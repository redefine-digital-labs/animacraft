export const MAKER_V8_PACK_CONTROLLER_SCHEMA = 'animacraft.maker-v8-pack-controller.v1';
export const MAKER_V8_PACK_DOCUMENT_SCHEMA = 'animacraft.maker-v8-pack-document.v1';
export const MAKER_V8_PACK_DRAFT_SCHEMA = 'animacraft.maker-v8-pack-draft.v1';
export const MAKER_V8_PACK_EXPORT_SCHEMA = 'animacraft.maker-v8-pack-export.v1';
export const MAKER_V8_PACK_PREVIEW_SCHEMA = 'animacraft.maker-v8-pack-preview.v1';
export const MAKER_V8_PACK_COMPILER_RESULT_SCHEMA = 'animacraft.maker-v8-pack-compiler-result.v1';
export const MAKER_V8_PACK_PUBLICATION_REQUEST_SCHEMA = 'animacraft.maker-v8-pack-publication-request.v1';
export const MAKER_V8_PACK_PUBLICATION_CERTIFICATION_SCHEMA =
  'animacraft.maker-v8-pack-publication-certification.v1';
export const MAKER_V8_PACK_PUBLICATION_CONTROLLER_SCHEMA =
  'animacraft.maker-v8-pack-publication-controller.v1';
export const MAKER_V8_PACK_CHAIN_READBACK_SCHEMA = 'animacraft.maker-v8-pack-chain-readback.v1';
export const MAKER_V8_PACK_LIFECYCLE_CONTROLLER_SCHEMA =
  'animacraft.maker-v8-pack-lifecycle-controller.v1';
export const MAKER_V8_PACK_ERROR_VIEW_SCHEMA = 'animacraft.maker-v8-pack-error-view.v1';

export const MAKER_V8_PACK_ACCESS_KINDS = Object.freeze([
  'FREE', 'PAID', 'INCLUDED_WITH_MAKER',
]);
export const MAKER_V8_PACK_COMPLETE_MODES = Object.freeze([
  'UNLIMITED_FREE',
  'FREE_QUOTA_THEN_PAID',
  'PAID_EVERY_TIME',
  'FREE_QUOTA_THEN_BLOCK',
]);
export const MAKER_V8_PACK_LIFECYCLE_ACTIONS = Object.freeze([
  'PAUSE', 'RESUME', 'ARCHIVE', 'TRANSFER_CONTROL', 'REVOKE_ADMISSION',
  'WITHDRAW_PACK_REVENUE',
]);

const EXTERNAL_ITEM_ADMISSION_CEILINGS = new Set(['DISABLED', 'CERTIFIED', 'OPEN']);
const EXACT_ID = /^0x[0-9a-f]{64}$/;
const HASH = /^[0-9a-f]{64}$/;
const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const SAFE_DRAFT_ID = /^[a-z0-9][a-z0-9_-]{0,127}$/;
const U64 = /^(?:0|[1-9][0-9]*)$/;
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58_INDEX = new Map([...BASE58_ALPHABET].map((character, index) => [character, index]));
const ZERO_ID = `0x${'0'.repeat(64)}`;
const MAX_PRICE = 1_000_000_000_000n;
const MAX_COMPLETE_COUNT = 1_000_000_000n;
const MAX_PACK_STYLES = 10_000;
const MAX_ASSET_BYTES = 8 * 1024 * 1024;
const encoder = new TextEncoder();

const DOCUMENT_FIELDS = Object.freeze([
  'schemaVersion', 'protocolVersion', 'metadata', 'author', 'admission',
  'access', 'completion', 'styles', 'bindings',
]);
const PUBLICATION_CONTENT_FIELDS = Object.freeze([
  'schemaVersion', 'protocolVersion', 'rootId', 'rootVersion',
  'rootContentCommitment', 'semanticPackId', 'metadata', 'author',
  'admission', 'access', 'completion', 'styles',
  'authoring',
]);
const DRAFT_FIELDS = Object.freeze([
  'schemaVersion', 'draftId', 'revision', 'createdAt', 'updatedAt',
  'document', 'publication',
]);
const PUBLICATION_FIELDS = Object.freeze([
  'attemptId', 'status', 'chain', 'updatedAt', 'lastError',
]);
const PUBLICATION_STATES = new Set([
  'UNPREPARED', 'READY', 'ACTIVE', 'OUTCOME_UNKNOWN', 'COMPLETE', 'FAILED',
]);
const CHAIN_LIFECYCLES = new Set(['ACTIVE', 'PAUSED', 'ARCHIVED']);

export class MakerV8PackControllerError extends Error {
  constructor(layer, code, message, details = undefined, recoverable = true) {
    super(message);
    this.name = 'MakerV8PackControllerError';
    this.layer = layer;
    this.code = code;
    this.userMessage = message;
    this.recoverable = recoverable;
    if (details !== undefined) this.details = freeze(cloneData(details));
  }
}

function fail(layer, code, message, details, recoverable = true) {
  throw new MakerV8PackControllerError(layer, code, message, details, recoverable);
}

function plain(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

function cloneData(value) {
  if (value === undefined) return undefined;
  try {
    return structuredClone(value);
  } catch {
    return { value: String(value) };
  }
}

function snapshot(value) {
  return structuredClone(value);
}

function exactKeys(value, fields, label, layer = 'SCHEMA') {
  if (!plain(value)) fail(layer, 'MAKER_V8_PACK_RECORD_INVALID', `${label} must be a plain record.`);
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) {
    fail(layer, 'MAKER_V8_PACK_FIELDS_INVALID', `${label} must contain exactly: ${expected.join(', ')}.`, {
      actual,
      expected,
    });
  }
  return value;
}

function exactBoolean(value, label) {
  if (typeof value !== 'boolean') fail('SCHEMA', 'MAKER_V8_PACK_BOOLEAN_INVALID', `${label} must be boolean.`);
  return value;
}

function exactText(value, label, maximum, { allowEmpty = false } = {}) {
  if (typeof value !== 'string' || value !== value.trim()
    || (!allowEmpty && !value.length)
    || encoder.encode(value).length > maximum
    || /[\u0000-\u001f\u007f]/.test(value)) {
    fail('SCHEMA', 'MAKER_V8_PACK_TEXT_INVALID', `${label} must be exact UTF-8 text within ${maximum} bytes.`);
  }
  return value;
}

function exactKey(value, label) {
  if (typeof value !== 'string' || !SAFE_KEY.test(value) || encoder.encode(value).length > 128) {
    fail('SCHEMA', 'MAKER_V8_PACK_KEY_INVALID', `${label} must be a safe v8 semantic key.`);
  }
  return value;
}

function exactDraftId(value) {
  if (typeof value !== 'string' || !SAFE_DRAFT_ID.test(value)) {
    fail('SCHEMA', 'MAKER_V8_PACK_DRAFT_ID_INVALID', 'Pack draftId must be a safe lowercase identifier.');
  }
  return value;
}

function exactId(value, label) {
  if (typeof value !== 'string' || !EXACT_ID.test(value) || value === ZERO_ID) {
    fail('BINDING', 'MAKER_V8_PACK_ID_INVALID', `${label} must be one exact lowercase non-zero Sui ID.`);
  }
  return value;
}

function exactHash(value, label, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !HASH.test(value)) {
    fail('BINDING', 'MAKER_V8_PACK_HASH_INVALID', `${label} must be one lowercase SHA-256 hex value.`);
  }
  return value;
}

function exactU64(value, label, { positive = false, maximum = (1n << 64n) - 1n } = {}) {
  if (typeof value !== 'string' || !U64.test(value)) {
    fail('SCHEMA', 'MAKER_V8_PACK_U64_INVALID', `${label} must be a canonical u64 decimal string.`);
  }
  const parsed = BigInt(value);
  if ((positive && parsed === 0n) || parsed > maximum) {
    fail('SCHEMA', 'MAKER_V8_PACK_U64_RANGE', `${label} is outside its allowed u64 range.`);
  }
  return value;
}

function exactTime(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail('SCHEMA', 'MAKER_V8_PACK_TIME_INVALID', `${label} must be a non-negative safe integer.`);
  }
  return value;
}

function exactRevision(value, label = 'revision') {
  if (!Number.isSafeInteger(value) || value < 1) {
    fail('SCHEMA', 'MAKER_V8_PACK_REVISION_INVALID', `${label} must be a positive safe integer.`);
  }
  return value;
}

function encodeBase58(bytes) {
  let leading = 0;
  while (leading < bytes.length && bytes[leading] === 0) leading += 1;
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  let encoded = '';
  while (value > 0n) {
    encoded = BASE58_ALPHABET[Number(value % 58n)] + encoded;
    value /= 58n;
  }
  return `${'1'.repeat(leading)}${encoded}`;
}

function decodeBase58(value) {
  let leading = 0;
  while (leading < value.length && value[leading] === '1') leading += 1;
  let integer = 0n;
  for (const character of value) {
    const index = BASE58_INDEX.get(character);
    if (index === undefined) throw new TypeError('base58');
    integer = integer * 58n + BigInt(index);
  }
  const tail = [];
  while (integer > 0n) {
    tail.push(Number(integer % 256n));
    integer /= 256n;
  }
  return Uint8Array.from([...Array(leading).fill(0), ...tail.reverse()]);
}

function exactDigest(value, label) {
  try {
    if (typeof value !== 'string' || !value.length) throw new TypeError('digest');
    const bytes = decodeBase58(value);
    if (bytes.length !== 32 || bytes.every((byte) => byte === 0) || encodeBase58(bytes) !== value) {
      throw new TypeError('digest');
    }
  } catch {
    fail('BINDING', 'MAKER_V8_PACK_DIGEST_INVALID', `${label} must be one exact canonical non-zero Sui digest.`);
  }
  return value;
}

function objectRef(value, label) {
  exactKeys(value, ['objectId', 'version', 'digest'], `${label}.objectRef`, 'BINDING');
  return {
    objectId: exactId(value.objectId, `${label}.objectId`),
    version: exactU64(value.version, `${label}.version`, { positive: true }),
    digest: exactDigest(value.digest, `${label}.digest`),
  };
}

function canonicalValue(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) throw new TypeError('non-canonical number');
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (plain(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => {
      if (value[key] === undefined) throw new TypeError('undefined');
      return [key, canonicalValue(value[key])];
    }));
  }
  throw new TypeError('non-canonical value');
}

export function canonicalMakerV8PackJson(value) {
  try {
    return JSON.stringify(canonicalValue(value));
  } catch {
    fail('SCHEMA', 'MAKER_V8_PACK_CANONICAL_JSON_INVALID', 'Pack data must be deterministic JSON.');
  }
}

