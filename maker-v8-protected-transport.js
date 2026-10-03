import { bcs } from '@mysten/sui/bcs';
import { fromBase64, fromHex, toBase64 } from '@mysten/sui/utils';
import { sha256 } from '@noble/hashes/sha2.js';
import { EncryptedObject, DemType } from '@mysten/seal';
import { assertMakerV8SealEncryptionProfile, MAKER_V8_SEAL_KEM_TYPE } from './maker-v8-seal-profile.js';

// Keep the transport trust boundary independent from Player/Product modules.
// Importing the UI/player graph here creates an ESM initialization cycle
// (Player -> ProductRuntime -> PackTransport -> ProtectedTransport).
const MAKER_V8_PROTECTED_RENDER_IDENTITY_SCHEMA =
  'animacraft.maker-v8-protected-render-identity.v1';

export const MAKER_V8_PROTECTED_RENDER_REQUEST_SCHEMA =
  'animacraft.maker-v8-protected-render-request.v2';
export const MAKER_V8_PROTECTED_RENDER_SCHEMA =
  'animacraft.maker-v8-protected-render.v2';
export const MAKER_V8_SEAL_ENCRYPTION_IDENTITY_SCHEMA =
  'animacraft.maker-v8-seal-encryption-identity.v1';
export const MAKER_V8_PROTECTED_TRANSPORT_SCHEMA =
  'animacraft.maker-v8-protected-transport.v1';
export const MAKER_V8_PROTECTED_ASSET_IDENTITY_SCHEMA =
  'animacraft.maker-v8-protected-asset-identity.v1';
export const MAKER_V8_PROTECTED_ASSET_REQUEST_SCHEMA =
  'animacraft.maker-v8-protected-asset-request.v1';
export const MAKER_V8_PROTECTED_ASSET_SCHEMA =
  'animacraft.maker-v8-protected-asset.v1';
export const MAKER_V8_SEAL_CIPHERTEXT_MEDIA_TYPE =
  'application/vnd.animacraft.seal-ciphertext';

const HASH = /^[0-9a-f]{64}$/;
const ID = /^0x[0-9a-f]{64}$/;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/;
const KEY = /^(?!0x[0-9a-fA-F]{64}$)[A-Za-z0-9][A-Za-z0-9_/-]{0,127}$/;
// Preserve the certified application payload bounds in browser memory.
const MAX_PLAINTEXT_BYTES = 3 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const encoder = new TextEncoder();
const BV = bcs.vector(bcs.u8());
const SealIdInputV8 = bcs.struct('SealIdInputV2', {
  domain: bcs.string(),
  schema_revision: bcs.u64(),
  product_binding_commitment: BV,
  policy_commitment: BV,
  root_content_commitment: BV,
  maker_version: bcs.u64(),
  scope_kind: bcs.u8(),
  scope_key: bcs.string(),
  asset_key: bcs.string(),
});

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)
    || ArrayBuffer.isView(value)) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
}

