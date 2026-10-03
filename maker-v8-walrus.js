import { WalrusClient } from '@mysten/walrus';
import { bcs } from '@mysten/sui/bcs';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { TransactionDataBuilder } from '@mysten/sui/transactions';
import { fromBase64, toBase64 } from '@mysten/sui/utils';
import { sha256 } from '@noble/hashes/sha2.js';

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
export const MAKER_V8_WALRUS_MAINNET_AGGREGATOR =
  'https://aggregator.walrus-mainnet.walrus.space';

const DB_NAME = 'animacraft-maker-v8-walrus-v1';
const DB_VERSION = 1;
const STORE = 'uploads';
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
  };
  return requestResult(request);
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
  const database = () => (databasePromise ??= openDatabase(indexedDB));
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
    transaction.setExpiration({ Epoch: (BigInt(epoch) + 1n).toString() });
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
    if (!certified
      || String(blob?.id ?? '').toLowerCase() !== record.upload.blobObjectId
      || blob?.blob_id !== record.encoded.blobId
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

  const api = {
    schemaVersion: MAKER_V8_WALRUS_SCHEMA,

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

    async requestSignature(uploadId, expected) {
      await persistence.requirePersistentStorage();
      let record = await persistence.load(id(uploadId));
      if (!record) fail('MAKER_V8_WALRUS_NOT_FOUND', 'Walrus upload was not found.', 'PERSISTENCE');
      assertExpectedUpload(record, expected);
      if (record.status.endsWith('_SIGNED')) return api.resume(uploadId);
      if (record.status === 'COMPLETE' || record.status === 'FAILED') return recordView(record);
      const build = record.status === 'ENCODED'
        ? await buildRegister(record)
        : record.status === 'UPLOADED' ? await buildCertify(record) : null;
      if (!build) fail('MAKER_V8_WALRUS_SIGNATURE_STATE_INVALID', 'Walrus upload is not ready for a signature.', 'SIGNING');
      await assertPinned();
      const account = await wallet.getCurrentAccount();
      if (account?.address !== record.owner || account?.network !== 'mainnet') {
        fail('MAKER_V8_WALRUS_ACCOUNT_DRIFT', 'Current wallet differs from the Walrus owner.', 'CONTEXT');
      }
      if (expected) assertExpectedUpload(await persistence.load(record.uploadId), expected);
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
  const walrusClient = new WalrusClient({
    network: 'mainnet',
    suiClient: buildClient,
    uploadRelay: { host: uploadRelay, sendTip: { max: 1_000_000 }, timeout: 600_000 },
  });
  const persistence = createMakerV8WalrusPersistenceV8(indexedDB, { storageManager });
  const publisher = createMakerV8WalrusPublisherV8({
    walrusClient, buildClient, rpc, wallet, persistence, execution, fetcher, aggregator,
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
