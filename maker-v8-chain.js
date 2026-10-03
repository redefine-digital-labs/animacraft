import { sha256 } from '@noble/hashes/sha2.js';
import { blake2b } from '@noble/hashes/blake2.js';
import { bcs, TypeTagSerializer } from '@mysten/sui/bcs';
import { TransactionDataBuilder } from '@mysten/sui/transactions';
import { ObjectError } from '@mysten/sui/client';
import { assertMakerV8SealEncryptionProfile } from './maker-v8-seal-profile.js';
import { readMakerV8PackDefinitions } from './maker-v8-pack-definition-reader.js';
import { deriveMakerV8PackProfiles } from './maker-v8-profile-wire.js';
import { assertMakerV8CatalogCommitments } from './maker-v8-catalog-commitments.js';
import { assertMakerV8SealPolicyCommitments } from './maker-v8-seal-policy-commitments.js';
import {
  fromBase58, fromBase64, fromHex, normalizeStructTag, toBase58, toBase64, deriveDynamicFieldID,
} from '@mysten/sui/utils';

import {
  MAKER_V8_MAKER_BINDING_FIELDS,
  assertMakerV8Runtime,
  inspectMakerV8Runtime,
  makerV8StableType,
} from './maker-v8-runtime.js';

export const MAKER_V8_CHAIN_NETWORK = 'mainnet';
export const MAKER_V8_CHAIN_SCHEMA = 'animacraft.maker-v8-chain.v8';
export const MAKER_V8_MAINNET_CHAIN_IDENTIFIER = '35834a8a';
export const MAKER_V8_MAINNET_GENESIS_DIGEST = '4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S';
export const MAKER_V8_APPROVED_CORE_BASE_REGISTRY_MODULE_SHA256 = '14948901f5d3337e32492468d58e7fc945c271d37005788fcb05ab6f39ee07d2';
export const MAKER_V8_EVENT_DISCOVERY_PAGE_SIZE = 50;

export const MAKER_V8_LIFECYCLES = Object.freeze({
  0: 'DRAFT',
  1: 'ACTIVE',
  2: 'PAUSED',
  3: 'ARCHIVED',
});

export const MAKER_V8_CHAIN_ERROR_LAYERS = Object.freeze([
  'local',
  'config',
  'schema',
  'stale',
  'dry-run',
  'wallet',
  'signed-outcome',
  'finalized',
  'readback',
]);

const SUI_ID = /^0x[0-9a-fA-F]{64}$/;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/;
const DIGEST = /^[1-9A-HJ-NP-Za-km-z]{20,64}$/;
const HASH_HEX = /^(?:0x)?[0-9a-fA-F]{64}$/;
const RENDERABLE_MEDIA_TYPES = new Set([
  'image/avif', 'image/gif', 'image/jpeg', 'image/png', 'image/webp',
]);
const MAX_CERTIFIED_ASSET_BYTES = 12 * 1024 * 1024;
const VERIFIED_MAINNET_RPCS = new WeakSet();
const ATTESTED_MAKER_V8_RUNTIMES = new WeakSet();
const ATTESTED_MAKER_V8_PACKAGE_TUPLES = new WeakMap();
const ATTESTED_MAKER_V8_CORE_ARTIFACTS = new WeakMap();
const ATTESTED_MAKER_V8_REPLACEMENTS = new WeakMap();
const VERIFIED_NATIVE_SOUL_BINDINGS = new WeakMap();
const VERIFIED_NATIVE_INTEGRATIONS = new WeakMap();
const VERIFIED_NATIVE_COMPLETION_RECOVERIES = new WeakMap();
const AUTHORITY_ROLES = ['core', 'seal', 'runtime', 'output', 'physical', 'market', 'release'];
const A_HASH = bcs.vector(bcs.u8());
const A_HEADER = { domain: bcs.string(), schema_revision: bcs.u64() };
const A_BINDING = { original_package_id: bcs.Address, callable_package_id: bcs.Address,
  source_commitment: A_HASH, package_commitment: A_HASH, abi_commitment: A_HASH, commitment: A_HASH };
const A_ROLE_HASHES = Object.fromEntries(AUTHORITY_ROLES.map(role => [`${role}_binding_commitment`, A_HASH]));
const A_REPLACEMENT_INPUT = { ...A_ROLE_HASHES, package_tuple_commitment: A_HASH, call_cap_set_commitment: A_HASH,
  runtime_config_id: bcs.Address, output_config_id: bcs.Address, market_config_id: bcs.Address, release_config_id: bcs.Address };
const A_REPLACEMENT = { id: bcs.Address, version: bcs.u64(), catalog_id: bcs.Address,
  ...A_REPLACEMENT_INPUT, binding_commitment: A_HASH };
const A_CERTIFICATE = { id: bcs.Address, version: bcs.u64(), replacement_binding_id: bcs.Address,
  catalog_id: bcs.Address, package_tuple_commitment: A_HASH, call_cap_set_commitment: A_HASH,
  install_mask: bcs.u8(), install_mark_commitments: bcs.vector(A_HASH), certificate_commitment: A_HASH };
const A_CALLER = { schema_revision: bcs.u64(), role: bcs.u8(), catalog_id: bcs.Address,
  replacement_binding_id: bcs.Address, package_tuple_commitment: A_HASH,
  caller_original_package_id: bcs.Address, caller_callable_package_id: bcs.Address,
  call_cap_set_commitment: A_HASH, cap_commitment: A_HASH };
const A_SLOT = { state: bcs.u8(), replacement_binding_id: bcs.Address,
  admin_id: bcs.option(bcs.Address), certificate_id: bcs.option(bcs.Address), certificate_commitment: bcs.option(A_HASH) };

function authorityCheck(condition, label) {
  if (!condition) fail('readback', 'MAKER_V8_RUNTIME_AUTHORITY_MISMATCH', `${label} differs from certified Core authority.`);
}
function authorityHash(fields, value, domain) {
  return [...sha256(bcs.struct('AuthorityCommitment', { ...A_HEADER, ...fields }).serialize({
    domain, schema_revision: 2, ...value,
  }).toBytes())].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function authorityDecode(encoded, shape, label) {
  try {
    const bytes = fromBase64(encoded);
    const schema = bcs.struct(label, shape);
    const result = schema.parse(bytes);
    authorityCheck(toBase64(bytes) === encoded && toBase64(schema.serialize(result).toBytes()) === encoded, `${label} canonical BCS`);
    return result;
  } catch (error) {
    fail('readback', 'MAKER_V8_RUNTIME_AUTHORITY_BCS_INVALID', `${label} requires exact canonical BCS.`, { cause: error.code });
  }
}
function authorityDigest(value, expected, label) { authorityCheck(hash(value, label) === expected, label); }
// These are the vector<u8> fields in the exact authority layouts above and
// configShape below. Do not infer byte vectors from numeric/empty arrays.
const AUTHORITY_BYTE_FIELDS = new Set([
  'source_commitment', 'package_commitment', 'abi_commitment', 'commitment',
  'protocol_config_commitment', 'call_cap_set_commitment', 'catalog_commitment',
  'package_tuple_commitment', 'product_binding_commitment', 'binding_commitment',
  'certificate_commitment', 'cap_commitment', 'installation_commitment',
  'key_server_set_commitment', 'encryption_policy_commitment', 'config_commitment',
  ...AUTHORITY_ROLES.map(role => `${role}_binding_commitment`),
]);
const AUTHORITY_BYTE_VECTOR_FIELDS = new Set(['role_config_commitments', 'install_mark_commitments']);
function authorityJsonMatches(observed, decoded, label, byteVector = false, nestedBytes = false) {
  if (record(observed) && (Object.hasOwn(observed, 'vec') || Object.hasOwn(observed.fields || {}, 'vec'))) observed = moveOption(observed, label);
  if (decoded === null) { authorityCheck(observed === null, label); return; }
  if (Array.isArray(decoded)) {
    if (byteVector && typeof observed === 'string') {
      let bytes;
      try { bytes = fromBase64(observed); } catch { authorityCheck(false, `${label} Base64`); }
      authorityCheck(toBase64(bytes) === observed, `${label} canonical Base64`);
      observed = [...bytes];
    }
    authorityCheck(Array.isArray(observed) && observed.length === decoded.length, label);
    decoded.forEach((entry, index) => authorityJsonMatches(observed[index], entry, `${label}[${index}]`, nestedBytes));
  } else if (record(decoded)) {
    const fields = fieldsOf(observed, label);
    exactRecord(fields, Object.keys(decoded), label);
    authorityCheck(Object.keys(fields).length === Object.keys(decoded).length, label);
    Object.entries(decoded).forEach(([key, entry]) => authorityJsonMatches(fields[key], entry, `${label}.${key}`,
      AUTHORITY_BYTE_FIELDS.has(key), AUTHORITY_BYTE_VECTOR_FIELDS.has(key)));
  } else if (typeof decoded === 'string' && /^0x[0-9a-f]{64}$/i.test(decoded)) {
    authorityCheck(id(observed, label) === decoded.toLowerCase(), label);
  } else if (typeof decoded === 'boolean') {
    authorityCheck(observed === decoded, label);
  } else { authorityCheck(String(observed) === String(decoded), label); }
}
function authorityObject(response, runtime, datatype, shape, observedNetwork, owner) {
  const object = parsedObject(response, makerV8StableType(runtime, 'core', 'package_binding_v8', datatype), observedNetwork, datatype);
  authorityCheck(object.owner.kind === owner, `${datatype} owner`);
  authorityCheck(response.data.bcs?.dataType === 'moveObject' && typeEquals(response.data.bcs.type, object.type), `${datatype} BCS type`);
  const fields = authorityDecode(response.data.bcs?.bcsBytes, shape, datatype);
  authorityJsonMatches(object.fields, fields, datatype);
  authorityCheck(fields.id === object.objectId, `${datatype} UID`);
  return { object, fields };
}
const PACK_ADMISSION_RECORD_BCS = bcs.struct('PackAdmissionRecordV8', {
  release_id: bcs.Address,
  semantic_pack_id: bcs.string(),
  release_content_commitment: bcs.vector(bcs.u8()),
  admitted_revision: bcs.u64(),
  admission_state: bcs.u8(),
});
const PACK_TABLE_BCS = bcs.struct('PackTable', { id: bcs.Address, size: bcs.u64() });
// Exact current Runtime layouts. Discovery reads these public objects without
// requiring a Pass, and binds parsed projections to canonical Move bytes.
const PACK_REGISTRY_BCS = bcs.struct('PackRegistryV8', {
  id: bcs.Address, version: bcs.u64(), root_id: bcs.Address, root_version: bcs.u64(),
  root_content_commitment: A_HASH, definition_registry_id: bcs.Address,
  admission_authority_id: bcs.Address, admission_policy_commitment: A_HASH,
  revision: bcs.u64(), release_count: bcs.u64(), external_admission_count: bcs.u64(),
  wardrobe_revision: bcs.u64(), base_item_count: bcs.u64(), releases: PACK_TABLE_BCS,
  semantic_releases: PACK_TABLE_BCS, external_admissions: PACK_TABLE_BCS, base_item_owners: PACK_TABLE_BCS,
});
const PACK_RELEASE_BCS = bcs.struct('PackReleaseV8', {
  id: bcs.Address, version: bcs.u64(), root_id: bcs.Address, root_version: bcs.u64(),
  root_content_commitment: A_HASH, creator: bcs.Address, owner: bcs.Address,
  control_epoch: bcs.u64(), admin_cap_id: bcs.Address, treasury_id: bcs.Address,
  semantic_pack_id: bcs.string(), manifest_blob_id: bcs.string(), manifest_sha256: A_HASH,
  content_commitment: A_HASH, lifecycle: bcs.u8(), access_kind: bcs.u8(), access_price_atomic: bcs.u64(),
  complete_mode: bcs.u8(), complete_price_atomic: bcs.u64(), complete_free_quota_per_wallet: bcs.u64(),
  complete_total_cap: bcs.u64(), expected_style_count: bcs.u64(), observed_style_count: bcs.u64(),
  expected_style_commitment: A_HASH, rolling_style_commitment: A_HASH,
  protected_style_count: bcs.u64(), pass_count: bcs.u64(), total_complete_count: bcs.u64(),
  styles: PACK_TABLE_BCS, complete_by_wallet: PACK_TABLE_BCS,
});

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
}

