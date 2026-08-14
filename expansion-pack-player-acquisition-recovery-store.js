/**
 * Durable recovery for Expansion Pack v8 Player acquisition transactions.
 *
 * The store deliberately persists only immutable acquisition identity, exact
 * signed transaction material, small retry-state fields, and verified Pass
 * readback evidence. Pack manifests and asset bytes never belong here.
 */

import { fromBase64 } from '@mysten/bcs';
import { TransactionDataBuilder } from '@mysten/sui/transactions';
import { normalizeSuiAddress } from '@mysten/sui/utils';

export const EXPANSION_PACK_PLAYER_ACQUISITION_RECOVERY_SCHEMA =
  'animacraft.expansion-pack-player-acquisition-recovery.v1';
export const EXPANSION_PACK_PLAYER_ACQUISITION_RECEIPT_SCHEMA =
  'animacraft.expansion-pack-player-acquisition-receipt.v1';
export const EXPANSION_PACK_PLAYER_ACQUISITION_FAILURE_SCHEMA =
  'animacraft.expansion-pack-player-acquisition-finalized-failure.v1';
export const EXPANSION_PACK_PLAYER_ACQUISITION_DATABASE_NAME =
  'animacraft-expansion-pack-player-acquisition-v8';
export const EXPANSION_PACK_PLAYER_ACQUISITION_DATABASE_VERSION = 2;
export const EXPANSION_PACK_PLAYER_ACQUISITION_PENDING_STORE = 'pending-acquisitions';
export const EXPANSION_PACK_PLAYER_ACQUISITION_RECEIPT_STORE = 'verified-receipts';
export const EXPANSION_PACK_PLAYER_ACQUISITION_FAILURE_STORE = 'finalized-failures';

export const EXPANSION_PACK_PLAYER_ACQUISITION_STATE = Object.freeze({
  SIGNED: 'SIGNED',
  BROADCASTING: 'BROADCASTING',
  OUTCOME_PENDING: 'OUTCOME_PENDING',
});

export const EXPANSION_PACK_PLAYER_ACQUISITION_ERROR = Object.freeze({
  IDENTITY_MISSING: 'EXPANSION_PACK_PLAYER_ACQUISITION_IDENTITY_MISSING',
  OBJECT_ID_INVALID: 'EXPANSION_PACK_PLAYER_ACQUISITION_OBJECT_ID_INVALID',
  VERSION_INVALID: 'EXPANSION_PACK_PLAYER_ACQUISITION_VERSION_INVALID',
  ACCESS_INVALID: 'EXPANSION_PACK_PLAYER_ACQUISITION_ACCESS_INVALID',
  PRICE_INVALID: 'EXPANSION_PACK_PLAYER_ACQUISITION_PRICE_INVALID',
  COMMITMENT_INVALID: 'EXPANSION_PACK_PLAYER_ACQUISITION_COMMITMENT_INVALID',
  SESSION_INVALID: 'EXPANSION_PACK_PLAYER_ACQUISITION_SESSION_INVALID',
  REVISION_INVALID: 'EXPANSION_PACK_PLAYER_ACQUISITION_REVISION_INVALID',
  STATE_INVALID: 'EXPANSION_PACK_PLAYER_ACQUISITION_STATE_INVALID',
  SIGNED_BYTES_INVALID: 'EXPANSION_PACK_PLAYER_ACQUISITION_SIGNED_BYTES_INVALID',
  SIGNATURE_INVALID: 'EXPANSION_PACK_PLAYER_ACQUISITION_SIGNATURE_INVALID',
  DIGEST_INVALID: 'EXPANSION_PACK_PLAYER_ACQUISITION_DIGEST_INVALID',
  DIGEST_MISMATCH: 'EXPANSION_PACK_PLAYER_ACQUISITION_DIGEST_MISMATCH',
  CAS_CONFLICT: 'EXPANSION_PACK_PLAYER_ACQUISITION_CAS_CONFLICT',
  SESSION_CONFLICT: 'EXPANSION_PACK_PLAYER_ACQUISITION_SESSION_CONFLICT',
  SIGNED_TRANSACTION_IMMUTABLE:
    'EXPANSION_PACK_PLAYER_ACQUISITION_SIGNED_TRANSACTION_IMMUTABLE',
  ALREADY_COMPLETED: 'EXPANSION_PACK_PLAYER_ACQUISITION_ALREADY_COMPLETED',
  PENDING_MISSING: 'EXPANSION_PACK_PLAYER_ACQUISITION_PENDING_MISSING',
  RECEIPT_INVALID: 'EXPANSION_PACK_PLAYER_ACQUISITION_RECEIPT_INVALID',
  RECEIPT_IDENTITY_MISMATCH:
    'EXPANSION_PACK_PLAYER_ACQUISITION_RECEIPT_IDENTITY_MISMATCH',
  RECEIPT_IMMUTABLE: 'EXPANSION_PACK_PLAYER_ACQUISITION_RECEIPT_IMMUTABLE',
  RECEIPT_REQUIRED: 'EXPANSION_PACK_PLAYER_ACQUISITION_RECEIPT_REQUIRED',
  FINALIZED_FAILURE_INVALID:
    'EXPANSION_PACK_PLAYER_ACQUISITION_FINALIZED_FAILURE_INVALID',
  FINALIZED_FAILURE_IMMUTABLE:
    'EXPANSION_PACK_PLAYER_ACQUISITION_FINALIZED_FAILURE_IMMUTABLE',
  ALREADY_FINALIZED_FAILED:
    'EXPANSION_PACK_PLAYER_ACQUISITION_ALREADY_FINALIZED_FAILED',
  INDEXEDDB_UNAVAILABLE: 'EXPANSION_PACK_PLAYER_ACQUISITION_INDEXEDDB_UNAVAILABLE',
  DATABASE_BLOCKED: 'EXPANSION_PACK_PLAYER_ACQUISITION_DATABASE_BLOCKED',
  DATABASE_OPEN_FAILED: 'EXPANSION_PACK_PLAYER_ACQUISITION_DATABASE_OPEN_FAILED',
  STORAGE_READ_FAILED: 'EXPANSION_PACK_PLAYER_ACQUISITION_STORAGE_READ_FAILED',
  STORAGE_TRANSACTION_FAILED:
    'EXPANSION_PACK_PLAYER_ACQUISITION_STORAGE_TRANSACTION_FAILED',
  READBACK_MISMATCH: 'EXPANSION_PACK_PLAYER_ACQUISITION_READBACK_MISMATCH',
});

