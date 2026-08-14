/** Durable write-ahead recovery for Expansion Pack v8 lifecycle transactions. */
import { fromBase64 } from '@mysten/bcs';
import { TransactionDataBuilder } from '@mysten/sui/transactions';
import { normalizeSuiAddress } from '@mysten/sui/utils';

export const EXPANSION_PACK_LIFECYCLE_RECOVERY_SCHEMA =
  'animacraft.expansion-pack-lifecycle-recovery.v2';
export const EXPANSION_PACK_LIFECYCLE_RECEIPT_SCHEMA =
  'animacraft.expansion-pack-lifecycle-receipt.v2';
export const EXPANSION_PACK_LIFECYCLE_FAILURE_SCHEMA =
  'animacraft.expansion-pack-lifecycle-finalized-failure.v2';
export const EXPANSION_PACK_LIFECYCLE_DATABASE_NAME =
  'animacraft-expansion-pack-lifecycle-v8';
export const EXPANSION_PACK_LIFECYCLE_DATABASE_VERSION = 2;
export const EXPANSION_PACK_LIFECYCLE_PENDING_STORE = 'pending-lifecycle-actions-v2';
export const EXPANSION_PACK_LIFECYCLE_RECEIPT_STORE = 'verified-lifecycle-receipts-v2';
export const EXPANSION_PACK_LIFECYCLE_FAILURE_STORE = 'finalized-lifecycle-failures-v2';

// The pre-release v1 prototype did not bind the mutable shared Release object
// version/digest, so those records cannot be promoted into a v2 action identity
// without guessing. Keep the old stores intact and detect any old pending lane
// fail-closed. This prevents a replacement signature while preserving the raw
// v1 bytes for an explicit query-only recovery tool if a developer build ever
// wrote them. The first public lifecycle release starts on v2.
const LEGACY_V1_PENDING_STORE = 'pending-lifecycle-actions';
const LEGACY_V1_RECEIPT_STORE = 'verified-lifecycle-receipts';
const LEGACY_V1_FAILURE_STORE = 'finalized-lifecycle-failures';

export const EXPANSION_PACK_LIFECYCLE_RECOVERY_STATE = Object.freeze({
  SIGNED: 'SIGNED',
  BROADCASTING: 'BROADCASTING',
  OUTCOME_PENDING: 'OUTCOME_PENDING',
});

export const EXPANSION_PACK_LIFECYCLE_RECOVERY_ERROR = Object.freeze({
  IDENTITY_INVALID: 'EXPANSION_PACK_LIFECYCLE_RECOVERY_IDENTITY_INVALID',
  SIGNED_INVALID: 'EXPANSION_PACK_LIFECYCLE_RECOVERY_SIGNED_INVALID',
  DIGEST_MISMATCH: 'EXPANSION_PACK_LIFECYCLE_RECOVERY_DIGEST_MISMATCH',
  CAS_CONFLICT: 'EXPANSION_PACK_LIFECYCLE_RECOVERY_CAS_CONFLICT',
  SESSION_CONFLICT: 'EXPANSION_PACK_LIFECYCLE_RECOVERY_SESSION_CONFLICT',
  SIGNED_IMMUTABLE: 'EXPANSION_PACK_LIFECYCLE_RECOVERY_SIGNED_IMMUTABLE',
  PENDING_MISSING: 'EXPANSION_PACK_LIFECYCLE_RECOVERY_PENDING_MISSING',
  ALREADY_COMPLETED: 'EXPANSION_PACK_LIFECYCLE_RECOVERY_ALREADY_COMPLETED',
  ALREADY_FINALIZED_FAILED: 'EXPANSION_PACK_LIFECYCLE_RECOVERY_ALREADY_FINALIZED_FAILED',
  RECEIPT_INVALID: 'EXPANSION_PACK_LIFECYCLE_RECOVERY_RECEIPT_INVALID',
  FINALIZED_FAILURE_INVALID: 'EXPANSION_PACK_LIFECYCLE_RECOVERY_FINALIZED_FAILURE_INVALID',
  READBACK_MISMATCH: 'EXPANSION_PACK_LIFECYCLE_RECOVERY_READBACK_MISMATCH',
  INDEXEDDB_UNAVAILABLE: 'EXPANSION_PACK_LIFECYCLE_RECOVERY_INDEXEDDB_UNAVAILABLE',
  DATABASE_BLOCKED: 'EXPANSION_PACK_LIFECYCLE_RECOVERY_DATABASE_BLOCKED',
  LEGACY_RECOVERY_REQUIRED: 'EXPANSION_PACK_LIFECYCLE_LEGACY_RECOVERY_REQUIRED',
  STORAGE_FAILED: 'EXPANSION_PACK_LIFECYCLE_RECOVERY_STORAGE_FAILED',
});

