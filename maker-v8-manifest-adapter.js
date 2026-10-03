import { sha256 } from '@noble/hashes/sha2.js';
import { assertMakerV8PublishedSources } from './maker-v8-source-asset.js';
import { toBase64 } from '@mysten/sui/utils';

import {
  MAKER_V8_BYTE_BUDGETS,
  canonicalMakerV8Json,
} from './maker-v8-compiler.js';
import {
  assertMakerV8Document,
  compareMakerV8ProtocolText,
  projectPublicMakerV8Document,
} from './maker-v8-document.js';
import { MAKER_V8_SEAL_CIPHERTEXT_MEDIA_TYPE } from './maker-v8-protected-transport.js';

export const MAKER_V8_MANIFEST_SCHEMA = 'animacraft.maker-v8-manifest.v2';
export const MAKER_V8_MANIFEST_PROTOCOL_VERSION = 8;
export const MAKER_V8_MANIFEST_ADAPTER_SCHEMA = 'animacraft.maker-v8-manifest-read.v1';
export const MAKER_V8_CERTIFIED_ASSET_ADAPTER_SCHEMA = 'animacraft.maker-v8-certified-asset-read.v1';
export const MAKER_V8_MANIFEST_MAX_BYTES = MAKER_V8_BYTE_BUDGETS.maxManifestBytes;
export const MAKER_V8_CERTIFIED_ASSET_MAX_BYTES = MAKER_V8_BYTE_BUDGETS.maxAssetBytes;

const MANIFEST_FIELDS = Object.freeze([
  'schemaVersion',
  'protocolVersion',
  'document',
  'certifiedAssets',
]);
const CERTIFIED_ASSET_FIELDS = Object.freeze([
  'assetId',
  'blobId',
  'mediaType',
  'byteLength',
  'sha256',
]);
const HASH = /^[0-9a-f]{64}$/;
const MEDIA_TYPE = /^[a-z0-9][a-z0-9.+-]{0,63}\/[a-z0-9][a-z0-9.+-]{0,127}$/i;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
}

function plain(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function fail(code, message, layer = 'MANIFEST', details = {}) {
  throw new MakerV8ManifestError(code, message, layer, details);
}

export class MakerV8ManifestError extends Error {
  constructor(code, message, layer = 'MANIFEST', details = {}) {
    super(message);
    this.name = 'MakerV8ManifestError';
    this.code = code;
    this.layer = layer;
    this.details = freeze({ ...details });
  }
}

function exactRecord(value, fields, label) {
  if (!plain(value)) {
    fail('MAKER_V8_MANIFEST_RECORD_INVALID', `${label} must be a plain JSON record.`, 'SCHEMA');
  }
  const allowed = new Set(fields);
  const unknown = Object.keys(value).filter((field) => !allowed.has(field));
  const missing = fields.filter((field) => !Object.hasOwn(value, field));
  if (unknown.length || missing.length) {
    fail(
      'MAKER_V8_MANIFEST_FIELDS_INVALID',
      `${label} does not have the exact Maker v8 shape.`,
      'SCHEMA',
      { label, unknown, missing },
    );
  }
}

function boundedText(value, label, maximum = 512) {
  if (typeof value !== 'string' || !value.length || encoder.encode(value).length > maximum) {
    fail(
      'MAKER_V8_MANIFEST_TEXT_INVALID',
      `${label} must be non-empty bounded text.`,
      'SCHEMA',
      { label, maximum },
    );
  }
  return value;
}

function exactHash(value, label) {
  if (typeof value !== 'string' || !HASH.test(value)) {
    fail(
      'MAKER_V8_MANIFEST_HASH_INVALID',
      `${label} must be one canonical lowercase 32-byte SHA-256 value.`,
      'INTEGRITY',
      { label },
    );
  }
  return value;
}

function byteLimit(value, maximum, label) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    fail(
      'MAKER_V8_MANIFEST_LIMIT_INVALID',
      `${label} must be between 1 and ${maximum}.`,
      'CONFIGURATION',
    );
  }
  return value;
}

function byteArray(value, label) {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  }
  fail('MAKER_V8_MANIFEST_BYTES_INVALID', `${label} did not return manifest bytes.`, 'TRANSPORT');
}

function assertWithinLimit(bytes, maximumBytes, { allowEmpty = false, noun = 'Manifest' } = {}) {
  if (bytes.length === 0 && !allowEmpty) {
    fail('MAKER_V8_MANIFEST_EMPTY', 'The fetched Maker v8 Manifest is empty.', 'TRANSPORT');
  }
  if (bytes.length > maximumBytes) {
    fail(
      'MAKER_V8_MANIFEST_BYTE_BUDGET_EXCEEDED',
      `The fetched Maker v8 ${noun} exceeds its configured byte budget.`,
      'TRANSPORT',
      { byteLength: bytes.length, maximumBytes },
    );
  }
  return bytes;
}

