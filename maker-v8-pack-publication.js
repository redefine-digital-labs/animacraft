import { bcs } from '@mysten/sui/bcs';
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions';
import { fromBase58, fromBase64, toBase64 } from '@mysten/sui/utils';
import { sha256 } from '@noble/hashes/sha2.js';

import { MAKER_V8_PACK_PUBLICATION_CONTROLLER_SCHEMA } from './maker-v8-pack-controller.js';

export const MAKER_V8_PACK_PUBLICATION_SCHEMA =
  'animacraft.maker-v8-pack-publication.v1';
export const MAKER_V8_PACK_PUBLICATION_DESCRIPTOR_SCHEMA =
  'animacraft.maker-v8-pack-transaction-descriptor.v1';
export const MAKER_V8_PACK_PUBLICATION_EVENT_SCHEMA =
  'animacraft.maker-v8-pack-publication-event.v1';
export const MAKER_V8_PACK_PUBLICATION_DATABASE =
  'animacraft-maker-v8-pack-publication-v1';

const PLAN_STORE = 'plans';
const EVENT_STORE = 'events';
const DATABASE_VERSION = 1;
const HASH = /^[0-9a-f]{64}$/;
const SAFE_ATTEMPT = /^[a-z0-9][a-z0-9_-]{0,255}$/;
const EXACT_ID = /^0x[0-9a-f]{64}$/;
const STAGES = new Set(['INIT', 'DEFINITIONS_BEGIN', 'DEFINITIONS_APPEND', 'DEFINITIONS_FINALIZE',
  'DEFINITIONS_COLOR_BEGIN', 'DEFINITIONS_COLOR_APPEND', 'DEFINITIONS_COLOR_FINISH', 'APPEND', 'FINALIZE']);
const OUTCOMES = new Set([
  'READY', 'SIGNED', 'OUTCOME_PENDING', 'BROADCAST_ACCEPTED',
  'OUTCOME_UNKNOWN', 'FINALIZED_SUCCESS', 'FINALIZED_FAILURE',
]);
const encoder = new TextEncoder();

export class MakerV8PackPublicationError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'MakerV8PackPublicationError';
    this.code = code;
    if (details !== undefined) this.details = Object.freeze(structuredClone(details));
  }
}

function fail(code, message, details) {
  throw new MakerV8PackPublicationError(code, message, details);
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

function clone(value) {
  return structuredClone(value);
}

function canonicalValue(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalValue);
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
}

export function canonicalMakerV8PackPublicationJson(value) {
  return JSON.stringify(canonicalValue(value));
}

function hashBytes(bytes) {
  return [...sha256(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function hashValue(value) {
  return hashBytes(encoder.encode(canonicalMakerV8PackPublicationJson(value)));
}

function exact(value, fields, label) {
  if (!plain(value)) fail('MAKER_V8_PACK_PUBLICATION_SHAPE_INVALID', `${label} must be a plain record.`);
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) {
    fail('MAKER_V8_PACK_PUBLICATION_FIELDS_INVALID', `${label} has fields outside its exact schema.`, {
      actual, expected,
    });
  }
  return value;
}

function deterministic(value, label) {
  let result;
  try {
    result = JSON.parse(JSON.stringify(value));
    if (canonicalMakerV8PackPublicationJson(result) !== canonicalMakerV8PackPublicationJson(value)) {
      throw new Error('roundtrip');
    }
  } catch {
    fail('MAKER_V8_PACK_PUBLICATION_EVIDENCE_INVALID', `${label} must be deterministic JSON.`);
  }
  return result;
}

function canonicalBase64(value, label) {
  try {
    if (typeof value !== 'string' || !value.length) throw new Error('shape');
    const bytes = fromBase64(value);
    if (toBase64(bytes) !== value) throw new Error('canonical');
    return bytes;
  } catch {
    fail('MAKER_V8_PACK_PUBLICATION_BASE64_INVALID', `${label} must be canonical Base64.`);
  }
}

function address(value, label) {
  if (typeof value !== 'string' || !EXACT_ID.test(value)) {
    fail('MAKER_V8_PACK_PUBLICATION_ADDRESS_INVALID', `${label} must be one canonical Sui address.`);
  }
  return value;
}

function attemptId(value) {
  if (typeof value !== 'string' || !SAFE_ATTEMPT.test(value)) {
    fail('MAKER_V8_PACK_PUBLICATION_ATTEMPT_INVALID', 'Pack attemptId must be one bounded deterministic identifier.');
  }
  return value;
}

function exactTime(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail('MAKER_V8_PACK_PUBLICATION_TIME_INVALID', `${label} must be one non-negative safe integer.`);
  }
  return value;
}

function exactRevision(value, label = 'revision') {
  if (!Number.isSafeInteger(value) || value < 1) {
    fail('MAKER_V8_PACK_PUBLICATION_REVISION_INVALID', `${label} must be one positive safe integer.`);
  }
  return value;
}

function decimal(value, label) {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(value)) {
    fail('MAKER_V8_PACK_PUBLICATION_INTEGER_INVALID', `${label} must be one canonical decimal string.`);
  }
  return value;
}

function suiDigest(value, label) {
  try {
    if (typeof value !== 'string' || fromBase58(value).length !== 32) throw new Error('digest');
  } catch {
    fail('MAKER_V8_PACK_PUBLICATION_DIGEST_INVALID', `${label} must be one canonical Sui digest.`);
  }
  return value;
}

