import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  IDBDatabase, IDBFactory, IDBIndex, IDBObjectStore,
} from 'fake-indexeddb';
import { Transaction } from '@mysten/sui/transactions';
import { toBase58, toBase64 } from '@mysten/sui/utils';

import { MAKER_V8_PUBLICATION_COMPILER_ABI } from '../maker-v8-compiler.js';
import {
  MAKER_V8_PUBLICATION_DATABASE,
  MAKER_V8_PUBLICATION_PERSISTENCE_SCHEMA,
  MAKER_V8_PUBLICATION_HISTORY_LIMITS,
  MAKER_V8_PUBLICATION_STORE_TRUST,
  assertMakerV8PublicationHistoryReserveV8,
  assertMakerV8PublicationCheckpointV8,
  assertMakerV8PublicationPlanIdentityV8,
  createMakerV8PublicationPersistenceV8,
  makerV8Base64BlobV8,
  makerV8BlobRefV8,
  makerV8PublicationAttemptIdV8,
  makerV8PublicationAttemptSha256V8,
  makerV8PublicationBlobRefsCommitmentV8,
  makerV8PublicationCheckpointSha256V8,
  makerV8PublicationCompilerAuthorityV8,
  makerV8PublicationPlanIdV8,
  makerV8PublicationScopeKeyV8,
  makerV8Utf8BlobV8,
} from '../maker-v8-publication-store.js';

const CHAIN = '35834a8a';
const COIN = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
const ROLES = ['core', 'seal', 'runtime', 'output', 'physical', 'market', 'release'];
const id = (byte) => `0x${byte.repeat(32)}`;
const hash = (byte) => byte.repeat(32);
const clone = (value) => structuredClone(value);
const TX_DIGEST = toBase58(new Uint8Array(32).fill(0xa5));
const OTHER_TX_DIGEST = toBase58(new Uint8Array(32).fill(0xa6));
const PERSISTENT_STORAGE = Object.freeze({
  async persisted() { return true; },
  async persist() { return true; },
});

async function publicationStore(indexedDB, options = {}) {
  const store = createMakerV8PublicationPersistenceV8(indexedDB, {
    ...options,
    storageManager: options.storageManager ?? PERSISTENT_STORAGE,
  });
  await store.requirePersistentStorage();
  return store;
}

async function compilerKindBase64(salt = 0) {
  const transaction = new Transaction();
  transaction.moveCall({
    target: `${id('11')}::core_v8::new_initial_maker_draft_v8`,
    arguments: [transaction.pure.u8(salt)],
  });
  return toBase64(await transaction.build({ onlyTransactionKind: true }));
}

function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}

function canonicalSha256(value) {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

function checkpointSha256(checkpoint) {
  const payload = { ...checkpoint };
  delete payload.checkpointSha256;
  return canonicalSha256(payload);
}

function attemptHead(attempt) {
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

function idbResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function idbDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => {};
  });
}

function within(promise, milliseconds = 1000) {
  let timeout;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error('IndexedDB operation timed out.')), milliseconds);
    }),
  ]).finally(() => clearTimeout(timeout));
}

function openRawDatabase(indexedDB, databaseName) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function addRawPublicationRows(database, rows) {
  const transaction = database.transaction(
    ['checkpoints', 'attempts', 'attemptHeads'],
    'readwrite',
  );
  const completion = idbDone(transaction);
  const checkpoints = transaction.objectStore('checkpoints');
  const attempts = transaction.objectStore('attempts');
  const heads = transaction.objectStore('attemptHeads');
  for (const row of rows) {
    checkpoints.add(row.checkpoint);
    for (const attempt of row.attempts) attempts.add(attempt);
    heads.add(row.attemptHead);
  }
  await completion;
}

function* derivedLimitTopology(kindBlob) {
  let ordinal = 0;
  yield cursor(kindBlob, ordinal++);
  for (let index = 0; index < MAKER_V8_PUBLICATION_HISTORY_LIMITS.maxBaseRows; index += 1) {
    yield cursor(kindBlob, ordinal++, {
      kind: 'BASE_CHUNK', phase: 'BASE_APPEND', lane: 'BASE', action: 'APPEND',
      startSequence: String(index), endSequence: String(index + 1), localIndex: index,
    });
  }
  yield cursor(kindBlob, ordinal++, {
    kind: 'BASE_CHUNK', phase: 'BASE_SEAL', lane: 'BASE', action: 'SEAL',
    startSequence: String(MAKER_V8_PUBLICATION_HISTORY_LIMITS.maxBaseRows),
    endSequence: String(MAKER_V8_PUBLICATION_HISTORY_LIMITS.maxBaseRows),
    localIndex: MAKER_V8_PUBLICATION_HISTORY_LIMITS.maxBaseRows,
  });
  yield cursor(kindBlob, ordinal++, {
    kind: 'COMPANION_OBJECTS', phase: 'COMPANION_OBJECTS', lane: 'COMPANION',
    action: 'CREATE', startSequence: '0', endSequence: '0', localIndex: 0,
  });
  let activationIndex = 0;
  const lanes = [
    ['SEAL', 500],
    ['RUNTIME', 750],
    ['OUTPUT', 256],
    ['PHYSICAL', 500],
  ];
  for (const [lane, rows] of lanes) {
    for (let index = 0; index < rows; index += 1) {
      yield cursor(kindBlob, ordinal++, {
        kind: 'ACTIVATION_CHUNK', phase: `ACTIVATION_${lane}_APPEND`, lane,
        action: 'APPEND', startSequence: String(index), endSequence: String(index + 1),
        localIndex: activationIndex++,
      });
    }
    yield cursor(kindBlob, ordinal++, {
      kind: 'ACTIVATION_CHUNK', phase: `ACTIVATION_${lane}_SEAL`, lane,
      action: 'SEAL', startSequence: String(rows), endSequence: String(rows),
      localIndex: activationIndex++,
    });
  }
  yield cursor(kindBlob, ordinal++, {
    kind: 'ACTIVATION_CHUNK', phase: 'ACTIVATION_FINALIZE', lane: 'FINALIZE',
    action: 'FINALIZE', startSequence: '0', endSequence: '0',
    localIndex: activationIndex,
  });
  assert.equal(ordinal, MAKER_V8_PUBLICATION_HISTORY_LIMITS.derivedMaximumCheckpoints);
}

function nearLimitCheckpoint(plan, descriptor, {
  previousCheckpointSha256, fullTransactionRef, signatureRef, finalizedAt,
}) {
  const readback = {
    schemaVersion: 'test',
    source: 'FINALIZED_RPC',
    transactionDigest: TX_DIGEST,
    transactionKindSha256: descriptor.transactionKindSha256,
  };
  const checkpoint = {
    schemaVersion: MAKER_V8_PUBLICATION_PERSISTENCE_SCHEMA,
    attemptId: plan.attemptId,
    planId: plan.planId,
    ordinal: descriptor.ordinal,
    kind: descriptor.kind,
    phase: descriptor.phase,
    lane: descriptor.lane,
    action: descriptor.action,
    startSequence: descriptor.startSequence,
    endSequence: descriptor.endSequence,
    rowCommitments: descriptor.rowCommitments,
    preState: descriptor.preState,
    postState: descriptor.postState,
    compilerCheckpoint: descriptor.compilerCheckpoint,
    transactionKindRef: descriptor.transactionKindRef,
    transactionKindSha256: descriptor.transactionKindSha256,
    commandCount: descriptor.commandCount,
    targets: descriptor.targets,
    fullTransactionRef,
    signatureRef,
    digest: TX_DIGEST,
    certificate: {
      source: 'FINALIZED_RPC',
      transactionDigest: TX_DIGEST,
      transactionKindSha256: descriptor.transactionKindSha256,
      readbackSha256: canonicalSha256(readback),
    },
    readback,
    submissionSource: 'WALLET',
    checkpointSha256: hash('00'),
    previousCheckpointSha256,
    finalizedAt,
  };
  checkpoint.checkpointSha256 = checkpointSha256(checkpoint);
  return checkpoint;
}

function nearLimitAttempts(plan, descriptor, {
  fullTransactionRef, signatureRef, previousGlobalAttemptSha256, signedAt,
}) {
  const seed = {
    attemptId: plan.attemptId,
    current: descriptor,
    attemptHistory: { globalAttemptHeadSha256: previousGlobalAttemptSha256 },
  };
  const signed = event(seed, 'SIGNED', 0, {
    fullTransactionRef, signatureRef, at: signedAt,
  });
  const pending = event(seed, 'OUTCOME_PENDING', 1, {
    fullTransactionRef, signatureRef, at: signedAt + 1,
    previousAttempt: signed,
    previousGlobalAttemptSha256: signed.eventSha256,
  });
  const success = event(seed, 'FINALIZED_SUCCESS', 2, {
    fullTransactionRef, signatureRef, at: signedAt + 2,
    previousAttempt: pending,
    previousGlobalAttemptSha256: pending.eventSha256,
  });
  return [signed, pending, success];
}

async function authority() {
  const packageTuple = ROLES.map((role, index) => ({
    role,
    originalPackageId: id(`${index + 1}${index + 1}`),
    callablePackageId: id(`${index + 1}${index + 1}`),
    packageDigest: String(index + 2).repeat(44),
    sourceCommitment: hash('1a'),
    packageCommitment: hash('2a'),
    abiCommitment: hash('3a'),
    bindingCommitment: hash('4a'),
  }));
  const configRoles = ['seal', 'runtime', 'output', 'physical', 'market', 'release'];
  const configs = Object.fromEntries(configRoles.map((role, index) => {
    const fields = {
      version: 8,
      catalogId: id('80'),
      productBindingCommitment: hash('5d'),
      callCapSetCommitment: hash('6d'),
      authorityId: id(`${index + 1}a`),
    };
    if (role === 'seal') Object.assign(fields, {
      commitment: hash('7d'),
      keyServerIds: [id('a1')],
      weights: [1],
      threshold: 1,
      keyServerSetCommitment: hash('8d'),
      encryptionPolicyCommitment: hash('9d'),
    });
    return [role, { objectId: id(`${index + 1}b`), fields }];
  }));
  return makerV8PublicationCompilerAuthorityV8({
    schemaVersion: 'animacraft.maker-v8-publication-authority.v1',
    protocolProfile: {
      protocolVersion: '133',
      objectRuntimeMaxNumCachedObjects: '1000',
      objectRuntimeMaxNumStoreEntries: '1000',
    },
    coreArtifact: {
      callablePackageId: packageTuple[0].callablePackageId,
      packageDigest: packageTuple[0].packageDigest,
      baseRegistryModuleSha256: '89ecbd9e3640ab218f92094c516d05d7efdacac4a12c56630759354af8d1bbc7',
    },
    packageTuple,
    protocolConfig: { objectId: id('81'), revision: '3', commitment: hash('4d') },
    catalog: {
      objectId: id('80'), protocolConfigId: id('81'), protocolConfigRevision: '3',
      protocolConfigCommitment: hash('4d'), productBindingCommitment: hash('5d'),
      callCapSetCommitment: hash('6d'),
    },
    configs,
    sealPolicyCommitment: hash('7d'),
    compilerAbi: Object.fromEntries(ROLES.map((role, index) => [
      role,
      MAKER_V8_PUBLICATION_COMPILER_ABI[role]
        .map((suffix) => `${packageTuple[index].callablePackageId}::${suffix}`),
    ])),
  });
}

