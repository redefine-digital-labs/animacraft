/**
 * Fresh-v8 transaction recovery.
 *
 * This module deliberately knows nothing about wallets, RPC clients, or a
 * browser database.  Those boundaries are injected.  In production `persist`
 * can be an IndexedDB adapter backed by fresh v8 stores; tests use the
 * deterministic in-memory adapter below.  A persistence adapter MUST make
 * compareAndSwap atomic, including its optional failure/receipt side write.
 */

export const MAKER_V8_RECOVERY_SCHEMA = 'animacraft.maker-v8-recovery.v1';
export const MAKER_V8_RECOVERY_RECEIPT_SCHEMA = 'animacraft.maker-v8-recovery-receipt.v1';
export const MAKER_V8_RECOVERY_FAILURE_SCHEMA =
  'animacraft.maker-v8-recovery-finalized-failure.v1';

export const MAKER_V8_RECOVERY_STATE = Object.freeze({
  READY: 'READY',
  AWAITING_SIGNATURE: 'AWAITING_SIGNATURE',
  SIGNED_DURABLE: 'SIGNED_DURABLE',
  BROADCASTING: 'BROADCASTING',
  OUTCOME_PENDING: 'OUTCOME_PENDING',
  VERIFIED: 'VERIFIED',
  FINALIZED_FAILURE: 'FINALIZED_FAILURE',
});

export const MAKER_V8_RECOVERY_ERROR_LAYER = Object.freeze({
  CONFIGURATION: 'CONFIGURATION',
  VALIDATION: 'VALIDATION',
  CONTEXT: 'CONTEXT',
  CONCURRENCY: 'CONCURRENCY',
  STORAGE: 'STORAGE',
  SIGNING: 'SIGNING',
  QUERY: 'QUERY',
  BROADCAST: 'BROADCAST',
  READBACK: 'READBACK',
  TERMINAL: 'TERMINAL',
});

export const MAKER_V8_RECOVERY_ERROR = Object.freeze({
  CONFIG_INVALID: 'MAKER_V8_RECOVERY_CONFIG_INVALID',
  IDENTITY_INVALID: 'MAKER_V8_RECOVERY_IDENTITY_INVALID',
  PLAN_INVALID: 'MAKER_V8_RECOVERY_PLAN_INVALID',
  CONTEXT_UNAVAILABLE: 'MAKER_V8_RECOVERY_CONTEXT_UNAVAILABLE',
  CONTEXT_DRIFT: 'MAKER_V8_RECOVERY_CONTEXT_DRIFT',
  CAS_CONFLICT: 'MAKER_V8_RECOVERY_CAS_CONFLICT',
  SESSION_CONFLICT: 'MAKER_V8_RECOVERY_SESSION_CONFLICT',
  PENDING_CONFLICT: 'MAKER_V8_RECOVERY_PENDING_CONFLICT',
  STORAGE_FAILED: 'MAKER_V8_RECOVERY_STORAGE_FAILED',
  STORAGE_RECORD_INVALID: 'MAKER_V8_RECOVERY_STORAGE_RECORD_INVALID',
  STATE_INVALID: 'MAKER_V8_RECOVERY_STATE_INVALID',
  SIGNING_FAILED: 'MAKER_V8_RECOVERY_SIGNING_FAILED',
  SIGNED_BYTES_MISMATCH: 'MAKER_V8_RECOVERY_SIGNED_BYTES_MISMATCH',
  SIGNATURE_INVALID: 'MAKER_V8_RECOVERY_SIGNATURE_INVALID',
  DIGEST_MISMATCH: 'MAKER_V8_RECOVERY_DIGEST_MISMATCH',
  SIGNATURE_REPLACEMENT_FORBIDDEN: 'MAKER_V8_RECOVERY_SIGNATURE_REPLACEMENT_FORBIDDEN',
  QUERY_FAILED: 'MAKER_V8_RECOVERY_QUERY_FAILED',
  QUERY_INVALID: 'MAKER_V8_RECOVERY_QUERY_INVALID',
  BROADCAST_FAILED: 'MAKER_V8_RECOVERY_BROADCAST_FAILED',
  BROADCAST_DIGEST_MISMATCH: 'MAKER_V8_RECOVERY_BROADCAST_DIGEST_MISMATCH',
  READBACK_PENDING: 'MAKER_V8_RECOVERY_READBACK_PENDING',
  READBACK_FAILED: 'MAKER_V8_RECOVERY_READBACK_FAILED',
  READBACK_MISMATCH: 'MAKER_V8_RECOVERY_READBACK_MISMATCH',
  FINALIZED_FAILURE_INVALID: 'MAKER_V8_RECOVERY_FINALIZED_FAILURE_INVALID',
  FINALIZED_FAILURE_REPLAY: 'MAKER_V8_RECOVERY_FINALIZED_FAILURE_REPLAY',
  RECEIPT_INVALID: 'MAKER_V8_RECOVERY_RECEIPT_INVALID',
  ALREADY_COMPLETED: 'MAKER_V8_RECOVERY_ALREADY_COMPLETED',
});

export class MakerV8RecoveryError extends Error {
  constructor(message, {
    code = MAKER_V8_RECOVERY_ERROR.CONFIG_INVALID,
    layer = MAKER_V8_RECOVERY_ERROR_LAYER.CONFIGURATION,
    retryable = false,
    details = {},
    cause,
  } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'MakerV8RecoveryError';
    this.code = code;
    this.layer = layer;
    this.retryable = retryable === true;
    this.details = deepFreeze(clonePlainData(details, 'error details'));
  }
}

function fail(code, layer, message, details = {}, retryable = false, cause) {
  throw new MakerV8RecoveryError(message, {
    code, layer, details, retryable, cause,
  });
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

const MAX_JSON_DEPTH = 64;
const MAX_JSON_NODES = 100_000;

/**
 * Clone only descriptor-backed plain JSON.  This intentionally rejects class
 * instances, accessors, sparse arrays, cycles, shared references, proxies that
 * throw, BigInt, and non-finite numbers at every durable trust boundary.
 */
function clonePlainData(root, label, { allowScalar = true } = {}) {
  let nodes = 0;
  const seen = new WeakSet();

  function visit(value, path, depth) {
    nodes += 1;
    if (nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) {
      fail(
        MAKER_V8_RECOVERY_ERROR.PLAN_INVALID,
        MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
        `${label} exceeds the bounded JSON limit.`,
        { path },
      );
    }
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) fail(
        MAKER_V8_RECOVERY_ERROR.PLAN_INVALID,
        MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
        `${label} contains a non-finite number.`,
        { path },
      );
      return value;
    }
    if (!value || typeof value !== 'object') fail(
      MAKER_V8_RECOVERY_ERROR.PLAN_INVALID,
      MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
      `${label} must contain only plain JSON data.`,
      { path },
    );
    if (seen.has(value)) fail(
      MAKER_V8_RECOVERY_ERROR.PLAN_INVALID,
      MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
      `${label} must be a tree without cycles or shared object references.`,
      { path },
    );
    seen.add(value);

    let prototype;
    let keys;
    try {
      prototype = Object.getPrototypeOf(value);
      keys = Reflect.ownKeys(value);
    } catch (cause) {
      fail(
        MAKER_V8_RECOVERY_ERROR.PLAN_INVALID,
        MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
        `${label} could not be inspected safely.`,
        { path },
        false,
        cause,
      );
    }
    const array = Array.isArray(value);
    if ((array && prototype !== Array.prototype)
      || (!array && prototype !== Object.prototype && prototype !== null)
      || keys.some((key) => typeof key !== 'string')) fail(
      MAKER_V8_RECOVERY_ERROR.PLAN_INVALID,
      MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
      `${label} must use ordinary JSON records and arrays.`,
      { path },
    );

    if (array) {
      const allowed = new Set(['length']);
      for (let index = 0; index < value.length; index += 1) allowed.add(String(index));
      if (keys.length !== allowed.size || keys.some((key) => !allowed.has(key))) fail(
        MAKER_V8_RECOVERY_ERROR.PLAN_INVALID,
        MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
        `${label} contains a sparse or decorated array.`,
        { path },
      );
      const result = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail(
          MAKER_V8_RECOVERY_ERROR.PLAN_INVALID,
          MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
          `${label} arrays may contain only data properties.`,
          { path: `${path}[${index}]` },
        );
        result.push(visit(descriptor.value, `${path}[${index}]`, depth + 1));
      }
      return result;
    }

    const result = {};
    for (const key of keys.sort()) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail(
        MAKER_V8_RECOVERY_ERROR.PLAN_INVALID,
        MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
        `${label} records may contain only enumerable data properties.`,
        { path: `${path}.${key}` },
      );
      result[key] = visit(descriptor.value, `${path}.${key}`, depth + 1);
    }
    return result;
  }

  const cloned = visit(root, label, 0);
  if (!allowScalar && (!cloned || typeof cloned !== 'object' || Array.isArray(cloned))) fail(
    MAKER_V8_RECOVERY_ERROR.PLAN_INVALID,
    MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
    `${label} must be a plain JSON record.`,
  );
  return cloned;
}

