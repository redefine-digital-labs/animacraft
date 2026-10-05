import { WalrusClient, MAINNET_WALRUS_PACKAGE_CONFIG, blobIdFromInt } from '@mysten/walrus';
import { bcs } from '@mysten/sui/bcs';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { TransactionDataBuilder } from '@mysten/sui/transactions';
import { fromBase64, toBase64, normalizeStructTag } from '@mysten/sui/utils';
import { sha256 } from '@noble/hashes/sha2.js';
import { makerV8PublicationExpiration } from './maker-v8-publication-expiration.js';

import {
  MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
} from './maker-v8-chain.js';
import {
  MAKER_V8_SUI_GRPC_MAINNET_ENDPOINT,
  MAKER_V8_SUI_MAINNET_GENESIS_DIGEST,
} from './maker-v8-sui-grpc.js';

export const MAKER_V8_WALRUS_SCHEMA = 'animacraft.maker-v8-walrus-upload.v1';
export const MAKER_V8_WALRUS_STORE_SCHEMA = 'animacraft.maker-v8-walrus-store.v1';
export const MAKER_V8_WALRUS_MAINNET_RELAY = 'https://upload-relay.mainnet.walrus.space';
// Per-blob ceiling, not a fixed fee or the total publication budget. The SDK
// quotes the relay dynamically; gas and WAL storage are separate costs.
export const MAKER_V8_WALRUS_MAX_RELAY_TIP_MIST = 10_000_000;
export const MAKER_V8_WALRUS_MAINNET_AGGREGATOR =
  'https://aggregator.walrus-mainnet.walrus.space';

const DB_NAME = 'animacraft-maker-v8-walrus-v1';
const DB_VERSION = 2;
const STORE = 'uploads';
const BINDING_STORE = 'publication-bindings';
const ID = /^[a-z0-9][a-z0-9_-]{0,127}$/;
const SUI_ID = /^0x[0-9a-f]{64}$/;
const HASH = /^[0-9a-f]{64}$/;
const BLOB_ID = /^[A-Za-z0-9_-]{20,512}$/;
const UINT = /^(?:0|[1-9][0-9]*)$/;
const encoder = new TextEncoder();

export class MakerV8WalrusError extends Error {
  constructor(code, message, layer = 'WALRUS', details = {}) {
    super(message);
    this.name = 'MakerV8WalrusError';
    this.code = code;
    this.layer = layer;
    this.details = Object.freeze({ ...details });
  }
}

function fail(code, message, layer = 'WALRUS', details = {}) {
  throw new MakerV8WalrusError(code, message, layer, details);
}

function plain(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  // Typed arrays are transient SDK inputs. JavaScript engines reject freezing
  // non-empty ArrayBuffer views, and they are never part of a persisted JSON
  // record in this module.
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
}

function clone(value) {
  return structuredClone(value);
}

function exact(value, fields, label) {
  if (!plain(value)) fail('MAKER_V8_WALRUS_SHAPE_INVALID', `${label} must be a plain record.`, 'VALIDATION');
  const expected = new Set(fields);
  const missing = fields.filter((field) => !Object.hasOwn(value, field));
  const unknown = Object.keys(value).filter((field) => !expected.has(field));
  if (missing.length || unknown.length) {
    fail('MAKER_V8_WALRUS_SHAPE_INVALID', `${label} has an unexpected shape.`, 'VALIDATION', {
      missing, unknown,
    });
  }
  return value;
}

function id(value, label = 'uploadId') {
  if (typeof value !== 'string' || !ID.test(value)) {
    fail('MAKER_V8_WALRUS_ID_INVALID', `${label} must be a safe fresh-v8 identifier.`, 'VALIDATION');
  }
  return value;
}

function suiId(value, label) {
  const normalized = typeof value === 'string' ? value.toLowerCase() : '';
  if (!SUI_ID.test(normalized) || /^0x0+$/.test(normalized)) {
    fail('MAKER_V8_WALRUS_SUI_ID_INVALID', `${label} must be an exact non-zero Sui ID.`, 'VALIDATION');
  }
  return normalized;
}

function integer(value, label, { positive = false } = {}) {
  const text = typeof value === 'bigint' ? value.toString() : String(value ?? '');
  if (!UINT.test(text) || (positive && text === '0')) {
    fail('MAKER_V8_WALRUS_INTEGER_INVALID', `${label} must be a canonical integer.`, 'VALIDATION');
  }
  return text;
}

function canonicalBase64(value, label, { empty = false } = {}) {
  try {
    if (typeof value !== 'string') throw new Error('string');
    const bytes = fromBase64(value);
    if ((!empty && bytes.length === 0) || toBase64(bytes) !== value) throw new Error('canonical');
    return bytes;
  } catch {
    fail('MAKER_V8_WALRUS_BASE64_INVALID', `${label} must be canonical Base64.`, 'VALIDATION');
  }
}