function record(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function exactRecord(value, fields, label) {
  if (!record(value)) fail('schema', 'MAKER_V8_CHAIN_RECORD_INVALID', `${label} must be a plain record.`);
  const expected = new Set(fields);
  const unknown = Object.keys(value).filter((field) => !expected.has(field));
  if (unknown.length) fail('schema', 'MAKER_V8_CHAIN_FIELD_UNKNOWN', `${label} contains unknown fields: ${unknown.join(', ')}.`, { fields: unknown });
}

function fail(layer, code, message, details = {}) {
  throw new MakerV8ChainError(layer, code, message, details);
}

export class MakerV8ChainError extends Error {
  constructor(layer, code, message, details = {}) {
    super(message);
    this.name = 'MakerV8ChainError';
    this.layer = layer;
    this.code = code;
    this.details = freeze({ ...details });
  }
}

function id(value, label) {
  if (record(value) && typeof value.id === 'string') return id(value.id, label);
  if (record(value) && record(value.fields)) return id(value.fields, label);
  const normalized = String(value || '').toLowerCase();
  if (!SUI_ID.test(normalized) || /^0x0{64}$/.test(normalized)) {
    fail('schema', 'MAKER_V8_CHAIN_ID_INVALID', `${label} is not an exact non-zero Sui ID.`, { label });
  }
  return normalized;
}

function address(value, label) {
  return id(value, label);
}

function decimal(value, label, { positive = false } = {}) {
  const text = String(value ?? '');
  if (!DECIMAL.test(text) || (positive && text === '0')) {
    fail('schema', 'MAKER_V8_CHAIN_INTEGER_INVALID', `${label} must be a canonical${positive ? ' positive' : ''} integer.`, { label });
  }
  return BigInt(text);
}

function digest(value, label) {
  let bytes;
  try {
    if (typeof value !== 'string' || !DIGEST.test(value)) throw new Error('shape');
    bytes = fromBase58(value);
    if (bytes.length !== 32 || toBase58(bytes) !== value) throw new Error('canonical');
  } catch {
    fail('schema', 'MAKER_V8_CHAIN_DIGEST_INVALID', `${label} is not an exact Sui digest.`, { label });
  }
  return value;
}

function hash(value, label) {
  if (Array.isArray(value) && value.length === 32
    && value.every((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 255)) {
    return value.map((entry) => entry.toString(16).padStart(2, '0')).join('');
  }
  if (typeof value === 'string') {
    try {
      const bytes = fromBase64(value);
      if (bytes.length === 32 && toBase64(bytes) === value) {
        return [...bytes].map((entry) => entry.toString(16).padStart(2, '0')).join('');
      }
    } catch {
      // Continue to the canonical hex projection below.
    }
  }
  const text = String(value || '').replace(/^0x/i, '').toLowerCase();
  if (!HASH_HEX.test(text)) fail('schema', 'MAKER_V8_CHAIN_HASH_INVALID', `${label} must contain exactly 32 bytes.`, { label });
  return text;
}

function text(value, label) {
  if (typeof value !== 'string' || !value.length || new TextEncoder().encode(value).length > 1024) {
    fail('schema', 'MAKER_V8_CHAIN_TEXT_INVALID', `${label} is not valid bounded text.`, { label });
  }
  return value;
}

function network(value) {
  if (value !== MAKER_V8_CHAIN_NETWORK) {
    fail('config', 'MAKER_V8_NETWORK_MISMATCH', `Maker v8 chain access is pinned to ${MAKER_V8_CHAIN_NETWORK}.`, { observed: value });
  }
  return value;
}

export async function assertMakerV8MainnetRpc(rpc) {
  if (!rpc || typeof rpc !== 'object') fail('config', 'MAKER_V8_RPC_INVALID', 'A concrete Sui RPC client is required.');
  if (VERIFIED_MAINNET_RPCS.has(rpc)) return rpc;
  let response;
  if (typeof rpc.getChainIdentifier === 'function') response = await rpc.getChainIdentifier();
  else if (typeof rpc.core?.getChainIdentifier === 'function') response = await rpc.core.getChainIdentifier();
  else fail('config', 'MAKER_V8_RPC_CHAIN_ID_UNAVAILABLE', 'RPC must expose an authoritative chain identifier.');
  const observed = typeof response === 'string' ? response : response?.chainIdentifier;
  if (![MAKER_V8_MAINNET_CHAIN_IDENTIFIER, MAKER_V8_MAINNET_GENESIS_DIGEST].includes(observed)) {
    fail('config', 'MAKER_V8_RPC_CHAIN_ID_MISMATCH', 'RPC is not the pinned Sui Mainnet chain.', { observed });
  }
  VERIFIED_MAINNET_RPCS.add(rpc);
  return rpc;
}

function fieldsOf(value, label) {
  if (record(value?.fields)) return value.fields;
  if (record(value)) return value;
  fail('schema', 'MAKER_V8_CHAIN_FIELDS_INVALID', `${label} has no Move fields.`);
}

function moveOption(value, label) {
  if (value === null) return null;
  if (Array.isArray(value)) {
    fail('schema', 'MAKER_V8_CHAIN_OPTION_INVALID', `${label} uses a retired JSON-RPC Move Option projection.`);
  }
  return record(value) ? fieldsOf(value, label) : value;
}

function typeEquals(observed, expected) {
  return String(observed || '').replace(/\s+/g, '') === String(expected).replace(/\s+/g, '');
}

function assertType(observed, expected, label) {
  if (!typeEquals(observed, expected)) {
    fail('schema', 'UNSUPPORTED_LEGACY_PRODUCT', `${label} is not the exact fresh-v8 stable TypeOrigin.`, { expected, observed });
  }
}

function ownerOf(value) {
  if (typeof value === 'string') return freeze({ kind: 'address', address: address(value, 'owner') });
  if (!record(value)) fail('schema', 'MAKER_V8_CHAIN_OWNER_INVALID', 'Sui object owner is invalid.');
  if (typeof value.AddressOwner === 'string') return freeze({ kind: 'address', address: address(value.AddressOwner, 'owner.AddressOwner') });
  if (typeof value.ObjectOwner === 'string') return freeze({ kind: 'object', objectId: id(value.ObjectOwner, 'owner.ObjectOwner') });
  if (record(value.Shared)) return freeze({
    kind: 'shared',
    initialSharedVersion: decimal(value.Shared.initial_shared_version ?? value.Shared.initialSharedVersion, 'owner.Shared.initialSharedVersion', { positive: true }),
  });
  if (Object.hasOwn(value, 'Immutable')) return freeze({ kind: 'immutable' });
  fail('schema', 'MAKER_V8_CHAIN_OWNER_INVALID', 'Sui object owner has an unsupported shape.');
}

function parsedObject(response, expectedType, observedNetwork, label) {
  network(observedNetwork);
  if (!record(response) || response.error || !record(response.data)) {
    fail('readback', 'MAKER_V8_OBJECT_READ_FAILED', `${label} could not be read from the current RPC.`, { error: response?.error ?? null });
  }
  const data = response.data;
  assertType(data.type ?? data.content?.type, expectedType, label);
  if (!record(data.content) || data.content.dataType !== 'moveObject') {
    fail('schema', 'MAKER_V8_MOVE_OBJECT_REQUIRED', `${label} is not a parsed Move object.`);
  }
  const objectId = id(data.objectId, `${label}.objectId`);
  const version = decimal(data.version, `${label}.version`, { positive: true });
  const objectDigest = digest(data.digest, `${label}.digest`);
  const fields = fieldsOf(data.content.fields, `${label}.content.fields`);
  if (fields.id !== undefined && id(fields.id, `${label}.fields.id`) !== objectId) {
    fail('readback', 'MAKER_V8_OBJECT_ID_READBACK_MISMATCH', `${label} UID does not match its RPC object ID.`);
  }
  return freeze({
    schemaVersion: MAKER_V8_CHAIN_SCHEMA,
    network: observedNetwork,
    objectId,
    version,
    digest: objectDigest,
    type: String(data.type ?? data.content.type).replace(/\s+/g, ''),
    owner: ownerOf(data.owner),
    fields,
    objectRef: freeze({ objectId, version: version.toString(), digest: objectDigest }),
  });
}

export function makerV8ChainTypes(runtimeInput) {
  const runtime = assertMakerV8Runtime(runtimeInput);
  return freeze({
    activationEvent: makerV8StableType(runtime, 'release', 'release_v8', 'MakerV8Activated'),
    lifecycleEvent: makerV8StableType(runtime, 'release', 'release_v8', 'MakerV8LifecycleChanged'),
    root: `${makerV8StableType(runtime, 'core', 'maker_v8', 'MakerRootV8')}<${runtime.paymentCoinType}>`,
    adminCap: makerV8StableType(runtime, 'core', 'maker_v8', 'MakerAdminCapV8'),
    protocolConfig: makerV8StableType(runtime, 'core', 'protocol_config_v8', 'ProtocolConfigV8'),
    makerTreasury: `${makerV8StableType(runtime, 'core', 'treasury_v8', 'MakerTreasuryV8')}<${runtime.paymentCoinType}>`,
    productReleaseCatalog: makerV8StableType(runtime, 'core', 'package_binding_v8', 'ProductReleaseCatalogV8'),
    sealConfig: makerV8StableType(runtime, 'seal', 'seal_v8', 'SealPolicyConfigV8'),
    sealRegistry: `${makerV8StableType(runtime, 'seal', 'seal_v8', 'SealRegistryV8')}<${runtime.paymentCoinType}>`,
    runtimeConfig: makerV8StableType(runtime, 'runtime', 'runtime_binding_v8', 'RuntimePackageConfigV8'),
    outputConfig: makerV8StableType(runtime, 'output', 'output_v8', 'OutputPackageConfigV8'),
    physicalConfig: makerV8StableType(runtime, 'physical', 'physical_v8', 'PhysicalPackageConfigV8'),
    marketConfig: makerV8StableType(runtime, 'market', 'market_v8', 'MarketPackageConfigV8'),
    releaseConfig: makerV8StableType(runtime, 'release', 'release_v8', 'ReleasePackageConfigV8'),
    baseRegistry: makerV8StableType(runtime, 'core', 'base_registry_v8', 'BaseDefinitionRegistryV8'),
    runtimeDefinitions: makerV8StableType(runtime, 'runtime', 'runtime_v8', 'RuntimeDefinitionRegistryV8'),
    packRegistry: makerV8StableType(runtime, 'runtime', 'runtime_v8', 'PackRegistryV8'),
    packAdmissionAuthority: makerV8StableType(runtime, 'runtime', 'runtime_v8', 'PackAdmissionAuthorityV8'),
    physicalRegistry: makerV8StableType(runtime, 'physical', 'physical_v8', 'PhysicalRegistryV8'),
    marketRegistry: `${makerV8StableType(runtime, 'market', 'market_v8', 'MarketRegistryV8')}<${runtime.paymentCoinType}>`,
    marketTreasury: `${makerV8StableType(runtime, 'market', 'market_v8', 'MarketTreasuryV8')}<${runtime.paymentCoinType}>`,
    makerAccess: makerV8StableType(runtime, 'core', 'treasury_v8', 'MakerAccessPassV8'),
    packAdminCap: makerV8StableType(runtime, 'runtime', 'runtime_v8', 'PackAdminCapV8'),
    packRelease: `${makerV8StableType(runtime, 'runtime', 'runtime_v8', 'PackReleaseV8')}<${runtime.paymentCoinType}>`,
    packTreasury: `${makerV8StableType(runtime, 'runtime', 'runtime_v8', 'PackTreasuryV8')}<${runtime.paymentCoinType}>`,
    packPass: makerV8StableType(runtime, 'runtime', 'runtime_v8', 'PackPassV8'),
    externalItemAdminCap: makerV8StableType(runtime, 'runtime', 'runtime_v8', 'ExternalItemAdminCapV8'),
    externalItemProduct: makerV8StableType(runtime, 'runtime', 'runtime_v8', 'ExternalItemProductV8'),
    ownedExternalItem: makerV8StableType(runtime, 'runtime', 'runtime_v8', 'OwnedExternalItemV8'),
    ownedBaseItem: makerV8StableType(runtime, 'runtime', 'runtime_v8', 'OwnedBaseItemV8'),
    makerLoadout: makerV8StableType(runtime, 'runtime', 'runtime_v8', 'MakerLoadoutV8'),
    completeOutput: makerV8StableType(runtime, 'output', 'output_v8', 'CompleteOutputV8'),
    completeReceipt: makerV8StableType(runtime, 'output', 'output_v8', 'CompleteReceiptV8'),
    canonicalSoul: makerV8StableType(runtime, 'output', 'output_v8', 'CanonicalSoulV8'),
    physicalAsset: makerV8StableType(runtime, 'physical', 'physical_v8', 'PhysicalAssetV8'),
  });
}

const CATALOG_SHAPE = {
  id: bcs.Address, schema_revision: bcs.u64(), protocol_config_id: bcs.Address,
  protocol_config_revision: bcs.u64(), protocol_config_commitment: A_HASH,
  binding: bcs.struct('ProductReleaseBindingV8', { bindings: bcs.vector(bcs.struct('ExactPackageBindingV8', A_BINDING)), commitment: A_HASH }),
  authority_ids: bcs.vector(bcs.Address), call_cap_set_commitment: A_HASH, catalog_commitment: A_HASH,
  next_setup_role: bcs.u8(), role_config_ids: bcs.vector(bcs.Address), role_config_commitments: bcs.vector(A_HASH),
};

function parseCatalogWithRuntime(response, runtime, observedNetwork) {
  const { object, fields } = authorityObject(response, runtime, 'ProductReleaseCatalogV8', CATALOG_SHAPE, observedNetwork, 'shared');
  authorityCheck(object.objectId === runtime.catalogId && fields.schema_revision === '2'
    && fields.protocol_config_id === runtime.protocolConfigId, 'Catalog identity');
  authorityCheck(fields.binding.bindings.length === 7 && fields.authority_ids.length === 6
    && new Set(fields.authority_ids).size === 6 && fields.next_setup_role === 6
    && fields.role_config_ids.length === 6 && new Set(fields.role_config_ids).size === 6
    && fields.role_config_commitments.length === 6, 'Catalog setup completion');
  try { assertMakerV8CatalogCommitments(fields); }
  catch (error) {
    if (error?.code !== 'MAKER_V8_CATALOG_COMMITMENT_INVALID') throw error;
    authorityCheck(false, error.message);
  }
  const roles = {};
  for (const [index, role] of AUTHORITY_ROLES.entries()) {
    const row = fields.binding.bindings[index];
    authorityCheck(row.original_package_id === runtime.roles[role].typeOriginPackageId
      && row.callable_package_id === runtime.roles[role].callablePackageId, `Catalog ${role} TypeOrigin`);
    const { commitment } = row;
    roles[role] = { role, originalPackageId: row.original_package_id, callablePackageId: row.callable_package_id,
      sourceCommitment: hash(row.source_commitment, role), packageCommitment: hash(row.package_commitment, role),
      abiCommitment: hash(row.abi_commitment, role), commitment: hash(commitment, role) };
  }
  authorityCheck(new Set(Object.values(roles).map(row => row.originalPackageId)).size === 7
    && new Set(Object.values(roles).map(row => row.callablePackageId)).size === 7, 'Distinct package roles');
  const authorities = Object.fromEntries(AUTHORITY_ROLES.slice(1).map((role, index) => [role, fields.authority_ids[index]]));
  const configIds = Object.fromEntries(AUTHORITY_ROLES.slice(1).map((role, index) => [role, fields.role_config_ids[index]]));
  for (const role of AUTHORITY_ROLES.slice(1)) authorityCheck(configIds[role] === runtime.roleConfigIds[role], `${role} installed ID`);
  return freeze({ ...object, protocolConfigRevision: BigInt(fields.protocol_config_revision),
    protocolConfigCommitment: hash(fields.protocol_config_commitment, 'protocol commitment'),
    productBindingCommitment: hash(fields.binding.commitment, 'tuple'),
    callCapSetCommitment: hash(fields.call_cap_set_commitment, 'caps'), roles, authorities,
    configIds, configCommitments: fields.role_config_commitments.map(value => hash(value, 'installation')) });
}
function rawCatalogIdentity(config) {
  if (!record(config) || !record(config.roles) || !record(config.roles.core)) {
    fail('config', 'MAKER_V8_RUNTIME_CONFIG_INVALID', 'Runtime config cannot identify the Core ProductReleaseCatalog TypeOrigin.');
  }
  return {
    catalogId: id(config.catalogId, 'runtime.catalogId'),
    coreOriginalPackageId: id(config.roles.core.typeOriginPackageId, 'runtime.roles.core.typeOriginPackageId'),
  };
}

function companionConfigType(types, role) {
  return types[`${role}Config`];
}

function configShape(role) {
  const common = { id: bcs.Address, version: bcs.u64(), catalog_id: bcs.Address, product_binding_commitment: A_HASH };
  if (role !== 'seal') return { ...common,
    ...(['physical', 'market', 'release'].includes(role) ? { call_cap_set_commitment: A_HASH } : {}),
    installation_commitment: A_HASH,
    ...(['output', 'market'].includes(role) ? { runtime_caller_cap: bcs.option(bcs.struct('RuntimeCallerCapV1', A_CALLER)) } : {}) };
  return { id: bcs.Address, version: bcs.u64(), protocol_config_id: bcs.Address, protocol_config_revision: bcs.u64(),
    catalog_id: bcs.Address, product_binding_commitment: A_HASH, seal_original_package_id: bcs.Address,
    seal_callable_package_id: bcs.Address, seal_binding_commitment: A_HASH, seal_authority_id: bcs.Address,
    call_cap_set_commitment: A_HASH, role: bcs.u8(), finalized: bcs.bool(),
    key_servers: bcs.vector(bcs.struct('KeyServerRowV2', { key_server_id: bcs.Address, weight: bcs.u16() })),
    threshold: bcs.u16(), cipher_suite: bcs.string(), key_derivation: bcs.string(), ciphertext_format: bcs.string(),
    max_plaintext_bytes: bcs.u64(), key_server_set_commitment: A_HASH, encryption_policy_commitment: A_HASH,
    commitment: A_HASH, config_commitment: A_HASH };
}
function parseCompanionConfig(response, runtime, catalog, role, observedNetwork) {
  const object = parsedObject(response, companionConfigType(makerV8ChainTypes(runtime), role), observedNetwork, `${role}Config`);
  authorityCheck(response.data.bcs?.dataType === 'moveObject' && typeEquals(response.data.bcs.type, object.type), `${role} BCS type`);
  const fields = authorityDecode(response.data.bcs?.bcsBytes, configShape(role), `${role}Config`);
  authorityJsonMatches(object.fields, fields, `${role}Config`);
  authorityCheck(object.objectId === catalog.configIds[role] && fields.id === object.objectId
    && fields.version === '8' && fields.catalog_id === catalog.objectId
    && (object.owner.kind === 'shared' || object.owner.kind === 'immutable'), `${role} config identity`);
  authorityDigest(fields.product_binding_commitment, catalog.productBindingCommitment, 'Config tuple');
  if ('call_cap_set_commitment' in fields) authorityDigest(fields.call_cap_set_commitment, catalog.callCapSetCommitment, 'Config cap set');
  const roleNumber = AUTHORITY_ROLES.indexOf(role);
  const optional = {
    seal_policy_commitment: role === 'seal' ? fields.commitment : null,
    key_server_set_commitment: role === 'seal' ? fields.key_server_set_commitment : null,
    encryption_policy_commitment: role === 'seal' ? fields.encryption_policy_commitment : null,
    external_validator_policy_id: null, external_validator_registry_id: null, soul_binding_registry_id: null,
    runtime_caller_cap_commitment: null, bootstrap_certificate_id: null, bootstrap_certificate_commitment: null,
  };
  const optionFields = Object.fromEntries(Object.keys(optional).map(key => [key, bcs.option(key.endsWith('_id') ? bcs.Address : A_HASH)]));
  const expected = authorityHash({ role: bcs.u8(), config_id: bcs.Address, catalog_id: bcs.Address,
    package_tuple_commitment: A_HASH, call_cap_set_commitment: A_HASH, authority_id: bcs.Address,
    finalized: bcs.bool(), ...optionFields }, {
      role: roleNumber, config_id: object.objectId, catalog_id: catalog.objectId,
      package_tuple_commitment: fromHex(catalog.productBindingCommitment), call_cap_set_commitment: fromHex(catalog.callCapSetCommitment),
      authority_id: catalog.authorities[role], finalized: ['seal', 'physical'].includes(role), ...optional,
    }, 'animacraft-fresh-v8/package/role-config/v2');
  authorityCheck(expected === catalog.configCommitments[roleNumber - 1], 'Catalog config installation');
  authorityDigest(role === 'seal' ? fields.config_commitment : fields.installation_commitment, expected, 'Stored config installation');
  if (role === 'seal') {
    assertMakerV8SealEncryptionProfile({ cipherSuite: fields.cipher_suite,
      keyDerivation: fields.key_derivation, ciphertextFormat: fields.ciphertext_format });
    authorityCheck(fields.finalized === true && fields.role === 1 && fields.protocol_config_id === runtime.protocolConfigId
      && BigInt(fields.protocol_config_revision) === catalog.protocolConfigRevision
      && fields.seal_original_package_id === runtime.roles.seal.typeOriginPackageId
      && fields.seal_callable_package_id === runtime.roles.seal.callablePackageId
      && fields.seal_authority_id === catalog.authorities.seal, 'Seal policy binding');
    authorityDigest(fields.seal_binding_commitment, catalog.roles.seal.commitment, 'Seal binding');
    const totalKeyShares = fields.key_servers.reduce((sum, row) => sum + row.weight, 0);
    authorityCheck(fields.key_servers.length > 0 && fields.key_servers.length <= 64
      && fields.key_servers.every((row, index, rows) => row.weight > 0 && row.key_server_id !== `0x${'0'.repeat(64)}`
        && (index === 0 || rows[index - 1].key_server_id < row.key_server_id))
      && totalKeyShares < 255 && fields.threshold > 0 && fields.threshold <= totalKeyShares, 'Seal key servers');
    try { assertMakerV8SealPolicyCommitments(fields); }
    catch (cause) {
      if (cause?.code !== 'MAKER_V8_SEAL_POLICY_COMMITMENT_INVALID') throw cause;
      authorityCheck(false, cause.message);
    }
  }
  return freeze({ ...object, role, authorityFields: fields });
}

async function attestReplacement(rpc, runtime, catalog, configs, observedNetwork) {
  authorityCheck(typeof rpc.getDynamicField === 'function', 'Dynamic-field point reader');
  const keyType = makerV8StableType(runtime, 'core', 'package_binding_v8', 'FreshTupleBootstrapSlotKeyV2');
  const valueType = makerV8StableType(runtime, 'core', 'package_binding_v8', 'FreshTupleBootstrapSlotV2');
  // Source-level empty Move key: compiled dummy_field is always false.
  const keyBytes = bcs.struct('FreshTupleBootstrapSlotKeyV2', { dummy_field: bcs.bool() })
    .serialize({ dummy_field: false }).toBytes();
  const keyBase64 = toBase64(keyBytes);
  const field = await rpc.getDynamicField({ parentId: catalog.objectId, name: { type: keyType, bcsBase64: keyBase64 } });
  authorityCheck(record(field) && field.kind === 'DynamicField' && field.childId == null
    && field.fieldId === deriveDynamicFieldID(catalog.objectId, keyType, keyBytes)
    && normalizeStructTag(field.name?.type) === normalizeStructTag(keyType) && field.name?.bcsBase64 === keyBase64
    && normalizeStructTag(field.value?.type) === normalizeStructTag(valueType)
    && normalizeStructTag(field.type) === normalizeStructTag(`0x2::dynamic_field::Field<${keyType},${valueType}>`), 'Bootstrap slot TypeOrigin');
  const slot = authorityDecode(field.value.bcsBase64, A_SLOT, 'FreshTupleBootstrapSlotV2');
  authorityCheck(slot.state === 2 && slot.admin_id === null && slot.certificate_id !== null
    && slot.certificate_commitment !== null, 'Certified bootstrap slot');
  const read = async (objectId, datatype, shape) => {
    const response = await rpc.getObject({ id: objectId, options: { showType: true, showContent: true, showOwner: true, showBcs: true } });
    const result = authorityObject(response, runtime, datatype, shape, observedNetwork, 'immutable');
    authorityCheck(result.object.objectId === objectId, datatype);
    return result;
  };
  const replacement = await read(slot.replacement_binding_id, 'FreshTupleReplacementBindingV2', A_REPLACEMENT);
  const r = replacement.fields;
  authorityCheck(r.version === '2' && r.catalog_id === catalog.objectId, 'Replacement identity');
  for (const role of AUTHORITY_ROLES) authorityDigest(r[`${role}_binding_commitment`], catalog.roles[role].commitment, `${role} replacement binding`);
  authorityDigest(r.package_tuple_commitment, catalog.productBindingCommitment, 'Replacement tuple');
  authorityDigest(r.call_cap_set_commitment, catalog.callCapSetCommitment, 'Replacement caps');
  for (const role of ['runtime', 'output', 'market', 'release']) authorityCheck(r[`${role}_config_id`] === catalog.configIds[role], 'Replacement config ID');
  authorityDigest(r.binding_commitment, authorityHash({ binding_id: bcs.Address, catalog_id: bcs.Address, ...A_REPLACEMENT_INPUT },
    { ...r, binding_id: r.id }, 'animacraft-fresh-v8/core/fresh-tuple-replacement-binding/v2'), 'Replacement commitment');
  const certificate = await read(slot.certificate_id, 'FreshTupleBootstrapCertificateV2', A_CERTIFICATE);
  const c = certificate.fields;
  authorityCheck(c.version === '2' && c.catalog_id === catalog.objectId && c.replacement_binding_id === r.id
    && c.install_mask === 12 && c.install_mark_commitments.length === 2, 'Bootstrap certificate binding');
  authorityDigest(c.package_tuple_commitment, catalog.productBindingCommitment, 'Certificate tuple');
  authorityDigest(c.call_cap_set_commitment, catalog.callCapSetCommitment, 'Certificate caps');
  c.install_mark_commitments.forEach(mark => authorityCheck(hash(mark, 'install mark') !== '0'.repeat(64), 'Install mark'));
  const certificateHash = authorityHash({ certificate_id: bcs.Address, replacement_binding_id: bcs.Address,
    catalog_id: bcs.Address, package_tuple_commitment: A_HASH, call_cap_set_commitment: A_HASH,
    install_mask: bcs.u8(), ordered_install_mark_commitments: bcs.vector(A_HASH) },
    { ...c, certificate_id: c.id, ordered_install_mark_commitments: c.install_mark_commitments },
    'animacraft-fresh-v8/core/fresh-tuple-bootstrap-certificate/v2');
  authorityDigest(c.certificate_commitment, certificateHash, 'Certificate commitment');
  authorityDigest(slot.certificate_commitment, certificateHash, 'Slot certificate commitment');
  for (const [role, callerRole, markIndex, kind, witness] of [
    ['output', 0, 0, 4, 'OutputRuntimeCallerCapInstallWitnessV2'],
    ['market', 1, 1, 8, 'MarketRuntimeCallerCapInstallWitnessV2'],
  ]) {
    const cap = configs[role].authorityFields.runtime_caller_cap;
    authorityCheck(cap !== null && cap.schema_revision === '2' && cap.role === callerRole
      && cap.catalog_id === catalog.objectId && cap.replacement_binding_id === r.id
      && cap.caller_original_package_id === catalog.roles[role].originalPackageId
      && cap.caller_callable_package_id === catalog.roles[role].callablePackageId, `${role} Runtime caller`);
    authorityDigest(cap.package_tuple_commitment, catalog.productBindingCommitment, 'Caller tuple');
    authorityDigest(cap.call_cap_set_commitment, catalog.callCapSetCommitment, 'Caller cap set');
    const { cap_commitment, schema_revision: _, ...capInput } = cap;
    const capHash = authorityHash(Object.fromEntries(Object.entries(A_CALLER).filter(([key]) => !['schema_revision', 'cap_commitment'].includes(key))),
      capInput, 'animacraft-fresh-v8/core/runtime-caller-cap/v1');
    authorityDigest(cap_commitment, capHash, 'Runtime caller commitment');
    authorityDigest(c.install_mark_commitments[markIndex], authorityHash({ replacement_binding_id: bcs.Address,
      role: bcs.u8(), install_kind: bcs.u8(), config_id: bcs.Address, installed_object_id: bcs.option(bcs.Address),
      installed_commitment: A_HASH, role_witness_type_name: bcs.string() }, {
        replacement_binding_id: r.id, role: AUTHORITY_ROLES.indexOf(role), install_kind: kind, config_id: catalog.configIds[role],
        installed_object_id: null, installed_commitment: fromHex(capHash),
        role_witness_type_name: `${catalog.roles[role].originalPackageId.slice(2)}::${role}_v8::${witness}`,
      }, 'animacraft-fresh-v8/core/fresh-tuple-bootstrap-install-mark/v2'), 'Caller installation mark');
  }
  return freeze({ replacement: replacement.object, certificate: certificate.object });
}

export function makerV8AttestedReplacement(runtime) {
  if (!isMakerV8RuntimeAttested(runtime) || !ATTESTED_MAKER_V8_REPLACEMENTS.has(runtime)) {
    fail('config', 'MAKER_V8_RUNTIME_ATTESTATION_REQUIRED', 'Replacement requires exact certified runtime attestation.');
  }
  return ATTESTED_MAKER_V8_REPLACEMENTS.get(runtime);
}

/** Explicit native-Complete dependency, not a gate for unrelated legacy reads.
 * Defining IDs identify a type's introduction, NOT the latest callable package.
 * Callers must separately pin the native implementation they intend to invoke.
 */
export async function readMakerV8NativeSoulBinding(rpc, runtimeInput) {
  const runtime = assertMakerV8Runtime(runtimeInput);
  await assertMakerV8MainnetRpc(rpc);
  authorityCheck(typeof rpc.getDynamicField === 'function', 'Native Soul dynamic-field point reader');
  const keyType = makerV8StableType(runtime, 'core', 'protocol_config_v8', 'SoulidityBindingSlotKeyV8');
  const valueType = makerV8StableType(runtime, 'core', 'protocol_config_v8', 'SoulidityBindingV8');
  // Move compiles source-level empty structs with dummy_field: bool. Every
  // constructor in the compiled Core uses false, so its exact key BCS is [0].
  const keyBytes = bcs.struct('SoulidityBindingSlotKeyV8', { dummy_field: bcs.bool() })
    .serialize({ dummy_field: false }).toBytes();
  const keyBase64 = toBase64(keyBytes);
  const fieldId = deriveDynamicFieldID(runtime.protocolConfigId, keyType, keyBytes);
  let field;
  try {
    field = await rpc.getDynamicField({ parentId: runtime.protocolConfigId, name: { type: keyType, bcsBase64: keyBase64 } });
  } catch (error) {
    fail('readback', 'MAKER_V8_NATIVE_SOUL_BINDING_READ_FAILED', 'The exact protocol-scoped native Soul binding could not be read; native Complete is unavailable.', { cause: error?.code || error?.name });
  }
  const exactType = (actual, expected) => {
    try { return typeof actual === 'string' && normalizeStructTag(actual) === normalizeStructTag(expected); }
    catch { return false; }
  };
  authorityCheck(record(field) && field.kind === 'DynamicField' && field.childId === null
    && field.fieldId === fieldId && field.name?.bcsBase64 === keyBase64
    && exactType(field.name?.type, keyType) && exactType(field.value?.type, valueType)
    && exactType(field.type, `0x2::dynamic_field::Field<${keyType},${valueType}>`), 'Native Soul binding field identity');
  authorityCheck(typeof field.value.bcsBase64 === 'string' && field.value.bcsBase64.length <= 16384, 'Native Soul binding BCS length');
  const typeName = bcs.struct('TypeName', { name: bcs.string() });
  const fields = authorityDecode(field.value.bcsBase64, {
    config_id: bcs.Address, soul_original: typeName, soul_defining: typeName,
    mint_original: typeName, mint_defining: typeName, owner_original: typeName, owner_defining: typeName,
  }, 'SoulidityBindingV8');
  authorityCheck(fields.config_id === runtime.protocolConfigId, 'Native Soul binding protocol');
  const nativeType = (value, suffix) => {
    authorityCheck(typeof value?.name === 'string' && new RegExp(`^[0-9a-f]{64}::${suffix}$`).test(value.name)
      && !value.name.startsWith('0'.repeat(64)), `Native Soul exact ${suffix}`);
    return `0x${value.name}`;
  };
  const metadata = {
    soulOriginalType: nativeType(fields.soul_original, 'soul::Soul'),
    soulDefiningType: nativeType(fields.soul_defining, 'soul::Soul'),
    mintWitnessOriginalType: nativeType(fields.mint_original, 'animacraft_v8_binding::MintBindingWitnessV8'),
    mintWitnessDefiningType: nativeType(fields.mint_defining, 'animacraft_v8_binding::MintBindingWitnessV8'),
    ownerWitnessOriginalType: nativeType(fields.owner_original, 'animacraft_v8_binding::SoulOwnerWitnessV8'),
    ownerWitnessDefiningType: nativeType(fields.owner_defining, 'animacraft_v8_binding::SoulOwnerWitnessV8'),
  };
  const packageId = type => type.split('::')[0];
  authorityCheck(packageId(metadata.soulOriginalType) === packageId(metadata.mintWitnessOriginalType)
    && packageId(metadata.soulOriginalType) === packageId(metadata.ownerWitnessOriginalType)
    && packageId(metadata.mintWitnessDefiningType) === packageId(metadata.ownerWitnessDefiningType), 'Native Soul package lineage');
  const evidence = freeze({ protocolConfigId: runtime.protocolConfigId, fieldId, ...metadata });
  VERIFIED_NATIVE_SOUL_BINDINGS.set(evidence, keyType);
  return evidence;
}

export function isMakerV8NativeSoulBinding(value, runtimeInput) {
  if (!value || !VERIFIED_NATIVE_SOUL_BINDINGS.has(value)) return false;
  const runtime = assertMakerV8Runtime(runtimeInput);
  return value.protocolConfigId === runtime.protocolConfigId
    && VERIFIED_NATIVE_SOUL_BINDINGS.get(value) === makerV8StableType(runtime, 'core', 'protocol_config_v8', 'SoulidityBindingSlotKeyV8');
}

function nativePackageEvidence(response, expectedId, expectedOriginal = null, expectedDigest = null) {
  const data = response?.data;
  authorityCheck(record(data) && !response.error && data.objectId === expectedId
    && data.bcs?.dataType === 'package' && data.bcs.id === expectedId
    && ownerOf(data.owner).kind === 'immutable', 'Native package object');
  let packageDigest;
  try {
    const bytes = fromBase58(data.digest);
    authorityCheck(bytes.length === 32 && toBase58(bytes) === data.digest, 'Native callable digest');
    packageDigest = data.digest;
  } catch { authorityCheck(false, 'Native callable digest'); }
  authorityCheck(expectedDigest === null || packageDigest === expectedDigest, 'Native callable digest pin');
  const originalId = id(data.bcs.originalId, 'Native package originalId');
  authorityCheck(expectedOriginal === null || originalId === expectedOriginal, 'Native package lineage pin');
  const version = decimal(data.version, 'Native package version', { positive: true }).toString();
  authorityCheck(String(data.bcs.version) === version && record(data.bcs.moduleMap)
    && Array.isArray(data.bcs.typeOriginTable) && Array.isArray(data.bcs.linkageTable), 'Native package complete metadata');
  const origins = {};
  for (const row of data.bcs.typeOriginTable) {
    authorityCheck(record(row) && typeof row.moduleName === 'string' && typeof row.datatypeName === 'string'
      && /^[a-zA-Z_][a-zA-Z_0-9]*$/.test(row.moduleName) && /^[a-zA-Z_][a-zA-Z_0-9]*$/.test(row.datatypeName), 'Native type origin row');
    const key = `${row.moduleName}::${row.datatypeName}`;
    authorityCheck(!Object.hasOwn(origins, key), 'Native duplicate type origin');
    const encoded = data.bcs.moduleMap[row.moduleName];
    let bytes;
    try { bytes = fromBase64(encoded); } catch { authorityCheck(false, 'Native package module BCS'); }
    authorityCheck(typeof encoded === 'string' && bytes?.length > 4 && toBase64(bytes) === encoded
      && bytes[0] === 0xa1 && bytes[1] === 0x1c && bytes[2] === 0xeb && bytes[3] === 0x0b, 'Native package Move module bytes');
    origins[key] = `${id(row.packageId, 'Native type origin')}::${key}`;
  }
  const linkage = {};
  for (const row of data.bcs.linkageTable) {
    const original = id(row?.originalId, 'Native dependency originalId');
    authorityCheck(!Object.hasOwn(linkage, original), 'Native duplicate dependency');
    linkage[original] = { upgradedId: id(row.upgradedId, 'Native dependency upgradedId'), upgradedVersion: decimal(row.upgradedVersion, 'Native dependency version', { positive: true }).toString() };
  }
  return freeze({ objectId: expectedId, originalId, version, digest: packageDigest, origins, linkage });
}

function nativeIntegrationScope(runtimeInput) {
  const runtime = assertMakerV8Runtime(runtimeInput);
  return JSON.stringify({ protocolConfigId: runtime.protocolConfigId, catalogId: runtime.catalogId,
    roles: runtime.roles, roleConfigIds: runtime.roleConfigIds,
    tuple: makerV8AttestedPackageTuple(runtimeInput), config: runtime.nativeSoulIntegration });
}

async function attestNativeSoulAuthority(rpc, runtimeInput, recovery) {
  const runtime = assertMakerV8Runtime(runtimeInput);
  const config = runtime.nativeSoulIntegration;
  if (!config) fail('config', 'MAKER_V8_NATIVE_INTEGRATION_REQUIRED', 'Native Complete requires the explicit native Soul integration configuration.');
  const attestedTuple = makerV8AttestedPackageTuple(runtimeInput);
  await assertMakerV8MainnetRpc(rpc);
  authorityCheck(typeof rpc.getObject === 'function', 'Native package/config reader');
  const get = objectId => rpc.getObject({ id: objectId, options: { showType: true, showContent: true, showOwner: true, showBcs: true } });
  const [nativeBinding, nativeResponse] = await Promise.all([
    readMakerV8NativeSoulBinding(rpc, runtime), get(config.soulidityCallablePackageId),
  ]);
  for (const [key, value] of Object.entries(config.expectedNativeBinding)) authorityCheck(nativeBinding[key] === value, `Native expected ${key}`);
  const nativePackage = nativePackageEvidence(nativeResponse, config.soulidityCallablePackageId, config.soulidityOriginalPackageId, config.soulidityCallableDigest);
  await Promise.all(['core', 'output', 'runtime'].map(async role => {
    const pinned = attestedTuple.find(entry => entry.role === role);
    const response = await get(pinned.callablePackageId);
    const data = response?.data;
    const dependency = nativePackage.linkage[pinned.originalPackageId];
    authorityCheck(data?.objectId === pinned.callablePackageId && data.digest === pinned.packageDigest
      && data.bcs?.dataType === 'package' && data.bcs.originalId === pinned.originalPackageId
      && data.bcs.id === pinned.callablePackageId && ownerOf(data.owner).kind === 'immutable'
      && /^[1-9][0-9]*$/.test(String(data.version)) && String(data.bcs.version) === String(data.version)
      && dependency?.upgradedId === pinned.callablePackageId && dependency.upgradedVersion === String(data.version), `Native ${role} attested dependency`);
  }));
  for (const [row, key] of [['soul::Soul', 'soulDefiningType'], ['animacraft_v8_binding::MintBindingWitnessV8', 'mintWitnessDefiningType'], ['animacraft_v8_binding::SoulOwnerWitnessV8', 'ownerWitnessDefiningType']]) authorityCheck(nativePackage.origins[row] === nativeBinding[key], 'Native package exact bound type introduction');
  // Existing encrypted content needs the same immutable identity, not permission
  // to mint again or availability of unrelated mutable Kiosk/market objects.
  if (recovery) {
    const evidence = freeze({ config, nativeBinding, packageEvidence: nativePackage });
    VERIFIED_NATIVE_COMPLETION_RECOVERIES.set(evidence, nativeIntegrationScope(runtimeInput));
    return evidence;
  }
  const [kioskResponse, walrusResponse] = await Promise.all([get(config.kioskPackageId), get(config.walrusPackageId)]);
  const walrusPackage = nativePackageEvidence(walrusResponse, config.walrusPackageId);
  const walrusLink = nativePackage.linkage[walrusPackage.originalId];
  authorityCheck(walrusLink?.upgradedId === walrusPackage.objectId && walrusLink.upgradedVersion === walrusPackage.version
    && typeof walrusPackage.origins['blob::Blob'] === 'string', 'Native Walrus dependency');
  const packageEvidence = freeze({ ...nativePackage, walrusBlobType: walrusPackage.origins['blob::Blob'], walrusPackage });
  const kioskPackage = nativePackageEvidence(kioskResponse, config.kioskPackageId);
  const link = packageEvidence.linkage[kioskPackage.originalId];
  authorityCheck(link?.upgradedId === kioskPackage.objectId && link.upgradedVersion === kioskPackage.version, 'Native Kiosk dependency');
  const personalKioskCapType = kioskPackage.origins['personal_kiosk::PersonalKioskCap'];
  authorityCheck(typeof personalKioskCapType === 'string', 'Native personal Kiosk capability type');
  const kioskEvidence = freeze({ ...kioskPackage, personalKioskCapType });
  const table = bcs.struct('Table', { id: bcs.Address, size: bcs.u64() });
  const specs = {
    marketConfig: [config.marketConfigV2Id, packageEvidence.origins['market::MarketConfigV2'], { id: bcs.Address, version: bcs.u64(), legacy_config_id: bcs.Address, fee_recipient: bcs.Address, platform_fee_bps: bcs.u16(), primary_enabled: bcs.bool(), secondary_enabled: bcs.bool() }],
    kindRegistry: [config.kindRegistryId, packageEvidence.origins['kind_registry::KindRegistry'], { id: bcs.Address, version: bcs.u64(), next_kind: bcs.u32(), kinds: table, name_to_kind: table }],
    kioskRegistry: [config.kioskRegistryId, packageEvidence.origins['market::KioskRegistry'], { id: bcs.Address, version: bcs.u64() }],
    soulTransferPolicy: [config.soulTransferPolicyId, `0x2::transfer_policy::TransferPolicy<${nativeBinding.soulDefiningType}>`, { id: bcs.Address, balance: bcs.struct('Balance', { value: bcs.u64() }), rules: bcs.struct('VecSet', { contents: bcs.vector(bcs.struct('TypeName', { name: bcs.string() })) }) }],
  };
  const objects = {};
  await Promise.all(Object.entries(specs).map(async ([key, [objectId, type, shape]]) => {
    authorityCheck(typeof type === 'string', `Native ${key} declared type`);
    const response = await get(objectId);
    const object = parsedObject(response, normalizeStructTag(type), MAKER_V8_CHAIN_NETWORK, key);
    authorityCheck(object.objectId === objectId && object.owner.kind === 'shared'
      && response.data.bcs?.dataType === 'moveObject' && normalizeStructTag(response.data.bcs.type) === normalizeStructTag(type), `Native ${key} identity`);
    const decoded = authorityDecode(response.data.bcs.bcsBytes, shape, `Native ${key}`);
    authorityCheck(decoded.id === objectId, `Native ${key} UID`);
    authorityJsonMatches(object.fields, decoded, `Native ${key} JSON/BCS`);
    objects[key] = object;
  }));
  authorityCheck(String(objects.marketConfig.fields.version) === '2' && objects.marketConfig.fields.primary_enabled === true
    && Number(objects.marketConfig.fields.platform_fee_bps) <= 10000, 'Native market primary mint policy');
  authorityCheck(String(objects.kindRegistry.fields.version) === '1' && Number(objects.kindRegistry.fields.next_kind) >= 16
    && String(objects.kioskRegistry.fields.version) === '1', 'Native registries version');
  const evidence = freeze({ config, nativeBinding, objects, packageEvidence, kioskEvidence });
  VERIFIED_NATIVE_INTEGRATIONS.set(evidence, nativeIntegrationScope(runtimeInput));
  return evidence;
}

export async function attestMakerV8NativeSoulIntegration(rpc, runtimeInput) {
  return attestNativeSoulAuthority(rpc, runtimeInput, false);
}

export async function attestMakerV8NativeSoulCompletionRecovery(rpc, runtimeInput) {
  return attestNativeSoulAuthority(rpc, runtimeInput, true);
}

export function isMakerV8NativeSoulCompletionRecoveryAttested(value, runtimeInput) {
  return Boolean(value) && VERIFIED_NATIVE_COMPLETION_RECOVERIES.has(value)
    && isMakerV8RuntimeAttested(runtimeInput)
    && VERIFIED_NATIVE_COMPLETION_RECOVERIES.get(value) === nativeIntegrationScope(runtimeInput);
}

export function isMakerV8NativeSoulIntegrationAttested(value, runtimeInput) {
  if (!value || !VERIFIED_NATIVE_INTEGRATIONS.has(value)) return false;
  if (!isMakerV8RuntimeAttested(runtimeInput)) return false;
  return VERIFIED_NATIVE_INTEGRATIONS.get(value) === nativeIntegrationScope(runtimeInput);
}

/** Point-read the registered personal Kiosk. A failed read never means new user. */
export async function readMakerV8NativePersonalKiosk(rpc, runtimeInput, integration, signerInput) {
  authorityCheck(isMakerV8NativeSoulIntegrationAttested(integration, runtimeInput), 'Native Kiosk mint authority');
  const signer = address(signerInput, 'Native Kiosk signer');
  await assertMakerV8MainnetRpc(rpc);
  authorityCheck(typeof rpc.getDynamicField === 'function' && typeof rpc.getObject === 'function', 'Native Kiosk readers');
  const parentId = integration.config.kioskRegistryId;
  const keyType = integration.packageEvidence.origins['market::PersonalKioskOwnerKey'];
  const valueType = integration.packageEvidence.origins['market::PersonalKioskRegistration'];
  authorityCheck(typeof keyType === 'string' && typeof valueType === 'string', 'Native Kiosk registration type introductions');
  const nameBytes = bcs.struct('PersonalKioskOwnerKey', { owner: bcs.Address }).serialize({ owner: signer }).toBytes();
  const name = { type: keyType, bcsBase64: toBase64(nameBytes) };
  const fieldId = deriveDynamicFieldID(parentId, keyType, nameBytes);
  let field;
  try { field = await rpc.getDynamicField({ parentId, name }); }
  catch (error) {
    if (error instanceof ObjectError && error.reason === 'notFound' && error.objectId === fieldId) {
      return freeze({ currentKioskId: null, currentKioskCapOnChainId: null });
    }
    throw error;
  }
  const exact = (actual, expected) => {
    try { return typeof actual === 'string' && normalizeStructTag(actual) === normalizeStructTag(expected); }
    catch { return false; }
  };
  authorityCheck(record(field) && field.kind === 'DynamicField' && field.childId === null
    && field.fieldId === fieldId && exact(field.name?.type, keyType) && field.name?.bcsBase64 === name.bcsBase64
    && exact(field.value?.type, valueType)
    && exact(field.type, `0x2::dynamic_field::Field<${keyType},${valueType}>`), 'Native personal Kiosk field identity');
  authorityCheck(typeof field.value.bcsBase64 === 'string' && field.value.bcsBase64.length <= 128, 'Native personal Kiosk registration BCS length');
  const registration = authorityDecode(field.value.bcsBase64, {
    version: bcs.u64(), kiosk_id: bcs.Address, kiosk_cap_id: bcs.Address,
  }, 'PersonalKioskRegistration');
  const kioskId = id(registration.kiosk_id, 'Native Kiosk ID');
  const capId = id(registration.kiosk_cap_id, 'Native personal Kiosk cap ID');
  authorityCheck(registration.version === '1' && kioskId !== capId, 'Native personal Kiosk registration version/identity');
  const specs = [
    [kioskId, '0x2::kiosk::Kiosk', { id: bcs.Address, profits: bcs.struct('Balance', { value: bcs.u64() }),
      owner: bcs.Address, item_count: bcs.u32(), allow_extensions: bcs.bool() }],
    [capId, integration.kioskEvidence.personalKioskCapType, { id: bcs.Address,
      cap: bcs.option(bcs.struct('KioskOwnerCap', { id: bcs.Address, for: bcs.Address })) }],
  ];
  const [kiosk, cap] = await Promise.all(specs.map(async ([objectId, type, shape]) => {
    const response = await rpc.getObject({ id: objectId, options: { showType: true, showContent: true, showOwner: true, showBcs: true } });
    const object = parsedObject(response, normalizeStructTag(type), MAKER_V8_CHAIN_NETWORK, 'Native personal Kiosk custody');
    authorityCheck(object.objectId === objectId && response.data.bcs?.dataType === 'moveObject'
      && exact(response.data.bcs.type, type), 'Native personal Kiosk object identity');
    const decoded = authorityDecode(response.data.bcs.bcsBytes, shape, 'Native personal Kiosk custody');
    authorityCheck(decoded.id === objectId, 'Native personal Kiosk UID');
    authorityJsonMatches(object.fields, decoded, 'Native personal Kiosk JSON/BCS');
    return { object, decoded };
  }));
  authorityCheck(kiosk.object.owner.kind === 'shared' && kiosk.decoded.owner === signer
    && cap.object.owner.kind === 'address' && cap.object.owner.address === signer
    && cap.decoded.cap !== null && cap.decoded.cap.for === kioskId, 'Native personal Kiosk signer custody');
  id(cap.decoded.cap.id, 'Native wrapped Kiosk owner cap UID');
  return freeze({ currentKioskId: kioskId, currentKioskCapOnChainId: capId });
}
export function isMakerV8RuntimeAttested(runtime) {
  return Boolean(runtime) && ATTESTED_MAKER_V8_RUNTIMES.has(runtime);
}

export function makerV8AttestedPackageTuple(runtime) {
  if (!isMakerV8RuntimeAttested(runtime) || !ATTESTED_MAKER_V8_PACKAGE_TUPLES.has(runtime)) {
    fail('config', 'MAKER_V8_RUNTIME_ATTESTATION_REQUIRED', 'Package digests require the exact Mainnet-attested Maker v8 runtime.');
  }
  return ATTESTED_MAKER_V8_PACKAGE_TUPLES.get(runtime);
}

export function makerV8AttestedCoreArtifact(runtime) {
  if (!isMakerV8RuntimeAttested(runtime) || !ATTESTED_MAKER_V8_CORE_ARTIFACTS.has(runtime)) {
    fail('config', 'MAKER_V8_RUNTIME_ATTESTATION_REQUIRED', 'Core artifact evidence requires the exact Mainnet-attested Maker v8 runtime.');
  }
  return ATTESTED_MAKER_V8_CORE_ARTIFACTS.get(runtime);
}

function parseCallablePackageIdentity(response, runtime, role) {
  if (!record(response) || response.error || !record(response.data)) {
    fail('readback', 'MAKER_V8_PACKAGE_READ_FAILED', `${role} callable package could not be read from Mainnet.`);
  }
  const data = response.data;
  const expectedId = runtime.roles[role].callablePackageId;
  const packageId = id(data.objectId, `${role}.callablePackageId`);
  let packageDigest;
  try {
    packageDigest = digest(data.digest, `${role}.packageDigest`);
  } catch (error) {
    if (role !== 'core') throw error;
    fail('readback', 'MAKER_V8_CORE_ARTIFACT_UNMEASURED', 'Core callable package digest is missing or malformed.', { cause: error.code });
  }
  const packageVersion = decimal(data.version, `${role}.packageVersion`, { positive: true });
  const packageDataType = data.bcs?.dataType ?? data.content?.dataType;
  const packageOwner = ownerOf(data.owner);
  if (packageId !== expectedId || packageDataType !== 'package' || packageOwner.kind !== 'immutable') {
    fail('readback', 'MAKER_V8_PACKAGE_IDENTITY_MISMATCH', `${role} callable package object does not match the attested runtime.`, {
      expectedId,
      packageId,
      packageDataType,
      ownerKind: packageOwner.kind,
    });
  }
  let coreModuleEvidence = {};
  if (role === 'core') {
    const encoded = data.bcs?.moduleMap?.base_registry_v8;
    let moduleBytes;
    try {
      if (typeof encoded !== 'string' || encoded.length === 0 || encoded.length > 256 * 1024) throw new Error('shape');
      moduleBytes = fromBase64(encoded);
      if (toBase64(moduleBytes) !== encoded) throw new Error('canonical');
    } catch {
      fail('readback', 'MAKER_V8_CORE_ARTIFACT_UNMEASURED', 'Core base_registry_v8 module bytes are missing or not canonical Base64.');
    }
    const digestHex = (bytes) => [...sha256(bytes)]
      .map((byte) => byte.toString(16).padStart(2, '0')).join('');
    const publishedModuleSha256 = digestHex(moduleBytes);
    let moduleSha256 = publishedModuleSha256;
    if (moduleSha256 !== MAKER_V8_APPROVED_CORE_BASE_REGISTRY_MODULE_SHA256) {
      const packageBytes = fromHex(packageId);
      const matchingOffsets = [];
      for (let offset = 0; offset <= moduleBytes.length - packageBytes.length; offset += 1) {
        if (!packageBytes.every((byte, index) => moduleBytes[offset + index] === byte)) continue;
        const sourceModuleBytes = Uint8Array.from(moduleBytes);
        sourceModuleBytes.fill(0, offset, offset + packageBytes.length);
        if (digestHex(sourceModuleBytes) === MAKER_V8_APPROVED_CORE_BASE_REGISTRY_MODULE_SHA256) {
          matchingOffsets.push(offset);
        }
      }
      if (matchingOffsets.length === 1) moduleSha256 = MAKER_V8_APPROVED_CORE_BASE_REGISTRY_MODULE_SHA256;
    }
    if (moduleSha256 !== MAKER_V8_APPROVED_CORE_BASE_REGISTRY_MODULE_SHA256) {
      fail('readback', 'MAKER_V8_CORE_ARTIFACT_UNMEASURED', 'Core base_registry_v8 module bytes do not match the metered seal-cap artifact.', {
        expectedSha256: MAKER_V8_APPROVED_CORE_BASE_REGISTRY_MODULE_SHA256,
        observedSha256: publishedModuleSha256,
        byteLength: moduleBytes.length,
      });
    }
    coreModuleEvidence = { baseRegistryModuleSha256: moduleSha256 };
  }
  return freeze({
    role,
    originalPackageId: runtime.roles[role].typeOriginPackageId,
    callablePackageId: packageId,
    packageVersion: packageVersion.toString(),
    packageDigest,
    ...coreModuleEvidence,
  });
}

export async function attestMakerV8Runtime(rpc, config, { network: observedNetwork = MAKER_V8_CHAIN_NETWORK } = {}) {
  network(observedNetwork);
  await assertMakerV8MainnetRpc(rpc);
  if (typeof rpc?.getObject !== 'function') fail('config', 'MAKER_V8_RPC_INVALID', 'RPC getObject is required for runtime attestation.');
  const raw = rawCatalogIdentity(config);
  const rawCatalogType = `${raw.coreOriginalPackageId}::package_binding_v8::ProductReleaseCatalogV8`;
  const catalogResponse = await rpc.getObject({
    id: raw.catalogId,
    options: { showType: true, showContent: true, showOwner: true, showBcs: true },
  });
  const rawCatalog = parsedObject(catalogResponse, rawCatalogType, observedNetwork, 'ProductReleaseCatalogV8');
  const rawBinding = fieldsOf(rawCatalog.fields.binding, 'catalog.binding');
  const resolver = (role, callablePackageId) => {
    const roleFields = fieldsOf(rawBinding.bindings?.[AUTHORITY_ROLES.indexOf(role)], `catalog.binding.${role}`);
    return id(roleFields.callable_package_id, `catalog.binding.${role}.callable_package_id`) === callablePackageId
      ? id(roleFields.original_package_id, `catalog.binding.${role}.original_package_id`)
      : null;
  };
  const runtime = assertMakerV8Runtime(config, { requireEnabled: true, resolveTypeOriginPackageId: resolver });
  const catalog = parseCatalogWithRuntime(catalogResponse, runtime, observedNetwork);
  const roles = ['seal', 'runtime', 'output', 'physical', 'market', 'release'];
  const responses = await Promise.all(roles.map((role) => rpc.getObject({
    id: runtime.roleConfigIds[role],
    options: { showType: true, showContent: true, showOwner: true, showBcs: true },
  })));
  const configs = Object.fromEntries(roles.map((role, index) => [
    role,
    parseCompanionConfig(responses[index], runtime, catalog, role, observedNetwork),
  ]));
  const authority = await attestReplacement(rpc, runtime, catalog, configs, observedNetwork);
  const packageResponses = await Promise.all(Object.keys(runtime.roles).map((role) => rpc.getObject({
    id: runtime.roles[role].callablePackageId,
    options: { showBcs: true, showOwner: true },
  })));
  const packageEvidence = freeze(Object.keys(runtime.roles).map((role, index) => (
    parseCallablePackageIdentity(packageResponses[index], runtime, role)
  )));
  const packageTuple = freeze(packageEvidence.map((entry) => freeze({
    role: entry.role,
    originalPackageId: entry.originalPackageId,
    callablePackageId: entry.callablePackageId,
    packageDigest: entry.packageDigest,
  })));
  const coreEvidence = packageEvidence.find((entry) => entry.role === 'core');
  const coreArtifact = freeze({
    callablePackageId: coreEvidence.callablePackageId,
    packageDigest: coreEvidence.packageDigest,
    baseRegistryModuleSha256: coreEvidence.baseRegistryModuleSha256,
  });
  ATTESTED_MAKER_V8_RUNTIMES.add(runtime);
  ATTESTED_MAKER_V8_PACKAGE_TUPLES.set(runtime, packageTuple);
  ATTESTED_MAKER_V8_CORE_ARTIFACTS.set(runtime, coreArtifact);
  ATTESTED_MAKER_V8_REPLACEMENTS.set(runtime, authority.replacement);
  return freeze({
    runtime, catalog, configs: freeze(configs), packageTuple, coreArtifact,
    replacement: authority.replacement, bootstrapCertificate: authority.certificate,
    network: observedNetwork,
  });
}

const ACTIVATION_FIELDS = Object.freeze([
  'root_id', 'version', 'owner', 'control_epoch', 'admin_cap_id', 'maker_key',
  'maker_version', 'version_commitment', 'content_commitment', 'renderer_commitment',
  'protocol_config_id', 'protocol_config_revision', 'protocol_config_commitment',
  'protocol_treasury_id', 'maker_treasury_id', 'catalog_id',
  'product_binding_commitment', 'call_cap_set_commitment', 'base_registry_id',
  'registry_ids', 'replacement_id', 'bootstrap_certificate_id',
]);

const COMPANION_BINDING_MAP = Object.freeze({
  runtime_definition_registry_id: 'runtimeDefinitionRegistryId',
  pack_registry_id: 'packRegistryId',
  admission_authority_id: 'packAdmissionAuthorityId',
  seal_registry_id: 'sealRegistryId',
  output_registry_id: 'outputRegistryId',
  soul_registry_id: 'soulRegistryId',
  physical_registry_id: 'physicalRegistryId',
  market_registry_id: 'marketRegistryId',
});

function requiredFields(value, keys, label) {
  const fields = fieldsOf(value, label);
  exactRecord(fields, keys, label);
  for (const key of keys) {
    if (!Object.hasOwn(fields, key)) fail('schema', 'MAKER_V8_CHAIN_FIELD_MISSING', `${label}.${key} is required.`);
  }
  return fields;
}

function companionBinding(value, label) {
  const fields = requiredFields(value, Object.keys(COMPANION_BINDING_MAP), label);
  return Object.fromEntries(Object.entries(COMPANION_BINDING_MAP)
    .map(([key, name]) => [name, id(fields[key], `${label}.${key}`)]));
}

function bindingFromActivation(fields) {
  return freeze({
    rootId: id(fields.root_id, 'activation.root_id'),
    baseRegistryId: id(fields.base_registry_id, 'activation.base_registry_id'),
    makerTreasuryId: id(fields.maker_treasury_id, 'activation.maker_treasury_id'),
    ...companionBinding(fields.registry_ids, 'activation.registry_ids'),
  });
}

function assertBindingDistinct(binding) {
  const seen = new Map();
  for (const field of Object.keys(binding)) {
    const value = binding[field];
    if (seen.has(value)) fail('readback', 'MAKER_V8_BINDING_ID_COLLISION', `${field} collides with ${seen.get(value)}.`, { objectId: value });
    seen.set(value, field);
  }
}

function compareConfiguredBinding(runtime, binding, fields = Object.keys(binding)) {
  if (Object.keys(binding).some((key) => !MAKER_V8_MAKER_BINDING_FIELDS.includes(key))
    || fields.some((key) => !MAKER_V8_MAKER_BINDING_FIELDS.includes(key) || !Object.hasOwn(binding, key))) {
    fail('schema', 'MAKER_V8_BINDING_FIELD_INVALID', 'Binding comparison contains an unknown or absent field.');
  }
  const configured = runtime.makerBindings.find((entry) => entry.rootId === binding.rootId);
  if (!configured) {
    if (runtime.makerBindings.length > 0) {
      fail('config', 'MAKER_V8_ROOT_NOT_CONFIGURED', 'Activated Root is not present in the configured Maker binding allowlist.', { rootId: binding.rootId });
    }
    return;
  }
  for (const field of fields) {
    if (configured[field] !== binding[field]) {
      fail('readback', 'MAKER_V8_BINDING_READBACK_MISMATCH', `${field} does not match the pinned Maker binding.`, { expected: configured[field], observed: binding[field] });
    }
  }
}

export function parseMakerV8ActivatedEvent(event, runtimeInput, observedNetwork = MAKER_V8_CHAIN_NETWORK) {
  const runtime = assertMakerV8Runtime(runtimeInput);
  network(observedNetwork);
  const expectedType = makerV8ChainTypes(runtime).activationEvent;
  assertType(event?.type, expectedType, 'MakerV8Activated event');
  if (!record(event?.parsedJson)) fail('schema', 'MAKER_V8_ACTIVATION_EVENT_INVALID', 'MakerV8Activated has no parsed JSON payload.');
  exactRecord(event.parsedJson, ACTIVATION_FIELDS, 'MakerV8Activated');
  for (const field of ACTIVATION_FIELDS) {
    if (!Object.hasOwn(event.parsedJson, field)) fail('schema', 'MAKER_V8_ACTIVATION_FIELD_MISSING', `MakerV8Activated.${field} is required.`);
  }
  const fields = event.parsedJson;
  const binding = bindingFromActivation(fields);
  assertBindingDistinct(binding);
  compareConfiguredBinding(runtime, binding);
  const exactChecks = [
    ['catalog_id', runtime.catalogId],
    ['protocol_config_id', runtime.protocolConfigId],
    ['protocol_treasury_id', runtime.protocolTreasuryId],
  ];
  exactChecks.forEach(([field, expected]) => {
    const observed = id(fields[field], `activation.${field}`);
    if (observed !== expected) fail('readback', 'MAKER_V8_ACTIVATION_RUNTIME_MISMATCH', `${field} does not match the pinned runtime.`, { expected, observed });
  });
  if (decimal(fields.version, 'activation.version') !== 8n) {
    fail('readback', 'MAKER_V8_ACTIVATION_VERSION_MISMATCH', 'MakerV8Activated is not the complete native v8 product.');
  }
  const result = {
    schemaVersion: MAKER_V8_CHAIN_SCHEMA,
    network: observedNetwork,
    type: expectedType,
    eventId: event.id ?? null,
    transactionDigest: event.id?.txDigest ? digest(event.id.txDigest, 'event.id.txDigest') : null,
    binding,
    owner: address(fields.owner, 'activation.owner'),
    adminCapId: id(fields.admin_cap_id, 'activation.admin_cap_id'),
    controlEpoch: decimal(fields.control_epoch, 'activation.control_epoch'),
    makerKey: text(fields.maker_key, 'activation.maker_key'),
    makerVersion: decimal(fields.maker_version, 'activation.maker_version', { positive: true }),
    protocolConfigRevision: decimal(fields.protocol_config_revision, 'activation.protocol_config_revision'),
    versionCommitment: hash(fields.version_commitment, 'activation.version_commitment'),
    contentCommitment: hash(fields.content_commitment, 'activation.content_commitment'),
    rendererCommitment: hash(fields.renderer_commitment, 'activation.renderer_commitment'),
    catalogId: id(fields.catalog_id, 'activation.catalog_id'),
    protocolConfigCommitment: hash(fields.protocol_config_commitment, 'activation.protocol_config_commitment'),
    productBindingCommitment: hash(fields.product_binding_commitment, 'activation.product_binding_commitment'),
    callCapSetCommitment: hash(fields.call_cap_set_commitment, 'activation.call_cap_set_commitment'),
    replacementId: id(fields.replacement_id, 'activation.replacement_id'),
    bootstrapCertificateId: id(fields.bootstrap_certificate_id, 'activation.bootstrap_certificate_id'),
  };
  return freeze(result);
}

export function parseMakerRootV8(response, runtimeInput, activationInput, observedNetwork = MAKER_V8_CHAIN_NETWORK) {
  const runtime = assertMakerV8Runtime(runtimeInput);
  const activation = activationInput?.binding
    ? activationInput
    : parseMakerV8ActivatedEvent(activationInput, runtime, observedNetwork);
  network(activation.network);
  assertType(activation.type, makerV8ChainTypes(runtime).activationEvent, 'MakerV8Activated event');
  if (id(activation.catalogId, 'activation.catalogId') !== runtime.catalogId) {
    fail('readback', 'MAKER_V8_ACTIVATION_RUNTIME_MISMATCH', 'Activation catalog differs from the pinned runtime.');
  }
  const object = parsedObject(response, makerV8ChainTypes(runtime).root, observedNetwork, 'MakerRootV8');
  const fields = object.fields;
  requiredFields(fields, [
    'id', 'version', 'core_original_package_id', 'core_callable_package_id',
    'creator', 'owner', 'admin_cap_id', 'control_epoch', 'lifecycle', 'maker_key',
    'maker_version', 'version_commitment', 'previous_root_id',
    'previous_version_commitment', 'successor_authority_id', 'successor_root_id',
    'maker_document_commitment', 'creator_defaults_commitment',
    'living_content_binding_commitment', 'content', 'base_registry_id',
    'maker_treasury_id', 'expected_base_definition_count',
    'expected_base_registry_commitment', 'expected_pack_admission_policy_commitment',
    'economics', 'rights', 'publication', 'created_at_ms',
  ], 'MakerRootV8');
  const content = requiredFields(fields.content, [
    'renderer_commitment', 'manifest_blob_id', 'manifest_sha256', 'content_commitment',
  ], 'root.content');
  const publication = requiredFields(fields.publication, [
    'catalog_id', 'release_commitments', 'registry_ids', 'sealed_base_registry_commitment',
  ], 'root.publication');
  // A discovered/activated Root must have completed the one-time Base seal.
  // The author intent and the identity-bound storage seal are different hashes.
  const authorRowsCommitment = hash(fields.expected_base_registry_commitment, 'root.expected_base_registry_commitment');
  const sealedBaseRegistryCommitment = hash(
    moveOption(publication.sealed_base_registry_commitment, 'root.publication.sealed_base_registry_commitment'),
    'root.publication.sealed_base_registry_commitment');
  const releaseCommitments = requiredFields(
    moveOption(publication.release_commitments, 'root.publication.release_commitments'),
    ['product_binding_commitment', 'call_cap_set_commitment'], 'root.publication.release_commitments');
  if (!record(fields.economics)) {
    fail('schema', 'MAKER_V8_ROOT_ECONOMICS_INVALID', 'Root has no exact economics snapshot.');
  }
  const economics = fieldsOf(fields.economics, 'root.economics');
  if (object.objectId !== activation.binding.rootId) fail('readback', 'MAKER_V8_ROOT_ID_MISMATCH', 'Root object does not match MakerV8Activated.');
  const checks = [
    [id(fields.core_original_package_id, 'root.core_original_package_id'), runtime.roles.core.typeOriginPackageId, 'core original'],
    [id(fields.core_callable_package_id, 'root.core_callable_package_id'), runtime.roles.core.callablePackageId, 'core callable'],
    [id(economics.protocol_config_id, 'root.economics.protocol_config_id'), runtime.protocolConfigId, 'protocol config'],
    [id(economics.protocol_treasury_id, 'root.economics.protocol_treasury_id'), runtime.protocolTreasuryId, 'protocol treasury'],
    [id(moveOption(publication.catalog_id, 'root.publication.catalog_id'), 'root.publication.catalog_id'), runtime.catalogId, 'catalog'],
  ];
  checks.forEach(([observed, expected, label]) => {
    if (observed !== expected) fail('readback', 'MAKER_V8_ROOT_READBACK_MISMATCH', `Root ${label} does not match verified context.`, { expected, observed });
  });
  if (decimal(fields.version, 'root.version') !== 8n
    || decimal(fields.maker_version, 'root.maker_version') !== activation.makerVersion
    || text(fields.maker_key, 'root.maker_key') !== activation.makerKey
    || hash(content.content_commitment, 'root.content.content_commitment') !== activation.contentCommitment
    || hash(fields.version_commitment, 'root.version_commitment') !== activation.versionCommitment
    || hash(content.renderer_commitment, 'root.content.renderer_commitment') !== activation.rendererCommitment
    || decimal(economics.protocol_config_revision, 'root.economics.protocol_config_revision') !== activation.protocolConfigRevision
    || hash(economics.protocol_config_commitment, 'root.economics.protocol_config_commitment') !== activation.protocolConfigCommitment
    || hash(releaseCommitments.product_binding_commitment, 'root.publication.product_binding_commitment') !== activation.productBindingCommitment
    || hash(releaseCommitments.call_cap_set_commitment, 'root.publication.call_cap_set_commitment') !== activation.callCapSetCommitment) {
    fail('readback', 'MAKER_V8_ROOT_SNAPSHOT_MISMATCH', 'Root immutable/control snapshot does not match activation readback.');
  }
  const lifecycleCode = Number(decimal(fields.lifecycle, 'root.lifecycle'));
  if (!Object.hasOwn(MAKER_V8_LIFECYCLES, lifecycleCode)) fail('schema', 'MAKER_V8_LIFECYCLE_INVALID', 'Root lifecycle is unknown.');
  const previousRootValue = moveOption(fields.previous_root_id, 'root.previous_root_id');
  const previousCommitmentValue = moveOption(
    fields.previous_version_commitment,
    'root.previous_version_commitment',
  );
  if ((previousRootValue === null) !== (previousCommitmentValue === null)) {
    fail('readback', 'MAKER_V8_ROOT_LINEAGE_MISMATCH', 'Root predecessor ID and commitment must be present together.');
  }
  const successorAuthorityValue = moveOption(
    fields.successor_authority_id,
    'root.successor_authority_id',
  );
  const successorRootValue = moveOption(fields.successor_root_id, 'root.successor_root_id');
  const binding = freeze({
    rootId: object.objectId,
    baseRegistryId: id(moveOption(fields.base_registry_id, 'root.base_registry_id'), 'root.base_registry_id'),
    makerTreasuryId: id(moveOption(fields.maker_treasury_id, 'root.maker_treasury_id'), 'root.maker_treasury_id'),
    ...companionBinding(moveOption(publication.registry_ids, 'root.publication.registry_ids'), 'root.publication.registry_ids'),
  });
  assertBindingDistinct(binding);
  compareConfiguredBinding(runtime, binding);
  for (const field of Object.keys(binding)) {
    if (binding[field] !== activation.binding[field]) {
      fail('readback', 'MAKER_V8_COMPANION_BINDING_MISMATCH', `${field} does not match activation.`);
    }
  }
  return freeze({
    ...object,
    binding,
    ownerAddress: address(fields.owner, 'root.owner'),
    creatorAddress: address(fields.creator, 'root.creator'),
    adminCapId: id(fields.admin_cap_id, 'root.admin_cap_id'),
    controlEpoch: decimal(fields.control_epoch, 'root.control_epoch'),
    lifecycleCode,
    lifecycle: MAKER_V8_LIFECYCLES[lifecycleCode],
    makerKey: activation.makerKey,
    makerVersion: activation.makerVersion,
    versionCommitment: activation.versionCommitment,
    authorRowsCommitment,
    sealedBaseRegistryCommitment,
    previousRootId: previousRootValue === null
      ? null : id(previousRootValue, 'root.previous_root_id'),
    previousVersionCommitment: previousCommitmentValue === null
      ? null : hash(previousCommitmentValue, 'root.previous_version_commitment'),
    successorAuthorityId: successorAuthorityValue === null
      ? null : id(successorAuthorityValue, 'root.successor_authority_id'),
    successorRootId: successorRootValue === null
      ? null : id(successorRootValue, 'root.successor_root_id'),
    contentCommitment: activation.contentCommitment,
    rendererCommitment: activation.rendererCommitment,
    content: freeze({
      rendererCommitment: activation.rendererCommitment,
      contentCommitment: activation.contentCommitment,
      manifestBlobId: text(content.manifest_blob_id, 'root.content.manifest_blob_id'),
      manifestSha256: hash(content.manifest_sha256, 'root.content.manifest_sha256'),
    }),
    productBindingCommitment: activation.productBindingCommitment,
    callCapSetCommitment: activation.callCapSetCommitment,
    catalogId: runtime.catalogId,
  });
}

export function parseMakerAdminCapV8(response, runtimeInput, walletAddress, rootInput, observedNetwork = MAKER_V8_CHAIN_NETWORK) {
  const runtime = assertMakerV8Runtime(runtimeInput);
  const object = parsedObject(response, makerV8ChainTypes(runtime).adminCap, observedNetwork, 'MakerAdminCapV8');
  const owner = address(walletAddress, 'wallet.address');
  const root = rootInput;
  if (object.owner.kind !== 'address' || object.owner.address !== owner
    || address(object.fields.owner, 'admin.owner') !== owner
    || id(object.fields.root_id, 'admin.root_id') !== root.objectId
    || object.objectId !== root.adminCapId
    || decimal(object.fields.control_epoch, 'admin.control_epoch') !== root.controlEpoch
    || decimal(object.fields.version, 'admin.version') !== 8n) {
    fail('readback', 'MAKER_V8_ADMIN_CAP_MISMATCH', 'Maker AdminCap does not match the connected wallet and live Root epoch.');
  }
  return freeze({ ...object, rootId: root.objectId, holder: owner, controlEpoch: root.controlEpoch });
}

function observedBalance(value, label) {
  let candidate = value;
  if (record(candidate) && record(candidate.fields)) candidate = candidate.fields;
  if (record(candidate) && Object.hasOwn(candidate, 'value')) candidate = candidate.value;
  return decimal(candidate, label);
}

export function parseProtocolConfigV8(response, runtimeInput, rootInput, observedNetwork = MAKER_V8_CHAIN_NETWORK) {
  const runtime = assertMakerV8Runtime(runtimeInput);
  const object = parsedObject(response, makerV8ChainTypes(runtime).protocolConfig, observedNetwork, 'ProtocolConfigV8');
  const fields = object.fields;
  const treasuryId = moveOption(fields.treasury_id, 'protocol.treasury_id');
  if (object.objectId !== runtime.protocolConfigId
    || decimal(fields.version, 'protocol.version') !== 8n
    || id(fields.core_original_package_id, 'protocol.core_original_package_id') !== runtime.roles.core.typeOriginPackageId
    || id(fields.core_callable_package_id, 'protocol.core_callable_package_id') !== runtime.roles.core.callablePackageId
    || treasuryId === null
    || id(treasuryId, 'protocol.treasury_id') !== runtime.protocolTreasuryId
    || fields.payment_coin_type !== runtime.paymentCoinType
    || (rootInput && id(
      fieldsOf(rootInput.fields.economics, 'root.economics').protocol_config_id,
      'root.economics.protocol_config_id',
    ) !== object.objectId)) {
    fail('readback', 'MAKER_V8_PROTOCOL_CONFIG_MISMATCH', 'ProtocolConfig does not match the pinned runtime and live Root.');
  }
  if (typeof fields.enabled !== 'boolean') fail('schema', 'MAKER_V8_PROTOCOL_ENABLED_INVALID', 'Protocol enabled state is not boolean.');
  return freeze({
    ...object,
    enabled: fields.enabled,
    revision: decimal(fields.revision, 'protocol.revision'),
    commitment: `0x${hash(fields.commitment, 'protocol.commitment')}`,
    treasuryId: runtime.protocolTreasuryId,
  });
}

export function parseMakerTreasuryV8(response, runtimeInput, rootInput, observedNetwork = MAKER_V8_CHAIN_NETWORK) {
  const runtime = assertMakerV8Runtime(runtimeInput);
  const object = parsedObject(response, makerV8ChainTypes(runtime).makerTreasury, observedNetwork, 'MakerTreasuryV8');
  const fields = object.fields;
  if (object.objectId !== rootInput.binding.makerTreasuryId
    || decimal(fields.version, 'makerTreasury.version') !== 8n
    || id(fields.root_id, 'makerTreasury.root_id') !== rootInput.objectId
    || decimal(fields.maker_version, 'makerTreasury.maker_version') !== rootInput.makerVersion
    || hash(fields.root_content_commitment, 'makerTreasury.root_content_commitment') !== rootInput.contentCommitment) {
    fail('readback', 'MAKER_V8_MAKER_TREASURY_MISMATCH', 'MakerTreasury does not match the verified live Root.');
  }
  return freeze({
    ...object,
    rootId: rootInput.objectId,
    balanceAtomic: observedBalance(fields.revenue, 'makerTreasury.revenue'),
    totalCollectedAtomic: decimal(fields.total_collected, 'makerTreasury.total_collected'),
    totalWithdrawnAtomic: decimal(fields.total_withdrawn, 'makerTreasury.total_withdrawn'),
  });
}

function parseOwnedOutputObject(response, runtime, type, label, wallet, observedNetwork) {
  const object = parsedObject(response, type, observedNetwork, label);
  const holder = address(object.fields.holder, `${label}.holder`);
  if (object.owner.kind !== 'address' || object.owner.address !== wallet || holder !== wallet) {
    fail('readback', 'MAKER_V8_INVENTORY_OWNER_MISMATCH', `${label} is not held by the connected wallet.`);
  }
  return object;
}

export function parseSoulBundleV8(input, runtimeInput, walletAddress, rootInput, observedNetwork = MAKER_V8_CHAIN_NETWORK) {
  exactRecord(input, ['output', 'receipt', 'soul'], 'Soul bundle input');
  const runtime = assertMakerV8Runtime(runtimeInput);
  const types = makerV8ChainTypes(runtime);
  const wallet = address(walletAddress, 'wallet.address');
  const output = parseOwnedOutputObject(input.output, runtime, types.completeOutput, 'CompleteOutputV8', wallet, observedNetwork);
  const receipt = parseOwnedOutputObject(input.receipt, runtime, types.completeReceipt, 'CompleteReceiptV8', wallet, observedNetwork);
  const soul = parseOwnedOutputObject(input.soul, runtime, types.canonicalSoul, 'CanonicalSoulV8', wallet, observedNetwork);
  const rootId = rootInput.objectId;
  const content = rootInput.contentCommitment;
  const outputId = id(soul.fields.output_id, 'soul.output_id');
  const receiptId = id(soul.fields.receipt_id, 'soul.receipt_id');
  const objects = [output, receipt, soul];
  if (objects.some((object) => id(object.fields.root_id, `${object.type}.root_id`) !== rootId
      || hash(object.fields.root_content_commitment, `${object.type}.root_content_commitment`) !== content)
    || output.objectId !== outputId || receipt.objectId !== receiptId
    || id(receipt.fields.output_id, 'receipt.output_id') !== outputId
    || id(output.fields.output_registry_id, 'output.output_registry_id') !== rootInput.binding.outputRegistryId
    || id(soul.fields.soul_registry_id, 'soul.soul_registry_id') !== rootInput.binding.soulRegistryId) {
    fail('readback', 'MAKER_V8_SOUL_BUNDLE_MISMATCH', 'Soul/Output/Receipt do not form one exact verified bundle.');
  }
  return freeze({
    network: observedNetwork,
    rootId,
    holder: wallet,
    ownershipEpoch: decimal(soul.fields.ownership_epoch, 'soul.ownership_epoch'),
    output,
    receipt,
    soul,
  });
}

const PHYSICAL_SOURCE_FIELDS = Object.freeze([
  'source_kind', 'source_id', 'source_semantic_id', 'source_content_commitment',
  'source_treasury_id', 'pack_registry_id', 'pack_registry_revision',
  'registered_pack_owner', 'registered_pack_control_epoch',
  'registered_pack_admin_cap_id',
]);
const PHYSICAL_STYLE_FIELDS = Object.freeze([
  'part_key', 'item_key', 'style_key', 'layer_track_key', 'color_channel_key',
  'default_swatch_key', 'style_asset_blob_id', 'style_asset_sha256',
  'style_protected',
]);
const PHYSICAL_RETIRED_FLAT_FIELDS = Object.freeze(
  [...PHYSICAL_SOURCE_FIELDS, ...PHYSICAL_STYLE_FIELDS].flatMap((name) => [
    name,
    name.replace(/_([a-z])/g, (_match, letter) => letter.toUpperCase()),
  ]),
);

function exactPhysicalFields(fields, expected, label) {
  exactRecord(fields, expected, label);
  if (expected.some((name) => !Object.hasOwn(fields, name))) {
    fail('schema', 'MAKER_V8_PHYSICAL_FIELDS_MISSING', `${label} omits required fields.`);
  }
}

export function parsePhysicalAssetV8(response, runtimeInput, walletAddress, rootInput, observedNetwork = MAKER_V8_CHAIN_NETWORK) {
  const runtime = assertMakerV8Runtime(runtimeInput);
  const object = parsedObject(response, makerV8ChainTypes(runtime).physicalAsset, observedNetwork, 'PhysicalAssetV8');
  const sourceFields = fieldsOf(object.fields.source, 'PhysicalAssetV8.source');
  const styleFields = fieldsOf(object.fields.style, 'PhysicalAssetV8.style');
  exactPhysicalFields(sourceFields, PHYSICAL_SOURCE_FIELDS, 'PhysicalAssetV8.source');
  exactPhysicalFields(styleFields, PHYSICAL_STYLE_FIELDS, 'PhysicalAssetV8.style');
  if (PHYSICAL_RETIRED_FLAT_FIELDS
    .some((name) => Object.hasOwn(object.fields, name))) {
    fail('schema', 'MAKER_V8_PHYSICAL_FIELDS_LEGACY', 'PhysicalAssetV8 contains retired flat Physical fields.');
  }
  const { source: _source, style: _style, ...outerFields } = object.fields;
  const fields = freeze({ ...outerFields, ...sourceFields, ...styleFields });
  const wallet = address(walletAddress, 'wallet.address');
  if (object.owner.kind !== 'address' || object.owner.address !== wallet
    || address(fields.holder, 'physical.holder') !== wallet
    || id(fields.root_id, 'physical.root_id') !== rootInput.objectId
    || id(fields.registry_id, 'physical.registry_id') !== rootInput.binding.physicalRegistryId
    || hash(fields.root_content_commitment, 'physical.root_content_commitment') !== rootInput.contentCommitment) {
    fail('readback', 'MAKER_V8_PHYSICAL_ASSET_MISMATCH', 'Physical asset does not match the wallet and verified Maker binding.');
  }
  const sourceKind = Number(decimal(fields.source_kind, 'physical.source_kind'));
  if (![0, 1].includes(sourceKind)) fail('schema', 'MAKER_V8_PHYSICAL_SOURCE_INVALID', 'Physical source must be Base or Pack.');
  const sourceTreasuryId = moveOption(fields.source_treasury_id, 'physical.source_treasury_id');
  if ((sourceKind === 0 && sourceTreasuryId !== null)
    || (sourceKind === 1 && sourceTreasuryId === null)) {
    fail('readback', 'MAKER_V8_PHYSICAL_SOURCE_MISMATCH', 'Physical Base/Pack custody fields are inconsistent.');
  }
  return freeze({
    ...object,
    fields,
    rootId: rootInput.objectId,
    holder: wallet,
    sourceKind,
    source: sourceKind === 0 ? 'BASE' : 'PACK',
    sourceId: id(fields.source_id, 'physical.source_id'),
    sourceTreasuryId: sourceTreasuryId === null
      ? null
      : id(sourceTreasuryId, 'physical.source_treasury_id'),
    ownershipEpoch: decimal(fields.ownership_epoch, 'physical.ownership_epoch'),
    transferable: fields.transferable === true,
  });
}

async function allPages(fetchPage, maximum = 10_000) {
  const rows = [];
  const cursors = new Set();
  let cursor = null;
  do {
    const page = await fetchPage(cursor);
    if (!record(page) || !Array.isArray(page.data) || typeof page.hasNextPage !== 'boolean') fail('readback', 'MAKER_V8_RPC_PAGE_INVALID', 'RPC returned an invalid page.');
    rows.push(...page.data);
    if (rows.length > maximum) fail('local', 'MAKER_V8_RPC_PAGE_LIMIT', 'RPC result exceeds the bounded client limit.');
    cursor = page.hasNextPage ? page.nextCursor : null;
    if (page.hasNextPage) {
      const key = typeof cursor === 'string' ? cursor
        : record(cursor) ? JSON.stringify(Object.entries(cursor).sort(([left], [right]) => left.localeCompare(right))) : '';
      if (!key || page.data.length === 0 || cursors.has(key)) {
        fail('readback', 'MAKER_V8_RPC_CURSOR_INVALID', 'RPC pagination did not advance to a new nonempty page.');
      }
      cursors.add(key);
    }
  } while (cursor);
  return rows;
}

export async function discoverMakerV8Activations(rpc, runtimeInput, { network: observedNetwork = MAKER_V8_CHAIN_NETWORK } = {}) {
  const runtime = assertMakerV8Runtime(runtimeInput);
  network(observedNetwork);
  await assertMakerV8MainnetRpc(rpc);
  if (typeof rpc?.queryEvents !== 'function') fail('config', 'MAKER_V8_RPC_INVALID', 'RPC queryEvents is required.');
  const eventType = makerV8ChainTypes(runtime).activationEvent;
  const events = await allPages((cursor) => rpc.queryEvents({
    query: { MoveEventType: eventType }, cursor, limit: MAKER_V8_EVENT_DISCOVERY_PAGE_SIZE, order: 'descending',
  }));
  return freeze(events.map((event) => parseMakerV8ActivatedEvent(event, runtime, observedNetwork)));
}

/** Extend the Root's real companion IDs using the actual Market objects.
 * Discovery never invents a treasury field absent from the activation event.
 * Reading escrow works for paused/archived Makers; this grants no write access.
 */
export function parseMakerV8MarketAuthority(registryResponse, treasuryResponse, runtimeInput, root, observedNetwork = MAKER_V8_CHAIN_NETWORK) {
  const runtime = assertMakerV8Runtime(runtimeInput);
  const types = makerV8ChainTypes(runtime);
  const registry = parsedObject(registryResponse, types.marketRegistry, observedNetwork, 'MarketRegistryV8');
  const treasury = parsedObject(treasuryResponse, types.marketTreasury, observedNetwork, 'MarketTreasuryV8');
  if (registry.owner.kind !== 'shared' || treasury.owner.kind !== 'shared'
    || registry.objectId !== root.binding.marketRegistryId
    || registry.fields.sealed !== true
    || id(registry.fields.treasury_id, 'market.treasury_id') !== treasury.objectId
    || decimal(treasury.fields.version, 'marketTreasury.version') !== 8n) {
    fail('readback', 'MAKER_V8_MARKET_BINDING_MISMATCH', 'Market registry and treasury are not the exact shared companion objects.');
  }
  for (const [object, label] of [[registry, 'market'], [treasury, 'marketTreasury']]) {
    if (id(object.fields.root_id, `${label}.root_id`) !== root.objectId
      || decimal(object.fields.maker_version, `${label}.maker_version`) !== root.makerVersion
      || hash(object.fields.root_content_commitment, `${label}.root_content_commitment`) !== root.contentCommitment
      || id(object.fields.catalog_id, `${label}.catalog_id`) !== runtime.catalogId
      || id(object.fields.package_config_id, `${label}.package_config_id`) !== runtime.roleConfigIds.market) {
      fail('readback', 'MAKER_V8_MARKET_BINDING_MISMATCH', `${label} does not belong to this exact Maker and installed Market config.`);
    }
  }
  const fields = registry.fields;
  const economics = fieldsOf(root.fields.economics);
  const rights = fieldsOf(root.fields.rights);
  if (hash(fields.product_binding_commitment, 'market.product_binding_commitment') !== root.productBindingCommitment
    || hash(fields.call_cap_set_commitment, 'market.call_cap_set_commitment') !== root.callCapSetCommitment
    || id(fields.protocol_config_id, 'market.protocol_config_id') !== runtime.protocolConfigId
    || decimal(fields.protocol_config_revision, 'market.protocol_config_revision') !== decimal(economics.protocol_config_revision, 'root.economics.protocol_config_revision')
    || hash(fields.protocol_config_commitment, 'market.protocol_config_commitment') !== hash(economics.protocol_config_commitment, 'root.economics.protocol_config_commitment')
    || hash(fields.economics_commitment, 'market.economics_commitment') !== hash(economics.commitment, 'root.economics.commitment')
    || hash(fields.rights_commitment, 'market.rights_commitment') !== hash(rights.commitment, 'root.rights.commitment')) {
    fail('readback', 'MAKER_V8_MARKET_SNAPSHOT_MISMATCH', 'Market immutable product/economic/rights snapshot differs from the Root.');
  }
  const binding = freeze({ ...root.binding, marketTreasuryId: treasury.objectId });
  if (Object.keys(binding).length !== MAKER_V8_MAKER_BINDING_FIELDS.length
    || MAKER_V8_MAKER_BINDING_FIELDS.some(field => !Object.hasOwn(binding, field))) {
    fail('readback', 'MAKER_V8_MARKET_BINDING_MISMATCH', 'Market discovery did not complete the exact Maker binding.');
  }
  assertBindingDistinct(binding);
  compareConfiguredBinding(runtime, binding);
  return freeze({ root: { ...root, binding }, registry, treasury });
}

export async function loadMakerV8Context(rpc, runtimeInput, activationInput, { network: observedNetwork = MAKER_V8_CHAIN_NETWORK } = {}) {
  const runtime = assertMakerV8Runtime(runtimeInput);
  const activation = activationInput?.binding
    ? activationInput
    : parseMakerV8ActivatedEvent(activationInput, runtime, observedNetwork);
  await assertMakerV8MainnetRpc(rpc);
  if (typeof rpc?.getObject !== 'function') fail('config', 'MAKER_V8_RPC_INVALID', 'RPC getObject is required.');
  const response = await rpc.getObject({
    id: activation.binding.rootId,
    options: { showType: true, showContent: true, showOwner: true },
  });
  const root = parseMakerRootV8(response, runtime, activation, observedNetwork);
  const marketResponse = await rpc.getObject({
    id: root.binding.marketRegistryId,
    options: { showType: true, showContent: true, showOwner: true },
  });
  const market = parsedObject(marketResponse, makerV8ChainTypes(runtime).marketRegistry, observedNetwork, 'MarketRegistryV8');
  if (market.objectId !== root.binding.marketRegistryId) {
    fail('readback', 'MAKER_V8_MARKET_BINDING_MISMATCH', 'RPC returned a different Market registry.');
  }
  const treasuryResponse = await rpc.getObject({
    id: id(market.fields.treasury_id, 'market.treasury_id'),
    options: { showType: true, showContent: true, showOwner: true },
  });
  const authority = parseMakerV8MarketAuthority(marketResponse, treasuryResponse, runtime, root, observedNetwork);
  return freeze({ runtime, activation, root: authority.root, marketRegistry: authority.registry, marketTreasury: authority.treasury });
}

export async function loadMakerV8OperationalState(rpc, runtimeInput, rootInput, { network: observedNetwork = MAKER_V8_CHAIN_NETWORK } = {}) {
  const runtime = assertMakerV8Runtime(runtimeInput);
  network(observedNetwork);
  await assertMakerV8MainnetRpc(rpc);
  if (typeof rpc?.getObject !== 'function') fail('config', 'MAKER_V8_RPC_INVALID', 'RPC getObject is required.');
  const options = { showType: true, showContent: true, showOwner: true };
  const [protocolResponse, makerTreasuryResponse] = await Promise.all([
    rpc.getObject({ id: runtime.protocolConfigId, options }),
    rpc.getObject({ id: rootInput.binding.makerTreasuryId, options }),
  ]);
  return freeze({
    network: observedNetwork,
    root: rootInput,
    protocolConfig: parseProtocolConfigV8(protocolResponse, runtime, rootInput, observedNetwork),
    makerTreasury: parseMakerTreasuryV8(makerTreasuryResponse, runtime, rootInput, observedNetwork),
  });
}

const RUNTIME_ADMISSION_CEILINGS = Object.freeze({
  0: 'DISABLED',
  1: 'CERTIFIED',
  2: 'OPEN',
});

/**
 * Read the complete authority tuple required to author a post-activation Pack.
 * Every ID is derived from the certified Root binding; no caller-supplied
 * registry reference or revision is trusted.
 */
export async function loadMakerV8PackAuthoringContext(
  rpc,
  runtimeInput,
  rootInput,
  walletAddress,
  { network: observedNetwork = MAKER_V8_CHAIN_NETWORK } = {},
) {
  const runtime = assertMakerV8Runtime(runtimeInput, { requireEnabled: true });
  const wallet = address(walletAddress, 'wallet.address');
  network(observedNetwork);
  await assertMakerV8MainnetRpc(rpc);
  if (typeof rpc?.getObject !== 'function') {
    fail('config', 'MAKER_V8_RPC_INVALID', 'RPC getObject is required for Pack authoring.');
  }
  if (!record(rootInput) || rootInput.lifecycle !== 'ACTIVE') {
    fail('readback', 'MAKER_V8_PACK_ROOT_INACTIVE', 'Pack authoring requires one exact ACTIVE Maker Root.');
  }
  const binding = rootInput.binding;
  if (!record(binding)) {
    fail('readback', 'MAKER_V8_PACK_ROOT_BINDING_MISSING', 'Maker Root has no certified v8 registry binding.');
  }
  const inventory = await listOwnedMakerV8Inventory(
    rpc,
    runtime,
    wallet,
    rootInput,
    { network: observedNetwork },
  );
  const admins = inventory.adminCaps.filter((entry) => entry.objectId === rootInput.adminCapId);
  if (admins.length !== 1) {
    fail('readback', 'MAKER_V8_PACK_ADMIN_REQUIRED', 'Connected wallet does not hold the exact current MakerAdmin capability.');
  }
  const options = { showType: true, showContent: true, showOwner: true };
  const ids = [
    binding.runtimeDefinitionRegistryId,
    binding.baseRegistryId,
    binding.packRegistryId,
    binding.packAdmissionAuthorityId,
    binding.physicalRegistryId,
    binding.marketRegistryId,
    runtime.roleConfigIds.release,
  ];
  const responses = await Promise.all(ids.map((objectId) => rpc.getObject({ id: objectId, options })));
  const types = makerV8ChainTypes(runtime);
  const definitions = parsedObject(responses[0], types.runtimeDefinitions, observedNetwork, 'RuntimeDefinitionRegistryV8');
  const base = parsedObject(responses[1], types.baseRegistry, observedNetwork, 'BaseDefinitionRegistryV8');
  const packs = parsedObject(responses[2], types.packRegistry, observedNetwork, 'PackRegistryV8');
  const authority = parsedObject(responses[3], types.packAdmissionAuthority, observedNetwork, 'PackAdmissionAuthorityV8');
  const physical = parsedObject(responses[4], types.physicalRegistry, observedNetwork, 'PhysicalRegistryV8');
  const market = parsedObject(responses[5], types.marketRegistry, observedNetwork, 'MarketRegistryV8');
  const release = parsedObject(responses[6], types.releaseConfig, observedNetwork, 'ReleasePackageConfigV8');
  for (const [index, object] of [definitions, base, packs, authority, physical, market, release].entries()) {
    if (object.objectId !== ids[index]) {
      fail('readback', 'MAKER_V8_PACK_REGISTRY_BINDING_MISMATCH', 'RPC returned an object outside the activated Pack authority tuple.');
    }
  }
  const rootId = rootInput.objectId;
  const rootVersion = rootInput.makerVersion.toString();
  const rootCommitment = rootInput.contentCommitment;
  const exactRoot = (object, label, versionField = 'root_version') => {
    if (id(object.fields.root_id, `${label}.root_id`) !== rootId
      || decimal(object.fields[versionField], `${label}.${versionField}`, { positive: true }).toString() !== rootVersion
      || hash(object.fields.root_content_commitment, `${label}.root_content_commitment`) !== rootCommitment) {
      fail('readback', 'MAKER_V8_PACK_ROOT_BINDING_MISMATCH', `${label} differs from the exact activated Maker Root.`);
    }
  };
  exactRoot(definitions, 'RuntimeDefinitionRegistryV8');
  exactRoot(base, 'BaseDefinitionRegistryV8', 'maker_version');
  exactRoot(packs, 'PackRegistryV8');
  exactRoot(authority, 'PackAdmissionAuthorityV8');
  exactRoot(physical, 'PhysicalRegistryV8', 'maker_version');
  exactRoot(market, 'MarketRegistryV8', 'maker_version');
  const admissionCode = Number(decimal(definitions.fields.admission_ceiling, 'RuntimeDefinitionRegistryV8.admission_ceiling'));
  const admissionCeiling = RUNTIME_ADMISSION_CEILINGS[admissionCode];
  if (!admissionCeiling) {
    fail('readback', 'MAKER_V8_PACK_ADMISSION_CEILING_INVALID', 'Runtime definition admission ceiling is invalid.');
  }
  if (definitions.fields.sealed !== true || base.fields.sealed !== true || market.fields.sealed !== true) {
    fail('readback', 'MAKER_V8_PACK_REGISTRY_UNSEALED', 'Pack authoring requires sealed Base, Runtime and Market registries.');
  }
  const admin = admins[0];
  const productBindingCommitment = hash(rootInput.productBindingCommitment, 'Root.productBindingCommitment');
  const callCapSetCommitment = hash(rootInput.callCapSetCommitment, 'Root.callCapSetCommitment');
  const catalogId = id(rootInput.catalogId, 'Root.catalogId');
  const sharedProductBinding = (object, label) => {
    if (id(object.fields.catalog_id, `${label}.catalog_id`) !== catalogId
      || hash(object.fields.product_binding_commitment, `${label}.product_binding_commitment`) !== productBindingCommitment
      || hash(object.fields.call_cap_set_commitment, `${label}.call_cap_set_commitment`) !== callCapSetCommitment) {
      fail('readback', 'MAKER_V8_PACK_PRODUCT_BINDING_MISMATCH', `${label} differs from the activated product release.`);
    }
  };
  sharedProductBinding(physical, 'PhysicalRegistryV8');
  sharedProductBinding(market, 'MarketRegistryV8');
  sharedProductBinding(release, 'ReleasePackageConfigV8');
  if (id(definitions.fields.base_registry_id, 'RuntimeDefinitionRegistryV8.base_registry_id') !== base.objectId
    || id(packs.fields.definition_registry_id, 'PackRegistryV8.definition_registry_id') !== definitions.objectId
    || id(packs.fields.admission_authority_id, 'PackRegistryV8.admission_authority_id') !== authority.objectId
    || id(physical.fields.base_registry_id, 'PhysicalRegistryV8.base_registry_id') !== base.objectId) {
    fail('readback', 'MAKER_V8_PACK_REGISTRY_BINDING_MISMATCH', 'Pack authoring registries are not the exact activated tuple.');
  }
  return freeze({
    root: {
      objectRef: rootInput.objectRef,
      makerVersion: rootVersion,
      contentCommitment: rootCommitment,
      lifecycle: rootInput.lifecycle,
      owner: rootInput.ownerAddress,
      adminCapId: rootInput.adminCapId,
      controlEpoch: rootInput.controlEpoch.toString(),
    },
    makerAdmin: {
      objectRef: admin.objectRef,
      protocolVersion: 8,
      rootId,
      owner: wallet,
      controlEpoch: admin.controlEpoch.toString(),
    },
    definitionRegistry: {
      objectRef: definitions.objectRef,
      rootId,
      rootVersion,
      rootContentCommitment: rootCommitment,
      baseRegistryId: base.objectId,
      sealed: true,
      admissionCeiling,
    },
    baseRegistry: {
      objectRef: base.objectRef,
      rootId,
      makerVersion: rootVersion,
      rootContentCommitment: rootCommitment,
      sealed: true,
    },
    packRegistry: {
      objectRef: packs.objectRef,
      rootId,
      rootVersion,
      rootContentCommitment: rootCommitment,
      definitionRegistryId: definitions.objectId,
      admissionAuthorityId: authority.objectId,
      admissionPolicyCommitment: hash(packs.fields.admission_policy_commitment, 'PackRegistryV8.admission_policy_commitment'),
      revision: decimal(packs.fields.revision, 'PackRegistryV8.revision').toString(),
    },
    admissionAuthority: {
      objectRef: authority.objectRef,
      rootId,
      rootVersion,
      rootContentCommitment: rootCommitment,
    },
    physicalRegistry: {
      objectRef: physical.objectRef,
      catalogId,
      productBindingCommitment,
      callCapSetCommitment,
      rootId,
      makerVersion: rootVersion,
      rootContentCommitment: rootCommitment,
      baseRegistryId: base.objectId,
      revision: decimal(physical.fields.revision, 'PhysicalRegistryV8.revision').toString(),
    },
    marketRegistry: {
      objectRef: market.objectRef,
      catalogId,
      productBindingCommitment,
      callCapSetCommitment,
      rootId,
      makerVersion: rootVersion,
      rootContentCommitment: rootCommitment,
      treasuryId: id(market.fields.treasury_id, 'MarketRegistryV8.treasury_id'),
      sealed: true,
      revision: decimal(market.fields.revision, 'MarketRegistryV8.revision').toString(),
    },
    releaseConfig: {
      objectRef: release.objectRef,
      catalogId,
      productBindingCommitment,
      callCapSetCommitment,
    },
  });
}

async function ownedByType(rpc, owner, type) {
  return allPages((cursor) => rpc.getOwnedObjects({
    owner,
    filter: { StructType: type },
    options: { showType: true, showContent: true, showOwner: true },
    cursor,
    limit: 100,
  }));
}

function ownedHolderObject(response, expectedType, runtime, wallet, label) {
  const object = parsedObject(response, expectedType, MAKER_V8_CHAIN_NETWORK, label);
  if (object.owner.kind !== 'address' || object.owner.address !== wallet
    || address(object.fields.holder, `${label}.holder`) !== wallet) {
    fail('readback', 'MAKER_V8_INVENTORY_OWNER_MISMATCH', `${label} is not held by the connected wallet.`);
  }
  return object;
}

function exactRootInventoryBinding(object, root, label) {
  if (id(object.fields.root_id, `${label}.root_id`) !== root.objectId
    || decimal(object.fields.root_version ?? object.fields.maker_version, `${label}.root_version`)
      !== root.makerVersion
    || hash(object.fields.root_content_commitment, `${label}.root_content_commitment`)
      !== root.contentCommitment) {
    fail('readback', 'MAKER_V8_INVENTORY_ROOT_MISMATCH', `${label} belongs to another immutable Maker version.`);
  }
}

function equipLock(value, label) {
  const candidate = moveOption(value, label);
  if (candidate === null) return null;
  const fields = fieldsOf(candidate, label);
  exactRecord(fields, ['loadout_id', 'equip_revision', 'selection_index'], label);
  return freeze({
    loadoutId: id(fields.loadout_id, `${label}.loadout_id`),
    equipRevision: decimal(fields.equip_revision, `${label}.equip_revision`).toString(),
    selectionIndex: decimal(fields.selection_index, `${label}.selection_index`).toString(),
  });
}

function parseMakerAccessInventory(response, runtime, wallet, root) {
  const object = ownedHolderObject(
    response, makerV8ChainTypes(runtime).makerAccess, runtime, wallet, 'MakerAccessPassV8',
  );
  exactRootInventoryBinding(object, root, 'MakerAccessPassV8');
  return freeze({
    ...object,
    rootId: root.objectId,
    holder: wallet,
    paidAtomic: decimal(object.fields.paid_atomic, 'MakerAccessPassV8.paid_atomic').toString(),
    issuedAtMs: decimal(object.fields.issued_at_ms, 'MakerAccessPassV8.issued_at_ms').toString(),
  });
}

function parsePackPassInventory(response, runtime, wallet, root) {
  const object = ownedHolderObject(
    response, makerV8ChainTypes(runtime).packPass, runtime, wallet, 'PackPassV8',
  );
  exactRootInventoryBinding(object, root, 'PackPassV8');
  return freeze({
    ...object,
    rootId: root.objectId,
    releaseId: id(object.fields.release_id, 'PackPassV8.release_id'),
    holder: wallet,
    releaseContentCommitment: hash(
      object.fields.release_content_commitment,
      'PackPassV8.release_content_commitment',
    ),
    commitment: hash(object.fields.commitment, 'PackPassV8.commitment'),
  });
}

function parseOwnedBaseInventory(response, runtime, wallet, root) {
  const object = ownedHolderObject(
    response, makerV8ChainTypes(runtime).ownedBaseItem, runtime, wallet, 'OwnedBaseItemV8',
  );
  exactRootInventoryBinding(object, root, 'OwnedBaseItemV8');
  if (id(object.fields.definition_registry_id, 'OwnedBaseItemV8.definition_registry_id')
      !== root.binding.runtimeDefinitionRegistryId
    || id(object.fields.pack_registry_id, 'OwnedBaseItemV8.pack_registry_id')
      !== root.binding.packRegistryId
    || id(object.fields.base_registry_id, 'OwnedBaseItemV8.base_registry_id')
      !== root.binding.baseRegistryId) {
    fail('readback', 'MAKER_V8_OWNED_BASE_BINDING_MISMATCH', 'Owned Base Item differs from the activated Maker registries.');
  }
  return freeze({
    ...object,
    rootId: root.objectId,
    holder: wallet,
    partKey: text(object.fields.part_key, 'OwnedBaseItemV8.part_key'),
    itemKey: text(object.fields.item_key, 'OwnedBaseItemV8.item_key'),
    itemPayloadCommitment: hash(
      object.fields.item_payload_commitment,
      'OwnedBaseItemV8.item_payload_commitment',
    ),
    ownershipEpoch: decimal(object.fields.ownership_epoch, 'OwnedBaseItemV8.ownership_epoch'),
    transferable: object.fields.transferable === true,
    equipLock: equipLock(object.fields.equip_lock, 'OwnedBaseItemV8.equip_lock'),
  });
}

function parseOwnedExternalInventory(response, runtime, wallet) {
  const object = ownedHolderObject(
    response, makerV8ChainTypes(runtime).ownedExternalItem, runtime, wallet, 'OwnedExternalItemV8',
  );
  return freeze({
    ...object,
    productId: id(object.fields.product_id, 'OwnedExternalItemV8.product_id'),
    holder: wallet,
    productContentCommitment: hash(
      object.fields.product_content_commitment,
      'OwnedExternalItemV8.product_content_commitment',
    ),
    assetContentCommitment: hash(
      object.fields.asset_content_commitment,
      'OwnedExternalItemV8.asset_content_commitment',
    ),
    ownershipEpoch: decimal(object.fields.ownership_epoch, 'OwnedExternalItemV8.ownership_epoch'),
    transferable: object.fields.transferable === true,
    equipLock: equipLock(object.fields.equip_lock, 'OwnedExternalItemV8.equip_lock'),
  });
}

function parseMakerLoadoutInventory(response, runtime, wallet, root, verifiedBundles = new Map(), admission = 0) {
  const object = ownedHolderObject(
    response, makerV8ChainTypes(runtime).makerLoadout, runtime, wallet, 'MakerLoadoutV8',
  );
  exactRootInventoryBinding(object, root, 'MakerLoadoutV8');
  const attached = object.fields.attached_pack_definitions;
  if (!Array.isArray(attached)) {
    fail('readback', 'MAKER_V8_LOADOUT_LAYOUT_INVALID', 'Maker Loadout attached Pack definitions are unavailable.');
  }
  const expectedOwnedSlots = [];
  const attachedIds = new Set();
  if (attached.length > 500) fail('readback', 'MAKER_V8_LOADOUT_LAYOUT_INVALID', 'Too many attached Packs.');
  for (const raw of attached) {
    const binding = fieldsOf(raw, 'AttachedPackDefinitionV8');
    const releaseId = id(binding.release_id, 'AttachedPackDefinitionV8.release_id');
    const commitment = hash(binding.definition_commitment, 'AttachedPackDefinitionV8.definition_commitment');
    const bundle = verifiedBundles.get(releaseId);
    if (releaseId === root.objectId || attachedIds.has(releaseId) || !bundle || bundle.definitionCommitment !== commitment) {
      fail('readback', 'MAKER_V8_LOADOUT_LAYOUT_INVALID', 'Attachment does not match one verified Release bundle.');
    }
    attachedIds.add(releaseId);
    expectedOwnedSlots.push(...deriveMakerV8PackProfiles(bundle, admission).map(profile => ({ ...profile, releaseId })));
  }
  const slots = object.fields.definition_slots;
  const selections = object.fields.selections;
  if (!Array.isArray(slots) || !Array.isArray(selections)) {
    fail('readback', 'MAKER_V8_LOADOUT_LAYOUT_INVALID', 'Maker Loadout requires immutable definition slots.');
  }
  let end = 0n;
  const keys = new Set();
  let ownedIndex = 0;
  let reachedOwned = false;
  for (const row of slots) {
    const slot = fieldsOf(row, 'DefinitionSlotV8');
    const part = text(slot.part_key, 'DefinitionSlotV8.part_key');
    const capacity = BigInt(decimal(slot.capacity, 'DefinitionSlotV8.capacity'));
    hash(slot.profile_commitment, 'DefinitionSlotV8.profile_commitment');
    const sourceId = id(slot.source_definition_id, 'DefinitionSlotV8.source_definition_id');
    const scopedKey = `${sourceId}/${part}`;
    if (sourceId !== root.objectId) {
      reachedOwned = true;
      const expected = expectedOwnedSlots[ownedIndex++];
      if (!expected || sourceId !== expected.releaseId || part !== expected.partKey
        || capacity !== BigInt(expected.capacity)
        || hash(slot.profile_commitment, 'DefinitionSlotV8.profile_commitment') !== expected.profileCommitment) {
        fail('readback', 'MAKER_V8_LOADOUT_LAYOUT_INVALID', 'Owned slot differs from its exact ordered Pack profile.');
      }
    } else if (reachedOwned) fail('readback', 'MAKER_V8_LOADOUT_LAYOUT_INVALID', 'Base slots cannot follow attached Pack slots.');
    if (keys.has(scopedKey) || BigInt(decimal(slot.start, 'DefinitionSlotV8.start')) !== end
      || capacity === 0n || capacity > 64n || end + capacity > BigInt(selections.length) || end + capacity > 500n) {
      fail('readback', 'MAKER_V8_LOADOUT_LAYOUT_INVALID', 'Maker Loadout definition slot identity/range mismatch.');
    }
    for (let index = Number(end); index < Number(end + capacity); index++) {
      const selection = moveOption(selections[index], 'MakerLoadoutV8.selection');
      if (selection !== null && (selection.part_key !== part || String(selection.selection_index) !== String(index))) {
        fail('readback', 'MAKER_V8_LOADOUT_LAYOUT_INVALID', 'Maker Loadout selection differs from its definition slot.');
      }
    }
    keys.add(scopedKey); end += capacity;
  }
  if (ownedIndex !== expectedOwnedSlots.length) fail('readback', 'MAKER_V8_LOADOUT_LAYOUT_INVALID', 'Missing owned definition slots.');
  if (end !== BigInt(selections.length)) fail('readback', 'MAKER_V8_LOADOUT_LAYOUT_INVALID', 'Maker Loadout slot coverage mismatch.');
  if (id(object.fields.definition_registry_id, 'MakerLoadoutV8.definition_registry_id')
      !== root.binding.runtimeDefinitionRegistryId
    || id(object.fields.pack_registry_id, 'MakerLoadoutV8.pack_registry_id')
      !== root.binding.packRegistryId) {
    fail('readback', 'MAKER_V8_LOADOUT_BINDING_MISMATCH', 'Maker Loadout differs from the activated Runtime registries.');
  }
  return freeze({
    ...object,
    rootId: root.objectId,
    holder: wallet,
    revision: decimal(object.fields.revision, 'MakerLoadoutV8.revision'),
    selectionCount: decimal(object.fields.selection_count, 'MakerLoadoutV8.selection_count'),
    commitment: hash(object.fields.commitment, 'MakerLoadoutV8.commitment'),
    attachedPackDefinitions: freeze(attached),
    packDefinitionLayout: freeze({
      bindings: freeze(attached.map(raw => {
        const binding = fieldsOf(raw, 'AttachedPackDefinitionV8');
        return freeze({ releaseId: id(binding.release_id, 'AttachedPackDefinitionV8.release_id'),
          definitionCommitment: hash(binding.definition_commitment, 'AttachedPackDefinitionV8.definition_commitment') });
      })),
      profiles: freeze(expectedOwnedSlots),
    }),
    definitionSlots: freeze(object.fields.definition_slots),
    selections: freeze(object.fields.selections),
  });
}

function parseOwnedControlCap(response, expectedType, wallet, label, targetField) {
  const object = parsedObject(response, expectedType, MAKER_V8_CHAIN_NETWORK, label);
  if (object.owner.kind !== 'address' || object.owner.address !== wallet
    || address(object.fields.owner, `${label}.owner`) !== wallet) {
    fail('readback', 'MAKER_V8_INVENTORY_OWNER_MISMATCH', `${label} is not held by the connected wallet.`);
  }
  return freeze({
    ...object,
    targetId: id(object.fields[targetField], `${label}.${targetField}`),
    controlEpoch: decimal(object.fields.control_epoch, `${label}.control_epoch`),
  });
}

function parsePackReleaseInventory(response, runtime, root, cap) {
  const object = parsedObject(
    response, makerV8ChainTypes(runtime).packRelease, MAKER_V8_CHAIN_NETWORK, 'PackReleaseV8',
  );
  exactRootInventoryBinding(object, root, 'PackReleaseV8');
  if (object.owner.kind !== 'shared' || object.objectId !== cap.targetId
    || id(object.fields.admin_cap_id, 'PackReleaseV8.admin_cap_id') !== cap.objectId
    || address(object.fields.owner, 'PackReleaseV8.owner') !== cap.owner.address
    || decimal(object.fields.control_epoch, 'PackReleaseV8.control_epoch') !== cap.controlEpoch) {
    fail('readback', 'MAKER_V8_PACK_CONTROL_MISMATCH', 'Pack control cap and shared Release differ.');
  }
  return freeze({
    ...object,
    adminCap: cap,
    rootId: root.objectId,
    treasuryId: id(object.fields.treasury_id, 'PackReleaseV8.treasury_id'),
    semanticPackId: text(object.fields.semantic_pack_id, 'PackReleaseV8.semantic_pack_id'),
    contentCommitment: hash(object.fields.content_commitment, 'PackReleaseV8.content_commitment'),
    lifecycle: Number(decimal(object.fields.lifecycle, 'PackReleaseV8.lifecycle')),
  });
}

function parsePackReleasePublic(response, runtime, root) {
  const object = parsedObject(
    response, makerV8ChainTypes(runtime).packRelease, MAKER_V8_CHAIN_NETWORK, 'PackReleaseV8',
  );
  exactRootInventoryBinding(object, root, 'PackReleaseV8');
  if (object.owner.kind !== 'shared' || decimal(object.fields.version, 'PackReleaseV8.version') !== 8n) {
    fail('readback', 'MAKER_V8_PACK_ACCESS_RELEASE_MISMATCH', 'Pack Release must be the exact current shared Runtime object.');
  }
  const kind = Number(decimal(object.fields.access_kind, 'PackReleaseV8.access_kind'));
  const price = decimal(object.fields.access_price_atomic, 'PackReleaseV8.access_price_atomic');
  if (![0, 1, 2].includes(kind) || price > 1_000_000_000_000n || (kind === 1 ? price === 0n : price !== 0n)) {
    fail('readback', 'MAKER_V8_PACK_ACCESS_POLICY_INVALID', 'Pack entry kind and exact price do not form a valid Runtime access policy.');
  }
  return freeze({
    ...object,
    rootId: root.objectId,
    semanticPackId: text(object.fields.semantic_pack_id, 'PackReleaseV8.semantic_pack_id'),
    manifestBlobId: text(object.fields.manifest_blob_id, 'PackReleaseV8.manifest_blob_id'),
    manifestSha256: hash(object.fields.manifest_sha256, 'PackReleaseV8.manifest_sha256'),
    contentCommitment: hash(object.fields.content_commitment, 'PackReleaseV8.content_commitment'),
    lifecycle: Number(decimal(object.fields.lifecycle, 'PackReleaseV8.lifecycle')),
    expectedStyleCount: decimal(
      object.fields.expected_style_count,
      'PackReleaseV8.expected_style_count',
    ).toString(),
    entry: freeze({ kind, priceAtomic: price.toString(), paymentCoinType: runtime.paymentCoinType }),
  });
}

function parsePackReleaseAccess(response, runtime, root, pass) {
  const release = parsePackReleasePublic(response, runtime, root);
  if (release.objectId !== pass.releaseId || release.contentCommitment !== pass.releaseContentCommitment) {
    fail('readback', 'MAKER_V8_PACK_ACCESS_RELEASE_MISMATCH', 'PackPass and shared Pack Release differ.');
  }
  return release;
}

function tableId(value, label) {
  return id(
    value?.fields?.id?.id
      ?? value?.fields?.id
      ?? value?.id?.id
      ?? value?.id
      ?? value,
    label,
  );
}

async function readActivePackAdmission(rpc, runtime, registry, release) {
  if (typeof rpc?.getDynamicField !== 'function') {
    fail('config', 'MAKER_V8_RPC_INVALID', 'Pack access projection requires the official gRPC dynamic-field point reader.');
  }
  const nameBytes = bcs.Address.serialize(release.objectId).toBytes();
  const valueType = makerV8StableType(runtime, 'runtime', 'runtime_v8', 'PackAdmissionRecordV8');
  const field = await rpc.getDynamicField({
    parentId: tableId(registry.fields.releases, 'PackRegistryV8.releases.tableId'),
    name: {
      type: normalizeStructTag('0x2::object::ID'),
      bcsBase64: toBase64(nameBytes),
    },
  });
  if (!record(field) || field.kind !== 'DynamicField'
    || normalizeStructTag(field.name?.type) !== normalizeStructTag('0x2::object::ID')
    || field.name?.bcsBase64 !== toBase64(nameBytes)
    || normalizeStructTag(field.value?.type) !== normalizeStructTag(valueType)) {
    fail('readback', 'MAKER_V8_PACK_ADMISSION_DRIFT', 'Pack admission dynamic field has another exact key or TypeOrigin.');
  }
  const raw = fromBase64(field.value.bcsBase64);
  let parsed;
  let roundtrip;
  try {
    parsed = PACK_ADMISSION_RECORD_BCS.parse(raw);
    roundtrip = PACK_ADMISSION_RECORD_BCS.serialize(parsed).toBytes();
  } catch {
    fail('readback', 'MAKER_V8_PACK_ADMISSION_BCS_INVALID', 'Pack admission cannot be canonically decoded.');
  }
  if (roundtrip.length !== raw.length
    || roundtrip.some((byte, index) => byte !== raw[index])
    || id(parsed.release_id, 'PackAdmissionRecordV8.release_id') !== release.objectId
    || text(parsed.semantic_pack_id, 'PackAdmissionRecordV8.semantic_pack_id') !== release.semanticPackId
    || hash(parsed.release_content_commitment, 'PackAdmissionRecordV8.release_content_commitment')
      !== release.contentCommitment
    || Number(decimal(parsed.admission_state, 'PackAdmissionRecordV8.admission_state')) !== 0) {
    fail('readback', 'MAKER_V8_PACK_ADMISSION_DRIFT', 'Pack admission differs from the exact active Release.');
  }
  return freeze({
    admittedRevision: decimal(parsed.admitted_revision, 'PackAdmissionRecordV8.admitted_revision').toString(),
    admissionState: 0,
  });
}

function assertPackObjectBcs(response, object, schema) {
  let decoded;
  try {
    const encoded = response.data.bcs;
    if (encoded?.dataType !== 'moveObject' || !typeEquals(encoded.type, object.type)) throw new Error();
    const raw = fromBase64(encoded.bcsBytes);
    decoded = schema.parse(raw);
    if (toBase64(raw) !== encoded.bcsBytes || toBase64(schema.serialize(decoded).toBytes()) !== encoded.bcsBytes) throw new Error();
  } catch {
    fail('readback', 'MAKER_V8_PACK_DISCOVERY_BCS_INVALID', 'Public Pack discovery requires exact canonical registry and Release BCS.');
  }
  // All vectors in these two layouts are SHA-256 commitments. Normalize only
  // those fields for the existing exact JSON/BCS comparator; never infer types
  // from an untrusted JSON array or accept a JSON-only metadata substitute.
  const normalized = { ...object.fields };
  for (const [key, value] of Object.entries(decoded)) {
    if (Array.isArray(value)) normalized[key] = [...fromHex(hash(normalized[key], key))];
  }
  try { authorityJsonMatches(normalized, decoded, 'Pack discovery JSON/BCS'); }
  catch { fail('readback', 'MAKER_V8_PACK_DISCOVERY_BCS_INVALID', 'Public Pack object JSON differs from its canonical Move bytes.'); }
}

function parsePublicPackAdmission(field, runtime, parentId) {
  const keyType = normalizeStructTag('0x2::object::ID');
  const valueType = makerV8StableType(runtime, 'runtime', 'runtime_v8', 'PackAdmissionRecordV8');
  let releaseId, row;
  try {
    const key = fromBase64(field.name.bcsBase64);
    releaseId = id(bcs.Address.parse(key), 'Pack admission key');
    const value = fromBase64(field.value.bcsBase64);
    row = PACK_ADMISSION_RECORD_BCS.parse(value);
    if (field.kind !== 'DynamicField' || field.childId !== null
      || !typeEquals(field.name.type, keyType) || !typeEquals(field.value.type, valueType)
      || !typeEquals(field.type, normalizeStructTag(`0x2::dynamic_field::Field<${keyType},${valueType}>`))
      || field.fieldId !== deriveDynamicFieldID(parentId, keyType, key)
      || toBase64(bcs.Address.serialize(releaseId).toBytes()) !== field.name.bcsBase64
      || toBase64(PACK_ADMISSION_RECORD_BCS.serialize(row).toBytes()) !== field.value.bcsBase64
      || id(row.release_id, 'Pack admission release') !== releaseId
      || ![0, 1].includes(row.admission_state)) throw new Error();
  } catch {
    fail('readback', 'MAKER_V8_PACK_ADMISSION_DRIFT', 'Public Pack admission has another exact key, field identity, TypeOrigin or canonical BCS.');
  }
  return freeze({ releaseId, semanticPackId: text(row.semantic_pack_id, 'Pack admission semantic ID'),
    contentCommitment: hash(row.release_content_commitment, 'Pack admission commitment'),
    admittedRevision: decimal(row.admitted_revision, 'Pack admission revision', { positive: true }).toString(),
    admissionState: row.admission_state });
}

/** Public choices come from the exact Root-bound admission table, never owned
 * Pass enumeration or unverified events. Paused/archived/revoked releases are
 * excluded from acquisition; a changed registry requires a fresh complete read.
 * This is current readback, not a guarantee against a later on-chain change. */
export async function discoverMakerV8PackReleases(rpc, runtimeInput, rootInput, { network: observedNetwork = MAKER_V8_CHAIN_NETWORK } = {}) {
  const runtime = assertMakerV8Runtime(runtimeInput);
  network(observedNetwork);
  await assertMakerV8MainnetRpc(rpc);
  if (!record(rootInput) || rootInput.lifecycle !== 'ACTIVE') {
    fail('readback', 'MAKER_V8_PACK_ROOT_INACTIVE', 'Pack acquisition discovery requires the exact ACTIVE Maker Root.');
  }
  for (const method of ['getObject', 'listDynamicFields', 'getDynamicField']) {
    if (typeof rpc?.[method] !== 'function') fail('config', 'MAKER_V8_RPC_INVALID', 'Pack discovery requires the official current object and dynamic-field readers.');
  }
  const options = { showType: true, showContent: true, showOwner: true, showBcs: true };
  const registryId = id(rootInput.binding?.packRegistryId, 'Root Pack registry');
  const readRegistry = async () => {
    const response = await rpc.getObject({ id: registryId, options });
    const registry = parsedObject(response, makerV8ChainTypes(runtime).packRegistry, observedNetwork, 'PackRegistryV8');
    exactRootInventoryBinding(registry, rootInput, 'PackRegistryV8');
    if (registry.objectId !== registryId || registry.owner.kind !== 'shared'
      || decimal(registry.fields.version, 'Pack registry version') !== 8n
      || id(registry.fields.definition_registry_id, 'Pack definition registry') !== rootInput.binding.runtimeDefinitionRegistryId
      || id(registry.fields.admission_authority_id, 'Pack admission authority') !== rootInput.binding.packAdmissionAuthorityId
      || hash(registry.fields.admission_policy_commitment, 'Pack admission policy')
        !== hash(rootInput.fields.expected_pack_admission_policy_commitment, 'Root admission policy')) {
      fail('readback', 'MAKER_V8_PACK_REGISTRY_BINDING_MISMATCH', 'Pack registry is not the exact shared Root-bound admission authority.');
    }
    assertPackObjectBcs(response, registry, PACK_REGISTRY_BCS);
    return registry;
  };
  const registry = await readRegistry();
  const parentId = tableId(registry.fields.releases, 'Pack releases table');
  const rows = await allPages(cursor => rpc.listDynamicFields({ parentId, cursor, limit: 100 }));
  const count = decimal(registry.fields.release_count, 'Pack release count');
  if (BigInt(rows.length) !== count || decimal(fieldsOf(registry.fields.releases).size, 'Pack releases table size') !== count) {
    fail('stale', 'MAKER_V8_PACK_DISCOVERY_CHANGED', 'Pack admission enumeration differs from its registry count; refresh before acquiring.');
  }
  const ids = new Set(), semanticIds = new Set(), releases = [];
  for (const row of rows) {
    const listed = parsePublicPackAdmission(row, runtime, parentId);
    if (ids.has(listed.releaseId) || semanticIds.has(listed.semanticPackId)
      || BigInt(listed.admittedRevision) > decimal(registry.fields.revision, 'Pack registry revision')) {
      fail('readback', 'MAKER_V8_PACK_ADMISSION_DRIFT', 'Pack discovery contains duplicate identities or a future admission revision.');
    }
    ids.add(listed.releaseId); semanticIds.add(listed.semanticPackId);
    const point = await rpc.getDynamicField({ parentId, name: { ...row.name } });
    const admission = parsePublicPackAdmission(point, runtime, parentId);
    if (JSON.stringify(admission) !== JSON.stringify(listed)) {
      fail('stale', 'MAKER_V8_PACK_DISCOVERY_CHANGED', 'Pack admission changed between enumeration and point read; refresh before acquiring.');
    }
    if (admission.admissionState !== 0) continue;
    const response = await rpc.getObject({ id: admission.releaseId, options });
    const release = parsePackReleasePublic(response, runtime, rootInput);
    assertPackObjectBcs(response, release, PACK_RELEASE_BCS);
    if (release.objectId !== admission.releaseId || release.semanticPackId !== admission.semanticPackId
      || release.contentCommitment !== admission.contentCommitment || ![2, 3, 4].includes(release.lifecycle)) {
      fail('readback', 'MAKER_V8_PACK_ADMISSION_DRIFT', 'Admitted Pack Release differs from its registry identity or valid post-admission lifecycle.');
    }
    if (release.lifecycle === 2) releases.push(freeze({ ...release,
      admission: freeze({ admittedRevision: admission.admittedRevision, admissionState: 0 }),
      registryRef: registry.objectRef, registryRevision: String(registry.fields.revision) }));
  }
  const after = await readRegistry();
  if (after.version !== registry.version || after.digest !== registry.digest
    || JSON.stringify(after.fields) !== JSON.stringify(registry.fields)) {
    fail('stale', 'MAKER_V8_PACK_DISCOVERY_CHANGED', 'Pack registry changed during discovery; refresh before acquiring.');
  }
  return freeze(releases.sort((left, right) => left.objectId.localeCompare(right.objectId)));
}

const EXTERNAL_CHOICE_ADMISSION_BCS = bcs.struct('ExternalAdmissionRecordV8', {
  product_id: bcs.Address, compatibility_commitment: bcs.vector(bcs.u8()), product_content_commitment: bcs.vector(bcs.u8()),
  attestation_commitment: bcs.option(bcs.vector(bcs.u8())), admitted_revision: bcs.u64(), admission_state: bcs.u8(),
});
async function readExternalChoiceAdmission(rpc, runtime, registry, product) {
  if (typeof rpc.getDynamicField !== 'function') fail('config', 'MAKER_V8_RPC_INVALID', 'External choices require the official dynamic-field point reader.');
  const parentId = tableId(registry.fields.external_admissions, 'PackRegistry.external_admissions');
  const keyType = normalizeStructTag('0x2::object::ID');
  const nameBytes = bcs.Address.serialize(product.objectId).toBytes();
  const fieldId = deriveDynamicFieldID(parentId, keyType, nameBytes);
  let field;
  try { field = await rpc.getDynamicField({ parentId, name: { type: keyType, bcsBase64: toBase64(nameBytes) } }); }
  catch (error) {
    if (error instanceof ObjectError && error.reason === 'notFound' && error.objectId === fieldId) return null;
    throw error;
  }
  const valueType = makerV8StableType(runtime, 'runtime', 'runtime_v8', 'ExternalAdmissionRecordV8');
  if (!record(field) || field.kind !== 'DynamicField' || normalizeStructTag(field.name?.type) !== keyType
    || field.name?.bcsBase64 !== toBase64(nameBytes) || normalizeStructTag(field.value?.type) !== normalizeStructTag(valueType)) {
    fail('readback', 'MAKER_V8_EXTERNAL_ADMISSION_DRIFT', 'External admission key or TypeOrigin differs.');
  }
  const raw = fromBase64(field.value.bcsBase64);
  const row = EXTERNAL_CHOICE_ADMISSION_BCS.parse(raw);
  const encoded = EXTERNAL_CHOICE_ADMISSION_BCS.serialize(row).toBytes();
  if (toBase64(raw) !== field.value.bcsBase64 || raw.length !== encoded.length || raw.some((v, i) => v !== encoded[i])
    || id(row.product_id, 'admission.product') !== product.objectId
    || hash(row.compatibility_commitment, 'admission.compatibility') !== product.compatibilityCommitment
    || hash(row.product_content_commitment, 'admission.content') !== product.contentCommitment
    || ![0, 1].includes(Number(row.admission_state))
    || decimal(row.admitted_revision, 'admission.revision') === 0n) {
    fail('readback', 'MAKER_V8_EXTERNAL_ADMISSION_DRIFT', 'External admission differs from its exact Product.');
  }
  return freeze({ productId: product.objectId, compatibilityCommitment: product.compatibilityCommitment,
    productContentCommitment: product.contentCommitment, admittedRevision: String(row.admitted_revision),
    admissionState: Number(row.admission_state), attestationCommitment: row.attestation_commitment === null ? null : hash(row.attestation_commitment, 'admission.attestation') });
}

function parseExternalProductInventory(response, runtime, root, cap = null) {
  const object = parsedObject(
    response,
    makerV8ChainTypes(runtime).externalItemProduct,
    MAKER_V8_CHAIN_NETWORK,
    'ExternalItemProductV8',
  );
  exactRootInventoryBinding(object, root, 'ExternalItemProductV8');
  if (object.owner.kind !== 'shared'
    || cap && (object.objectId !== cap.targetId
      || id(object.fields.admin_cap_id, 'ExternalItemProductV8.admin_cap_id') !== cap.objectId
      || address(object.fields.owner, 'ExternalItemProductV8.owner') !== cap.owner.address
      || decimal(object.fields.control_epoch, 'ExternalItemProductV8.control_epoch')
        !== cap.controlEpoch)) {
    fail('readback', 'MAKER_V8_EXTERNAL_CONTROL_MISMATCH', 'External Product control or shared custody differs.');
  }
  const colorChannel = moveOption(
    object.fields.color_channel_key,
    'ExternalItemProductV8.color_channel_key',
  );
  const defaultSwatch = moveOption(
    object.fields.default_swatch_key,
    'ExternalItemProductV8.default_swatch_key',
  );
  const assetMediaType = text(
    object.fields.asset_media_type,
    'ExternalItemProductV8.asset_media_type',
  );
  const assetByteLength = Number(decimal(
    object.fields.asset_byte_length,
    'ExternalItemProductV8.asset_byte_length',
  ));
  if (!RENDERABLE_MEDIA_TYPES.has(assetMediaType)
    || !Number.isSafeInteger(assetByteLength)
    || assetByteLength < 1 || assetByteLength > MAX_CERTIFIED_ASSET_BYTES) {
    fail(
      'readback',
      'MAKER_V8_EXTERNAL_ASSET_METADATA_INVALID',
      'External Product render metadata is unsafe or outside the v8 asset budget.',
    );
  }
  return freeze({
    ...object,
    rootId: root.objectId,
    partKey: text(object.fields.part_key, 'ExternalItemProductV8.part_key'),
    itemKey: text(object.fields.item_key, 'ExternalItemProductV8.item_key'),
    styleKey: text(object.fields.style_key, 'ExternalItemProductV8.style_key'),
    trackKey: text(object.fields.layer_track_key, 'ExternalItemProductV8.layer_track_key'),
    colorChannelKey: colorChannel === null
      ? null : text(colorChannel, 'ExternalItemProductV8.color_channel_key'),
    defaultSwatchKey: defaultSwatch === null
      ? null : text(defaultSwatch, 'ExternalItemProductV8.default_swatch_key'),
    assetBlobId: text(object.fields.asset_blob_id, 'ExternalItemProductV8.asset_blob_id'),
    assetSha256: hash(object.fields.asset_sha256, 'ExternalItemProductV8.asset_sha256'),
    assetMediaType,
    assetByteLength,
    lifecycle: Number(decimal(object.fields.lifecycle, 'ExternalItemProductV8.lifecycle')),
    contentCommitment: hash(object.fields.content_commitment, 'ExternalItemProductV8.content_commitment'),
    compatibilityCommitment: hash(object.fields.compatibility_commitment, 'ExternalItemProductV8.compatibility_commitment'),
    assetContentCommitment: hash(
      object.fields.asset_content_commitment,
      'ExternalItemProductV8.asset_content_commitment',
    ),
    transferable: object.fields.transferable === true,
    ...(cap ? { adminCap: cap } : {}),
  });
}

export async function listOwnedMakerV8Inventory(rpc, runtimeInput, walletAddress, rootInput, { network: observedNetwork = MAKER_V8_CHAIN_NETWORK } = {}) {
  const runtime = assertMakerV8Runtime(runtimeInput);
  const wallet = address(walletAddress, 'wallet.address');
  network(observedNetwork);
  await assertMakerV8MainnetRpc(rpc);
  if (typeof rpc?.getOwnedObjects !== 'function') fail('config', 'MAKER_V8_RPC_INVALID', 'RPC getOwnedObjects is required.');
  const types = makerV8ChainTypes(runtime);
  const [
    adminRows,
    makerAccessRows,
    packAdminRows,
    packPassRows,
    externalAdminRows,
    ownedExternalRows,
    ownedBaseRows,
    loadoutRows,
    outputRows,
    receiptRows,
    soulRows,
    physicalRows,
  ] = await Promise.all([
    ownedByType(rpc, wallet, types.adminCap),
    ownedByType(rpc, wallet, types.makerAccess),
    ownedByType(rpc, wallet, types.packAdminCap),
    ownedByType(rpc, wallet, types.packPass),
    ownedByType(rpc, wallet, types.externalItemAdminCap),
    ownedByType(rpc, wallet, types.ownedExternalItem),
    ownedByType(rpc, wallet, types.ownedBaseItem),
    ownedByType(rpc, wallet, types.makerLoadout),
    ownedByType(rpc, wallet, types.completeOutput),
    ownedByType(rpc, wallet, types.completeReceipt),
    ownedByType(rpc, wallet, types.canonicalSoul),
    ownedByType(rpc, wallet, types.physicalAsset),
  ]);
  const selectedRoot = (entry, label) => (
    id(fieldsOf(entry.data?.content?.fields, `${label}.fields`).root_id, `${label}.root_id`)
      === rootInput.objectId
  );
  const selectedAdmins = adminRows.filter((entry) => selectedRoot(entry, 'admin'));
  const selectedMakerAccess = makerAccessRows.filter((entry) => selectedRoot(entry, 'makerAccess'));
  const selectedPackPasses = packPassRows.filter((entry) => selectedRoot(entry, 'packPass'));
  const selectedOwnedBase = ownedBaseRows.filter((entry) => selectedRoot(entry, 'ownedBase'));
  const selectedLoadouts = loadoutRows.filter((entry) => selectedRoot(entry, 'loadout'));
  const selectedOutputs = outputRows.filter((entry) => selectedRoot(entry, 'output'));
  const selectedReceipts = receiptRows.filter((entry) => selectedRoot(entry, 'receipt'));
  const selectedSouls = soulRows.filter((entry) => selectedRoot(entry, 'soul'));
  const selectedPhysical = physicalRows.filter((entry) => selectedRoot(entry, 'physical'));
  const adminCaps = selectedAdmins.map((entry) => parseMakerAdminCapV8(entry, runtime, wallet, rootInput, observedNetwork));
  const makerAccessPasses = selectedMakerAccess.map((entry) => (
    parseMakerAccessInventory(entry, runtime, wallet, rootInput)
  ));
  const packPasses = selectedPackPasses.map((entry) => (
    parsePackPassInventory(entry, runtime, wallet, rootInput)
  ));
  const ownedBaseItems = selectedOwnedBase.map((entry) => (
    parseOwnedBaseInventory(entry, runtime, wallet, rootInput)
  ));
  const attachmentIds = new Set();
  for (const entry of selectedLoadouts) {
    const bindings = fieldsOf(entry.data?.content?.fields, 'MakerLoadoutV8.fields').attached_pack_definitions;
    if (!Array.isArray(bindings) || bindings.length > 500) fail('readback', 'MAKER_V8_LOADOUT_LAYOUT_INVALID', 'Invalid attachment list.');
    const seen = new Set();
    for (const raw of bindings) {
      const binding = fieldsOf(raw, 'AttachedPackDefinitionV8');
      const releaseId = id(binding.release_id, 'AttachedPackDefinitionV8.release_id');
      hash(binding.definition_commitment, 'AttachedPackDefinitionV8.definition_commitment');
      if (seen.has(releaseId) || releaseId === rootInput.objectId) fail('readback', 'MAKER_V8_LOADOUT_LAYOUT_INVALID', 'Duplicate or Root attachment.');
      seen.add(releaseId); attachmentIds.add(releaseId);
    }
  }

  const packCaps = packAdminRows.map((entry) => parseOwnedControlCap(
    entry, types.packAdminCap, wallet, 'PackAdminCapV8', 'release_id',
  ));
  const externalCaps = externalAdminRows.map((entry) => parseOwnedControlCap(
    entry, types.externalItemAdminCap, wallet, 'ExternalItemAdminCapV8', 'product_id',
  ));
  const parsedExternalItems = ownedExternalRows.map((entry) => (
    parseOwnedExternalInventory(entry, runtime, wallet)
  ));
  const relatedIds = [...new Set([
    ...attachmentIds,
    ...packCaps.map((entry) => entry.targetId),
    ...packPasses.map((entry) => entry.releaseId),
    ...externalCaps.map((entry) => entry.targetId),
    ...parsedExternalItems.map((entry) => entry.productId),
  ])];
  if (relatedIds.length && typeof rpc?.getObject !== 'function') {
    fail('config', 'MAKER_V8_RPC_INVALID', 'RPC getObject is required for owned Pack/external inventory certification.');
  }
  const relatedObjects = new Map((await Promise.all(relatedIds.map(async (objectId) => [
    objectId,
    await rpc.getObject({
      id: objectId,
      options: { showType: true, showContent: true, showOwner: true },
    }),
  ]))).map(([objectId, response]) => [objectId, response]));
  const verifiedBundles = new Map();
  let profileAdmission = 0;
  if (attachmentIds.size) {
    const definitions = parsedObject(await rpc.getObject({ id: rootInput.binding.runtimeDefinitionRegistryId,
      options: { showType: true, showContent: true, showOwner: true } }), types.runtimeDefinitions, observedNetwork, 'RuntimeDefinitionRegistryV8');
    exactRootInventoryBinding(definitions, rootInput, 'RuntimeDefinitionRegistryV8');
    profileAdmission = Number(decimal(definitions.fields.admission_ceiling, 'RuntimeDefinitionRegistryV8.admission_ceiling'));
    if (definitions.objectId !== rootInput.binding.runtimeDefinitionRegistryId || definitions.owner.kind !== 'shared'
      || definitions.fields.sealed !== true || decimal(definitions.fields.version, 'RuntimeDefinitionRegistryV8.version') !== 8n
      || id(definitions.fields.base_registry_id, 'RuntimeDefinitionRegistryV8.base_registry_id') !== rootInput.binding.baseRegistryId
      || ![0, 1, 2].includes(profileAdmission)) {
      fail('readback', 'MAKER_V8_LOADOUT_LAYOUT_INVALID', 'Attached profiles require the exact sealed Runtime definition registry.');
    }
    for (const releaseId of attachmentIds) {
      const release = parsePackReleasePublic(relatedObjects.get(releaseId), runtime, rootInput);
      if (release.objectId !== releaseId) fail('readback', 'MAKER_V8_LOADOUT_LAYOUT_INVALID', 'Foreign attachment Release.');
      verifiedBundles.set(releaseId, await readMakerV8PackDefinitions(rpc, {
        runtimeOriginalPackageId: makerV8StableType(runtime, 'runtime', 'runtime_v8', 'PackDefinitionsV8').split('::')[0],
        releaseId, semanticPackId: release.semanticPackId, contentCommitment: release.contentCommitment,
      }));
    }
  }
  const makerLoadouts = selectedLoadouts.map(entry => parseMakerLoadoutInventory(entry, runtime, wallet, rootInput, verifiedBundles, profileAdmission));
  const belongsToRoot = (response, label) => (
    id(fieldsOf(response?.data?.content?.fields, `${label}.fields`).root_id, `${label}.root_id`)
      === rootInput.objectId
  );
  const packControls = packCaps.filter((cap) => (
    belongsToRoot(relatedObjects.get(cap.targetId), 'PackReleaseV8')
  )).map((cap) => parsePackReleaseInventory(
    relatedObjects.get(cap.targetId), runtime, rootInput, cap,
  ));
  let certifiedPackPasses = packPasses;
  if (packPasses.length) {
    const packRegistryResponse = await rpc.getObject({
      id: rootInput.binding.packRegistryId,
      options: { showType: true, showContent: true, showOwner: true },
    });
    const packRegistry = parsedObject(
      packRegistryResponse,
      types.packRegistry,
      observedNetwork,
      'PackRegistryV8',
    );
    exactRootInventoryBinding(packRegistry, rootInput, 'PackRegistryV8');
    certifiedPackPasses = await Promise.all(packPasses.map(async (pass) => {
      const release = parsePackReleaseAccess(
        relatedObjects.get(pass.releaseId), runtime, rootInput, pass,
      );
      if (release.lifecycle !== 2) {
        fail('readback', 'MAKER_V8_PACK_RELEASE_INACTIVE', 'PackPass references a non-active Pack Release.');
      }
      const admission = await readActivePackAdmission(rpc, runtime, packRegistry, release);
      return freeze({ ...pass, release, admission });
    }));
  }
  const externalControls = externalCaps.filter((cap) => (
    belongsToRoot(relatedObjects.get(cap.targetId), 'ExternalItemProductV8')
  )).map((cap) => parseExternalProductInventory(
    relatedObjects.get(cap.targetId), runtime, rootInput, cap,
  ));
  const externalProducts = new Map();
  for (const item of parsedExternalItems) {
    const response = relatedObjects.get(item.productId);
    if (!belongsToRoot(response, 'ExternalItemProductV8')) continue;
    if (!externalProducts.has(item.productId)) {
      externalProducts.set(
        item.productId,
        parseExternalProductInventory(response, runtime, rootInput),
      );
    }
  }
  if (externalProducts.size) {
    const registry = parsedObject(await rpc.getObject({ id: rootInput.binding.packRegistryId,
      options: { showType: true, showContent: true, showOwner: true } }), types.packRegistry, observedNetwork, 'PackRegistryV8');
    exactRootInventoryBinding(registry, rootInput, 'PackRegistryV8');
    if (registry.owner.kind !== 'shared' || registry.objectId !== rootInput.binding.packRegistryId) {
      fail('readback', 'MAKER_V8_EXTERNAL_ADMISSION_DRIFT', 'External admission registry must be the exact shared Root-bound object.');
    }
    for (const [productId, product] of externalProducts) externalProducts.set(productId,
      freeze({ ...product, admission: await readExternalChoiceAdmission(rpc, runtime, registry, product) }));
  }
  const ownedExternalItems = parsedExternalItems.filter((item) => externalProducts.has(item.productId))
    .map((item) => freeze({ ...item, product: externalProducts.get(item.productId) }));
  const outputs = new Map(selectedOutputs.map((entry) => [id(entry.data?.objectId, 'output.objectId'), entry]));
  const receipts = new Map(selectedReceipts.map((entry) => [id(entry.data?.objectId, 'receipt.objectId'), entry]));
  const soulBundles = selectedSouls.map((soulResponse) => {
    const soulFields = fieldsOf(soulResponse.data?.content?.fields, 'soul.fields');
    const outputId = id(soulFields.output_id, 'soul.output_id');
    const receiptId = id(soulFields.receipt_id, 'soul.receipt_id');
    if (!outputs.has(outputId) || !receipts.has(receiptId)) fail('readback', 'MAKER_V8_SOUL_BUNDLE_INCOMPLETE', 'Owned Soul is missing its exact Output or Receipt.');
    return parseSoulBundleV8({ output: outputs.get(outputId), receipt: receipts.get(receiptId), soul: soulResponse }, runtime, wallet, rootInput, observedNetwork);
  });
  const physicalAssets = selectedPhysical.map((entry) => parsePhysicalAssetV8(entry, runtime, wallet, rootInput, observedNetwork));
  return freeze({
    network: observedNetwork,
    wallet,
    rootId: rootInput.objectId,
    adminCaps,
    makerAccessPasses,
    packControls,
    packPasses: certifiedPackPasses,
    externalControls,
    ownedExternalItems,
    ownedBaseItems,
    makerLoadouts,
    soulBundles,
    physicalAssets,
  });
}

export async function loadReceivingRefV8(rpc, runtimeInput, objectIdInput, listingIdInput, expectedType, { network: observedNetwork = MAKER_V8_CHAIN_NETWORK } = {}) {
  assertMakerV8Runtime(runtimeInput);
  const objectId = id(objectIdInput, 'receiving.objectId');
  const listingId = id(listingIdInput, 'receiving.listingId');
  network(observedNetwork);
  await assertMakerV8MainnetRpc(rpc);
  if (typeof rpc?.getObject !== 'function') fail('config', 'MAKER_V8_RPC_INVALID', 'RPC getObject is required.');
  const response = await rpc.getObject({ id: objectId, options: { showType: true, showContent: true, showOwner: true } });
  const object = parsedObject(response, expectedType, observedNetwork, 'Receiving child');
  if (object.owner.kind !== 'object' || object.owner.objectId !== listingId) {
    fail('stale', 'MAKER_V8_RECEIVING_OWNER_MISMATCH', 'Receiving child is not currently owned by the exact listing.', { expected: listingId, observed: object.owner });
  }
  return freeze({ ...object.objectRef, network: observedNetwork, type: object.type, listingId });
}

const FINALIZED_EVENT_BCS = bcs.struct('MakerV8FinalizedEvent', {
  package_id: bcs.Address,
  transaction_module: bcs.string(),
  sender: bcs.Address,
  event_type: bcs.StructTag,
  contents: bcs.vector(bcs.u8()),
});
const FINALIZED_EVENTS_BCS = bcs.struct('MakerV8FinalizedEvents', {
  data: bcs.vector(FINALIZED_EVENT_BCS),
});

function sameBytes(left, right) {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

function canonicalBcsBytes(value, schema, label) {
  if (!(value instanceof Uint8Array) || value.length === 0) {
    fail('readback', 'MAKER_V8_TRANSACTION_BCS_MISSING', `${label} BCS is required.`);
  }
  let parsed;
  let roundtrip;
  try {
    parsed = schema.parse(value);
    roundtrip = schema.serialize(parsed).toBytes();
  } catch (error) {
    fail('readback', 'MAKER_V8_TRANSACTION_BCS_INVALID', `${label} BCS is invalid.`, {
      cause: String(error?.message || error),
    });
  }
  if (!sameBytes(value, roundtrip)) {
    fail('readback', 'MAKER_V8_TRANSACTION_BCS_NONCANONICAL', `${label} BCS is not canonical.`);
  }
  return { bytes: value, parsed };
}

function typedBcsDigest(name, value) {
  const domain = new TextEncoder().encode(`${name}::`);
  const input = new Uint8Array(domain.length + value.length);
  input.set(domain);
  input.set(value, domain.length);
  return toBase58(blake2b(input, { dkLen: 32 }));
}

function finalizedEventsEvidence(events) {
  if (!Array.isArray(events)) {
    fail('readback', 'MAKER_V8_TRANSACTION_EVENTS_INVALID', 'Finalized Core events are unavailable.');
  }
  let encoded;
  try {
    encoded = FINALIZED_EVENTS_BCS.serialize({
      data: events.map((event, index) => ({
        package_id: address(event?.packageId, `events[${index}].packageId`),
        transaction_module: String(event?.module || ''),
        sender: address(event?.sender, `events[${index}].sender`),
        event_type: TypeTagSerializer.parseFromStr(
          normalizeStructTag(event?.eventType),
          true,
        ).struct,
        contents: event?.bcs,
      })),
    }).toBytes();
  } catch (error) {
    if (error instanceof MakerV8ChainError) throw error;
    fail('readback', 'MAKER_V8_TRANSACTION_EVENTS_INVALID', 'Finalized Core events cannot be encoded as exact TransactionEvents BCS.', {
      cause: String(error?.message || error),
    });
  }
  return freeze({ count: events.length, digest: typedBcsDigest('TransactionEvents', encoded) });
}

export async function readFinalizedMakerV8Transaction(rpc, digestInput, {
  network: observedNetwork = MAKER_V8_CHAIN_NETWORK,
  expectedSender,
  expectedEventTypes = [],
} = {}) {
  network(observedNetwork);
  await assertMakerV8MainnetRpc(rpc);
  const transactionDigest = digest(digestInput, 'transaction.digest');
  const sender = address(expectedSender, 'expectedSender');
  if (typeof rpc?.getTransactionFinality !== 'function'
    || typeof rpc?.core?.getTransaction !== 'function') {
    fail('config', 'MAKER_V8_GRPC_INVALID', 'Raw Ledger finality and Core getTransaction are required.');
  }
  let finality;
  let result;
  try {
    finality = await rpc.getTransactionFinality({ digest: transactionDigest });
    result = await rpc.core.getTransaction({
      digest: transactionDigest,
      include: { effects: true, events: true, objectTypes: true, transaction: true, bcs: true },
    });
  } catch (error) {
    fail('signed-outcome', 'MAKER_V8_SIGNED_OUTCOME_UNKNOWN', 'Signed transaction is not yet queryable; keep the exact signed bytes for query-first recovery.', { cause: String(error?.message || error) });
  }
  const transaction = result?.$kind === 'Transaction'
    ? result.Transaction
    : result?.$kind === 'FailedTransaction' ? result.FailedTransaction : null;
  if (!record(finality) || !record(result) || !record(transaction)
    || !['Transaction', 'FailedTransaction'].includes(result.$kind)
    || finality.digest !== transactionDigest
    || transaction.digest !== transactionDigest
    || !record(transaction.status)
    || !record(transaction.effects?.status)
    || finality.epoch !== transaction.epoch
    || finality.status?.success !== transaction.status.success
    || transaction.effects.transactionDigest !== transactionDigest
    || transaction.effects.status.success !== transaction.status.success) {
    fail('readback', 'MAKER_V8_TRANSACTION_READBACK_INVALID', 'gRPC finality/Core transaction readback is malformed or inconsistent.');
  }
  if (address(transaction.transaction?.sender, 'transaction.sender') !== sender) {
    fail('readback', 'MAKER_V8_TRANSACTION_SENDER_MISMATCH', 'Finalized transaction sender differs from the connected signer.');
  }
  if (result.$kind !== 'Transaction' || transaction.status.success !== true) {
    fail('finalized', 'MAKER_V8_FINALIZED_FAILURE', 'Transaction finalized with a Move failure.', {
      error: transaction.effects.status.error ?? transaction.status.error ?? finality.status.error ?? null,
    });
  }
  const events = Array.isArray(transaction.events) ? transaction.events : [];
  const observedTypes = new Set(events.map((event) => String(event.eventType).replace(/\s+/g, '')));
  expectedEventTypes.forEach((type) => {
    if (!observedTypes.has(String(type).replace(/\s+/g, ''))) {
      fail('readback', 'MAKER_V8_FINALIZED_EVENT_MISSING', `Finalized transaction omitted expected event ${type}.`);
    }
  });
  return freeze({
    network: observedNetwork,
    digest: transactionDigest,
    sender,
    checkpoint: finality.checkpoint,
    effects: transaction.effects,
    events,
    objectChanges: Array.isArray(transaction.effects.changedObjects)
      ? transaction.effects.changedObjects : [],
    raw: freeze({ finality, result }),
  });
}

export function createMakerV8ChainClient(runtimeInput, { rpc, network: observedNetwork = MAKER_V8_CHAIN_NETWORK } = {}) {
  const runtime = assertMakerV8Runtime(runtimeInput);
  network(observedNetwork);
  if (!rpc || typeof rpc !== 'object' || Array.isArray(rpc)) {
    fail('config', 'MAKER_V8_RPC_INVALID', 'A concrete Sui RPC client is required.');
  }
  return freeze({
    runtime,
    network: observedNetwork,
    types: makerV8ChainTypes(runtime),
    ready: () => assertMakerV8MainnetRpc(rpc),
    discover: () => discoverMakerV8Activations(rpc, runtime, { network: observedNetwork }),
    loadContext: (activation) => loadMakerV8Context(rpc, runtime, activation, { network: observedNetwork }),
    loadOperationalState: (root) => loadMakerV8OperationalState(rpc, runtime, root, { network: observedNetwork }),
    loadPackAuthoringContext: (root, wallet) => loadMakerV8PackAuthoringContext(
      rpc,
      runtime,
      root,
      wallet,
      { network: observedNetwork },
    ),
    discoverPackReleases: (root) => discoverMakerV8PackReleases(rpc, runtime, root, { network: observedNetwork }),
    loadPackDefinitions: (release) => readMakerV8PackDefinitions(rpc, {
      ...release, runtimeOriginalPackageId: makerV8StableType(runtime, 'runtime', 'runtime_v8', 'PackDefinitionsV8').split('::')[0],
    }),
    inventory: (wallet, root) => listOwnedMakerV8Inventory(rpc, runtime, wallet, root, { network: observedNetwork }),
    receivingRef: (objectId, listingId, expectedType) => loadReceivingRefV8(rpc, runtime, objectId, listingId, expectedType, { network: observedNetwork }),
    finalized: (transactionDigest, options) => readFinalizedMakerV8Transaction(rpc, transactionDigest, { ...options, network: observedNetwork }),
  });
}
