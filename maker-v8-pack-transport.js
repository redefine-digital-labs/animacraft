import { fromBase64, toBase64 } from '@mysten/sui/utils';
import { sha256 } from '@noble/hashes/sha2.js';
import { packPublicationAuthoringContent, assertPublicPackAuthoringContent } from './maker-v8-pack-authoring.js';

import {
  MAKER_V8_PACK_DOCUMENT_SCHEMA,
  assertMakerV8PackDocumentV8,
  assertMakerV8PackPublicationContentV8,
  canonicalMakerV8PackJson,
} from './maker-v8-pack-controller.js';
import {
  MAKER_V8_PROTECTED_ASSET_REQUEST_SCHEMA,
  MAKER_V8_SEAL_CIPHERTEXT_MEDIA_TYPE,
  assertMakerV8ProtectedAssetV8,
} from './maker-v8-protected-transport.js';
import { makerV8WalrusUploadIdV8 } from './maker-v8-walrus.js';

export const MAKER_V8_PACK_TRANSPORT_SCHEMA =
  'animacraft.maker-v8-pack-transport.v1';
export const MAKER_V8_PACK_MANIFEST_SCHEMA =
  'animacraft.maker-v8-pack-manifest.v1';
export const MAKER_V8_PACK_MANIFEST_READ_SCHEMA =
  'animacraft.maker-v8-pack-manifest-read.v1';

const HASH = /^[0-9a-f]{64}$/;
const EXACT_ID = /^0x[0-9a-f]{64}$/;
const PLAINTEXT_MEDIA_TYPES = new Set(['image/png', 'image/webp']);
const CERTIFIED_MEDIA_TYPES = new Set([
  ...PLAINTEXT_MEDIA_TYPES,
  MAKER_V8_SEAL_CIPHERTEXT_MEDIA_TYPE,
]);
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const MAX_PACK_MANIFEST_BYTES = 12 * 1024 * 1024;

export class MakerV8PackTransportError extends Error {
  constructor(code, message, layer = 'PACK_TRANSPORT', details = undefined) {
    super(message);
    this.name = 'MakerV8PackTransportError';
    this.code = code;
    this.layer = layer;
    if (details !== undefined) this.details = Object.freeze(structuredClone(details));
  }
}

function fail(code, message, layer = 'PACK_TRANSPORT', details) {
  throw new MakerV8PackTransportError(code, message, layer, details);
}

function plain(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (ArrayBuffer.isView(value)) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
}

function exact(value, fields, label) {
  if (!plain(value)) fail('MAKER_V8_PACK_TRANSPORT_SHAPE_INVALID', `${label} must be a plain record.`, 'VALIDATION');
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) {
    fail('MAKER_V8_PACK_TRANSPORT_SHAPE_INVALID', `${label} has fields outside its exact schema.`, 'VALIDATION', {
      actual,
      expected,
    });
  }
  return value;
}

function requireMethod(value, method, label) {
  if (typeof value?.[method] !== 'function') {
    fail('MAKER_V8_PACK_TRANSPORT_DEPENDENCY_INVALID', `${label}.${method} is required.`, 'CONFIGURATION');
  }
}