async function sha256Canonical(value) {
  if (!globalThis.crypto?.subtle?.digest) {
    fail('ENVIRONMENT', 'MAKER_V8_PACK_CRYPTO_REQUIRED', 'Web Crypto SHA-256 is required for Pack integrity.');
  }
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest(
    'SHA-256',
    encoder.encode(canonicalMakerV8PackJson(value)),
  ));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function assertMetadata(value) {
  exactKeys(value, ['semanticPackId', 'name', 'summary', 'coverAssetId'], 'document.metadata');
  exactKey(value.semanticPackId, 'metadata.semanticPackId');
  exactText(value.name, 'metadata.name', 256);
  exactText(value.summary, 'metadata.summary', 2_000, { allowEmpty: true });
  if (value.coverAssetId !== null) exactKey(value.coverAssetId, 'metadata.coverAssetId');
}

function assertAuthor(value, bindings) {
  exactKeys(value, ['address', 'role'], 'document.author');
  exactId(value.address, 'author.address');
  if (!['MAKER_OWNER', 'THIRD_PARTY'].includes(value.role)) {
    fail('ADMISSION', 'MAKER_V8_PACK_AUTHOR_ROLE_INVALID', 'Pack author role must be MAKER_OWNER or THIRD_PARTY.');
  }
  if (value.role === 'MAKER_OWNER' && value.address !== bindings.root.owner) {
    fail('ADMISSION', 'MAKER_V8_PACK_AUTHOR_OWNER_MISMATCH', 'MAKER_OWNER author must equal the exact live Root owner.');
  }
  if (value.role === 'THIRD_PARTY' && value.address === bindings.root.owner) {
    fail('ADMISSION', 'MAKER_V8_PACK_AUTHOR_ROLE_MISMATCH', 'The live Root owner must use the MAKER_OWNER author role.');
  }
}

function assertAdmission(value, author, bindings) {
  exactKeys(value, ['makerApproval', 'expectedPackRegistryRevision'], 'document.admission');
  if (value.makerApproval !== 'REQUIRED') {
    fail('ADMISSION', 'MAKER_V8_PACK_MAKER_APPROVAL_REQUIRED', 'Every Pack author requires explicit current MakerAdmin and Root-owner admission.');
  }
  exactU64(value.expectedPackRegistryRevision, 'admission.expectedPackRegistryRevision');
  if (value.expectedPackRegistryRevision !== bindings.packRegistry.revision) {
    fail('ADMISSION', 'MAKER_V8_PACK_REGISTRY_REVISION_MISMATCH', 'Pack admission must use the exact current PackRegistry revision.');
  }
  if (bindings.makerAdmin.owner !== bindings.root.owner
    || bindings.makerAdmin.objectRef.objectId !== bindings.root.adminCapId
    || bindings.makerAdmin.controlEpoch !== bindings.root.controlEpoch) {
    fail('ADMISSION', 'MAKER_V8_PACK_MAKER_ADMIN_MISMATCH', 'Pack admission is not bound to the exact current MakerAdmin and Root owner.');
  }
  // Runtime v8 admission ceilings and attestations govern ExternalItemProductV8,
  // never Pack authors. A third-party Pack still follows this same explicit
  // MakerAdmin + Root-owner + PackRegistry CAS path.
  void author;
}

function assertAccess(value) {
  exactKeys(value, ['kind', 'priceAtomic'], 'document.access');
  if (!MAKER_V8_PACK_ACCESS_KINDS.includes(value.kind)) {
    fail('POLICY', 'MAKER_V8_PACK_ACCESS_KIND_INVALID', 'Pack access kind is invalid.');
  }
  exactU64(value.priceAtomic, 'access.priceAtomic', { maximum: MAX_PRICE });
  const price = BigInt(value.priceAtomic);
  const valid = (value.kind === 'FREE' && price === 0n)
    || (value.kind === 'PAID' && price > 0n)
    || (value.kind === 'INCLUDED_WITH_MAKER' && price === 0n);
  if (!valid) fail('POLICY', 'MAKER_V8_PACK_ACCESS_POLICY_INVALID', 'Pack access price does not match its Runtime v8 access kind.');
}

function assertCompletion(value) {
  exactKeys(value, ['mode', 'priceAtomic', 'freeQuotaPerWallet', 'totalCap'], 'document.completion');
  if (!MAKER_V8_PACK_COMPLETE_MODES.includes(value.mode)) {
    fail('POLICY', 'MAKER_V8_PACK_COMPLETION_MODE_INVALID', 'Pack completion mode is invalid.');
  }
  exactU64(value.priceAtomic, 'completion.priceAtomic', { maximum: MAX_PRICE });
  exactU64(value.freeQuotaPerWallet, 'completion.freeQuotaPerWallet', { maximum: MAX_COMPLETE_COUNT });
  exactU64(value.totalCap, 'completion.totalCap', { maximum: MAX_COMPLETE_COUNT });
  const price = BigInt(value.priceAtomic);
  const quota = BigInt(value.freeQuotaPerWallet);
  const cap = BigInt(value.totalCap);
  const valid = (value.mode === 'UNLIMITED_FREE' && price === 0n && quota === 0n)
    || (value.mode === 'FREE_QUOTA_THEN_PAID' && price > 0n && quota > 0n)
    || (value.mode === 'PAID_EVERY_TIME' && price > 0n && quota === 0n)
    || (value.mode === 'FREE_QUOTA_THEN_BLOCK' && price === 0n && quota > 0n);
  if (!valid || (cap !== 0n && cap < quota)) {
    fail('POLICY', 'MAKER_V8_PACK_COMPLETION_POLICY_INVALID', 'Pack completion economics do not match Runtime v8.');
  }
}

function assertAsset(value, label, mode) {
  exactKeys(value, [
    'assetId', 'mediaType', 'byteLength', 'sha256', 'blobId',
    'contentCommitment', 'protected', 'sealBindingCommitment',
  ], label);
  exactKey(value.assetId, `${label}.assetId`);
  exactText(value.mediaType, `${label}.mediaType`, 128);
  if (!Number.isSafeInteger(value.byteLength) || value.byteLength < 1 || value.byteLength > MAX_ASSET_BYTES) {
    fail('ASSET', 'MAKER_V8_PACK_ASSET_SIZE_INVALID', `${label}.byteLength must be between 1 and ${MAX_ASSET_BYTES}.`);
  }
  exactHash(value.sha256, `${label}.sha256`);
  exactHash(value.contentCommitment, `${label}.contentCommitment`);
  exactBoolean(value.protected, `${label}.protected`);
  if (value.blobId !== null) exactText(value.blobId, `${label}.blobId`, 512);
  if (mode === 'COMPILE' && value.blobId === null) {
    fail('ASSET', 'MAKER_V8_PACK_ASSET_BLOB_REQUIRED', `${label} must have a durable asset blob before publication.`);
  }
  exactHash(value.sealBindingCommitment, `${label}.sealBindingCommitment`, { nullable: true });
  if (!value.protected && value.sealBindingCommitment !== null
    || mode === 'COMPILE' && value.protected && value.sealBindingCommitment === null) {
    fail(
      'ASSET',
      'MAKER_V8_PACK_SEAL_BINDING_INVALID',
      `${label} Seal binding does not match its draft/publication protection state.`,
    );
  }
}

function assertStyles(value, metadata, mode) {
  if (!Array.isArray(value) || value.length > MAX_PACK_STYLES || (mode === 'COMPILE' && value.length < 1)) {
    fail('SCHEMA', 'MAKER_V8_PACK_STYLE_COUNT_INVALID', `Pack styles must contain ${mode === 'COMPILE' ? '1 to' : '0 to'} ${MAX_PACK_STYLES} rows.`);
  }
  const semanticKeys = new Set();
  const assetIds = new Set();
  value.forEach((style, index) => {
    const label = `document.styles[${index}]`;
    exactKeys(style, [
      'sequence', 'partKey', 'itemKey', 'styleKey', 'layerTrackKey',
      'colorChannelKey', 'defaultSwatchKey', 'asset',
    ], label);
    exactU64(style.sequence, `${label}.sequence`);
    if (style.sequence !== String(index)) {
      fail('SCHEMA', 'MAKER_V8_PACK_STYLE_SEQUENCE_INVALID', `${label}.sequence must equal its canonical row index.`);
    }
    for (const field of ['partKey', 'itemKey', 'styleKey', 'layerTrackKey']) {
      exactKey(style[field], `${label}.${field}`);
    }
    if (style.colorChannelKey !== null) exactKey(style.colorChannelKey, `${label}.colorChannelKey`);
    if (style.defaultSwatchKey !== null) exactKey(style.defaultSwatchKey, `${label}.defaultSwatchKey`);
    if ((style.colorChannelKey === null) !== (style.defaultSwatchKey === null)) {
      fail('SCHEMA', 'MAKER_V8_PACK_COLOR_REFERENCE_INVALID', `${label} color channel and default swatch must be present together.`);
    }
    const semanticKey = `${style.partKey}/${style.itemKey}/${style.styleKey}`;
    if (semanticKeys.has(semanticKey)) {
      fail('SCHEMA', 'MAKER_V8_PACK_STYLE_DUPLICATE', `Duplicate Pack style ${semanticKey}.`);
    }
    semanticKeys.add(semanticKey);
    assertAsset(style.asset, `${label}.asset`, mode);
    if (assetIds.has(style.asset.assetId)) {
      fail('SCHEMA', 'MAKER_V8_PACK_ASSET_DUPLICATE', `Duplicate Pack asset ${style.asset.assetId}.`);
    }
    assetIds.add(style.asset.assetId);
  });
  if (metadata.coverAssetId !== null && !assetIds.has(metadata.coverAssetId)) {
    fail('SCHEMA', 'MAKER_V8_PACK_COVER_ASSET_INVALID', 'Pack coverAssetId does not reference a Pack style asset.');
  }
}