function plain(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function fail(code, message, status = 400) {
  const error = new Error(message);
  error.name = 'MakerV8ProtectedTransportError';
  error.code = code;
  error.status = status;
  throw error;
}

function exact(value, fields, label) {
  if (!plain(value)) fail('MAKER_V8_PROTECTED_SHAPE_INVALID', `${label} must be a plain record.`);
  const expected = [...fields].sort();
  const observed = Object.keys(value).sort();
  if (expected.length !== observed.length
    || expected.some((field, index) => field !== observed[index])) {
    fail('MAKER_V8_PROTECTED_SHAPE_INVALID', `${label} has an invalid exact shape.`);
  }
  return value;
}

function id(value, label) {
  const normalized = typeof value === 'string' ? value.toLowerCase() : '';
  if (!ID.test(normalized) || /^0x0+$/.test(normalized)) {
    fail('MAKER_V8_PROTECTED_ID_INVALID', `${label} must be one exact non-zero Sui ID.`);
  }
  return normalized;
}

function hash(value, label) {
  if (typeof value !== 'string' || !HASH.test(value) || /^0+$/.test(value)) {
    fail('MAKER_V8_PROTECTED_HASH_INVALID', `${label} must be one non-zero lowercase SHA-256.`);
  }
  return value;
}

function decimal(value, label, positive = false) {
  const normalized = String(value ?? '');
  if (!DECIMAL.test(normalized) || positive && normalized === '0') {
    fail('MAKER_V8_PROTECTED_INTEGER_INVALID', `${label} must be a canonical integer.`);
  }
  return normalized;
}

function key(value, label) {
  if (typeof value !== 'string' || !KEY.test(value)) {
    fail('MAKER_V8_PROTECTED_KEY_INVALID', `${label} must be one bounded semantic key.`);
  }
  return value;
}

function bytesFromBase64(value, expectedLength, label) {
  let bytes;
  try { bytes = fromBase64(value); } catch {
    fail('MAKER_V8_PROTECTED_BASE64_INVALID', `${label} is not Base64.`);
  }
  if (toBase64(bytes) !== value || bytes.length !== expectedLength) {
    fail('MAKER_V8_PROTECTED_BASE64_INVALID', `${label} is not canonical or has another length.`);
  }
  return bytes;
}

function hex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function sameBytes(left, right) {
  return left.length === right.length
    && left.every((byte, index) => byte === right[index]);
}

function assertEncryptedObject(bytes, derived, policy = null) {
  let parsed;
  let canonical;
  try {
    parsed = EncryptedObject.parse(bytes);
    canonical = EncryptedObject.serialize(parsed).toBytes();
  } catch {
    fail('MAKER_V8_PROTECTED_CIPHERTEXT_INVALID', 'Protected ciphertext is not one canonical Seal EncryptedObject.', 502);
  }
  const ciphertext = parsed?.ciphertext;
  const payload = ciphertext?.$kind === 'Aes256Gcm'
    ? ciphertext.Aes256Gcm
    : null;
  const aad = payload?.aad;
  let expectedAad;
  try { expectedAad = fromBase64(derived.aadBase64); } catch {
    fail('MAKER_V8_PROTECTED_CIPHERTEXT_INVALID', 'Seal AAD is invalid.', 502);
  }
  if (!sameBytes(bytes, canonical)
    || parsed.version !== 0
    || parsed.encryptedShares?.$kind !== 'BonehFranklinBLS12381'
    || parsed.packageId !== derived.packageId
    || parsed.id !== derived.sealId
    || !Number.isSafeInteger(parsed.threshold) || parsed.threshold < 1
    || !Array.isArray(parsed.services) || parsed.services.length < parsed.threshold
    || !(aad instanceof Uint8Array)
    || toBase64(expectedAad) !== derived.aadBase64
    || hex(sha256(expectedAad)) !== derived.sealId
    || !sameBytes(aad, expectedAad)) {
    fail('MAKER_V8_PROTECTED_CIPHERTEXT_INVALID', 'Protected ciphertext differs from its exact Seal package, identity, threshold, or AAD.', 502);
  }
  if (policy !== null) {
    assertMakerV8SealEncryptionProfile(policy.encryptionProfile);
    const servers = policy.serverConfigs;
    const counts = new Map();
    if (!Array.isArray(servers) || servers.length < 1 || servers.length > 64
      || servers.some(row => !plain(row) || !/^0x[0-9a-f]{64}$/.test(row.objectId)
        || /^0x0+$/.test(row.objectId) || !Number.isSafeInteger(row.weight) || row.weight < 1
        || counts.has(row.objectId) || (counts.set(row.objectId, row.weight), false))) {
      fail('MAKER_V8_PROTECTED_CIPHERTEXT_INVALID', 'Seal server policy is invalid.', 502);
    }
    const total = servers.reduce((sum, row) => sum + row.weight, 0);
    const indices = new Set();
    const shares = parsed.encryptedShares.BonehFranklinBLS12381.encryptedShares;
    const max = policy.maxPlaintextBytes;
    if (total >= 255 || !Number.isSafeInteger(policy.threshold) || policy.threshold < 1
      || policy.threshold > total || parsed.threshold !== policy.threshold
      || !Number.isSafeInteger(max) || max < 1 || max > MAX_PLAINTEXT_BYTES
      || payload.blob.length <= 16 || payload.blob.length - 16 > max
      || parsed.services.length !== total || shares.length !== total
      || parsed.services.some(([server, index]) => {
        const remaining = counts.get(server) ?? 0;
        if (remaining < 1 || !Number.isInteger(index) || index < 1 || index > total || indices.has(index)) return true;
        counts.set(server, remaining - 1); indices.add(index); return false;
      }) || [...counts.values()].some(count => count !== 0)) {
      fail('MAKER_V8_PROTECTED_CIPHERTEXT_INVALID', 'Seal ciphertext differs from the certified encryption policy.', 502);
    }
  }
  return parsed;
}

// Browser preflight only: no key fetch, signature, or plaintext release.
export function assertMakerV8SealCiphertextV8(bytes, expected) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 1 || bytes.length > MAX_RESPONSE_BYTES
    || !plain(expected)) {
    fail('MAKER_V8_PROTECTED_CIPHERTEXT_INVALID', 'Seal ciphertext input is invalid.', 502);
  }
  return assertEncryptedObject(bytes, expected, expected);
}