function cursor(kindBlob, ordinal = 0, options = {}) {
  const kind = options.kind ?? (ordinal === 0 ? 'SCAFFOLD' : 'BASE_CHUNK');
  const phase = options.phase ?? (kind === 'SCAFFOLD' ? 'SCAFFOLD' : 'BASE_APPEND');
  const lane = options.lane ?? (kind === 'SCAFFOLD' ? 'SCAFFOLD'
    : kind === 'BASE_CHUNK' ? 'BASE'
      : kind === 'COMPANION_OBJECTS' ? 'COMPANION'
        : phase === 'ACTIVATION_FINALIZE' ? 'FINALIZE' : phase.split('_')[1]);
  const action = options.action ?? (kind === 'SCAFFOLD' || kind === 'COMPANION_OBJECTS' ? 'CREATE'
    : kind === 'BASE_CHUNK' ? phase === 'BASE_SEAL' ? 'SEAL' : 'APPEND'
      : phase === 'ACTIVATION_FINALIZE' ? 'FINALIZE' : phase.split('_')[2]);
  const startSequence = options.startSequence ?? '0';
  const endSequence = options.endSequence ?? (kind === 'BASE_CHUNK' && phase === 'BASE_APPEND' ? '1' : '0');
  const localIndex = options.localIndex ?? (kind === 'BASE_CHUNK' ? ordinal - 1 : 0);
  let compilerCheckpoint;
  if (kind === 'SCAFFOLD' || kind === 'COMPANION_OBJECTS') {
    compilerCheckpoint = {
      schemaVersion: kind === 'SCAFFOLD'
        ? 'animacraft.maker-v8-scaffold-checkpoint.v1'
        : 'animacraft.maker-v8-companion-checkpoint.v1',
      phase, lane, action, index: 0, startSequence: '0', endSequence: '0', final: true,
    };
  } else if (kind === 'BASE_CHUNK') {
    compilerCheckpoint = {
      schemaVersion: 'animacraft.maker-v8-base-checkpoint.v1',
      phase, lane, index: localIndex, startSequence, endSequence,
      final: phase === 'BASE_SEAL', expected: {}, metrics: {},
    };
  } else {
    compilerCheckpoint = {
      schemaVersion: 'animacraft.maker-v8-activation-checkpoint.v1',
      phase, lane, action, index: localIndex, startSequence, endSequence,
      final: phase === 'ACTIVATION_FINALIZE', expected: {}, metrics: {},
    };
  }
  const ref = makerV8BlobRefV8(kindBlob);
  return {
    ordinal,
    kind,
    phase,
    lane,
    action,
    startSequence,
    endSequence,
    rowCommitments: [],
    preState: { contentCommitment: hash('cc') },
    postState: { contentCommitment: hash('cc'), nextSequence: String(ordinal) },
    compilerCheckpoint,
    transactionKindRef: ref,
    transactionKindSha256: ref.sha256,
    commandCount: 1,
    targets: [`${id('11')}::core_v8::new_initial_maker_draft_v8`],
    fullTransactionRef: null,
    signatureRef: null,
    outcome: { status: 'READY' },
  };
}

async function planFixture({
  makerKey = 'maker', nonce = '1:first', kindSalt = 0,
} = {}) {
  const kindBase64 = await compilerKindBase64(kindSalt);
  const [documentBlob, metadataBlob, compilerContextBlob, kindBlob] = await Promise.all([
    makerV8Utf8BlobV8('{"schemaVersion":"animacraft.maker.v8"}'),
    makerV8Utf8BlobV8('{"schemaVersion":"animacraft.maker-v8-author-transport-metadata.v1","assets":[]}'),
    makerV8Utf8BlobV8('{"schemaVersion":"animacraft.maker-v8-compiler-context-snapshot.v1"}'),
    makerV8Base64BlobV8(kindBase64),
  ]);
  const blobRefs = {
    document: makerV8BlobRefV8(documentBlob),
    transportMetadata: makerV8BlobRefV8(metadataBlob),
    compilerContext: makerV8BlobRefV8(compilerContextBlob),
    assets: [],
  };
  const compilerAuthority = await authority();
  const immutable = {
    chainIdentifier: CHAIN,
    paymentCoinType: COIN,
    signerAddress: id('90'),
    makerKey,
    manifestSha256: hash('aa'),
    contentCommitment: hash('cc'),
    protocolProfileCommitment: '47a00c7f70f9359a3e1f28e301c51705ff6ce4d5912dde65685015a8bb2f8457',
    coreArtifactCommitment: await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(JSON.stringify({
        baseRegistryModuleSha256: compilerAuthority.coreArtifact.baseRegistryModuleSha256,
        callablePackageId: compilerAuthority.coreArtifact.callablePackageId,
        packageDigest: compilerAuthority.coreArtifact.packageDigest,
        schemaVersion: 'animacraft.maker-v8-core-artifact.v1',
      })),
    ).then((bytes) => [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('')),
    blobRefsCommitment: await makerV8PublicationBlobRefsCommitmentV8(blobRefs),
    compilerAuthority,
  };
  const scopeKey = await makerV8PublicationScopeKeyV8(immutable);
  const planId = await makerV8PublicationPlanIdV8(immutable);
  const attemptId = await makerV8PublicationAttemptIdV8({ planId, scopeKey, attemptNonce: nonce });
  const plan = {
    schemaVersion: MAKER_V8_PUBLICATION_PERSISTENCE_SCHEMA,
    attemptId,
    attemptNonce: nonce,
    planId,
    scopeKey,
    status: 'ACTIVE',
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
    immutable,
    blobRefs,
    attemptHistory: { totalEvents: 0, excessEvents: 0, globalAttemptHeadSha256: null },
    head: null,
    current: cursor(kindBlob),
    nextPreparation: null,
    terminal: null,
  };
  await assertMakerV8PublicationPlanIdentityV8(plan);
  return {
    plan,
    blobs: [documentBlob, metadataBlob, compilerContextBlob, kindBlob],
    kindBlob,
  };
}

function event(plan, status, sequence, {
  digest = TX_DIGEST, fullTransactionRef = null, signatureRef = null,
  source = 'WALLET', code = undefined, at = sequence + 2,
  previousAttempt = null,
  previousAttemptSha256 = sequence === 0 ? null : hash('ee'),
  previousGlobalAttemptSha256 = plan.attemptHistory.globalAttemptHeadSha256,
} = {}) {
  const outcomeCode = code === undefined ? {
    WALLET_REJECTED: 'WALLET_REJECTED',
    OUTCOME_UNKNOWN: 'RPC_OUTCOME_UNKNOWN',
    FINALIZED_FAILURE: 'MAKER_V8_COMPILER_TRANSACTION_FAILED',
  }[status] ?? null : code;
  const signedAt = status === 'SIGNED' ? at
    : status === 'WALLET_REJECTED' || source === 'EXTERNAL_FINALIZED'
      ? null : previousAttempt?.details.signedAt ?? Math.max(0, at - 1);
  const firstSeenAt = ['SIGNED', 'WALLET_REJECTED'].includes(status) ? null
    : previousAttempt?.details.firstSeenAt ?? at;
  const broadcastAt = status === 'BROADCAST_ACCEPTED' ? at
    : previousAttempt?.details.broadcastAt ?? null;
  const value = {
    schemaVersion: MAKER_V8_PUBLICATION_PERSISTENCE_SCHEMA,
    attemptId: plan.attemptId,
    ordinal: plan.current.ordinal,
    sequence,
    status,
    digest,
    kindSha256: plan.current.transactionKindSha256,
    fullTransactionRef,
    signatureRef,
    details: { source, at, code: outcomeCode, signedAt, firstSeenAt, broadcastAt },
    observedAt: at,
    previousAttemptSha256: previousAttempt?.eventSha256 ?? previousAttemptSha256,
    previousGlobalAttemptSha256,
    eventSha256: hash('00'),
  };
  value.eventSha256 = makerV8PublicationAttemptSha256V8(value);
  return value;
}

function rehashAttemptEvents(events) {
  const heads = new Map();
  let globalHead = null;
  for (const entry of events) {
    const previous = heads.get(entry.ordinal) ?? null;
    if (entry.status === 'SIGNED') {
      Object.assign(entry.details, { signedAt: entry.details.at, firstSeenAt: null, broadcastAt: null });
    } else if (entry.status === 'WALLET_REJECTED') {
      Object.assign(entry.details, { signedAt: null, firstSeenAt: null, broadcastAt: null });
    } else if (entry.details.source === 'EXTERNAL_FINALIZED') {
      Object.assign(entry.details, {
        signedAt: null,
        firstSeenAt: previous?.details.firstSeenAt ?? entry.details.at,
        broadcastAt: null,
      });
    } else {
      Object.assign(entry.details, {
        signedAt: previous?.details.signedAt ?? entry.details.at,
        firstSeenAt: previous?.details.firstSeenAt ?? entry.details.at,
        broadcastAt: entry.status === 'BROADCAST_ACCEPTED'
          ? entry.details.at : previous?.details.broadcastAt ?? null,
      });
    }
    entry.previousAttemptSha256 = previous?.eventSha256 ?? null;
    entry.previousGlobalAttemptSha256 = globalHead?.eventSha256 ?? null;
    entry.eventSha256 = makerV8PublicationAttemptSha256V8(entry);
    heads.set(entry.ordinal, entry);
    globalHead = entry;
  }
  return events;
}

function rehashAttemptLinks(events) {
  const localHeads = new Map();
  let globalHead = null;
  for (const entry of events) {
    const local = localHeads.get(entry.ordinal) ?? null;
    entry.previousAttemptSha256 = local?.eventSha256 ?? null;
    entry.previousGlobalAttemptSha256 = globalHead?.eventSha256 ?? null;
    entry.eventSha256 = makerV8PublicationAttemptSha256V8(entry);
    localHeads.set(entry.ordinal, entry);
    globalHead = entry;
  }
  return events;
}

function withAttemptHistory(plan, attempt) {
  return {
    totalEvents: plan.attemptHistory.totalEvents + 1,
    excessEvents: plan.attemptHistory.excessEvents + (attempt.sequence >= 3 ? 1 : 0),
    globalAttemptHeadSha256: attempt.eventSha256,
  };
}

async function signedPath(store, fixture) {
  const full = await makerV8Base64BlobV8('AQ==');
  const signature = await makerV8Base64BlobV8('Ag==');
  const fullRef = makerV8BlobRefV8(full);
  const signatureRef = makerV8BlobRefV8(signature);
  let plan = fixture.plan;
  const signedAt = plan.updatedAt + 1;
  const signedEvent = event(plan, 'SIGNED', 0, {
    fullTransactionRef: fullRef, signatureRef, at: signedAt,
  });
  plan = await store.compareAndSwap(plan.attemptId, plan.revision, {
    ...plan,
    revision: plan.revision + 1,
    updatedAt: signedAt,
    attemptHistory: withAttemptHistory(plan, signedEvent),
    current: {
      ...plan.current,
      fullTransactionRef: fullRef,
      signatureRef,
      outcome: {
        status: 'SIGNED', digest: TX_DIGEST, kindSha256: plan.current.transactionKindSha256, signedAt,
      },
    },
  }, {
    attempt: signedEvent,
    blobs: [full, signature],
  });
  const pendingAt = plan.updatedAt + 1;
  const pendingEvent = event(plan, 'OUTCOME_PENDING', 1, {
    fullTransactionRef: fullRef,
    signatureRef,
    at: pendingAt,
    previousAttemptSha256: signedEvent.eventSha256,
    previousAttempt: signedEvent,
  });
  plan = await store.compareAndSwap(plan.attemptId, plan.revision, {
    ...plan,
    revision: plan.revision + 1,
    updatedAt: pendingAt,
    attemptHistory: withAttemptHistory(plan, pendingEvent, signedEvent),
    current: {
      ...plan.current,
      outcome: {
        status: 'OUTCOME_PENDING', digest: TX_DIGEST,
        kindSha256: plan.current.transactionKindSha256,
        signedAt, firstSeenAt: pendingAt, source: 'WALLET',
        broadcastAt: null, observedAt: pendingAt,
      },
    },
  }, {
    attempt: pendingEvent,
  });
  return { plan, fullRef, signatureRef, lastAttempt: pendingEvent };
}

async function finalizationRequest(signed, {
  complete = false,
  submissionSource = signed.fullRef === null ? 'EXTERNAL_FINALIZED' : 'WALLET',
  successSequence = submissionSource === 'EXTERNAL_FINALIZED' ? 1 : 2,
} = {}) {
  const { plan, fullRef, signatureRef } = signed;
  const finalizedAt = plan.updatedAt + 1;
  const readback = {
    schemaVersion: 'test',
    source: 'FINALIZED_RPC',
    transactionDigest: TX_DIGEST,
    transactionKindSha256: plan.current.transactionKindSha256,
  };
  const readbackSha256 = (await makerV8Utf8BlobV8(canonical(readback))).sha256;
  const checkpoint = {
    schemaVersion: MAKER_V8_PUBLICATION_PERSISTENCE_SCHEMA,
    attemptId: plan.attemptId,
    planId: plan.planId,
    ordinal: plan.current.ordinal,
    kind: plan.current.kind,
    phase: plan.current.phase,
    lane: plan.current.lane,
    action: plan.current.action,
    startSequence: plan.current.startSequence,
    endSequence: plan.current.endSequence,
    rowCommitments: plan.current.rowCommitments,
    preState: plan.current.preState,
    postState: plan.current.postState,
    compilerCheckpoint: plan.current.compilerCheckpoint,
    transactionKindRef: plan.current.transactionKindRef,
    transactionKindSha256: plan.current.transactionKindSha256,
    commandCount: plan.current.commandCount,
    targets: plan.current.targets,
    fullTransactionRef: fullRef,
    signatureRef,
    digest: TX_DIGEST,
    certificate: {
      source: 'FINALIZED_RPC',
      transactionDigest: TX_DIGEST,
      transactionKindSha256: plan.current.transactionKindSha256,
      readbackSha256,
    },
    readback,
    submissionSource,
    checkpointSha256: hash('00'),
    previousCheckpointSha256: plan.head?.checkpointSha256 ?? null,
    finalizedAt,
  };
  checkpoint.checkpointSha256 = await makerV8PublicationCheckpointSha256V8(checkpoint);
  const successAttempt = event(plan, 'FINALIZED_SUCCESS', successSequence, {
    fullTransactionRef: fullRef,
    signatureRef,
    source: submissionSource,
    at: finalizedAt,
    previousAttempt: signed.lastAttempt,
  });
  const next = {
    ...plan,
    revision: plan.revision + 1,
    updatedAt: finalizedAt,
    attemptHistory: withAttemptHistory(plan, successAttempt, signed.lastAttempt),
    status: complete ? 'COMPLETE' : 'ACTIVE',
    head: {
      ordinal: checkpoint.ordinal,
      digest: checkpoint.digest,
      transactionKindSha256: checkpoint.transactionKindSha256,
      checkpointSha256: checkpoint.checkpointSha256,
      phase: checkpoint.phase,
      lane: checkpoint.lane,
    },
    current: null,
    nextPreparation: complete ? null : { status: 'REQUIRED', ordinal: checkpoint.ordinal + 1, reason: null },
    terminal: complete ? { status: 'COMPLETE', reason: 'ACTIVATION_FINALIZED', at: finalizedAt } : null,
  };
  const options = {
    checkpoint,
    attempt: successAttempt,
  };
  return { next, options };
}