function assertBindings(value) {
  exactKeys(value, [
    'root', 'makerAdmin', 'definitionRegistry', 'baseRegistry', 'packRegistry',
    'admissionAuthority', 'physicalRegistry', 'marketRegistry', 'releaseConfig',
  ], 'document.bindings', 'BINDING');

  exactKeys(value.root, [
    'objectRef', 'makerVersion', 'contentCommitment', 'lifecycle', 'owner',
    'adminCapId', 'controlEpoch',
  ], 'bindings.root', 'BINDING');
  value.root.objectRef = objectRef(value.root.objectRef, 'bindings.root');
  exactU64(value.root.makerVersion, 'bindings.root.makerVersion', { positive: true });
  exactHash(value.root.contentCommitment, 'bindings.root.contentCommitment');
  exactId(value.root.owner, 'bindings.root.owner');
  exactId(value.root.adminCapId, 'bindings.root.adminCapId');
  exactU64(value.root.controlEpoch, 'bindings.root.controlEpoch');
  if (value.root.lifecycle !== 'ACTIVE') {
    fail('BINDING', 'MAKER_V8_PACK_ROOT_INACTIVE', 'New Pack releases require an ACTIVE Maker Root.');
  }

  exactKeys(value.makerAdmin, [
    'objectRef', 'protocolVersion', 'rootId', 'owner', 'controlEpoch',
  ], 'bindings.makerAdmin', 'BINDING');
  value.makerAdmin.objectRef = objectRef(value.makerAdmin.objectRef, 'bindings.makerAdmin');
  if (value.makerAdmin.protocolVersion !== 8) {
    fail('BINDING', 'MAKER_V8_PACK_MAKER_ADMIN_VERSION_INVALID', 'MakerAdmin must be the exact Fresh v8 capability.');
  }
  exactId(value.makerAdmin.rootId, 'makerAdmin.rootId');
  exactId(value.makerAdmin.owner, 'makerAdmin.owner');
  exactU64(value.makerAdmin.controlEpoch, 'makerAdmin.controlEpoch');

  exactKeys(value.definitionRegistry, [
    'objectRef', 'rootId', 'rootVersion', 'rootContentCommitment', 'baseRegistryId',
    'sealed', 'admissionCeiling',
  ], 'bindings.definitionRegistry', 'BINDING');
  value.definitionRegistry.objectRef = objectRef(value.definitionRegistry.objectRef, 'bindings.definitionRegistry');
  exactId(value.definitionRegistry.rootId, 'definitionRegistry.rootId');
  exactU64(value.definitionRegistry.rootVersion, 'definitionRegistry.rootVersion', { positive: true });
  exactHash(value.definitionRegistry.rootContentCommitment, 'definitionRegistry.rootContentCommitment');
  exactId(value.definitionRegistry.baseRegistryId, 'definitionRegistry.baseRegistryId');
  if (value.definitionRegistry.sealed !== true) fail('BINDING', 'MAKER_V8_PACK_DEFINITIONS_UNSEALED', 'Runtime definitions must be sealed.');
  if (!EXTERNAL_ITEM_ADMISSION_CEILINGS.has(value.definitionRegistry.admissionCeiling)) {
    fail('BINDING', 'MAKER_V8_PACK_ADMISSION_CEILING_INVALID', 'Runtime definition admission ceiling is invalid.');
  }

  exactKeys(value.baseRegistry, [
    'objectRef', 'rootId', 'makerVersion', 'rootContentCommitment', 'sealed',
  ], 'bindings.baseRegistry', 'BINDING');
  value.baseRegistry.objectRef = objectRef(value.baseRegistry.objectRef, 'bindings.baseRegistry');
  exactId(value.baseRegistry.rootId, 'baseRegistry.rootId');
  exactU64(value.baseRegistry.makerVersion, 'baseRegistry.makerVersion', { positive: true });
  exactHash(value.baseRegistry.rootContentCommitment, 'baseRegistry.rootContentCommitment');
  if (value.baseRegistry.sealed !== true) fail('BINDING', 'MAKER_V8_PACK_BASE_UNSEALED', 'Base definition registry must be sealed.');

  exactKeys(value.packRegistry, [
    'objectRef', 'rootId', 'rootVersion', 'rootContentCommitment',
    'definitionRegistryId', 'admissionAuthorityId', 'admissionPolicyCommitment', 'revision',
  ], 'bindings.packRegistry', 'BINDING');
  value.packRegistry.objectRef = objectRef(value.packRegistry.objectRef, 'bindings.packRegistry');
  exactId(value.packRegistry.rootId, 'packRegistry.rootId');
  exactU64(value.packRegistry.rootVersion, 'packRegistry.rootVersion', { positive: true });
  exactHash(value.packRegistry.rootContentCommitment, 'packRegistry.rootContentCommitment');
  exactId(value.packRegistry.definitionRegistryId, 'packRegistry.definitionRegistryId');
  exactId(value.packRegistry.admissionAuthorityId, 'packRegistry.admissionAuthorityId');
  exactHash(value.packRegistry.admissionPolicyCommitment, 'packRegistry.admissionPolicyCommitment');
  exactU64(value.packRegistry.revision, 'packRegistry.revision');

  exactKeys(value.admissionAuthority, [
    'objectRef', 'rootId', 'rootVersion', 'rootContentCommitment',
  ], 'bindings.admissionAuthority', 'BINDING');
  value.admissionAuthority.objectRef = objectRef(value.admissionAuthority.objectRef, 'bindings.admissionAuthority');
  exactId(value.admissionAuthority.rootId, 'admissionAuthority.rootId');
  exactU64(value.admissionAuthority.rootVersion, 'admissionAuthority.rootVersion', { positive: true });
  exactHash(value.admissionAuthority.rootContentCommitment, 'admissionAuthority.rootContentCommitment');

  exactKeys(value.physicalRegistry, [
    'objectRef', 'catalogId', 'productBindingCommitment', 'callCapSetCommitment',
    'rootId', 'makerVersion', 'rootContentCommitment', 'baseRegistryId', 'revision',
  ], 'bindings.physicalRegistry', 'BINDING');
  value.physicalRegistry.objectRef = objectRef(value.physicalRegistry.objectRef, 'bindings.physicalRegistry');
  exactId(value.physicalRegistry.catalogId, 'physicalRegistry.catalogId');
  exactHash(value.physicalRegistry.productBindingCommitment, 'physicalRegistry.productBindingCommitment');
  exactHash(value.physicalRegistry.callCapSetCommitment, 'physicalRegistry.callCapSetCommitment');
  exactId(value.physicalRegistry.rootId, 'physicalRegistry.rootId');
  exactU64(value.physicalRegistry.makerVersion, 'physicalRegistry.makerVersion', { positive: true });
  exactHash(value.physicalRegistry.rootContentCommitment, 'physicalRegistry.rootContentCommitment');
  exactId(value.physicalRegistry.baseRegistryId, 'physicalRegistry.baseRegistryId');
  exactU64(value.physicalRegistry.revision, 'physicalRegistry.revision');

  exactKeys(value.marketRegistry, [
    'objectRef', 'catalogId', 'productBindingCommitment', 'callCapSetCommitment',
    'rootId', 'makerVersion', 'rootContentCommitment', 'treasuryId', 'sealed', 'revision',
  ], 'bindings.marketRegistry', 'BINDING');
  value.marketRegistry.objectRef = objectRef(value.marketRegistry.objectRef, 'bindings.marketRegistry');
  exactId(value.marketRegistry.catalogId, 'marketRegistry.catalogId');
  exactHash(value.marketRegistry.productBindingCommitment, 'marketRegistry.productBindingCommitment');
  exactHash(value.marketRegistry.callCapSetCommitment, 'marketRegistry.callCapSetCommitment');
  exactId(value.marketRegistry.rootId, 'marketRegistry.rootId');
  exactU64(value.marketRegistry.makerVersion, 'marketRegistry.makerVersion', { positive: true });
  exactHash(value.marketRegistry.rootContentCommitment, 'marketRegistry.rootContentCommitment');
  exactId(value.marketRegistry.treasuryId, 'marketRegistry.treasuryId');
  if (value.marketRegistry.sealed !== true) fail('BINDING', 'MAKER_V8_PACK_MARKET_UNSEALED', 'Market registry must be sealed.');
  exactU64(value.marketRegistry.revision, 'marketRegistry.revision');

  exactKeys(value.releaseConfig, [
    'objectRef', 'catalogId', 'productBindingCommitment', 'callCapSetCommitment',
  ], 'bindings.releaseConfig', 'BINDING');
  value.releaseConfig.objectRef = objectRef(value.releaseConfig.objectRef, 'bindings.releaseConfig');
  exactId(value.releaseConfig.catalogId, 'releaseConfig.catalogId');
  exactHash(value.releaseConfig.productBindingCommitment, 'releaseConfig.productBindingCommitment');
  exactHash(value.releaseConfig.callCapSetCommitment, 'releaseConfig.callCapSetCommitment');

  const rootId = value.root.objectRef.objectId;
  const rootVersion = value.root.makerVersion;
  const content = value.root.contentCommitment;
  for (const [name, binding] of Object.entries(value)) {
    if (name === 'root' || name === 'releaseConfig' || name === 'makerAdmin') continue;
    if (binding.rootId !== rootId
      || (binding.rootVersion !== undefined && binding.rootVersion !== rootVersion)
      || (binding.makerVersion !== undefined && binding.makerVersion !== rootVersion)
      || binding.rootContentCommitment !== content) {
      fail('BINDING', 'MAKER_V8_PACK_ROOT_BINDING_MISMATCH', `${name} is not cross-bound to the exact Maker Root.`);
    }
  }
  if (value.packRegistry.definitionRegistryId !== value.definitionRegistry.objectRef.objectId
    || value.packRegistry.admissionAuthorityId !== value.admissionAuthority.objectRef.objectId
    || value.definitionRegistry.baseRegistryId !== value.baseRegistry.objectRef.objectId
    || value.physicalRegistry.baseRegistryId !== value.baseRegistry.objectRef.objectId) {
    fail('BINDING', 'MAKER_V8_PACK_REGISTRY_BINDING_MISMATCH', 'Pack, admission, definition, or Physical registry IDs differ.');
  }
  if (value.makerAdmin.objectRef.objectId !== value.root.adminCapId
    || value.makerAdmin.rootId !== rootId
    || value.makerAdmin.owner !== value.root.owner
    || value.makerAdmin.controlEpoch !== value.root.controlEpoch) {
    fail('BINDING', 'MAKER_V8_PACK_MAKER_ADMIN_MISMATCH', 'MakerAdmin is not the exact current Root control capability.');
  }
  const catalogId = value.releaseConfig.catalogId;
  const productBinding = value.releaseConfig.productBindingCommitment;
  const callCaps = value.releaseConfig.callCapSetCommitment;
  for (const [name, binding] of [
    ['physicalRegistry', value.physicalRegistry],
    ['marketRegistry', value.marketRegistry],
  ]) {
    if (binding.catalogId !== catalogId
      || binding.productBindingCommitment !== productBinding
      || binding.callCapSetCommitment !== callCaps) {
      fail('BINDING', 'MAKER_V8_PACK_PRODUCT_BINDING_MISMATCH', `${name} differs from the certified Release binding.`);
    }
  }
  return value;
}