function sealIdentity({
  releasePackageId,
  productBindingCommitment,
  policyCommitment,
  rootContentCommitment,
  makerVersion,
  scopeKind,
  scopeKey,
  assetKey,
}) {
  const aad = SealIdInputV8.serialize({
    domain: 'animacraft-fresh-v8/seal/ciphertext-id/v2',
    schema_revision: 2,
    product_binding_commitment: [...fromHex(productBindingCommitment)],
    policy_commitment: [...fromHex(policyCommitment)],
    root_content_commitment: [...fromHex(rootContentCommitment)],
    maker_version: makerVersion,
    scope_kind: scopeKind,
    scope_key: scopeKey,
    asset_key: assetKey,
  }).toBytes();
  const sealId = hex(sha256(aad));
  return freeze({
    schemaVersion: MAKER_V8_SEAL_ENCRYPTION_IDENTITY_SCHEMA,
    packageId: releasePackageId,
    sealId,
    aadBase64: toBase64(aad),
    aadSha256: sealId,
  });
}

export function assertMakerV8ProtectedAssetIdentityV8(value) {
  exact(value, [
    'schemaVersion', 'signer', 'scopeKind', 'scopeKey', 'assetKey',
    'rootContentCommitment', 'makerVersion', 'releasePackageId',
    'productBindingCommitment', 'policyCommitment', 'sealPolicyConfigId',
    'assetContentCommitment',
  ], 'protected publication asset identity');
  const checked = freeze({
    schemaVersion: value.schemaVersion,
    signer: id(value.signer, 'identity.signer'),
    scopeKind: value.scopeKind,
    scopeKey: key(value.scopeKey, 'identity.scopeKey'),
    assetKey: key(value.assetKey, 'identity.assetKey'),
    rootContentCommitment: hash(value.rootContentCommitment, 'identity.rootContentCommitment'),
    makerVersion: decimal(value.makerVersion, 'identity.makerVersion', true),
    releasePackageId: id(value.releasePackageId, 'identity.releasePackageId'),
    productBindingCommitment: hash(value.productBindingCommitment, 'identity.productBindingCommitment'),
    policyCommitment: hash(value.policyCommitment, 'identity.policyCommitment'),
    sealPolicyConfigId: id(value.sealPolicyConfigId, 'identity.sealPolicyConfigId'),
    assetContentCommitment: hash(value.assetContentCommitment, 'identity.assetContentCommitment'),
  });
  const segments = checked.assetKey.split('/');
  if (checked.schemaVersion !== MAKER_V8_PROTECTED_ASSET_IDENTITY_SCHEMA
    || ![0, 1].includes(checked.scopeKind)
    || checked.scopeKind === 0 && checked.scopeKey !== 'maker/base'
    || checked.scopeKind === 1 && !checked.scopeKey.startsWith('pack/')
    || segments.length !== 3 || segments.some((segment) => !segment)) {
    fail('MAKER_V8_PROTECTED_IDENTITY_INVALID', 'Protected publication asset has an invalid Base/Pack semantic identity.');
  }
  return checked;
}

export function deriveMakerV8ProtectedAssetSealIdentityV8(value) {
  const identity = assertMakerV8ProtectedAssetIdentityV8(value);
  return sealIdentity(identity);
}