function hashBytes(bytes) {
  return [...sha256(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function canonicalBase64(value, label) {
  try {
    if (typeof value !== 'string' || value.length === 0) throw new Error('shape');
    const bytes = fromBase64(value);
    if (toBase64(bytes) !== value) throw new Error('canonical');
    return bytes;
  } catch {
    fail('MAKER_V8_PACK_TRANSPORT_BYTES_INVALID', `${label} must be non-empty canonical Base64.`, 'VALIDATION');
  }
}

function owner(value) {
  const checked = typeof value === 'string' ? value.toLowerCase() : '';
  if (!EXACT_ID.test(checked) || /^0x0+$/.test(checked)) {
    fail('MAKER_V8_PACK_TRANSPORT_OWNER_INVALID', 'Pack transport owner must be one canonical non-zero Sui address.', 'VALIDATION');
  }
  return checked;
}

function assetRecord(value, draftId) {
  exact(value, [
    'schemaVersion', 'draftId', 'assetId', 'revision', 'createdAt', 'updatedAt',
    'mediaType', 'bytesBase64', 'byteLength', 'sha256',
  ], `Pack asset ${String(value?.assetId ?? '')}`);
  const bytes = canonicalBase64(value.bytesBase64, `Pack asset ${String(value.assetId)}`);
  if (value.draftId !== draftId || typeof value.assetId !== 'string'
    || !PLAINTEXT_MEDIA_TYPES.has(value.mediaType) || value.byteLength !== bytes.length
    || !HASH.test(value.sha256) || value.sha256 !== hashBytes(bytes)) {
    fail('MAKER_V8_PACK_TRANSPORT_ASSET_INVALID', 'Persisted Pack asset bytes or metadata are invalid.', 'VALIDATION', {
      assetId: value.assetId,
    });
  }
  return freeze({ ...structuredClone(value), bytes });
}

function prepareInput(input) {
  exact(input, ['draft', 'assets', 'owner'], 'Pack transport input');
  const draft = structuredClone(input.draft);
  if (draft?.publication?.status !== 'UNPREPARED') {
    fail('MAKER_V8_PACK_TRANSPORT_DRAFT_LOCKED', 'Pack transport may run only before a chain publication attempt exists.', 'VALIDATION');
  }
  draft.document = assertMakerV8PackDocumentV8(draft.document, { mode: 'DRAFT' });
  if (draft.document.bindings.kind === 'LOCAL_DRAFT') {
    fail('MAKER_V8_PACK_PARENT_NOT_PUBLISHED', 'Bind and validate the exact public parent before any Pack upload.', 'VALIDATION');
  }
  const checkedOwner = owner(input.owner);
  if (draft.document.authoring !== undefined) {
    fail('MAKER_V8_PACK_AUTHORING_NOT_PUBLISHABLE', 'Authored Pack runtime mapping must be complete before uploading.', 'VALIDATION');
  }
  if (draft.document.author.address !== checkedOwner) {
    fail('MAKER_V8_PACK_TRANSPORT_AUTHOR_DRIFT', 'Pack transport owner differs from the exact Pack author.', 'VALIDATION');
  }
  if (!Array.isArray(input.assets)) {
    fail('MAKER_V8_PACK_TRANSPORT_ASSET_SET_INVALID', 'Pack transport assets must be an exact array.', 'VALIDATION');
  }
  const assets = input.assets.map((entry) => assetRecord(entry, draft.draftId));
  const byId = new Map(assets.map((asset) => [asset.assetId, asset]));
  if (byId.size !== assets.length || draft.document.styles.length !== assets.length) {
    fail('MAKER_V8_PACK_TRANSPORT_ASSET_SET_INVALID', 'Pack transport requires exactly one durable asset for every Style.', 'VALIDATION');
  }
  for (const style of draft.document.styles) {
    const asset = byId.get(style.asset.assetId);
    if (!asset || !style.asset.protected && style.asset.sealBindingCommitment !== null
      || style.asset.protected && style.asset.sealBindingCommitment !== null
      || asset.mediaType !== style.asset.mediaType
      || asset.byteLength !== style.asset.byteLength
      || asset.sha256 !== style.asset.sha256
      || style.asset.contentCommitment !== style.asset.sha256) {
      fail('MAKER_V8_PACK_TRANSPORT_ASSET_DRIFT', 'Pack Style descriptor differs from its exact local asset bytes.', 'VALIDATION', {
        assetId: style.asset.assetId,
      });
    }
  }
  assets.sort((left, right) => left.assetId < right.assetId ? -1 : left.assetId > right.assetId ? 1 : 0);
  return freeze({ draft, assets, owner: checkedOwner });
}

function stageView(stage, upload, completedAssets, assetId = null) {
  const status = upload?.status;
  if (!['SIGNATURE_REQUIRED', 'RECOVERY_REQUIRED', 'FAILED'].includes(status)) {
    fail('MAKER_V8_PACK_TRANSPORT_UPLOAD_STATE_INVALID', 'Pack Walrus upload returned an unsupported durable state.');
  }
  const publicStatus = status === 'FAILED'
    ? 'FAILED' : status === 'SIGNATURE_REQUIRED'
      ? 'TRANSPORT_SIGNATURE_REQUIRED' : 'TRANSPORT_RECOVERY_REQUIRED';
  return freeze({
    schemaVersion: MAKER_V8_PACK_TRANSPORT_SCHEMA,
    status: publicStatus,
    stage,
    assetId,
    completedAssets,
    upload,
    prepared: null,
    message: status === 'FAILED'
      ? `Pack ${stage === 'ASSET' ? 'asset' : 'Manifest'} transport failed and requires review.`
      : status === 'SIGNATURE_REQUIRED'
        ? `Review and sign the exact Pack ${stage === 'ASSET' ? 'asset' : 'Manifest'} Walrus transaction.`
        : `Query and recover the existing Pack ${stage === 'ASSET' ? 'asset' : 'Manifest'} Walrus transaction.`,
  });
}

function publicationPayload(document) {
  return freeze({
    schemaVersion: 'animacraft.maker-v8-pack-content.v1',
    protocolVersion: 8,
    rootId: document.bindings.root.objectRef.objectId,
    rootVersion: document.bindings.root.makerVersion,
    rootContentCommitment: document.bindings.root.contentCommitment,
    semanticPackId: document.metadata.semanticPackId,
    metadata: structuredClone(document.metadata),
    author: structuredClone(document.author),
    admission: structuredClone(document.admission),
    access: structuredClone(document.access),
    completion: structuredClone(document.completion),
    styles: document.styles.map((style) => structuredClone(style)),
    authoring: document.authoring === undefined ? null : packPublicationAuthoringContent(document).content,
  });
}

function semanticPublicationPayload(document) {
  const content = document?.schemaVersion === 'animacraft.maker-v8-pack-content.v1'
    ? structuredClone(document) : structuredClone(publicationPayload(document));
  content.styles = content.styles.map((style) => ({
    ...style,
    asset: {
      assetId: style.asset.assetId,
      contentCommitment: style.asset.contentCommitment,
      protected: style.asset.protected,
    },
  }));
  return freeze(content);
}

export function deriveMakerV8PackSemanticContentCommitmentV8(documentValue) {
  const document = assertMakerV8PackDocumentV8(documentValue, { mode: 'DRAFT' });
  return hashBytes(encoder.encode(canonicalMakerV8PackJson(
    semanticPublicationPayload(document),
  )));
}

/** Pure publication encoding shared by preparation, recovery and offline
 * compilation. Producing bytes grants no upload or transaction authority. */
export function buildMakerV8PackManifestV8(documentValue) {
  const document = assertMakerV8PackDocumentV8(structuredClone(documentValue), { mode: 'COMPILE' });
  const content = publicationPayload(document);
  const contentCommitment = deriveMakerV8PackSemanticContentCommitmentV8(document);
  const manifest = freeze({
    schemaVersion: MAKER_V8_PACK_MANIFEST_SCHEMA,
    protocolVersion: 8,
    contentCommitment,
    content,
  });
  const bytes = encoder.encode(canonicalMakerV8PackJson(manifest));
  if (bytes.length > MAX_PACK_MANIFEST_BYTES) {
    fail('MAKER_V8_PACK_MANIFEST_BYTE_BUDGET', 'Pack Manifest exceeds its bounded byte budget.', 'VALIDATION');
  }
  assertMakerV8PackManifestV8(manifest, null, content.authoring?.parent ?? null);
  return freeze({
    manifest,
    bytesBase64: toBase64(bytes),
    byteLength: bytes.length,
    sha256: hashBytes(bytes),
    contentCommitment,
  });
}

export function assertMakerV8PackManifestV8(value, expected = null, expectedParent = null) {
  const manifest = structuredClone(value);
  exact(manifest, [
    'schemaVersion', 'protocolVersion', 'contentCommitment', 'content',
  ], 'Pack Manifest');
  if (manifest.schemaVersion !== MAKER_V8_PACK_MANIFEST_SCHEMA
    || manifest.protocolVersion !== 8
    || !HASH.test(manifest.contentCommitment)) {
    fail('MAKER_V8_PACK_MANIFEST_SCHEMA_INVALID', 'Pack Manifest is not exact Fresh Maker v8.', 'VALIDATION');
  }
  manifest.content = assertMakerV8PackPublicationContentV8(manifest.content);
  if (manifest.content.authoring !== null) {
    const authored = assertPublicPackAuthoringContent(manifest.content.authoring, { expectedParent });
    const indexed = manifest.content.styles.map(style => ({ sequence: style.sequence,
      partKey: style.partKey, itemKey: style.itemKey, styleKey: style.styleKey,
      layerTrackKey: style.layerTrackKey, colorChannelKey: style.colorChannelKey,
      defaultSwatchKey: style.defaultSwatchKey,
      asset: { assetId: style.asset.assetId, contentCommitment: style.asset.contentCommitment, protected: style.asset.protected } }));
    if (canonicalMakerV8PackJson(indexed) !== canonicalMakerV8PackJson(authored.content.styles)) {
      fail('MAKER_V8_PACK_MANIFEST_CONTENT_DRIFT', 'Pack authoring differs from its published Style inventory.', 'VALIDATION');
    }
  }
  const contentCommitment = hashBytes(encoder.encode(canonicalMakerV8PackJson(
    semanticPublicationPayload(manifest.content),
  )));
  if (manifest.contentCommitment !== contentCommitment) {
    fail('MAKER_V8_PACK_MANIFEST_CONTENT_DRIFT', 'Pack Manifest content commitment is invalid.', 'VALIDATION');
  }
  if (expected !== null) {
    exact(expected, [
      'rootId', 'rootVersion', 'rootContentCommitment',
      'semanticPackId', 'contentCommitment',
    ], 'expected Pack Manifest binding');
    if (manifest.content.rootId !== expected.rootId
      || manifest.content.rootVersion !== expected.rootVersion
      || manifest.content.rootContentCommitment !== expected.rootContentCommitment
      || manifest.content.semanticPackId !== expected.semanticPackId
      || manifest.contentCommitment !== expected.contentCommitment) {
      fail('MAKER_V8_PACK_MANIFEST_BINDING_DRIFT', 'Pack Manifest differs from its exact active Release.', 'VALIDATION');
    }
  }
  return freeze(manifest);
}

async function boundedPackManifestBytes(value, maximumBytes) {
  if (value instanceof Uint8Array || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    const bytes = value instanceof Uint8Array
      ? new Uint8Array(value)
      : value instanceof ArrayBuffer
        ? new Uint8Array(value.slice(0))
        : new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
    if (bytes.length < 1 || bytes.length > maximumBytes) {
      fail('MAKER_V8_PACK_MANIFEST_BYTE_BUDGET', 'Pack Manifest exceeds its bounded byte budget.', 'TRANSPORT');
    }
    return bytes;
  }
  if (!value || typeof value !== 'object' || value.ok === false) {
    fail('MAKER_V8_PACK_MANIFEST_FETCH_FAILED', 'Pack Manifest transport did not return bytes.', 'TRANSPORT');
  }
  const contentLength = value.headers?.get?.('content-length');
  if (contentLength != null
    && (!/^(?:0|[1-9][0-9]*)$/.test(contentLength)
      || BigInt(contentLength) > BigInt(maximumBytes))) {
    fail('MAKER_V8_PACK_MANIFEST_BYTE_BUDGET', 'Pack Manifest Content-Length exceeds its bounded byte budget.', 'TRANSPORT');
  }
  if (value.body?.getReader) {
    const reader = value.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
        total += bytes.length;
        if (total > maximumBytes) {
          await reader.cancel().catch(() => {});
          fail('MAKER_V8_PACK_MANIFEST_BYTE_BUDGET', 'Streamed Pack Manifest exceeds its bounded byte budget.', 'TRANSPORT');
        }
        chunks.push(bytes);
      }
    } finally {
      reader.releaseLock?.();
    }
    const output = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.length;
    }
    if (!output.length) fail('MAKER_V8_PACK_MANIFEST_FETCH_FAILED', 'Pack Manifest is empty.', 'TRANSPORT');
    return output;
  }
  if (typeof value.arrayBuffer !== 'function') {
    fail('MAKER_V8_PACK_MANIFEST_FETCH_FAILED', 'Pack Manifest response body is unreadable.', 'TRANSPORT');
  }
  const output = new Uint8Array(await value.arrayBuffer());
  if (!output.length || output.length > maximumBytes) {
    fail('MAKER_V8_PACK_MANIFEST_BYTE_BUDGET', 'Pack Manifest exceeds its bounded byte budget.', 'TRANSPORT');
  }
  return output;
}