const HASH = /^(?:0x)?[0-9a-f]{64}$/i;
const SESSION = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/;
const ERROR_CODE = /^[A-Z][A-Z0-9_]{2,127}$/;
const U64_MAX = (1n << 64n) - 1n;

export class ExpansionPackPlayerAcquisitionRecoveryStoreError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'ExpansionPackPlayerAcquisitionRecoveryStoreError';
    this.code = code;
    this.details = details;
  }
}

function error(code, message, details = {}) {
  return new ExpansionPackPlayerAcquisitionRecoveryStoreError(message, code, details);
}

function fail(code, message, details = {}) {
  throw error(code, message, details);
}

function text(value) {
  return String(value ?? '').trim();
}

function required(value, label) {
  const result = text(value);
  if (!result) fail(
    EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.IDENTITY_MISSING,
    `${label} is required.`,
    { label },
  );
  return result;
}

function exactObjectId(value, label) {
  const result = required(value, label);
  try {
    return normalizeSuiAddress(result);
  } catch {
    fail(
      EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.OBJECT_ID_INVALID,
      `${label} must be an exact Sui object id.`,
      { label, value: result },
    );
  }
}

function exactVersionId(value) {
  const result = required(value, 'Parent Maker version id');
  if (!/^0x[0-9a-f]+$/i.test(result)) return result;
  try {
    return normalizeSuiAddress(result);
  } catch {
    fail(
      EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.VERSION_INVALID,
      'Parent Maker version id is not a valid exact identifier.',
      { value: result },
    );
  }
}

function exactU64(value, label, { positive = false, code } = {}) {
  let result;
  try {
    if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error('unsafe');
    result = BigInt(required(value, label));
  } catch {
    fail(
      code || EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.PRICE_INVALID,
      `${label} must be an exact unsigned integer.`,
      { label, value: text(value) },
    );
  }
  if (result < 0n || result > U64_MAX || (positive && result === 0n)) fail(
    code || EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.PRICE_INVALID,
    `${label} is outside its supported unsigned integer range.`,
    { label, value: text(value) },
  );
  return result.toString();
}

function exactCommitment(value, label) {
  const result = required(value, label).replace(/^0x/i, '').toLowerCase();
  if (!HASH.test(result)) fail(
    EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.COMMITMENT_INVALID,
    `${label} must be an exact 32-byte commitment.`,
    { label },
  );
  return result;
}

function exactAccessKind(value) {
  const result = text(value).toUpperCase();
  if (value === 0 || result === '0' || result === 'FREE') return 'FREE';
  if (value === 1 || result === '1' || result === 'PAID_ONCE') return 'PAID_ONCE';
  fail(
    EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.ACCESS_INVALID,
    'Expansion Pack acquisition access kind must be FREE or PAID_ONCE.',
    { value: text(value) },
  );
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
}

function publicRecord(record) {
  return record ? freeze(clone(record)) : null;
}

function identityFrom(value = {}) {
  const parent = value.parent || {};
  const access = value.access || {};
  const release = value.release || {};
  const walletAddress = exactObjectId(
    value.walletAddress ?? value.wallet ?? value.holder ?? value.owner,
    'Wallet address',
  );
  const parentRootId = exactObjectId(
    value.parentRootId ?? value.baseMakerRootId ?? parent.baseMakerRootId,
    'Parent Maker root id',
  );
  const makerVersionNumber = exactU64(
    value.makerVersionNumber ?? value.parentVersionNumber ?? parent.versionNumber,
    'Parent Maker version number',
    { positive: true, code: EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.VERSION_INVALID },
  );
  const makerVersionId = exactVersionId(
    value.makerVersionId ?? value.parentVersionId ?? parent.versionId,
  );
  const releaseId = exactObjectId(
    value.releaseId ?? release.objectId,
    'Expansion Pack release id',
  );
  const accessKind = exactAccessKind(value.accessKind ?? access.kind ?? release.accessKind);
  const priceAtomic = exactU64(
    value.priceAtomic ?? value.purchasePriceAtomic ?? access.priceAtomic
      ?? release.purchasePriceAtomic,
    'Expansion Pack acquisition price',
  );
  if ((accessKind === 'FREE' && priceAtomic !== '0')
    || (accessKind === 'PAID_ONCE' && priceAtomic === '0')) fail(
    EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.PRICE_INVALID,
    'Expansion Pack access kind and exact acquisition price do not match.',
    { accessKind, priceAtomic },
  );
  const contentCommitment = exactCommitment(
    value.contentCommitment ?? release.contentCommitment,
    'Expansion Pack content commitment',
  );
  const key = [
    EXPANSION_PACK_PLAYER_ACQUISITION_RECOVERY_SCHEMA,
    walletAddress,
    parentRootId,
    makerVersionNumber,
    makerVersionId,
    releaseId,
    accessKind,
    priceAtomic,
    contentCommitment,
  ].map((part) => encodeURIComponent(part)).join(':');
  return freeze({
    walletAddress,
    parentRootId,
    makerVersionNumber,
    makerVersionId,
    releaseId,
    accessKind,
    priceAtomic,
    contentCommitment,
    key,
    walletParentKey: [walletAddress, parentRootId].map(encodeURIComponent).join(':'),
    parentVersionKey: [parentRootId, makerVersionNumber, makerVersionId]
      .map(encodeURIComponent).join(':'),
    releaseKey: [releaseId, contentCommitment].map(encodeURIComponent).join(':'),
  });
}

export function expansionPackPlayerAcquisitionIdentity(value) {
  return identityFrom(value);
}

export function expansionPackPlayerAcquisitionKey(value) {
  return identityFrom(value).key;
}

function sessionId(value) {
  const result = text(value);
  if (!SESSION.test(result)) fail(
    EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.SESSION_INVALID,
    'Acquisition recovery session id must be an opaque 8-160 character token.',
  );
  return result;
}

