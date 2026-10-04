import { bcs } from '@mysten/sui/bcs';
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions';
import {
  fromBase58,
  fromBase64,
  normalizeStructTag,
  toBase58,
  toBase64,
} from '@mysten/sui/utils';
import { sha256 } from '@noble/hashes/sha2.js';

import { MAKER_V8_TRANSACTION_ABSENCE_SCHEMA } from './maker-v8-actions.js';
import {
  assertFinalizedMakerV8CompilerTransactionV8,
  createProductionMakerV8BrowserAdapters,
} from './maker-v8-browser.js';
import {
  MAKER_V8_CHAIN_NETWORK,
  MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
  MAKER_V8_MAINNET_GENESIS_DIGEST,
  attestMakerV8Runtime,
  isMakerV8RuntimeAttested,
  makerV8ChainTypes,
  parseMakerAdminCapV8,
  parseMakerRootV8,
  parseMakerTreasuryV8,
  parseProtocolConfigV8,
} from './maker-v8-chain.js';
import {
  MAKER_V8_LIFECYCLE_ACTIONS,
  MAKER_V8_LIFECYCLE_CONTROLLER_SCHEMA,
  MAKER_V8_LIFECYCLE_STATES,
  buildMakerV8LifecycleActionV8,
  createMakerV8LifecycleControllerV8,
  makerV8LifecycleTargetsV8,
} from './maker-v8-lifecycle.js';
import { assertMakerV8Runtime } from './maker-v8-runtime.js';
import {
  assertMakerV8SuiGrpcTransport,
  createProductionMakerV8SuiGrpcTransport,
} from './maker-v8-sui-grpc.js';

export const MAKER_V8_LIFECYCLE_ADAPTERS_SCHEMA =
  'animacraft.maker-v8-lifecycle-adapters.v1';
export const MAKER_V8_LIFECYCLE_RECOVERY_SCHEMA =
  'animacraft.maker-v8-lifecycle-recovery.v2';
export const MAKER_V8_LIFECYCLE_DATABASE = 'animacraft-maker-v8-lifecycle-mainnet-v2';

export const MAKER_V8_LIFECYCLE_RECOVERY_STATUS = Object.freeze({
  SIGNED_DURABLE: 'SIGNED_DURABLE',
  OUTCOME_PENDING: 'OUTCOME_PENDING',
  FINALIZED_SUCCESS: 'FINALIZED_SUCCESS',
  FINALIZED_FAILURE: 'FINALIZED_FAILURE',
  EXPIRED_NOT_FOUND: 'EXPIRED_NOT_FOUND',
});

const STORE = 'recoveries';
const INTENT_STORE = 'signatureIntents';
const ACTIVE_SCOPE_STORE = 'activeScopes';
const DATABASE_VERSION = 1;
const MAX_BYTES = 128 * 1024;
const MAX_RECORD_BYTES = 512 * 1024;
const UINT = /^(?:0|[1-9][0-9]*)$/;
const EXACT_ID = /^0x[0-9a-f]{64}$/;
const HASH = /^[0-9a-f]{64}$/;
const EFFECTS_HASH = /^0x[0-9a-f]{64}$/;
const encoder = new TextEncoder();
const FINALIZED_CONTEXTS = new WeakMap();
const RECORD_FIELDS = Object.freeze([
  'schemaVersion', 'controllerSchemaVersion', 'recoveryId', 'scopeKey', 'artifactSha256', 'revision', 'status',
  'action', 'descriptor', 'input', 'bytes', 'digest', 'signature', 'signer',
  'expirationEpoch', 'createdAt', 'updatedAt', 'broadcastCount', 'query',
]);
const ARTIFACT_FIELDS = Object.freeze([
  'schemaVersion', 'action', 'descriptor', 'input', 'bytes', 'digest', 'signature', 'signer',
]);
const INTENT_FIELDS = Object.freeze([
  'schemaVersion', 'recoveryId', 'scopeKey', 'intentSha256', 'sessionId', 'leaseExpiresAt',
  'action', 'descriptor', 'input', 'bytes', 'digest', 'signer', 'createdAt',
]);
const LOADED_ARTIFACT_FIELDS = Object.freeze([
  'schemaVersion', 'recoveryId', 'action', 'descriptor', 'input',
  'bytes', 'digest', 'signature', 'signer',
]);
const SESSION_ID = /^[0-9a-f]{32}$/;
const LIFECYCLE_EVENT_FIELDS = Object.freeze([
  'root_id', 'catalog_id', 'maker_version', 'content_commitment', 'owner',
  'control_epoch', 'from', 'to', 'registry_ids',
]);
const WITHDRAW_EVENT_FIELDS = Object.freeze([
  'root_id', 'treasury_id', 'operator', 'recipient', 'amount',
]);
const LIFECYCLE_REGISTRY_BINDINGS = Object.freeze({
  runtime_definition_registry_id: 'runtimeDefinitionRegistryId', pack_registry_id: 'packRegistryId',
  admission_authority_id: 'packAdmissionAuthorityId', seal_registry_id: 'sealRegistryId',
  output_registry_id: 'outputRegistryId', soul_registry_id: 'soulRegistryId',
  physical_registry_id: 'physicalRegistryId', market_registry_id: 'marketRegistryId',
});
const MAKER_V8_LIFECYCLE_CHANGED_BCS = bcs.struct('MakerV8LifecycleChanged', {
  root_id: bcs.Address,
  catalog_id: bcs.Address,
  maker_version: bcs.u64(),
  content_commitment: bcs.vector(bcs.u8()),
  owner: bcs.Address,
  control_epoch: bcs.u64(),
  from: bcs.u8(),
  to: bcs.u8(),
  registry_ids: bcs.struct('MakerRuntimeCompanionRegistryIdsV2', Object.fromEntries(Object.keys(LIFECYCLE_REGISTRY_BINDINGS).map(key => [key, bcs.Address]))),
});
const MAKER_REVENUE_V8_WITHDRAWN_BCS = bcs.struct('MakerRevenueV8Withdrawn', {
  root_id: bcs.Address,
  treasury_id: bcs.Address,
  operator: bcs.Address,
  recipient: bcs.Address,
  amount: bcs.u64(),
});

export class MakerV8LifecycleAdaptersError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'MakerV8LifecycleAdaptersError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function fail(code, message, details = {}) {
  throw new MakerV8LifecycleAdaptersError(code, message, details);
}

function plain(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function exact(value, fields, label) {
  if (!plain(value)) fail('MAKER_V8_LIFECYCLE_ADAPTER_SHAPE_INVALID', `${label} must be a plain record.`);
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (actual.length !== expected.length
    || actual.some((field, index) => field !== expected[index])) {
    fail('MAKER_V8_LIFECYCLE_ADAPTER_SHAPE_INVALID', `${label} has fields outside its exact schema.`, {
      actual,
      expected,
    });
  }
  return value;
}

function requireMethod(value, method, label) {
  if (typeof value?.[method] !== 'function') {
    fail('MAKER_V8_LIFECYCLE_ADAPTER_DEPENDENCY_INVALID', `${label}.${method} is required.`);
  }
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (ArrayBuffer.isView(value)) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
}

function clonePlain(root, label) {
  const seen = new WeakSet();
  let nodes = 0;
  function visit(value, path, depth) {
    nodes += 1;
    if (nodes > 100_000 || depth > 64) {
      fail('MAKER_V8_LIFECYCLE_DURABLE_VALUE_INVALID', `${label} exceeds bounded structured-data limits.`, { path });
    }
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'bigint') return value;
    if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
    if (!value || typeof value !== 'object' || seen.has(value)) {
      fail('MAKER_V8_LIFECYCLE_DURABLE_VALUE_INVALID', `${label} must be one ordinary structured-data tree.`, { path });
    }
    seen.add(value);
    const array = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    if ((array && prototype !== Array.prototype)
      || (!array && prototype !== Object.prototype && prototype !== null)) {
      fail('MAKER_V8_LIFECYCLE_DURABLE_VALUE_INVALID', `${label} contains a non-plain value.`, { path });
    }
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== 'string')) {
      fail('MAKER_V8_LIFECYCLE_DURABLE_VALUE_INVALID', `${label} contains symbol keys.`, { path });
    }
    if (array) {
      const result = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
          fail('MAKER_V8_LIFECYCLE_DURABLE_VALUE_INVALID', `${label} contains a sparse or accessor array.`, { path });
        }
        result.push(visit(descriptor.value, `${path}[${index}]`, depth + 1));
      }
      if (keys.some((key) => key !== 'length' && !/^(?:0|[1-9][0-9]*)$/.test(key))) {
        fail('MAKER_V8_LIFECYCLE_DURABLE_VALUE_INVALID', `${label} contains decorated arrays.`, { path });
      }
      return result;
    }
    const result = {};
    for (const key of keys.sort()) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
        fail('MAKER_V8_LIFECYCLE_DURABLE_VALUE_INVALID', `${label} contains accessors or hidden fields.`, { path });
      }
      result[key] = visit(descriptor.value, `${path}.${key}`, depth + 1);
    }
    return result;
  }
  return visit(root, label, 0);
}

function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'bigint') return JSON.stringify(value.toString());
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (plain(value)) return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonical(value[key])}`
  )).join(',')}}`;
  throw new TypeError('non-canonical value');
}