function publicData(value) {
  return value === null || value === undefined
    ? value ?? null
    : deepFreeze(clonePlainData(value, 'stored recovery data'));
}

function text(value, label, code = MAKER_V8_RECOVERY_ERROR.IDENTITY_INVALID) {
  const result = typeof value === 'string' ? value.trim() : '';
  if (!result || result !== value || result.length > 2_048 || /[\u0000-\u001f\u007f]/.test(result)) fail(
    code,
    MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
    `${label} must be a non-empty exact string.`,
  );
  return result;
}

function canonicalU64(value, label, { positive = false } = {}) {
  const raw = typeof value === 'number' && Number.isSafeInteger(value)
    ? String(value)
    : typeof value === 'string' ? value : '';
  try {
    if (!/^(0|[1-9][0-9]*)$/.test(raw)) throw new Error('format');
    const parsed = BigInt(raw);
    if (parsed > ((1n << 64n) - 1n) || (positive && parsed < 1n)) throw new Error('range');
    return parsed.toString();
  } catch {
    fail(
      MAKER_V8_RECOVERY_ERROR.IDENTITY_INVALID,
      MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
      `${label} must be an exact ${positive ? 'positive ' : ''}u64.`,
    );
  }
}

function canonicalSuiId(value, label) {
  const raw = text(value, label);
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(raw)) fail(
    MAKER_V8_RECOVERY_ERROR.IDENTITY_INVALID,
    MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
    `${label} must be a Sui object or account id.`,
  );
  return `0x${raw.slice(2).toLowerCase().padStart(64, '0')}`;
}

function canonicalSuiType(value, label) {
  const raw = text(value, label);
  if (/\s/.test(raw) || !raw.includes('::')) fail(
    MAKER_V8_RECOVERY_ERROR.IDENTITY_INVALID,
    MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
    `${label} must be an exact Sui type.`,
  );
  return raw.replace(/0x[0-9a-fA-F]{1,64}/g, (entry) => canonicalSuiId(entry, label));
}

function opaque(value, label) {
  const result = text(value, label);
  if (/\s/.test(result) || result.length > 512) fail(
    MAKER_V8_RECOVERY_ERROR.IDENTITY_INVALID,
    MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
    `${label} must be an exact opaque value without whitespace.`,
  );
  return /^0x[0-9a-fA-F]+$/.test(result) ? result.toLowerCase() : result;
}

function exactKeys(value, expected, label, code = MAKER_V8_RECOVERY_ERROR.IDENTITY_INVALID) {
  let keys;
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || (Object.getPrototypeOf(value) !== Object.prototype
        && Object.getPrototypeOf(value) !== null)) throw new Error('record');
    keys = Object.keys(value).sort();
  } catch {
    fail(code, MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION, `${label} must be a plain record.`);
  }
  const wanted = [...expected].sort();
  if (keys.length !== wanted.length || keys.some((key, index) => key !== wanted[index])) fail(
    code,
    MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
    `${label} fields must be exact.`,
    { expected: wanted, actual: keys },
  );
}

function canonicalObjectRef(value, label) {
  exactKeys(value, ['id', 'version', 'digest'], label);
  return deepFreeze({
    id: canonicalSuiId(value.id, `${label} id`),
    version: canonicalU64(value.version, `${label} version`, { positive: true }),
    digest: opaque(value.digest, `${label} digest`),
  });
}

function canonicalPackageTuple(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32) fail(
    MAKER_V8_RECOVERY_ERROR.IDENTITY_INVALID,
    MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
    'packageTuple must contain the exact bound package entries.',
  );
  const roles = new Set();
  const tuple = value.map((raw, index) => {
    const entry = clonePlainData(raw, `packageTuple[${index}]`, { allowScalar: false });
    for (const field of ['role', 'originalPackageId', 'callablePackageId', 'packageDigest']) {
      if (!Object.hasOwn(entry, field)) fail(
        MAKER_V8_RECOVERY_ERROR.IDENTITY_INVALID,
        MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
        `packageTuple[${index}].${field} is required.`,
      );
    }
    entry.role = text(entry.role, `packageTuple[${index}] role`).toUpperCase();
    entry.originalPackageId = canonicalSuiId(
      entry.originalPackageId,
      `packageTuple[${index}] original package id`,
    );
    entry.callablePackageId = canonicalSuiId(
      entry.callablePackageId,
      `packageTuple[${index}] callable package id`,
    );
    entry.packageDigest = opaque(entry.packageDigest, `packageTuple[${index}] package digest`);
    if (roles.has(entry.role)) fail(
      MAKER_V8_RECOVERY_ERROR.IDENTITY_INVALID,
      MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
      'packageTuple roles must be unique.',
      { role: entry.role },
    );
    roles.add(entry.role);
    return entry;
  });
  tuple.sort((left, right) => left.role.localeCompare(right.role));
  return deepFreeze(tuple);
}

const IDENTITY_FIELDS = Object.freeze([
  'chain',
  'wallet',
  'lane',
  'action',
  'packageTuple',
  'paymentCoin',
  'listing',
  'root',
  'registry',
  'treasury',
  'rootContentCommitment',
  'protocolRevision',
  'listingRevision',
  'quoteCommitment',
  'authority',
]);

/** Canonical, immutable identity for one exact fresh-v8 action context. */
export function canonicalMakerV8RecoveryIdentity(value) {
  exactKeys(value, IDENTITY_FIELDS, 'Maker v8 recovery identity');
  const authority = clonePlainData(value.authority, 'lane authority', { allowScalar: false });
  if (!Object.hasOwn(authority, 'kind') || Object.keys(authority).length < 2) fail(
    MAKER_V8_RECOVERY_ERROR.IDENTITY_INVALID,
    MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
    'lane authority must bind a kind and its lane-specific authority data.',
  );
  authority.kind = text(authority.kind, 'Lane authority kind').toUpperCase();

  return deepFreeze({
    chain: text(value.chain, 'Chain').toLowerCase(),
    wallet: canonicalSuiId(value.wallet, 'Wallet'),
    lane: text(value.lane, 'Recovery lane').toUpperCase(),
    action: text(value.action, 'Recovery action').toUpperCase(),
    packageTuple: canonicalPackageTuple(value.packageTuple),
    paymentCoin: canonicalSuiType(value.paymentCoin, 'PaymentCoin'),
    listing: canonicalObjectRef(value.listing, 'Listing object'),
    root: canonicalObjectRef(value.root, 'Root object'),
    registry: canonicalObjectRef(value.registry, 'Registry object'),
    treasury: canonicalObjectRef(value.treasury, 'Treasury object'),
    rootContentCommitment: opaque(value.rootContentCommitment, 'Root content commitment'),
    protocolRevision: canonicalU64(value.protocolRevision, 'Protocol revision'),
    listingRevision: canonicalU64(value.listingRevision, 'Listing revision'),
    quoteCommitment: opaque(value.quoteCommitment, 'Quote commitment'),
    authority: deepFreeze(authority),
  });
}

function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${stableJson(value[key])}`
  )).join(',')}}`;
}

export function makerV8RecoveryIdentityKey(value) {
  const identity = canonicalMakerV8RecoveryIdentity(value);
  return `${MAKER_V8_RECOVERY_SCHEMA}:identity:${stableJson(identity)}`;
}

/** One pending action per exact chain + Root, independent of tab/session. */
export function makerV8RecoveryScopeKey(value) {
  const identity = canonicalMakerV8RecoveryIdentity(value);
  return `${MAKER_V8_RECOVERY_SCHEMA}:root:${encodeURIComponent(identity.chain)}:${identity.root.id}`;
}

function exactSessionId(value) {
  const result = text(value, 'Recovery session id', MAKER_V8_RECOVERY_ERROR.CONFIG_INVALID);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/.test(result)) fail(
    MAKER_V8_RECOVERY_ERROR.CONFIG_INVALID,
    MAKER_V8_RECOVERY_ERROR_LAYER.CONFIGURATION,
    'Recovery session id must be an opaque 8-160 character token.',
  );
  return result;
}

function exactTimestamp(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) fail(
    MAKER_V8_RECOVERY_ERROR.STORAGE_RECORD_INVALID,
    MAKER_V8_RECOVERY_ERROR_LAYER.STORAGE,
    `${label} must be a non-negative integer timestamp.`,
  );
  return value;
}

