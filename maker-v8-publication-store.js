import {
  fromBase58, fromBase64, toBase58, toBase64,
} from '@mysten/sui/utils';
import { bcs } from '@mysten/sui/bcs';
import { sha256 } from '@noble/hashes/sha2.js';
import {
  MAKER_V8_APPROVED_SUI_PROTOCOL_PROFILE,
  MAKER_V8_APPROVED_SUI_PROTOCOL_PROFILE_COMMITMENT,
  MAKER_V8_BYTE_BUDGETS,
  MAKER_V8_PUBLICATION_COMPILER_ABI,
  MAKER_V8_PUBLICATION_TOPOLOGY,
  MAKER_V8_TRANSACTION_LIMITS,
} from './maker-v8-compiler.js';
import { MAKER_V8_APPROVED_CORE_BASE_REGISTRY_MODULE_SHA256 } from './maker-v8-chain.js';

export const MAKER_V8_PUBLICATION_DATABASE = 'animacraft-fresh-maker-v8-publication-v1';
export const MAKER_V8_PUBLICATION_PERSISTENCE_SCHEMA = 'animacraft.maker-v8-publication-wal.v1';
export const MAKER_V8_PUBLICATION_PLAN_STATES = Object.freeze([
  'ACTIVE', 'COMPLETE', 'ABANDONED_RECOVERABLE', 'RELEASE_RETIRED',
]);
export const MAKER_V8_PUBLICATION_STORE_TRUST = Object.freeze({
  schemaVersion: 'animacraft.maker-v8-publication-store-trust.v1',
  executionAuthority: 'INERT_STORAGE_ONLY',
  hotHistory: 'OPERATIONAL_ANCHOR_ONLY',
  fullHistoryValidation: Object.freeze([
    'exportAttempt', 'importAttempt', 'collectOrphanedBlobs',
  ]),
  coordinatedRawIndexedDbAuthenticity: 'OUT_OF_SCOPE',
  requiresDeterministicCompilerRehydrate: true,
  requiresExactTransactionDataAndSignatureVerification: true,
});
export const MAKER_V8_PUBLICATION_BYTE_LIMITS = Object.freeze({
  maxPlanCanonicalUtf8Bytes: 2 * 1024 * 1024,
  maxCheckpointCanonicalUtf8Bytes: 1024 * 1024,
  maxAttemptCanonicalUtf8Bytes: 16 * 1024,
  maxCompilerCheckpointCanonicalUtf8Bytes: 256 * 1024,
  maxReadbackCanonicalUtf8Bytes: 512 * 1024,
  maxCertificateCanonicalUtf8Bytes: 64 * 1024,
  maxSignatureBytes: 16 * 1024,
});
// Derived from the fresh document ceiling: at most 12,506 Base rows and 2,006
// Activation rows, plus Scaffold, Companion, seals, and finalization. Every
// append chunk consumes at least one row. The power-of-two envelope leaves a
// reviewable margin without permitting an unbounded local WAL.
export const MAKER_V8_PUBLICATION_HISTORY_LIMITS = Object.freeze({
  maxBaseRows: 12_506,
  maxActivationRows: 2_006,
  fixedTopologyTransactions: 8,
  derivedMaximumCheckpoints: 14_520,
  maxCheckpoints: 16_384,
  optionalRetrySoftLimitPerOrdinal: 12,
  maxEventsPerOrdinal: 16,
  maxExcessEvents: 16_384,
  maxAttemptEvents: 65_536,
});

const DATABASE_VERSION = 1;
const PLAN_STORE = 'plans';
const ACTIVE_STORE = 'activeScopes';
const CHECKPOINT_STORE = 'checkpoints';
const ATTEMPT_STORE = 'attempts';
const ATTEMPT_HEAD_STORE = 'attemptHeads';
const BLOB_STORE = 'blobs';
const USED_ATTEMPT_STORE = 'usedAttempts';
const HASH = /^[0-9a-f]{64}$/;
const EXACT_ID = /^0x[0-9a-f]{64}$/;
const encoder = new TextEncoder();
const PLAN_FIELDS = Object.freeze([
  'schemaVersion', 'attemptId', 'attemptNonce', 'planId', 'scopeKey', 'status',
  'revision', 'createdAt', 'updatedAt', 'immutable', 'blobRefs', 'head', 'current',
  'nextPreparation', 'terminal', 'attemptHistory',
]);
const ATTEMPT_HISTORY_FIELDS = Object.freeze([
  'totalEvents', 'excessEvents', 'globalAttemptHeadSha256',
]);
const IMMUTABLE_FIELDS = Object.freeze([
  'chainIdentifier', 'paymentCoinType', 'signerAddress', 'makerKey', 'manifestSha256',
  'contentCommitment', 'protocolProfileCommitment', 'coreArtifactCommitment',
  'blobRefsCommitment', 'compilerAuthority',
]);
const AUTHORITY_FIELDS = Object.freeze([
  'schemaVersion', 'trustedContextCommitment', 'protocolProfile', 'coreArtifact',
  'packageTuple', 'protocolConfig', 'catalog', 'configs', 'sealPolicyCommitment', 'compilerAbi',
]);
const AUTHORITY_PAYLOAD_FIELDS = Object.freeze(AUTHORITY_FIELDS.filter((field) => field !== 'trustedContextCommitment'));
const PROFILE_FIELDS = Object.freeze([
  'protocolVersion', 'objectRuntimeMaxNumCachedObjects', 'objectRuntimeMaxNumStoreEntries',
]);
const CORE_ARTIFACT_FIELDS = Object.freeze([
  'callablePackageId', 'packageDigest', 'baseRegistryModuleSha256',
]);
const PACKAGE_FIELDS = Object.freeze([
  'role', 'originalPackageId', 'callablePackageId', 'packageDigest',
  'sourceCommitment', 'packageCommitment', 'abiCommitment', 'bindingCommitment',
]);
const PROTOCOL_CONFIG_FIELDS = Object.freeze(['objectId', 'revision', 'commitment']);
const CATALOG_FIELDS = Object.freeze([
  'objectId', 'protocolConfigId', 'protocolConfigRevision',
  'protocolConfigCommitment', 'productBindingCommitment', 'callCapSetCommitment',
]);
const CONFIG_BINDING_FIELDS = Object.freeze(['objectId', 'fields']);
const COMMON_CONFIG_FIELDS = Object.freeze([
  'version', 'catalogId', 'productBindingCommitment', 'callCapSetCommitment', 'authorityId',
]);
const SEAL_CONFIG_FIELDS = Object.freeze([
  ...COMMON_CONFIG_FIELDS, 'commitment', 'keyServerIds', 'weights', 'threshold',
  'keyServerSetCommitment', 'encryptionPolicyCommitment',
]);
const ROLES = Object.freeze(['core', 'seal', 'runtime', 'output', 'physical', 'market', 'release']);
const MAINNET_CHAIN_IDENTIFIER = '35834a8a';
const NATIVE_USDC = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
const BLOB_REF_FIELDS = Object.freeze([
  'document', 'transportMetadata', 'compilerContext', 'assets',
]);
const ASSET_REF_FIELDS = Object.freeze(['assetId', 'blob']);
const BLOB_FIELDS = Object.freeze(['sha256', 'byteLength', 'encoding', 'data']);
const CURRENT_FIELDS = Object.freeze([
  'ordinal', 'kind', 'phase', 'lane', 'action', 'startSequence', 'endSequence',
  'rowCommitments', 'preState', 'postState', 'compilerCheckpoint',
  'transactionKindRef', 'transactionKindSha256', 'commandCount', 'targets',
  'fullTransactionRef', 'signatureRef', 'outcome',
]);
const STATIC_COMPILER_CHECKPOINT_FIELDS = Object.freeze([
  'schemaVersion', 'phase', 'lane', 'action', 'index', 'startSequence', 'endSequence', 'final',
]);
const BASE_COMPILER_CHECKPOINT_FIELDS = Object.freeze([
  'schemaVersion', 'phase', 'lane', 'index', 'startSequence', 'endSequence', 'final',
  'expected', 'metrics',
]);
const ACTIVATION_COMPILER_CHECKPOINT_FIELDS = Object.freeze([
  'schemaVersion', 'phase', 'lane', 'action', 'index', 'startSequence', 'endSequence',
  'final', 'expected', 'metrics',
]);
const HEAD_FIELDS = Object.freeze([
  'ordinal', 'digest', 'transactionKindSha256', 'checkpointSha256', 'phase', 'lane',
]);
const NEXT_PREPARATION_FIELDS = Object.freeze(['status', 'ordinal', 'reason']);
const TERMINAL_FIELDS = Object.freeze(['status', 'reason', 'at']);
const USED_ATTEMPT_FIELDS = Object.freeze([
  'attemptId', 'planId', 'scopeKey', 'attemptNonce', 'createdAt', 'disposition', 'deletedAt',
]);
const CHECKPOINT_FIELDS = Object.freeze([
  'schemaVersion', 'attemptId', 'planId', 'ordinal', 'kind', 'phase', 'lane',
  'action', 'startSequence', 'endSequence', 'rowCommitments', 'preState',
  'postState', 'compilerCheckpoint', 'transactionKindRef', 'transactionKindSha256',
  'commandCount', 'targets',
  'fullTransactionRef', 'signatureRef', 'digest', 'certificate', 'readback',
  'submissionSource', 'checkpointSha256', 'previousCheckpointSha256', 'finalizedAt',
]);
const CERTIFICATE_FIELDS = Object.freeze([
  'source', 'transactionDigest', 'transactionKindSha256', 'readbackSha256',
]);
const ATTEMPT_FIELDS = Object.freeze([
  'schemaVersion', 'attemptId', 'ordinal', 'sequence', 'status', 'digest',
  'kindSha256', 'fullTransactionRef', 'signatureRef', 'details', 'observedAt',
  'previousAttemptSha256', 'previousGlobalAttemptSha256', 'eventSha256',
]);
const ATTEMPT_DETAILS_FIELDS = Object.freeze([
  'source', 'at', 'code', 'signedAt', 'firstSeenAt', 'broadcastAt',
]);
const ATTEMPT_STATUSES = Object.freeze([
  'SIGNED', 'BROADCAST_ACCEPTED', 'OUTCOME_PENDING', 'FINALIZED_SUCCESS',
  'FINALIZED_FAILURE', 'WALLET_REJECTED', 'OUTCOME_UNKNOWN', 'EXTERNAL_PENDING',
]);
const ATTEMPT_TRANSITIONS = Object.freeze({
  SIGNED: new Set(['OUTCOME_PENDING']),
  BROADCAST_ACCEPTED: new Set(['OUTCOME_PENDING']),
  OUTCOME_PENDING: new Set([
    'BROADCAST_ACCEPTED', 'OUTCOME_UNKNOWN',
    'FINALIZED_SUCCESS', 'FINALIZED_FAILURE',
  ]),
  OUTCOME_UNKNOWN: new Set(['OUTCOME_PENDING']),
  WALLET_REJECTED: new Set(['WALLET_REJECTED', 'SIGNED', 'EXTERNAL_PENDING']),
  EXTERNAL_PENDING: new Set(['FINALIZED_SUCCESS', 'FINALIZED_FAILURE']),
  FINALIZED_SUCCESS: new Set(),
  FINALIZED_FAILURE: new Set(['SIGNED', 'WALLET_REJECTED', 'EXTERNAL_PENDING']),
});
const PLAN_TRANSITIONS = Object.freeze({
  ACTIVE: new Set(['ACTIVE', 'COMPLETE', 'ABANDONED_RECOVERABLE', 'RELEASE_RETIRED']),
  COMPLETE: new Set(),
  ABANDONED_RECOVERABLE: new Set(['ACTIVE']),
  RELEASE_RETIRED: new Set(),
});
const RESTORE_TOKEN = Symbol('maker-v8-publication-restore');

function optionalAttemptEvent(attempt, prior = null) {
  if (['FINALIZED_SUCCESS', 'FINALIZED_FAILURE'].includes(attempt.status)) return false;
  if (attempt.sequence === 0) {
    return !['SIGNED', 'EXTERNAL_PENDING'].includes(attempt.status);
  }
  if (attempt.status === 'OUTCOME_PENDING'
    && ['SIGNED', 'BROADCAST_ACCEPTED', 'OUTCOME_UNKNOWN'].includes(prior?.status)) return false;
  return true;
}

function excessAttemptEvent(attempt) {
  return attempt.sequence >= 3;
}

function minimumEventsUntilTerminal(status) {
  return {
    SIGNED: 2,
    BROADCAST_ACCEPTED: 2,
    OUTCOME_PENDING: 1,
    OUTCOME_UNKNOWN: 2,
    EXTERNAL_PENDING: 1,
    WALLET_REJECTED: 3,
    FINALIZED_SUCCESS: 0,
    FINALIZED_FAILURE: 0,
  }[status];
}

export function assertMakerV8PublicationHistoryReserveV8(history, attempt) {
  if (!plain(history) || !Number.isSafeInteger(history.totalEvents) || history.totalEvents < 0
    || !Number.isSafeInteger(history.excessEvents) || history.excessEvents < 0
    || !plain(attempt) || !Number.isSafeInteger(attempt.sequence) || attempt.sequence < 0
    || typeof attempt.status !== 'string') {
    fail('MAKER_V8_PUBLICATION_HISTORY_RESERVE_REQUIRED', 'Publication attempt reserve input is invalid.');
  }
  const remaining = minimumEventsUntilTerminal(attempt.status);
  if (!Number.isSafeInteger(remaining)) {
    fail('MAKER_V8_PUBLICATION_HISTORY_RESERVE_REQUIRED', 'Publication attempt status has no bounded terminal path.');
  }
  const futureExcessEvents = Math.max(
    0,
    attempt.sequence + remaining - Math.max(attempt.sequence, 2),
  );
  if (history.totalEvents + remaining > MAKER_V8_PUBLICATION_HISTORY_LIMITS.maxAttemptEvents
    || history.excessEvents + futureExcessEvents
      > MAKER_V8_PUBLICATION_HISTORY_LIMITS.maxExcessEvents) {
    fail('MAKER_V8_PUBLICATION_HISTORY_RESERVE_REQUIRED', 'Publication history lacks the mandatory query and terminal outcome reserve.', {
      totalEvents: history.totalEvents,
      excessEvents: history.excessEvents,
      remaining,
      futureExcessEvents,
      maximumEvents: MAKER_V8_PUBLICATION_HISTORY_LIMITS.maxAttemptEvents,
      maximumExcessEvents: MAKER_V8_PUBLICATION_HISTORY_LIMITS.maxExcessEvents,
    });
  }
  return Object.freeze({ remaining, futureExcessEvents });
}

function assertAttemptHistoryCapacity(attempt, prior = null, transitionAware = false) {
  const remaining = minimumEventsUntilTerminal(attempt.status);
  if (!Number.isSafeInteger(remaining)
    || attempt.sequence + remaining >= MAKER_V8_PUBLICATION_HISTORY_LIMITS.maxEventsPerOrdinal
    || (transitionAware && optionalAttemptEvent(attempt, prior)
      && attempt.sequence >= MAKER_V8_PUBLICATION_HISTORY_LIMITS.optionalRetrySoftLimitPerOrdinal)) {
    fail('MAKER_V8_PUBLICATION_HISTORY_RESERVE_REQUIRED', 'Optional retry evidence would consume the terminal outcome reserve for this ordinal.', {
      sequence: attempt.sequence,
      status: attempt.status,
      softLimit: MAKER_V8_PUBLICATION_HISTORY_LIMITS.optionalRetrySoftLimitPerOrdinal,
      hardLimit: MAKER_V8_PUBLICATION_HISTORY_LIMITS.maxEventsPerOrdinal,
    });
  }
}

function requiresPersistentEvidence(attempt) {
  return attempt != null && attempt.status !== 'WALLET_REJECTED';
}

function boundedDiagnostic(value, depth = 0) {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value.length <= 128 ? value : `${value.slice(0, 128)}…`;
  if (depth >= 3) return '[truncated]';
  if (Array.isArray(value)) {
    return value.slice(0, 8).map((entry) => boundedDiagnostic(entry, depth + 1));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, 16)
      .map(([key, entry]) => [key.slice(0, 128), boundedDiagnostic(entry, depth + 1)]));
  }
  return String(value).slice(0, 128);
}

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.name = 'MakerV8PublicationStoreError';
  error.code = code;
  error.layer = 'PERSISTENCE';
  error.details = Object.freeze(boundedDiagnostic(details));
  throw error;
}

function plain(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertDeterministicJson(value, label = 'Durable publication value') {
  const seen = new WeakSet();
  let nodes = 0;
  const visit = (entry, path, depth) => {
    nodes += 1;
    if (nodes > 200_000 || depth > 128) {
      fail('MAKER_V8_PUBLICATION_JSON_DOMAIN_INVALID', `${label} exceeds the deterministic JSON domain budget.`, { path });
    }
    if (entry === null || typeof entry === 'string' || typeof entry === 'boolean') return;
    if (typeof entry === 'number') {
      if (!Number.isSafeInteger(entry) || Object.is(entry, -0)) {
        fail('MAKER_V8_PUBLICATION_JSON_DOMAIN_INVALID', `${label} contains a non-canonical JSON number.`, { path });
      }
      return;
    }
    if (typeof entry !== 'object') {
      fail('MAKER_V8_PUBLICATION_JSON_DOMAIN_INVALID', `${label} contains a value outside the deterministic JSON domain.`, { path });
    }
    if (seen.has(entry)) {
      fail('MAKER_V8_PUBLICATION_JSON_DOMAIN_INVALID', `${label} contains a cyclic value.`, { path });
    }
    seen.add(entry);
    const descriptors = Object.getOwnPropertyDescriptors(entry);
    const symbols = Object.getOwnPropertySymbols(entry);
    if (symbols.length) {
      fail('MAKER_V8_PUBLICATION_JSON_DOMAIN_INVALID', `${label} contains symbol-keyed data.`, { path });
    }
    if (Array.isArray(entry)) {
      if (Object.getPrototypeOf(entry) !== Array.prototype) {
        fail('MAKER_V8_PUBLICATION_JSON_DOMAIN_INVALID', `${label} contains a non-plain array.`, { path });
      }
      const keys = Object.keys(entry);
      const ownKeys = Reflect.ownKeys(entry);
      if (keys.length !== entry.length || keys.some((key, index) => key !== String(index))
        || ownKeys.length !== entry.length + 1 || ownKeys.at(-1) !== 'length') {
        fail('MAKER_V8_PUBLICATION_JSON_DOMAIN_INVALID', `${label} contains a sparse array or extra array fields.`, { path });
      }
      for (let index = 0; index < entry.length; index += 1) {
        const descriptor = descriptors[index];
        if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) {
          fail('MAKER_V8_PUBLICATION_JSON_DOMAIN_INVALID', `${label} contains an accessor or hidden array value.`, { path: `${path}[${index}]` });
        }
        visit(descriptor.value, `${path}[${index}]`, depth + 1);
      }
    } else {
      const prototype = Object.getPrototypeOf(entry);
      if (prototype !== Object.prototype && prototype !== null) {
        fail('MAKER_V8_PUBLICATION_JSON_DOMAIN_INVALID', `${label} contains a non-plain record.`, { path });
      }
      const keys = Object.keys(entry);
      if (Reflect.ownKeys(entry).length !== keys.length) {
        fail('MAKER_V8_PUBLICATION_JSON_DOMAIN_INVALID', `${label} contains hidden or symbol-keyed record data.`, { path });
      }
      for (const key of keys) {
        const descriptor = descriptors[key];
        if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) {
          fail('MAKER_V8_PUBLICATION_JSON_DOMAIN_INVALID', `${label} contains an accessor or hidden record value.`, { path: `${path}.${key}` });
        }
        visit(descriptor.value, `${path}.${key}`, depth + 1);
      }
    }
    seen.delete(entry);
  };
  visit(value, '$', 0);
  return value;
}