function hashBytes(value) {
  return [...sha256(value)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function hashValue(value) {
  try { return hashBytes(encoder.encode(canonical(value))); } catch {
    fail('MAKER_V8_LIFECYCLE_DURABLE_VALUE_INVALID', 'Lifecycle durable value cannot be canonically hashed.');
  }
}

function address(value, label) {
  if (typeof value !== 'string' || !EXACT_ID.test(value) || /^0x0{64}$/.test(value)) {
    fail('MAKER_V8_LIFECYCLE_ADDRESS_INVALID', `${label} must be one canonical non-zero Sui address.`);
  }
  return value;
}

function decimal(value, label, { positive = false } = {}) {
  const text = typeof value === 'bigint' ? value.toString() : value;
  if (typeof text !== 'string' || !UINT.test(text) || (positive && text === '0')) {
    fail('MAKER_V8_LIFECYCLE_INTEGER_INVALID', `${label} must be one canonical decimal integer.`);
  }
  return text;
}

function suiDigest(value, label) {
  try {
    if (typeof value !== 'string') throw new Error('shape');
    const bytes = fromBase58(value);
    if (bytes.length !== 32 || toBase58(bytes) !== value) throw new Error('canonical');
    return value;
  } catch {
    fail('MAKER_V8_LIFECYCLE_DIGEST_INVALID', `${label} must be one canonical Sui digest.`);
  }
}

function base64(value, label, maximum = MAX_RECORD_BYTES) {
  try {
    if (typeof value !== 'string' || value.length === 0) throw new Error('shape');
    const bytes = fromBase64(value);
    if (bytes.length === 0 || bytes.length > maximum || toBase64(bytes) !== value) throw new Error('canonical');
    return bytes;
  } catch {
    fail('MAKER_V8_LIFECYCLE_BASE64_INVALID', `${label} must be bounded canonical Base64.`);
  }
}

function commitment(value, label) {
  if (Array.isArray(value) && value.length === 32
    && value.every((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 255)) {
    return value.map((entry) => entry.toString(16).padStart(2, '0')).join('');
  }
  if (typeof value === 'string') {
    const hex = value.replace(/^0x/, '').toLowerCase();
    if (HASH.test(hex)) return hex;
    try {
      const bytes = fromBase64(value);
      if (bytes.length === 32 && toBase64(bytes) === value) return hashBytesIdentity(bytes);
    } catch {
      // Use the exact error below.
    }
  }
  fail('MAKER_V8_LIFECYCLE_COMMITMENT_INVALID', `${label} must contain exactly 32 bytes.`);
}

function hashBytesIdentity(bytes) {
  return [...bytes].map((entry) => entry.toString(16).padStart(2, '0')).join('');
}

function executionConfig(value) {
  exact(value, ['network', 'chainIdentifier', 'allowWalletSignature', 'allowBroadcast'], 'lifecycle execution');
  if (value.network !== MAKER_V8_CHAIN_NETWORK
    || value.chainIdentifier !== MAKER_V8_MAINNET_CHAIN_IDENTIFIER
    || typeof value.allowWalletSignature !== 'boolean'
    || value.allowWalletSignature !== value.allowBroadcast) {
    fail('MAKER_V8_LIFECYCLE_EXECUTION_INVALID', 'Lifecycle execution must pin Mainnet and gate signing/broadcast together.');
  }
  return freeze({ ...value });
}

function transactionFromDescriptor(descriptor) {
  const tx = new Transaction();
  tx.setSender(address(descriptor.sender, 'descriptor.sender'));
  const args = descriptor.arguments.map((argument, index) => {
    if (!plain(argument)) fail('MAKER_V8_LIFECYCLE_DESCRIPTOR_INVALID', `descriptor.arguments[${index}] is invalid.`);
    if (argument.kind === 'shared') return tx.sharedObjectRef({
      objectId: address(argument.objectId, `descriptor.arguments[${index}].objectId`),
      initialSharedVersion: decimal(argument.initialSharedVersion, `descriptor.arguments[${index}].initialSharedVersion`, { positive: true }),
      mutable: argument.mutable,
    });
    if (argument.kind === 'owned' || argument.kind === 'immutable') return tx.objectRef({
      objectId: address(argument.objectId, `descriptor.arguments[${index}].objectId`),
      version: decimal(argument.version, `descriptor.arguments[${index}].version`, { positive: true }),
      digest: suiDigest(argument.digest, `descriptor.arguments[${index}].digest`),
    });
    if (argument.kind === 'u64') return tx.pure.u64(decimal(argument.value, `descriptor.arguments[${index}].value`, { positive: true }));
    if (argument.kind === 'address') return tx.pure.address(address(argument.value, `descriptor.arguments[${index}].value`));
    fail('MAKER_V8_LIFECYCLE_DESCRIPTOR_INVALID', `descriptor.arguments[${index}] has an unsupported kind.`);
  });
  tx.moveCall({ target: descriptor.target, typeArguments: descriptor.typeArguments, arguments: args });
  return tx;
}

function transactionKind(transaction) {
  return toBase64(new TransactionDataBuilder(transaction.getData()).build({ onlyTransactionKind: true }));
}

function transactionDataProof(value, expected = {}) {
  const bytes = base64(value, 'TransactionData', MAX_BYTES);
  let parsed;
  let canonicalBytes;
  let builder;
  try {
    parsed = bcs.TransactionData.parse(bytes);
    canonicalBytes = bcs.TransactionData.serialize(parsed).toBytes();
    builder = TransactionDataBuilder.fromBytes(bytes);
  } catch {
    fail('MAKER_V8_LIFECYCLE_TRANSACTION_DATA_INVALID', 'TransactionData is not canonical Sui BCS.');
  }
  if (parsed?.$kind !== 'V1' || canonicalBytes.length !== bytes.length
    || canonicalBytes.some((byte, index) => byte !== bytes[index])) {
    fail('MAKER_V8_LIFECYCLE_TRANSACTION_DATA_INVALID', 'TransactionData must be canonical V1 Sui BCS.');
  }
  const snapshot = builder.snapshot();
  const sender = address(snapshot.sender, 'TransactionData.sender');
  const gasOwner = address(snapshot.gasData?.owner, 'TransactionData.gasOwner');
  const gasBudget = BigInt(decimal(snapshot.gasData?.budget, 'TransactionData.gasBudget', { positive: true }));
  const gasPrice = BigInt(decimal(snapshot.gasData?.price, 'TransactionData.gasPrice', { positive: true }));
  const payment = snapshot.gasData?.payment;
  const epoch = snapshot.expiration?.Epoch;
  if (sender !== gasOwner || gasBudget > 500_000_000n || gasPrice === 0n
    || !Array.isArray(payment)
    || !Number.isSafeInteger(epoch) || epoch <= 0) {
    fail('MAKER_V8_LIFECYCLE_TRANSACTION_ENVELOPE_INVALID', 'TransactionData has an unsafe signer, gas, or expiration envelope.');
  }
  payment.forEach((ref, index) => {
    address(ref.objectId, `TransactionData.gasPayment[${index}].objectId`);
    decimal(ref.version, `TransactionData.gasPayment[${index}].version`, { positive: true });
    suiDigest(ref.digest, `TransactionData.gasPayment[${index}].digest`);
  });
  const digest = TransactionDataBuilder.getDigestFromBytes(bytes);
  const kindBytes = toBase64(bcs.TransactionKind.serialize(parsed.V1.kind).toBytes());
  if ((expected.sender !== undefined && sender !== expected.sender)
    || (expected.digest !== undefined && digest !== expected.digest)
    || (expected.kindBytes !== undefined && kindBytes !== expected.kindBytes)) {
    fail('MAKER_V8_LIFECYCLE_TRANSACTION_DATA_DRIFT', 'TransactionData differs from its exact sender, kind, or digest proof.');
  }
  return freeze({ bytes, base64: value, digest, sender, kindBytes, expirationEpoch: String(epoch) });
}

function stableScope({ action, rootId, signer }) {
  return `lifecycle-scope:${hashValue({
    schemaVersion: MAKER_V8_LIFECYCLE_RECOVERY_SCHEMA,
    action,
    rootId: address(rootId, 'lifecycle scope Root'),
    signer: address(signer, 'lifecycle scope signer'),
  })}`;
}

function artifactScope(artifact) {
  return stableScope({
    action: artifact.action,
    rootId: artifact.descriptor?.preState?.root?.objectId,
    signer: artifact.signer,
  });
}

function artifactIdentity(artifact) {
  return `lifecycle:${hashValue({
    scopeKey: artifactScope(artifact),
    bytes: artifact.bytes,
    digest: artifact.digest,
  })}`;
}

function unsignedIntent(artifact) {
  return Object.fromEntries([
    'schemaVersion', 'action', 'descriptor', 'input', 'bytes', 'digest', 'signer',
  ].map((field) => [field, field === 'schemaVersion'
    ? (artifact.controllerSchemaVersion ?? artifact.schemaVersion) : artifact[field]]));
}

function validateIntent(raw) {
  const intent = clonePlain(raw, 'lifecycle signature intent');
  exact(intent, INTENT_FIELDS, 'lifecycle signature intent');
  if (intent.schemaVersion !== MAKER_V8_LIFECYCLE_CONTROLLER_SCHEMA
    || !Number.isSafeInteger(intent.createdAt) || intent.createdAt < 0
    || !Number.isSafeInteger(intent.leaseExpiresAt)
    || intent.leaseExpiresAt <= intent.createdAt
    || !SESSION_ID.test(intent.sessionId)
    || artifactScope(intent) !== intent.scopeKey
    || artifactIdentity(intent) !== intent.recoveryId
    || hashValue(unsignedIntent(intent)) !== intent.intentSha256) {
    fail('MAKER_V8_LIFECYCLE_SIGNATURE_INTENT_INVALID', 'Durable lifecycle signature intent drifted.');
  }
  const expectedKind = transactionKind(transactionFromDescriptor(intent.descriptor));
  transactionDataProof(intent.bytes, {
    sender: intent.signer,
    digest: intent.digest,
    kindBytes: expectedKind,
  });
  return freeze(intent);
}

function artifactHash(artifact) {
  return hashValue(Object.fromEntries(ARTIFACT_FIELDS.map((field) => [
    field,
    field === 'schemaVersion'
      ? (artifact.controllerSchemaVersion ?? artifact.schemaVersion) : artifact[field],
  ])));
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
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
  });
}

function recoveryIdValue(value) {
  if (typeof value !== 'string' || !/^lifecycle:[0-9a-f]{64}$/.test(value)) {
    fail('MAKER_V8_LIFECYCLE_RECOVERY_ID_INVALID', 'Lifecycle recoveryId is invalid.');
  }
  return value;
}

function validateActiveScope(raw) {
  const value = clonePlain(raw, 'active lifecycle scope');
  exact(value, ['scopeKey', 'recoveryId'], 'active lifecycle scope');
  if (typeof value.scopeKey !== 'string'
    || !/^lifecycle-scope:[0-9a-f]{64}$/.test(value.scopeKey)) {
    fail('MAKER_V8_LIFECYCLE_SCOPE_INVALID', 'Active lifecycle scope is invalid.');
  }
  recoveryIdValue(value.recoveryId);
  return freeze(value);
}

function defaultSessionId() {
  const uuid = globalThis.crypto?.randomUUID?.();
  const value = typeof uuid === 'string' ? uuid.replaceAll('-', '').toLowerCase() : null;
  if (!SESSION_ID.test(value ?? '')) {
    fail('MAKER_V8_LIFECYCLE_RANDOM_REQUIRED', 'Cryptographic browser randomness is required for a signature session.');
  }
  return value;
}

function openDatabase(indexedDB, databaseName) {
  if (!indexedDB || typeof indexedDB.open !== 'function') {
    fail('MAKER_V8_LIFECYCLE_INDEXEDDB_REQUIRED', 'Durable lifecycle recovery requires IndexedDB.');
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE)) {
        const store = database.createObjectStore(STORE, { keyPath: 'recoveryId' });
        store.createIndex('byDigest', 'digest', { unique: true });
      }
      if (!database.objectStoreNames.contains(INTENT_STORE)) {
        database.createObjectStore(INTENT_STORE, { keyPath: 'recoveryId' });
      }
      if (!database.objectStoreNames.contains(ACTIVE_SCOPE_STORE)) {
        database.createObjectStore(ACTIVE_SCOPE_STORE, { keyPath: 'scopeKey' });
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
    request.onblocked = () => reject(new Error('IndexedDB lifecycle database upgrade is blocked'));
  });
}

function validateQuery(value, digest) {
  if (value === null) return null;
  exact(value, [
    'status', 'digest', 'epoch', 'effectsFingerprint', 'eventsDigest', 'error', 'absence',
  ], 'transaction query');
  const statuses = ['NOT_FOUND', 'PENDING', 'FINALIZED_SUCCESS', 'FINALIZED_FAILURE'];
  if (!statuses.includes(value.status) || suiDigest(value.digest, 'query.digest') !== digest) {
    fail('MAKER_V8_LIFECYCLE_QUERY_INVALID', 'Transaction query status or digest is invalid.');
  }
  if (value.status === 'NOT_FOUND') {
    const absence = value.absence;
    exact(absence, [
      'schemaVersion', 'kind', 'grpcCode', 'grpcService', 'grpcMethod',
      'requestedDigest', 'chainIdentifier',
      'watermarkEpoch', 'watermarkCheckpointSequence', 'watermarkCheckpointDigest',
    ], 'transaction absence');
    if (absence.schemaVersion !== MAKER_V8_TRANSACTION_ABSENCE_SCHEMA
      || absence.kind !== 'SUI_GRPC_TRANSACTION_NOT_FOUND'
      || absence.grpcCode !== 'NOT_FOUND'
      || absence.grpcService !== 'sui.rpc.v2.LedgerService'
      || absence.grpcMethod !== 'GetTransaction'
      || absence.requestedDigest !== digest
      || absence.chainIdentifier !== MAKER_V8_MAINNET_CHAIN_IDENTIFIER) {
      fail('MAKER_V8_LIFECYCLE_ABSENCE_INVALID', 'NOT_FOUND evidence is not bound to this Mainnet digest.');
    }
    decimal(absence.watermarkEpoch, 'absence.watermarkEpoch');
    decimal(absence.watermarkCheckpointSequence, 'absence.watermarkCheckpointSequence');
    suiDigest(absence.watermarkCheckpointDigest, 'absence.watermarkCheckpointDigest');
    if (value.epoch !== null || value.effectsFingerprint !== null || value.eventsDigest !== null
      || value.error !== null) fail('MAKER_V8_LIFECYCLE_QUERY_INVALID', 'NOT_FOUND contains finalized fields.');
  } else if (value.absence !== null) {
    fail('MAKER_V8_LIFECYCLE_QUERY_INVALID', 'Only NOT_FOUND may contain absence evidence.');
  }
  if (value.status.startsWith('FINALIZED_')) {
    decimal(value.epoch, 'query.epoch');
    if (typeof value.effectsFingerprint !== 'string' || !EFFECTS_HASH.test(value.effectsFingerprint)) {
      fail('MAKER_V8_LIFECYCLE_QUERY_INVALID', 'Finalized query lacks an exact effects fingerprint.');
    }
    if (value.eventsDigest !== null) suiDigest(value.eventsDigest, 'query.eventsDigest');
  }
  return freeze(clonePlain(value, 'transaction query'));
}

