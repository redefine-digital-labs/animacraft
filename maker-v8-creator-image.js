import { assertMakerV8Document } from './maker-v8-document.js';
import { applyMakerV8WorkspaceCommand } from './maker-v8-workspace.js';
import { MAKER_V8_SOURCE_ASSET_KEY } from './maker-v8-source-asset.js';

// Match the durable draft-store limit; decoding is a separate browser-side gate.
export const MAKER_V8_CREATOR_PNG_MAX_BYTES = 12 * 1024 * 1024;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

export function pngDimensions(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 33
    || !PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
    fail('MAKER_V8_CREATOR_PNG_INVALID', 'Select a PNG with a complete IHDR header.');
  }
  if (bytes.byteLength > MAKER_V8_CREATOR_PNG_MAX_BYTES) {
    fail('MAKER_V8_CREATOR_PNG_TOO_LARGE', 'PNG files must not exceed 12 MiB.');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(8) !== 13 || view.getUint32(12) !== 0x49484452) {
    fail('MAKER_V8_CREATOR_PNG_INVALID', 'PNG must begin with a 13-byte IHDR chunk.');
  }
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width < 1 || height < 1 || width > 8192 || height > 8192
    || width * height > 32 * 1024 * 1024) {
    fail('MAKER_V8_CREATOR_PNG_DIMENSIONS_INVALID', 'PNG must fit 8192 pixels per side and 32 megapixels.');
  }
  return { width, height };
}

function base64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

// Conservatively preserve any document reference, including cover, rights evidence
// and opaque author payloads. The descriptor collection itself is not a consumer.
function hasOtherReference(document, selectedStyle, assetId) {
  const visit = (value) => {
    if (value === assetId) return true;
    if (!value || typeof value !== 'object') return false;
    return Object.entries(value).some(([key, child]) => {
      if (value === document && key === 'assets') return false;
      if (value === selectedStyle && key === 'assetId') return false;
      return visit(child);
    });
  };
  return visit(document);
}

function exclusiveAssetId(oldId, document, assets) {
  const used = new Set([...document.assets.map((row) => row.id), ...assets.map((row) => row.assetId)]);
  for (let suffix = 1; suffix <= used.size + 1; suffix += 1) {
    const tail = `-style-${suffix}`;
    const candidate = `${oldId.slice(0, 128 - tail.length)}${tail}`;
    if (!used.has(candidate)) return candidate;
  }
  fail('MAKER_V8_CREATOR_ASSET_ID_INVALID', 'Unable to allocate an exclusive style asset.');
}

/** Prepare only: the caller must decode the PNG and atomically persist commands
 * and assetUpserts. UI-only style locks are passed separately from the document. */
export function prepareCreatorStylePng({ document, assets, partKey, itemKey, styleKey, bytes, styleLocked = false }) {
  assertMakerV8Document(document, { mode: 'draft' });
  if (typeof styleLocked !== 'boolean' || styleLocked) {
    fail('MAKER_V8_CREATOR_STYLE_LOCKED', 'Unlock this Style before replacing its PNG.');
  }
  const part = document.parts.find((row) => row.key === partKey);
  const item = part?.items.find((row) => row.key === itemKey);
  const style = item?.styles.find((row) => row.key === styleKey);
  if (!style) fail('MAKER_V8_CREATOR_STYLE_NOT_FOUND', 'The selected Style no longer exists.');
  const editor = style.payload.animacraftEditor;
  if (editor !== undefined && (!editor || typeof editor !== 'object' || Array.isArray(editor)
    || ['styleLocked', 'positionLocked', 'positionConfirmed'].some(key => editor[key] !== undefined && typeof editor[key] !== 'boolean'))) {
    fail('MAKER_V8_CREATOR_STYLE_INVALID', 'The existing Style editor metadata cannot be overwritten.');
  }
  if (editor?.styleLocked === true) fail('MAKER_V8_CREATOR_STYLE_LOCKED', 'Unlock this Style before replacing its PNG.');
  const { width, height } = pngDimensions(bytes);
  const firstUpload = style.assetId === null;
  const descriptor = document.assets.find((row) => row.id === style.assetId);
  const durableRows = Array.isArray(assets) ? assets.filter((row) => row?.assetId === style.assetId) : [];
  const durable = durableRows[0];
  if (!Array.isArray(assets) || (!firstUpload && (!descriptor || durableRows.length !== 1 || !Number.isSafeInteger(durable.revision)
    || durable.revision < 1 || durable.kind !== descriptor.kind
    || durable.mediaType !== descriptor.mediaType || durable.byteLength !== descriptor.byteLength))) {
    fail('MAKER_V8_CREATOR_ASSET_UNAVAILABLE', 'The selected Style asset must be loaded from its saved draft.');
  }
  const shared = !firstUpload && hasOtherReference(document, style, style.assetId);
  const assetId = firstUpload
    ? exclusiveAssetId(`${partKey}-${itemKey}-${styleKey}`, document, assets)
    : shared ? exclusiveAssetId(style.assetId, document, assets) : style.assetId;
  const kind = firstUpload ? 'layer' : descriptor.kind;
  const commands = [{ type: 'asset.upsert', row: {
    id: assetId, kind, mediaType: 'image/png', byteLength: bytes.byteLength,
  } }];
  if (firstUpload || shared || !editor?.positionLocked || Object.hasOwn(style.payload, MAKER_V8_SOURCE_ASSET_KEY)) {
    const nextPart = structuredClone(part);
    const nextStyle = nextPart.items.find((row) => row.key === itemKey).styles.find((row) => row.key === styleKey);
    nextStyle.assetId = assetId;
    // Replacing source art invalidates its prior publication identity. The next
    // publication derives the replacement from durable bytes before hashing.
    delete nextStyle.payload[MAKER_V8_SOURCE_ASSET_KEY];
    if (!editor?.positionLocked) {
      // Preserve full PNG extent (including transparent margins), never upscale.
      // Quantize downward to the existing six-place scale contract so a rounded
      // ratio never grows the fitted source beyond the authored canvas.
      const scale = Math.floor(Math.min(1, document.canvas.width / width, document.canvas.height / height) * 1e6) / 1e6;
      nextStyle.transform = { x: Math.round((document.canvas.width - width * scale) / 2),
        y: Math.round((document.canvas.height - height * scale) / 2), scale, rotation: 0 };
      nextStyle.payload.animacraftEditor = { ...editor, positionConfirmed: false };
    }
    commands.push({ type: 'part.upsert', row: nextPart });
  }
  // Each command is independently valid, matching the bridge's sequential checks.
  commands.reduce((current, command) => applyMakerV8WorkspaceCommand(current, command), document);
  return {
    commands,
    assetUpserts: [{ assetId, expectedRevision: firstUpload || shared ? null : durable.revision,
      kind, mediaType: 'image/png', bytesBase64: base64(bytes) }],
    width,
    height,
  };
}