/** Byte-bounded, hash-bound read adapter for active Pack Manifests. */
export function createMakerV8PackManifestReadAdapterV8({
  fetcher,
  loadParent = null,
  maximumBytes = MAX_PACK_MANIFEST_BYTES,
} = {}) {
  if (typeof fetcher !== 'function'
    || !Number.isSafeInteger(maximumBytes)
    || maximumBytes < 1024
    || maximumBytes > MAX_PACK_MANIFEST_BYTES) {
    fail('MAKER_V8_PACK_MANIFEST_READER_INVALID', 'Pack Manifest reader configuration is invalid.', 'CONFIGURATION');
  }
  return freeze({
    schemaVersion: MAKER_V8_PACK_MANIFEST_READ_SCHEMA,
    async load(input = {}) {
      exact(input, [
        'blobId', 'sha256', 'rootId', 'rootVersion', 'rootContentCommitment',
        'semanticPackId', 'contentCommitment',
      ], 'Pack Manifest read input');
      if (typeof input.blobId !== 'string' || !input.blobId
        || !HASH.test(input.sha256) || !HASH.test(input.contentCommitment)) {
        fail('MAKER_V8_PACK_MANIFEST_READ_INPUT_INVALID', 'Pack Manifest read identity is invalid.', 'VALIDATION');
      }
      const bytes = await boundedPackManifestBytes(
        await fetcher({ blobId: input.blobId, maximumBytes }),
        maximumBytes,
      );
      if (hashBytes(bytes) !== input.sha256) {
        fail('MAKER_V8_PACK_MANIFEST_HASH_DRIFT', 'Fetched Pack Manifest differs from its Release SHA-256.', 'INTEGRITY');
      }
      let text;
      let parsed;
      try {
        text = decoder.decode(bytes);
        parsed = JSON.parse(text);
      } catch {
        fail('MAKER_V8_PACK_MANIFEST_JSON_INVALID', 'Pack Manifest is not strict UTF-8 JSON.', 'VALIDATION');
      }
      const binding = {
        rootId: input.rootId,
        rootVersion: input.rootVersion,
        rootContentCommitment: input.rootContentCommitment,
        semanticPackId: input.semanticPackId,
        contentCommitment: input.contentCommitment,
      };
      const expectedParent = parsed?.content?.authoring != null && typeof loadParent === 'function'
        ? await loadParent({ rootId: input.rootId, rootVersion: input.rootVersion, rootContentCommitment: input.rootContentCommitment }) : null;
      const manifest = assertMakerV8PackManifestV8(parsed, binding, expectedParent);
      if (canonicalMakerV8PackJson(manifest) !== text) {
        fail('MAKER_V8_PACK_MANIFEST_NONCANONICAL', 'Pack Manifest JSON is not canonical.', 'INTEGRITY');
      }
      return freeze({
        schemaVersion: MAKER_V8_PACK_MANIFEST_READ_SCHEMA,
        blobId: input.blobId,
        sha256: input.sha256,
        byteLength: bytes.length,
        manifest,
        assets: freeze(manifest.content.styles.map((style) => freeze({
          assetId: style.asset.assetId,
          blobId: style.asset.blobId,
          mediaType: style.asset.mediaType,
          byteLength: style.asset.byteLength,
          sha256: style.asset.sha256,
        }))),
      });
    },
  });
}