export function assertMakerV8ProtectedRenderIdentityV8(value) {
  exact(value, [
    'schemaVersion', 'rootId', 'makerVersion', 'rootContentCommitment', 'signer',
    'outputKey', 'scopeKey', 'assetKey', 'releasePackageId',
    'productBindingCommitment', 'policyCommitment', 'sealPolicyConfigId',
    'sealRegistryId', 'sealRuntimeRevision',
  ], 'protected render identity');
  const checked = freeze({
    schemaVersion: value.schemaVersion,
    rootId: id(value.rootId, 'identity.rootId'),
    makerVersion: decimal(value.makerVersion, 'identity.makerVersion', true),
    rootContentCommitment: hash(value.rootContentCommitment, 'identity.rootContentCommitment'),
    signer: id(value.signer, 'identity.signer'),
    outputKey: key(value.outputKey, 'identity.outputKey'),
    scopeKey: key(value.scopeKey, 'identity.scopeKey'),
    assetKey: key(value.assetKey, 'identity.assetKey'),
    releasePackageId: id(value.releasePackageId, 'identity.releasePackageId'),
    productBindingCommitment: hash(value.productBindingCommitment, 'identity.productBindingCommitment'),
    policyCommitment: hash(value.policyCommitment, 'identity.policyCommitment'),
    sealPolicyConfigId: id(value.sealPolicyConfigId, 'identity.sealPolicyConfigId'),
    sealRegistryId: id(value.sealRegistryId, 'identity.sealRegistryId'),
    sealRuntimeRevision: decimal(value.sealRuntimeRevision, 'identity.sealRuntimeRevision'),
  });
  if (checked.schemaVersion !== MAKER_V8_PROTECTED_RENDER_IDENTITY_SCHEMA
    || checked.scopeKey !== `complete/${checked.outputKey}`
    || !checked.assetKey.startsWith(`receipt-${checked.signer.slice(2)}-`)) {
    fail('MAKER_V8_PROTECTED_IDENTITY_INVALID', 'Protected render identity is not the exact Complete identity.');
  }
  return checked;
}

export function deriveMakerV8SealEncryptionIdentityV8(value) {
  const identity = assertMakerV8ProtectedRenderIdentityV8(value);
  return sealIdentity({ ...identity, scopeKind: 2 });
}

function render(value) {
  exact(value, ['mediaType', 'bytesBase64', 'byteLength', 'sha256'], 'protected plaintext render');
  if (value.mediaType !== 'image/png'
    || !Number.isSafeInteger(value.byteLength)
    || value.byteLength < 1 || value.byteLength > MAX_PLAINTEXT_BYTES) {
    fail('MAKER_V8_PROTECTED_RENDER_INVALID', 'Protected plaintext render must be one bounded PNG.');
  }
  const bytes = bytesFromBase64(value.bytesBase64, value.byteLength, 'render.bytesBase64');
  if (hash(value.sha256, 'render.sha256') !== hex(sha256(bytes))) {
    fail('MAKER_V8_PROTECTED_RENDER_INVALID', 'Protected plaintext render hash differs from its bytes.');
  }
  return freeze({ ...value, bytes });
}

function publicationAsset(value) {
  exact(value, ['mediaType', 'bytesBase64', 'byteLength', 'sha256'], 'protected publication plaintext asset');
  if (!['image/png', 'image/webp'].includes(value.mediaType)
    || !Number.isSafeInteger(value.byteLength)
    || value.byteLength < 1 || value.byteLength > MAX_PLAINTEXT_BYTES) {
    fail('MAKER_V8_PROTECTED_ASSET_INVALID', 'Protected publication asset must be one bounded PNG or WebP.');
  }
  const bytes = bytesFromBase64(value.bytesBase64, value.byteLength, 'asset.bytesBase64');
  if (hash(value.sha256, 'asset.sha256') !== hex(sha256(bytes))) {
    fail('MAKER_V8_PROTECTED_ASSET_INVALID', 'Protected publication asset hash differs from its bytes.');
  }
  return freeze({ ...value, bytes });
}

export function assertMakerV8ProtectedAssetRequestV8(value) {
  exact(value, ['schemaVersion', 'identity', 'asset'], 'protected publication asset request');
  if (value.schemaVersion !== MAKER_V8_PROTECTED_ASSET_REQUEST_SCHEMA) {
    fail('MAKER_V8_PROTECTED_REQUEST_INVALID', 'Protected publication asset request schema is invalid.');
  }
  return freeze({
    schemaVersion: value.schemaVersion,
    identity: assertMakerV8ProtectedAssetIdentityV8(value.identity),
    asset: publicationAsset(value.asset),
  });
}

function assetResponse(value, derived) {
  exact(value, [
    'schemaVersion', 'mediaType', 'bytesBase64', 'byteLength', 'sha256',
    'packageId', 'sealId', 'aadSha256',
  ], 'protected publication asset response');
  if (value.schemaVersion !== MAKER_V8_PROTECTED_ASSET_SCHEMA
    || value.mediaType !== MAKER_V8_SEAL_CIPHERTEXT_MEDIA_TYPE
    || id(value.packageId, 'response.packageId') !== derived.packageId
    || hash(value.sealId, 'response.sealId') !== derived.sealId
    || hash(value.aadSha256, 'response.aadSha256') !== derived.aadSha256
    || !Number.isSafeInteger(value.byteLength) || value.byteLength < 1
    || value.byteLength > MAX_RESPONSE_BYTES) {
    fail('MAKER_V8_PROTECTED_RESPONSE_INVALID', 'Protected publication response differs from its exact Seal identity.');
  }
  const bytes = bytesFromBase64(value.bytesBase64, value.byteLength, 'response.bytesBase64');
  if (hash(value.sha256, 'response.sha256') !== hex(sha256(bytes))) {
    fail('MAKER_V8_PROTECTED_RESPONSE_INVALID', 'Protected publication response hash differs from its bytes.');
  }
  assertEncryptedObject(bytes, derived);
  return freeze({ ...value, bytes });
}