function clone(value) {
  assertDeterministicJson(value);
  return structuredClone(value);
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function canonical(value) {
  assertDeterministicJson(value);
  return canonicalJson(value);
}

function assertCanonicalByteBudget(value, label, maximum) {
  assertDeterministicJson(value, label);
  const byteLength = encoder.encode(canonicalJson(value)).length;
  if (byteLength > maximum) {
    fail('MAKER_V8_PUBLICATION_CANONICAL_BYTE_BUDGET_EXCEEDED', `${label} exceeds its canonical UTF-8 byte budget.`, {
      byteLength, maximum,
    });
  }
  return byteLength;
}

function exactKeys(value, fields, label) {
  if (!plain(value)) fail('MAKER_V8_PUBLICATION_RECORD_INVALID', `${label} must be a plain record.`);
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (actual.length !== expected.length
    || actual.some((field, index) => field !== expected[index])) {
    fail('MAKER_V8_PUBLICATION_FIELDS_INVALID', `${label} has fields outside the exact durable schema.`, {
      actualCount: actual.length,
      expectedCount: expected.length,
      actualSample: actual.slice(0, 8),
      expectedSample: expected.slice(0, 8),
    });
  }
  return value;
}

function suiDigest(value, label) {
  let bytes;
  try {
    if (typeof value !== 'string') throw new Error('shape');
    bytes = fromBase58(value);
    if (bytes.length !== 32 || toBase58(bytes) !== value) throw new Error('canonical');
  } catch {
    fail('MAKER_V8_PUBLICATION_SUI_DIGEST_INVALID', `${label} must be one canonical 32-byte Sui digest.`);
  }
  return value;
}

function validateCompilerAuthority(authority) {
  exactKeys(authority, AUTHORITY_FIELDS, 'Compiler authority');
  exactKeys(authority.protocolProfile, PROFILE_FIELDS, 'Compiler protocol profile');
  exactKeys(authority.coreArtifact, CORE_ARTIFACT_FIELDS, 'Compiler Core artifact');
  exactKeys(authority.protocolConfig, PROTOCOL_CONFIG_FIELDS, 'Compiler ProtocolConfig binding');
  exactKeys(authority.catalog, CATALOG_FIELDS, 'Compiler Catalog binding');
  exactKeys(authority.configs, ['seal', 'runtime', 'output', 'physical', 'market', 'release'], 'Compiler config bindings');
  if (authority.schemaVersion !== 'animacraft.maker-v8-publication-authority.v1'
    || !HASH.test(authority.trustedContextCommitment)
    || !HASH.test(authority.sealPolicyCommitment)
    || Object.values(authority.protocolProfile).some((value) => typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(value))
    || !EXACT_ID.test(authority.coreArtifact.callablePackageId)
    || !HASH.test(authority.coreArtifact.baseRegistryModuleSha256)
    || !EXACT_ID.test(authority.protocolConfig.objectId)
    || !/^(?:0|[1-9][0-9]*)$/.test(authority.protocolConfig.revision)
    || !HASH.test(authority.protocolConfig.commitment)
    || !EXACT_ID.test(authority.catalog.objectId)
    || !EXACT_ID.test(authority.catalog.protocolConfigId)
    || !/^(?:0|[1-9][0-9]*)$/.test(authority.catalog.protocolConfigRevision)
    || ['protocolConfigCommitment', 'productBindingCommitment', 'callCapSetCommitment']
      .some((field) => !HASH.test(authority.catalog[field]))) {
    fail('MAKER_V8_PUBLICATION_AUTHORITY_INVALID', 'Compiler authority has malformed protocol, Core, Catalog, or commitment fields.');
  }
  if (canonical(authority.protocolProfile) !== canonical(MAKER_V8_APPROVED_SUI_PROTOCOL_PROFILE)
    || authority.coreArtifact.baseRegistryModuleSha256
      !== MAKER_V8_APPROVED_CORE_BASE_REGISTRY_MODULE_SHA256) {
    fail('MAKER_V8_PUBLICATION_AUTHORITY_UNMEASURED', 'Compiler authority is not bound to the exact measured Sui protocol and Core artifact profile.');
  }
  suiDigest(authority.coreArtifact.packageDigest, 'Core package digest');
  if (!Array.isArray(authority.packageTuple) || authority.packageTuple.length !== ROLES.length) {
    fail('MAKER_V8_PUBLICATION_AUTHORITY_INVALID', 'Compiler authority must bind the exact seven package roles.');
  }
  const seen = new Set();
  for (const [index, entry] of authority.packageTuple.entries()) {
    exactKeys(entry, PACKAGE_FIELDS, `Compiler packageTuple[${index}]`);
    if (entry.role !== ROLES[index] || seen.has(entry.role)
      || !EXACT_ID.test(entry.originalPackageId) || !EXACT_ID.test(entry.callablePackageId)
      || ['sourceCommitment', 'packageCommitment', 'abiCommitment', 'bindingCommitment']
        .some((field) => !HASH.test(entry[field]))) {
      fail('MAKER_V8_PUBLICATION_AUTHORITY_INVALID', 'Compiler package tuple order or binding is invalid.');
    }
    suiDigest(entry.packageDigest, `Compiler packageTuple[${index}].packageDigest`);
    seen.add(entry.role);
  }
  exactKeys(authority.compilerAbi, ROLES, 'Compiler ABI allowlist');
  for (const role of ROLES) {
    const prefix = authority.packageTuple[ROLES.indexOf(role)].callablePackageId;
    const expectedTargets = MAKER_V8_PUBLICATION_COMPILER_ABI[role]
      .map((suffix) => `${prefix}::${suffix}`);
    if (!Array.isArray(authority.compilerAbi[role])
      || canonical(authority.compilerAbi[role]) !== canonical(expectedTargets)) {
      fail('MAKER_V8_PUBLICATION_AUTHORITY_INVALID', `Compiler ABI targets for ${role} are invalid.`);
    }
  }
  for (const role of ['seal', 'runtime', 'output', 'physical', 'market', 'release']) {
    const config = authority.configs[role];
    exactKeys(config, CONFIG_BINDING_FIELDS, `Compiler configs.${role}`);
    exactKeys(config.fields, role === 'seal' ? SEAL_CONFIG_FIELDS : COMMON_CONFIG_FIELDS, `Compiler configs.${role}.fields`);
    const fields = config.fields;
    if (!EXACT_ID.test(config.objectId) || fields.version !== 8
      || fields.catalogId !== authority.catalog.objectId
      || fields.productBindingCommitment !== authority.catalog.productBindingCommitment
      || fields.callCapSetCommitment !== authority.catalog.callCapSetCommitment
      || !EXACT_ID.test(fields.authorityId)) {
      fail('MAKER_V8_PUBLICATION_AUTHORITY_INVALID', `Compiler ${role} config binding is invalid.`);
    }
    if (role === 'seal') {
      if (fields.commitment !== authority.sealPolicyCommitment
        || !HASH.test(fields.keyServerSetCommitment)
        || !HASH.test(fields.encryptionPolicyCommitment)
        || !Array.isArray(fields.keyServerIds) || !fields.keyServerIds.length
        || !Array.isArray(fields.weights) || fields.weights.length !== fields.keyServerIds.length
        || fields.keyServerIds.some((id) => !EXACT_ID.test(id))
        || fields.weights.some((weight) => !Number.isSafeInteger(weight) || weight < 0 || weight > 65_535)
        || !Number.isSafeInteger(fields.threshold) || fields.threshold < 0 || fields.threshold > 65_535) {
        fail('MAKER_V8_PUBLICATION_AUTHORITY_INVALID', 'Compiler seal config binding is invalid.');
      }
    }
  }
  return authority;
}

function validateCompilerTargets(descriptor, plan, label) {
  if (!plan) {
    fail('MAKER_V8_PUBLICATION_AUTHORITY_REQUIRED', `${label} requires its immutable compiler authority.`);
  }
  const allowed = new Set(ROLES.flatMap((role) => plan.immutable.compilerAuthority.compilerAbi[role]));
  if (!Array.isArray(descriptor.targets)
    || descriptor.targets.length !== descriptor.commandCount
    || descriptor.targets.some((target) => !allowed.has(target))) {
    fail('MAKER_V8_PUBLICATION_TARGET_INVALID', `${label} contains a Move target outside its immutable exact compiler ABI.`);
  }
}

async function digest(bytes) {
  if (typeof globalThis.crypto?.subtle?.digest !== 'function') {
    fail('MAKER_V8_PUBLICATION_WEB_CRYPTO_REQUIRED', 'Web Crypto is required for durable publication blobs.');
  }
  const result = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  return [...result].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function digestSync(bytes) {
  return [...sha256(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function canonicalDigestSync(value) {
  return digestSync(encoder.encode(canonical(value)));
}

function attemptEventSha256Sync(attempt) {
  exactKeys(attempt, ATTEMPT_FIELDS, 'Publication transaction attempt');
  const payload = { ...attempt };
  delete payload.eventSha256;
  return canonicalDigestSync(payload);
}

export function makerV8PublicationAttemptSha256V8(attempt) {
  return attemptEventSha256Sync(attempt);
}

function scopeKeySync({ chainIdentifier, signerAddress, makerKey }) {
  return canonicalDigestSync({
    schemaVersion: 'animacraft.maker-v8-publication-scope.v1',
    chainIdentifier,
    signerAddress,
    makerKey,
  });
}

function blobRefsCommitmentSync(blobRefs) {
  return canonicalDigestSync({
    schemaVersion: 'animacraft.maker-v8-publication-blobs.v1',
    ...blobRefs,
  });
}

function attemptIdSync({ planId, scopeKey, attemptNonce }) {
  return canonicalDigestSync({
    schemaVersion: MAKER_V8_PUBLICATION_PERSISTENCE_SCHEMA,
    planId,
    scopeKey,
    attemptNonce,
  });
}

export async function makerV8PublicationPlanIdV8(immutable) {
  assertDeterministicJson(immutable, 'Immutable publication plan');
  exactKeys(immutable, IMMUTABLE_FIELDS, 'Immutable publication plan');
  return digest(encoder.encode(canonical(immutable)));
}

export async function makerV8PublicationCompilerAuthorityV8(payload) {
  assertDeterministicJson(payload, 'Compiler authority payload');
  exactKeys(payload, AUTHORITY_PAYLOAD_FIELDS, 'Compiler authority payload');
  const trustedContextCommitment = await digest(encoder.encode(canonical(payload)));
  const authority = { ...clone(payload), trustedContextCommitment };
  validateCompilerAuthority(authority);
  return Object.freeze(authority);
}

export async function makerV8PublicationScopeKeyV8(input) {
  assertDeterministicJson(input, 'Publication scope identity');
  const { chainIdentifier, signerAddress, makerKey } = input;
  if (chainIdentifier !== MAINNET_CHAIN_IDENTIFIER || !EXACT_ID.test(signerAddress)
    || typeof makerKey !== 'string' || !makerKey || encoder.encode(makerKey).length > 128) {
    fail('MAKER_V8_PUBLICATION_SCOPE_INPUT_INVALID', 'Publication scope identity is invalid.');
  }
  return scopeKeySync({ chainIdentifier, signerAddress, makerKey });
}

export async function makerV8PublicationBlobRefsCommitmentV8(blobRefs) {
  assertDeterministicJson(blobRefs, 'Publication blob refs');
  exactKeys(blobRefs, BLOB_REF_FIELDS, 'Publication blob refs');
  return blobRefsCommitmentSync(blobRefs);
}

export async function makerV8PublicationAttemptIdV8(input) {
  assertDeterministicJson(input, 'Publication attempt identity');
  const { planId, scopeKey, attemptNonce } = input;
  if (!HASH.test(planId) || !HASH.test(scopeKey)
    || typeof attemptNonce !== 'string' || !attemptNonce
    || encoder.encode(attemptNonce).length > 192) {
    fail('MAKER_V8_PUBLICATION_ATTEMPT_ID_INPUT_INVALID', 'Publication attempt identity input is invalid.');
  }
  return attemptIdSync({ planId, scopeKey, attemptNonce });
}

function assertPlanIdentitySync(plan) {
  assertMakerV8PublicationPlanV8(plan);
  const scopeKey = scopeKeySync(plan.immutable);
  const blobRefsCommitment = blobRefsCommitmentSync(plan.blobRefs);
  const authorityPayload = { ...plan.immutable.compilerAuthority };
  delete authorityPayload.trustedContextCommitment;
  const authorityCommitment = canonicalDigestSync(authorityPayload);
  const protocolProfileCommitment = canonicalDigestSync({
    schemaVersion: 'animacraft.maker-v8-sui-protocol-profile.v1',
    ...plan.immutable.compilerAuthority.protocolProfile,
  });
  const coreArtifactCommitment = canonicalDigestSync({
    schemaVersion: 'animacraft.maker-v8-core-artifact.v1',
    ...plan.immutable.compilerAuthority.coreArtifact,
  });
  if (scopeKey !== plan.scopeKey
    || blobRefsCommitment !== plan.immutable.blobRefsCommitment
    || authorityCommitment !== plan.immutable.compilerAuthority.trustedContextCommitment
    || protocolProfileCommitment !== plan.immutable.protocolProfileCommitment
    || protocolProfileCommitment !== MAKER_V8_APPROVED_SUI_PROTOCOL_PROFILE_COMMITMENT
    || coreArtifactCommitment !== plan.immutable.coreArtifactCommitment) {
    fail('MAKER_V8_PUBLICATION_AUTHORITY_COMMITMENT_MISMATCH', 'Immutable publication scope, blobs, or compiler authority commitments do not match their canonical evidence.');
  }
  const planId = canonicalDigestSync(plan.immutable);
  const attemptId = attemptIdSync({
    planId,
    scopeKey: plan.scopeKey,
    attemptNonce: plan.attemptNonce,
  });
  if (plan.planId !== planId || plan.attemptId !== attemptId) {
    fail('MAKER_V8_PUBLICATION_PLAN_ID_MISMATCH', 'Durable publication IDs do not match canonical immutable plan and attempt inputs.', {
      expectedPlanId: planId,
      expectedAttemptId: attemptId,
    });
  }
  return plan;
}

export async function assertMakerV8PublicationPlanIdentityV8(plan) {
  return assertPlanIdentitySync(plan);
}

export async function makerV8PublicationCheckpointSha256V8(checkpoint) {
  exactKeys(checkpoint, CHECKPOINT_FIELDS, 'Finalized publication checkpoint');
  assertCanonicalByteBudget(checkpoint, 'Finalized publication checkpoint', MAKER_V8_PUBLICATION_BYTE_LIMITS.maxCheckpointCanonicalUtf8Bytes);
  const payload = { ...checkpoint };
  delete payload.checkpointSha256;
  return digest(encoder.encode(canonical(payload)));
}

function checkpointSha256Sync(checkpoint) {
  exactKeys(checkpoint, CHECKPOINT_FIELDS, 'Finalized publication checkpoint');
  assertCanonicalByteBudget(checkpoint, 'Finalized publication checkpoint', MAKER_V8_PUBLICATION_BYTE_LIMITS.maxCheckpointCanonicalUtf8Bytes);
  const payload = { ...checkpoint };
  delete payload.checkpointSha256;
  return canonicalDigestSync(payload);
}

async function assertBlob(blob, label = 'Publication blob') {
  return assertBlobSync(blob, label);
}

function assertBlobSync(blob, label = 'Publication blob') {
  assertDeterministicJson(blob, label);
  exactKeys(blob, BLOB_FIELDS, label);
  validateRef({
    sha256: blob.sha256,
    byteLength: blob.byteLength,
    encoding: blob.encoding,
  }, label);
  if (typeof blob.data !== 'string') fail('MAKER_V8_PUBLICATION_BLOB_INVALID', `${label} data must be text.`);
  let bytes;
  if (blob.encoding === 'UTF8') bytes = encoder.encode(blob.data);
  else {
    try { bytes = fromBase64(blob.data); } catch { fail('MAKER_V8_PUBLICATION_BLOB_INVALID', `${label} is not valid Base64.`); }
    if (toBase64(bytes) !== blob.data) fail('MAKER_V8_PUBLICATION_BLOB_INVALID', `${label} is not canonical Base64.`);
  }
  const observed = digestSync(bytes);
  if (bytes.length !== blob.byteLength || observed !== blob.sha256) {
    fail('MAKER_V8_PUBLICATION_BLOB_HASH_MISMATCH', `${label} bytes differ from their content address.`, {
      expectedSha256: blob.sha256,
      observedSha256: observed,
      expectedByteLength: blob.byteLength,
      observedByteLength: bytes.length,
    });
  }
  return blob;
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed.'));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted.'));
    transaction.onerror = () => {};
  });
}

function storageError(error, message) {
  if (error?.name === 'MakerV8PublicationStoreError'
    || error?.name === 'MakerV8PublicationBrowserError') return error;
  const quota = error?.name === 'QuotaExceededError';
  const changed = error?.name === 'VersionError' || error?.name === 'InvalidStateError';
  const wrapped = new Error(quota
    ? 'Durable Maker v8 publication storage quota was exceeded before an atomic checkpoint completed.'
    : message);
  wrapped.name = 'MakerV8PublicationStoreError';
  wrapped.code = quota
    ? 'MAKER_V8_PUBLICATION_STORAGE_QUOTA_EXCEEDED'
    : changed
      ? 'MAKER_V8_PUBLICATION_STORAGE_VERSION_CHANGED'
      : 'MAKER_V8_PUBLICATION_STORAGE_FAILED';
  wrapped.layer = 'PERSISTENCE';
  wrapped.details = Object.freeze({ retryable: !quota, cause: String(error?.name || 'unknown').slice(0, 64) });
  return wrapped;
}

function validateRef(ref, label) {
  assertDeterministicJson(ref, label);
  exactKeys(ref, ['sha256', 'byteLength', 'encoding'], label);
  if (!HASH.test(ref.sha256)
    || !Number.isSafeInteger(ref.byteLength) || ref.byteLength < 0
    || !['UTF8', 'BASE64'].includes(ref.encoding)) {
    fail('MAKER_V8_PUBLICATION_BLOB_REF_INVALID', `${label} reference is invalid.`);
  }
  return ref;
}

function sequence(value, label) {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(value)) {
    fail('MAKER_V8_PUBLICATION_TOPOLOGY_INVALID', `${label} must be one canonical decimal sequence.`);
  }
  const amount = BigInt(value);
  if (amount > (1n << 64n) - 1n) {
    fail('MAKER_V8_PUBLICATION_TOPOLOGY_INVALID', `${label} exceeds u64.`);
  }
  return amount;
}

function validateTopologyEntry(entry, label = 'Publication transaction') {
  const topology = MAKER_V8_PUBLICATION_TOPOLOGY;
  const checkpoint = entry.compilerCheckpoint;
  if (!plain(checkpoint)) {
    fail('MAKER_V8_PUBLICATION_TOPOLOGY_INVALID', `${label} compiler checkpoint must be a plain record.`);
  }
  const start = sequence(entry.startSequence, `${label} startSequence`);
  const end = sequence(entry.endSequence, `${label} endSequence`);
  if (end < start) {
    fail('MAKER_V8_PUBLICATION_TOPOLOGY_INVALID', `${label} sequence range is reversed.`);
  }
  let localIndex;
  let final;
  if (entry.kind === topology.scaffold.kind || entry.kind === topology.companion.kind) {
    const expected = entry.kind === topology.scaffold.kind ? topology.scaffold : topology.companion;
    exactKeys(checkpoint, STATIC_COMPILER_CHECKPOINT_FIELDS, `${label} compiler checkpoint`);
    localIndex = checkpoint.index;
    final = checkpoint.final;
    if (entry.phase !== expected.phase || entry.lane !== expected.lane || entry.action !== expected.action
      || checkpoint.schemaVersion !== expected.checkpointSchema
      || checkpoint.phase !== expected.phase || checkpoint.lane !== expected.lane
      || checkpoint.action !== expected.action || checkpoint.index !== 0
      || checkpoint.startSequence !== '0' || checkpoint.endSequence !== '0'
      || checkpoint.final !== true || start !== 0n || end !== 0n) {
      fail('MAKER_V8_PUBLICATION_TOPOLOGY_INVALID', `${label} does not match the exact ${entry.kind} compiler topology.`);
    }
  } else if (entry.kind === topology.base.kind) {
    exactKeys(checkpoint, BASE_COMPILER_CHECKPOINT_FIELDS, `${label} compiler checkpoint`);
    localIndex = checkpoint.index;
    final = checkpoint.final;
    const action = entry.phase === 'BASE_APPEND' ? 'APPEND' : entry.phase === 'BASE_SEAL' ? 'SEAL' : null;
    if (!topology.base.phases.includes(entry.phase) || entry.lane !== topology.base.lane
      || entry.action !== action || checkpoint.schemaVersion !== topology.base.checkpointSchema
      || checkpoint.phase !== entry.phase || checkpoint.lane !== entry.lane
      || checkpoint.startSequence !== entry.startSequence
      || checkpoint.endSequence !== entry.endSequence
      || checkpoint.final !== (entry.phase === 'BASE_SEAL')
      || (action === 'APPEND' ? end <= start : start !== end)
      || !plain(checkpoint.expected) || !plain(checkpoint.metrics)) {
      fail('MAKER_V8_PUBLICATION_TOPOLOGY_INVALID', `${label} does not match an exact Base compiler checkpoint.`);
    }
  } else if (entry.kind === topology.activation.kind) {
    exactKeys(checkpoint, ACTIVATION_COMPILER_CHECKPOINT_FIELDS, `${label} compiler checkpoint`);
    localIndex = checkpoint.index;
    final = checkpoint.final;
    const phaseIndex = topology.activation.phases.indexOf(entry.phase);
    const match = /^ACTIVATION_(SEAL|RUNTIME|OUTPUT|PHYSICAL)_(APPEND|SEAL)$/.exec(entry.phase);
    const lane = entry.phase === 'ACTIVATION_FINALIZE' ? 'FINALIZE' : match?.[1];
    const action = entry.phase === 'ACTIVATION_FINALIZE' ? 'FINALIZE' : match?.[2];
    if (phaseIndex < 0 || entry.lane !== lane || entry.action !== action
      || checkpoint.schemaVersion !== topology.activation.checkpointSchema
      || checkpoint.phase !== entry.phase || checkpoint.lane !== lane || checkpoint.action !== action
      || checkpoint.startSequence !== entry.startSequence
      || checkpoint.endSequence !== entry.endSequence
      || checkpoint.final !== (entry.phase === 'ACTIVATION_FINALIZE')
      || (action === 'APPEND' ? end <= start
        : action === 'SEAL' ? start !== end : start !== 0n || end !== 0n)
      || !plain(checkpoint.expected) || !plain(checkpoint.metrics)) {
      fail('MAKER_V8_PUBLICATION_TOPOLOGY_INVALID', `${label} does not match an exact Activation compiler checkpoint.`);
    }
  } else {
    fail('MAKER_V8_PUBLICATION_TOPOLOGY_INVALID', `${label} has an unknown compiler transaction kind.`);
  }
  if (!Number.isSafeInteger(localIndex) || localIndex < 0 || typeof final !== 'boolean') {
    fail('MAKER_V8_PUBLICATION_TOPOLOGY_INVALID', `${label} compiler checkpoint index or final marker is invalid.`);
  }
  return { kind: entry.kind, phase: entry.phase, localIndex, start, end, final };
}

function validateTopologyTransition(previous, next, label = 'Publication transaction') {
  const nextTopology = validateTopologyEntry(next, label);
  if (previous === null) {
    if (next.ordinal !== 0 || nextTopology.kind !== MAKER_V8_PUBLICATION_TOPOLOGY.scaffold.kind) {
      fail('MAKER_V8_PUBLICATION_TOPOLOGY_INVALID', 'Ordinal zero must be the exact Scaffold transaction.');
    }
    return nextTopology;
  }
  const previousTopology = validateTopologyEntry(previous, 'Prior finalized publication checkpoint');
  if (next.ordinal !== previous.ordinal + 1) {
    fail('MAKER_V8_PUBLICATION_TOPOLOGY_INVALID', 'Publication topology ordinal is not the exact successor.');
  }
  if (previousTopology.kind === 'SCAFFOLD') {
    if (nextTopology.kind !== 'BASE_CHUNK' || nextTopology.localIndex !== 0 || nextTopology.start !== 0n) {
      fail('MAKER_V8_PUBLICATION_TOPOLOGY_INVALID', 'Scaffold must be followed by the first Base chunk.');
    }
  } else if (previousTopology.kind === 'BASE_CHUNK') {
    if (previousTopology.final) {
      if (nextTopology.kind !== 'COMPANION_OBJECTS') {
        fail('MAKER_V8_PUBLICATION_TOPOLOGY_INVALID', 'The sealed Base must be followed by exactly one companion transaction.');
      }
    } else if (nextTopology.kind !== 'BASE_CHUNK'
      || nextTopology.localIndex !== previousTopology.localIndex + 1
      || (nextTopology.phase === previousTopology.phase
        ? nextTopology.start !== previousTopology.end
        : previousTopology.phase !== 'BASE_APPEND' || nextTopology.phase !== 'BASE_SEAL'
          || nextTopology.start !== previousTopology.end)) {
      fail('MAKER_V8_PUBLICATION_TOPOLOGY_INVALID', 'Base chunks do not form one exact append-then-seal sequence.');
    }
  } else if (previousTopology.kind === 'COMPANION_OBJECTS') {
    const phase = MAKER_V8_PUBLICATION_TOPOLOGY.activation.phases.indexOf(nextTopology.phase);
    if (nextTopology.kind !== 'ACTIVATION_CHUNK' || nextTopology.localIndex !== 0
      || nextTopology.start !== 0n || ![0, 1].includes(phase)) {
      fail('MAKER_V8_PUBLICATION_TOPOLOGY_INVALID', 'Companion creation must be followed by the first Seal activation chunk.');
    }
  } else if (previousTopology.kind === 'ACTIVATION_CHUNK') {
    if (previousTopology.final || nextTopology.kind !== 'ACTIVATION_CHUNK'
      || nextTopology.localIndex !== previousTopology.localIndex + 1) {
      fail('MAKER_V8_PUBLICATION_TOPOLOGY_INVALID', 'Activation cannot continue after finalization or leave its exact chunk sequence.');
    }
    const phases = MAKER_V8_PUBLICATION_TOPOLOGY.activation.phases;
    const from = phases.indexOf(previousTopology.phase);
    const to = phases.indexOf(nextTopology.phase);
    const sameAppend = to === from && previousTopology.phase.endsWith('_APPEND')
      && nextTopology.start === previousTopology.end;
    const appendToSeal = to === from + 1 && previousTopology.phase.endsWith('_APPEND')
      && nextTopology.phase.endsWith('_SEAL')
      && nextTopology.start === previousTopology.end;
    const sealToNext = to === from + 1 && previousTopology.phase.endsWith('_SEAL')
      && nextTopology.start === 0n;
    const skippedEmptyAppend = to === from + 2 && previousTopology.phase.endsWith('_SEAL')
      && nextTopology.phase.endsWith('_SEAL')
      && nextTopology.start === 0n && nextTopology.end === 0n;
    if (!sameAppend && !appendToSeal && !sealToNext && !skippedEmptyAppend) {
      fail('MAKER_V8_PUBLICATION_TOPOLOGY_INVALID', 'Activation chunks do not follow the measured lane append/seal order.');
    }
  } else {
    fail('MAKER_V8_PUBLICATION_TOPOLOGY_INVALID', 'Publication topology cannot continue after its prior stage.');
  }
  return nextTopology;
}