export class ExpansionPackLifecycleRecoveryStoreError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'ExpansionPackLifecycleRecoveryStoreError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new ExpansionPackLifecycleRecoveryStoreError(message, code, details);
}

function text(value) { return String(value ?? '').trim(); }
function required(value, label) {
  const result = text(value);
  if (!result) fail(EXPANSION_PACK_LIFECYCLE_RECOVERY_ERROR.IDENTITY_INVALID, `${label} is required.`);
  return result;
}

function exactId(value, label) {
  try { return normalizeSuiAddress(required(value, label)); } catch {
    fail(EXPANSION_PACK_LIFECYCLE_RECOVERY_ERROR.IDENTITY_INVALID, `${label} must be an exact Sui id.`);
  }
}

function lifecycle(value, label) {
  const result = Number(value);
  if (!Number.isInteger(result) || result < 0 || result > 5) fail(
    EXPANSION_PACK_LIFECYCLE_RECOVERY_ERROR.IDENTITY_INVALID,
    `${label} must be a known Expansion Pack lifecycle.`,
  );
  return result;
}

function exactObjectVersion(value) {
  const version = required(value, 'Release object version');
  try {
    if (!/^[0-9]+$/.test(version) || BigInt(version) < 1n) throw new Error('range');
  } catch {
    fail(
      EXPANSION_PACK_LIFECYCLE_RECOVERY_ERROR.IDENTITY_INVALID,
      'Release object version must be an exact positive u64.',
    );
  }
  return BigInt(version).toString();
}

function exactObjectDigest(value) {
  const digest = required(value, 'Release object digest');
  if (digest.length > 160 || /\s/.test(digest)) fail(
    EXPANSION_PACK_LIFECYCLE_RECOVERY_ERROR.IDENTITY_INVALID,
    'Release object digest must be an exact opaque Sui digest.',
  );
  return digest;
}

const TRANSITIONS = Object.freeze({ pause: [3, 4], resume: [4, 3] });

function identityFrom(value = {}) {
  const walletAddress = exactId(value.walletAddress ?? value.wallet, 'Wallet address');
  const releaseId = exactId(value.releaseId ?? value.release?.objectId, 'Release id');
  const adminCapId = exactId(value.adminCapId ?? value.adminCap?.objectId, 'AdminCap id');
  const parentRootId = exactId(value.parentRootId ?? value.parent?.objectId, 'Parent root id');
  const releaseObjectVersion = exactObjectVersion(
    value.releaseObjectVersion ?? value.release?.objectVersion,
  );
  const releaseObjectDigest = exactObjectDigest(
    value.releaseObjectDigest ?? value.release?.objectDigest,
  );
  const action = required(value.action ?? value.kind, 'Lifecycle action').toLowerCase();
  if (!['pause', 'resume', 'archive'].includes(action)) fail(
    EXPANSION_PACK_LIFECYCLE_RECOVERY_ERROR.IDENTITY_INVALID,
    'Lifecycle action must be pause, resume or archive.',
  );
  const fromLifecycle = lifecycle(value.fromLifecycle, 'Previous lifecycle');
  const toLifecycle = lifecycle(value.toLifecycle, 'Current lifecycle');
  const fixed = TRANSITIONS[action];
  if ((fixed && (fixed[0] !== fromLifecycle || fixed[1] !== toLifecycle))
    || (action === 'archive' && (toLifecycle !== 5 || fromLifecycle === 3 || fromLifecycle === 5))) fail(
    EXPANSION_PACK_LIFECYCLE_RECOVERY_ERROR.IDENTITY_INVALID,
    'Lifecycle action and exact from/to states do not form a protocol transition.',
  );
  const parts = [walletAddress, releaseId, adminCapId, parentRootId,
    releaseObjectVersion, releaseObjectDigest, action,
    fromLifecycle, toLifecycle];
  const key = [EXPANSION_PACK_LIFECYCLE_RECOVERY_SCHEMA, ...parts]
    .map((entry) => encodeURIComponent(entry)).join(':');
  return deepFreeze({
    walletAddress, releaseId, adminCapId, parentRootId,
    releaseObjectVersion, releaseObjectDigest, action,
    fromLifecycle, toLifecycle, key,
    walletReleaseKey: [walletAddress, releaseId].map(encodeURIComponent).join(':'),
    releaseActionKey: [releaseId, action].map(encodeURIComponent).join(':'),
  });
}

