import { bcs } from '@mysten/sui/bcs';
import { ObjectError } from '@mysten/sui/client';
import { readMakerV8PackDefinitions, findMakerV8PackDefinitions } from './maker-v8-pack-definition-reader.js';
import { deriveMakerV8PackProfiles } from './maker-v8-profile-wire.js';
import { makerV8PackAttachmentOrder } from './maker-v8-player-slot-layout.js';
import { readMakerV8NativeContentEvidenceV8 } from './maker-v8-native-content-evidence.js';
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions';
import {
  fromBase58,
  fromBase64,
  normalizeStructTag,
  toBase64,
  deriveDynamicFieldID,
} from '@mysten/sui/utils';
import { isValidTransactionSignature } from '@mysten/sui/verify';
import { sha256 } from '@noble/hashes/sha2.js';
import { RpcError } from '@protobuf-ts/runtime-rpc';
import { SessionKey } from '@mysten/seal';
import { createMakerV8BrowserSealClient, createMakerV8DirectSealFetch,
  assertMakerV8BrowserSealServers } from './maker-v8-seal-browser.js';
import {
  assertMakerV8SealCiphertextV8,
  deriveMakerV8ProtectedAssetSealIdentityV8,
  MAKER_V8_PROTECTED_ASSET_IDENTITY_SCHEMA,
} from './maker-v8-protected-transport.js';
import { assertMakerV8PlayerProtocolCurrentV8 } from './maker-v8-player-protocol.js';
import * as nativeChain from './maker-v8-chain.js';
import {
  appendMakerV8NativeCompletionV8, assertMakerV8NativeCompletionInputV8,
  assertMakerV8NativeCompleteObjectsV8, MAKER_V8_NATIVE_BINDING_FIELDS,
  MAKER_V8_NATIVE_SOUL_FIELDS, MAKER_V8_NATIVE_STATE_FIELDS,
  MAKER_V8_NATIVE_KIOSK_ITEM_TYPE, readMakerV8NativeKioskItemV8,
} from './maker-v8-native-completion.js';

import {
  assertFinalizedMakerV8CompilerTransactionV8,
  createProductionMakerV8BrowserAdapters,
  readMakerV8CompilerHistoricalObjectV8,
} from './maker-v8-browser.js';
import {
  MAKER_V8_CHAIN_NETWORK,
  MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
  MAKER_V8_MAINNET_GENESIS_DIGEST,
  attestMakerV8Runtime,
  isMakerV8RuntimeAttested,
  makerV8ChainTypes,
  makerV8AttestedReplacement,
} from './maker-v8-chain.js';
import {
  MAKER_V8_PLAYER_ACTIONS,
  MAKER_V8_PLAYER_CONTEXT_SCHEMA,
  MAKER_V8_PLAYER_PLAN_SCHEMA,
  MAKER_V8_PLAYER_READBACK_SCHEMA,
  MAKER_V8_PROTECTED_RENDER_IDENTITY_SCHEMA,
  createMakerV8PlayerControllerV8,
  makerV8PlayerContextCommitmentV8,
  makerV8PlayerRecipeCommitmentV8,
} from './maker-v8-player-controller.js';
import {
  assertMakerV8Runtime,
  makerV8CallableTarget,
  makerV8StableType,
} from './maker-v8-runtime.js';
import {
  assertMakerV8SuiGrpcTransport,
  createProductionMakerV8SuiGrpcTransport,
} from './maker-v8-sui-grpc.js';

export const MAKER_V8_PLAYER_ADAPTERS_SCHEMA =
  'animacraft.maker-v8-player-adapters.v1';
export const MAKER_V8_PLAYER_DESCRIPTOR_SCHEMA =
  'animacraft.maker-v8-player-descriptor.v2';
export const MAKER_V8_PLAYER_DATABASE =
  'animacraft-maker-v8-player-mainnet-v1';
export const MAKER_V8_PLAYER_PROTECTED_SELECTION_SCHEMA =
  'animacraft.maker-v8-protected-selection.v1';

const ACTION_STORE = 'actions';
const ACTIVE_STORE = 'activeScopes';
const ROOT_ACTIVE_STORE = 'activeRoots';
const BUILD_STORE = 'transactionBuilds';
const DATABASE_VERSION = 1;
const MAX_TRANSACTION_BYTES = 128 * 1024;
const MAX_RECORD_BYTES = 1024 * 1024;
const MAX_GAS_BUDGET = 500_000_000n;
const MAX_CERTIFIED_ASSET_BYTES = 12 * 1024 * 1024;
const RENDERABLE_MEDIA_TYPES = new Set([
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);
const EXACT_ID = /^0x[0-9a-f]{64}$/;
const HASH = /^[0-9a-f]{64}$/;
const UINT = /^(?:0|[1-9][0-9]*)$/;
const SESSION = /^[0-9a-f]{32}$/;
const encoder = new TextEncoder();
const COMPILER_AUTHORITIES = new WeakSet();
const STATE_CERTIFICATES = new WeakMap();
const READ_ONLY_COMPLETION_QUOTE = Symbol('read-only-completion-quote');
const FINALITY_CERTIFICATES = new WeakMap();
const DRY_RUN_PROOFS = new WeakMap();
const PERSISTENCE_AUTHORITIES = new WeakSet();
const MAKER_ACCESS_ISSUED_BCS = bcs.struct('MakerAccessPassV8Issued', {
  root_id: bcs.Address,
  pass_id: bcs.Address,
  holder: bcs.Address,
  paid_atomic: bcs.u64(),
  protocol_atomic: bcs.u64(),
  maker_atomic: bcs.u64(),
  issued_at_ms: bcs.u64(),
});
const NATIVE_SOUL_BOUND_BCS = bcs.struct('NativeSoulBoundV8', {
  binding_id: bcs.Address,
  soul_id: bcs.Address,
  soul_state_id: bcs.Address,
  root_id: bcs.Address,
  output_id: bcs.Address,
  receipt_id: bcs.Address,
  original_holder: bcs.Address,
  authorization_commitment: bcs.vector(bcs.u8()),
});
const PHYSICAL_ASSET_ISSUED_BCS = bcs.struct('PhysicalAssetIssuedV8', {
  asset_id: bcs.Address,
  root_id: bcs.Address,
  registry_id: bcs.Address,
  source_kind: bcs.u8(),
  source_id: bcs.Address,
  serial: bcs.u64(),
  holder: bcs.Address,
  issuance_kind: bcs.u8(),
  authorization_key: bcs.vector(bcs.u8()),
  provenance_commitment: bcs.vector(bcs.u8()),
});
const EXTERNAL_ADMISSION_RECORD_BCS = bcs.struct('ExternalAdmissionRecordV8', {
  product_id: bcs.Address,
  compatibility_commitment: bcs.vector(bcs.u8()),
  product_content_commitment: bcs.vector(bcs.u8()),
  attestation_commitment: bcs.option(bcs.vector(bcs.u8())),
  admitted_revision: bcs.u64(),
  admission_state: bcs.u8(),
});
const PACK_QUOTE_ADMISSION_BCS = bcs.struct('PackAdmissionRecordV8', {
  release_id: bcs.Address, semantic_pack_id: bcs.string(),
  release_content_commitment: bcs.vector(bcs.u8()), admitted_revision: bcs.u64(), admission_state: bcs.u8(),
});
const PACK_STYLE_KEY_BCS = bcs.struct('PackStyleKeyV8', {
  part_key: bcs.string(),
  item_key: bcs.string(),
  style_key: bcs.string(),
});
const PACK_STYLE_BCS = bcs.struct('PackStyleV8', {
  index: bcs.u64(),
  definition_sources: bcs.struct('PackStyleDefinitionSourcesV8', {
    part: bcs.u8(), track: bcs.u8(), color: bcs.option(bcs.u8()),
  }),
  part_key: bcs.string(),
  item_key: bcs.string(),
  style_key: bcs.string(),
  layer_track_key: bcs.string(),
  color_channel_key: bcs.option(bcs.string()),
  default_swatch_key: bcs.option(bcs.string()),
  asset_blob_id: bcs.string(),
  asset_sha256: bcs.vector(bcs.u8()),
  asset_content_commitment: bcs.vector(bcs.u8()),
  protected: bcs.bool(),
  seal_binding_commitment: bcs.vector(bcs.u8()),
  style_commitment: bcs.vector(bcs.u8()),
});
const PROTECTED_ASSET_KEY_BCS = bcs.struct('ProtectedAssetKeyV8', {
  scope_kind: bcs.u8(),
  scope_key: bcs.string(),
  asset_key: bcs.string(),
});
const PROTECTED_ASSET_BCS = bcs.struct('ProtectedAssetV8', {
  scope_kind: bcs.u8(),
  scope_key: bcs.string(),
  scope_commitment: bcs.vector(bcs.u8()),
  asset_key: bcs.string(),
  asset_content_commitment: bcs.vector(bcs.u8()),
  ciphertext_blob_id: bcs.string(),
  ciphertext_sha256: bcs.vector(bcs.u8()),
  ciphertext_blob_commitment: bcs.vector(bcs.u8()),
  certification_commitment: bcs.vector(bcs.u8()),
  seal_id: bcs.vector(bcs.u8()),
});
const OUTPUT_WALLET_KEY_BCS = bcs.struct('OutputWalletKeyV8', {
  holder: bcs.Address,
});
const PACK_WALLET_KEY_BCS = bcs.struct('PackWalletKeyV8', {
  wallet: bcs.Address,
});
const PHYSICAL_POLICY_KEY_BCS = bcs.struct('PhysicalPolicyKeyV8', {
  source_kind: bcs.u8(),
  source_id: bcs.Address,
  part_key: bcs.string(),
  item_key: bcs.string(),
  style_key: bcs.string(),
});
const PHYSICAL_SOURCE_BINDING_BCS = bcs.struct('PhysicalSourceBindingV8', {
  source_kind: bcs.u8(),
  source_id: bcs.Address,
  source_semantic_id: bcs.string(),
  source_content_commitment: bcs.vector(bcs.u8()),
  source_treasury_id: bcs.option(bcs.Address),
  pack_registry_id: bcs.option(bcs.Address),
  pack_registry_revision: bcs.u64(),
  registered_pack_owner: bcs.option(bcs.Address),
  registered_pack_control_epoch: bcs.u64(),
  registered_pack_admin_cap_id: bcs.option(bcs.Address),
});
const PHYSICAL_STYLE_DESCRIPTOR_BCS = bcs.struct('PhysicalStyleDescriptorV8', {
  part_key: bcs.string(),
  item_key: bcs.string(),
  style_key: bcs.string(),
  layer_track_key: bcs.string(),
  color_channel_key: bcs.option(bcs.string()),
  default_swatch_key: bcs.option(bcs.string()),
  style_asset_blob_id: bcs.string(),
  style_asset_sha256: bcs.vector(bcs.u8()),
  style_protected: bcs.bool(),
});
const PHYSICAL_STYLE_POLICY_BCS = bcs.struct('PhysicalStylePolicyV8', {
  sequence: bcs.u64(),
  source: PHYSICAL_SOURCE_BINDING_BCS,
  style: PHYSICAL_STYLE_DESCRIPTOR_BCS,
  style_payload_commitment: bcs.vector(bcs.u8()),
  style_seal_binding_commitment: bcs.vector(bcs.u8()),
  source_style_commitment: bcs.vector(bcs.u8()),
  style_identity_commitment: bcs.vector(bcs.u8()),
  material_policy_commitment: bcs.vector(bcs.u8()),
  issuance_kind: bcs.u8(),
  proof_kind: bcs.u8(),
  price_atomic: bcs.u64(),
  max_supply: bcs.u64(),
  transferable: bcs.bool(),
  issued_count: bcs.u64(),
  consumed_count: bcs.u64(),
  row_commitment: bcs.vector(bcs.u8()),
});

export class MakerV8PlayerAdaptersError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'MakerV8PlayerAdaptersError';
    this.code = code;
    this.layer = 'PLAYER_ADAPTERS';
    this.details = Object.freeze({ ...details });
  }
}

function fail(code, message, details = {}) {
  throw new MakerV8PlayerAdaptersError(code, message, details);
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
  if (!plain(value)) fail('MAKER_V8_PLAYER_ADAPTER_SHAPE_INVALID', `${label} must be a plain record.`);
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (actual.length !== expected.length
    || actual.some((field, index) => field !== expected[index])) {
    fail('MAKER_V8_PLAYER_ADAPTER_SHAPE_INVALID', `${label} has fields outside its exact schema.`, {
      actual,
      expected,
    });
  }
  return value;
}

function requireMethod(value, method, label) {
  if (typeof value?.[method] !== 'function') {
    fail('MAKER_V8_PLAYER_ADAPTER_DEPENDENCY_INVALID', `${label}.${method} is required.`);
  }
}

function clone(root, label = 'value') {
  const seen = new WeakSet();
  let nodes = 0;
  function visit(value, path, depth) {
    nodes += 1;
    if (nodes > 100_000 || depth > 64) {
      fail('MAKER_V8_PLAYER_DURABLE_VALUE_INVALID', `${label} exceeds bounded structured-data limits.`, { path });
    }
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
    if (!value || typeof value !== 'object' || seen.has(value)) {
      fail('MAKER_V8_PLAYER_DURABLE_VALUE_INVALID', `${label} must be one ordinary JSON tree.`, { path });
    }
    seen.add(value);
    if (ArrayBuffer.isView(value) || typeof value === 'bigint') {
      fail('MAKER_V8_PLAYER_DURABLE_VALUE_INVALID', `${label} cannot contain binary or bigint values.`, { path });
    }
    const array = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    if ((array && prototype !== Array.prototype)
      || (!array && prototype !== Object.prototype && prototype !== null)) {
      fail('MAKER_V8_PLAYER_DURABLE_VALUE_INVALID', `${label} contains a non-plain value.`, { path });
    }
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== 'string')) {
      fail('MAKER_V8_PLAYER_DURABLE_VALUE_INVALID', `${label} contains symbol keys.`, { path });
    }
    if (array) {
      const output = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
          fail('MAKER_V8_PLAYER_DURABLE_VALUE_INVALID', `${label} contains a sparse/accessor array.`, { path });
        }
        output.push(visit(descriptor.value, `${path}[${index}]`, depth + 1));
      }
      if (keys.some((key) => key !== 'length' && !/^(?:0|[1-9][0-9]*)$/.test(key))) {
        fail('MAKER_V8_PLAYER_DURABLE_VALUE_INVALID', `${label} contains decorated arrays.`, { path });
      }
      return output;
    }
    const output = {};
    for (const key of keys.sort()) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
        fail('MAKER_V8_PLAYER_DURABLE_VALUE_INVALID', `${label} contains accessors or hidden fields.`, { path });
      }
      output[key] = visit(descriptor.value, `${path}.${key}`, depth + 1);
    }
    return output;
  }
  return visit(root, label, 0);
}

function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean'
    || typeof value === 'number') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (plain(value)) return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonical(value[key])}`
  )).join(',')}}`;
  throw new TypeError('non-canonical value');
}

function hashBytes(bytes) {
  return [...sha256(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function hashValue(value) {
  try { return hashBytes(encoder.encode(canonical(value))); } catch {
    fail('MAKER_V8_PLAYER_DURABLE_VALUE_INVALID', 'Value cannot be canonically hashed.');
  }
}

function same(left, right) {
  try { return canonical(left) === canonical(right); } catch { return false; }
}

// The shared system Clock advances independently of custody. Transactions bind
// its identity and initial shared version, not its latest version/digest. Keep
// every economic/ownership field strict while allowing only forward Clock reads.
function sameCustodyAfterClockProgress(fresh, previous, runtime) {
  if (same(fresh, previous)) return true;
  const before = previous.builderInput?.objects?.clock;
  const after = fresh.builderInput?.objects?.clock;
  const u64 = value => typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)
    && BigInt(value) <= 18446744073709551615n;
  if (!before || !after || before.objectId !== runtime.clockObjectId
    || after.objectId !== runtime.clockObjectId
    || before.type !== playerTypes(runtime).clock || after.type !== before.type
    || before.owner?.kind !== 'SHARED' || !same(before.owner, after.owner)
    || !u64(before.version) || !u64(after.version)
    || BigInt(after.version) <= BigInt(before.version)
    || !u64(before.fields?.timestamp_ms) || !u64(after.fields?.timestamp_ms)
    || BigInt(after.fields.timestamp_ms) < BigInt(before.fields.timestamp_ms)) return false;
  const comparableClock = { ...after, version: before.version, digest: before.digest,
    fields: { ...after.fields, timestamp_ms: before.fields.timestamp_ms } };
  return same(previous, { ...fresh, builderInput: { ...fresh.builderInput,
    objects: { ...fresh.builderInput.objects, clock: comparableClock } } });
}

function address(value, label) {
  if (typeof value !== 'string' || !EXACT_ID.test(value) || /^0x0{64}$/.test(value)) {
    fail('MAKER_V8_PLAYER_ADDRESS_INVALID', `${label} must be one canonical non-zero Sui address.`);
  }
  return value;
}

function decimal(value, label, { positive = false } = {}) {
  const text = typeof value === 'bigint' ? value.toString() : String(value ?? '');
  if (!UINT.test(text) || (positive && text === '0')) {
    fail('MAKER_V8_PLAYER_INTEGER_INVALID', `${label} must be one canonical decimal integer.`);
  }
  return text;
}

function hex(value, label) {
  if (typeof value === 'string') {
    const normalized = value.startsWith('0x') ? value.slice(2) : value;
    if (HASH.test(normalized)) return normalized;
    // gRPC Move JSON encodes vector<u8> as canonical Base64, including hashes.
    try {
      const bytes = fromBase64(value);
      if (bytes.length === 32 && toBase64(bytes) === value) {
        return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
      }
    } catch {
      // Reject malformed or non-canonical encodings below.
    }
  }
  if (Array.isArray(value) && value.length === 32
    && value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
    return value.map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  fail('MAKER_V8_PLAYER_HASH_INVALID', `${label} must be one exact 32-byte hash.`);
}

function base64(value, label, maximum = MAX_RECORD_BYTES) {
  try {
    if (typeof value !== 'string' || value.length === 0) throw new Error('shape');
    const bytes = fromBase64(value);
    if (bytes.length === 0 || bytes.length > maximum || toBase64(bytes) !== value) throw new Error('canonical');
    return value;
  } catch {
    fail('MAKER_V8_PLAYER_BASE64_INVALID', `${label} must be bounded canonical Base64.`);
  }
}

function suiDigest(value, label) {
  try {
    if (typeof value !== 'string' || fromBase58(value).length !== 32) throw new Error('shape');
    return value;
  } catch {
    fail('MAKER_V8_PLAYER_DIGEST_INVALID', `${label} must be one canonical Sui digest.`);
  }
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
  });
}

function openDatabase(indexedDB, databaseName) {
  if (!indexedDB || typeof indexedDB.open !== 'function') {
    fail('MAKER_V8_PLAYER_INDEXEDDB_REQUIRED', 'Fresh Player v8 execution requires IndexedDB.');
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, DATABASE_VERSION);
    request.onupgradeneeded = (event) => {
      const database = request.result;
      if (event.oldVersion !== 0) {
        request.transaction.abort();
        return;
      }
      const actions = database.createObjectStore(ACTION_STORE, { keyPath: 'actionId' });
      actions.createIndex('byDigest', 'transaction.digest', { unique: true });
      database.createObjectStore(ACTIVE_STORE, { keyPath: 'scopeKey' });
      database.createObjectStore(ROOT_ACTIVE_STORE, { keyPath: 'rootScopeKey' });
      const builds = database.createObjectStore(BUILD_STORE, { keyPath: 'descriptorSha256' });
      builds.createIndex('byDigest', 'digest', { unique: true });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
    request.onblocked = () => reject(new Error('IndexedDB upgrade is blocked'));
  });
}

/** Fresh v8-only IndexedDB action WAL plus O(1) semantic active head and build proof. */
export function createMakerV8PlayerPersistenceV8(indexedDB = globalThis.indexedDB, {
  databaseName = MAKER_V8_PLAYER_DATABASE,
  storageManager = globalThis.navigator?.storage,
  minimumAvailableBytes = 4 * 1024 * 1024,
  confirmNoSignedArtifact = null,
} = {}) {
  if (typeof databaseName !== 'string' || databaseName.length < 8 || databaseName.length > 160
    || !Number.isSafeInteger(minimumAvailableBytes) || minimumAvailableBytes < MAX_RECORD_BYTES
    || (confirmNoSignedArtifact !== null && typeof confirmNoSignedArtifact !== 'function')) {
    fail('MAKER_V8_PLAYER_PERSISTENCE_CONFIG_INVALID', 'Player persistence configuration is invalid.');
  }
  const database = openDatabase(indexedDB, databaseName);
  let durable = null;
  async function requirePersistentStorage() {
    if (!durable) durable = (async () => {
      if (!storageManager || typeof storageManager.persisted !== 'function'
        || typeof storageManager.persist !== 'function'
        || typeof storageManager.estimate !== 'function') {
        fail('MAKER_V8_PLAYER_PERSISTENCE_REQUIRED', 'Persistent browser storage is required before Player signing.');
      }
      const granted = await storageManager.persisted() || await storageManager.persist();
      const estimate = await storageManager.estimate();
      const quota = Number(estimate?.quota);
      const usage = Number(estimate?.usage);
      if (granted !== true || !Number.isSafeInteger(quota) || !Number.isSafeInteger(usage)
        || quota < usage || quota - usage < minimumAvailableBytes) {
        fail('MAKER_V8_PLAYER_PERSISTENCE_REQUIRED', 'Persistent Player WAL quota was not granted.');
      }
      return true;
    })().catch((error) => { durable = null; throw error; });
    return durable;
  }
  async function preflightQuota(requiredBytes) {
    await requirePersistentStorage();
    if (!Number.isSafeInteger(requiredBytes) || requiredBytes < 1 || requiredBytes > MAX_RECORD_BYTES) {
      fail('MAKER_V8_PLAYER_QUOTA_REQUEST_INVALID', 'Player quota request is invalid.');
    }
    const estimate = await storageManager.estimate();
    if (Number(estimate?.quota) - Number(estimate?.usage) < requiredBytes) {
      fail('MAKER_V8_PLAYER_QUOTA_EXHAUSTED', 'Player WAL has insufficient durable quota.');
    }
    return true;
  }
  async function load(actionId) {
    if (typeof actionId !== 'string' || !HASH.test(actionId)) fail('MAKER_V8_PLAYER_ACTION_ID_INVALID', 'actionId is invalid.');
    const db = await database;
    const transaction = db.transaction(ACTION_STORE, 'readonly');
    const raw = await requestResult(transaction.objectStore(ACTION_STORE).get(actionId));
    await transactionDone(transaction);
    return raw === undefined ? null : clone(raw, 'stored Player action');
  }
  async function resolveActive(scopeKey) {
    if (typeof scopeKey !== 'string' || !HASH.test(scopeKey)) fail('MAKER_V8_PLAYER_SCOPE_INVALID', 'scopeKey is invalid.');
    const db = await database;
    const transaction = db.transaction(ACTIVE_STORE, 'readonly');
    const raw = await requestResult(transaction.objectStore(ACTIVE_STORE).get(scopeKey));
    await transactionDone(transaction);
    if (raw === undefined) return null;
    exact(raw, ['scopeKey', 'actionId'], 'active Player scope');
    if (raw.scopeKey !== scopeKey || typeof raw.actionId !== 'string' || !HASH.test(raw.actionId)) {
      fail('MAKER_V8_PLAYER_SCOPE_INVALID', 'Active Player scope is corrupt.');
    }
    return raw.actionId;
  }
  function rootScopeKey(rootId, signer) {
    return hashValue({
      chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
      rootId: address(rootId, 'active Root ID'),
      signer: address(signer, 'active Root signer'),
    });
  }
  async function resolveRootActive(input) {
    exact(input, ['rootId', 'signer'], 'active Player Root lookup');
    const key = rootScopeKey(input.rootId, input.signer);
    const db = await database;
    const transaction = db.transaction(ROOT_ACTIVE_STORE, 'readonly');
    const raw = await requestResult(transaction.objectStore(ROOT_ACTIVE_STORE).get(key));
    await transactionDone(transaction);
    if (raw === undefined) return null;
    exact(raw, ['rootScopeKey', 'actionId'], 'active Player Root');
    if (raw.rootScopeKey !== key || typeof raw.actionId !== 'string' || !HASH.test(raw.actionId)) {
      fail('MAKER_V8_PLAYER_ROOT_SCOPE_INVALID', 'Active Player Root index is corrupt.');
    }
    return raw.actionId;
  }
  async function loadByDigest(digest) {
    suiDigest(digest, 'transaction digest');
    const db = await database;
    const transaction = db.transaction(ACTION_STORE, 'readonly');
    const raw = await requestResult(transaction.objectStore(ACTION_STORE).index('byDigest').get(digest));
    await transactionDone(transaction);
    return raw === undefined ? null : clone(raw, 'stored Player action by digest');
  }
  async function create(recordInput) {
    await requirePersistentStorage();
    const record = clone(recordInput, 'new Player action');
    const db = await database;
    const transaction = db.transaction([ACTION_STORE, ACTIVE_STORE, ROOT_ACTIVE_STORE], 'readwrite');
    const actions = transaction.objectStore(ACTION_STORE);
    const scopes = transaction.objectStore(ACTIVE_STORE);
    const roots = transaction.objectStore(ROOT_ACTIVE_STORE);
    const rootKey = rootScopeKey(record.playerIdentity?.rootId, record.plan?.signer);
    const [existingRaw, activeRaw, rootActiveRaw] = await Promise.all([
      requestResult(actions.get(record.actionId)),
      requestResult(scopes.get(record.scopeKey)),
      requestResult(roots.get(rootKey)),
    ]);
    if (existingRaw !== undefined) {
      if (!same(existingRaw, record)
        || !same(activeRaw, { scopeKey: record.scopeKey, actionId: record.actionId })
        || !same(rootActiveRaw, { rootScopeKey: rootKey, actionId: record.actionId })) {
        transaction.abort();
        fail('MAKER_V8_PLAYER_ACTION_CONFLICT', 'Action ID or its O(1) active indices contain different durable authority.');
      }
    } else if (activeRaw !== undefined || rootActiveRaw !== undefined) {
      transaction.abort();
      fail('MAKER_V8_PLAYER_SCOPE_CONFLICT', 'This Player Root/signer already has an active durable attempt.');
    } else {
      await requestResult(actions.add(record));
      await requestResult(scopes.add({ scopeKey: record.scopeKey, actionId: record.actionId }));
      await requestResult(roots.add({ rootScopeKey: rootKey, actionId: record.actionId }));
    }
    await transactionDone(transaction);
    const reread = await load(record.actionId);
    if (!reread || !same(reread, record)) {
      fail('MAKER_V8_PLAYER_DURABLE_READBACK_FAILED', 'Prepared Player action did not survive exact durable reread.');
    }
    return reread;
  }
  async function compareAndSwap(actionId, revision, nextInput) {
    await requirePersistentStorage();
    const next = clone(nextInput, 'next Player action');
    const db = await database;
    const transaction = db.transaction([ACTION_STORE, ACTIVE_STORE, ROOT_ACTIVE_STORE], 'readwrite');
    const actions = transaction.objectStore(ACTION_STORE);
    const scopes = transaction.objectStore(ACTIVE_STORE);
    const roots = transaction.objectStore(ROOT_ACTIVE_STORE);
    const raw = await requestResult(actions.get(actionId));
    if (raw === undefined || raw.revision !== revision
      || next.actionId !== actionId || next.revision !== revision + 1
      || next.scopeKey !== raw.scopeKey || next.createdAt !== raw.createdAt
      || next.updatedAt < raw.updatedAt
      || !same(next.playerIdentity, raw.playerIdentity)
      || !same(next.recipe, raw.recipe) || !same(next.loadout, raw.loadout)
      || !same(next.input, raw.input) || !same(next.plan, raw.plan)
      || !same(next.transaction, raw.transaction)) {
      transaction.abort();
      fail('MAKER_V8_PLAYER_CAS_CONFLICT', 'Player action CAS or immutable authority changed.');
    }
    await requestResult(actions.put(next));
    const rootKey = rootScopeKey(raw.playerIdentity?.rootId, raw.plan?.signer);
    if (['FINALIZED_SUCCESS', 'FINALIZED_FAILURE', 'EXPIRED_NOT_FOUND'].includes(next.status)) {
      await requestResult(scopes.delete(next.scopeKey));
      await requestResult(roots.delete(rootKey));
    } else {
      await requestResult(scopes.put({ scopeKey: next.scopeKey, actionId }));
      await requestResult(roots.put({ rootScopeKey: rootKey, actionId }));
    }
    await transactionDone(transaction);
    const reread = await load(actionId);
    if (!reread || !same(reread, next)) {
      fail('MAKER_V8_PLAYER_DURABLE_READBACK_FAILED', 'Player CAS did not survive exact durable reread.');
    }
    return reread;
  }
  async function reclaimSignatureIntent(requestInput) {
    await requirePersistentStorage();
    const request = clone(requestInput, 'signature reclaim request');
    exact(request, ['actionId', 'revision', 'signatureIntent', 'checkedAt'], 'signature reclaim request');
    if (!plain(request.signatureIntent) || !SESSION.test(request.signatureIntent.sessionId)
      || !Number.isSafeInteger(request.checkedAt) || request.checkedAt < request.signatureIntent.leaseExpiresAt
      || confirmNoSignedArtifact === null) {
      fail('MAKER_V8_PLAYER_SIGNATURE_RECLAIM_FORBIDDEN', 'Uncertain signature intent cannot be reclaimed without an expired lease and external no-artifact proof.');
    }
    const confirmationRequest = freeze({
      actionId: request.actionId,
      revision: request.revision,
      sessionId: request.signatureIntent.sessionId,
      leaseExpiresAt: request.signatureIntent.leaseExpiresAt,
      checkedAt: request.checkedAt,
    });
    const proof = await confirmNoSignedArtifact(confirmationRequest);
    exact(proof, ['kind', 'actionId', 'sessionId', 'checkedAt'], 'signature no-artifact proof');
    if (proof.kind !== 'EXTERNAL_NO_ARTIFACT' || proof.actionId !== request.actionId
      || proof.sessionId !== request.signatureIntent.sessionId
      || proof.checkedAt !== request.checkedAt) {
      fail('MAKER_V8_PLAYER_SIGNATURE_RECLAIM_FORBIDDEN', 'External no-artifact proof does not echo the exact expired intent.');
    }
    const current = await load(request.actionId);
    if (!current || current.revision !== request.revision
      || !['SIGNING', 'SIGNING_UNKNOWN'].includes(current.status)
      || !same(current.signatureIntent, request.signatureIntent)
      || current.signature !== null) {
      fail('MAKER_V8_PLAYER_SIGNATURE_RECLAIM_CONFLICT', 'Signature intent changed before reclaim.');
    }
    return compareAndSwap(current.actionId, current.revision, {
      ...current,
      revision: current.revision + 1,
      updatedAt: request.checkedAt,
      status: 'PREPARED',
      signatureIntent: null,
      error: null,
    });
  }
  async function loadBuild(descriptorSha256) {
    if (typeof descriptorSha256 !== 'string' || !HASH.test(descriptorSha256)) {
      fail('MAKER_V8_PLAYER_BUILD_KEY_INVALID', 'Build descriptor hash is invalid.');
    }
    const db = await database;
    const transaction = db.transaction(BUILD_STORE, 'readonly');
    const raw = await requestResult(transaction.objectStore(BUILD_STORE).get(descriptorSha256));
    await transactionDone(transaction);
    return raw === undefined ? null : clone(raw, 'stored Player build');
  }
  async function createBuild(buildInput) {
    await requirePersistentStorage();
    const build = clone(buildInput, 'Player build');
    const db = await database;
    const transaction = db.transaction(BUILD_STORE, 'readwrite');
    const store = transaction.objectStore(BUILD_STORE);
    const raw = await requestResult(store.get(build.descriptorSha256));
    if (raw === undefined) await requestResult(store.add(build));
    else if (!same(raw, build)) {
      transaction.abort();
      fail('MAKER_V8_PLAYER_BUILD_CONFLICT', 'One Player descriptor cannot authorize replacement TransactionData.');
    }
    await transactionDone(transaction);
    const reread = await loadBuild(build.descriptorSha256);
    if (!reread || !same(reread, raw === undefined ? build : raw)) {
      fail('MAKER_V8_PLAYER_DURABLE_READBACK_FAILED', 'Player build did not survive exact durable reread.');
    }
    return reread;
  }
  async function loadBuildByDigest(digest) {
    suiDigest(digest, 'build digest');
    const db = await database;
    const transaction = db.transaction(BUILD_STORE, 'readonly');
    const raw = await requestResult(transaction.objectStore(BUILD_STORE).index('byDigest').get(digest));
    await transactionDone(transaction);
    return raw === undefined ? null : clone(raw, 'stored Player build by digest');
  }
  const adapter = freeze({
    schemaVersion: MAKER_V8_PLAYER_ADAPTERS_SCHEMA,
    requirePersistentStorage,
    preflightQuota,
    create,
    load,
    loadByDigest,
    compareAndSwap,
    resolveActive,
    resolveRootActive,
    reclaimSignatureIntent,
    loadBuild,
    loadBuildByDigest,
    createBuild,
  });
  PERSISTENCE_AUTHORITIES.add(adapter);
  return adapter;
}

async function pinnedMainnet(client) {
  requireMethod(client, 'getChainIdentifier', 'Sui gRPC transport');
  const result = await client.getChainIdentifier();
  const observed = typeof result === 'string' ? result : result?.chainIdentifier;
  if (observed !== MAKER_V8_MAINNET_GENESIS_DIGEST) {
    fail('MAKER_V8_PLAYER_NETWORK_DRIFT', 'Sui gRPC transport no longer identifies the pinned Mainnet genesis.');
  }
}

function runtimeLoader(runtime, client, loadRuntimeAttestation) {
  const load = loadRuntimeAttestation ?? (() => attestMakerV8Runtime(client, runtime, {
    network: MAKER_V8_CHAIN_NETWORK,
  }));
  return async () => {
    const value = await load(client, runtime, { network: MAKER_V8_CHAIN_NETWORK });
    const observed = assertMakerV8Runtime(value?.runtime ?? value);
    if (!isMakerV8RuntimeAttested(observed) || !same(observed, runtime)) {
      fail('MAKER_V8_PLAYER_RUNTIME_DRIFT', 'Fresh Mainnet runtime attestation differs from the Player runtime.');
    }
    return observed;
  };
}

function moveFields(value, label) {
  if (plain(value?.fields)) return value.fields;
  if (plain(value)) return value;
  fail('MAKER_V8_PLAYER_MOVE_FIELDS_INVALID', `${label} has no exact Move fields.`);
}

function attestedReplacementSnapshot(runtime) {
  const replacement = makerV8AttestedReplacement(runtime);
  return freeze({
    objectId: replacement.objectId,
    version: replacement.version.toString(),
    digest: replacement.digest,
    type: replacement.type,
    owner: { kind: 'IMMUTABLE' },
    fields: clone(replacement.fields, 'certified replacement fields'),
  });
}

function moveId(value, label) {
  if (typeof value === 'string') return address(value.toLowerCase(), label);
  if (plain(value?.id)) return moveId(value.id, label);
  if (plain(value?.fields)) return moveId(value.fields, label);
  if (plain(value) && typeof value.bytes === 'string') return moveId(value.bytes, label);
  fail('MAKER_V8_PLAYER_MOVE_ID_INVALID', `${label} is not an exact Move ID.`);
}

function moveTableId(value, label) {
  return moveId(
    value?.fields?.id?.id
      ?? value?.fields?.id
      ?? value?.id?.id
      ?? value?.id
      ?? value,
    label,
  );
}

function moveText(value, label) {
  if (typeof value === 'string' && value.length > 0 && value.length <= 1024) return value;
  if (plain(value?.fields)) return moveText(value.fields, label);
  if (plain(value) && typeof value.bytes === 'string') return moveText(value.bytes, label);
  fail('MAKER_V8_PLAYER_MOVE_TEXT_INVALID', `${label} is not bounded Move text.`);
}

function moveOption(value, label) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    if (value.length === 1) return value[0];
    fail('MAKER_V8_PLAYER_MOVE_OPTION_INVALID', `${label} has invalid cardinality.`);
  }
  const fields = plain(value?.fields) ? value.fields : value;
  if (plain(fields) && Array.isArray(fields.vec)) return moveOption(fields.vec, label);
  if (plain(fields) && Object.hasOwn(fields, 'some')) return fields.some;
  if (plain(fields) && fields.$kind === 'None') return null;
  if (plain(fields) && fields.$kind === 'Some') return fields.Some;
  return value;
}

