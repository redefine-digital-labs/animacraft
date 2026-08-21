import { TransactionDataBuilder } from '@mysten/sui/transactions';
import { fromBase64, toBase64 } from '@mysten/sui/utils';
import { sha256 } from '@noble/hashes/sha2.js';
import { consumeMarketV8RecoveryEvidenceV8 } from './maker-v8-market.js';

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
  DISCARDED: 'DISCARDED',
  CLEANED: 'CLEANED',
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
  PLAN_EVIDENCE_REQUIRED: 'MAKER_V8_RECOVERY_PLAN_EVIDENCE_REQUIRED',
  PLAN_EVIDENCE_MISMATCH: 'MAKER_V8_RECOVERY_PLAN_EVIDENCE_MISMATCH',
  PLAN_EVIDENCE_REPLAY: 'MAKER_V8_RECOVERY_PLAN_EVIDENCE_REPLAY',
  CONTEXT_UNAVAILABLE: 'MAKER_V8_RECOVERY_CONTEXT_UNAVAILABLE',
  CONTEXT_DRIFT: 'MAKER_V8_RECOVERY_CONTEXT_DRIFT',
  CAS_CONFLICT: 'MAKER_V8_RECOVERY_CAS_CONFLICT',
  SESSION_CONFLICT: 'MAKER_V8_RECOVERY_SESSION_CONFLICT',
  SIGNATURE_LEASE_ACTIVE: 'MAKER_V8_RECOVERY_SIGNATURE_LEASE_ACTIVE',
  SIGNATURE_OUTCOME_UNKNOWN: 'MAKER_V8_RECOVERY_SIGNATURE_OUTCOME_UNKNOWN',
  UNSIGNED_CONFIRMATION_REQUIRED: 'MAKER_V8_RECOVERY_UNSIGNED_CONFIRMATION_REQUIRED',
  UNSIGNED_CONFIRMATION_INVALID: 'MAKER_V8_RECOVERY_UNSIGNED_CONFIRMATION_INVALID',
  PENDING_CONFLICT: 'MAKER_V8_RECOVERY_PENDING_CONFLICT',
  STORAGE_FAILED: 'MAKER_V8_RECOVERY_STORAGE_FAILED',
  STORAGE_RECORD_INVALID: 'MAKER_V8_RECOVERY_STORAGE_RECORD_INVALID',
  STATE_INVALID: 'MAKER_V8_RECOVERY_STATE_INVALID',
  SIGNING_FAILED: 'MAKER_V8_RECOVERY_SIGNING_FAILED',
  SIGNED_BYTES_MISMATCH: 'MAKER_V8_RECOVERY_SIGNED_BYTES_MISMATCH',
  SIGNATURE_INVALID: 'MAKER_V8_RECOVERY_SIGNATURE_INVALID',
  DIGEST_MISMATCH: 'MAKER_V8_RECOVERY_DIGEST_MISMATCH',
  SIGNATURE_REPLACEMENT_FORBIDDEN: 'MAKER_V8_RECOVERY_SIGNATURE_REPLACEMENT_FORBIDDEN',
  UNSIGNED_DISCARD_FORBIDDEN: 'MAKER_V8_RECOVERY_UNSIGNED_DISCARD_FORBIDDEN',
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

export const MAKER_V8_SIGNATURE_DISPOSITION = Object.freeze({
  REQUEST_IN_FLIGHT: 'REQUEST_IN_FLIGHT',
  DEFINITIVE_REJECTION: 'DEFINITIVE_REJECTION',
  OUTCOME_UNKNOWN: 'OUTCOME_UNKNOWN',
});