export function expansionPackLifecycleRecoveryIdentity(value) { return identityFrom(value); }

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function publicRecord(value) { return value ? deepFreeze(structuredClone(value)) : null; }
function sameIdentity(left, right) { return left?.key === right?.key; }
function sameSigned(left, right) {
  return left?.bytes === right?.bytes && left?.signature === right?.signature
    && left?.digest === right?.digest;
}

function exactRevision(value, { zero = false } = {}) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < (zero ? 0 : 1)) fail(
    EXPANSION_PACK_LIFECYCLE_RECOVERY_ERROR.READBACK_MISMATCH,
    'Lifecycle recovery revision is invalid.',
  );
  return result;
}

function exactSession(value) {
  const result = required(value, 'Recovery session id');
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/.test(result)) fail(
    EXPANSION_PACK_LIFECYCLE_RECOVERY_ERROR.IDENTITY_INVALID,
    'Recovery session id must be an opaque 8-160 character token.',
  );
  return result;
}

async function exactSigned(value, deriveDigest, now) {
  const bytes = typeof value?.bytes === 'string' ? value.bytes : '';
  const signature = typeof value?.signature === 'string' ? value.signature : '';
  if (!bytes || bytes !== bytes.trim() || !signature || signature !== signature.trim()) fail(
    EXPANSION_PACK_LIFECYCLE_RECOVERY_ERROR.SIGNED_INVALID,
    'Exact base64 signed bytes and serialized signature are required.',
  );
  let digest;
  try {
    if (!fromBase64(bytes).length) throw new Error('empty');
    digest = required(await deriveDigest(bytes), 'Derived transaction digest');
  } catch {
    fail(EXPANSION_PACK_LIFECYCLE_RECOVERY_ERROR.SIGNED_INVALID, 'Signed bytes are not a valid transaction.');
  }
  for (const name of ['digest', 'transactionDigest']) {
    if (text(value?.[name]) && text(value[name]) !== digest) fail(
      EXPANSION_PACK_LIFECYCLE_RECOVERY_ERROR.DIGEST_MISMATCH,
      `The supplied ${name} does not match the exact signed bytes.`,
    );
  }
  return deepFreeze({
    bytes, signature, digest,
    signedAt: text(value?.signedAt) || new Date(now()).toISOString(),
  });
}

// One terminal failure lane per immutable action identity. A different digest
// must never become a replacement signature after definitive failure.
function failureKey(identity, _digest) { return identity.key; }

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
  });
}

function completed(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'));
    transaction.onerror = () => {};
  });
}