async function finalize(store, signed, options = {}) {
  const request = await finalizationRequest(signed, options);
  return store.compareAndSwap(
    signed.plan.attemptId,
    signed.plan.revision,
    request.next,
    request.options,
  );
}

async function prepareNext(store, plan, _kindLabel, options) {
  const kindBlob = await makerV8Base64BlobV8(
    await compilerKindBase64((plan.head.ordinal + 1) % 256),
  );
  const current = cursor(kindBlob, plan.head.ordinal + 1, options);
  const next = await store.compareAndSwap(plan.attemptId, plan.revision, {
    ...plan,
    revision: plan.revision + 1,
    updatedAt: plan.updatedAt + 1,
    current,
    nextPreparation: null,
  }, { blobs: [kindBlob] });
  return { plan: next, kindBlob };
}

test('real IndexedDB atomically appends signed attempts and success head before successor preparation', async () => {
  const indexedDB = new IDBFactory();
  const store = await publicationStore(indexedDB, { databaseName: 'publication-atomic' });
  const fixture = await planFixture();
  await store.createAttempt(fixture.plan, fixture.blobs);
  const signed = await signedPath(store, fixture);
  const finalized = await finalize(store, signed);
  assert.equal(finalized.current, null);
  assert.equal(finalized.nextPreparation.status, 'REQUIRED');
  const head = await store.loadHead(finalized.attemptId);
  assert.equal(head.digest, TX_DIGEST);
  assert.equal((await store.loadAttemptHead(finalized.attemptId, 0)).status, 'FINALIZED_SUCCESS');

  const nextKind = await makerV8Base64BlobV8(await compilerKindBase64(1));
  const successor = cursor(nextKind, 1);
  const advanced = await store.compareAndSwap(finalized.attemptId, finalized.revision, {
    ...finalized,
    revision: finalized.revision + 1,
    updatedAt: 5,
    current: successor,
    nextPreparation: null,
  }, { blobs: [nextKind] });
  assert.equal(advanced.current.ordinal, 1);
  assert.equal(advanced.head.ordinal, 0);
});

test('success CAS stops at the exact non-final boundary and only final Activation may complete', async () => {
  const indexedDB = new IDBFactory();

  const scaffoldStore = await publicationStore(indexedDB, {
    databaseName: 'publication-success-boundary-scaffold',
  });
  const scaffold = await planFixture();
  await scaffoldStore.createAttempt(scaffold.plan, scaffold.blobs);
  const signedScaffold = await signedPath(scaffoldStore, scaffold);
  await assert.rejects(
    finalize(scaffoldStore, signedScaffold, { complete: true }),
    { code: 'MAKER_V8_PUBLICATION_SUCCESS_BOUNDARY_INVALID' },
  );

  const retiredRequest = await finalizationRequest(signedScaffold);
  retiredRequest.next.status = 'RELEASE_RETIRED';
  retiredRequest.next.nextPreparation = {
    status: 'BLOCKED', ordinal: retiredRequest.options.checkpoint.ordinal + 1, reason: 'PROFILE_UNMEASURED',
  };
  retiredRequest.next.terminal = {
    status: 'RELEASE_RETIRED', reason: 'PROFILE_UNMEASURED', at: 4,
  };
  await assert.rejects(
    scaffoldStore.compareAndSwap(
      signedScaffold.plan.attemptId,
      signedScaffold.plan.revision,
      retiredRequest.next,
      retiredRequest.options,
    ),
    { code: 'MAKER_V8_PUBLICATION_SUCCESS_BOUNDARY_INVALID' },
  );

  let published = await finalize(scaffoldStore, signedScaffold);
  const stages = [
    ['AQ==', { kind: 'BASE_CHUNK', phase: 'BASE_SEAL', localIndex: 0 }],
    ['Ag==', { kind: 'COMPANION_OBJECTS', phase: 'COMPANION_OBJECTS' }],
    ['Aw==', { kind: 'ACTIVATION_CHUNK', phase: 'ACTIVATION_SEAL_SEAL', localIndex: 0 }],
    ['BA==', { kind: 'ACTIVATION_CHUNK', phase: 'ACTIVATION_RUNTIME_SEAL', localIndex: 1 }],
    ['BQ==', { kind: 'ACTIVATION_CHUNK', phase: 'ACTIVATION_OUTPUT_SEAL', localIndex: 2 }],
    ['Bg==', { kind: 'ACTIVATION_CHUNK', phase: 'ACTIVATION_PHYSICAL_SEAL', localIndex: 3 }],
    ['Bw==', { kind: 'ACTIVATION_CHUNK', phase: 'ACTIVATION_FINALIZE', localIndex: 4 }],
  ];
  for (const [kindBase64, options] of stages) {
    const prepared = await prepareNext(scaffoldStore, published, kindBase64, options);
    const signed = await signedPath(scaffoldStore, prepared);
    if (options.phase === 'ACTIVATION_FINALIZE') {
      await assert.rejects(
        finalize(scaffoldStore, signed),
        { code: 'MAKER_V8_PUBLICATION_SUCCESS_BOUNDARY_INVALID' },
      );
      published = await finalize(scaffoldStore, signed, { complete: true });
    } else {
      published = await finalize(scaffoldStore, signed);
    }
  }
  const completed = published;
  assert.equal(completed.status, 'COMPLETE');
  assert.equal(completed.current, null);
  assert.equal(completed.nextPreparation, null);
});

test('finalized checkpoint binds exact RPC readback, kind, digest, and submission provenance', async () => {
  const indexedDB = new IDBFactory();
  const store = await publicationStore(indexedDB, { databaseName: 'publication-finalized-evidence' });
  const fixture = await planFixture();
  await store.createAttempt(fixture.plan, fixture.blobs);
  const signed = await signedPath(store, fixture);
  const valid = await finalizationRequest(signed);

  for (const mutate of [
    (checkpoint) => { checkpoint.readback.source = 'LATEST_RPC'; },
    (checkpoint) => { checkpoint.readback.transactionDigest = OTHER_TX_DIGEST; },
    (checkpoint) => { checkpoint.readback.transactionKindSha256 = hash('fe'); },
    (checkpoint) => { checkpoint.certificate.readbackSha256 = hash('fd'); },
    (checkpoint) => { checkpoint.submissionSource = 'EXTERNAL_FINALIZED'; },
  ]) {
    const options = clone(valid.options);
    mutate(options.checkpoint);
    await assert.rejects(
      store.compareAndSwap(signed.plan.attemptId, signed.plan.revision, clone(valid.next), options),
      { code: 'MAKER_V8_PUBLICATION_FINALIZED_EVIDENCE_INVALID' },
    );
  }

  const externalStore = await publicationStore(indexedDB, {
    databaseName: 'publication-finalized-external',
  });
  const externalFixture = await planFixture();
  await externalStore.createAttempt(externalFixture.plan, externalFixture.blobs);
  const externalPending = clone(externalFixture.plan);
  externalPending.revision = 2;
  externalPending.updatedAt = 2;
  externalPending.current.outcome = {
    status: 'OUTCOME_PENDING', digest: TX_DIGEST,
    kindSha256: externalPending.current.transactionKindSha256,
    signedAt: null, firstSeenAt: 2, source: 'EXTERNAL_FINALIZED',
    broadcastAt: null, observedAt: 2,
  };
  const externalPendingEvent = event(externalFixture.plan, 'EXTERNAL_PENDING', 0, {
    source: 'EXTERNAL_FINALIZED', at: 2,
  });
  externalPending.attemptHistory = withAttemptHistory(externalFixture.plan, externalPendingEvent);
  const pending = await externalStore.compareAndSwap(externalPending.attemptId, 1, externalPending, {
    attempt: externalPendingEvent,
  });
  const externalFinal = await finalize(externalStore, {
    plan: pending, fullRef: null, signatureRef: null, lastAttempt: externalPendingEvent,
  });
  assert.equal(externalFinal.head.digest, TX_DIGEST);
  assert.equal((await externalStore.loadHead(externalFinal.attemptId)).submissionSource, 'EXTERNAL_FINALIZED');
});

test('CAS rejects forged checkpoint hashes, head drift, dangling refs, and invalid attempt bindings', async () => {
  const indexedDB = new IDBFactory();
  const store = await publicationStore(indexedDB, { databaseName: 'publication-attacks' });
  const fixture = await planFixture();
  await store.createAttempt(fixture.plan, fixture.blobs);
  const forged = clone(fixture.plan);
  forged.revision = 2;
  forged.updatedAt = 2;
  forged.current.transactionKindRef = { ...forged.current.transactionKindRef, sha256: hash('fe') };
  forged.current.transactionKindSha256 = hash('fe');
  await assert.rejects(
    store.compareAndSwap(forged.attemptId, 1, forged),
    (error) => /BLOB_MISSING|CURSOR_DRIFT/.test(error.code),
  );

  const signed = await signedPath(store, fixture);
  const badAttempt = event(signed.plan, 'FINALIZED_FAILURE', 2, {
    fullTransactionRef: signed.fullRef, signatureRef: signed.signatureRef, at: 4,
    previousAttempt: signed.lastAttempt,
  });
  badAttempt.ordinal = 999;
  badAttempt.eventSha256 = makerV8PublicationAttemptSha256V8(badAttempt);
  const failed = clone(signed.plan);
  failed.revision += 1;
  failed.updatedAt = 4;
  failed.attemptHistory = withAttemptHistory(signed.plan, badAttempt, signed.lastAttempt);
  failed.current.outcome = {
    status: 'FINALIZED_FAILURE', digest: TX_DIGEST,
    kindSha256: failed.current.transactionKindSha256,
    signedAt: 2, firstSeenAt: 3, broadcastAt: null, observedAt: 4,
    failureCode: 'MAKER_V8_COMPILER_TRANSACTION_FAILED', source: 'WALLET',
  };
  await assert.rejects(
    store.compareAndSwap(failed.attemptId, signed.plan.revision, failed, { attempt: badAttempt }),
    { code: 'MAKER_V8_PUBLICATION_ATTEMPT_BINDING_INVALID' },
  );

  for (const invalidDigest of ['0OIl', toBase58(new Uint8Array(31).fill(4)), ` ${TX_DIGEST}`]) {
    const invalid = clone(signed.plan);
    invalid.current.outcome.digest = invalidDigest;
    await assert.rejects(
      assertMakerV8PublicationPlanIdentityV8(invalid),
      { code: 'MAKER_V8_PUBLICATION_SUI_DIGEST_INVALID' },
    );
  }

  const external = clone(signed.plan);
  external.revision += 1;
  external.updatedAt = 4;
  external.current.fullTransactionRef = null;
  external.current.signatureRef = null;
  external.current.outcome = {
    status: 'OUTCOME_PENDING', digest: toBase58(new Uint8Array(31).fill(9)),
    kindSha256: external.current.transactionKindSha256,
    signedAt: null, firstSeenAt: 4, source: 'EXTERNAL_FINALIZED',
    broadcastAt: null, observedAt: 4,
  };
  const invalidExternalEvent = event(signed.plan, 'EXTERNAL_PENDING', 2, {
    digest: external.current.outcome.digest,
    source: 'EXTERNAL_FINALIZED', at: 4,
    previousAttempt: signed.lastAttempt,
  });
  external.attemptHistory = withAttemptHistory(signed.plan, invalidExternalEvent, signed.lastAttempt);
  await assert.rejects(
    store.compareAndSwap(external.attemptId, signed.plan.revision, external, {
      attempt: invalidExternalEvent,
    }),
    { code: 'MAKER_V8_PUBLICATION_SUI_DIGEST_INVALID' },
  );
});