function hashBytes(bytes) {
  return [...sha256(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function canonical(value) {
  const walk = (entry) => {
    if (entry === null || typeof entry === 'string' || typeof entry === 'boolean') return entry;
    if (typeof entry === 'number' && Number.isFinite(entry)) return Object.is(entry, -0) ? 0 : entry;
    if (Array.isArray(entry)) return entry.map(walk);
    if (!plain(entry)) fail('MAKER_V8_WALRUS_JSON_INVALID', 'Walrus evidence must be plain JSON.', 'VALIDATION');
    return Object.fromEntries(Object.keys(entry).sort().map((key) => [key, walk(entry[key])]));
  };
  return JSON.stringify(walk(value));
}

function digestFor(value) {
  return hashBytes(encoder.encode(canonical(value)));
}

function requireMethod(value, method, label) {
  if (typeof value?.[method] !== 'function') {
    fail('MAKER_V8_WALRUS_DEPENDENCY_INVALID', `${label}.${method} is required.`, 'CONFIGURATION');
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

async function openDatabase(indexedDB) {
  if (!indexedDB || typeof indexedDB.open !== 'function') {
    fail('MAKER_V8_WALRUS_INDEXEDDB_REQUIRED', 'IndexedDB is required for durable Walrus uploads.', 'PERSISTENCE');
  }
  const request = indexedDB.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE, { keyPath: 'uploadId' });
    if (!database.objectStoreNames.contains(BINDING_STORE)) database.createObjectStore(BINDING_STORE, { keyPath: 'key' });
  };
  return new Promise((resolve, reject) => {
    let blocked = false;
    request.onblocked = () => {
      blocked = true;
      reject(new MakerV8WalrusError('MAKER_V8_WALRUS_DATABASE_BLOCKED',
        'Close other Animacraft tabs using the older storage connection, then retry. Saved uploads are preserved.', 'PERSISTENCE'));
    };
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      if (blocked) database.close();
      else resolve(database);
    };
  });
}

function recordView(record) {
  return freeze({
    schemaVersion: record.schemaVersion,
    uploadId: record.uploadId,
    revision: record.revision,
    status: record.status,
    stage: record.status === 'COMPLETE' ? 'COMPLETE' : record.status === 'ENCODED' ? 'REGISTER'
      : record.status === 'UPLOADED' ? 'CERTIFY'
        : record.transaction?.stage ?? (record.status === 'REGISTER_FINALIZED' ? 'UPLOAD' : record.status),
    epochs: record.epochs,
    deletable: record.deletable,
    blobId: record.encoded.blobId,
    blobObjectId: record.upload?.blobObjectId ?? null,
    transactionDigest: record.transaction?.digest ?? null,
    mediaType: record.mediaType,
    byteLength: record.byteLength,
    byteSha256: record.byteSha256,
    error: record.error,
  });
}

function contentView(record) {
  return freeze({
    schemaVersion: MAKER_V8_WALRUS_SCHEMA,
    uploadId: record.uploadId,
    owner: record.owner,
    mediaType: record.mediaType,
    bytesBase64: record.bytesBase64,
    byteLength: record.byteLength,
    byteSha256: record.byteSha256,
  });
}

function assertRecord(value) {
  exact(value, [
    'schemaVersion', 'uploadId', 'revision', 'createdAt', 'updatedAt', 'status',
    'owner', 'mediaType', 'bytesBase64', 'byteLength', 'byteSha256', 'epochs',
    'deletable', 'encoded', 'transaction', 'upload', 'readback', 'error',
  ], 'Walrus upload record');
  if (value.schemaVersion !== MAKER_V8_WALRUS_SCHEMA || !Number.isSafeInteger(value.revision)
    || value.revision < 1 || !Number.isSafeInteger(value.createdAt) || value.createdAt < 0
    || !Number.isSafeInteger(value.updatedAt) || value.updatedAt < value.createdAt) {
    fail('MAKER_V8_WALRUS_RECORD_INVALID', 'Walrus upload record revision or time is invalid.', 'PERSISTENCE');
  }
  id(value.uploadId);
  suiId(value.owner, 'owner');
  const bytes = canonicalBase64(value.bytesBase64, 'upload bytes', { empty: true });
  if (value.byteLength !== bytes.length || value.byteSha256 !== hashBytes(bytes)
    || !HASH.test(value.byteSha256) || typeof value.mediaType !== 'string'
    || value.mediaType.length === 0 || value.mediaType.length > 256
    || !Number.isSafeInteger(value.epochs) || value.epochs < 1 || value.epochs > 53
    || value.deletable !== false) {
    fail('MAKER_V8_WALRUS_RECORD_INVALID', 'Walrus byte, media, retention, or permanence evidence drifted.', 'PERSISTENCE');
  }
  exact(value.encoded, ['blobId', 'rootHash', 'nonce', 'unencodedSize'], 'encoded Walrus proof');
  if (!BLOB_ID.test(value.encoded.blobId)
    || value.encoded.unencodedSize !== bytes.length
    || canonicalBase64(value.encoded.rootHash, 'Walrus root hash').length !== 32
    || canonicalBase64(value.encoded.nonce, 'Walrus nonce').length !== 32) {
    fail('MAKER_V8_WALRUS_RECORD_INVALID', 'Encoded Walrus proof is invalid.', 'PERSISTENCE');
  }
  canonical(value);
  return value;
}

/** Dedicated fresh-v8 IndexedDB store. No pre-v8 database is opened or upgraded. */
export function createMakerV8WalrusPersistenceV8(indexedDB = globalThis.indexedDB, {
  storageManager = globalThis.navigator?.storage,
} = {}) {
  let databasePromise = null;
  const database = () => (databasePromise ??= openDatabase(indexedDB).then(db => {
    db.onversionchange = () => { db.close(); databasePromise = null; };
    return db;
  }).catch(error => {
    databasePromise = null;
    throw error;
  }));
  const persistent = async () => {
    if (typeof storageManager?.persisted !== 'function' || typeof storageManager?.persist !== 'function') {
      fail('MAKER_V8_WALRUS_PERSISTENCE_REQUIRED', 'Persistent browser storage is required before a wallet prompt.', 'PERSISTENCE');
    }
    if (await storageManager.persisted()) return true;
    if (await storageManager.persist()) return true;
    fail('MAKER_V8_WALRUS_PERSISTENCE_REQUIRED', 'Persistent browser storage permission was not granted.', 'PERSISTENCE');
  };
  const read = async (uploadId) => {
    const db = await database();
    const tx = db.transaction([STORE], 'readonly');
    const result = await requestResult(tx.objectStore(STORE).get(id(uploadId)));
    await transactionDone(tx);
    return result == null ? null : freeze(assertRecord(result));
  };
  const write = async (mode, current, next) => {
    assertRecord(next);
    const db = await database();
    const tx = db.transaction([STORE], 'readwrite', { durability: 'strict' });
    const store = tx.objectStore(STORE);
    const existing = await requestResult(store.get(next.uploadId));
    if (mode === 'create') {
      if (existing) fail('MAKER_V8_WALRUS_UPLOAD_EXISTS', 'Walrus upload ID already exists.', 'PERSISTENCE');
      store.add(clone(next));
    } else {
      if (!existing || existing.revision !== current.revision || canonical(existing) !== canonical(current)) {
        fail('MAKER_V8_WALRUS_CAS_MISMATCH', 'Walrus upload changed in another tab.', 'PERSISTENCE');
      }
      store.put(clone(next));
    }
    await transactionDone(tx);
    const reread = await read(next.uploadId);
    if (!reread || canonical(reread) !== canonical(next)) {
      fail('MAKER_V8_WALRUS_DURABLE_REREAD_FAILED', 'Walrus WAL write was not observed by a cold reread.', 'PERSISTENCE');
    }
    return reread;
  };
  return freeze({
    schemaVersion: MAKER_V8_WALRUS_STORE_SCHEMA,
    capabilities: freeze({ durable: true, atomicCas: true, legacy: false }),
    requirePersistentStorage: persistent,
    create: (record) => write('create', null, record),
    load: read,
    compareAndSwap: (current, next) => write('cas', current, next),
    async bindAssetLayout(key, { schemaVersion, owner, sourceSha256, source }) {
      await persistent();
      const expectedHash = hashBytes(encoder.encode(JSON.stringify({ schemaVersion, owner, source })));
      if (schemaVersion !== 'animacraft.maker-v8-asset-layout.v1' || expectedHash !== sourceSha256
        || key !== `${schemaVersion}:${sourceSha256}` || !Array.isArray(source) || source.length < 2
        || new Set(source.map(asset => asset.assetId)).size !== source.length
        || new Set(source.map(asset => asset.uploadId)).size !== source.length) {
        fail('MAKER_V8_WALRUS_LAYOUT_INVALID', 'Asset layout identity is invalid.', 'PERSISTENCE');
      }
      suiId(owner, 'layout owner');
      source.forEach(asset => id(asset.uploadId));
      const db = await database();
      // Select membership and invalidate already-held unsigned reviews atomically.
      // A crash commits both or neither; retries never invalidate a later review.
      const tx = db.transaction([STORE, BINDING_STORE], 'readwrite', { durability: 'strict' });
      const done = transactionDone(tx);
      const uploads = tx.objectStore(STORE), bindings = tx.objectStore(BINDING_STORE);
      try {
        const current = await requestResult(bindings.get(key));
        if (current) { await done; return freeze(current); }
        const records = await Promise.all(source.map(asset => requestResult(uploads.get(asset.uploadId))));
        records.forEach((record, i) => {
          if (!record) return;
          assertRecord(record);
          if (record.owner !== owner || record.byteSha256 !== source[i].sha256 || record.mediaType !== source[i].mediaType) {
            fail('MAKER_V8_WALRUS_LAYOUT_INVALID', 'Asset layout differs from durable upload bytes.', 'PERSISTENCE');
          }
        });
        const eligible = source.filter((_, i) => !records[i] || records[i].status === 'ENCODED').map(asset => asset.assetId);
        const members = eligible.length > 1 ? eligible : [];
        const layoutSha256 = hashBytes(encoder.encode(JSON.stringify({ sourceSha256, members })));
        const binding = { schemaVersion, owner, sourceSha256, members, layoutSha256, key, revision: 1 };
        records.forEach((record, i) => {
          if (record && members.includes(source[i].assetId)) {
            uploads.put(clone(nextRecord(record, record.updatedAt, {})));
          }
        });
        bindings.add(binding);
        await done;
        return freeze(binding);
      } catch (error) {
        try { tx.abort(); } catch { /* The transaction may already have aborted. */ }
        await done.catch(() => {});
        throw error;
      }
    },
    async loadPublicationBinding(key) {
      const db = await database();
      const tx = db.transaction(BINDING_STORE, 'readonly');
      const result = await requestResult(tx.objectStore(BINDING_STORE).get(key));
      await transactionDone(tx);
      return result ?? null;
    },
    async savePublicationBinding(key, expectedRevision, value) {
      await persistent();
      const db = await database();
      const tx = db.transaction(BINDING_STORE, 'readwrite', { durability: 'strict' });
      const store = tx.objectStore(BINDING_STORE);
      const current = await requestResult(store.get(key));
      if ((current?.revision ?? null) !== expectedRevision) {
        fail('MAKER_V8_WALRUS_CAS_MISMATCH', 'Publication binding changed in another tab.', 'PERSISTENCE');
      }
      const next = { ...clone(value), key, revision: (expectedRevision ?? 0) + 1 };
      store.put(next);
      await transactionDone(tx);
      return freeze(next);
    },
    async close() { (await databasePromise)?.close(); databasePromise = null; },
  });
}

function transactionProof(bytesBase64, expected) {
  const bytes = canonicalBase64(bytesBase64, 'Walrus TransactionData');
  let parsed;
  try {
    parsed = bcs.TransactionData.parse(bytes);
    if (parsed?.$kind !== 'V1'
      || toBase64(bcs.TransactionData.serialize(parsed).toBytes()) !== bytesBase64) throw new Error('canonical');
  } catch {
    fail('MAKER_V8_WALRUS_TRANSACTION_INVALID', 'Walrus TransactionData is not canonical V1 BCS.', 'TRANSACTION');
  }
  const digest = TransactionDataBuilder.getDigestFromBytes(bytes);
  if (parsed.V1.sender !== expected.owner || parsed.V1.gasData?.owner !== expected.owner
    || expected.digest && digest !== expected.digest) {
    fail('MAKER_V8_WALRUS_TRANSACTION_DRIFT', 'Walrus TransactionData sender, gas owner, or digest drifted.', 'TRANSACTION');
  }
  const kindBytes = bcs.TransactionKind.serialize(parsed.V1.kind).toBytes();
  const kindSha256 = hashBytes(kindBytes);
  if (expected.kindSha256 && kindSha256 !== expected.kindSha256) {
    fail('MAKER_V8_WALRUS_TRANSACTION_DRIFT', 'Walrus TransactionKind differs from its durable compiler proof.', 'TRANSACTION');
  }
  return freeze({ bytes, digest, kindSha256 });
}

const FRAMEWORK = `0x${'0'.repeat(63)}2`;
const SUI_TYPE = `${FRAMEWORK}::sui::SUI`;
const unknownQuote = quotedAt => ({ quotedAt, walrusStorageCostFrost: null,
  walrusWriteCostFrost: null, walrusTotalCostFrost: null, relayTipMist: null, verified: false });

/** Quote the payments in these exact TransactionData bytes, never coin balances
 * or withdrawal reservation maxima. Unknown SDK shapes deliberately stay unknown.
 * Authority is read by the same SDK/client that built the transaction. */
export function makerV8WalrusTransactionQuote({ bytesBase64, stage, authority, owner,
  epochs, byteLength, blobObjectId = null, quotedAt }) {
  const unknown = freeze(unknownQuote(quotedAt));
  try {
    const parsed = bcs.TransactionData.parse(fromBase64(bytesBase64));
    if (toBase64(bcs.TransactionData.serialize(parsed).toBytes()) !== bytesBase64) return unknown;
    const data = parsed.V1;
    if (data.sender !== owner || data.gasData.owner !== owner
      || authority?.system?.id !== MAINNET_WALRUS_PACKAGE_CONFIG.systemObjectId
      || !SUI_ID.test(authority.system.package_id)) return unknown;
    const { inputs, commands } = data.kind.ProgrammableTransaction;
    const pkg = authority.system.package_id;
    const require = condition => { if (!condition) throw new Error('unproven payment'); };
    const pure = (arg, codec) => {
      const bytes = fromBase64(inputs[arg?.Input]?.Pure?.bytes ?? '');
      const value = codec.parse(bytes);
      require(toBase64(codec.serialize(value).toBytes()) === toBase64(bytes));
      return value;
    };
    const objectId = arg => {
      const object = inputs[arg?.Input]?.Object;
      return object?.SharedObject?.objectId ?? object?.ImmOrOwnedObject?.objectId ?? null;
    };
    const ref = arg => arg?.NestedResult ?? (Number.isInteger(arg?.Result) ? [arg.Result, 0] : null);
    const same = (a, b) => {
      const ar = ref(a), br = ref(b);
      return ar && br ? ar[0] === br[0] && ar[1] === br[1] : canonical(a) === canonical(b);
    };
    const type = call => call?.typeArguments?.length === 1
      ? normalizeStructTag(call.typeArguments[0]) : null;
    const isFramework = (call, fn) => call?.package === FRAMEWORK && call.module === 'coin' && call.function === fn;
    const args = command => command.MoveCall?.arguments ?? command.TransferObjects?.objects
      ?? (command.SplitCoins ? [command.SplitCoins.coin] : command.MergeCoins
        ? [command.MergeCoins.destination, ...command.MergeCoins.sources] : []);
    const origin = arg => { const r = ref(arg); return r ? commands[r[0]] : null; };
    const coinType = arg => {
      if (arg?.GasCoin) return SUI_TYPE;
      const call = origin(arg)?.MoveCall;
      return isFramework(call, 'redeem_funds') || isFramework(call, 'zero') ? type(call) : null;
    };
    const amount = (arg, at, expectedType, destroyed) => {
      const r = ref(arg); require(r && r[0] < at);
      const source = commands[r[0]];
      let value;
      if (source.SplitCoins) {
        require(r[1] < source.SplitCoins.amounts.length);
        value = BigInt(pure(source.SplitCoins.amounts[r[1]], bcs.u64()));
        if (expectedType === SUI_TYPE) require(coinType(source.SplitCoins.coin) === SUI_TYPE);
      } else {
        require(isFramework(source.MoveCall, 'zero') && type(source.MoveCall) === expectedType);
        value = 0n;
      }
      const uses = commands.flatMap((command, index) => args(command).filter(a => same(a, arg)).map(() => index));
      if (destroyed) {
        const drops = uses.filter(index => index > at && isFramework(commands[index].MoveCall, 'destroy_zero')
          && type(commands[index].MoveCall) === expectedType);
        require(uses.length === 2 && uses.includes(at) && drops.length === 1);
      } else require(uses.length === 1 && uses[0] === at);
      return value;
    };
    const systemCalls = commands.flatMap((command, index) => command.MoveCall?.package === pkg
      && command.MoveCall.module === 'system' ? [{ call: command.MoveCall, index }] : []);
    for (const { call } of systemCalls) require(objectId(call.arguments[0]) === authority.system.id);
    const recognized = new Set(['reserve_space', 'register_blob', 'certify_blob']);
    for (const command of commands) {
      if (command.MoveCall) {
        const call = command.MoveCall;
        require((call.package === pkg && ((call.module === 'system' && recognized.has(call.function))
          || (call.module === 'metadata' && call.function === 'new')
          || (call.module === 'blob' && ['add_metadata', 'insert_or_update_metadata_pair'].includes(call.function))))
          || (call.package === FRAMEWORK && call.module === 'coin'
            && ['redeem_funds', 'zero', 'destroy_zero', 'send_funds'].includes(call.function)));
        if (isFramework(call, 'send_funds')) require(pure(call.arguments[1], bcs.Address) === owner);
      } else require(Boolean(command.SplitCoins || command.MergeCoins || command.TransferObjects));
    }
    if (stage === 'CERTIFY') {
      require(commands.length === 1 && systemCalls.length === 1
        && systemCalls[0].call.function === 'certify_blob'
        && objectId(systemCalls[0].call.arguments[1]) === blobObjectId);
      return freeze({ quotedAt, walrusStorageCostFrost: '0', walrusWriteCostFrost: '0',
        walrusTotalCostFrost: '0', relayTipMist: '0', verified: true });
    }
    require(stage === 'REGISTER' && systemCalls.length === 2);
    const storage = systemCalls.find(({ call }) => call.function === 'reserve_space');
    const register = systemCalls.find(({ call }) => call.function === 'register_blob');
    require(storage && register && storage.index < register.index
      && same(register.call.arguments[1], { Result: storage.index })
      && String(pure(storage.call.arguments[2], bcs.u32())) === String(epochs)
      && String(pure(register.call.arguments[4], bcs.u64())) === String(byteLength)
      && pure(register.call.arguments[6], bcs.bool()) === false);
    const walType = normalizeStructTag(authority.walCoinType);
    require(walType !== SUI_TYPE);
    const storageCost = amount(storage.call.arguments[3], storage.index, walType, true);
    const writeCost = amount(register.call.arguments[7], register.index, walType, true);
    require(!same(storage.call.arguments[3], register.call.arguments[7]));
    let relayTip = 0n, tips = 0, blobs = 0;
    for (const [index, command] of commands.entries()) {
      if (!command.TransferObjects) continue;
      const transfer = command.TransferObjects;
      require(transfer.objects.length === 1);
      if (same(transfer.objects[0], { Result: register.index })) {
        require(pure(transfer.address, bcs.Address) === owner); blobs += 1;
      } else {
        require(SUI_ID.test(authority.relayAddress ?? '')
          && pure(transfer.address, bcs.Address) === authority.relayAddress);
        relayTip += amount(transfer.objects[0], index, SUI_TYPE, false); tips += 1;
      }
    }
    require(blobs === 1 && (authority.relayAddress === null ? tips === 0 : tips === 1));
    return freeze({ quotedAt, walrusStorageCostFrost: storageCost.toString(),
      walrusWriteCostFrost: writeCost.toString(), walrusTotalCostFrost: (storageCost + writeCost).toString(),
      relayTipMist: relayTip.toString(), verified: true });
  } catch { return unknown; }
}

function signedTransaction(record, stage, bytes, signature, at) {
  const proof = transactionProof(bytes, { owner: record.owner });
  canonicalBase64(signature, 'Walrus signature');
  return freeze({
    stage,
    bytes,
    digest: proof.digest,
    kindSha256: proof.kindSha256,
    signature,
    signedAt: at,
    broadcastAt: null,
  });
}

function nextRecord(record, at, patch) {
  return assertRecord({
    ...clone(record),
    ...clone(patch),
    revision: record.revision + 1,
    updatedAt: at,
  });
}

function publicStatus(record) {
  if (record.status === 'ENCODED' || record.status === 'UPLOADED') return 'SIGNATURE_REQUIRED';
  if (record.status.endsWith('_SIGNED')) return 'RECOVERY_REQUIRED';
  return record.status;
}

function assertExpectedUpload(record, expected) {
  if (expected && (!record || record.revision !== expected.revision
    || recordView(record).stage !== expected.stage || publicStatus(record) !== expected.status)) {
    fail('MAKER_V8_WALRUS_CONTEXT_CHANGED', 'Upload changed. Read its current stage before continuing.', 'CONTEXT');
  }
}

/**
 * Durable, query-first Mainnet Walrus upload controller. Registration and
 * certification are separate exact wallet signatures; the public relay only
 * distributes slivers and never receives a private key.
 */
export function createMakerV8WalrusPublisherV8({
  walrusClient,
  buildClient,
  rpc,
  wallet,
  persistence,
  execution,
  fetcher = globalThis.fetch,
  aggregator = MAKER_V8_WALRUS_MAINNET_AGGREGATOR,
  now = () => Date.now(),
  quoteAuthority = null,
} = {}) {
  for (const method of [
    'computeBlobMetadata', 'writeBlobFlow', 'certifyBlobTransaction',
    'getBlobObject', 'getVerifiedBlobStatus',
  ]) requireMethod(walrusClient, method, 'walrusClient');
  requireMethod(buildClient?.core, 'getCurrentSystemState', 'buildClient.core');
  for (const method of ['getChainIdentifier', 'queryTransaction', 'getSuiClient']) requireMethod(rpc, method, 'rpc');
  for (const method of ['getCurrentAccount', 'signExactTransaction', 'verifyExactSignature']) requireMethod(wallet, method, 'wallet');
  for (const method of ['requirePersistentStorage', 'create', 'load', 'compareAndSwap']) requireMethod(persistence, method, 'persistence');
  if (typeof fetcher !== 'function') fail('MAKER_V8_WALRUS_FETCH_REQUIRED', 'Fetch is required.', 'CONFIGURATION');
  if (!plain(execution) || execution.network !== 'mainnet'
    || execution.chainIdentifier !== MAKER_V8_MAINNET_CHAIN_IDENTIFIER
    || execution.allowWalletSignature !== true || execution.allowBroadcast !== true) {
    fail('MAKER_V8_WALRUS_EXECUTION_DISABLED', 'Walrus upload requires the exact enabled Mainnet signing/broadcast gate.', 'CONFIGURATION');
  }
  const clock = (minimum = 0) => {
    const value = Number(now());
    if (!Number.isSafeInteger(value) || value < minimum) {
      fail('MAKER_V8_WALRUS_CLOCK_INVALID', 'Walrus clock moved backwards.', 'ENVIRONMENT');
    }
    return value;
  };

  const assertPinned = async () => {
    const chain = await rpc.getChainIdentifier();
    if (chain !== MAKER_V8_MAINNET_CHAIN_IDENTIFIER) {
      fail('MAKER_V8_WALRUS_NETWORK_DRIFT', 'Walrus transaction boundary is not pinned to Sui Mainnet.', 'CONTEXT');
    }
  };

  const reconstructMetadata = async (record) => {
    const bytes = canonicalBase64(record.bytesBase64, 'upload bytes', { empty: true });
    const metadata = await walrusClient.computeBlobMetadata({
      bytes,
      nonce: canonicalBase64(record.encoded.nonce, 'Walrus nonce'),
    });
    if (metadata.blobId !== record.encoded.blobId
      || toBase64(metadata.rootHash) !== record.encoded.rootHash
      || Number(metadata.metadata.unencodedLength) !== record.byteLength) {
      fail('MAKER_V8_WALRUS_ENCODING_DRIFT', 'Walrus SDK re-encoding differs from the durable blob proof.', 'ENCODING');
    }
    return { bytes, metadata };
  };

  const expiration = async (transaction, owner) => {
    const epoch = integer((await buildClient.core.getCurrentSystemState())?.systemState?.epoch, 'current epoch');
    transaction.setSenderIfNotSet(owner);
    transaction.setExpiration(makerV8PublicationExpiration(String(epoch)));
    return epoch;
  };

  const buildRegister = async (record) => {
    const { bytes } = await reconstructMetadata(record);
    const resume = {
      step: 'encoded',
      blobId: record.encoded.blobId,
      rootHash: record.encoded.rootHash,
      unencodedSize: record.byteLength,
      nonce: record.encoded.nonce,
    };
    const flow = walrusClient.writeBlobFlow({ blob: bytes, resume });
    await flow.encode();
    const transaction = flow.register({
      epochs: record.epochs,
      deletable: false,
      owner: record.owner,
      attributes: { contentType: record.mediaType, sha256: record.byteSha256 },
    });
    await expiration(transaction, record.owner);
    const raw = await transaction.build({ client: buildClient });
    const bytesBase64 = toBase64(raw);
    const proof = transactionProof(bytesBase64, { owner: record.owner });
    return freeze({
      stage: 'REGISTER',
      bytes: bytesBase64,
      digest: proof.digest,
      kindSha256: proof.kindSha256,
    });
  };

  const buildCertify = async (record) => {
    if (!record.upload?.certificate || !record.upload?.blobObjectId) {
      fail('MAKER_V8_WALRUS_UPLOAD_EVIDENCE_REQUIRED', 'Certification requires the exact relay certificate.', 'UPLOAD');
    }
    const transaction = walrusClient.certifyBlobTransaction({
      blobId: record.encoded.blobId,
      blobObjectId: record.upload.blobObjectId,
      certificate: record.upload.certificate,
      deletable: false,
    });
    await expiration(transaction, record.owner);
    const raw = await transaction.build({ client: buildClient });
    const bytesBase64 = toBase64(raw);
    const proof = transactionProof(bytesBase64, { owner: record.owner });
    return freeze({
      stage: 'CERTIFY',
      bytes: bytesBase64,
      digest: proof.digest,
      kindSha256: proof.kindSha256,
    });
  };

  const verifySigned = async (record) => {
    const transaction = record.transaction;
    if (!transaction) fail('MAKER_V8_WALRUS_SIGNED_ARTIFACT_REQUIRED', 'Durable signed Walrus transaction is missing.', 'RECOVERY');
    const proof = transactionProof(transaction.bytes, {
      owner: record.owner,
      digest: transaction.digest,
      kindSha256: transaction.kindSha256,
    });
    const verified = await wallet.verifyExactSignature({
      bytes: transaction.bytes,
      signature: transaction.signature,
      digest: transaction.digest,
      signer: record.owner,
    });
    if (!verified || verified.verified === false
      || verified.bytes && verified.bytes !== transaction.bytes
      || verified.digest && verified.digest !== transaction.digest
      || verified.signer && verified.signer !== record.owner) {
      fail('MAKER_V8_WALRUS_SIGNATURE_INVALID', 'Durable Walrus signature does not authenticate exact TransactionData.', 'SIGNING');
    }
    return proof;
  };

  const broadcast = async (record) => {
    await assertPinned();
    const account = await wallet.getCurrentAccount();
    if (account?.address !== record.owner || account?.network !== 'mainnet') {
      fail('MAKER_V8_WALRUS_ACCOUNT_DRIFT', 'Current wallet differs from the durable Walrus owner.', 'CONTEXT');
    }
    const proof = await verifySigned(record);
    await assertPinned();
    const client = await rpc.getSuiClient();
    requireMethod(client?.core, 'executeTransaction', 'Sui gRPC core');
    const result = await client.core.executeTransaction({
      transaction: proof.bytes,
      signatures: [record.transaction.signature],
      include: { effects: true, events: true },
    });
    await assertPinned();
    const transaction = result?.$kind === 'Transaction' ? result.Transaction
      : result?.$kind === 'FailedTransaction' ? result.FailedTransaction : null;
    if (!transaction || transaction.digest !== record.transaction.digest) {
      fail('MAKER_V8_WALRUS_BROADCAST_DRIFT', 'Sui gRPC executed another transaction digest.', 'BROADCAST');
    }
    return transaction;
  };

  const upload = async (record) => {
    const { bytes } = await reconstructMetadata(record);
    const transaction = record.transaction;
    const flow = walrusClient.writeBlobFlow({
      blob: bytes,
      resume: {
        step: 'registered',
        blobId: record.encoded.blobId,
        txDigest: transaction.digest,
        nonce: record.encoded.nonce,
      },
    });
    await flow.encode();
    const result = await flow.upload({ digest: transaction.digest, deletable: false });
    if (result.blobId !== record.encoded.blobId || typeof result.blobObjectId !== 'string'
      || typeof result.certificate !== 'string') {
      fail('MAKER_V8_WALRUS_RELAY_RESULT_INVALID', 'Walrus relay returned invalid upload evidence.', 'UPLOAD');
    }
    return freeze({
      blobObjectId: suiId(result.blobObjectId, 'blobObjectId'),
      certificate: result.certificate,
      registrationDigest: transaction.digest,
    });
  };

  const readback = async (record) => {
    const [blob, status, response] = await Promise.all([
      walrusClient.getBlobObject(record.upload.blobObjectId),
      walrusClient.getVerifiedBlobStatus({ blobId: record.encoded.blobId }),
      fetcher(`${aggregator}/v1/blobs/${encodeURIComponent(record.encoded.blobId)}`, {
        method: 'GET', cache: 'no-store', credentials: 'omit', redirect: 'error',
      }),
    ]);
    if (!response?.ok) fail('MAKER_V8_WALRUS_READBACK_UNAVAILABLE', 'Certified Walrus bytes are not available from Mainnet.', 'READBACK');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length !== record.byteLength || hashBytes(bytes) !== record.byteSha256) {
      fail('MAKER_V8_WALRUS_READBACK_DRIFT', 'Certified Walrus bytes differ from the durable upload.', 'READBACK');
    }
    const certified = (status?.type === 'permanent' && status.isCertified === true)
      || (status?.type === 'deletable'
        && Number(status.deletableCounts?.count_deletable_certified ?? 0) > 0);
    // getBlobObject decodes the on-chain u256 as decimal, while encoded IDs
    // use base64url. Convert through the pinned SDK, retaining exact identity.
    let objectBlobId = null;
    try {
      if (typeof blob?.blob_id === 'string' && UINT.test(blob.blob_id)) {
        objectBlobId = blobIdFromInt(blob.blob_id);
      }
    } catch { /* Malformed/out-of-range u256 remains invalid certification. */ }
    if (!certified
      || String(blob?.id ?? '').toLowerCase() !== record.upload.blobObjectId
      || objectBlobId !== record.encoded.blobId
      || integer(blob?.size, 'Walrus blob size') !== String(record.byteLength)
      || blob?.deletable !== false
      || blob?.certified_epoch == null) {
      fail('MAKER_V8_WALRUS_CERTIFICATION_INVALID', 'Walrus object/status is not the exact certified blob.', 'READBACK');
    }
    return freeze({
      schemaVersion: 'animacraft.maker-v8-walrus-readback.v1',
      blobId: record.encoded.blobId,
      blobObjectId: record.upload.blobObjectId,
      byteLength: bytes.length,
      sha256: hashBytes(bytes),
      status: status.type,
      certifiedEpoch: blob.certified_epoch == null ? null : String(blob.certified_epoch),
      endEpoch: blob.storage?.end_epoch == null ? null : String(blob.storage.end_epoch),
    });
  };

  const save = async (record, patch) => {
    const at = clock(record.updatedAt);
    return persistence.compareAndSwap(record, nextRecord(record, at, patch));
  };

  const settle = async (record) => {
    const query = await rpc.queryTransaction({ digest: record.transaction.digest });
    if (!plain(query) || query.digest !== record.transaction.digest) {
      fail('MAKER_V8_WALRUS_QUERY_INVALID', 'Walrus exact-digest query returned invalid evidence.', 'RECOVERY');
    }
    if (query.status === 'FINALIZED_FAILURE') {
      return save(record, {
        status: 'FAILED',
        error: { code: 'MAKER_V8_WALRUS_TRANSACTION_FAILED', message: query.error?.message ?? 'Walrus transaction failed.' },
      });
    }
    if (query.status === 'NOT_FOUND') {
      if (query.absence?.chainIdentifier !== MAKER_V8_MAINNET_CHAIN_IDENTIFIER) {
        fail('MAKER_V8_WALRUS_ABSENCE_INVALID', 'Walrus replay requires typed Mainnet absence evidence.', 'RECOVERY');
      }
      await broadcast(record);
      if (record.transaction.broadcastAt === null) {
        const at = clock(record.updatedAt);
        const next = nextRecord(record, at, {
          transaction: { ...clone(record.transaction), broadcastAt: at },
        });
        return persistence.compareAndSwap(record, next);
      }
      return record;
    }
    if (query.status !== 'FINALIZED_SUCCESS') {
      fail('MAKER_V8_WALRUS_QUERY_INVALID', 'Walrus query returned an unsupported state.', 'RECOVERY');
    }
    if (record.status === 'REGISTER_SIGNED') {
      let finalized = await save(record, { status: 'REGISTER_FINALIZED', error: null });
      const uploaded = await upload(finalized);
      finalized = await save(finalized, { status: 'UPLOADED', upload: uploaded, transaction: null, error: null });
      return finalized;
    }
    if (record.status === 'CERTIFY_SIGNED') {
      const proof = await readback(record);
      return save(record, { status: 'COMPLETE', readback: proof, error: null });
    }
    fail('MAKER_V8_WALRUS_STATE_INVALID', 'Finality cannot settle the current Walrus stage.', 'RECOVERY');
  };

  const reviews = new Map();
  const api = {
    schemaVersion: MAKER_V8_WALRUS_SCHEMA,
    async getNumShards() { return (await walrusClient.systemState()).committee.n_shards; },
    loadPublicationBinding: (...args) => {
      requireMethod(persistence, 'loadPublicationBinding', 'persistence');
      return persistence.loadPublicationBinding(...args);
    },
    savePublicationBinding: (...args) => {
      requireMethod(persistence, 'savePublicationBinding', 'persistence');
      return persistence.savePublicationBinding(...args);
    },

    bindAssetLayout: (...args) => {
      requireMethod(persistence, 'bindAssetLayout', 'persistence');
      return persistence.bindAssetLayout(...args);
    },

    async prepareReview(uploadId) {
      const record = await persistence.load(id(uploadId));
      if (!record || !['ENCODED', 'UPLOADED'].includes(record.status)) return null;
      const build = record.status === 'ENCODED' ? await buildRegister(record) : await buildCertify(record);
      assertExpectedUpload(await persistence.load(uploadId), { ...recordView(record), status: publicStatus(record) });
      const data = bcs.TransactionData.parse(fromBase64(build.bytes)).V1;
      const quotedAt = new Date(clock(record.updatedAt)).toISOString();
      let quote = freeze(unknownQuote(quotedAt));
      if (typeof quoteAuthority === 'function') {
        try {
          quote = makerV8WalrusTransactionQuote({ bytesBase64: build.bytes, stage: build.stage,
            authority: await quoteAuthority(build.stage), owner: record.owner, epochs: record.epochs,
            byteLength: record.byteLength, blobObjectId: record.upload?.blobObjectId ?? null, quotedAt });
        } catch { /* A missing read is unknown, never an invented zero price. */ }
      }
      const review = freeze({ id: uploadId, revision: record.revision, stage: build.stage,
        status: 'SIGNATURE_REQUIRED', digest: build.digest,
        gasBudgetMist: String(data.gasData.budget), gasPriceMist: String(data.gasData.price),
        storageEpochs: record.epochs, deletable: record.deletable,
        storageCostAtomic: quote.walrusStorageCostFrost, relayTipMist: quote.relayTipMist, quote });
      reviews.set(uploadId, { review, build });
      return review;
    },

    async signReviewed(uploadId, review, assertCurrent = async () => {}) {
      const frozen = reviews.get(uploadId);
      if (!frozen || canonical(frozen.review) !== canonical(review)) {
        fail('MAKER_V8_WALRUS_REVIEW_STALE', 'Review this exact upload transaction again.', 'CONTEXT');
      }
      reviews.delete(uploadId);
      await assertCurrent();
      return api.requestSignature(uploadId, review, { build: frozen.build, signOnly: true, assertCurrent });
    },

    async prepare({ uploadId, owner, mediaType, bytesBase64, epochs = 3 } = {}) {
      await persistence.requirePersistentStorage();
      const checkedId = id(uploadId);
      const checkedOwner = suiId(owner, 'owner');
      const bytes = canonicalBase64(bytesBase64, 'upload bytes', { empty: true });
      if (typeof mediaType !== 'string' || mediaType.length === 0 || mediaType.length > 256
        || !Number.isSafeInteger(epochs) || epochs < 1 || epochs > 53) {
        fail('MAKER_V8_WALRUS_INPUT_INVALID', 'Walrus media type or retention is invalid.', 'VALIDATION');
      }
      const metadata = await walrusClient.computeBlobMetadata({ bytes });
      const at = clock();
      const record = assertRecord({
        schemaVersion: MAKER_V8_WALRUS_SCHEMA,
        uploadId: checkedId,
        revision: 1,
        createdAt: at,
        updatedAt: at,
        status: 'ENCODED',
        owner: checkedOwner,
        mediaType,
        bytesBase64,
        byteLength: bytes.length,
        byteSha256: hashBytes(bytes),
        epochs,
        deletable: false,
        encoded: {
          blobId: metadata.blobId,
          rootHash: toBase64(metadata.rootHash),
          nonce: toBase64(metadata.nonce),
          unencodedSize: bytes.length,
        },
        transaction: null,
        upload: null,
        readback: null,
        error: null,
      });
      return recordView(await persistence.create(record));
    },

    async requestSignature(uploadId, expected, reviewed = null) {
      await persistence.requirePersistentStorage();
      let record = await persistence.load(id(uploadId));
      if (!record) fail('MAKER_V8_WALRUS_NOT_FOUND', 'Walrus upload was not found.', 'PERSISTENCE');
      assertExpectedUpload(record, expected);
      if (record.status.endsWith('_SIGNED')) return api.resume(uploadId);
      if (record.status === 'COMPLETE' || record.status === 'FAILED') return recordView(record);
      const build = reviewed?.build ?? (record.status === 'ENCODED'
        ? await buildRegister(record)
        : record.status === 'UPLOADED' ? await buildCertify(record) : null);
      if (!build) fail('MAKER_V8_WALRUS_SIGNATURE_STATE_INVALID', 'Walrus upload is not ready for a signature.', 'SIGNING');
      await assertPinned();
      const account = await wallet.getCurrentAccount();
      if (account?.address !== record.owner || account?.network !== 'mainnet') {
        fail('MAKER_V8_WALRUS_ACCOUNT_DRIFT', 'Current wallet differs from the Walrus owner.', 'CONTEXT');
      }
      if (expected) assertExpectedUpload(await persistence.load(record.uploadId), expected);
      await reviewed?.assertCurrent?.();
      const signed = await wallet.signExactTransaction({
        bytes: build.bytes, digest: build.digest, signer: record.owner,
      });
      if (!plain(signed) || signed.bytes !== build.bytes || signed.digest !== build.digest
        || signed.signer !== record.owner || typeof signed.signature !== 'string') {
        fail('MAKER_V8_WALRUS_SIGNED_ARTIFACT_DRIFT', 'Wallet changed the exact Walrus transaction.', 'SIGNING');
      }
      const verified = await wallet.verifyExactSignature(signed);
      if (!verified || verified.verified === false) {
        fail('MAKER_V8_WALRUS_SIGNATURE_INVALID', 'Wallet signature is invalid.', 'SIGNING');
      }
      const at = clock(record.updatedAt);
      record = await persistence.compareAndSwap(record, nextRecord(record, at, {
        status: build.stage === 'REGISTER' ? 'REGISTER_SIGNED' : 'CERTIFY_SIGNED',
        transaction: signedTransaction(record, build.stage, signed.bytes, signed.signature, at),
        error: null,
      }));
      // Cold durable reread precedes the first exact-digest query/broadcast.
      record = await persistence.load(record.uploadId);
      await verifySigned(record);
      if (reviewed?.signOnly) return freeze({ ...recordView(record), status: publicStatus(record) });
      return api.resume(uploadId);
    },

    async resume(uploadId, expected) {
      await persistence.requirePersistentStorage();
      let record = await persistence.load(id(uploadId));
      if (!record) fail('MAKER_V8_WALRUS_NOT_FOUND', 'Walrus upload was not found.', 'PERSISTENCE');
      assertExpectedUpload(record, expected);
      if (record.status === 'REGISTER_FINALIZED') {
        const uploaded = await upload(record);
        record = await save(record, { status: 'UPLOADED', upload: uploaded, transaction: null, error: null });
      } else if (record.status.endsWith('_SIGNED')) {
        record = await settle(record);
      }
      return freeze({ ...recordView(record), status: publicStatus(record) });
    },

    async load(uploadId) {
      const record = await persistence.load(id(uploadId));
      return record == null ? null : freeze({ ...recordView(record), status: publicStatus(record) });
    },

    async loadContent(uploadId) {
      const record = await persistence.load(id(uploadId));
      return record == null ? null : contentView(record);
    },
  };
  return freeze(api);
}

export function createProductionMakerV8WalrusPublisherV8({
  rpc,
  wallet,
  execution,
  indexedDB = globalThis.indexedDB,
  storageManager = globalThis.navigator?.storage,
  fetcher = globalThis.fetch,
  grpcEndpoint = MAKER_V8_SUI_GRPC_MAINNET_ENDPOINT,
  uploadRelay = MAKER_V8_WALRUS_MAINNET_RELAY,
  aggregator = MAKER_V8_WALRUS_MAINNET_AGGREGATOR,
} = {}) {
  const buildClient = new SuiGrpcClient({ network: 'mainnet', baseUrl: grpcEndpoint });
  let relayAddress;
  const quoteFetch = async (url, options) => {
    const response = await fetcher(url, options);
    // Capture the payee from the very response consumed by this SDK build.
    // Do not issue an independent price request or substitute its amount.
    if (String(url) === `${uploadRelay}/v1/tip-config` && options?.method === 'GET' && response.ok) {
      try {
        const config = await response.clone().json();
        relayAddress = typeof config === 'string' ? null : suiId(config.send_tip?.address, 'relay payee');
      } catch { relayAddress = undefined; }
    }
    return response;
  };
  const walrusClient = new WalrusClient({
    network: 'mainnet',
    suiClient: buildClient,
    uploadRelay: { host: uploadRelay, sendTip: { max: MAKER_V8_WALRUS_MAX_RELAY_TIP_MIST }, timeout: 600_000, fetch: quoteFetch },
  });
  const persistence = createMakerV8WalrusPersistenceV8(indexedDB, { storageManager });
  const publisher = createMakerV8WalrusPublisherV8({
    walrusClient, buildClient, rpc, wallet, persistence, execution, fetcher, aggregator,
    async quoteAuthority(stage) {
      const system = await walrusClient.systemObject();
      if (stage === 'CERTIFY') return { system };
      // The SDK derives WAL's type from this same on-chain staking parameter.
      const originalPackage = (await walrusClient.getBlobType()).split('::')[0];
      const parameter = (await buildClient.core.getMoveFunction({ packageId: originalPackage,
        moduleName: 'staking', name: 'stake_with_pool' })).function.parameters[1];
      const coin = parameter.body?.datatype;
      const walCoinType = coin?.typeParameters?.[0]?.datatype?.typeName;
      return { system, walCoinType, relayAddress };
    },
  });
  return freeze({
    schemaVersion: MAKER_V8_WALRUS_SCHEMA,
    publisher,
    persistence,
    transport: freeze({
      chainIdentifier: MAKER_V8_SUI_MAINNET_GENESIS_DIGEST,
      sui: 'GRPC',
      uploadRelay,
      aggregator,
    }),
  });
}

export function makerV8WalrusUploadIdV8({ owner, purpose, contentSha256 }) {
  const checked = {
    schemaVersion: MAKER_V8_WALRUS_SCHEMA,
    chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
    owner: suiId(owner, 'owner'),
    purpose: id(purpose, 'purpose'),
    contentSha256: HASH.test(contentSha256) ? contentSha256 : fail(
      'MAKER_V8_WALRUS_HASH_INVALID', 'contentSha256 must be one lowercase hash.', 'VALIDATION',
    ),
  };
  return `walrus-${digestFor(checked)}`;
}