function openDatabase(indexedDB) {
  if (!indexedDB) fail(
    EXPANSION_PACK_LIFECYCLE_RECOVERY_ERROR.INDEXEDDB_UNAVAILABLE,
    'This browser cannot durably recover lifecycle transactions.',
  );
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(
      EXPANSION_PACK_LIFECYCLE_DATABASE_NAME,
      EXPANSION_PACK_LIFECYCLE_DATABASE_VERSION,
    );
    request.onupgradeneeded = () => {
      const database = request.result;
      // Always retain/create the unpublished v1 stores. Existing v1 bytes are
      // never deleted during the v2 upgrade, and their presence is checked
      // before a new signature can be persisted for the same wallet+Release.
      if (!database.objectStoreNames.contains(LEGACY_V1_PENDING_STORE)) {
        const store = database.createObjectStore(LEGACY_V1_PENDING_STORE, { keyPath: 'key' });
        store.createIndex('walletReleaseKey', 'walletReleaseKey', { unique: false });
        store.createIndex('releaseActionKey', 'releaseActionKey', { unique: false });
      }
      if (!database.objectStoreNames.contains(LEGACY_V1_RECEIPT_STORE)) {
        const store = database.createObjectStore(LEGACY_V1_RECEIPT_STORE, { keyPath: 'key' });
        store.createIndex('walletReleaseKey', 'walletReleaseKey', { unique: false });
      }
      if (!database.objectStoreNames.contains(LEGACY_V1_FAILURE_STORE)) {
        const store = database.createObjectStore(LEGACY_V1_FAILURE_STORE, { keyPath: 'failureKey' });
        store.createIndex('key', 'key', { unique: false });
      }
      if (!database.objectStoreNames.contains(EXPANSION_PACK_LIFECYCLE_PENDING_STORE)) {
        const store = database.createObjectStore(EXPANSION_PACK_LIFECYCLE_PENDING_STORE, { keyPath: 'key' });
        store.createIndex('walletReleaseKey', 'walletReleaseKey', { unique: false });
        store.createIndex('releaseActionKey', 'releaseActionKey', { unique: false });
      }
      if (!database.objectStoreNames.contains(EXPANSION_PACK_LIFECYCLE_RECEIPT_STORE)) {
        const store = database.createObjectStore(EXPANSION_PACK_LIFECYCLE_RECEIPT_STORE, { keyPath: 'key' });
        store.createIndex('walletReleaseKey', 'walletReleaseKey', { unique: false });
      }
      if (!database.objectStoreNames.contains(EXPANSION_PACK_LIFECYCLE_FAILURE_STORE)) {
        const store = database.createObjectStore(EXPANSION_PACK_LIFECYCLE_FAILURE_STORE, { keyPath: 'failureKey' });
        store.createIndex('key', 'key', { unique: false });
      }
    };
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
    request.onblocked = () => reject(new ExpansionPackLifecycleRecoveryStoreError(
      'Close other tabs so lifecycle recovery storage can be upgraded.',
      EXPANSION_PACK_LIFECYCLE_RECOVERY_ERROR.DATABASE_BLOCKED,
    ));
    request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
  });
}

async function withDatabase(indexedDB, stores, mode, run) {
  const database = await openDatabase(indexedDB);
  try {
    const transaction = database.transaction(stores, mode);
    const done = completed(transaction);
    const result = await run(transaction);
    await done;
    return result;
  } catch (cause) {
    if (cause instanceof ExpansionPackLifecycleRecoveryStoreError) throw cause;
    fail(EXPANSION_PACK_LIFECYCLE_RECOVERY_ERROR.STORAGE_FAILED, 'Lifecycle recovery storage failed.', {
      cause: text(cause?.message),
    });
  } finally {
    database.close();
  }
}

function storedIdentity(record, expected) {
  const actual = identityFrom(record);
  if (record?.key !== expected.key || !sameIdentity(actual, expected)) fail(
    EXPANSION_PACK_LIFECYCLE_RECOVERY_ERROR.READBACK_MISMATCH,
    'Stored lifecycle recovery identity does not match its key.',
  );
}