export function assertMakerV8PackPreparedTransportV8(value, expectedDocument = null) {
  const prepared = structuredClone(value);
  exact(prepared, ['schemaVersion', 'document', 'manifest', 'assets'], 'prepared Pack transport');
  if (prepared.schemaVersion !== MAKER_V8_PACK_TRANSPORT_SCHEMA) {
    fail('MAKER_V8_PACK_TRANSPORT_SCHEMA_INVALID', 'Prepared Pack transport schema is invalid.', 'VALIDATION');
  }
  prepared.document = assertMakerV8PackDocumentV8(prepared.document, { mode: 'COMPILE' });
  if (expectedDocument !== null
    && canonicalMakerV8PackJson(prepared.document) !== canonicalMakerV8PackJson(
      assertMakerV8PackDocumentV8(expectedDocument, { mode: 'COMPILE' }),
    )) {
    fail('MAKER_V8_PACK_TRANSPORT_DOCUMENT_DRIFT', 'Prepared Pack transport differs from the exact compiler document.', 'VALIDATION');
  }
  exact(prepared.manifest, [
    'blobId', 'bytesBase64', 'byteLength', 'sha256', 'contentCommitment',
  ], 'prepared Pack Manifest');
  if (typeof prepared.manifest.blobId !== 'string' || !prepared.manifest.blobId
    || !HASH.test(prepared.manifest.sha256) || !HASH.test(prepared.manifest.contentCommitment)) {
    fail('MAKER_V8_PACK_TRANSPORT_MANIFEST_INVALID', 'Prepared Pack Manifest identity is invalid.', 'VALIDATION');
  }
  const bytes = canonicalBase64(prepared.manifest.bytesBase64, 'prepared Pack Manifest');
  const expected = buildMakerV8PackManifestV8(prepared.document);
  if (prepared.manifest.byteLength !== bytes.length
    || prepared.manifest.byteLength !== expected.byteLength
    || prepared.manifest.sha256 !== hashBytes(bytes)
    || prepared.manifest.sha256 !== expected.sha256
    || prepared.manifest.contentCommitment !== expected.contentCommitment
    || prepared.manifest.bytesBase64 !== expected.bytesBase64) {
    fail('MAKER_V8_PACK_TRANSPORT_MANIFEST_DRIFT', 'Prepared Pack Manifest bytes differ from the canonical Pack document.', 'VALIDATION');
  }
  if (!Array.isArray(prepared.assets) || prepared.assets.length !== prepared.document.styles.length) {
    fail('MAKER_V8_PACK_TRANSPORT_ASSET_SET_INVALID', 'Prepared Pack transport has an incomplete asset set.', 'VALIDATION');
  }
  const assets = new Map();
  for (const [index, asset] of prepared.assets.entries()) {
    exact(asset, ['assetId', 'blobId', 'mediaType', 'byteLength', 'sha256'], `prepared Pack asset[${index}]`);
    if (typeof asset.assetId !== 'string' || typeof asset.blobId !== 'string' || !asset.blobId
      || !CERTIFIED_MEDIA_TYPES.has(asset.mediaType) || !Number.isSafeInteger(asset.byteLength)
      || asset.byteLength < 1 || !HASH.test(asset.sha256) || assets.has(asset.assetId)) {
      fail('MAKER_V8_PACK_TRANSPORT_ASSET_INVALID', 'Prepared Pack asset identity is invalid.', 'VALIDATION');
    }
    assets.set(asset.assetId, asset);
  }
  for (const style of prepared.document.styles) {
    const asset = assets.get(style.asset.assetId);
    if (!asset || asset.blobId !== style.asset.blobId
      || asset.mediaType !== style.asset.mediaType
      || asset.byteLength !== style.asset.byteLength
      || asset.sha256 !== style.asset.sha256) {
      fail('MAKER_V8_PACK_TRANSPORT_ASSET_DRIFT', 'Prepared Pack Style differs from its certified asset.', 'VALIDATION');
    }
  }
  return freeze(prepared);
}