function safeClock(clock) {
  const value = Number(clock());
  if (!Number.isSafeInteger(value) || value < 0) fail(
    MAKER_V8_RECOVERY_ERROR.CONFIG_INVALID,
    MAKER_V8_RECOVERY_ERROR_LAYER.CONFIGURATION,
    'Recovery clock must return a non-negative safe integer.',
  );
  return value;
}

function errorSummary(error, fallbackCode) {
  return deepFreeze({
    code: typeof error?.code === 'string' && error.code.trim() ? error.code.trim() : fallbackCode,
    message: typeof error?.message === 'string' && error.message.trim()
      ? error.message.trim().slice(0, 1_024)
      : fallbackCode,
  });
}

function normalizeDigest(value, label, code = MAKER_V8_RECOVERY_ERROR.DIGEST_MISMATCH) {
  try {
    return opaque(value, label);
  } catch (cause) {
    if (cause instanceof MakerV8RecoveryError) fail(
      code,
      MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
      `${label} is invalid.`,
      {},
      false,
      cause,
    );
    throw cause;
  }
}

async function canonicalPlan(value, identity, deriveTransactionDigest) {
  exactKeys(value, [
    'transactionBytes',
    'transactionDigest',
    'stage',
    'sequence',
    'signer',
    'epochWindow',
    'gas',
    'sourceSnapshot',
  ], 'Maker v8 transaction plan', MAKER_V8_RECOVERY_ERROR.PLAN_INVALID);
  const transactionBytes = text(
    value.transactionBytes,
    'Exact transaction bytes',
    MAKER_V8_RECOVERY_ERROR.PLAN_INVALID,
  );
  let derived;
  try {
    derived = normalizeDigest(
      await deriveTransactionDigest(transactionBytes),
      'Derived transaction digest',
      MAKER_V8_RECOVERY_ERROR.PLAN_INVALID,
    );
  } catch (cause) {
    if (cause instanceof MakerV8RecoveryError) throw cause;
    fail(
      MAKER_V8_RECOVERY_ERROR.PLAN_INVALID,
      MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
      'The exact transaction bytes do not produce a valid digest.',
      {},
      false,
      cause,
    );
  }
  const supplied = normalizeDigest(
    value.transactionDigest,
    'Transaction digest',
    MAKER_V8_RECOVERY_ERROR.PLAN_INVALID,
  );
  if (supplied !== derived) fail(
    MAKER_V8_RECOVERY_ERROR.DIGEST_MISMATCH,
    MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
    'The planned transaction digest does not match the exact transaction bytes.',
    { supplied, derived },
  );
  const signer = canonicalSuiId(value.signer, 'Transaction signer');
  if (signer !== identity.wallet) fail(
    MAKER_V8_RECOVERY_ERROR.CONTEXT_DRIFT,
    MAKER_V8_RECOVERY_ERROR_LAYER.CONTEXT,
    'The planned signer does not match the immutable wallet identity.',
    { signer, wallet: identity.wallet },
  );
  exactKeys(value.epochWindow, ['start', 'end'], 'Epoch window', MAKER_V8_RECOVERY_ERROR.PLAN_INVALID);
  const epochWindow = {
    start: canonicalU64(value.epochWindow.start, 'Epoch window start'),
    end: canonicalU64(value.epochWindow.end, 'Epoch window end'),
  };
  if (BigInt(epochWindow.end) < BigInt(epochWindow.start)) fail(
    MAKER_V8_RECOVERY_ERROR.PLAN_INVALID,
    MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
    'Epoch window end cannot precede its start.',
  );
  const gas = clonePlainData(value.gas, 'Gas snapshot', { allowScalar: false });
  const sourceSnapshot = clonePlainData(
    value.sourceSnapshot,
    'Source snapshot',
    { allowScalar: false },
  );
  if (!Object.keys(gas).length || !Object.keys(sourceSnapshot).length) fail(
    MAKER_V8_RECOVERY_ERROR.PLAN_INVALID,
    MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
    'Gas and source snapshots must be non-empty exact records.',
  );
  return deepFreeze({
    transactionBytes,
    transactionDigest: derived,
    stage: text(value.stage, 'Transaction stage', MAKER_V8_RECOVERY_ERROR.PLAN_INVALID),
    sequence: canonicalU64(value.sequence, 'Transaction sequence'),
    signer,
    epochWindow: deepFreeze(epochWindow),
    gas: deepFreeze(gas),
    sourceSnapshot: deepFreeze(sourceSnapshot),
  });
}

function requireDependency(value, name) {
  if (typeof value !== 'function') fail(
    MAKER_V8_RECOVERY_ERROR.CONFIG_INVALID,
    MAKER_V8_RECOVERY_ERROR_LAYER.CONFIGURATION,
    `${name} dependency is required.`,
  );
  return value;
}

/**
 * Runtime contract for an injected persistence adapter.  IndexedDB adapters
 * should implement all five methods with stores dedicated to this schema:
 *
 *   load(scopeKey)
 *   compareAndSwap(scopeKey, expectedRevision, nextRecord, commitOptions)
 *   loadReceipt(identityKey)
 *   loadFinalizedFailure(identityKey, digest)
 *   listFinalizedFailures(scopeKey)
 *
 * `compareAndSwap` must atomically validate the revision and either (a) write
 * `nextRecord`, optionally archiving `nextRecord.failure`, or (b) durably put
 * `commitOptions.completionReceipt` before deleting the active record.
 */
export function assertMakerV8RecoveryPersistenceAdapter(value) {
  const methods = [
    'load',
    'compareAndSwap',
    'loadReceipt',
    'loadFinalizedFailure',
    'listFinalizedFailures',
  ];
  if (!value || typeof value !== 'object'
    || methods.some((method) => typeof value[method] !== 'function')) fail(
    MAKER_V8_RECOVERY_ERROR.CONFIG_INVALID,
    MAKER_V8_RECOVERY_ERROR_LAYER.CONFIGURATION,
    'persist must implement the fresh-v8 recovery persistence adapter interface.',
    { methods },
  );
  return value;
}

function cloneForMemory(value) {
  return value === null || value === undefined
    ? value ?? null
    : clonePlainData(value, 'in-memory recovery data');
}

/** Deterministic, process-local adapter for unit tests; never use as durable browser storage. */
export function createMakerV8RecoveryMemoryAdapter(seed = {}) {
  const active = new Map();
  const receipts = new Map();
  const failures = new Map();
  const seeded = clonePlainData(seed, 'Memory adapter seed', { allowScalar: false });
  for (const [key, value] of Object.entries(seeded.active || {})) active.set(key, value);
  for (const [key, value] of Object.entries(seeded.receipts || {})) receipts.set(key, value);
  for (const [key, value] of Object.entries(seeded.failures || {})) failures.set(key, value);

  function failureArchiveKey(identityKey, digest) { return `${identityKey}:digest:${digest}`; }

  return Object.freeze({
    async load(scopeKey) {
      return cloneForMemory(active.get(scopeKey));
    },

    async compareAndSwap(scopeKey, expectedRevision, nextRecord, commitOptions = {}) {
      const current = active.get(scopeKey) ?? null;
      const actualRevision = current?.revision ?? 0;
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0
        || actualRevision !== expectedRevision) fail(
        MAKER_V8_RECOVERY_ERROR.CAS_CONFLICT,
        MAKER_V8_RECOVERY_ERROR_LAYER.CONCURRENCY,
        'Recovery state changed in another session.',
        { scopeKey, expectedRevision, actualRevision },
        true,
      );

      const options = cloneForMemory(commitOptions) || {};
      const next = cloneForMemory(nextRecord);
      if (next !== null) {
        if (next.scopeKey !== scopeKey || next.revision !== expectedRevision + 1) fail(
          MAKER_V8_RECOVERY_ERROR.STORAGE_RECORD_INVALID,
          MAKER_V8_RECOVERY_ERROR_LAYER.STORAGE,
          'CAS attempted to write an invalid scope or revision.',
        );
        if (options.archiveFinalizedFailure === true) {
          if (next.state !== MAKER_V8_RECOVERY_STATE.FINALIZED_FAILURE || !next.failure) fail(
            MAKER_V8_RECOVERY_ERROR.FINALIZED_FAILURE_INVALID,
            MAKER_V8_RECOVERY_ERROR_LAYER.STORAGE,
            'Only an exact FINALIZED_FAILURE can be archived.',
          );
          const archiveKey = failureArchiveKey(next.identityKey, next.failure.digest);
          const prior = failures.get(archiveKey);
          if (prior && stableJson(prior) !== stableJson(next.failure)) fail(
            MAKER_V8_RECOVERY_ERROR.FINALIZED_FAILURE_INVALID,
            MAKER_V8_RECOVERY_ERROR_LAYER.STORAGE,
            'A finalized failure archive key already contains different evidence.',
          );
          failures.set(archiveKey, cloneForMemory(next.failure));
        }
        active.set(scopeKey, next);
        return cloneForMemory(next);
      }

      const receipt = options.completionReceipt;
      if (!receipt || current?.state !== MAKER_V8_RECOVERY_STATE.VERIFIED
        || stableJson(receipt) !== stableJson(current.receipt)) fail(
        MAKER_V8_RECOVERY_ERROR.RECEIPT_INVALID,
        MAKER_V8_RECOVERY_ERROR_LAYER.STORAGE,
        'Verified recovery can be cleaned only with its exact durable receipt.',
      );
      const prior = receipts.get(receipt.identityKey);
      if (prior && stableJson(prior) !== stableJson(receipt)) fail(
        MAKER_V8_RECOVERY_ERROR.RECEIPT_INVALID,
        MAKER_V8_RECOVERY_ERROR_LAYER.STORAGE,
        'A completion receipt key already contains different evidence.',
      );
      // The receipt put and active delete are one synchronous atomic commit in
      // this adapter.  IndexedDB implementations must use one transaction.
      receipts.set(receipt.identityKey, cloneForMemory(receipt));
      active.delete(scopeKey);
      return null;
    },

    async loadReceipt(identityKey) {
      return cloneForMemory(receipts.get(identityKey));
    },

    async loadFinalizedFailure(identityKey, digest) {
      return cloneForMemory(failures.get(failureArchiveKey(identityKey, digest)));
    },

    async listFinalizedFailures(scopeKey) {
      return [...failures.values()]
        .filter((entry) => entry.scopeKey === scopeKey)
        .sort((left, right) => left.archivedAt - right.archivedAt
          || left.identityKey.localeCompare(right.identityKey))
        .map(cloneForMemory);
    },

    /** A deterministic snapshot useful for crash/reload test setup. */
    snapshot() {
      return publicData({
        active: Object.fromEntries(active),
        receipts: Object.fromEntries(receipts),
        failures: Object.fromEntries(failures),
      });
    },
  });
}