export function assertMakerV8PackDocumentV8(value, { mode = 'DRAFT' } = {}) {
  if (!['DRAFT', 'COMPILE'].includes(mode)) {
    fail('SCHEMA', 'MAKER_V8_PACK_VALIDATION_MODE_INVALID', 'Pack validation mode must be DRAFT or COMPILE.');
  }
  const document = snapshot(value);
  exactKeys(document, [...DOCUMENT_FIELDS,
    ...(document.authoring === undefined ? [] : ['authoring']),
    ...(document.authoringParent === undefined ? [] : ['authoringParent'])], 'Pack document');
  if (document.authoringParent !== undefined && (document.bindings?.kind === 'LOCAL_DRAFT'
    || !plain(document.authoringParent) || !plain(document.authoring))) {
    fail('SCHEMA', 'MAKER_V8_PACK_AUTHORING_NOT_PUBLISHABLE', 'Retained parent is only valid for a bound authored draft.');
  }
  if (document.authoring !== undefined && (!plain(document.authoring)
    || document.bindings?.kind !== 'LOCAL_DRAFT' && document.authoringParent === undefined)) {
    fail('SCHEMA', 'MAKER_V8_PACK_AUTHORING_NOT_PUBLISHABLE', 'Additive authoring requires its retained parent snapshot.');
  }
  if (document.schemaVersion !== MAKER_V8_PACK_DOCUMENT_SCHEMA || document.protocolVersion !== 8) {
    fail('SCHEMA', 'MAKER_V8_PACK_DOCUMENT_SCHEMA_INVALID', 'Pack document is not exact Fresh Maker v8.');
  }
  assertMetadata(document.metadata);
  if (document.bindings?.kind === 'LOCAL_DRAFT') {
    exactKeys(document.bindings, ['kind', 'parent'], 'local parent binding');
    const parent = document.bindings.parent;
    exactKeys(parent, ['schemaVersion', 'draft', 'assets', 'draftSha256'], 'parent snapshot');
    if (!plain(parent.draft) || !plain(parent.draft.document)) {
      fail('BINDING', 'MAKER_V8_PACK_LOCAL_PARENT_INVALID', 'Local parent document is missing.');
    }
    exactDraftId(parent.draft.draftId);
    exactRevision(parent.draft.revision);
    if (parent.schemaVersion !== 'animacraft.maker-v8-draft-export.v1'
      || !Array.isArray(parent.assets) || !/^[a-f0-9]{64}$/.test(parent.draftSha256)) {
      fail('BINDING', 'MAKER_V8_PACK_LOCAL_PARENT_INVALID', 'A local Pack needs its complete parent snapshot.');
    }
    exactKeys(document.author, ['address', 'role'], 'document.author');
    exactId(document.author.address, 'author.address');
    exactKeys(document.admission, ['makerApproval', 'expectedPackRegistryRevision'], 'document.admission');
    if (document.author.role !== 'MAKER_OWNER' || document.admission.makerApproval !== 'REQUIRED'
      || document.admission.expectedPackRegistryRevision !== null) {
      fail('BINDING', 'MAKER_V8_PACK_LOCAL_PARENT_INVALID', 'Local authoring cannot claim chain admission.');
    }
    if (mode !== 'DRAFT') {
      fail('BINDING', 'MAKER_V8_PACK_PARENT_NOT_PUBLISHED', 'Bind the exact published parent release before publishing this Pack.');
    }
  } else {
    assertBindings(document.bindings);
    assertAuthor(document.author, document.bindings);
    assertAdmission(document.admission, document.author, document.bindings);
  }
  assertAccess(document.access);
  assertCompletion(document.completion);
  assertStyles(document.styles, document.metadata, mode);
  canonicalMakerV8PackJson(document);
  return freeze(document);
}

/** Exact public Pack payload persisted inside the certified Walrus Manifest. */
export function assertMakerV8PackPublicationContentV8(value) {
  const content = snapshot(value);
  exactKeys(content, PUBLICATION_CONTENT_FIELDS, 'Pack publication content');
  if (content.schemaVersion !== 'animacraft.maker-v8-pack-content.v1'
    || content.protocolVersion !== 8) {
    fail('SCHEMA', 'MAKER_V8_PACK_CONTENT_SCHEMA_INVALID', 'Pack publication content is not exact Fresh Maker v8.');
  }
  exactId(content.rootId, 'Pack publication content.rootId');
  exactU64(content.rootVersion, 'Pack publication content.rootVersion', { positive: true });
  exactHash(content.rootContentCommitment, 'Pack publication content.rootContentCommitment');
  exactKey(content.semanticPackId, 'Pack publication content.semanticPackId');
  assertMetadata(content.metadata);
  if (content.metadata.semanticPackId !== content.semanticPackId) {
    fail('BINDING', 'MAKER_V8_PACK_CONTENT_IDENTITY_DRIFT', 'Pack Manifest semantic identity differs from its metadata.');
  }
  exactKeys(content.author, ['address', 'role'], 'Pack publication content.author');
  exactId(content.author.address, 'Pack publication content.author.address');
  if (!['MAKER_OWNER', 'THIRD_PARTY'].includes(content.author.role)) {
    fail('ADMISSION', 'MAKER_V8_PACK_AUTHOR_ROLE_INVALID', 'Pack publication author role is invalid.');
  }
  exactKeys(
    content.admission,
    ['makerApproval', 'expectedPackRegistryRevision'],
    'Pack publication content.admission',
  );
  if (content.admission.makerApproval !== 'REQUIRED') {
    fail('ADMISSION', 'MAKER_V8_PACK_MAKER_APPROVAL_REQUIRED', 'Pack Manifest must preserve explicit Maker approval.');
  }
  exactU64(
    content.admission.expectedPackRegistryRevision,
    'Pack publication content.admission.expectedPackRegistryRevision',
  );
  assertAccess(content.access);
  assertCompletion(content.completion);
  assertStyles(content.styles, content.metadata, 'COMPILE');
  if (content.authoring !== null && !plain(content.authoring)) fail('SCHEMA', 'MAKER_V8_PACK_CONTENT_SCHEMA_INVALID', 'Pack authoring content must be explicit null or a record.');
  return freeze(content);
}

function assertChainReadback(value, document, {
  expectedLifecycle = null,
  expectedDigest = null,
  minimumPackRegistryRevision = null,
  requireInitialAdmissionRevision = false,
} = {}) {
  const readback = snapshot(value);
  exactKeys(readback, [
    'schemaVersion', 'rootId', 'packRegistryId', 'semanticPackId',
    'release', 'adminCap', 'treasury', 'lifecycle', 'packRegistryRevision',
    'finalizedDigest',
  ], 'Pack chain readback', 'READBACK');
  if (readback.schemaVersion !== MAKER_V8_PACK_CHAIN_READBACK_SCHEMA) {
    fail('READBACK', 'MAKER_V8_PACK_CHAIN_READBACK_SCHEMA_INVALID', 'Pack chain readback is not exact Fresh Maker v8.');
  }
  exactId(readback.rootId, 'chain.rootId');
  exactId(readback.packRegistryId, 'chain.packRegistryId');
  exactKey(readback.semanticPackId, 'chain.semanticPackId');
  exactKeys(readback.release, ['objectRef', 'owner', 'controlEpoch'], 'chain.release', 'READBACK');
  readback.release.objectRef = objectRef(readback.release.objectRef, 'chain.release');
  exactId(readback.release.owner, 'chain.release.owner');
  exactU64(readback.release.controlEpoch, 'chain.release.controlEpoch');
  exactKeys(readback.adminCap, [
    'objectRef', 'releaseId', 'owner', 'controlEpoch',
  ], 'chain.adminCap', 'READBACK');
  readback.adminCap.objectRef = objectRef(readback.adminCap.objectRef, 'chain.adminCap');
  exactId(readback.adminCap.releaseId, 'chain.adminCap.releaseId');
  exactId(readback.adminCap.owner, 'chain.adminCap.owner');
  exactU64(readback.adminCap.controlEpoch, 'chain.adminCap.controlEpoch');
  exactKeys(readback.treasury, ['objectRef', 'releaseId'], 'chain.treasury', 'READBACK');
  readback.treasury.objectRef = objectRef(readback.treasury.objectRef, 'chain.treasury');
  exactId(readback.treasury.releaseId, 'chain.treasury.releaseId');
  exactU64(readback.packRegistryRevision, 'chain.packRegistryRevision', { positive: true });
  exactDigest(readback.finalizedDigest, 'chain.finalizedDigest');
  if (!CHAIN_LIFECYCLES.has(readback.lifecycle)
    || (expectedLifecycle !== null && readback.lifecycle !== expectedLifecycle)) {
    fail('READBACK', 'MAKER_V8_PACK_CHAIN_LIFECYCLE_MISMATCH', 'Pack finalized lifecycle differs from the exact requested state.');
  }
  if (expectedDigest !== null && readback.finalizedDigest !== expectedDigest) {
    fail('READBACK', 'MAKER_V8_PACK_CHAIN_DIGEST_MISMATCH', 'Pack readback does not bind the exact finalized transaction digest.');
  }
  const releaseId = readback.release.objectRef.objectId;
  if (readback.rootId !== document.bindings.root.objectRef.objectId
    || readback.packRegistryId !== document.bindings.packRegistry.objectRef.objectId
    || readback.semanticPackId !== document.metadata.semanticPackId
    || readback.adminCap.owner !== readback.release.owner
    || readback.adminCap.releaseId !== releaseId
    || readback.treasury.releaseId !== releaseId
    || readback.adminCap.controlEpoch !== readback.release.controlEpoch) {
    fail('READBACK', 'MAKER_V8_PACK_CHAIN_IDENTITY_MISMATCH', 'Pack readback does not prove the exact Root, registry, author, release, cap, and treasury identity.');
  }
  const uniqueIds = new Set([
    releaseId,
    readback.adminCap.objectRef.objectId,
    readback.treasury.objectRef.objectId,
  ]);
  if (uniqueIds.size !== 3) {
    fail('READBACK', 'MAKER_V8_PACK_CHAIN_IDENTITY_COLLISION', 'Pack release, admin cap, and treasury IDs must be distinct.');
  }
  const revision = BigInt(readback.packRegistryRevision);
  const initial = BigInt(document.admission.expectedPackRegistryRevision) + 1n;
  if ((requireInitialAdmissionRevision && revision !== initial)
    || (minimumPackRegistryRevision !== null
      && revision < BigInt(minimumPackRegistryRevision))) {
    fail('READBACK', 'MAKER_V8_PACK_CHAIN_REVISION_MISMATCH', 'Pack readback does not prove the exact admission revision.');
  }
  if (requireInitialAdmissionRevision && readback.release.owner !== document.author.address) {
    fail('READBACK', 'MAKER_V8_PACK_CHAIN_IDENTITY_MISMATCH', 'Initial Pack control does not belong to the exact certified Pack author.');
  }
  return freeze(readback);
}