function revision(value, { allowZero = false } = {}) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < (allowZero ? 0 : 1)) fail(
    EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.REVISION_INVALID,
    `Acquisition recovery revision must be ${allowZero ? 'non-negative' : 'positive'}.`,
    { value },
  );
  return result;
}

function pendingState(value) {
  const result = text(value).toUpperCase();
  if (!Object.values(EXPANSION_PACK_PLAYER_ACQUISITION_STATE).includes(result)) fail(
    EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.STATE_INVALID,
    'Acquisition recovery state is unsupported.',
    { value: text(value) },
  );
  return result;
}

function retryErrorCode(value) {
  const result = text(value);
  if (result && !ERROR_CODE.test(result)) fail(
    EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.STATE_INVALID,
    'Acquisition retry error code must be a stable machine-readable code.',
  );
  return result;
}

function defaultDigestSignedBytes(bytes) {
  return TransactionDataBuilder.getDigestFromBytes(fromBase64(bytes));
}

async function signedTransaction(value, deriveTransactionDigest, now) {
  const bytes = typeof value?.bytes === 'string' ? value.bytes : '';
  if (!bytes || bytes !== bytes.trim()) fail(
    EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.SIGNED_BYTES_INVALID,
    'Exact base64 signed transaction bytes are required.',
  );
  let derivedDigest;
  try {
    const decoded = fromBase64(bytes);
    if (!decoded.length) throw new Error('empty');
    derivedDigest = text(await deriveTransactionDigest(bytes));
  } catch {
    fail(
      EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.SIGNED_BYTES_INVALID,
      'Signed transaction bytes are not valid non-empty base64 transaction bytes.',
    );
  }
  if (!derivedDigest) fail(
    EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.DIGEST_INVALID,
    'A digest could not be derived from the exact signed transaction bytes.',
  );
  const signature = typeof value?.signature === 'string' ? value.signature : '';
  if (!signature || signature !== signature.trim()) fail(
    EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.SIGNATURE_INVALID,
    'An exact serialized transaction signature is required.',
  );
  for (const field of ['digest', 'transactionDigest']) {
    const supplied = text(value?.[field]);
    if (supplied && supplied !== derivedDigest) fail(
      EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.DIGEST_MISMATCH,
      `The persisted ${field} does not match the exact signed transaction bytes.`,
      { field, suppliedDigest: supplied, derivedDigest },
    );
  }
  return freeze({
    bytes,
    signature,
    digest: derivedDigest,
    signedAt: text(value?.signedAt) || new Date(now()).toISOString(),
  });
}

function sameSigned(left, right) {
  return left?.bytes === right?.bytes
    && left?.signature === right?.signature
    && left?.digest === right?.digest;
}

function sameIdentity(left, right) {
  return left?.key === right?.key;
}

async function validateStoredPending(record, identity, deriveTransactionDigest, now) {
  if (!record) return null;
  if (record.schemaVersion !== EXPANSION_PACK_PLAYER_ACQUISITION_RECOVERY_SCHEMA) fail(
    EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.READBACK_MISMATCH,
    'Stored acquisition recovery schema is unsupported.',
  );
  const storedIdentity = identityFrom(record);
  if (!sameIdentity(identity, storedIdentity) || record.key !== identity.key) fail(
    EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.READBACK_MISMATCH,
    'Stored acquisition recovery identity does not match its exact key.',
  );
  revision(record.revision);
  sessionId(record.sessionId);
  pendingState(record.state);
  if (!Number.isSafeInteger(record.attemptCount) || record.attemptCount < 0) fail(
    EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.READBACK_MISMATCH,
    'Stored acquisition retry count is invalid.',
  );
  retryErrorCode(record.lastErrorCode);
  const exactSigned = await signedTransaction(record.signed, deriveTransactionDigest, now);
  if (!sameSigned(exactSigned, record.signed)) fail(
    EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.DIGEST_MISMATCH,
    'Stored acquisition digest no longer matches its exact signed bytes.',
  );
  return record;
}

function validateStoredReceipt(record, identity) {
  if (!record) return null;
  if (record.schemaVersion !== EXPANSION_PACK_PLAYER_ACQUISITION_RECEIPT_SCHEMA
    || record.verifiedReadback !== true) fail(
    EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.READBACK_MISMATCH,
    'Stored acquisition receipt is not verified readback evidence.',
  );
  const storedIdentity = identityFrom(record);
  if (!sameIdentity(identity, storedIdentity) || record.key !== identity.key) fail(
    EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.READBACK_MISMATCH,
    'Stored acquisition receipt identity does not match its exact key.',
  );
  exactObjectId(record.passId, 'Expansion Pack Pass id');
  required(record.transactionDigest, 'Transaction digest');
  revision(record.receiptRevision);
  revision(record.pendingRevision);
  sessionId(record.sessionId);
  return record;
}

function failureKey(identity, digest) {
  return `${identity.key}:${encodeURIComponent(required(digest, 'Transaction digest'))}`;
}

function normalizedExecutionError(value = {}) {
  const message = text(value.message) || 'The Sui transaction failed.';
  const kind = text(value.kind) || 'Unknown';
  const abortCode = text(value.abortCode);
  const numericCommand = value.command == null ? null : Number(value.command);
  if (message.length > 2_000 || kind.length > 160 || abortCode.length > 160
    || (numericCommand != null
      && (!Number.isSafeInteger(numericCommand) || numericCommand < 0))) fail(
    EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.FINALIZED_FAILURE_INVALID,
    'Finalized transaction failure evidence is malformed.',
  );
  return freeze({
    kind,
    message,
    command: numericCommand,
    abortCode,
  });
}