function validateRecord(raw) {
  const record = clonePlain(raw, 'lifecycle recovery record');
  exact(record, RECORD_FIELDS, 'lifecycle recovery record');
  if (record.schemaVersion !== MAKER_V8_LIFECYCLE_RECOVERY_SCHEMA
    || record.controllerSchemaVersion !== MAKER_V8_LIFECYCLE_CONTROLLER_SCHEMA
    || !Object.values(MAKER_V8_LIFECYCLE_RECOVERY_STATUS).includes(record.status)
    || !Object.values(MAKER_V8_LIFECYCLE_ACTIONS).includes(record.action)
    || !Number.isSafeInteger(record.revision) || record.revision < 1
    || !Number.isSafeInteger(record.broadcastCount) || record.broadcastCount < 0
    || !Number.isSafeInteger(record.createdAt) || !Number.isSafeInteger(record.updatedAt)
    || record.createdAt < 0 || record.updatedAt < record.createdAt) {
    fail('MAKER_V8_LIFECYCLE_RECOVERY_RECORD_INVALID', 'Lifecycle recovery record metadata is invalid.');
  }
  const artifact = Object.fromEntries(ARTIFACT_FIELDS.map((field) => [
    field,
    field === 'schemaVersion' ? record.controllerSchemaVersion : record[field],
  ]));
  exact(artifact, ARTIFACT_FIELDS, 'stored signed artifact');
  if (artifact.schemaVersion !== MAKER_V8_LIFECYCLE_CONTROLLER_SCHEMA
    || artifact.action !== record.descriptor?.action
    || artifact.signer !== record.descriptor?.sender
    || artifactScope(artifact) !== record.scopeKey
    || artifactIdentity(artifact) !== record.recoveryId
    || artifactHash(artifact) !== record.artifactSha256) {
    fail('MAKER_V8_LIFECYCLE_RECOVERY_RECORD_INVALID', 'Stored lifecycle identity or artifact hash drifted.');
  }
  const expectedKind = transactionKind(transactionFromDescriptor(record.descriptor));
  const proof = transactionDataProof(record.bytes, {
    sender: address(record.signer, 'record.signer'),
    digest: suiDigest(record.digest, 'record.digest'),
    kindBytes: expectedKind,
  });
  base64(record.signature, 'record.signature');
  if (record.expirationEpoch !== proof.expirationEpoch) {
    fail('MAKER_V8_LIFECYCLE_RECOVERY_RECORD_INVALID', 'Stored expiration differs from TransactionData.');
  }
  validateQuery(record.query, record.digest);
  if (record.status === MAKER_V8_LIFECYCLE_RECOVERY_STATUS.SIGNED_DURABLE
    && record.query !== null) {
    fail('MAKER_V8_LIFECYCLE_RECOVERY_RECORD_INVALID', 'Fresh signed record cannot contain a query result.');
  }
  if (canonical(record).length > MAX_RECORD_BYTES) {
    fail('MAKER_V8_LIFECYCLE_RECOVERY_RECORD_INVALID', 'Lifecycle recovery record exceeds its storage bound.');
  }
  return freeze(record);
}

function sameArtifact(left, right) {
  return ARTIFACT_FIELDS.every((field) => canonical(
    field === 'schemaVersion' ? (left.controllerSchemaVersion ?? left.schemaVersion) : left[field],
  ) === canonical(
    field === 'schemaVersion' ? (right.controllerSchemaVersion ?? right.schemaVersion) : right[field],
  ));
}

function assertTransition(current, next) {
  if (next.revision !== current.revision + 1 || next.createdAt !== current.createdAt
    || next.updatedAt < current.updatedAt || next.recoveryId !== current.recoveryId
    || next.scopeKey !== current.scopeKey
    || next.artifactSha256 !== current.artifactSha256 || !sameArtifact(current, next)
    || next.expirationEpoch !== current.expirationEpoch
    || next.broadcastCount < current.broadcastCount) {
    fail('MAKER_V8_LIFECYCLE_RECOVERY_CAS_INVALID', 'Lifecycle recovery CAS changed immutable signed authority.');
  }
  const terminal = [
    MAKER_V8_LIFECYCLE_RECOVERY_STATUS.FINALIZED_FAILURE,
    MAKER_V8_LIFECYCLE_RECOVERY_STATUS.EXPIRED_NOT_FOUND,
  ];
  if (terminal.includes(current.status) && next.status !== current.status) {
    fail('MAKER_V8_LIFECYCLE_RECOVERY_TERMINAL', 'Terminal lifecycle recovery cannot be replayed or replaced.');
  }
  if (current.status === MAKER_V8_LIFECYCLE_RECOVERY_STATUS.FINALIZED_SUCCESS
    && next.status !== current.status) {
    fail('MAKER_V8_LIFECYCLE_RECOVERY_TERMINAL', 'Finalized lifecycle recovery cannot regress.');
  }
}

/** Fresh IndexedDB WAL: stable Root/action scopes point to content-bound signed attempts in O(1). */
export function createMakerV8LifecyclePersistenceV8(indexedDB = globalThis.indexedDB, {
  databaseName = MAKER_V8_LIFECYCLE_DATABASE,
  storageManager = globalThis.navigator?.storage,
  minimumAvailableBytes = 2 * 1024 * 1024,
  now = Date.now,
  signatureLeaseMs = 120_000,
  createSessionId = defaultSessionId,
} = {}) {
  if (typeof databaseName !== 'string' || databaseName.length < 8 || databaseName.length > 160
    || !Number.isSafeInteger(minimumAvailableBytes) || minimumAvailableBytes < MAX_RECORD_BYTES
    || typeof now !== 'function' || typeof createSessionId !== 'function'
    || !Number.isSafeInteger(signatureLeaseMs) || signatureLeaseMs < 1_000
    || signatureLeaseMs > 300_000) {
    fail('MAKER_V8_LIFECYCLE_PERSISTENCE_CONFIG_INVALID', 'Lifecycle persistence options are invalid.');
  }
  const database = openDatabase(indexedDB, databaseName);
  let durablePromise = null;
  async function requirePersistentStorage() {
    if (!durablePromise) durablePromise = (async () => {
      if (!storageManager || typeof storageManager.persisted !== 'function'
        || typeof storageManager.persist !== 'function'
        || typeof storageManager.estimate !== 'function') {
        fail('MAKER_V8_LIFECYCLE_PERSISTENCE_REQUIRED', 'Persistent browser storage is required before a signature can be retained.');
      }
      const granted = await storageManager.persisted() || await storageManager.persist();
      const estimate = await storageManager.estimate();
      const quota = Number(estimate?.quota);
      const usage = Number(estimate?.usage);
      if (granted !== true || !Number.isSafeInteger(quota) || !Number.isSafeInteger(usage)
        || quota < usage || quota - usage < minimumAvailableBytes) {
        fail('MAKER_V8_LIFECYCLE_PERSISTENCE_REQUIRED', 'Persistent storage or minimum lifecycle WAL quota was not granted.');
      }
      return true;
    })().catch((error) => {
      durablePromise = null;
      throw error;
    });
    return durablePromise;
  }

  async function load(recoveryId) {
    recoveryId = recoveryIdValue(recoveryId);
    const db = await database;
    const transaction = db.transaction(STORE, 'readonly');
    const value = await requestResult(transaction.objectStore(STORE).get(recoveryId));
    await transactionDone(transaction);
    return value === undefined ? null : validateRecord(value);
  }

  async function loadByDigest(digest) {
    suiDigest(digest, 'recovery digest');
    const db = await database;
    const transaction = db.transaction(STORE, 'readonly');
    const value = await requestResult(transaction.objectStore(STORE).index('byDigest').get(digest));
    await transactionDone(transaction);
    return value === undefined ? null : validateRecord(value);
  }

  async function loadActiveScope(input) {
    const value = clonePlain(input, 'active lifecycle scope lookup');
    exact(value, ['action', 'rootId', 'signer'], 'active lifecycle scope lookup');
    const scopeKey = stableScope(value);
    const db = await database;
    const transaction = db.transaction(ACTIVE_SCOPE_STORE, 'readonly');
    const raw = await requestResult(transaction.objectStore(ACTIVE_SCOPE_STORE).get(scopeKey));
    await transactionDone(transaction);
    if (raw === undefined) return null;
    const active = validateActiveScope(raw);
    if (active.scopeKey !== scopeKey) {
      fail('MAKER_V8_LIFECYCLE_SCOPE_INVALID', 'Active lifecycle scope lookup returned another semantic action.');
    }
    return active;
  }

  async function putSignedArtifact(artifactInput, expirationEpoch) {
    await requirePersistentStorage();
    const artifact = freeze(clonePlain(artifactInput, 'signed lifecycle artifact'));
    exact(artifact, ARTIFACT_FIELDS, 'signed lifecycle artifact');
    const timestamp = Number(now());
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
      fail('MAKER_V8_LIFECYCLE_CLOCK_INVALID', 'Lifecycle persistence clock is invalid.');
    }
    const record = validateRecord({
      schemaVersion: MAKER_V8_LIFECYCLE_RECOVERY_SCHEMA,
      controllerSchemaVersion: artifact.schemaVersion,
      recoveryId: artifactIdentity(artifact),
      scopeKey: artifactScope(artifact),
      artifactSha256: artifactHash(artifact),
      revision: 1,
      status: MAKER_V8_LIFECYCLE_RECOVERY_STATUS.SIGNED_DURABLE,
      action: artifact.action,
      descriptor: artifact.descriptor,
      input: artifact.input,
      bytes: artifact.bytes,
      digest: artifact.digest,
      signature: artifact.signature,
      signer: artifact.signer,
      expirationEpoch: decimal(expirationEpoch, 'expirationEpoch', { positive: true }),
      createdAt: timestamp,
      updatedAt: timestamp,
      broadcastCount: 0,
      query: null,
    });
    const db = await database;
    const transaction = db.transaction([STORE, INTENT_STORE, ACTIVE_SCOPE_STORE], 'readwrite');
    const store = transaction.objectStore(STORE);
    const intents = transaction.objectStore(INTENT_STORE);
    const activeScopes = transaction.objectStore(ACTIVE_SCOPE_STORE);
    const intentRaw = await requestResult(intents.get(record.recoveryId));
    const intent = intentRaw === undefined ? null : validateIntent(intentRaw);
    const activeRaw = await requestResult(activeScopes.get(record.scopeKey));
    const active = activeRaw === undefined ? null : validateActiveScope(activeRaw);
    if (!intent || !active || active.recoveryId !== record.recoveryId
      || intent.scopeKey !== record.scopeKey
      || canonical(unsignedIntent(intent)) !== canonical(unsignedIntent(record))) {
      transaction.abort();
      fail('MAKER_V8_LIFECYCLE_SIGNATURE_INTENT_REQUIRED', 'Signed lifecycle persistence requires its exact durable pre-wallet intent.');
    }
    const existingRaw = await requestResult(store.get(record.recoveryId));
    if (existingRaw === undefined) {
      await requestResult(store.add(record));
      await requestResult(intents.delete(record.recoveryId));
    }
    else {
      const existing = validateRecord(existingRaw);
      if (!sameArtifact(existing, record)) {
        transaction.abort();
        fail('MAKER_V8_LIFECYCLE_SIGNED_ARTIFACT_CONFLICT', 'This exact lifecycle action already has different durable signed bytes.');
      }
    }
    await transactionDone(transaction);
    const reread = await load(record.recoveryId);
    if (!reread || canonical(reread) !== canonical(existingRaw === undefined ? record : validateRecord(existingRaw))) {
      fail('MAKER_V8_LIFECYCLE_DURABLE_READBACK_FAILED', 'Signed lifecycle WAL did not survive exact durable readback.');
    }
    return reread;
  }

  async function reserveSignatureIntent(input) {
    await requirePersistentStorage();
    const value = freeze(clonePlain(input, 'lifecycle signature intent input'));
    exact(value, [
      'schemaVersion', 'action', 'descriptor', 'input', 'bytes', 'digest', 'signer',
    ], 'lifecycle signature intent input');
    const timestamp = Number(now());
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
      fail('MAKER_V8_LIFECYCLE_CLOCK_INVALID', 'Lifecycle persistence clock is invalid.');
    }
    const sessionId = String(createSessionId()).toLowerCase();
    const intent = validateIntent({
      ...value,
      recoveryId: artifactIdentity(value),
      scopeKey: artifactScope(value),
      intentSha256: hashValue(unsignedIntent(value)),
      sessionId,
      leaseExpiresAt: timestamp + signatureLeaseMs,
      createdAt: timestamp,
    });
    const db = await database;
    const transaction = db.transaction([STORE, INTENT_STORE, ACTIVE_SCOPE_STORE], 'readwrite');
    const records = transaction.objectStore(STORE);
    const intents = transaction.objectStore(INTENT_STORE);
    const activeScopes = transaction.objectStore(ACTIVE_SCOPE_STORE);
    const [recordRaw, existingRaw, activeRaw] = await Promise.all([
      requestResult(records.get(intent.recoveryId)),
      requestResult(intents.get(intent.recoveryId)),
      requestResult(activeScopes.get(intent.scopeKey)),
    ]);
    let replaceFinalizedHead = false;
    if (activeRaw !== undefined) {
      const active = validateActiveScope(activeRaw);
      const activeRecordRaw = await requestResult(records.get(active.recoveryId));
      replaceFinalizedHead = activeRecordRaw !== undefined
        && validateRecord(activeRecordRaw).status === MAKER_V8_LIFECYCLE_RECOVERY_STATUS.FINALIZED_SUCCESS;
    }
    if (recordRaw !== undefined || existingRaw !== undefined
      || (activeRaw !== undefined && !replaceFinalizedHead)) {
      transaction.abort();
      fail('MAKER_V8_LIFECYCLE_SIGNED_ARTIFACT_CONFLICT', 'This lifecycle pre-state already has a signed or in-flight durable attempt.');
    }
    await requestResult(intents.add(intent));
    await requestResult(activeScopes.put({ scopeKey: intent.scopeKey, recoveryId: intent.recoveryId }));
    await transactionDone(transaction);
    const read = db.transaction([INTENT_STORE, ACTIVE_SCOPE_STORE], 'readonly');
    const reread = validateIntent(await requestResult(
      read.objectStore(INTENT_STORE).get(intent.recoveryId),
    ));
    const active = validateActiveScope(await requestResult(
      read.objectStore(ACTIVE_SCOPE_STORE).get(intent.scopeKey),
    ));
    await transactionDone(read);
    if (canonical(reread) !== canonical(intent) || active.recoveryId !== intent.recoveryId) {
      fail('MAKER_V8_LIFECYCLE_DURABLE_READBACK_FAILED', 'Lifecycle signature intent did not survive exact durable readback.');
    }
    return reread;
  }

  async function loadSignatureIntent(id) {
    const checkedId = recoveryIdValue(id);
    const db = await database;
    const transaction = db.transaction(INTENT_STORE, 'readonly');
    const raw = await requestResult(transaction.objectStore(INTENT_STORE).get(checkedId));
    await transactionDone(transaction);
    return raw === undefined ? null : validateIntent(raw);
  }

  async function releaseSignatureIntent(id, confirmationInput) {
    const checkedId = recoveryIdValue(id);
    const confirmation = clonePlain(confirmationInput, 'unsigned signature confirmation');
    exact(confirmation, [
      'kind', 'recoveryId', 'sessionId', 'checkedAt',
    ], 'unsigned signature confirmation');
    if (!['DEFINITIVE_REJECTION', 'EXTERNAL_NO_ARTIFACT'].includes(confirmation.kind)
      || confirmation.recoveryId !== checkedId
      || !SESSION_ID.test(confirmation.sessionId)
      || !Number.isSafeInteger(confirmation.checkedAt) || confirmation.checkedAt < 0) {
      fail('MAKER_V8_LIFECYCLE_UNSIGNED_CONFIRMATION_INVALID', 'Unsigned lifecycle confirmation is invalid.');
    }
    const db = await database;
    const transaction = db.transaction([STORE, INTENT_STORE, ACTIVE_SCOPE_STORE], 'readwrite');
    const records = transaction.objectStore(STORE);
    const intents = transaction.objectStore(INTENT_STORE);
    const activeScopes = transaction.objectStore(ACTIVE_SCOPE_STORE);
    const intentRaw = await requestResult(intents.get(checkedId));
    const intent = intentRaw === undefined ? null : validateIntent(intentRaw);
    if (!intent || intent.sessionId !== confirmation.sessionId
      || confirmation.checkedAt < intent.createdAt
      || (confirmation.kind === 'EXTERNAL_NO_ARTIFACT'
        && confirmation.checkedAt < intent.leaseExpiresAt)) {
      transaction.abort();
      fail('MAKER_V8_LIFECYCLE_UNSIGNED_CONFIRMATION_INVALID', 'Confirmation does not release this exact signature session.');
    }
    const [recordRaw, activeRaw] = await Promise.all([
      requestResult(records.get(checkedId)),
      requestResult(activeScopes.get(intent.scopeKey)),
    ]);
    const active = activeRaw === undefined ? null : validateActiveScope(activeRaw);
    if (recordRaw !== undefined || !active || active.recoveryId !== checkedId) {
      transaction.abort();
      fail('MAKER_V8_LIFECYCLE_SIGNED_ARTIFACT_CONFLICT', 'A signed artifact or another active lifecycle attempt forbids intent release.');
    }
    await requestResult(intents.delete(checkedId));
    await requestResult(activeScopes.delete(intent.scopeKey));
    await transactionDone(transaction);
    if (await loadSignatureIntent(checkedId) !== null) {
      fail('MAKER_V8_LIFECYCLE_DURABLE_READBACK_FAILED', 'Released lifecycle signature intent remained durable.');
    }
    return freeze({ recoveryId: checkedId, digest: intent.digest, released: true });
  }

  async function compareAndSwap(recoveryId, expectedRevision, nextInput) {
    const next = validateRecord(nextInput);
    if (next.recoveryId !== recoveryId || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
      fail('MAKER_V8_LIFECYCLE_RECOVERY_CAS_INVALID', 'Lifecycle recovery CAS key or revision is invalid.');
    }
    const db = await database;
    const transaction = db.transaction([STORE, ACTIVE_SCOPE_STORE], 'readwrite');
    const store = transaction.objectStore(STORE);
    const activeScopes = transaction.objectStore(ACTIVE_SCOPE_STORE);
    const current = validateRecord(await requestResult(store.get(recoveryId)));
    if (!current || current.revision !== expectedRevision) {
      transaction.abort();
      fail('MAKER_V8_LIFECYCLE_RECOVERY_CAS_CONFLICT', 'Lifecycle recovery revision changed concurrently.');
    }
    assertTransition(current, next);
    const activeRaw = await requestResult(activeScopes.get(current.scopeKey));
    const active = activeRaw === undefined ? null : validateActiveScope(activeRaw);
    if (!active || active.recoveryId !== current.recoveryId) {
      transaction.abort();
      fail('MAKER_V8_LIFECYCLE_RECOVERY_CAS_INVALID', 'Lifecycle recovery lost its exact active-scope binding.');
    }
    await requestResult(store.put(next));
    if ([
      MAKER_V8_LIFECYCLE_RECOVERY_STATUS.FINALIZED_FAILURE,
      MAKER_V8_LIFECYCLE_RECOVERY_STATUS.EXPIRED_NOT_FOUND,
    ].includes(next.status)) {
      await requestResult(activeScopes.delete(current.scopeKey));
    }
    await transactionDone(transaction);
    const reread = await load(recoveryId);
    if (!reread || canonical(reread) !== canonical(next)) {
      fail('MAKER_V8_LIFECYCLE_DURABLE_READBACK_FAILED', 'Lifecycle recovery CAS did not survive exact durable readback.');
    }
    return reread;
  }

  return freeze({
    schemaVersion: MAKER_V8_LIFECYCLE_RECOVERY_SCHEMA,
    databaseName,
    requirePersistentStorage,
    load,
    loadByDigest,
    loadActiveScope,
    reserveSignatureIntent,
    loadSignatureIntent,
    releaseSignatureIntent,
    putSignedArtifact,
    compareAndSwap,
  });
}