function assertGrpcAbsence(value, expectedDigest, expectedChain) {
  const absence = deterministic(value, 'typed gRPC transaction absence');
  exact(absence, [
    'schemaVersion', 'kind', 'grpcCode', 'grpcService', 'grpcMethod',
    'requestedDigest', 'chainIdentifier', 'watermarkEpoch',
    'watermarkCheckpointSequence', 'watermarkCheckpointDigest',
  ], 'typed gRPC transaction absence');
  if (absence.schemaVersion !== 'animacraft.sui-transaction-absence.v8'
    || absence.kind !== 'SUI_GRPC_TRANSACTION_NOT_FOUND'
    || absence.grpcCode !== 'NOT_FOUND'
    || absence.grpcService !== 'sui.rpc.v2.LedgerService'
    || absence.grpcMethod !== 'GetTransaction'
    || absence.requestedDigest !== expectedDigest
    || absence.chainIdentifier !== expectedChain) {
    fail('MAKER_V8_PACK_PUBLICATION_ABSENCE_INVALID', 'Typed gRPC absence does not bind the exact Mainnet digest.');
  }
  decimal(absence.watermarkEpoch, 'absence.watermarkEpoch');
  decimal(absence.watermarkCheckpointSequence, 'absence.watermarkCheckpointSequence');
  suiDigest(absence.watermarkCheckpointDigest, 'absence.watermarkCheckpointDigest');
  return freeze(absence);
}

function requireMethod(value, method, label) {
  if (typeof value?.[method] !== 'function') {
    fail('MAKER_V8_PACK_PUBLICATION_DEPENDENCY_INVALID', `${label}.${method} is required.`);
  }
}

function same(left, right) {
  return canonicalMakerV8PackPublicationJson(left) === canonicalMakerV8PackPublicationJson(right);
}

function kindProof(value, stage, label = 'Pack TransactionKind') {
  const bytes = value instanceof Uint8Array ? value : canonicalBase64(value, label);
  let parsed;
  let roundtrip;
  try {
    parsed = bcs.TransactionKind.parse(bytes);
    roundtrip = bcs.TransactionKind.serialize(parsed).toBytes();
  } catch {
    fail('MAKER_V8_PACK_PUBLICATION_KIND_INVALID', `${label} is not canonical Sui BCS.`);
  }
  if (parsed?.$kind !== 'ProgrammableTransaction'
    || roundtrip.length !== bytes.length
    || roundtrip.some((byte, index) => byte !== bytes[index])) {
    fail('MAKER_V8_PACK_PUBLICATION_KIND_INVALID', `${label} is not one canonical programmable transaction.`);
  }
  const commands = parsed.ProgrammableTransaction?.commands;
  if (!Array.isArray(commands) || !commands.some(command => command?.$kind === 'MoveCall') || commands.some((command) => (
    command?.$kind !== 'MoveCall' && !(stage === 'DEFINITIONS_APPEND' && command?.$kind === 'MakeMoveVec')
  ))) {
    fail('MAKER_V8_PACK_PUBLICATION_KIND_INVALID', `${label} contains commands outside its exact Pack stage grammar.`);
  }
  const targets = commands.filter(command => command.$kind === 'MoveCall')
    .map(({ MoveCall: call }) => `${call.package}::${call.module}::${call.function}`);
  return freeze({ bytes, base64: toBase64(bytes), sha256: hashBytes(bytes), targets });
}

function transactionDataProof(value, expected) {
  const bytes = canonicalBase64(value, 'Pack TransactionData');
  let parsed;
  let roundtrip;
  try {
    parsed = bcs.TransactionData.parse(bytes);
    roundtrip = bcs.TransactionData.serialize(parsed).toBytes();
  } catch {
    fail('MAKER_V8_PACK_PUBLICATION_TRANSACTION_INVALID', 'Pack TransactionData is not canonical BCS.');
  }
  if (parsed?.$kind !== 'V1' || roundtrip.length !== bytes.length
    || roundtrip.some((byte, index) => byte !== bytes[index])) {
    fail('MAKER_V8_PACK_PUBLICATION_TRANSACTION_INVALID', 'Pack TransactionData must be canonical V1 BCS.');
  }
  const kind = toBase64(bcs.TransactionKind.serialize(parsed.V1.kind).toBytes());
  const digest = TransactionDataBuilder.getDigestFromBytes(bytes);
  if (parsed.V1.sender !== expected.signer || parsed.V1.gasData?.owner !== expected.signer
    || kind !== expected.kindBytes || expected.digest != null && digest !== expected.digest) {
    fail('MAKER_V8_PACK_PUBLICATION_TRANSACTION_DRIFT', 'Pack TransactionData differs from its signer, kind, or digest.');
  }
  return freeze({ bytes, base64: value, digest, kindBytes: kind });
}

function assertDescriptor(value) {
  const descriptor = deterministic(value, 'Pack descriptor');
  exact(descriptor, [
    'schemaVersion', 'ordinal', 'stage', 'startStyle', 'endStyle', 'signer',
    'kindBytes', 'kindSha256', 'targets', 'checkpoint',
  ], 'Pack descriptor');
  if (descriptor.schemaVersion !== MAKER_V8_PACK_PUBLICATION_DESCRIPTOR_SCHEMA
    || !Number.isSafeInteger(descriptor.ordinal) || descriptor.ordinal < 0
    || !STAGES.has(descriptor.stage)
    || !Number.isSafeInteger(descriptor.startStyle) || descriptor.startStyle < 0
    || !Number.isSafeInteger(descriptor.endStyle) || descriptor.endStyle < descriptor.startStyle) {
    fail('MAKER_V8_PACK_PUBLICATION_DESCRIPTOR_INVALID', 'Pack descriptor cursor is invalid.');
  }
  address(descriptor.signer, 'descriptor.signer');
  if (descriptor.stage.startsWith('DEFINITIONS_') && (descriptor.startStyle !== 0 || descriptor.endStyle !== 0)) {
    fail('MAKER_V8_PACK_PUBLICATION_DESCRIPTOR_INVALID', 'Definition registration cannot advance the Style cursor.');
  }
  const proof = kindProof(descriptor.kindBytes, descriptor.stage);
  if (!HASH.test(descriptor.kindSha256) || descriptor.kindSha256 !== proof.sha256
    || !Array.isArray(descriptor.targets) || !same(descriptor.targets, proof.targets)
    || !plain(descriptor.checkpoint)) {
    fail('MAKER_V8_PACK_PUBLICATION_DESCRIPTOR_INVALID', 'Pack descriptor does not bind its exact transaction kind and checkpoint.');
  }
  return freeze(descriptor);
}