test('terminal attempts release only the active index and preserve shared blobs, export, import, and restore', async () => {
  const indexedDB = new IDBFactory();
  const store = await publicationStore(indexedDB, { databaseName: 'publication-terminal' });
  const fixture = await planFixture();
  await store.createAttempt(fixture.plan, fixture.blobs);
  const finalized = await finalize(store, await signedPath(store, fixture));
  const abandoned = await store.compareAndSwap(finalized.attemptId, finalized.revision, {
    ...finalized,
    status: 'ABANDONED_RECOVERABLE',
    revision: finalized.revision + 1,
    updatedAt: 5,
    nextPreparation: {
      ...finalized.nextPreparation,
      status: 'BLOCKED',
      reason: 'USER_REQUESTED',
    },
    terminal: { status: 'ABANDONED_RECOVERABLE', reason: 'USER_REQUESTED', at: 5 },
  });
  assert.equal(await store.loadActive(abandoned.scopeKey), null);
  assert.equal((await store.listAttemptsByScope(abandoned.scopeKey)).length, 1);
  const bundle = await store.exportAttempt(abandoned.attemptId);
  assert.ok(bundle.blobs.length >= 5);
  const restored = await store.restoreAttempt(abandoned.attemptId, abandoned.revision, 6);
  assert.equal(restored.status, 'ACTIVE');
  assert.equal((await store.loadActive(restored.scopeKey)).attemptId, restored.attemptId);

  const importedDb = new IDBFactory();
  const imported = await publicationStore(importedDb, { databaseName: 'publication-import' });
  const terminalBundle = clone(bundle);
  await imported.importAttempt(terminalBundle);
  await imported.importAttempt(clone(terminalBundle));
  assert.equal((await imported.exportAttempt(abandoned.attemptId)).blobs.length, bundle.blobs.length);
  terminalBundle.blobs[0].data += 'tamper';
  await assert.rejects(imported.importAttempt(terminalBundle), { code: 'MAKER_V8_PUBLICATION_BLOB_HASH_MISMATCH' });
});

test('idempotent import compares the complete immutable audit bundle and never repairs missing history', async () => {
  const indexedDB = new IDBFactory();
  const databaseName = 'publication-import-collision';
  const store = await publicationStore(indexedDB, { databaseName });
  const fixture = await planFixture();
  await store.createAttempt(fixture.plan, fixture.blobs);
  const finalized = await finalize(store, await signedPath(store, fixture));
  const bundle = await store.exportAttempt(finalized.attemptId);

  const alternate = clone(bundle);
  const alternatePending = alternate.attempts.find((entry) => entry.status === 'OUTCOME_PENDING');
  alternatePending.details.at -= 1;
  alternatePending.observedAt -= 1;
  rehashAttemptEvents(alternate.attempts);
  alternate.plan.attemptHistory = {
    totalEvents: alternate.attempts.length,
    excessEvents: alternate.attempts.filter((entry) => entry.sequence >= 3).length,
    globalAttemptHeadSha256: alternate.attempts.at(-1).eventSha256,
  };
  await assert.rejects(
    store.importAttempt(alternate),
    { code: 'MAKER_V8_PUBLICATION_IMPORT_COLLISION' },
  );

  const raw = await idbResult(indexedDB.open(databaseName));
  const transaction = raw.transaction(['attempts'], 'readwrite');
  const completion = idbDone(transaction);
  await idbResult(transaction.objectStore('attempts').delete([finalized.attemptId, 0, 1]));
  await completion;
  raw.close();
  await assert.rejects(
    store.importAttempt(bundle),
    { code: 'MAKER_V8_PUBLICATION_IMPORT_COLLISION' },
  );
});

test('scope, plan, blob-ref, and ABI commitments reject self-consistent caller drift', async () => {
  const fixture = await planFixture();
  for (const mutate of [
    (plan) => { plan.scopeKey = hash('ef'); },
    (plan) => { plan.blobRefs.document = { ...plan.blobRefs.document, encoding: 'BASE64' }; },
    (plan) => { plan.blobRefs.document = { ...plan.blobRefs.document, extra: true }; },
    (plan) => { plan.immutable.compilerAuthority.compilerAbi.core.pop(); },
    (plan) => { plan.immutable.compilerAuthority.packageTuple[0].packageDigest = '2'.repeat(43); },
  ]) {
    const plan = clone(fixture.plan);
    mutate(plan);
    await assert.rejects(assertMakerV8PublicationPlanIdentityV8(plan));
  }
});

test('canonical checkpoint and plan evidence rejects non-injective JSON-domain values without invoking accessors', async () => {
  const fixture = await planFixture();
  const invalidPlans = [];

  const nan = clone(fixture.plan);
  nan.current.preState.observed = Number.NaN;
  invalidPlans.push(nan);

  const negativeZero = clone(fixture.plan);
  negativeZero.current.preState.observed = -0;
  invalidPlans.push(negativeZero);

  const sparse = clone(fixture.plan);
  sparse.current.rowCommitments = new Array(1);
  invalidPlans.push(sparse);

  const undefinedValue = clone(fixture.plan);
  undefinedValue.current.rowCommitments = [undefined];
  invalidPlans.push(undefinedValue);

  const nonPlain = clone(fixture.plan);
  nonPlain.current.preState = Object.create({ inherited: true });
  nonPlain.current.preState.contentCommitment = hash('cc');
  invalidPlans.push(nonPlain);

  for (const plan of invalidPlans) {
    await assert.rejects(
      assertMakerV8PublicationPlanIdentityV8(plan),
      { code: 'MAKER_V8_PUBLICATION_JSON_DOMAIN_INVALID' },
    );
  }

  let getterCalls = 0;
  const accessor = clone(fixture.plan);
  Object.defineProperty(accessor.current.preState, 'accessor', {
    enumerable: true,
    get() { getterCalls += 1; return null; },
  });
  await assert.rejects(
    assertMakerV8PublicationPlanIdentityV8(accessor),
    { code: 'MAKER_V8_PUBLICATION_JSON_DOMAIN_INVALID' },
  );
  assert.equal(getterCalls, 0);
});

test('read paths reject blob deletion and CAS rejects a forged derived attempt head', async () => {
  const indexedDB = new IDBFactory();

  const blobDatabase = 'publication-read-tamper';
  const blobStore = createMakerV8PublicationPersistenceV8(indexedDB, { databaseName: blobDatabase });
  const blobFixture = await planFixture();
  await blobStore.createAttempt(blobFixture.plan, blobFixture.blobs);
  const rawBlobDatabase = await idbResult(indexedDB.open(blobDatabase));
  const deleteTransaction = rawBlobDatabase.transaction(['blobs'], 'readwrite');
  const deleteCompletion = idbDone(deleteTransaction);
  await idbResult(deleteTransaction.objectStore('blobs').delete(blobFixture.plan.blobRefs.document.sha256));
  await deleteCompletion;
  rawBlobDatabase.close();
  await assert.rejects(blobStore.loadPlan(blobFixture.plan.attemptId), {
    code: 'MAKER_V8_PUBLICATION_BLOB_MISSING',
  });
  await assert.rejects(blobStore.loadActive(blobFixture.plan.scopeKey), {
    code: 'MAKER_V8_PUBLICATION_BLOB_MISSING',
  });

  const headDatabase = 'publication-head-tamper';
  const headStore = await publicationStore(indexedDB, { databaseName: headDatabase });
  const headFixture = await planFixture();
  await headStore.createAttempt(headFixture.plan, headFixture.blobs);
  const [full, signature] = await Promise.all([
    makerV8Base64BlobV8('AQ=='), makerV8Base64BlobV8('Ag=='),
  ]);
  const fullRef = makerV8BlobRefV8(full);
  const signatureRef = makerV8BlobRefV8(signature);
  const rawHeadDatabase = await idbResult(indexedDB.open(headDatabase));
  const forgeTransaction = rawHeadDatabase.transaction(['attemptHeads'], 'readwrite');
  const forgeCompletion = idbDone(forgeTransaction);
  await idbResult(forgeTransaction.objectStore('attemptHeads').put({
    attemptId: headFixture.plan.attemptId,
    ordinal: 0,
    sequence: 0,
    status: 'SIGNED',
    digest: TX_DIGEST,
    kindSha256: headFixture.plan.current.transactionKindSha256,
    fullTransactionRef: fullRef,
    signatureRef,
  }));
  await forgeCompletion;
  rawHeadDatabase.close();

  const pending = clone(headFixture.plan);
  pending.revision = 2;
  pending.updatedAt = 2;
  pending.current.fullTransactionRef = fullRef;
  pending.current.signatureRef = signatureRef;
  pending.current.outcome = {
    status: 'OUTCOME_PENDING', digest: TX_DIGEST,
    kindSha256: pending.current.transactionKindSha256,
    signedAt: 1, firstSeenAt: 2, source: 'WALLET', broadcastAt: null, observedAt: 2,
  };
  const forgedPendingEvent = event(headFixture.plan, 'OUTCOME_PENDING', 1, {
    fullTransactionRef: fullRef, signatureRef, at: 2,
    previousGlobalAttemptSha256: hash('ef'),
  });
  pending.attemptHistory = withAttemptHistory(headFixture.plan, forgedPendingEvent);
  await assert.rejects(
    headStore.compareAndSwap(pending.attemptId, 1, pending, {
      attempt: forgedPendingEvent,
      blobs: [full, signature],
    }),
    { code: 'MAKER_V8_PUBLICATION_ATTEMPT_GLOBAL_CHAIN_INVALID' },
  );
});

test('quota preflight and multi-tab CAS fail closed without deleting content-addressed blobs', async () => {
  const indexedDB = new IDBFactory();
  const lowQuota = createMakerV8PublicationPersistenceV8(indexedDB, {
    databaseName: 'publication-quota',
    storageManager: { async estimate() { return { usage: 900, quota: 1000 }; } },
  });
  await assert.rejects(lowQuota.preflightQuota(101, 0), { code: 'MAKER_V8_PUBLICATION_STORAGE_QUOTA_EXCEEDED' });

  const first = await publicationStore(indexedDB, { databaseName: 'publication-tabs' });
  const second = await publicationStore(indexedDB, { databaseName: 'publication-tabs' });
  const fixture = await planFixture();
  await first.createAttempt(fixture.plan, fixture.blobs);
  const left = clone(fixture.plan);
  left.revision = 2;
  left.updatedAt = 2;
  const right = clone(left);
  right.updatedAt = 3;
  await first.compareAndSwap(left.attemptId, 1, left);
  await assert.rejects(second.compareAndSwap(right.attemptId, 1, right), { code: 'MAKER_V8_PUBLICATION_CAS_MISMATCH' });
  assert.ok(await second.getBlob(fixture.blobs[0].sha256));
});

test('transactional mark-sweep retains shared refs, collects only orphans, and serializes a late create', async () => {
  const indexedDB = new IDBFactory();
  const store = await publicationStore(indexedDB, { databaseName: 'publication-mark-sweep' });
  const discarded = await planFixture({ makerKey: 'discarded', nonce: '1:discarded', kindSalt: 0 });
  const retained = await planFixture({ makerKey: 'retained', nonce: '1:retained', kindSalt: 3 });
  await store.createAttempt(discarded.plan, discarded.blobs);
  await store.deleteUnsigned(discarded.plan.attemptId, discarded.plan.revision);
  await store.createAttempt(retained.plan, retained.blobs);

  const collected = await store.collectOrphanedBlobs();
  assert.deepEqual(collected, { scanned: 5, retained: 4, deleted: 1 });
  assert.equal(await store.getBlob(discarded.kindBlob.sha256), null);
  assert.ok(await store.getBlob(retained.plan.blobRefs.document.sha256));
  assert.ok(await store.getBlob(retained.kindBlob.sha256));

  const late = await planFixture({ makerKey: 'late', nonce: '1:late', kindSalt: 4 });
  await Promise.all([
    store.collectOrphanedBlobs(),
    store.createAttempt(late.plan, late.blobs),
  ]);
  assert.equal((await store.loadPlan(late.plan.attemptId)).attemptId, late.plan.attemptId);
  assert.ok(await store.getBlob(late.kindBlob.sha256));
});