async function pinnedMainnet(client) {
  requireMethod(client, 'getChainIdentifier', 'Sui gRPC transport');
  const result = await client.getChainIdentifier();
  const observed = typeof result === 'string' ? result : result?.chainIdentifier;
  if (observed !== MAKER_V8_MAINNET_GENESIS_DIGEST) {
    fail('MAKER_V8_LIFECYCLE_NETWORK_DRIFT', 'Sui gRPC transport no longer identifies the pinned Mainnet genesis.');
  }
}

function runtimeLoader(runtime, client, loadRuntimeAttestation) {
  const load = loadRuntimeAttestation ?? (() => attestMakerV8Runtime(client, runtime, {
    network: MAKER_V8_CHAIN_NETWORK,
  }));
  return async () => {
    const value = await load();
    const observed = assertMakerV8Runtime(value?.runtime ?? value);
    if (!isMakerV8RuntimeAttested(observed) || canonical(observed) !== canonical(runtime)) {
      fail('MAKER_V8_LIFECYCLE_RUNTIME_DRIFT', 'Fresh Mainnet runtime attestation differs from the lifecycle controller runtime.');
    }
    return observed;
  };
}

/** Production wallet projection with fresh authority checks and exact four-field artifacts. */
export function createMakerV8LifecycleWalletAdapterV8({
  client,
  runtime: runtimeInput,
  wallet,
  loadRuntimeAttestation,
  assertTransport = assertMakerV8SuiGrpcTransport,
} = {}) {
  assertTransport(client);
  const runtime = assertMakerV8Runtime(runtimeInput);
  requireMethod(wallet, 'signExactTransaction', 'browser wallet');
  requireMethod(wallet, 'verifyExactSignature', 'browser wallet');
  requireMethod(wallet, 'getCurrentAccount', 'browser wallet');
  const freshRuntime = runtimeLoader(runtime, client, loadRuntimeAttestation);
  return freeze({
    async getCurrentAccount() {
      const account = await wallet.getCurrentAccount();
      return freeze({
        address: address(account?.address, 'wallet account'),
        network: account?.network === MAKER_V8_CHAIN_NETWORK ? account.network
          : fail('MAKER_V8_LIFECYCLE_WALLET_DRIFT', 'Wallet account is not on Sui Mainnet.'),
      });
    },
    async signExactTransaction(input) {
      exact(input, ['bytes', 'digest', 'signer'], 'lifecycle wallet sign input');
      await freshRuntime();
      await pinnedMainnet(client);
      const signed = await wallet.signExactTransaction(input);
      if (!plain(signed)) fail('MAKER_V8_LIFECYCLE_WALLET_ARTIFACT_INVALID', 'Wallet returned no signed artifact.');
      const projected = {
        bytes: signed.bytes,
        digest: signed.digest,
        signature: signed.signature,
        signer: signed.signer,
      };
      exact(projected, ['bytes', 'digest', 'signature', 'signer'], 'lifecycle wallet signed artifact');
      if (projected.bytes !== input.bytes || projected.digest !== input.digest
        || projected.signer !== input.signer) {
        fail('MAKER_V8_LIFECYCLE_WALLET_ARTIFACT_INVALID', 'Wallet changed exact lifecycle bytes, digest, or signer.');
      }
      const verified = await wallet.verifyExactSignature(projected);
      if (verified !== true && !(plain(verified) && verified.verified === true
        && verified.bytes === projected.bytes && verified.digest === projected.digest
        && verified.signer === projected.signer)) {
        fail('MAKER_V8_LIFECYCLE_SIGNATURE_INVALID', 'Wallet signature does not authenticate exact lifecycle TransactionData.');
      }
      await pinnedMainnet(client);
      await freshRuntime();
      return freeze(projected);
    },
    async verifyExactSignature(input) {
      const verified = await wallet.verifyExactSignature(input);
      return verified === true || Boolean(plain(verified) && verified.verified === true
        && verified.bytes === input.bytes && verified.digest === input.digest
        && verified.signer === input.signer);
    },
  });
}