function assertOutcome(value, descriptor) {
  if (!plain(value) || !OUTCOMES.has(value.status)) {
    fail('MAKER_V8_PACK_PUBLICATION_OUTCOME_INVALID', 'Pack cursor outcome is invalid.');
  }
  if (value.status === 'READY') {
    exact(value, ['status'], 'READY outcome');
    return freeze({ status: 'READY' });
  }
  const base = [
    'status', 'digest', 'signedAt', 'firstSeenAt', 'broadcastAt', 'observedAt',
    'code', 'absence',
  ];
  exact(value, base, `${value.status} outcome`);
  if (typeof value.digest !== 'string' || !value.digest.length
    || !Number.isSafeInteger(value.signedAt) || value.signedAt < 0
    || value.firstSeenAt !== null && (!Number.isSafeInteger(value.firstSeenAt) || value.firstSeenAt < value.signedAt)
    || value.broadcastAt !== null && (!Number.isSafeInteger(value.broadcastAt) || value.broadcastAt < value.signedAt)
    || !Number.isSafeInteger(value.observedAt) || value.observedAt < value.signedAt
    || value.code !== null && typeof value.code !== 'string'
    || value.absence !== null && !plain(value.absence)) {
    fail('MAKER_V8_PACK_PUBLICATION_OUTCOME_INVALID', `${value.status} outcome timing is invalid.`);
  }
  void descriptor;
  return freeze(clone(value));
}

export function assertMakerV8PackPublicationPlanV8(value) {
  const plan = deterministic(value, 'Pack publication plan');
  exact(plan, [
    'schemaVersion', 'attemptId', 'revision', 'status', 'createdAt', 'updatedAt',
    'immutable', 'current', 'head', 'nextPreparation', 'terminal', 'eventHeadSha256',
  ], 'Pack publication plan');
  if (plan.schemaVersion !== MAKER_V8_PACK_PUBLICATION_SCHEMA
    || !['ACTIVE', 'COMPLETE', 'FAILED'].includes(plan.status)) {
    fail('MAKER_V8_PACK_PUBLICATION_PLAN_INVALID', 'Pack publication plan schema or status is invalid.');
  }
  attemptId(plan.attemptId);
  exactRevision(plan.revision);
  exactTime(plan.createdAt, 'plan.createdAt');
  exactTime(plan.updatedAt, 'plan.updatedAt');
  if (plan.updatedAt < plan.createdAt) fail('MAKER_V8_PACK_PUBLICATION_TIME_INVALID', 'Pack plan time moved backwards.');
  exact(plan.immutable, [
    'request', 'requestSha256', 'draftId', 'draftRevision', 'documentSha256', 'signer',
  ], 'plan.immutable');
  const request = deterministic(plan.immutable.request, 'Pack publication request');
  if (!HASH.test(plan.immutable.requestSha256) || plan.immutable.requestSha256 !== hashValue(request)
    || plan.immutable.request.draftId !== plan.immutable.draftId
    || plan.immutable.request.draftRevision !== plan.immutable.draftRevision
    || plan.immutable.request.documentSha256 !== plan.immutable.documentSha256) {
    fail('MAKER_V8_PACK_PUBLICATION_IDENTITY_DRIFT', 'Pack publication immutable request drifted.');
  }
  address(plan.immutable.signer, 'plan signer');
  if (plan.current !== null) {
    exact(plan.current, [
      'descriptor', 'fullTransaction', 'signature', 'outcome', 'eventSequence',
    ], 'plan.current');
    plan.current.descriptor = assertDescriptor(plan.current.descriptor);
    if (plan.current.descriptor.signer !== plan.immutable.signer
      || !Number.isSafeInteger(plan.current.eventSequence) || plan.current.eventSequence < -1) {
      fail('MAKER_V8_PACK_PUBLICATION_CURSOR_INVALID', 'Pack current cursor differs from its immutable signer or event sequence.');
    }
    if ((plan.current.fullTransaction === null) !== (plan.current.signature === null)) {
      fail('MAKER_V8_PACK_PUBLICATION_ARTIFACT_INVALID', 'Pack TransactionData and signature must be stored together.');
    }
    if (plan.current.fullTransaction !== null) {
      canonicalBase64(plan.current.fullTransaction, 'durable Pack TransactionData');
      canonicalBase64(plan.current.signature, 'durable Pack signature');
    }
    plan.current.outcome = assertOutcome(plan.current.outcome, plan.current.descriptor);
    if (plan.current.outcome.absence != null) {
      if (!['OUTCOME_PENDING', 'BROADCAST_ACCEPTED'].includes(plan.current.outcome.status)
        || plan.current.outcome.code !== 'TYPED_GRPC_NOT_FOUND') {
        fail('MAKER_V8_PACK_PUBLICATION_ABSENCE_INVALID', 'Typed gRPC absence is attached to an invalid Pack outcome.');
      }
      assertGrpcAbsence(
        plan.current.outcome.absence,
        plan.current.outcome.digest,
        plan.immutable.request.publicationInput.chainIdentifier,
      );
    }
  }
  if (plan.eventHeadSha256 !== null && !HASH.test(plan.eventHeadSha256)) {
    fail('MAKER_V8_PACK_PUBLICATION_EVENT_HEAD_INVALID', 'Pack event head is invalid.');
  }
  if (plan.status === 'ACTIVE' && plan.current === null && plan.nextPreparation === null) {
    fail('MAKER_V8_PACK_PUBLICATION_CURSOR_INVALID', 'Active Pack plan has neither a current cursor nor successor boundary.');
  }
  if (plan.status !== 'ACTIVE' && (plan.current !== null || plan.nextPreparation !== null || plan.terminal === null)) {
    fail('MAKER_V8_PACK_PUBLICATION_TERMINAL_INVALID', 'Terminal Pack plan retains an active cursor.');
  }
  return freeze(plan);
}