export function assertMakerV8ProtectedAssetV8(value, identity) {
  return assetResponse(value, deriveMakerV8ProtectedAssetSealIdentityV8(identity));
}

export function createMakerV8ProtectedAssetServiceV8({ verifyIdentity, encrypt } = {}) {
  if (typeof verifyIdentity !== 'function' || typeof encrypt !== 'function') {
    fail('MAKER_V8_PROTECTED_SERVICE_INVALID', 'Protected asset service requires identity verification and Seal encryption.', 500);
  }
  return freeze({
    schemaVersion: MAKER_V8_PROTECTED_TRANSPORT_SCHEMA,
    async protectAsset(value) {
      const request = assertMakerV8ProtectedAssetRequestV8(value);
      try {
      const verified = await verifyIdentity(request.identity);
      const verifiedIdentity = plain(verified?.identity)
        ? assertMakerV8ProtectedAssetIdentityV8(verified.identity) : null;
      if (!plain(verified) || verified.certified !== true || verifiedIdentity === null
        || JSON.stringify(verifiedIdentity) !== JSON.stringify(request.identity)
        || !Number.isSafeInteger(verified.threshold) || verified.threshold < 1) {
        fail('MAKER_V8_PROTECTED_IDENTITY_UNCERTIFIED', 'Browser could not certify the exact protected publication identity.', 409);
      }
      assertMakerV8SealEncryptionProfile(verified.encryptionProfile);
      const derived = deriveMakerV8ProtectedAssetSealIdentityV8(request.identity);
      const encrypted = await encrypt({
        kemType: MAKER_V8_SEAL_KEM_TYPE,
        demType: DemType.AesGcm256,
        threshold: verified.threshold,
        packageId: derived.packageId,
        id: derived.sealId,
        data: request.asset.bytes,
        aad: fromBase64(derived.aadBase64),
      });
      const ciphertext = encrypted?.encryptedObject;
      if (!(ciphertext instanceof Uint8Array) || ciphertext.length < 1
        || ciphertext.length > MAX_RESPONSE_BYTES
        || hex(sha256(ciphertext)) === request.asset.sha256) {
        fail('MAKER_V8_PROTECTED_ENCRYPTION_INVALID', 'Seal returned invalid or plaintext-equivalent publication ciphertext.', 502);
      }
      assertMakerV8SealCiphertextV8(ciphertext, { ...derived, ...verified });
      return freeze({
        schemaVersion: MAKER_V8_PROTECTED_ASSET_SCHEMA,
        mediaType: MAKER_V8_SEAL_CIPHERTEXT_MEDIA_TYPE,
        bytesBase64: toBase64(ciphertext),
        byteLength: ciphertext.length,
        sha256: hex(sha256(ciphertext)),
        packageId: derived.packageId,
        sealId: derived.sealId,
        aadSha256: derived.aadSha256,
      });
      } finally {
        request.asset.bytes.fill(0);
      }
    },
  });
}

export function assertMakerV8ProtectedRenderRequestV8(value) {
  exact(value, ['schemaVersion', 'identity', 'render'], 'protected render request');
  if (value.schemaVersion !== MAKER_V8_PROTECTED_RENDER_REQUEST_SCHEMA) {
    fail('MAKER_V8_PROTECTED_REQUEST_INVALID', 'Protected render request schema is invalid.');
  }
  return freeze({
    schemaVersion: value.schemaVersion,
    identity: assertMakerV8ProtectedRenderIdentityV8(value.identity),
    render: render(value.render),
  });
}

