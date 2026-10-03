import { assertMakerV8Document } from './maker-v8-document.js';
import { applyMakerV8WorkspaceCommand } from './maker-v8-workspace.js';

// Preserve the original Maker Info upload limit. Full decoding belongs to the UI.
export const MAKER_V8_CREATOR_COVER_MAX_BYTES = 5 * 1024 * 1024;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const JPEG_SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function invalidImage() {
  fail('MAKER_V8_CREATOR_COVER_INVALID', 'Choose a valid PNG or JPEG image.');
}

function dimensions(width, height, mediaType) {
  if (width < 1 || height < 1 || width > 8192 || height > 8192 || width * height > 32 * 1024 * 1024) {
    fail('MAKER_V8_CREATOR_COVER_DIMENSIONS_INVALID', 'Cover must fit 8192 pixels per side and 32 megapixels.');
  }
  return { width, height, mediaType };
}

function inspectImage(bytes) {
  if (!(bytes instanceof Uint8Array)) invalidImage();
  if (bytes.byteLength > MAKER_V8_CREATOR_COVER_MAX_BYTES) {
    fail('MAKER_V8_CREATOR_COVER_TOO_LARGE', 'Cover images must be 5 MB or smaller.');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 33 && PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
    if (view.getUint32(8) !== 13 || view.getUint32(12) !== 0x49484452) invalidImage();
    return dimensions(view.getUint32(16), view.getUint32(20), 'image/png');
  }
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) invalidImage();
  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset++] !== 0xff) invalidImage();
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    // Image dimensions must precede scan data. Stuffed bytes and restart markers
    // are scan-only; accepting them here would treat arbitrary data as a header.
    if (marker === undefined || marker === 0 || marker === 0xd8 || marker === 0xd9
      || marker === 0xda || (marker >= 0xd0 && marker <= 0xd7)) invalidImage();
    if (marker === 0x01) continue;
    if (offset + 2 > bytes.length) invalidImage();
    const length = view.getUint16(offset);
    if (length < 2 || offset + length > bytes.length) invalidImage();
    if (JPEG_SOF.has(marker)) {
      if (length < 11 || bytes[offset + 7] < 1 || length !== 8 + 3 * bytes[offset + 7]) invalidImage();
      return dimensions(view.getUint16(offset + 5), view.getUint16(offset + 3), 'image/jpeg');
    }
    offset += length;
  }
  invalidImage();
}

function base64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function savedCover(document, assets) {
  const descriptor = document.assets.find((row) => row.id === document.metadata.coverAssetId);
  const rows = assets.filter((row) => row?.assetId === document.metadata.coverAssetId);
  const row = rows[0];
  let actualLength = -1;
  if (typeof row?.bytesBase64 === 'string') {
    try {
      const binary = atob(row.bytesBase64);
      if (btoa(binary) === row.bytesBase64) actualLength = binary.length;
    } catch { /* Invalid durable bytes must not be overwritten or removed. */ }
  }
  if (!descriptor || rows.length !== 1 || !Number.isSafeInteger(row.revision) || row.revision < 1
    || row.kind !== descriptor.kind || row.mediaType !== descriptor.mediaType
    || row.byteLength !== descriptor.byteLength || actualLength !== descriptor.byteLength) {
    fail('MAKER_V8_CREATOR_COVER_ASSET_UNAVAILABLE', 'The cover asset must be loaded from its saved draft.');
  }
  return row;
}

// The descriptor is not a consumer. Preserve any other reference, including
// Styles, rights evidence, and opaque author payloads that may share this asset.
function sharedCover(document, assetId) {
  const visit = (value) => {
    if (value === assetId) return true;
    if (!value || typeof value !== 'object') return false;
    return Object.entries(value).some(([key, child]) => {
      if (value === document && key === 'assets') return false;
      if (value === document.metadata && key === 'coverAssetId') return false;
      return visit(child);
    });
  };
  return visit(document);
}

function nextCoverId(document, assets) {
  const used = new Set([...document.assets.map((row) => row.id), ...assets.map((row) => row?.assetId)]);
  for (let suffix = 1; suffix <= used.size + 1; suffix += 1) {
    const candidate = `maker-cover-${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  fail('MAKER_V8_CREATOR_COVER_ASSET_UNAVAILABLE', 'Unable to allocate a cover asset.');
}

/** Pure preparation only. Decode uploaded bytes before atomically saving these
 * commands and byte mutations through the existing draft transaction/Undo path. */
export function prepareCreatorCover({ document, assets, bytes, remove = false }) {
  assertMakerV8Document(document, { mode: 'draft' });
  if (typeof remove !== 'boolean') invalidImage();
  const result = { commands: [], assetUpserts: [], assetDeletes: [], width: null, height: null, mediaType: null, changed: false };
  const oldId = document.metadata.coverAssetId;
  if (remove && oldId === null) return result;
  if (!Array.isArray(assets)) {
    fail('MAKER_V8_CREATOR_COVER_ASSET_UNAVAILABLE', 'Load the saved draft assets before editing its cover.');
  }
  const oldAsset = oldId === null ? null : savedCover(document, assets);
  let nextId = null;
  if (!remove) {
    Object.assign(result, inspectImage(bytes));
    const bytesBase64 = base64(bytes);
    if (oldAsset?.bytesBase64 === bytesBase64 && oldAsset.mediaType === result.mediaType) return result;
    nextId = nextCoverId(document, assets);
    result.commands.push({ type: 'asset.upsert', row: {
      id: nextId, kind: 'cover', mediaType: result.mediaType, byteLength: bytes.byteLength,
    } });
    result.assetUpserts.push({ assetId: nextId, expectedRevision: null, kind: 'cover', mediaType: result.mediaType, bytesBase64 });
  }
  result.commands.push({ type: 'metadata.set', metadata: { ...structuredClone(document.metadata), coverAssetId: nextId } });
  if (oldAsset && !sharedCover(document, oldId)) {
    result.commands.push({ type: 'asset.remove', key: oldId });
    result.assetDeletes.push({ assetId: oldId, expectedRevision: oldAsset.revision });
  }
  // The bridge validates each command sequentially, before the one bundle CAS.
  result.commands.reduce(applyMakerV8WorkspaceCommand, document);
  result.changed = true;
  return result;
}