/** Store API mirrors Player acquisition recovery, but uses lifecycle authority identity. */
export function createExpansionPackLifecycleRecoveryStore(options = {}) {
  const indexedDB = options.indexedDB ?? globalThis.indexedDB;
  const now = typeof options.clock === 'function' ? options.clock : Date.now;
  const deriveDigest = typeof options.deriveTransactionDigest === 'function'
    ? options.deriveTransactionDigest
    : (bytes) => TransactionDataBuilder.getDigestFromBytes(fromBase64(bytes));

  const api = {
    async listPendingForRelease({ walletAddress, releaseId } = {}) {
      const walletReleaseKey = [
        exactId(walletAddress, 'Wallet address'),
        exactId(releaseId, 'Release id'),
      ].map(encodeURIComponent).join(':');
      const [records, legacyRecords] = await withDatabase(
        indexedDB,
        [EXPANSION_PACK_LIFECYCLE_PENDING_STORE, LEGACY_V1_PENDING_STORE],
        'readonly',
        (tx) => Promise.all([
          requestResult(tx.objectStore(EXPANSION_PACK_LIFECYCLE_PENDING_STORE).getAll()),
          requestResult(tx.objectStore(LEGACY_V1_PENDING_STORE).getAll()),
        ]),
      );
      if ((legacyRecords || []).some((record) => record?.walletReleaseKey === walletReleaseKey)) fail(
        EXPANSION_PACK_LIFECYCLE_RECOVERY_ERROR.LEGACY_RECOVERY_REQUIRED,
        'A pre-release lifecycle transaction is still pending. It must be resolved by digest before a new signature is allowed.',
        { walletReleaseKey },
      );
      const matches = [];
      for (const record of records || []) {
        if (record?.walletReleaseKey !== walletReleaseKey) continue;
        const identity = identityFrom(record);
        storedIdentity(record, identity);
        if (record.schemaVersion !== EXPANSION_PACK_LIFECYCLE_RECOVERY_SCHEMA) fail(
          EXPANSION_PACK_LIFECYCLE_RECOVERY_ERROR.READBACK_MISMATCH,
          'Stored pending lifecycle recovery schema is unsupported.',
        );
        exactRevision(record.revision);
        exactSession(record.sessionId);
        const signed = await exactSigned(record.signed, deriveDigest, now);
        if (!sameSigned(signed, record.signed)) fail(
          EXPANSION_PACK_LIFECYCLE_RECOVERY_ERROR.READBACK_MISMATCH,
          'Stored signed lifecycle transaction changed.',
        );
        matches.push(publicRecord(record));
      }
      return deepFreeze(matches.sort((left, right) => (
        Number(left.savedAt || 0) - Number(right.savedAt || 0)
        || left.key.localeCompare(right.key)
      )));
    },

    async listFinalizedFailuresForRelease({ walletAddress, releaseId } = {}) {
      const walletReleaseKey = [
        exactId(walletAddress, 'Wallet address'),
        exactId(releaseId, 'Release id'),
      ].map(encodeURIComponent).join(':');
      const records = await withDatabase(
        indexedDB,
        [EXPANSION_PACK_LIFECYCLE_FAILURE_STORE],
        'readonly',
        (tx) => requestResult(tx.objectStore(EXPANSION_PACK_LIFECYCLE_FAILURE_STORE).getAll()),
      );
      const matches = [];
      for (const record of records || []) {
        if (record?.walletReleaseKey !== walletReleaseKey) continue;
        const identity = identityFrom(record);
        storedIdentity(record, identity);
        if (record.schemaVersion !== EXPANSION_PACK_LIFECYCLE_FAILURE_SCHEMA
          || record.failureKey !== failureKey(identity)
          || !text(record.transactionDigest)
          || record.finalized !== true || record.executionStatus !== 'FAILURE') fail(
          EXPANSION_PACK_LIFECYCLE_RECOVERY_ERROR.READBACK_MISMATCH,
          'Stored finalized lifecycle failure is invalid.',
        );
        matches.push(publicRecord(record));
      }
      return deepFreeze(matches.sort((left, right) => (
        Number(left.failedAt || 0) - Number(right.failedAt || 0)
        || left.key.localeCompare(right.key)
      )));
    },

    async loadPending(identityValue) {
      const identity = identityFrom(identityValue);
      const record = await withDatabase(indexedDB, [EXPANSION_PACK_LIFECYCLE_PENDING_STORE], 'readonly',
        (tx) => requestResult(tx.objectStore(EXPANSION_PACK_LIFECYCLE_PENDING_STORE).get(identity.key)));
      if (!record) return null;
      storedIdentity(record, identity);
      if (record.schemaVersion !== EXPANSION_PACK_LIFECYCLE_RECOVERY_SCHEMA) fail(
        EXPANSION_PACK_LIFECYCLE_RECOVERY_ERROR.READBACK_MISMATCH,
        'Stored pending lifecycle recovery schema is unsupported.',
      );
      exactRevision(record.revision);
      exactSession(record.sessionId);
      const signed = await exactSigned(record.signed, deriveDigest, now);
      if (!sameSigned(signed, record.signed)) fail(
        EXPANSION_PACK_LIFECYCLE_RECOVERY_ERROR.READBACK_MISMATCH,
        'Stored signed lifecycle transaction changed.',
      );
      return publicRecord(record);
    },

    async loadVerifiedReceipt(identityValue) {
      const identity = identityFrom(identityValue);
      const record = await withDatabase(indexedDB, [EXPANSION_PACK_LIFECYCLE_RECEIPT_STORE], 'readonly',
        (tx) => requestResult(tx.objectStore(EXPANSION_PACK_LIFECYCLE_RECEIPT_STORE).get(identity.key)));
      if (!record) return null;
      storedIdentity(record, identity);
      if (record.schemaVersion !== EXPANSION_PACK_LIFECYCLE_RECEIPT_SCHEMA
        || record.verifiedReadback !== true || record.executionStatus !== 'SUCCESS'
        || record.previousLifecycle !== identity.fromLifecycle
        || record.lifecycle !== identity.toLifecycle) fail(
        EXPANSION_PACK_LIFECYCLE_RECOVERY_ERROR.READBACK_MISMATCH,
        'Stored receipt is not exact successful lifecycle readback evidence.',
      );
      return publicRecord(record);
    },

    async loadFinalizedFailure(identityValue, digestValue = '') {
      const identity = identityFrom(identityValue);
      const digest = text(digestValue);
      const record = await withDatabase(indexedDB, [EXPANSION_PACK_LIFECYCLE_FAILURE_STORE], 'readonly',
        (tx) => requestResult(tx.objectStore(EXPANSION_PACK_LIFECYCLE_FAILURE_STORE)
          .get(failureKey(identity, digest))));
      if (!record) return null;
      storedIdentity(record, identity);
      if (record.schemaVersion !== EXPANSION_PACK_LIFECYCLE_FAILURE_SCHEMA
        || record.failureKey !== failureKey(identity, digest)
        || !text(record.transactionDigest)
        || (digest && record.transactionDigest !== digest)
        || record.finalized !== true || record.executionStatus !== 'FAILURE') fail(
        EXPANSION_PACK_LIFECYCLE_RECOVERY_ERROR.READBACK_MISMATCH,
        'Stored finalized lifecycle failure is invalid.',
      );
      return publicRecord(record);
    },

    /** Must complete successfully before the caller is allowed to broadcast. */
    async persistSignedTransaction(identityValue, signedValue, persistOptions = {}) {
      const identity = identityFrom(identityValue);
      const expectedRevision = exactRevision(persistOptions.expectedRevision ?? 0, { zero: true });
      const sessionId = exactSession(persistOptions.sessionId);
      const signed = await exactSigned(signedValue, deriveDigest, now);
      const record = await withDatabase(indexedDB, [
        EXPANSION_PACK_LIFECYCLE_PENDING_STORE,
        EXPANSION_PACK_LIFECYCLE_RECEIPT_STORE,
        EXPANSION_PACK_LIFECYCLE_FAILURE_STORE,
        LEGACY_V1_PENDING_STORE,
      ], 'readwrite', async (tx) => {
        const pendingStore = tx.objectStore(EXPANSION_PACK_LIFECYCLE_PENDING_STORE);
        const [releasePending, legacyReleasePending, pending, receipt, failure] = await Promise.all([
          requestResult(pendingStore.index('walletReleaseKey').getAll(identity.walletReleaseKey)),
          requestResult(tx.objectStore(LEGACY_V1_PENDING_STORE)
            .index('walletReleaseKey').getAll(identity.walletReleaseKey)),
          requestResult(pendingStore.get(identity.key)),
          requestResult(tx.objectStore(EXPANSION_PACK_LIFECYCLE_RECEIPT_STORE).get(identity.key)),
          requestResult(tx.objectStore(EXPANSION_PACK_LIFECYCLE_FAILURE_STORE)
            .get(failureKey(identity, signed.digest))),
        ]);
        if (receipt) fail(EXPANSION_PACK_LIFECYCLE_RECOVERY_ERROR.ALREADY_COMPLETED,
          'This lifecycle action already has verified readback.');
        if (failure) fail(EXPANSION_PACK_LIFECYCLE_RECOVERY_ERROR.ALREADY_FINALIZED_FAILED,
          'This exact transaction finalized with failure and cannot be replayed.');
        if ((legacyReleasePending || []).length) fail(
          EXPANSION_PACK_LIFECYCLE_RECOVERY_ERROR.LEGACY_RECOVERY_REQUIRED,
          'A pre-release lifecycle transaction for this wallet and Release must be resolved before signing again.',
          { walletReleaseKey: identity.walletReleaseKey },
        );
        const conflicting = (releasePending || []).find((record) => record?.key !== identity.key);
        if (conflicting) fail(
          EXPANSION_PACK_LIFECYCLE_RECOVERY_ERROR.CAS_CONFLICT,
          'Another lifecycle transition is already pending for this wallet and Release.',
          { pendingKey: text(conflicting.key), requestedKey: identity.key },
        );
        const actualRevision = pending?.revision ?? 0;
        if (actualRevision !== expectedRevision) fail(
          EXPANSION_PACK_LIFECYCLE_RECOVERY_ERROR.CAS_CONFLICT,
          'Lifecycle recovery changed in another operation.',
          { expectedRevision, actualRevision },
        );
        if (pending) {
          if (pending.sessionId !== sessionId) fail(
            EXPANSION_PACK_LIFECYCLE_RECOVERY_ERROR.SESSION_CONFLICT,
            'Lifecycle recovery belongs to another signing session.',
          );
          if (!sameSigned(pending.signed, signed)) fail(
            EXPANSION_PACK_LIFECYCLE_RECOVERY_ERROR.SIGNED_IMMUTABLE,
            'Persisted signed bytes, signature and digest are immutable.',
          );
          return pending;
        }
        const timestamp = Number(now());
        const next = {
          schemaVersion: EXPANSION_PACK_LIFECYCLE_RECOVERY_SCHEMA,
          ...identity,
          revision: 1,
          sessionId,
          state: EXPANSION_PACK_LIFECYCLE_RECOVERY_STATE.SIGNED,
          attemptCount: 0,
          lastErrorCode: '',
          signed,
          savedAt: timestamp,
          updatedAt: timestamp,
        };
        pendingStore.put(next);
        return next;
      });
      const readback = await api.loadPending(identity);
      if (!readback || readback.revision !== record.revision || !sameSigned(readback.signed, signed)) fail(
        EXPANSION_PACK_LIFECYCLE_RECOVERY_ERROR.READBACK_MISMATCH,
        'Signed lifecycle transaction did not survive durable readback.',
      );
      return deepFreeze({ saved: true, verified: true, idempotent: expectedRevision > 0, record: readback });
    },

    async checkpointPending(identityValue, patch = {}, updateOptions = {}) {
      const identity = identityFrom(identityValue);
      const expectedRevision = exactRevision(updateOptions.expectedRevision);
      const sessionId = exactSession(updateOptions.sessionId);
      const state = required(patch.state, 'Pending state').toUpperCase();
      if (!Object.values(EXPANSION_PACK_LIFECYCLE_RECOVERY_STATE).includes(state)) fail(
        EXPANSION_PACK_LIFECYCLE_RECOVERY_ERROR.IDENTITY_INVALID, 'Unsupported pending state.',
      );
      return publicRecord(await withDatabase(indexedDB, [EXPANSION_PACK_LIFECYCLE_PENDING_STORE],
        'readwrite', async (tx) => {
          const store = tx.objectStore(EXPANSION_PACK_LIFECYCLE_PENDING_STORE);
          const pending = await requestResult(store.get(identity.key));
          if (!pending) fail(EXPANSION_PACK_LIFECYCLE_RECOVERY_ERROR.PENDING_MISSING,
            'Pending lifecycle transaction is missing.');
          if (pending.revision !== expectedRevision) fail(
            EXPANSION_PACK_LIFECYCLE_RECOVERY_ERROR.CAS_CONFLICT,
            'Lifecycle recovery changed in another operation.',
            { expectedRevision, actualRevision: pending.revision },
          );
          if (pending.sessionId !== sessionId) fail(
            EXPANSION_PACK_LIFECYCLE_RECOVERY_ERROR.SESSION_CONFLICT,
            'Lifecycle recovery belongs to another signing session.',
          );
          const next = {
            ...pending,
            revision: pending.revision + 1,
            state,
            attemptCount: pending.attemptCount + (state === 'BROADCASTING' ? 1 : 0),
            lastErrorCode: text(patch.lastErrorCode),
            updatedAt: Number(now()),
          };
          store.put(next);
          return next;
        }));
    },

    async storeVerifiedReceipt(identityValue, receiptValue, updateOptions = {}) {
      const identity = identityFrom(identityValue);
      const expectedRevision = exactRevision(updateOptions.expectedRevision);
      const sessionId = exactSession(updateOptions.sessionId);
      return publicRecord(await withDatabase(indexedDB, [
        EXPANSION_PACK_LIFECYCLE_PENDING_STORE,
        EXPANSION_PACK_LIFECYCLE_RECEIPT_STORE,
      ], 'readwrite', async (tx) => {
        const pendingStore = tx.objectStore(EXPANSION_PACK_LIFECYCLE_PENDING_STORE);
        const pending = await requestResult(pendingStore.get(identity.key));
        if (!pending) fail(EXPANSION_PACK_LIFECYCLE_RECOVERY_ERROR.PENDING_MISSING,
          'Pending lifecycle transaction is missing.');
        if (pending.revision !== expectedRevision) fail(
          EXPANSION_PACK_LIFECYCLE_RECOVERY_ERROR.CAS_CONFLICT,
          'Lifecycle recovery changed in another operation.',
          { expectedRevision, actualRevision: pending.revision },
        );
        if (pending.sessionId !== sessionId) fail(
          EXPANSION_PACK_LIFECYCLE_RECOVERY_ERROR.SESSION_CONFLICT,
          'Lifecycle recovery belongs to another signing session.',
        );
        if (receiptValue?.readbackVerified !== true
          || Number(receiptValue.previousLifecycle) !== identity.fromLifecycle
          || Number(receiptValue.lifecycle) !== identity.toLifecycle) fail(
          EXPANSION_PACK_LIFECYCLE_RECOVERY_ERROR.RECEIPT_INVALID,
          'Receipt must contain exact verified LifecycleChanged and Release readback.',
        );
        const digest = required(receiptValue.transactionDigest ?? receiptValue.digest, 'Transaction digest');
        if (digest !== pending.signed.digest) fail(
          EXPANSION_PACK_LIFECYCLE_RECOVERY_ERROR.DIGEST_MISMATCH,
          'Receipt digest does not match persisted signed bytes.',
        );
        const receipt = {
          schemaVersion: EXPANSION_PACK_LIFECYCLE_RECEIPT_SCHEMA,
          ...identity,
          transactionDigest: digest,
          executionStatus: 'SUCCESS',
          verifiedReadback: true,
          previousLifecycle: identity.fromLifecycle,
          lifecycle: identity.toLifecycle,
          pendingRevision: pending.revision,
          sessionId,
          verifiedAt: Number(now()),
        };
        tx.objectStore(EXPANSION_PACK_LIFECYCLE_RECEIPT_STORE).put(receipt);
        pendingStore.delete(identity.key);
        return receipt;
      }));
    },

    async storeFinalizedFailure(identityValue, failureValue, updateOptions = {}) {
      const identity = identityFrom(identityValue);
      const expectedRevision = exactRevision(updateOptions.expectedRevision);
      const sessionId = exactSession(updateOptions.sessionId);
      return publicRecord(await withDatabase(indexedDB, [
        EXPANSION_PACK_LIFECYCLE_PENDING_STORE,
        EXPANSION_PACK_LIFECYCLE_FAILURE_STORE,
      ], 'readwrite', async (tx) => {
        const pendingStore = tx.objectStore(EXPANSION_PACK_LIFECYCLE_PENDING_STORE);
        const pending = await requestResult(pendingStore.get(identity.key));
        if (!pending) fail(EXPANSION_PACK_LIFECYCLE_RECOVERY_ERROR.PENDING_MISSING,
          'Pending lifecycle transaction is missing.');
        if (pending.revision !== expectedRevision) fail(
          EXPANSION_PACK_LIFECYCLE_RECOVERY_ERROR.CAS_CONFLICT,
          'Lifecycle recovery changed in another operation.',
          { expectedRevision, actualRevision: pending.revision },
        );
        if (pending.sessionId !== sessionId) fail(
          EXPANSION_PACK_LIFECYCLE_RECOVERY_ERROR.SESSION_CONFLICT,
          'Lifecycle recovery belongs to another signing session.',
        );
        const digest = required(failureValue.transactionDigest ?? failureValue.digest,
          'Transaction digest');
        if (failureValue.finalized !== true
          || text(failureValue.executionStatus).toUpperCase() !== 'FAILURE') fail(
          EXPANSION_PACK_LIFECYCLE_RECOVERY_ERROR.FINALIZED_FAILURE_INVALID,
          'Only definitive finalized failure evidence can retire signed bytes.',
        );
        if (digest !== pending.signed.digest) fail(
          EXPANSION_PACK_LIFECYCLE_RECOVERY_ERROR.DIGEST_MISMATCH,
          'Failure digest does not match persisted signed bytes.',
        );
        const failure = {
          schemaVersion: EXPANSION_PACK_LIFECYCLE_FAILURE_SCHEMA,
          ...identity,
          failureKey: failureKey(identity, digest),
          transactionDigest: digest,
          finalized: true,
          executionStatus: 'FAILURE',
          executionError: {
            kind: text(failureValue.executionError?.kind) || 'Unknown',
            message: text(failureValue.executionError?.message) || 'Sui transaction failed.',
          },
          pendingRevision: pending.revision,
          sessionId,
          failedAt: Number(now()),
        };
        tx.objectStore(EXPANSION_PACK_LIFECYCLE_FAILURE_STORE).put(failure);
        pendingStore.delete(identity.key);
        return failure;
      }));
    },
  };
  return Object.freeze(api);
}