const RECORD_FIELDS = Object.freeze([
  'schemaVersion',
  'scopeKey',
  'identityKey',
  'identity',
  'revision',
  'attempt',
  'state',
  'plan',
  'signed',
  'signatureSessionId',
  'writerSessionId',
  'broadcastCount',
  'queryOutcome',
  'lastError',
  'receipt',
  'failure',
  'createdAt',
  'updatedAt',
]);

const ALLOWED_TRANSITIONS = Object.freeze({
  [MAKER_V8_RECOVERY_STATE.READY]: new Set([MAKER_V8_RECOVERY_STATE.AWAITING_SIGNATURE]),
  [MAKER_V8_RECOVERY_STATE.AWAITING_SIGNATURE]: new Set([
    MAKER_V8_RECOVERY_STATE.AWAITING_SIGNATURE,
    MAKER_V8_RECOVERY_STATE.SIGNED_DURABLE,
  ]),
  [MAKER_V8_RECOVERY_STATE.SIGNED_DURABLE]: new Set([
    MAKER_V8_RECOVERY_STATE.SIGNED_DURABLE,
    MAKER_V8_RECOVERY_STATE.BROADCASTING,
    MAKER_V8_RECOVERY_STATE.OUTCOME_PENDING,
    MAKER_V8_RECOVERY_STATE.FINALIZED_FAILURE,
  ]),
  [MAKER_V8_RECOVERY_STATE.BROADCASTING]: new Set([
    MAKER_V8_RECOVERY_STATE.BROADCASTING,
    MAKER_V8_RECOVERY_STATE.OUTCOME_PENDING,
    MAKER_V8_RECOVERY_STATE.FINALIZED_FAILURE,
  ]),
  [MAKER_V8_RECOVERY_STATE.OUTCOME_PENDING]: new Set([
    MAKER_V8_RECOVERY_STATE.OUTCOME_PENDING,
    MAKER_V8_RECOVERY_STATE.BROADCASTING,
    MAKER_V8_RECOVERY_STATE.VERIFIED,
    MAKER_V8_RECOVERY_STATE.FINALIZED_FAILURE,
  ]),
  [MAKER_V8_RECOVERY_STATE.VERIFIED]: new Set(),
  [MAKER_V8_RECOVERY_STATE.FINALIZED_FAILURE]: new Set(),
});

function nextRecord(current, state, patch, sessionId, now) {
  if (!ALLOWED_TRANSITIONS[current.state]?.has(state)) fail(
    MAKER_V8_RECOVERY_ERROR.STATE_INVALID,
    MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
    `Recovery cannot transition from ${current.state} to ${state}.`,
  );
  return {
    ...current,
    ...patch,
    state,
    revision: current.revision + 1,
    writerSessionId: sessionId,
    updatedAt: now,
  };
}