function makeEvent(plan, status, at, { digest = null, code = null, absence = null } = {}) {
  const sequence = plan.current.eventSequence + 1;
  const event = {
    schemaVersion: MAKER_V8_PACK_PUBLICATION_EVENT_SCHEMA,
    attemptId: plan.attemptId,
    ordinal: plan.current.descriptor.ordinal,
    sequence,
    status,
    digest,
    kindSha256: plan.current.descriptor.kindSha256,
    observedAt: at,
    code,
    absence,
    previousEventSha256: plan.eventHeadSha256,
    eventSha256: '0'.repeat(64),
  };
  event.eventSha256 = hashValue({ ...event, eventSha256: '0'.repeat(64) });
  return freeze(event);
}

function assertEvent(value, current, successor) {
  const event = deterministic(value, 'Pack publication event');
  exact(event, [
    'schemaVersion', 'attemptId', 'ordinal', 'sequence', 'status', 'digest',
    'kindSha256', 'observedAt', 'code', 'absence', 'previousEventSha256',
    'eventSha256',
  ], 'Pack publication event');
  const cursor = current.current;
  if (event.schemaVersion !== MAKER_V8_PACK_PUBLICATION_EVENT_SCHEMA
    || !cursor || event.attemptId !== current.attemptId
    || event.ordinal !== cursor.descriptor.ordinal
    || event.sequence !== cursor.eventSequence + 1
    || !OUTCOMES.has(event.status) || event.status === 'READY'
    || event.kindSha256 !== cursor.descriptor.kindSha256
    || event.previousEventSha256 !== current.eventHeadSha256
    || event.eventSha256 !== successor.eventHeadSha256
    || event.observedAt !== successor.updatedAt
    || event.eventSha256 !== hashValue({ ...event, eventSha256: '0'.repeat(64) })) {
    fail('MAKER_V8_PACK_PUBLICATION_EVENT_INVALID', 'Pack publication event does not bind its exact CAS boundary.');
  }
  exactTime(event.observedAt, 'event.observedAt');
  if (event.digest !== null) suiDigest(event.digest, 'event.digest');
  if (event.code !== null && typeof event.code !== 'string') {
    fail('MAKER_V8_PACK_PUBLICATION_EVENT_INVALID', 'Pack publication event code is invalid.');
  }
  if (event.absence !== null) {
    assertGrpcAbsence(
      event.absence,
      cursor.outcome.digest,
      current.immutable.request.publicationInput.chainIdentifier,
    );
  }
  return freeze(event);
}

function applyEvent(plan, event, outcome, at) {
  return {
    ...plan,
    revision: plan.revision + 1,
    updatedAt: at,
    eventHeadSha256: event.eventSha256,
    current: {
      ...plan.current,
      eventSequence: event.sequence,
      outcome,
    },
  };
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

function strictTransaction(database, stores, mode) {
  if (mode !== 'readwrite') return database.transaction(stores, mode);
  let transaction;
  try {
    transaction = database.transaction(stores, mode, { durability: 'strict' });
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    fail(
      'MAKER_V8_PACK_PUBLICATION_STRICT_DURABILITY_REQUIRED',
      'Browser IndexedDB does not support strict durability for the Pack publication WAL.',
    );
  }
  if (transaction.durability !== 'strict') {
    try { transaction.abort(); } catch {}
    fail(
      'MAKER_V8_PACK_PUBLICATION_STRICT_DURABILITY_REQUIRED',
      'Browser IndexedDB did not honor strict durability for the Pack publication WAL.',
    );
  }
  return transaction;
}

export function createMakerV8PackPublicationPersistenceV8(
  indexedDB = globalThis.indexedDB,
  {
    databaseName = MAKER_V8_PACK_PUBLICATION_DATABASE,
    storageManager = globalThis.navigator?.storage,
  } = {},
) {
  if (!indexedDB?.open) fail('MAKER_V8_PACK_PUBLICATION_INDEXEDDB_REQUIRED', 'Pack publication requires IndexedDB.');
  let databasePromise = null;
  const open = () => {
    databasePromise ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(PLAN_STORE)) {
          request.result.createObjectStore(PLAN_STORE, { keyPath: 'attemptId' });
        }
        if (!request.result.objectStoreNames.contains(EVENT_STORE)) {
          const events = request.result.createObjectStore(EVENT_STORE, {
            keyPath: ['attemptId', 'ordinal', 'sequence'],
          });
          events.createIndex('byAttempt', 'attemptId', { unique: false });
        }
      };
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => {
          database.close();
          databasePromise = null;
        };
        resolve(database);
      };
      request.onerror = () => reject(request.error || new Error('Pack publication database failed to open.'));
      request.onblocked = () => reject(Object.assign(
        new Error('Pack publication database upgrade is blocked by another tab.'),
        { code: 'MAKER_V8_PACK_PUBLICATION_UPGRADE_BLOCKED' },
      ));
    });
    return databasePromise;
  };
  const transact = async (stores, mode, operation) => {
    const database = await open();
    const transaction = strictTransaction(database, stores, mode);
    const done = transactionDone(transaction);
    try {
      const result = await operation(transaction);
      if (mode === 'readwrite') await done;
      return result;
    } catch (error) {
      try { transaction.abort(); } catch {}
      await done.catch(() => {});
      throw error;
    }
  };
  return freeze({
    capabilities: freeze({ durable: true, atomicCas: true }),
    async requirePersistentStorage() {
      if (typeof storageManager?.persisted !== 'function'
        || typeof storageManager?.persist !== 'function') {
        fail('MAKER_V8_PACK_PUBLICATION_PERSISTENCE_REQUIRED', 'Pack signing requires browser persistent storage.');
      }
      let persisted;
      try {
        persisted = await storageManager.persisted();
        if (!persisted) persisted = await storageManager.persist();
      } catch {
        fail('MAKER_V8_PACK_PUBLICATION_PERSISTENCE_REQUIRED', 'Pack signing could not establish browser persistent storage.');
      }
      if (persisted !== true) {
        fail('MAKER_V8_PACK_PUBLICATION_PERSISTENCE_REQUIRED', 'Pack signing requires browser persistent storage.');
      }
      return true;
    },
    async create(value) {
      const plan = assertMakerV8PackPublicationPlanV8(value);
      return transact([PLAN_STORE], 'readwrite', async (transaction) => {
        const store = transaction.objectStore(PLAN_STORE);
        if (await requestResult(store.get(plan.attemptId))) {
          fail('MAKER_V8_PACK_PUBLICATION_EXISTS', 'Pack publication attempt already exists.');
        }
        store.add(clone(plan));
        return plan;
      });
    },
    async load(id) {
      const value = await transact([PLAN_STORE], 'readonly', (transaction) => (
        requestResult(transaction.objectStore(PLAN_STORE).get(attemptId(id)))
      ));
      return value ? assertMakerV8PackPublicationPlanV8(value) : null;
    },
    async listPlans(signer) {
      const owner = address(signer, 'signer');
      const values = await transact([PLAN_STORE], 'readonly', transaction => requestResult(transaction.objectStore(PLAN_STORE).getAll()));
      return freeze(values.filter(value => value.immutable?.signer === owner).map(assertMakerV8PackPublicationPlanV8));
    },
    async compareAndSwap(id, expectedRevision, nextValue, { event = null } = {}) {
      const checkedId = attemptId(id);
      const successor = assertMakerV8PackPublicationPlanV8(nextValue);
      return transact([PLAN_STORE, EVENT_STORE], 'readwrite', async (transaction) => {
        const plans = transaction.objectStore(PLAN_STORE);
        const loaded = await requestResult(plans.get(checkedId));
        const current = loaded ? assertMakerV8PackPublicationPlanV8(loaded) : null;
        if (!current || current.revision !== expectedRevision
          || successor.attemptId !== checkedId || successor.revision !== expectedRevision + 1) {
          fail('MAKER_V8_PACK_PUBLICATION_CAS_MISMATCH', 'Pack publication changed in another tab.');
        }
        if (event !== null) transaction.objectStore(EVENT_STORE).add(clone(assertEvent(event, current, successor)));
        plans.put(clone(successor));
        return successor;
      });
    },
    async listEvents(id) {
      const values = await transact([EVENT_STORE], 'readonly', (transaction) => (
        requestResult(transaction.objectStore(EVENT_STORE).index('byAttempt').getAll(attemptId(id)))
      ));
      return freeze(values.sort((left, right) => left.ordinal - right.ordinal || left.sequence - right.sequence));
    },
  });
}