function validateCurrent(current, plan = null) {
  exactKeys(current, CURRENT_FIELDS, 'Current publication transaction');
  if (!Number.isSafeInteger(current.ordinal) || current.ordinal < 0
    || current.ordinal >= MAKER_V8_PUBLICATION_HISTORY_LIMITS.maxCheckpoints
    || typeof current.kind !== 'string' || !current.kind
    || typeof current.phase !== 'string' || !current.phase
    || !HASH.test(current.transactionKindSha256)
    || current.transactionKindRef?.sha256 !== current.transactionKindSha256
    || !plain(current.outcome)
    || !['READY', 'SIGNED', 'OUTCOME_PENDING', 'OUTCOME_UNKNOWN', 'FINALIZED_FAILURE'].includes(current.outcome.status)) {
    fail('MAKER_V8_PUBLICATION_CURRENT_INVALID', 'Publication current transaction state is invalid.');
  }
  validateTopologyEntry(current, 'Current publication transaction');
  if (encoder.encode(current.phase).length > 96 || typeof current.lane !== 'string'
    || !current.lane || encoder.encode(current.lane).length > 96
    || typeof current.action !== 'string' || !current.action
    || !Array.isArray(current.rowCommitments) || !plain(current.preState)
    || !plain(current.postState) || !plain(current.compilerCheckpoint)
    || !Number.isSafeInteger(current.commandCount) || current.commandCount < 1
    || current.commandCount > MAKER_V8_TRANSACTION_LIMITS.maxCommands
    || !Array.isArray(current.targets) || current.targets.length !== current.commandCount
    || current.targets.some((target) => typeof target !== 'string' || !target
      || encoder.encode(target).length > 320)) {
    fail('MAKER_V8_PUBLICATION_CURRENT_INVALID', 'Publication current compiler descriptor is malformed or exceeds the pinned limits.');
  }
  for (const [index, row] of current.rowCommitments.entries()) {
    exactKeys(row, ['lane', 'commitment'], `Current rowCommitments[${index}]`);
    if (typeof row.lane !== 'string' || !row.lane || encoder.encode(row.lane).length > 96
      || !HASH.test(row.commitment)) {
      fail('MAKER_V8_PUBLICATION_CURRENT_INVALID', 'Publication row commitment is invalid.');
    }
  }
  validateRef(current.transactionKindRef, 'TransactionKind');
  assertCanonicalByteBudget(
    current.compilerCheckpoint,
    'Current compiler checkpoint',
    MAKER_V8_PUBLICATION_BYTE_LIMITS.maxCompilerCheckpointCanonicalUtf8Bytes,
  );
  if (current.transactionKindRef.encoding !== 'BASE64') {
    fail('MAKER_V8_PUBLICATION_CURRENT_INVALID', 'TransactionKind ref must contain canonical Base64 bytes.');
  }
  if (current.transactionKindRef.byteLength > MAKER_V8_TRANSACTION_LIMITS.maxKindBytes) {
    fail('MAKER_V8_PUBLICATION_CURRENT_INVALID', 'TransactionKind ref exceeds the pinned compiler byte budget.');
  }
  if (current.fullTransactionRef != null) validateRef(current.fullTransactionRef, 'TransactionData');
  if (current.signatureRef != null) validateRef(current.signatureRef, 'Signature');
  if (current.fullTransactionRef?.encoding === 'UTF8' || current.signatureRef?.encoding === 'UTF8') {
    fail('MAKER_V8_PUBLICATION_CURRENT_INVALID', 'TransactionData and signature refs must contain canonical Base64 bytes.');
  }
  if ((current.fullTransactionRef?.byteLength ?? 0) > MAKER_V8_BYTE_BUDGETS.maxTransactionDataBytes
    || (current.signatureRef?.byteLength ?? 0) > MAKER_V8_PUBLICATION_BYTE_LIMITS.maxSignatureBytes) {
    fail('MAKER_V8_PUBLICATION_SIGNED_ARTIFACT_LIMIT', 'Durable TransactionData or signature ref exceeds its pinned byte budget.');
  }
  const outcomeFields = {
    READY: ['status'],
    SIGNED: ['status', 'digest', 'kindSha256', 'signedAt'],
    OUTCOME_PENDING: [
      'status', 'digest', 'kindSha256', 'signedAt', 'firstSeenAt', 'source',
      'broadcastAt', 'observedAt',
    ],
    OUTCOME_UNKNOWN: [
      'status', 'digest', 'kindSha256', 'signedAt', 'firstSeenAt', 'source',
      'broadcastAt', 'observedAt', 'code',
    ],
    FINALIZED_FAILURE: [
      'status', 'digest', 'kindSha256', 'signedAt', 'firstSeenAt', 'broadcastAt',
      'observedAt', 'failureCode', 'source',
    ],
  }[current.outcome.status];
  exactKeys(current.outcome, outcomeFields, `${current.outcome.status} outcome`);
  if (current.outcome.status !== 'READY'
    && (typeof current.outcome.digest !== 'string' || !current.outcome.digest
      || current.outcome.kindSha256 !== current.transactionKindSha256)) {
    fail('MAKER_V8_PUBLICATION_OUTCOME_INVALID', 'Publication outcome is not bound to the exact transaction kind.');
  }
  if (current.outcome.status !== 'READY') {
    suiDigest(current.outcome.digest, `${current.outcome.status} transaction digest`);
  }
  if (current.outcome.status === 'SIGNED'
    && (!current.fullTransactionRef || !current.signatureRef
      || !Number.isSafeInteger(current.outcome.signedAt) || current.outcome.signedAt < 0)) {
    fail('MAKER_V8_PUBLICATION_SIGNED_INVALID', 'Signed publication state is not bound to exact durable bytes and signature.');
  }
  if (current.outcome.status === 'READY'
    && (current.fullTransactionRef !== null || current.signatureRef !== null)) {
    fail('MAKER_V8_PUBLICATION_CURRENT_INVALID', 'READY publication cursor cannot retain signed artifacts.');
  }
  if (current.outcome.status === 'OUTCOME_PENDING') {
    if (!['WALLET', 'EXTERNAL_FINALIZED'].includes(current.outcome.source)
      || (current.outcome.source === 'WALLET' && (!current.fullTransactionRef || !current.signatureRef))
      || (current.outcome.source === 'EXTERNAL_FINALIZED'
        && (current.fullTransactionRef !== null || current.signatureRef !== null))) {
      fail('MAKER_V8_PUBLICATION_PENDING_INVALID', 'Pending publication source does not match its durable signed artifacts.');
    }
    if (current.outcome.source === 'WALLET'
      ? !Number.isSafeInteger(current.outcome.signedAt)
        || current.outcome.signedAt < 0
        || current.outcome.signedAt > current.outcome.firstSeenAt
      : current.outcome.signedAt !== null) {
      fail('MAKER_V8_PUBLICATION_PENDING_INVALID', 'Pending publication signed-time provenance is invalid.');
    }
    if (!Number.isSafeInteger(current.outcome.observedAt)
      || current.outcome.observedAt < current.outcome.firstSeenAt
      || (current.outcome.broadcastAt !== null
        && (!Number.isSafeInteger(current.outcome.broadcastAt)
          || current.outcome.broadcastAt < current.outcome.firstSeenAt
          || current.outcome.broadcastAt > current.outcome.observedAt))
      || (current.outcome.source === 'EXTERNAL_FINALIZED'
        && current.outcome.broadcastAt !== null)) {
      fail('MAKER_V8_PUBLICATION_PENDING_INVALID', 'Pending publication broadcast timeline is invalid.');
    }
  }
  if (current.outcome.status === 'OUTCOME_UNKNOWN'
    && (current.outcome.source !== 'WALLET' || !current.fullTransactionRef || !current.signatureRef
      || !Number.isSafeInteger(current.outcome.signedAt) || current.outcome.signedAt < 0
      || !Number.isSafeInteger(current.outcome.firstSeenAt) || current.outcome.firstSeenAt < 0
      || current.outcome.signedAt > current.outcome.firstSeenAt
      || !Number.isSafeInteger(current.outcome.observedAt) || current.outcome.observedAt < current.outcome.firstSeenAt
      || current.outcome.broadcastAt !== null
        && (!Number.isSafeInteger(current.outcome.broadcastAt)
          || current.outcome.broadcastAt < current.outcome.firstSeenAt
          || current.outcome.broadcastAt > current.outcome.observedAt)
      || typeof current.outcome.code !== 'string' || !current.outcome.code
      || encoder.encode(current.outcome.code).length > 128)) {
    fail('MAKER_V8_PUBLICATION_CURRENT_INVALID', 'Unknown wallet outcome must preserve exact durable signed artifacts and timing.');
  }
  if (current.outcome.status === 'FINALIZED_FAILURE') {
    if (!['WALLET', 'EXTERNAL_FINALIZED'].includes(current.outcome.source)
      || (current.outcome.source === 'WALLET' && (!current.fullTransactionRef || !current.signatureRef))
      || (current.outcome.source === 'EXTERNAL_FINALIZED'
        && (current.fullTransactionRef !== null || current.signatureRef !== null))) {
      fail('MAKER_V8_PUBLICATION_CURRENT_INVALID', 'Finalized failure source does not match its durable artifact provenance.');
    }
    if (!Number.isSafeInteger(current.outcome.firstSeenAt) || current.outcome.firstSeenAt < 0
      || !Number.isSafeInteger(current.outcome.observedAt)
      || current.outcome.observedAt < current.outcome.firstSeenAt
      || (current.outcome.source === 'WALLET'
        ? !Number.isSafeInteger(current.outcome.signedAt)
          || current.outcome.signedAt < 0
          || current.outcome.signedAt > current.outcome.firstSeenAt
        : current.outcome.signedAt !== null)
      || current.outcome.broadcastAt !== null
        && (!Number.isSafeInteger(current.outcome.broadcastAt)
          || current.outcome.broadcastAt < current.outcome.firstSeenAt
          || current.outcome.broadcastAt > current.outcome.observedAt)
      || current.outcome.source === 'EXTERNAL_FINALIZED' && current.outcome.broadcastAt !== null
      || current.outcome.failureCode !== 'MAKER_V8_COMPILER_TRANSACTION_FAILED') {
      fail('MAKER_V8_PUBLICATION_CURRENT_INVALID', 'Finalized failure timeline or code is invalid.');
    }
  }
  if (current.outcome.status === 'OUTCOME_PENDING'
    && (!Number.isSafeInteger(current.outcome.firstSeenAt) || current.outcome.firstSeenAt < 0)) {
    fail('MAKER_V8_PUBLICATION_PENDING_INVALID', 'Pending publication outcome requires a durable first-seen time.');
  }
  if (plan) validateCompilerTargets(current, plan, 'Current publication transaction');
  return current;
}

export function assertMakerV8PublicationPlanV8(plan) {
  assertDeterministicJson(plan, 'Publication plan');
  assertCanonicalByteBudget(
    plan,
    'Publication plan',
    MAKER_V8_PUBLICATION_BYTE_LIMITS.maxPlanCanonicalUtf8Bytes,
  );
  exactKeys(plan, PLAN_FIELDS, 'Publication plan');
  exactKeys(plan.immutable, IMMUTABLE_FIELDS, 'Immutable publication plan');
  exactKeys(plan.blobRefs, BLOB_REF_FIELDS, 'Publication blob refs');
  exactKeys(plan.attemptHistory, ATTEMPT_HISTORY_FIELDS, 'Publication global attempt-history anchor');
  if (plan.schemaVersion !== MAKER_V8_PUBLICATION_PERSISTENCE_SCHEMA
    || !HASH.test(plan.planId) || !HASH.test(plan.attemptId)
    || typeof plan.attemptNonce !== 'string' || !plan.attemptNonce
    || encoder.encode(plan.attemptNonce).length > 192
    || !HASH.test(plan.scopeKey)
    || !MAKER_V8_PUBLICATION_PLAN_STATES.includes(plan.status)
    || !Number.isSafeInteger(plan.revision) || plan.revision < 1
    || !Number.isSafeInteger(plan.createdAt) || plan.createdAt < 0
    || !Number.isSafeInteger(plan.updatedAt) || plan.updatedAt < plan.createdAt
    || !plain(plan.immutable)
    || !Number.isSafeInteger(plan.attemptHistory.totalEvents)
    || plan.attemptHistory.totalEvents < 0
    || plan.attemptHistory.totalEvents > MAKER_V8_PUBLICATION_HISTORY_LIMITS.maxAttemptEvents
    || !Number.isSafeInteger(plan.attemptHistory.excessEvents)
    || plan.attemptHistory.excessEvents < 0
    || plan.attemptHistory.excessEvents > plan.attemptHistory.totalEvents
    || plan.attemptHistory.excessEvents
      > MAKER_V8_PUBLICATION_HISTORY_LIMITS.maxExcessEvents
    || plan.attemptHistory.totalEvents - plan.attemptHistory.excessEvents
      > 3 * MAKER_V8_PUBLICATION_HISTORY_LIMITS.maxCheckpoints
    || (plan.attemptHistory.totalEvents === 0
      ? plan.attemptHistory.globalAttemptHeadSha256 !== null
      : !HASH.test(plan.attemptHistory.globalAttemptHeadSha256))
    || plan.immutable.chainIdentifier !== MAINNET_CHAIN_IDENTIFIER
    || plan.immutable.paymentCoinType !== NATIVE_USDC
    || !EXACT_ID.test(plan.immutable.signerAddress)
    || typeof plan.immutable.makerKey !== 'string' || !plan.immutable.makerKey
    || encoder.encode(plan.immutable.makerKey).length > 128
    || !HASH.test(plan.immutable.manifestSha256)
    || !HASH.test(plan.immutable.contentCommitment)
    || !HASH.test(plan.immutable.protocolProfileCommitment)
    || !HASH.test(plan.immutable.coreArtifactCommitment)
    || !HASH.test(plan.immutable.blobRefsCommitment)
    || !plain(plan.immutable.compilerAuthority)) {
    fail('MAKER_V8_PUBLICATION_PLAN_INVALID', 'Durable publication plan is invalid.');
  }
  validateCompilerAuthority(plan.immutable.compilerAuthority);
  const authority = plan.immutable.compilerAuthority;
  const core = authority.packageTuple[0];
  if (authority.coreArtifact.callablePackageId !== core.callablePackageId
    || authority.coreArtifact.packageDigest !== core.packageDigest
    || authority.protocolConfig.objectId !== authority.catalog.protocolConfigId
    || authority.protocolConfig.revision !== authority.catalog.protocolConfigRevision
    || authority.protocolConfig.commitment !== authority.catalog.protocolConfigCommitment) {
    fail('MAKER_V8_PUBLICATION_AUTHORITY_INVALID', 'Compiler authority cross-bindings are inconsistent.');
  }
  validateRef(plan.blobRefs.document, 'Maker document');
  validateRef(plan.blobRefs.transportMetadata, 'Author transport metadata');
  validateRef(plan.blobRefs.compilerContext, 'Immutable compiler context snapshot');
  if (plan.blobRefs.document.encoding !== 'UTF8'
    || plan.blobRefs.transportMetadata.encoding !== 'UTF8'
    || plan.blobRefs.compilerContext.encoding !== 'UTF8'
    || plan.blobRefs.document.byteLength > MAKER_V8_BYTE_BUDGETS.maxDocumentUtf8Bytes
    || plan.blobRefs.transportMetadata.byteLength > MAKER_V8_BYTE_BUDGETS.maxManifestBytes
    || plan.blobRefs.compilerContext.byteLength
      > MAKER_V8_PUBLICATION_BYTE_LIMITS.maxPlanCanonicalUtf8Bytes) {
    fail('MAKER_V8_PUBLICATION_BLOB_REF_INVALID', 'Document and transport metadata refs must be UTF-8.');
  }
  if (!Array.isArray(plan.blobRefs.assets)) {
    fail('MAKER_V8_PUBLICATION_ASSET_REFS_INVALID', 'Publication asset blob refs must be an exact array.');
  }
  const assetIds = new Set();
  let previousAssetId = null;
  let totalAssetBytes = 0;
  for (const [index, entry] of plan.blobRefs.assets.entries()) {
    exactKeys(entry, ASSET_REF_FIELDS, `Publication asset ref[${index}]`);
    validateRef(entry.blob, `Publication asset[${index}]`);
    if (typeof entry.assetId !== 'string' || !entry.assetId
      || encoder.encode(entry.assetId).length > 128
      || entry.blob.encoding !== 'BASE64'
      || entry.blob.byteLength > MAKER_V8_BYTE_BUDGETS.maxAssetBytes
      || assetIds.has(entry.assetId)
      || (previousAssetId !== null && previousAssetId >= entry.assetId)) {
      fail('MAKER_V8_PUBLICATION_ASSET_REFS_INVALID', 'Publication asset blob refs must bind unique bounded asset IDs to canonical Base64 refs.');
    }
    assetIds.add(entry.assetId);
    previousAssetId = entry.assetId;
    totalAssetBytes += entry.blob.byteLength;
    if (!Number.isSafeInteger(totalAssetBytes)
      || totalAssetBytes > MAKER_V8_BYTE_BUDGETS.maxTotalAssetBytes) {
      fail('MAKER_V8_PUBLICATION_ASSET_REFS_INVALID', 'Publication asset refs exceed the compiler total byte budget.');
    }
  }
  if (plan.current !== null) {
    validateCurrent(plan.current, plan);
    const outcome = plan.current.outcome;
    const outcomeAt = outcome.status === 'SIGNED' ? outcome.signedAt
      : outcome.status === 'OUTCOME_PENDING' ? outcome.observedAt
        : ['OUTCOME_UNKNOWN', 'FINALIZED_FAILURE'].includes(outcome.status)
          ? outcome.observedAt : null;
    if (outcomeAt !== null && outcomeAt > plan.updatedAt) {
      fail('MAKER_V8_PUBLICATION_CLOCK_REGRESSION', 'Publication plan predates its durable transaction outcome.');
    }
  }
  if (plan.head !== null) {
    exactKeys(plan.head, HEAD_FIELDS, 'Publication head');
    if (!Number.isSafeInteger(plan.head.ordinal) || plan.head.ordinal < 0
      || typeof plan.head.digest !== 'string' || !plan.head.digest
      || !HASH.test(plan.head.transactionKindSha256)
      || !HASH.test(plan.head.checkpointSha256)
      || typeof plan.head.phase !== 'string' || !plan.head.phase
      || encoder.encode(plan.head.phase).length > 96
      || typeof plan.head.lane !== 'string' || !plan.head.lane
      || encoder.encode(plan.head.lane).length > 96) {
      fail('MAKER_V8_PUBLICATION_HEAD_INVALID', 'Durable publication head is invalid.');
    }
    suiDigest(plan.head.digest, 'Durable publication head digest');
  }
  if (plan.current && plan.current.ordinal !== (plan.head?.ordinal ?? -1) + 1) {
    fail('MAKER_V8_PUBLICATION_CURSOR_INVALID', 'Current publication ordinal must be the exact successor of the finalized head.');
  }
  if (plan.nextPreparation !== null) {
    exactKeys(plan.nextPreparation, NEXT_PREPARATION_FIELDS, 'Publication successor preparation');
    if (!['REQUIRED', 'BLOCKED'].includes(plan.nextPreparation.status)
      || plan.nextPreparation.ordinal !== (plan.head?.ordinal ?? -1) + 1
      || (plan.nextPreparation.status === 'REQUIRED') !== (plan.nextPreparation.reason === null)) {
      fail('MAKER_V8_PUBLICATION_NEXT_PREPARATION_INVALID', 'Publication successor preparation state is invalid.');
    }
  }
  if (plan.terminal !== null) {
    exactKeys(plan.terminal, TERMINAL_FIELDS, 'Publication terminal record');
    if (plan.terminal.status !== plan.status || typeof plan.terminal.reason !== 'string'
      || !plan.terminal.reason || !Number.isSafeInteger(plan.terminal.at) || plan.terminal.at < 0
      || plan.terminal.at > plan.updatedAt) {
      fail('MAKER_V8_PUBLICATION_TERMINAL_INVALID', 'Publication terminal record is invalid.');
    }
  }
  if ((plan.status === 'ACTIVE') !== (plan.terminal === null)) {
    fail('MAKER_V8_PUBLICATION_TERMINAL_INVALID', 'Only an active publication may omit terminal evidence.');
  }
  if (plan.status === 'COMPLETE' && plan.current !== null) {
    fail('MAKER_V8_PUBLICATION_PLAN_STATE_INVALID', 'Complete publication cannot retain a current transaction.');
  }
  if (plan.status === 'ACTIVE'
    && ((plan.current === null) === (plan.nextPreparation === null))) {
    fail('MAKER_V8_PUBLICATION_PLAN_STATE_INVALID', 'Active publication requires exactly one current transaction or durable successor-preparation boundary.');
  }
  if (['ABANDONED_RECOVERABLE', 'RELEASE_RETIRED'].includes(plan.status)) {
    const boundary = plan.current === null && plan.nextPreparation?.status === 'BLOCKED';
    const prepared = plan.nextPreparation === null
      && ['READY', 'FINALIZED_FAILURE'].includes(plan.current?.outcome.status);
    if (!boundary && !prepared) {
      fail('MAKER_V8_PUBLICATION_PLAN_STATE_INVALID', 'Recoverable terminal publication must preserve either a blocked successor boundary or an unsigned/finalized-failure cursor.');
    }
  }
  return plan;
}