function normalizeFinalizedFailure(identity, pending, value, now) {
  if (value?.finalized !== true || text(value?.executionStatus).toUpperCase() !== 'FAILURE') fail(
    EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.FINALIZED_FAILURE_INVALID,
    'Only definitive finalized Sui failure evidence can retire replay bytes.',
  );
  const transactionDigest = required(value.transactionDigest ?? value.digest, 'Transaction digest');
  if (transactionDigest !== pending.signed.digest) fail(
    EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.DIGEST_MISMATCH,
    'Finalized failure evidence does not match the persisted signed transaction digest.',
    { transactionDigest, signedDigest: pending.signed.digest },
  );
  const failedAt = Number(now());
  return freeze({
    schemaVersion: EXPANSION_PACK_PLAYER_ACQUISITION_FAILURE_SCHEMA,
    ...identity,
    failureKey: failureKey(identity, transactionDigest),
    transactionDigest,
    finalized: true,
    executionStatus: 'FAILURE',
    executionError: normalizedExecutionError(value.executionError),
    pendingRevision: pending.revision,
    sessionId: pending.sessionId,
    attemptCount: pending.attemptCount,
    failedAt: Number.isFinite(failedAt) ? failedAt : Date.now(),
  });
}

function sameFinalizedFailure(left, right) {
  return left?.failureKey === right?.failureKey
    && left?.transactionDigest === right?.transactionDigest
    && left?.pendingRevision === right?.pendingRevision
    && left?.sessionId === right?.sessionId
    && left?.executionStatus === right?.executionStatus
    && JSON.stringify(left?.executionError) === JSON.stringify(right?.executionError);
}

function validateStoredFailure(record, identity, digest) {
  if (!record) return null;
  if (record.schemaVersion !== EXPANSION_PACK_PLAYER_ACQUISITION_FAILURE_SCHEMA
    || record.finalized !== true
    || record.executionStatus !== 'FAILURE') fail(
    EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.READBACK_MISMATCH,
    'Stored acquisition failure is not definitive finalized evidence.',
  );
  const storedIdentity = identityFrom(record);
  const expectedKey = failureKey(identity, digest);
  if (!sameIdentity(identity, storedIdentity)
    || record.key !== identity.key
    || record.failureKey !== expectedKey
    || record.transactionDigest !== digest) fail(
    EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.READBACK_MISMATCH,
    'Stored finalized failure identity or digest does not match its exact key.',
  );
  revision(record.pendingRevision);
  sessionId(record.sessionId);
  if (!Number.isSafeInteger(record.attemptCount) || record.attemptCount < 0) fail(
    EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.READBACK_MISMATCH,
    'Stored finalized failure retry count is invalid.',
  );
  normalizedExecutionError(record.executionError);
  return record;
}

function normalizeReceipt(identity, pending, value, now) {
  if (value?.verifiedReadback !== true) fail(
    EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.RECEIPT_INVALID,
    'Cleanup requires an explicitly verified chain readback receipt.',
  );
  const receiptIdentity = identityFrom({
    walletAddress: value.holder ?? value.walletAddress,
    parentRootId: value.parentRootId,
    makerVersionNumber: value.makerVersionNumber ?? value.parentVersionNumber,
    makerVersionId: value.makerVersionId ?? value.parentVersionId,
    releaseId: value.releaseId,
    accessKind: value.accessKind,
    priceAtomic: value.priceAtomic ?? value.paidAtomic,
    contentCommitment: value.contentCommitment,
  });
  if (!sameIdentity(identity, receiptIdentity)) fail(
    EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.RECEIPT_IDENTITY_MISMATCH,
    'Verified Pass readback belongs to another wallet, parent, Maker version, release or price.',
  );
  const transactionDigest = required(value.transactionDigest ?? value.digest, 'Transaction digest');
  if (transactionDigest !== pending.signed.digest) fail(
    EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.DIGEST_MISMATCH,
    'Verified Pass readback does not match the persisted signed transaction digest.',
    { transactionDigest, signedDigest: pending.signed.digest },
  );
  const passId = exactObjectId(value.passId ?? value.objectId, 'Expansion Pack Pass id');
  return freeze({
    schemaVersion: EXPANSION_PACK_PLAYER_ACQUISITION_RECEIPT_SCHEMA,
    ...identity,
    passId,
    transactionDigest,
    verifiedReadback: true,
    verifiedAt: Number(now()),
  });
}

function storageError(code, message, cause) {
  if (cause instanceof ExpansionPackPlayerAcquisitionRecoveryStoreError) return cause;
  return error(code, message, {
    causeName: text(cause?.name),
    causeMessage: text(cause?.message),
  });
}

function requestResult(request, message) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(storageError(
      EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.STORAGE_READ_FAILED,
      message,
      request.error,
    ));
  });
}

function transactionComplete(transaction, callbackError = null) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => (
      callbackError?.current ? reject(callbackError.current) : resolve()
    );
    transaction.onabort = () => reject(
      callbackError?.current
      || storageError(
        EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.STORAGE_TRANSACTION_FAILED,
        'Acquisition recovery storage transaction was aborted.',
        transaction.error,
      )
    );
    transaction.onerror = () => {};
  });
}

function openDatabase(indexedDb) {
  if (!indexedDb) fail(
    EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.INDEXEDDB_UNAVAILABLE,
    'This browser cannot durably recover Expansion Pack acquisition transactions.',
  );
  return new Promise((resolve, reject) => {
    const request = indexedDb.open(
      EXPANSION_PACK_PLAYER_ACQUISITION_DATABASE_NAME,
      EXPANSION_PACK_PLAYER_ACQUISITION_DATABASE_VERSION,
    );
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(
        EXPANSION_PACK_PLAYER_ACQUISITION_PENDING_STORE,
      )) {
        const pending = database.createObjectStore(
          EXPANSION_PACK_PLAYER_ACQUISITION_PENDING_STORE,
          { keyPath: 'key' },
        );
        pending.createIndex('walletParentKey', 'walletParentKey', { unique: false });
        pending.createIndex('parentVersionKey', 'parentVersionKey', { unique: false });
        pending.createIndex('releaseKey', 'releaseKey', { unique: false });
      }
      if (!database.objectStoreNames.contains(
        EXPANSION_PACK_PLAYER_ACQUISITION_RECEIPT_STORE,
      )) {
        const receipts = database.createObjectStore(
          EXPANSION_PACK_PLAYER_ACQUISITION_RECEIPT_STORE,
          { keyPath: 'key' },
        );
        receipts.createIndex('walletParentKey', 'walletParentKey', { unique: false });
        receipts.createIndex('releaseKey', 'releaseKey', { unique: false });
      }
      if (!database.objectStoreNames.contains(
        EXPANSION_PACK_PLAYER_ACQUISITION_FAILURE_STORE,
      )) {
        const failures = database.createObjectStore(
          EXPANSION_PACK_PLAYER_ACQUISITION_FAILURE_STORE,
          { keyPath: 'failureKey' },
        );
        failures.createIndex('key', 'key', { unique: false });
        failures.createIndex('walletParentKey', 'walletParentKey', { unique: false });
        failures.createIndex('releaseKey', 'releaseKey', { unique: false });
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onblocked = () => reject(error(
      EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.DATABASE_BLOCKED,
      'Close other Animacraft tabs once so Player acquisition recovery can be upgraded.',
    ));
    request.onerror = () => reject(storageError(
      EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.DATABASE_OPEN_FAILED,
      'Player acquisition recovery storage could not be opened.',
      request.error,
    ));
  });
}