export function createMakerV8PackPublicationMemoryPersistenceV8({ durable = true } = {}) {
  const plans = new Map();
  const events = [];
  return freeze({
    capabilities: freeze({ durable, atomicCas: true }),
    async requirePersistentStorage() {
      if (!durable) fail('MAKER_V8_PACK_PUBLICATION_PERSISTENCE_REQUIRED', 'Pack signing requires durable storage.');
      return true;
    },
    async create(value) {
      const plan = assertMakerV8PackPublicationPlanV8(value);
      if (plans.has(plan.attemptId)) fail('MAKER_V8_PACK_PUBLICATION_EXISTS', 'Pack attempt exists.');
      plans.set(plan.attemptId, clone(plan));
      return plan;
    },
    async load(id) {
      const value = plans.get(attemptId(id));
      return value ? assertMakerV8PackPublicationPlanV8(value) : null;
    },
    async listPlans(signer) {
      const owner = address(signer, 'signer');
      return freeze([...plans.values()].filter(value => value.immutable.signer === owner).map(assertMakerV8PackPublicationPlanV8));
    },
    async compareAndSwap(id, revision, next, { event = null } = {}) {
      const loaded = plans.get(attemptId(id));
      const current = loaded ? assertMakerV8PackPublicationPlanV8(loaded) : null;
      const successor = assertMakerV8PackPublicationPlanV8(next);
      if (!current || current.revision !== revision || successor.revision !== revision + 1) {
        fail('MAKER_V8_PACK_PUBLICATION_CAS_MISMATCH', 'Pack publication changed in another tab.');
      }
      if (event) events.push(clone(assertEvent(event, current, successor)));
      plans.set(id, clone(successor));
      return successor;
    },
    async listEvents(id) {
      return freeze(events.filter((event) => event.attemptId === id).map(clone));
    },
  });
}