/** Canonical TransactionData build and simulation boundary; it never broadcasts. */
export function createMakerV8LifecycleBoundaryAdapterV8({
  client,
  runtime: runtimeInput,
  execution,
  loadRuntimeAttestation,
  assertTransport = assertMakerV8SuiGrpcTransport,
} = {}) {
  assertTransport(client);
  const runtime = assertMakerV8Runtime(runtimeInput);
  const gates = executionConfig(execution);
  const freshRuntime = runtimeLoader(runtime, client, loadRuntimeAttestation);
  const built = new Map();
  return freeze({
    schemaVersion: MAKER_V8_LIFECYCLE_ADAPTERS_SCHEMA,
    execution: gates,
    async buildExactTransaction(input) {
      exact(input, ['transaction', 'sender', 'descriptor', 'expectedKindBytes'], 'lifecycle build input');
      if (!(input.transaction instanceof Transaction)) {
        fail('MAKER_V8_LIFECYCLE_TRANSACTION_REQUIRED', 'Lifecycle boundary requires a Sui Transaction.');
      }
      const expectedKind = toBase64(base64(input.expectedKindBytes, 'expected TransactionKind'));
      const sender = address(input.sender, 'lifecycle sender');
      const allowedTarget = makerV8LifecycleTargetsV8(runtime)[input.descriptor?.action];
      const descriptorKind = transactionKind(transactionFromDescriptor(input.descriptor));
      if (input.descriptor.sender !== sender || transactionKind(input.transaction) !== expectedKind
        || input.transaction.getData().sender !== sender || descriptorKind !== expectedKind
        || input.descriptor.target !== allowedTarget) {
        fail('MAKER_V8_LIFECYCLE_TRANSACTION_KIND_DRIFT', 'Lifecycle Transaction differs before gas resolution.');
      }
      await freshRuntime();
      await pinnedMainnet(client);
      requireMethod(client?.core, 'getCurrentSystemState', 'Sui gRPC core');
      const system = await client.core.getCurrentSystemState();
      const epoch = decimal(system?.systemState?.epoch, 'current epoch');
      input.transaction.setExpiration({ Epoch: (BigInt(epoch) + 1n).toString() });
      const raw = await input.transaction.build({ client });
      await pinnedMainnet(client);
      if (toBase64(await input.transaction.build({ onlyTransactionKind: true })) !== expectedKind) {
        fail('MAKER_V8_LIFECYCLE_TRANSACTION_KIND_DRIFT', 'Gas resolution changed the lifecycle TransactionKind.');
      }
      const proof = transactionDataProof(toBase64(raw), { sender, kindBytes: expectedKind });
      built.set(proof.base64, freeze({ digest: proof.digest, sender, kindBytes: expectedKind }));
      while (built.size > 32) built.delete(built.keys().next().value);
      return freeze({ bytes: proof.base64, digest: proof.digest });
    },
    async dryRunExactTransaction(input) {
      exact(input, ['bytes', 'digest', 'signer', 'descriptor', 'expectedKindBytes'], 'lifecycle dry-run input');
      const proof = transactionDataProof(input.bytes, {
        sender: input.signer,
        digest: input.digest,
        kindBytes: input.expectedKindBytes,
      });
      const registered = built.get(proof.base64);
      if (!registered || registered.digest !== proof.digest || registered.sender !== proof.sender
        || registered.kindBytes !== proof.kindBytes) {
        fail('MAKER_V8_LIFECYCLE_BUILD_PROOF_REQUIRED', 'Dry-run accepts only freshly built exact lifecycle bytes.');
      }
      await pinnedMainnet(client);
      requireMethod(client?.core, 'simulateTransaction', 'Sui gRPC core');
      const result = await client.core.simulateTransaction({
        transaction: proof.bytes,
        include: { effects: true, bcs: true },
      });
      await pinnedMainnet(client);
      await freshRuntime();
      const simulated = result?.$kind === 'Transaction' ? result.Transaction
        : result?.$kind === 'FailedTransaction' ? result.FailedTransaction : null;
      if (!simulated || simulated.digest !== proof.digest
        || !(simulated.bcs instanceof Uint8Array)
        || toBase64(simulated.bcs) !== proof.base64
        || typeof simulated.effects?.transactionDigest !== 'string') {
        fail('MAKER_V8_LIFECYCLE_SIMULATION_DRIFT', 'Simulation did not echo exact TransactionData and a typed effects digest.');
      }
      suiDigest(simulated.effects.transactionDigest, 'simulation effects digest');
      const success = result.$kind === 'Transaction'
        && simulated.status?.success === true && simulated.effects?.status?.success === true;
      return freeze({
        status: success ? 'SUCCESS' : 'FAILURE',
        bytes: proof.base64,
        digest: proof.digest,
      });
    },
  });
}

function verifiedSignature(value, artifact) {
  return value === true || Boolean(plain(value) && value.verified === true
    && value.bytes === artifact.bytes && value.digest === artifact.digest
    && value.signer === artifact.signer);
}

// Immutable facts from the durable Root snapshot, not a rediscovered activation event.
function activationAnchor(record, runtime) {
  const root = record.input?.root;
  const rawVersion = root?.fields?.version_commitment ?? root?.versionCommitment;
  const economics = root?.fields?.economics?.fields ?? root?.fields?.economics;
  return freeze({
    network: root.network,
    type: makerV8ChainTypes(runtime).activationEvent,
    catalogId: root.catalogId,
    binding: root?.binding,
    makerKey: root?.makerKey,
    makerVersion: BigInt(decimal(root?.makerVersion, 'durable root makerVersion', { positive: true })),
    contentCommitment: commitment(root?.contentCommitment, 'durable root contentCommitment'),
    versionCommitment: commitment(rawVersion, 'durable root versionCommitment'),
    rendererCommitment: commitment(root.rendererCommitment, 'durable root rendererCommitment'),
    protocolConfigRevision: BigInt(decimal(String(economics?.protocol_config_revision), 'durable protocol revision')),
    protocolConfigCommitment: commitment(economics?.protocol_config_commitment, 'durable protocol commitment'),
    productBindingCommitment: commitment(root.productBindingCommitment, 'durable root productBindingCommitment'),
    callCapSetCommitment: commitment(root.callCapSetCommitment, 'durable root callCapSetCommitment'),
  });
}

function exactObjectRef(value, expected, label) {
  const observed = {
    objectId: address(value?.objectId, `${label}.objectId`),
    version: decimal(value?.version, `${label}.version`, { positive: true }),
    digest: suiDigest(value?.digest, `${label}.digest`),
  };
  const expectedRef = expected && {
    objectId: expected.objectId,
    version: String(expected.version),
    digest: expected.digest,
  };
  if (expectedRef && canonical(observed) !== canonical(expectedRef)) {
    fail('MAKER_V8_LIFECYCLE_OBJECT_REF_DRIFT', `${label} differs from the durable object ref.`);
  }
  return freeze(observed);
}

function responseRef(value) {
  return {
    objectId: value.objectId,
    version: String(value.version ?? value.objectRef?.version),
    digest: value.digest ?? value.objectRef?.digest,
  };
}

async function freshLifecycleContext({ client, runtime, record }) {
  requireMethod(client, 'getObject', 'Sui gRPC transport');
  const options = { showType: true, showContent: true, showOwner: true };
  const rootResponse = await client.getObject({ id: record.descriptor.preState.root.objectId, options });
  const root = parseMakerRootV8(rootResponse, runtime, activationAnchor(record, runtime));
  exactObjectRef(responseRef(root), {
    objectId: record.descriptor.preState.root.objectId,
    version: record.descriptor.preState.root.version,
    digest: record.descriptor.preState.root.digest,
  }, 'fresh Root');
  const adminArg = record.descriptor.arguments.find((argument) => argument.name === 'admin');
  const adminResponse = await client.getObject({ id: adminArg.objectId, options });
  const admin = parseMakerAdminCapV8(adminResponse, runtime, record.signer, root);
  exactObjectRef(responseRef(admin), {
    objectId: adminArg.objectId,
    version: adminArg.version,
    digest: adminArg.digest,
  }, 'fresh AdminCap');
  if (record.action === MAKER_V8_LIFECYCLE_ACTIONS.RESUME) {
    const protocolArg = record.descriptor.arguments.find((argument) => argument.name === 'protocolConfig');
    const protocol = parseProtocolConfigV8(
      await client.getObject({ id: protocolArg.objectId, options }), runtime, root,
    );
    if (protocol.enabled !== true) {
      fail('MAKER_V8_LIFECYCLE_CONTEXT_DRIFT', 'Resume replay requires the currently enabled ProtocolConfig.');
    }
  }
  if (record.action === MAKER_V8_LIFECYCLE_ACTIONS.WITHDRAW_MAKER_REVENUE) {
    const treasury = parseMakerTreasuryV8(
      await client.getObject({ id: record.descriptor.preState.treasury.objectId, options }),
      runtime,
      root,
    );
    exactObjectRef(responseRef(treasury), {
      objectId: record.descriptor.preState.treasury.objectId,
      version: record.descriptor.preState.treasury.version,
      digest: record.descriptor.preState.treasury.digest,
    }, 'fresh MakerTreasury');
    if (String(treasury.balanceAtomic) !== record.descriptor.preState.treasury.balanceAtomic
      || String(treasury.totalWithdrawnAtomic) !== record.descriptor.preState.treasury.totalWithdrawnAtomic) {
      fail('MAKER_V8_LIFECYCLE_CONTEXT_DRIFT', 'MakerTreasury changed after the signed withdrawal was prepared.');
    }
  }
}