function normalizeOwner(owner, label) {
  if (plain(owner?.Shared)) {
    const initial = owner.Shared.initialSharedVersion ?? owner.Shared.initial_shared_version;
    return freeze({ kind: 'SHARED', initialSharedVersion: decimal(initial, `${label}.initialSharedVersion`, { positive: true }) });
  }
  if (plain(owner?.shared)) {
    return freeze({ kind: 'SHARED', initialSharedVersion: decimal(owner.shared.initialSharedVersion, `${label}.initialSharedVersion`, { positive: true }) });
  }
  const owned = owner?.AddressOwner ?? owner?.addressOwner ?? owner?.address;
  if (typeof owned === 'string') return freeze({ kind: 'ADDRESS', address: address(owned.toLowerCase(), `${label}.address`) });
  if (plain(owner?.ObjectOwner)) return freeze({ kind: 'OBJECT', objectId: moveId(owner.ObjectOwner, `${label}.objectId`) });
  fail('MAKER_V8_PLAYER_OBJECT_OWNER_INVALID', `${label} is not an exact Sui owner.`);
}

function objectSnapshot(response, expectedType, label, expectedId = null) {
  const data = response?.data ?? response?.object ?? response;
  if (!plain(data) || data.error) fail('MAKER_V8_PLAYER_OBJECT_MISSING', `${label} is unavailable.`);
  const objectId = address(String(data.objectId ?? data.object_id ?? '').toLowerCase(), `${label}.objectId`);
  if (expectedId !== null && objectId !== expectedId) fail('MAKER_V8_PLAYER_OBJECT_ID_DRIFT', `${label} returned another object.`);
  const type = normalizeStructTag(String(data.type ?? data.objectType ?? data.content?.type ?? ''));
  if (normalizeStructTag(expectedType) !== type) {
    fail('MAKER_V8_PLAYER_OBJECT_TYPE_DRIFT', `${label} has another TypeOrigin.`, { expectedType, observedType: type });
  }
  const digest = String(data.digest ?? '');
  suiDigest(digest, `${label}.digest`);
  const fields = clone(data.content?.fields ?? data.fields ?? data.json, `${label}.fields`);
  if (!plain(fields)) fail('MAKER_V8_PLAYER_MOVE_FIELDS_INVALID', `${label} has no parsed Move fields.`);
  return freeze({
    objectId,
    version: decimal(data.version, `${label}.version`, { positive: true }),
    digest,
    type,
    owner: normalizeOwner(data.owner, `${label}.owner`),
    fields,
  });
}

function stableType(runtime, role, moduleName, structName, generic = false) {
  const base = makerV8StableType(runtime, role, moduleName, structName);
  return generic ? `${base}<${runtime.paymentCoinType}>` : base;
}

function playerTypes(runtime) {
  const chain = makerV8ChainTypes(runtime);
  return freeze({
    ...chain,
    nativeSoul: runtime.nativeSoulIntegration?.expectedNativeBinding.soulOriginalType ?? null,
    nativeSoulState: runtime.nativeSoulIntegration
      ? `${runtime.nativeSoulIntegration.soulidityOriginalPackageId}::soul::SoulState` : null,
    nativeSoulBinding: stableType(runtime, 'output', 'output_v8', 'NativeSoulBindingV8'),
    clock: '0x0000000000000000000000000000000000000000000000000000000000000002::clock::Clock',
    protocolTreasury: stableType(runtime, 'core', 'protocol_config_v8', 'ProtocolTreasuryV8', true),
    baseRegistry: stableType(runtime, 'core', 'base_registry_v8', 'BaseDefinitionRegistryV8'),
    sealRegistry: stableType(runtime, 'seal', 'seal_v8', 'SealRegistryV8'),
    runtimeDefinitions: stableType(runtime, 'runtime', 'runtime_v8', 'RuntimeDefinitionRegistryV8'),
    packRegistry: stableType(runtime, 'runtime', 'runtime_v8', 'PackRegistryV8'),
    packRelease: stableType(runtime, 'runtime', 'runtime_v8', 'PackReleaseV8', true),
    packTreasury: stableType(runtime, 'runtime', 'runtime_v8', 'PackTreasuryV8', true),
    packPass: stableType(runtime, 'runtime', 'runtime_v8', 'PackPassV8'),
    makerAccess: stableType(runtime, 'core', 'treasury_v8', 'MakerAccessPassV8'),
    ownedBaseItem: stableType(runtime, 'runtime', 'runtime_v8', 'OwnedBaseItemV8'),
    externalItemProduct: stableType(runtime, 'runtime', 'runtime_v8', 'ExternalItemProductV8'),
    ownedExternalItem: stableType(runtime, 'runtime', 'runtime_v8', 'OwnedExternalItemV8'),
    makerLoadout: stableType(runtime, 'runtime', 'runtime_v8', 'MakerLoadoutV8'),
    outputRegistry: stableType(runtime, 'output', 'output_v8', 'OutputRegistryV8'),
    soulRegistry: stableType(runtime, 'output', 'output_v8', 'SoulRegistryV8'),
    physicalRegistry: stableType(runtime, 'physical', 'physical_v8', 'PhysicalRegistryV8'),
  });
}

async function readObject(client, objectId, type, label) {
  const response = await client.getObject({
    id: objectId,
    options: { showType: true, showContent: true, showOwner: true },
  });
  return objectSnapshot(response, type, label, objectId);
}

async function ownedObjects(client, owner, type, label, { completeQuote = false } = {}) {
  const rows = [];
  const cursors = new Set();
  const seen = new Set();
  let cursor = null;
  do {
    const page = await client.getOwnedObjects({
      owner,
      filter: { StructType: type },
      options: { showType: true, showContent: true, showOwner: true },
      cursor,
      limit: 100,
    });
    if (!plain(page) || !Array.isArray(page.data)) fail('MAKER_V8_PLAYER_OWNED_PAGE_INVALID', `${label} page is invalid.`);
    if (completeQuote && typeof page.hasNextPage !== 'boolean') {
      fail('MAKER_V8_PLAYER_OWNED_PAGE_INVALID', `${label} pagination completeness is unknown.`);
    }
    const snapshots = page.data.map((row, index) => objectSnapshot(row, type, `${label}[${rows.length + index}]`));
    if (completeQuote) for (const snapshot of snapshots) {
      if (snapshot.owner.kind !== 'ADDRESS' || snapshot.owner.address !== owner || seen.has(snapshot.objectId)) {
        fail('MAKER_V8_PLAYER_OWNED_PAGE_INVALID', `${label} repeats an object or has another actual owner.`);
      }
      seen.add(snapshot.objectId);
    }
    rows.push(...snapshots);
    if (rows.length > 10_000) fail('MAKER_V8_PLAYER_OWNED_PAGE_LIMIT', `${label} exceeds the bounded owned-object limit.`);
    cursor = page.hasNextPage ? page.nextCursor : null;
    if (page.hasNextPage && !cursor) fail('MAKER_V8_PLAYER_OWNED_CURSOR_INVALID', `${label} omitted its next cursor.`);
    if (completeQuote && cursor !== null) {
      if (typeof cursor !== 'string' || cursors.has(cursor)) fail('MAKER_V8_PLAYER_OWNED_CURSOR_INVALID', `${label} pagination does not advance.`);
      cursors.add(cursor);
    }
  } while (cursor);
  return rows;
}

function unique(rows, predicate, label, { required = true } = {}) {
  const selected = rows.filter(predicate);
  if (selected.length > 1 || (required && selected.length !== 1)) {
    fail('MAKER_V8_PLAYER_CUSTODY_CARDINALITY_INVALID', `${label} must resolve to ${required ? 'one' : 'zero or one'} exact object.`, { observed: selected.length });
  }
  return selected[0] ?? null;
}

export function makerV8PlayerRequiresMakerAccessV8(action, packAccessKind = null) {
  if (!Object.values(MAKER_V8_PLAYER_ACTIONS).includes(action)) {
    fail('MAKER_V8_PLAYER_ACTION_INVALID', 'Unknown Player action.');
  }
  if (action === MAKER_V8_PLAYER_ACTIONS.ACQUIRE_MAKER_ACCESS) return false;
  if (action !== MAKER_V8_PLAYER_ACTIONS.ACQUIRE_PACK_ACCESS) return true;
  if (![0, 1, 2].includes(packAccessKind)) {
    fail('MAKER_V8_PLAYER_PACK_ACCESS_POLICY_INVALID', 'Pack access policy is not callable.');
  }
  return packAccessKind === 2;
}

function assertMakerAccessDependency(state, request) {
  const kind = request.action === MAKER_V8_PLAYER_ACTIONS.ACQUIRE_PACK_ACCESS
    ? Number(decimal(releaseFor(state, request.input.releaseId).fields.access_kind, 'PackRelease.accessKind'))
    : null;
  if (makerV8PlayerRequiresMakerAccessV8(request.action, kind) && !state.objects.makerAccess) {
    fail('MAKER_V8_PLAYER_MAKER_ACCESS_REQUIRED', 'This action requires the exact Maker entry entitlement.');
  }
}

export function makerV8PlayerRootBindingV2(root, runtime, player) {
  const fields = root.fields;
  const content = moveFields(fields.content, 'root.content');
  const publication = moveFields(fields.publication, 'root.publication');
  hex(moveOption(publication.sealed_base_registry_commitment, 'root.publication.sealed_base_registry_commitment'), 'root.publication.sealed_base_registry_commitment');
  const registryIds = moveFields(moveOption(publication.registry_ids, 'root.publication.registry_ids'), 'root.publication.registry_ids');
  const commitments = moveFields(moveOption(publication.release_commitments, 'root.publication.release_commitments'), 'root.publication.release_commitments');
  const replacement = makerV8AttestedReplacement(runtime).fields;
  const economics = moveFields(fields.economics, 'root.economics');
  if (root.objectId !== player.rootId || root.type !== makerV8ChainTypes(runtime).root
    || root.owner.kind !== 'SHARED'
    || decimal(fields.version, 'root.version') !== '8'
    || decimal(fields.lifecycle, 'root.lifecycle') !== '1'
    || decimal(fields.maker_version, 'root.maker_version') !== player.makerVersion
    || decimal(fields.maker_version, 'root.maker_version') !== player.evidence.makerVersion
    || hex(content.content_commitment, 'root.content.content_commitment') !== player.evidence.contentCommitment
    || hex(content.renderer_commitment, 'root.content.renderer_commitment') !== player.evidence.rendererCommitment
    || moveId(fields.core_original_package_id, 'root.coreOriginalPackageId') !== runtime.roles.core.typeOriginPackageId
    || moveId(fields.core_callable_package_id, 'root.coreCallablePackageId') !== runtime.roles.core.callablePackageId
    || moveId(moveOption(publication.catalog_id, 'root.publication.catalog_id'), 'root.catalogId') !== runtime.catalogId
    || moveId(economics.protocol_config_id, 'root.protocolConfigId') !== runtime.protocolConfigId
    || moveId(economics.protocol_treasury_id, 'root.protocolTreasuryId') !== runtime.protocolTreasuryId
    || hex(commitments.product_binding_commitment, 'root.publication.productBindingCommitment') !== hex(replacement.package_tuple_commitment, 'replacement.packageTupleCommitment')
    || hex(commitments.call_cap_set_commitment, 'root.publication.callCapSetCommitment') !== hex(replacement.call_cap_set_commitment, 'replacement.callCapSetCommitment')) {
    fail('MAKER_V8_PLAYER_ROOT_DRIFT', 'Live Root differs from the exact ACTIVE Player/runtime binding.');
  }
  const binding = {
    baseRegistryId: moveId(moveOption(fields.base_registry_id, 'root.base_registry_id'), 'root.baseRegistryId'),
    makerTreasuryId: moveId(moveOption(fields.maker_treasury_id, 'root.maker_treasury_id'), 'root.makerTreasuryId'),
    sealPolicyConfigId: runtime.roleConfigIds.seal,
    sealRegistryId: moveId(registryIds.seal_registry_id, 'root.sealRegistryId'),
    runtimeDefinitionsId: moveId(registryIds.runtime_definition_registry_id, 'root.runtimeDefinitionsId'),
    packRegistryId: moveId(registryIds.pack_registry_id, 'root.packRegistryId'),
    packAdmissionAuthorityId: moveId(registryIds.admission_authority_id, 'root.packAdmissionAuthorityId'),
    outputRegistryId: moveId(registryIds.output_registry_id, 'root.outputRegistryId'),
    soulRegistryId: moveId(registryIds.soul_registry_id, 'root.soulRegistryId'),
    physicalRegistryId: moveId(registryIds.physical_registry_id, 'root.physicalRegistryId'),
    marketRegistryId: moveId(registryIds.market_registry_id, 'root.marketRegistryId'),
  };
  const companionIds = Object.entries(binding).filter(([key]) => key !== 'sealPolicyConfigId').map(([, value]) => value);
  if (new Set(companionIds).size !== companionIds.length
    || companionIds.includes(root.objectId) || companionIds.includes(moveId(fields.admin_cap_id, 'root.adminCapId'))) {
    fail('MAKER_V8_PLAYER_ROOT_DRIFT', 'Live Root companion IDs collide with another registry or authority.');
  }
  return freeze({
    binding: freeze(binding),
    economics: freeze({
      makerAccess: Number(decimal(economics.maker_access, 'root.economics.makerAccess')),
      makerPriceAtomic: decimal(economics.maker_price_atomic, 'root.economics.makerPrice'),
      completeMode: Number(decimal(economics.complete_mode, 'root.economics.completeMode')),
      completePriceAtomic: decimal(economics.complete_price_atomic, 'root.economics.completePrice'),
      completeQuota: decimal(economics.complete_per_wallet_quota, 'root.economics.completeQuota'),
      completeTotalCap: decimal(economics.complete_total_cap, 'root.economics.completeTotalCap'),
      fixedCompleteFeeAtomic: decimal(economics.fixed_complete_fee_atomic, 'root.economics.fixedCompleteFee'),
    }),
  });
}
const rootBinding = makerV8PlayerRootBindingV2;

function selectedBaseStyle(player, selection) {
  const part = player.document.parts.find((entry) => entry.key === selection.partKey);
  const item = part?.items.find((entry) => entry.key === selection.itemKey);
  return item?.styles.find((entry) => entry.key === selection.styleKey) ?? null;
}

function selectedOutput(player, recipe) {
  return player.document.outputs.find((entry) => entry.key === recipe.outputKey) ?? null;
}

function loadoutSelections(loadout, verifiedBundles = new Map(), admission = 0, expectedLayout = null) {
  if (!loadout) return [];
  const attached = loadout.fields.attached_pack_definitions;
  if (!Array.isArray(attached)) {
    fail('MAKER_V8_PLAYER_LOADOUT_LAYOUT_INVALID', 'MakerLoadout attached Pack definitions are unavailable.');
  }
  const ownedSlots = [];
  const seen = new Set();
  if (expectedLayout !== null) {
    exact(expectedLayout, ['bindings', 'profiles'], 'Expected Pack layout');
    if (!Array.isArray(expectedLayout.bindings) || !Array.isArray(expectedLayout.profiles)
      || expectedLayout.bindings.length !== attached.length || expectedLayout.profiles.length > 500) {
      fail('MAKER_V8_PLAYER_LOADOUT_LAYOUT_INVALID', 'Final attachment list differs from the prepared transaction.');
    }
    for (const row of expectedLayout.bindings) {
      exact(row, ['releaseId', 'definitionCommitment'], 'Expected attachment');
      address(row.releaseId, 'Expected attachment release');
      hex(row.definitionCommitment, 'Expected attachment commitment');
    }
    let sourceIndex = -1;
    for (const row of expectedLayout.profiles) {
      exact(row, ['releaseId', 'partKey', 'capacity', 'profileCommitment'], 'Expected profile');
      const index = expectedLayout.bindings.findIndex(binding => binding.releaseId === row.releaseId);
      if (index < 0 || index < sourceIndex || typeof row.partKey !== 'string' || !row.partKey
        || BigInt(decimal(row.capacity, 'Expected profile capacity')) < 1n
        || BigInt(row.capacity) > 64n || !HASH.test(row.profileCommitment)) {
        fail('MAKER_V8_PLAYER_LOADOUT_LAYOUT_INVALID', 'Prepared profile evidence is invalid.');
      }
      sourceIndex = index;
    }
  }
  for (const raw of attached) {
    const binding = moveFields(raw, 'AttachedPackDefinition');
    const releaseId = moveId(binding.release_id, 'AttachedPackDefinition.releaseId');
    const expectedBinding = expectedLayout?.bindings[seen.size];
    if (expectedLayout !== null && (expectedBinding?.releaseId !== releaseId
      || expectedBinding.definitionCommitment !== hex(binding.definition_commitment, 'AttachedPackDefinition.commitment'))) {
      fail('MAKER_V8_PLAYER_LOADOUT_LAYOUT_INVALID', 'Final attachment identity/order/commitment differs from the prepared transaction.');
    }
    const bundle = expectedLayout !== null ? expectedBinding : verifiedBundles.get(releaseId);
    if (!bundle) fail('MAKER_V8_PLAYER_LOADOUT_ATTACHED_PACK_DEFINITIONS_UNAVAILABLE', 'Exact attached Pack definitions are unavailable.');
    if (seen.has(releaseId) || releaseId === moveId(loadout.fields.root_id, 'MakerLoadout.rootId')
      || attached.length > 500 || bundle.definitionCommitment !== hex(binding.definition_commitment, 'AttachedPackDefinition.commitment')) {
      fail('MAKER_V8_PLAYER_LOADOUT_LAYOUT_INVALID', 'Attached definition identity or commitment mismatch.');
    }
    seen.add(releaseId);
    if (expectedLayout === null) ownedSlots.push(...deriveMakerV8PackProfiles(bundle, admission).map(profile => ({ ...profile, releaseId })));
  }
  if (expectedLayout !== null) ownedSlots.push(...expectedLayout.profiles);
  const value = loadout.fields.selections;
  const rows = Array.isArray(value) ? value : value?.fields?.contents ?? value?.contents;
  if (!Array.isArray(rows)) fail('MAKER_V8_PLAYER_LOADOUT_SELECTIONS_INVALID', 'MakerLoadout selections are unavailable.');
  const slots = loadout.fields.definition_slots;
  if (!Array.isArray(slots)) fail('MAKER_V8_PLAYER_LOADOUT_LAYOUT_INVALID', 'MakerLoadout definition slots are unavailable.');
  let end = 0n;
  const keys = new Set();
  let ownedIndex = 0;
  let reachedOwned = false;
  for (const row of slots) {
    const slot = moveFields(row, 'MakerLoadout definition slot');
    const part = moveText(slot.part_key, 'DefinitionSlot.partKey');
    const capacity = BigInt(decimal(slot.capacity, 'DefinitionSlot.capacity'));
    const sourceId = moveId(slot.source_definition_id, 'DefinitionSlot.sourceDefinitionId');
    const scopedKey = `${sourceId}/${part}`;
    if (sourceId !== moveId(loadout.fields.root_id, 'MakerLoadout.rootId')) {
      reachedOwned = true;
      const expected = ownedSlots[ownedIndex++];
      if (!expected || expected.releaseId !== sourceId || expected.partKey !== part
        || BigInt(expected.capacity) !== capacity
        || expected.profileCommitment !== hex(slot.profile_commitment, 'DefinitionSlot.profileCommitment')) {
        fail('MAKER_V8_PLAYER_LOADOUT_LAYOUT_INVALID', 'Owned slot differs from its ordered Pack profile.');
      }
    } else if (reachedOwned) fail('MAKER_V8_PLAYER_LOADOUT_LAYOUT_INVALID', 'Base slot follows a Pack slot.');
    if (!part || keys.has(scopedKey) || BigInt(decimal(slot.start, 'DefinitionSlot.start')) !== end
      || capacity === 0n || capacity > 64n || end + capacity > 500n || end + capacity > BigInt(rows.length)
      || !HASH.test(hex(slot.profile_commitment, 'DefinitionSlot.profileCommitment'))) {
      fail('MAKER_V8_PLAYER_LOADOUT_LAYOUT_INVALID', 'MakerLoadout definition slot identity/range mismatch.');
    }
    keys.add(scopedKey);
    for (let index = Number(end); index < Number(end + capacity); index++) {
      const selected = moveOption(rows[index], `loadout.selections[${index}]`);
      if (selected !== null && (moveText(moveFields(selected, 'selection').part_key, 'selection.partKey') !== part
        || decimal(moveFields(selected, 'selection').selection_index, 'selection.selectionIndex') !== String(index))) {
        fail('MAKER_V8_PLAYER_LOADOUT_LAYOUT_INVALID', 'Selection differs from its scoped definition slot.');
      }
    }
    end += capacity;
  }
  if (end !== BigInt(rows.length) || ownedIndex !== ownedSlots.length) fail('MAKER_V8_PLAYER_LOADOUT_LAYOUT_INVALID', 'MakerLoadout definition slot coverage mismatch.');
  return rows.map((row, index) => {
    const selected = moveOption(row, `loadout.selections[${index}]`);
    if (selected === null) return null;
    const fields = moveFields(selected, `loadout.selections[${index}]`);
    const selectedSwatch = moveOption(fields.swatch_key, `loadout.selections[${index}].swatchKey`);
    return freeze({
      selectionIndex: Number(decimal(fields.selection_index, `loadout.selections[${index}].selectionIndex`)),
      partKey: moveText(fields.part_key, `loadout.selections[${index}].partKey`),
      itemKey: moveText(fields.item_key, `loadout.selections[${index}].itemKey`),
      styleKey: moveText(fields.style_key, `loadout.selections[${index}].styleKey`),
      swatchKey: selectedSwatch === null
        ? null : moveText(selectedSwatch, `loadout.selections[${index}].swatchKey`),
      sourceClass: Number(decimal(fields.source_class, `loadout.selections[${index}].sourceClass`)),
      sourceDefinitionId: moveId(fields.source_definition_id, `loadout.selections[${index}].sourceDefinitionId`),
      accessSubject: moveId(fields.access_subject, `loadout.selections[${index}].accessSubject`),
      sourceEpoch: decimal(fields.source_epoch, `loadout.selections[${index}].sourceEpoch`),
      sourceSemanticId: typeof fields.source_semantic_id === 'string'
        ? fields.source_semantic_id : moveText(fields.source_semantic_id, `loadout.selections[${index}].sourceSemanticId`),
      protected: fields.protected === true,
      sealBindingCommitment: fields.protected === true
        ? hex(fields.seal_binding_commitment, `loadout.selections[${index}].sealBindingCommitment`)
        : null,
      assetContentCommitment: hex(fields.asset_content_commitment, `loadout.selections[${index}].assetContentCommitment`),
    });
  });
}

/** Verify historical Loadout bytes against the layout bound into the prepared
 * transaction descriptor. Does not refetch mutable latest state during recovery. */
export function assertMakerV8PlayerLoadoutLayoutV8(fields, expectedLayout) {
  if (!expectedLayout) fail('MAKER_V8_PLAYER_LOADOUT_LAYOUT_INVALID', 'Prepared attachment layout evidence is missing.');
  return loadoutSelections({ fields: { ...fields, root_id: fields.rootId,
    attached_pack_definitions: fields.attachedPackDefinitions, definition_slots: fields.definitionSlots } },
  new Map(), 0, expectedLayout);
}

function completePrice(mode, price, quota, ordinal, label) {
  const position = BigInt(decimal(ordinal, `${label}.ordinal`));
  const amount = BigInt(decimal(price, `${label}.price`));
  const free = BigInt(decimal(quota, `${label}.quota`));
  if (mode === 0) return '0';
  if (mode === 2) return amount.toString();
  if (mode === 1) return position < free ? '0' : amount.toString();
  if (mode === 3) {
    if (position >= free) fail('MAKER_V8_PLAYER_COMPLETE_QUOTA_EXHAUSTED', `${label} free Complete quota is exhausted.`);
    return '0';
  }
  fail('MAKER_V8_PLAYER_COMPLETE_POLICY_INVALID', `${label} has an unknown Complete mode.`);
}

function makerEntryQuote(runtime, state) {
  const kind = state.rootInfo.economics.makerAccess;
  if (![0, 1].includes(kind)) fail('MAKER_V8_PLAYER_MAKER_ACCESS_POLICY_INVALID', 'Root Maker access policy is not callable.');
  return freeze({ rootId: state.objects.root.objectId, kind,
    priceAtomic: kind === 0 ? '0' : decimal(state.rootInfo.economics.makerPriceAtomic, 'Maker entry price', { positive: true }),
    paymentCoinType: runtime.paymentCoinType });
}

function packEntryQuote(runtime, release) {
  const kind = Number(decimal(release.fields.access_kind, 'PackRelease.accessKind'));
  if (![0, 1, 2].includes(kind)) fail('MAKER_V8_PLAYER_PACK_ACCESS_POLICY_INVALID', 'Pack access policy is not callable.');
  return freeze({ releaseId: release.objectId, kind,
    priceAtomic: kind === 1 ? decimal(release.fields.access_price_atomic, 'PackRelease.accessPrice', { positive: true }) : '0',
    paymentCoinType: runtime.paymentCoinType,
    requiresMakerAccess: makerV8PlayerRequiresMakerAccessV8(MAKER_V8_PLAYER_ACTIONS.ACQUIRE_PACK_ACCESS, kind) });
}