export function assertMakerV8PublicationCheckpointV8(checkpoint, plan = null) {
  assertDeterministicJson(checkpoint, 'Finalized publication checkpoint');
  assertCanonicalByteBudget(
    checkpoint,
    'Finalized publication checkpoint',
    MAKER_V8_PUBLICATION_BYTE_LIMITS.maxCheckpointCanonicalUtf8Bytes,
  );
  exactKeys(checkpoint, CHECKPOINT_FIELDS, 'Finalized publication checkpoint');
  if (checkpoint.schemaVersion !== MAKER_V8_PUBLICATION_PERSISTENCE_SCHEMA
    || !HASH.test(checkpoint.attemptId)
    || !Number.isSafeInteger(checkpoint.ordinal) || checkpoint.ordinal < 0
    || checkpoint.ordinal >= MAKER_V8_PUBLICATION_HISTORY_LIMITS.maxCheckpoints
    || typeof checkpoint.digest !== 'string' || !checkpoint.digest
    || !HASH.test(checkpoint.transactionKindSha256)
    || !HASH.test(checkpoint.checkpointSha256)
    || checkpoint.transactionKindRef?.sha256 !== checkpoint.transactionKindSha256
    || typeof checkpoint.phase !== 'string' || !checkpoint.phase
    || encoder.encode(checkpoint.phase).length > 96
    || typeof checkpoint.lane !== 'string' || !checkpoint.lane
    || encoder.encode(checkpoint.lane).length > 96
    || !plain(checkpoint.certificate) || !plain(checkpoint.readback)
    || !Number.isSafeInteger(checkpoint.finalizedAt) || checkpoint.finalizedAt < 0) {
    fail('MAKER_V8_PUBLICATION_CHECKPOINT_INVALID', 'Durable finalized checkpoint is invalid.');
  }
  suiDigest(checkpoint.digest, 'Finalized checkpoint digest');
  validateTopologyEntry(checkpoint, 'Finalized publication checkpoint');
  if (!Array.isArray(checkpoint.rowCommitments) || !plain(checkpoint.preState)
    || !plain(checkpoint.postState)
    || !Number.isSafeInteger(checkpoint.commandCount) || checkpoint.commandCount < 1
    || checkpoint.commandCount > MAKER_V8_TRANSACTION_LIMITS.maxCommands
    || !Array.isArray(checkpoint.targets) || checkpoint.targets.length !== checkpoint.commandCount
    || checkpoint.targets.some((target) => typeof target !== 'string' || !target
      || encoder.encode(target).length > 320)) {
    fail('MAKER_V8_PUBLICATION_CHECKPOINT_INVALID', 'Finalized checkpoint compiler descriptor is malformed or exceeds the pinned limits.');
  }
  for (const [index, row] of checkpoint.rowCommitments.entries()) {
    exactKeys(row, ['lane', 'commitment'], `Checkpoint rowCommitments[${index}]`);
    if (typeof row.lane !== 'string' || !row.lane || encoder.encode(row.lane).length > 96
      || !HASH.test(row.commitment)) {
      fail('MAKER_V8_PUBLICATION_CHECKPOINT_INVALID', 'Finalized checkpoint row commitment is invalid.');
    }
  }
  exactKeys(checkpoint.certificate, CERTIFICATE_FIELDS, 'Finalized checkpoint certificate');
  assertCanonicalByteBudget(
    checkpoint.compilerCheckpoint,
    'Finalized compiler checkpoint',
    MAKER_V8_PUBLICATION_BYTE_LIMITS.maxCompilerCheckpointCanonicalUtf8Bytes,
  );
  assertCanonicalByteBudget(
    checkpoint.readback,
    'Finalized RPC readback',
    MAKER_V8_PUBLICATION_BYTE_LIMITS.maxReadbackCanonicalUtf8Bytes,
  );
  assertCanonicalByteBudget(
    checkpoint.certificate,
    'Finalized checkpoint certificate',
    MAKER_V8_PUBLICATION_BYTE_LIMITS.maxCertificateCanonicalUtf8Bytes,
  );
  if (checkpoint.submissionSource !== 'WALLET'
      && checkpoint.submissionSource !== 'EXTERNAL_FINALIZED'
    || checkpoint.readback.source !== 'FINALIZED_RPC'
    || checkpoint.readback.transactionDigest !== checkpoint.digest
    || checkpoint.readback.transactionKindSha256 !== checkpoint.transactionKindSha256
    || checkpoint.certificate.source !== 'FINALIZED_RPC'
    || checkpoint.certificate.transactionDigest !== checkpoint.digest
    || checkpoint.certificate.transactionKindSha256 !== checkpoint.transactionKindSha256
    || checkpoint.certificate.readbackSha256 !== canonicalDigestSync(checkpoint.readback)) {
    fail('MAKER_V8_PUBLICATION_FINALIZED_EVIDENCE_INVALID', 'Finalized checkpoint evidence does not bind its exact RPC digest, TransactionKind, and canonical readback.');
  }
  validateRef(checkpoint.transactionKindRef, 'Checkpoint TransactionKind');
  if (checkpoint.transactionKindRef.encoding !== 'BASE64'
    || checkpoint.transactionKindRef.byteLength > MAKER_V8_TRANSACTION_LIMITS.maxKindBytes) {
    fail('MAKER_V8_PUBLICATION_CHECKPOINT_INVALID', 'Checkpoint TransactionKind ref must be canonical Base64.');
  }
  if (checkpoint.fullTransactionRef != null) validateRef(checkpoint.fullTransactionRef, 'Checkpoint TransactionData');
  if (checkpoint.signatureRef != null) validateRef(checkpoint.signatureRef, 'Checkpoint signature');
  if (checkpoint.fullTransactionRef?.encoding === 'UTF8' || checkpoint.signatureRef?.encoding === 'UTF8'
    || (checkpoint.fullTransactionRef === null) !== (checkpoint.signatureRef === null)) {
    fail('MAKER_V8_PUBLICATION_CHECKPOINT_INVALID', 'Checkpoint signed artifact refs have invalid encoding or provenance.');
  }
  if ((checkpoint.fullTransactionRef?.byteLength ?? 0) > MAKER_V8_BYTE_BUDGETS.maxTransactionDataBytes
    || (checkpoint.signatureRef?.byteLength ?? 0) > MAKER_V8_PUBLICATION_BYTE_LIMITS.maxSignatureBytes) {
    fail('MAKER_V8_PUBLICATION_SIGNED_ARTIFACT_LIMIT', 'Finalized TransactionData or signature ref exceeds its pinned byte budget.');
  }
  if ((checkpoint.submissionSource === 'WALLET') !== (checkpoint.fullTransactionRef !== null)) {
    fail('MAKER_V8_PUBLICATION_FINALIZED_EVIDENCE_INVALID', 'Finalized checkpoint submission source differs from its exact signed artifact provenance.');
  }
  if (plan && (checkpoint.attemptId !== plan.attemptId
    || checkpoint.planId !== plan.planId
    || checkpoint.ordinal !== (plan.head?.ordinal ?? -1) + 1
    || checkpoint.previousCheckpointSha256 !== (plan.head?.checkpointSha256 ?? null))) {
    fail('MAKER_V8_PUBLICATION_CHECKPOINT_SEQUENCE_INVALID', 'Finalized checkpoint does not extend the exact durable head.');
  }
  if (plan) validateCompilerTargets(checkpoint, plan, 'Finalized publication checkpoint');
  return checkpoint;
}

function validateAttempt(attempt, plan) {
  assertDeterministicJson(attempt, 'Publication transaction attempt');
  assertCanonicalByteBudget(
    attempt,
    'Publication transaction attempt',
    MAKER_V8_PUBLICATION_BYTE_LIMITS.maxAttemptCanonicalUtf8Bytes,
  );
  exactKeys(attempt, ATTEMPT_FIELDS, 'Publication transaction attempt');
  if (attempt.schemaVersion !== MAKER_V8_PUBLICATION_PERSISTENCE_SCHEMA
    || attempt.attemptId !== plan.attemptId
    || !Number.isSafeInteger(attempt.ordinal) || attempt.ordinal < 0
    || !Number.isSafeInteger(attempt.sequence) || attempt.sequence < 0
    || attempt.sequence >= MAKER_V8_PUBLICATION_HISTORY_LIMITS.maxEventsPerOrdinal
    || !ATTEMPT_STATUSES.includes(attempt.status)
    || !Number.isSafeInteger(attempt.observedAt) || attempt.observedAt < 0
    || !HASH.test(attempt.eventSha256)
    || (attempt.sequence === 0
      ? attempt.previousAttemptSha256 !== null
      : !HASH.test(attempt.previousAttemptSha256))
    || (attempt.ordinal === 0 && attempt.sequence === 0
      ? attempt.previousGlobalAttemptSha256 !== null
      : !HASH.test(attempt.previousGlobalAttemptSha256))) {
    fail('MAKER_V8_PUBLICATION_ATTEMPT_INVALID', 'Durable transaction attempt event is invalid.');
  }
  if (attemptEventSha256Sync(attempt) !== attempt.eventSha256) {
    fail('MAKER_V8_PUBLICATION_ATTEMPT_HASH_MISMATCH', 'Durable transaction attempt differs from its canonical event hash.');
  }
  assertAttemptHistoryCapacity(attempt);
  const noSignedArtifact = ['WALLET_REJECTED', 'EXTERNAL_PENDING'].includes(attempt.status);
  const terminal = ['FINALIZED_SUCCESS', 'FINALIZED_FAILURE'].includes(attempt.status);
  if (!HASH.test(attempt.kindSha256)
    || (attempt.status === 'WALLET_REJECTED') !== (attempt.digest === null)
    || (!terminal && noSignedArtifact !== (attempt.fullTransactionRef === null))
    || (!terminal && noSignedArtifact !== (attempt.signatureRef === null))
    || terminal && ((attempt.fullTransactionRef === null) !== (attempt.signatureRef === null))
    || (attempt.status === 'EXTERNAL_PENDING'
      && (typeof attempt.digest !== 'string' || !attempt.digest))) {
    fail('MAKER_V8_PUBLICATION_ATTEMPT_INVALID', 'Wallet rejection cannot claim a signed transaction artifact.');
  }
  if (attempt.status !== 'WALLET_REJECTED') {
    suiDigest(attempt.digest, 'Transaction attempt digest');
  }
  if (!noSignedArtifact && !(terminal && attempt.fullTransactionRef === null)) {
    if (typeof attempt.digest !== 'string' || !attempt.digest) {
      fail('MAKER_V8_PUBLICATION_ATTEMPT_INVALID', 'Transaction attempt must bind an exact digest and kind hash.');
    }
    validateRef(attempt.fullTransactionRef, 'Attempt TransactionData');
    validateRef(attempt.signatureRef, 'Attempt signature');
    if (attempt.fullTransactionRef.encoding !== 'BASE64'
      || attempt.signatureRef.encoding !== 'BASE64'
      || attempt.fullTransactionRef.byteLength > MAKER_V8_BYTE_BUDGETS.maxTransactionDataBytes
      || attempt.signatureRef.byteLength > MAKER_V8_PUBLICATION_BYTE_LIMITS.maxSignatureBytes) {
      fail('MAKER_V8_PUBLICATION_ATTEMPT_INVALID', 'Attempt TransactionData and signature refs must be canonical Base64.');
    }
  }
  exactKeys(attempt.details, ATTEMPT_DETAILS_FIELDS, 'Transaction attempt details');
  const terminalAttempt = ['FINALIZED_SUCCESS', 'FINALIZED_FAILURE'].includes(attempt.status);
  const nullableTime = (value) => value === null || Number.isSafeInteger(value) && value >= 0;
  if (!['WALLET', 'EXTERNAL_FINALIZED'].includes(attempt.details.source)
    || !Number.isSafeInteger(attempt.details.at) || attempt.details.at < 0
    || (attempt.details.code !== null
      && (typeof attempt.details.code !== 'string' || !attempt.details.code
        || encoder.encode(attempt.details.code).length > 128))
    || !nullableTime(attempt.details.signedAt)
    || !nullableTime(attempt.details.firstSeenAt)
    || !nullableTime(attempt.details.broadcastAt)
    || attempt.details.at !== attempt.observedAt
    || (!terminalAttempt
      && ((attempt.status === 'EXTERNAL_PENDING')
        !== (attempt.details.source === 'EXTERNAL_FINALIZED')))) {
    fail('MAKER_V8_PUBLICATION_ATTEMPT_INVALID', 'Transaction attempt details are invalid.');
  }
  const codeRequired = ['WALLET_REJECTED', 'OUTCOME_UNKNOWN', 'FINALIZED_FAILURE'].includes(attempt.status);
  if (codeRequired !== (attempt.details.code !== null)
    || attempt.status === 'FINALIZED_FAILURE'
      && attempt.details.code !== 'MAKER_V8_COMPILER_TRANSACTION_FAILED') {
    fail('MAKER_V8_PUBLICATION_ATTEMPT_INVALID', 'Transaction attempt code does not match its exact outcome status.');
  }
  const walletPipeline = !['WALLET_REJECTED', 'EXTERNAL_PENDING'].includes(attempt.status)
    && !(terminalAttempt && attempt.details.source === 'EXTERNAL_FINALIZED');
  if (attempt.status === 'SIGNED'
    ? attempt.details.signedAt !== attempt.details.at
      || attempt.details.firstSeenAt !== null || attempt.details.broadcastAt !== null
    : attempt.status === 'WALLET_REJECTED'
      ? attempt.details.signedAt !== null || attempt.details.firstSeenAt !== null
        || attempt.details.broadcastAt !== null
      : attempt.status === 'EXTERNAL_PENDING'
        ? attempt.details.signedAt !== null || attempt.details.firstSeenAt !== attempt.details.at
          || attempt.details.broadcastAt !== null
        : attempt.status === 'BROADCAST_ACCEPTED'
          ? attempt.details.signedAt === null || attempt.details.firstSeenAt === null
            || attempt.details.signedAt > attempt.details.firstSeenAt
            || attempt.details.broadcastAt !== attempt.details.at
        : walletPipeline
          ? attempt.details.signedAt === null || attempt.details.firstSeenAt === null
            || attempt.details.signedAt > attempt.details.firstSeenAt
            || attempt.details.broadcastAt !== null
              && (attempt.details.broadcastAt < attempt.details.firstSeenAt
                || attempt.details.broadcastAt > attempt.details.at)
          : attempt.details.signedAt !== null || attempt.details.firstSeenAt === null
            || attempt.details.broadcastAt !== null) {
    fail('MAKER_V8_PUBLICATION_ATTEMPT_INVALID', 'Transaction attempt cumulative timeline projection is invalid.');
  }
  if (terminalAttempt) {
    const external = attempt.fullTransactionRef === null;
    if (attempt.details.source !== (external ? 'EXTERNAL_FINALIZED' : 'WALLET')) {
      fail('MAKER_V8_PUBLICATION_ATTEMPT_INVALID', 'Finalized attempt source differs from its signed artifact provenance.');
    }
  }
  return attempt;
}

export async function makerV8Utf8BlobV8(text) {
  if (typeof text !== 'string') fail('MAKER_V8_PUBLICATION_BLOB_INVALID', 'UTF-8 publication blob must be text.');
  const bytes = encoder.encode(text);
  return Object.freeze({ sha256: await digest(bytes), byteLength: bytes.length, encoding: 'UTF8', data: text });
}

export async function makerV8Base64BlobV8(base64) {
  if (typeof base64 !== 'string') fail('MAKER_V8_PUBLICATION_BLOB_INVALID', 'Base64 publication blob must be text.');
  let bytes;
  try { bytes = fromBase64(base64); } catch { fail('MAKER_V8_PUBLICATION_BLOB_INVALID', 'Publication blob is not canonical Base64.'); }
  if (toBase64(bytes) !== base64) fail('MAKER_V8_PUBLICATION_BLOB_INVALID', 'Publication blob is not canonical Base64.');
  return Object.freeze({ sha256: await digest(bytes), byteLength: bytes.length, encoding: 'BASE64', data: base64 });
}

export function makerV8BlobRefV8(blob) {
  return Object.freeze({ sha256: blob.sha256, byteLength: blob.byteLength, encoding: blob.encoding });
}

export async function readMakerV8PublicationBlobV8(store, ref, label) {
  validateRef(ref, label);
  const blob = await store.getBlob(ref.sha256);
  if (!plain(blob) || blob.sha256 !== ref.sha256 || blob.byteLength !== ref.byteLength
    || blob.encoding !== ref.encoding || typeof blob.data !== 'string') {
    fail('MAKER_V8_PUBLICATION_BLOB_MISSING', `${label} content-addressed blob is unavailable.`);
  }
  let bytes;
  if (blob.encoding === 'UTF8') bytes = encoder.encode(blob.data);
  else {
    try { bytes = fromBase64(blob.data); } catch { fail('MAKER_V8_PUBLICATION_BLOB_HASH_MISMATCH', `${label} blob is not valid Base64.`); }
    if (toBase64(bytes) !== blob.data) fail('MAKER_V8_PUBLICATION_BLOB_HASH_MISMATCH', `${label} blob is not canonical Base64.`);
  }
  if (bytes.length !== ref.byteLength || await digest(bytes) !== ref.sha256) {
    fail('MAKER_V8_PUBLICATION_BLOB_HASH_MISMATCH', `${label} content-addressed blob failed exact hash verification.`);
  }
  return blob.data;
}

function sameImmutable(current, next) {
  return current.attemptId === next.attemptId
    && current.planId === next.planId
    && current.scopeKey === next.scopeKey
    && current.createdAt === next.createdAt
    && canonical(current.immutable) === canonical(next.immutable)
    && canonical(current.blobRefs) === canonical(next.blobRefs);
}

function activeIndex(plan) {
  return {
    scopeKey: plan.scopeKey,
    attemptId: plan.attemptId,
    planId: plan.planId,
    revision: plan.revision,
    chainIdentifier: plan.immutable.chainIdentifier,
    signerAddress: plan.immutable.signerAddress,
    makerKey: plan.immutable.makerKey,
    updatedAt: plan.updatedAt,
  };
}

function usedAttemptRecord(plan) {
  return {
    attemptId: plan.attemptId,
    planId: plan.planId,
    scopeKey: plan.scopeKey,
    attemptNonce: plan.attemptNonce,
    createdAt: plan.createdAt,
    disposition: 'PRESENT',
    deletedAt: null,
  };
}

function assertUsedAttemptRecord(record, plan) {
  assertDeterministicJson(record, 'Used publication attempt identity');
  exactKeys(record, USED_ATTEMPT_FIELDS, 'Used publication attempt identity');
  if (canonical(record) !== canonical(usedAttemptRecord(plan))) {
    fail('MAKER_V8_PUBLICATION_ATTEMPT_ID_REUSED', 'Durable attempt identity tombstone differs from the canonical publication plan.');
  }
  return record;
}

function assertDeletedAttemptRecord(record) {
  assertDeterministicJson(record, 'Deleted publication attempt identity');
  exactKeys(record, USED_ATTEMPT_FIELDS, 'Deleted publication attempt identity');
  if (!HASH.test(record.attemptId) || !HASH.test(record.planId) || !HASH.test(record.scopeKey)
    || typeof record.attemptNonce !== 'string' || !record.attemptNonce
    || !Number.isSafeInteger(record.createdAt) || record.createdAt < 0
    || record.disposition !== 'DELETED_UNSIGNED'
    || !Number.isSafeInteger(record.deletedAt) || record.deletedAt < record.createdAt
    || attemptIdSync(record) !== record.attemptId) {
    fail('MAKER_V8_PUBLICATION_ATTEMPT_ID_REUSED', 'Deleted attempt identity tombstone is malformed or non-canonical.');
  }
  return record;
}

function assertActiveIndex(index, plan) {
  assertDeterministicJson(index, 'Active publication index');
  const expected = activeIndex(plan);
  exactKeys(index, Object.keys(expected), 'Active publication index');
  if (canonical(index) !== canonical(expected)) {
    fail('MAKER_V8_PUBLICATION_ACTIVE_INDEX_DRIFT', 'Active publication index differs from its exact canonical plan projection.');
  }
  return index;
}

function currentDescriptor(current) {
  if (!current) return null;
  const value = { ...current };
  delete value.fullTransactionRef;
  delete value.signatureRef;
  delete value.outcome;
  return value;
}

function checkpointDescriptor(value) {
  return Object.fromEntries([
    'kind', 'phase', 'lane', 'action', 'startSequence', 'endSequence',
    'rowCommitments', 'preState', 'postState', 'compilerCheckpoint',
    'transactionKindRef', 'transactionKindSha256', 'commandCount', 'targets',
  ].map((field) => [field, value[field]]));
}

function validatePlanMutation(current, next, checkpoint, attempt, priorAttempt, restoring) {
  const expectedAttemptHistory = attempt ? {
    totalEvents: current.attemptHistory.totalEvents + 1,
    excessEvents: current.attemptHistory.excessEvents + (excessAttemptEvent(attempt) ? 1 : 0),
    globalAttemptHeadSha256: attempt.eventSha256,
  } : current.attemptHistory;
  if (canonical(next.attemptHistory) !== canonical(expectedAttemptHistory)
    || (attempt && attempt.previousGlobalAttemptSha256
      !== current.attemptHistory.globalAttemptHeadSha256)) {
    fail('MAKER_V8_PUBLICATION_ATTEMPT_GLOBAL_CHAIN_INVALID', 'Publication CAS does not atomically advance the exact global attempt-history anchor.');
  }
  if (attempt) assertMakerV8PublicationHistoryReserveV8(expectedAttemptHistory, attempt);
  if (restoring) return;
  if (checkpoint) {
    const finalActivation = checkpoint.kind === 'ACTIVATION_CHUNK'
      && checkpoint.compilerCheckpoint?.final === true;
    if (!current.current || current.current.ordinal !== checkpoint.ordinal
      || canonical(checkpointDescriptor(current.current)) !== canonical(checkpointDescriptor(checkpoint))
      || current.current.outcome.status !== 'OUTCOME_PENDING'
      || current.current.outcome.digest !== checkpoint.digest
      || attempt?.status !== 'FINALIZED_SUCCESS'
      || attempt.digest !== checkpoint.digest
      || attempt.kindSha256 !== checkpoint.transactionKindSha256
      || canonical(attempt.fullTransactionRef) !== canonical(checkpoint.fullTransactionRef)
      || canonical(attempt.signatureRef) !== canonical(checkpoint.signatureRef)
      || next.current !== null
      || !['ACTIVE', 'COMPLETE'].includes(next.status)
      || (finalActivation ? next.status !== 'COMPLETE' : next.status !== 'ACTIVE')
      || (next.status === 'ACTIVE'
        && (next.nextPreparation?.status !== 'REQUIRED'
          || next.nextPreparation.ordinal !== checkpoint.ordinal + 1))
      || (next.status === 'COMPLETE' && next.nextPreparation !== null)) {
      fail('MAKER_V8_PUBLICATION_SUCCESS_BOUNDARY_INVALID', 'Finalized success must atomically append the exact current certificate and stop at a durable successor-preparation boundary.');
    }
    return;
  }
  if (canonical(current.head) !== canonical(next.head)) return;
  if (next.status === 'COMPLETE') {
    fail('MAKER_V8_PUBLICATION_SUCCESS_BOUNDARY_INVALID', 'Complete publication can be produced only by the final checkpoint success CAS.');
  }
  if (current.status === 'ACTIVE' && next.status !== 'ACTIVE') {
    const boundary = current.current === null && next.current === null
      && ['REQUIRED', 'BLOCKED'].includes(current.nextPreparation?.status)
      && next.nextPreparation?.status === 'BLOCKED'
      && current.nextPreparation.ordinal === next.nextPreparation.ordinal;
    const retained = canonical(current.current) === canonical(next.current)
      && canonical(current.nextPreparation) === canonical(next.nextPreparation);
    const cursorPreserved = boundary || retained
      && ['READY', 'FINALIZED_FAILURE'].includes(current.current?.outcome.status);
    if (!cursorPreserved) {
      fail('MAKER_V8_PUBLICATION_TOMBSTONE_INVALID', 'Publication retirement or abandonment must preserve its exact recoverable cursor.');
    }
    return;
  }
  if (current.status === 'ACTIVE' && next.status === 'ACTIVE'
    && current.current === null && next.current === null
    && current.nextPreparation !== null && next.nextPreparation !== null) {
    if (current.nextPreparation.ordinal !== next.nextPreparation.ordinal
      || !['REQUIRED', 'BLOCKED'].includes(current.nextPreparation.status)
      || !['REQUIRED', 'BLOCKED'].includes(next.nextPreparation.status)) {
      fail('MAKER_V8_PUBLICATION_NEXT_PREPARATION_INVALID', 'Successor preparation retry changed its durable boundary.');
    }
    return;
  }
  if (current.current === null && next.current !== null) {
    if (current.status !== 'ACTIVE' || current.nextPreparation?.status !== 'REQUIRED'
      || next.status !== 'ACTIVE' || next.nextPreparation !== null
      || next.current.ordinal !== (current.head?.ordinal ?? -1) + 1
      || next.current.outcome.status !== 'READY') {
      fail('MAKER_V8_PUBLICATION_SUCCESSOR_INVALID', 'Prepared successor does not consume the exact durable preparation boundary.');
    }
    return;
  }
  if (current.current && next.current) {
    if (canonical(currentDescriptor(current.current)) !== canonical(currentDescriptor(next.current))) {
      fail('MAKER_V8_PUBLICATION_CURSOR_DRIFT', 'Publication transaction descriptor changed within one ordinal.');
    }
    const from = current.current.outcome.status;
    const to = next.current.outcome.status;
    const allowed = {
      READY: new Set(['READY', 'SIGNED', 'OUTCOME_PENDING']),
      SIGNED: new Set(['OUTCOME_PENDING']),
      OUTCOME_PENDING: new Set(['OUTCOME_PENDING', 'OUTCOME_UNKNOWN', 'FINALIZED_FAILURE']),
      OUTCOME_UNKNOWN: new Set(['OUTCOME_PENDING']),
      FINALIZED_FAILURE: new Set(['READY']),
    };
    if (!allowed[from]?.has(to)) {
      fail('MAKER_V8_PUBLICATION_OUTCOME_TRANSITION_INVALID', 'Publication outcome transition is invalid.', { from, to });
    }
    if (to === 'SIGNED' && attempt?.status !== 'SIGNED'
      || to === 'OUTCOME_UNKNOWN' && attempt?.status !== 'OUTCOME_UNKNOWN'
      || to === 'OUTCOME_PENDING'
        && !['OUTCOME_PENDING', 'BROADCAST_ACCEPTED', 'EXTERNAL_PENDING'].includes(attempt?.status)
      || to === 'FINALIZED_FAILURE' && attempt?.status !== 'FINALIZED_FAILURE') {
      fail('MAKER_V8_PUBLICATION_ATTEMPT_REQUIRED', 'Publication outcome transition requires its exact append-only attempt event.');
    }
    return;
  }
  if (next.status === 'ACTIVE') {
    fail('MAKER_V8_PUBLICATION_CURSOR_INVALID', 'Active publication mutation lost its durable cursor or successor boundary.');
  }
}

function sameRef(left, right) {
  if (left === null || right === null) return left === right;
  return canonical(left) === canonical(right);
}

function sameAttemptRefs(attempt, cursor) {
  return cursor !== null
    && sameRef(attempt.fullTransactionRef, cursor.fullTransactionRef)
    && sameRef(attempt.signatureRef, cursor.signatureRef);
}