/** Query-first exact signed recovery; execute acknowledgement is always OUTCOME_UNKNOWN. */
export function createMakerV8LifecycleRecoveryAdapterV8({
  client,
  runtime: runtimeInput,
  rpc,
  wallet,
  persistence,
  execution,
  loadRuntimeAttestation,
  confirmNoSignedArtifact = null,
  now = Date.now,
  assertTransport = assertMakerV8SuiGrpcTransport,
} = {}) {
  assertTransport(client);
  const runtime = assertMakerV8Runtime(runtimeInput);
  const gates = executionConfig(execution);
  for (const method of [
    'load', 'loadByDigest', 'loadActiveScope', 'reserveSignatureIntent', 'loadSignatureIntent',
    'releaseSignatureIntent', 'putSignedArtifact', 'compareAndSwap',
  ]) {
    requireMethod(persistence, method, 'lifecycle persistence');
  }
  requireMethod(rpc, 'queryTransaction', 'browser rpc');
  requireMethod(wallet, 'verifyExactSignature', 'lifecycle wallet');
  requireMethod(wallet, 'getCurrentAccount', 'lifecycle wallet');
  const freshRuntime = runtimeLoader(runtime, client, loadRuntimeAttestation);

  async function attestRecord(record) {
    const rebuilt = buildMakerV8LifecycleActionV8(runtime, record.input);
    if (canonical(rebuilt.descriptor) !== canonical(record.descriptor)
      || rebuilt.action !== record.action) {
      fail('MAKER_V8_LIFECYCLE_RECOVERY_DESCRIPTOR_DRIFT', 'Durable input no longer rebuilds its signed lifecycle descriptor.');
    }
    const proof = transactionDataProof(record.bytes, {
      sender: record.signer,
      digest: record.digest,
      kindBytes: transactionKind(transactionFromDescriptor(rebuilt.descriptor)),
    });
    const verified = await wallet.verifyExactSignature({
      bytes: record.bytes,
      digest: record.digest,
      signature: record.signature,
      signer: record.signer,
    });
    if (!verifiedSignature(verified, record)) {
      fail('MAKER_V8_LIFECYCLE_SIGNATURE_INVALID', 'Durable signature does not authenticate exact lifecycle TransactionData.');
    }
    return proof;
  }

  async function advance(record, status, query, { broadcast = false } = {}) {
    const timestamp = Number(now());
    if (!Number.isSafeInteger(timestamp) || timestamp < record.updatedAt) {
      fail('MAKER_V8_LIFECYCLE_CLOCK_INVALID', 'Lifecycle recovery clock regressed.');
    }
    return persistence.compareAndSwap(record.recoveryId, record.revision, {
      ...record,
      revision: record.revision + 1,
      status,
      updatedAt: timestamp,
      broadcastCount: record.broadcastCount + (broadcast ? 1 : 0),
      query,
    });
  }

  async function persistSignedArtifact(input) {
    exact(input, ARTIFACT_FIELDS, 'persistSignedArtifact input');
    if (input.schemaVersion !== MAKER_V8_LIFECYCLE_CONTROLLER_SCHEMA) {
      fail('MAKER_V8_LIFECYCLE_RECOVERY_SCHEMA_INVALID', 'Signed lifecycle artifact has another controller schema.');
    }
    const artifact = freeze(clonePlain(input, 'signed lifecycle artifact'));
    const rebuilt = buildMakerV8LifecycleActionV8(runtime, artifact.input);
    if (rebuilt.action !== artifact.action
      || canonical(rebuilt.descriptor) !== canonical(artifact.descriptor)) {
      fail('MAKER_V8_LIFECYCLE_RECOVERY_DESCRIPTOR_DRIFT', 'Signed lifecycle input does not rebuild its descriptor.');
    }
    const proof = transactionDataProof(artifact.bytes, {
      sender: artifact.signer,
      digest: artifact.digest,
      kindBytes: transactionKind(transactionFromDescriptor(rebuilt.descriptor)),
    });
    const verified = await wallet.verifyExactSignature(artifact);
    if (!verifiedSignature(verified, artifact)) {
      fail('MAKER_V8_LIFECYCLE_SIGNATURE_INVALID', 'Signed lifecycle artifact failed exact cryptographic verification.');
    }
    const record = await persistence.putSignedArtifact(artifact, proof.expirationEpoch);
    await attestRecord(record);
    return freeze({ recoveryId: record.recoveryId, digest: record.digest });
  }

  async function reserveSignatureIntent(input) {
    exact(input, [
      'schemaVersion', 'action', 'descriptor', 'input', 'bytes', 'digest', 'signer',
    ], 'reserveSignatureIntent input');
    if (input.schemaVersion !== MAKER_V8_LIFECYCLE_CONTROLLER_SCHEMA) {
      fail('MAKER_V8_LIFECYCLE_RECOVERY_SCHEMA_INVALID', 'Lifecycle signature intent has another controller schema.');
    }
    const intent = freeze(clonePlain(input, 'lifecycle signature intent'));
    const rebuilt = buildMakerV8LifecycleActionV8(runtime, intent.input);
    if (rebuilt.action !== intent.action
      || canonical(rebuilt.descriptor) !== canonical(intent.descriptor)) {
      fail('MAKER_V8_LIFECYCLE_RECOVERY_DESCRIPTOR_DRIFT', 'Lifecycle signature intent input does not rebuild its descriptor.');
    }
    const proof = transactionDataProof(intent.bytes, {
      sender: intent.signer,
      digest: intent.digest,
      kindBytes: transactionKind(transactionFromDescriptor(rebuilt.descriptor)),
    });
    const reserved = await persistence.reserveSignatureIntent(intent);
    return freeze({ recoveryId: reserved.recoveryId, digest: proof.digest });
  }

  async function handleSignatureFailure(input) {
    exact(input, [
      'recoveryId', 'digest', 'definitiveRejection', 'signedArtifactCreated',
    ], 'signature failure disposition');
    const intent = await persistence.loadSignatureIntent(input.recoveryId);
    if (!intent || intent.digest !== input.digest) {
      fail('MAKER_V8_LIFECYCLE_SIGNATURE_INTENT_INVALID', 'Signature failure does not bind one durable unsigned intent.');
    }
    const definitive = input.definitiveRejection === true
      && input.signedArtifactCreated === false;
    if (!definitive) {
      return freeze({
        status: 'SIGNATURE_OUTCOME_UNKNOWN',
        recoveryId: intent.recoveryId,
        digest: intent.digest,
      });
    }
    const checkedAt = Number(now());
    if (!Number.isSafeInteger(checkedAt) || checkedAt < intent.createdAt) {
      fail('MAKER_V8_LIFECYCLE_CLOCK_INVALID', 'Lifecycle signature failure clock is invalid.');
    }
    await persistence.releaseSignatureIntent(intent.recoveryId, {
      kind: 'DEFINITIVE_REJECTION',
      recoveryId: intent.recoveryId,
      sessionId: intent.sessionId,
      checkedAt,
    });
    return freeze({
      status: 'DEFINITIVE_REJECTION_RELEASED',
      recoveryId: intent.recoveryId,
      digest: intent.digest,
    });
  }

  async function reclaimSignatureIntent(input) {
    exact(input, ['recoveryId'], 'signature intent reclaim request');
    if (typeof confirmNoSignedArtifact !== 'function') {
      fail('MAKER_V8_LIFECYCLE_UNSIGNED_CONFIRMATION_REQUIRED', 'Unknown signature outcomes require an external no-artifact confirmation after the bounded lease.');
    }
    const intent = await persistence.loadSignatureIntent(input.recoveryId);
    if (!intent) {
      fail('MAKER_V8_LIFECYCLE_SIGNATURE_INTENT_INVALID', 'No durable unsigned signature session exists to reclaim.');
    }
    const checkedAt = Number(now());
    if (!Number.isSafeInteger(checkedAt) || checkedAt < intent.leaseExpiresAt) {
      fail('MAKER_V8_LIFECYCLE_SIGNATURE_LEASE_ACTIVE', 'The bounded lifecycle signature lease has not expired.');
    }
    const request = freeze({
      recoveryId: intent.recoveryId,
      scopeKey: intent.scopeKey,
      sessionId: intent.sessionId,
      leaseExpiresAt: intent.leaseExpiresAt,
      checkedAt,
      digest: intent.digest,
      signer: intent.signer,
    });
    const proof = await confirmNoSignedArtifact(request);
    exact(proof, ['confirmed', 'recoveryId', 'sessionId', 'checkedAt'], 'external no-artifact proof');
    if (proof.confirmed !== true || proof.recoveryId !== intent.recoveryId
      || proof.sessionId !== intent.sessionId || proof.checkedAt !== checkedAt) {
      fail('MAKER_V8_LIFECYCLE_UNSIGNED_CONFIRMATION_INVALID', 'External confirmation does not bind the exact expired signature session.');
    }
    await persistence.releaseSignatureIntent(intent.recoveryId, {
      kind: 'EXTERNAL_NO_ARTIFACT',
      recoveryId: intent.recoveryId,
      sessionId: intent.sessionId,
      checkedAt,
    });
    return freeze({ status: 'UNSIGNED_INTENT_RELEASED', recoveryId: intent.recoveryId, digest: intent.digest });
  }

  async function loadSignedArtifact(input) {
    exact(input, ['recoveryId'], 'loadSignedArtifact input');
    const record = await persistence.load(input.recoveryId);
    if (!record) fail('MAKER_V8_LIFECYCLE_RECOVERY_NOT_FOUND', 'No durable lifecycle signed artifact exists for recoveryId.');
    await attestRecord(record);
    return freeze(Object.fromEntries(LOADED_ARTIFACT_FIELDS.map((field) => [
      field,
      field === 'schemaVersion' ? MAKER_V8_LIFECYCLE_CONTROLLER_SCHEMA : record[field],
    ])));
  }

  async function resolveActiveRecovery(input) {
    exact(input, ['action', 'descriptor', 'signer'], 'active lifecycle recovery request');
    if (!Object.values(MAKER_V8_LIFECYCLE_ACTIONS).includes(input.action)
      || input.descriptor?.action !== input.action
      || input.descriptor?.sender !== input.signer
      || input.descriptor?.target !== makerV8LifecycleTargetsV8(runtime)[input.action]) {
      fail('MAKER_V8_LIFECYCLE_SCOPE_INVALID', 'Active recovery request is not one exact runtime lifecycle action.');
    }
    transactionKind(transactionFromDescriptor(input.descriptor));
    const active = await persistence.loadActiveScope({
      action: input.action,
      rootId: input.descriptor.preState.root.objectId,
      signer: input.signer,
    });
    if (!active) {
      fail('MAKER_V8_LIFECYCLE_ACTIVE_RECOVERY_NOT_FOUND', 'No active durable lifecycle attempt exists for this semantic action.');
    }
    const record = await persistence.load(active.recoveryId);
    if (!record) {
      const intent = await persistence.loadSignatureIntent(active.recoveryId);
      if (intent) {
        fail('MAKER_V8_LIFECYCLE_SIGNATURE_OUTCOME_UNKNOWN', 'The active lifecycle attempt has no durable signed artifact; reclaim requires its lease and external confirmation.', {
          recoveryId: active.recoveryId,
        });
      }
      fail('MAKER_V8_LIFECYCLE_SCOPE_INVALID', 'Active lifecycle scope has neither a signed WAL nor an unsigned intent.');
    }
    if (record.action !== input.action || record.signer !== input.signer
      || canonical(record.descriptor) !== canonical(input.descriptor)) {
      fail('MAKER_V8_LIFECYCLE_SCOPE_INVALID', 'Active lifecycle scope resolved another durable action.');
    }
    await attestRecord(record);
    return freeze({ recoveryId: record.recoveryId, digest: record.digest });
  }

  async function resolveActiveRecoveryByRoot(input) {
    exact(input, ['action', 'rootId', 'signer'], 'stable lifecycle recovery request');
    if (!Object.values(MAKER_V8_LIFECYCLE_ACTIONS).includes(input.action)) {
      fail('MAKER_V8_LIFECYCLE_SCOPE_INVALID', 'Stable recovery action is invalid.');
    }
    const active = await persistence.loadActiveScope(input);
    if (!active) {
      fail('MAKER_V8_LIFECYCLE_ACTIVE_RECOVERY_NOT_FOUND', 'No active durable lifecycle attempt exists for this Root action.');
    }
    const record = await persistence.load(active.recoveryId);
    if (!record) {
      const intent = await persistence.loadSignatureIntent(active.recoveryId);
      if (intent) {
        fail('MAKER_V8_LIFECYCLE_SIGNATURE_OUTCOME_UNKNOWN', 'The stable Root action has no durable signed artifact; use the controller lease-reclaim path.', {
          recoveryId: active.recoveryId,
        });
      }
      fail('MAKER_V8_LIFECYCLE_SCOPE_INVALID', 'Stable Root action has neither a signed WAL nor an unsigned intent.');
    }
    if (record.action !== input.action || record.signer !== input.signer
      || record.descriptor.preState.root.objectId !== input.rootId) {
      fail('MAKER_V8_LIFECYCLE_SCOPE_INVALID', 'Stable Root action resolved another durable record.');
    }
    await attestRecord(record);
    return freeze({ recoveryId: record.recoveryId, digest: record.digest });
  }

  async function reclaimActiveSignatureIntent(input) {
    exact(input, ['action', 'rootId', 'signer'], 'active signature reclaim request');
    if (!Object.values(MAKER_V8_LIFECYCLE_ACTIONS).includes(input.action)) {
      fail('MAKER_V8_LIFECYCLE_SCOPE_INVALID', 'Active signature reclaim action is invalid.');
    }
    const active = await persistence.loadActiveScope(input);
    if (!active) {
      fail('MAKER_V8_LIFECYCLE_ACTIVE_RECOVERY_NOT_FOUND', 'No active unsigned lifecycle attempt exists for this Root action.');
    }
    return reclaimSignatureIntent({ recoveryId: active.recoveryId });
  }

  async function recoverExactTransaction(input) {
    exact(input, ['recoveryId', 'digest', 'signer', 'descriptor'], 'recoverExactTransaction input');
    let record = await persistence.load(input.recoveryId);
    if (!record || record.digest !== input.digest || record.signer !== input.signer
      || canonical(record.descriptor) !== canonical(input.descriptor)) {
      fail('MAKER_V8_LIFECYCLE_RECOVERY_DRIFT', 'Recovery request differs from the exact durable signed artifact.');
    }
    const proof = await attestRecord(record);
    const rawQuery = await rpc.queryTransaction({ digest: record.digest });
    const query = validateQuery(rawQuery, record.digest);
    if (query.status === 'FINALIZED_SUCCESS') {
      if (record.status !== MAKER_V8_LIFECYCLE_RECOVERY_STATUS.FINALIZED_SUCCESS) {
        record = await advance(record, MAKER_V8_LIFECYCLE_RECOVERY_STATUS.FINALIZED_SUCCESS, query);
      }
      return freeze({ status: 'FINALIZED_SUCCESS', recoveryId: record.recoveryId, digest: record.digest });
    }
    if (query.status === 'FINALIZED_FAILURE') {
      if (record.status !== MAKER_V8_LIFECYCLE_RECOVERY_STATUS.FINALIZED_FAILURE) {
        record = await advance(record, MAKER_V8_LIFECYCLE_RECOVERY_STATUS.FINALIZED_FAILURE, query);
      }
      fail('MAKER_V8_LIFECYCLE_FINALIZED_FAILURE', 'Lifecycle transaction finalized with a Move failure.', {
        recoveryId: record.recoveryId,
        digest: record.digest,
        error: query.error,
      });
    }
    if (record.status === MAKER_V8_LIFECYCLE_RECOVERY_STATUS.FINALIZED_FAILURE
      || record.status === MAKER_V8_LIFECYCLE_RECOVERY_STATUS.EXPIRED_NOT_FOUND) {
      fail('MAKER_V8_LIFECYCLE_RECOVERY_TERMINAL', 'Terminal lifecycle recovery cannot be replayed.');
    }
    if (query.status === 'PENDING') {
      record = await advance(record, MAKER_V8_LIFECYCLE_RECOVERY_STATUS.OUTCOME_PENDING, query);
      return freeze({ status: 'OUTCOME_UNKNOWN', recoveryId: record.recoveryId, digest: record.digest });
    }
    if (BigInt(query.absence.watermarkEpoch) > BigInt(proof.expirationEpoch)) {
      await advance(record, MAKER_V8_LIFECYCLE_RECOVERY_STATUS.EXPIRED_NOT_FOUND, query);
      fail('MAKER_V8_LIFECYCLE_TRANSACTION_EXPIRED', 'Authoritative Mainnet NOT_FOUND is beyond the signed epoch expiration.');
    }
    record = await advance(
      record,
      MAKER_V8_LIFECYCLE_RECOVERY_STATUS.OUTCOME_PENDING,
      query,
      { broadcast: true },
    );
    if (!gates.allowBroadcast || !gates.allowWalletSignature) {
      return freeze({ status: 'OUTCOME_UNKNOWN', recoveryId: record.recoveryId, digest: record.digest });
    }
    await freshRuntime();
    await pinnedMainnet(client);
    await freshLifecycleContext({ client, runtime, record });
    await pinnedMainnet(client);
    const account = await wallet.getCurrentAccount();
    if (account?.address !== record.signer || account?.network !== MAKER_V8_CHAIN_NETWORK) {
      fail('MAKER_V8_LIFECYCLE_WALLET_DRIFT', 'Current wallet differs from the durable lifecycle signer.');
    }
    const verified = await wallet.verifyExactSignature({
      bytes: record.bytes,
      digest: record.digest,
      signature: record.signature,
      signer: record.signer,
    });
    if (!verifiedSignature(verified, record)) {
      fail('MAKER_V8_LIFECYCLE_SIGNATURE_INVALID', 'Durable lifecycle signature failed before replay.');
    }
    await pinnedMainnet(client);
    await freshRuntime();
    await pinnedMainnet(client);
    requireMethod(client?.core, 'executeTransaction', 'Sui gRPC core');
    const executed = await client.core.executeTransaction({
      transaction: proof.bytes,
      signatures: [record.signature],
      include: { effects: true, events: true, objectTypes: true },
    });
    await pinnedMainnet(client);
    const transaction = executed?.$kind === 'Transaction' ? executed.Transaction
      : executed?.$kind === 'FailedTransaction' ? executed.FailedTransaction : null;
    if (!transaction || transaction.digest !== record.digest
      || transaction.effects?.transactionDigest !== record.digest) {
      fail('MAKER_V8_LIFECYCLE_BROADCAST_DRIFT', 'Sui gRPC execution returned another transaction digest.');
    }
    return freeze({ status: 'OUTCOME_UNKNOWN', recoveryId: record.recoveryId, digest: record.digest });
  }

  return freeze({
    schemaVersion: MAKER_V8_LIFECYCLE_ADAPTERS_SCHEMA,
    execution: gates,
    reserveSignatureIntent,
    handleSignatureFailure,
    reclaimSignatureIntent,
    reclaimActiveSignatureIntent,
    persistSignedArtifact,
    loadSignedArtifact,
    resolveActiveRecovery,
    resolveActiveRecoveryByRoot,
    recoverExactTransaction,
  });
}