export function createMakerV8PackPublicationControllerV8({
  persistence,
  compiler,
  boundary,
  wallet,
  rpc,
  oneShot = false,
  execution = { allowWalletSignature: false, allowBroadcast: false },
  now = () => Date.now(),
} = {}) {
  for (const method of ['requirePersistentStorage', 'create', 'load', 'compareAndSwap']) {
    requireMethod(persistence, method, 'persistence');
  }
  for (const method of ['prepare', 'rehydrate', 'certifyFinalized', 'prepareSuccessor']) {
    requireMethod(compiler, method, 'compiler');
  }
  for (const method of ['buildExactTransaction', 'dryRunExactTransaction', 'broadcastExactTransaction']) {
    requireMethod(boundary, method, 'boundary');
  }
  for (const method of ['signExactTransaction', 'verifyExactSignature']) requireMethod(wallet, method, 'wallet');
  requireMethod(rpc, 'queryTransaction', 'rpc');
  if (!plain(compiler.authority)) fail('MAKER_V8_PACK_PUBLICATION_COMPILER_INVALID', 'Pack compiler authority is required.');
  if (typeof oneShot !== 'boolean') {
    fail('MAKER_V8_PACK_PUBLICATION_MODE_INVALID', 'Pack publication one-shot mode must be a boolean.');
  }
  const gates = freeze({
    allowWalletSignature: execution.allowWalletSignature === true,
    allowBroadcast: execution.allowBroadcast === true,
  });
  if (gates.allowWalletSignature !== gates.allowBroadcast) {
    fail('MAKER_V8_PACK_PUBLICATION_EXECUTION_INVALID', 'Pack signing and broadcast gates must change together.');
  }
  const clock = (minimum = 0) => {
    const value = Number(now());
    if (!Number.isSafeInteger(value) || value < minimum) {
      fail('MAKER_V8_PACK_PUBLICATION_TIME_INVALID', 'Pack publication clock moved backwards.');
    }
    return value;
  };
  const assertQuery = (value, plan) => {
    const query = deterministic(value, 'Pack transaction query');
    exact(query, [
      'status', 'digest', 'epoch', 'effectsFingerprint', 'eventsDigest', 'error',
      'absence',
    ], 'Pack transaction query');
    if (!['NOT_FOUND', 'FINALIZED_SUCCESS', 'FINALIZED_FAILURE'].includes(query.status)
      || query.digest !== plan.current.outcome.digest) {
      fail('MAKER_V8_PACK_PUBLICATION_QUERY_INVALID', 'Pack finality query returned another status or digest.');
    }
    if (query.status === 'NOT_FOUND') {
      if (query.epoch !== null || query.effectsFingerprint !== null
        || query.eventsDigest !== null || query.error !== null) {
        fail('MAKER_V8_PACK_PUBLICATION_QUERY_INVALID', 'Pack NOT_FOUND query contains finalized evidence.');
      }
      query.absence = assertGrpcAbsence(
        query.absence,
        query.digest,
        plan.immutable.request.publicationInput.chainIdentifier,
      );
    } else if (query.absence !== null) {
      fail('MAKER_V8_PACK_PUBLICATION_QUERY_INVALID', 'Finalized Pack query contains absence evidence.');
    }
    return freeze(query);
  };
  const reread = async (expected) => {
    const value = await persistence.load(expected.attemptId);
    if (!value || !same(value, expected)) {
      fail('MAKER_V8_PACK_PUBLICATION_DURABLE_REREAD_FAILED', 'Pack publication write failed its cold reread.');
    }
    return value;
  };
  const cas = async (plan, next, event = null) => reread(await persistence.compareAndSwap(
    plan.attemptId, plan.revision, next, { event },
  ));
  const assertAttested = async (plan, attested, purpose) => {
    if (!plain(attested) || attested.authority !== compiler.authority
      || !(attested.transaction instanceof Transaction)) {
      fail('MAKER_V8_PACK_PUBLICATION_COMPILER_PROOF_REQUIRED', `${purpose} requires the exact in-process Pack compiler transaction.`);
    }
    const descriptor = assertDescriptor(attested.descriptor);
    if (!same(descriptor, plan.current.descriptor)) {
      fail('MAKER_V8_PACK_PUBLICATION_COMPILER_DRIFT', 'Rehydrated Pack descriptor differs from the durable cursor.');
    }
    const built = kindProof(await attested.transaction.build({ onlyTransactionKind: true }), plan.current.descriptor.stage);
    if (built.base64 !== descriptor.kindBytes || attested.transaction.getData().sender !== plan.immutable.signer) {
      fail('MAKER_V8_PACK_PUBLICATION_COMPILER_DRIFT', 'Rehydrated Pack transaction differs from the durable kind or signer.');
    }
    return freeze({ ...attested, descriptor });
  };
  const authorize = async (plan, purpose, requireFreshAuthority) => assertAttested(
    plan,
    await compiler.rehydrate({ plan: clone(plan), purpose, requireFreshAuthority }),
    purpose,
  );
  const verifyArtifact = async (plan) => {
    if (!plan.current.fullTransaction || !plan.current.signature || !plan.current.outcome.digest) {
      fail('MAKER_V8_PACK_PUBLICATION_ARTIFACT_REQUIRED', 'Pack cursor has no durable signed artifact.');
    }
    const proof = transactionDataProof(plan.current.fullTransaction, {
      signer: plan.immutable.signer,
      kindBytes: plan.current.descriptor.kindBytes,
      digest: plan.current.outcome.digest,
    });
    const verified = await wallet.verifyExactSignature({
      bytes: proof.base64,
      signature: plan.current.signature,
      digest: proof.digest,
      signer: plan.immutable.signer,
    });
    if (!verified || verified.verified === false) {
      fail('MAKER_V8_PACK_PUBLICATION_SIGNATURE_INVALID', 'Pack signature does not authenticate the durable TransactionData.');
    }
    return freeze({ ...proof, signature: plan.current.signature });
  };
  const pending = async (plan) => {
    if (plan.current.outcome.status === 'OUTCOME_PENDING') return plan;
    if (!['SIGNED', 'OUTCOME_UNKNOWN', 'BROADCAST_ACCEPTED'].includes(plan.current.outcome.status)) {
      fail('MAKER_V8_PACK_PUBLICATION_TRANSITION_INVALID', 'Pack cursor cannot enter query-first pending state.');
    }
    const at = clock(plan.updatedAt);
    const event = makeEvent(plan, 'OUTCOME_PENDING', at, { digest: plan.current.outcome.digest });
    const outcome = {
      status: 'OUTCOME_PENDING',
      digest: plan.current.outcome.digest,
      signedAt: plan.current.outcome.signedAt,
      firstSeenAt: plan.current.outcome.firstSeenAt ?? at,
      broadcastAt: plan.current.outcome.broadcastAt ?? null,
      observedAt: at,
      code: null,
      absence: null,
    };
    return cas(plan, assertMakerV8PackPublicationPlanV8(applyEvent(plan, event, outcome, at)), event);
  };
  const recover = async (id) => {
    await persistence.requirePersistentStorage();
    let plan = await persistence.load(id);
    if (!plan) fail('MAKER_V8_PACK_PUBLICATION_NOT_FOUND', 'Pack publication attempt was not found.');
    if (plan.status !== 'ACTIVE' || !plan.current) return plan;
    if (['SIGNED', 'OUTCOME_UNKNOWN', 'BROADCAST_ACCEPTED'].includes(plan.current.outcome.status)) {
      plan = await pending(plan);
    }
    if (plan.current.outcome.status !== 'OUTCOME_PENDING') return plan;
    let query;
    try {
      query = await rpc.queryTransaction({ digest: plan.current.outcome.digest });
    } catch (error) {
      const at = clock(plan.updatedAt);
      const event = makeEvent(plan, 'OUTCOME_UNKNOWN', at, {
        digest: plan.current.outcome.digest,
        code: typeof error?.code === 'string' ? error.code : 'PACK_RPC_UNKNOWN',
      });
      const outcome = {
        ...plan.current.outcome,
        status: 'OUTCOME_UNKNOWN',
        observedAt: at,
        code: event.code,
        absence: null,
      };
      return cas(plan, assertMakerV8PackPublicationPlanV8(applyEvent(plan, event, outcome, at)), event);
    }
    query = assertQuery(query, plan);
    if (query.status === 'NOT_FOUND') {
      const at = clock(plan.updatedAt);
      const event = makeEvent(plan, 'OUTCOME_PENDING', at, {
        digest: query.digest,
        code: 'TYPED_GRPC_NOT_FOUND',
        absence: query.absence,
      });
      const outcome = {
        ...plan.current.outcome,
        observedAt: at,
        code: event.code,
        absence: query.absence,
      };
      return cas(plan, assertMakerV8PackPublicationPlanV8(applyEvent(plan, event, outcome, at)), event);
    }
    const authorized = await authorize(plan, 'FINALIZED_RECOVERY', false);
    const artifact = await verifyArtifact(plan);
    const at = clock(plan.updatedAt);
    if (query.status === 'FINALIZED_FAILURE') {
      const event = makeEvent(plan, 'FINALIZED_FAILURE', at, { digest: artifact.digest, code: 'MOVE_FAILURE' });
      return cas(plan, assertMakerV8PackPublicationPlanV8({
        ...plan,
        revision: plan.revision + 1,
        status: 'FAILED',
        updatedAt: at,
        current: null,
        nextPreparation: null,
        terminal: { status: 'FAILED', digest: artifact.digest, at, query: deterministic(query, 'failure query') },
        eventHeadSha256: event.eventSha256,
      }), event);
    }
    const certified = await compiler.certifyFinalized({
      plan: clone(plan), query: deterministic(query, 'success query'),
      attested: authorized, artifact: clone(artifact),
    });
    exact(certified, ['authority', 'checkpoint', 'complete', 'chain'], 'Pack finalized certification');
    if (certified.authority !== compiler.authority || typeof certified.complete !== 'boolean'
      || certified.complete !== (authorized.descriptor.stage === 'FINALIZE')
      || certified.complete !== (certified.chain !== null)) {
      fail('MAKER_V8_PACK_PUBLICATION_CERTIFICATION_INVALID', 'Pack finality certification differs from its exact stage.');
    }
    const checkpoint = deterministic(certified.checkpoint, 'Pack checkpoint');
    if (checkpoint.ordinal !== authorized.descriptor.ordinal
      || checkpoint.stage !== authorized.descriptor.stage
      || checkpoint.digest !== artifact.digest
      || checkpoint.kindSha256 !== authorized.descriptor.kindSha256) {
      fail('MAKER_V8_PACK_PUBLICATION_CERTIFICATION_INVALID', 'Pack checkpoint does not bind its finalized cursor.');
    }
    const event = makeEvent(plan, 'FINALIZED_SUCCESS', at, { digest: artifact.digest });
    const next = assertMakerV8PackPublicationPlanV8({
      ...plan,
      revision: plan.revision + 1,
      status: certified.complete ? 'COMPLETE' : 'ACTIVE',
      updatedAt: at,
      current: null,
      head: checkpoint,
      nextPreparation: certified.complete ? null : {
        status: 'REQUIRED', ordinal: authorized.descriptor.ordinal + 1,
      },
      terminal: certified.complete ? {
        status: 'COMPLETE', digest: artifact.digest, at, chain: deterministic(certified.chain, 'Pack chain readback'),
      } : null,
      eventHeadSha256: event.eventSha256,
    });
    return cas(plan, next, event);
  };

  return freeze({
    schemaVersion: MAKER_V8_PACK_PUBLICATION_CONTROLLER_SCHEMA,
    execution: gates,
    async prepare(request) {
      await persistence.requirePersistentStorage();
      const immutableRequest = deterministic(request, 'Pack publication request');
      const prepared = await compiler.prepare(clone(immutableRequest));
      if (!plain(prepared) || prepared.authority !== compiler.authority
        || !(prepared.transaction instanceof Transaction)) {
        fail('MAKER_V8_PACK_PUBLICATION_PREPARE_INVALID', 'Pack compiler did not return one exact initial transaction.');
      }
      const descriptor = assertDescriptor(prepared.descriptor);
      const initialStage = oneShot ? 'FINALIZE' : 'INIT';
      if (descriptor.ordinal !== 0 || descriptor.stage !== initialStage) {
        fail(
          'MAKER_V8_PACK_PUBLICATION_PREPARE_INVALID',
          oneShot
            ? 'One-shot Pack action must begin and finish at FINALIZE ordinal 0.'
            : 'Pack publication must begin at INIT ordinal 0.',
        );
      }
      const at = clock();
      const plan = assertMakerV8PackPublicationPlanV8({
        schemaVersion: MAKER_V8_PACK_PUBLICATION_SCHEMA,
        attemptId: attemptId(prepared.attemptId),
        revision: 1,
        status: 'ACTIVE',
        createdAt: at,
        updatedAt: at,
        immutable: {
          request: immutableRequest,
          requestSha256: hashValue(immutableRequest),
          draftId: immutableRequest.draftId,
          draftRevision: immutableRequest.draftRevision,
          documentSha256: immutableRequest.documentSha256,
          signer: descriptor.signer,
        },
        current: {
          descriptor,
          fullTransaction: null,
          signature: null,
          outcome: { status: 'READY' },
          eventSequence: -1,
        },
        head: null,
        nextPreparation: null,
        terminal: null,
        eventHeadSha256: null,
      });
      await assertAttested(plan, prepared, 'PREPARE');
      const existing = await persistence.load(plan.attemptId);
      if (existing) {
        if (!same(existing.immutable, plan.immutable)) {
          fail('MAKER_V8_PACK_PUBLICATION_COLLISION', 'Pack attemptId is already bound to another immutable request.');
        }
        return existing;
      }
      return reread(await persistence.create(plan));
    },
    async resume(id) {
      await persistence.requirePersistentStorage();
      let plan = await persistence.load(id);
      if (!plan) fail('MAKER_V8_PACK_PUBLICATION_NOT_FOUND', 'Pack publication attempt was not found.');
      if (plan.status !== 'ACTIVE') return plan;
      if (plan.current && ['SIGNED', 'OUTCOME_PENDING', 'OUTCOME_UNKNOWN', 'BROADCAST_ACCEPTED']
        .includes(plan.current.outcome.status)) return recover(id);
      if (plan.current !== null) {
        await authorize(plan, 'READY_RESUME', false);
        return plan;
      }
      if (plan.nextPreparation?.status !== 'REQUIRED') return plan;
      const prepared = await compiler.prepareSuccessor({ plan: clone(plan), head: clone(plan.head) });
      if (!plain(prepared) || prepared.authority !== compiler.authority
        || !(prepared.transaction instanceof Transaction)) {
        fail('MAKER_V8_PACK_PUBLICATION_SUCCESSOR_INVALID', 'Pack compiler omitted one exact successor transaction.');
      }
      const descriptor = assertDescriptor(prepared.descriptor);
      if (descriptor.ordinal !== plan.nextPreparation.ordinal) {
        fail('MAKER_V8_PACK_PUBLICATION_SUCCESSOR_INVALID', 'Pack successor ordinal differs from the durable boundary.');
      }
      const next = assertMakerV8PackPublicationPlanV8({
        ...plan,
        revision: plan.revision + 1,
        updatedAt: clock(plan.updatedAt),
        current: { descriptor, fullTransaction: null, signature: null, outcome: { status: 'READY' }, eventSequence: -1 },
        nextPreparation: null,
      });
      await assertAttested(next, prepared, 'SUCCESSOR');
      return cas(plan, next);
    },
    async requestSignature(id) {
      if (!gates.allowWalletSignature || !gates.allowBroadcast) {
        fail('MAKER_V8_PACK_PUBLICATION_EXECUTION_DISABLED', 'Pack signing and exact-byte broadcast are disabled.');
      }
      await persistence.requirePersistentStorage();
      const plan = await persistence.load(id);
      if (!plan || plan.status !== 'ACTIVE' || plan.current?.outcome.status !== 'READY') {
        fail('MAKER_V8_PACK_PUBLICATION_NOT_READY', 'Only one durable READY Pack cursor may be signed.');
      }
      const authorized = await authorize(plan, 'REQUEST_SIGNATURE', true);
      const built = await boundary.buildExactTransaction({
        transaction: authorized.transaction,
        descriptor: authorized.descriptor,
        sender: plan.immutable.signer,
      });
      const proof = transactionDataProof(built.bytes ?? built.transactionBytes, {
        signer: plan.immutable.signer,
        kindBytes: authorized.descriptor.kindBytes,
        digest: built.digest ?? built.transactionDigest,
      });
      const simulated = await boundary.dryRunExactTransaction({
        transaction: authorized.transaction,
        descriptor: authorized.descriptor,
        transactionBytes: proof.base64,
        digest: proof.digest,
      });
      if (simulated?.status !== 'SUCCESS') {
        fail('MAKER_V8_PACK_PUBLICATION_DRY_RUN_FAILED', 'Exact Pack transaction simulation failed.');
      }
      const signed = await wallet.signExactTransaction({
        bytes: proof.base64, digest: proof.digest, signer: plan.immutable.signer,
      });
      if (!plain(signed) || signed.bytes !== proof.base64 || signed.digest !== proof.digest
        || signed.signer !== plan.immutable.signer) {
        fail('MAKER_V8_PACK_PUBLICATION_SIGNED_DRIFT', 'Wallet changed Pack TransactionData, digest, or signer.');
      }
      canonicalBase64(signed.signature, 'Pack signature');
      const verified = await wallet.verifyExactSignature(signed);
      if (!verified || verified.verified === false) {
        fail('MAKER_V8_PACK_PUBLICATION_SIGNATURE_INVALID', 'Pack signature verification failed before WAL commit.');
      }
      const at = clock(plan.updatedAt);
      const event = makeEvent(plan, 'SIGNED', at, { digest: proof.digest });
      const outcome = {
        status: 'SIGNED', digest: proof.digest, signedAt: at, firstSeenAt: null,
        broadcastAt: null, observedAt: at, code: null, absence: null,
      };
      const next = assertMakerV8PackPublicationPlanV8(applyEvent({
        ...plan,
        current: { ...plan.current, fullTransaction: signed.bytes, signature: signed.signature },
      }, event, outcome, at));
      return cas(plan, next, event);
    },
    recoverOutcome: recover,
    async replayExact(id) {
      if (!gates.allowBroadcast || !gates.allowWalletSignature) {
        fail('MAKER_V8_PACK_PUBLICATION_EXECUTION_DISABLED', 'Pack exact-byte replay is disabled.');
      }
      let plan = await recover(id);
      if (plan.status !== 'ACTIVE' || plan.current?.outcome.status !== 'OUTCOME_PENDING') return plan;
      assertGrpcAbsence(
        plan.current.outcome.absence,
        plan.current.outcome.digest,
        plan.immutable.request.publicationInput.chainIdentifier,
      );
      const authorized = await authorize(plan, 'EXACT_REPLAY', true);
      const artifact = await verifyArtifact(plan);
      await boundary.broadcastExactTransaction({
        bytes: artifact.base64, signature: artifact.signature,
        digest: artifact.digest, signer: plan.immutable.signer,
      });
      const at = clock(plan.updatedAt);
      const event = makeEvent(plan, 'BROADCAST_ACCEPTED', at, { digest: artifact.digest });
      const outcome = {
        ...plan.current.outcome,
        status: 'BROADCAST_ACCEPTED',
        broadcastAt: at,
        observedAt: at,
        code: null,
        absence: null,
      };
      plan = await cas(plan, assertMakerV8PackPublicationPlanV8(applyEvent(plan, event, outcome, at)), event);
      return recover(plan.attemptId);
    },
  });
}