function assertAttemptTransition(prior, attempt) {
  assertAttemptHistoryCapacity(attempt, prior, true);
  if (!prior) {
    if (attempt.sequence !== 0
      || attempt.previousAttemptSha256 !== null
      || !['SIGNED', 'WALLET_REJECTED', 'EXTERNAL_PENDING'].includes(attempt.status)) {
      fail('MAKER_V8_PUBLICATION_ATTEMPT_SEQUENCE_INVALID', 'Transaction attempt history does not begin with an exact sequence-zero signing or external-recovery event.');
    }
    return;
  }
  const freshAttempt = ['WALLET_REJECTED', 'FINALIZED_FAILURE'].includes(prior.status)
    && ['SIGNED', 'WALLET_REJECTED', 'EXTERNAL_PENDING'].includes(attempt.status);
  if (attempt.sequence !== prior.sequence + 1
    || attempt.previousAttemptSha256 !== prior.eventSha256
    || !ATTEMPT_TRANSITIONS[prior.status]?.has(attempt.status)
    || (!freshAttempt && prior.digest !== attempt.digest)
    || prior.kindSha256 !== attempt.kindSha256
    || (!freshAttempt && !sameRef(prior.fullTransactionRef, attempt.fullTransactionRef))
    || (!freshAttempt && !sameRef(prior.signatureRef, attempt.signatureRef))
    || attempt.observedAt < prior.observedAt
    || attempt.details.at < prior.details.at) {
    fail('MAKER_V8_PUBLICATION_ATTEMPT_SEQUENCE_INVALID', 'Transaction attempt history has an invalid query-first or monotonic transition.');
  }
  if (freshAttempt) return;
  const priorTimeline = prior.details;
  const timeline = attempt.details;
  if (attempt.status === 'OUTCOME_PENDING' && prior.status === 'SIGNED') {
    if (timeline.signedAt !== priorTimeline.signedAt
      || timeline.firstSeenAt !== timeline.at || timeline.broadcastAt !== null) {
      fail('MAKER_V8_PUBLICATION_ATTEMPT_TIMELINE_INVALID', 'Initial wallet pending event does not begin the exact query-first timeline.');
    }
    return;
  }
  if (attempt.status === 'BROADCAST_ACCEPTED') {
    if (priorTimeline.broadcastAt !== null
      || timeline.signedAt !== priorTimeline.signedAt
      || timeline.firstSeenAt !== priorTimeline.firstSeenAt
      || timeline.broadcastAt !== timeline.at) {
      fail('MAKER_V8_PUBLICATION_ATTEMPT_TIMELINE_INVALID', 'Broadcast acceptance does not exactly advance the pending timeline once.');
    }
    return;
  }
  if (timeline.signedAt !== priorTimeline.signedAt
    || timeline.firstSeenAt !== priorTimeline.firstSeenAt
    || timeline.broadcastAt !== priorTimeline.broadcastAt) {
    fail('MAKER_V8_PUBLICATION_ATTEMPT_TIMELINE_INVALID', 'Transaction outcome changed immutable signed, first-seen, or broadcast timing.');
  }
}

/**
 * Pure durable-state binding shared by live CAS and bundle import/export/GC.
 * It intentionally consumes no RPC or process-local brand.
 */
export function assertAttemptBindsDurableState({
  attempt,
  prior = null,
  currentBefore = null,
  currentAfter = null,
  checkpoint = null,
  updatedAt = null,
  previousUpdatedAt = null,
}) {
  if (!attempt) {
    if (checkpoint) {
      fail('MAKER_V8_PUBLICATION_ATTEMPT_BINDING_INVALID', 'A finalized checkpoint requires its append-only success attempt.');
    }
    return null;
  }
  const descriptor = checkpoint ?? currentBefore ?? currentAfter;
  if (!descriptor || attempt.ordinal !== descriptor.ordinal
    || attempt.kindSha256 !== descriptor.transactionKindSha256) {
    fail('MAKER_V8_PUBLICATION_ATTEMPT_BINDING_INVALID', 'Transaction attempt does not bind the exact durable ordinal and TransactionKind.');
  }
  if (currentBefore && (attempt.ordinal !== currentBefore.ordinal
    || attempt.kindSha256 !== currentBefore.transactionKindSha256)) {
    fail('MAKER_V8_PUBLICATION_ATTEMPT_BINDING_INVALID', 'Transaction attempt differs from the pre-mutation durable cursor.');
  }
  if (updatedAt !== null && (!Number.isSafeInteger(updatedAt)
    || attempt.observedAt > updatedAt || attempt.details.at > updatedAt)) {
    fail('MAKER_V8_PUBLICATION_CLOCK_REGRESSION', 'Durable plan time predates its append-only transaction attempt.');
  }
  if (previousUpdatedAt !== null && (!Number.isSafeInteger(previousUpdatedAt)
    || attempt.details.at < previousUpdatedAt || attempt.observedAt < previousUpdatedAt)) {
    fail('MAKER_V8_PUBLICATION_CLOCK_REGRESSION', 'New attempt evidence predates the prior durable plan revision.');
  }
  assertAttemptTransition(prior, attempt);

  if (checkpoint) {
    const external = checkpoint.submissionSource === 'EXTERNAL_FINALIZED';
    if (attempt.status !== 'FINALIZED_SUCCESS'
      || attempt.digest !== checkpoint.digest
      || attempt.kindSha256 !== checkpoint.transactionKindSha256
      || !sameRef(attempt.fullTransactionRef, checkpoint.fullTransactionRef)
      || !sameRef(attempt.signatureRef, checkpoint.signatureRef)
      || attempt.details.source !== checkpoint.submissionSource
      || attempt.details.at !== checkpoint.finalizedAt
      || attempt.observedAt > checkpoint.finalizedAt
      || external !== (attempt.fullTransactionRef === null)) {
      fail('MAKER_V8_PUBLICATION_ATTEMPT_BINDING_INVALID', 'Finalized-success attempt does not exactly bind its durable RPC checkpoint.');
    }
    if (!prior) {
      fail('MAKER_V8_PUBLICATION_ATTEMPT_BINDING_INVALID', 'Finalized success lacks its query-first predecessor event.');
    }
    const predecessorExternal = prior.status === 'EXTERNAL_PENDING';
    if (predecessorExternal !== external
      || !sameRef(prior.fullTransactionRef, attempt.fullTransactionRef)
      || !sameRef(prior.signatureRef, attempt.signatureRef)) {
      fail('MAKER_V8_PUBLICATION_ATTEMPT_BINDING_INVALID', 'Finalized-success provenance differs from its pending predecessor.');
    }
    return attempt;
  }

  if (!currentAfter) {
    fail('MAKER_V8_PUBLICATION_ATTEMPT_BINDING_INVALID', 'Non-success attempt lacks the exact durable cursor outcome it claims.');
  }
  const outcome = currentAfter.outcome;
  const refsMatch = sameAttemptRefs(attempt, currentAfter);
  const digestMatches = outcome.digest === attempt.digest
    && outcome.kindSha256 === attempt.kindSha256;
  if (attempt.status === 'SIGNED') {
    if (outcome.status !== 'SIGNED' || !digestMatches || !refsMatch
      || attempt.details.source !== 'WALLET'
      || attempt.details.at !== outcome.signedAt
      || attempt.details.signedAt !== outcome.signedAt) {
      fail('MAKER_V8_PUBLICATION_ATTEMPT_BINDING_INVALID', 'SIGNED event does not match the exact durable signed cursor and time.');
    }
  } else if (attempt.status === 'WALLET_REJECTED') {
    const unchangedReady = outcome.status === 'READY'
      && currentAfter.fullTransactionRef === null && currentAfter.signatureRef === null
      && (!currentBefore || canonical(currentBefore) === canonical(currentAfter));
    if (!unchangedReady || attempt.digest !== null
      || attempt.details.source !== 'WALLET' || attempt.details.at !== attempt.observedAt) {
      fail('MAKER_V8_PUBLICATION_ATTEMPT_BINDING_INVALID', 'Wallet rejection must preserve the exact unsigned READY cursor.');
    }
  } else if (attempt.status === 'EXTERNAL_PENDING') {
    const initialExternal = prior?.status !== 'EXTERNAL_PENDING';
    if (outcome.status !== 'OUTCOME_PENDING' || outcome.source !== 'EXTERNAL_FINALIZED'
      || !digestMatches || attempt.fullTransactionRef !== null
      || attempt.signatureRef !== null || currentAfter.fullTransactionRef !== null
      || currentAfter.signatureRef !== null || attempt.details.source !== 'EXTERNAL_FINALIZED'
      || attempt.details.firstSeenAt !== outcome.firstSeenAt
      || attempt.details.signedAt !== outcome.signedAt
      || attempt.details.broadcastAt !== outcome.broadcastAt
      || attempt.observedAt !== outcome.observedAt
      || (initialExternal
        ? attempt.details.at !== outcome.firstSeenAt
          || outcome.observedAt !== outcome.firstSeenAt
        : attempt.details.at !== outcome.observedAt)
      || outcome.broadcastAt !== null) {
      fail('MAKER_V8_PUBLICATION_ATTEMPT_BINDING_INVALID', 'External pending event must bind one digest, first-seen time, and no signed artifacts.');
    }
  } else if (attempt.status === 'OUTCOME_UNKNOWN') {
    if (outcome.status !== 'OUTCOME_UNKNOWN' || outcome.source !== 'WALLET'
      || !digestMatches || !refsMatch || attempt.details.source !== 'WALLET'
      || attempt.details.signedAt !== outcome.signedAt
      || attempt.details.firstSeenAt !== outcome.firstSeenAt
      || attempt.details.broadcastAt !== outcome.broadcastAt
      || attempt.details.at !== outcome.observedAt
      || attempt.observedAt !== outcome.observedAt
      || attempt.details.code !== outcome.code) {
      fail('MAKER_V8_PUBLICATION_ATTEMPT_BINDING_INVALID', 'Unknown wallet outcome does not preserve exact bytes, digest, code, and observed time.');
    }
  } else if (['BROADCAST_ACCEPTED', 'OUTCOME_PENDING'].includes(attempt.status)) {
    const initialPending = prior?.status === 'SIGNED';
    if (outcome.status !== 'OUTCOME_PENDING' || outcome.source !== 'WALLET'
      || !digestMatches || !refsMatch || attempt.details.source !== 'WALLET'
      || attempt.details.signedAt !== outcome.signedAt
      || attempt.details.firstSeenAt !== outcome.firstSeenAt
      || attempt.details.broadcastAt !== outcome.broadcastAt
      || attempt.details.at !== outcome.observedAt
      || attempt.observedAt !== outcome.observedAt
      || (initialPending
        ? outcome.broadcastAt !== null || outcome.firstSeenAt !== outcome.observedAt
        : attempt.status === 'BROADCAST_ACCEPTED'
          ? outcome.broadcastAt !== outcome.observedAt
          : outcome.broadcastAt !== null && outcome.broadcastAt > outcome.observedAt)) {
      fail('MAKER_V8_PUBLICATION_ATTEMPT_BINDING_INVALID', 'Wallet pending event does not match exact durable bytes and query-first timing.');
    }
  } else if (attempt.status === 'FINALIZED_FAILURE') {
    const failureCursor = outcome.status === 'FINALIZED_FAILURE';
    const rebuiltReady = outcome.status === 'READY';
    const sourceMatches = attempt.details.source === (attempt.fullTransactionRef === null
      ? 'EXTERNAL_FINALIZED' : 'WALLET');
    if ((!failureCursor && !rebuiltReady) || !sourceMatches
      || (failureCursor && (!digestMatches || !refsMatch
        || attempt.details.signedAt !== outcome.signedAt
        || attempt.details.firstSeenAt !== outcome.firstSeenAt
        || attempt.details.broadcastAt !== outcome.broadcastAt
        || attempt.details.at !== outcome.observedAt
        || attempt.observedAt !== outcome.observedAt
        || attempt.details.code !== outcome.failureCode))
      || (rebuiltReady && (currentAfter.fullTransactionRef !== null
        || currentAfter.signatureRef !== null))) {
      fail('MAKER_V8_PUBLICATION_ATTEMPT_BINDING_INVALID', 'Finalized failure does not bind the exact durable failure or its fresh READY rebuild boundary.');
    }
    if (!prior || (prior.status === 'EXTERNAL_PENDING') !== (attempt.fullTransactionRef === null)
      || !sameRef(prior.fullTransactionRef, attempt.fullTransactionRef)
      || !sameRef(prior.signatureRef, attempt.signatureRef)) {
      fail('MAKER_V8_PUBLICATION_ATTEMPT_BINDING_INVALID', 'Finalized-failure provenance differs from its pending predecessor.');
    }
  } else if (attempt.status === 'FINALIZED_SUCCESS') {
    fail('MAKER_V8_PUBLICATION_ATTEMPT_BINDING_INVALID', 'Finalized success requires the exact checkpoint append in the same CAS.');
  }
  return attempt;
}

function collectBlobRefs(value, refs = new Map()) {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectBlobRefs(entry, refs));
    return refs;
  }
  if (!plain(value)) return refs;
  const keys = Object.keys(value).sort();
  if (keys.length === 3 && keys[0] === 'byteLength' && keys[1] === 'encoding' && keys[2] === 'sha256') {
    validateRef(value, 'Exported publication blob');
    const prior = refs.get(value.sha256);
    if (prior && canonical(prior) !== canonical(value)) {
      fail('MAKER_V8_PUBLICATION_BLOB_COLLISION', 'Publication records bind conflicting refs for one content hash.');
    }
    refs.set(value.sha256, value);
    return refs;
  }
  Object.values(value).forEach((entry) => collectBlobRefs(entry, refs));
  return refs;
}

function validateAttemptHistory(attempts, plan) {
  if (attempts.length > MAKER_V8_PUBLICATION_HISTORY_LIMITS.maxAttemptEvents) {
    fail('MAKER_V8_PUBLICATION_HISTORY_LIMIT_EXCEEDED', 'Publication attempt history exceeds its derived durable event ceiling.', {
      count: attempts.length,
      maximum: MAKER_V8_PUBLICATION_HISTORY_LIMITS.maxAttemptEvents,
    });
  }
  const heads = new Map();
  let previousOrdinal = -1;
  let previousSequence = -1;
  let previousGlobal = null;
  let excessEvents = 0;
  let totalEvents = 0;
  for (const entry of attempts) {
    if (entry.ordinal < previousOrdinal
      || (entry.ordinal === previousOrdinal && entry.sequence !== previousSequence + 1)
      || (entry.ordinal > previousOrdinal && entry.sequence !== 0)) {
      fail('MAKER_V8_PUBLICATION_ATTEMPT_ORDER_INVALID', 'Publication attempts must use canonical ordinal and sequence order.');
    }
    if (entry.sequence >= MAKER_V8_PUBLICATION_HISTORY_LIMITS.maxEventsPerOrdinal) {
      fail('MAKER_V8_PUBLICATION_HISTORY_LIMIT_EXCEEDED', 'One publication ordinal exceeds its bounded retry-event ceiling.', {
        ordinal: entry.ordinal,
        maximum: MAKER_V8_PUBLICATION_HISTORY_LIMITS.maxEventsPerOrdinal,
      });
    }
    validateAttempt(entry, plan);
    if (entry.previousGlobalAttemptSha256 !== (previousGlobal?.eventSha256 ?? null)) {
      fail('MAKER_V8_PUBLICATION_ATTEMPT_GLOBAL_CHAIN_INVALID', 'Publication attempt event does not extend the exact global rolling history anchor.');
    }
    const key = String(entry.ordinal);
    const prior = heads.get(key);
    assertAttemptTransition(prior, entry);
    if (excessAttemptEvent(entry)) excessEvents += 1;
    totalEvents += 1;
    assertMakerV8PublicationHistoryReserveV8({ totalEvents, excessEvents }, entry);
    heads.set(key, entry);
    previousOrdinal = entry.ordinal;
    previousSequence = entry.sequence;
    previousGlobal = entry;
  }
  return { heads, excessEvents };
}

function attemptHeadRecord(attempt) {
  return {
    attemptId: attempt.attemptId,
    ordinal: attempt.ordinal,
    sequence: attempt.sequence,
    status: attempt.status,
    digest: attempt.digest,
    kindSha256: attempt.kindSha256,
    fullTransactionRef: attempt.fullTransactionRef,
    signatureRef: attempt.signatureRef,
    details: attempt.details,
    observedAt: attempt.observedAt,
    previousAttemptSha256: attempt.previousAttemptSha256,
    previousGlobalAttemptSha256: attempt.previousGlobalAttemptSha256,
    eventSha256: attempt.eventSha256,
  };
}

function validateBundleClosure(plan, checkpoints, attempts) {
  if (checkpoints.length > MAKER_V8_PUBLICATION_HISTORY_LIMITS.maxCheckpoints) {
    fail('MAKER_V8_PUBLICATION_HISTORY_LIMIT_EXCEEDED', 'Publication checkpoint prefix exceeds the compiler-derived durable ceiling.', {
      count: checkpoints.length,
      maximum: MAKER_V8_PUBLICATION_HISTORY_LIMITS.maxCheckpoints,
    });
  }
  validateTopologyClosure(plan, checkpoints);
  const { heads, excessEvents } = validateAttemptHistory(attempts, plan);
  if (attempts.length) {
    assertMakerV8PublicationHistoryReserveV8(plan.attemptHistory, attempts.at(-1));
  }
  if (plan.attemptHistory.totalEvents !== attempts.length
    || plan.attemptHistory.excessEvents !== excessEvents
    || plan.attemptHistory.globalAttemptHeadSha256 !== (attempts.at(-1)?.eventSha256 ?? null)) {
    fail('MAKER_V8_PUBLICATION_ATTEMPT_GLOBAL_CHAIN_INVALID', 'Publication plan does not bind the exact global append-only attempt history.');
  }
  const eventsByOrdinal = new Map();
  for (const entry of attempts) {
    const entries = eventsByOrdinal.get(entry.ordinal) ?? [];
    entries.push(entry);
    eventsByOrdinal.set(entry.ordinal, entries);
  }
  const maximumOrdinal = plan.current?.ordinal ?? plan.head?.ordinal ?? 0;
  if ([...heads.keys()].some((ordinal) => Number(ordinal) > maximumOrdinal)) {
    fail('MAKER_V8_PUBLICATION_ATTEMPT_BINDING_INVALID', 'Attempt history contains an ordinal outside the durable cursor.');
  }
  for (const checkpoint of checkpoints) {
    validateCompilerTargets(checkpoint, plan, 'Finalized publication checkpoint');
    const entries = eventsByOrdinal.get(checkpoint.ordinal) ?? [];
    const successes = entries.filter((entry) => entry.status === 'FINALIZED_SUCCESS');
    const success = successes[0];
    if (successes.length !== 1 || heads.get(String(checkpoint.ordinal)) !== success) {
      fail('MAKER_V8_PUBLICATION_ATTEMPT_BINDING_INVALID', 'Each finalized checkpoint requires exactly one matching terminal success attempt.');
    }
    assertAttemptBindsDurableState({
      attempt: success,
      prior: entries.find((entry) => entry.sequence === success.sequence - 1) ?? null,
      checkpoint,
      updatedAt: checkpoint.finalizedAt,
      previousUpdatedAt: checkpoint.ordinal === 0
        ? plan.createdAt : checkpoints[checkpoint.ordinal - 1].finalizedAt,
    });
    const lowerBound = checkpoint.ordinal === 0
      ? plan.createdAt : checkpoints[checkpoint.ordinal - 1].finalizedAt;
    if (entries.some((entry) => entry.details.at < lowerBound
      || entry.observedAt < lowerBound)) {
      fail('MAKER_V8_PUBLICATION_CLOCK_REGRESSION', 'Checkpoint attempt history predates its prior durable publication boundary.');
    }
  }
  if (plan.current) {
    const head = heads.get(String(plan.current.ordinal));
    if (!head && plan.current.outcome.status !== 'READY') {
      fail('MAKER_V8_PUBLICATION_ATTEMPT_BINDING_INVALID', 'Current publication outcome differs from its append-only attempt head.');
    }
    if (head) {
      const entries = eventsByOrdinal.get(plan.current.ordinal) ?? [];
      assertAttemptBindsDurableState({
        attempt: head,
        prior: entries.find((entry) => entry.sequence === head.sequence - 1) ?? null,
        currentAfter: plan.current,
        updatedAt: plan.updatedAt,
        previousUpdatedAt: checkpoints.at(-1)?.finalizedAt ?? plan.createdAt,
      });
      const lowerBound = checkpoints.at(-1)?.finalizedAt ?? plan.createdAt;
      if (entries.some((entry) => entry.details.at < lowerBound
        || entry.observedAt < lowerBound)) {
        fail('MAKER_V8_PUBLICATION_CLOCK_REGRESSION', 'Current attempt history predates the finalized publication head.');
      }
    }
  }
  return heads;
}

function assertFinalActivationPlanState(plan, checkpoint) {
  const topology = checkpoint ? validateTopologyEntry(checkpoint, 'Durable publication head') : null;
  const finalized = topology?.kind === 'ACTIVATION_CHUNK'
    && topology.phase === 'ACTIVATION_FINALIZE' && topology.final === true;
  if (finalized) {
    if (plan.status !== 'COMPLETE' || plan.current !== null
      || plan.nextPreparation !== null || plan.terminal?.status !== 'COMPLETE') {
      fail('MAKER_V8_PUBLICATION_TOPOLOGY_INVALID', 'Final Activation head permits only the exact COMPLETE terminal plan state.');
    }
  } else if (plan.status === 'COMPLETE') {
    fail('MAKER_V8_PUBLICATION_TOPOLOGY_INVALID', 'Complete publication requires the exact final Activation checkpoint head.');
  }
  return topology;
}

function validateTopologyClosure(plan, checkpoints) {
  let previous = null;
  let previousTopology = null;
  for (const [ordinal, checkpoint] of checkpoints.entries()) {
    if (checkpoint.ordinal !== ordinal) {
      fail('MAKER_V8_PUBLICATION_TOPOLOGY_INVALID', 'Finalized checkpoint topology is not a contiguous ordinal prefix.');
    }
    if (checkpoint.finalizedAt < (previous?.finalizedAt ?? plan.createdAt)
      || checkpoint.finalizedAt > plan.updatedAt) {
      fail('MAKER_V8_PUBLICATION_CLOCK_REGRESSION', 'Finalized checkpoint time is outside the monotonic durable plan timeline.');
    }
    previousTopology = validateTopologyTransition(previous, checkpoint, `Finalized checkpoint ${ordinal}`);
    previous = checkpoint;
  }
  if (plan.current) validateTopologyTransition(previous, plan.current, 'Current publication transaction');
  assertFinalActivationPlanState(plan, previous);
  return previousTopology;
}

/**
 * Integrity-checked, inert browser persistence only. A successful load/import
 * never authorizes signing, broadcasting, or finalized certification. The
 * publication controller must deterministically rehydrate the pinned compiler
 * from the immutable context/document blobs, compare exact TransactionKind
 * bytes, and independently verify TransactionData, sender, digest, and
 * signature before any execution boundary.
 */