test('blocked upgrades close their late connection and versionchange closes an already-open tab', async () => {
  const indexedDB = new IDBFactory();
  const blockedName = 'publication-blocked-upgrade';
  const blocker = await idbResult(indexedDB.open(blockedName, 1));
  blocker.onversionchange = () => {};
  const testUpgradeFactory = {
    open(name, version) {
      assert.equal(version, 1);
      return indexedDB.open(name, 2);
    },
  };
  const blockedStore = createMakerV8PublicationPersistenceV8(testUpgradeFactory, {
    databaseName: blockedName,
  });
  await assert.rejects(
    within(blockedStore.listActive()),
    { code: 'MAKER_V8_PUBLICATION_STORAGE_VERSION_CHANGED' },
  );
  blocker.close();

  const afterLateSuccess = await within(idbResult(indexedDB.open(blockedName, 2)));
  afterLateSuccess.close();
  assert.deepEqual(await within(blockedStore.listActive()), []);

  const versionchangeName = 'publication-versionchange-close';
  const openStore = createMakerV8PublicationPersistenceV8(indexedDB, { databaseName: versionchangeName });
  assert.deepEqual(await openStore.listActive(), []);
  const upgraded = await within(idbResult(indexedDB.open(versionchangeName, 2)));
  upgraded.close();
  openStore.close();
});

test('persistent-storage capability is explicit and fail-closed before execution', async () => {
  const indexedDB = new IDBFactory();
  let requested = 0;
  const persisted = createMakerV8PublicationPersistenceV8(indexedDB, {
    databaseName: 'publication-persistence-already',
    storageManager: {
      async persisted() { return true; },
      async persist() { requested += 1; return true; },
    },
  });
  assert.deepEqual(await persisted.requirePersistentStorage(), { persisted: true });
  assert.equal(requested, 0);

  const granted = createMakerV8PublicationPersistenceV8(indexedDB, {
    databaseName: 'publication-persistence-granted',
    storageManager: {
      async persisted() { return false; },
      async persist() { requested += 1; return true; },
    },
  });
  assert.deepEqual(await granted.requirePersistentStorage(), { persisted: true });
  assert.equal(requested, 1);

  for (const [name, storageManager] of [
    ['missing', {}],
    ['denied', { async persisted() { return false; }, async persist() { return false; } }],
  ]) {
    const store = createMakerV8PublicationPersistenceV8(indexedDB, {
      databaseName: `publication-persistence-${name}`, storageManager,
    });
    await assert.rejects(store.requirePersistentStorage(), {
      code: 'MAKER_V8_PUBLICATION_PERSISTENCE_REQUIRED',
    });
  }
  const throwing = createMakerV8PublicationPersistenceV8(indexedDB, {
    databaseName: 'publication-persistence-throwing',
    storageManager: {
      async persisted() { throw new DOMException('denied', 'NotAllowedError'); },
      async persist() { return false; },
    },
  });
  await assert.rejects(throwing.requirePersistentStorage(), {
    code: 'MAKER_V8_PUBLICATION_STORAGE_FAILED',
  });
});

test('every WAL mutation requests strict IndexedDB durability and rejects unsupported durability', async () => {
  const original = IDBDatabase.prototype.transaction;
  const observed = [];
  IDBDatabase.prototype.transaction = function transaction(...args) {
    observed.push(args[2] ?? null);
    return original.apply(this, args);
  };
  try {
    const indexedDB = new IDBFactory();
    const store = createMakerV8PublicationPersistenceV8(indexedDB, {
      databaseName: 'publication-strict-durability',
    });
    const fixture = await planFixture({ makerKey: 'strict', nonce: '1:strict', kindSalt: 8 });
    await store.createAttempt(fixture.plan, fixture.blobs);
    assert.ok(observed.some((options) => options?.durability === 'strict'));
    assert.equal(observed.filter((options) => options !== null)
      .every((options) => options.durability === 'strict'), true);
  } finally {
    IDBDatabase.prototype.transaction = original;
  }

  IDBDatabase.prototype.transaction = function transaction(...args) {
    if (args[1] === 'readwrite') throw new TypeError('durability options unsupported');
    return original.apply(this, args);
  };
  try {
    const indexedDB = new IDBFactory();
    const store = createMakerV8PublicationPersistenceV8(indexedDB, {
      databaseName: 'publication-strict-durability-unsupported',
    });
    const fixture = await planFixture({ makerKey: 'strict-fail', nonce: '1:strict-fail', kindSalt: 9 });
    await assert.rejects(store.createAttempt(fixture.plan, fixture.blobs), {
      code: 'MAKER_V8_PUBLICATION_STORAGE_FAILED',
    });
  } finally {
    IDBDatabase.prototype.transaction = original;
  }
});

test('signed, pending, finalized, and imported evidence cannot bypass the persistent-storage latch', async () => {
  const indexedDB = new IDBFactory();
  const rawStore = createMakerV8PublicationPersistenceV8(indexedDB, {
    databaseName: 'publication-persistence-latch',
  });
  const fixture = await planFixture({ makerKey: 'latch', nonce: '1:latch', kindSalt: 10 });
  await rawStore.createAttempt(fixture.plan, fixture.blobs);
  const [full, signature] = await Promise.all([
    makerV8Base64BlobV8('AQ=='), makerV8Base64BlobV8('Ag=='),
  ]);
  const signedEvent = event(fixture.plan, 'SIGNED', 0, {
    fullTransactionRef: makerV8BlobRefV8(full),
    signatureRef: makerV8BlobRefV8(signature),
    at: 2,
  });
  const signedPlan = clone(fixture.plan);
  signedPlan.revision = 2;
  signedPlan.updatedAt = 2;
  signedPlan.attemptHistory = withAttemptHistory(fixture.plan, signedEvent);
  signedPlan.current.fullTransactionRef = signedEvent.fullTransactionRef;
  signedPlan.current.signatureRef = signedEvent.signatureRef;
  signedPlan.current.outcome = {
    status: 'SIGNED', digest: TX_DIGEST,
    kindSha256: signedPlan.current.transactionKindSha256,
    signedAt: 2,
  };
  await assert.rejects(rawStore.compareAndSwap(fixture.plan.attemptId, 1, signedPlan, {
    attempt: signedEvent,
    blobs: [full, signature],
  }), { code: 'MAKER_V8_PUBLICATION_PERSISTENCE_REQUIRED' });
  assert.equal((await rawStore.loadPlan(fixture.plan.attemptId)).current.outcome.status, 'READY');

  const granted = await publicationStore(new IDBFactory(), {
    databaseName: 'publication-persistence-export-source',
  });
  const sourceFixture = await planFixture({ makerKey: 'import-latch', nonce: '1:source', kindSalt: 11 });
  await granted.createAttempt(sourceFixture.plan, sourceFixture.blobs);
  const finalized = await finalize(granted, await signedPath(granted, sourceFixture));
  const bundle = await granted.exportAttempt(finalized.attemptId);
  const ungrantedImport = createMakerV8PublicationPersistenceV8(new IDBFactory(), {
    databaseName: 'publication-persistence-import-target',
  });
  await assert.rejects(ungrantedImport.importAttempt(bundle), {
    code: 'MAKER_V8_PUBLICATION_PERSISTENCE_REQUIRED',
  });
});

test('terminal history coexists with one exact active successor and rejects a forged source plan', async () => {
  const indexedDB = new IDBFactory();
  const databaseName = 'publication-terminal-active-successor';
  const store = await publicationStore(indexedDB, { databaseName });
  const first = await planFixture({ makerKey: 'same-scope', nonce: '1:first', kindSalt: 1 });
  await store.createAttempt(first.plan, first.blobs);
  const finalized = await finalize(store, await signedPath(store, first));
  const abandonedAt = finalized.updatedAt + 1;
  const abandoned = await store.compareAndSwap(finalized.attemptId, finalized.revision, {
    ...finalized,
    revision: finalized.revision + 1,
    updatedAt: abandonedAt,
    status: 'ABANDONED_RECOVERABLE',
    nextPreparation: {
      ...finalized.nextPreparation,
      status: 'BLOCKED',
      reason: 'USER_REQUESTED',
    },
    terminal: { status: 'ABANDONED_RECOVERABLE', reason: 'USER_REQUESTED', at: abandonedAt },
  });
  const terminalBundle = await store.exportAttempt(abandoned.attemptId);

  const successor = await planFixture({ makerKey: 'same-scope', nonce: '2:successor', kindSalt: 2 });
  await store.createAttempt(successor.plan, successor.blobs);
  assert.equal((await store.loadActive(successor.plan.scopeKey)).attemptId, successor.plan.attemptId);
  assert.equal((await store.importAttempt(clone(terminalBundle))).attemptId, abandoned.attemptId);
  assert.equal((await store.exportAttempt(abandoned.attemptId)).plan.status, 'ABANDONED_RECOVERABLE');

  const raw = await idbResult(indexedDB.open(databaseName));
  const tamper = raw.transaction(['usedAttempts'], 'readwrite');
  const completion = idbDone(tamper);
  await idbResult(tamper.objectStore('usedAttempts').delete(successor.plan.attemptId));
  await completion;
  raw.close();
  await assert.rejects(store.exportAttempt(abandoned.attemptId), {
    code: 'MAKER_V8_PUBLICATION_ATTEMPT_ID_REUSED',
  });
});

test('permanent attempt identities prevent unsigned delete/recreate ABA and GC audits tombstones', async () => {
  const indexedDB = new IDBFactory();
  const databaseName = 'publication-used-attempts';
  const store = await publicationStore(indexedDB, { databaseName });
  const discarded = await planFixture({ makerKey: 'aba', nonce: '1:aba', kindSalt: 3 });
  await store.createAttempt(discarded.plan, discarded.blobs);
  await store.deleteUnsigned(discarded.plan.attemptId, discarded.plan.revision);
  await assert.rejects(store.createAttempt(discarded.plan, discarded.blobs), {
    code: 'MAKER_V8_PUBLICATION_ATTEMPT_ID_REUSED',
  });
  const stale = clone(discarded.plan);
  stale.revision += 1;
  stale.updatedAt += 1;
  await assert.rejects(store.compareAndSwap(stale.attemptId, 1, stale), {
    code: 'MAKER_V8_PUBLICATION_CAS_MISMATCH',
  });

  const raw = await idbResult(indexedDB.open(databaseName));
  const read = raw.transaction(['usedAttempts'], 'readonly');
  const readDone = idbDone(read);
  const tombstone = await idbResult(read.objectStore('usedAttempts').get(discarded.plan.attemptId));
  await readDone;
  const corrupt = raw.transaction(['usedAttempts'], 'readwrite');
  const corruptDone = idbDone(corrupt);
  await idbResult(corrupt.objectStore('usedAttempts').put({ ...tombstone, planId: hash('fa') }));
  await corruptDone;
  raw.close();
  await assert.rejects(store.collectOrphanedBlobs(), {
    code: 'MAKER_V8_PUBLICATION_ATTEMPT_ID_REUSED',
  });
});

test('global attempt-history anchor rejects removed old ordinals and forged ordinal-head caches on hot reads', async () => {
  const makeAdvanced = async (indexedDB, databaseName) => {
    const store = await publicationStore(indexedDB, { databaseName });
    const fixture = await planFixture({ makerKey: databaseName, nonce: '1:history', kindSalt: 5 });
    await store.createAttempt(fixture.plan, fixture.blobs);
    const scaffold = await finalize(store, await signedPath(store, fixture));
    const prepared = await prepareNext(store, scaffold, 'base', {
      kind: 'BASE_CHUNK', phase: 'BASE_APPEND', lane: 'BASE', action: 'APPEND',
      startSequence: '0', endSequence: '1', localIndex: 0,
    });
    const signed = await signedPath(store, prepared);
    return { store, signed };
  };

  const removedDb = new IDBFactory();
  const removedName = 'publication-global-history-removed';
  const removed = await makeAdvanced(removedDb, removedName);
  const rawRemoved = await idbResult(removedDb.open(removedName));
  const deletion = rawRemoved.transaction(['attempts', 'attemptHeads'], 'readwrite');
  const deletionDone = idbDone(deletion);
  for (let sequence = 0; sequence <= 2; sequence += 1) {
    await idbResult(deletion.objectStore('attempts').delete([
      removed.signed.plan.attemptId, 0, sequence,
    ]));
  }
  await idbResult(deletion.objectStore('attemptHeads').delete([
    removed.signed.plan.attemptId, 0,
  ]));
  await deletionDone;
  rawRemoved.close();
  await assert.rejects(removed.store.loadPlan(removed.signed.plan.attemptId), {
    code: 'MAKER_V8_PUBLICATION_ATTEMPT_GLOBAL_CHAIN_INVALID',
  });

  const forgedDb = new IDBFactory();
  const forgedName = 'publication-global-history-forged-head';
  const forged = await makeAdvanced(forgedDb, forgedName);
  const rawForged = await idbResult(forgedDb.open(forgedName));
  const forge = rawForged.transaction(['attemptHeads'], 'readwrite');
  const forgeDone = idbDone(forge);
  const head = await idbResult(forge.objectStore('attemptHeads').get([
    forged.signed.plan.attemptId, 1,
  ]));
  await idbResult(forge.objectStore('attemptHeads').put({ ...head, ordinal: 2 }));
  await forgeDone;
  rawForged.close();
  await assert.rejects(forged.store.loadHead(forged.signed.plan.attemptId), {
    code: 'MAKER_V8_PUBLICATION_ATTEMPT_GLOBAL_CHAIN_INVALID',
  });
});