async function responseBytes(response, maximumBytes, options) {
  if (response.ok === false) {
    fail(
      'MAKER_V8_MANIFEST_FETCH_FAILED',
      'The Manifest transport returned a non-success response.',
      'TRANSPORT',
      { status: response.status ?? null },
    );
  }
  const contentLength = response.headers?.get?.('content-length');
  if (contentLength !== null && contentLength !== undefined) {
    if (!/^(?:0|[1-9][0-9]*)$/.test(contentLength)) {
      fail('MAKER_V8_MANIFEST_CONTENT_LENGTH_INVALID', 'Manifest Content-Length is not canonical.', 'TRANSPORT');
    }
    if (BigInt(contentLength) > BigInt(maximumBytes)) {
      fail(
        'MAKER_V8_MANIFEST_BYTE_BUDGET_EXCEEDED',
        'Manifest Content-Length exceeds the configured byte budget.',
        'TRANSPORT',
        { contentLength, maximumBytes },
      );
    }
  }

  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = byteArray(value, 'Manifest response stream');
        total += chunk.length;
        if (total > maximumBytes) {
          await reader.cancel().catch(() => {});
          fail(
            'MAKER_V8_MANIFEST_BYTE_BUDGET_EXCEEDED',
            'The streamed Maker v8 Manifest exceeds its configured byte budget.',
            'TRANSPORT',
            { byteLength: total, maximumBytes },
          );
        }
        chunks.push(chunk);
      }
    } finally {
      reader.releaseLock?.();
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return assertWithinLimit(bytes, maximumBytes, options);
  }

  if (typeof response.arrayBuffer !== 'function') {
    fail('MAKER_V8_MANIFEST_BYTES_INVALID', 'Manifest response has no readable byte body.', 'TRANSPORT');
  }
  return assertWithinLimit(new Uint8Array(await response.arrayBuffer()), maximumBytes, options);
}

async function fetchedBytes(value, maximumBytes, options) {
  if (value instanceof Uint8Array || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    return assertWithinLimit(byteArray(value, 'Manifest fetcher'), maximumBytes, options);
  }
  if (plain(value) && Object.keys(value).length === 1 && Object.hasOwn(value, 'bytes')) {
    return assertWithinLimit(byteArray(value.bytes, 'Manifest fetcher.bytes'), maximumBytes, options);
  }
  if (value && typeof value === 'object'
    && (typeof value.arrayBuffer === 'function' || value.body?.getReader)) {
    return responseBytes(value, maximumBytes, options);
  }
  fail('MAKER_V8_MANIFEST_FETCH_RESULT_INVALID', 'Manifest fetcher returned an unsupported result.', 'TRANSPORT');
}