function response(value, derived) {
  exact(value, [
    'schemaVersion', 'mediaType', 'bytesBase64', 'byteLength', 'sha256',
    'packageId', 'sealId', 'aadSha256',
  ], 'protected render response');
  if (value.schemaVersion !== MAKER_V8_PROTECTED_RENDER_SCHEMA
    || value.mediaType !== 'application/vnd.animacraft.seal-ciphertext'
    || id(value.packageId, 'response.packageId') !== derived.packageId
    || hash(value.sealId, 'response.sealId') !== derived.sealId
    || hash(value.aadSha256, 'response.aadSha256') !== derived.aadSha256
    || !Number.isSafeInteger(value.byteLength) || value.byteLength < 1
    || value.byteLength > MAX_RESPONSE_BYTES) {
    fail('MAKER_V8_PROTECTED_RESPONSE_INVALID', 'Protected render response differs from its exact Seal identity.');
  }
  const bytes = bytesFromBase64(value.bytesBase64, value.byteLength, 'response.bytesBase64');
  if (hash(value.sha256, 'response.sha256') !== hex(sha256(bytes))) {
    fail('MAKER_V8_PROTECTED_RESPONSE_INVALID', 'Protected render response hash differs from its bytes.');
  }
  assertEncryptedObject(bytes, derived);
  return freeze({ ...value, bytes });
}

export function assertMakerV8ProtectedRenderV8(value, identity) {
  return response(value, deriveMakerV8SealEncryptionIdentityV8(identity));
}

export function createMakerV8ProtectedRenderServiceV8({ verifyIdentity, encrypt } = {}) {
  if (typeof verifyIdentity !== 'function' || typeof encrypt !== 'function') {
    fail('MAKER_V8_PROTECTED_SERVICE_INVALID', 'Protected render service requires identity verification and Seal encryption.', 500);
  }
  return freeze({
    schemaVersion: MAKER_V8_PROTECTED_TRANSPORT_SCHEMA,
    async protect(value) {
      const request = assertMakerV8ProtectedRenderRequestV8(value);
      try {
      const verified = await verifyIdentity(request.identity);
      const verifiedIdentity = plain(verified?.identity)
        ? assertMakerV8ProtectedRenderIdentityV8(verified.identity)
        : null;
      if (!plain(verified) || verified.certified !== true
        || verifiedIdentity === null
        || JSON.stringify(verifiedIdentity) !== JSON.stringify(request.identity)
        || !Number.isSafeInteger(verified.threshold) || verified.threshold < 1) {
        fail('MAKER_V8_PROTECTED_IDENTITY_UNCERTIFIED', 'Browser could not certify the exact live protected identity.', 409);
      }
      assertMakerV8SealEncryptionProfile(verified.encryptionProfile);
      const derived = deriveMakerV8SealEncryptionIdentityV8(request.identity);
      const encrypted = await encrypt({
        kemType: MAKER_V8_SEAL_KEM_TYPE,
        demType: DemType.AesGcm256,
        threshold: verified.threshold,
        packageId: derived.packageId,
        id: derived.sealId,
        data: request.render.bytes,
        aad: fromBase64(derived.aadBase64),
      });
      const ciphertext = encrypted?.encryptedObject;
      if (!(ciphertext instanceof Uint8Array) || ciphertext.length < 1
        || ciphertext.length > MAX_RESPONSE_BYTES
        || hex(sha256(ciphertext)) === request.render.sha256) {
        fail('MAKER_V8_PROTECTED_ENCRYPTION_INVALID', 'Seal returned invalid or plaintext-equivalent ciphertext.', 502);
      }
      assertMakerV8SealCiphertextV8(ciphertext, { ...derived, ...verified });
      return freeze({
        schemaVersion: MAKER_V8_PROTECTED_RENDER_SCHEMA,
        mediaType: 'application/vnd.animacraft.seal-ciphertext',
        bytesBase64: toBase64(ciphertext),
        byteLength: ciphertext.length,
        sha256: hex(sha256(ciphertext)),
        packageId: derived.packageId,
        sealId: derived.sealId,
        aadSha256: derived.aadSha256,
      });
      } finally {
        request.render.bytes.fill(0);
      }
    },
  });
}

export function createProductionMakerV8ProtectedTransportV8(options = {}) {
  // Lazy import keeps the primitive ciphertext/identity module independent of
  // runtime attestation and the Player graph during ESM initialization.
  const run = async (method, value) => {
    const { createMakerV8ProtectedBrowserTransportV8 } = await import('./maker-v8-protected-browser.js');
    return createMakerV8ProtectedBrowserTransportV8(options)[method](value);
  };
  return freeze({ schemaVersion: MAKER_V8_PROTECTED_TRANSPORT_SCHEMA,
    protect: value => run('protect', value),
    protectAsset: value => run('protectAsset', value) });
}