function assertPublication(value, document) {
  if (document.bindings?.kind === 'LOCAL_DRAFT' && value?.status !== 'UNPREPARED') {
    fail('BINDING', 'MAKER_V8_PACK_PARENT_NOT_PUBLISHED', 'A local parent cannot have a publication attempt.');
  }
  exactKeys(value, PUBLICATION_FIELDS, 'draft.publication');
  if (!PUBLICATION_STATES.has(value.status)) {
    fail('SCHEMA', 'MAKER_V8_PACK_PUBLICATION_STATE_INVALID', 'Pack publication state is invalid.');
  }
  if (value.attemptId !== null) exactText(value.attemptId, 'publication.attemptId', 256);
  if ((value.status === 'UNPREPARED') !== (value.attemptId === null)) {
    fail('SCHEMA', 'MAKER_V8_PACK_PUBLICATION_ATTEMPT_INVALID', 'Pack publication attempt and state differ.');
  }
  if ((value.status === 'COMPLETE') !== (value.chain !== null)) {
    fail('SCHEMA', 'MAKER_V8_PACK_CHAIN_STATE_UNCERTIFIED', 'Only a certified completed publication may expose Pack chain readback.');
  }
  if (value.chain !== null) value.chain = assertChainReadback(value.chain, document);
  if (value.updatedAt !== null) exactTime(value.updatedAt, 'publication.updatedAt');
  if (value.lastError !== null) {
    exactKeys(value.lastError, ['schemaVersion', 'code', 'message', 'recoverable'], 'publication.lastError');
    if (value.lastError.schemaVersion !== MAKER_V8_PACK_ERROR_VIEW_SCHEMA
      || typeof value.lastError.code !== 'string'
      || typeof value.lastError.message !== 'string'
      || typeof value.lastError.recoverable !== 'boolean') {
      fail('SCHEMA', 'MAKER_V8_PACK_ERROR_VIEW_INVALID', 'Stored Pack error is invalid.');
    }
  }
}

export function assertMakerV8PackDraftV8(value, { mode = 'DRAFT' } = {}) {
  const draft = snapshot(value);
  exactKeys(draft, DRAFT_FIELDS, 'Pack draft');
  if (draft.schemaVersion !== MAKER_V8_PACK_DRAFT_SCHEMA) {
    fail('SCHEMA', 'MAKER_V8_PACK_DRAFT_SCHEMA_INVALID', 'Pack draft record is not exact Fresh Maker v8.');
  }
  exactDraftId(draft.draftId);
  exactRevision(draft.revision);
  exactTime(draft.createdAt, 'draft.createdAt');
  exactTime(draft.updatedAt, 'draft.updatedAt');
  if (draft.updatedAt < draft.createdAt) {
    fail('SCHEMA', 'MAKER_V8_PACK_TIME_INVALID', 'Pack draft updatedAt precedes createdAt.');
  }
  draft.document = assertMakerV8PackDocumentV8(draft.document, { mode });
  assertPublication(draft.publication, draft.document);
  canonicalMakerV8PackJson(draft);
  return freeze(draft);
}

export function makerV8PackErrorViewV8(error) {
  const source = error instanceof MakerV8PackControllerError ? error : null;
  return freeze({
    schemaVersion: MAKER_V8_PACK_ERROR_VIEW_SCHEMA,
    code: source?.code || (typeof error?.code === 'string' ? error.code : 'MAKER_V8_PACK_OPERATION_FAILED'),
    message: source?.userMessage || (typeof error?.message === 'string' && error.message
      ? error.message : 'The Pack operation could not be completed.'),
    recoverable: source?.recoverable ?? true,
  });
}

export function collectMakerV8PackDraftIssuesV8(value, options = {}) {
  try {
    assertMakerV8PackDraftV8(value, options);
    return freeze([]);
  } catch (error) {
    return freeze([makerV8PackErrorViewV8(error)]);
  }
}

function initialPublication() {
  return {
    attemptId: null,
    status: 'UNPREPARED',
    chain: null,
    updatedAt: null,
    lastError: null,
  };
}

function requireMethod(value, method, label) {
  if (typeof value?.[method] !== 'function') {
    fail('DEPENDENCY', 'MAKER_V8_PACK_DEPENDENCY_INVALID', `${label}.${method} is required.`, undefined, false);
  }
}

function executionGates(value) {
  exactKeys(value, ['allowWalletSignature', 'allowBroadcast'], 'execution', 'CONFIG');
  exactBoolean(value.allowWalletSignature, 'execution.allowWalletSignature');
  exactBoolean(value.allowBroadcast, 'execution.allowBroadcast');
  if (value.allowWalletSignature !== value.allowBroadcast) {
    fail('CONFIG', 'MAKER_V8_PACK_EXECUTION_GATE_INVALID', 'Pack signing and exact-byte broadcast gates must change together.', undefined, false);
  }
  return freeze({ ...value });
}

function cloneRecord(value, mode = 'DRAFT') {
  return assertMakerV8PackDraftV8(value, { mode });
}

export function createMakerV8PackMemoryPersistenceV8(seed = []) {
  const records = new Map();
  for (const value of seed) {
    const draft = cloneRecord(value);
    if (records.has(draft.draftId)) fail('PERSISTENCE', 'MAKER_V8_PACK_DRAFT_EXISTS', `Pack draft ${draft.draftId} already exists.`);
    records.set(draft.draftId, snapshot(draft));
  }
  return Object.freeze({
    capabilities: Object.freeze({ durable: false, atomicCas: true }),
    async create(value) {
      const draft = cloneRecord(value);
      if (records.has(draft.draftId)) fail('PERSISTENCE', 'MAKER_V8_PACK_DRAFT_EXISTS', `Pack draft ${draft.draftId} already exists.`);
      records.set(draft.draftId, snapshot(draft));
      return cloneRecord(draft);
    },
    async load(draftId) {
      exactDraftId(draftId);
      const value = records.get(draftId);
      return value ? cloneRecord(value) : null;
    },
    async compareAndSwap({ draftId, expectedRevision, next }) {
      exactDraftId(draftId);
      exactRevision(expectedRevision, 'expectedRevision');
      const current = records.get(draftId);
      if (!current) fail('PERSISTENCE', 'MAKER_V8_PACK_DRAFT_NOT_FOUND', `Pack draft ${draftId} was not found.`);
      if (current.revision !== expectedRevision) {
        fail('PERSISTENCE', 'MAKER_V8_PACK_DRAFT_CAS_MISMATCH', 'Pack draft changed in another tab.', {
          expectedRevision,
          actualRevision: current.revision,
        });
      }
      const draft = cloneRecord(next);
      if (draft.draftId !== draftId || draft.revision !== expectedRevision + 1) {
        fail('PERSISTENCE', 'MAKER_V8_PACK_DRAFT_CAS_INVALID', 'Pack CAS successor identity or revision is invalid.');
      }
      records.set(draftId, snapshot(draft));
      return cloneRecord(draft);
    },
  });
}

function mapPlanStatus(plan) {
  if (plan.status === 'COMPLETE') return 'COMPLETE';
  if (plan.status === 'FAILED' || plan.terminal?.status === 'FAILED'
    || plan.current?.outcome?.status === 'FINALIZED_FAILURE') return 'FAILED';
  if (plan.current?.outcome?.status === 'OUTCOME_UNKNOWN') return 'OUTCOME_UNKNOWN';
  if (plan.current?.outcome?.status === 'READY') return 'READY';
  return 'ACTIVE';
}

function assertPublicationPlan(plan, expectedAttemptId = null) {
  if (!plain(plan)) fail('PUBLICATION', 'MAKER_V8_PACK_PUBLICATION_RESULT_INVALID', 'Publication boundary returned no durable plan.');
  exactText(plan.attemptId, 'publication plan attemptId', 256);
  if (expectedAttemptId !== null && plan.attemptId !== expectedAttemptId) {
    fail('PUBLICATION', 'MAKER_V8_PACK_PUBLICATION_ATTEMPT_DRIFT', 'Query-first recovery returned a different publication attempt.');
  }
  exactRevision(plan.revision, 'publication plan revision');
  if (!['ACTIVE', 'COMPLETE', 'FAILED'].includes(plan.status)) {
    fail('PUBLICATION', 'MAKER_V8_PACK_PUBLICATION_RESULT_INVALID', 'Publication plan status is unsupported.');
  }
  return plan;
}

function assertPreparedPublicationPlan(plan) {
  assertPublicationPlan(plan);
  if (plan.status !== 'ACTIVE'
    || plan.revision !== 1
    || plan.current?.outcome?.status !== 'READY'
    || plan.terminal !== null) {
    fail('PUBLICATION', 'MAKER_V8_PACK_PUBLICATION_PREPARE_RESULT_INVALID', 'Pack publication preparation must return only a durable ACTIVE revision-1 READY WAL cursor.');
  }
  return plan;
}

function lifecycleTransitionAllowed(action, lifecycle) {
  if (action === 'PAUSE') return lifecycle === 'ACTIVE';
  if (action === 'RESUME') return lifecycle === 'PAUSED';
  if (action === 'ARCHIVE') return lifecycle === 'ACTIVE' || lifecycle === 'PAUSED';
  return ['TRANSFER_CONTROL', 'REVOKE_ADMISSION', 'WITHDRAW_PACK_REVENUE'].includes(action)
    && CHAIN_LIFECYCLES.has(lifecycle);
}

function lifecycleAfter(action, current) {
  if (action === 'PAUSE') return 'PAUSED';
  if (action === 'RESUME') return 'ACTIVE';
  if (action === 'ARCHIVE') return 'ARCHIVED';
  return current;
}