export function createMakerV8RecoverySessionId() {
  const cryptoValue = globalThis.crypto;
  if (!cryptoValue || typeof cryptoValue.randomUUID !== 'function') fail(
    MAKER_V8_RECOVERY_ERROR.CONFIG_INVALID,
    MAKER_V8_RECOVERY_ERROR_LAYER.CONFIGURATION,
    'A cryptographically random UUID source is required for recovery sessions.',
  );
  return `maker-v8-${cryptoValue.randomUUID()}`;
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

function text(value, label, code = MAKER_V8_RECOVERY_ERROR.IDENTITY_INVALID, maxLength = 2_048) {
  const result = typeof value === 'string' ? value.trim() : '';
  if (!result || result !== value || result.length > maxLength || /[\u0000-\u001f\u007f]/.test(result)) fail(
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

export const MAKER_V8_RECOVERY_PACKAGE_ROLES = Object.freeze([
  'CORE',
  'SEAL',
  'RUNTIME',
  'OUTPUT',
  'PHYSICAL',
  'MARKET',
  'RELEASE',
]);

function canonicalPackageTuple(value) {
  if (!Array.isArray(value) || value.length !== MAKER_V8_RECOVERY_PACKAGE_ROLES.length) fail(
    MAKER_V8_RECOVERY_ERROR.IDENTITY_INVALID,
    MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
    'packageTuple must contain the exact seven fresh-v8 package roles.',
  );
  const roles = new Set();
  const originals = new Set();
  const callables = new Set();
  const tuple = value.map((raw, index) => {
    exactKeys(
      raw,
      ['role', 'originalPackageId', 'callablePackageId'],
      `packageTuple[${index}]`,
    );
    const entry = clonePlainData(raw, `packageTuple[${index}]`, { allowScalar: false });
    entry.role = text(entry.role, `packageTuple[${index}] role`).toUpperCase();
    if (!MAKER_V8_RECOVERY_PACKAGE_ROLES.includes(entry.role)) fail(
      MAKER_V8_RECOVERY_ERROR.IDENTITY_INVALID,
      MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
      'packageTuple contains an unknown fresh-v8 role.',
      { role: entry.role },
    );
    entry.originalPackageId = canonicalSuiId(
      entry.originalPackageId,
      `packageTuple[${index}] original package id`,
    );
    entry.callablePackageId = canonicalSuiId(
      entry.callablePackageId,
      `packageTuple[${index}] callable package id`,
    );
    if (roles.has(entry.role)) fail(
      MAKER_V8_RECOVERY_ERROR.IDENTITY_INVALID,
      MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
      'packageTuple roles must be unique.',
      { role: entry.role },
    );
    if (originals.has(entry.originalPackageId) || callables.has(entry.callablePackageId)) fail(
      MAKER_V8_RECOVERY_ERROR.IDENTITY_INVALID,
      MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
      'Package roles must not collide in original or callable identity.',
      { role: entry.role },
    );
    roles.add(entry.role);
    originals.add(entry.originalPackageId);
    callables.add(entry.callablePackageId);
    return entry;
  });
  tuple.sort((left, right) => left.role.localeCompare(right.role));
  if (tuple.some((entry, index) => entry.role !== [...MAKER_V8_RECOVERY_PACKAGE_ROLES]
    .sort()[index])) fail(
    MAKER_V8_RECOVERY_ERROR.IDENTITY_INVALID,
    MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
    'packageTuple must bind each of the seven roles exactly once.',
  );
  return deepFreeze(tuple);
}

const MARKET_ACTIONS = Object.freeze({
  listMakerControl: Object.freeze({ lane: 'MAKER', laneCode: 0, kind: 'LIST', function: 'list_maker_control_v8', primary: 'admin', arguments: ['registry', 'treasury', 'root', 'admin', 'makerTreasury', 'protocolConfig', 'catalog', 'config', 'grossAtomic'] }),
  purchaseMakerControl: Object.freeze({ lane: 'MAKER', laneCode: 0, kind: 'PURCHASE', function: 'purchase_maker_control_v8', primary: 'listing', arguments: ['listing', 'registry', 'treasury', 'root', 'protocolConfig', 'protocolTreasury', 'catalog', 'config', 'adminReceiving', 'payment'] }),
  cancelMakerControl: Object.freeze({ lane: 'MAKER', laneCode: 0, kind: 'CANCEL', function: 'cancel_maker_control_listing_v8', primary: 'listing', arguments: ['listing', 'registry', 'treasury', 'root', 'catalog', 'config', 'adminReceiving'] }),
  recoverMakerControl: Object.freeze({ lane: 'MAKER', laneCode: 0, kind: 'RECOVER', function: 'recover_maker_control_listing_v8', primary: 'listing', arguments: ['listing', 'registry', 'treasury', 'root', 'protocolConfig', 'catalog', 'config', 'adminReceiving'] }),
  listSoulBundle: Object.freeze({ lane: 'SOUL', laneCode: 1, kind: 'LIST', function: 'list_soul_bundle_v8', primary: 'outputAsset', arguments: ['registry', 'treasury', 'outputRegistry', 'soulRegistry', 'root', 'protocolConfig', 'catalog', 'config', 'outputAsset', 'receipt', 'soul', 'grossAtomic'] }),
  purchaseSoulBundle: Object.freeze({ lane: 'SOUL', laneCode: 1, kind: 'PURCHASE', function: 'purchase_soul_bundle_v8', primary: 'listing', arguments: ['listing', 'registry', 'treasury', 'outputRegistry', 'soulRegistry', 'root', 'makerTreasury', 'protocolConfig', 'protocolTreasury', 'catalog', 'config', 'outputReceiving', 'receiptReceiving', 'soulReceiving', 'payment'] }),
  cancelSoulListing: Object.freeze({ lane: 'SOUL', laneCode: 1, kind: 'CANCEL', function: 'cancel_soul_listing_v8', primary: 'listing', arguments: ['listing', 'registry', 'treasury', 'outputRegistry', 'soulRegistry', 'root', 'catalog', 'config', 'outputReceiving', 'receiptReceiving', 'soulReceiving'] }),
  recoverSoulListing: Object.freeze({ lane: 'SOUL', laneCode: 1, kind: 'RECOVER', function: 'recover_soul_listing_v8', primary: 'listing', arguments: ['listing', 'registry', 'treasury', 'outputRegistry', 'soulRegistry', 'root', 'protocolConfig', 'catalog', 'config', 'outputReceiving', 'receiptReceiving', 'soulReceiving'] }),
  listBasePhysical: Object.freeze({ lane: 'PHYSICAL_BASE', laneCode: 2, kind: 'LIST', function: 'list_base_physical_v8', primary: 'asset', arguments: ['registry', 'treasury', 'physicalRegistry', 'root', 'makerTreasury', 'protocolConfig', 'catalog', 'physicalConfig', 'config', 'asset', 'grossAtomic'] }),
  listPackPhysical: Object.freeze({ lane: 'PHYSICAL_PACK', laneCode: 3, kind: 'LIST', function: 'list_pack_physical_v8', primary: 'asset', arguments: ['registry', 'treasury', 'physicalRegistry', 'root', 'packTreasury', 'protocolConfig', 'catalog', 'physicalConfig', 'config', 'asset', 'grossAtomic'] }),
  purchaseBasePhysical: Object.freeze({ lane: 'PHYSICAL_BASE', laneCode: 2, kind: 'PURCHASE', function: 'purchase_base_physical_v8', primary: 'listing', arguments: ['listing', 'registry', 'treasury', 'physicalRegistry', 'root', 'makerTreasury', 'protocolConfig', 'protocolTreasury', 'catalog', 'physicalConfig', 'config', 'receiving', 'payment'] }),
  purchasePackPhysical: Object.freeze({ lane: 'PHYSICAL_PACK', laneCode: 3, kind: 'PURCHASE', function: 'purchase_pack_physical_v8', primary: 'listing', arguments: ['listing', 'registry', 'treasury', 'physicalRegistry', 'root', 'packRelease', 'packTreasury', 'protocolConfig', 'protocolTreasury', 'catalog', 'physicalConfig', 'config', 'receiving', 'payment'] }),
  cancelPhysicalListing: Object.freeze({ lanes: Object.freeze(['PHYSICAL_BASE', 'PHYSICAL_PACK']), laneCodes: Object.freeze([2, 3]), kind: 'CANCEL', function: 'cancel_physical_listing_v8', primary: 'listing', arguments: ['listing', 'registry', 'treasury', 'physicalRegistry', 'root', 'catalog', 'config', 'receiving'] }),
  recoverPhysicalListing: Object.freeze({ lanes: Object.freeze(['PHYSICAL_BASE', 'PHYSICAL_PACK']), laneCodes: Object.freeze([2, 3]), kind: 'RECOVER', function: 'recover_physical_listing_v8', primary: 'listing', arguments: ['listing', 'registry', 'treasury', 'physicalRegistry', 'root', 'protocolConfig', 'catalog', 'config', 'receiving'] }),
});

const MARKET_V8_ACTION_SCHEMA = 'animacraft.market-action.v8';
const MARKET_V8_EVIDENCE_SCHEMA = 'animacraft.market-recovery-evidence.v8';
const MAKER_V8_RUNTIME_SCHEMA = 'animacraft.maker-v8-runtime.v8';
const MARKET_V8_NETWORK = 'mainnet';
const MARKET_RUNTIME_ROLES = Object.freeze([
  'core', 'seal', 'runtime', 'output', 'physical', 'market', 'release',
]);
const MARKET_CONFIG_ROLES = Object.freeze([
  'seal', 'runtime', 'output', 'physical', 'market', 'release',
]);
const MAKER_BINDING_FIELDS = Object.freeze([
  'rootId',
  'baseRegistryId',
  'makerTreasuryId',
  'sealRegistryId',
  'runtimeDefinitionRegistryId',
  'packRegistryId',
  'packAdmissionAuthorityId',
  'outputRegistryId',
  'soulRegistryId',
  'physicalRegistryId',
  'marketRegistryId',
  'marketTreasuryId',
]);
const CONSUMED_MARKET_EVIDENCE = new WeakSet();

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
  const chain = text(value.chain, 'Chain').toLowerCase();
  if (chain !== '35834a8a') fail(
    MAKER_V8_RECOVERY_ERROR.IDENTITY_INVALID,
    MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
    'Maker v8 recovery is pinned to the attested Sui Mainnet chain identifier.',
  );
  const action = text(value.action, 'Recovery action');
  const actionContract = MARKET_ACTIONS[action];
  if (!actionContract) fail(
    MAKER_V8_RECOVERY_ERROR.IDENTITY_INVALID,
    MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
    'Recovery action must be one of the fourteen exact Market v8 actions.',
    { action },
  );
  const lane = text(value.lane, 'Recovery lane').toUpperCase();
  const allowedLanes = actionContract.lanes ?? [actionContract.lane];
  if (!allowedLanes.includes(lane)) fail(
    MAKER_V8_RECOVERY_ERROR.IDENTITY_INVALID,
    MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
    'Recovery lane does not match the exact Market v8 action.',
    { action, lane, allowedLanes },
  );
  const authority = clonePlainData(value.authority, 'lane authority', { allowScalar: false });
  exactKeys(authority, ['kind', 'refs'], 'Lane authority');
  if (!Array.isArray(authority.refs) || authority.refs.length < 1 || authority.refs.length > 32) fail(
    MAKER_V8_RECOVERY_ERROR.IDENTITY_INVALID,
    MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
    'Lane authority must bind one or more exact object references.',
  );
  authority.kind = text(authority.kind, 'Lane authority kind').toUpperCase();
  const authorityIds = new Set();
  authority.refs = authority.refs.map((entry, index) => {
    const ref = canonicalObjectRef(entry, `Lane authority ref[${index}]`);
    if (authorityIds.has(ref.id)) fail(
      MAKER_V8_RECOVERY_ERROR.IDENTITY_INVALID,
      MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
      'Lane authority references must be unique.',
      { id: ref.id },
    );
    authorityIds.add(ref.id);
    return ref;
  });

  return deepFreeze({
    chain,
    wallet: canonicalSuiId(value.wallet, 'Wallet'),
    lane,
    action,
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

function canonicalFingerprintJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new TypeError('fingerprint number is not an integer');
    return JSON.stringify(value);
  }
  if (typeof value === 'bigint') return JSON.stringify(value.toString());
  if (Array.isArray(value)) return `[${value.map(canonicalFingerprintJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalFingerprintJson(value[key])}`
  )).join(',')}}`;
  throw new TypeError('fingerprint contains unsupported data');
}

function recoveryFingerprint(value) {
  const bytes = sha256(new TextEncoder().encode(canonicalFingerprintJson(value)));
  return `0x${[...bytes].map((entry) => entry.toString(16).padStart(2, '0')).join('')}`;
}

export function makerV8RecoveryIdentityKey(value) {
  const identity = canonicalMakerV8RecoveryIdentity(value);
  return `${MAKER_V8_RECOVERY_SCHEMA}:identity:${stableJson(identity)}`;
}

const SCOPE_FIELDS = Object.freeze(['chain', 'rootId']);

/** Canonical lookup scope that remains stable when a quote or action identity becomes stale. */
export function canonicalMakerV8RecoveryScope(value) {
  exactKeys(value, SCOPE_FIELDS, 'Maker v8 recovery scope');
  const chain = text(value.chain, 'Chain').toLowerCase();
  if (chain !== '35834a8a') fail(
    MAKER_V8_RECOVERY_ERROR.IDENTITY_INVALID,
    MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
    'Maker v8 recovery scope is pinned to the attested Sui Mainnet chain identifier.',
  );
  return deepFreeze({
    chain,
    rootId: canonicalSuiId(value.rootId, 'Root id'),
  });
}

export function makerV8RecoveryScopeLookupKey(value) {
  const scope = canonicalMakerV8RecoveryScope(value);
  return `${MAKER_V8_RECOVERY_SCHEMA}:root:${encodeURIComponent(scope.chain)}:${scope.rootId}`;
}

/** One pending action per exact chain + Root, independent of tab/session. */
export function makerV8RecoveryScopeKey(value) {
  const identity = canonicalMakerV8RecoveryIdentity(value);
  return makerV8RecoveryScopeLookupKey({ chain: identity.chain, rootId: identity.root.id });
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

function canonicalSignatureLease(value, plan, signatureSessionId) {
  exactKeys(value, ['sessionId', 'expiresAtMs', 'planHash'], 'Signature lease',
    MAKER_V8_RECOVERY_ERROR.STORAGE_RECORD_INVALID);
  const lease = {
    sessionId: exactSessionId(value.sessionId),
    expiresAtMs: exactTimestamp(value.expiresAtMs, 'Signature lease expiry'),
    planHash: opaque(value.planHash, 'Signature lease plan hash'),
  };
  if (lease.sessionId !== signatureSessionId || lease.planHash !== plan.fingerprint) fail(
    MAKER_V8_RECOVERY_ERROR.STORAGE_RECORD_INVALID,
    MAKER_V8_RECOVERY_ERROR_LAYER.STORAGE,
    'Signature lease does not bind the exact session and full durable plan hash.',
  );
  return deepFreeze(lease);
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

function canonicalMarketRuntime(value) {
  exactKeys(value, [
    'schemaVersion',
    'protocolVersion',
    'enabled',
    'catalogId',
    'protocolConfigId',
    'protocolTreasuryId',
    'paymentCoinType',
    'clockObjectId',
    'roles',
    'roleConfigIds',
    'makerBindings',
  ], 'Market recovery runtime', MAKER_V8_RECOVERY_ERROR.PLAN_INVALID);
  if (value.schemaVersion !== MAKER_V8_RUNTIME_SCHEMA
    || value.protocolVersion !== 8 || value.enabled !== true) fail(
    MAKER_V8_RECOVERY_ERROR.PLAN_EVIDENCE_MISMATCH,
    MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
    'Market recovery evidence is not an enabled exact fresh-v8 runtime.',
  );
  exactKeys(value.roles, MARKET_RUNTIME_ROLES, 'Market runtime roles',
    MAKER_V8_RECOVERY_ERROR.PLAN_INVALID);
  const roles = {};
  for (const role of MARKET_RUNTIME_ROLES) {
    exactKeys(value.roles[role], ['typeOriginPackageId', 'callablePackageId'],
      `Market runtime role ${role}`, MAKER_V8_RECOVERY_ERROR.PLAN_INVALID);
    roles[role] = deepFreeze({
      typeOriginPackageId: canonicalSuiId(
        value.roles[role].typeOriginPackageId,
        `Market runtime ${role} TypeOrigin`,
      ),
      callablePackageId: canonicalSuiId(
        value.roles[role].callablePackageId,
        `Market runtime ${role} callable package`,
      ),
    });
  }
  exactKeys(value.roleConfigIds, MARKET_CONFIG_ROLES, 'Market runtime config ids',
    MAKER_V8_RECOVERY_ERROR.PLAN_INVALID);
  const roleConfigIds = Object.fromEntries(MARKET_CONFIG_ROLES.map((role) => [
    role,
    canonicalSuiId(value.roleConfigIds[role], `Market runtime ${role} config`),
  ]));
  if (!Array.isArray(value.makerBindings)) fail(
    MAKER_V8_RECOVERY_ERROR.PLAN_INVALID,
    MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
    'Market runtime makerBindings must be an exact array.',
  );
  const makerBindings = value.makerBindings.map((binding, index) => {
    exactKeys(binding, MAKER_BINDING_FIELDS, `Market runtime makerBindings[${index}]`,
      MAKER_V8_RECOVERY_ERROR.PLAN_INVALID);
    return deepFreeze(Object.fromEntries(MAKER_BINDING_FIELDS.map((field) => [
      field,
      canonicalSuiId(binding[field], `Market runtime makerBindings[${index}].${field}`),
    ])));
  });
  return deepFreeze({
    schemaVersion: MAKER_V8_RUNTIME_SCHEMA,
    protocolVersion: 8,
    enabled: true,
    catalogId: canonicalSuiId(value.catalogId, 'Market runtime catalog'),
    protocolConfigId: canonicalSuiId(value.protocolConfigId, 'Market runtime protocol config'),
    protocolTreasuryId: canonicalSuiId(
      value.protocolTreasuryId,
      'Market runtime protocol treasury',
    ),
    paymentCoinType: canonicalSuiType(value.paymentCoinType, 'Market runtime payment coin'),
    clockObjectId: canonicalSuiId(value.clockObjectId, 'Market runtime clock'),
    roles: deepFreeze(roles),
    roleConfigIds: deepFreeze(roleConfigIds),
    makerBindings: deepFreeze(makerBindings),
  });
}

function descriptorArgumentKind(name) {
  if (name === 'payment') return 'payment';
  if (name === 'grossAtomic') return 'u64';
  if (name === 'receiving' || name.endsWith('Receiving')) return 'receiving';
  return 'object';
}

function canonicalDescriptorArgument(value, name, index) {
  const expectedKind = descriptorArgumentKind(name);
  const label = `Market descriptor argument[${index}]`;
  const fields = expectedKind === 'object'
    ? ['kind', 'name', 'objectId', 'type']
    : expectedKind === 'receiving'
      ? ['kind', 'name', 'objectId', 'type', 'version', 'digest']
      : expectedKind === 'payment'
        ? ['kind', 'name', 'type', 'balanceAtomic']
        : ['kind', 'name', 'value'];
  exactKeys(value, fields, label, MAKER_V8_RECOVERY_ERROR.PLAN_INVALID);
  if (value.kind !== expectedKind || value.name !== name) fail(
    MAKER_V8_RECOVERY_ERROR.PLAN_EVIDENCE_MISMATCH,
    MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
    'Market evidence argument kind or order differs from the exact action ABI.',
    { index, expectedName: name, expectedKind },
  );
  if (expectedKind === 'u64') return deepFreeze({
    kind: expectedKind,
    name,
    value: canonicalU64(value.value, `${label} value`, { positive: true }),
  });
  if (expectedKind === 'payment') return deepFreeze({
    kind: expectedKind,
    name,
    type: canonicalSuiType(value.type, `${label} type`),
    balanceAtomic: canonicalU64(value.balanceAtomic, `${label} balance`, { positive: true }),
  });
  const object = {
    kind: expectedKind,
    name,
    objectId: canonicalSuiId(value.objectId, `${label} object id`),
    type: canonicalSuiType(value.type, `${label} type`),
  };
  if (expectedKind === 'receiving') {
    object.version = canonicalU64(value.version, `${label} version`, { positive: true });
    object.digest = opaque(value.digest, `${label} digest`);
  }
  return deepFreeze(object);
}

function canonicalMarketDescriptor(value, runtime, identity) {
  exactKeys(value, [
    'schema',
    'action',
    'lane',
    'target',
    'typeArguments',
    'sender',
    'network',
    'catalogId',
    'protocolConfigId',
    'protocolTreasuryId',
    'rootId',
    'registryId',
    'treasuryId',
    'rootContentCommitment',
    'protocolRevision',
    'roleConfigIds',
    'packageTuple',
    'arguments',
    'expectation',
    'preState',
  ], 'Market recovery descriptor', MAKER_V8_RECOVERY_ERROR.PLAN_INVALID);
  const contract = MARKET_ACTIONS[identity.action];
  const laneCode = contract.lanes
    ? contract.laneCodes[contract.lanes.indexOf(identity.lane)]
    : contract.laneCode;
  const expectedTarget = `${runtime.roles.market.callablePackageId}::market_v8::${contract.function}`;
  if (value.schema !== MARKET_V8_ACTION_SCHEMA || value.action !== identity.action
    || value.lane !== laneCode || value.target !== expectedTarget
    || value.sender !== identity.wallet || value.network !== MARKET_V8_NETWORK) fail(
    MAKER_V8_RECOVERY_ERROR.PLAN_EVIDENCE_MISMATCH,
    MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
    'Market evidence action, lane, target, sender, or network differs from recovery identity.',
  );
  if (!Array.isArray(value.typeArguments) || value.typeArguments.length !== 1
    || canonicalSuiType(value.typeArguments[0], 'Market type argument') !== identity.paymentCoin
    || identity.paymentCoin !== runtime.paymentCoinType) fail(
    MAKER_V8_RECOVERY_ERROR.PLAN_EVIDENCE_MISMATCH,
    MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
    'Market evidence payment type differs from the exact recovery identity.',
  );
  exactKeys(value.roleConfigIds, MARKET_CONFIG_ROLES, 'Market descriptor config ids',
    MAKER_V8_RECOVERY_ERROR.PLAN_INVALID);
  const roleConfigIds = Object.fromEntries(MARKET_CONFIG_ROLES.map((role) => [
    role,
    canonicalSuiId(value.roleConfigIds[role], `Market descriptor ${role} config`),
  ]));
  if (stableJson(roleConfigIds) !== stableJson(runtime.roleConfigIds)) fail(
    MAKER_V8_RECOVERY_ERROR.PLAN_EVIDENCE_MISMATCH,
    MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
    'Market descriptor config tuple differs from its attested runtime.',
  );
  if (!Array.isArray(value.packageTuple)
    || value.packageTuple.length !== MARKET_RUNTIME_ROLES.length) fail(
    MAKER_V8_RECOVERY_ERROR.PLAN_INVALID,
    MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
    'Market descriptor must bind the exact seven-role package tuple.',
  );
  const descriptorTupleInput = value.packageTuple.map((entry, index) => {
    exactKeys(entry, ['role', 'originalPackageId', 'callablePackageId'],
      `Market descriptor packageTuple[${index}]`, MAKER_V8_RECOVERY_ERROR.PLAN_INVALID);
    const role = text(entry.role, `Market descriptor packageTuple[${index}] role`).toLowerCase();
    if (!MARKET_RUNTIME_ROLES.includes(role)) fail(
      MAKER_V8_RECOVERY_ERROR.PLAN_EVIDENCE_MISMATCH,
      MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
      'Market descriptor contains an unknown package role.',
      { role },
    );
    return {
      role,
      originalPackageId: canonicalSuiId(
        entry.originalPackageId,
        `Market descriptor ${role} TypeOrigin`,
      ),
      callablePackageId: canonicalSuiId(
        entry.callablePackageId,
        `Market descriptor ${role} callable package`,
      ),
    };
  });
  if (new Set(descriptorTupleInput.map(({ role }) => role)).size
    !== MARKET_RUNTIME_ROLES.length) fail(
    MAKER_V8_RECOVERY_ERROR.PLAN_EVIDENCE_MISMATCH,
    MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
    'Market descriptor package roles must be unique.',
  );
  const descriptorByRole = new Map(descriptorTupleInput.map((entry) => [entry.role, entry]));
  const descriptorTuple = MARKET_RUNTIME_ROLES.map((role) => descriptorByRole.get(role));
  const expectedTuple = MARKET_RUNTIME_ROLES.map((role) => ({
    role,
    originalPackageId: runtime.roles[role].typeOriginPackageId,
    callablePackageId: runtime.roles[role].callablePackageId,
  }));
  const identityTuple = identity.packageTuple.map((entry) => ({
    role: entry.role.toLowerCase(),
    originalPackageId: entry.originalPackageId,
    callablePackageId: entry.callablePackageId,
  })).sort((left, right) => left.role.localeCompare(right.role));
  if (stableJson(descriptorTuple) !== stableJson(expectedTuple)
    || stableJson([...descriptorTuple].sort((left, right) => left.role.localeCompare(right.role)))
      !== stableJson(identityTuple)) fail(
    MAKER_V8_RECOVERY_ERROR.PLAN_EVIDENCE_MISMATCH,
    MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
    'Market evidence does not bind the identity to the attested seven-role package tuple.',
  );
  if (!Array.isArray(value.arguments) || value.arguments.length !== contract.arguments.length) fail(
    MAKER_V8_RECOVERY_ERROR.PLAN_EVIDENCE_MISMATCH,
    MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
    'Market evidence argument count differs from the exact action ABI.',
  );
  const args = value.arguments.map((entry, index) => (
    canonicalDescriptorArgument(entry, contract.arguments[index], index)
  ));
  const byName = new Map(args.map((entry) => [entry.name, entry]));
  for (const [name, expectedId] of [
    ['root', identity.root.id],
    ['registry', identity.registry.id],
    ['treasury', identity.treasury.id],
    [contract.primary, identity.listing.id],
  ]) {
    if (byName.get(name)?.objectId !== expectedId) fail(
      MAKER_V8_RECOVERY_ERROR.PLAN_EVIDENCE_MISMATCH,
      MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
      'Market evidence object intent differs from the immutable recovery identity.',
      { name, expectedId, observedId: byName.get(name)?.objectId ?? null },
    );
  }
  for (const ref of identity.authority.refs) {
    const argument = args.find((entry) => entry.objectId === ref.id);
    if (!argument || (argument.kind === 'receiving'
      && (argument.version !== ref.version || argument.digest !== ref.digest))) fail(
      MAKER_V8_RECOVERY_ERROR.PLAN_EVIDENCE_MISMATCH,
      MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
      'Market evidence does not contain the exact lane-authority reference.',
      { authorityId: ref.id },
    );
  }
  exactKeys(value.expectation, ['listingRevision', 'registryRevision', 'quoteCommitment'],
    'Market descriptor expectation', MAKER_V8_RECOVERY_ERROR.PLAN_INVALID);
  const expectation = {
    listingRevision: canonicalU64(value.expectation.listingRevision, 'Expected listing revision'),
    registryRevision: canonicalU64(value.expectation.registryRevision, 'Expected registry revision'),
    quoteCommitment: opaque(value.expectation.quoteCommitment, 'Expected quote commitment'),
  };
  const catalogId = canonicalSuiId(value.catalogId, 'Market descriptor catalog');
  const protocolConfigId = canonicalSuiId(
    value.protocolConfigId,
    'Market descriptor protocol config',
  );
  const protocolTreasuryId = canonicalSuiId(
    value.protocolTreasuryId,
    'Market descriptor protocol treasury',
  );
  const rootId = canonicalSuiId(value.rootId, 'Market descriptor root');
  const registryId = canonicalSuiId(value.registryId, 'Market descriptor registry');
  const treasuryId = canonicalSuiId(value.treasuryId, 'Market descriptor treasury');
  const rootContentCommitment = opaque(
    value.rootContentCommitment,
    'Market descriptor Root content commitment',
  );
  const protocolRevision = canonicalU64(
    value.protocolRevision,
    'Market descriptor protocol revision',
  );
  if (catalogId !== runtime.catalogId || protocolConfigId !== runtime.protocolConfigId
    || protocolTreasuryId !== runtime.protocolTreasuryId
    || rootId !== identity.root.id || registryId !== identity.registry.id
    || treasuryId !== identity.treasury.id
    || rootContentCommitment !== identity.rootContentCommitment
    || protocolRevision !== identity.protocolRevision
    || expectation.listingRevision !== identity.listingRevision
    || expectation.quoteCommitment !== identity.quoteCommitment) fail(
    MAKER_V8_RECOVERY_ERROR.PLAN_EVIDENCE_MISMATCH,
    MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
    'Market evidence runtime, refs, revisions, or quote differs from recovery identity.',
  );
  const preState = clonePlainData(value.preState, 'Market action pre-state', {
    allowScalar: false,
  });
  if (preState.schema !== 'animacraft.market-action-prestate.v8'
    || preState.action !== identity.action || preState.lane !== laneCode
    || preState.sender !== identity.wallet) fail(
    MAKER_V8_RECOVERY_ERROR.PLAN_EVIDENCE_MISMATCH,
    MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
    'Market action pre-state does not bind the exact action, lane, and sender.',
  );
  return deepFreeze({
    schema: MARKET_V8_ACTION_SCHEMA,
    action: identity.action,
    lane: laneCode,
    target: expectedTarget,
    typeArguments: deepFreeze([identity.paymentCoin]),
    sender: identity.wallet,
    network: MARKET_V8_NETWORK,
    catalogId,
    protocolConfigId,
    protocolTreasuryId,
    rootId,
    registryId,
    treasuryId,
    rootContentCommitment,
    protocolRevision,
    roleConfigIds: deepFreeze(roleConfigIds),
    packageTuple: deepFreeze(descriptorTuple.map(deepFreeze)),
    arguments: deepFreeze(args),
    expectation: deepFreeze(expectation),
    preState: deepFreeze(preState),
  });
}

function canonicalMarketSnapshot(value, identity) {
  exactKeys(value, ['schema', 'descriptor', 'runtime'], 'Market recovery snapshot',
    MAKER_V8_RECOVERY_ERROR.PLAN_INVALID);
  if (value.schema !== MARKET_V8_EVIDENCE_SCHEMA) fail(
    MAKER_V8_RECOVERY_ERROR.PLAN_EVIDENCE_MISMATCH,
    MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
    'Market recovery evidence schema is not exact fresh-v8.',
  );
  const runtime = canonicalMarketRuntime(value.runtime);
  const descriptor = canonicalMarketDescriptor(value.descriptor, runtime, identity);
  return deepFreeze({ schema: MARKET_V8_EVIDENCE_SCHEMA, descriptor, runtime });
}

function u64PureBase64(value) {
  let remaining = BigInt(value);
  const bytes = new Uint8Array(8);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return toBase64(bytes);
}

function inputArgumentIndex(value, label) {
  if (value?.$kind !== 'Input' || !Number.isSafeInteger(value.Input) || value.Input < 0) fail(
    MAKER_V8_RECOVERY_ERROR.PLAN_INVALID,
    MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
    `${label} does not reference an exact transaction input.`,
  );
  return value.Input;
}

function decodedObjectIdentity(input, label) {
  const object = input?.Object;
  const value = object?.ImmOrOwnedObject ?? object?.SharedObject ?? object?.Receiving;
  if (!value) fail(
    MAKER_V8_RECOVERY_ERROR.PLAN_INVALID,
    MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
    `${label} is not an exact object transaction input.`,
  );
  return {
    kind: object.$kind,
    objectId: canonicalSuiId(value.objectId, `${label} object id`),
    version: value.version === undefined ? null : canonicalU64(value.version, `${label} version`, {
      positive: true,
    }),
    digest: value.digest ?? null,
  };
}

function assertDecodedArgument(snapshot, call, descriptorArgument, index) {
  const callArgument = call.arguments[index];
  const label = `Decoded Market argument ${descriptorArgument.name}`;
  if (descriptorArgument.kind === 'payment') {
    if (callArgument?.$kind !== 'NestedResult' || !Array.isArray(callArgument.NestedResult)) fail(
      MAKER_V8_RECOVERY_ERROR.PLAN_EVIDENCE_MISMATCH,
      MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
      'Decoded payment is not the exact resolved CoinWithBalance split result.',
    );
    const [commandIndex, resultIndex] = callArgument.NestedResult;
    const split = snapshot.commands[commandIndex]?.SplitCoins;
    if (!split || !Number.isSafeInteger(resultIndex) || resultIndex < 0
      || resultIndex >= split.amounts.length) fail(
      MAKER_V8_RECOVERY_ERROR.PLAN_EVIDENCE_MISMATCH,
      MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
      'Decoded payment does not reference a valid exact coin split.',
    );
    const amount = snapshot.inputs[inputArgumentIndex(
      split.amounts[resultIndex],
      `${label} split amount`,
    )];
    if (amount?.Pure?.bytes !== u64PureBase64(descriptorArgument.balanceAtomic)) fail(
      MAKER_V8_RECOVERY_ERROR.PLAN_EVIDENCE_MISMATCH,
      MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
      'Decoded payment amount differs from the reviewed gross intent.',
    );
    return;
  }
  const input = snapshot.inputs[inputArgumentIndex(callArgument, label)];
  if (descriptorArgument.kind === 'u64') {
    if (input?.Pure?.bytes !== u64PureBase64(descriptorArgument.value)) fail(
      MAKER_V8_RECOVERY_ERROR.PLAN_EVIDENCE_MISMATCH,
      MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
      'Decoded pure u64 differs from the reviewed Market intent.',
    );
    return;
  }
  const observed = decodedObjectIdentity(input, label);
  if (observed.objectId !== descriptorArgument.objectId
    || (descriptorArgument.kind === 'receiving'
      && (observed.kind !== 'Receiving' || observed.version !== descriptorArgument.version
        || observed.digest !== descriptorArgument.digest))
    || (descriptorArgument.kind === 'object' && observed.kind === 'Receiving')) fail(
    MAKER_V8_RECOVERY_ERROR.PLAN_EVIDENCE_MISMATCH,
    MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
    'Decoded object or Receiving ref differs from the reviewed Market intent.',
    { argument: descriptorArgument.name },
  );
}

function allowedCoinPlumbing(command, paymentCoinType) {
  if (command?.MergeCoins || command?.SplitCoins) return true;
  const call = command?.MoveCall;
  if (!call) return false;
  const system = canonicalSuiId('0x2', 'Sui framework package');
  return call.package === system
    && new Set([
      'coin::redeem_funds',
      'coin::destroy_zero',
      'coin::into_balance',
      'coin::send_funds',
      'balance::redeem_funds',
    ]).has(`${call.module}::${call.function}`)
    && call.typeArguments.length === 1
    && canonicalSuiType(call.typeArguments[0], 'Coin plumbing type') === paymentCoinType;
}

function assertDecodedTransaction(snapshot, descriptor, identity) {
  if (snapshot.sender !== identity.wallet || snapshot.gasData?.owner !== identity.wallet) fail(
    MAKER_V8_RECOVERY_ERROR.PLAN_EVIDENCE_MISMATCH,
    MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
    'Decoded transaction sender or gas owner differs from recovery identity.',
  );
  const [expectedPackage, expectedModule, expectedFunction] = descriptor.target.split('::');
  const marketCommands = snapshot.commands.filter((command) => command?.MoveCall
    && command.MoveCall.package === expectedPackage
    && command.MoveCall.module === expectedModule
    && command.MoveCall.function === expectedFunction);
  if (marketCommands.length !== 1) fail(
    MAKER_V8_RECOVERY_ERROR.PLAN_EVIDENCE_MISMATCH,
    MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
    'Decoded transaction must contain exactly one exact Market action call.',
  );
  const marketCommand = marketCommands[0];
  const call = marketCommand.MoveCall;
  if (call.typeArguments.length !== 1
    || canonicalSuiType(call.typeArguments[0], 'Decoded Market payment type') !== identity.paymentCoin
    || call.arguments.length !== descriptor.arguments.length) fail(
    MAKER_V8_RECOVERY_ERROR.PLAN_EVIDENCE_MISMATCH,
    MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
    'Decoded Market call type arguments or argument count differ from evidence.',
  );
  descriptor.arguments.forEach((argument, index) => (
    assertDecodedArgument(snapshot, call, argument, index)
  ));
  for (const command of snapshot.commands) {
    if (command === marketCommand) continue;
    if (!allowedCoinPlumbing(command, identity.paymentCoin)) fail(
      MAKER_V8_RECOVERY_ERROR.PLAN_EVIDENCE_MISMATCH,
      MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
      'Decoded transaction contains an unrelated or extra command.',
    );
  }
  if (MARKET_ACTIONS[identity.action].kind !== 'PURCHASE' && snapshot.commands.length !== 1) fail(
    MAKER_V8_RECOVERY_ERROR.PLAN_EVIDENCE_MISMATCH,
    MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
    'A non-purchase Market action may not contain coin plumbing or extra commands.',
  );
}

function canonicalGasSnapshot(value, snapshot, identity) {
  exactKeys(value, ['owner', 'budget', 'price', 'payment', 'funding'], 'Gas snapshot',
    MAKER_V8_RECOVERY_ERROR.PLAN_INVALID);
  const owner = canonicalSuiId(value.owner, 'Gas owner');
  const budget = canonicalU64(value.budget, 'Gas budget', { positive: true });
  const price = canonicalU64(value.price, 'Gas price', { positive: true });
  if (BigInt(budget) > 500_000_000n || BigInt(price) > 1_000_000_000n) fail(
    MAKER_V8_RECOVERY_ERROR.PLAN_INVALID,
    MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
    'Gas budget or price exceeds the explicit recovery safety cap.',
  );
  if (!Array.isArray(value.payment) || value.payment.length > 256) fail(
    MAKER_V8_RECOVERY_ERROR.PLAN_INVALID,
    MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
    'Gas payment refs must be an exact bounded array.',
  );
  const seen = new Set();
  const payment = value.payment.map((entry, index) => {
    exactKeys(entry, ['objectId', 'version', 'digest'], `Gas payment[${index}]`,
      MAKER_V8_RECOVERY_ERROR.PLAN_INVALID);
    const result = {
      objectId: canonicalSuiId(entry.objectId, `Gas payment[${index}] id`),
      version: canonicalU64(entry.version, `Gas payment[${index}] version`, { positive: true }),
      digest: opaque(entry.digest, `Gas payment[${index}] digest`),
    };
    if (seen.has(result.objectId)) fail(
      MAKER_V8_RECOVERY_ERROR.PLAN_INVALID,
      MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
      'Gas payment refs must be unique.',
      { objectId: result.objectId },
    );
    seen.add(result.objectId);
    return deepFreeze(result);
  });
  let funding;
  if (payment.length > 0) {
    exactKeys(value.funding, ['kind'], 'Gas funding', MAKER_V8_RECOVERY_ERROR.PLAN_INVALID);
    if (value.funding.kind !== 'OBJECT_REFS') fail(
      MAKER_V8_RECOVERY_ERROR.PLAN_EVIDENCE_MISMATCH,
      MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
      'Non-empty gas payment refs require OBJECT_REFS funding evidence.',
    );
    funding = { kind: 'OBJECT_REFS' };
  } else {
    exactKeys(value.funding, ['kind', 'addressBalance', 'coinType'], 'Gas funding',
      MAKER_V8_RECOVERY_ERROR.PLAN_INVALID);
    const addressBalance = canonicalU64(
      value.funding.addressBalance,
      'Gas address balance',
    );
    const coinType = canonicalSuiType(value.funding.coinType, 'Gas address-balance coin type');
    if (value.funding.kind !== 'ADDRESS_BALANCE' || BigInt(addressBalance) < BigInt(budget)
      || coinType !== canonicalSuiType('0x2::sui::SUI', 'Sui gas coin type')) fail(
      MAKER_V8_RECOVERY_ERROR.PLAN_EVIDENCE_MISMATCH,
      MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
      'Empty gas refs require sufficient exact Mainnet SUI address-balance evidence.',
    );
    funding = { kind: 'ADDRESS_BALANCE', addressBalance, coinType };
  }
  const decodedPayment = (snapshot.gasData?.payment ?? []).map((entry, index) => ({
    objectId: canonicalSuiId(entry.objectId, `Decoded gas payment[${index}] id`),
    version: canonicalU64(entry.version, `Decoded gas payment[${index}] version`, { positive: true }),
    digest: opaque(entry.digest, `Decoded gas payment[${index}] digest`),
  }));
  if (owner !== identity.wallet || snapshot.gasData?.owner !== owner
    || String(snapshot.gasData?.budget) !== budget || String(snapshot.gasData?.price) !== price
    || stableJson(decodedPayment) !== stableJson(payment)) fail(
    MAKER_V8_RECOVERY_ERROR.PLAN_EVIDENCE_MISMATCH,
    MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
    'Gas owner, budget, price, or payment refs differ from the decoded transaction bytes.',
  );
  return deepFreeze({
    owner,
    budget,
    price,
    payment: deepFreeze(payment),
    funding: deepFreeze(funding),
  });
}

function consumeMarketEvidence(value, phase) {
  if (!value || typeof value !== 'object') fail(
    MAKER_V8_RECOVERY_ERROR.PLAN_EVIDENCE_REQUIRED,
    MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
    `${phase} requires a fresh branded Market recovery evidence object.`,
  );
  if (CONSUMED_MARKET_EVIDENCE.has(value)) fail(
    MAKER_V8_RECOVERY_ERROR.PLAN_EVIDENCE_REPLAY,
    MAKER_V8_RECOVERY_ERROR_LAYER.TERMINAL,
    'Market recovery evidence is one-shot and was already consumed.',
    { phase },
  );
  let checked;
  try {
    checked = consumeMarketV8RecoveryEvidenceV8(value);
  } catch (cause) {
    fail(
      MAKER_V8_RECOVERY_ERROR.PLAN_EVIDENCE_REQUIRED,
      MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
      `${phase} requires evidence produced by the attested Market builder and Mainnet dry-run.`,
      { marketCode: cause?.code ?? null },
      false,
      cause,
    );
  }
  CONSUMED_MARKET_EVIDENCE.add(value);
  const evidence = clonePlainData(checked, `${phase} Market evidence`, { allowScalar: false });
  exactKeys(evidence, [
    'schema',
    'transactionBytes',
    'transactionDigest',
    'descriptor',
    'runtime',
    'gasData',
    'expiration',
    'epochWindow',
    'sourceFingerprint',
    'dryRunAtMs',
  ], `${phase} Market evidence`, MAKER_V8_RECOVERY_ERROR.PLAN_INVALID);
  exactTimestamp(evidence.dryRunAtMs, `${phase} dry-run timestamp`);
  return deepFreeze(evidence);
}

function canonicalExpiration(value, snapshot) {
  exactKeys(value, ['kind', 'epoch'], 'Transaction expiration',
    MAKER_V8_RECOVERY_ERROR.PLAN_INVALID);
  const epoch = canonicalU64(value.epoch, 'Transaction expiration epoch', { positive: true });
  if (value.kind !== 'Epoch' || snapshot.expiration?.$kind !== 'Epoch'
    || String(snapshot.expiration.Epoch) !== epoch) fail(
    MAKER_V8_RECOVERY_ERROR.PLAN_EVIDENCE_MISMATCH,
    MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
    'Durable expiration differs from the exact decoded Epoch expiration.',
  );
  return deepFreeze({ kind: 'Epoch', epoch });
}

async function canonicalPlan(value, identity, deriveTransactionDigest, marketEvidence = undefined) {
  exactKeys(value, [
    'transactionBytes',
    'transactionDigest',
    'stage',
    'sequence',
    'signer',
    'epochWindow',
    'gas',
    'expiration',
    'sourceSnapshot',
    ...(marketEvidence === undefined ? ['market', 'fingerprint'] : []),
  ], 'Maker v8 transaction plan', MAKER_V8_RECOVERY_ERROR.PLAN_INVALID);
  const transactionBytes = text(
    value.transactionBytes,
    'Exact transaction bytes',
    MAKER_V8_RECOVERY_ERROR.PLAN_INVALID,
    2_000_000,
  );
  let decodedBytes;
  let snapshot;
  let sdkDigest;
  try {
    decodedBytes = fromBase64(transactionBytes);
    if (toBase64(decodedBytes) !== transactionBytes) throw new TypeError('non-canonical base64');
    if (decodedBytes.length > 128 * 1_024) throw new TypeError('transaction exceeds 128 KiB');
    snapshot = TransactionDataBuilder.fromBytes(decodedBytes).snapshot();
    sdkDigest = TransactionDataBuilder.getDigestFromBytes(decodedBytes);
  } catch (cause) {
    fail(
      MAKER_V8_RECOVERY_ERROR.PLAN_INVALID,
      MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
      'The transaction bytes are not canonical full Sui TransactionData.',
      {},
      false,
      cause,
    );
  }
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
  if (supplied !== derived || supplied !== sdkDigest) fail(
    MAKER_V8_RECOVERY_ERROR.DIGEST_MISMATCH,
    MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
    'The planned digest does not match both the exact bytes and Sui SDK digest.',
    { supplied, derived, sdkDigest },
  );
  const signer = canonicalSuiId(value.signer, 'Transaction signer');
  if (signer !== identity.wallet) fail(
    MAKER_V8_RECOVERY_ERROR.CONTEXT_DRIFT,
    MAKER_V8_RECOVERY_ERROR_LAYER.CONTEXT,
    'The planned signer does not match the immutable wallet identity.',
    { signer, wallet: identity.wallet },
  );
  const marketInput = marketEvidence === undefined
    ? value.market
    : {
      schema: marketEvidence.schema,
      descriptor: marketEvidence.descriptor,
      runtime: marketEvidence.runtime,
    };
  if (marketEvidence !== undefined
    && (marketEvidence.transactionBytes !== transactionBytes
      || marketEvidence.transactionDigest !== derived)) fail(
    MAKER_V8_RECOVERY_ERROR.PLAN_EVIDENCE_MISMATCH,
    MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
    'Market evidence is for different transaction bytes or digest.',
  );
  const market = canonicalMarketSnapshot(marketInput, identity);
  assertDecodedTransaction(snapshot, market.descriptor, identity);
  exactKeys(value.epochWindow, ['start', 'end'], 'Epoch window', MAKER_V8_RECOVERY_ERROR.PLAN_INVALID);
  const epochWindow = {
    start: canonicalU64(value.epochWindow.start, 'Epoch window start'),
    end: canonicalU64(value.epochWindow.end, 'Epoch window end'),
  };
  const expiration = canonicalExpiration(value.expiration, snapshot);
  if (BigInt(epochWindow.end) !== BigInt(epochWindow.start) + 1n
    || epochWindow.end !== expiration.epoch) fail(
    MAKER_V8_RECOVERY_ERROR.PLAN_INVALID,
    MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
    'Epoch window must cover exactly the freshly read epoch through its +1 expiration.',
  );
  const rawSourceSnapshot = clonePlainData(
    value.sourceSnapshot,
    'Source snapshot',
    { allowScalar: false },
  );
  exactKeys(rawSourceSnapshot, ['schema', 'fingerprint', 'descriptor'], 'Source snapshot',
    MAKER_V8_RECOVERY_ERROR.PLAN_INVALID);
  const sourceDescriptor = canonicalMarketDescriptor(
    rawSourceSnapshot.descriptor,
    market.runtime,
    identity,
  );
  const sourceFingerprint = opaque(rawSourceSnapshot.fingerprint, 'Source fingerprint');
  const decodedSourceFingerprint = recoveryFingerprint({
    descriptor: market.descriptor,
    inputs: snapshot.inputs,
  });
  if (rawSourceSnapshot.schema !== 'animacraft.market-source-snapshot.v8'
    || stableJson(sourceDescriptor) !== stableJson(market.descriptor)
    || sourceFingerprint !== decodedSourceFingerprint) fail(
    MAKER_V8_RECOVERY_ERROR.PLAN_EVIDENCE_MISMATCH,
    MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
    'Source snapshot does not bind the exact descriptor and decoded transaction inputs.',
  );
  const sourceSnapshot = deepFreeze({
    schema: 'animacraft.market-source-snapshot.v8',
    fingerprint: sourceFingerprint,
    descriptor: sourceDescriptor,
  });
  const gas = canonicalGasSnapshot(value.gas, snapshot, identity);
  if (marketEvidence !== undefined) {
    const evidenceEpochWindow = {
      start: canonicalU64(marketEvidence.epochWindow?.start, 'Evidence epoch start'),
      end: canonicalU64(marketEvidence.epochWindow?.end, 'Evidence epoch end'),
    };
    const evidenceExpiration = canonicalExpiration(marketEvidence.expiration, snapshot);
    const evidenceGas = canonicalGasSnapshot(marketEvidence.gasData, snapshot, identity);
    const evidenceSource = opaque(marketEvidence.sourceFingerprint, 'Evidence source fingerprint');
    if (stableJson(evidenceEpochWindow) !== stableJson(epochWindow)
      || stableJson(evidenceExpiration) !== stableJson(expiration)
      || stableJson(evidenceGas) !== stableJson(gas)
      || evidenceSource !== sourceFingerprint) fail(
      MAKER_V8_RECOVERY_ERROR.PLAN_EVIDENCE_MISMATCH,
      MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
      'Plan gas, expiration, epoch window, or source differs from fresh Market evidence.',
    );
  }
  const contract = MARKET_ACTIONS[identity.action];
  const stage = text(value.stage, 'Transaction stage', MAKER_V8_RECOVERY_ERROR.PLAN_INVALID);
  const sequence = canonicalU64(value.sequence, 'Transaction sequence');
  if (stage !== `MARKET_${contract.kind}` || sequence !== identity.listingRevision) fail(
    MAKER_V8_RECOVERY_ERROR.PLAN_EVIDENCE_MISMATCH,
    MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
    'Transaction stage or sequence differs from the verified Market action intent.',
  );
  const canonical = {
    transactionBytes,
    transactionDigest: derived,
    stage,
    sequence,
    signer,
    epochWindow: deepFreeze(epochWindow),
    gas,
    expiration,
    sourceSnapshot,
    market,
  };
  const fingerprint = recoveryFingerprint(canonical);
  if (marketEvidence === undefined && value.fingerprint !== fingerprint) fail(
    MAKER_V8_RECOVERY_ERROR.PLAN_EVIDENCE_MISMATCH,
    MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
    'Durable recovery plan fingerprint does not cover its exact full canonical plan.',
    { supplied: value.fingerprint, derived: fingerprint },
  );
  return deepFreeze({ ...canonical, fingerprint });
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
 * `load(scopeKey)` loads the sole active record for an exact chain + Root
 * scope; it must not require the caller to know the current full identity.
 *
 * `compareAndSwap` must atomically validate the revision and perform exactly
 * one operation: (a) write `nextRecord`, optionally archiving its finalized
 * failure; (b) durably put `commitOptions.completionReceipt` while replacing a
 * VERIFIED record with a CLEANED tombstone; or (c) replace an unsigned
 * READY/AWAITING_SIGNATURE record with a DISCARDED tombstone when
 * `commitOptions.discardUnsigned === true`; or (d) reset an unsigned
 * AWAITING_SIGNATURE record to READY only when `commitOptions.resetUnsigned`
 * contains the exact definitive-rejection or externally verified no-artifact
 * binding for the current scope, identity, plan hash, signing session, and
 * lease. Tombstone revisions MUST remain in
 * the same scope and increase monotonically when a later plan replaces them.
 * Physically deleting active state and resetting the revision creates a CAS ABA
 * vulnerability and is forbidden. Operation (c) MUST reject every record that
 * contains signed bytes, even if a caller bypasses this controller.
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
      if (!next) fail(
        MAKER_V8_RECOVERY_ERROR.STORAGE_RECORD_INVALID,
        MAKER_V8_RECOVERY_ERROR_LAYER.STORAGE,
        'Physical recovery deletion is forbidden because it resets the CAS revision.',
      );
      if (next.scopeKey !== scopeKey || next.revision !== expectedRevision + 1) fail(
        MAKER_V8_RECOVERY_ERROR.STORAGE_RECORD_INVALID,
        MAKER_V8_RECOVERY_ERROR_LAYER.STORAGE,
        'CAS attempted to write an invalid scope or revision.',
      );

      const optionKeys = Object.keys(options);
      const noOptions = optionKeys.length === 0;
      const archiveFailure = optionKeys.length === 1
        && options.archiveFinalizedFailure === true;
      const discardUnsigned = optionKeys.length === 1
        && options.discardUnsigned === true;
      const completionReceipt = optionKeys.length === 1
        && Object.hasOwn(options, 'completionReceipt');
      const replaceTombstone = optionKeys.length === 1
        && options.replaceTombstone === true;
      const replaceFinalizedFailure = optionKeys.length === 1
        && options.replaceFinalizedFailure === true;
      const resetUnsigned = optionKeys.length === 1
        && Object.hasOwn(options, 'resetUnsigned');
      if (!noOptions && !archiveFailure && !discardUnsigned && !completionReceipt
        && !replaceTombstone && !replaceFinalizedFailure && !resetUnsigned) fail(
        MAKER_V8_RECOVERY_ERROR.STORAGE_RECORD_INVALID,
        MAKER_V8_RECOVERY_ERROR_LAYER.STORAGE,
        'A recovery write received unsupported atomic commit options.',
      );

      if (!current) {
        if (!noOptions || expectedRevision !== 0
          || next.state !== MAKER_V8_RECOVERY_STATE.READY) fail(
          MAKER_V8_RECOVERY_ERROR.STORAGE_RECORD_INVALID,
          MAKER_V8_RECOVERY_ERROR_LAYER.STORAGE,
          'A new recovery scope must begin with an exact READY record.',
        );
      } else if (discardUnsigned) {
        if (![
          MAKER_V8_RECOVERY_STATE.READY,
          MAKER_V8_RECOVERY_STATE.AWAITING_SIGNATURE,
        ].includes(current.state)
          || current.signed !== null
          || (current.state === MAKER_V8_RECOVERY_STATE.AWAITING_SIGNATURE
            && current.signatureDisposition
              !== MAKER_V8_SIGNATURE_DISPOSITION.DEFINITIVE_REJECTION)
          || next.state !== MAKER_V8_RECOVERY_STATE.DISCARDED
          || next.identityKey !== current.identityKey
          || next.plan !== null || next.signed !== null) fail(
          MAKER_V8_RECOVERY_ERROR.UNSIGNED_DISCARD_FORBIDDEN,
          MAKER_V8_RECOVERY_ERROR_LAYER.TERMINAL,
          'Only an unsigned READY or AWAITING_SIGNATURE recovery can become a tombstone.',
          { scopeKey, state: current.state },
        );
      } else if (resetUnsigned) {
        const reset = options.resetUnsigned;
        const confirmed = current.signatureDisposition
          === MAKER_V8_SIGNATURE_DISPOSITION.DEFINITIVE_REJECTION
          ? reset?.kind === 'DEFINITIVE_REJECTION'
            && Object.keys(reset).length === 1
          : reset?.kind === 'EXTERNAL_UNSIGNED_CONFIRMATION'
            && Object.keys(reset).length === 6
            && reset.scopeKey === current.scopeKey
            && reset.identityKey === current.identityKey
            && reset.planHash === current.plan?.fingerprint
            && reset.sessionId === current.signatureSessionId
            && reset.leaseExpiresAtMs === current.signatureLease?.expiresAtMs;
        if (current.state !== MAKER_V8_RECOVERY_STATE.AWAITING_SIGNATURE
          || current.signed !== null || next.state !== MAKER_V8_RECOVERY_STATE.READY
          || next.signatureSessionId !== null || next.signatureDisposition !== null
          || next.signatureLease !== null || !confirmed) fail(
          MAKER_V8_RECOVERY_ERROR.UNSIGNED_CONFIRMATION_INVALID,
          MAKER_V8_RECOVERY_ERROR_LAYER.STORAGE,
          'AWAITING_SIGNATURE can reset only with an exact durable unsigned confirmation.',
        );
      } else if (completionReceipt) {
        const receipt = options.completionReceipt;
        if (!receipt || current.state !== MAKER_V8_RECOVERY_STATE.VERIFIED
          || next.state !== MAKER_V8_RECOVERY_STATE.CLEANED
          || next.identityKey !== current.identityKey
          || next.plan !== null || next.signed !== null
          || stableJson(receipt) !== stableJson(current.receipt)
          || stableJson(next.receipt) !== stableJson(receipt)) fail(
          MAKER_V8_RECOVERY_ERROR.RECEIPT_INVALID,
          MAKER_V8_RECOVERY_ERROR_LAYER.STORAGE,
          'Verified recovery can be cleaned only into a tombstone with its exact receipt.',
        );
        const prior = receipts.get(receipt.identityKey);
        if (prior && stableJson(prior) !== stableJson(receipt)) fail(
          MAKER_V8_RECOVERY_ERROR.RECEIPT_INVALID,
          MAKER_V8_RECOVERY_ERROR_LAYER.STORAGE,
          'A completion receipt key already contains different evidence.',
        );
        // The receipt put and CLEANED tombstone write are one synchronous
        // atomic commit. IndexedDB implementations must use one transaction.
        receipts.set(receipt.identityKey, cloneForMemory(receipt));
      } else if (replaceTombstone) {
        if (![MAKER_V8_RECOVERY_STATE.DISCARDED,
          MAKER_V8_RECOVERY_STATE.CLEANED].includes(current.state)
          || next.state !== MAKER_V8_RECOVERY_STATE.READY) fail(
          MAKER_V8_RECOVERY_ERROR.STORAGE_RECORD_INVALID,
          MAKER_V8_RECOVERY_ERROR_LAYER.STORAGE,
          'Only a durable recovery tombstone can be replaced by a new READY plan.',
        );
        if (current.state === MAKER_V8_RECOVERY_STATE.CLEANED) {
          const durable = receipts.get(current.identityKey);
          if (!durable || stableJson(durable) !== stableJson(current.receipt)) fail(
            MAKER_V8_RECOVERY_ERROR.RECEIPT_INVALID,
            MAKER_V8_RECOVERY_ERROR_LAYER.STORAGE,
            'A CLEANED tombstone must retain its exact durable completion receipt.',
          );
        }
      } else if (replaceFinalizedFailure) {
        const archive = current.failure
          ? failures.get(failureArchiveKey(current.identityKey, current.failure.digest))
          : null;
        if (current.state !== MAKER_V8_RECOVERY_STATE.FINALIZED_FAILURE
          || next.state !== MAKER_V8_RECOVERY_STATE.READY
          || !archive || stableJson(archive) !== stableJson(current.failure)) fail(
          MAKER_V8_RECOVERY_ERROR.FINALIZED_FAILURE_INVALID,
          MAKER_V8_RECOVERY_ERROR_LAYER.STORAGE,
          'Only an archived FINALIZED_FAILURE can be replaced by a new READY plan.',
        );
      } else {
        if ((current.state === MAKER_V8_RECOVERY_STATE.AWAITING_SIGNATURE
            && next.state === MAKER_V8_RECOVERY_STATE.READY)
          || next.identityKey !== current.identityKey
          || stableJson(next.identity) !== stableJson(current.identity)
          || !ALLOWED_TRANSITIONS[current.state]?.has(next.state)) fail(
          MAKER_V8_RECOVERY_ERROR.STATE_INVALID,
          MAKER_V8_RECOVERY_ERROR_LAYER.STORAGE,
          'The persistence adapter rejected an invalid recovery state transition.',
          { from: current.state, to: next.state },
        );
      }

      if (next.state === MAKER_V8_RECOVERY_STATE.AWAITING_SIGNATURE) {
        if (!Object.values(MAKER_V8_SIGNATURE_DISPOSITION)
          .includes(next.signatureDisposition)) fail(
          MAKER_V8_RECOVERY_ERROR.STORAGE_RECORD_INVALID,
          MAKER_V8_RECOVERY_ERROR_LAYER.STORAGE,
          'AWAITING_SIGNATURE requires an exact wallet outcome disposition.',
        );
        canonicalSignatureLease(next.signatureLease, next.plan, next.signatureSessionId);
      } else if (next.signatureSessionId !== null || next.signatureDisposition !== null
        || next.signatureLease !== null) fail(
        MAKER_V8_RECOVERY_ERROR.STORAGE_RECORD_INVALID,
        MAKER_V8_RECOVERY_ERROR_LAYER.STORAGE,
        'Only AWAITING_SIGNATURE may retain an outstanding signature lease.',
      );

      if (archiveFailure) {
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
  'signatureDisposition',
  'signatureLease',
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
  [MAKER_V8_RECOVERY_STATE.READY]: new Set([
    MAKER_V8_RECOVERY_STATE.AWAITING_SIGNATURE,
    MAKER_V8_RECOVERY_STATE.DISCARDED,
  ]),
  [MAKER_V8_RECOVERY_STATE.AWAITING_SIGNATURE]: new Set([
    MAKER_V8_RECOVERY_STATE.READY,
    MAKER_V8_RECOVERY_STATE.AWAITING_SIGNATURE,
    MAKER_V8_RECOVERY_STATE.SIGNED_DURABLE,
    MAKER_V8_RECOVERY_STATE.DISCARDED,
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
  [MAKER_V8_RECOVERY_STATE.VERIFIED]: new Set([MAKER_V8_RECOVERY_STATE.CLEANED]),
  [MAKER_V8_RECOVERY_STATE.FINALIZED_FAILURE]: new Set(),
  [MAKER_V8_RECOVERY_STATE.DISCARDED]: new Set(),
  [MAKER_V8_RECOVERY_STATE.CLEANED]: new Set(),
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
    signatureDisposition: null,
    signatureLease: null,
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
    || !/^0x[0-9a-f]{64}$/.test(receipt.planHash ?? '')
    || (record.plan && receipt.planHash !== record.plan.fingerprint)
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
  if (readback.planHash !== record.plan.fingerprint) fail(
    MAKER_V8_RECOVERY_ERROR.READBACK_MISMATCH,
    MAKER_V8_RECOVERY_ERROR_LAYER.READBACK,
    'Readback verification does not bind the exact full durable plan hash.',
    { expected: record.plan.fingerprint, observed: readback.planHash ?? null },
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
    planHash: record.plan.fingerprint,
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
    planHash: record.plan.fingerprint,
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
 * - getContext({ identity }) -> current full identity and epoch (used only for replay)
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
  const confirmNoSignedArtifact = options.confirmNoSignedArtifact === undefined
    ? null
    : requireDependency(options.confirmNoSignedArtifact, 'confirmNoSignedArtifact');
  const clock = typeof options.clock === 'function' ? options.clock : Date.now;
  const sessionId = exactSessionId(
    options.sessionId === undefined ? createMakerV8RecoverySessionId() : options.sessionId,
  );
  const signatureLeaseMs = options.signatureLeaseMs === undefined
    ? 120_000
    : options.signatureLeaseMs;
  if (!Number.isSafeInteger(signatureLeaseMs)
    || signatureLeaseMs < 1_000 || signatureLeaseMs > 300_000) fail(
    MAKER_V8_RECOVERY_ERROR.CONFIG_INVALID,
    MAKER_V8_RECOVERY_ERROR_LAYER.CONFIGURATION,
    'signatureLeaseMs must be an integer from 1000 through 300000 milliseconds.',
  );
  const evidenceMaxAgeMs = options.evidenceMaxAgeMs === undefined
    ? 60_000
    : options.evidenceMaxAgeMs;
  if (!Number.isSafeInteger(evidenceMaxAgeMs)
    || evidenceMaxAgeMs < 1 || evidenceMaxAgeMs > 300_000) fail(
    MAKER_V8_RECOVERY_ERROR.CONFIG_INVALID,
    MAKER_V8_RECOVERY_ERROR_LAYER.CONFIGURATION,
    'evidenceMaxAgeMs must be an integer from 1 through 300000 milliseconds.',
  );

  function assertFreshEvidence(evidence, phase, notBefore = 0) {
    const now = safeClock(clock);
    if (evidence.dryRunAtMs < notBefore || evidence.dryRunAtMs > now
      || now - evidence.dryRunAtMs > evidenceMaxAgeMs) fail(
      MAKER_V8_RECOVERY_ERROR.PLAN_EVIDENCE_MISMATCH,
      MAKER_V8_RECOVERY_ERROR_LAYER.CONTEXT,
      `${phase} evidence is stale, from the future, or predates the current recovery revision.`,
      {
        phase,
        dryRunAtMs: evidence.dryRunAtMs,
        notBefore,
        now,
        evidenceMaxAgeMs,
      },
    );
    return now;
  }

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
      2_000_000,
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
      const tombstone = [
        MAKER_V8_RECOVERY_STATE.DISCARDED,
        MAKER_V8_RECOVERY_STATE.CLEANED,
      ].includes(record.state);
      let plan = null;
      if (tombstone) {
        if (record.plan !== null) throw new Error('tombstone plan');
      } else {
        plan = await canonicalPlan(record.plan, identity, deriveTransactionDigest);
        if (stableJson(plan) !== stableJson(record.plan)) throw new Error('plan');
      }
      const needsSigned = ![
        MAKER_V8_RECOVERY_STATE.READY,
        MAKER_V8_RECOVERY_STATE.AWAITING_SIGNATURE,
        MAKER_V8_RECOVERY_STATE.DISCARDED,
        MAKER_V8_RECOVERY_STATE.CLEANED,
      ].includes(record.state);
      if (needsSigned !== Boolean(record.signed)) throw new Error('signed state');
      if (record.state === MAKER_V8_RECOVERY_STATE.AWAITING_SIGNATURE) {
        exactSessionId(record.signatureSessionId);
        if (!Object.values(MAKER_V8_SIGNATURE_DISPOSITION)
          .includes(record.signatureDisposition)) throw new Error('signature disposition');
        const lease = canonicalSignatureLease(
          record.signatureLease,
          plan,
          record.signatureSessionId,
        );
        if (stableJson(lease) !== stableJson(record.signatureLease)) {
          throw new Error('signature lease');
        }
      } else if (record.signatureSessionId !== null
        || record.signatureDisposition !== null || record.signatureLease !== null) {
        throw new Error('signature session');
      }
      if (needsSigned) {
        const signed = await verifySignedArtifact(record.signed, { ...record, identity, plan }, { stored: true });
        if (stableJson(signed) !== stableJson(record.signed)) throw new Error('signed');
      }
      if (record.state === MAKER_V8_RECOVERY_STATE.VERIFIED) validateReceipt(record.receipt, record);
      else if (record.state === MAKER_V8_RECOVERY_STATE.CLEANED) validateReceipt(
        record.receipt,
        { ...record, signed: { digest: record.receipt?.digest } },
      );
      else if (record.receipt !== null) throw new Error('receipt state');
      if (record.state === MAKER_V8_RECOVERY_STATE.FINALIZED_FAILURE) {
        if (!record.failure || record.failure.schemaVersion !== MAKER_V8_RECOVERY_FAILURE_SCHEMA
          || record.failure.identityKey !== identityKey || record.failure.scopeKey !== scopeKey
          || record.failure.digest !== record.signed.digest || record.failure.finalized !== true
          || record.failure.planHash !== plan.fingerprint
          || record.failure.executionStatus !== 'FAILURE') throw new Error('failure');
      } else if (record.failure !== null) throw new Error('failure state');
      if (tombstone && (record.queryOutcome !== null || record.lastError !== null)) {
        throw new Error('tombstone transient state');
      }
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

  async function loadScopeByLookup(scopeValue) {
    const scopeKey = makerV8RecoveryScopeLookupKey(scopeValue);
    const record = await validateStoredRecord(await storage(
      'load',
      () => persist.load(scopeKey),
    ));
    if (record && record.scopeKey !== scopeKey) fail(
      MAKER_V8_RECOVERY_ERROR.STORAGE_RECORD_INVALID,
      MAKER_V8_RECOVERY_ERROR_LAYER.STORAGE,
      'Persistence returned a recovery record from a different chain + Root scope.',
      { requestedScopeKey: scopeKey, returnedScopeKey: record.scopeKey },
    );
    return record;
  }

  async function loadScope(identity) {
    return loadScopeByLookup({ chain: identity.chain, rootId: identity.root.id });
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

  function hiddenTombstone(record) {
    return record && [
      MAKER_V8_RECOVERY_STATE.DISCARDED,
      MAKER_V8_RECOVERY_STATE.CLEANED,
    ].includes(record.state);
  }

  async function commitCas(scopeKey, expectedRevision, next, commitOptions, operation) {
    const stored = await storage('compareAndSwap', () => persist.compareAndSwap(
      scopeKey,
      expectedRevision,
      next,
      commitOptions,
    ));
    const committed = await validateStoredRecord(stored);
    if (!committed || committed.scopeKey !== scopeKey || stableJson(committed) !== stableJson(next)) fail(
      MAKER_V8_RECOVERY_ERROR.STORAGE_RECORD_INVALID,
      MAKER_V8_RECOVERY_ERROR_LAYER.STORAGE,
      'Recovery CAS did not return the exact committed record.',
      { operation, expectedRevision },
      true,
    );
    const reread = await validateStoredRecord(await storage(
      'post-CAS durable readback',
      () => persist.load(scopeKey),
    ));
    if (!reread || stableJson(reread) !== stableJson(committed)) fail(
      MAKER_V8_RECOVERY_ERROR.STORAGE_RECORD_INVALID,
      MAKER_V8_RECOVERY_ERROR_LAYER.STORAGE,
      'Recovery CAS did not survive an exact durable readback.',
      { operation, state: next.state, revision: next.revision },
      true,
    );
    return reread;
  }

  async function cas(record, state, patch = {}, commitOptions = {}) {
    const now = safeClock(clock);
    const next = nextRecord(record, state, patch, sessionId, now);
    return commitCas(
      record.scopeKey,
      record.revision,
      next,
      commitOptions,
      `${record.state} -> ${state}`,
    );
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

  async function assertCurrentContext(identity, plan) {
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
    const currentEpoch = canonicalU64(
      value?.currentEpoch ?? value?.epoch,
      'Current Mainnet epoch',
    );
    if (!plan || currentEpoch !== plan.epochWindow.start
      || plan.expiration.epoch !== plan.epochWindow.end) fail(
      MAKER_V8_RECOVERY_ERROR.CONTEXT_DRIFT,
      MAKER_V8_RECOVERY_ERROR_LAYER.CONTEXT,
      'Current Mainnet epoch differs from the fresh evidence epoch window.',
      {
        currentEpoch,
        expectedEpoch: plan?.epochWindow?.start ?? null,
        expirationEpoch: plan?.expiration?.epoch ?? null,
      },
    );
    return currentEpoch;
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

  function assertLiveRecoveryBinding(record, durableIdentity, input, phase) {
    let liveIdentity;
    try {
      liveIdentity = canonicalMakerV8RecoveryIdentity(input.liveIdentity);
    } catch (cause) {
      fail(
        MAKER_V8_RECOVERY_ERROR.CONTEXT_DRIFT,
        MAKER_V8_RECOVERY_ERROR_LAYER.CONTEXT,
        `${phase} live identity is incomplete or invalid.`,
        {},
        false,
        cause,
      );
    }
    if (stableJson(liveIdentity) !== stableJson(durableIdentity)) fail(
      MAKER_V8_RECOVERY_ERROR.CONTEXT_DRIFT,
      MAKER_V8_RECOVERY_ERROR_LAYER.CONTEXT,
      `${phase} live identity differs from the exact durable recovery identity.`,
      {
        durableIdentityKey: record.identityKey,
        liveIdentityKey: makerV8RecoveryIdentityKey(liveIdentity),
      },
    );
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) fail(
      MAKER_V8_RECOVERY_ERROR.PLAN_INVALID,
      MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
      `${phase} expectedRevision must be a positive safe integer.`,
    );
    const expectedPlanHash = opaque(input.expectedPlanHash, `${phase} expected plan hash`);
    if (!/^0x[0-9a-f]{64}$/.test(expectedPlanHash)) fail(
      MAKER_V8_RECOVERY_ERROR.PLAN_INVALID,
      MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
      `${phase} expectedPlanHash must be a canonical SHA-256 fingerprint.`,
    );
    if (input.expectedRevision !== record.revision
      || expectedPlanHash !== record.plan.fingerprint) fail(
      MAKER_V8_RECOVERY_ERROR.CAS_CONFLICT,
      MAKER_V8_RECOVERY_ERROR_LAYER.CONCURRENCY,
      `${phase} durable revision or full plan hash changed before the signing boundary.`,
      {
        expectedRevision: input.expectedRevision,
        actualRevision: record.revision,
        expectedPlanHash,
        actualPlanHash: record.plan.fingerprint,
      },
      true,
    );
    return liveIdentity;
  }

  async function planFromFreshEvidence(
    record,
    identity,
    planValue,
    recoveryEvidence,
    phase,
  ) {
    const evidence = consumeMarketEvidence(recoveryEvidence, phase);
    assertFreshEvidence(evidence, phase, record.updatedAt);
    const evidencedPlan = await canonicalPlan(
      planValue,
      identity,
      deriveTransactionDigest,
      evidence,
    );
    if (stableJson(evidencedPlan) !== stableJson(record.plan)) fail(
      MAKER_V8_RECOVERY_ERROR.PLAN_EVIDENCE_MISMATCH,
      MAKER_V8_RECOVERY_ERROR_LAYER.CONTEXT,
      'Fresh evidence does not exactly match the current full durable recovery plan.',
      {
        phase,
        scopeKey: record.scopeKey,
        revision: record.revision,
        sessionId,
        transactionDigest: record.plan.transactionDigest,
        planHash: record.plan.fingerprint,
      },
    );
    return evidence;
  }

  async function externalUnsignedConfirmation(record) {
    const now = safeClock(clock);
    if (now < record.signatureLease.expiresAtMs) fail(
      MAKER_V8_RECOVERY_ERROR.SIGNATURE_LEASE_ACTIVE,
      MAKER_V8_RECOVERY_ERROR_LAYER.CONCURRENCY,
      'The prior random signing session still owns its bounded lease.',
      {
        owner: record.signatureSessionId,
        expiresAtMs: record.signatureLease.expiresAtMs,
        now,
      },
      true,
    );
    if (!confirmNoSignedArtifact) fail(
      MAKER_V8_RECOVERY_ERROR.UNSIGNED_CONFIRMATION_REQUIRED,
      MAKER_V8_RECOVERY_ERROR_LAYER.SIGNING,
      'The prior wallet outcome is unknown; a trusted exact no-artifact confirmation is required.',
      { disposition: record.signatureDisposition, planHash: record.plan.fingerprint },
    );
    let raw;
    try {
      raw = await confirmNoSignedArtifact({
        scopeKey: record.scopeKey,
        identityKey: record.identityKey,
        identity: publicData(record.identity),
        transactionBytes: record.plan.transactionBytes,
        transactionDigest: record.plan.transactionDigest,
        planHash: record.plan.fingerprint,
        sessionId: record.signatureSessionId,
        leaseExpiresAtMs: record.signatureLease.expiresAtMs,
      });
    } catch (cause) {
      fail(
        MAKER_V8_RECOVERY_ERROR.UNSIGNED_CONFIRMATION_REQUIRED,
        MAKER_V8_RECOVERY_ERROR_LAYER.SIGNING,
        'The trusted wallet boundary could not confirm that no signed artifact exists.',
        {},
        false,
        cause,
      );
    }
    const confirmationReadAt = safeClock(clock);
    let confirmation;
    try {
      confirmation = clonePlainData(raw, 'Unsigned wallet confirmation', { allowScalar: false });
      exactKeys(confirmation, [
        'confirmedUnsigned',
        'scopeKey',
        'identityKey',
        'planHash',
        'sessionId',
        'leaseExpiresAtMs',
        'checkedAtMs',
      ], 'Unsigned wallet confirmation', MAKER_V8_RECOVERY_ERROR.UNSIGNED_CONFIRMATION_INVALID);
    } catch (cause) {
      if (cause instanceof MakerV8RecoveryError) throw cause;
      fail(
        MAKER_V8_RECOVERY_ERROR.UNSIGNED_CONFIRMATION_INVALID,
        MAKER_V8_RECOVERY_ERROR_LAYER.SIGNING,
        'Unsigned wallet confirmation is malformed.',
        {},
        false,
        cause,
      );
    }
    if (confirmation.confirmedUnsigned !== true
      || confirmation.scopeKey !== record.scopeKey
      || confirmation.identityKey !== record.identityKey
      || confirmation.planHash !== record.plan.fingerprint
      || confirmation.sessionId !== record.signatureSessionId
      || confirmation.leaseExpiresAtMs !== record.signatureLease.expiresAtMs
      || !Number.isSafeInteger(confirmation.checkedAtMs)
      || confirmation.checkedAtMs < record.signatureLease.expiresAtMs
      || confirmation.checkedAtMs > confirmationReadAt) fail(
      MAKER_V8_RECOVERY_ERROR.UNSIGNED_CONFIRMATION_INVALID,
      MAKER_V8_RECOVERY_ERROR_LAYER.SIGNING,
      'Unsigned wallet confirmation does not bind the exact scope, plan, session, and lease.',
    );
    return deepFreeze({
      kind: 'EXTERNAL_UNSIGNED_CONFIRMATION',
      scopeKey: record.scopeKey,
      identityKey: record.identityKey,
      planHash: record.plan.fingerprint,
      sessionId: record.signatureSessionId,
      leaseExpiresAtMs: record.signatureLease.expiresAtMs,
    });
  }

  const api = {
    async prepare(input) {
      exactKeys(input, ['identity', 'plan', 'evidence', 'options'], 'Prepare request',
        MAKER_V8_RECOVERY_ERROR.PLAN_INVALID);
      const {
        identity: identityValue,
        plan: planValue,
        evidence: recoveryEvidence,
        options: prepareOptions,
      } = input;
      exactKeys(prepareOptions, ['afterFinalizedFailure'], 'Prepare options',
        MAKER_V8_RECOVERY_ERROR.PLAN_INVALID);
      if (typeof prepareOptions.afterFinalizedFailure !== 'boolean') fail(
        MAKER_V8_RECOVERY_ERROR.PLAN_INVALID,
        MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
        'Prepare options must explicitly select afterFinalizedFailure true or false.',
      );
      const identity = canonicalMakerV8RecoveryIdentity(identityValue);
      const evidence = consumeMarketEvidence(recoveryEvidence, 'prepare');
      assertFreshEvidence(evidence, 'prepare');
      const plan = await canonicalPlan(planValue, identity, deriveTransactionDigest, evidence);
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
        return commitCas(scopeKey, 0, created, {}, 'create READY recovery');
      }

      if (hiddenTombstone(current)) {
        if (evidence.dryRunAtMs < current.updatedAt) fail(
          MAKER_V8_RECOVERY_ERROR.PLAN_EVIDENCE_MISMATCH,
          MAKER_V8_RECOVERY_ERROR_LAYER.CONTEXT,
          'Replacement evidence predates the durable recovery tombstone.',
          { dryRunAtMs: evidence.dryRunAtMs, tombstoneUpdatedAt: current.updatedAt },
        );
        if (current.state === MAKER_V8_RECOVERY_STATE.CLEANED) {
          const durable = await storage('loadReceipt before tombstone replacement', () => (
            persist.loadReceipt(current.identityKey)
          ));
          if (!durable || stableJson(durable) !== stableJson(current.receipt)) fail(
            MAKER_V8_RECOVERY_ERROR.RECEIPT_INVALID,
            MAKER_V8_RECOVERY_ERROR_LAYER.STORAGE,
            'A CLEANED tombstone lost its exact durable completion receipt.',
          );
        }
        const replacement = initialRecord(identity, plan, sessionId, safeClock(clock), {
          revision: current.revision + 1,
          attempt: current.attempt + 1,
        });
        return commitCas(
          current.scopeKey,
          current.revision,
          replacement,
          { replaceTombstone: true },
          `${current.state} tombstone -> READY`,
        );
      }

      if (current.state === MAKER_V8_RECOVERY_STATE.FINALIZED_FAILURE) {
        if (evidence.dryRunAtMs < current.updatedAt) fail(
          MAKER_V8_RECOVERY_ERROR.PLAN_EVIDENCE_MISMATCH,
          MAKER_V8_RECOVERY_ERROR_LAYER.CONTEXT,
          'Replacement evidence predates the finalized recovery record.',
          { dryRunAtMs: evidence.dryRunAtMs, recordUpdatedAt: current.updatedAt },
        );
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
        return commitCas(
          current.scopeKey,
          current.revision,
          replacement,
          { replaceFinalizedFailure: true },
          'FINALIZED_FAILURE -> READY',
        );
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
      if (!record || hiddenTombstone(record)) return null;
      return requireExactIdentity(record, identity);
    },

    async loadByScope(scopeValue) {
      const scope = canonicalMakerV8RecoveryScope(scopeValue);
      const record = await loadScopeByLookup(scope);
      return hiddenTombstone(record) ? null : record;
    },

    async reclaimAwaitingSignature(input) {
      exactKeys(input, [
        'identity',
        'liveIdentity',
        'plan',
        'expectedRevision',
        'expectedPlanHash',
        'evidence',
      ], 'Signature reclaim request',
        MAKER_V8_RECOVERY_ERROR.PLAN_INVALID);
      const { identity: identityValue, evidence } = input;
      const identity = canonicalMakerV8RecoveryIdentity(identityValue);
      const record = requireExactIdentity(await loadScope(identity), identity);
      if (!record || record.state !== MAKER_V8_RECOVERY_STATE.AWAITING_SIGNATURE
        || record.signed !== null) fail(
        MAKER_V8_RECOVERY_ERROR.STATE_INVALID,
        MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
        'Only an unsigned AWAITING_SIGNATURE recovery can be reclaimed.',
        { state: record?.state ?? null },
      );
      const liveIdentity = assertLiveRecoveryBinding(
        record,
        identity,
        input,
        'reclaimAwaitingSignature',
      );
      let resetUnsigned;
      if (record.signatureDisposition
        === MAKER_V8_SIGNATURE_DISPOSITION.DEFINITIVE_REJECTION) {
        resetUnsigned = { kind: 'DEFINITIVE_REJECTION' };
      } else {
        resetUnsigned = await externalUnsignedConfirmation(record);
      }
      await planFromFreshEvidence(
        record,
        liveIdentity,
        input.plan,
        evidence,
        'reclaimAwaitingSignature',
      );
      return cas(record, MAKER_V8_RECOVERY_STATE.READY, {
        signatureSessionId: null,
        signatureDisposition: null,
        signatureLease: null,
        lastError: null,
      }, { resetUnsigned });
    },

    async discardUnsigned(identityValue) {
      const identity = canonicalMakerV8RecoveryIdentity(identityValue);
      const record = requireExactIdentity(await loadScope(identity), identity);
      if (!record
        || ![
          MAKER_V8_RECOVERY_STATE.READY,
          MAKER_V8_RECOVERY_STATE.AWAITING_SIGNATURE,
        ].includes(record.state)
        || record.signed !== null
        || (record.state === MAKER_V8_RECOVERY_STATE.AWAITING_SIGNATURE
          && record.signatureDisposition
            !== MAKER_V8_SIGNATURE_DISPOSITION.DEFINITIVE_REJECTION)) fail(
        MAKER_V8_RECOVERY_ERROR.UNSIGNED_DISCARD_FORBIDDEN,
        MAKER_V8_RECOVERY_ERROR_LAYER.TERMINAL,
        'Only an unsigned READY or AWAITING_SIGNATURE recovery can be discarded.',
        { state: record?.state ?? null },
      );
      await cas(record, MAKER_V8_RECOVERY_STATE.DISCARDED, {
        plan: null,
        signed: null,
        signatureSessionId: null,
        signatureDisposition: null,
        signatureLease: null,
        queryOutcome: null,
        lastError: null,
        receipt: null,
        failure: null,
      }, { discardUnsigned: true });
      return null;
    },

    async requestSignature(input) {
      exactKeys(input, [
        'identity',
        'liveIdentity',
        'plan',
        'expectedRevision',
        'expectedPlanHash',
        'evidence',
      ], 'Signature request',
        MAKER_V8_RECOVERY_ERROR.PLAN_INVALID);
      const { identity: identityValue, evidence: recoveryEvidence } = input;
      const identity = canonicalMakerV8RecoveryIdentity(identityValue);
      let record = requireExactIdentity(await loadScope(identity), identity);
      if (!record) fail(
        MAKER_V8_RECOVERY_ERROR.STATE_INVALID,
        MAKER_V8_RECOVERY_ERROR_LAYER.VALIDATION,
        'Prepare the exact transaction before requesting a signature.',
      );
      if (record.state !== MAKER_V8_RECOVERY_STATE.READY) fail(
        MAKER_V8_RECOVERY_ERROR.SIGNATURE_REPLACEMENT_FORBIDDEN,
        MAKER_V8_RECOVERY_ERROR_LAYER.TERMINAL,
        record.state === MAKER_V8_RECOVERY_STATE.AWAITING_SIGNATURE
          ? 'Reclaim the outstanding unsigned request before a fresh signing attempt.'
          : 'Durable signed or terminal recovery cannot request a replacement signature.',
        { state: record.state },
      );
      const liveIdentity = assertLiveRecoveryBinding(record, identity, input, 'requestSignature');
      await planFromFreshEvidence(
        record,
        liveIdentity,
        input.plan,
        recoveryEvidence,
        'requestSignature',
      );
      const leaseStartedAt = safeClock(clock);
      const expiresAtMs = leaseStartedAt + signatureLeaseMs;
      if (!Number.isSafeInteger(expiresAtMs)) fail(
        MAKER_V8_RECOVERY_ERROR.CONFIG_INVALID,
        MAKER_V8_RECOVERY_ERROR_LAYER.CONFIGURATION,
        'Signature lease timestamp exceeds the safe integer range.',
      );
      record = await cas(record, MAKER_V8_RECOVERY_STATE.AWAITING_SIGNATURE, {
        signatureSessionId: sessionId,
        signatureDisposition: MAKER_V8_SIGNATURE_DISPOSITION.REQUEST_IN_FLIGHT,
        signatureLease: {
          sessionId,
          expiresAtMs,
          planHash: record.plan.fingerprint,
        },
        lastError: null,
      });

      let walletResult;
      try {
        walletResult = await signBoundary({
          bytes: record.plan.transactionBytes,
          digest: record.plan.transactionDigest,
          signer: record.plan.signer,
          identity: publicData(identity),
          plan: publicData(record.plan),
          recovery: publicData({
            scopeKey: record.scopeKey,
            identityKey: record.identityKey,
            revision: record.revision,
            planHash: record.plan.fingerprint,
            sessionId: record.signatureSessionId,
            leaseExpiresAtMs: record.signatureLease.expiresAtMs,
          }),
        });
      } catch (cause) {
        const error = new MakerV8RecoveryError('Wallet signing failed before a durable signature existed.', {
          code: MAKER_V8_RECOVERY_ERROR.SIGNING_FAILED,
          layer: MAKER_V8_RECOVERY_ERROR_LAYER.SIGNING,
          retryable: true,
          details: { cause: String(cause?.message || cause || 'unknown').slice(0, 512) },
          cause,
        });
        const definitive = cause?.definitiveRejection === true
          && cause?.signedArtifactCreated === false;
        await cas(record, MAKER_V8_RECOVERY_STATE.AWAITING_SIGNATURE, {
          signatureDisposition: definitive
            ? MAKER_V8_SIGNATURE_DISPOSITION.DEFINITIVE_REJECTION
            : MAKER_V8_SIGNATURE_DISPOSITION.OUTCOME_UNKNOWN,
          lastError: errorSummary(error, error.code),
        });
        throw error;
      }
      let signed;
      try { signed = await verifySignedArtifact(walletResult, record); } catch (error) {
        await cas(record, MAKER_V8_RECOVERY_STATE.AWAITING_SIGNATURE, {
          signatureDisposition: MAKER_V8_SIGNATURE_DISPOSITION.OUTCOME_UNKNOWN,
          lastError: errorSummary(error, error.code),
        });
        throw error;
      }
      // This CAS and its verified durable reread complete before this method
      // returns; callers are forbidden from broadcasting walletResult directly.
      return cas(record, MAKER_V8_RECOVERY_STATE.SIGNED_DURABLE, {
        signed,
        signatureSessionId: null,
        signatureDisposition: null,
        signatureLease: null,
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
      if (record.state === MAKER_V8_RECOVERY_STATE.CLEANED) fail(
        MAKER_V8_RECOVERY_ERROR.ALREADY_COMPLETED,
        MAKER_V8_RECOVERY_ERROR_LAYER.TERMINAL,
        'Cleaned recovery has a durable receipt and cannot be replayed.',
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
            plan: publicData(record.plan),
            planHash: record.plan.fingerprint,
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

      await assertCurrentContext(identity, record.plan);
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
      await cas(record, MAKER_V8_RECOVERY_STATE.CLEANED, {
        plan: null,
        signed: null,
        signatureSessionId: null,
        signatureDisposition: null,
        signatureLease: null,
        queryOutcome: null,
        lastError: null,
        failure: null,
      }, { completionReceipt: record.receipt });
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
          || !/^0x[0-9a-f]{64}$/.test(failure.planHash ?? '')
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