export function createMakerV8PublicationPersistenceV8(
  indexedDB = globalThis.indexedDB,
  { storageManager = globalThis.navigator?.storage, databaseName = MAKER_V8_PUBLICATION_DATABASE } = {},
) {
  if (!indexedDB || typeof indexedDB.open !== 'function') {
    fail('MAKER_V8_PUBLICATION_INDEXEDDB_REQUIRED', 'IndexedDB is required for durable Maker v8 publication.');
  }
  let databasePromise;
  let closed = false;
  let persistentStorageGranted = false;
  const open = () => {
    if (databasePromise && !closed) return databasePromise;
    closed = false;
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName, DATABASE_VERSION);
      let settled = false;
      let blocked = false;
      request.onupgradeneeded = () => {
        const database = request.result;
        const plans = database.createObjectStore(PLAN_STORE, { keyPath: 'attemptId' });
        plans.createIndex('byScope', 'scopeKey', { unique: false });
        plans.createIndex('byScopeStatus', ['scopeKey', 'status'], { unique: false });
        plans.createIndex('byStatus', 'status', { unique: false });
        database.createObjectStore(ACTIVE_STORE, { keyPath: 'scopeKey' });
        const checkpoints = database.createObjectStore(
          CHECKPOINT_STORE,
          { keyPath: ['attemptId', 'ordinal'] },
        );
        checkpoints.createIndex('byAttempt', 'attemptId', { unique: false });
        const attempts = database.createObjectStore(
          ATTEMPT_STORE,
          { keyPath: ['attemptId', 'ordinal', 'sequence'] },
        );
        attempts.createIndex('byAttempt', 'attemptId', { unique: false });
        attempts.createIndex('byOrdinal', ['attemptId', 'ordinal'], { unique: false });
        const attemptHeads = database.createObjectStore(
          ATTEMPT_HEAD_STORE,
          { keyPath: ['attemptId', 'ordinal'] },
        );
        attemptHeads.createIndex('byAttempt', 'attemptId', { unique: false });
        database.createObjectStore(USED_ATTEMPT_STORE, { keyPath: 'attemptId' });
        database.createObjectStore(BLOB_STORE, { keyPath: 'sha256' });
      };
      request.onsuccess = () => {
        const database = request.result;
        if (blocked || settled) {
          database.close();
          return;
        }
        settled = true;
        database.onversionchange = () => {
          closed = true;
          database.close();
          databasePromise = null;
        };
        resolve(database);
      };
      request.onerror = () => {
        if (settled) return;
        settled = true;
        reject(storageError(request.error, 'Unable to open durable publication storage.'));
      };
      request.onblocked = () => {
        blocked = true;
        if (settled) return;
        settled = true;
        reject(storageError(
          typeof DOMException === 'function'
            ? new DOMException('blocked', 'InvalidStateError')
            : Object.assign(new Error('blocked'), { name: 'InvalidStateError' }),
          'Durable publication storage upgrade is blocked by another tab.',
        ));
      };
    });
    return databasePromise;
  };

  const transact = async (stores, mode, operation) => {
    try {
      const database = await open();
      const transaction = mode === 'readwrite'
        ? database.transaction(stores, mode, { durability: 'strict' })
        : database.transaction(stores, mode);
      if (mode === 'readwrite' && transaction.durability !== 'strict') {
        try { transaction.abort(); } catch {}
        fail('MAKER_V8_PUBLICATION_STRICT_DURABILITY_REQUIRED', 'Browser IndexedDB did not honor strict durability for a publication WAL mutation.');
      }
      const completion = transactionDone(transaction);
      try {
        const result = await operation(transaction);
        await completion;
        return result;
      } catch (error) {
        try { transaction.abort(); } catch {}
        await completion.catch(() => {});
        throw error;
      }
    } catch (error) {
      if (error?.name === 'InvalidStateError'
        || error?.code === 'MAKER_V8_PUBLICATION_STORAGE_VERSION_CHANGED') {
        closed = true;
        databasePromise = null;
      }
      throw storageError(error, 'Durable publication storage transaction failed.');
    }
  };

  const addBlobs = async (store, blobs) => {
    for (const [index, blob] of blobs.entries()) {
      assertBlobSync(blob, `Publication blob[${index}]`);
      const existing = await requestResult(store.get(blob.sha256));
      if (existing && canonical(existing) !== canonical(blob)) {
        fail('MAKER_V8_PUBLICATION_BLOB_COLLISION', 'Content-addressed publication blob collides with different bytes.');
      }
      if (!existing) await requestResult(store.add(clone(blob)));
    }
  };

  const collectTransactionDescriptors = (value, descriptors = []) => {
    if (Array.isArray(value)) {
      value.forEach((entry) => collectTransactionDescriptors(entry, descriptors));
      return descriptors;
    }
    if (!plain(value)) return descriptors;
    if (Object.hasOwn(value, 'transactionKindRef')
      && Object.hasOwn(value, 'transactionKindSha256')
      && Object.hasOwn(value, 'commandCount') && Object.hasOwn(value, 'targets')) {
      descriptors.push(value);
    }
    Object.values(value).forEach((entry) => collectTransactionDescriptors(entry, descriptors));
    return descriptors;
  };

  const assertTransactionKindDescriptor = (descriptor, blob, plan) => {
    validateCompilerTargets(descriptor, plan, 'Durable TransactionKind descriptor');
    if (blob.encoding !== 'BASE64' || blob.byteLength > MAKER_V8_TRANSACTION_LIMITS.maxKindBytes) {
      fail('MAKER_V8_PUBLICATION_TRANSACTION_KIND_INVALID', 'Durable TransactionKind bytes have an invalid encoding or exceed the pinned byte limit.');
    }
    let bytes;
    let parsed;
    let roundTrip;
    try {
      bytes = fromBase64(blob.data);
      parsed = bcs.TransactionKind.parse(bytes);
      roundTrip = bcs.TransactionKind.serialize(parsed).toBytes();
    } catch {
      fail('MAKER_V8_PUBLICATION_TRANSACTION_KIND_INVALID', 'Pinned SDK could not canonically parse the durable TransactionKind bytes.');
    }
    if (roundTrip.length !== bytes.length
      || roundTrip.some((byte, index) => byte !== bytes[index])
      || parsed?.$kind !== 'ProgrammableTransaction'
      || !Array.isArray(parsed.ProgrammableTransaction?.inputs)
      || !Array.isArray(parsed.ProgrammableTransaction?.commands)
      || parsed.ProgrammableTransaction.inputs.length > MAKER_V8_TRANSACTION_LIMITS.maxInputs
      || parsed.ProgrammableTransaction.commands.length > MAKER_V8_TRANSACTION_LIMITS.maxCommands) {
      fail('MAKER_V8_PUBLICATION_TRANSACTION_KIND_INVALID', 'Durable TransactionKind is not one canonical bounded ProgrammableTransaction.');
    }
    const targets = [];
    for (const command of parsed.ProgrammableTransaction.commands) {
      if (command?.$kind !== 'MoveCall' || !plain(command.MoveCall)) {
        fail('MAKER_V8_PUBLICATION_TRANSACTION_KIND_COMMAND_INVALID', 'Publication TransactionKind may contain only exact compiler MoveCall commands.');
      }
      const call = command.MoveCall;
      targets.push(`${call.package}::${call.module}::${call.function}`);
    }
    if (targets.length !== descriptor.commandCount
      || canonical(targets) !== canonical(descriptor.targets)) {
      fail('MAKER_V8_PUBLICATION_TRANSACTION_KIND_TARGET_DRIFT', 'TransactionKind command projection differs from the durable command count or target sequence.');
    }
  };

  const ensureRefs = async (transaction, values, plan = null) => {
    const refs = collectBlobRefs(values);
    const store = transaction.objectStore(BLOB_STORE);
    const blobs = new Map();
    for (const ref of refs.values()) {
      const blob = await requestResult(store.get(ref.sha256));
      if (!blob) fail('MAKER_V8_PUBLICATION_BLOB_MISSING', 'Atomic publication state would contain a dangling content reference.');
      assertBlobSync(blob, 'Referenced publication blob');
      if (blob.byteLength !== ref.byteLength || blob.encoding !== ref.encoding) {
        fail('MAKER_V8_PUBLICATION_BLOB_HASH_MISMATCH', 'Atomic publication blob metadata differs from its durable reference.');
      }
      blobs.set(ref.sha256, blob);
    }
    for (const descriptor of collectTransactionDescriptors(values)) {
      const blob = blobs.get(descriptor.transactionKindRef.sha256);
      if (!blob) {
        fail('MAKER_V8_PUBLICATION_BLOB_MISSING', 'Durable TransactionKind descriptor has no content-addressed bytes.');
      }
      assertTransactionKindDescriptor(descriptor, blob, plan);
    }
  };

  const checkedGlobalAttemptHistory = async (transaction, plan) => {
    const attempts = transaction.objectStore(ATTEMPT_STORE);
    const byAttempt = attempts.index('byAttempt');
    const attemptHeads = transaction.objectStore(ATTEMPT_HEAD_STORE).index('byAttempt');
    const [count, firstCursor, lastCursor, headCount, firstHeadCursor, lastHeadCursor] = await Promise.all([
      requestResult(byAttempt.count(plan.attemptId)),
      requestResult(byAttempt.openCursor(plan.attemptId, 'next')),
      requestResult(byAttempt.openCursor(plan.attemptId, 'prev')),
      requestResult(attemptHeads.count(plan.attemptId)),
      requestResult(attemptHeads.openKeyCursor(plan.attemptId, 'next')),
      requestResult(attemptHeads.openKeyCursor(plan.attemptId, 'prev')),
    ]);
    if (count !== plan.attemptHistory.totalEvents
      || count > MAKER_V8_PUBLICATION_HISTORY_LIMITS.maxAttemptEvents) {
      fail('MAKER_V8_PUBLICATION_ATTEMPT_GLOBAL_CHAIN_INVALID', 'Global attempt-history count differs from its durable plan anchor.', {
        count,
        expected: plan.attemptHistory.totalEvents,
        maximum: MAKER_V8_PUBLICATION_HISTORY_LIMITS.maxAttemptEvents,
      });
    }
    if (count === 0) {
      if (firstCursor || lastCursor || headCount !== 0 || firstHeadCursor || lastHeadCursor
        || plan.attemptHistory.globalAttemptHeadSha256 !== null) {
        fail('MAKER_V8_PUBLICATION_ATTEMPT_GLOBAL_CHAIN_INVALID', 'Empty global attempt history has a non-empty tail anchor.');
      }
      return null;
    }
    const first = firstCursor?.value;
    const tail = lastCursor?.value;
    const expectedOrdinalHeads = tail?.ordinal + 1;
    if (!first || !tail || first.ordinal !== 0 || first.sequence !== 0
      || first.previousGlobalAttemptSha256 !== null
      || tail.eventSha256 !== plan.attemptHistory.globalAttemptHeadSha256
      || headCount !== expectedOrdinalHeads
      || firstHeadCursor?.primaryKey?.[1] !== 0
      || lastHeadCursor?.primaryKey?.[1] !== tail.ordinal) {
      fail('MAKER_V8_PUBLICATION_ATTEMPT_GLOBAL_CHAIN_INVALID', 'Global attempt-history first/tail records differ from the durable rolling anchor.');
    }
    validateAttempt(first, plan);
    validateAttempt(tail, plan);
    const tailHead = await requestResult(
      transaction.objectStore(ATTEMPT_HEAD_STORE).get([plan.attemptId, tail.ordinal]),
    );
    if (!tailHead || canonical(tailHead) !== canonical(attemptHeadRecord(tail))) {
      fail('MAKER_V8_PUBLICATION_ATTEMPT_HEAD_DRIFT', 'Global attempt-history tail differs from its derived ordinal head.');
    }
    let predecessor = null;
    if (count > 1) {
      if (tail.sequence > 0) {
        predecessor = await requestResult(attempts.get([
          plan.attemptId, tail.ordinal, tail.sequence - 1,
        ]));
      } else {
        const priorHead = await requestResult(
          transaction.objectStore(ATTEMPT_HEAD_STORE).get([plan.attemptId, tail.ordinal - 1]),
        );
        if (priorHead) {
          predecessor = await requestResult(attempts.get([
            plan.attemptId, tail.ordinal - 1, priorHead.sequence,
          ]));
          if (!predecessor || canonical(priorHead) !== canonical(attemptHeadRecord(predecessor))) {
            fail('MAKER_V8_PUBLICATION_ATTEMPT_HEAD_DRIFT', 'Global attempt predecessor differs from its derived ordinal head.');
          }
        }
      }
      if (!predecessor || tail.previousGlobalAttemptSha256 !== predecessor.eventSha256) {
        fail('MAKER_V8_PUBLICATION_ATTEMPT_GLOBAL_CHAIN_INVALID', 'Global attempt-history tail does not extend its exact predecessor event.');
      }
      validateAttempt(predecessor, plan);
    }
    assertMakerV8PublicationHistoryReserveV8(plan.attemptHistory, tail);
    await ensureRefs(transaction, [first, predecessor, tail], plan);
    return tail;
  };

  const checkedAttemptHead = async (transaction, plan, ordinal) => {
    const heads = transaction.objectStore(ATTEMPT_HEAD_STORE);
    const attempts = transaction.objectStore(ATTEMPT_STORE);
    const byOrdinal = attempts.index('byOrdinal');
    const cached = await requestResult(heads.get([plan.attemptId, ordinal]));
    if (!cached) {
      if (await requestResult(byOrdinal.count([plan.attemptId, ordinal])) !== 0) {
        fail('MAKER_V8_PUBLICATION_ATTEMPT_HEAD_DRIFT', 'Append-only attempt history exists without its derived head.');
      }
      return null;
    }
    const [eventCount, firstCursor, lastCursor] = await Promise.all([
      requestResult(byOrdinal.count([plan.attemptId, ordinal])),
      requestResult(byOrdinal.openKeyCursor([plan.attemptId, ordinal], 'next')),
      requestResult(byOrdinal.openKeyCursor([plan.attemptId, ordinal], 'prev')),
    ]);
    if (eventCount > MAKER_V8_PUBLICATION_HISTORY_LIMITS.maxEventsPerOrdinal) {
      fail('MAKER_V8_PUBLICATION_HISTORY_LIMIT_EXCEEDED', 'Publication ordinal exceeds its bounded retry-event ceiling.', {
        ordinal,
        count: eventCount,
        maximum: MAKER_V8_PUBLICATION_HISTORY_LIMITS.maxEventsPerOrdinal,
      });
    }
    if (eventCount !== cached.sequence + 1
      || firstCursor?.primaryKey?.[2] !== 0
      || lastCursor?.primaryKey?.[2] !== cached.sequence) {
      fail('MAKER_V8_PUBLICATION_ATTEMPT_HEAD_DRIFT', 'Derived attempt head does not cover one exact contiguous local event-key range.');
    }
    const durable = await requestResult(attempts.get([
      plan.attemptId, ordinal, cached.sequence,
    ]));
    const prior = cached.sequence === 0 ? null : await requestResult(attempts.get([
      plan.attemptId, ordinal, cached.sequence - 1,
    ]));
    const first = cached.sequence > 1 ? await requestResult(attempts.get([
      plan.attemptId, ordinal, 0,
    ])) : null;
    if (!durable || (cached.sequence > 0 && !prior)) {
      fail('MAKER_V8_PUBLICATION_ATTEMPT_HEAD_DRIFT', 'Derived attempt head or its exact predecessor event is absent.');
    }
    if (await requestResult(attempts.get([plan.attemptId, ordinal, cached.sequence + 1]))) {
      fail('MAKER_V8_PUBLICATION_ATTEMPT_HEAD_DRIFT', 'Derived attempt head is stale relative to its immediate successor event.');
    }
    validateAttempt(durable, plan);
    if (prior) validateAttempt(prior, plan);
    if (cached.sequence > 1) {
      if (!first || first.sequence !== 0 || first.previousAttemptSha256 !== null) {
        fail('MAKER_V8_PUBLICATION_ATTEMPT_HEAD_DRIFT', 'Derived attempt head has no canonical sequence-zero prefix anchor.');
      }
      validateAttempt(first, plan);
      assertAttemptTransition(null, first);
    }
    assertAttemptTransition(prior, durable);
    if (canonical(cached) !== canonical(attemptHeadRecord(durable))) {
      fail('MAKER_V8_PUBLICATION_ATTEMPT_HEAD_DRIFT', 'Derived attempt head differs from the complete contiguous append-only attempt history.');
    }
    await ensureRefs(transaction, [durable, prior], plan);
    return durable;
  };

  const checkedPlanHead = async (transaction, plan) => {
    const checkpoints = transaction.objectStore(CHECKPOINT_STORE);
    const byAttempt = checkpoints.index('byAttempt');
    if (!plan.head) {
      if (await requestResult(byAttempt.count(plan.attemptId)) !== 0) {
        fail('MAKER_V8_PUBLICATION_HEAD_DRIFT', 'Headless publication hides an append-only ordinal-zero checkpoint.');
      }
      return { checkpoint: null, predecessor: null };
    }
    const [checkpointCount, firstCursor, lastCursor] = await Promise.all([
      requestResult(byAttempt.count(plan.attemptId)),
      requestResult(byAttempt.openKeyCursor(plan.attemptId, 'next')),
      requestResult(byAttempt.openKeyCursor(plan.attemptId, 'prev')),
    ]);
    if (checkpointCount > MAKER_V8_PUBLICATION_HISTORY_LIMITS.maxCheckpoints) {
      fail('MAKER_V8_PUBLICATION_HISTORY_LIMIT_EXCEEDED', 'Publication checkpoint prefix exceeds the compiler-derived durable ceiling.', {
        count: checkpointCount,
        maximum: MAKER_V8_PUBLICATION_HISTORY_LIMITS.maxCheckpoints,
      });
    }
    if (checkpointCount !== plan.head.ordinal + 1
      || firstCursor?.primaryKey?.[1] !== 0
      || lastCursor?.primaryKey?.[1] !== plan.head.ordinal) {
      fail('MAKER_V8_PUBLICATION_HEAD_DRIFT', 'Publication head does not cover one exact contiguous checkpoint-key prefix.');
    }
    const checkpoint = await requestResult(checkpoints.get([plan.attemptId, plan.head.ordinal]));
    if (await requestResult(checkpoints.get([plan.attemptId, plan.head.ordinal + 1]))) {
      fail('MAKER_V8_PUBLICATION_HEAD_DRIFT', 'Publication head is stale relative to its immediate checkpoint successor.');
    }
    if (!checkpoint || checkpoint.attemptId !== plan.attemptId || checkpoint.planId !== plan.planId
      || checkpoint.ordinal !== plan.head.ordinal
      || checkpoint.checkpointSha256 !== plan.head.checkpointSha256
      || checkpoint.digest !== plan.head.digest
      || checkpoint.transactionKindSha256 !== plan.head.transactionKindSha256
      || checkpoint.phase !== plan.head.phase || checkpoint.lane !== plan.head.lane
      || checkpoint.finalizedAt > plan.updatedAt
      || checkpointSha256Sync(checkpoint) !== checkpoint.checkpointSha256) {
      fail('MAKER_V8_PUBLICATION_HEAD_DRIFT', 'Publication head differs from its exact append-only checkpoint.');
    }
    assertMakerV8PublicationCheckpointV8(checkpoint);
    let predecessor = null;
    if (checkpoint.ordinal === 0) {
      if (checkpoint.previousCheckpointSha256 !== null
        || checkpoint.finalizedAt < plan.createdAt) {
        fail('MAKER_V8_PUBLICATION_HEAD_DRIFT', 'Ordinal-zero publication head has a predecessor hash.');
      }
    } else {
      predecessor = await requestResult(checkpoints.get([plan.attemptId, checkpoint.ordinal - 1]));
      if (!predecessor || predecessor.attemptId !== plan.attemptId
        || predecessor.planId !== plan.planId || predecessor.ordinal !== checkpoint.ordinal - 1
        || checkpointSha256Sync(predecessor) !== predecessor.checkpointSha256
        || checkpoint.previousCheckpointSha256 !== predecessor.checkpointSha256
        || checkpoint.finalizedAt < predecessor.finalizedAt) {
        fail('MAKER_V8_PUBLICATION_HEAD_DRIFT', 'Publication head does not extend its exact predecessor checkpoint.');
      }
      assertMakerV8PublicationCheckpointV8(predecessor);
    }
    validateTopologyTransition(predecessor, checkpoint, 'Durable publication head');
    await ensureRefs(transaction, [checkpoint, predecessor], plan);
    return { checkpoint, predecessor };
  };

  const validatePlanAnchor = async (transaction, plan) => {
    await checkedGlobalAttemptHistory(transaction, plan);
    const { checkpoint, predecessor } = await checkedPlanHead(transaction, plan);
    if (plan.current) validateTopologyTransition(checkpoint, plan.current, 'Durable publication current');
    assertFinalActivationPlanState(plan, checkpoint);
    if (plan.nextPreparation !== null && checkpoint === null) {
      fail('MAKER_V8_PUBLICATION_TOPOLOGY_INVALID', 'Successor-preparation state has no finalized publication head.');
    }
    if (checkpoint) {
      const attempt = await checkedAttemptHead(transaction, plan, checkpoint.ordinal);
      const prior = attempt?.sequence > 0
        ? await requestResult(transaction.objectStore(ATTEMPT_STORE).get([
          plan.attemptId, checkpoint.ordinal, attempt.sequence - 1,
        ])) : null;
      assertAttemptBindsDurableState({
        attempt,
        prior,
        checkpoint,
        updatedAt: plan.updatedAt,
        previousUpdatedAt: predecessor?.finalizedAt ?? plan.createdAt,
      });
    }
    if (plan.current) {
      const attempt = await checkedAttemptHead(transaction, plan, plan.current.ordinal);
      if (!attempt && plan.current.outcome.status !== 'READY') {
        fail('MAKER_V8_PUBLICATION_ATTEMPT_BINDING_INVALID', 'Durable current outcome has no append-only attempt event.');
      }
      if (attempt) {
        const prior = attempt.sequence > 0
          ? await requestResult(transaction.objectStore(ATTEMPT_STORE).get([
            plan.attemptId, plan.current.ordinal, attempt.sequence - 1,
          ])) : null;
        assertAttemptBindsDurableState({
          attempt,
          prior,
          currentAfter: plan.current,
          updatedAt: plan.updatedAt,
          previousUpdatedAt: checkpoint?.finalizedAt ?? plan.createdAt,
        });
      }
    }
    return checkpoint;
  };

  const validateActiveAnchor = async (transaction, plan) => {
    const index = await requestResult(transaction.objectStore(ACTIVE_STORE).get(plan.scopeKey));
    const activePlans = await requestResult(
      transaction.objectStore(PLAN_STORE).index('byScopeStatus').getAll([plan.scopeKey, 'ACTIVE']),
    );
    if (activePlans.length > 1) {
      fail('MAKER_V8_PUBLICATION_ACTIVE_INDEX_DRIFT', 'Multiple active plans occupy one canonical publication scope.');
    }
    for (const activePlan of activePlans) {
      assertPlanIdentitySync(activePlan);
      await ensureRefs(transaction, activePlan, activePlan);
      await validateUsedAttemptAnchor(transaction, activePlan);
    }
    if (plan.status === 'ACTIVE') {
      if (!index || activePlans.length !== 1 || activePlans[0].attemptId !== plan.attemptId) {
        fail('MAKER_V8_PUBLICATION_ACTIVE_INDEX_DRIFT', 'Active publication is missing its canonical active-scope index.');
      }
      assertActiveIndex(index, plan);
    } else if (index) {
      const [activePlan] = activePlans;
      if (!activePlan || activePlan.attemptId !== index.attemptId
        || index.attemptId === plan.attemptId) {
        fail('MAKER_V8_PUBLICATION_ACTIVE_INDEX_DRIFT', 'Terminal publication scope has an orphaned or self-referential active index.');
      }
      assertActiveIndex(index, activePlan);
    } else if (activePlans.length) {
      fail('MAKER_V8_PUBLICATION_ACTIVE_INDEX_DRIFT', 'Terminal publication scope hides another active plan without its index.');
    }
    return index;
  };

  const validateUsedAttemptAnchor = async (transaction, plan) => {
    const record = await requestResult(
      transaction.objectStore(USED_ATTEMPT_STORE).get(plan.attemptId),
    );
    if (!record) {
      fail('MAKER_V8_PUBLICATION_ATTEMPT_ID_REUSED', 'Durable publication plan lacks its permanent attempt identity record.');
    }
    assertUsedAttemptRecord(record, plan);
    return record;
  };

  const api = {
    async requirePersistentStorage() {
      if (typeof storageManager?.persisted !== 'function'
        || typeof storageManager?.persist !== 'function') {
        fail('MAKER_V8_PUBLICATION_PERSISTENCE_REQUIRED', 'Browser durable-storage capability is required before signing or broadcasting.');
      }
      let persisted;
      try {
        persisted = await storageManager.persisted();
        if (!persisted) persisted = await storageManager.persist();
      } catch (error) {
        throw storageError(error, 'Unable to establish persistent browser storage for publication signing.');
      }
      if (persisted !== true) {
        fail('MAKER_V8_PUBLICATION_PERSISTENCE_REQUIRED', 'Browser denied persistent storage; signing and broadcasting remain disabled.');
      }
      persistentStorageGranted = true;
      return Object.freeze({ persisted: true });
    },

    async preflightQuota(requiredBytes, reserveBytes = 1024 * 1024) {
      if (!Number.isSafeInteger(requiredBytes) || requiredBytes < 0
        || !Number.isSafeInteger(reserveBytes) || reserveBytes < 0) {
        fail('MAKER_V8_PUBLICATION_QUOTA_PREFLIGHT_INVALID', 'Publication quota preflight byte count is invalid.');
      }
      if (typeof storageManager?.estimate !== 'function') return Object.freeze({ available: null, requiredBytes });
      let estimate;
      try { estimate = await storageManager.estimate(); } catch (error) {
        throw storageError(error, 'Unable to estimate durable publication storage quota.');
      }
      const usage = Number(estimate?.usage);
      const quota = Number(estimate?.quota);
      if (!Number.isSafeInteger(usage) || usage < 0 || !Number.isSafeInteger(quota) || quota < usage) {
        fail('MAKER_V8_PUBLICATION_QUOTA_ESTIMATE_INVALID', 'Browser storage quota estimate is malformed.');
      }
      const available = quota - usage;
      if (available < requiredBytes + reserveBytes) {
        fail('MAKER_V8_PUBLICATION_STORAGE_QUOTA_EXCEEDED', 'Insufficient durable storage remains for the publication plan.', {
          requiredBytes, available, reserveBytes,
        });
      }
      return Object.freeze({ available, requiredBytes });
    },

    async collectOrphanedBlobs() {
      return transact([
        PLAN_STORE, ACTIVE_STORE, CHECKPOINT_STORE, ATTEMPT_STORE, ATTEMPT_HEAD_STORE,
        USED_ATTEMPT_STORE, BLOB_STORE,
      ], 'readwrite', async (transaction) => {
        const plans = await requestResult(transaction.objectStore(PLAN_STORE).getAll());
        const activeIndexes = await requestResult(transaction.objectStore(ACTIVE_STORE).getAll());
        const checkpoints = await requestResult(transaction.objectStore(CHECKPOINT_STORE).getAll());
        const attempts = await requestResult(transaction.objectStore(ATTEMPT_STORE).getAll());
        const cachedAttemptHeads = await requestResult(
          transaction.objectStore(ATTEMPT_HEAD_STORE).getAll(),
        );
        const usedAttempts = await requestResult(
          transaction.objectStore(USED_ATTEMPT_STORE).getAll(),
        );
        const blobs = await requestResult(transaction.objectStore(BLOB_STORE).getAll());
        const plansById = new Map();
        const checkpointsById = new Map();
        const attemptsById = new Map();
        const expectedAttemptHeads = new Map();
        const expectedActiveIndexes = new Map();
        const usedById = new Map();
        for (const used of usedAttempts) {
          if (usedById.has(used.attemptId)) {
            fail('MAKER_V8_PUBLICATION_GC_AUDIT_INVALID', 'Permanent attempt identity records contain a duplicate key.');
          }
          usedById.set(used.attemptId, used);
        }
        for (const plan of plans) {
          assertPlanIdentitySync(plan);
          if (plansById.has(plan.attemptId)) {
            fail('MAKER_V8_PUBLICATION_GC_AUDIT_INVALID', 'Durable publication plans contain a duplicate attempt identity.');
          }
          plansById.set(plan.attemptId, plan);
          const used = usedById.get(plan.attemptId);
          if (!used) {
            fail('MAKER_V8_PUBLICATION_GC_AUDIT_INVALID', 'Durable publication plan lacks its permanent attempt identity record.');
          }
          assertUsedAttemptRecord(used, plan);
        }
        for (const used of usedAttempts) {
          if (!plansById.has(used.attemptId)) assertDeletedAttemptRecord(used);
        }
        for (const checkpoint of checkpoints) {
          assertMakerV8PublicationCheckpointV8(checkpoint);
          if (!plansById.has(checkpoint.attemptId)
            || checkpointSha256Sync(checkpoint) !== checkpoint.checkpointSha256) {
            fail('MAKER_V8_PUBLICATION_GC_AUDIT_INVALID', 'Garbage collection found an orphaned or non-canonical checkpoint record.');
          }
          const entries = checkpointsById.get(checkpoint.attemptId) ?? [];
          entries.push(checkpoint);
          checkpointsById.set(checkpoint.attemptId, entries);
        }
        for (const attempt of attempts) {
          const plan = plansById.get(attempt.attemptId);
          if (!plan) {
            fail('MAKER_V8_PUBLICATION_GC_AUDIT_INVALID', 'Garbage collection found an orphaned transaction-attempt record.');
          }
          validateAttempt(attempt, plan);
          const entries = attemptsById.get(attempt.attemptId) ?? [];
          entries.push(attempt);
          attemptsById.set(attempt.attemptId, entries);
        }
        for (const plan of plans) {
          const planCheckpoints = (checkpointsById.get(plan.attemptId) ?? [])
            .sort((left, right) => left.ordinal - right.ordinal);
          const planAttempts = (attemptsById.get(plan.attemptId) ?? [])
            .sort((left, right) => left.ordinal - right.ordinal || left.sequence - right.sequence);
          let previous = null;
          for (const [ordinal, checkpoint] of planCheckpoints.entries()) {
            if (checkpoint.planId !== plan.planId || checkpoint.ordinal !== ordinal
              || checkpoint.previousCheckpointSha256 !== previous) {
              fail('MAKER_V8_PUBLICATION_GC_AUDIT_INVALID', 'Garbage collection found a broken checkpoint prefix.');
            }
            previous = checkpoint.checkpointSha256;
          }
          if ((plan.head?.checkpointSha256 ?? null) !== previous
            || (plan.head?.ordinal ?? -1) !== planCheckpoints.length - 1) {
            fail('MAKER_V8_PUBLICATION_GC_AUDIT_INVALID', 'Garbage collection found a plan head outside its checkpoint prefix.');
          }
          const derivedHeads = validateBundleClosure(plan, planCheckpoints, planAttempts);
          await ensureRefs(transaction, [plan, planCheckpoints, planAttempts], plan);
          for (const event of derivedHeads.values()) {
            expectedAttemptHeads.set(`${event.attemptId}:${event.ordinal}`, attemptHeadRecord(event));
          }
          if (plan.status === 'ACTIVE') {
            if (expectedActiveIndexes.has(plan.scopeKey)) {
              fail('MAKER_V8_PUBLICATION_GC_AUDIT_INVALID', 'Multiple active plans occupy one canonical publication scope.');
            }
            expectedActiveIndexes.set(plan.scopeKey, activeIndex(plan));
          }
        }
        if (cachedAttemptHeads.length !== expectedAttemptHeads.size) {
          fail('MAKER_V8_PUBLICATION_GC_AUDIT_INVALID', 'Derived attempt-head cache does not exactly cover append-only attempt histories.');
        }
        for (const cached of cachedAttemptHeads) {
          const expected = expectedAttemptHeads.get(`${cached.attemptId}:${cached.ordinal}`);
          if (!expected || canonical(cached) !== canonical(expected)) {
            fail('MAKER_V8_PUBLICATION_GC_AUDIT_INVALID', 'Derived attempt-head cache differs from its append-only source history.');
          }
        }
        if (activeIndexes.length !== expectedActiveIndexes.size) {
          fail('MAKER_V8_PUBLICATION_GC_AUDIT_INVALID', 'Active-scope index does not exactly cover all active publication plans.');
        }
        for (const index of activeIndexes) {
          const expected = expectedActiveIndexes.get(index.scopeKey);
          if (!expected || canonical(index) !== canonical(expected)) {
            fail('MAKER_V8_PUBLICATION_GC_AUDIT_INVALID', 'Active-scope index differs from its canonical active plan projection.');
          }
        }
        const refs = collectBlobRefs([plans, checkpoints, attempts]);
        const blobsByHash = new Map();
        for (const blob of blobs) {
          assertBlobSync(blob, 'Garbage-collection publication blob');
          blobsByHash.set(blob.sha256, blob);
        }
        for (const ref of refs.values()) {
          const blob = blobsByHash.get(ref.sha256);
          if (!blob || blob.byteLength !== ref.byteLength || blob.encoding !== ref.encoding) {
            fail('MAKER_V8_PUBLICATION_BLOB_MISSING', 'Garbage collection found a dangling durable blob reference.');
          }
        }
        let retained = 0;
        let deleted = 0;
        const blobStore = transaction.objectStore(BLOB_STORE);
        for (const blob of blobs) {
          if (refs.has(blob.sha256)) retained += 1;
          else {
            await requestResult(blobStore.delete(blob.sha256));
            deleted += 1;
          }
        }
        return Object.freeze({ scanned: blobs.length, retained, deleted });
      });
    },

    async createAttempt(planValue, blobs = []) {
      const plan = clone(planValue);
      await assertMakerV8PublicationPlanIdentityV8(plan);
      await Promise.all(blobs.map((blob, index) => assertBlob(blob, `Publication blob[${index}]`)));
      if (plan.revision !== 1 || plan.status !== 'ACTIVE' || plan.head !== null
        || plan.current?.ordinal !== 0 || plan.current.kind !== 'SCAFFOLD'
        || plan.current.outcome.status !== 'READY'
        || plan.current.fullTransactionRef !== null || plan.current.signatureRef !== null
        || plan.attemptHistory.totalEvents !== 0
        || plan.attemptHistory.excessEvents !== 0
        || plan.attemptHistory.globalAttemptHeadSha256 !== null
        || plan.nextPreparation !== null || plan.terminal !== null) {
        fail('MAKER_V8_PUBLICATION_PLAN_INVALID', 'A new publication attempt must begin as one exact unsigned ACTIVE Scaffold cursor.');
      }
      validateTopologyClosure(plan, []);
      return transact([
        PLAN_STORE, ACTIVE_STORE, USED_ATTEMPT_STORE, BLOB_STORE,
      ], 'readwrite', async (transaction) => {
        const plans = transaction.objectStore(PLAN_STORE);
        const active = transaction.objectStore(ACTIVE_STORE);
        const used = transaction.objectStore(USED_ATTEMPT_STORE);
        if (await requestResult(plans.get(plan.attemptId))) {
          fail('MAKER_V8_PUBLICATION_ATTEMPT_EXISTS', 'Publication attempt ID already exists.');
        }
        if (await requestResult(used.get(plan.attemptId))) {
          fail('MAKER_V8_PUBLICATION_ATTEMPT_ID_REUSED', 'Publication attempt ID was already consumed and cannot be recreated.');
        }
        const activePlans = await requestResult(
          plans.index('byScopeStatus').getAll([plan.scopeKey, 'ACTIVE']),
        );
        if (activePlans.length) {
          fail('MAKER_V8_PUBLICATION_SCOPE_ACTIVE', 'An active plan already occupies this canonical signer and maker scope.');
        }
        const existing = await requestResult(active.get(plan.scopeKey));
        if (existing) {
          fail('MAKER_V8_PUBLICATION_SCOPE_ACTIVE', 'This signer and maker key already have an active publication attempt.', {
            attemptId: existing.attemptId,
          });
        }
        await addBlobs(transaction.objectStore(BLOB_STORE), blobs);
        await ensureRefs(transaction, plan, plan);
        await requestResult(used.add(usedAttemptRecord(plan)));
        await requestResult(plans.add(plan));
        await requestResult(active.add(activeIndex(plan)));
        return clone(plan);
      });
    },

    async loadPlan(attemptId) {
      const plan = await transact([
        PLAN_STORE, ACTIVE_STORE, CHECKPOINT_STORE, ATTEMPT_STORE, ATTEMPT_HEAD_STORE,
        USED_ATTEMPT_STORE, BLOB_STORE,
      ], 'readonly', async (transaction) => {
        const value = await requestResult(transaction.objectStore(PLAN_STORE).get(attemptId));
        if (value == null) return null;
        assertMakerV8PublicationPlanV8(value);
        await ensureRefs(transaction, value, value);
        await validatePlanAnchor(transaction, value);
        await validateActiveAnchor(transaction, value);
        await validateUsedAttemptAnchor(transaction, value);
        return clone(value);
      });
      if (plan) await assertMakerV8PublicationPlanIdentityV8(plan);
      return plan;
    },

    async loadActive(scopeKey) {
      const plan = await transact([
        ACTIVE_STORE, PLAN_STORE, CHECKPOINT_STORE, ATTEMPT_STORE, ATTEMPT_HEAD_STORE,
        USED_ATTEMPT_STORE, BLOB_STORE,
      ], 'readonly', async (transaction) => {
        const index = await requestResult(transaction.objectStore(ACTIVE_STORE).get(scopeKey));
        const activePlans = await requestResult(
          transaction.objectStore(PLAN_STORE).index('byScopeStatus').getAll([scopeKey, 'ACTIVE']),
        );
        if (activePlans.length > 1 || (activePlans.length === 0) !== (index == null)) {
          fail('MAKER_V8_PUBLICATION_ACTIVE_INDEX_DRIFT', 'Active publication index differs from its plan.');
        }
        if (!activePlans.length) return null;
        const [plan] = activePlans;
        if (index.attemptId !== plan.attemptId) {
          fail('MAKER_V8_PUBLICATION_ACTIVE_INDEX_DRIFT', 'Active publication index points to another attempt.');
        }
        assertActiveIndex(index, plan);
        await ensureRefs(transaction, plan, plan);
        await validatePlanAnchor(transaction, plan);
        await validateUsedAttemptAnchor(transaction, plan);
        return clone(assertMakerV8PublicationPlanV8(plan));
      });
      if (plan) await assertMakerV8PublicationPlanIdentityV8(plan);
      return plan;
    },

    async listActive({ chainIdentifier, signerAddress } = {}) {
      const plans = await transact([
        ACTIVE_STORE, PLAN_STORE, CHECKPOINT_STORE, ATTEMPT_STORE, ATTEMPT_HEAD_STORE,
        USED_ATTEMPT_STORE, BLOB_STORE,
      ], 'readonly', async (transaction) => {
        const rows = await requestResult(transaction.objectStore(ACTIVE_STORE).getAll());
        const activePlans = await requestResult(
          transaction.objectStore(PLAN_STORE).index('byStatus').getAll('ACTIVE'),
        );
        const byScope = new Map();
        for (const plan of activePlans) {
          if (byScope.has(plan.scopeKey)) {
            fail('MAKER_V8_PUBLICATION_ACTIVE_INDEX_DRIFT', 'Multiple active plans occupy one canonical publication scope.');
          }
          byScope.set(plan.scopeKey, plan);
        }
        if (rows.length !== activePlans.length) {
          fail('MAKER_V8_PUBLICATION_ACTIVE_INDEX_DRIFT', 'Active-scope index does not exactly cover active publication plans.');
        }
        const plans = [];
        for (const row of rows) {
          const plan = byScope.get(row.scopeKey);
          if (!plan || row.attemptId !== plan.attemptId) {
            fail('MAKER_V8_PUBLICATION_ACTIVE_INDEX_DRIFT', 'Active publication index differs from its plan.');
          }
          assertActiveIndex(row, plan);
          if ((chainIdentifier != null && plan.immutable.chainIdentifier !== chainIdentifier)
            || (signerAddress != null && plan.immutable.signerAddress !== signerAddress)) continue;
          await ensureRefs(transaction, plan, plan);
          await validatePlanAnchor(transaction, plan);
          await validateUsedAttemptAnchor(transaction, plan);
          plans.push(clone(assertMakerV8PublicationPlanV8(plan)));
        }
        return plans;
      });
      await Promise.all(plans.map(assertMakerV8PublicationPlanIdentityV8));
      return plans;
    },

    async listAttemptsByScope(scopeKey) {
      const plans = await transact([
        PLAN_STORE, ACTIVE_STORE, CHECKPOINT_STORE, ATTEMPT_STORE, ATTEMPT_HEAD_STORE,
        USED_ATTEMPT_STORE, BLOB_STORE,
      ], 'readonly', async (transaction) => {
        const values = await requestResult(transaction.objectStore(PLAN_STORE).index('byScope').getAll(scopeKey));
        for (const value of values) {
          assertMakerV8PublicationPlanV8(value);
          await ensureRefs(transaction, value, value);
          await validatePlanAnchor(transaction, value);
          await validateActiveAnchor(transaction, value);
          await validateUsedAttemptAnchor(transaction, value);
        }
        return values;
      });
      plans.sort((left, right) => left.createdAt - right.createdAt
        || (left.attemptId < right.attemptId ? -1 : left.attemptId > right.attemptId ? 1 : 0));
      await Promise.all(plans.map(assertMakerV8PublicationPlanIdentityV8));
      return plans.map(clone);
    },

    async getBlob(sha256) {
      return transact([BLOB_STORE], 'readonly', async (transaction) => {
        const value = await requestResult(transaction.objectStore(BLOB_STORE).get(sha256));
        return value == null ? null : clone(assertBlobSync(value, 'Stored publication blob'));
      });
    },

    async loadCheckpoint(attemptId, ordinal) {
      const value = await transact([
        PLAN_STORE, ACTIVE_STORE, CHECKPOINT_STORE, ATTEMPT_STORE, ATTEMPT_HEAD_STORE,
        USED_ATTEMPT_STORE, BLOB_STORE,
      ], 'readonly', async (transaction) => {
        const plan = await requestResult(transaction.objectStore(PLAN_STORE).get(attemptId));
        if (!plan) return null;
        assertMakerV8PublicationPlanV8(plan);
        if (plan.head === null) return null;
        if (ordinal !== plan.head.ordinal) {
          fail('MAKER_V8_PUBLICATION_CHECKPOINT_NOT_HEAD', 'Public checkpoint reads are limited to the exact durable head anchor.');
        }
        const value = await requestResult(transaction.objectStore(CHECKPOINT_STORE).get([attemptId, ordinal]));
        if (value == null) return null;
        assertMakerV8PublicationCheckpointV8(value);
        if (value.attemptId !== plan.attemptId || value.planId !== plan.planId || value.ordinal !== ordinal) {
          fail('MAKER_V8_PUBLICATION_CHECKPOINT_SEQUENCE_INVALID', 'Stored checkpoint does not bind its exact plan and ordinal.');
        }
        let predecessor = null;
        if (ordinal === 0) {
          if (value.previousCheckpointSha256 !== null) {
            fail('MAKER_V8_PUBLICATION_CHECKPOINT_SEQUENCE_INVALID', 'Ordinal-zero checkpoint has a predecessor.');
          }
        } else {
          predecessor = await requestResult(
            transaction.objectStore(CHECKPOINT_STORE).get([attemptId, ordinal - 1]),
          );
          if (!predecessor || predecessor.attemptId !== plan.attemptId
            || predecessor.planId !== plan.planId || predecessor.ordinal !== ordinal - 1
            || checkpointSha256Sync(predecessor) !== predecessor.checkpointSha256
            || value.previousCheckpointSha256 !== predecessor.checkpointSha256) {
            fail('MAKER_V8_PUBLICATION_CHECKPOINT_SEQUENCE_INVALID', 'Stored checkpoint does not extend its exact predecessor.');
          }
          assertMakerV8PublicationCheckpointV8(predecessor);
        }
        validateTopologyTransition(predecessor, value, 'Stored publication checkpoint');
        const attempt = await checkedAttemptHead(transaction, plan, ordinal);
        const priorAttempt = attempt?.sequence > 0
          ? await requestResult(transaction.objectStore(ATTEMPT_STORE).get([
            attemptId, ordinal, attempt.sequence - 1,
          ])) : null;
        assertAttemptBindsDurableState({
          attempt, prior: priorAttempt, checkpoint: value, updatedAt: plan.updatedAt,
        });
        await ensureRefs(transaction, value, plan);
        await ensureRefs(transaction, predecessor, plan);
        await validatePlanAnchor(transaction, plan);
        await validateActiveAnchor(transaction, plan);
        await validateUsedAttemptAnchor(transaction, plan);
        return { plan: clone(plan), checkpoint: clone(value) };
      });
      if (!value) return null;
      await assertMakerV8PublicationPlanIdentityV8(value.plan);
      const checkpoint = value.checkpoint;
      if (checkpoint && await makerV8PublicationCheckpointSha256V8(checkpoint) !== checkpoint.checkpointSha256) {
        fail('MAKER_V8_PUBLICATION_CHECKPOINT_HASH_MISMATCH', 'Stored finalized checkpoint content differs from its canonical hash.');
      }
      return checkpoint;
    },

    async loadAttemptHead(attemptId, ordinal) {
      return transact([
        PLAN_STORE, ACTIVE_STORE, CHECKPOINT_STORE, ATTEMPT_STORE, ATTEMPT_HEAD_STORE,
        USED_ATTEMPT_STORE, BLOB_STORE,
      ], 'readonly', async (transaction) => {
        const plan = await requestResult(transaction.objectStore(PLAN_STORE).get(attemptId));
        if (!plan) return null;
        assertMakerV8PublicationPlanV8(plan);
        await ensureRefs(transaction, plan, plan);
        await validatePlanAnchor(transaction, plan);
        await validateActiveAnchor(transaction, plan);
        await validateUsedAttemptAnchor(transaction, plan);
        const allowed = ordinal === plan.current?.ordinal || ordinal === plan.head?.ordinal;
        if (!allowed) {
          fail('MAKER_V8_PUBLICATION_ATTEMPT_ORDINAL_UNAVAILABLE', 'Public attempt-head reads are limited to the durable current or finalized head ordinal.');
        }
        const value = await checkedAttemptHead(transaction, plan, ordinal);
        return value == null ? null : clone(value);
      });
    },

    async loadHead(attemptId) {
      const value = await transact([
        PLAN_STORE, ACTIVE_STORE, CHECKPOINT_STORE, ATTEMPT_STORE, ATTEMPT_HEAD_STORE,
        USED_ATTEMPT_STORE, BLOB_STORE,
      ], 'readonly', async (transaction) => {
        const plan = await requestResult(transaction.objectStore(PLAN_STORE).get(attemptId));
        if (!plan) return null;
        assertMakerV8PublicationPlanV8(plan);
        await ensureRefs(transaction, plan, plan);
        const checkpoint = await validatePlanAnchor(transaction, plan);
        await validateActiveAnchor(transaction, plan);
        await validateUsedAttemptAnchor(transaction, plan);
        return { plan: clone(plan), checkpoint: clone(checkpoint) };
      });
      if (!value) return null;
      await assertMakerV8PublicationPlanIdentityV8(value.plan);
      const checkpoint = value.checkpoint;
      if (!checkpoint) return null;
      if (await makerV8PublicationCheckpointSha256V8(checkpoint) !== checkpoint.checkpointSha256) {
        fail('MAKER_V8_PUBLICATION_CHECKPOINT_HASH_MISMATCH', 'Stored finalized checkpoint content differs from its canonical hash.');
      }
      return checkpoint;
    },

    async compareAndSwap(attemptId, expectedRevision, nextValue, {
      checkpoint = null, attempt = null, blobs = [], restoreToken = null,
    } = {}) {
      const next = clone(nextValue);
      await assertMakerV8PublicationPlanIdentityV8(next);
      await Promise.all(blobs.map((blob, index) => assertBlob(blob, `Publication blob[${index}]`)));
      const checkedCheckpoint = checkpoint == null
        ? null : clone(assertMakerV8PublicationCheckpointV8(checkpoint));
      const checkedAttemptValue = attempt == null
        ? null : clone(validateAttempt(attempt, next));
      if (checkedAttemptValue) {
        assertMakerV8PublicationHistoryReserveV8(next.attemptHistory, checkedAttemptValue);
      }
      if ((checkedCheckpoint || requiresPersistentEvidence(checkedAttemptValue))
        && !persistentStorageGranted) {
        fail('MAKER_V8_PUBLICATION_PERSISTENCE_REQUIRED', 'Persistent browser storage must be granted before durable signing, query, or finalized evidence is appended.');
      }
      if (checkedCheckpoint
        && await makerV8PublicationCheckpointSha256V8(checkedCheckpoint) !== checkedCheckpoint.checkpointSha256) {
        fail('MAKER_V8_PUBLICATION_CHECKPOINT_HASH_MISMATCH', 'Finalized checkpoint content differs from its canonical hash.');
      }
      return transact([
        PLAN_STORE, ACTIVE_STORE, CHECKPOINT_STORE, ATTEMPT_STORE, ATTEMPT_HEAD_STORE,
        USED_ATTEMPT_STORE, BLOB_STORE,
      ], 'readwrite', async (transaction) => {
        const plans = transaction.objectStore(PLAN_STORE);
        const active = transaction.objectStore(ACTIVE_STORE);
        const current = await requestResult(plans.get(attemptId));
        if (!current || current.revision !== expectedRevision) {
          fail('MAKER_V8_PUBLICATION_CAS_MISMATCH', 'Publication state changed in another tab.', {
            expectedRevision, actualRevision: current?.revision ?? null,
          });
        }
        assertMakerV8PublicationPlanV8(current);
        const used = await requestResult(
          transaction.objectStore(USED_ATTEMPT_STORE).get(current.attemptId),
        );
        if (!used) {
          fail('MAKER_V8_PUBLICATION_ATTEMPT_ID_REUSED', 'Publication attempt lacks its permanent identity tombstone.');
        }
        assertUsedAttemptRecord(used, current);
        await validateActiveAnchor(transaction, current);
        if (next.revision !== expectedRevision + 1 || !sameImmutable(current, next)) {
          fail('MAKER_V8_PUBLICATION_CAS_INVALID', 'Publication CAS changed immutable plan data or revision.');
        }
        const restoring = restoreToken === RESTORE_TOKEN;
        if (!PLAN_TRANSITIONS[current.status]?.has(next.status)
          || (current.status !== 'ACTIVE' && !restoring)) {
          fail('MAKER_V8_PUBLICATION_TRANSITION_INVALID', 'Publication status transition is not allowed.', {
            from: current.status, to: next.status,
          });
        }
        if (restoring && (current.status !== 'ABANDONED_RECOVERABLE' || next.status !== 'ACTIVE'
          || canonical(current.head) !== canonical(next.head)
          || canonical(current.current) !== canonical(next.current)
          || canonical(current.nextPreparation) !== canonical(next.nextPreparation)
          || next.terminal !== null)) {
          fail('MAKER_V8_PUBLICATION_RESTORE_INVALID', 'Only an exact abandoned plan can restore without changing its durable cursor.');
        }
        if (next.updatedAt < current.updatedAt) {
          fail('MAKER_V8_PUBLICATION_CLOCK_REGRESSION', 'Publication durable clock cannot move backwards.');
        }
        const priorCheckpoint = await validatePlanAnchor(transaction, current);
        if (checkedCheckpoint) {
          validateTopologyTransition(priorCheckpoint, checkedCheckpoint, 'Finalized publication checkpoint');
        }
        const nextPriorCheckpoint = checkedCheckpoint ?? priorCheckpoint;
        if (next.current) {
          validateTopologyTransition(nextPriorCheckpoint, next.current, 'Next publication transaction');
        }
        const priorAttempt = checkedAttemptValue
          ? await checkedAttemptHead(transaction, current, checkedAttemptValue.ordinal)
          : null;
        validatePlanMutation(
          current,
          next,
          checkedCheckpoint,
          checkedAttemptValue,
          priorAttempt,
          restoring,
        );
        if (checkedAttemptValue) {
          assertAttemptBindsDurableState({
            attempt: checkedAttemptValue,
            prior: priorAttempt,
            currentBefore: current.current,
            currentAfter: next.current,
            checkpoint: checkedCheckpoint,
            updatedAt: next.updatedAt,
            previousUpdatedAt: current.updatedAt,
          });
        }
        if (checkedCheckpoint) {
          const checked = clone(assertMakerV8PublicationCheckpointV8(checkedCheckpoint, current));
          const checkpoints = transaction.objectStore(CHECKPOINT_STORE);
          const existing = await requestResult(checkpoints.get([checked.attemptId, checked.ordinal]));
          if (existing) {
            if (canonical(existing) !== canonical(checked)) {
              fail('MAKER_V8_PUBLICATION_CHECKPOINT_COLLISION', 'Finalized checkpoint key already contains different evidence.');
            }
          } else {
            await requestResult(checkpoints.add(checked));
          }
          if (next.head?.ordinal !== checked.ordinal
            || next.head.digest !== checked.digest
            || next.head.checkpointSha256 !== checked.checkpointSha256
            || next.head.transactionKindSha256 !== checked.transactionKindSha256
            || next.head.phase !== checked.phase || next.head.lane !== checked.lane) {
            fail('MAKER_V8_PUBLICATION_HEAD_INVALID', 'CAS head does not bind the appended finalized checkpoint.');
          }
        } else if (canonical(current.head) !== canonical(next.head)) {
          fail('MAKER_V8_PUBLICATION_CHECKPOINT_REQUIRED', 'Publication head can advance only with an append-only checkpoint.');
        }
        if (checkedAttemptValue) {
          const checkedAttempt = clone(validateAttempt(checkedAttemptValue, current));
          const attempts = transaction.objectStore(ATTEMPT_STORE);
          const attemptHeads = transaction.objectStore(ATTEMPT_HEAD_STORE);
          const key = [checkedAttempt.attemptId, checkedAttempt.ordinal, checkedAttempt.sequence];
          const existing = await requestResult(attempts.get(key));
          if (existing && canonical(existing) !== canonical(checkedAttempt)) {
            fail('MAKER_V8_PUBLICATION_ATTEMPT_COLLISION', 'Transaction attempt key already contains different evidence.');
          }
          assertAttemptTransition(priorAttempt, checkedAttempt);
          if (!existing) {
            const totalAttemptEvents = await requestResult(
              attempts.index('byAttempt').count(checkedAttempt.attemptId),
            );
            if (totalAttemptEvents >= MAKER_V8_PUBLICATION_HISTORY_LIMITS.maxAttemptEvents) {
              fail('MAKER_V8_PUBLICATION_HISTORY_LIMIT_EXCEEDED', 'Publication attempt history reached its derived durable event ceiling.', {
                count: totalAttemptEvents,
                maximum: MAKER_V8_PUBLICATION_HISTORY_LIMITS.maxAttemptEvents,
              });
            }
            await requestResult(attempts.add(checkedAttempt));
            await requestResult(attemptHeads.put(attemptHeadRecord(checkedAttempt)));
          }
        }
        await addBlobs(transaction.objectStore(BLOB_STORE), blobs);
        await ensureRefs(transaction, [next, checkedCheckpoint, checkedAttemptValue], next);

        const currentActive = await requestResult(active.get(current.scopeKey));
        if (current.status === 'ACTIVE' && !currentActive) {
          fail('MAKER_V8_PUBLICATION_ACTIVE_INDEX_DRIFT', 'Active publication index changed in another tab.');
        }
        if (current.status === 'ACTIVE') assertActiveIndex(currentActive, current);
        if (next.status === 'ACTIVE') {
          const activePlans = await requestResult(
            plans.index('byScopeStatus').getAll([next.scopeKey, 'ACTIVE']),
          );
          if (activePlans.some((plan) => plan.attemptId !== current.attemptId)) {
            fail('MAKER_V8_PUBLICATION_SCOPE_ACTIVE', 'Another durable active plan occupies this signer and maker scope.');
          }
          if (current.status !== 'ACTIVE' && currentActive && currentActive.attemptId !== current.attemptId) {
            fail('MAKER_V8_PUBLICATION_SCOPE_ACTIVE', 'Another active publication attempt occupies this signer and maker key.');
          }
          await requestResult(active.put(activeIndex(next)));
        } else if (currentActive?.attemptId === current.attemptId) {
          await requestResult(active.delete(current.scopeKey));
        }
        await requestResult(plans.put(next));
        return clone(next);
      });
    },

    async deleteUnsigned(attemptId, expectedRevision) {
      return transact([
        PLAN_STORE, ACTIVE_STORE, CHECKPOINT_STORE, ATTEMPT_STORE, ATTEMPT_HEAD_STORE,
        USED_ATTEMPT_STORE, BLOB_STORE,
      ], 'readwrite', async (transaction) => {
        const plans = transaction.objectStore(PLAN_STORE);
        const active = transaction.objectStore(ACTIVE_STORE);
        const current = await requestResult(plans.get(attemptId));
        if (!current || current.revision !== expectedRevision) {
          fail('MAKER_V8_PUBLICATION_CAS_MISMATCH', 'Publication state changed in another tab.');
        }
        assertMakerV8PublicationPlanV8(current);
        const used = await requestResult(
          transaction.objectStore(USED_ATTEMPT_STORE).get(current.attemptId),
        );
        if (!used) {
          fail('MAKER_V8_PUBLICATION_ATTEMPT_ID_REUSED', 'Unsigned publication lacks its permanent attempt identity tombstone.');
        }
        assertUsedAttemptRecord(used, current);
        await validateActiveAnchor(transaction, current);
        if (current.status !== 'ACTIVE' || current.head !== null
          || current.current?.outcome.status !== 'READY'
          || current.current.fullTransactionRef != null || current.current.signatureRef != null) {
          fail('MAKER_V8_PUBLICATION_DISCARD_FORBIDDEN', 'Only an unsigned, unbroadcast ordinal-zero plan can be physically discarded.');
        }
        const recordedAttempts = await requestResult(
          transaction.objectStore(ATTEMPT_STORE).index('byAttempt').getAll(attemptId),
        );
        const recordedCheckpoints = await requestResult(
          transaction.objectStore(CHECKPOINT_STORE).index('byAttempt').getAll(attemptId),
        );
        const recordedAttemptHeads = (await requestResult(
          transaction.objectStore(ATTEMPT_HEAD_STORE).getAll(),
        )).filter((entry) => entry.attemptId === attemptId);
        if (recordedAttempts.length || recordedCheckpoints.length || recordedAttemptHeads.length) {
          fail('MAKER_V8_PUBLICATION_DISCARD_FORBIDDEN', 'A plan with any recorded signing outcome cannot be physically discarded.');
        }
        const index = await requestResult(active.get(current.scopeKey));
        if (!index) {
          fail('MAKER_V8_PUBLICATION_ACTIVE_INDEX_DRIFT', 'Active publication index changed in another tab.');
        }
        assertActiveIndex(index, current);
        await requestResult(transaction.objectStore(USED_ATTEMPT_STORE).put({
          ...used,
          disposition: 'DELETED_UNSIGNED',
          deletedAt: current.updatedAt,
        }));
        await requestResult(active.delete(current.scopeKey));
        await requestResult(plans.delete(attemptId));
        return true;
      });
    },

    async restoreAttempt(attemptId, expectedRevision, restoredAt) {
      if (!Number.isSafeInteger(restoredAt) || restoredAt < 0) {
        fail('MAKER_V8_PUBLICATION_RESTORE_INVALID', 'Restore time must be a non-negative safe integer.');
      }
      const current = await api.loadPlan(attemptId);
      if (!current || current.revision !== expectedRevision
        || current.status !== 'ABANDONED_RECOVERABLE') {
        fail('MAKER_V8_PUBLICATION_RESTORE_INVALID', 'Only the exact abandoned publication revision can be restored.');
      }
      if (current.head) await api.loadHead(attemptId);
      return api.compareAndSwap(attemptId, expectedRevision, {
        ...current,
        status: 'ACTIVE',
        revision: expectedRevision + 1,
        updatedAt: restoredAt,
        terminal: null,
      }, { restoreToken: RESTORE_TOKEN });
    },

    async exportAttempt(attemptId) {
      const bundle = await transact([
        PLAN_STORE, ACTIVE_STORE, CHECKPOINT_STORE, ATTEMPT_STORE, ATTEMPT_HEAD_STORE,
        USED_ATTEMPT_STORE, BLOB_STORE,
      ], 'readonly', async (transaction) => {
        const plan = await requestResult(transaction.objectStore(PLAN_STORE).get(attemptId));
        if (!plan) return null;
        assertMakerV8PublicationPlanV8(plan);
        const used = await requestResult(
          transaction.objectStore(USED_ATTEMPT_STORE).get(plan.attemptId),
        );
        if (!used) {
          fail('MAKER_V8_PUBLICATION_ATTEMPT_ID_REUSED', 'Exported publication lacks its permanent attempt identity tombstone.');
        }
        assertUsedAttemptRecord(used, plan);
        await validateActiveAnchor(transaction, plan);
        const checkpoints = (await requestResult(
          transaction.objectStore(CHECKPOINT_STORE).index('byAttempt').getAll(attemptId),
        )).sort((left, right) => left.ordinal - right.ordinal)
          .map((entry) => clone(assertMakerV8PublicationCheckpointV8(entry)));
        const attempts = (await requestResult(
          transaction.objectStore(ATTEMPT_STORE).index('byAttempt').getAll(attemptId),
        )).sort((left, right) => left.ordinal - right.ordinal || left.sequence - right.sequence)
          .map((entry) => clone(entry));
        const refs = collectBlobRefs([plan, checkpoints, attempts]);
        await ensureRefs(transaction, [plan, checkpoints, attempts], plan);
        const derivedHeads = validateBundleClosure(plan, checkpoints, attempts);
        const cachedHeads = (await requestResult(
          transaction.objectStore(ATTEMPT_HEAD_STORE).getAll(),
        )).filter((entry) => entry.attemptId === plan.attemptId);
        if (cachedHeads.length !== derivedHeads.size) {
          fail('MAKER_V8_PUBLICATION_ATTEMPT_HEAD_DRIFT', 'Exported attempt-head cache has missing or extra ordinal records.');
        }
        for (const event of derivedHeads.values()) {
          const cached = await requestResult(
            transaction.objectStore(ATTEMPT_HEAD_STORE).get([event.attemptId, event.ordinal]),
          );
          if (!cached || canonical(cached) !== canonical(attemptHeadRecord(event))) {
            fail('MAKER_V8_PUBLICATION_ATTEMPT_HEAD_DRIFT', 'Exported attempt history differs from its derived durable head.');
          }
        }
        const blobs = [];
        for (const ref of refs.values()) {
          const blob = await requestResult(transaction.objectStore(BLOB_STORE).get(ref.sha256));
          if (!blob || blob.byteLength !== ref.byteLength || blob.encoding !== ref.encoding) {
            fail('MAKER_V8_PUBLICATION_BLOB_MISSING', 'Export cannot omit a content-addressed publication blob.');
          }
          blobs.push(clone(blob));
        }
        blobs.sort((left, right) => left.sha256 < right.sha256 ? -1 : left.sha256 > right.sha256 ? 1 : 0);
        return {
          schemaVersion: MAKER_V8_PUBLICATION_PERSISTENCE_SCHEMA,
          plan: clone(plan), checkpoints, attempts, blobs,
        };
      });
      if (!bundle) return null;
      await assertMakerV8PublicationPlanIdentityV8(bundle.plan);
      let previous = null;
      for (const checkpoint of bundle.checkpoints) {
        if (checkpoint.previousCheckpointSha256 !== previous
          || await makerV8PublicationCheckpointSha256V8(checkpoint) !== checkpoint.checkpointSha256) {
          fail('MAKER_V8_PUBLICATION_CHECKPOINT_HASH_MISMATCH', 'Exported checkpoint failed canonical hash verification.');
        }
        previous = checkpoint.checkpointSha256;
      }
      if ((bundle.plan.head?.checkpointSha256 ?? null) !== previous) {
        fail('MAKER_V8_PUBLICATION_HEAD_DRIFT', 'Exported publication head does not bind the checkpoint prefix.');
      }
      await Promise.all(bundle.blobs.map((blob, index) => assertBlob(blob, `Exported publication blob[${index}]`)));
      validateBundleClosure(bundle.plan, bundle.checkpoints, bundle.attempts);
      return Object.freeze(bundle);
    },

    async importAttempt(bundleValue) {
      const bundle = clone(bundleValue);
      exactKeys(bundle, ['schemaVersion', 'plan', 'checkpoints', 'attempts', 'blobs'], 'Publication export bundle');
      if (bundle.schemaVersion !== MAKER_V8_PUBLICATION_PERSISTENCE_SCHEMA
        || !Array.isArray(bundle.checkpoints) || !Array.isArray(bundle.attempts)
        || !Array.isArray(bundle.blobs)) {
        fail('MAKER_V8_PUBLICATION_IMPORT_INVALID', 'Publication import bundle shape is invalid.');
      }
      await assertMakerV8PublicationPlanIdentityV8(bundle.plan);
      await Promise.all(bundle.blobs.map((blob, index) => assertBlob(blob, `Imported publication blob[${index}]`)));
      const blobMap = new Map(bundle.blobs.map((blob) => [blob.sha256, blob]));
      if (blobMap.size !== bundle.blobs.length) fail('MAKER_V8_PUBLICATION_IMPORT_INVALID', 'Publication import repeats a content blob.');
      let previous = null;
      for (const [ordinal, checkpoint] of bundle.checkpoints.entries()) {
        assertMakerV8PublicationCheckpointV8(checkpoint);
        if (checkpoint.attemptId !== bundle.plan.attemptId || checkpoint.planId !== bundle.plan.planId
          || checkpoint.ordinal !== ordinal
          || checkpoint.previousCheckpointSha256 !== previous
          || await makerV8PublicationCheckpointSha256V8(checkpoint) !== checkpoint.checkpointSha256) {
          fail('MAKER_V8_PUBLICATION_IMPORT_INVALID', 'Publication import checkpoint prefix is not exact and canonical.');
        }
        previous = checkpoint.checkpointSha256;
      }
      if ((bundle.plan.head?.ordinal ?? -1) !== bundle.checkpoints.length - 1
        || (bundle.plan.head?.checkpointSha256 ?? null) !== previous) {
        fail('MAKER_V8_PUBLICATION_IMPORT_INVALID', 'Publication import head does not bind its complete audit prefix.');
      }
      let priorOrdinal = -1;
      let priorSequence = -1;
      for (const attempt of bundle.attempts) {
        if (attempt.ordinal < priorOrdinal
          || (attempt.ordinal === priorOrdinal && attempt.sequence !== priorSequence + 1)
          || (attempt.ordinal > priorOrdinal && attempt.sequence !== 0)) {
          fail('MAKER_V8_PUBLICATION_IMPORT_INVALID', 'Publication import attempts are not in canonical ordinal and sequence order.');
        }
        priorOrdinal = attempt.ordinal;
        priorSequence = attempt.sequence;
      }
      const attemptHeads = validateBundleClosure(bundle.plan, bundle.checkpoints, bundle.attempts);
      if ((bundle.checkpoints.length || bundle.attempts.some(requiresPersistentEvidence))
        && !persistentStorageGranted) {
        fail('MAKER_V8_PUBLICATION_PERSISTENCE_REQUIRED', 'Persistent browser storage must be granted before signed or finalized publication evidence is imported.');
      }
      const refs = collectBlobRefs([bundle.plan, bundle.checkpoints, bundle.attempts]);
      if (refs.size !== blobMap.size
        || [...refs.values()].some((ref) => {
          const blob = blobMap.get(ref.sha256);
          return !blob || blob.byteLength !== ref.byteLength || blob.encoding !== ref.encoding;
        })) {
        fail('MAKER_V8_PUBLICATION_IMPORT_INVALID', 'Publication import blobs do not exactly cover all durable references.');
      }
      return transact([
        PLAN_STORE, ACTIVE_STORE, CHECKPOINT_STORE, ATTEMPT_STORE, ATTEMPT_HEAD_STORE,
        USED_ATTEMPT_STORE, BLOB_STORE,
      ], 'readwrite', async (transaction) => {
        const plans = transaction.objectStore(PLAN_STORE);
        const existing = await requestResult(plans.get(bundle.plan.attemptId));
        const usedAttempts = transaction.objectStore(USED_ATTEMPT_STORE);
        const used = await requestResult(usedAttempts.get(bundle.plan.attemptId));
        if (existing) {
          if (canonical(existing) !== canonical(bundle.plan)) {
            fail('MAKER_V8_PUBLICATION_IMPORT_COLLISION', 'Existing publication plan differs from the canonical import bundle.');
          }
          if (!used) {
            fail('MAKER_V8_PUBLICATION_ATTEMPT_ID_REUSED', 'Existing imported plan lacks its permanent attempt identity tombstone.');
          }
          assertUsedAttemptRecord(used, existing);
          await validateActiveAnchor(transaction, existing);
          const existingCheckpoints = (await requestResult(
            transaction.objectStore(CHECKPOINT_STORE).index('byAttempt').getAll(bundle.plan.attemptId),
          )).sort((left, right) => left.ordinal - right.ordinal);
          const existingAttempts = (await requestResult(
            transaction.objectStore(ATTEMPT_STORE).index('byAttempt').getAll(bundle.plan.attemptId),
          )).sort((left, right) => left.ordinal - right.ordinal || left.sequence - right.sequence);
          const existingHeads = (await requestResult(
            transaction.objectStore(ATTEMPT_HEAD_STORE).getAll(),
          )).filter((entry) => entry.attemptId === bundle.plan.attemptId)
            .sort((left, right) => left.ordinal - right.ordinal);
          const expectedHeads = [...attemptHeads.values()].map(attemptHeadRecord)
            .sort((left, right) => left.ordinal - right.ordinal);
          let exactBundle = canonical(existingCheckpoints) === canonical(bundle.checkpoints)
            && canonical(existingAttempts) === canonical(bundle.attempts)
            && canonical(existingHeads) === canonical(expectedHeads);
          for (const blob of bundle.blobs) {
            const existingBlob = await requestResult(
              transaction.objectStore(BLOB_STORE).get(blob.sha256),
            );
            exactBundle &&= canonical(existingBlob ?? null) === canonical(blob);
          }
          if (!exactBundle) {
            fail('MAKER_V8_PUBLICATION_IMPORT_COLLISION', 'Existing publication attempt differs from the complete canonical import bundle.');
          }
          return clone(existing);
        }
        if (used) {
          fail('MAKER_V8_PUBLICATION_ATTEMPT_ID_REUSED', 'Imported attempt ID was previously consumed and cannot be recreated.');
        }
        const occupied = await requestResult(
          transaction.objectStore(ACTIVE_STORE).get(bundle.plan.scopeKey),
        );
        const activePlans = await requestResult(
          plans.index('byScopeStatus').getAll([bundle.plan.scopeKey, 'ACTIVE']),
        );
        if (activePlans.length > 1 || (activePlans.length === 0) !== (occupied == null)) {
          fail('MAKER_V8_PUBLICATION_ACTIVE_INDEX_DRIFT', 'Imported publication scope has inconsistent active-plan authority.');
        }
        if (activePlans.length === 1) {
          assertActiveIndex(occupied, activePlans[0]);
        }
        if (bundle.plan.status === 'ACTIVE' && (occupied || activePlans.length)) {
          fail('MAKER_V8_PUBLICATION_SCOPE_ACTIVE', 'Another active attempt occupies the imported scope.');
        }
        await addBlobs(transaction.objectStore(BLOB_STORE), bundle.blobs);
        await ensureRefs(transaction, [bundle.plan, bundle.checkpoints, bundle.attempts], bundle.plan);
        await requestResult(usedAttempts.add(usedAttemptRecord(bundle.plan)));
        await requestResult(plans.add(bundle.plan));
        if (bundle.plan.status === 'ACTIVE') {
          await requestResult(transaction.objectStore(ACTIVE_STORE).add(activeIndex(bundle.plan)));
        }
        const checkpoints = transaction.objectStore(CHECKPOINT_STORE);
        for (const checkpoint of bundle.checkpoints) await requestResult(checkpoints.add(checkpoint));
        const attempts = transaction.objectStore(ATTEMPT_STORE);
        for (const attempt of bundle.attempts) await requestResult(attempts.add(attempt));
        const heads = transaction.objectStore(ATTEMPT_HEAD_STORE);
        for (const entry of attemptHeads.values()) {
          await requestResult(heads.add(attemptHeadRecord(entry)));
        }
        await validateActiveAnchor(transaction, bundle.plan);
        await validateUsedAttemptAnchor(transaction, bundle.plan);
        return clone(bundle.plan);
      });
    },

    close() {
      if (!databasePromise) return;
      databasePromise.then((database) => database.close()).catch(() => {});
      closed = true;
      databasePromise = null;
    },
  };
  return Object.freeze(api);
}