test('fresh production v1 schema never opens or mutates the unpublished development database', async () => {
  const indexedDB = new IDBFactory();
  const oldDevelopmentName = 'animacraft-maker-v8-publication-v3';
  const oldRequest = indexedDB.open(oldDevelopmentName, 7);
  oldRequest.onupgradeneeded = () => {
    oldRequest.result.createObjectStore('unpublishedDevelopment', { keyPath: 'id' })
      .add({ id: 'sentinel', value: 'untouched' });
  };
  const oldDatabase = await idbResult(oldRequest);
  oldDatabase.close();

  assert.equal(MAKER_V8_PUBLICATION_DATABASE, 'animacraft-fresh-maker-v8-publication-v1');
  assert.equal(MAKER_V8_PUBLICATION_PERSISTENCE_SCHEMA, 'animacraft.maker-v8-publication-wal.v1');
  const fresh = createMakerV8PublicationPersistenceV8(indexedDB);
  assert.deepEqual(await fresh.listActive(), []);

  const database = await idbResult(indexedDB.open(MAKER_V8_PUBLICATION_DATABASE));
  assert.equal(database.version, 1);
  assert.deepEqual([...database.objectStoreNames].sort(), [
    'activeScopes', 'attemptHeads', 'attempts', 'blobs',
    'checkpoints', 'plans', 'usedAttempts',
  ]);
  const transaction = database.transaction(
    ['plans', 'checkpoints', 'attempts', 'attemptHeads'],
    'readonly',
  );
  assert.deepEqual([...transaction.objectStore('plans').indexNames].sort(), [
    'byScope', 'byScopeStatus', 'byStatus',
  ]);
  assert.deepEqual([...transaction.objectStore('checkpoints').indexNames], ['byAttempt']);
  assert.deepEqual([...transaction.objectStore('attempts').indexNames].sort(), [
    'byAttempt', 'byOrdinal',
  ]);
  assert.deepEqual([...transaction.objectStore('attemptHeads').indexNames], ['byAttempt']);
  await idbDone(transaction);
  database.close();

  const untouched = await idbResult(indexedDB.open(oldDevelopmentName));
  assert.deepEqual([...untouched.objectStoreNames], ['unpublishedDevelopment']);
  const legacyRead = untouched.transaction('unpublishedDevelopment', 'readonly');
  assert.deepEqual(
    await idbResult(legacyRead.objectStore('unpublishedDevelopment').get('sentinel')),
    { id: 'sentinel', value: 'untouched' },
  );
  await idbDone(legacyRead);
  untouched.close();
  fresh.close();
});

test('global history reserve preserves cap-edge unknown query and terminal outcomes in live CAS and import', async () => {
  const limits = MAKER_V8_PUBLICATION_HISTORY_LIMITS;
  assert.deepEqual(assertMakerV8PublicationHistoryReserveV8({
    totalEvents: limits.maxAttemptEvents - 2,
    excessEvents: limits.maxExcessEvents - 2,
  }, { sequence: 2, status: 'OUTCOME_UNKNOWN' }), {
    remaining: 2,
    futureExcessEvents: 2,
  });
  assert.deepEqual(assertMakerV8PublicationHistoryReserveV8({
    totalEvents: limits.maxAttemptEvents - 1,
    excessEvents: limits.maxExcessEvents - 1,
  }, { sequence: 3, status: 'OUTCOME_PENDING' }), {
    remaining: 1,
    futureExcessEvents: 1,
  });
  for (const status of ['FINALIZED_SUCCESS', 'FINALIZED_FAILURE']) {
    assert.deepEqual(assertMakerV8PublicationHistoryReserveV8({
      totalEvents: limits.maxAttemptEvents,
      excessEvents: limits.maxExcessEvents,
    }, { sequence: 4, status }), {
      remaining: 0,
      futureExcessEvents: 0,
    });
  }
  for (const history of [
    {
      totalEvents: limits.maxAttemptEvents - 1,
      excessEvents: limits.maxExcessEvents - 1,
    },
    {
      totalEvents: limits.maxAttemptEvents - 2,
      excessEvents: limits.maxExcessEvents - 1,
    },
  ]) {
    assert.throws(
      () => assertMakerV8PublicationHistoryReserveV8(
        history,
        { sequence: 2, status: 'OUTCOME_UNKNOWN' },
      ),
      { code: 'MAKER_V8_PUBLICATION_HISTORY_RESERVE_REQUIRED' },
    );
  }

  const indexedDB = new IDBFactory();
  const source = await publicationStore(indexedDB, {
    databaseName: 'publication-global-reserve-live',
  });
  const fixture = await planFixture({
    makerKey: 'global-reserve', nonce: '1:global-reserve', kindSalt: 19,
  });
  await source.createAttempt(fixture.plan, fixture.blobs);
  const signed = await signedPath(source, fixture);
  const unknownAt = signed.plan.updatedAt + 1;
  const unknownEvent = event(signed.plan, 'OUTCOME_UNKNOWN', 2, {
    fullTransactionRef: signed.fullRef,
    signatureRef: signed.signatureRef,
    at: unknownAt,
    previousAttempt: signed.lastAttempt,
  });
  const unknown = clone(signed.plan);
  unknown.revision += 1;
  unknown.updatedAt = unknownAt;
  unknown.attemptHistory = withAttemptHistory(signed.plan, unknownEvent);
  unknown.current.outcome = {
    ...unknown.current.outcome,
    status: 'OUTCOME_UNKNOWN',
    observedAt: unknownAt,
    code: unknownEvent.details.code,
  };

  const noGlobalReserve = clone(unknown);
  noGlobalReserve.attemptHistory = {
    totalEvents: limits.maxAttemptEvents - 1,
    excessEvents: limits.maxExcessEvents - 1,
    globalAttemptHeadSha256: unknownEvent.eventSha256,
  };
  await assert.rejects(
    source.compareAndSwap(
      noGlobalReserve.attemptId,
      signed.plan.revision,
      noGlobalReserve,
      { attempt: unknownEvent },
    ),
    { code: 'MAKER_V8_PUBLICATION_HISTORY_RESERVE_REQUIRED' },
  );

  const durableUnknown = await source.compareAndSwap(
    unknown.attemptId,
    signed.plan.revision,
    unknown,
    { attempt: unknownEvent },
  );
  const bundle = clone(await source.exportAttempt(durableUnknown.attemptId));
  bundle.plan.attemptHistory = {
    totalEvents: limits.maxAttemptEvents - 1,
    excessEvents: limits.maxExcessEvents - 1,
    globalAttemptHeadSha256: unknownEvent.eventSha256,
  };
  const target = await publicationStore(new IDBFactory(), {
    databaseName: 'publication-global-reserve-import',
  });
  await assert.rejects(target.importAttempt(bundle), {
    code: 'MAKER_V8_PUBLICATION_HISTORY_RESERVE_REQUIRED',
  });
});

test('retry soft cap preserves mandatory unknown-to-query-to-terminal slots and rejects another optional observation', async () => {
  const sourceDb = new IDBFactory();
  const source = await publicationStore(sourceDb, { databaseName: 'publication-history-reserve-source' });
  const fixture = await planFixture({ makerKey: 'history-reserve', nonce: '1:reserve', kindSalt: 12 });
  await source.createAttempt(fixture.plan, fixture.blobs);
  const finalized = await finalize(source, await signedPath(source, fixture));
  const bundle = clone(await source.exportAttempt(finalized.attemptId));
  const fullRef = bundle.checkpoints[0].fullTransactionRef;
  const signatureRef = bundle.checkpoints[0].signatureRef;
  const statuses = [
    'WALLET_REJECTED', 'SIGNED', 'OUTCOME_PENDING',
    'OUTCOME_UNKNOWN', 'OUTCOME_PENDING', 'OUTCOME_UNKNOWN', 'OUTCOME_PENDING',
    'OUTCOME_UNKNOWN', 'OUTCOME_PENDING', 'OUTCOME_UNKNOWN', 'OUTCOME_PENDING',
    'OUTCOME_UNKNOWN', 'OUTCOME_PENDING', 'FINALIZED_SUCCESS',
  ];
  const attempts = [];
  const states = [];
  let working = clone(fixture.plan);
  let prior = null;
  for (const [sequence, status] of statuses.entries()) {
    const rejected = status === 'WALLET_REJECTED';
    const attempt = event(working, status, sequence, {
      digest: rejected ? null : TX_DIGEST,
      fullTransactionRef: rejected ? null : fullRef,
      signatureRef: rejected ? null : signatureRef,
      at: sequence + 2,
      previousAttempt: prior,
    });
    attempts.push(attempt);
    working.attemptHistory = withAttemptHistory(working, attempt);
    states.push(clone(working));
    prior = attempt;
  }
  const finalizedAt = attempts.at(-1).observedAt;
  const checkpoint = bundle.checkpoints[0];
  checkpoint.finalizedAt = finalizedAt;
  checkpoint.checkpointSha256 = await makerV8PublicationCheckpointSha256V8(checkpoint);
  bundle.attempts = attempts;
  bundle.plan.revision = attempts.length + 1;
  bundle.plan.updatedAt = finalizedAt;
  bundle.plan.attemptHistory = clone(working.attemptHistory);
  bundle.plan.head.checkpointSha256 = checkpoint.checkpointSha256;
  const target = await publicationStore(new IDBFactory(), {
    databaseName: 'publication-history-reserve-target',
  });
  assert.equal((await target.importAttempt(bundle)).attemptHistory.totalEvents, attempts.length);

  const optionalUnknown = event(states[12], 'OUTCOME_UNKNOWN', 13, {
    fullTransactionRef: fullRef,
    signatureRef,
    at: 15,
    previousAttempt: attempts[12],
  });
  const overPlan = clone(fixture.plan);
  overPlan.revision = 15;
  overPlan.updatedAt = optionalUnknown.observedAt;
  overPlan.attemptHistory = withAttemptHistory(states[12], optionalUnknown);
  overPlan.current.fullTransactionRef = fullRef;
  overPlan.current.signatureRef = signatureRef;
  overPlan.current.outcome = {
    status: 'OUTCOME_UNKNOWN', digest: TX_DIGEST,
    kindSha256: overPlan.current.transactionKindSha256,
    signedAt: optionalUnknown.details.signedAt,
    firstSeenAt: optionalUnknown.details.firstSeenAt,
    source: 'WALLET',
    broadcastAt: optionalUnknown.details.broadcastAt,
    observedAt: optionalUnknown.observedAt,
    code: optionalUnknown.details.code,
  };
  const overBundle = {
    schemaVersion: MAKER_V8_PUBLICATION_PERSISTENCE_SCHEMA,
    plan: overPlan,
    checkpoints: [],
    attempts: [...attempts.slice(0, 13), optionalUnknown],
    blobs: bundle.blobs,
  };
  const overTarget = await publicationStore(new IDBFactory(), {
    databaseName: 'publication-history-reserve-over',
  });
  await assert.rejects(overTarget.importAttempt(overBundle), {
    code: 'MAKER_V8_PUBLICATION_HISTORY_RESERVE_REQUIRED',
  });
});