function rawOwner(value, label) {
  const kind = value?.$kind ?? Object.keys(value ?? {})[0];
  const body = value?.[kind];
  if (kind === 'Shared') return freeze({
    kind,
    initialSharedVersion: decimal(body?.initialSharedVersion ?? body?.initial_shared_version, `${label}.initialSharedVersion`, { positive: true }),
  });
  if (kind === 'AddressOwner' || kind === 'ObjectOwner') return freeze({ kind, address: address(body, `${label}.address`) });
  if (kind === 'Immutable') return freeze({ kind });
  fail('MAKER_V8_LIFECYCLE_EFFECT_OWNER_INVALID', `${label} has an unsupported owner.`);
}

function rawEffectsForObject(evidence, objectId) {
  let parsed;
  let canonicalBytes;
  try {
    parsed = bcs.TransactionEffects.parse(evidence.effectsBcs);
    canonicalBytes = bcs.TransactionEffects.serialize(parsed).toBytes();
  } catch {
    fail('MAKER_V8_LIFECYCLE_EFFECTS_INVALID', 'Raw finalized TransactionEffects BCS is invalid.');
  }
  if (parsed?.$kind !== 'V2' || canonicalBytes.length !== evidence.effectsBcs.length
    || canonicalBytes.some((byte, index) => byte !== evidence.effectsBcs[index])) {
    fail('MAKER_V8_LIFECYCLE_EFFECTS_V2_REQUIRED', 'Lifecycle historical certification requires canonical TransactionEffects V2.');
  }
  const effects = parsed.V2;
  const changes = effects.changedObjects.filter(([id]) => id === objectId);
  const unchanged = effects.unchangedConsensusObjects.filter(([id]) => id === objectId);
  if (changes.length + unchanged.length !== 1) {
    fail('MAKER_V8_LIFECYCLE_EFFECT_REF_INVALID', 'Lifecycle object is not unique in raw finalized effects.', { objectId });
  }
  if (changes.length === 1) {
    const change = changes[0][1];
    const input = change.inputState?.$kind === 'Exist' ? freeze({
      objectId,
      version: decimal(change.inputState.Exist[0][0], 'effects input version', { positive: true }),
      digest: suiDigest(change.inputState.Exist[0][1], 'effects input digest'),
      owner: rawOwner(change.inputState.Exist[1], 'effects input owner'),
    }) : null;
    const output = change.outputState?.$kind === 'ObjectWrite' ? freeze({
      objectId,
      version: decimal(effects.lamportVersion, 'effects output version', { positive: true }),
      digest: suiDigest(change.outputState.ObjectWrite[0], 'effects output digest'),
      owner: rawOwner(change.outputState.ObjectWrite[1], 'effects output owner'),
    }) : null;
    return freeze({ kind: 'CHANGED', input, output });
  }
  const item = unchanged[0][1];
  if (item?.$kind !== 'ReadOnlyRoot') {
    fail('MAKER_V8_LIFECYCLE_EFFECT_REF_INVALID', 'Read-only lifecycle object lacks a raw ReadOnlyRoot ref.');
  }
  return freeze({ kind: 'READ_ONLY', ref: freeze({
    objectId,
    version: decimal(item.ReadOnlyRoot[0], 'effects read-only version', { positive: true }),
    digest: suiDigest(item.ReadOnlyRoot[1], 'effects read-only digest'),
  }) });
}

function coreEffectsForObject(response, objectId) {
  const changes = (response.effects?.changedObjects ?? []).filter((change) => change.objectId === objectId);
  const unchanged = (response.effects?.unchangedConsensusObjects ?? []).filter((entry) => entry.objectId === objectId);
  if (changes.length + unchanged.length !== 1) {
    fail('MAKER_V8_LIFECYCLE_CORE_EFFECT_REF_INVALID', 'Lifecycle object is not unique in Core effects.', { objectId });
  }
  if (changes.length === 1) {
    const change = changes[0];
    return freeze({ kind: 'CHANGED', input: change.inputVersion === null ? null : freeze({
      objectId,
      version: decimal(change.inputVersion, 'Core input version', { positive: true }),
      digest: suiDigest(change.inputDigest, 'Core input digest'),
      owner: rawOwner(change.inputOwner, 'Core input owner'),
    }), output: change.outputVersion === null ? null : freeze({
      objectId,
      version: decimal(change.outputVersion, 'Core output version', { positive: true }),
      digest: suiDigest(change.outputDigest, 'Core output digest'),
      owner: rawOwner(change.outputOwner, 'Core output owner'),
    }) });
  }
  return freeze({ kind: 'READ_ONLY', ref: freeze({
    objectId,
    version: decimal(unchanged[0].version, 'Core read-only version', { positive: true }),
    digest: suiDigest(unchanged[0].digest, 'Core read-only digest'),
  }) });
}

function effectRef(response, evidence, objectId, expectedInput, { readOnly = false } = {}) {
  const raw = rawEffectsForObject(evidence, objectId);
  const core = coreEffectsForObject(response, objectId);
  if (canonical(raw) !== canonical(core)) {
    fail('MAKER_V8_LIFECYCLE_EFFECTS_CORE_DRIFT', 'Raw TransactionEffects and Core object refs differ.', { objectId });
  }
  if (readOnly) {
    if (raw.kind !== 'READ_ONLY') fail('MAKER_V8_LIFECYCLE_EFFECT_REF_INVALID', 'Expected a read-only lifecycle object.');
    exactObjectRef(raw.ref, expectedInput, 'read-only effects ref');
    return raw.ref;
  }
  if (raw.kind !== 'CHANGED' || raw.input === null || raw.output === null) {
    fail('MAKER_V8_LIFECYCLE_EFFECT_REF_INVALID', 'Expected one existing lifecycle ObjectWrite.');
  }
  exactObjectRef(raw.input, expectedInput, 'effects input ref');
  return raw.output;
}

function eventScalar(value) {
  if (typeof value !== 'object' || value === null) return value;
  if (Object.hasOwn(value, 'bytes')) return eventScalar(value.bytes);
  if (Object.hasOwn(value, 'id')) return eventScalar(value.id);
  if (Object.hasOwn(value, 'value')) return eventScalar(value.value);
  if (plain(value.fields)) return eventScalar(value.fields);
  return value;
}

function eventField(fields, snake, camel = null) {
  if (Object.hasOwn(fields, snake)) return eventScalar(fields[snake]);
  if (camel && Object.hasOwn(fields, camel)) return eventScalar(fields[camel]);
  fail('MAKER_V8_LIFECYCLE_EVENT_INVALID', `Lifecycle event omitted ${snake}.`);
}

function eventU8(value, label) {
  const numeric = Number(decimal(String(value), label));
  if (!Number.isSafeInteger(numeric) || numeric < 0 || numeric > 255) {
    fail('MAKER_V8_LIFECYCLE_EVENT_BCS_INVALID', `${label} must be one u8.`);
  }
  return numeric;
}

function canonicalLifecycleEventFields(value, action, label) {
  const withdraw = action === MAKER_V8_LIFECYCLE_ACTIONS.WITHDRAW_MAKER_REVENUE;
  const expected = withdraw ? WITHDRAW_EVENT_FIELDS : LIFECYCLE_EVENT_FIELDS;
  exact(value, expected, label);
  if (withdraw) return freeze({
    root_id: address(eventScalar(value.root_id), `${label}.root_id`),
    treasury_id: address(eventScalar(value.treasury_id), `${label}.treasury_id`),
    operator: address(eventScalar(value.operator), `${label}.operator`),
    recipient: address(eventScalar(value.recipient), `${label}.recipient`),
    amount: decimal(String(eventScalar(value.amount)), `${label}.amount`),
  });
  const registries = value.registry_ids?.fields ?? value.registry_ids;
  exact(registries, Object.keys(LIFECYCLE_REGISTRY_BINDINGS), `${label}.registry_ids`);
  const registryIds = Object.fromEntries(Object.keys(LIFECYCLE_REGISTRY_BINDINGS).map(key => [key,
    address(eventScalar(registries[key]), `${label}.registry_ids.${key}`)]));
  return freeze({
    root_id: address(eventScalar(value.root_id), `${label}.root_id`),
    catalog_id: address(eventScalar(value.catalog_id), `${label}.catalog_id`),
    maker_version: decimal(String(eventScalar(value.maker_version)), `${label}.maker_version`),
    content_commitment: commitment(eventScalar(value.content_commitment), `${label}.content_commitment`),
    owner: address(eventScalar(value.owner), `${label}.owner`),
    control_epoch: decimal(String(eventScalar(value.control_epoch)), `${label}.control_epoch`),
    from: eventU8(eventScalar(value.from), `${label}.from`),
    to: eventU8(eventScalar(value.to), `${label}.to`),
    registry_ids: registryIds,
  });
}

function ledgerBoundEventFields(event, action) {
  const withdraw = action === MAKER_V8_LIFECYCLE_ACTIONS.WITHDRAW_MAKER_REVENUE;
  const layout = withdraw ? MAKER_REVENUE_V8_WITHDRAWN_BCS : MAKER_V8_LIFECYCLE_CHANGED_BCS;
  const expectedLength = withdraw ? 136 : 403;
  const bytes = base64(event.bcs, 'finalized lifecycle event BCS', 1024);
  if (bytes.length !== expectedLength) {
    fail('MAKER_V8_LIFECYCLE_EVENT_BCS_INVALID', 'Lifecycle event BCS has the wrong exact length.');
  }
  let decoded;
  let encoded;
  try {
    decoded = layout.parse(bytes);
    encoded = layout.serialize(decoded).toBytes();
  } catch {
    fail('MAKER_V8_LIFECYCLE_EVENT_BCS_INVALID', 'Lifecycle event BCS cannot be canonically decoded.');
  }
  if (encoded.length !== bytes.length
    || encoded.some((byte, index) => byte !== bytes[index])) {
    fail('MAKER_V8_LIFECYCLE_EVENT_BCS_INVALID', 'Lifecycle event BCS is noncanonical or has trailing bytes.');
  }
  const authority = canonicalLifecycleEventFields(decoded, action, 'lifecycle event BCS');
  const display = canonicalLifecycleEventFields(event.parsedJson, action, 'lifecycle event JSON');
  if (canonical(authority) !== canonical(display)) {
    fail('MAKER_V8_LIFECYCLE_EVENT_JSON_BCS_DRIFT', 'Lifecycle event JSON differs from its Ledger-bound BCS fields.');
  }
  return authority;
}