function initialRecord(identity, plan, sessionId, now, { revision = 1, attempt = 1 } = {}) {
  const identityKey = makerV8RecoveryIdentityKey(identity);
  return {
    schemaVersion: MAKER_V8_RECOVERY_SCHEMA,
    scopeKey: makerV8RecoveryScopeKey(identity),
    identityKey,
    identity,
    revision,
    attempt,
    state: MAKER_V8_RECOVERY_STATE.READY,
    plan,
    signed: null,
    signatureSessionId: null,
    writerSessionId: sessionId,
    broadcastCount: 0,
    queryOutcome: null,
    lastError: null,
    receipt: null,
    failure: null,
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeQueryResult(value, digest) {
  if (value === null || value === undefined) return deepFreeze({
    status: 'NOT_FOUND', digest: null, checkpoint: null, error: null,
  });
  const result = clonePlainData(value, 'Digest query result', { allowScalar: false });
  const aliases = {
    NOT_FOUND: 'NOT_FOUND', UNKNOWN: 'NOT_FOUND',
    PENDING: 'PENDING',
    SUCCESS: 'FINALIZED_SUCCESS', FINALIZED_SUCCESS: 'FINALIZED_SUCCESS',
    FAILURE: 'FINALIZED_FAILURE', FINALIZED_FAILURE: 'FINALIZED_FAILURE',
  };
  const status = aliases[String(result.status || '').toUpperCase()];
  if (!status) fail(
    MAKER_V8_RECOVERY_ERROR.QUERY_INVALID,
    MAKER_V8_RECOVERY_ERROR_LAYER.QUERY,
    'Digest query returned an unsupported status.',
  );
  if (status !== 'NOT_FOUND') {
    const observed = normalizeDigest(
      result.digest ?? result.transactionDigest,
      'Queried transaction digest',
      MAKER_V8_RECOVERY_ERROR.QUERY_INVALID,
    );
    if (observed !== digest) fail(
      MAKER_V8_RECOVERY_ERROR.DIGEST_MISMATCH,
      MAKER_V8_RECOVERY_ERROR_LAYER.QUERY,
      'Digest query returned evidence for a different transaction.',
      { expected: digest, observed },
    );
  } else if (result.digest && normalizeDigest(result.digest, 'Queried transaction digest') !== digest) {
    fail(
      MAKER_V8_RECOVERY_ERROR.DIGEST_MISMATCH,
      MAKER_V8_RECOVERY_ERROR_LAYER.QUERY,
      'Not-found query evidence named a different transaction.',
    );
  }
  const checkpoint = result.checkpoint === undefined || result.checkpoint === null
    ? null
    : canonicalU64(result.checkpoint, 'Transaction checkpoint');
  if (status.startsWith('FINALIZED_') && checkpoint === null) fail(
    MAKER_V8_RECOVERY_ERROR.QUERY_INVALID,
    MAKER_V8_RECOVERY_ERROR_LAYER.QUERY,
    'A finalized digest query must include its exact checkpoint.',
  );
  const error = status === 'FINALIZED_FAILURE'
    ? clonePlainData(result.error || {}, 'Finalized execution error', { allowScalar: false })
    : null;
  return deepFreeze({ status, digest: status === 'NOT_FOUND' ? null : digest, checkpoint, error });
}

function validateReceipt(receipt, record) {
  if (!receipt || receipt.schemaVersion !== MAKER_V8_RECOVERY_RECEIPT_SCHEMA
    || receipt.identityKey !== record.identityKey || receipt.scopeKey !== record.scopeKey
    || receipt.digest !== record.signed?.digest || receipt.verified !== true
    || stableJson(receipt.identity) !== stableJson(record.identity)) fail(
    MAKER_V8_RECOVERY_ERROR.RECEIPT_INVALID,
    MAKER_V8_RECOVERY_ERROR_LAYER.STORAGE,
    'Stored completion receipt does not bind the exact recovery identity and digest.',
  );
  return receipt;
}

function receiptFromReadback(value, record, outcome, now) {
  const readback = clonePlainData(value, 'Verified readback', { allowScalar: false });
  if (readback.pending === true || readback.indexed === false) fail(
    MAKER_V8_RECOVERY_ERROR.READBACK_PENDING,
    MAKER_V8_RECOVERY_ERROR_LAYER.READBACK,
    'Finalized transaction readback is not indexed yet.',
    { digest: record.signed.digest },
    true,
  );
  if (readback.verified !== true) fail(
    MAKER_V8_RECOVERY_ERROR.READBACK_MISMATCH,
    MAKER_V8_RECOVERY_ERROR_LAYER.READBACK,
    'Readback did not affirm exact verification.',
  );
  const digest = normalizeDigest(
    readback.digest ?? readback.transactionDigest,
    'Readback transaction digest',
    MAKER_V8_RECOVERY_ERROR.READBACK_MISMATCH,
  );
  if (digest !== record.signed.digest) fail(
    MAKER_V8_RECOVERY_ERROR.READBACK_MISMATCH,
    MAKER_V8_RECOVERY_ERROR_LAYER.READBACK,
    'Readback digest differs from the durable signed transaction.',
    { expected: record.signed.digest, observed: digest },
  );
  let readbackIdentity;
  try {
    readbackIdentity = canonicalMakerV8RecoveryIdentity(readback.identity);
  } catch (cause) {
    fail(
      MAKER_V8_RECOVERY_ERROR.READBACK_MISMATCH,
      MAKER_V8_RECOVERY_ERROR_LAYER.READBACK,
      'Readback identity is not a canonical v8 action identity.',
      {},
      false,
      cause,
    );
  }
  if (stableJson(readbackIdentity) !== stableJson(record.identity)) fail(
    MAKER_V8_RECOVERY_ERROR.READBACK_MISMATCH,
    MAKER_V8_RECOVERY_ERROR_LAYER.READBACK,
    'Readback object refs or commitments differ from the signed identity.',
  );
  const checkpoint = canonicalU64(readback.checkpoint, 'Readback checkpoint');
  if (checkpoint !== outcome.checkpoint) fail(
    MAKER_V8_RECOVERY_ERROR.READBACK_MISMATCH,
    MAKER_V8_RECOVERY_ERROR_LAYER.READBACK,
    'Readback checkpoint differs from finalized query evidence.',
    { queried: outcome.checkpoint, readback: checkpoint },
  );
  const evidence = clonePlainData(readback.evidence, 'Readback evidence', { allowScalar: false });
  if (!Object.keys(evidence).length) fail(
    MAKER_V8_RECOVERY_ERROR.READBACK_MISMATCH,
    MAKER_V8_RECOVERY_ERROR_LAYER.READBACK,
    'Readback evidence must be a non-empty exact record.',
  );
  return deepFreeze({
    schemaVersion: MAKER_V8_RECOVERY_RECEIPT_SCHEMA,
    scopeKey: record.scopeKey,
    identityKey: record.identityKey,
    identity: clonePlainData(record.identity, 'Receipt identity'),
    digest,
    checkpoint,
    stage: record.plan.stage,
    sequence: record.plan.sequence,
    verified: true,
    evidence: deepFreeze(evidence),
    verifiedAt: now,
  });
}

function failureFromQuery(outcome, record, now) {
  if (outcome.status !== 'FINALIZED_FAILURE' || !outcome.checkpoint) fail(
    MAKER_V8_RECOVERY_ERROR.FINALIZED_FAILURE_INVALID,
    MAKER_V8_RECOVERY_ERROR_LAYER.QUERY,
    'Only query-confirmed finalized failure evidence can retire signed bytes.',
  );
  return deepFreeze({
    schemaVersion: MAKER_V8_RECOVERY_FAILURE_SCHEMA,
    scopeKey: record.scopeKey,
    identityKey: record.identityKey,
    identity: clonePlainData(record.identity, 'Failure identity'),
    digest: record.signed.digest,
    checkpoint: outcome.checkpoint,
    stage: record.plan.stage,
    sequence: record.plan.sequence,
    finalized: true,
    executionStatus: 'FAILURE',
    error: clonePlainData(outcome.error, 'Archived execution error', { allowScalar: false }),
    archivedAt: now,
  });
}

function normalizeBroadcastResult(value, digest) {
  const result = clonePlainData(value, 'Broadcast result', { allowScalar: false });
  const observed = normalizeDigest(
    result.digest ?? result.transactionDigest,
    'Broadcast transaction digest',
    MAKER_V8_RECOVERY_ERROR.BROADCAST_DIGEST_MISMATCH,
  );
  if (observed !== digest) fail(
    MAKER_V8_RECOVERY_ERROR.BROADCAST_DIGEST_MISMATCH,
    MAKER_V8_RECOVERY_ERROR_LAYER.BROADCAST,
    'Broadcast returned a digest different from the durable signed transaction.',
    { expected: digest, observed },
    true,
  );
  return deepFreeze({ digest, accepted: result.accepted !== false });
}

/**
 * Build a generic, network-agnostic recovery controller.
 *
 * Required pure/injected boundaries:
 * - deriveTransactionDigest(bytes) -> exact digest
 * - verifySignature({ bytes, signature, digest, signer }) -> true or
 *   { verified: true, signer?, digest?, bytes? }
 * - getContext({ identity }) -> current full identity (used only pre-sign/replay)
 * - sign({ bytes, digest, signer, identity, plan }) -> signed envelope
 * - broadcast({ bytes, signature, digest, signer, identity }) -> { digest }
 * - query({ digest, identity }) -> strict digest status
 * - readback({ digest, identity, outcome }) -> strict verified readback
 */
export function createMakerV8RecoveryController(options = {}) {
  const persist = assertMakerV8RecoveryPersistenceAdapter(options.persist);
  const deriveTransactionDigest = requireDependency(
    options.deriveTransactionDigest,
    'deriveTransactionDigest',
  );
  const verifySignature = requireDependency(options.verifySignature, 'verifySignature');
  const getContext = requireDependency(options.getContext, 'getContext');
  const signBoundary = requireDependency(options.sign, 'sign');
  const broadcastBoundary = requireDependency(options.broadcast, 'broadcast');
  const queryBoundary = requireDependency(options.query, 'query');
  const readbackBoundary = requireDependency(options.readback, 'readback');
  const clock = typeof options.clock === 'function' ? options.clock : Date.now;
  const sessionId = exactSessionId(options.sessionId);

  async function storage(operation, run) {
    try {
      return await run();
    } catch (cause) {
      if (cause instanceof MakerV8RecoveryError) throw cause;
      fail(
        MAKER_V8_RECOVERY_ERROR.STORAGE_FAILED,
        MAKER_V8_RECOVERY_ERROR_LAYER.STORAGE,
        `Recovery persistence failed during ${operation}.`,
        { operation, cause: String(cause?.message || cause || 'unknown').slice(0, 512) },
        true,
        cause,
      );
    }
  }

  async function verifySignedArtifact(value, record, { stored = false } = {}) {
    const code = stored
      ? MAKER_V8_RECOVERY_ERROR.STORAGE_RECORD_INVALID
      : MAKER_V8_RECOVERY_ERROR.SIGNATURE_INVALID;
    let envelope;
    try {
      envelope = clonePlainData(value, 'Signed transaction envelope', { allowScalar: false });
    } catch (cause) {
      fail(code, stored ? MAKER_V8_RECOVERY_ERROR_LAYER.STORAGE
        : MAKER_V8_RECOVERY_ERROR_LAYER.SIGNING,
      'Signed transaction envelope is not exact plain data.', {}, false, cause);
    }
    const bytes = text(
      envelope.bytes ?? envelope.transactionBytes,
      'Wallet-returned transaction bytes',
      code,
    );
    if (bytes !== record.plan.transactionBytes) fail(
      MAKER_V8_RECOVERY_ERROR.SIGNED_BYTES_MISMATCH,
      stored ? MAKER_V8_RECOVERY_ERROR_LAYER.STORAGE : MAKER_V8_RECOVERY_ERROR_LAYER.SIGNING,
      'Wallet-returned bytes differ from the exact planned transaction bytes.',
    );
    const digest = normalizeDigest(
      envelope.digest ?? envelope.transactionDigest,
      'Wallet-returned transaction digest',
      code,
    );
    let derived;
    try { derived = normalizeDigest(await deriveTransactionDigest(bytes), 'Derived signed digest', code); } catch (cause) {
      if (cause instanceof MakerV8RecoveryError) throw cause;
      fail(code, stored ? MAKER_V8_RECOVERY_ERROR_LAYER.STORAGE
        : MAKER_V8_RECOVERY_ERROR_LAYER.SIGNING,
      'Wallet-returned bytes could not be digested.', {}, false, cause);
    }
    if (digest !== derived || digest !== record.plan.transactionDigest) fail(
      MAKER_V8_RECOVERY_ERROR.DIGEST_MISMATCH,
      stored ? MAKER_V8_RECOVERY_ERROR_LAYER.STORAGE : MAKER_V8_RECOVERY_ERROR_LAYER.SIGNING,
      'Wallet-returned digest is inconsistent with the planned and returned bytes.',
      { planned: record.plan.transactionDigest, returned: digest, derived },
    );
    const signer = canonicalSuiId(envelope.signer, 'Wallet-returned signer');
    if (signer !== record.identity.wallet || signer !== record.plan.signer) fail(
      MAKER_V8_RECOVERY_ERROR.CONTEXT_DRIFT,
      MAKER_V8_RECOVERY_ERROR_LAYER.CONTEXT,
      'Wallet signed with a different account.',
      { expected: record.identity.wallet, observed: signer },
    );
    const signature = text(envelope.signature, 'Serialized transaction signature', code);
    let verification;
    try {
      verification = await verifySignature({ bytes, signature, digest, signer });
    } catch (cause) {
      fail(
        MAKER_V8_RECOVERY_ERROR.SIGNATURE_INVALID,
        stored ? MAKER_V8_RECOVERY_ERROR_LAYER.STORAGE : MAKER_V8_RECOVERY_ERROR_LAYER.SIGNING,
        'The serialized signature could not be verified.',
        {},
        false,
        cause,
      );
    }
    const verified = verification === true || verification?.verified === true;
    if (!verified
      || (verification?.signer && canonicalSuiId(verification.signer, 'Verified signer') !== signer)
      || (verification?.digest && normalizeDigest(verification.digest, 'Verified digest') !== digest)
      || (verification?.bytes && verification.bytes !== bytes)) fail(
      MAKER_V8_RECOVERY_ERROR.SIGNATURE_INVALID,
      stored ? MAKER_V8_RECOVERY_ERROR_LAYER.STORAGE : MAKER_V8_RECOVERY_ERROR_LAYER.SIGNING,
      'The signature does not authenticate the exact bytes, digest, and signer.',
    );
    const signedAt = envelope.signedAt === undefined
      ? safeClock(clock)
      : exactTimestamp(envelope.signedAt, 'Signed timestamp');
    return deepFreeze({ bytes, signature, digest, signer, signedAt });
  }

  async function validateStoredRecord(raw) {
    if (!raw) return null;
    let record;
    try {
      record = clonePlainData(raw, 'Stored recovery record', { allowScalar: false });
      exactKeys(record, RECORD_FIELDS, 'Stored recovery record',
        MAKER_V8_RECOVERY_ERROR.STORAGE_RECORD_INVALID);
      if (record.schemaVersion !== MAKER_V8_RECOVERY_SCHEMA) throw new Error('schema');
      const identity = canonicalMakerV8RecoveryIdentity(record.identity);
      const identityKey = makerV8RecoveryIdentityKey(identity);
      const scopeKey = makerV8RecoveryScopeKey(identity);
      if (record.identityKey !== identityKey || record.scopeKey !== scopeKey) throw new Error('identity');
      if (!Number.isSafeInteger(record.revision) || record.revision < 1
        || !Number.isSafeInteger(record.attempt) || record.attempt < 1
        || !Number.isSafeInteger(record.broadcastCount) || record.broadcastCount < 0
        || !Object.values(MAKER_V8_RECOVERY_STATE).includes(record.state)) throw new Error('counter');
      exactSessionId(record.writerSessionId);
      const plan = await canonicalPlan(record.plan, identity, deriveTransactionDigest);
      if (stableJson(plan) !== stableJson(record.plan)) throw new Error('plan');
      const needsSigned = ![
        MAKER_V8_RECOVERY_STATE.READY,
        MAKER_V8_RECOVERY_STATE.AWAITING_SIGNATURE,
      ].includes(record.state);
      if (needsSigned !== Boolean(record.signed)) throw new Error('signed state');
      if (record.state === MAKER_V8_RECOVERY_STATE.AWAITING_SIGNATURE) {
        exactSessionId(record.signatureSessionId);
      } else if (record.state === MAKER_V8_RECOVERY_STATE.READY
        && record.signatureSessionId !== null) throw new Error('signature session');
      if (needsSigned) {
        const signed = await verifySignedArtifact(record.signed, { ...record, identity, plan }, { stored: true });
        if (stableJson(signed) !== stableJson(record.signed)) throw new Error('signed');
      }
      if (record.state === MAKER_V8_RECOVERY_STATE.VERIFIED) validateReceipt(record.receipt, record);
      else if (record.receipt !== null) throw new Error('receipt state');
      if (record.state === MAKER_V8_RECOVERY_STATE.FINALIZED_FAILURE) {
        if (!record.failure || record.failure.schemaVersion !== MAKER_V8_RECOVERY_FAILURE_SCHEMA
          || record.failure.identityKey !== identityKey || record.failure.scopeKey !== scopeKey
          || record.failure.digest !== record.signed.digest || record.failure.finalized !== true
          || record.failure.executionStatus !== 'FAILURE') throw new Error('failure');
      } else if (record.failure !== null) throw new Error('failure state');
      exactTimestamp(record.createdAt, 'Created timestamp');
      exactTimestamp(record.updatedAt, 'Updated timestamp');
      if (record.updatedAt < record.createdAt) throw new Error('timestamp order');
      return publicData(record);
    } catch (cause) {
      if (cause instanceof MakerV8RecoveryError
        && cause.code === MAKER_V8_RECOVERY_ERROR.STORAGE_RECORD_INVALID) throw cause;
      fail(
        MAKER_V8_RECOVERY_ERROR.STORAGE_RECORD_INVALID,
        MAKER_V8_RECOVERY_ERROR_LAYER.STORAGE,
        'Durable recovery state is malformed or has drifted.',
        { reason: String(cause?.message || cause || 'invalid').slice(0, 256) },
        false,
        cause,
      );
    }
  }

  async function loadScope(identity) {
    return validateStoredRecord(await storage(
      'load',
      () => persist.load(makerV8RecoveryScopeKey(identity)),
    ));
  }

  function requireExactIdentity(record, identity) {
    if (!record) return null;
    const requested = makerV8RecoveryIdentityKey(identity);
    if (record.identityKey !== requested) fail(
      MAKER_V8_RECOVERY_ERROR.PENDING_CONFLICT,
      MAKER_V8_RECOVERY_ERROR_LAYER.CONCURRENCY,
      'Another immutable action identity is active for this Root.',
      { activeIdentityKey: record.identityKey, requestedIdentityKey: requested },
      true,
    );
    return record;
  }

  async function cas(record, state, patch = {}, commitOptions = {}) {
    const now = safeClock(clock);
    const next = nextRecord(record, state, patch, sessionId, now);
    const stored = await storage('compareAndSwap', () => persist.compareAndSwap(
      record.scopeKey,
      record.revision,
      next,
      commitOptions,
    ));
    const committed = await validateStoredRecord(stored);
    const reread = await validateStoredRecord(await storage(
      'post-CAS durable readback',
      () => persist.load(record.scopeKey),
    ));
    if (!reread || stableJson(reread) !== stableJson(committed)) fail(
      MAKER_V8_RECOVERY_ERROR.STORAGE_RECORD_INVALID,
      MAKER_V8_RECOVERY_ERROR_LAYER.STORAGE,
      'Recovery CAS did not survive an exact durable readback.',
      { state, revision: next.revision },
      true,
    );
    return reread;
  }

  async function rememberError(record, state, error) {
    try {
      return await cas(record, state, { lastError: errorSummary(error, error.code) });
    } catch (cause) {
      if (cause instanceof MakerV8RecoveryError
        && cause.code === MAKER_V8_RECOVERY_ERROR.CAS_CONFLICT) return loadScope(record.identity);
      throw cause;
    }
  }

  async function assertCurrentContext(identity) {
    let value;
    try { value = await getContext({ identity: publicData(identity) }); } catch (cause) {
      fail(
        MAKER_V8_RECOVERY_ERROR.CONTEXT_UNAVAILABLE,
        MAKER_V8_RECOVERY_ERROR_LAYER.CONTEXT,
        'Current wallet/chain context could not be read.',
        {},
        true,
        cause,
      );
    }
    const actualValue = value?.identity ?? value;
    let actual;
    try { actual = canonicalMakerV8RecoveryIdentity(actualValue); } catch (cause) {
      fail(
        MAKER_V8_RECOVERY_ERROR.CONTEXT_DRIFT,
        MAKER_V8_RECOVERY_ERROR_LAYER.CONTEXT,
        'Current wallet/chain context is incomplete or invalid.',
        {},
        false,
        cause,
      );
    }
    if (stableJson(actual) !== stableJson(identity)) fail(
      MAKER_V8_RECOVERY_ERROR.CONTEXT_DRIFT,
      MAKER_V8_RECOVERY_ERROR_LAYER.CONTEXT,
      'Wallet, chain, package, object, revision, commitment, or authority context drifted.',
      {
        expectedIdentityKey: makerV8RecoveryIdentityKey(identity),
        actualIdentityKey: makerV8RecoveryIdentityKey(actual),
      },
    );
  }

  async function loadReceipt(identity) {
    const identityKey = makerV8RecoveryIdentityKey(identity);
    const raw = await storage('loadReceipt', () => persist.loadReceipt(identityKey));
    if (!raw) return null;
    const receipt = publicData(raw);
    const shell = {
      identity, identityKey, scopeKey: makerV8RecoveryScopeKey(identity),
      signed: { digest: receipt.digest },
    };
    validateReceipt(receipt, shell);
    return receipt;
  }

  const api = {
    async prepare(identityValue, planValue, prepareOptions = {}) {
      const identity = canonicalMakerV8RecoveryIdentity(identityValue);
      const plan = await canonicalPlan(planValue, identity, deriveTransactionDigest);
      const identityKey = makerV8RecoveryIdentityKey(identity);
      const scopeKey = makerV8RecoveryScopeKey(identity);
      const archivedFailures = await storage('listFinalizedFailures before prepare', () => (
        persist.listFinalizedFailures(scopeKey)
      ));
      const terminalFailure = (archivedFailures || []).find((entry) => (
        entry?.identityKey === identityKey || entry?.digest === plan.transactionDigest
      ));
      if (terminalFailure) fail(
        MAKER_V8_RECOVERY_ERROR.FINALIZED_FAILURE_REPLAY,
        MAKER_V8_RECOVERY_ERROR_LAYER.TERMINAL,
        'A previously finalized identity or digest cannot receive a replacement signature.',
        { digest: terminalFailure.digest, identityKey: terminalFailure.identityKey },
      );
      const receipt = await loadReceipt(identity);
      if (receipt) fail(
        MAKER_V8_RECOVERY_ERROR.ALREADY_COMPLETED,
        MAKER_V8_RECOVERY_ERROR_LAYER.TERMINAL,
        'This exact action already has a durable verified receipt.',
        { digest: receipt.digest },
      );
      const current = await loadScope(identity);
      if (!current) {
        const created = initialRecord(identity, plan, sessionId, safeClock(clock));
        return validateStoredRecord(await storage('compareAndSwap', () => persist.compareAndSwap(
          scopeKey,
          0,
          created,
          {},
        )));
      }

      if (current.state === MAKER_V8_RECOVERY_STATE.FINALIZED_FAILURE) {
        if (prepareOptions.afterFinalizedFailure !== true) fail(
          MAKER_V8_RECOVERY_ERROR.FINALIZED_FAILURE_REPLAY,
          MAKER_V8_RECOVERY_ERROR_LAYER.TERMINAL,
          'A finalized failure must remain archived before a changed action can start.',
        );
        if (current.identityKey === makerV8RecoveryIdentityKey(identity)
          || current.signed.digest === plan.transactionDigest) fail(
          MAKER_V8_RECOVERY_ERROR.FINALIZED_FAILURE_REPLAY,
          MAKER_V8_RECOVERY_ERROR_LAYER.TERMINAL,
          'The failed identity or digest cannot receive a replacement signature.',
        );
        const archive = await storage('loadFinalizedFailure', () => persist.loadFinalizedFailure(
          current.identityKey,
          current.signed.digest,
        ));
        if (!archive || stableJson(archive) !== stableJson(current.failure)) fail(
          MAKER_V8_RECOVERY_ERROR.FINALIZED_FAILURE_INVALID,
          MAKER_V8_RECOVERY_ERROR_LAYER.STORAGE,
          'The prior finalized failure is not durably archived.',
        );
        const replacement = initialRecord(identity, plan, sessionId, safeClock(clock), {
          revision: current.revision + 1,
          attempt: current.attempt + 1,
        });
        return validateStoredRecord(await storage('compareAndSwap', () => persist.compareAndSwap(
          current.scopeKey,
          current.revision,
          replacement,
          {},
        )));
      }

      requireExactIdentity(current, identity);
      if (current.state === MAKER_V8_RECOVERY_STATE.VERIFIED) fail(
        MAKER_V8_RECOVERY_ERROR.ALREADY_COMPLETED,
        MAKER_V8_RECOVERY_ERROR_LAYER.TERMINAL,
        'Verified recovery must be receipted and cleaned before another Root action.',
      );
      if (stableJson(current.plan) !== stableJson(plan)) fail(
        current.signed
          ? MAKER_V8_RECOVERY_ERROR.SIGNATURE_REPLACEMENT_FORBIDDEN
          : MAKER_V8_RECOVERY_ERROR.PENDING_CONFLICT,
        current.signed
          ? MAKER_V8_RECOVERY_ERROR_LAYER.TERMINAL
          : MAKER_V8_RECOVERY_ERROR_LAYER.CONCURRENCY,
        'An active recovery record cannot be replaced with a different plan.',
      );
      return current;
    },

    async load(identityValue) {
      const identity = canonicalMakerV8RecoveryIdentity(identityValue);
      const record = await loadScope(identity);
      return record ? requireExactIdentity(record, identity) : null;
    },

    async requestSignature(identityValue) {
      const identity = canonicalMakerV8RecoveryIdentity(identityValue);
      let record = requireExactIdentity(await loadScope(identity), identity);
      if (!record) fail(
        MAKER_V8_RECOVERY_ERROR.STATE_INVALID,
        MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
        'Prepare the exact transaction before requesting a signature.',
      );
      if (![MAKER_V8_RECOVERY_STATE.READY,
        MAKER_V8_RECOVERY_STATE.AWAITING_SIGNATURE].includes(record.state)) fail(
        MAKER_V8_RECOVERY_ERROR.SIGNATURE_REPLACEMENT_FORBIDDEN,
        MAKER_V8_RECOVERY_ERROR_LAYER.TERMINAL,
        'Durable signed or terminal recovery cannot request a replacement signature.',
        { state: record.state },
      );
      if (record.state === MAKER_V8_RECOVERY_STATE.READY) {
        record = await cas(record, MAKER_V8_RECOVERY_STATE.AWAITING_SIGNATURE, {
          signatureSessionId: sessionId,
          lastError: null,
        });
      } else if (record.signatureSessionId !== sessionId) fail(
        MAKER_V8_RECOVERY_ERROR.SESSION_CONFLICT,
        MAKER_V8_RECOVERY_ERROR_LAYER.CONCURRENCY,
        'Another session owns the outstanding signature request.',
        { owner: record.signatureSessionId, requested: sessionId },
        true,
      );

      await assertCurrentContext(identity);
      let walletResult;
      try {
        walletResult = await signBoundary({
          bytes: record.plan.transactionBytes,
          digest: record.plan.transactionDigest,
          signer: record.plan.signer,
          identity: publicData(identity),
          plan: publicData(record.plan),
        });
      } catch (cause) {
        const error = new MakerV8RecoveryError('Wallet signing failed before a durable signature existed.', {
          code: MAKER_V8_RECOVERY_ERROR.SIGNING_FAILED,
          layer: MAKER_V8_RECOVERY_ERROR_LAYER.SIGNING,
          retryable: true,
          details: { cause: String(cause?.message || cause || 'unknown').slice(0, 512) },
          cause,
        });
        await rememberError(record, MAKER_V8_RECOVERY_STATE.AWAITING_SIGNATURE, error);
        throw error;
      }
      let signed;
      try { signed = await verifySignedArtifact(walletResult, record); } catch (error) {
        await rememberError(record, MAKER_V8_RECOVERY_STATE.AWAITING_SIGNATURE, error);
        throw error;
      }
      // This CAS and its verified durable reread complete before this method
      // returns; callers are forbidden from broadcasting walletResult directly.
      return cas(record, MAKER_V8_RECOVERY_STATE.SIGNED_DURABLE, {
        signed,
        lastError: null,
      });
    },

    async recover(identityValue, recoverOptions = {}) {
      const identity = canonicalMakerV8RecoveryIdentity(identityValue);
      let record = requireExactIdentity(await loadScope(identity), identity);
      if (!record) {
        const receipt = await loadReceipt(identity);
        if (receipt) fail(
          MAKER_V8_RECOVERY_ERROR.ALREADY_COMPLETED,
          MAKER_V8_RECOVERY_ERROR_LAYER.TERMINAL,
          'This exact action already completed and cannot be replayed.',
          { digest: receipt.digest },
        );
        fail(
          MAKER_V8_RECOVERY_ERROR.STATE_INVALID,
          MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
          'No durable signed transaction exists for this identity.',
        );
      }
      if (record.state === MAKER_V8_RECOVERY_STATE.VERIFIED) fail(
        MAKER_V8_RECOVERY_ERROR.ALREADY_COMPLETED,
        MAKER_V8_RECOVERY_ERROR_LAYER.TERMINAL,
        'Verified recovery cannot be queried or replayed again.',
      );
      if (record.state === MAKER_V8_RECOVERY_STATE.FINALIZED_FAILURE) fail(
        MAKER_V8_RECOVERY_ERROR.FINALIZED_FAILURE_REPLAY,
        MAKER_V8_RECOVERY_ERROR_LAYER.TERMINAL,
        'A finalized failed digest is terminal and cannot be replayed.',
      );
      if (!record.signed) fail(
        MAKER_V8_RECOVERY_ERROR.STATE_INVALID,
        MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
        'Recovery cannot query or broadcast before an exact signature is durable.',
        { state: record.state },
      );

      // Querying the immutable digest is always first.  It is intentionally
      // allowed through wallet/context drift because it cannot sign or spend.
      let queried;
      try {
        queried = normalizeQueryResult(await queryBoundary({
          digest: record.signed.digest,
          identity: publicData(identity),
        }), record.signed.digest);
      } catch (cause) {
        const error = cause instanceof MakerV8RecoveryError ? cause
          : new MakerV8RecoveryError('Transaction digest query failed.', {
            code: MAKER_V8_RECOVERY_ERROR.QUERY_FAILED,
            layer: MAKER_V8_RECOVERY_ERROR_LAYER.QUERY,
            retryable: true,
            details: { cause: String(cause?.message || cause || 'unknown').slice(0, 512) },
            cause,
          });
        const safeState = record.state === MAKER_V8_RECOVERY_STATE.BROADCASTING
          ? MAKER_V8_RECOVERY_STATE.OUTCOME_PENDING : record.state;
        await rememberError(record, safeState, error);
        throw error;
      }

      if (queried.status === 'FINALIZED_FAILURE') {
        const failure = failureFromQuery(queried, record, safeClock(clock));
        const finalized = await cas(record, MAKER_V8_RECOVERY_STATE.FINALIZED_FAILURE, {
          queryOutcome: queried,
          failure,
          lastError: null,
        }, { archiveFinalizedFailure: true });
        const archived = await storage('finalized failure durable readback', () => (
          persist.loadFinalizedFailure(finalized.identityKey, finalized.signed.digest)
        ));
        if (!archived || stableJson(archived) !== stableJson(finalized.failure)) fail(
          MAKER_V8_RECOVERY_ERROR.FINALIZED_FAILURE_INVALID,
          MAKER_V8_RECOVERY_ERROR_LAYER.STORAGE,
          'Finalized failure did not survive its atomic archive commit.',
          { digest: finalized.signed.digest },
          true,
        );
        return finalized;
      }

      if (queried.status === 'FINALIZED_SUCCESS') {
        if (record.state !== MAKER_V8_RECOVERY_STATE.OUTCOME_PENDING) {
          record = await cas(record, MAKER_V8_RECOVERY_STATE.OUTCOME_PENDING, {
            queryOutcome: queried,
            lastError: null,
          });
        } else {
          record = await cas(record, MAKER_V8_RECOVERY_STATE.OUTCOME_PENDING, {
            queryOutcome: queried,
            lastError: null,
          });
        }
        let readback;
        try {
          readback = await readbackBoundary({
            digest: record.signed.digest,
            identity: publicData(identity),
            outcome: publicData(queried),
          });
        } catch (cause) {
          const pending = cause?.code === 'TRANSACTION_OUTCOME_PENDING' || cause?.pending === true;
          const error = new MakerV8RecoveryError(
            pending ? 'Finalized transaction readback is not indexed yet.'
              : 'Finalized transaction readback failed.',
            {
              code: pending
                ? MAKER_V8_RECOVERY_ERROR.READBACK_PENDING
                : MAKER_V8_RECOVERY_ERROR.READBACK_FAILED,
              layer: MAKER_V8_RECOVERY_ERROR_LAYER.READBACK,
              retryable: true,
              details: { cause: String(cause?.message || cause || 'unknown').slice(0, 512) },
              cause,
            },
          );
          await rememberError(record, MAKER_V8_RECOVERY_STATE.OUTCOME_PENDING, error);
          throw error;
        }
        let receipt;
        try { receipt = receiptFromReadback(readback, record, queried, safeClock(clock)); } catch (error) {
          await rememberError(record, MAKER_V8_RECOVERY_STATE.OUTCOME_PENDING, error);
          throw error;
        }
        return cas(record, MAKER_V8_RECOVERY_STATE.VERIFIED, {
          receipt,
          queryOutcome: queried,
          lastError: null,
        });
      }

      if (queried.status === 'PENDING') {
        return cas(record, MAKER_V8_RECOVERY_STATE.OUTCOME_PENDING, {
          queryOutcome: queried,
          lastError: null,
        });
      }

      if (recoverOptions.replayIfNotFound !== true) {
        if (record.state === MAKER_V8_RECOVERY_STATE.BROADCASTING) return cas(
          record,
          MAKER_V8_RECOVERY_STATE.OUTCOME_PENDING,
          { queryOutcome: queried, lastError: null },
        );
        return record;
      }

      await assertCurrentContext(identity);
      record = await cas(record, MAKER_V8_RECOVERY_STATE.BROADCASTING, {
        broadcastCount: record.broadcastCount + 1,
        queryOutcome: queried,
        lastError: null,
      });
      let broadcastResult;
      try {
        broadcastResult = normalizeBroadcastResult(await broadcastBoundary({
          bytes: record.signed.bytes,
          signature: record.signed.signature,
          digest: record.signed.digest,
          signer: record.signed.signer,
          identity: publicData(identity),
        }), record.signed.digest);
      } catch (cause) {
        const error = cause instanceof MakerV8RecoveryError ? cause
          : new MakerV8RecoveryError('Exact signed transaction broadcast is ambiguous.', {
            code: MAKER_V8_RECOVERY_ERROR.BROADCAST_FAILED,
            layer: MAKER_V8_RECOVERY_ERROR_LAYER.BROADCAST,
            retryable: true,
            details: { cause: String(cause?.message || cause || 'unknown').slice(0, 512) },
            cause,
          });
        await rememberError(record, MAKER_V8_RECOVERY_STATE.OUTCOME_PENDING, error);
        throw error;
      }
      return cas(record, MAKER_V8_RECOVERY_STATE.OUTCOME_PENDING, {
        queryOutcome: deepFreeze({
          status: 'PENDING',
          digest: broadcastResult.digest,
          checkpoint: null,
          error: null,
        }),
        lastError: null,
      });
    },

    async broadcastSigned(identityValue) {
      return api.recover(identityValue, { replayIfNotFound: true });
    },

    async cleanupVerified(identityValue) {
      const identity = canonicalMakerV8RecoveryIdentity(identityValue);
      const record = requireExactIdentity(await loadScope(identity), identity);
      if (!record || record.state !== MAKER_V8_RECOVERY_STATE.VERIFIED) fail(
        MAKER_V8_RECOVERY_ERROR.STATE_INVALID,
        MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
        'Only a VERIFIED record with a durable receipt can be cleaned.',
      );
      validateReceipt(record.receipt, record);
      await storage('compareAndSwap receipt cleanup', () => persist.compareAndSwap(
        record.scopeKey,
        record.revision,
        null,
        { completionReceipt: record.receipt },
      ));
      const durable = await loadReceipt(identity);
      if (!durable || stableJson(durable) !== stableJson(record.receipt)) fail(
        MAKER_V8_RECOVERY_ERROR.RECEIPT_INVALID,
        MAKER_V8_RECOVERY_ERROR_LAYER.STORAGE,
        'Completion receipt did not survive cleanup readback.',
      );
      return durable;
    },

    async loadReceipt(identityValue) {
      return loadReceipt(canonicalMakerV8RecoveryIdentity(identityValue));
    },

    async listFinalizedFailures(identityValue) {
      const identity = canonicalMakerV8RecoveryIdentity(identityValue);
      const entries = await storage('listFinalizedFailures', () => (
        persist.listFinalizedFailures(makerV8RecoveryScopeKey(identity))
      ));
      return deepFreeze((entries || []).map((entry) => {
        const failure = publicData(entry);
        if (failure.schemaVersion !== MAKER_V8_RECOVERY_FAILURE_SCHEMA
          || failure.scopeKey !== makerV8RecoveryScopeKey(failure.identity)
          || failure.identityKey !== makerV8RecoveryIdentityKey(failure.identity)
          || failure.finalized !== true || failure.executionStatus !== 'FAILURE') fail(
          MAKER_V8_RECOVERY_ERROR.FINALIZED_FAILURE_INVALID,
          MAKER_V8_RECOVERY_ERROR_LAYER.STORAGE,
          'Stored finalized failure archive is malformed.',
        );
        return failure;
      }));
    },
  };

  return Object.freeze(api);
}