test('status timeline covers broadcast, unknown, external failure retry, and no-op repeated query evidence', async () => {
  const indexedDB = new IDBFactory();
  const walletStore = await publicationStore(indexedDB, { databaseName: 'publication-status-wallet' });
  const walletFixture = await planFixture({ makerKey: 'status-wallet', nonce: '1:wallet', kindSalt: 13 });
  await walletStore.createAttempt(walletFixture.plan, walletFixture.blobs);
  const signed = await signedPath(walletStore, walletFixture);

  const acceptedAt = signed.plan.updatedAt + 1;
  const acceptedEvent = event(signed.plan, 'BROADCAST_ACCEPTED', 2, {
    fullTransactionRef: signed.fullRef,
    signatureRef: signed.signatureRef,
    at: acceptedAt,
    previousAttempt: signed.lastAttempt,
  });
  let walletPlan = clone(signed.plan);
  walletPlan.revision += 1;
  walletPlan.updatedAt = acceptedAt;
  walletPlan.attemptHistory = withAttemptHistory(signed.plan, acceptedEvent);
  walletPlan.current.outcome.broadcastAt = acceptedAt;
  walletPlan.current.outcome.observedAt = acceptedAt;
  walletPlan = await walletStore.compareAndSwap(
    walletPlan.attemptId, signed.plan.revision, walletPlan, { attempt: acceptedEvent },
  );

  const queryAt = walletPlan.updatedAt + 1;
  const queryEvent = event(walletPlan, 'OUTCOME_PENDING', 3, {
    fullTransactionRef: signed.fullRef,
    signatureRef: signed.signatureRef,
    at: queryAt,
    previousAttempt: acceptedEvent,
  });
  let queried = clone(walletPlan);
  queried.revision += 1;
  queried.updatedAt = queryAt;
  queried.attemptHistory = withAttemptHistory(walletPlan, queryEvent);
  queried.current.outcome.observedAt = queryAt;
  queried = await walletStore.compareAndSwap(
    queried.attemptId, walletPlan.revision, queried, { attempt: queryEvent },
  );

  const unknownAt = queried.updatedAt + 1;
  const unknownEvent = event(queried, 'OUTCOME_UNKNOWN', 4, {
    fullTransactionRef: signed.fullRef,
    signatureRef: signed.signatureRef,
    at: unknownAt,
    previousAttempt: queryEvent,
  });
  let unknown = clone(queried);
  unknown.revision += 1;
  unknown.updatedAt = unknownAt;
  unknown.attemptHistory = withAttemptHistory(queried, unknownEvent);
  unknown.current.outcome = {
    ...unknown.current.outcome,
    status: 'OUTCOME_UNKNOWN',
    observedAt: unknownAt,
    code: unknownEvent.details.code,
  };
  unknown = await walletStore.compareAndSwap(
    unknown.attemptId, queried.revision, unknown, { attempt: unknownEvent },
  );

  const requeryAt = unknown.updatedAt + 1;
  const requeryEvent = event(unknown, 'OUTCOME_PENDING', 5, {
    fullTransactionRef: signed.fullRef,
    signatureRef: signed.signatureRef,
    at: requeryAt,
    previousAttempt: unknownEvent,
  });
  let requery = clone(unknown);
  requery.revision += 1;
  requery.updatedAt = requeryAt;
  requery.attemptHistory = withAttemptHistory(unknown, requeryEvent);
  requery.current.outcome = {
    status: 'OUTCOME_PENDING', digest: TX_DIGEST,
    kindSha256: requery.current.transactionKindSha256,
    signedAt: requeryEvent.details.signedAt,
    firstSeenAt: requeryEvent.details.firstSeenAt,
    source: 'WALLET',
    broadcastAt: requeryEvent.details.broadcastAt,
    observedAt: requeryAt,
  };
  requery = await walletStore.compareAndSwap(
    requery.attemptId, unknown.revision, requery, { attempt: requeryEvent },
  );
  assert.equal((await finalize(walletStore, {
    plan: requery,
    fullRef: signed.fullRef,
    signatureRef: signed.signatureRef,
    lastAttempt: requeryEvent,
  }, { successSequence: 6 })).head.ordinal, 0);

  const externalStore = await publicationStore(indexedDB, { databaseName: 'publication-status-external' });
  const externalFixture = await planFixture({ makerKey: 'status-external', nonce: '1:external', kindSalt: 14 });
  await externalStore.createAttempt(externalFixture.plan, externalFixture.blobs);
  const externalPendingEvent = event(externalFixture.plan, 'EXTERNAL_PENDING', 0, {
    source: 'EXTERNAL_FINALIZED', at: 2,
  });
  let externalPending = clone(externalFixture.plan);
  externalPending.revision = 2;
  externalPending.updatedAt = 2;
  externalPending.attemptHistory = withAttemptHistory(externalFixture.plan, externalPendingEvent);
  externalPending.current.outcome = {
    status: 'OUTCOME_PENDING', digest: TX_DIGEST,
    kindSha256: externalPending.current.transactionKindSha256,
    signedAt: null, firstSeenAt: 2, source: 'EXTERNAL_FINALIZED',
    broadcastAt: null, observedAt: 2,
  };
  externalPending = await externalStore.compareAndSwap(
    externalPending.attemptId, 1, externalPending, { attempt: externalPendingEvent },
  );
  const failureEvent = event(externalPending, 'FINALIZED_FAILURE', 1, {
    source: 'EXTERNAL_FINALIZED', at: 3, previousAttempt: externalPendingEvent,
  });
  let failed = clone(externalPending);
  failed.revision += 1;
  failed.updatedAt = 3;
  failed.attemptHistory = withAttemptHistory(externalPending, failureEvent);
  failed.current.outcome = {
    status: 'FINALIZED_FAILURE', digest: TX_DIGEST,
    kindSha256: failed.current.transactionKindSha256,
    signedAt: null, firstSeenAt: 2, broadcastAt: null, observedAt: 3,
    failureCode: 'MAKER_V8_COMPILER_TRANSACTION_FAILED', source: 'EXTERNAL_FINALIZED',
  };
  failed = await externalStore.compareAndSwap(
    failed.attemptId, externalPending.revision, failed, { attempt: failureEvent },
  );
  let ready = clone(failed);
  ready.revision += 1;
  ready.updatedAt = 4;
  ready.current.outcome = { status: 'READY' };
  ready = await externalStore.compareAndSwap(ready.attemptId, failed.revision, ready);

  const retryEvent = event(ready, 'EXTERNAL_PENDING', 2, {
    source: 'EXTERNAL_FINALIZED', at: 5,
    previousAttemptSha256: failureEvent.eventSha256,
  });
  let retry = clone(ready);
  retry.revision += 1;
  retry.updatedAt = 5;
  retry.attemptHistory = withAttemptHistory(ready, retryEvent);
  retry.current.outcome = {
    status: 'OUTCOME_PENDING', digest: TX_DIGEST,
    kindSha256: retry.current.transactionKindSha256,
    signedAt: null, firstSeenAt: 5, source: 'EXTERNAL_FINALIZED',
    broadcastAt: null, observedAt: 5,
  };
  retry = await externalStore.compareAndSwap(
    retry.attemptId, ready.revision, retry, { attempt: retryEvent },
  );

  const repeatedEvent = event(retry, 'EXTERNAL_PENDING', 3, {
    source: 'EXTERNAL_FINALIZED', at: 6,
    previousAttemptSha256: retryEvent.eventSha256,
  });
  const repeated = clone(retry);
  repeated.revision += 1;
  repeated.updatedAt = 6;
  repeated.attemptHistory = withAttemptHistory(retry, repeatedEvent);
  repeated.current.outcome.observedAt = 6;
  await assert.rejects(
    externalStore.compareAndSwap(repeated.attemptId, retry.revision, repeated, {
      attempt: repeatedEvent,
    }),
    { code: 'MAKER_V8_PUBLICATION_ATTEMPT_SEQUENCE_INVALID' },
  );
  assert.equal((await externalStore.loadPlan(retry.attemptId)).attemptHistory.totalEvents, 3);
  assert.equal((await finalize(externalStore, {
    plan: retry, fullRef: null, signatureRef: null, lastAttempt: retryEvent,
  }, { successSequence: 3 })).head.ordinal, 0);
});

test('every intermediate attempt event is locally bound to exact timeline, source, refs, and rolling links', async () => {
  const source = await publicationStore(new IDBFactory(), {
    databaseName: 'publication-intermediate-source',
  });
  const fixture = await planFixture({ makerKey: 'intermediate', nonce: '1:intermediate', kindSalt: 15 });
  await source.createAttempt(fixture.plan, fixture.blobs);
  const finalized = await finalize(source, await signedPath(source, fixture));
  const canonicalBundle = await source.exportAttempt(finalized.attemptId);
  const mutations = [
    (attempts) => { attempts[0].details.at -= 1; },
    (attempts) => { attempts[0].details.source = 'EXTERNAL_FINALIZED'; },
    (attempts) => { attempts[1].details.firstSeenAt -= 1; },
    (attempts) => { attempts[1].details.signedAt += 1; },
    (attempts) => { attempts[1].fullTransactionRef = null; },
    (attempts) => { attempts[2].details.broadcastAt = 1; },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const bundle = clone(canonicalBundle);
    mutate(bundle.attempts);
    rehashAttemptLinks(bundle.attempts);
    bundle.plan.attemptHistory.globalAttemptHeadSha256 = bundle.attempts.at(-1).eventSha256;
    const target = await publicationStore(new IDBFactory(), {
      databaseName: `publication-intermediate-tamper-${index}`,
    });
    await assert.rejects(
      target.importAttempt(bundle),
      (error) => /^MAKER_V8_PUBLICATION_ATTEMPT_(?:INVALID|TIMELINE_INVALID|SEQUENCE_INVALID|BINDING_INVALID)$/.test(error.code),
    );
  }

  const brokenLink = clone(canonicalBundle);
  brokenLink.attempts[1].previousGlobalAttemptSha256 = hash('ef');
  brokenLink.attempts[1].eventSha256 = makerV8PublicationAttemptSha256V8(brokenLink.attempts[1]);
  brokenLink.attempts[2].previousAttemptSha256 = brokenLink.attempts[1].eventSha256;
  brokenLink.attempts[2].previousGlobalAttemptSha256 = brokenLink.attempts[1].eventSha256;
  brokenLink.attempts[2].eventSha256 = makerV8PublicationAttemptSha256V8(brokenLink.attempts[2]);
  brokenLink.plan.attemptHistory.globalAttemptHeadSha256 = brokenLink.attempts[2].eventSha256;
  const linkTarget = await publicationStore(new IDBFactory(), {
    databaseName: 'publication-intermediate-link-tamper',
  });
  await assert.rejects(linkTarget.importAttempt(brokenLink), {
    code: 'MAKER_V8_PUBLICATION_ATTEMPT_GLOBAL_CHAIN_INVALID',
  });
});

test('derived history ceilings accept exact bounds, reject overage, and expose the inert audit boundary', async () => {
  assert.equal(
    MAKER_V8_PUBLICATION_HISTORY_LIMITS.maxBaseRows
      + MAKER_V8_PUBLICATION_HISTORY_LIMITS.maxActivationRows
      + MAKER_V8_PUBLICATION_HISTORY_LIMITS.fixedTopologyTransactions,
    MAKER_V8_PUBLICATION_HISTORY_LIMITS.derivedMaximumCheckpoints,
  );
  assert.ok(
    MAKER_V8_PUBLICATION_HISTORY_LIMITS.derivedMaximumCheckpoints
      < MAKER_V8_PUBLICATION_HISTORY_LIMITS.maxCheckpoints,
  );
  assert.equal(
    3 * MAKER_V8_PUBLICATION_HISTORY_LIMITS.maxCheckpoints
      + MAKER_V8_PUBLICATION_HISTORY_LIMITS.maxExcessEvents,
    MAKER_V8_PUBLICATION_HISTORY_LIMITS.maxAttemptEvents,
  );
  assert.equal(MAKER_V8_PUBLICATION_STORE_TRUST.executionAuthority, 'INERT_STORAGE_ONLY');
  assert.equal(MAKER_V8_PUBLICATION_STORE_TRUST.hotHistory, 'OPERATIONAL_ANCHOR_ONLY');

  const fixture = await planFixture({ makerKey: 'history-bounds', nonce: '1:bounds', kindSalt: 16 });
  const near = clone(fixture.plan);
  near.attemptHistory = {
    totalEvents: MAKER_V8_PUBLICATION_HISTORY_LIMITS.maxAttemptEvents,
    excessEvents: MAKER_V8_PUBLICATION_HISTORY_LIMITS.maxExcessEvents,
    globalAttemptHeadSha256: hash('ab'),
  };
  await assertMakerV8PublicationPlanIdentityV8(near);
  for (const mutate of [
    (plan) => { plan.attemptHistory.totalEvents += 1; },
    (plan) => {
      plan.attemptHistory.totalEvents = MAKER_V8_PUBLICATION_HISTORY_LIMITS.maxExcessEvents + 1;
      plan.attemptHistory.excessEvents = MAKER_V8_PUBLICATION_HISTORY_LIMITS.maxExcessEvents + 1;
    },
    (plan) => {
      plan.attemptHistory.totalEvents = 3 * MAKER_V8_PUBLICATION_HISTORY_LIMITS.maxCheckpoints + 1;
      plan.attemptHistory.excessEvents = 0;
    },
  ]) {
    const over = clone(near);
    mutate(over);
    await assert.rejects(assertMakerV8PublicationPlanIdentityV8(over), {
      code: 'MAKER_V8_PUBLICATION_PLAN_INVALID',
    });
  }

  const source = await publicationStore(new IDBFactory(), {
    databaseName: 'publication-checkpoint-bounds',
  });
  await source.createAttempt(fixture.plan, fixture.blobs);
  const finalized = await finalize(source, await signedPath(source, fixture));
  const checkpoint = clone(await source.loadHead(finalized.attemptId));
  checkpoint.ordinal = MAKER_V8_PUBLICATION_HISTORY_LIMITS.maxCheckpoints - 1;
  assertMakerV8PublicationCheckpointV8(checkpoint);
  checkpoint.ordinal += 1;
  assert.throws(() => assertMakerV8PublicationCheckpointV8(checkpoint), {
    code: 'MAKER_V8_PUBLICATION_CHECKPOINT_INVALID',
  });
});