/**
 * Certifies every unprotected Pack Style asset and one canonical Pack Manifest
 * before any Runtime-v8 transaction may be prepared. Each Walrus blob owns its
 * own strict durable WAL; this coordinator never stores a parallel authority.
 */
export function createMakerV8PackTransportV8({
  publisher,
  compiler = null,
  protector = null,
} = {}) {
  for (const method of ['prepare', 'requestSignature', 'resume', 'load']) {
    requireMethod(publisher, method, 'publisher');
  }

  const requireProtection = () => {
    requireMethod(publisher, 'loadContent', 'publisher');
    requireMethod(compiler, 'prepareProtectedAssetIdentities', 'compiler');
    requireMethod(compiler, 'bindProtectedAssetTransports', 'compiler');
    requireMethod(protector, 'protectAsset', 'protector');
  };

  const ensureUpload = async ({ uploadId, owner: checkedOwner, mediaType, bytesBase64 }) => {
    let view = await publisher.load(uploadId);
    if (!view) {
      view = await publisher.prepare({
        uploadId,
        owner: checkedOwner,
        mediaType,
        bytesBase64,
        epochs: 3,
      });
    }
    return view;
  };

  const ensureProtectedUpload = async ({ checked, asset, identity }) => {
    const semanticSha256 = hashBytes(encoder.encode(canonicalMakerV8PackJson({
      schemaVersion: MAKER_V8_PACK_TRANSPORT_SCHEMA,
      identity,
      plaintextSha256: asset.sha256,
    })));
    const uploadId = makerV8WalrusUploadIdV8({
      owner: checked.owner,
      purpose: `pack-protected-${hashBytes(encoder.encode(`${checked.draft.draftId}:${asset.assetId}`)).slice(0, 24)}`,
      contentSha256: semanticSha256,
    });
    let content = await publisher.loadContent(uploadId);
    if (!content) {
      const encrypted = assertMakerV8ProtectedAssetV8(await protector.protectAsset({
        schemaVersion: MAKER_V8_PROTECTED_ASSET_REQUEST_SCHEMA,
        identity,
        asset: {
          mediaType: asset.mediaType,
          bytesBase64: asset.bytesBase64,
          byteLength: asset.byteLength,
          sha256: asset.sha256,
        },
      }), identity);
      try {
        await ensureUpload({
          uploadId,
          owner: checked.owner,
          mediaType: encrypted.mediaType,
          bytesBase64: encrypted.bytesBase64,
        });
      } catch (error) {
        if (error?.code !== 'MAKER_V8_WALRUS_UPLOAD_EXISTS') throw error;
      }
      content = await publisher.loadContent(uploadId);
    }
    const bytes = content === null ? null : canonicalBase64(
      content.bytesBase64,
      `durable protected Pack asset ${asset.assetId}`,
    );
    if (!content || content.uploadId !== uploadId || content.owner !== checked.owner
      || content.mediaType !== MAKER_V8_SEAL_CIPHERTEXT_MEDIA_TYPE
      || bytes.length !== content.byteLength || hashBytes(bytes) !== content.byteSha256) {
      fail(
        'MAKER_V8_PACK_PROTECTED_ASSET_DRIFT',
        `Durable protected Pack asset ${asset.assetId} differs from its exact ciphertext.`,
        'PERSISTENCE',
      );
    }
    const upload = await publisher.load(uploadId);
    if (!upload) {
      fail('MAKER_V8_PACK_PROTECTED_ASSET_DRIFT', 'Protected Pack Walrus upload is missing.', 'PERSISTENCE');
    }
    return freeze({ upload, content });
  };

  const inspect = async (input, operation) => {
    const checked = prepareInput(input);
    const document = structuredClone(checked.draft.document);
    const protectedStyles = document.styles.filter((style) => style.asset.protected);
    let identities = new Map();
    if (protectedStyles.length) {
      requireProtection();
      const prepared = await compiler.prepareProtectedAssetIdentities({
        draft: structuredClone(checked.draft),
        assets: checked.assets.map((asset) => ({
          assetId: asset.assetId,
          mediaType: asset.mediaType,
          bytesBase64: asset.bytesBase64,
          byteLength: asset.byteLength,
          sha256: asset.sha256,
        })),
      });
      if (!Array.isArray(prepared?.assets) || prepared.assets.length !== protectedStyles.length) {
        fail('MAKER_V8_PACK_PROTECTED_IDENTITY_DRIFT', 'Compiler did not return every protected Pack asset identity.', 'COMPILER');
      }
      identities = new Map(prepared.assets.map((entry) => [entry.assetId, entry.identity]));
      if (protectedStyles.some((style) => !identities.has(style.asset.assetId))) {
        fail('MAKER_V8_PACK_PROTECTED_IDENTITY_DRIFT', 'Compiler protected identities differ from the Pack draft.', 'COMPILER');
      }
    }
    const uploadedAssets = [];
    for (const asset of checked.assets) {
      const style = document.styles.find((entry) => entry.asset.assetId === asset.assetId);
      let content = {
        mediaType: asset.mediaType,
        bytesBase64: asset.bytesBase64,
        byteLength: asset.byteLength,
        byteSha256: asset.sha256,
      };
      let upload;
      if (style.asset.protected) {
        const durable = await ensureProtectedUpload({
          checked,
          asset,
          identity: identities.get(asset.assetId),
        });
        upload = durable.upload;
        content = durable.content;
      } else {
        const uploadId = makerV8WalrusUploadIdV8({
          owner: checked.owner,
          purpose: `pack-asset-${hashBytes(encoder.encode(`${checked.draft.draftId}:${asset.assetId}`)).slice(0, 24)}`,
          contentSha256: asset.sha256,
        });
        upload = await ensureUpload({
          uploadId,
          owner: checked.owner,
          mediaType: asset.mediaType,
          bytesBase64: asset.bytesBase64,
        });
      }
      if (upload.status !== 'COMPLETE') {
        if (operation === 'SIGN' && upload.status === 'SIGNATURE_REQUIRED') {
          upload = await publisher.requestSignature(upload.uploadId);
        } else if (operation === 'RECOVER' && upload.status === 'RECOVERY_REQUIRED') {
          upload = await publisher.resume(upload.uploadId);
        }
        if (upload.status !== 'COMPLETE') {
          return stageView('ASSET', upload, uploadedAssets.length, asset.assetId);
        }
      }
      uploadedAssets.push(freeze({
        assetId: asset.assetId,
        blobId: upload.blobId,
        mediaType: content.mediaType,
        byteLength: content.byteLength,
        sha256: content.byteSha256,
      }));
    }
    let publicationDocument = document;
    if (protectedStyles.length) {
      const bound = await compiler.bindProtectedAssetTransports({
        draft: structuredClone(checked.draft),
        assets: structuredClone(uploadedAssets),
      });
      publicationDocument = structuredClone(bound?.document);
    } else {
      for (const asset of uploadedAssets) {
        const style = publicationDocument.styles.find((entry) => entry.asset.assetId === asset.assetId);
        style.asset.blobId = asset.blobId;
      }
    }
    const compiledDocument = assertMakerV8PackDocumentV8(publicationDocument, { mode: 'COMPILE' });
    const manifest = buildMakerV8PackManifestV8(compiledDocument);
    const manifestUploadId = makerV8WalrusUploadIdV8({
      owner: checked.owner,
      purpose: `pack-manifest-${hashBytes(encoder.encode(checked.draft.draftId)).slice(0, 24)}`,
      contentSha256: manifest.sha256,
    });
    let upload = await ensureUpload({
      uploadId: manifestUploadId,
      owner: checked.owner,
      mediaType: 'application/json',
      bytesBase64: manifest.bytesBase64,
    });
    if (upload.status !== 'COMPLETE') {
      if (operation === 'SIGN' && upload.status === 'SIGNATURE_REQUIRED') {
        upload = await publisher.requestSignature(upload.uploadId);
      } else if (operation === 'RECOVER' && upload.status === 'RECOVERY_REQUIRED') {
        upload = await publisher.resume(upload.uploadId);
      }
      if (upload.status !== 'COMPLETE') {
        return stageView('MANIFEST', upload, uploadedAssets.length);
      }
    }
    const prepared = assertMakerV8PackPreparedTransportV8({
      schemaVersion: MAKER_V8_PACK_TRANSPORT_SCHEMA,
      document: structuredClone(compiledDocument),
      manifest: {
        blobId: upload.blobId,
        bytesBase64: manifest.bytesBase64,
        byteLength: manifest.byteLength,
        sha256: manifest.sha256,
        contentCommitment: manifest.contentCommitment,
      },
      assets: uploadedAssets,
    });
    return freeze({
      schemaVersion: MAKER_V8_PACK_TRANSPORT_SCHEMA,
      status: 'PUBLICATION_TRANSPORT_READY',
      stage: 'PUBLICATION',
      assetId: null,
      completedAssets: uploadedAssets.length,
      upload,
      prepared,
      message: 'Every Pack asset and the canonical Pack Manifest are certified on Walrus.',
    });
  };

  return freeze({
    schemaVersion: MAKER_V8_PACK_TRANSPORT_SCHEMA,
    prepare: (input) => inspect(input, 'INSPECT'),
    requestSignature: (input) => inspect(input, 'SIGN'),
    recover: (input) => inspect(input, 'RECOVER'),
  });
}

// Keep the document marker in the source-level trust audit: the Pack Manifest
// is an exact projection of this one Fresh-v8 authoring schema only.
void MAKER_V8_PACK_DOCUMENT_SCHEMA;