function certifyLifecycleEvent(runtime, record, response) {
  const expected = normalizeStructTag(record.descriptor.expectedEventType);
  const events = response.events.filter((event) => normalizeStructTag(event.type) === expected);
  if (events.length !== 1) {
    fail('MAKER_V8_LIFECYCLE_EVENT_INVALID', 'Finalized transaction must emit exactly one expected lifecycle event.');
  }
  const event = events[0];
  if (!plain(event.parsedJson) || event.sender !== record.signer) {
    fail('MAKER_V8_LIFECYCLE_EVENT_INVALID', 'Lifecycle event JSON or sender is invalid.');
  }
  const fields = ledgerBoundEventFields(event, record.action);
  if (record.action === MAKER_V8_LIFECYCLE_ACTIONS.WITHDRAW_MAKER_REVENUE) {
    const amount = record.descriptor.arguments.find((argument) => argument.kind === 'u64').value;
    const recipient = record.descriptor.arguments.find((argument) => argument.kind === 'address').value;
    if (address(event.packageId, 'withdraw event package') !== runtime.roles.core.callablePackageId
      || event.transactionModule !== 'treasury_v8'
      || fields.root_id !== record.descriptor.preState.root.objectId
      || fields.treasury_id !== record.descriptor.preState.treasury.objectId
      || fields.operator !== record.signer
      || fields.recipient !== recipient
      || fields.amount !== amount) {
      fail('MAKER_V8_LIFECYCLE_EVENT_DRIFT', 'Maker revenue event differs from the exact signed withdrawal.');
    }
  } else {
    const to = {
      PAUSE: MAKER_V8_LIFECYCLE_STATES.PAUSED,
      RESUME: MAKER_V8_LIFECYCLE_STATES.ACTIVE,
      ARCHIVE: MAKER_V8_LIFECYCLE_STATES.ARCHIVED,
    }[record.action];
    const pre = record.descriptor.preState.root;
    if (address(event.packageId, 'lifecycle event package') !== runtime.roles.release.callablePackageId
      || event.transactionModule !== 'release_v8'
      || fields.root_id !== pre.objectId
      || fields.catalog_id !== runtime.catalogId
      || fields.maker_version !== pre.makerVersion
      || fields.content_commitment !== pre.contentCommitment
      || fields.owner !== pre.ownerAddress
      || fields.control_epoch !== pre.controlEpoch
      || fields.from !== pre.lifecycleCode
      || fields.to !== to
      || Object.entries(LIFECYCLE_REGISTRY_BINDINGS).some(([field, binding]) => fields.registry_ids[field]
        !== address(record.input.root.binding[binding], `durable registry binding.${binding}`))) {
      fail('MAKER_V8_LIFECYCLE_EVENT_DRIFT', 'Lifecycle transition event differs from the exact signed pre/post state.');
    }
  }
  return event;
}

async function historicalResponse(client, ref, expectedType, outputDigest, label) {
  requireMethod(client, 'getHistoricalObject', 'Sui gRPC transport');
  const historical = await client.getHistoricalObject({
    objectId: ref.objectId,
    version: BigInt(ref.version),
  });
  const observed = exactObjectRef(historical, ref, `${label} historical ref`);
  if (normalizeStructTag(historical.type) !== normalizeStructTag(expectedType)
    || (outputDigest !== null && historical.previousTransaction !== outputDigest)
    || !plain(historical.parsed)
    || !(historical.contentBcs instanceof Uint8Array)
    || !(historical.objectBcs instanceof Uint8Array)) {
    fail('MAKER_V8_LIFECYCLE_HISTORICAL_OBJECT_DRIFT', `${label} historical object lacks exact type, BCS, JSON, or previous transaction.`);
  }
  return freeze({
    data: freeze({
      ...observed,
      type: historical.type,
      owner: historical.owner,
      previousTransaction: historical.previousTransaction,
      content: freeze({ dataType: 'moveObject', type: historical.type, fields: historical.parsed }),
    }),
  });
}

/** Finalized raw/Core/effects/event proof plus exact historical Root/Treasury parser. */
export function createMakerV8LifecycleReadbackAdapterV8({
  client,
  runtime: runtimeInput,
  persistence,
  assertTransport = assertMakerV8SuiGrpcTransport,
} = {}) {
  assertTransport(client);
  const runtime = assertMakerV8Runtime(runtimeInput);
  requireMethod(persistence, 'loadByDigest', 'lifecycle persistence');
  return freeze({
    schemaVersion: MAKER_V8_LIFECYCLE_ADAPTERS_SCHEMA,
    async readFinalizedTransaction(input) {
      exact(input, ['digest', 'expectedSender', 'expectedEventTypes'], 'lifecycle finality request');
      const record = await persistence.loadByDigest(input.digest);
      if (!record || record.signer !== input.expectedSender
        || canonical(input.expectedEventTypes) !== canonical([record.descriptor.expectedEventType])) {
        fail('MAKER_V8_LIFECYCLE_FINALITY_DRIFT', 'Finality request differs from the exact durable lifecycle WAL.');
      }
      await pinnedMainnet(client);
      const transaction = transactionFromDescriptor(record.descriptor);
      const [response, evidence] = await Promise.all([
        assertFinalizedMakerV8CompilerTransactionV8(client, record.digest, transaction),
        client.getFinalizedTransactionEvidence({ digest: record.digest }),
      ]);
      await pinnedMainnet(client);
      if (evidence?.digest !== record.digest
        || evidence.transactionBcsBase64 !== record.bytes
        || !Array.isArray(evidence.signatures)
        || !evidence.signatures.includes(record.signature)
        || evidence.effectsStatus?.success !== true) {
        fail('MAKER_V8_LIFECYCLE_FINALITY_DRIFT', 'Ledger finality does not bind exact durable bytes, signature, and successful effects.');
      }
      const event = certifyLifecycleEvent(runtime, record, response);
      const finalized = freeze({
        digest: record.digest,
        sender: record.signer,
        events: freeze([{ eventType: event.type, sender: event.sender }]),
      });
      FINALIZED_CONTEXTS.set(finalized, freeze({ record, response, evidence }));
      return finalized;
    },
    async readRoot(input) {
      exact(input, ['rootId', 'built', 'finalized'], 'lifecycle Root readback request');
      const context = FINALIZED_CONTEXTS.get(input.finalized);
      if (!context || input.rootId !== context.record.descriptor.preState.root.objectId
        || canonical(input.built?.descriptor) !== canonical(context.record.descriptor)) {
        fail('MAKER_V8_LIFECYCLE_FINALITY_PROOF_REQUIRED', 'Root readback requires this adapter finality proof.');
      }
      const pre = context.record.descriptor.preState.root;
      const expected = { objectId: pre.objectId, version: pre.version, digest: pre.digest };
      const readOnly = context.record.action === MAKER_V8_LIFECYCLE_ACTIONS.WITHDRAW_MAKER_REVENUE;
      const ref = effectRef(context.response, context.evidence, pre.objectId, expected, { readOnly });
      await pinnedMainnet(client);
      const response = await historicalResponse(
        client,
        ref,
        makerV8ChainTypes(runtime).root,
        readOnly ? null : context.record.digest,
        'MakerRootV8',
      );
      await pinnedMainnet(client);
      return parseMakerRootV8(response, runtime, activationAnchor(context.record, runtime));
    },
    async readMakerTreasury(input) {
      exact(input, ['treasuryId', 'root', 'built', 'finalized'], 'lifecycle MakerTreasury readback request');
      const context = FINALIZED_CONTEXTS.get(input.finalized);
      const pre = context?.record?.descriptor?.preState?.treasury;
      if (!context || !pre || input.treasuryId !== pre.objectId
        || context.record.action !== MAKER_V8_LIFECYCLE_ACTIONS.WITHDRAW_MAKER_REVENUE
        || canonical(input.built?.descriptor) !== canonical(context.record.descriptor)) {
        fail('MAKER_V8_LIFECYCLE_FINALITY_PROOF_REQUIRED', 'MakerTreasury readback requires this adapter withdrawal finality proof.');
      }
      const ref = effectRef(context.response, context.evidence, pre.objectId, {
        objectId: pre.objectId,
        version: pre.version,
        digest: pre.digest,
      });
      await pinnedMainnet(client);
      const response = await historicalResponse(
        client,
        ref,
        makerV8ChainTypes(runtime).makerTreasury,
        context.record.digest,
        'MakerTreasuryV8',
      );
      await pinnedMainnet(client);
      return parseMakerTreasuryV8(response, runtime, input.root);
    },
  });
}

/**
 * Async production composition. `controller` can be injected directly into the
 * product bridge; `controller.recoverById(id)` is the cold-reload entrypoint.
 */
export async function createProductionMakerV8LifecycleAdaptersV8({
  client = createProductionMakerV8SuiGrpcTransport(),
  runtime: runtimeInput,
  execution,
  browserAdapters = null,
  persistence: persistenceInput = null,
  indexedDB = globalThis.indexedDB,
  persistenceOptions,
  walletRegistry,
  walletId = null,
  walletAdapter = null,
  dataSource = null,
  loadRuntimeAttestation,
  confirmNoSignedArtifact = null,
  assertTransport = assertMakerV8SuiGrpcTransport,
  now,
} = {}) {
  assertTransport(client);
  if (browserAdapters !== null || dataSource !== null) {
    fail('MAKER_V8_LIFECYCLE_BROWSER_PROVENANCE_INVALID', 'Production lifecycle composition creates its own same-client gRPC browser RPC and wallet adapters.');
  }
  const suppliedRuntime = assertMakerV8Runtime(runtimeInput);
  const attestation = isMakerV8RuntimeAttested(suppliedRuntime)
    ? { runtime: suppliedRuntime }
    : await (loadRuntimeAttestation ?? attestMakerV8Runtime)(
      client,
      suppliedRuntime,
      { network: MAKER_V8_CHAIN_NETWORK },
    );
  const runtime = assertMakerV8Runtime(attestation?.runtime ?? attestation);
  if (!isMakerV8RuntimeAttested(runtime)) {
    fail('MAKER_V8_LIFECYCLE_RUNTIME_ATTESTATION_REQUIRED', 'Production lifecycle factory requires official Mainnet-attested runtime authority.');
  }
  const gates = executionConfig(execution);
  const persistence = persistenceInput ?? createMakerV8LifecyclePersistenceV8(
    indexedDB,
    persistenceOptions,
  );
  const browser = createProductionMakerV8BrowserAdapters({
    runtime,
    execution: gates,
    client,
    walletRegistry,
    walletId,
    wallet: walletAdapter,
  });
  requireMethod(browser?.rpc, 'getSuiClient', 'production browser rpc');
  requireMethod(browser?.rpc, 'getChainIdentifier', 'production browser rpc');
  const [rpcClient, rpcChain] = await Promise.all([
    browser.rpc.getSuiClient(),
    browser.rpc.getChainIdentifier(),
  ]);
  if (rpcClient !== client || rpcChain !== MAKER_V8_MAINNET_CHAIN_IDENTIFIER) {
    fail('MAKER_V8_LIFECYCLE_BROWSER_PROVENANCE_INVALID', 'Lifecycle query RPC is not the official same-client Mainnet gRPC adapter.');
  }
  const loadFresh = () => (loadRuntimeAttestation
    ? loadRuntimeAttestation(client, runtime, { network: MAKER_V8_CHAIN_NETWORK })
    : attestMakerV8Runtime(client, runtime, { network: MAKER_V8_CHAIN_NETWORK }));
  const wallet = createMakerV8LifecycleWalletAdapterV8({
    client,
    runtime,
    wallet: browser.wallet,
    loadRuntimeAttestation: loadFresh,
    assertTransport,
  });
  const boundary = createMakerV8LifecycleBoundaryAdapterV8({
    client,
    runtime,
    execution: gates,
    loadRuntimeAttestation: loadFresh,
    assertTransport,
  });
  const recovery = createMakerV8LifecycleRecoveryAdapterV8({
    client,
    runtime,
    rpc: browser.rpc,
    wallet,
    persistence,
    execution: gates,
    loadRuntimeAttestation: loadFresh,
    confirmNoSignedArtifact,
    ...(now === undefined ? {} : { now }),
    assertTransport,
  });
  const readback = createMakerV8LifecycleReadbackAdapterV8({
    client,
    runtime,
    persistence,
    assertTransport,
  });
  const controllerExecution = freeze({
    allowWalletSignature: gates.allowWalletSignature,
    allowBroadcast: gates.allowBroadcast,
  });
  const controller = createMakerV8LifecycleControllerV8({
    runtime,
    boundary,
    wallet,
    recovery,
    readback,
    execution: controllerExecution,
  });
  return freeze({
    schemaVersion: MAKER_V8_LIFECYCLE_ADAPTERS_SCHEMA,
    client,
    runtime,
    persistence,
    boundary,
    wallet,
    recovery,
    readback,
    rpc: browser.rpc,
    execution: gates,
    controller,
  });
}