test('hot resume uses scalar counts and bounded cursors without materializing audit prefixes', async () => {
  const indexedDB = new IDBFactory();
  const databaseName = 'publication-hot-resume-bounded';
  const store = await publicationStore(indexedDB, { databaseName });
  const fixture = await planFixture({ makerKey: 'hot-resume', nonce: '1:hot', kindSalt: 17 });
  await store.createAttempt(fixture.plan, fixture.blobs);
  const finalized = await finalize(store, await signedPath(store, fixture));
  const prepared = await prepareNext(store, finalized, 'base', {
    kind: 'BASE_CHUNK', phase: 'BASE_APPEND', lane: 'BASE', action: 'APPEND',
    startSequence: '0', endSequence: '1', localIndex: 0,
  });
  const signed = await signedPath(store, prepared);

  const originalStoreGetAll = IDBObjectStore.prototype.getAll;
  const originalIndexGetAll = IDBIndex.prototype.getAll;
  const originalCount = IDBIndex.prototype.count;
  const originalOpenCursor = IDBIndex.prototype.openCursor;
  const observed = { getAll: 0, count: 0, cursor: 0 };
  IDBObjectStore.prototype.getAll = function getAll(...args) {
    if (['attempts', 'attemptHeads', 'checkpoints'].includes(this.name)) observed.getAll += 1;
    return originalStoreGetAll.apply(this, args);
  };
  IDBIndex.prototype.getAll = function getAll(...args) {
    if (['attempts', 'attemptHeads', 'checkpoints'].includes(this.objectStore.name)) observed.getAll += 1;
    return originalIndexGetAll.apply(this, args);
  };
  IDBIndex.prototype.count = function count(...args) {
    if (['attempts', 'attemptHeads', 'checkpoints'].includes(this.objectStore.name)) observed.count += 1;
    return originalCount.apply(this, args);
  };
  IDBIndex.prototype.openCursor = function openCursor(...args) {
    if (['attempts', 'attemptHeads', 'checkpoints'].includes(this.objectStore.name)) observed.cursor += 1;
    return originalOpenCursor.apply(this, args);
  };
  try {
    assert.equal((await store.loadPlan(signed.plan.attemptId)).attemptId, signed.plan.attemptId);
    assert.equal((await store.loadHead(signed.plan.attemptId)).ordinal, 0);
  } finally {
    IDBObjectStore.prototype.getAll = originalStoreGetAll;
    IDBIndex.prototype.getAll = originalIndexGetAll;
    IDBIndex.prototype.count = originalCount;
    IDBIndex.prototype.openCursor = originalOpenCursor;
  }
  assert.equal(observed.getAll, 0);
  assert.ok(observed.count > 0);
  assert.ok(observed.cursor > 0);
});

test('derived-limit WAL hot resume stays bounded across 14,520 checkpoints and 43,560 events', {
  timeout: 120_000,
}, async (t) => {
  const indexedDB = new IDBFactory();
  const databaseName = 'publication-derived-limit-hot-resume';
  const store = await publicationStore(indexedDB, { databaseName });
  const fixture = await planFixture({
    makerKey: 'derived-limit-hot-resume', nonce: '1:derived-limit', kindSalt: 18,
  });
  await store.createAttempt(fixture.plan, fixture.blobs);

  const [fullBlob, signatureBlob] = await Promise.all([
    makerV8Base64BlobV8('AQ=='),
    makerV8Base64BlobV8('Ag=='),
  ]);
  const fullTransactionRef = makerV8BlobRefV8(fullBlob);
  const signatureRef = makerV8BlobRefV8(signatureBlob);
  const database = await openRawDatabase(indexedDB, databaseName);
  let previousCheckpointSha256 = null;
  let previousGlobalAttemptSha256 = null;
  let finalCheckpoint = null;
  let finalAttempt = null;
  let batch = [];
  let checkpointCount = 0;
  let attemptCount = 0;
  for (const descriptor of derivedLimitTopology(fixture.kindBlob)) {
    const signedAt = descriptor.ordinal * 3 + 2;
    const attempts = nearLimitAttempts(fixture.plan, descriptor, {
      fullTransactionRef,
      signatureRef,
      previousGlobalAttemptSha256,
      signedAt,
    });
    const checkpoint = nearLimitCheckpoint(fixture.plan, descriptor, {
      previousCheckpointSha256,
      fullTransactionRef,
      signatureRef,
      finalizedAt: signedAt + 2,
    });
    batch.push({ checkpoint, attempts, attemptHead: attemptHead(attempts[2]) });
    previousCheckpointSha256 = checkpoint.checkpointSha256;
    previousGlobalAttemptSha256 = attempts[2].eventSha256;
    finalCheckpoint = checkpoint;
    finalAttempt = attempts[2];
    checkpointCount += 1;
    attemptCount += attempts.length;
    if (batch.length === 256) {
      await addRawPublicationRows(database, batch);
      batch = [];
    }
  }
  if (batch.length) await addRawPublicationRows(database, batch);
  assert.equal(checkpointCount, MAKER_V8_PUBLICATION_HISTORY_LIMITS.derivedMaximumCheckpoints);
  assert.equal(attemptCount, 3 * checkpointCount);

  const finalPlan = {
    ...fixture.plan,
    status: 'COMPLETE',
    revision: checkpointCount + attemptCount + 1,
    updatedAt: finalCheckpoint.finalizedAt,
    attemptHistory: {
      totalEvents: attemptCount,
      excessEvents: 0,
      globalAttemptHeadSha256: finalAttempt.eventSha256,
    },
    head: {
      ordinal: finalCheckpoint.ordinal,
      digest: finalCheckpoint.digest,
      transactionKindSha256: finalCheckpoint.transactionKindSha256,
      checkpointSha256: finalCheckpoint.checkpointSha256,
      phase: finalCheckpoint.phase,
      lane: finalCheckpoint.lane,
    },
    current: null,
    nextPreparation: null,
    terminal: {
      status: 'COMPLETE', reason: 'ACTIVATION_FINALIZED', at: finalCheckpoint.finalizedAt,
    },
  };
  await assertMakerV8PublicationPlanIdentityV8(finalPlan);
  {
    const transaction = database.transaction(['plans', 'activeScopes', 'blobs'], 'readwrite');
    const completion = idbDone(transaction);
    transaction.objectStore('plans').put(finalPlan);
    transaction.objectStore('activeScopes').delete(finalPlan.scopeKey);
    transaction.objectStore('blobs').put(fullBlob);
    transaction.objectStore('blobs').put(signatureBlob);
    await completion;
  }

  const originalStoreGetAll = IDBObjectStore.prototype.getAll;
  const originalIndexGetAll = IDBIndex.prototype.getAll;
  const originalCount = IDBIndex.prototype.count;
  const originalOpenCursor = IDBIndex.prototype.openCursor;
  const originalBuild = Transaction.prototype.build;
  const originalFetch = globalThis.fetch;
  const observed = {
    getAll: 0, count: 0, cursor: 0, compilerBuild: 0, network: 0,
  };
  IDBObjectStore.prototype.getAll = function getAll(...args) {
    if (['attempts', 'attemptHeads', 'checkpoints'].includes(this.name)) observed.getAll += 1;
    return originalStoreGetAll.apply(this, args);
  };
  IDBIndex.prototype.getAll = function getAll(...args) {
    if (['attempts', 'attemptHeads', 'checkpoints'].includes(this.objectStore.name)) observed.getAll += 1;
    return originalIndexGetAll.apply(this, args);
  };
  IDBIndex.prototype.count = function count(...args) {
    if (['attempts', 'attemptHeads', 'checkpoints'].includes(this.objectStore.name)) observed.count += 1;
    return originalCount.apply(this, args);
  };
  IDBIndex.prototype.openCursor = function openCursor(...args) {
    if (['attempts', 'attemptHeads', 'checkpoints'].includes(this.objectStore.name)) observed.cursor += 1;
    return originalOpenCursor.apply(this, args);
  };
  Transaction.prototype.build = function build(...args) {
    observed.compilerBuild += 1;
    return originalBuild.apply(this, args);
  };
  globalThis.fetch = async (...args) => {
    observed.network += 1;
    return originalFetch(...args);
  };
  const heapBefore = process.memoryUsage().heapUsed;
  const startedAt = performance.now();
  let loadedPlan;
  let loadedHead;
  try {
    [loadedPlan, loadedHead] = await within(Promise.all([
      store.loadPlan(finalPlan.attemptId),
      store.loadHead(finalPlan.attemptId),
    ]), 5_000);
  } finally {
    IDBObjectStore.prototype.getAll = originalStoreGetAll;
    IDBIndex.prototype.getAll = originalIndexGetAll;
    IDBIndex.prototype.count = originalCount;
    IDBIndex.prototype.openCursor = originalOpenCursor;
    Transaction.prototype.build = originalBuild;
    globalThis.fetch = originalFetch;
  }
  const elapsedMilliseconds = performance.now() - startedAt;
  const heapGrowthBytes = Math.max(0, process.memoryUsage().heapUsed - heapBefore);
  assert.equal(loadedPlan.status, 'COMPLETE');
  assert.equal(loadedPlan.head.ordinal, checkpointCount - 1);
  assert.equal(loadedHead.ordinal, checkpointCount - 1);
  assert.equal(loadedHead.phase, 'ACTIVATION_FINALIZE');
  assert.equal(observed.getAll, 0);
  assert.ok(observed.count > 0);
  assert.ok(observed.cursor > 0);
  assert.equal(observed.compilerBuild, 0);
  assert.equal(observed.network, 0);
  assert.ok(elapsedMilliseconds < 5_000, `hot resume took ${elapsedMilliseconds.toFixed(1)}ms`);
  assert.ok(heapGrowthBytes < 256 * 1024 * 1024, `hot resume grew heap by ${heapGrowthBytes} bytes`);
  t.diagnostic(
    `near-limit hot resume: ${checkpointCount} checkpoints, ${attemptCount} events, `
      + `${elapsedMilliseconds.toFixed(1)}ms, ${heapGrowthBytes} heap bytes, 0 prefix getAll`,
  );

  // Prove the actual IDB counts—not only numeric plan fields—fail closed over
  // both bounded history envelopes. Payload validity is intentionally irrelevant:
  // count gates run before any out-of-range row can become an authority.
  {
    const transaction = database.transaction('checkpoints', 'readwrite');
    const completion = idbDone(transaction);
    const checkpoints = transaction.objectStore('checkpoints');
    for (let ordinal = checkpointCount;
      ordinal <= MAKER_V8_PUBLICATION_HISTORY_LIMITS.maxCheckpoints; ordinal += 1) {
      checkpoints.add({ ...finalCheckpoint, ordinal });
    }
    await completion;
  }
  await assert.rejects(store.loadPlan(finalPlan.attemptId), {
    code: 'MAKER_V8_PUBLICATION_HISTORY_LIMIT_EXCEEDED',
  });

  const overAttemptCount = MAKER_V8_PUBLICATION_HISTORY_LIMITS.maxAttemptEvents + 1;
  let remaining = overAttemptCount - attemptCount;
  let synthetic = 0;
  while (remaining > 0) {
    const transaction = database.transaction('attempts', 'readwrite');
    const completion = idbDone(transaction);
    const attempts = transaction.objectStore('attempts');
    const count = Math.min(remaining, 1_024);
    for (let index = 0; index < count; index += 1) {
      attempts.add({
        ...finalAttempt,
        ordinal: checkpointCount + Math.floor(synthetic / 16),
        sequence: synthetic % 16,
      });
      synthetic += 1;
    }
    await completion;
    remaining -= count;
  }
  {
    const transaction = database.transaction('plans', 'readwrite');
    const completion = idbDone(transaction);
    transaction.objectStore('plans').put({
      ...finalPlan,
      attemptHistory: {
        totalEvents: MAKER_V8_PUBLICATION_HISTORY_LIMITS.maxAttemptEvents,
        excessEvents: MAKER_V8_PUBLICATION_HISTORY_LIMITS.maxExcessEvents,
        globalAttemptHeadSha256: finalAttempt.eventSha256,
      },
    });
    await completion;
  }
  await assert.rejects(store.loadPlan(finalPlan.attemptId), {
    code: 'MAKER_V8_PUBLICATION_ATTEMPT_GLOBAL_CHAIN_INVALID',
  });

  database.close();
  store.close();
});