function completionOverview(runtime, state, request) {
  const { objects } = state;
  const signer = request.account.address;
  const held = (object, label) => {
    if (object === null) return false;
    if (!plain(object) || object.owner?.kind !== 'ADDRESS' || object.owner.address !== signer
      || address(object.fields?.holder, `${label}.holder`) !== signer) {
      fail('MAKER_V8_PLAYER_QUOTE_OWNERSHIP_INVALID', `${label} does not prove this wallet's current ownership.`);
    }
    return true;
  };
  const bindsRoot = (object, versionField, label) => {
    if (moveId(object.fields.root_id, `${label}.rootId`) !== request.player.rootId
      || decimal(object.fields[versionField], `${label}.rootVersion`) !== request.player.makerVersion
      || hex(object.fields.root_content_commitment, `${label}.rootContent`) !== request.player.evidence.contentCommitment) {
      fail('MAKER_V8_PLAYER_QUOTE_OWNERSHIP_INVALID', `${label} belongs to another Maker version.`);
    }
  };
  const makerPolicy = makerEntryQuote(runtime, state);
  const makerOwned = held(objects.makerAccess, 'MakerAccess');
  if (makerOwned) bindsRoot(objects.makerAccess, 'maker_version', 'MakerAccess');
  const maker = { ...makerPolicy, required: !makerOwned,
    policyPriceAtomic: makerPolicy.priceAtomic, priceAtomic: makerOwned ? '0' : makerPolicy.priceAtomic,
    ownedObjectId: makerOwned ? objects.makerAccess.objectId : null };
  if (!Array.isArray(objects.packPasses) || !Array.isArray(objects.ownedBaseItems)) {
    fail('MAKER_V8_PLAYER_QUOTE_OWNERSHIP_INVALID', 'Completion entry inventory is incomplete.');
  }
  const packs = request.loadout.usedPacks.map(used => {
    const release = releaseFor(state, used.releaseId);
    const policy = packEntryQuote(runtime, release);
    const pass = unique(objects.packPasses, row => moveId(row.fields.release_id, 'PackPass.releaseId') === release.objectId,
      'PackPass', { required: false });
    const owned = held(pass, 'PackPass');
    if (owned) {
      bindsRoot(pass, 'root_version', 'PackPass');
      if (decimal(pass.fields.version, 'PackPass.version') !== '8'
        || hex(pass.fields.release_content_commitment, 'PackPass.releaseContent') !== hex(release.fields.content_commitment, 'PackRelease.content')) {
        fail('MAKER_V8_PLAYER_QUOTE_OWNERSHIP_INVALID', 'Pack entry proof belongs to another Release content.');
      }
    }
    return { ...policy, semanticPackId: used.semanticPackId, required: !owned,
      policyPriceAtomic: policy.priceAtomic, priceAtomic: owned ? '0' : policy.priceAtomic,
      ownedObjectId: owned ? pass.objectId : null };
  });
  const baseItems = [];
  if (typeof objects.runtimeDefinitions?.fields?.item_assetization !== 'boolean') {
    fail('MAKER_V8_PLAYER_QUOTE_POLICY_INVALID', 'The Base Item issuance policy is unavailable.');
  }
  if (itemAssetizationEnabled(state)) {
    const seen = new Set();
    for (const selection of request.loadout.selections.filter(row => row.source === 'BASE')) {
      const key = `${selection.partKey}\u0000${selection.itemKey}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const item = unique(objects.ownedBaseItems, row => moveText(row.fields.part_key, 'Base.partKey') === selection.partKey
        && moveText(row.fields.item_key, 'Base.itemKey') === selection.itemKey, 'OwnedBaseItem', { required: false });
      const owned = held(item, 'OwnedBaseItem');
      if (owned) bindsRoot(item, 'root_version', 'OwnedBaseItem');
      // Runtime claim_owned_base_item_v8 has no payment argument. It still needs
      // Maker access and its own network transaction when the item is missing.
      baseItems.push({ partKey: selection.partKey, itemKey: selection.itemKey, required: !owned,
        priceAtomic: '0', ownedObjectId: owned ? item.objectId : null });
    }
  }
  const complete = completePaymentQuote(runtime, state, request.loadout);
  const entryTotal = packs.reduce((sum, pack) => sum + BigInt(pack.priceAtomic), BigInt(maker.priceAtomic));
  return freeze({ rootId: request.player.rootId, signer,
    recipeCommitment: makerV8PlayerRecipeCommitmentV8(request.recipe), completePaymentQuote: complete,
    entryPaymentQuote: { paymentCoinType: runtime.paymentCoinType, maker, packs, baseItems, totalAmountAtomic: entryTotal.toString() },
    totalBusinessAmountAtomic: (entryTotal + BigInt(complete.totalAmountAtomic)).toString() });
}

function completeRightsQuote(root) {
  const rights = moveFields(root.fields.rights, 'Root.rights');
  const origin = Number(decimal(rights.origin, 'Root.rights.origin'));
  if (![0, 1].includes(origin) || typeof rights.creator_confirmed !== 'boolean'
    || typeof rights.evidence_certified !== 'boolean') {
    fail('MAKER_V8_PLAYER_COMPLETE_RIGHTS_INVALID', 'Root rights have invalid origin or confirmation fields.');
  }
  const optional = (key, parse) => {
    if (!Object.hasOwn(rights, key)) fail('MAKER_V8_PLAYER_COMPLETE_RIGHTS_INVALID', `Root rights lack ${key}.`);
    const value = moveOption(rights[key], `Root.rights.${key}`);
    return value === null ? null : parse(value, `Root.rights.${key}`);
  };
  // gRPC encodes an empty vector<u8> as empty Base64, not an empty array.
  // Only these optional rights fields permit it; required hashes stay strict.
  const emptyHash = (value, label) => value === '' || (Array.isArray(value) && value.length === 0)
    ? null : hex(value, label);
  const text = (value, label) => value === '' ? '' : moveText(value, label);
  const bps = (key) => {
    const value = decimal(rights[key], `Root.rights.${key}`);
    if (BigInt(value) > 10000n) fail('MAKER_V8_PLAYER_COMPLETE_RIGHTS_INVALID', 'Root royalty exceeds 10000 basis points.');
    return value;
  };
  return freeze({ origin, creator: address(rights.creator, 'Root.rights.creator'),
    creatorConfirmed: rights.creator_confirmed, evidenceCertified: rights.evidence_certified,
    certificationCatalogId: optional('certification_catalog_id', moveId),
    certificationBindingCommitment: optional('certification_binding_commitment', hex),
    evidenceLocator: text(rights.evidence_locator, 'Root.rights.evidenceLocator'),
    evidenceBlobId: text(rights.evidence_blob_id, 'Root.rights.evidenceBlobId'),
    evidenceSha256: emptyHash(rights.evidence_sha256, 'Root.rights.evidenceSha256'),
    termsCommitment: emptyHash(rights.terms_commitment, 'Root.rights.termsCommitment'),
    soulCreatorRoyaltyBps: bps('soul_creator_royalty_bps'),
    makerSourceRoyaltyBps: bps('maker_source_royalty_bps'),
    makerResaleRoyaltyBps: bps('maker_resale_royalty_bps'),
    commitment: hex(rights.commitment, 'Root.rights.commitment') });
}

// Quote the prepared Complete transaction separately from entry, upload and gas.
// These same amounts drive its transaction; there is no separate UI price formula.
function completePaymentQuote(runtime, state, loadout) {
  const total = (cap, completed, label) => {
    const totalCap = decimal(cap, `${label}.totalCap`);
    const totalCompleted = decimal(completed, `${label}.totalCompleted`);
    if (BigInt(totalCap) !== 0n && BigInt(totalCompleted) >= BigInt(totalCap)) {
      fail('MAKER_V8_PLAYER_COMPLETE_TOTAL_CAP_EXHAUSTED', `${label} total Complete cap is exhausted.`);
    }
    return { totalCap, totalCompleted, remainingTotalUses: totalCap === '0'
      ? null : (BigInt(totalCap) - BigInt(totalCompleted)).toString() };
  };
  const line = (mode, price, quota, ordinal, label) => {
    const priceAtomic = decimal(price, `${label}.price`);
    const freeQuota = decimal(quota, `${label}.quota`);
    const walletCompleted = decimal(ordinal, `${label}.ordinal`);
    return {
      mode, priceAtomic, freeQuota,
      // Non-quota policies may use the existing price-only zero counter fallback.
      // Do not present that fallback as an observed wallet use count.
      walletCompleted: [1, 3].includes(mode) ? walletCompleted : null,
      remainingFreeUses: [1, 3].includes(mode)
        ? (BigInt(freeQuota) > BigInt(walletCompleted)
          ? BigInt(freeQuota) - BigInt(walletCompleted) : 0n).toString() : null,
      contentAmountAtomic: completePrice(mode, priceAtomic, freeQuota, walletCompleted, label),
    };
  };
  const economics = state.rootInfo.economics;
  const maker = {
    ...total(economics.completeTotalCap, state.objects.outputRegistry.fields.total_complete_count, 'Maker Complete'),
    ...line(economics.completeMode, economics.completePriceAtomic,
      economics.completeQuota, state.counters.baseOrdinal, 'Maker Complete'),
    fixedFeeAtomic: decimal(economics.fixedCompleteFeeAtomic, 'Maker Complete.fixedFee'),
  };
  maker.amountAtomic = (BigInt(maker.contentAmountAtomic) + BigInt(maker.fixedFeeAtomic)).toString();
  const seen = new Set();
  const packs = loadout.usedPacks.map((used) => {
    if (seen.has(used.releaseId)) {
      fail('MAKER_V8_PLAYER_COMPLETE_POLICY_INVALID', 'Complete quote repeats a used Pack.');
    }
    seen.add(used.releaseId);
    const release = releaseFor(state, used.releaseId);
    const policy = line(Number(decimal(release.fields.complete_mode, 'PackRelease.completeMode')),
      release.fields.complete_price_atomic, release.fields.complete_free_quota_per_wallet,
      state.counters.packOrdinals[release.objectId], `Pack Complete ${release.objectId}`);
    return { releaseId: release.objectId, semanticPackId: used.semanticPackId,
      ...total(release.fields.complete_total_cap, release.fields.total_complete_count, `Pack Complete ${release.objectId}`),
      ...policy, amountAtomic: policy.contentAmountAtomic };
  });
  return freeze({
    paymentCoinType: runtime.paymentCoinType,
    rights: completeRightsQuote(state.objects.root),
    maker, packs,
    totalAmountAtomic: packs.reduce((total, pack) => total + BigInt(pack.amountAtomic),
      BigInt(maker.amountAtomic)).toString(),
  });
}

function defaultCounterSnapshot(rootInfo, releases) {
  const needsBase = [1, 3].includes(rootInfo.economics.completeMode);
  const needsPack = releases.some((release) => [1, 3].includes(Number(decimal(
    release.fields.complete_mode,
    'packRelease.completeMode',
  ))));
  if (needsBase || needsPack) {
    fail(
      'MAKER_V8_PLAYER_DYNAMIC_COUNTER_READER_REQUIRED',
      'Quota-based Complete requires an exact official gRPC dynamic-field counter reader.',
    );
  }
  return freeze({
    baseOrdinal: '0',
    packOrdinals: freeze(Object.fromEntries(releases.map((release) => [release.objectId, '0']))),
  });
}

function assertCounters(value, releases) {
  exact(value, ['baseOrdinal', 'packOrdinals'], 'Player Complete counters');
  decimal(value.baseOrdinal, 'Player Complete base ordinal');
  if (!plain(value.packOrdinals)) fail('MAKER_V8_PLAYER_COUNTERS_INVALID', 'Pack counters must be an exact map.');
  const expected = releases.map((release) => release.objectId).sort();
  const observed = Object.keys(value.packOrdinals).sort();
  if (expected.length !== observed.length
    || expected.some((key, index) => key !== observed[index])) {
    fail('MAKER_V8_PLAYER_COUNTERS_INVALID', 'Pack Complete counters do not cover the exact used Releases.');
  }
  for (const release of releases) decimal(value.packOrdinals[release.objectId], `Pack ${release.objectId} ordinal`);
  return freeze(clone(value, 'Player Complete counters'));
}

function assertPhysicalPolicy(value, selection) {
  exact(value, [
    'source', 'selectionIndex', 'issuanceKind', 'priceAtomic',
    'expectedIssuedCount', 'policyCommitment',
  ], 'Physical policy');
  if (value.source !== selection.source
    || value.selectionIndex !== selection.selectionIndex
    || ![0, 1, 2].includes(value.issuanceKind)) {
    fail('MAKER_V8_PLAYER_PHYSICAL_POLICY_INVALID', 'Physical policy differs from the exact current selection.');
  }
  decimal(value.priceAtomic, 'Physical price');
  decimal(value.expectedIssuedCount, 'Physical expected issued count');
  if (!HASH.test(value.policyCommitment)) fail('MAKER_V8_PLAYER_PHYSICAL_POLICY_INVALID', 'Physical policy commitment is invalid.');
  return freeze(clone(value, 'Physical policy'));
}

function assertPackStyleDefinitionSources(value, colorChannelKey) {
  exact(value, ['part', 'track', 'color'], 'Pack Style definition sources');
  if (![1, 2].includes(value.part) || ![1, 2].includes(value.track)
    || (colorChannelKey === null ? value.color !== null : ![1, 2].includes(value.color))) {
    fail('MAKER_V8_PLAYER_PACK_DEFINITION_SOURCES_INVALID', 'Pack Style definition sources are invalid or differ from its color channel.');
  }
}

function assertPackStyles(value, selections) {
  if (!Array.isArray(value)) {
    fail('MAKER_V8_PLAYER_PACK_STYLE_READER_INVALID', 'Pack Style reader must return one exact array.');
  }
  const expected = [...selections].sort((left, right) => left.selectionIndex - right.selectionIndex);
  const normalized = value.map((row, index) => {
    // Every owned definition must resolve inside the verified Release bundle.
    const selection = selections.find(selection => selection.selectionIndex === row?.selectionIndex);
    assertPackStyleDefinitionSources(row?.definitionSources, selection?.colorChannelKey);
    exact(row, [
      'selectionIndex', 'releaseId', 'semanticPackId', 'partKey', 'itemKey',
      'styleKey', 'trackKey', 'swatchKey', 'protected',
      'assetContentCommitment', 'styleCommitment', 'definitionSources',
      ...(Object.hasOwn(row, 'ownedDefinitions') ? ['ownedDefinitions'] : []),
    ], `Pack Style policy[${index}]`);
    if (!Number.isSafeInteger(row.selectionIndex) || row.selectionIndex < 0
      || typeof row.protected !== 'boolean'
      || (row.swatchKey !== null && (typeof row.swatchKey !== 'string' || row.swatchKey.length === 0))) {
      fail('MAKER_V8_PLAYER_PACK_STYLE_READER_INVALID', 'Pack Style policy contains invalid scalar fields.');
    }
    address(row.releaseId, `Pack Style policy[${index}].releaseId`);
    for (const key of ['semanticPackId', 'partKey', 'itemKey', 'styleKey', 'trackKey']) {
      if (typeof row[key] !== 'string' || row[key].length === 0 || row[key].length > 1024) {
        fail('MAKER_V8_PLAYER_PACK_STYLE_READER_INVALID', `Pack Style policy ${key} is invalid.`);
      }
    }
    hex(row.assetContentCommitment, `Pack Style policy[${index}].assetContentCommitment`);
    hex(row.styleCommitment, `Pack Style policy[${index}].styleCommitment`);
    if (Object.hasOwn(row, 'ownedDefinitions') && (!plain(row.ownedDefinitions)
      || row.ownedDefinitions.releaseId !== row.releaseId || row.ownedDefinitions.semanticPackId !== row.semanticPackId
      || !HASH.test(row.ownedDefinitions.definitionCommitment))) {
      fail('MAKER_V8_PLAYER_PACK_DEFINITION_REFERENCE_INVALID', 'Pack definition bundle differs from its Style policy.');
    }
    for (const [term, collection, key] of [['part', 'parts', row.partKey], ['track', 'tracks', row.trackKey]]) {
      if (row.definitionSources[term] === 2 && (!row.ownedDefinitions
        || !Array.isArray(row.ownedDefinitions.rows?.[collection])
        || row.ownedDefinitions.rows[collection].filter(definition => definition.key === key).length !== 1)) {
        fail('MAKER_V8_PLAYER_PACK_DEFINITION_REFERENCE_INVALID', `Owned ${term} requires its verified Release definition row.`);
      }
    }
    if (row.definitionSources.color === 2) {
      const channels = row.ownedDefinitions?.rows?.colors;
      const matches = Array.isArray(channels) ? channels.filter(channel => channel.key === selection.colorChannelKey) : [];
      if (matches.length !== 1 || !Array.isArray(matches[0].swatches)
        || [selection.defaultSwatchKey, selection.swatchKey].some(key => matches[0].swatches.filter(swatch => swatch.key === key).length !== 1)) {
        fail('MAKER_V8_PLAYER_PACK_DEFINITION_REFERENCE_INVALID', 'Owned Color requires its exact default and selected swatches.');
      }
    }
    return freeze(clone(row, `Pack Style policy[${index}]`));
  }).sort((left, right) => left.selectionIndex - right.selectionIndex);
  if (normalized.length !== expected.length) {
    fail('MAKER_V8_PLAYER_PACK_STYLE_READER_INVALID', 'Pack Style policies do not cover the exact intended Pack selections.');
  }
  for (let index = 0; index < expected.length; index += 1) {
    const policy = normalized[index];
    const selection = expected[index];
    if (index > 0 && normalized[index - 1].selectionIndex === policy.selectionIndex
      || policy.selectionIndex !== selection.selectionIndex
      || policy.releaseId !== selection.releaseId
      || policy.semanticPackId !== selection.semanticPackId
      || policy.partKey !== selection.partKey
      || policy.itemKey !== selection.itemKey
      || policy.styleKey !== selection.styleKey
      || policy.trackKey !== selection.trackKey
      || policy.swatchKey !== selection.swatchKey) {
      fail('MAKER_V8_PLAYER_PACK_STYLE_READER_INVALID', 'Pack Style policy differs from the exact intended selection.');
    }
  }
  return freeze(normalized);
}

function assertExternalAdmissions(value, selections, products) {
  if (!Array.isArray(value)) {
    fail('MAKER_V8_PLAYER_EXTERNAL_ADMISSION_READER_INVALID', 'External admission reader must return one exact array.');
  }
  const productById = new Map(products.map((product) => [product.objectId, product]));
  const expectedIds = [...new Set(selections.map((selection) => selection.externalProductId))].sort();
  const normalized = value.map((row, index) => {
    exact(row, [
      'productId', 'compatibilityCommitment', 'productContentCommitment',
      'attestationCommitment', 'admittedRevision', 'admissionState',
    ], `External admission[${index}]`);
    const productId = address(row.productId, `External admission[${index}].productId`);
    const product = productById.get(productId);
    if (!product
      || hex(row.compatibilityCommitment, `External admission[${index}].compatibilityCommitment`)
        !== hex(product.fields.compatibility_commitment, 'ExternalItemProduct.compatibilityCommitment')
      || hex(row.productContentCommitment, `External admission[${index}].productContentCommitment`)
        !== hex(product.fields.content_commitment, 'ExternalItemProduct.contentCommitment')
      || row.attestationCommitment !== null
        && hex(row.attestationCommitment, `External admission[${index}].attestationCommitment`).length !== 64
      || decimal(row.admittedRevision, `External admission[${index}].admittedRevision`, { positive: true }) === '0'
      || Number(row.admissionState) !== 0) {
      fail('MAKER_V8_PLAYER_EXTERNAL_ADMISSION_DRIFT', 'External admission differs from the exact active Product authority.');
    }
    return freeze({
      productId,
      compatibilityCommitment: hex(row.compatibilityCommitment, `External admission[${index}].compatibilityCommitment`),
      productContentCommitment: hex(row.productContentCommitment, `External admission[${index}].productContentCommitment`),
      attestationCommitment: row.attestationCommitment === null ? null
        : hex(row.attestationCommitment, `External admission[${index}].attestationCommitment`),
      admittedRevision: decimal(row.admittedRevision, `External admission[${index}].admittedRevision`, { positive: true }),
      admissionState: 0,
    });
  }).sort((left, right) => left.productId.localeCompare(right.productId));
  if (normalized.length !== expectedIds.length
    || normalized.some((row, index) => row.productId !== expectedIds[index])) {
    fail('MAKER_V8_PLAYER_EXTERNAL_ADMISSION_DRIFT', 'External admissions do not cover the exact intended Products.');
  }
  return freeze(normalized);
}

export async function readMakerV8ExternalAdmissionsV8({ client, runtime, packRegistry, products }) {
  if (typeof client?.getDynamicField !== 'function') {
    fail(
      'MAKER_V8_PLAYER_EXTERNAL_ADMISSION_READER_REQUIRED',
      'External execution requires the official gRPC dynamic-field point reader.',
    );
  }
  const parentId = moveId(
    packRegistry.fields.external_admissions,
    'PackRegistry.externalAdmissions.tableId',
  );
  const valueType = stableType(runtime, 'runtime', 'runtime_v8', 'ExternalAdmissionRecordV8');
  const rows = [];
  for (const product of products) {
    const nameBytes = bcs.Address.serialize(product.objectId).toBytes();
    const field = await client.getDynamicField({
      parentId,
      name: {
        type: '0x0000000000000000000000000000000000000000000000000000000000000002::object::ID',
        bcsBase64: toBase64(nameBytes),
      },
    });
    if (!plain(field) || field.kind !== 'DynamicField'
      || normalizeStructTag(field.value?.type) !== normalizeStructTag(valueType)
      || field.name?.bcsBase64 !== toBase64(nameBytes)) {
      fail('MAKER_V8_PLAYER_EXTERNAL_ADMISSION_DRIFT', 'External admission dynamic field has another exact key/type.');
    }
    const raw = fromBase64(base64(field.value.bcsBase64, 'External admission BCS', 4096));
    let parsed;
    let roundtrip;
    try {
      parsed = EXTERNAL_ADMISSION_RECORD_BCS.parse(raw);
      roundtrip = EXTERNAL_ADMISSION_RECORD_BCS.serialize(parsed).toBytes();
    } catch {
      fail('MAKER_V8_PLAYER_EXTERNAL_ADMISSION_BCS_INVALID', 'External admission cannot be canonically decoded.');
    }
    if (roundtrip.length !== raw.length
      || roundtrip.some((byte, index) => byte !== raw[index])) {
      fail('MAKER_V8_PLAYER_EXTERNAL_ADMISSION_BCS_INVALID', 'External admission BCS is noncanonical.');
    }
    rows.push({
      productId: address(parsed.product_id, 'External admission productId'),
      compatibilityCommitment: hex(Array.from(parsed.compatibility_commitment), 'External admission compatibility'),
      productContentCommitment: hex(Array.from(parsed.product_content_commitment), 'External admission content'),
      attestationCommitment: parsed.attestation_commitment === null ? null
        : hex(Array.from(parsed.attestation_commitment), 'External admission attestation'),
      admittedRevision: decimal(parsed.admitted_revision, 'External admission revision', { positive: true }),
      admissionState: Number(parsed.admission_state),
    });
  }
  await pinnedMainnet(client);
  return rows;
}

/**
 * Point-reads only the Pack Styles selected by the active Player recipe.
 * The release Table ID, dynamic-field key, value TypeOrigin and canonical BCS
 * are all independently bound before any row reaches the transaction compiler.
 */
export async function readMakerV8PackStylesV8({ client, runtime, releases, selections }) {
  if (typeof client?.getDynamicField !== 'function') {
    fail(
      'MAKER_V8_PLAYER_PACK_STYLE_READER_REQUIRED',
      'Pack execution requires the official gRPC dynamic-field point reader.',
    );
  }
  if (!Array.isArray(releases) || !Array.isArray(selections)) {
    fail('MAKER_V8_PLAYER_PACK_STYLE_READER_INVALID', 'Pack Style point-read input is invalid.');
  }
  const releaseById = new Map(releases.map((release) => [release.objectId, release]));
  if (releaseById.size !== releases.length) {
    fail('MAKER_V8_PLAYER_PACK_STYLE_READER_INVALID', 'Pack Style Releases contain duplicate identities.');
  }
  const keyType = stableType(runtime, 'runtime', 'runtime_v8', 'PackStyleKeyV8');
  const valueType = stableType(runtime, 'runtime', 'runtime_v8', 'PackStyleV8');
  const definitionsByRelease = new Map();
  const rows = [];
  for (const selection of selections) {
    const release = releaseById.get(selection.releaseId);
    if (!release) {
      fail('MAKER_V8_PLAYER_PACK_STYLE_READER_INVALID', 'Pack Style selection references an unavailable Release.');
    }
    const parentId = moveTableId(release.fields.styles, 'PackRelease.styles.tableId');
    const key = {
      part_key: selection.partKey,
      item_key: selection.itemKey,
      style_key: selection.styleKey,
    };
    let nameBytes;
    try {
      nameBytes = PACK_STYLE_KEY_BCS.serialize(key).toBytes();
    } catch {
      fail('MAKER_V8_PLAYER_PACK_STYLE_KEY_INVALID', 'Pack Style key cannot be canonically encoded.');
    }
    const nameBcsBase64 = toBase64(nameBytes);
    const field = await client.getDynamicField({
      parentId,
      name: { type: keyType, bcsBase64: nameBcsBase64 },
    });
    if (!plain(field) || field.kind !== 'DynamicField'
      || normalizeStructTag(field.name?.type) !== normalizeStructTag(keyType)
      || field.name?.bcsBase64 !== nameBcsBase64
      || normalizeStructTag(field.value?.type) !== normalizeStructTag(valueType)) {
      fail('MAKER_V8_PLAYER_PACK_STYLE_DRIFT', 'Pack Style dynamic field has another exact key or TypeOrigin.');
    }
    const raw = fromBase64(base64(field.value.bcsBase64, 'Pack Style BCS', 16 * 1024));
    let parsed;
    let roundtrip;
    try {
      parsed = PACK_STYLE_BCS.parse(raw);
      roundtrip = PACK_STYLE_BCS.serialize(parsed).toBytes();
    } catch {
      fail('MAKER_V8_PLAYER_PACK_STYLE_BCS_INVALID', 'Pack Style cannot be canonically decoded.');
    }
    if (roundtrip.length !== raw.length
      || roundtrip.some((byte, index) => byte !== raw[index])) {
      fail('MAKER_V8_PLAYER_PACK_STYLE_BCS_INVALID', 'Pack Style BCS is noncanonical.');
    }
    const colorChannelKey = parsed.color_channel_key === null
      ? null : moveText(parsed.color_channel_key, 'Pack Style colorChannelKey');
    assertPackStyleDefinitionSources(parsed.definition_sources, colorChannelKey);
    const defaultSwatchKey = parsed.default_swatch_key === null
      ? null : moveText(parsed.default_swatch_key, 'Pack Style defaultSwatchKey');
    const assetSha256 = hex(Array.from(parsed.asset_sha256), 'Pack Style assetSha256');
    const assetContentCommitment = hex(
      Array.from(parsed.asset_content_commitment),
      'Pack Style assetContentCommitment',
    );
    const styleCommitment = hex(Array.from(parsed.style_commitment), 'Pack Style styleCommitment');
    const sealBinding = Array.from(parsed.seal_binding_commitment);
    if (moveText(parsed.part_key, 'Pack Style partKey') !== selection.partKey
      || moveText(parsed.item_key, 'Pack Style itemKey') !== selection.itemKey
      || moveText(parsed.style_key, 'Pack Style styleKey') !== selection.styleKey
      || moveText(parsed.layer_track_key, 'Pack Style trackKey') !== selection.trackKey
      || colorChannelKey !== selection.colorChannelKey
      || defaultSwatchKey !== selection.defaultSwatchKey
      || typeof parsed.protected !== 'boolean'
      || (parsed.protected && sealBinding.length !== 32)
      || (!parsed.protected && sealBinding.length !== 0)) {
      fail('MAKER_V8_PLAYER_PACK_STYLE_DRIFT', 'Pack Style differs from the exact intended Player selection.');
    }
    moveText(parsed.asset_blob_id, 'Pack Style assetBlobId');
    decimal(parsed.index, 'Pack Style index');
    let ownedDefinitions;
    const sources = parsed.definition_sources;
    {
      if (moveText(release.fields.semantic_pack_id, 'PackRelease.semanticPackId') !== selection.semanticPackId) {
        fail('MAKER_V8_PLAYER_PACK_STYLE_DRIFT', 'Pack Style semantic identity differs from its Release.');
      }
      if (!definitionsByRelease.has(selection.releaseId)) {
        definitionsByRelease.set(selection.releaseId, await findMakerV8PackDefinitions(client, {
          runtimeOriginalPackageId: valueType.split('::')[0], releaseId: selection.releaseId,
          contentCommitment: hex(release.fields.content_commitment, 'PackRelease.contentCommitment'),
          semanticPackId: selection.semanticPackId,
        }));
      }
      ownedDefinitions = definitionsByRelease.get(selection.releaseId);
    }
    if (!ownedDefinitions && (sources.part === 2 || sources.track === 2 || sources.color === 2)) {
      fail('MAKER_V8_PLAYER_PACK_DEFINITION_REFERENCE_INVALID', 'Owned Style references a Release without definitions.');
    }
    if (ownedDefinitions) {
      const unique = (values, predicate) => {
        const matches = values.filter(predicate);
        if (matches.length !== 1) fail('MAKER_V8_PLAYER_PACK_DEFINITION_REFERENCE_INVALID',
          'Pack Style requires one exact owned definition; Base or another Release cannot substitute.');
        return matches[0];
      };
      // Source 1 is deliberately not resolved against this bundle, even for
      // same-named keys. Its authority remains the sealed Base registry.
      if (sources.part === 2) unique(ownedDefinitions.rows.parts, row => row.key === selection.partKey);
      if (sources.track === 2) unique(ownedDefinitions.rows.tracks, row => row.key === selection.trackKey);
      if (sources.color === 2) {
        const channel = unique(ownedDefinitions.rows.colors, row => row.key === colorChannelKey);
        for (const key of [defaultSwatchKey, selection.swatchKey]) {
          unique(channel.swatches, row => row.key === key);
        }
      }
      const item = unique(ownedDefinitions.rows.visibility, row => row.subject === 1
        && row.part_key === selection.partKey && row.item_key === selection.itemKey && row.style_key === null);
      if (![1, 2].includes(item.definition_source) || (sources.part === 2 && item.definition_source !== 2)) {
        fail('MAKER_V8_PLAYER_PACK_DEFINITION_REFERENCE_INVALID', 'Owned Part cannot inherit a Base Item visibility program.');
      }
      unique(ownedDefinitions.rows.visibility, row => row.subject === 2 && row.definition_source === 2
        && row.part_key === selection.partKey && row.item_key === selection.itemKey && row.style_key === selection.styleKey);
    }
    rows.push({
      selectionIndex: selection.selectionIndex,
      releaseId: selection.releaseId,
      semanticPackId: selection.semanticPackId,
      partKey: selection.partKey,
      itemKey: selection.itemKey,
      styleKey: selection.styleKey,
      trackKey: selection.trackKey,
      swatchKey: selection.swatchKey,
      definitionSources: parsed.definition_sources,
      ...(ownedDefinitions ? { ownedDefinitions } : {}),
      protected: parsed.protected,
      assetContentCommitment,
      ...(parsed.protected ? {
        sealBindingCommitment: hex(sealBinding, 'Pack Style sealBindingCommitment'),
      } : {}),
      styleCommitment,
    });
    // Force validation even though these fields are not duplicated in the
    // compact compiler projection.
    void assetSha256;
  }
  await pinnedMainnet(client);
  return rows;
}

function protectedSelectionKey(selection) {
  const scopeKind = selection.source === 'BASE' ? 0 : 1;
  const scopeKey = selection.source === 'BASE'
    ? 'maker/base' : `pack/${selection.semanticPackId}`;
  const assetKey = `${selection.partKey}/${selection.itemKey}/${selection.styleKey}`;
  return freeze({ scopeKind, scopeKey, assetKey });
}

function assertProtectedAssets(value, selections) {
  if (!Array.isArray(value) || value.length !== selections.length) {
    fail('MAKER_V8_PLAYER_PROTECTED_ASSET_READER_INVALID', 'Protected rows must cover every exact protected selection.');
  }
  const expected = [...selections].sort((left, right) => left.selectionIndex - right.selectionIndex);
  const normalized = value.map((row, index) => {
    exact(row, [
      'selectionIndex', 'source', 'scopeKind', 'scopeKey', 'scopeCommitment',
      'assetKey', 'assetContentCommitment', 'ciphertextBlobId', 'ciphertextSha256',
      'ciphertextBlobCommitment', 'certificationCommitment', 'sealId',
    ], `Protected asset[${index}]`);
    if (!Number.isSafeInteger(row.selectionIndex) || row.selectionIndex < 0
      || !['BASE', 'PACK'].includes(row.source)
      || ![0, 1].includes(row.scopeKind)) {
      fail('MAKER_V8_PLAYER_PROTECTED_ASSET_READER_INVALID', 'Protected row scalar identity is invalid.');
    }
    for (const field of [
      'scopeCommitment', 'assetContentCommitment', 'ciphertextSha256',
      'ciphertextBlobCommitment', 'certificationCommitment', 'sealId',
    ]) hex(row[field], `Protected asset[${index}].${field}`);
    for (const field of ['scopeKey', 'assetKey', 'ciphertextBlobId']) {
      if (typeof row[field] !== 'string' || row[field].length < 1 || row[field].length > 1024) {
        fail('MAKER_V8_PLAYER_PROTECTED_ASSET_READER_INVALID', `Protected asset ${field} is invalid.`);
      }
    }
    return freeze(clone(row, `Protected asset[${index}]`));
  }).sort((left, right) => left.selectionIndex - right.selectionIndex);
  for (let index = 0; index < expected.length; index += 1) {
    const selection = expected[index];
    const row = normalized[index];
    const key = protectedSelectionKey(selection);
    if (row.selectionIndex !== selection.selectionIndex
      || row.source !== selection.source
      || row.scopeKind !== key.scopeKind
      || row.scopeKey !== key.scopeKey
      || row.assetKey !== key.assetKey) {
      fail('MAKER_V8_PLAYER_PROTECTED_ASSET_DRIFT', 'Protected row differs from the exact Player selection.');
    }
  }
  return freeze(normalized);
}

export async function readMakerV8ProtectedAssetsV8({
  client, runtime, sealRegistry, selections,
}) {
  if (!Array.isArray(selections) || selections.some((selection) => (
    !['BASE', 'PACK'].includes(selection.source)
  ))) {
    fail('MAKER_V8_PLAYER_PROTECTED_ASSET_REQUEST_INVALID', 'Protected row request is invalid.');
  }
  const keyType = stableType(runtime, 'seal', 'seal_v8', 'ProtectedAssetKeyV8');
  const valueType = stableType(runtime, 'seal', 'seal_v8', 'ProtectedAssetV8');
  const tableIds = [
    moveTableId(sealRegistry.fields.assets, 'SealRegistry.assets.tableId'),
    moveTableId(sealRegistry.fields.runtime_assets, 'SealRegistry.runtimeAssets.tableId'),
  ];
  const rows = [];
  for (const selection of selections) {
    const key = protectedSelectionKey(selection);
    const nameBytes = PROTECTED_ASSET_KEY_BCS.serialize({
      scope_kind: key.scopeKind,
      scope_key: key.scopeKey,
      asset_key: key.assetKey,
    }).toBytes();
    const nameBcsBase64 = toBase64(nameBytes);
    const matches = [];
    for (const parentId of tableIds) {
      try {
        const field = await client.getDynamicField({
          parentId,
          name: { type: keyType, bcsBase64: nameBcsBase64 },
        });
        if (!plain(field) || field.kind !== 'DynamicField'
          || normalizeStructTag(field.name?.type) !== normalizeStructTag(keyType)
          || field.name?.bcsBase64 !== nameBcsBase64
          || normalizeStructTag(field.value?.type) !== normalizeStructTag(valueType)) {
          fail('MAKER_V8_PLAYER_PROTECTED_ASSET_DRIFT', 'Protected row dynamic field identity is invalid.');
        }
        const raw = fromBase64(base64(field.value.bcsBase64, 'Protected asset BCS', 64 * 1024));
        let parsed;
        let roundtrip;
        try {
          parsed = PROTECTED_ASSET_BCS.parse(raw);
          roundtrip = PROTECTED_ASSET_BCS.serialize(parsed).toBytes();
        } catch {
          fail('MAKER_V8_PLAYER_PROTECTED_ASSET_BCS_INVALID', 'Protected row cannot be canonically decoded.');
        }
        if (roundtrip.length !== raw.length
          || roundtrip.some((byte, index) => byte !== raw[index])) {
          fail('MAKER_V8_PLAYER_PROTECTED_ASSET_BCS_INVALID', 'Protected row BCS is noncanonical.');
        }
        matches.push(parsed);
      } catch (error) {
        if (!dynamicFieldNotFound(error)) throw error;
      }
    }
    if (matches.length !== 1) {
      fail('MAKER_V8_PLAYER_PROTECTED_ASSET_DRIFT', 'Protected row must exist in exactly one certified Seal table.');
    }
    const parsed = matches[0];
    rows.push(freeze({
      selectionIndex: selection.selectionIndex,
      source: selection.source,
      scopeKind: Number(parsed.scope_kind),
      scopeKey: moveText(parsed.scope_key, 'Protected asset scopeKey'),
      scopeCommitment: hex(Array.from(parsed.scope_commitment), 'Protected asset scopeCommitment'),
      assetKey: moveText(parsed.asset_key, 'Protected asset assetKey'),
      assetContentCommitment: hex(Array.from(parsed.asset_content_commitment), 'Protected asset contentCommitment'),
      ciphertextBlobId: moveText(parsed.ciphertext_blob_id, 'Protected asset blobId'),
      ciphertextSha256: hex(Array.from(parsed.ciphertext_sha256), 'Protected asset ciphertextSha256'),
      ciphertextBlobCommitment: hex(Array.from(parsed.ciphertext_blob_commitment), 'Protected asset blobCommitment'),
      certificationCommitment: hex(Array.from(parsed.certification_commitment), 'Protected asset certificationCommitment'),
      sealId: hex(Array.from(parsed.seal_id), 'Protected asset sealId'),
    }));
  }
  await pinnedMainnet(client);
  return assertProtectedAssets(rows, selections);
}

function dynamicFieldNotFound(error) {
  return error instanceof RpcError
    && error.name === 'RpcError'
    && error.code === 'NOT_FOUND';
}

async function readDynamicU64(client, parentId, keyType, keyBytes, label) {
  const nameBcsBase64 = toBase64(keyBytes);
  let field;
  try {
    field = await client.getDynamicField({
      parentId,
      name: { type: keyType, bcsBase64: nameBcsBase64 },
    });
  } catch (error) {
    if (dynamicFieldNotFound(error)) return '0';
    // Current SDK point reads wrap absence in ObjectError. Only the requested
    // holder's exact dynamic-field ID may stand for an uninitialized counter.
    if (error instanceof ObjectError && error.code === 'notExists'
      && error.reason === 'notFound'
      && error.objectId === deriveDynamicFieldID(parentId, keyType, keyBytes)) return '0';
    throw error;
  }
  if (!plain(field) || field.kind !== 'DynamicField'
    || normalizeStructTag(field.name?.type) !== normalizeStructTag(keyType)
    || field.name?.bcsBase64 !== nameBcsBase64
    || field.value?.type !== 'u64') {
    fail('MAKER_V8_PLAYER_COUNTER_DRIFT', `${label} has another exact key or value type.`);
  }
  const raw = fromBase64(base64(field.value.bcsBase64, `${label} BCS`, 32));
  let parsed;
  let roundtrip;
  try {
    parsed = bcs.u64().parse(raw);
    roundtrip = bcs.u64().serialize(parsed).toBytes();
  } catch {
    fail('MAKER_V8_PLAYER_COUNTER_BCS_INVALID', `${label} is not canonical u64 BCS.`);
  }
  if (roundtrip.length !== raw.length
    || roundtrip.some((byte, index) => byte !== raw[index])) {
    fail('MAKER_V8_PLAYER_COUNTER_BCS_INVALID', `${label} is not canonical u64 BCS.`);
  }
  return decimal(parsed, label);
}

/** Reads only the connected holder's base and used-Pack Complete ordinals. */
export async function readMakerV8CompleteCountersV8({
  client,
  runtime,
  outputRegistry,
  releases,
  account,
}) {
  if (typeof client?.getDynamicField !== 'function' || !Array.isArray(releases)) {
    fail(
      'MAKER_V8_PLAYER_DYNAMIC_COUNTER_READER_REQUIRED',
      'Quota-based Complete requires the official gRPC dynamic-field point reader.',
    );
  }
  const holder = address(account?.address, 'Complete counter holder');
  const outputKeyType = stableType(runtime, 'output', 'output_v8', 'WalletKeyV8');
  const baseOrdinal = await readDynamicU64(
    client,
    moveTableId(outputRegistry.fields.complete_by_wallet, 'OutputRegistry.completeByWallet.tableId'),
    outputKeyType,
    OUTPUT_WALLET_KEY_BCS.serialize({ holder }).toBytes(),
    'Maker Complete counter',
  );
  const packKeyType = stableType(runtime, 'runtime', 'runtime_v8', 'WalletKeyV8');
  const packOrdinals = {};
  for (const release of releases) {
    packOrdinals[release.objectId] = await readDynamicU64(
      client,
      moveTableId(release.fields.complete_by_wallet, `Pack ${release.objectId} completeByWallet.tableId`),
      packKeyType,
      PACK_WALLET_KEY_BCS.serialize({ wallet: holder }).toBytes(),
      `Pack ${release.objectId} Complete counter`,
    );
  }
  await pinnedMainnet(client);
  return freeze({ baseOrdinal, packOrdinals: freeze(packOrdinals) });
}

/** Reads one exact Base/Pack Physical policy row selected by the Player. */
export async function readMakerV8PhysicalPolicyV8({
  client,
  runtime,
  physicalRegistry,
  selection,
  release,
}) {
  if (typeof client?.getDynamicField !== 'function'
    || !plain(selection)
    || !['BASE', 'PACK'].includes(selection.source)
    || (selection.source === 'PACK' && !plain(release))) {
    fail(
      'MAKER_V8_PLAYER_PHYSICAL_POLICY_READER_REQUIRED',
      'Physical execution requires one exact official gRPC policy point reader.',
    );
  }
  const sourceKind = selection.source === 'BASE' ? 0 : 1;
  const sourceId = selection.source === 'BASE'
    ? moveId(physicalRegistry.fields.base_registry_id, 'PhysicalRegistry.baseRegistryId')
    : address(release.objectId, 'Physical Pack releaseId');
  const key = {
    source_kind: sourceKind,
    source_id: sourceId,
    part_key: selection.partKey,
    item_key: selection.itemKey,
    style_key: selection.styleKey,
  };
  let nameBytes;
  try {
    nameBytes = PHYSICAL_POLICY_KEY_BCS.serialize(key).toBytes();
  } catch {
    fail('MAKER_V8_PLAYER_PHYSICAL_POLICY_KEY_INVALID', 'Physical policy key is not canonical.');
  }
  const keyType = stableType(runtime, 'physical', 'physical_v8', 'PhysicalPolicyKeyV8');
  const valueType = stableType(runtime, 'physical', 'physical_v8', 'PhysicalStylePolicyV8');
  const parentId = moveTableId(
    selection.source === 'BASE'
      ? physicalRegistry.fields.base_policies
      : physicalRegistry.fields.pack_policies,
    `PhysicalRegistry.${selection.source === 'BASE' ? 'basePolicies' : 'packPolicies'}.tableId`,
  );
  const nameBcsBase64 = toBase64(nameBytes);
  const field = await client.getDynamicField({
    parentId,
    name: { type: keyType, bcsBase64: nameBcsBase64 },
  });
  if (!plain(field) || field.kind !== 'DynamicField'
    || normalizeStructTag(field.name?.type) !== normalizeStructTag(keyType)
    || field.name?.bcsBase64 !== nameBcsBase64
    || normalizeStructTag(field.value?.type) !== normalizeStructTag(valueType)) {
    fail('MAKER_V8_PLAYER_PHYSICAL_POLICY_DRIFT', 'Physical policy has another exact key or TypeOrigin.');
  }
  const raw = fromBase64(base64(field.value.bcsBase64, 'Physical policy BCS', 64 * 1024));
  let parsed;
  let roundtrip;
  try {
    parsed = PHYSICAL_STYLE_POLICY_BCS.parse(raw);
    roundtrip = PHYSICAL_STYLE_POLICY_BCS.serialize(parsed).toBytes();
  } catch {
    fail('MAKER_V8_PLAYER_PHYSICAL_POLICY_BCS_INVALID', 'Physical policy cannot be canonically decoded.');
  }
  if (roundtrip.length !== raw.length
    || roundtrip.some((byte, index) => byte !== raw[index])) {
    fail('MAKER_V8_PLAYER_PHYSICAL_POLICY_BCS_INVALID', 'Physical policy BCS is noncanonical.');
  }
  const issuanceKind = Number(parsed.issuance_kind);
  const proofKind = Number(parsed.proof_kind);
  const priceAtomic = decimal(parsed.price_atomic, 'Physical policy price');
  const maxSupply = BigInt(decimal(parsed.max_supply, 'Physical policy max supply', { positive: true }));
  const issuedCount = BigInt(decimal(parsed.issued_count, 'Physical policy issued count'));
  const sourceSemanticId = parsed.source.source_semantic_id;
  if (typeof sourceSemanticId !== 'string' || sourceSemanticId.length > 1024) {
    fail('MAKER_V8_PLAYER_PHYSICAL_POLICY_DRIFT', 'Physical policy semantic source is invalid.');
  }
  if (Number(parsed.source.source_kind) !== sourceKind
    || address(parsed.source.source_id, 'Physical policy sourceId') !== sourceId
    || moveText(parsed.style.part_key, 'Physical policy partKey') !== selection.partKey
    || moveText(parsed.style.item_key, 'Physical policy itemKey') !== selection.itemKey
    || moveText(parsed.style.style_key, 'Physical policy styleKey') !== selection.styleKey
    || parsed.style.style_protected !== false
    || sourceSemanticId !== (selection.source === 'BASE'
      ? '' : moveText(release.fields.semantic_pack_id, 'PackRelease.semanticPackId'))
    || issuedCount >= maxSupply
    || !(
      issuanceKind === 0 && proofKind === 0 && priceAtomic === '0'
      || issuanceKind === 1 && proofKind === 0 && BigInt(priceAtomic) > 0n
      || issuanceKind === 2 && proofKind === 1 && priceAtomic === '0'
    )) {
    fail('MAKER_V8_PLAYER_PHYSICAL_POLICY_DRIFT', 'Physical policy differs from the selected callable Style.');
  }
  const policyCommitment = hex(Array.from(parsed.row_commitment), 'Physical policy row commitment');
  await pinnedMainnet(client);
  return freeze({
    source: selection.source,
    selectionIndex: selection.selectionIndex,
    issuanceKind,
    priceAtomic,
    expectedIssuedCount: issuedCount.toString(),
    policyCommitment,
  });
}

function packStyleFor(state, selection) {
  const matches = (state.packStyles ?? []).filter((row) => (
    row.selectionIndex === selection.selectionIndex
    && row.releaseId === selection.releaseId
    && row.semanticPackId === selection.semanticPackId
    && row.partKey === selection.partKey
    && row.itemKey === selection.itemKey
    && row.styleKey === selection.styleKey
    && row.trackKey === selection.trackKey
    && row.swatchKey === selection.swatchKey
  ));
  if (matches.length !== 1) {
    fail('MAKER_V8_PLAYER_PACK_STYLE_UNAVAILABLE', 'Pack selection lacks one exact official Style policy.');
  }
  return matches[0];
}

function protectedAssetFor(state, selection, { required = true } = {}) {
  const matches = (state.protectedAssets ?? []).filter((row) => (
    row.selectionIndex === selection.selectionIndex
    && row.source === selection.source
  ));
  if (matches.length !== 1) {
    if (!required && matches.length === 0) return null;
    fail(
      'MAKER_V8_PLAYER_PROTECTED_ASSET_DRIFT',
      'Protected selection lacks one exact live Seal asset row.',
    );
  }
  return matches[0];
}

function assertCommittedLoadout(state, request) {
  const intended = request.loadout.selections;
  const observed = state.currentSelections.filter(Boolean);
  if (observed.length !== intended.length) {
    fail('MAKER_V8_PLAYER_LOADOUT_DRIFT', 'Committed MakerLoadout selection cardinality differs from the intended Recipe.');
  }
  const byIndex = new Map();
  for (const selection of observed) {
    if (byIndex.has(selection.selectionIndex)) {
      fail('MAKER_V8_PLAYER_LOADOUT_DRIFT', 'Committed MakerLoadout repeats one Part profile index.');
    }
    byIndex.set(selection.selectionIndex, selection);
  }
  for (const expected of intended) {
    const actual = byIndex.get(expected.selectionIndex);
    const sourceClass = expected.source === 'BASE' ? 0 : expected.source === 'PACK' ? 1 : 2;
    const sourceDefinitionId = expected.source === 'BASE'
      ? request.player.rootId
      : expected.source === 'PACK' ? expected.releaseId : expected.externalProductId;
    const sourceSemanticId = expected.source === 'PACK' ? expected.semanticPackId : '';
    const accessSubject = expected.source === 'BASE' && itemAssetizationEnabled(state)
      ? ownedBaseItemFor(state, expected).objectId
      : expected.source === 'BASE' ? state.objects.makerAccess.objectId
        : expected.source === 'EXTERNAL' ? ownedExternalItemFor(state, expected).objectId : null;
    const packStyle = expected.source === 'PACK' ? packStyleFor(state, expected) : null;
    const protectedAsset = protectedAssetFor(state, expected, { required: false });
    const expectedProtected = protectedAsset !== null
      || expected.source === 'PACK' && packStyle.protected === true;
    const externalProduct = expected.source === 'EXTERNAL'
      ? externalProductFor(state, expected) : null;
    if (!actual
      || actual.partKey !== expected.partKey
      || actual.itemKey !== expected.itemKey
      || actual.styleKey !== expected.styleKey
      || actual.swatchKey !== expected.swatchKey
      || actual.sourceClass !== sourceClass
      || actual.sourceDefinitionId !== sourceDefinitionId
      || actual.sourceSemanticId !== sourceSemanticId
      || accessSubject !== null && actual.accessSubject !== accessSubject
      || actual.protected !== expectedProtected
      || expectedProtected && !HASH.test(actual.sealBindingCommitment ?? '')
      || !expectedProtected && (actual.sealBindingCommitment ?? null) !== null
      || protectedAsset && actual.assetContentCommitment !== protectedAsset.assetContentCommitment
      || packStyle?.protected === true
        && actual.sealBindingCommitment !== packStyle.sealBindingCommitment
      || packStyle && actual.assetContentCommitment !== packStyle.assetContentCommitment
      || externalProduct && actual.assetContentCommitment
        !== hex(externalProduct.fields.asset_content_commitment, 'ExternalItemProduct.assetContent')) {
      fail('MAKER_V8_PLAYER_LOADOUT_DRIFT', 'Committed MakerLoadout differs from the exact intended selection identity.');
    }
  }
  return true;
}

function releaseIdentity(release, root, semanticPackId) {
  const fields = release.fields;
  if (moveId(fields.root_id, 'PackRelease.rootId') !== root.objectId
    || decimal(fields.root_version, 'PackRelease.rootVersion') !== decimal(root.fields.maker_version, 'Root.makerVersion')
    || hex(fields.root_content_commitment, 'PackRelease.rootContent') !== hex(moveFields(root.fields.content, 'Root.content').content_commitment, 'Root.contentCommitment')
    || moveText(fields.semantic_pack_id, 'PackRelease.semanticPackId') !== semanticPackId
    || decimal(fields.lifecycle, 'PackRelease.lifecycle') !== '2') {
    fail('MAKER_V8_PLAYER_PACK_RELEASE_DRIFT', 'Pack Release is not the exact ACTIVE admitted Player Pack.');
  }
  return release;
}

function externalProductIdentity(product, item, root, selection, account) {
  if (!plain(product) || !plain(item)) {
    fail('MAKER_V8_PLAYER_EXTERNAL_ITEM_DRIFT', 'External Product/owned Item is missing from the certified wardrobe state.');
  }
  const fields = product.fields;
  const itemFields = item.fields;
  const colorChannel = moveOption(fields.color_channel_key, 'ExternalItemProduct.colorChannelKey');
  const defaultSwatch = moveOption(fields.default_swatch_key, 'ExternalItemProduct.defaultSwatchKey');
  const assetBlobId = moveText(fields.asset_blob_id, 'ExternalItemProduct.assetBlobId');
  const assetMediaType = moveText(fields.asset_media_type, 'ExternalItemProduct.assetMediaType');
  const assetByteLength = Number(decimal(
    fields.asset_byte_length,
    'ExternalItemProduct.assetByteLength',
  ));
  if (product.objectId !== selection.externalProductId
    || product.owner.kind !== 'SHARED'
    || decimal(fields.version, 'ExternalItemProduct.version') !== '8'
    || moveId(fields.root_id, 'ExternalItemProduct.rootId') !== root.objectId
    || decimal(fields.root_version, 'ExternalItemProduct.rootVersion')
      !== decimal(root.fields.maker_version, 'Root.makerVersion')
    || hex(fields.root_content_commitment, 'ExternalItemProduct.rootContent')
      !== hex(moveFields(root.fields.content, 'Root.content').content_commitment, 'Root.contentCommitment')
    || Number(decimal(fields.lifecycle, 'ExternalItemProduct.lifecycle')) !== 0
    || moveText(fields.part_key, 'ExternalItemProduct.partKey') !== selection.partKey
    || moveText(fields.item_key, 'ExternalItemProduct.itemKey') !== selection.itemKey
    || moveText(fields.style_key, 'ExternalItemProduct.styleKey') !== selection.styleKey
    || moveText(fields.layer_track_key, 'ExternalItemProduct.trackKey') !== selection.trackKey
    || colorChannel !== selection.colorChannelKey
    || defaultSwatch !== selection.defaultSwatchKey
    || assetBlobId.length < 1 || assetBlobId.length > 512
    || hex(fields.asset_sha256, 'ExternalItemProduct.assetSha256').length !== 64
    || !RENDERABLE_MEDIA_TYPES.has(assetMediaType)
    || !Number.isSafeInteger(assetByteLength)
    || assetByteLength < 1 || assetByteLength > MAX_CERTIFIED_ASSET_BYTES
    || item.objectId !== selection.ownedExternalItemId
    || item.owner.kind !== 'ADDRESS' || item.owner.address !== account.address
    || decimal(itemFields.version, 'OwnedExternalItem.version') !== '8'
    || moveId(itemFields.product_id, 'OwnedExternalItem.productId') !== product.objectId
    || hex(itemFields.product_content_commitment, 'OwnedExternalItem.productContent')
      !== hex(fields.content_commitment, 'ExternalItemProduct.contentCommitment')
    || hex(itemFields.asset_content_commitment, 'OwnedExternalItem.assetContent')
      !== hex(fields.asset_content_commitment, 'ExternalItemProduct.assetContent')
    || address(String(itemFields.holder).toLowerCase(), 'OwnedExternalItem.holder')
      !== account.address) {
    fail('MAKER_V8_PLAYER_EXTERNAL_ITEM_DRIFT', 'External Product/owned Item differs from the exact admitted wardrobe selection.');
  }
  return freeze({ product, item });
}

// Acquisition obtains an entitlement; it does not execute the draft recipe.
// This only scopes reads. Each requested entitlement still needs live policy,
// exact wallet/Root binding and Move validation in the existing execution path.
export function makerV8PlayerSelectionDependenciesV8(action, loadout, input = {}) {
  if (!Object.values(MAKER_V8_PLAYER_ACTIONS).includes(action)) {
    throw new TypeError('Unknown Player action for selection dependencies.');
  }
  const executesSelections = ![
    MAKER_V8_PLAYER_ACTIONS.ACQUIRE_MAKER_ACCESS,
    MAKER_V8_PLAYER_ACTIONS.ACQUIRE_BASE_ITEM,
    MAKER_V8_PLAYER_ACTIONS.ACQUIRE_PACK_ACCESS,
  ].includes(action);
  const selections = executesSelections ? loadout.selections : [];
  const usedPacks = executesSelections ? loadout.usedPacks : [];
  const releases = new Map(usedPacks.map(row => [row.releaseId, row.semanticPackId]));
  if (action === MAKER_V8_PLAYER_ACTIONS.ACQUIRE_PACK_ACCESS) {
    releases.set(input.releaseId, input.semanticPackId);
  }
  return { executesSelections, selections, releases };
}

async function assertQuotePackAdmissions(client, runtime, registry, root, releases) {
  if (releases.length === 0) return;
  if (registry.owner.kind !== 'SHARED'
    || moveId(registry.fields.root_id, 'PackRegistry.rootId') !== root.objectId
    || decimal(registry.fields.root_version, 'PackRegistry.rootVersion') !== decimal(root.fields.maker_version, 'Root.makerVersion')
    || hex(registry.fields.root_content_commitment, 'PackRegistry.rootContent') !== hex(moveFields(root.fields.content, 'Root.content').content_commitment, 'Root.content')) {
    fail('MAKER_V8_PLAYER_PACK_ADMISSION_DRIFT', 'Pack quote registry belongs to another Root.');
  }
  const parentId = moveTableId(registry.fields.releases, 'PackRegistry.releases');
  const keyType = normalizeStructTag('0x2::object::ID');
  const valueType = stableType(runtime, 'runtime', 'runtime_v8', 'PackAdmissionRecordV8');
  for (const release of releases) {
    const nameBytes = bcs.Address.serialize(release.objectId).toBytes();
    const name = { type: keyType, bcsBase64: toBase64(nameBytes) };
    const field = await client.getDynamicField({ parentId, name });
    if (!plain(field) || field.kind !== 'DynamicField' || field.childId != null
      || field.fieldId !== deriveDynamicFieldID(parentId, keyType, nameBytes)
      || normalizeStructTag(field.type) !== normalizeStructTag(`0x2::dynamic_field::Field<${keyType},${valueType}>`)
      || normalizeStructTag(field.name?.type) !== keyType || field.name.bcsBase64 !== name.bcsBase64
      || normalizeStructTag(field.value?.type) !== normalizeStructTag(valueType)) {
      fail('MAKER_V8_PLAYER_PACK_ADMISSION_DRIFT', 'Pack quote admission has another exact key or TypeOrigin.');
    }
    let parsed;
    const raw = fromBase64(base64(field.value.bcsBase64, 'Pack quote admission', 4096));
    try {
      parsed = PACK_QUOTE_ADMISSION_BCS.parse(raw);
      if (toBase64(PACK_QUOTE_ADMISSION_BCS.serialize(parsed).toBytes()) !== field.value.bcsBase64) throw new Error('noncanonical');
    } catch { fail('MAKER_V8_PLAYER_PACK_ADMISSION_DRIFT', 'Pack quote admission is not canonical BCS.'); }
    if (release.owner.kind !== 'SHARED' || decimal(release.fields.version, 'PackRelease.version') !== '8'
      || parsed.release_id !== release.objectId || parsed.semantic_pack_id !== moveText(release.fields.semantic_pack_id, 'PackRelease.semanticPackId')
      || hex(Array.from(parsed.release_content_commitment), 'Pack admission content') !== hex(release.fields.content_commitment, 'PackRelease.content')
      || parsed.admission_state !== 0 || BigInt(parsed.admitted_revision) === 0n
      || BigInt(parsed.admitted_revision) > BigInt(decimal(registry.fields.revision, 'PackRegistry.revision'))) {
      fail('MAKER_V8_PLAYER_PACK_ADMISSION_DRIFT', 'Pack quote requires the exact ACTIVE admitted Release.');
    }
  }
}

async function defaultLoadPlayerState({
  client,
  runtime,
  action,
  player,
  recipe,
  loadout: intendedLoadout,
  input,
  account,
  loadCompleteCounters,
  loadPhysicalPolicy,
  loadPackStyles,
  loadProtectedAssets,
  loadExternalAdmissions,
  requireCurrentProtocol = true,
  readOnlyCompletionQuote = null,
}) {
  const completeQuote = readOnlyCompletionQuote === READ_ONLY_COMPLETION_QUOTE;
  await pinnedMainnet(client);
  const types = playerTypes(runtime);
  const root = await readObject(client, player.rootId, types.root, 'MakerRootV8');
  const rootInfo = rootBinding(root, runtime, player);
  const ids = rootInfo.binding;
  const commonEntries = await Promise.all([
    ['catalog', runtime.catalogId, types.productReleaseCatalog],
    ['clock', runtime.clockObjectId, types.clock],
    ['protocolConfig', runtime.protocolConfigId, types.protocolConfig],
    ['protocolTreasury', runtime.protocolTreasuryId, types.protocolTreasury],
    ['baseRegistry', ids.baseRegistryId, types.baseRegistry],
    ['makerTreasury', ids.makerTreasuryId, types.makerTreasury],
    ['sealConfig', runtime.roleConfigIds.seal, types.sealConfig],
    ['sealRegistry', ids.sealRegistryId, types.sealRegistry],
    ['runtimeConfig', runtime.roleConfigIds.runtime, types.runtimeConfig],
    ['runtimeDefinitions', ids.runtimeDefinitionsId, types.runtimeDefinitions],
    ['packRegistry', ids.packRegistryId, types.packRegistry],
    ['outputConfig', runtime.roleConfigIds.output, types.outputConfig],
    ['outputRegistry', ids.outputRegistryId, types.outputRegistry],
    ['soulRegistry', ids.soulRegistryId, types.soulRegistry],
    ['physicalConfig', runtime.roleConfigIds.physical, types.physicalConfig],
    ['physicalRegistry', ids.physicalRegistryId, types.physicalRegistry],
    ['releaseConfig', runtime.roleConfigIds.release, types.releaseConfig],
  ].map(async ([name, objectId, type]) => [name, await readObject(client, objectId, type, name)]));
  const objects = Object.fromEntries(commonEntries);
  objects.root = root;
  if (requireCurrentProtocol) {
    await assertMakerV8PlayerProtocolCurrentV8({ client, runtime, objects });
  }

  const [accessRows, ownedBaseItemRows, ownedExternalItemRows, loadoutRows] = await Promise.all([
    ownedObjects(client, account.address, types.makerAccess, 'MakerAccessPassV8', { completeQuote }),
    ownedObjects(client, account.address, types.ownedBaseItem, 'OwnedBaseItemV8', { completeQuote }),
    ownedObjects(client, account.address, types.ownedExternalItem, 'OwnedExternalItemV8', { completeQuote }),
    ownedObjects(client, account.address, types.makerLoadout, 'MakerLoadoutV8', { completeQuote }),
  ]);
  const makerAccess = unique(accessRows, (entry) => (
    moveId(entry.fields.root_id, 'MakerAccessPass.rootId') === root.objectId
    && decimal(entry.fields.maker_version, 'MakerAccessPass.makerVersion') === player.makerVersion
    && address(String(entry.fields.holder).toLowerCase(), 'MakerAccessPass.holder') === account.address
  ), 'MakerAccessPassV8', { required: !completeQuote && ![
    MAKER_V8_PLAYER_ACTIONS.ACQUIRE_MAKER_ACCESS,
    MAKER_V8_PLAYER_ACTIONS.ACQUIRE_PACK_ACCESS,
  ].includes(action) });
  if (action === MAKER_V8_PLAYER_ACTIONS.ACQUIRE_MAKER_ACCESS && makerAccess) {
    fail('MAKER_V8_PLAYER_ACCESS_ALREADY_OWNED', 'Wallet already owns this exact MakerAccessPassV8.');
  }
  const ownedBaseItems = ownedBaseItemRows.filter((entry) => (
    moveId(entry.fields.root_id, 'OwnedBaseItem.rootId') === root.objectId
    && decimal(entry.fields.root_version, 'OwnedBaseItem.rootVersion') === player.makerVersion
    && address(String(entry.fields.holder).toLowerCase(), 'OwnedBaseItem.holder') === account.address
  ));
  if (action === MAKER_V8_PLAYER_ACTIONS.ACQUIRE_BASE_ITEM) {
    const duplicate = ownedBaseItems.filter((entry) => (
      moveText(entry.fields.part_key, 'OwnedBaseItem.partKey') === input.partKey
      && moveText(entry.fields.item_key, 'OwnedBaseItem.itemKey') === input.itemKey
    ));
    if (duplicate.length) {
      fail('MAKER_V8_PLAYER_BASE_ITEM_ALREADY_OWNED', 'Wallet already owns this exact Base Item.');
    }
  }
  const makerLoadout = unique(loadoutRows, (entry) => (
    moveId(entry.fields.root_id, 'MakerLoadout.rootId') === root.objectId
    && decimal(entry.fields.root_version, 'MakerLoadout.rootVersion') === player.makerVersion
    && address(String(entry.fields.holder).toLowerCase(), 'MakerLoadout.holder') === account.address
  ), 'MakerLoadoutV8', {
    required: !completeQuote && [MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT, MAKER_V8_PLAYER_ACTIONS.MATERIALIZE_PHYSICAL]
      .includes(action),
  });
  const dependencies = makerV8PlayerSelectionDependenciesV8(action, intendedLoadout, input);
  const { executesSelections } = dependencies;
  const externalSelections = dependencies.selections.filter((selection) => selection.source === 'EXTERNAL');
  const requestedExternalProducts = [...new Set(externalSelections.map((selection) => selection.externalProductId))];
  const externalProducts = await Promise.all(requestedExternalProducts.map((productId) => (
    readObject(client, productId, types.externalItemProduct, `ExternalItemProductV8(${productId})`)
  )));
  const externalProductById = new Map(externalProducts.map((product) => [product.objectId, product]));
  for (const selection of externalSelections) {
    const itemMatches = ownedExternalItemRows.filter((item) => item.objectId === selection.ownedExternalItemId);
    if (itemMatches.length !== 1) {
      fail('MAKER_V8_PLAYER_OWNED_EXTERNAL_ITEM_REQUIRED', 'External selection requires one exact holder-owned Item object.');
    }
    externalProductIdentity(
      externalProductById.get(selection.externalProductId),
      itemMatches[0],
      root,
      selection,
      account,
    );
  }
  if (externalSelections.length && !loadExternalAdmissions) {
    fail(
      'MAKER_V8_PLAYER_EXTERNAL_ADMISSION_READER_REQUIRED',
      'External execution requires exact official gRPC dynamic-field admission reads.',
    );
  }
  const externalAdmissions = externalSelections.length
    ? assertExternalAdmissions(await loadExternalAdmissions(freeze({
      client,
      runtime,
      root,
      packRegistry: objects.packRegistry,
      products: freeze(externalProducts),
      selections: freeze(externalSelections),
      account: freeze(account),
    })), externalSelections, externalProducts)
    : freeze([]);

  const releaseRequests = new Map(dependencies.releases);
  const bindings = makerLoadout?.fields.attached_pack_definitions ?? (makerLoadout ? null : []);
  if (!Array.isArray(bindings) || bindings.length > 500) fail('MAKER_V8_PLAYER_LOADOUT_LAYOUT_INVALID', 'Invalid attachment list.');
  const attachmentCommitments = new Map();
  for (const raw of bindings) {
    const binding = moveFields(raw, 'AttachedPackDefinition');
    const releaseId = moveId(binding.release_id, 'AttachedPackDefinition.releaseId');
    if (attachmentCommitments.has(releaseId) || releaseId === root.objectId) fail('MAKER_V8_PLAYER_LOADOUT_LAYOUT_INVALID', 'Duplicate or Root attachment.');
    attachmentCommitments.set(releaseId, hex(binding.definition_commitment, 'AttachedPackDefinition.commitment'));
    if (!releaseRequests.has(releaseId)) releaseRequests.set(releaseId, null);
  }
  const releases = await Promise.all([...releaseRequests].map(async ([releaseId, semanticPackId]) => {
    const release = await readObject(client, releaseId, types.packRelease, `PackReleaseV8(${releaseId})`);
    return releaseIdentity(release, root, semanticPackId ?? moveText(release.fields.semantic_pack_id, 'PackRelease.semanticPackId'));
  }));
  const releaseById = new Map(releases.map((release) => [release.objectId, release]));
  const verifiedBundles = new Map();
  let admission = 0;
  if (bindings.length) {
    const definitions = objects.runtimeDefinitions.fields;
    admission = Number(decimal(definitions.admission_ceiling, 'RuntimeDefinitionRegistry.admissionCeiling'));
    if (objects.runtimeDefinitions.owner.kind !== 'SHARED'
      || decimal(makerLoadout.fields.version, 'MakerLoadout.version') !== '8'
      || moveId(makerLoadout.fields.definition_registry_id, 'MakerLoadout.definitionRegistryId') !== objects.runtimeDefinitions.objectId
      || moveId(makerLoadout.fields.pack_registry_id, 'MakerLoadout.packRegistryId') !== objects.packRegistry.objectId
      || hex(makerLoadout.fields.root_content_commitment, 'MakerLoadout.rootContent') !== hex(definitions.root_content_commitment, 'RuntimeDefinitionRegistry.rootContent')
      || definitions.sealed !== true || decimal(definitions.version, 'RuntimeDefinitionRegistry.version') !== '8'
      || moveId(definitions.root_id, 'RuntimeDefinitionRegistry.rootId') !== root.objectId
      || decimal(definitions.root_version, 'RuntimeDefinitionRegistry.rootVersion') !== decimal(root.fields.maker_version, 'Root.makerVersion')
      || hex(definitions.root_content_commitment, 'RuntimeDefinitionRegistry.rootContent') !== hex(moveFields(root.fields.content, 'Root.content').content_commitment, 'Root.contentCommitment')
      || moveId(definitions.base_registry_id, 'RuntimeDefinitionRegistry.baseRegistryId') !== objects.baseRegistry.objectId
      || ![0, 1, 2].includes(admission)) fail('MAKER_V8_PLAYER_LOADOUT_LAYOUT_INVALID', 'Attached definitions require the sealed Root Runtime policy.');
    for (const [releaseId, definitionCommitment] of attachmentCommitments) {
      const release = releaseById.get(releaseId);
      verifiedBundles.set(releaseId, await readMakerV8PackDefinitions(client, {
        runtimeOriginalPackageId: stableType(runtime, 'runtime', 'runtime_v8', 'PackDefinitionsV8').split('::')[0],
        releaseId, semanticPackId: moveText(release.fields.semantic_pack_id, 'PackRelease.semanticPackId'),
        contentCommitment: hex(release.fields.content_commitment, 'PackRelease.contentCommitment'), definitionCommitment,
      }));
    }
  }
  const currentSelections = loadoutSelections(makerLoadout, verifiedBundles, admission);
  if (!completeQuote) assertMakerAccessDependency({ objects: { makerAccess, releases } }, { action, input });
  if (completeQuote) await assertQuotePackAdmissions(client, runtime, objects.packRegistry, root, releases);
  const packPassRows = releases.length
    ? await ownedObjects(client, account.address, types.packPass, 'PackPassV8', { completeQuote }) : [];
  const packPasses = releases.map((release) => unique(packPassRows, (entry) => (
    moveId(entry.fields.release_id, 'PackPass.releaseId') === release.objectId
    && address(String(entry.fields.holder).toLowerCase(), 'PackPass.holder') === account.address
  ), `PackPassV8(${release.objectId})`, {
    required: !completeQuote && (action !== MAKER_V8_PLAYER_ACTIONS.ACQUIRE_PACK_ACCESS
      || release.objectId !== input.releaseId),
  }));
  if (action === MAKER_V8_PLAYER_ACTIONS.ACQUIRE_PACK_ACCESS
    && packPasses.find((entry) => entry && moveId(entry.fields.release_id, 'PackPass.releaseId') === input.releaseId)) {
    fail('MAKER_V8_PLAYER_PACK_ACCESS_ALREADY_OWNED', 'Wallet already owns this exact PackPassV8.');
  }
  const packTreasuries = await Promise.all(releases.map(async (release) => {
    const treasuryId = moveId(release.fields.treasury_id, 'PackRelease.treasuryId');
    return readObject(client, treasuryId, types.packTreasury, `PackTreasuryV8(${release.objectId})`);
  }));

  const packSelections = dependencies.selections.filter((selection) => selection.source === 'PACK');
  const requiresPackStyles = packSelections.length > 0;
  if (requiresPackStyles && !loadPackStyles) {
    fail(
      'MAKER_V8_PLAYER_PACK_STYLE_READER_REQUIRED',
      'Pack execution requires exact official Release Style policy reads.',
    );
  }
  const packStyles = requiresPackStyles
    ? assertPackStyles(await loadPackStyles(freeze({
      client,
      runtime,
      root,
      packRegistry: objects.packRegistry,
      releases: freeze(releases),
      selections: freeze(packSelections),
      account: freeze(account),
    })), packSelections)
    : freeze([]);

  const protectedSelectionRequests = executesSelections
    ? intendedLoadout.selections.filter((selection) => (
      selection.source === 'BASE'
        ? selectedBaseStyle(player, selection)?.protected === true
        : selection.source === 'PACK' && packStyleFor({ packStyles }, selection).protected === true
    ))
    : [];
  if (protectedSelectionRequests.length > 0 && !loadProtectedAssets) {
    fail(
      'MAKER_V8_PLAYER_PROTECTED_ASSET_READER_REQUIRED',
      'Protected Base/Pack execution requires exact official Seal dynamic-field reads.',
    );
  }
  const protectedAssets = protectedSelectionRequests.length > 0
    ? assertProtectedAssets(await loadProtectedAssets(freeze({
      client,
      runtime,
      sealRegistry: objects.sealRegistry,
      selections: freeze(protectedSelectionRequests),
      account: freeze(account),
    })), protectedSelectionRequests)
    : freeze([]);

  let counters = freeze({ baseOrdinal: '0', packOrdinals: freeze({}) });
  if (action === MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT) {
    if (completeQuote && !loadCompleteCounters) {
      fail('MAKER_V8_PLAYER_DYNAMIC_COUNTER_READER_REQUIRED', 'A completion overview requires exact current wallet counters.');
    }
    const raw = loadCompleteCounters
      ? await loadCompleteCounters(freeze({
        client, runtime, root, outputRegistry: objects.outputRegistry,
        releases: freeze(releases), account: freeze(account),
      }))
      : defaultCounterSnapshot(rootInfo, releases);
    counters = assertCounters(raw, releases);
  }

  let soulBundle = null;
  let physicalPolicy = null;
  if (action === MAKER_V8_PLAYER_ACTIONS.MATERIALIZE_PHYSICAL) {
    const soul = await readObject(client, input.soulId, types.canonicalSoul, 'CanonicalSoulV8');
    if (soul.owner.kind !== 'ADDRESS' || soul.owner.address !== account.address
      || address(String(soul.fields.holder).toLowerCase(), 'CanonicalSoul.holder') !== account.address
      || moveId(soul.fields.root_id, 'CanonicalSoul.rootId') !== root.objectId) {
      fail('MAKER_V8_PLAYER_SOUL_CUSTODY_INVALID', 'Selected Soul is not held by this Player for the exact Root.');
    }
    const outputId = moveId(soul.fields.output_id, 'CanonicalSoul.outputId');
    const receiptId = moveId(soul.fields.receipt_id, 'CanonicalSoul.receiptId');
    const [output, receipt] = await Promise.all([
      readObject(client, outputId, types.completeOutput, 'CompleteOutputV8'),
      readObject(client, receiptId, types.completeReceipt, 'CompleteReceiptV8'),
    ]);
    if (output.owner.kind !== 'ADDRESS' || output.owner.address !== account.address
      || receipt.owner.kind !== 'ADDRESS' || receipt.owner.address !== account.address
      || moveId(receipt.fields.output_id, 'CompleteReceipt.outputId') !== output.objectId
      || moveId(receipt.fields.loadout_id, 'CompleteReceipt.loadoutId') !== makerLoadout.objectId) {
      fail('MAKER_V8_PLAYER_SOUL_BUNDLE_INVALID', 'Soul/Output/Receipt do not bind the exact current MakerLoadout.');
    }
    soulBundle = freeze({ soul, output, receipt });
    const selection = intendedLoadout.selections[input.selectionIndex];
    if (!loadPhysicalPolicy) {
      fail('MAKER_V8_PLAYER_PHYSICAL_POLICY_READER_REQUIRED', 'Physical execution requires an exact official policy/counter read.');
    }
    physicalPolicy = assertPhysicalPolicy(await loadPhysicalPolicy(freeze({
      client, runtime, root, physicalRegistry: objects.physicalRegistry,
      selection: freeze(selection), release: selection.source === 'PACK'
        ? releaseById.get(selection.releaseId) : null,
      account: freeze(account),
    })), selection);
  }

  const output = selectedOutput(player, recipe);
  const protectedOutput = output?.protected === true;
  const protectedSelections = protectedAssets.length > 0
    || currentSelections.some((selection) => selection?.protected === true);
  const protectedRequired = protectedOutput || protectedSelections;
  const state = freeze({
    schemaVersion: MAKER_V8_PLAYER_ADAPTERS_SCHEMA,
    rootInfo,
    objects: freeze({
      ...objects,
      makerAccess,
      ownedBaseItems: freeze(ownedBaseItems),
      ownedExternalItems: freeze(ownedExternalItemRows),
      externalProducts: freeze(externalProducts),
      makerLoadout,
      releases: freeze(releases),
      packPasses: freeze(packPasses.filter(Boolean)),
      packTreasuries: freeze(packTreasuries),
      soulBundle,
    }),
    currentSelections: freeze(currentSelections),
    packStyles,
    protectedAssets,
    externalAdmissions,
    counters,
    physicalPolicy,
    protectedOutput,
    protectedSelections,
    protectedRequired,
  });
  if (!completeQuote && [MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT, MAKER_V8_PLAYER_ACTIONS.MATERIALIZE_PHYSICAL]
    .includes(action)) {
    assertCommittedLoadout(state, { player, loadout: intendedLoadout });
  }
  await pinnedMainnet(client);
  return state;
}

async function loadNativeCompletionCustody(client, runtime, input) {
  assertMakerV8NativeCompletionInputV8(input.input.nativeSoul);
  if (typeof nativeChain.attestMakerV8NativeSoulIntegration !== 'function') {
    fail('MAKER_V8_NATIVE_INTEGRATION_REQUIRED', 'Native Complete requires the live protocol/deployment attestation reader.');
  }
  const evidence = await nativeChain.attestMakerV8NativeSoulIntegration(client, runtime);
  if (!nativeChain.isMakerV8NativeSoulIntegrationAttested(evidence, runtime)) {
    fail('MAKER_V8_NATIVE_INTEGRATION_REQUIRED', 'Native deployment evidence is not authenticated.');
  }
  const snapshots = {};
  for (const key of ['marketConfig', 'kindRegistry', 'kioskRegistry', 'soulTransferPolicy']) {
    const proof = evidence.objects[key];
    const snapshot = await readObject(client, proof.objectId, proof.type, `Native ${key}`);
    if (snapshot.version !== String(proof.version) || snapshot.digest !== proof.digest) {
      fail('MAKER_V8_NATIVE_INTEGRATION_DRIFT', 'Native shared authority changed after attestation.');
    }
    snapshots[key] = snapshot;
  }
  const nativeInput = input.input.nativeSoul;
  const blobType = evidence.packageEvidence.walrusBlobType;
  if (typeof blobType !== 'string') {
    fail('MAKER_V8_NATIVE_CONTENT_AUTHORITY_REQUIRED', 'Native Complete requires the verified Walrus Blob dependency type, not a guessed Blob ID.');
  }
  snapshots.contentBlobs = await Promise.all(nativeInput.initialContent.map((row) => (
    readObject(client, row.blobObjectId, blobType, 'Native initial content Blob')
  )));
  for (const blob of snapshots.contentBlobs) {
    if (blob.owner.kind !== 'ADDRESS' || blob.owner.address !== input.account.address) {
      fail('MAKER_V8_NATIVE_CONTENT_CUSTODY_INVALID', 'Native content Blob is not held by this signer.');
    }
  }
  snapshots.kiosk = null; snapshots.personalKioskCap = null;
  if (nativeInput.currentKioskId !== null) {
    if (typeof evidence.kioskEvidence.personalKioskCapType !== 'string') {
      fail('MAKER_V8_NATIVE_INTEGRATION_REQUIRED', 'Native Kiosk cap type lacks exact package evidence.');
    }
    snapshots.kiosk = await readObject(client, nativeInput.currentKioskId, '0x2::kiosk::Kiosk', 'Native Kiosk');
    snapshots.personalKioskCap = await readObject(client, nativeInput.currentKioskCapOnChainId,
      evidence.kioskEvidence.personalKioskCapType, 'Native personal Kiosk cap');
    const capValue = moveOption(snapshots.personalKioskCap.fields.cap, 'PersonalKioskCap.cap');
    if (snapshots.kiosk.owner.kind !== 'SHARED'
      || snapshots.personalKioskCap.owner.kind !== 'ADDRESS'
      || snapshots.personalKioskCap.owner.address !== input.account.address
      || capValue === null
      || moveId(moveFields(capValue, 'KioskOwnerCap').for, 'KioskOwnerCap.for') !== snapshots.kiosk.objectId) {
      fail('MAKER_V8_NATIVE_KIOSK_CUSTODY_INVALID', 'Native Kiosk/cap ownership differs from the signer.');
    }
  }
  return { evidence, snapshot: freeze({ config: evidence.config, nativeBinding: evidence.nativeBinding, objects: snapshots }) };
}

function assertExternalCustodyState(state, input) {
  const selections = makerV8PlayerSelectionDependenciesV8(input.action, input.loadout, input.input)
    .selections.filter((selection) => selection.source === 'EXTERNAL');
  if (selections.length === 0) return;
  if (!plain(state) || !plain(state.objects) || !plain(state.objects.root)
    || !Array.isArray(state.objects.externalProducts)
    || !Array.isArray(state.objects.ownedExternalItems)
    || !Array.isArray(state.externalAdmissions)) {
    fail(
      'MAKER_V8_PLAYER_EXTERNAL_ITEM_DRIFT',
      'External Player custody state is incomplete.',
    );
  }
  if (state.objects.root.objectId !== input.player.rootId) {
    fail('MAKER_V8_PLAYER_EXTERNAL_ITEM_DRIFT', 'External Player custody belongs to another Maker Root.');
  }
  const root = freeze({
    objectId: input.player.rootId,
    fields: freeze({
      maker_version: input.player.makerVersion,
      content: { content_commitment: input.player.evidence.contentCommitment },
    }),
  });
  const products = [];
  for (const productId of [...new Set(selections.map((selection) => selection.externalProductId))]) {
    const rows = state.objects.externalProducts.filter((product) => product.objectId === productId);
    if (rows.length !== 1) {
      fail('MAKER_V8_PLAYER_EXTERNAL_PRODUCT_REQUIRED', 'External selection lacks one exact admitted Product.');
    }
    products.push(rows[0]);
  }
  for (const selection of selections) {
    const product = products.find((row) => row.objectId === selection.externalProductId);
    const items = state.objects.ownedExternalItems.filter((item) => (
      item.objectId === selection.ownedExternalItemId
    ));
    if (items.length !== 1) {
      fail('MAKER_V8_PLAYER_OWNED_EXTERNAL_ITEM_REQUIRED', 'External selection requires one exact holder-owned Item object.');
    }
    externalProductIdentity(product, items[0], root, selection, input.account);
  }
  assertExternalAdmissions(state.externalAdmissions, selections, products);
}

/** Exact live-custody projection; only its in-process certificate may reach the compiler. */
export function createMakerV8PlayerCustodyAdapterV8({
  client,
  runtime: runtimeInput,
  loadRuntimeAttestation,
  loadPlayerState = defaultLoadPlayerState,
  loadCompleteCounters = readMakerV8CompleteCountersV8,
  loadPhysicalPolicy = readMakerV8PhysicalPolicyV8,
  loadPackStyles = readMakerV8PackStylesV8,
  loadProtectedAssets = readMakerV8ProtectedAssetsV8,
  loadExternalAdmissions = readMakerV8ExternalAdmissionsV8,
  assertTransport = assertMakerV8SuiGrpcTransport,
} = {}) {
  assertTransport(client);
  const runtime = assertMakerV8Runtime(runtimeInput);
  const loadFreshRuntime = runtimeLoader(runtime, client, loadRuntimeAttestation);
  if (typeof loadPlayerState !== 'function'
    || (loadCompleteCounters !== null && typeof loadCompleteCounters !== 'function')
    || (loadPhysicalPolicy !== null && typeof loadPhysicalPolicy !== 'function')
    || (loadPackStyles !== null && typeof loadPackStyles !== 'function')
    || (loadProtectedAssets !== null && typeof loadProtectedAssets !== 'function')
    || typeof loadExternalAdmissions !== 'function') {
    fail('MAKER_V8_PLAYER_CUSTODY_CONFIG_INVALID', 'Player custody readers are invalid.');
  }
  async function load(input, { newTransaction = true } = {}) {
    await pinnedMainnet(client);
    const attestedRuntime = await loadFreshRuntime();
    const loadedState = await loadPlayerState({
      client,
      runtime: attestedRuntime,
      ...input,
      loadCompleteCounters,
      loadPhysicalPolicy,
      loadPackStyles,
      loadProtectedAssets,
      loadExternalAdmissions,
      requireCurrentProtocol: newTransaction,
      readOnlyCompletionQuote: null,
    });
    // A caller-supplied ID cannot stand in for the installed immutable authority.
    // Use the object ref proven by this load's catalog/slot/certificate attestation.
    const replacementSnapshot = attestedReplacementSnapshot(attestedRuntime);
    if (loadedState.objects.replacement && !same(loadedState.objects.replacement, replacementSnapshot)) {
      fail('MAKER_V8_PLAYER_REPLACEMENT_DRIFT', 'Player replacement differs from the certified immutable runtime authority.');
    }
    const native = newTransaction && input.action === MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT
      ? await loadNativeCompletionCustody(client, attestedRuntime, input) : null;
    const state = { ...loadedState, objects: { ...loadedState.objects, replacement: replacementSnapshot },
      nativeSoulIntegration: native?.snapshot ?? null };
    assertMakerAccessDependency(state, input);
    assertExternalCustodyState(state, input);
    const builderInput = freeze(clone(state, 'Player builder input'));
    const context = freeze({
      schemaVersion: MAKER_V8_PLAYER_CONTEXT_SCHEMA,
      chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
      network: 'mainnet',
      action: input.action,
      account: input.account.address,
      rootId: input.player.rootId,
      makerVersion: input.player.makerVersion,
      rootContentCommitment: input.player.evidence.contentCommitment,
      lifecycle: 'ACTIVE',
      actionEligible: newTransaction,
      protectedContentRequired: state.protectedRequired === true,
      recipeCommitment: makerV8PlayerRecipeCommitmentV8(input.recipe),
      builderInput,
    });
    STATE_CERTIFICATES.set(context, freeze({ state: builderInput, nativeEvidence: native?.evidence ?? null, input: freeze(clone({
      action: input.action,
      player: input.player,
      recipe: input.recipe,
      loadout: input.loadout,
      input: input.input,
      account: input.account,
    }, 'Player custody request')) }));
    await pinnedMainnet(client);
    return context;
  }
  return freeze({
    schemaVersion: MAKER_V8_PLAYER_ADAPTERS_SCHEMA,
    async quotePlayerCompletion({ player, recipe, loadout, account }) {
      const request = freeze(clone({ player, recipe, loadout, account }, 'Completion overview request'));
      address(request.account.address, 'Completion overview signer');
      if (request.account.network !== MAKER_V8_CHAIN_NETWORK
        || request.loadout.recipeCommitment !== makerV8PlayerRecipeCommitmentV8(request.recipe)
        || request.loadout.rootId !== request.player.rootId) {
        fail('MAKER_V8_PLAYER_QUOTE_SCOPE_INVALID', 'Completion overview differs from the current wallet or Recipe.');
      }
      const freshRuntime = await loadFreshRuntime();
      const read = async () => {
        const state = await loadPlayerState({ client, runtime: freshRuntime, ...request,
          action: MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT, input: {},
          loadCompleteCounters, loadPhysicalPolicy, loadPackStyles, loadProtectedAssets, loadExternalAdmissions,
          requireCurrentProtocol: true, readOnlyCompletionQuote: READ_ONLY_COMPLETION_QUOTE });
        if (state.objects.root.objectId !== request.player.rootId) {
          fail('MAKER_V8_PLAYER_QUOTE_SCOPE_INVALID', 'Completion overview read another Root.');
        }
        assertExternalCustodyState(state, { ...request, action: MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT, input: {} });
        return completionOverview(freshRuntime, state, request);
      };
      // An overview is advisory and carries no custody certificate. Read its
      // economic/ownership projection again to reject changes during collection.
      const quote = await read();
      if (!same(quote, await read())) fail('MAKER_V8_PLAYER_QUOTE_CHANGED', 'Completion price or ownership changed while reading; refresh the overview.');
      await pinnedMainnet(client);
      return quote;
    },
    async loadPlayerContext(input) { return load(input); },
    async resolveProtectedOutputIdentity(input) {
      const context = await load(input, { newTransaction: false });
      const certificate = STATE_CERTIFICATES.get(context);
      if (!certificate) {
        fail('MAKER_V8_PLAYER_CUSTODY_PROOF_REQUIRED', 'Protected Output identity lacks its exact live custody certificate.');
      }
      return protectedRenderIdentity(
        certificate.state,
        input.loadout,
        input.account.address,
        runtime,
      );
    },
    async resolveProtectedSelectionApproval(input) {
      if (!Number.isSafeInteger(input?.selectionIndex)
        || input.selectionIndex < 0 || !Array.isArray(input?.loadout?.selections)) {
        fail('MAKER_V8_PLAYER_PROTECTED_SELECTION_INVALID', 'Protected selection index is invalid.');
      }
      // Slot indices include empty slots; never reinterpret them as compact
      // positions in the selected-items array.
      const selections = input.loadout.selections.filter(row => row.selectionIndex === input.selectionIndex);
      if (selections.length !== 1) {
        fail('MAKER_V8_PLAYER_PROTECTED_SELECTION_INVALID', 'Protected read must name one exact occupied slot.');
      }
      const context = await load(input, { newTransaction: false });
      const certificate = STATE_CERTIFICATES.get(context);
      if (!certificate) {
        fail('MAKER_V8_PLAYER_CUSTODY_PROOF_REQUIRED', 'Protected selection lacks its exact live custody certificate.');
      }
      const selection = selections[0];
      const result = await protectedSelectionApproval(
        client,
        runtime,
        certificate.state,
        selection,
        input.account.address,
      );
      await pinnedMainnet(client);
      return result;
    },
    async assertPlayerContext(input) {
      const context = input.context;
      const request = {
        action: input.action,
        player: input.player,
        recipe: input.recipe,
        loadout: input.loadout,
        input: input.input,
        account: input.account,
      };
      const certificate = STATE_CERTIFICATES.get(context);
      if (!certificate || !same(certificate.input, request)) {
        fail('MAKER_V8_PLAYER_CUSTODY_PROOF_REQUIRED', 'Player context lacks this custody adapter certificate.');
      }
      const fresh = await load(request);
      if (!sameCustodyAfterClockProgress(fresh, context, runtime)) fail('MAKER_V8_PLAYER_CUSTODY_DRIFT', 'Player custody changed during certification.');
      return freeze({ certified: true });
    },
    // Attached after the readback adapter is composed by the production factory.
    async readbackPlayerAction() {
      fail('MAKER_V8_PLAYER_READBACK_NOT_COMPOSED', 'Player finalized readback adapter is not composed.');
    },
  });
}

/**
 * Browser Seal decryptor. It authorizes only a transaction-local dry-run proof,
 * never signs or broadcasts a Sui transaction, and never persists a session key.
 */
export function createMakerV8PlayerProtectedContentAdapterV8({
  client,
  custody,
  wallet,
  fetcher = globalThis.fetch,
  createSessionKey = (input) => SessionKey.create(input),
  createSealClient = ({ sealFetch, serverConfigs }) => createMakerV8BrowserSealClient({
    client, serverConfigs, sealFetch,
  }),
} = {}) {
  if (typeof custody?.resolveProtectedSelectionApproval !== 'function'
    || typeof wallet?.signExactPersonalMessage !== 'function'
    || typeof wallet?.getCurrentAccount !== 'function'
    || typeof wallet?.subscribe !== 'function'
    || typeof fetcher !== 'function'
    || typeof createSessionKey !== 'function'
    || typeof createSealClient !== 'function') {
    fail('MAKER_V8_PLAYER_PROTECTED_CLIENT_INVALID', 'Protected Player decryptor configuration is invalid.');
  }
  const sealFetch = createMakerV8DirectSealFetch(fetcher);
  return freeze({
    schemaVersion: MAKER_V8_PLAYER_PROTECTED_SELECTION_SCHEMA,
    async decrypt({ request, selectionIndex, ciphertext, signal } = {}) {
      if (!plain(request) || !Number.isSafeInteger(selectionIndex) || selectionIndex < 0
        || !plain(ciphertext)) {
        fail('MAKER_V8_PLAYER_PROTECTED_DECRYPT_INVALID', 'Protected decrypt request is invalid.');
      }
      // A fresh session per operation; cancellation also observes and clears a
      // late SDK plaintext result even though the SDK has no abort argument.
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      const timer = setTimeout(abort, 120_000);
      let unsubscribe;
      let plaintext;
      const check = () => {
        if (controller.signal.aborted) {
          fail('MAKER_V8_PLAYER_PROTECTED_CANCELLED', 'Protected read was cancelled, expired, or its wallet changed.');
        }
      };
      const step = value => new Promise((resolve, reject) => {
        const onAbort = () => {
          try { check(); } catch (error) { reject(error); }
        };
        controller.signal.addEventListener('abort', onAbort, { once: true });
        if (controller.signal.aborted) onAbort();
        Promise.resolve(value).then(result => {
          controller.signal.removeEventListener('abort', onAbort);
          if (controller.signal.aborted && result instanceof Uint8Array) result.fill(0);
          try { check(); resolve(result); } catch (error) { reject(error); }
        }, error => {
          controller.signal.removeEventListener('abort', onAbort); reject(error);
        });
      });
      try {
        check();
        const snapshot = clone(request, 'Protected read request');
        const account = await step(wallet.getCurrentAccount());
        let walletRevision;
        unsubscribe = wallet.subscribe(current => {
          if (walletRevision === undefined) walletRevision = current.revision;
          else if (current.revision !== walletRevision) abort();
        });
        const readApproval = () => step(custody.resolveProtectedSelectionApproval({
          ...snapshot, selectionIndex,
        }));
        const approval = await readApproval();
        if (account.address !== approval.signer || account.network !== MAKER_V8_CHAIN_NETWORK) {
          fail('MAKER_V8_PLAYER_PROTECTED_ACCOUNT_DRIFT', 'Protected read requires the exact current Mainnet account.');
        }
        const recheck = async () => {
          const current = await readApproval();
          const currentAccount = await step(wallet.getCurrentAccount());
          if (!same(current, approval) || !same(currentAccount, account)) {
            fail('MAKER_V8_PLAYER_PROTECTED_APPROVAL_DRIFT', 'Protected read authority changed; retry against current state.');
          }
          check();
        };
        base64(ciphertext.bytesBase64, 'Protected ciphertext bytes', MAX_CERTIFIED_ASSET_BYTES);
        const bytes = fromBase64(ciphertext.bytesBase64);
        if (ciphertext.blobId !== approval.ciphertextBlobId
          || hex([...sha256(bytes)], 'Protected ciphertext SHA-256') !== approval.ciphertextSha256
          || String(ciphertext.sha256) !== approval.ciphertextSha256
          || Number(ciphertext.byteLength) !== bytes.length) {
          fail('MAKER_V8_PLAYER_PROTECTED_CIPHERTEXT_DRIFT', 'Protected ciphertext differs from the exact live Seal row.');
        }
        assertMakerV8SealCiphertextV8(bytes, approval);
        const serverConfigs = assertMakerV8BrowserSealServers(approval.serverConfigs);
        const seal = await step(createSealClient({ sealFetch, serverConfigs }));
        if (typeof seal?.decrypt !== 'function' || typeof seal?.getKeyServers !== 'function') {
          fail('MAKER_V8_PLAYER_PROTECTED_CLIENT_INVALID', 'Seal decrypt client is unavailable.');
        }
        await step(seal.getKeyServers());
        const sessionKey = await step(createSessionKey({
          address: approval.signer,
          packageId: approval.packageId,
          ttlMin: 10,
          suiClient: client,
        }));
        if (!sessionKey || typeof sessionKey.getPersonalMessage !== 'function'
          || typeof sessionKey.setPersonalMessageSignature !== 'function') {
          fail('MAKER_V8_PLAYER_PROTECTED_SESSION_INVALID', 'Seal session key is unavailable.');
        }
        const message = sessionKey.getPersonalMessage();
        await recheck();
        const signed = await step(wallet.signExactPersonalMessage({
          message,
          signer: approval.signer,
        }));
        await step(sessionKey.setPersonalMessageSignature(signed.signature));
        await recheck();
        plaintext = await step(seal.decrypt({
          data: bytes,
          sessionKey,
          txBytes: fromBase64(approval.transactionKindBytesBase64),
          checkShareConsistency: true,
        }));
        if (!(plaintext instanceof Uint8Array) || plaintext.length < 1
          || plaintext.length > approval.maxPlaintextBytes) {
          fail('MAKER_V8_PLAYER_PROTECTED_PLAINTEXT_INVALID', 'Seal returned invalid protected asset bytes.');
        }
        await recheck();
        return freeze({
          schemaVersion: MAKER_V8_PLAYER_PROTECTED_SELECTION_SCHEMA,
          selectionIndex,
          source: approval.source,
          bytesBase64: toBase64(plaintext),
          byteLength: plaintext.length,
        });
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        unsubscribe?.();
        if (plaintext instanceof Uint8Array) plaintext.fill(0);
        controller.abort();
      }
    },
  });
}

function bytesFromHex(value, label) {
  const checked = hex(value, label);
  return Uint8Array.from(checked.match(/../g).map((part) => Number.parseInt(part, 16)));
}

function pureHash(transaction, value, label) {
  return transaction.pure.vector('u8', [...bytesFromHex(value, label)]);
}

function transactionObject(transaction, snapshot, mutable = false) {
  if (!plain(snapshot) || !plain(snapshot.owner)) {
    fail('MAKER_V8_PLAYER_COMPILER_OBJECT_INVALID', 'Player compiler object snapshot is unavailable.');
  }
  if (snapshot.owner.kind === 'SHARED') {
    return transaction.sharedObjectRef({
      objectId: snapshot.objectId,
      initialSharedVersion: snapshot.owner.initialSharedVersion,
      mutable,
    });
  }
  return transaction.objectRef({
    objectId: snapshot.objectId,
    version: snapshot.version,
    digest: snapshot.digest,
  });
}

function target(runtime, role, moduleName, functionName) {
  return makerV8CallableTarget(runtime, role, moduleName, functionName);
}

const NON_GENERIC_PLAYER_FUNCTIONS = new Set([
  'transfer_pack_pass_to_holder_v8',
  'transfer_new_owned_base_item_to_holder_v8',
  'transfer_maker_loadout_to_holder_v8',
  'clear_non_external_selection_v8',
  'unequip_owned_base_style_v8',
  'certify_physical_selection_v8',
  'seal_ordered_selection_proofs_v8',
  'transfer_new_physical_asset_to_holder_v8',
]);

function moveCall(transaction, targets, runtime, role, moduleName, functionName, args) {
  const callable = target(runtime, role, moduleName, functionName);
  targets.push(callable);
  return transaction.moveCall({
    target: callable,
    typeArguments: NON_GENERIC_PLAYER_FUNCTIONS.has(functionName)
      ? [] : [runtime.paymentCoinType],
    arguments: args,
  });
}

function releaseFor(state, releaseId) {
  const releases = state.objects.releases.filter((release) => release.objectId === releaseId);
  if (releases.length !== 1) {
    fail('MAKER_V8_PLAYER_RELEASE_CONTEXT_INVALID', 'Player action does not bind one exact Pack Release.', { releaseId });
  }
  return releases[0];
}

function packObjectFor(state, release, key) {
  const rows = state.objects[key].filter((entry) => {
    if (key === 'packPasses') return moveId(entry.fields.release_id, 'PackPass.releaseId') === release.objectId;
    return moveId(release.fields.treasury_id, 'PackRelease.treasuryId') === entry.objectId;
  });
  if (rows.length !== 1) {
    fail('MAKER_V8_PLAYER_PACK_CONTEXT_INVALID', `Player action does not bind one exact ${key}.`, { releaseId: release.objectId });
  }
  return rows[0];
}

function ownedBaseItemFor(state, selection) {
  const rows = state.objects.ownedBaseItems.filter((entry) => (
    moveText(entry.fields.part_key, 'OwnedBaseItem.partKey') === selection.partKey
    && moveText(entry.fields.item_key, 'OwnedBaseItem.itemKey') === selection.itemKey
  ));
  if (rows.length !== 1) {
    fail('MAKER_V8_PLAYER_OWNED_BASE_ITEM_REQUIRED', 'Assetized Base selection requires one exact holder-owned Item.', {
      partKey: selection.partKey,
      itemKey: selection.itemKey,
      observed: rows.length,
    });
  }
  return rows[0];
}

function ownedBaseItemById(state, objectId) {
  const rows = state.objects.ownedBaseItems.filter((entry) => entry.objectId === objectId);
  if (rows.length !== 1) {
    fail('MAKER_V8_PLAYER_OWNED_BASE_ITEM_REQUIRED', 'Locked Base selection lacks its exact owned Item object.', {
      objectId,
      observed: rows.length,
    });
  }
  return rows[0];
}

function externalProductFor(state, selection) {
  const rows = state.objects.externalProducts.filter((entry) => (
    entry.objectId === selection.externalProductId
  ));
  if (rows.length !== 1) {
    fail('MAKER_V8_PLAYER_EXTERNAL_PRODUCT_REQUIRED', 'External selection lacks one exact admitted Product.');
  }
  const admissions = state.externalAdmissions.filter((entry) => (
    entry.productId === selection.externalProductId && entry.admissionState === 0
  ));
  if (admissions.length !== 1) {
    fail('MAKER_V8_PLAYER_EXTERNAL_ADMISSION_DRIFT', 'External Product is not exactly ACTIVE in this Maker wardrobe.');
  }
  return rows[0];
}

function ownedExternalItemFor(state, selection) {
  const rows = state.objects.ownedExternalItems.filter((entry) => (
    entry.objectId === selection.ownedExternalItemId
    && moveId(entry.fields.product_id, 'OwnedExternalItem.productId')
      === selection.externalProductId
  ));
  if (rows.length !== 1) {
    fail('MAKER_V8_PLAYER_OWNED_EXTERNAL_ITEM_REQUIRED', 'External selection lacks its exact holder-owned Item.');
  }
  return rows[0];
}

function ownedExternalItemById(state, objectId) {
  const rows = state.objects.ownedExternalItems.filter((entry) => entry.objectId === objectId);
  if (rows.length !== 1) {
    fail('MAKER_V8_PLAYER_OWNED_EXTERNAL_ITEM_REQUIRED', 'Locked external selection lacks its exact owned Item.');
  }
  return rows[0];
}

function itemAssetizationEnabled(state) {
  return state.objects.runtimeDefinitions.fields.item_assetization === true;
}

function swatch(transaction, value) {
  return transaction.pure.option('string', value === null ? null : value);
}

function selectionProof(transaction, targets, runtime, state, selection) {
  const { objects } = state;
  const loadout = transactionObject(transaction, objects.makerLoadout);
  const root = transactionObject(transaction, objects.root);
  const access = transactionObject(transaction, objects.makerAccess);
  const protectedAsset = protectedAssetFor(state, selection, { required: false });
  if (selection.source === 'BASE') {
    if (protectedAsset) {
      const shared = [
        loadout,
        ...(itemAssetizationEnabled(state) ? [
          transactionObject(transaction, ownedBaseItemFor(state, selection)),
          transactionObject(transaction, objects.runtimeDefinitions),
          transactionObject(transaction, objects.packRegistry),
        ] : [transactionObject(transaction, objects.runtimeDefinitions)]),
        transactionObject(transaction, objects.baseRegistry),
        transactionObject(transaction, objects.sealRegistry),
        transactionObject(transaction, objects.sealConfig),
        root,
        access,
        transaction.pure.u64(selection.selectionIndex),
        transaction.pure.string(selection.partKey),
        transaction.pure.string(selection.itemKey),
        transaction.pure.string(selection.styleKey),
        pureHash(transaction, protectedAsset.ciphertextBlobCommitment, 'Protected asset blob commitment'),
        pureHash(transaction, protectedAsset.certificationCommitment, 'Protected asset certification commitment'),
        pureHash(transaction, protectedAsset.sealId, 'Protected asset Seal ID'),
      ];
      return moveCall(
        transaction,
        targets,
        runtime,
        'runtime',
        'runtime_seal_v8',
        itemAssetizationEnabled(state)
          ? 'prove_protected_owned_base_selection_v8'
          : 'prove_protected_base_selection_v8',
        shared,
      );
    }
    if (itemAssetizationEnabled(state)) {
      return moveCall(transaction, targets, runtime, 'runtime', 'runtime_v8', 'prove_owned_base_selection_v8', [
        loadout,
        transactionObject(transaction, ownedBaseItemFor(state, selection)),
        transactionObject(transaction, objects.runtimeDefinitions),
        transactionObject(transaction, objects.packRegistry),
        transactionObject(transaction, objects.baseRegistry),
        root,
        access,
        transaction.pure.u64(selection.selectionIndex),
      ]);
    }
    return moveCall(transaction, targets, runtime, 'runtime', 'runtime_v8', 'prove_base_selection_v8', [
      loadout,
      transactionObject(transaction, objects.runtimeDefinitions),
      transactionObject(transaction, objects.baseRegistry),
      root,
      access,
      transaction.pure.u64(selection.selectionIndex),
    ]);
  }
  if (selection.source === 'EXTERNAL') {
    return moveCall(transaction, targets, runtime, 'runtime', 'runtime_v8', 'prove_external_selection_v8', [
      loadout,
      transactionObject(transaction, objects.packRegistry),
      transactionObject(transaction, externalProductFor(state, selection)),
      transactionObject(transaction, ownedExternalItemFor(state, selection)),
      root,
      access,
      transaction.pure.u64(selection.selectionIndex),
    ]);
  }
  if (selection.source !== 'PACK') {
    fail('MAKER_V8_PLAYER_SELECTION_UNAVAILABLE', 'Player selection source is not executable.');
  }
  const packStyle = packStyleFor(state, selection);
  const release = releaseFor(state, selection.releaseId);
  const pass = packObjectFor(state, release, 'packPasses');
  if (packStyle.protected === true) {
    if (!protectedAsset) {
      fail('MAKER_V8_PLAYER_PROTECTED_ASSET_DRIFT', 'Protected Pack selection lacks its exact Seal row.');
    }
    return moveCall(transaction, targets, runtime, 'runtime', 'runtime_seal_v8', 'prove_protected_pack_selection_v8', [
      loadout,
      transactionObject(transaction, objects.packRegistry),
      transactionObject(transaction, release),
      transactionObject(transaction, pass),
      transactionObject(transaction, objects.sealRegistry),
      transactionObject(transaction, objects.sealConfig),
      root,
      access,
      transaction.pure.u64(selection.selectionIndex),
      transaction.pure.string(selection.partKey),
      transaction.pure.string(selection.itemKey),
      transaction.pure.string(selection.styleKey),
      pureHash(transaction, protectedAsset.assetContentCommitment, 'Protected Pack asset commitment'),
      transaction.pure.string(protectedAsset.ciphertextBlobId),
      pureHash(transaction, protectedAsset.ciphertextSha256, 'Protected Pack ciphertext hash'),
      pureHash(transaction, protectedAsset.ciphertextBlobCommitment, 'Protected Pack blob commitment'),
      pureHash(transaction, protectedAsset.certificationCommitment, 'Protected Pack certification commitment'),
      pureHash(transaction, protectedAsset.sealId, 'Protected Pack Seal ID'),
    ]);
  }
  return moveCall(transaction, targets, runtime, 'runtime', 'runtime_v8', 'prove_pack_selection_v8', [
    loadout,
    transactionObject(transaction, objects.packRegistry),
    transactionObject(transaction, release),
    transactionObject(transaction, pass),
    root,
    access,
    transaction.pure.u64(selection.selectionIndex),
  ]);
}

function acquireMakerAccess(transaction, targets, runtime, state) {
  const { objects } = state;
  const quote = makerEntryQuote(runtime, state);
  if (quote.kind === 0) {
    moveCall(transaction, targets, runtime, 'core', 'treasury_v8', 'claim_free_maker_access_v8', [
      transactionObject(transaction, objects.root),
      transactionObject(transaction, objects.makerTreasury, true),
      transactionObject(transaction, objects.clock),
    ]);
    return;
  }
  const price = BigInt(quote.priceAtomic);
  if (price <= 0n) fail('MAKER_V8_PLAYER_MAKER_ACCESS_POLICY_INVALID', 'Paid Maker access requires a positive exact price.');
  moveCall(transaction, targets, runtime, 'core', 'treasury_v8', 'purchase_maker_access_v8', [
    transactionObject(transaction, objects.root),
    transactionObject(transaction, objects.makerTreasury, true),
    transactionObject(transaction, objects.protocolConfig),
    transactionObject(transaction, objects.protocolTreasury, true),
    transaction.coin({ type: runtime.paymentCoinType, balance: price }),
    transactionObject(transaction, objects.clock),
  ]);
}

function acquireBaseItem(transaction, targets, runtime, state, input) {
  const { objects } = state;
  if (!itemAssetizationEnabled(state)) {
    fail('MAKER_V8_PLAYER_ITEM_ASSETIZATION_DISABLED', 'This Maker includes Base Items and does not issue owned Base objects.');
  }
  const item = moveCall(transaction, targets, runtime, 'runtime', 'runtime_v8', 'claim_owned_base_item_v8', [
    transactionObject(transaction, objects.packRegistry, true),
    transactionObject(transaction, objects.runtimeDefinitions),
    transactionObject(transaction, objects.baseRegistry),
    transactionObject(transaction, objects.root),
    transactionObject(transaction, objects.makerAccess),
    transaction.pure.string(input.partKey),
    transaction.pure.string(input.itemKey),
  ]);
  moveCall(transaction, targets, runtime, 'runtime', 'runtime_v8',
    'transfer_new_owned_base_item_to_holder_v8', [item]);
}

function acquirePackAccess(transaction, targets, runtime, state, input) {
  const { objects } = state;
  const release = releaseFor(state, input.releaseId);
  const quote = packEntryQuote(runtime, release);
  const kind = quote.kind;
  let pass;
  if (kind === 0) {
    pass = moveCall(transaction, targets, runtime, 'runtime', 'runtime_v8', 'issue_free_pack_pass_v8', [
      transactionObject(transaction, release, true),
      transactionObject(transaction, objects.packRegistry),
      transactionObject(transaction, objects.clock),
    ]);
  } else if (kind === 1) {
    const price = BigInt(quote.priceAtomic);
    pass = moveCall(transaction, targets, runtime, 'runtime', 'runtime_v8', 'purchase_pack_pass_v8', [
      transactionObject(transaction, release, true),
      transactionObject(transaction, objects.packRegistry),
      transactionObject(transaction, packObjectFor(state, release, 'packTreasuries'), true),
      transactionObject(transaction, objects.root),
      transactionObject(transaction, objects.protocolConfig),
      transactionObject(transaction, objects.protocolTreasury, true),
      transaction.coin({ type: runtime.paymentCoinType, balance: price }),
      transactionObject(transaction, objects.clock),
    ]);
  } else if (kind === 2) {
    pass = moveCall(transaction, targets, runtime, 'runtime', 'runtime_v8', 'issue_included_pack_pass_v8', [
      transactionObject(transaction, release, true),
      transactionObject(transaction, objects.packRegistry),
      transactionObject(transaction, objects.root),
      transactionObject(transaction, objects.makerAccess),
      transactionObject(transaction, objects.clock),
    ]);
  } else {
    fail('MAKER_V8_PLAYER_PACK_ACCESS_POLICY_INVALID', 'Pack access policy is not callable.');
  }
  moveCall(transaction, targets, runtime, 'runtime', 'runtime_v8', 'transfer_pack_pass_to_holder_v8', [pass]);
}

function installSelection(transaction, targets, runtime, state, loadoutArg, revision, selection) {
  const { objects } = state;
  const common = [
    loadoutArg,
    transactionObject(transaction, objects.root),
    transactionObject(transaction, objects.runtimeDefinitions),
  ];
  if (selection.source === 'BASE') {
    const protectedAsset = protectedAssetFor(state, selection, { required: false });
    if (protectedAsset) {
      const args = itemAssetizationEnabled(state) ? [
        loadoutArg,
        transactionObject(transaction, ownedBaseItemFor(state, selection), true),
        transactionObject(transaction, objects.root),
        transactionObject(transaction, objects.runtimeDefinitions),
        transactionObject(transaction, objects.packRegistry),
        transactionObject(transaction, objects.baseRegistry),
        transactionObject(transaction, objects.makerAccess),
        transactionObject(transaction, objects.sealRegistry),
        transactionObject(transaction, objects.sealConfig),
        transaction.pure.u64(revision),
        transaction.pure.option('u64', selection.selectionIndex),
        transaction.pure.string(selection.styleKey),
        swatch(transaction, selection.swatchKey),
      ] : [
        loadoutArg,
        transactionObject(transaction, objects.root),
        transactionObject(transaction, objects.runtimeDefinitions),
        transactionObject(transaction, objects.packRegistry),
        transactionObject(transaction, objects.baseRegistry),
        transactionObject(transaction, objects.makerAccess),
        transactionObject(transaction, objects.sealRegistry),
        transactionObject(transaction, objects.sealConfig),
        transaction.pure.u64(revision),
        transaction.pure.option('u64', selection.selectionIndex),
        transaction.pure.string(selection.partKey),
        transaction.pure.string(selection.itemKey),
        transaction.pure.string(selection.styleKey),
        swatch(transaction, selection.swatchKey),
      ];
      args.push(
        pureHash(transaction, protectedAsset.ciphertextBlobCommitment, 'Protected asset blob commitment'),
        pureHash(transaction, protectedAsset.certificationCommitment, 'Protected asset certification commitment'),
        pureHash(transaction, protectedAsset.sealId, 'Protected asset Seal ID'),
      );
      moveCall(
        transaction,
        targets,
        runtime,
        'runtime',
        'runtime_seal_v8',
        itemAssetizationEnabled(state)
          ? 'equip_protected_owned_base_style_v8'
          : 'select_protected_base_style_v8',
        args,
      );
      return;
    }
    if (itemAssetizationEnabled(state)) {
      moveCall(transaction, targets, runtime, 'runtime', 'runtime_v8', 'equip_owned_base_style_v8', [
        loadoutArg,
        transactionObject(transaction, ownedBaseItemFor(state, selection), true),
        transactionObject(transaction, objects.root),
        transactionObject(transaction, objects.runtimeDefinitions),
        transactionObject(transaction, objects.packRegistry),
        transactionObject(transaction, objects.baseRegistry),
        transactionObject(transaction, objects.makerAccess),
        transaction.pure.u64(revision),
        transaction.pure.option('u64', selection.selectionIndex),
        transaction.pure.string(selection.styleKey),
        swatch(transaction, selection.swatchKey),
      ]);
      return;
    }
    moveCall(transaction, targets, runtime, 'runtime', 'runtime_v8', 'select_base_style_v8', [
      ...common,
      transactionObject(transaction, objects.packRegistry),
      transactionObject(transaction, objects.baseRegistry),
      transactionObject(transaction, objects.makerAccess),
      transaction.pure.u64(revision),
      transaction.pure.option('u64', selection.selectionIndex),
      transaction.pure.string(selection.partKey),
      transaction.pure.string(selection.itemKey),
      transaction.pure.string(selection.styleKey),
      swatch(transaction, selection.swatchKey),
    ]);
    return;
  }
  if (selection.source === 'EXTERNAL') {
    moveCall(transaction, targets, runtime, 'runtime', 'runtime_v8', 'equip_external_style_v8', [
      loadoutArg,
      transactionObject(transaction, ownedExternalItemFor(state, selection), true),
      transactionObject(transaction, objects.root),
      transactionObject(transaction, objects.runtimeDefinitions),
      transactionObject(transaction, objects.packRegistry),
      transactionObject(transaction, externalProductFor(state, selection)),
      transactionObject(transaction, objects.makerAccess),
      transaction.pure.u64(revision),
      transaction.pure.option('u64', selection.selectionIndex),
    ]);
    return;
  }
  if (selection.source !== 'PACK') {
    fail('MAKER_V8_PLAYER_SELECTION_UNAVAILABLE', 'Player selection source is not executable.');
  }
  packStyleFor(state, selection);
  const release = releaseFor(state, selection.releaseId);
  moveCall(transaction, targets, runtime, 'runtime', 'runtime_v8', 'select_pack_style_v8', [
    ...common,
    transactionObject(transaction, objects.baseRegistry),
    transactionObject(transaction, objects.packRegistry),
    transactionObject(transaction, release),
    transactionObject(transaction, packObjectFor(state, release, 'packPasses')),
    transactionObject(transaction, objects.makerAccess),
    transaction.pure.u64(revision),
    transaction.pure.option('u64', selection.selectionIndex),
    transaction.pure.string(selection.partKey),
    transaction.pure.string(selection.itemKey),
    transaction.pure.string(selection.styleKey),
    swatch(transaction, selection.swatchKey),
  ]);
}

function plannedPackAttachments(state, loadout) {
  const attached = new Map();
  if (state.objects.makerLoadout !== null) {
    const bindings = state.objects.makerLoadout.fields.attached_pack_definitions;
    if (!Array.isArray(bindings)) fail('MAKER_V8_PLAYER_LOADOUT_LAYOUT_INVALID', 'Commit requires the exact attachment list.');
    for (const raw of bindings) {
      const binding = moveFields(raw, 'AttachedPackDefinition');
      const releaseId = moveId(binding.release_id, 'AttachedPackDefinition.releaseId');
      if (attached.has(releaseId)) fail('MAKER_V8_PLAYER_LOADOUT_LAYOUT_INVALID', 'Duplicate Pack attachment.');
      attached.set(releaseId, hex(binding.definition_commitment, 'AttachedPackDefinition.commitment'));
    }
  }
  const pending = [];
  for (const selection of loadout.selections.filter(row => row.source === 'PACK').sort(makerV8PackAttachmentOrder)) {
    const bundle = packStyleFor(state, selection).ownedDefinitions;
    if (!bundle) continue;
    const release = releaseFor(state, selection.releaseId);
    if (bundle.releaseId !== release.objectId || bundle.semanticPackId !== selection.semanticPackId
      || bundle.contentCommitment !== hex(release.fields.content_commitment, 'PackRelease.contentCommitment')
      || !HASH.test(bundle.definitionCommitment)) {
      fail('MAKER_V8_PLAYER_PACK_DEFINITION_REFERENCE_INVALID', 'Attachment differs from the selected Release definition bundle.');
    }
    if (attached.has(release.objectId)) {
      if (attached.get(release.objectId) !== bundle.definitionCommitment) {
        fail('MAKER_V8_PLAYER_PACK_DEFINITION_REFERENCE_INVALID', 'Existing attachment has another definition commitment.');
      }
      continue;
    }
    if (attached.size >= 500) fail('MAKER_V8_PLAYER_LOADOUT_LAYOUT_INVALID', 'Too many Pack attachments.');
    pending.push(release);
    attached.set(release.objectId, bundle.definitionCommitment);
  }
  return pending;
}

function expectedPackDefinitionLayout(state, loadout) {
  const current = state.objects.makerLoadout;
  const bindings = (current?.fields.attached_pack_definitions ?? []).map(raw => {
    const row = moveFields(raw, 'AttachedPackDefinition');
    return { releaseId: moveId(row.release_id, 'AttachedPackDefinition.releaseId'),
      definitionCommitment: hex(row.definition_commitment, 'AttachedPackDefinition.commitment') };
  });
  const profiles = [];
  if (bindings.length) {
    if (!Array.isArray(current.fields.definition_slots)) fail('MAKER_V8_PLAYER_LOADOUT_LAYOUT_INVALID', 'Current slots are missing.');
    for (const raw of current.fields.definition_slots) {
      const row = moveFields(raw, 'DefinitionSlot');
      const releaseId = moveId(row.source_definition_id, 'DefinitionSlot.sourceDefinitionId');
      if (releaseId === state.objects.root.objectId) continue;
      profiles.push({ releaseId, partKey: moveText(row.part_key, 'DefinitionSlot.partKey'),
        capacity: decimal(row.capacity, 'DefinitionSlot.capacity'),
        profileCommitment: hex(row.profile_commitment, 'DefinitionSlot.profileCommitment') });
    }
  }
  for (const release of plannedPackAttachments(state, loadout)) {
    const bundle = state.packStyles.find(row => row.releaseId === release.objectId && row.ownedDefinitions)?.ownedDefinitions;
    bindings.push({ releaseId: release.objectId, definitionCommitment: bundle.definitionCommitment });
    const admission = Number(decimal(state.objects.runtimeDefinitions.fields.admission_ceiling, 'RuntimeDefinitionRegistry.admissionCeiling'));
    profiles.push(...deriveMakerV8PackProfiles(bundle, admission).map(profile => ({ ...profile, releaseId: release.objectId })));
  }
  return freeze({ bindings: freeze(bindings), profiles: freeze(profiles) });
}

function commitLoadout(transaction, targets, runtime, state, loadout) {
  const { objects } = state;
  let loadoutArg;
  let revision;
  let created = false;
  if (objects.makerLoadout === null) {
    created = true;
    revision = 0n;
    loadoutArg = moveCall(transaction, targets, runtime, 'runtime', 'runtime_v8', 'create_maker_loadout_v8', [
      transactionObject(transaction, objects.root),
      transactionObject(transaction, objects.runtimeDefinitions),
      transactionObject(transaction, objects.packRegistry),
      transactionObject(transaction, objects.makerAccess),
    ]);
  } else {
    loadoutArg = transactionObject(transaction, objects.makerLoadout, true);
    revision = BigInt(decimal(objects.makerLoadout.fields.revision, 'MakerLoadout.revision'));
    for (const selection of state.currentSelections.filter(Boolean)) {
      if (selection.sourceClass === 2) {
        moveCall(transaction, targets, runtime, 'runtime', 'runtime_v8', 'unequip_external_style_v8', [
          loadoutArg,
          transactionObject(transaction, ownedExternalItemById(state, selection.accessSubject), true),
          transaction.pure.u64(revision),
        ]);
      } else if (selection.sourceClass === 0
        && selection.accessSubject !== moveId(
          objects.makerAccess.objectId,
          'MakerAccessPass.objectId',
        )) {
        moveCall(transaction, targets, runtime, 'runtime', 'runtime_v8', 'unequip_owned_base_style_v8', [
          loadoutArg,
          transactionObject(transaction, ownedBaseItemById(state, selection.accessSubject), true),
          transaction.pure.u64(revision),
        ]);
      } else {
        moveCall(transaction, targets, runtime, 'runtime', 'runtime_v8', 'clear_non_external_selection_v8', [
          loadoutArg,
          transaction.pure.u64(selection.selectionIndex),
          transaction.pure.u64(revision),
        ]);
      }
      revision += 1n;
    }
  }
  // Canonical new-Pack order agrees with recipe allocation after Part sorting.
  // Existing attachments remain immutable and must never be reindexed.
  for (const release of plannedPackAttachments(state, loadout)) {
    moveCall(transaction, targets, runtime, 'runtime', 'runtime_v8', 'attach_pack_definitions_v8', [
      loadoutArg,
      transactionObject(transaction, objects.root),
      transactionObject(transaction, objects.runtimeDefinitions),
      transactionObject(transaction, objects.packRegistry),
      transactionObject(transaction, release),
      transactionObject(transaction, packObjectFor(state, release, 'packPasses')),
      transactionObject(transaction, objects.makerAccess),
      transaction.pure.u64(revision),
    ]);
    revision += 1n;
  }
  for (const selection of loadout.selections) {
    installSelection(transaction, targets, runtime, state, loadoutArg, revision, selection);
    revision += 1n;
  }
  if (created) {
    moveCall(transaction, targets, runtime, 'runtime', 'runtime_v8', 'transfer_maker_loadout_to_holder_v8', [loadoutArg]);
  }
}

function protectedCompleteIdentity(state, loadout, signer) {
  if (state.protectedOutput !== true) {
    return freeze({ scopeKey: null, assetKey: null, sealRuntimeRevision: null });
  }
  const scopeKey = `complete/${loadout.outputKey}`;
  const assetKey = `receipt-${signer.slice(2)}-${decimal(
    state.counters.baseOrdinal,
    'Maker Complete ordinal',
  )}`;
  if (scopeKey.length > 128 || assetKey.length > 128) {
    fail('MAKER_V8_PLAYER_PROTECTED_IDENTITY_INVALID', 'Protected Complete scope/asset identity exceeds the v8 bound.');
  }
  return freeze({
    scopeKey,
    assetKey,
    sealRuntimeRevision: decimal(
      state.objects.sealRegistry.fields.runtime_revision,
      'SealRegistry.runtimeRevision',
    ),
  });
}

function protectedRenderIdentity(state, loadout, signer, runtime) {
  if (state.protectedOutput !== true) {
    fail('MAKER_V8_PLAYER_PROTECTED_OUTPUT_REQUIRED', 'The selected Output is not protected.');
  }
  const identity = protectedCompleteIdentity(state, loadout, signer);
  return freeze({
    schemaVersion: MAKER_V8_PROTECTED_RENDER_IDENTITY_SCHEMA,
    rootId: state.objects.root.objectId,
    makerVersion: decimal(state.objects.root.fields.maker_version, 'Root.makerVersion'),
    rootContentCommitment: hex(
      moveFields(state.objects.root.fields.content, 'Root.content').content_commitment,
      'Root.contentCommitment',
    ),
    signer,
    outputKey: loadout.outputKey,
    scopeKey: identity.scopeKey,
    assetKey: identity.assetKey,
    releasePackageId: runtime.roles.release.typeOriginPackageId,
    productBindingCommitment: hex(
      state.objects.sealConfig.fields.product_binding_commitment,
      'SealPolicy.productBindingCommitment',
    ),
    policyCommitment: hex(
      state.objects.sealConfig.fields.commitment,
      'SealPolicy.commitment',
    ),
    sealPolicyConfigId: state.objects.sealConfig.objectId,
    sealRegistryId: state.objects.sealRegistry.objectId,
    sealRuntimeRevision: identity.sealRuntimeRevision,
  });
}

async function protectedSelectionApproval(
  client,
  runtime,
  state,
  selection,
  signer,
) {
  const protectedAsset = protectedAssetFor(state, selection);
  const { objects } = state;
  const transaction = new Transaction();
  transaction.setSender(signer);
  const targets = [];
  const shared = [
    transactionObject(transaction, objects.makerLoadout),
  ];
  let approvalArgs;
  let approveFunction;
  if (selection.source === 'BASE') {
    const baseArgs = itemAssetizationEnabled(state) ? [
      ...shared,
      transactionObject(transaction, ownedBaseItemFor(state, selection)),
      transactionObject(transaction, objects.runtimeDefinitions),
      transactionObject(transaction, objects.packRegistry),
      transactionObject(transaction, objects.baseRegistry),
    ] : [
      ...shared,
      transactionObject(transaction, objects.runtimeDefinitions),
      transactionObject(transaction, objects.baseRegistry),
    ];
    approvalArgs = [
        ...baseArgs,
        transactionObject(transaction, objects.root),
        transactionObject(transaction, objects.makerAccess),
        transactionObject(transaction, objects.catalog),
        transactionObject(transaction, objects.sealRegistry),
        transactionObject(transaction, objects.sealConfig),
        transaction.pure.u64(selection.selectionIndex),
        transaction.pure.string(selection.partKey),
        transaction.pure.string(selection.itemKey),
        transaction.pure.string(selection.styleKey),
        pureHash(transaction, protectedAsset.ciphertextBlobCommitment, 'Protected asset blob commitment'),
        pureHash(transaction, protectedAsset.certificationCommitment, 'Protected asset certification commitment'),
        pureHash(transaction, protectedAsset.sealId, 'Protected asset Seal ID'),
      ];
    approveFunction = itemAssetizationEnabled(state)
      ? 'seal_approve_owned_base_v8' : 'seal_approve_base_v8';
  } else if (selection.source === 'PACK') {
    const style = packStyleFor(state, selection);
    if (style.protected !== true) {
      fail('MAKER_V8_PLAYER_PROTECTED_ASSET_DRIFT', 'Pack selection is not protected.');
    }
    const release = releaseFor(state, selection.releaseId);
    approvalArgs = [
        ...shared,
        transactionObject(transaction, objects.packRegistry),
        transactionObject(transaction, release),
        transactionObject(transaction, packObjectFor(state, release, 'packPasses')),
        transactionObject(transaction, objects.catalog),
        transactionObject(transaction, objects.root),
        transactionObject(transaction, objects.makerAccess),
        transactionObject(transaction, objects.sealRegistry),
        transactionObject(transaction, objects.sealConfig),
        transaction.pure.u64(selection.selectionIndex),
        transaction.pure.string(selection.partKey),
        transaction.pure.string(selection.itemKey),
        transaction.pure.string(selection.styleKey),
        pureHash(transaction, protectedAsset.assetContentCommitment, 'Protected Pack asset commitment'),
        transaction.pure.string(protectedAsset.ciphertextBlobId),
        pureHash(transaction, protectedAsset.ciphertextSha256, 'Protected Pack ciphertext hash'),
        pureHash(transaction, protectedAsset.ciphertextBlobCommitment, 'Protected Pack blob commitment'),
        pureHash(transaction, protectedAsset.certificationCommitment, 'Protected Pack certification commitment'),
        pureHash(transaction, protectedAsset.sealId, 'Protected Pack Seal ID'),
      ];
    approveFunction = 'seal_approve_pack_v8';
  } else {
    fail('MAKER_V8_PLAYER_PROTECTED_ASSET_DRIFT', 'Only protected Base and Pack selections can be decrypted.');
  }
  moveCall(transaction, targets, runtime, 'release', 'release_v8', approveFunction, [
    pureHash(transaction, protectedAsset.sealId, 'Protected asset Seal ID'),
    transactionObject(transaction, objects.releaseConfig),
    ...approvalArgs,
  ]);
  const raw = await transaction.build({ client, onlyTransactionKind: true });
  const roundtrip = await Transaction.fromKind(raw).build({ onlyTransactionKind: true });
  if (toBase64(roundtrip) !== toBase64(raw)) {
    fail('MAKER_V8_PLAYER_PROTECTED_APPROVAL_INVALID', 'Seal approval TransactionKind is noncanonical.');
  }
  const call = Transaction.fromKind(raw).getData().commands;
  if (call.length !== 1 || !call[0].MoveCall
    || call[0].MoveCall.arguments.some(argument => argument.$kind !== 'Input')) {
    fail('MAKER_V8_PLAYER_PROTECTED_APPROVAL_INVALID', 'Seal approval requires a single Input-only Release call.');
  }
  const policy = objects.sealConfig.fields;
  const identity = deriveMakerV8ProtectedAssetSealIdentityV8({
    schemaVersion: MAKER_V8_PROTECTED_ASSET_IDENTITY_SCHEMA,
    signer, scopeKind: protectedAsset.scopeKind, scopeKey: protectedAsset.scopeKey,
    assetKey: protectedAsset.assetKey,
    rootContentCommitment: hex(moveFields(objects.root.fields.content, 'Root.content').content_commitment),
    makerVersion: decimal(objects.root.fields.maker_version, 'Root.makerVersion'),
    releasePackageId: runtime.roles.release.typeOriginPackageId,
    productBindingCommitment: hex(policy.product_binding_commitment),
    policyCommitment: hex(policy.commitment),
    sealPolicyConfigId: objects.sealConfig.objectId,
    assetContentCommitment: protectedAsset.assetContentCommitment,
  });
  if (identity.sealId !== protectedAsset.sealId) {
    fail('MAKER_V8_PLAYER_PROTECTED_ASSET_DRIFT', 'Protected layer key differs from the live Root and Seal policy.');
  }
  return freeze({
    schemaVersion: MAKER_V8_PLAYER_PROTECTED_SELECTION_SCHEMA,
    selectionIndex: selection.selectionIndex,
    source: selection.source,
    signer,
    packageId: identity.packageId,
    aadBase64: identity.aadBase64,
    threshold: Number(policy.threshold),
    serverConfigs: policy.key_servers.map(rawRow => {
      const row = moveFields(rawRow, 'Seal key server');
      return { objectId: address(row.key_server_id, 'Seal key server ID'), weight: Number(row.weight) };
    }),
    maxPlaintextBytes: Number(policy.max_plaintext_bytes),
    encryptionProfile: { cipherSuite: policy.cipher_suite, keyDerivation: policy.key_derivation,
      ciphertextFormat: policy.ciphertext_format },
    sealId: protectedAsset.sealId,
    ciphertextBlobId: protectedAsset.ciphertextBlobId,
    ciphertextSha256: protectedAsset.ciphertextSha256,
    transactionKindBytesBase64: toBase64(raw),
    transactionKindSha256: hashBytes(raw),
    targets: freeze([...targets]),
  });
}

function completeOutput(transaction, targets, runtime, state, loadout, input, signer) {
  const { objects } = state;
  if (objects.makerLoadout === null) fail('MAKER_V8_PLAYER_LOADOUT_REQUIRED', 'Complete requires the exact committed MakerLoadout.');
  const quote = completePaymentQuote(runtime, state, loadout);
  const proofs = loadout.selections.map((selection) => selectionProof(transaction, targets, runtime, state, selection));
  const proofVector = transaction.makeMoveVec({
    type: makerV8StableType(runtime, 'runtime', 'runtime_v8', 'SelectionAccessProofV8'),
    elements: proofs,
  });
  // Every attachment needs a completion proof, including zero-Part bundles
  // and Packs with no selected Style. Selection fee accounting stays separate.
  const attached = objects.makerLoadout.fields.attached_pack_definitions;
  if (!Array.isArray(attached) || attached.length > 500) {
    fail('MAKER_V8_PLAYER_LOADOUT_LAYOUT_INVALID', 'Complete requires the exact attachment list.');
  }
  const seen = new Set();
  const attachmentProofs = attached.map((raw, bindingIndex) => {
    const binding = moveFields(raw, 'AttachedPackDefinition');
    const releaseId = moveId(binding.release_id, 'AttachedPackDefinition.releaseId');
    hex(binding.definition_commitment, 'AttachedPackDefinition.commitment');
    if (seen.has(releaseId)) fail('MAKER_V8_PLAYER_LOADOUT_LAYOUT_INVALID', 'Duplicate Pack attachment.');
    seen.add(releaseId);
    const release = releaseFor(state, releaseId);
    return moveCall(transaction, targets, runtime, 'runtime', 'runtime_v8', 'prove_attached_pack_definitions_v8', [
      transactionObject(transaction, objects.makerLoadout),
      transactionObject(transaction, objects.runtimeDefinitions),
      transactionObject(transaction, objects.baseRegistry),
      transactionObject(transaction, objects.root),
      transactionObject(transaction, objects.packRegistry),
      transactionObject(transaction, release),
      transactionObject(transaction, packObjectFor(state, release, 'packPasses')),
      transactionObject(transaction, objects.makerAccess),
      transaction.pure.u64(bindingIndex),
    ]);
  });
  const attachmentProofVector = transaction.makeMoveVec({
    type: makerV8StableType(runtime, 'runtime', 'runtime_v8', 'PackDefinitionProofV8'),
    elements: attachmentProofs,
  });
  const authorization = moveCall(transaction, targets, runtime, 'runtime', 'runtime_v8', 'seal_ordered_selection_proofs_v8', [
    transactionObject(transaction, objects.makerLoadout),
    transactionObject(transaction, objects.runtimeDefinitions),
    transactionObject(transaction, objects.baseRegistry),
    attachmentProofVector,
    proofVector,
  ]);
  const baseAmount = BigInt(quote.maker.amountAtomic);
  let basePayment;
  if (baseAmount === 0n) {
    const zeroTarget = `0x${'0'.repeat(63)}2::coin::zero`;
    targets.push(zeroTarget);
    basePayment = transaction.moveCall({ target: zeroTarget, typeArguments: [runtime.paymentCoinType], arguments: [] });
  } else basePayment = transaction.coin({ type: runtime.paymentCoinType, balance: baseAmount });
  const session = moveCall(transaction, targets, runtime, 'output', 'output_v8', 'begin_complete_v8', [
    transactionObject(transaction, objects.outputRegistry, true),
    transaction.pure.string(loadout.outputKey),
    transactionObject(transaction, objects.root),
    transactionObject(transaction, objects.protocolConfig),
    transactionObject(transaction, objects.makerTreasury, true),
    transactionObject(transaction, objects.protocolTreasury, true),
    basePayment,
    authorization,
    transactionObject(transaction, objects.makerLoadout),
  ]);
  for (const pack of quote.packs) {
    const release = releaseFor(state, pack.releaseId);
    const amount = BigInt(pack.amountAtomic);
    const common = [
      session,
      transactionObject(transaction, objects.outputConfig),
      transactionObject(transaction, objects.outputRegistry),
      transactionObject(transaction, objects.root),
      transactionObject(transaction, objects.catalog),
      ...(amount === 0n ? [transactionObject(transaction, objects.protocolConfig)] : []),
      transactionObject(transaction, objects.replacement),
      transactionObject(transaction, objects.runtimeConfig),
      transactionObject(transaction, release, true),
      transactionObject(transaction, objects.packRegistry),
      transactionObject(transaction, packObjectFor(state, release, 'packPasses')),
      transactionObject(transaction, objects.makerLoadout),
    ];
    if (amount > 0n) {
      moveCall(transaction, targets, runtime, 'output', 'output_v8', 'append_paid_pack_complete_v8', [
        ...common,
        transactionObject(transaction, packObjectFor(state, release, 'packTreasuries'), true),
        transactionObject(transaction, objects.protocolConfig),
        transactionObject(transaction, objects.protocolTreasury, true),
        transaction.coin({ type: runtime.paymentCoinType, balance: amount }),
      ]);
    } else {
      moveCall(transaction, targets, runtime, 'output', 'output_v8', 'append_free_pack_complete_v8', common);
    }
  }
  const transport = [
    transaction.pure.string(input.render.blobId),
    transaction.pure.vector('u8', [...bytesFromHex(input.render.sha256, 'render.sha256')]),
    transaction.pure.vector('u8', [...bytesFromHex(input.render.blobCommitment, 'render.blobCommitment')]),
  ];
  const protectedIdentity = protectedCompleteIdentity(state, loadout, signer);
  const authorizationResult = state.protectedOutput === true
    ? moveCall(transaction, targets, runtime, 'release', 'release_v8', 'finish_protected_complete_v8', [
      session,
      transactionObject(transaction, objects.outputRegistry),
      transactionObject(transaction, objects.root),
      transactionObject(transaction, objects.protocolConfig),
      transactionObject(transaction, objects.catalog),
      transactionObject(transaction, objects.releaseConfig),
      transactionObject(transaction, objects.sealRegistry, true),
      transactionObject(transaction, objects.sealConfig),
      transaction.pure.u64(protectedIdentity.sealRuntimeRevision),
      transactionObject(transaction, objects.makerLoadout),
      ...transport,
      transaction.pure.string(protectedIdentity.scopeKey),
      transaction.pure.string(protectedIdentity.assetKey),
    ])
    : moveCall(transaction, targets, runtime, 'release', 'release_v8', 'finish_unprotected_complete_v8', [
      session,
      transactionObject(transaction, objects.outputRegistry),
      transactionObject(transaction, objects.root),
      transactionObject(transaction, objects.protocolConfig),
      transactionObject(transaction, objects.catalog),
      transactionObject(transaction, objects.replacement),
      transactionObject(transaction, objects.releaseConfig),
      transactionObject(transaction, objects.makerLoadout),
      ...transport,
    ]);
  const native = state.nativeSoulIntegration;
  if (!native) fail('MAKER_V8_NATIVE_INTEGRATION_REQUIRED', 'Native Complete lacks certified Soulidity deployment/custody.');
  appendMakerV8NativeCompletionV8({
    transaction, targets, config: native.config, input: input.nativeSoul,
    objects: { ...objects, ...native.objects }, authorization: authorizationResult,
    paymentCoinType: runtime.paymentCoinType,
    objectArgument: (snapshot, mutable = false) => transactionObject(transaction, snapshot, mutable),
  });
}

function physicalAsset(transaction, targets, runtime, state, loadout, input) {
  const { objects, physicalPolicy: policy } = state;
  if (!policy || objects.makerLoadout === null) {
    fail('MAKER_V8_PLAYER_PHYSICAL_CONTEXT_REQUIRED', 'Physical execution requires exact policy and committed loadout context.');
  }
  const selection = loadout.selections[input.selectionIndex];
  if (selection.source === 'EXTERNAL') {
    fail(
      'MAKER_V8_PLAYER_EXTERNAL_PHYSICAL_UNSUPPORTED',
      'Fresh-v8 Physical assets are defined only for Base and Pack Styles.',
    );
  }
  const proof = selectionProof(transaction, targets, runtime, state, selection);
  const selectionWitness = moveCall(transaction, targets, runtime, 'runtime', 'runtime_v8', 'certify_physical_selection_v8', [
    proof,
    transactionObject(transaction, objects.makerLoadout),
  ]);
  const base = [
    transactionObject(transaction, objects.physicalRegistry, true),
    transactionObject(transaction, objects.root),
    ...(policy.issuanceKind !== 1 ? [transactionObject(transaction, objects.protocolConfig)] : []),
    transactionObject(transaction, objects.catalog),
    transactionObject(transaction, objects.replacement),
    transactionObject(transaction, objects.physicalConfig),
  ];
  const release = selection.source === 'PACK' ? releaseFor(state, selection.releaseId) : null;
  const pack = release ? [
    transactionObject(transaction, objects.packRegistry),
    transactionObject(transaction, release),
    transactionObject(transaction, packObjectFor(state, release, 'packTreasuries'), policy.issuanceKind === 1),
    transactionObject(transaction, packObjectFor(state, release, 'packPasses')),
  ] : [];
  let result;
  if (policy.issuanceKind === 0) {
    result = moveCall(transaction, targets, runtime, 'physical', 'physical_v8',
      selection.source === 'PACK' ? 'claim_free_pack_style_v8' : 'claim_free_base_style_v8', [
        ...base, ...pack, selectionWitness,
        transactionObject(transaction, objects.makerLoadout),
        transaction.pure.u64(policy.expectedIssuedCount),
      ]);
  } else if (policy.issuanceKind === 1) {
    const price = BigInt(decimal(policy.priceAtomic, 'Physical price', { positive: true }));
    const settlement = selection.source === 'PACK' ? [
      ...pack,
      transactionObject(transaction, objects.protocolConfig),
      transactionObject(transaction, objects.protocolTreasury, true),
      transaction.coin({ type: runtime.paymentCoinType, balance: price }),
    ] : [
      transactionObject(transaction, objects.protocolConfig),
      transactionObject(transaction, objects.protocolTreasury, true),
      transactionObject(transaction, objects.makerTreasury, true),
      transaction.coin({ type: runtime.paymentCoinType, balance: price }),
    ];
    result = moveCall(transaction, targets, runtime, 'physical', 'physical_v8',
      selection.source === 'PACK' ? 'purchase_pack_style_v8' : 'purchase_base_style_v8', [
        ...base, ...settlement, selectionWitness,
        transactionObject(transaction, objects.makerLoadout),
        transaction.pure.u64(policy.expectedIssuedCount),
      ]);
  } else if (policy.issuanceKind === 2) {
    if (!objects.soulBundle) fail('MAKER_V8_PLAYER_SOUL_BUNDLE_INVALID', 'Proof materialization requires the exact Soul bundle.');
    const physicalWitness = moveCall(transaction, targets, runtime, 'output', 'output_v8', 'new_physical_materialization_witness_v8', [
      transactionObject(transaction, objects.outputRegistry, true),
      transactionObject(transaction, objects.soulRegistry),
      transactionObject(transaction, objects.soulBundle.receipt),
      transactionObject(transaction, objects.soulBundle.soul),
      transactionObject(transaction, objects.root),
      transactionObject(transaction, objects.makerLoadout),
      selectionWitness,
      transaction.pure.string(input.materializationKey),
    ]);
    result = moveCall(transaction, targets, runtime, 'physical', 'physical_v8',
      selection.source === 'PACK' ? 'materialize_pack_style_v8' : 'materialize_base_style_v8', [
        ...base, ...pack, physicalWitness,
        transactionObject(transaction, objects.makerLoadout),
        transaction.pure.u64(policy.expectedIssuedCount),
      ]);
  } else {
    fail('MAKER_V8_PLAYER_PHYSICAL_POLICY_INVALID', 'Physical issuance policy is not callable.');
  }
  moveCall(transaction, targets, runtime, 'physical', 'physical_v8', 'transfer_new_physical_asset_to_holder_v8', [result]);
}

function ownedBaseTransition(item, expectedLock) {
  const fields = item.fields;
  return freeze({
    kind: 'BASE',
    objectId: item.objectId,
    rootId: moveId(fields.root_id, 'OwnedBaseItem.rootId'),
    rootVersion: decimal(fields.root_version, 'OwnedBaseItem.rootVersion'),
    rootContentCommitment: hex(fields.root_content_commitment, 'OwnedBaseItem.rootContentCommitment'),
    definitionRegistryId: moveId(fields.definition_registry_id, 'OwnedBaseItem.definitionRegistryId'),
    packRegistryId: moveId(fields.pack_registry_id, 'OwnedBaseItem.packRegistryId'),
    baseRegistryId: moveId(fields.base_registry_id, 'OwnedBaseItem.baseRegistryId'),
    partKey: moveText(fields.part_key, 'OwnedBaseItem.partKey'),
    itemKey: moveText(fields.item_key, 'OwnedBaseItem.itemKey'),
    itemPayloadCommitment: hex(fields.item_payload_commitment, 'OwnedBaseItem.itemPayloadCommitment'),
    holder: address(String(fields.holder).toLowerCase(), 'OwnedBaseItem.holder'),
    ownershipEpoch: decimal(fields.ownership_epoch, 'OwnedBaseItem.ownershipEpoch'),
    transferable: fields.transferable === true,
    expectedLock,
  });
}

function ownedExternalTransition(item, expectedLock) {
  const fields = item.fields;
  return freeze({
    kind: 'EXTERNAL',
    objectId: item.objectId,
    productId: moveId(fields.product_id, 'OwnedExternalItem.productId'),
    productContentCommitment: hex(
      fields.product_content_commitment,
      'OwnedExternalItem.productContentCommitment',
    ),
    assetContentCommitment: hex(
      fields.asset_content_commitment,
      'OwnedExternalItem.assetContentCommitment',
    ),
    holder: address(String(fields.holder).toLowerCase(), 'OwnedExternalItem.holder'),
    ownershipEpoch: decimal(fields.ownership_epoch, 'OwnedExternalItem.ownershipEpoch'),
    transferable: fields.transferable === true,
    expectedLock,
  });
}

function expectedOwnedItemTransitions(state, intendedLoadout) {
  const items = new Map();
  const makerAccessId = moveId(state.objects.makerAccess.objectId, 'MakerAccessPass.objectId');
  for (const selection of state.currentSelections.filter(Boolean)) {
    if (selection.sourceClass === 2) {
      const item = ownedExternalItemById(state, selection.accessSubject);
      items.set(item.objectId, ownedExternalTransition(item, null));
    } else if (selection.sourceClass === 0 && selection.accessSubject !== makerAccessId) {
      const item = ownedBaseItemById(state, selection.accessSubject);
      items.set(item.objectId, ownedBaseTransition(item, null));
    }
  }

  let revision = state.objects.makerLoadout === null
    ? 0n
    : BigInt(decimal(state.objects.makerLoadout.fields.revision, 'MakerLoadout.revision'))
      + BigInt(state.currentSelections.filter(Boolean).length);
  revision += BigInt(plannedPackAttachments(state, intendedLoadout).length);
  for (const selection of intendedLoadout.selections) {
    revision += 1n;
    const expectedLock = freeze({
      selectionIndex: String(selection.selectionIndex),
      equipRevision: revision.toString(),
    });
    if (selection.source === 'BASE' && itemAssetizationEnabled(state)) {
      const item = ownedBaseItemFor(state, selection);
      items.set(item.objectId, ownedBaseTransition(item, expectedLock));
    } else if (selection.source === 'EXTERNAL') {
      const item = ownedExternalItemFor(state, selection);
      items.set(item.objectId, ownedExternalTransition(item, expectedLock));
    }
  }
  return freeze({
    finalLoadoutRevision: revision.toString(),
    items: freeze([...items.values()].sort((left, right) => left.objectId.localeCompare(right.objectId))),
  });
}

function expectedForAction(runtime, action, state, request) {
  const types = playerTypes(runtime);
  const byAction = {
    [MAKER_V8_PLAYER_ACTIONS.ACQUIRE_MAKER_ACCESS]: [types.makerAccess],
    [MAKER_V8_PLAYER_ACTIONS.ACQUIRE_BASE_ITEM]: [types.ownedBaseItem],
    [MAKER_V8_PLAYER_ACTIONS.ACQUIRE_PACK_ACCESS]: [types.packPass],
    [MAKER_V8_PLAYER_ACTIONS.COMMIT_LOADOUT]: [types.makerLoadout],
    [MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT]: [types.completeOutput, types.completeReceipt, types.nativeSoulBinding, types.nativeSoul, types.nativeSoulState, MAKER_V8_NATIVE_KIOSK_ITEM_TYPE],
    [MAKER_V8_PLAYER_ACTIONS.MATERIALIZE_PHYSICAL]: [types.physicalAsset],
  };
  const expectedEventType = {
    [MAKER_V8_PLAYER_ACTIONS.ACQUIRE_MAKER_ACCESS]:
      stableType(runtime, 'core', 'treasury_v8', 'MakerAccessPassV8Issued'),
    [MAKER_V8_PLAYER_ACTIONS.ACQUIRE_BASE_ITEM]: null,
    [MAKER_V8_PLAYER_ACTIONS.ACQUIRE_PACK_ACCESS]: null,
    [MAKER_V8_PLAYER_ACTIONS.COMMIT_LOADOUT]: null,
    [MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT]:
      stableType(runtime, 'output', 'output_v8', 'NativeSoulBoundV8'),
    [MAKER_V8_PLAYER_ACTIONS.MATERIALIZE_PHYSICAL]:
      stableType(runtime, 'physical', 'physical_v8', 'PhysicalAssetIssuedV8'),
  }[action];
  const chainLoadoutCommitment = [
    MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT,
    MAKER_V8_PLAYER_ACTIONS.MATERIALIZE_PHYSICAL,
  ].includes(action)
    ? hex(state.objects.makerLoadout?.fields?.commitment, 'MakerLoadout.commitment')
    : null;
  const chainLoadoutId = chainLoadoutCommitment === null
    ? null : state.objects.makerLoadout.objectId;
  const ownedBaseItems = itemAssetizationEnabled(state)
    && ![
      MAKER_V8_PLAYER_ACTIONS.ACQUIRE_MAKER_ACCESS,
      MAKER_V8_PLAYER_ACTIONS.ACQUIRE_BASE_ITEM,
      MAKER_V8_PLAYER_ACTIONS.ACQUIRE_PACK_ACCESS,
    ].includes(action)
    ? request.loadout.selections.filter((selection) => selection.source === 'BASE')
      .map((selection) => ({
        partKey: selection.partKey,
        itemKey: selection.itemKey,
        objectId: ownedBaseItemFor(state, selection).objectId,
      }))
      .sort((left, right) => left.partKey.localeCompare(right.partKey)
        || left.itemKey.localeCompare(right.itemKey))
    : [];
  const ownedExternalItems = ![
    MAKER_V8_PLAYER_ACTIONS.ACQUIRE_MAKER_ACCESS,
    MAKER_V8_PLAYER_ACTIONS.ACQUIRE_BASE_ITEM,
    MAKER_V8_PLAYER_ACTIONS.ACQUIRE_PACK_ACCESS,
  ].includes(action)
    ? request.loadout.selections.filter((selection) => selection.source === 'EXTERNAL')
      .map((selection) => ({
        productId: externalProductFor(state, selection).objectId,
        ownedItemId: ownedExternalItemFor(state, selection).objectId,
        productContentCommitment: hex(
          externalProductFor(state, selection).fields.content_commitment,
          'ExternalItemProduct.contentCommitment',
        ),
        assetContentCommitment: hex(
          externalProductFor(state, selection).fields.asset_content_commitment,
          'ExternalItemProduct.assetContentCommitment',
        ),
      })).sort((left, right) => left.ownedItemId.localeCompare(right.ownedItemId))
    : [];
  const ownedItemTransitions = action === MAKER_V8_PLAYER_ACTIONS.COMMIT_LOADOUT
    ? expectedOwnedItemTransitions(state, request.loadout)
    : freeze({ finalLoadoutRevision: null, items: freeze([]) });
  const protectedComplete = action === MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT
    ? protectedCompleteIdentity(state, request.loadout, request.account.address)
    : freeze({ scopeKey: null, assetKey: null, sealRuntimeRevision: null });
  return freeze({
    ownedOutputTypes: freeze(byAction[action]),
    makerEntryQuote: action === MAKER_V8_PLAYER_ACTIONS.ACQUIRE_MAKER_ACCESS
      ? makerEntryQuote(runtime, state) : null,
    completePaymentQuote: action === MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT
      ? completePaymentQuote(runtime, state, request.loadout) : null,
    packEntryQuote: action === MAKER_V8_PLAYER_ACTIONS.ACQUIRE_PACK_ACCESS
      ? packEntryQuote(runtime, releaseFor(state, request.input.releaseId)) : null,
    nativeSoul: action === MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT ? freeze({
      protocolConfigId: runtime.protocolConfigId,
      soulRegistryId: state.objects.soulRegistry.objectId,
      nativeBinding: state.nativeSoulIntegration.nativeBinding,
      makerCreator: address(state.objects.root.fields.creator, 'Root.creator'),
      makerTreasuryId: state.objects.makerTreasury.objectId,
      rightsCommitment: hex(moveFields(state.objects.root.fields.rights, 'Root.rights').commitment, 'Root.rights.commitment'),
    }) : null,
    rootId: state.objects.root.objectId,
    signer: request.account.address,
    recipeCommitment: makerV8PlayerRecipeCommitmentV8(request.recipe),
    input: freeze(clone(request.input, 'Player expected input')),
    chainLoadoutCommitment,
    chainLoadoutId,
    packStyles: freeze(clone(state.packStyles ?? [], 'Player expected Pack Styles')),
    protectedAssets: freeze(clone(state.protectedAssets ?? [], 'Player expected protected assets')),
    ownedBaseItems: freeze(ownedBaseItems),
    ownedExternalItems: freeze(ownedExternalItems),
    ownedItemTransitions,
    packDefinitionLayout: action === MAKER_V8_PLAYER_ACTIONS.COMMIT_LOADOUT
      ? expectedPackDefinitionLayout(state, request.loadout) : null,
    physicalPolicy: state.physicalPolicy === null
      ? null : freeze(clone(state.physicalPolicy, 'Player expected Physical policy')),
    protectedOutput: action === MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT
      && state.protectedOutput === true,
    sealRegistryId: action === MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT
      && state.protectedOutput === true ? state.objects.sealRegistry.objectId : null,
    sealRuntimeRevision: protectedComplete.sealRuntimeRevision,
    sealScopeKey: protectedComplete.scopeKey,
    sealAssetKey: protectedComplete.assetKey,
    physicalRegistryId: state.objects.physicalRegistry.objectId,
    baseRegistryId: state.objects.baseRegistry.objectId,
    runtimeDefinitionsId: state.objects.runtimeDefinitions.objectId,
    packRegistryId: state.objects.packRegistry.objectId,
    expectedEventType,
  });
}

async function compilePlayerTransaction(runtime, client, request) {
  const state = request.context?.builderInput;
  if (!plain(state) || state.schemaVersion !== MAKER_V8_PLAYER_ADAPTERS_SCHEMA) {
    fail(
      'MAKER_V8_PLAYER_COMPILER_CONTEXT_INVALID',
      'Compiler requires exact certified Player state.',
    );
  }
  const transaction = new Transaction();
  transaction.setSender(request.account.address);
  const targets = [];
  if ([MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT, MAKER_V8_PLAYER_ACTIONS.MATERIALIZE_PHYSICAL]
    .includes(request.action)) {
    assertCommittedLoadout(state, request);
  }
  if (request.action === MAKER_V8_PLAYER_ACTIONS.ACQUIRE_MAKER_ACCESS) {
    acquireMakerAccess(transaction, targets, runtime, state);
  } else if (request.action === MAKER_V8_PLAYER_ACTIONS.ACQUIRE_BASE_ITEM) {
    acquireBaseItem(transaction, targets, runtime, state, request.input);
  } else if (request.action === MAKER_V8_PLAYER_ACTIONS.ACQUIRE_PACK_ACCESS) {
    acquirePackAccess(transaction, targets, runtime, state, request.input);
  } else if (request.action === MAKER_V8_PLAYER_ACTIONS.COMMIT_LOADOUT) {
    commitLoadout(transaction, targets, runtime, state, request.loadout);
  } else if (request.action === MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT) {
    completeOutput(
      transaction,
      targets,
      runtime,
      state,
      request.loadout,
      request.input,
      request.account.address,
    );
  } else if (request.action === MAKER_V8_PLAYER_ACTIONS.MATERIALIZE_PHYSICAL) {
    physicalAsset(transaction, targets, runtime, state, request.loadout, request.input);
  } else {
    fail('MAKER_V8_PLAYER_ACTION_INVALID', 'Compiler received an unknown Player action.');
  }
  const rawKind = await transaction.build({ client, onlyTransactionKind: true });
  const kindBytes = toBase64(rawKind);
  const descriptor = freeze({
    schemaVersion: MAKER_V8_PLAYER_DESCRIPTOR_SCHEMA,
    action: request.action,
    signer: request.account.address,
    contextCommitment: makerV8PlayerContextCommitmentV8(request.context),
    kindBytes,
    kindSha256: hashBytes(rawKind),
    targets: freeze([...targets]),
    expected: expectedForAction(runtime, request.action, state, request),
  });
  return freeze({ transaction, descriptor, targets: freeze([...targets]) });
}

function descriptorKind(descriptor) {
  exact(descriptor, [
    'schemaVersion', 'action', 'signer', 'contextCommitment', 'kindBytes',
    'kindSha256', 'targets', 'expected',
  ], 'Player descriptor');
  if (descriptor.schemaVersion !== MAKER_V8_PLAYER_DESCRIPTOR_SCHEMA
    || !Object.values(MAKER_V8_PLAYER_ACTIONS).includes(descriptor.action)
    || !HASH.test(descriptor.contextCommitment)
    || !HASH.test(descriptor.kindSha256)
    || !Array.isArray(descriptor.targets) || descriptor.targets.length === 0) {
    fail('MAKER_V8_PLAYER_DESCRIPTOR_INVALID', 'Player descriptor has an invalid exact schema.');
  }
  address(descriptor.signer, 'descriptor.signer');
  const raw = fromBase64(base64(descriptor.kindBytes, 'descriptor.kindBytes', MAX_TRANSACTION_BYTES));
  let rebuilt;
  try {
    const parsedKind = bcs.TransactionKind.parse(raw);
    const canonicalKind = bcs.TransactionKind.serialize(parsedKind).toBytes();
    rebuilt = Transaction.fromKind(raw);
    if (canonicalKind.length !== raw.length
      || canonicalKind.some((byte, index) => byte !== raw[index])) throw new Error('roundtrip');
  } catch {
    fail('MAKER_V8_PLAYER_DESCRIPTOR_INVALID', 'Player descriptor TransactionKind is not canonical.');
  }
  if (hashBytes(raw) !== descriptor.kindSha256) {
    fail('MAKER_V8_PLAYER_DESCRIPTOR_INVALID', 'Player descriptor TransactionKind hash drifted.');
  }
  const canonicalTarget = (value) => {
    const [packageId, moduleName, functionName, ...rest] = String(value).split('::');
    if (rest.length || !moduleName || !functionName) {
      fail('MAKER_V8_PLAYER_DESCRIPTOR_INVALID', 'Player descriptor contains a malformed Move target.');
    }
    return `${address(packageId.toLowerCase(), 'Move target package')}::${moduleName}::${functionName}`;
  };
  const expectedTargets = descriptor.targets.map(canonicalTarget);
  const expectedPackages = new Set(expectedTargets.map((value) => value.split('::')[0]));
  const targets = rebuilt.getData().commands.map((command) => command?.MoveCall)
    .filter(Boolean).map((call) => canonicalTarget(`${call.package}::${call.module}::${call.function}`))
    .filter((value) => expectedPackages.has(value.split('::')[0]));
  if (!same(targets, expectedTargets)) {
    fail('MAKER_V8_PLAYER_DESCRIPTOR_INVALID', 'Player descriptor targets differ from canonical TransactionKind.', { expectedTargets, observedTargets: targets });
  }
  return freeze({ raw, transaction: rebuilt, targets: freeze(targets) });
}

/** Exact unprotected v8 Player compiler; no protected ABI is exposed. */
export function createMakerV8PlayerCompilerAdapterV8({
  client,
  runtime: runtimeInput,
  loadRuntimeAttestation,
  assertTransport = assertMakerV8SuiGrpcTransport,
} = {}) {
  assertTransport(client);
  const runtime = assertMakerV8Runtime(runtimeInput);
  const freshRuntime = runtimeLoader(runtime, client, loadRuntimeAttestation);
  const authority = freeze({ schemaVersion: MAKER_V8_PLAYER_ADAPTERS_SCHEMA });
  COMPILER_AUTHORITIES.add(authority);
  const authorized = new Set();
  async function compile(request) {
    if (!STATE_CERTIFICATES.has(request.context) || request.context.actionEligible !== true) {
      fail('MAKER_V8_PLAYER_CUSTODY_PROOF_REQUIRED', 'Player compiler requires an exact in-process certified custody context.');
    }
    await pinnedMainnet(client);
    const attestedRuntime = await freshRuntime();
    if (!same(request.context.builderInput.objects.replacement, attestedReplacementSnapshot(attestedRuntime))) {
      fail('MAKER_V8_PLAYER_REPLACEMENT_DRIFT', 'Player transaction replacement differs from fresh runtime attestation.');
    }
    if (request.action === MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT) {
      const certificate = STATE_CERTIFICATES.get(request.context);
      if (!nativeChain.isMakerV8NativeSoulIntegrationAttested?.(certificate.nativeEvidence, attestedRuntime)) {
        fail('MAKER_V8_NATIVE_INTEGRATION_REQUIRED', 'Native Complete lacks its live in-process deployment certificate.');
      }
      const fresh = await loadNativeCompletionCustody(client, attestedRuntime, request);
      if (!same(fresh.snapshot, request.context.builderInput.nativeSoulIntegration)) {
        fail('MAKER_V8_NATIVE_INTEGRATION_DRIFT', 'Native deployment or content custody changed before compilation.');
      }
    }
    const compiled = await compilePlayerTransaction(runtime, client, request);
    descriptorKind(compiled.descriptor);
    authorized.add(hashValue(compiled.descriptor));
    await pinnedMainnet(client);
    return compiled;
  }
  const compiler = {
    schemaVersion: MAKER_V8_PLAYER_ADAPTERS_SCHEMA,
    authority,
    async preparePlayerAction(request) {
      const compiled = await compile(request);
      const plan = freeze({
        schemaVersion: MAKER_V8_PLAYER_PLAN_SCHEMA,
        action: request.action,
        chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
        network: 'mainnet',
        signer: request.account.address,
        rootId: request.player.rootId,
        makerVersion: request.player.makerVersion,
        rootContentCommitment: request.player.evidence.contentCommitment,
        recipeCommitment: makerV8PlayerRecipeCommitmentV8(request.recipe),
        contextCommitment: makerV8PlayerContextCommitmentV8(request.context),
        descriptor: compiled.descriptor,
        targets: compiled.targets,
      });
      return freeze({ authority, plan });
    },
    async assertPlayerActionFresh(request) {
      const compiled = await compile(request);
      if (!same(compiled.descriptor, request.plan?.descriptor)
        || !same(compiled.targets, request.plan?.targets)) {
        fail('MAKER_V8_PLAYER_COMPILER_CONTEXT_DRIFT', 'Fresh Player compiler output differs from the durable plan.');
      }
      return freeze({ authority, fresh: true });
    },
    requireDescriptor(descriptor) {
      descriptorKind(descriptor);
      if (!authorized.has(hashValue(descriptor))) {
        fail('MAKER_V8_PLAYER_COMPILER_AUTHORITY_REQUIRED', 'Player descriptor lacks fresh compiler authority.');
      }
      return true;
    },
  };
  return freeze(compiler);
}

function transactionDataProof(value, expected = {}) {
  const encoded = base64(value, 'TransactionData', MAX_TRANSACTION_BYTES);
  const raw = fromBase64(encoded);
  let parsed;
  let roundtrip;
  try {
    parsed = bcs.TransactionData.parse(raw);
    roundtrip = bcs.TransactionData.serialize(parsed).toBytes();
  } catch {
    fail('MAKER_V8_PLAYER_TRANSACTION_DATA_INVALID', 'Player TransactionData is not canonical Sui BCS.');
  }
  if (parsed?.$kind !== 'V1' || roundtrip.length !== raw.length
    || roundtrip.some((byte, index) => byte !== raw[index])) {
    fail('MAKER_V8_PLAYER_TRANSACTION_DATA_INVALID', 'Player TransactionData must be canonical V1 BCS.');
  }
  const snapshot = TransactionDataBuilder.fromBytes(raw).snapshot();
  const sender = address(snapshot.sender, 'TransactionData.sender');
  const gasOwner = address(snapshot.gasData?.owner, 'TransactionData.gasOwner');
  const budget = BigInt(decimal(snapshot.gasData?.budget, 'TransactionData.gasBudget', { positive: true }));
  const price = BigInt(decimal(snapshot.gasData?.price, 'TransactionData.gasPrice', { positive: true }));
  const payment = snapshot.gasData?.payment;
  const epoch = snapshot.expiration?.Epoch;
  if (sender !== gasOwner || budget > MAX_GAS_BUDGET || price === 0n
    || !Array.isArray(payment)
    || !Number.isSafeInteger(epoch) || epoch <= 0) {
    fail('MAKER_V8_PLAYER_TRANSACTION_ENVELOPE_INVALID', 'Player TransactionData has an unsafe signer, gas, or expiration envelope.');
  }
  for (const [index, ref] of payment.entries()) {
    address(ref.objectId, `TransactionData.gasPayment[${index}].objectId`);
    decimal(ref.version, `TransactionData.gasPayment[${index}].version`, { positive: true });
    suiDigest(ref.digest, `TransactionData.gasPayment[${index}].digest`);
  }
  const digest = TransactionDataBuilder.getDigestFromBytes(raw);
  const kindBytes = toBase64(bcs.TransactionKind.serialize(parsed.V1.kind).toBytes());
  if (expected.sender !== undefined && expected.sender !== sender
    || expected.digest !== undefined && expected.digest !== digest
    || expected.kindBytes !== undefined && expected.kindBytes !== kindBytes) {
    fail('MAKER_V8_PLAYER_TRANSACTION_DATA_DRIFT', 'Player TransactionData differs from its exact sender, digest, or compiler kind.');
  }
  return freeze({
    raw,
    base64: encoded,
    digest,
    sender,
    kindBytes,
    expirationEpoch: String(epoch),
    gas: freeze({
      budget: budget.toString(),
      price: price.toString(),
      owner: gasOwner,
      payment: freeze(payment.map((ref) => freeze({
        objectId: ref.objectId,
        version: String(ref.version),
        digest: ref.digest,
      }))),
    }),
  });
}

function playerExecution(value = {}) {
  if (!plain(value)) fail('MAKER_V8_PLAYER_EXECUTION_INVALID', 'Player execution must be a plain record.');
  const allowed = new Set([
    'network', 'chainIdentifier', 'allowWalletSignature', 'allowBroadcast',
    'allowProtectedContent',
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))
    || value.network !== undefined && value.network !== MAKER_V8_CHAIN_NETWORK
    || value.chainIdentifier !== undefined
      && value.chainIdentifier !== MAKER_V8_MAINNET_CHAIN_IDENTIFIER) {
    fail('MAKER_V8_PLAYER_EXECUTION_INVALID', 'Player execution contains unknown fields or a non-Mainnet route.');
  }
  const allowWalletSignature = value.allowWalletSignature === true;
  const allowBroadcast = value.allowBroadcast === true;
  const allowProtectedContent = value.allowProtectedContent === true;
  if (allowWalletSignature !== allowBroadcast) {
    fail('MAKER_V8_PLAYER_EXECUTION_INVALID', 'Player signing/broadcast must change together.');
  }
  return freeze({
    network: MAKER_V8_CHAIN_NETWORK,
    chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
    allowWalletSignature,
    allowBroadcast,
    allowProtectedContent,
  });
}

/** Durable canonical V1 build/simulation/execution boundary. */
export function createMakerV8PlayerBoundaryAdapterV8({
  client,
  runtime: runtimeInput,
  compiler,
  persistence,
  wallet,
  execution,
  loadRuntimeAttestation,
  assertTransport = assertMakerV8SuiGrpcTransport,
} = {}) {
  assertTransport(client);
  const runtime = assertMakerV8Runtime(runtimeInput);
  const gates = playerExecution(execution);
  const freshRuntime = runtimeLoader(runtime, client, loadRuntimeAttestation);
  if (!COMPILER_AUTHORITIES.has(compiler?.authority)) {
    fail('MAKER_V8_PLAYER_COMPILER_AUTHORITY_REQUIRED', 'Boundary requires the official Player compiler authority.');
  }
  if (!PERSISTENCE_AUTHORITIES.has(persistence)) {
    fail('MAKER_V8_PLAYER_PERSISTENCE_AUTHORITY_REQUIRED', 'Boundary requires the official durable Player persistence adapter.');
  }
  requireMethod(compiler, 'requireDescriptor', 'Player compiler');
  for (const method of ['loadByDigest', 'loadBuild', 'loadBuildByDigest', 'createBuild']) requireMethod(persistence, method, 'Player persistence');
  for (const method of ['getCurrentAccount', 'verifyExactSignature']) requireMethod(wallet, method, 'Player wallet');
  return freeze({
    schemaVersion: MAKER_V8_PLAYER_ADAPTERS_SCHEMA,
    execution: gates,
    async buildExactTransaction(input) {
      exact(input, ['descriptor'], 'Player build request');
      compiler.requireDescriptor(input.descriptor);
      const kind = descriptorKind(input.descriptor);
      const descriptorSha256 = hashValue(input.descriptor);
      const existing = await persistence.loadBuild(descriptorSha256);
      if (existing !== null) {
        const proof = transactionDataProof(existing.transactionBytes, {
          sender: input.descriptor.signer,
          digest: existing.digest,
          kindBytes: input.descriptor.kindBytes,
        });
        if (!same(existing.descriptor, input.descriptor)
          || existing.descriptorSha256 !== descriptorSha256
          || existing.signer !== proof.sender || existing.kindSha256 !== input.descriptor.kindSha256) {
          fail('MAKER_V8_PLAYER_BUILD_DRIFT', 'Durable Player build differs from the compiler descriptor.');
        }
        return freeze(clone(existing.result, 'durable Player build result'));
      }
      await freshRuntime();
      await pinnedMainnet(client);
      requireMethod(client?.core, 'getCurrentSystemState', 'Sui gRPC core');
      const system = await client.core.getCurrentSystemState();
      const startEpoch = BigInt(decimal(system?.systemState?.epoch, 'current epoch'));
      const transaction = Transaction.fromKind(kind.raw);
      transaction.setSender(input.descriptor.signer);
      transaction.setExpiration({ Epoch: (startEpoch + 1n).toString() });
      const raw = await transaction.build({ client });
      await pinnedMainnet(client);
      await freshRuntime();
      if (toBase64(await transaction.build({ onlyTransactionKind: true })) !== input.descriptor.kindBytes) {
        fail('MAKER_V8_PLAYER_TRANSACTION_KIND_DRIFT', 'Gas resolution changed the exact Player TransactionKind.');
      }
      const proof = transactionDataProof(toBase64(raw), {
        sender: input.descriptor.signer,
        kindBytes: input.descriptor.kindBytes,
      });
      const result = freeze({
        transactionBytes: proof.base64,
        transactionDigest: proof.digest,
        epochWindow: freeze({ start: startEpoch.toString(), end: proof.expirationEpoch }),
        gas: proof.gas,
        descriptorSha256,
        kindSha256: input.descriptor.kindSha256,
      });
      const stored = await persistence.createBuild({
        schemaVersion: MAKER_V8_PLAYER_ADAPTERS_SCHEMA,
        descriptorSha256,
        descriptor: clone(input.descriptor, 'Player descriptor'),
        signer: proof.sender,
        digest: proof.digest,
        transactionBytes: proof.base64,
        kindSha256: input.descriptor.kindSha256,
        result: clone(result, 'Player build result'),
      });
      if (!same(stored.result, result)) fail('MAKER_V8_PLAYER_BUILD_DRIFT', 'Durable Player build write drifted.');
      return result;
    },
    async dryRunExactTransaction(input) {
      exact(input, ['transactionBytes', 'descriptor'], 'Player dry-run request');
      compiler.requireDescriptor(input.descriptor);
      const descriptorSha256 = hashValue(input.descriptor);
      const stored = await persistence.loadBuild(descriptorSha256);
      if (!stored || stored.transactionBytes !== input.transactionBytes
        || !same(stored.descriptor, input.descriptor)) {
        fail('MAKER_V8_PLAYER_BUILD_PROOF_REQUIRED', 'Player dry-run accepts only one exact durable compiler build.');
      }
      const proof = transactionDataProof(input.transactionBytes, {
        sender: input.descriptor.signer,
        digest: stored.digest,
        kindBytes: input.descriptor.kindBytes,
      });
      const proofs = DRY_RUN_PROOFS.get(client) ?? new Map();
      DRY_RUN_PROOFS.set(client, proofs);
      proofs.delete(proof.digest);
      await freshRuntime();
      await pinnedMainnet(client);
      requireMethod(client?.core, 'simulateTransaction', 'Sui gRPC core');
      const result = await client.core.simulateTransaction({
        transaction: proof.raw,
        include: { effects: true, bcs: true },
      });
      await pinnedMainnet(client);
      await freshRuntime();
      const simulated = result?.$kind === 'Transaction' ? result.Transaction
        : result?.$kind === 'FailedTransaction' ? result.FailedTransaction : null;
      if (!simulated || simulated.digest !== proof.digest
        || !(simulated.bcs instanceof Uint8Array) || toBase64(simulated.bcs) !== proof.base64
        || typeof simulated.effects?.transactionDigest !== 'string') {
        fail('MAKER_V8_PLAYER_SIMULATION_DRIFT', 'Simulation did not echo exact TransactionData and typed effects.');
      }
      suiDigest(simulated.effects.transactionDigest, 'simulation effects digest');
      const success = result.$kind === 'Transaction'
        && simulated.status?.success === true && simulated.effects?.status?.success === true;
      if (success) {
        proofs.set(proof.digest, freeze({
          bytes: proof.base64,
          signer: proof.sender,
          descriptorSha256,
        }));
      }
      return freeze({ status: success ? 'SUCCESS' : 'FAILURE' });
    },
    async broadcastExactTransaction(input) {
      exact(input, ['bytes', 'signature', 'digest', 'signer'], 'Player broadcast request');
      if (!gates.allowBroadcast || !gates.allowWalletSignature) {
        fail('MAKER_V8_PLAYER_BROADCAST_DISABLED', 'Player broadcast is disabled.');
      }
      const signer = address(input.signer, 'broadcast signer');
      const stored = await persistence.loadBuildByDigest(input.digest);
      if (!stored || stored.transactionBytes !== input.bytes || stored.signer !== signer) {
        fail('MAKER_V8_PLAYER_BUILD_PROOF_REQUIRED', 'Broadcast lacks the exact durable Player build proof.');
      }
      const proof = transactionDataProof(input.bytes, {
        sender: signer,
        digest: input.digest,
        kindBytes: stored.descriptor.kindBytes,
      });
      const action = await persistence.loadByDigest(proof.digest);
      if (!action || !['SIGNED', 'BROADCAST_ACCEPTED', 'OUTCOME_UNKNOWN', 'FINALIZED_UNCERTIFIED'].includes(action.status)
        || action.transaction?.bytes !== proof.base64
        || action.plan?.signer !== signer
        || !same(action.plan?.descriptor, stored.descriptor)
        || action.signature?.bytes !== proof.base64
        || action.signature?.digest !== proof.digest
        || action.signature?.signer !== signer
        || action.signature?.signature !== input.signature) {
        fail('MAKER_V8_PLAYER_SIGNED_WAL_REQUIRED', 'Broadcast requires the exact durable signed Player WAL artifact.');
      }
      const account = await wallet.getCurrentAccount();
      if (account.address !== signer || account.network !== MAKER_V8_CHAIN_NETWORK) {
        fail('MAKER_V8_PLAYER_WALLET_DRIFT', 'Current wallet differs from the durable Player signer.');
      }
      const verified = await wallet.verifyExactSignature(input);
      if (!verified || verified.verified === false
        || !await isValidTransactionSignature(proof.raw, input.signature, { client, address: signer })) {
        fail('MAKER_V8_PLAYER_SIGNATURE_INVALID', 'Player signature does not authenticate exact durable TransactionData.');
      }
      await freshRuntime();
      await pinnedMainnet(client);
      requireMethod(client?.core, 'executeTransaction', 'Sui gRPC core');
      const result = await client.core.executeTransaction({
        transaction: proof.raw,
        signatures: [input.signature],
        include: { effects: true, events: true, objectTypes: true },
      });
      await pinnedMainnet(client);
      const executed = result?.$kind === 'Transaction' ? result.Transaction
        : result?.$kind === 'FailedTransaction' ? result.FailedTransaction : null;
      if (!executed || executed.digest !== proof.digest
        || executed.effects?.transactionDigest !== proof.digest) {
        fail('MAKER_V8_PLAYER_BROADCAST_DRIFT', 'Sui gRPC execution returned another transaction digest.');
      }
      return freeze({ digest: proof.digest, accepted: true });
    },
  });
}

/** Strict projection of the production Wallet Standard connector. */
export function createMakerV8PlayerWalletAdapterV8({
  client,
  runtime: runtimeInput,
  wallet,
  persistence,
  loadRuntimeAttestation,
  assertTransport = assertMakerV8SuiGrpcTransport,
} = {}) {
  assertTransport(client);
  const runtime = assertMakerV8Runtime(runtimeInput);
  const freshRuntime = runtimeLoader(runtime, client, loadRuntimeAttestation);
  if (!PERSISTENCE_AUTHORITIES.has(persistence)) {
    fail('MAKER_V8_PLAYER_PERSISTENCE_AUTHORITY_REQUIRED', 'Wallet requires official durable Player persistence.');
  }
  for (const method of ['getCurrentAccount', 'signExactTransaction', 'verifyExactSignature']) requireMethod(wallet, method, 'browser wallet');
  requireMethod(persistence, 'loadByDigest', 'Player persistence');
  return freeze({
    schemaVersion: MAKER_V8_PLAYER_ADAPTERS_SCHEMA,
    subscribe(listener) {
      requireMethod(wallet, 'subscribe', 'browser wallet');
      return wallet.subscribe(listener);
    },
    async getCurrentAccount() {
      const account = await wallet.getCurrentAccount();
      return freeze({
        address: address(account?.address, 'wallet account'),
        network: account?.network === MAKER_V8_CHAIN_NETWORK ? account.network
          : fail('MAKER_V8_PLAYER_WALLET_DRIFT', 'Wallet account is not on Sui Mainnet.'),
      });
    },
    async signExactTransaction(input) {
      exact(input, ['bytes', 'digest', 'signer'], 'Player wallet sign request');
      const proof = transactionDataProof(input.bytes, { sender: input.signer, digest: input.digest });
      const record = await persistence.loadByDigest(proof.digest);
      const dryRun = DRY_RUN_PROOFS.get(client)?.get(proof.digest);
      if (!record || record.status !== 'SIGNING' || record.signature !== null
        || !plain(record.signatureIntent)
        || record.transaction?.bytes !== proof.base64
        || record.plan?.signer !== proof.sender
        || !dryRun || dryRun.bytes !== proof.base64 || dryRun.signer !== proof.sender
        || dryRun.descriptorSha256 !== hashValue(record.plan.descriptor)) {
        fail('MAKER_V8_PLAYER_SIGNATURE_INTENT_REQUIRED', 'Wallet signing requires the exact durable intent and one fresh successful dry-run proof.');
      }
      // Consume before opening the wallet prompt; every retry needs a new live
      // context check and successful simulation.
      DRY_RUN_PROOFS.get(client).delete(proof.digest);
      await freshRuntime();
      await pinnedMainnet(client);
      const signed = await wallet.signExactTransaction(input);
      if (!plain(signed)) fail('MAKER_V8_PLAYER_WALLET_ARTIFACT_INVALID', 'Wallet returned no Player signature artifact.');
      const artifact = freeze({
        bytes: signed.bytes,
        digest: signed.digest,
        signature: signed.signature,
        signer: signed.signer,
      });
      exact(artifact, ['bytes', 'digest', 'signature', 'signer'], 'Player wallet artifact');
      if (artifact.bytes !== proof.base64 || artifact.digest !== proof.digest
        || artifact.signer !== proof.sender
        || !await isValidTransactionSignature(proof.raw, artifact.signature, { client, address: proof.sender })) {
        fail('MAKER_V8_PLAYER_WALLET_ARTIFACT_INVALID', 'Wallet signature changed or did not authenticate the exact Player bytes.');
      }
      await pinnedMainnet(client);
      await freshRuntime();
      return artifact;
    },
    async verifyExactSignature(input) {
      exact(input, ['bytes', 'signature', 'digest', 'signer'], 'Player signature verification request');
      const proof = transactionDataProof(input.bytes, { sender: input.signer, digest: input.digest });
      const browserProof = await wallet.verifyExactSignature(input);
      const browserVerified = browserProof === true || Boolean(plain(browserProof)
        && browserProof.verified === true && browserProof.bytes === input.bytes
        && browserProof.digest === input.digest && browserProof.signer === input.signer);
      const verified = browserVerified
        && await isValidTransactionSignature(proof.raw, input.signature, { client, address: proof.sender });
      return freeze({
        verified,
        bytes: proof.base64,
        digest: proof.digest,
        signer: proof.sender,
      });
    },
  });
}

/** Same-client typed gRPC finality adapter; NOT_FOUND remains double-query evidence. */
export function createMakerV8PlayerRpcAdapterV8({
  client,
  rpc,
  assertTransport = assertMakerV8SuiGrpcTransport,
} = {}) {
  assertTransport(client);
  for (const method of ['getSuiClient', 'getChainIdentifier', 'queryTransaction']) requireMethod(rpc, method, 'browser rpc');
  const getChainIdentifier = async () => {
    await pinnedMainnet(client);
    const [sameClient, chain] = await Promise.all([rpc.getSuiClient(), rpc.getChainIdentifier()]);
    if (sameClient !== client || chain !== MAKER_V8_MAINNET_CHAIN_IDENTIFIER) {
      fail('MAKER_V8_PLAYER_RPC_PROVENANCE_INVALID', 'Player RPC is not the official same-client Mainnet gRPC adapter.');
    }
    return chain;
  };
  return freeze({
    schemaVersion: MAKER_V8_PLAYER_ADAPTERS_SCHEMA,
    getChainIdentifier,
    async queryTransaction(input) {
      exact(input, ['digest'], 'Player transaction query');
      suiDigest(input.digest, 'transaction digest');
      await getChainIdentifier();
      const result = await rpc.queryTransaction(input);
      await pinnedMainnet(client);
      return freeze(clone(result, 'Player transaction query result'));
    },
  });
}

function finalizedChange(response, expectedType, label) {
  const normalized = normalizeStructTag(expectedType);
  const matches = (response.objectChanges ?? []).filter((change) => {
    try {
      return ['created', 'mutated'].includes(change?.type)
        && normalizeStructTag(change.objectType) === normalized;
    } catch { return false; }
  });
  if (matches.length !== 1) {
    fail('MAKER_V8_PLAYER_OBJECT_CHANGE_INVALID', `${label} requires one exact finalized output.`, { observed: matches.length });
  }
  const change = matches[0];
  const refs = (response.compilerEffectsOutputRefs ?? []).filter((ref) => ref.objectId === change.objectId);
  if (refs.length !== 1 || String(refs[0].version) !== String(change.version)
    || refs[0].digest !== change.digest) {
    fail('MAKER_V8_PLAYER_EFFECTS_REF_DRIFT', `${label} Core object change differs from raw TransactionEffects.`);
  }
  return freeze({ change, ref: refs[0] });
}

function finalizedObjectChange(response, objectId, expectedType, label) {
  const normalized = normalizeStructTag(expectedType);
  const matches = (response.objectChanges ?? []).filter((change) => {
    try {
      return change?.type === 'mutated'
        && change.objectId === objectId
        && normalizeStructTag(change.objectType) === normalized;
    } catch { return false; }
  });
  if (matches.length !== 1) {
    fail('MAKER_V8_PLAYER_OBJECT_CHANGE_INVALID', `${label} requires one exact finalized mutation.`, {
      objectId,
      observed: matches.length,
    });
  }
  const change = matches[0];
  const refs = (response.compilerEffectsOutputRefs ?? []).filter((ref) => ref.objectId === objectId);
  if (refs.length !== 1 || String(refs[0].version) !== String(change.version)
    || refs[0].digest !== change.digest) {
    fail('MAKER_V8_PLAYER_EFFECTS_REF_DRIFT', `${label} Core object change differs from raw TransactionEffects.`);
  }
  return freeze({ change, ref: refs[0] });
}

function readbackFieldList(type, types) {
  if (type === types.nativeSoul) return MAKER_V8_NATIVE_SOUL_FIELDS;
  if (type === types.nativeSoulState) return MAKER_V8_NATIVE_STATE_FIELDS;
  if (type === types.nativeSoulBinding) return MAKER_V8_NATIVE_BINDING_FIELDS;
  if (type === types.makerAccess) return [
    'version', 'rootId', 'makerVersion', 'rootContentCommitment', 'holder',
    'paidAtomic', 'issuedAtMs',
  ];
  if (type === types.packPass) return [
    'version', 'releaseId', 'rootId', 'rootVersion', 'rootContentCommitment',
    'releaseContentCommitment', 'holder', 'paidAtomic', 'issuedAtMs', 'commitment',
  ];
  if (type === types.ownedBaseItem) return [
    'version', 'rootId', 'rootVersion', 'rootContentCommitment',
    'definitionRegistryId', 'packRegistryId', 'baseRegistryId', 'partKey',
    'itemKey', 'itemPayloadCommitment', 'holder', 'ownershipEpoch',
    'transferable', 'equipLock',
  ];
  if (type === types.ownedExternalItem) return [
    'version', 'productId', 'productContentCommitment',
    'assetContentCommitment', 'holder', 'ownershipEpoch',
    'transferable', 'equipLock',
  ];
  if (type === types.makerLoadout) return [
    'version', 'rootId', 'rootVersion', 'rootContentCommitment',
    'definitionRegistryId', 'packRegistryId', 'makerAccessPassId',
    'makerAccessCommitment', 'holder', 'revision', 'attachedPackDefinitions', 'definitionSlots', 'selections',
    'selectionCount', 'commitment',
  ];
  if (type === types.completeOutput) return [
    'version', 'rootId', 'makerVersion', 'rootContentCommitment', 'outputRegistryId',
    'outputKey', 'originalHolder', 'holder', 'loadoutId', 'loadoutRevision',
    'loadoutCommitment', 'outputPolicyCommitment', 'rendererSchemaCommitment',
    'recipeCommitment', 'renderCommitment', 'renderBlobId', 'renderSha256',
    'renderBlobCommitment', 'outputCommitment', 'protected', 'scopeKey',
    'assetKey', 'sealId', 'protectionBindingCommitment',
  ];
  if (type === types.completeReceipt) return [
    'version', 'outputId', 'rootId', 'makerVersion', 'rootContentCommitment',
    'outputKey', 'originalHolder', 'holder', 'loadoutId', 'loadoutRevision',
    'loadoutCommitment', 'outputPolicyCommitment', 'rendererSchemaCommitment',
    'economicsCommitment', 'recipeCommitment', 'renderCommitment',
    'outputCommitment', 'totalPaidAtomic', 'receiptCommitment', 'protected',
    'sealId',
  ];
  if (type === types.canonicalSoul) return [
    'version', 'soulRegistryId', 'rootId', 'makerVersion', 'rootContentCommitment',
    'outputKey', 'outputPolicyCommitment', 'holder', 'ownershipEpoch', 'outputId',
    'receiptId', 'recipeCommitment', 'renderCommitment', 'outputCommitment',
    'receiptCommitment', 'soulCommitment',
  ];
  if (type === types.physicalAsset) return [
    'version', 'registryId', 'rootId', 'makerVersion', 'rootContentCommitment',
    'source', 'style',
    'assetContentCommitment', 'materialPolicyCommitment', 'policyRowCommitment',
    'issuanceKind', 'proofKind', 'serial', 'holder', 'ownershipEpoch',
    'transferable', 'authorizationKey', 'proof', 'provenanceCommitment',
  ];
  fail('MAKER_V8_PLAYER_READBACK_TYPE_INVALID', 'Player readback requested an unknown exact v8 object type.');
}

function assertReadbackObject(record, type, object, all, types) {
  if (type === MAKER_V8_NATIVE_KIOSK_ITEM_TYPE) {
    assertMakerV8NativeCompleteObjectsV8({ record, outputs: all, types });
    return;
  }
  if ([types.nativeSoul, types.nativeSoulState, types.nativeSoulBinding].includes(type)) {
    assertMakerV8NativeCompleteObjectsV8({ record, outputs: all, types });
    const binding = all.find((entry) => entry.type === types.nativeSoulBinding);
    const state = all.find((entry) => entry.type === types.nativeSoulState);
    const rights = moveFields(binding.fields.rights, 'Native binding rights');
    const expected = record.plan.descriptor.expected.nativeSoul;
    if (hex(rights.commitment, 'Native rights commitment') !== expected.rightsCommitment
      || binding.fields.makerCreator !== expected.makerCreator
      || binding.fields.makerTreasuryId !== expected.makerTreasuryId
      || decimal(state.fields.creatorRoyaltyBps, 'Native creator royalty')
        !== decimal(rights.soul_creator_royalty_bps ?? rights.soulCreatorRoyaltyBps, 'Root creator royalty')) {
      fail('MAKER_V8_NATIVE_RIGHTS_DRIFT', 'Native Complete rights differ from the signed Root rights.');
    }
    if (moveOption(state.fields.contentId, 'Native contentId') === null
      || moveOption(state.fields.accessListId, 'Native accessListId') === null) {
      fail('MAKER_V8_NATIVE_CONTENT_READBACK_INVALID', 'Native Soul lacks required content/access roots.');
    }
    return;
  }
  const fields = object.fields;
  const rootId = moveId(fields.rootId, 'readback.rootId');
  const holder = address(String(fields.holder).toLowerCase(), 'readback.holder');
  if (rootId !== record.playerIdentity.rootId || holder !== record.plan.signer) {
    fail('MAKER_V8_PLAYER_READBACK_CUSTODY_DRIFT', 'Finalized Player output does not bind the exact Root and signer.', { type });
  }
  if (String(fields.makerVersion ?? fields.rootVersion) !== record.playerIdentity.makerVersion) {
    fail('MAKER_V8_PLAYER_READBACK_VERSION_DRIFT', 'Finalized Player output binds another Maker version.', { type });
  }
  if (fields.rootContentCommitment !== record.playerIdentity.rootContentCommitment) {
    fail('MAKER_V8_PLAYER_READBACK_CONTENT_DRIFT', 'Finalized Player output binds another Root content commitment.', { type });
  }
  if (type === types.packPass) {
    if (moveId(fields.releaseId, 'PackPass.releaseId') !== record.input.releaseId) {
      fail('MAKER_V8_PLAYER_READBACK_PACK_DRIFT', 'Finalized PackPass belongs to another Release.');
    }
  } else if (type === types.ownedBaseItem) {
    if (fields.partKey !== record.input.partKey || fields.itemKey !== record.input.itemKey
      || moveId(fields.definitionRegistryId, 'OwnedBaseItem.definitionRegistryId')
        !== record.plan.descriptor.expected.runtimeDefinitionsId
      || moveId(fields.packRegistryId, 'OwnedBaseItem.packRegistryId')
        !== record.plan.descriptor.expected.packRegistryId
      || moveId(fields.baseRegistryId, 'OwnedBaseItem.baseRegistryId')
        !== record.plan.descriptor.expected.baseRegistryId
      || fields.transferable !== true) {
      fail('MAKER_V8_PLAYER_BASE_ITEM_READBACK_DRIFT', 'Finalized owned Base Item differs from the exact Maker/Item authority.');
    }
  } else if (type === types.makerLoadout) {
    const selections = assertMakerV8PlayerLoadoutLayoutV8(fields, record.plan.descriptor.expected.packDefinitionLayout);
    const observed = selections.filter(Boolean);
    if (String(fields.revision)
        !== record.plan.descriptor.expected.ownedItemTransitions.finalLoadoutRevision
      || String(fields.selectionCount) !== String(record.loadout.selections.length)
      || observed.length !== record.loadout.selections.length
      || !HASH.test(fields.commitment)) {
      fail('MAKER_V8_PLAYER_READBACK_LOADOUT_DRIFT', 'Finalized MakerLoadout selection count differs from the Recipe.');
    }
    const packStyles = record.plan.descriptor.expected.packStyles;
    const protectedAssets = record.plan.descriptor.expected.protectedAssets ?? [];
    for (const expected of record.loadout.selections) {
      const actual = observed.find((row) => row.selectionIndex === expected.selectionIndex);
      const policy = expected.source === 'PACK'
        ? packStyles.find((row) => row.selectionIndex === expected.selectionIndex) : null;
      const ownedBase = expected.source === 'BASE'
        ? record.plan.descriptor.expected.ownedBaseItems.find((row) => (
          row.partKey === expected.partKey && row.itemKey === expected.itemKey
        )) : null;
      const ownedExternal = expected.source === 'EXTERNAL'
        ? record.plan.descriptor.expected.ownedExternalItems.find((row) => (
          row.productId === expected.externalProductId
          && row.ownedItemId === expected.ownedExternalItemId
        )) : null;
      const sourceClass = expected.source === 'BASE' ? 0 : expected.source === 'PACK' ? 1 : 2;
      const sourceDefinitionId = expected.source === 'BASE'
        ? record.playerIdentity.rootId
        : expected.source === 'PACK' ? expected.releaseId : expected.externalProductId;
      const sourceSemanticId = expected.source === 'PACK' ? expected.semanticPackId : '';
      const protectedAsset = protectedAssets.find((row) => (
        row.selectionIndex === expected.selectionIndex && row.source === expected.source
      ));
      const expectedProtected = protectedAsset !== undefined
        || policy?.protected === true;
      if (!actual
        || actual.partKey !== expected.partKey
        || actual.itemKey !== expected.itemKey
        || actual.styleKey !== expected.styleKey
        || actual.swatchKey !== expected.swatchKey
        || actual.sourceClass !== sourceClass
        || actual.sourceDefinitionId !== sourceDefinitionId
        || ownedBase && actual.accessSubject !== ownedBase.objectId
        || ownedExternal && actual.accessSubject !== ownedExternal.ownedItemId
        || actual.sourceSemanticId !== sourceSemanticId
        || ownedExternal && actual.assetContentCommitment
          !== ownedExternal.assetContentCommitment
        || actual.protected !== expectedProtected
        || expectedProtected && !HASH.test(actual.sealBindingCommitment ?? '')
        || !expectedProtected && (actual.sealBindingCommitment ?? null) !== null
        || policy?.protected === true
          && actual.sealBindingCommitment !== policy.sealBindingCommitment
        || protectedAsset
          && actual.assetContentCommitment !== protectedAsset.assetContentCommitment
        || policy && actual.assetContentCommitment !== policy.assetContentCommitment) {
        fail('MAKER_V8_PLAYER_READBACK_LOADOUT_DRIFT', 'Finalized MakerLoadout selections differ from the exact Recipe.');
      }
    }
  } else if ([types.completeOutput, types.completeReceipt, types.canonicalSoul].includes(type)) {
    const expectedProtected = record.plan.descriptor.expected.protectedOutput === true;
    if (fields.outputKey !== record.loadout.outputKey
      || [types.completeOutput, types.completeReceipt].includes(type)
        && fields.protected !== expectedProtected) {
      fail('MAKER_V8_PLAYER_READBACK_COMPLETE_DRIFT', 'Finalized Complete bundle differs from the exact protected/unprotected Recipe.');
    }
    if ([types.completeOutput, types.completeReceipt].includes(type)
      && (fields.loadoutCommitment !== record.plan.descriptor.expected.chainLoadoutCommitment
        || moveId(fields.loadoutId, 'Complete.loadoutId')
          !== record.plan.descriptor.expected.chainLoadoutId)) {
      fail('MAKER_V8_PLAYER_READBACK_COMPLETE_DRIFT', 'Finalized Complete bundle differs from the exact committed MakerLoadout.');
    }
    if (type === types.completeOutput
      && (fields.renderBlobId !== record.input.render.blobId
        || fields.renderSha256 !== record.input.render.sha256
        || fields.renderBlobCommitment !== record.input.render.blobCommitment)) {
      fail('MAKER_V8_PLAYER_READBACK_RENDER_DRIFT', 'Finalized Complete render transport differs from the signed input.');
    }
    if (type === types.completeOutput && expectedProtected
      && (fields.scopeKey !== record.plan.descriptor.expected.sealScopeKey
        || fields.assetKey !== record.plan.descriptor.expected.sealAssetKey
        || !HASH.test(fields.sealId ?? '')
        || !HASH.test(fields.protectionBindingCommitment ?? ''))) {
      fail('MAKER_V8_PLAYER_READBACK_PROTECTION_DRIFT', 'Protected Output lacks its exact Seal scope, asset, ID, or binding commitment.');
    }
    if (type === types.completeReceipt && expectedProtected) {
      const output = all.find((entry) => entry.type === types.completeOutput);
      if (!output || !HASH.test(fields.sealId ?? '')
        || fields.sealId !== output.fields.sealId) {
        fail('MAKER_V8_PLAYER_READBACK_PROTECTION_DRIFT', 'Protected Receipt does not bind the exact Output Seal ID.');
      }
    }
    if (type === types.completeOutput && !expectedProtected
      && (fields.scopeKey !== '' || fields.assetKey !== '' || fields.sealId !== null
        || fields.protectionBindingCommitment !== '')) {
      fail('MAKER_V8_PLAYER_READBACK_PROTECTION_DRIFT', 'Unprotected Output contains unexpected Seal authority.');
    }
    if (type === types.completeReceipt && !expectedProtected && fields.sealId !== null) {
      fail('MAKER_V8_PLAYER_READBACK_PROTECTION_DRIFT', 'Unprotected Receipt contains an unexpected Seal ID.');
    }
  } else if (type === types.physicalAsset) {
    const policy = record.plan.descriptor.expected.physicalPolicy;
    const expectedSelection = record.loadout.selections[record.input.selectionIndex];
    const source = moveFields(fields.source, 'PhysicalAsset.source');
    const style = moveFields(fields.style, 'PhysicalAsset.style');
    const proof = moveOption(fields.proof, 'PhysicalAsset.proof');
    const expectedProofKind = policy.issuanceKind === 2 ? 1 : 0;
    if (String(fields.ownershipEpoch) !== '0'
      || Number(fields.issuanceKind) !== policy.issuanceKind
      || Number(fields.proofKind) !== expectedProofKind
      || fields.policyRowCommitment !== policy.policyCommitment
      || moveId(fields.registryId, 'PhysicalAsset.registryId')
        !== record.plan.descriptor.expected.physicalRegistryId
      || Number(decimal(source.source_kind, 'PhysicalAsset.sourceKind'))
        !== (expectedSelection.source === 'BASE' ? 0 : 1)
      || moveId(source.source_id, 'PhysicalAsset.sourceId')
        !== (expectedSelection.source === 'BASE'
          ? record.plan.descriptor.expected.baseRegistryId : expectedSelection.releaseId)
      || moveText(style.part_key, 'PhysicalAsset.partKey') !== expectedSelection.partKey
      || moveText(style.item_key, 'PhysicalAsset.itemKey') !== expectedSelection.itemKey
      || moveText(style.style_key, 'PhysicalAsset.styleKey') !== expectedSelection.styleKey
      || style.style_protected !== false) {
      fail('MAKER_V8_PLAYER_READBACK_PHYSICAL_DRIFT', 'New Physical asset does not begin at ownership epoch zero.');
    }
    if (policy.issuanceKind === 2) {
      const proofFields = moveFields(proof, 'PhysicalAsset.proof');
      if (moveId(proofFields.soul_id, 'PhysicalAsset.proof.soulId') !== record.input.soulId
        || moveText(proofFields.materialization_key, 'PhysicalAsset.proof.materializationKey')
          !== record.input.materializationKey) {
        fail('MAKER_V8_PLAYER_READBACK_PHYSICAL_DRIFT', 'Physical proof differs from the signed Soul materialization input.');
      }
    } else if (proof !== null) {
      fail('MAKER_V8_PLAYER_READBACK_PHYSICAL_DRIFT', 'Non-proof Physical issuance unexpectedly contains Soul provenance.');
    }
  }
  if (type === types.completeReceipt || type === types.canonicalSoul) {
    const output = all.find((entry) => entry.type === types.completeOutput);
    if (!output || moveId(fields.outputId, 'Complete outputId') !== output.objectId) {
      fail('MAKER_V8_PLAYER_READBACK_COMPLETE_DRIFT', 'Complete Receipt/Soul does not bind the exact created Output.');
    }
  }
  if (type === types.canonicalSoul) {
    const receipt = all.find((entry) => entry.type === types.completeReceipt);
    const output = all.find((entry) => entry.type === types.completeOutput);
    if (!receipt || !output
      || moveId(fields.receiptId, 'Soul.receiptId') !== receipt.objectId
      || String(fields.ownershipEpoch) !== '0'
      || fields.recipeCommitment !== receipt.fields.recipeCommitment
      || fields.recipeCommitment !== output.fields.recipeCommitment) {
      fail('MAKER_V8_PLAYER_READBACK_COMPLETE_DRIFT', 'Canonical Soul does not bind the exact created Receipt.');
    }
  }
}

/** Pure verifier for the native Soul and its immutable Complete provenance. */
export function assertMakerV8PlayerCompleteReadbackV8({
  runtime: runtimeInput,
  record,
  outputs,
} = {}) {
  const runtime = assertMakerV8Runtime(runtimeInput);
  const types = playerTypes(runtime);
  const expected = [types.completeOutput, types.completeReceipt, types.nativeSoulBinding, types.nativeSoul, types.nativeSoulState, MAKER_V8_NATIVE_KIOSK_ITEM_TYPE];
  if (!plain(record) || !Array.isArray(outputs)
    || outputs.length !== expected.length
    || expected.some((type) => outputs.filter((entry) => entry?.type === type).length !== 1)) {
    fail('MAKER_V8_PLAYER_READBACK_COMPLETE_DRIFT', 'Complete readback must contain native Soul/State, immutable Binding/Output/Receipt and exact Kiosk wrapper custody.');
  }
  for (const output of outputs) {
    assertReadbackObject(record, output.type, output, outputs, types);
  }
  return true;
}

function assertOwnedItemTransitionReadback(expected, output, loadout, types) {
  const fields = output.fields;
  const expectedType = expected.kind === 'BASE' ? types.ownedBaseItem : types.ownedExternalItem;
  if (output.type !== expectedType || output.objectId !== expected.objectId
    || address(String(fields.holder).toLowerCase(), 'Owned Item holder') !== expected.holder
    || decimal(fields.ownershipEpoch, 'Owned Item ownershipEpoch') !== expected.ownershipEpoch
    || fields.transferable !== expected.transferable) {
    fail('MAKER_V8_PLAYER_OWNED_ITEM_READBACK_DRIFT', 'Finalized owned Item differs from the exact signed custody state.');
  }
  if (expected.kind === 'BASE') {
    if (moveId(fields.rootId, 'OwnedBaseItem.rootId') !== expected.rootId
      || decimal(fields.rootVersion, 'OwnedBaseItem.rootVersion') !== expected.rootVersion
      || hex(fields.rootContentCommitment, 'OwnedBaseItem.rootContentCommitment')
        !== expected.rootContentCommitment
      || moveId(fields.definitionRegistryId, 'OwnedBaseItem.definitionRegistryId')
        !== expected.definitionRegistryId
      || moveId(fields.packRegistryId, 'OwnedBaseItem.packRegistryId')
        !== expected.packRegistryId
      || moveId(fields.baseRegistryId, 'OwnedBaseItem.baseRegistryId')
        !== expected.baseRegistryId
      || moveText(fields.partKey, 'OwnedBaseItem.partKey') !== expected.partKey
      || moveText(fields.itemKey, 'OwnedBaseItem.itemKey') !== expected.itemKey
      || hex(fields.itemPayloadCommitment, 'OwnedBaseItem.itemPayloadCommitment')
        !== expected.itemPayloadCommitment) {
      fail('MAKER_V8_PLAYER_OWNED_ITEM_READBACK_DRIFT', 'Finalized owned Base Item authority drifted.');
    }
  } else if (moveId(fields.productId, 'OwnedExternalItem.productId') !== expected.productId
    || hex(fields.productContentCommitment, 'OwnedExternalItem.productContentCommitment')
      !== expected.productContentCommitment
    || hex(fields.assetContentCommitment, 'OwnedExternalItem.assetContentCommitment')
      !== expected.assetContentCommitment) {
    fail('MAKER_V8_PLAYER_OWNED_ITEM_READBACK_DRIFT', 'Finalized owned external Item authority drifted.');
  }

  const lock = moveOption(fields.equipLock, 'Owned Item equipLock');
  if (expected.expectedLock === null) {
    if (lock !== null) {
      fail('MAKER_V8_PLAYER_OWNED_ITEM_LOCK_DRIFT', 'Unequipped owned Item retains an unexpected loadout lock.');
    }
    return;
  }
  if (lock === null || !loadout) {
    fail('MAKER_V8_PLAYER_OWNED_ITEM_LOCK_DRIFT', 'Equipped owned Item lacks its exact finalized loadout lock.');
  }
  const lockFields = moveFields(lock, 'Owned Item equipLock');
  if (moveId(lockFields.loadout_id ?? lockFields.loadoutId, 'Owned Item equipLock.loadoutId')
      !== loadout.objectId
    || decimal(
      lockFields.equip_revision ?? lockFields.equipRevision,
      'Owned Item equipLock.equipRevision',
    ) !== expected.expectedLock.equipRevision
    || decimal(
      lockFields.selection_index ?? lockFields.selectionIndex,
      'Owned Item equipLock.selectionIndex',
    ) !== expected.expectedLock.selectionIndex) {
    fail('MAKER_V8_PLAYER_OWNED_ITEM_LOCK_DRIFT', 'Owned Item lock differs from the exact finalized loadout slot/revision.');
  }
}

/** Pure verifier used by the production historical-readback path and its adversarial gate. */
export function assertMakerV8PlayerOwnedItemReadbackV8({
  runtime: runtimeInput,
  expected,
  output,
  loadout,
} = {}) {
  const runtime = assertMakerV8Runtime(runtimeInput);
  assertOwnedItemTransitionReadback(expected, output, loadout, playerTypes(runtime));
  return true;
}

function eventFields(value, fields, addressFields, hashFields, numericFields, label) {
  exact(value, fields, label);
  return freeze(Object.fromEntries(fields.map((field) => {
    const raw = value[field];
    if (addressFields.has(field)) {
      return [field, address(String(raw).toLowerCase(), `${label}.${field}`)];
    }
    if (hashFields.has(field)) return [field, hex(raw, `${label}.${field}`)];
    if (numericFields.has(field)) return [field, decimal(String(raw), `${label}.${field}`)];
    return [field, raw];
  })));
}

function ledgerBoundPlayerEvent(event, layout, fields, addressFields, hashFields, numericFields) {
  const raw = fromBase64(base64(event.bcs, 'Player finalized event BCS', 2048));
  let decoded;
  let roundtrip;
  try {
    decoded = layout.parse(raw);
    roundtrip = layout.serialize(decoded).toBytes();
  } catch {
    fail('MAKER_V8_PLAYER_EVENT_BCS_INVALID', 'Player event BCS cannot be canonically decoded.');
  }
  if (roundtrip.length !== raw.length
    || roundtrip.some((byte, index) => byte !== raw[index])) {
    fail('MAKER_V8_PLAYER_EVENT_BCS_INVALID', 'Player event BCS is noncanonical or contains trailing bytes.');
  }
  const authority = eventFields(
    decoded, fields, addressFields, hashFields, numericFields, 'Player event BCS',
  );
  const display = eventFields(
    event.parsedJson, fields, addressFields, hashFields, numericFields, 'Player event JSON',
  );
  if (!same(authority, display)) {
    fail('MAKER_V8_PLAYER_EVENT_JSON_BCS_DRIFT', 'Player event JSON differs from its Ledger-bound BCS.');
  }
  return authority;
}

function certifyPlayerEvent(runtime, record, response, outputs, types) {
  const expectedType = record.plan.descriptor.expected.expectedEventType;
  if (expectedType === null) return null;
  const matches = response.events.filter((event) => {
    try { return normalizeStructTag(event.type) === normalizeStructTag(expectedType); } catch { return false; }
  });
  if (matches.length !== 1 || matches[0].sender !== record.plan.signer) {
    fail('MAKER_V8_PLAYER_EVENT_INVALID', 'Finalized Player action must emit one exact signer-bound event.');
  }
  const event = matches[0];
  let layout;
  let fields;
  let role;
  let moduleName;
  let addressFields;
  let hashFields;
  let numericFields;
  if (record.action === MAKER_V8_PLAYER_ACTIONS.ACQUIRE_MAKER_ACCESS) {
    layout = MAKER_ACCESS_ISSUED_BCS;
    fields = ['root_id', 'pass_id', 'holder', 'paid_atomic', 'protocol_atomic', 'maker_atomic', 'issued_at_ms'];
    role = 'core'; moduleName = 'treasury_v8';
    addressFields = new Set(['root_id', 'pass_id', 'holder']);
    hashFields = new Set();
    numericFields = new Set(['paid_atomic', 'protocol_atomic', 'maker_atomic', 'issued_at_ms']);
  } else if (record.action === MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT) {
    layout = NATIVE_SOUL_BOUND_BCS;
    fields = ['binding_id', 'soul_id', 'soul_state_id', 'root_id', 'output_id', 'receipt_id', 'original_holder', 'authorization_commitment'];
    role = 'output'; moduleName = 'output_v8';
    addressFields = new Set(['binding_id', 'soul_id', 'soul_state_id', 'root_id', 'output_id', 'receipt_id', 'original_holder']);
    hashFields = new Set(['authorization_commitment']);
    numericFields = new Set();
  } else if (record.action === MAKER_V8_PLAYER_ACTIONS.MATERIALIZE_PHYSICAL) {
    layout = PHYSICAL_ASSET_ISSUED_BCS;
    fields = [
      'asset_id', 'root_id', 'registry_id', 'source_kind', 'source_id', 'serial',
      'holder', 'issuance_kind', 'authorization_key', 'provenance_commitment',
    ];
    role = 'physical'; moduleName = 'physical_v8';
    addressFields = new Set(['asset_id', 'root_id', 'registry_id', 'source_id', 'holder']);
    hashFields = new Set(['authorization_key', 'provenance_commitment']);
    numericFields = new Set(['source_kind', 'serial', 'issuance_kind']);
  } else {
    fail('MAKER_V8_PLAYER_EVENT_INVALID', 'Player descriptor requires an event for an unsupported action.');
  }
  if (event.packageId !== runtime.roles[role].callablePackageId
    || event.transactionModule !== moduleName) {
    fail('MAKER_V8_PLAYER_EVENT_INVALID', 'Player event emitter differs from the exact callable package/module.');
  }
  const bound = ledgerBoundPlayerEvent(
    event, layout, fields, addressFields, hashFields, numericFields,
  );
  const output = outputs[0];
  if (bound.root_id !== record.playerIdentity.rootId || (bound.holder ?? bound.original_holder) !== record.plan.signer) {
    fail('MAKER_V8_PLAYER_EVENT_INVALID', 'Player event differs from the signed Root/holder.');
  }
  if (record.action === MAKER_V8_PLAYER_ACTIONS.ACQUIRE_MAKER_ACCESS) {
    if (bound.pass_id !== output.objectId
      || bound.paid_atomic !== String(output.fields.paidAtomic)
      || BigInt(bound.protocol_atomic) + BigInt(bound.maker_atomic) !== BigInt(bound.paid_atomic)
      || bound.issued_at_ms !== String(output.fields.issuedAtMs)) {
      fail('MAKER_V8_PLAYER_EVENT_INVALID', 'Maker access event differs from the historical Pass.');
    }
  } else if (record.action === MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT) {
    const byType = (type) => outputs.find((entry) => entry.type === type);
    const soul = byType(types.nativeSoul);
    const soulState = byType(types.nativeSoulState);
    const binding = byType(types.nativeSoulBinding);
    const complete = byType(types.completeOutput);
    const receipt = byType(types.completeReceipt);
    if (bound.soul_id !== soul?.objectId || bound.output_id !== complete?.objectId
      || bound.receipt_id !== receipt?.objectId
      || bound.soul_state_id !== soulState?.objectId || bound.binding_id !== binding?.objectId
      || bound.authorization_commitment !== binding?.fields.authorizationCommitment) {
      fail('MAKER_V8_PLAYER_EVENT_INVALID', 'Native Soul event differs from historical Complete provenance.');
    }
  } else {
    const selection = record.loadout.selections[record.input.selectionIndex];
    if (bound.asset_id !== output.objectId
      || bound.registry_id !== output.fields.registryId
      || bound.source_kind !== String(selection.source === 'BASE' ? 0 : 1)
      || bound.source_id !== (selection.source === 'BASE'
        ? record.plan.descriptor.expected.baseRegistryId : selection.releaseId)
      || bound.serial !== String(output.fields.serial)
      || bound.issuance_kind !== String(output.fields.issuanceKind)
      || bound.authorization_key !== output.fields.authorizationKey
      || bound.provenance_commitment !== output.fields.provenanceCommitment) {
      fail('MAKER_V8_PLAYER_EVENT_INVALID', 'Physical issuance event differs from the historical asset.');
    }
  }
  return freeze({ type: expectedType, fields: bound });
}

/** Raw Ledger/Core finality plus exact historical output certification. */
export function createMakerV8PlayerReadbackAdapterV8({
  client,
  runtime: runtimeInput,
  persistence,
  assertTransport = assertMakerV8SuiGrpcTransport,
} = {}) {
  assertTransport(client);
  const runtime = assertMakerV8Runtime(runtimeInput);
  if (!PERSISTENCE_AUTHORITIES.has(persistence)) {
    fail('MAKER_V8_PLAYER_PERSISTENCE_AUTHORITY_REQUIRED', 'Readback requires official durable Player persistence.');
  }
  requireMethod(persistence, 'loadByDigest', 'Player persistence');
  const types = playerTypes(runtime);
  return freeze({
    schemaVersion: MAKER_V8_PLAYER_ADAPTERS_SCHEMA,
    async readbackPlayerAction(input) {
      exact(input, ['record', 'query'], 'Player readback request');
      const record = await persistence.loadByDigest(input.record?.transaction?.digest);
      if (!record || !same(record, input.record)
        || input.query?.status !== 'FINALIZED_SUCCESS'
        || input.query.digest !== record.transaction.digest) {
        fail('MAKER_V8_PLAYER_FINALITY_DRIFT', 'Player readback request differs from the exact durable WAL and finalized query.');
      }
      const descriptor = record.plan.descriptor;
      const kind = descriptorKind(descriptor);
      const expectedTransaction = Transaction.fromKind(kind.raw);
      expectedTransaction.setSender(record.plan.signer);
      await pinnedMainnet(client);
      const [response, evidence] = await Promise.all([
        assertFinalizedMakerV8CompilerTransactionV8(client, record.transaction.digest, expectedTransaction),
        client.getFinalizedTransactionEvidence({ digest: record.transaction.digest }),
      ]);
      await pinnedMainnet(client);
      if (evidence?.digest !== record.transaction.digest
        || evidence.transactionBcsBase64 !== record.transaction.bytes
        || evidence.effectsStatus?.success !== true
        || !Array.isArray(evidence.signatures)
        || !evidence.signatures.includes(record.signature.signature)
        || input.query.epoch !== evidence.epoch
        || input.query.effectsFingerprint !== `0x${hashBytes(evidence.effectsBcs)}`
        || input.query.eventsDigest !== evidence.eventsDigest
        || !await isValidTransactionSignature(
          fromBase64(record.transaction.bytes), record.signature.signature,
          { client, address: record.plan.signer },
        )) {
        fail('MAKER_V8_PLAYER_FINALITY_DRIFT', 'Finalized Ledger evidence does not bind exact Player bytes, signature, epoch, and success.');
      }
      const outputs = [];
      for (const expectedType of descriptor.expected.ownedOutputTypes) {
        // Custody is selected by the derived UID after Soul/State are decoded,
        // not by a type-only match among a transaction's dynamic fields.
        if (expectedType === MAKER_V8_NATIVE_KIOSK_ITEM_TYPE) continue;
        const { change, ref } = finalizedChange(response, expectedType, expectedType);
        await pinnedMainnet(client);
        const object = await readMakerV8CompilerHistoricalObjectV8(
          client,
          ref,
          expectedType,
          `Player ${expectedType}`,
          readbackFieldList(expectedType, types),
          record.transaction.digest,
        );
        await pinnedMainnet(client);
        outputs.push(freeze({
          type: expectedType,
          change: change.type,
          objectId: change.objectId,
          version: String(change.version),
          digest: change.digest,
          ...(record.action === MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT ? { owner: freeze(clone(object.owner, 'Native historical owner')) } : {}),
          fields: freeze(clone(object.fields, 'Player historical fields')),
        }));
      }
      const ownedItemOutputs = [];
      let nativeContentEvidence = null;
      if (record.action === MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT) {
        const nativeState = outputs.find((entry) => entry.type === types.nativeSoulState);
        const nativeSoul = outputs.find((entry) => entry.type === types.nativeSoul);
        nativeContentEvidence = await readMakerV8NativeContentEvidenceV8({ client,
          input: record.input.nativeSoul, originalPackageId: runtime.nativeSoulIntegration.soulidityOriginalPackageId,
          soulId: nativeSoul.objectId, stateId: nativeState.objectId, signer: record.plan.signer,
          transactionDigest: record.transaction.digest, effectsBcs: evidence.effectsBcs, effectsSha256: hashBytes(evidence.effectsBcs) });
        await pinnedMainnet(client);
        outputs.push(freeze(await readMakerV8NativeKioskItemV8({ client, response,
          soulId: nativeSoul.objectId, kioskId: nativeState.fields.currentKioskId,
          transactionDigest: record.transaction.digest })));
        await pinnedMainnet(client);
        const binding = outputs.find((entry) => entry.type === types.nativeSoulBinding);
        const fieldId = deriveDynamicFieldID(nativeState.objectId, 'u8', new Uint8Array([9]));
        const fieldType = '0x2::dynamic_field::Field<u8,0x2::object::ID>';
        const changes = response.objectChanges.filter((change) => change.type === 'created'
          && change.objectId === fieldId && normalizeStructTag(change.objectType) === normalizeStructTag(fieldType));
        const refs = response.compilerEffectsOutputRefs.filter((ref) => ref.objectId === fieldId);
        if (changes.length !== 1 || refs.length !== 1 || String(changes[0].version) !== String(refs[0].version)
          || changes[0].digest !== refs[0].digest) {
          fail('MAKER_V8_NATIVE_STATE_BINDING_DRIFT', 'Native SoulState lacks its exact created provenance field.');
        }
        const field = await readMakerV8CompilerHistoricalObjectV8(client, refs[0], fieldType,
          'Native SoulState binding', ['name', 'value'], record.transaction.digest);
        if (Number(field.fields.name) !== 9 || moveId(field.fields.value, 'Native binding ID') !== binding.objectId
          || field.owner?.kind !== 'ObjectOwner' || field.owner.value !== nativeState.objectId) {
          fail('MAKER_V8_NATIVE_STATE_BINDING_DRIFT', 'Historical SoulState provenance does not point to the immutable native binding.');
        }
        ownedItemOutputs.push(freeze({ type: fieldType, change: 'created', objectId: fieldId,
          version: String(refs[0].version), digest: refs[0].digest, owner: field.owner, fields: field.fields }));
      }
      if (record.action === MAKER_V8_PLAYER_ACTIONS.COMMIT_LOADOUT) {
        const expectedTransitions = descriptor.expected.ownedItemTransitions.items;
        const expectedIds = expectedTransitions.map((entry) => entry.objectId).sort();
        const ownedTypes = new Set([
          normalizeStructTag(types.ownedBaseItem),
          normalizeStructTag(types.ownedExternalItem),
        ]);
        const observedIds = response.objectChanges.filter((change) => {
          try {
            return change?.type === 'mutated'
              && ownedTypes.has(normalizeStructTag(change.objectType));
          } catch { return false; }
        }).map((change) => change.objectId).sort();
        if (!same(observedIds, expectedIds)) {
          fail('MAKER_V8_PLAYER_OWNED_ITEM_CHANGE_DRIFT', 'Finalized owned Item mutation set differs from the signed loadout transition.');
        }
        for (const expected of expectedTransitions) {
          const expectedType = expected.kind === 'BASE'
            ? types.ownedBaseItem : types.ownedExternalItem;
          const { change, ref } = finalizedObjectChange(
            response, expected.objectId, expectedType, `${expected.kind} owned Item`,
          );
          await pinnedMainnet(client);
          const object = await readMakerV8CompilerHistoricalObjectV8(
            client,
            ref,
            expectedType,
            `Player ${expected.kind} owned Item`,
            readbackFieldList(expectedType, types),
            record.transaction.digest,
          );
          await pinnedMainnet(client);
          ownedItemOutputs.push(freeze({
            type: expectedType,
            change: change.type,
            objectId: change.objectId,
            version: String(change.version),
            digest: change.digest,
            fields: freeze(clone(object.fields, 'Player owned Item historical fields')),
          }));
        }
      }
      for (const output of outputs) assertReadbackObject(record, output.type, output, outputs, types);
      const loadoutOutput = outputs.find((entry) => entry.type === types.makerLoadout) ?? null;
      for (const expected of descriptor.expected.ownedItemTransitions.items) {
        const output = ownedItemOutputs.find((entry) => entry.objectId === expected.objectId);
        if (!output) {
          fail('MAKER_V8_PLAYER_OWNED_ITEM_CHANGE_DRIFT', 'Finalized readback omitted an expected owned Item mutation.');
        }
        assertOwnedItemTransitionReadback(expected, output, loadoutOutput, types);
      }
      const certifiedEvent = certifyPlayerEvent(runtime, record, response, outputs, types);
      const certifiedObjects = freeze([...outputs, ...ownedItemOutputs]);
      const certificate = freeze({
        schemaVersion: MAKER_V8_PLAYER_READBACK_SCHEMA,
        status: 'CERTIFIED',
        actionId: record.actionId,
        action: record.action,
        rootId: record.playerIdentity.rootId,
        transactionDigest: record.transaction.digest,
        evidence: freeze({
          checkpoint: String(evidence.checkpoint),
          epoch: String(evidence.epoch),
          transactionBcsSha256: hashBytes(evidence.transactionBcs),
          effectsBcsSha256: hashBytes(evidence.effectsBcs),
          signatureSha256: hashBytes(fromBase64(record.signature.signature)),
          transactionKindSha256: descriptor.kindSha256,
          objects: certifiedObjects,
          eventTypes: freeze(response.events.map((event) => event.type)),
          certifiedEvent,
          ...(nativeContentEvidence === null ? {} : { nativeContentEvidence }),
        }),
      });
      FINALITY_CERTIFICATES.set(certificate, freeze({ digest: record.transaction.digest }));
      return certificate;
    },
  });
}

/**
 * Complete production composition for direct product-controller injection.
 * Protected content is deliberately unavailable on the published v8 ABI.
 */
export async function createProductionMakerV8PlayerAdaptersV8({
  client = createProductionMakerV8SuiGrpcTransport(),
  productRuntime,
  runtime: runtimeInput = productRuntime?.runtime,
  execution = {},
  persistence: persistenceInput = null,
  indexedDB = globalThis.indexedDB,
  persistenceOptions,
  walletRegistry,
  walletId = null,
  walletAdapter = null,
  loadRuntimeAttestation,
  loadPlayerState = defaultLoadPlayerState,
  loadCompleteCounters = readMakerV8CompleteCountersV8,
  loadPhysicalPolicy = readMakerV8PhysicalPolicyV8,
  loadPackStyles = readMakerV8PackStylesV8,
  loadProtectedAssets = readMakerV8ProtectedAssetsV8,
  loadExternalAdmissions = readMakerV8ExternalAdmissionsV8,
  confirmNoSignedArtifact = null,
  now,
  randomBytes,
  signatureLeaseMs,
  assertTransport = assertMakerV8SuiGrpcTransport,
} = {}) {
  assertTransport(client);
  const suppliedRuntime = assertMakerV8Runtime(runtimeInput);
  const attestation = isMakerV8RuntimeAttested(suppliedRuntime)
    ? { runtime: suppliedRuntime }
    : await (loadRuntimeAttestation ?? attestMakerV8Runtime)(
      client,
      suppliedRuntime,
      { network: MAKER_V8_CHAIN_NETWORK },
    );
  const runtime = assertMakerV8Runtime(attestation?.runtime ?? attestation);
  if (!isMakerV8RuntimeAttested(runtime) || !same(runtime, suppliedRuntime)) {
    fail('MAKER_V8_PLAYER_RUNTIME_ATTESTATION_REQUIRED', 'Production Player factory requires the exact official Mainnet-attested runtime.');
  }
  if (!plain(productRuntime) || !same(productRuntime.runtime, runtime)) {
    fail('MAKER_V8_PLAYER_PRODUCT_RUNTIME_DRIFT', 'Player product runtime and attested runtime must be exact.');
  }
  const gates = playerExecution(execution);
  const browserExecution = freeze({
    network: MAKER_V8_CHAIN_NETWORK,
    chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
    allowWalletSignature: gates.allowWalletSignature,
    allowBroadcast: gates.allowBroadcast,
  });
  const persistence = persistenceInput ?? createMakerV8PlayerPersistenceV8(indexedDB, {
    ...(persistenceOptions ?? {}),
    confirmNoSignedArtifact,
  });
  if (!PERSISTENCE_AUTHORITIES.has(persistence)) {
    fail(
      'MAKER_V8_PLAYER_PERSISTENCE_AUTHORITY_REQUIRED',
      'Production Player factory accepts only the fresh v8 IndexedDB persistence adapter.',
    );
  }
  const browser = createProductionMakerV8BrowserAdapters({
    runtime,
    execution: browserExecution,
    client,
    walletRegistry,
    walletId,
    wallet: walletAdapter,
  });
  const loadFresh = () => (loadRuntimeAttestation
    ? loadRuntimeAttestation(client, runtime, { network: MAKER_V8_CHAIN_NETWORK })
    : attestMakerV8Runtime(client, runtime, { network: MAKER_V8_CHAIN_NETWORK }));
  const rpc = createMakerV8PlayerRpcAdapterV8({ client, rpc: browser.rpc, assertTransport });
  await rpc.getChainIdentifier();
  const wallet = createMakerV8PlayerWalletAdapterV8({
    client, runtime, wallet: browser.wallet, persistence,
    loadRuntimeAttestation: loadFresh, assertTransport,
  });
  const compiler = createMakerV8PlayerCompilerAdapterV8({
    client, runtime, loadRuntimeAttestation: loadFresh, assertTransport,
  });
  const readback = createMakerV8PlayerReadbackAdapterV8({ client, runtime, persistence, assertTransport });
  const custodyBase = createMakerV8PlayerCustodyAdapterV8({
    client,
    runtime,
    loadRuntimeAttestation: loadFresh,
    loadPlayerState,
    loadCompleteCounters,
    loadPhysicalPolicy,
    loadPackStyles,
    loadProtectedAssets,
    loadExternalAdmissions,
    assertTransport,
  });
  const custody = freeze({
    schemaVersion: MAKER_V8_PLAYER_ADAPTERS_SCHEMA,
    quotePlayerCompletion: (input) => custodyBase.quotePlayerCompletion(input),
    loadPlayerContext: (input) => custodyBase.loadPlayerContext(input),
    resolveProtectedOutputIdentity: (input) => custodyBase.resolveProtectedOutputIdentity(input),
    resolveProtectedSelectionApproval: (input) => custodyBase.resolveProtectedSelectionApproval(input),
    assertPlayerContext: (input) => custodyBase.assertPlayerContext(input),
    readbackPlayerAction: (input) => readback.readbackPlayerAction(input),
  });
  const boundary = createMakerV8PlayerBoundaryAdapterV8({
    client,
    runtime,
    compiler,
    persistence,
    wallet,
    execution: gates,
    loadRuntimeAttestation: loadFresh,
    assertTransport,
  });
  const protectedContent = gates.allowProtectedContent
    ? createMakerV8PlayerProtectedContentAdapterV8({
      client,
      custody: custodyBase,
      wallet: browser.wallet,
    })
    : null;
  const controllerExecution = freeze({
    allowWalletSignature: gates.allowWalletSignature,
    allowBroadcast: gates.allowBroadcast,
    allowProtectedContent: gates.allowProtectedContent,
  });
  const controller = createMakerV8PlayerControllerV8({
    productRuntime,
    compiler,
    custody,
    boundary,
    wallet,
    rpc,
    persistence,
    execution: controllerExecution,
    ...(now === undefined ? {} : { now }),
    ...(randomBytes === undefined ? {} : { randomBytes }),
    ...(signatureLeaseMs === undefined ? {} : { signatureLeaseMs }),
  });
  return freeze({
    schemaVersion: MAKER_V8_PLAYER_ADAPTERS_SCHEMA,
    client,
    runtime,
    persistence,
    compiler,
    custody,
    boundary,
    wallet,
    rpc,
    execution: gates,
    capabilities: freeze({
      acquireMakerAccess: true,
      acquireBaseItem: true,
      acquirePackAccess: true,
      externalComposableItems: true,
      commitLoadout: true,
      completeOutput: true,
      materializePhysical: true,
      protectedContent: protectedContent !== null,
      protectedAssetReaderConfigured: typeof loadProtectedAssets === 'function',
      packStyleReaderConfigured: typeof loadPackStyles === 'function',
      completeCounterReaderConfigured: typeof loadCompleteCounters === 'function',
      physicalPolicyReaderConfigured: typeof loadPhysicalPolicy === 'function',
      externalAdmissionReaderConfigured: typeof loadExternalAdmissions === 'function',
    }),
    protectedContent,
    controller,
  });
}