export function createMakerV8PackControllerV8({
  persistence,
  compiler,
  publication,
  lifecycle = null,
  execution = { allowWalletSignature: false, allowBroadcast: false },
  now = () => Date.now(),
  validateLocalParent = null,
  validateAuthoring = null,
  resolvePublishedParent = null,
} = {}) {
  for (const method of ['create', 'load', 'compareAndSwap']) requireMethod(persistence, method, 'persistence');
  requireMethod(compiler, 'compilePack', 'compiler');
  if (!plain(compiler.authority)) {
    fail('DEPENDENCY', 'MAKER_V8_PACK_COMPILER_AUTHORITY_INVALID', 'Pack compiler must expose one in-process authority token.', undefined, false);
  }
  for (const method of [
    'prepare', 'resume', 'requestSignature', 'recoverOutcome', 'replayExact',
  ]) requireMethod(publication, method, 'publication');
  if (publication.schemaVersion !== MAKER_V8_PACK_PUBLICATION_CONTROLLER_SCHEMA) {
    fail('DEPENDENCY', 'MAKER_V8_PACK_PUBLICATION_BOUNDARY_INVALID', 'Pack publication requires its dedicated Runtime-v8 Pack WAL/query-first controller, never the Maker publication topology.', undefined, false);
  }
  if (lifecycle !== null) {
    if (lifecycle.schemaVersion !== MAKER_V8_PACK_LIFECYCLE_CONTROLLER_SCHEMA) {
      fail('DEPENDENCY', 'MAKER_V8_PACK_LIFECYCLE_BOUNDARY_INVALID', 'Pack lifecycle requires its independent exact v8 controller, never the Maker Root lifecycle controller.', undefined, false);
    }
    for (const method of ['build', 'prepare', 'recover']) requireMethod(lifecycle, method, 'lifecycle');
    if (!plain(lifecycle.execution)
      || lifecycle.execution.allowWalletSignature !== execution.allowWalletSignature
      || lifecycle.execution.allowBroadcast !== execution.allowBroadcast) {
      fail('DEPENDENCY', 'MAKER_V8_PACK_LIFECYCLE_GATE_MISMATCH', 'Pack lifecycle and Pack Studio must share the same exact execution gates.', undefined, false);
    }
  }
  if (typeof now !== 'function') fail('DEPENDENCY', 'MAKER_V8_PACK_CLOCK_INVALID', 'Pack clock is required.', undefined, false);
  const gates = executionGates(execution);
  const listeners = new Set();
  const compiledProofs = new WeakSet();

  const clock = (minimum = 0) => {
    const value = Number(now());
    if (!Number.isSafeInteger(value) || value < minimum) {
      fail('ENVIRONMENT', 'MAKER_V8_PACK_CLOCK_INVALID', 'Pack clock must be monotonic and non-negative.', { minimum, actual: value });
    }
    return value;
  };

  const publish = (reason, draft, error = null) => {
    const event = freeze({
      schemaVersion: MAKER_V8_PACK_CONTROLLER_SCHEMA,
      reason,
      draft: draft ? snapshot(draft) : null,
      error: error ? makerV8PackErrorViewV8(error) : null,
    });
    for (const listener of listeners) {
      try { listener(event); } catch { /* Product observers never control persistence. */ }
    }
  };

  const checkAuthoring = async document => {
    if (document.authoring === undefined) return;
    if (typeof validateAuthoring !== 'function') fail('DEPENDENCY', 'MAKER_V8_PACK_AUTHORING_VALIDATOR_REQUIRED', 'Pack authoring validation is required.');
    await validateAuthoring(document);
  };
  const loadRequired = async (draftId, mode = 'DRAFT') => {
    const value = await persistence.load(exactDraftId(draftId));
    if (!value) fail('PERSISTENCE', 'MAKER_V8_PACK_DRAFT_NOT_FOUND', `Pack draft ${draftId} was not found.`);
    const draft = cloneRecord(value, mode);
    if (draft.document.bindings.kind === 'LOCAL_DRAFT' || draft.document.authoringParent !== undefined) {
      if (typeof validateLocalParent !== 'function') fail('DEPENDENCY', 'MAKER_V8_PACK_PARENT_VALIDATOR_REQUIRED', 'Local parent snapshot validation is required.');
      await validateLocalParent(draft.document.authoringParent ?? draft.document.bindings.parent);
    }
    await checkAuthoring(draft.document);
    return draft;
  };

  const casAndReread = async (current, next, reason) => {
    const rawWritten = await persistence.compareAndSwap({
      draftId: current.draftId,
      expectedRevision: current.revision,
      next,
    });
    const written = cloneRecord(rawWritten);
    if (canonicalMakerV8PackJson(written) !== canonicalMakerV8PackJson(next)) {
      fail('PERSISTENCE', 'MAKER_V8_PACK_CAS_WRITE_DRIFT', 'Pack CAS returned a record different from its exact successor.');
    }
    const reread = await loadRequired(current.draftId);
    if (canonicalMakerV8PackJson(reread) !== canonicalMakerV8PackJson(written)) {
      fail('PERSISTENCE', 'MAKER_V8_PACK_DURABLE_REREAD_FAILED', 'Pack CAS was not observed by an exact cold reread.');
    }
    publish(reason, reread);
    return reread;
  };

  const requireExpectedRevision = (draft, expectedRevision) => {
    exactRevision(expectedRevision, 'expectedRevision');
    if (draft.revision !== expectedRevision) {
      fail('PERSISTENCE', 'MAKER_V8_PACK_DRAFT_CAS_MISMATCH', 'Pack draft changed before this action.', {
        expectedRevision,
        actualRevision: draft.revision,
      });
    }
  };

  const requireDurablePublication = () => {
    if (persistence.capabilities?.durable !== true || persistence.capabilities?.atomicCas !== true) {
      fail('PERSISTENCE', 'MAKER_V8_PACK_DURABLE_STORAGE_REQUIRED', 'Pack publication requires durable atomic-CAS draft storage.', undefined, false);
    }
  };

  const compile = async (draft, context) => {
    const compileDraft = cloneRecord(draft, 'COMPILE');
    const documentSha256 = await sha256Canonical(compileDraft.document);
    let result;
    try {
      result = await compiler.compilePack({
        draft: snapshot(compileDraft),
        document: snapshot(compileDraft.document),
        documentSha256,
        context: cloneData(context ?? null),
      });
    } catch (cause) {
      fail('COMPILER', 'MAKER_V8_PACK_COMPILATION_FAILED', 'Pack compiler rejected this exact draft.', {
        causeCode: typeof cause?.code === 'string' ? cause.code : null,
        causeMessage: typeof cause?.message === 'string' ? cause.message : null,
      });
    }
    exactKeys(result, ['schemaVersion', 'authority', 'documentSha256', 'publicationInput'], 'compiler result', 'COMPILER');
    if (result.schemaVersion !== MAKER_V8_PACK_COMPILER_RESULT_SCHEMA
      || result.authority !== compiler.authority
      || result.documentSha256 !== documentSha256
      || !plain(result.publicationInput)) {
      fail('COMPILER', 'MAKER_V8_PACK_COMPILER_RESULT_INVALID', 'Pack compiler authority, document hash, or publication input drifted.');
    }
    canonicalMakerV8PackJson(result.publicationInput);
    compiledProofs.add(result);
    return { result, documentSha256 };
  };

  const certifyCompletedPublication = async (draft, plan) => {
    if (typeof compiler.certifyPackPublication !== 'function') {
      fail('COMPILER', 'MAKER_V8_PACK_BLOCKED_COMPILER', 'Pack publication finalized, but no exact Pack readback compiler is connected. Chain state remains unclaimed.', {
        attemptId: plan.attemptId,
      }, false);
    }
    const documentSha256 = await sha256Canonical(draft.document);
    let certified;
    try {
      certified = await compiler.certifyPackPublication({
        draft: snapshot(draft),
        plan: cloneData(plan),
        documentSha256,
      });
    } catch (cause) {
      if (cause instanceof MakerV8PackControllerError) throw cause;
      fail('COMPILER', 'MAKER_V8_PACK_PUBLICATION_CERTIFICATION_FAILED', 'Finalized Pack publication readback could not be certified.', {
        attemptId: plan.attemptId,
        causeCode: typeof cause?.code === 'string' ? cause.code : null,
        causeMessage: typeof cause?.message === 'string' ? cause.message : null,
      });
    }
    exactKeys(certified, [
      'schemaVersion', 'authority', 'attemptId', 'documentSha256', 'readback',
    ], 'Pack publication certification', 'COMPILER');
    if (certified.schemaVersion !== MAKER_V8_PACK_PUBLICATION_CERTIFICATION_SCHEMA
      || certified.authority !== compiler.authority
      || certified.attemptId !== plan.attemptId
      || certified.documentSha256 !== documentSha256) {
      fail('COMPILER', 'MAKER_V8_PACK_PUBLICATION_CERTIFICATION_INVALID', 'Pack publication certification drifted from its compiler, attempt, or exact draft.');
    }
    return assertChainReadback(certified.readback, draft.document, {
      expectedLifecycle: 'ACTIVE',
      requireInitialAdmissionRevision: true,
    });
  };

  const linkPublicationPlan = async (current, plan, reason) => {
    assertPublicationPlan(plan, current.publication.attemptId);
    const at = clock(current.updatedAt);
    const status = mapPlanStatus(plan);
    const chain = status === 'COMPLETE'
      ? await certifyCompletedPublication(current, plan)
      : null;
    const next = cloneRecord({
      ...snapshot(current),
      revision: current.revision + 1,
      updatedAt: at,
      publication: {
        attemptId: plan.attemptId,
        status,
        chain,
        updatedAt: at,
        lastError: status === 'FAILED' ? makerV8PackErrorViewV8(new MakerV8PackControllerError(
          'PUBLICATION',
          'MAKER_V8_PACK_PUBLICATION_FINALIZED_FAILURE',
          'Pack publication finalized with failure.',
        )) : null,
      },
    });
    const draft = await casAndReread(current, next, reason);
    return freeze({ draft, plan: cloneData(plan), execution: gates });
  };

  return Object.freeze({
    schemaVersion: MAKER_V8_PACK_CONTROLLER_SCHEMA,
    execution: gates,

    subscribe(listener) {
      if (typeof listener !== 'function') fail('SCHEMA', 'MAKER_V8_PACK_LISTENER_INVALID', 'Pack listener must be a function.');
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async createPackDraft({ draftId, document, createdAt = clock() } = {}) {
      const at = exactTime(createdAt, 'createdAt');
      const draft = cloneRecord({
        schemaVersion: MAKER_V8_PACK_DRAFT_SCHEMA,
        draftId: exactDraftId(draftId),
        revision: 1,
        createdAt: at,
        updatedAt: at,
        document: assertMakerV8PackDocumentV8(document, { mode: 'DRAFT' }),
        publication: initialPublication(),
      });
      if (draft.document.bindings.kind === 'LOCAL_DRAFT' || draft.document.authoringParent !== undefined) {
        if (typeof validateLocalParent !== 'function') fail('DEPENDENCY', 'MAKER_V8_PACK_PARENT_VALIDATOR_REQUIRED', 'Local parent snapshot validation is required.');
        await validateLocalParent(draft.document.authoringParent ?? draft.document.bindings.parent);
      }
      await checkAuthoring(draft.document);
      await persistence.create(draft);
      const reread = await loadRequired(draft.draftId);
      if (canonicalMakerV8PackJson(reread) !== canonicalMakerV8PackJson(draft)) {
        fail('PERSISTENCE', 'MAKER_V8_PACK_DURABLE_REREAD_FAILED', 'Created Pack draft failed its cold reread.');
      }
      publish('CREATED', reread);
      return reread;
    },

    load: (draftId) => loadRequired(draftId),

    async bindPublishedParent({ draftId, expectedRevision, rootId } = {}) {
      const current = await loadRequired(draftId);
      requireExpectedRevision(current, expectedRevision);
      if (current.publication.status !== 'UNPREPARED' || current.document.bindings.kind !== 'LOCAL_DRAFT') {
        fail('BINDING', 'MAKER_V8_PACK_REBIND_INVALID', 'Only an unprepared local-parent Pack can bind once.');
      }
      if (typeof resolvePublishedParent !== 'function') fail('DEPENDENCY', 'MAKER_V8_PACK_PARENT_RESOLVER_REQUIRED', 'Certified parent resolver is required.');
      const resolved = await resolvePublishedParent({ rootId: exactId(rootId, 'rootId'), document: snapshot(current.document) });
      const document = assertMakerV8PackDocumentV8({ ...snapshot(current.document),
        bindings: resolved.bindings, authoring: resolved.authoring,
        authoringParent: snapshot(current.document.bindings.parent),
        admission: { ...current.document.admission, expectedPackRegistryRevision: resolved.bindings.packRegistry.revision },
      });
      await checkAuthoring(document);
      return casAndReread(current, cloneRecord({ ...snapshot(current), document,
        revision: current.revision + 1, updatedAt: clock(current.updatedAt) }), 'PARENT_BOUND');
    },

    async save({ draftId, expectedRevision, document, updatedAt } = {}) {
      const current = await loadRequired(draftId);
      requireExpectedRevision(current, expectedRevision);
      if (current.publication.status !== 'UNPREPARED') {
        fail('PUBLICATION', 'MAKER_V8_PACK_DRAFT_LOCKED', 'A Pack with a durable publication attempt cannot be edited silently.');
      }
      const checkedDocument = assertMakerV8PackDocumentV8(document, { mode: 'DRAFT' });
      if (canonicalMakerV8PackJson(checkedDocument.authoringParent ?? null)
        !== canonicalMakerV8PackJson(current.document.authoringParent ?? null)) {
        fail('BINDING', 'MAKER_V8_PACK_PARENT_IMMUTABLE', 'Saving cannot replace the retained parent snapshot.');
      }
      await checkAuthoring(checkedDocument);
      const previousBinding = current.document.bindings;
      const nextBinding = checkedDocument.bindings;
      const localParent = previousBinding.kind === 'LOCAL_DRAFT' || nextBinding.kind === 'LOCAL_DRAFT';
      const previousParent = previousBinding.root;
      const nextParent = nextBinding.root;
      // Object refs can refresh; the authored parent release cannot change as
      // a side effect of an ordinary child-project edit.
      if (localParent ? canonicalMakerV8PackJson(previousBinding) !== canonicalMakerV8PackJson(nextBinding)
        : previousParent.objectRef.objectId !== nextParent.objectRef.objectId
        || previousParent.makerVersion !== nextParent.makerVersion
        || previousParent.contentCommitment !== nextParent.contentCommitment) {
        fail('BINDING', 'MAKER_V8_PACK_PARENT_IMMUTABLE',
          'Saving a Pack cannot change its parent Maker or authored release.');
      }
      const at = exactTime(updatedAt ?? clock(current.updatedAt), 'updatedAt');
      if (at < current.updatedAt) fail('SCHEMA', 'MAKER_V8_PACK_TIME_INVALID', 'Pack updatedAt moved backwards.');
      const next = cloneRecord({
        ...snapshot(current),
        revision: current.revision + 1,
        updatedAt: at,
        document: checkedDocument,
      });
      return casAndReread(current, next, 'SAVED');
    },

    async preview(input) {
      const draft = typeof input === 'string' ? await loadRequired(input) : cloneRecord(input);
      const styles = draft.document.styles.map((style) => freeze({
        sequence: style.sequence,
        partKey: style.partKey,
        itemKey: style.itemKey,
        styleKey: style.styleKey,
        assetId: style.asset.assetId,
        availability: style.asset.protected ? 'PROTECTED_LOCKED' : 'LOCAL_READY',
        previewBlobId: style.asset.protected ? null : style.asset.blobId,
      }));
      return freeze({
        schemaVersion: MAKER_V8_PACK_PREVIEW_SCHEMA,
        draftId: draft.draftId,
        revision: draft.revision,
        status: 'LOCAL_DRAFT',
        semanticPackId: draft.document.metadata.semanticPackId,
        name: draft.document.metadata.name,
        summary: draft.document.metadata.summary,
        author: snapshot(draft.document.author),
        admission: snapshot(draft.document.admission),
        access: snapshot(draft.document.access),
        completion: snapshot(draft.document.completion),
        styleCount: styles.length,
        protectedStyleCount: styles.filter((style) => style.availability === 'PROTECTED_LOCKED').length,
        rootId: draft.document.bindings.root?.objectRef.objectId ?? null,
        packRegistryId: draft.document.bindings.packRegistry?.objectRef.objectId ?? null,
        styles,
      });
    },

    async export(draftId) {
      const draft = await loadRequired(draftId);
      return freeze({
        schemaVersion: MAKER_V8_PACK_EXPORT_SCHEMA,
        disposition: 'LOCAL_DRAFT_ONLY',
        draft,
        draftSha256: await sha256Canonical(draft),
      });
    },

    validate(value, options = {}) {
      return collectMakerV8PackDraftIssuesV8(value, options);
    },

    async preparePublication({ draftId, expectedRevision, context = null } = {}) {
      requireDurablePublication();
      const current = await loadRequired(draftId, 'COMPILE');
      requireExpectedRevision(current, expectedRevision);
      if (current.publication.status !== 'UNPREPARED') {
        fail('PUBLICATION', 'MAKER_V8_PACK_PUBLICATION_EXISTS', 'This Pack already has a durable publication attempt.', {
          attemptId: current.publication.attemptId,
        });
      }
      const { result, documentSha256 } = await compile(current, context);
      if (!compiledProofs.has(result)) {
        fail('COMPILER', 'MAKER_V8_PACK_COMPILER_PROOF_REQUIRED', 'Publication requires the fresh in-process Pack compiler result.');
      }
      let plan;
      try {
        plan = await publication.prepare({
          schemaVersion: MAKER_V8_PACK_PUBLICATION_REQUEST_SCHEMA,
          kind: 'PACK',
          draftId: current.draftId,
          draftRevision: current.revision,
          documentSha256,
          publicationInput: snapshot(result.publicationInput),
        });
      } catch (cause) {
        if (cause instanceof MakerV8PackControllerError) throw cause;
        fail('PUBLICATION', 'MAKER_V8_PACK_PUBLICATION_PREPARE_FAILED', 'Pack publication could not create its durable WAL plan.', {
          causeCode: typeof cause?.code === 'string' ? cause.code : null,
          causeMessage: typeof cause?.message === 'string' ? cause.message : null,
        });
      }
      assertPreparedPublicationPlan(plan);
      const at = clock(current.updatedAt);
      const status = mapPlanStatus(plan);
      const next = cloneRecord({
        ...snapshot(current),
        revision: current.revision + 1,
        updatedAt: at,
        publication: {
          attemptId: plan.attemptId,
          status,
          chain: null,
          updatedAt: at,
          lastError: null,
        },
      });
      try {
        const draft = await casAndReread(current, next, 'PUBLICATION_PREPARED');
        return freeze({ draft, plan: cloneData(plan), execution: gates });
      } catch (cause) {
        fail('PERSISTENCE', 'MAKER_V8_PACK_PUBLICATION_LINK_FAILED', `The publication WAL exists but the Pack draft link failed. Resume attempt ${plan.attemptId}.`, {
          attemptId: plan.attemptId,
          causeCode: typeof cause?.code === 'string' ? cause.code : null,
        });
      }
    },

    async resumePublication({ draftId, attemptId = null, expectedRevision = null } = {}) {
      requireDurablePublication();
      const current = await loadRequired(draftId);
      if (expectedRevision !== null) requireExpectedRevision(current, expectedRevision);
      const durableAttemptId = current.publication.attemptId;
      const selectedAttemptId = attemptId ?? durableAttemptId;
      if (selectedAttemptId === null) {
        fail('PUBLICATION', 'MAKER_V8_PACK_PUBLICATION_ATTEMPT_REQUIRED', 'Pack publication recovery requires a durable attemptId.');
      }
      exactText(selectedAttemptId, 'attemptId', 256);
      if (durableAttemptId !== null && durableAttemptId !== selectedAttemptId) {
        fail('PUBLICATION', 'MAKER_V8_PACK_PUBLICATION_ATTEMPT_DRIFT', 'Pack draft and recovery attemptId differ.');
      }
      let plan;
      try {
        // The injected publication controller performs its exact-digest query
        // before any fresh authority read or exact-byte replay.
        plan = await publication.resume(selectedAttemptId);
      } catch (cause) {
        fail('RECOVERY', 'MAKER_V8_PACK_PUBLICATION_RESUME_FAILED', 'Query-first Pack publication recovery failed visibly.', {
          attemptId: selectedAttemptId,
          causeCode: typeof cause?.code === 'string' ? cause.code : null,
          causeMessage: typeof cause?.message === 'string' ? cause.message : null,
        });
      }
      assertPublicationPlan(plan, selectedAttemptId);
      return linkPublicationPlan(current, plan, `PUBLICATION_${mapPlanStatus(plan)}`);
    },

    async requestPublicationSignature({ draftId, expectedRevision = null } = {}) {
      requireDurablePublication();
      if (!gates.allowWalletSignature || !gates.allowBroadcast) {
        fail('CONFIG', 'MAKER_V8_PACK_EXECUTION_DISABLED', 'Pack publication signing and exact-byte broadcast are disabled.', undefined, false);
      }
      const current = await loadRequired(draftId);
      if (expectedRevision !== null) requireExpectedRevision(current, expectedRevision);
      if (current.publication.attemptId === null || current.publication.status !== 'READY') {
        fail('PUBLICATION', 'MAKER_V8_PACK_PUBLICATION_NOT_READY', 'Only one exact durable READY Pack cursor may request a wallet signature.');
      }
      let plan;
      try {
        plan = await publication.requestSignature(current.publication.attemptId);
      } catch (cause) {
        fail('PUBLICATION', 'MAKER_V8_PACK_PUBLICATION_SIGNATURE_FAILED', 'Pack publication signature request failed visibly.', {
          attemptId: current.publication.attemptId,
          causeCode: typeof cause?.code === 'string' ? cause.code : null,
          causeMessage: typeof cause?.message === 'string' ? cause.message : null,
        });
      }
      return linkPublicationPlan(current, plan, `PUBLICATION_${mapPlanStatus(plan)}`);
    },

    async recoverPublicationOutcome({ draftId, expectedRevision = null } = {}) {
      requireDurablePublication();
      const current = await loadRequired(draftId);
      if (expectedRevision !== null) requireExpectedRevision(current, expectedRevision);
      if (current.publication.attemptId === null) {
        fail('PUBLICATION', 'MAKER_V8_PACK_PUBLICATION_ATTEMPT_REQUIRED', 'Pack outcome recovery requires one durable attempt.');
      }
      let plan;
      try {
        plan = await publication.recoverOutcome(current.publication.attemptId);
      } catch (cause) {
        fail('RECOVERY', 'MAKER_V8_PACK_PUBLICATION_RESUME_FAILED', 'Query-first Pack publication recovery failed visibly.', {
          attemptId: current.publication.attemptId,
          causeCode: typeof cause?.code === 'string' ? cause.code : null,
          causeMessage: typeof cause?.message === 'string' ? cause.message : null,
        });
      }
      return linkPublicationPlan(current, plan, `PUBLICATION_${mapPlanStatus(plan)}`);
    },

    async replayPackPublication({ draftId, expectedRevision = null } = {}) {
      requireDurablePublication();
      if (!gates.allowWalletSignature || !gates.allowBroadcast) {
        fail('CONFIG', 'MAKER_V8_PACK_EXECUTION_DISABLED', 'Pack exact-byte replay is disabled.', undefined, false);
      }
      const current = await loadRequired(draftId);
      if (expectedRevision !== null) requireExpectedRevision(current, expectedRevision);
      if (current.publication.attemptId === null) {
        fail('PUBLICATION', 'MAKER_V8_PACK_PUBLICATION_ATTEMPT_REQUIRED', 'Pack replay requires one durable signed attempt.');
      }
      let plan;
      try {
        // The dedicated controller must query the existing digest before it
        // may replay the exact same durable bytes.
        plan = await publication.replayExact(current.publication.attemptId);
      } catch (cause) {
        fail('RECOVERY', 'MAKER_V8_PACK_PUBLICATION_REPLAY_FAILED', 'Exact-byte Pack replay failed visibly.', {
          attemptId: current.publication.attemptId,
          causeCode: typeof cause?.code === 'string' ? cause.code : null,
          causeMessage: typeof cause?.message === 'string' ? cause.message : null,
        });
      }
      return linkPublicationPlan(current, plan, `PUBLICATION_${mapPlanStatus(plan)}`);
    },

    async performLifecycle({
      draftId,
      expectedRevision = null,
      action,
      stage = 'PREPARE',
      request = {},
      ticket = null,
    } = {}) {
      if (lifecycle === null) {
        fail('COMPILER', 'MAKER_V8_PACK_BLOCKED_COMPILER', 'Independent Pack lifecycle compilation and certified readback are not connected.', undefined, false);
      }
      if (!gates.allowWalletSignature || !gates.allowBroadcast) {
        fail('CONFIG', 'MAKER_V8_PACK_EXECUTION_DISABLED', 'Pack lifecycle signing and exact-byte recovery are disabled.', undefined, false);
      }
      if (!MAKER_V8_PACK_LIFECYCLE_ACTIONS.includes(action)) {
        fail('LIFECYCLE', 'MAKER_V8_PACK_LIFECYCLE_ACTION_INVALID', 'Pack lifecycle action is invalid.');
      }
      if (!['PREPARE', 'RECOVER'].includes(stage)) {
        fail('LIFECYCLE', 'MAKER_V8_PACK_LIFECYCLE_STAGE_INVALID', 'Pack lifecycle stage must be PREPARE or RECOVER.');
      }
      const current = await loadRequired(draftId);
      if (expectedRevision !== null) requireExpectedRevision(current, expectedRevision);
      if (current.publication.status !== 'COMPLETE' || current.publication.chain === null) {
        fail('LIFECYCLE', 'MAKER_V8_PACK_LIFECYCLE_PUBLICATION_REQUIRED', 'Pack lifecycle actions require certified completed publication.');
      }
      if (!lifecycleTransitionAllowed(action, current.publication.chain.lifecycle)) {
        fail('LIFECYCLE', 'MAKER_V8_PACK_LIFECYCLE_TRANSITION_INVALID', `Cannot ${action} a ${current.publication.chain.lifecycle} Pack.`);
      }
      if (!plain(request)) fail('LIFECYCLE', 'MAKER_V8_PACK_LIFECYCLE_REQUEST_INVALID', 'Lifecycle request must be a plain record.');
      if (stage === 'PREPARE') {
        const built = await lifecycle.build({
          ...snapshot(request),
          action,
          draftRevision: current.revision,
          pack: {
            draftId: current.draftId,
            semanticPackId: current.document.metadata.semanticPackId,
            rootId: current.document.bindings.root.objectRef.objectId,
            packRegistryId: current.document.bindings.packRegistry.objectRef.objectId,
            bindings: snapshot(current.document.bindings),
            chain: snapshot(current.publication.chain),
          },
        });
        const prepared = await lifecycle.prepare(built);
        publish('LIFECYCLE_PREPARED', current);
        return Object.freeze({
          schemaVersion: MAKER_V8_PACK_CONTROLLER_SCHEMA,
          action,
          stage: 'PREPARED',
          draft: current,
          prepared,
        });
      }
      if (ticket === null) {
        fail('RECOVERY', 'MAKER_V8_PACK_LIFECYCLE_TICKET_REQUIRED', 'Lifecycle recovery requires the exact durable signed ticket.');
      }
      if (!plain(ticket)
        || ticket.schemaVersion !== MAKER_V8_PACK_LIFECYCLE_CONTROLLER_SCHEMA) {
        fail('RECOVERY', 'MAKER_V8_PACK_LIFECYCLE_TICKET_INVALID', 'Pack lifecycle recovery ticket is not from the exact independent Pack controller.');
      }
      exactText(ticket.recoveryId, 'lifecycle ticket recoveryId', 256);
      exactDigest(ticket.digest, 'lifecycle ticket digest');
      // Recovery remains delegated to the exact controller; this wrapper never
      // calls requestSignature(), execute(), or a broadcast adapter.
      const result = await lifecycle.recover(ticket);
      exactKeys(result, [
        'schemaVersion', 'status', 'recoveryId', 'digest', 'readback',
      ], 'Pack lifecycle recovery', 'RECOVERY');
      if (result.schemaVersion !== MAKER_V8_PACK_LIFECYCLE_CONTROLLER_SCHEMA
        || !['FINALIZED_SUCCESS', 'FINALIZED_FAILURE', 'OUTCOME_UNKNOWN'].includes(result.status)
        || result.recoveryId !== ticket.recoveryId
        || result.digest !== ticket.digest) {
        fail('RECOVERY', 'MAKER_V8_PACK_LIFECYCLE_RECOVERY_INVALID', 'Pack lifecycle recovery did not certify the exact signed transaction identity.');
      }
      if (result.status === 'OUTCOME_UNKNOWN') {
        if (result.readback !== null) {
          fail('RECOVERY', 'MAKER_V8_PACK_LIFECYCLE_RECOVERY_INVALID', 'Unknown Pack lifecycle outcome cannot claim finalized readback.');
        }
        publish('LIFECYCLE_OUTCOME_UNKNOWN', current);
        return Object.freeze({
          schemaVersion: MAKER_V8_PACK_CONTROLLER_SCHEMA,
          action,
          stage: 'OUTCOME_UNKNOWN',
          draft: current,
          result,
        });
      }
      if (result.status === 'FINALIZED_FAILURE') {
        if (result.readback !== null) {
          fail('RECOVERY', 'MAKER_V8_PACK_LIFECYCLE_RECOVERY_INVALID', 'Failed Pack lifecycle outcome cannot claim successful readback.');
        }
        publish('LIFECYCLE_FINALIZED_FAILURE', current);
        return Object.freeze({
          schemaVersion: MAKER_V8_PACK_CONTROLLER_SCHEMA,
          action,
          stage: 'FINALIZED_FAILURE',
          draft: current,
          result,
        });
      }
      const expectedLifecycle = lifecycleAfter(action, current.publication.chain.lifecycle);
      const chain = assertChainReadback(result.readback, current.document, {
        expectedLifecycle,
        expectedDigest: ticket.digest,
        minimumPackRegistryRevision: current.publication.chain.packRegistryRevision,
      });
      const priorChain = current.publication.chain;
      const transfer = action === 'TRANSFER_CONTROL';
      if (transfer) {
        if (chain.release.owner === priorChain.release.owner
          || BigInt(chain.release.controlEpoch) !== BigInt(priorChain.release.controlEpoch) + 1n) {
          fail('READBACK', 'MAKER_V8_PACK_LIFECYCLE_CONTROL_DRIFT', 'Pack control transfer did not certify one new owner and the next control epoch.');
        }
      } else if (chain.release.owner !== priorChain.release.owner
        || chain.release.controlEpoch !== priorChain.release.controlEpoch) {
        fail('READBACK', 'MAKER_V8_PACK_LIFECYCLE_CONTROL_DRIFT', 'Pack lifecycle action changed control authority unexpectedly.');
      }
      const expectedRegistryRevision = action === 'REVOKE_ADMISSION'
        ? (BigInt(priorChain.packRegistryRevision) + 1n).toString()
        : priorChain.packRegistryRevision;
      if (chain.packRegistryRevision !== expectedRegistryRevision) {
        fail('READBACK', 'MAKER_V8_PACK_LIFECYCLE_REVISION_DRIFT', 'Pack lifecycle action changed the registry revision outside its exact authority.');
      }
      for (const field of ['release', 'adminCap', 'treasury']) {
        if (chain[field].objectRef.objectId
          !== current.publication.chain[field].objectRef.objectId) {
          fail('READBACK', 'MAKER_V8_PACK_LIFECYCLE_IDENTITY_DRIFT', 'Pack lifecycle readback changed its release, admin cap, or treasury identity.');
        }
      }
      const at = clock(current.updatedAt);
      const next = cloneRecord({
        ...snapshot(current),
        revision: current.revision + 1,
        updatedAt: at,
        publication: {
          ...snapshot(current.publication),
          chain,
          updatedAt: at,
          lastError: null,
        },
      });
      const draft = await casAndReread(current, next, `LIFECYCLE_${action}_FINALIZED`);
      return Object.freeze({
        schemaVersion: MAKER_V8_PACK_CONTROLLER_SCHEMA,
        action,
        stage: 'FINALIZED_SUCCESS',
        draft,
        result,
      });
    },
  });
}