function abortWith(transaction, callbackError, value) {
  callbackError.current = value;
  transaction.abort();
}

function casConflict(expectedRevision, actualRevision) {
  return error(
    EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.CAS_CONFLICT,
    'Acquisition recovery changed in another operation. Reload the exact pending record.',
    { expectedRevision, actualRevision },
  );
}

function assertSession(expected, actual) {
  if (expected !== actual) fail(
    EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.SESSION_CONFLICT,
    'Acquisition recovery belongs to another signing session.',
    { expectedSessionId: expected, actualSessionId: actual },
  );
}

function verifiedPendingReadback(record, identity, signed, expectedRevision, expectedSessionId) {
  return Boolean(
    record
    && record.schemaVersion === EXPANSION_PACK_PLAYER_ACQUISITION_RECOVERY_SCHEMA
    && record.key === identity.key
    && record.revision === expectedRevision
    && record.sessionId === expectedSessionId
    && sameSigned(record.signed, signed)
  );
}

/**
 * Create the production IndexedDB store. Tests and non-browser hosts can inject
 * an IndexedDB-compatible factory and deterministic digest/clock functions.
 */
export function createExpansionPackPlayerAcquisitionRecoveryStore(options = {}) {
  const indexedDb = options.indexedDB ?? globalThis.indexedDB;
  const now = typeof options.clock === 'function' ? options.clock : Date.now;
  const deriveTransactionDigest = typeof options.deriveTransactionDigest === 'function'
    ? options.deriveTransactionDigest
    : defaultDigestSignedBytes;

  const api = {
    async loadPending(identityValue) {
      const identity = identityFrom(identityValue);
      const database = await openDatabase(indexedDb);
      try {
        const transaction = database.transaction(
          EXPANSION_PACK_PLAYER_ACQUISITION_PENDING_STORE,
          'readonly',
        );
        const completion = transactionComplete(transaction);
        const record = await requestResult(
          transaction.objectStore(EXPANSION_PACK_PLAYER_ACQUISITION_PENDING_STORE)
            .get(identity.key),
          'Pending acquisition transaction could not be loaded.',
        );
        await completion;
        return publicRecord(await validateStoredPending(
          record,
          identity,
          deriveTransactionDigest,
          now,
        ));
      } finally {
        database.close();
      }
    },

    async loadVerifiedReceipt(identityValue) {
      const identity = identityFrom(identityValue);
      const database = await openDatabase(indexedDb);
      try {
        const transaction = database.transaction(
          EXPANSION_PACK_PLAYER_ACQUISITION_RECEIPT_STORE,
          'readonly',
        );
        const completion = transactionComplete(transaction);
        const record = await requestResult(
          transaction.objectStore(EXPANSION_PACK_PLAYER_ACQUISITION_RECEIPT_STORE)
            .get(identity.key),
          'Verified acquisition receipt could not be loaded.',
        );
        await completion;
        return publicRecord(validateStoredReceipt(record, identity));
      } finally {
        database.close();
      }
    },

    async loadFinalizedFailure(identityValue, digestValue) {
      const identity = identityFrom(identityValue);
      const digest = required(digestValue, 'Transaction digest');
      const database = await openDatabase(indexedDb);
      try {
        const transaction = database.transaction(
          EXPANSION_PACK_PLAYER_ACQUISITION_FAILURE_STORE,
          'readonly',
        );
        const completion = transactionComplete(transaction);
        const record = await requestResult(
          transaction.objectStore(EXPANSION_PACK_PLAYER_ACQUISITION_FAILURE_STORE)
            .get(failureKey(identity, digest)),
          'Finalized acquisition failure could not be loaded.',
        );
        await completion;
        return publicRecord(validateStoredFailure(record, identity, digest));
      } finally {
        database.close();
      }
    },

    /** Persist and read back exact signed bytes before any caller broadcasts. */
    async persistSignedTransaction(identityValue, signedValue, persistOptions = {}) {
      const identity = identityFrom(identityValue);
      const expectedRevision = revision(
        persistOptions.expectedRevision ?? 0,
        { allowZero: true },
      );
      const recoverySessionId = sessionId(persistOptions.sessionId);
      const signed = await signedTransaction(signedValue, deriveTransactionDigest, now);
      const database = await openDatabase(indexedDb);
      const callbackError = { current: null };
      let outcome = null;
      try {
        const transaction = database.transaction([
          EXPANSION_PACK_PLAYER_ACQUISITION_PENDING_STORE,
          EXPANSION_PACK_PLAYER_ACQUISITION_RECEIPT_STORE,
          EXPANSION_PACK_PLAYER_ACQUISITION_FAILURE_STORE,
        ], 'readwrite');
        const completion = transactionComplete(transaction, callbackError);
        const pendingStore = transaction.objectStore(
          EXPANSION_PACK_PLAYER_ACQUISITION_PENDING_STORE,
        );
        const receiptStore = transaction.objectStore(
          EXPANSION_PACK_PLAYER_ACQUISITION_RECEIPT_STORE,
        );
        const failureStore = transaction.objectStore(
          EXPANSION_PACK_PLAYER_ACQUISITION_FAILURE_STORE,
        );
        const pendingRequest = pendingStore.get(identity.key);
        const receiptRequest = receiptStore.get(identity.key);
        const failureRequest = failureStore.get(failureKey(identity, signed.digest));
        let pendingReady = false;
        let receiptReady = false;
        let failureReady = false;
        const persist = () => {
          if (!pendingReady || !receiptReady || !failureReady || callbackError.current) return;
          try {
            const existing = pendingRequest.result || null;
            const completed = receiptRequest.result || null;
            const failed = failureRequest.result || null;
            if (completed) fail(
              EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.ALREADY_COMPLETED,
              'This exact Expansion Pack acquisition already has verified Pass readback.',
            );
            if (failed) fail(
              EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.ALREADY_FINALIZED_FAILED,
              'This exact signed transaction already finalized with failure and cannot be replayed.',
              { transactionDigest: signed.digest },
            );
            const actualRevision = existing?.revision ?? 0;
            if (actualRevision !== expectedRevision) throw casConflict(
              expectedRevision,
              actualRevision,
            );
            if (existing) {
              assertSession(recoverySessionId, existing.sessionId);
              if (!sameSigned(existing.signed, signed)) fail(
                EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.SIGNED_TRANSACTION_IMMUTABLE,
                'Pending acquisition signed bytes, signature and digest are immutable.',
              );
              outcome = { record: existing, idempotent: true };
              return;
            }
            const savedAt = Number(now());
            const record = {
              schemaVersion: EXPANSION_PACK_PLAYER_ACQUISITION_RECOVERY_SCHEMA,
              ...identity,
              revision: 1,
              sessionId: recoverySessionId,
              state: EXPANSION_PACK_PLAYER_ACQUISITION_STATE.SIGNED,
              attemptCount: 0,
              lastErrorCode: '',
              signed,
              savedAt: Number.isFinite(savedAt) ? savedAt : Date.now(),
              updatedAt: Number.isFinite(savedAt) ? savedAt : Date.now(),
            };
            pendingStore.put(record);
            outcome = { record, idempotent: false };
          } catch (caught) {
            abortWith(transaction, callbackError, caught);
          }
        };
        pendingRequest.onsuccess = () => {
          pendingReady = true;
          persist();
        };
        receiptRequest.onsuccess = () => {
          receiptReady = true;
          persist();
        };
        failureRequest.onsuccess = () => {
          failureReady = true;
          persist();
        };
        pendingRequest.onerror = () => abortWith(
          transaction,
          callbackError,
          storageError(
            EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.STORAGE_READ_FAILED,
            'Pending acquisition revision could not be read.',
            pendingRequest.error,
          ),
        );
        receiptRequest.onerror = () => abortWith(
          transaction,
          callbackError,
          storageError(
            EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.STORAGE_READ_FAILED,
            'Acquisition receipt lane could not be read.',
            receiptRequest.error,
          ),
        );
        failureRequest.onerror = () => abortWith(
          transaction,
          callbackError,
          storageError(
            EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.STORAGE_READ_FAILED,
            'Finalized acquisition failure lane could not be read.',
            failureRequest.error,
          ),
        );
        await completion;
      } finally {
        database.close();
      }
      const readback = await api.loadPending(identity);
      if (!verifiedPendingReadback(
        readback,
        identity,
        signed,
        outcome.record.revision,
        recoverySessionId,
      )) fail(
        EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.READBACK_MISMATCH,
        'Exact signed acquisition transaction did not survive durable readback.',
      );
      return freeze({
        saved: true,
        verified: true,
        idempotent: outcome.idempotent,
        record: readback,
      });
    },

    /** CAS-update retry state without ever replacing the signed transaction. */
    async checkpointPending(identityValue, checkpoint = {}, checkpointOptions = {}) {
      const identity = identityFrom(identityValue);
      const expectedRevision = revision(checkpointOptions.expectedRevision);
      const recoverySessionId = sessionId(checkpointOptions.sessionId);
      const state = pendingState(checkpoint.state);
      const lastErrorCode = retryErrorCode(checkpoint.lastErrorCode);
      const database = await openDatabase(indexedDb);
      const callbackError = { current: null };
      let stored = null;
      try {
        const transaction = database.transaction(
          EXPANSION_PACK_PLAYER_ACQUISITION_PENDING_STORE,
          'readwrite',
        );
        const completion = transactionComplete(transaction, callbackError);
        const store = transaction.objectStore(
          EXPANSION_PACK_PLAYER_ACQUISITION_PENDING_STORE,
        );
        const request = store.get(identity.key);
        request.onsuccess = () => {
          try {
            const existing = request.result || null;
            if (!existing) fail(
              EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.PENDING_MISSING,
              'No exact pending acquisition exists for this immutable identity.',
            );
            if (existing.revision !== expectedRevision) throw casConflict(
              expectedRevision,
              existing.revision,
            );
            assertSession(recoverySessionId, existing.sessionId);
            const updatedAt = Number(now());
            stored = {
              ...existing,
              revision: existing.revision + 1,
              state,
              attemptCount: existing.attemptCount
                + (state === EXPANSION_PACK_PLAYER_ACQUISITION_STATE.BROADCASTING ? 1 : 0),
              lastErrorCode,
              updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
            };
            store.put(stored);
          } catch (caught) {
            abortWith(transaction, callbackError, caught);
          }
        };
        request.onerror = () => abortWith(
          transaction,
          callbackError,
          storageError(
            EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.STORAGE_READ_FAILED,
            'Pending acquisition checkpoint could not be read.',
            request.error,
          ),
        );
        await completion;
      } finally {
        database.close();
      }
      const readback = await api.loadPending(identity);
      if (!verifiedPendingReadback(
        readback,
        identity,
        stored.signed,
        stored.revision,
        recoverySessionId,
      ) || readback.state !== state || readback.lastErrorCode !== lastErrorCode) fail(
        EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.READBACK_MISMATCH,
        'Acquisition retry checkpoint did not survive durable readback.',
      );
      return readback;
    },

    /** Store exact verified Pass readback; this does not delete replay bytes. */
    async storeVerifiedReceipt(identityValue, receiptValue, receiptOptions = {}) {
      const identity = identityFrom(identityValue);
      const expectedRevision = revision(receiptOptions.expectedRevision);
      const recoverySessionId = sessionId(receiptOptions.sessionId);
      const database = await openDatabase(indexedDb);
      const callbackError = { current: null };
      let stored = null;
      let idempotent = false;
      try {
        const transaction = database.transaction([
          EXPANSION_PACK_PLAYER_ACQUISITION_PENDING_STORE,
          EXPANSION_PACK_PLAYER_ACQUISITION_RECEIPT_STORE,
        ], 'readwrite');
        const completion = transactionComplete(transaction, callbackError);
        const pendingStore = transaction.objectStore(
          EXPANSION_PACK_PLAYER_ACQUISITION_PENDING_STORE,
        );
        const receiptStore = transaction.objectStore(
          EXPANSION_PACK_PLAYER_ACQUISITION_RECEIPT_STORE,
        );
        const pendingRequest = pendingStore.get(identity.key);
        const receiptRequest = receiptStore.get(identity.key);
        let pendingReady = false;
        let receiptReady = false;
        const persist = () => {
          if (!pendingReady || !receiptReady || callbackError.current) return;
          try {
            const pending = pendingRequest.result || null;
            if (!pending) fail(
              EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.PENDING_MISSING,
              'Verified readback cannot be recorded without its exact pending transaction.',
            );
            if (pending.revision !== expectedRevision) throw casConflict(
              expectedRevision,
              pending.revision,
            );
            assertSession(recoverySessionId, pending.sessionId);
            const normalized = normalizeReceipt(identity, pending, receiptValue, now);
            const existing = receiptRequest.result || null;
            if (existing) {
              if (
                existing.transactionDigest !== normalized.transactionDigest
                || existing.passId !== normalized.passId
                || existing.key !== normalized.key
              ) fail(
                EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.RECEIPT_IMMUTABLE,
                'Verified acquisition receipt is immutable.',
              );
              stored = existing;
              idempotent = true;
              return;
            }
            stored = {
              ...normalized,
              receiptRevision: 1,
              pendingRevision: pending.revision,
              sessionId: pending.sessionId,
            };
            receiptStore.put(stored);
          } catch (caught) {
            abortWith(transaction, callbackError, caught);
          }
        };
        pendingRequest.onsuccess = () => {
          pendingReady = true;
          persist();
        };
        receiptRequest.onsuccess = () => {
          receiptReady = true;
          persist();
        };
        pendingRequest.onerror = () => abortWith(
          transaction,
          callbackError,
          storageError(
            EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.STORAGE_READ_FAILED,
            'Pending acquisition could not be read for receipt storage.',
            pendingRequest.error,
          ),
        );
        receiptRequest.onerror = () => abortWith(
          transaction,
          callbackError,
          storageError(
            EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.STORAGE_READ_FAILED,
            'Verified acquisition receipt could not be read.',
            receiptRequest.error,
          ),
        );
        await completion;
      } finally {
        database.close();
      }
      const readback = await api.loadVerifiedReceipt(identity);
      if (
        !readback
        || readback.receiptRevision !== stored.receiptRevision
        || readback.transactionDigest !== stored.transactionDigest
        || readback.passId !== stored.passId
        || readback.key !== identity.key
      ) fail(
        EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.READBACK_MISMATCH,
        'Verified acquisition receipt did not survive durable readback.',
      );
      return freeze({ saved: true, verified: true, idempotent, record: readback });
    },

    /**
     * Archive definitive chain failure evidence and remove only its matching
     * replay bytes in one transaction. Ambiguous RPC outcomes never call this.
     */
    async storeFinalizedFailure(identityValue, failureValue, failureOptions = {}) {
      const identity = identityFrom(identityValue);
      const expectedRevision = revision(failureOptions.expectedRevision);
      const recoverySessionId = sessionId(failureOptions.sessionId);
      const evidenceDigest = required(
        failureValue?.transactionDigest ?? failureValue?.digest,
        'Transaction digest',
      );
      const exactFailureKey = failureKey(identity, evidenceDigest);
      const database = await openDatabase(indexedDb);
      const callbackError = { current: null };
      let stored = null;
      let idempotent = false;
      try {
        const transaction = database.transaction([
          EXPANSION_PACK_PLAYER_ACQUISITION_PENDING_STORE,
          EXPANSION_PACK_PLAYER_ACQUISITION_RECEIPT_STORE,
          EXPANSION_PACK_PLAYER_ACQUISITION_FAILURE_STORE,
        ], 'readwrite');
        const completion = transactionComplete(transaction, callbackError);
        const pendingStore = transaction.objectStore(
          EXPANSION_PACK_PLAYER_ACQUISITION_PENDING_STORE,
        );
        const receiptStore = transaction.objectStore(
          EXPANSION_PACK_PLAYER_ACQUISITION_RECEIPT_STORE,
        );
        const failureStore = transaction.objectStore(
          EXPANSION_PACK_PLAYER_ACQUISITION_FAILURE_STORE,
        );
        const pendingRequest = pendingStore.get(identity.key);
        const receiptRequest = receiptStore.get(identity.key);
        const failureRequest = failureStore.get(exactFailureKey);
        let pendingReady = false;
        let receiptReady = false;
        let failureReady = false;
        const archive = () => {
          if (!pendingReady || !receiptReady || !failureReady || callbackError.current) return;
          try {
            const pending = pendingRequest.result || null;
            const receipt = receiptRequest.result || null;
            const existingFailure = failureRequest.result || null;
            if (receipt) fail(
              EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.ALREADY_COMPLETED,
              'A verified Pass receipt already exists for this acquisition.',
            );
            if (!pending) {
              if (!existingFailure) fail(
                EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.PENDING_MISSING,
                'No exact pending acquisition exists for finalized failure evidence.',
              );
              const validated = validateStoredFailure(
                existingFailure,
                identity,
                evidenceDigest,
              );
              if (validated.pendingRevision !== expectedRevision
                || validated.sessionId !== recoverySessionId) fail(
                EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.FINALIZED_FAILURE_IMMUTABLE,
                'Finalized failure evidence belongs to another pending revision or session.',
              );
              const syntheticPending = {
                ...validated,
                revision: validated.pendingRevision,
                signed: { digest: validated.transactionDigest },
              };
              const normalized = normalizeFinalizedFailure(
                identity,
                syntheticPending,
                failureValue,
                () => validated.failedAt,
              );
              if (!sameFinalizedFailure(validated, normalized)) fail(
                EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.FINALIZED_FAILURE_IMMUTABLE,
                'Finalized failure evidence is immutable.',
              );
              stored = validated;
              idempotent = true;
              return;
            }
            if (pending.revision !== expectedRevision) throw casConflict(
              expectedRevision,
              pending.revision,
            );
            assertSession(recoverySessionId, pending.sessionId);
            const normalized = normalizeFinalizedFailure(identity, pending, failureValue, now);
            if (existingFailure && !sameFinalizedFailure(existingFailure, normalized)) fail(
              EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.FINALIZED_FAILURE_IMMUTABLE,
              'Finalized failure evidence is immutable.',
            );
            stored = existingFailure || normalized;
            idempotent = Boolean(existingFailure);
            if (!existingFailure) failureStore.put(stored);
            pendingStore.delete(identity.key);
          } catch (caught) {
            abortWith(transaction, callbackError, caught);
          }
        };
        pendingRequest.onsuccess = () => {
          pendingReady = true;
          archive();
        };
        receiptRequest.onsuccess = () => {
          receiptReady = true;
          archive();
        };
        failureRequest.onsuccess = () => {
          failureReady = true;
          archive();
        };
        pendingRequest.onerror = () => abortWith(
          transaction,
          callbackError,
          storageError(
            EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.STORAGE_READ_FAILED,
            'Pending acquisition could not be read for finalized failure archival.',
            pendingRequest.error,
          ),
        );
        receiptRequest.onerror = () => abortWith(
          transaction,
          callbackError,
          storageError(
            EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.STORAGE_READ_FAILED,
            'Verified receipt lane could not be read for finalized failure archival.',
            receiptRequest.error,
          ),
        );
        failureRequest.onerror = () => abortWith(
          transaction,
          callbackError,
          storageError(
            EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.STORAGE_READ_FAILED,
            'Finalized failure lane could not be read.',
            failureRequest.error,
          ),
        );
        await completion;
      } finally {
        database.close();
      }
      const failureReadback = await api.loadFinalizedFailure(identity, evidenceDigest);
      const pendingReadback = await api.loadPending(identity);
      if (!failureReadback || pendingReadback
        || !sameFinalizedFailure(failureReadback, stored)) fail(
        EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.READBACK_MISMATCH,
        'Finalized failure evidence did not survive before replay bytes were removed.',
      );
      return freeze({
        saved: true,
        verified: true,
        idempotent,
        record: failureReadback,
      });
    },

    /** Delete replay bytes only after the matching receipt is durably present. */
    async cleanupPending(identityValue, cleanupOptions = {}) {
      const identity = identityFrom(identityValue);
      const expectedRevision = revision(cleanupOptions.expectedRevision);
      const expectedReceiptRevision = revision(cleanupOptions.receiptRevision);
      const recoverySessionId = sessionId(cleanupOptions.sessionId);
      const expectedDigest = required(cleanupOptions.transactionDigest, 'Transaction digest');
      const database = await openDatabase(indexedDb);
      const callbackError = { current: null };
      let outcome = null;
      try {
        const transaction = database.transaction([
          EXPANSION_PACK_PLAYER_ACQUISITION_PENDING_STORE,
          EXPANSION_PACK_PLAYER_ACQUISITION_RECEIPT_STORE,
        ], 'readwrite');
        const completion = transactionComplete(transaction, callbackError);
        const pendingStore = transaction.objectStore(
          EXPANSION_PACK_PLAYER_ACQUISITION_PENDING_STORE,
        );
        const receiptStore = transaction.objectStore(
          EXPANSION_PACK_PLAYER_ACQUISITION_RECEIPT_STORE,
        );
        const pendingRequest = pendingStore.get(identity.key);
        const receiptRequest = receiptStore.get(identity.key);
        let pendingReady = false;
        let receiptReady = false;
        const remove = () => {
          if (!pendingReady || !receiptReady || callbackError.current) return;
          try {
            const pending = pendingRequest.result || null;
            const receipt = receiptRequest.result || null;
            if (!pending) {
              outcome = { deleted: false, alreadyClean: Boolean(receipt) };
              return;
            }
            if (pending.revision !== expectedRevision) throw casConflict(
              expectedRevision,
              pending.revision,
            );
            assertSession(recoverySessionId, pending.sessionId);
            if (
              !receipt
              || receipt.receiptRevision !== expectedReceiptRevision
              || receipt.key !== identity.key
              || receipt.sessionId !== recoverySessionId
              || receipt.pendingRevision !== pending.revision
              || receipt.transactionDigest !== expectedDigest
              || pending.signed.digest !== expectedDigest
              || receipt.verifiedReadback !== true
            ) fail(
              EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.RECEIPT_REQUIRED,
              'Matching verified Pass readback must be durable before replay bytes are removed.',
            );
            pendingStore.delete(identity.key);
            outcome = { deleted: true, alreadyClean: false };
          } catch (caught) {
            abortWith(transaction, callbackError, caught);
          }
        };
        pendingRequest.onsuccess = () => {
          pendingReady = true;
          remove();
        };
        receiptRequest.onsuccess = () => {
          receiptReady = true;
          remove();
        };
        pendingRequest.onerror = () => abortWith(
          transaction,
          callbackError,
          storageError(
            EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.STORAGE_READ_FAILED,
            'Pending acquisition could not be read for cleanup.',
            pendingRequest.error,
          ),
        );
        receiptRequest.onerror = () => abortWith(
          transaction,
          callbackError,
          storageError(
            EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.STORAGE_READ_FAILED,
            'Verified acquisition receipt could not be read for cleanup.',
            receiptRequest.error,
          ),
        );
        await completion;
      } finally {
        database.close();
      }
      if (outcome.deleted) {
        const pendingReadback = await api.loadPending(identity);
        const receiptReadback = await api.loadVerifiedReceipt(identity);
        if (pendingReadback || !receiptReadback
          || receiptReadback.transactionDigest !== expectedDigest) fail(
          EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.READBACK_MISMATCH,
          'Acquisition cleanup did not preserve receipt-before-delete ordering.',
        );
      }
      return freeze(outcome);
    },
  };

  return freeze(api);
}