function hashBytes(bytes) {
  return [...sha256(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function assertMakerV8CertifiedAsset(value, label = 'certifiedAsset') {
  exactRecord(value, CERTIFIED_ASSET_FIELDS, label);
  boundedText(value.assetId, `${label}.assetId`, 128);
  boundedText(value.blobId, `${label}.blobId`);
  if (typeof value.mediaType !== 'string' || !MEDIA_TYPE.test(value.mediaType)) {
    fail('MAKER_V8_MANIFEST_MEDIA_TYPE_INVALID', `${label}.mediaType is invalid.`, 'SCHEMA');
  }
  if (!Number.isSafeInteger(value.byteLength) || value.byteLength < 0
    || value.byteLength > MAKER_V8_CERTIFIED_ASSET_MAX_BYTES) {
    fail('MAKER_V8_MANIFEST_ASSET_LENGTH_INVALID', `${label}.byteLength is invalid.`, 'SCHEMA');
  }
  exactHash(value.sha256, `${label}.sha256`);
  return freeze(structuredClone(value));
}

function inspectCertifiedAssets(manifest) {
  if (!Array.isArray(manifest.certifiedAssets)) {
    fail('MAKER_V8_MANIFEST_ASSETS_INVALID', 'certifiedAssets must be an array.', 'SCHEMA');
  }
  assertMakerV8PublishedSources(manifest.document, manifest.certifiedAssets);
  const documentAssets = new Map(manifest.document.assets.map((asset) => [asset.id, asset]));
  const usageByAsset = new Map();
  for (const part of manifest.document.parts) for (const item of part.items) for (const style of item.styles) {
    const usage = usageByAsset.get(style.assetId) ?? [];
    usage.push({ protected: style.protected === true, partKey: part.key, itemKey: item.key, styleKey: style.key });
    usageByAsset.set(style.assetId, usage);
  }
  if (documentAssets.size !== manifest.document.assets.length
    || manifest.certifiedAssets.length !== manifest.document.assets.length) {
    fail(
      'MAKER_V8_MANIFEST_ASSET_SET_MISMATCH',
      'Manifest certifiedAssets must exactly cover the public document asset set.',
      'SCHEMA',
    );
  }
  const seen = new Set();
  manifest.certifiedAssets.forEach((asset, index) => {
    const label = `manifest.certifiedAssets[${index}]`;
    assertMakerV8CertifiedAsset(asset, label);
    if (seen.has(asset.assetId)) {
      fail('MAKER_V8_MANIFEST_ASSET_DUPLICATE', `Duplicate certified asset ${asset.assetId}.`, 'SCHEMA');
    }
    seen.add(asset.assetId);
    const documented = documentAssets.get(asset.assetId);
    const usages = usageByAsset.get(asset.assetId) ?? [];
    const protectedAsset = usages.some((usage) => usage.protected);
    if (protectedAsset && (usages.length !== 1 || usages[0].protected !== true)) {
      fail(
        'MAKER_V8_MANIFEST_PROTECTED_ASSET_AMBIGUOUS',
        `Protected asset ${asset.assetId} must belong to exactly one public protected Style.`,
        'SCHEMA',
      );
    }
    if (!documented
      || !protectedAsset && (documented.mediaType !== asset.mediaType
        || documented.byteLength !== asset.byteLength)
      || protectedAsset && asset.mediaType !== MAKER_V8_SEAL_CIPHERTEXT_MEDIA_TYPE) {
      fail(
        'MAKER_V8_MANIFEST_ASSET_METADATA_MISMATCH',
        `${label} does not match the document plaintext or protected ciphertext metadata.`,
        'SCHEMA',
        { assetId: asset.assetId },
      );
    }
    if (index > 0
      && compareMakerV8ProtocolText(manifest.certifiedAssets[index - 1].assetId, asset.assetId) >= 0) {
      fail(
        'MAKER_V8_MANIFEST_ASSET_ORDER_INVALID',
        'certifiedAssets must be strictly sorted by the canonical asset ID order.',
        'SCHEMA',
      );
    }
  });
}

export function assertMakerV8Manifest(value) {
  exactRecord(value, MANIFEST_FIELDS, 'manifest');
  if (value.schemaVersion !== MAKER_V8_MANIFEST_SCHEMA
    || value.protocolVersion !== MAKER_V8_MANIFEST_PROTOCOL_VERSION) {
    fail(
      'MAKER_V8_MANIFEST_VERSION_INVALID',
      'Manifest is not the exact fresh Maker v8 manifest schema.',
      'SCHEMA',
      { schemaVersion: value.schemaVersion ?? null, protocolVersion: value.protocolVersion ?? null },
    );
  }
  try {
    assertMakerV8Document(value.document, { mode: 'compile' });
  } catch (cause) {
    fail(
      'MAKER_V8_MANIFEST_DOCUMENT_INVALID',
      'Manifest document does not satisfy the exact compiled Maker v8 schema.',
      'SCHEMA',
      { causeCode: cause?.code ?? null },
    );
  }
  if (canonicalMakerV8Json(projectPublicMakerV8Document(value.document))
    !== canonicalMakerV8Json(value.document)) {
    fail(
      'MAKER_V8_MANIFEST_PRIVATE_ITEM_FORBIDDEN',
      'A public Manifest cannot contain author-only Maker items.',
      'SCHEMA',
    );
  }
  inspectCertifiedAssets(value);
  return freeze(structuredClone(value));
}

/**
 * Byte-bounded, transport-neutral Manifest loader. The fetcher receives only
 * `{ blobId, maximumBytes, signal }` and must return bytes or a Fetch Response.
 */
export function createMakerV8ManifestAdapter({
  fetcher,
  maximumBytes = MAKER_V8_MANIFEST_MAX_BYTES,
} = {}) {
  if (typeof fetcher !== 'function') {
    fail('MAKER_V8_MANIFEST_FETCHER_REQUIRED', 'An explicit Manifest byte fetcher is required.', 'CONFIGURATION');
  }
  const checkedMaximum = byteLimit(maximumBytes, MAKER_V8_MANIFEST_MAX_BYTES, 'maximumBytes');
  return freeze({
    schemaVersion: MAKER_V8_MANIFEST_ADAPTER_SCHEMA,
    maximumBytes: checkedMaximum,
    async load({ blobId: blobIdInput, sha256: sha256Input, signal } = {}) {
      const blobId = boundedText(blobIdInput, 'manifest.blobId');
      const expectedSha256 = exactHash(sha256Input, 'manifest.sha256');
      let fetched;
      try {
        fetched = await fetcher(Object.freeze({ blobId, maximumBytes: checkedMaximum, signal }));
      } catch (cause) {
        if (cause instanceof MakerV8ManifestError) throw cause;
        fail(
          'MAKER_V8_MANIFEST_FETCH_FAILED',
          'Manifest transport failed before returning certified bytes.',
          'TRANSPORT',
          { cause: String(cause?.message ?? cause ?? 'unknown') },
        );
      }
      const bytes = await fetchedBytes(fetched, checkedMaximum);
      const observedSha256 = hashBytes(bytes);
      if (observedSha256 !== expectedSha256) {
        fail(
          'MAKER_V8_MANIFEST_HASH_MISMATCH',
          'Fetched Manifest bytes do not match the activated Root SHA-256.',
          'INTEGRITY',
          { expectedSha256, observedSha256, blobId },
        );
      }
      if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
        fail('MAKER_V8_MANIFEST_UTF8_INVALID', 'Manifest JSON must not contain a UTF-8 BOM.', 'SCHEMA');
      }
      let text;
      let parsed;
      try {
        text = decoder.decode(bytes);
        parsed = JSON.parse(text);
      } catch {
        fail('MAKER_V8_MANIFEST_JSON_INVALID', 'Manifest bytes are not strict UTF-8 JSON.', 'SCHEMA');
      }
      const manifest = assertMakerV8Manifest(parsed);
      if (canonicalMakerV8Json(manifest) !== text) {
        fail(
          'MAKER_V8_MANIFEST_NONCANONICAL',
          'Manifest bytes are not the canonical JSON emitted by the Maker v8 compiler.',
          'INTEGRITY',
        );
      }
      return freeze({
        schemaVersion: MAKER_V8_MANIFEST_ADAPTER_SCHEMA,
        blobId,
        sha256: observedSha256,
        byteLength: bytes.length,
        manifest,
      });
    },
  });
}

/**
 * Load one manifest-certified asset as immutable Base64 after exact byte length
 * and SHA-256 verification. Views never receive unchecked Walrus bytes.
 */
export function createMakerV8CertifiedAssetAdapter({
  fetcher,
  maximumBytes = MAKER_V8_CERTIFIED_ASSET_MAX_BYTES,
} = {}) {
  if (typeof fetcher !== 'function') {
    fail('MAKER_V8_MANIFEST_FETCHER_REQUIRED', 'An explicit certified asset byte fetcher is required.', 'CONFIGURATION');
  }
  const checkedMaximum = byteLimit(
    maximumBytes,
    MAKER_V8_CERTIFIED_ASSET_MAX_BYTES,
    'assetMaximumBytes',
  );
  return freeze({
    schemaVersion: MAKER_V8_CERTIFIED_ASSET_ADAPTER_SCHEMA,
    maximumBytes: checkedMaximum,
    async load(assetInput, { signal } = {}) {
      const asset = assertMakerV8CertifiedAsset(assetInput);
      if (asset.byteLength > checkedMaximum) {
        fail(
          'MAKER_V8_MANIFEST_BYTE_BUDGET_EXCEEDED',
          'Certified asset metadata exceeds the configured byte budget.',
          'TRANSPORT',
          { byteLength: asset.byteLength, maximumBytes: checkedMaximum, assetId: asset.assetId },
        );
      }
      let fetched;
      try {
        fetched = await fetcher(Object.freeze({
          blobId: asset.blobId,
          maximumBytes: checkedMaximum,
          signal,
        }));
      } catch (cause) {
        if (cause instanceof MakerV8ManifestError) throw cause;
        fail(
          'MAKER_V8_MANIFEST_FETCH_FAILED',
          'Certified asset transport failed before returning bytes.',
          'TRANSPORT',
          { assetId: asset.assetId, cause: String(cause?.message ?? cause ?? 'unknown') },
        );
      }
      const bytes = await fetchedBytes(fetched, checkedMaximum, {
        allowEmpty: asset.byteLength === 0,
        noun: 'certified asset',
      });
      if (bytes.length !== asset.byteLength) {
        fail(
          'MAKER_V8_MANIFEST_ASSET_LENGTH_MISMATCH',
          'Fetched certified asset bytes do not match the Manifest byte length.',
          'INTEGRITY',
          { assetId: asset.assetId, expected: asset.byteLength, observed: bytes.length },
        );
      }
      const observedSha256 = hashBytes(bytes);
      if (observedSha256 !== asset.sha256) {
        fail(
          'MAKER_V8_MANIFEST_ASSET_HASH_MISMATCH',
          'Fetched certified asset bytes do not match the Manifest SHA-256.',
          'INTEGRITY',
          { assetId: asset.assetId, expectedSha256: asset.sha256, observedSha256 },
        );
      }
      return freeze({
        schemaVersion: MAKER_V8_CERTIFIED_ASSET_ADAPTER_SCHEMA,
        assetId: asset.assetId,
        blobId: asset.blobId,
        mediaType: asset.mediaType,
        byteLength: bytes.length,
        sha256: observedSha256,
        bytesBase64: toBase64(bytes),
      });
    },
  });
}
