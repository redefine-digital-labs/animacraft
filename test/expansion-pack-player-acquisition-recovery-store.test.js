import assert from 'node:assert/strict';
import test from 'node:test';

import { fromBase64 } from '@mysten/bcs';
import { TransactionDataBuilder } from '@mysten/sui/transactions';
import {
  EXPANSION_PACK_PLAYER_ACQUISITION_DATABASE_NAME,
  EXPANSION_PACK_PLAYER_ACQUISITION_DATABASE_VERSION,
  EXPANSION_PACK_PLAYER_ACQUISITION_ERROR,
  EXPANSION_PACK_PLAYER_ACQUISITION_FAILURE_STORE,
  EXPANSION_PACK_PLAYER_ACQUISITION_PENDING_STORE,
  EXPANSION_PACK_PLAYER_ACQUISITION_RECEIPT_STORE,
  EXPANSION_PACK_PLAYER_ACQUISITION_STATE,
  createExpansionPackPlayerAcquisitionRecoveryStore,
  expansionPackPlayerAcquisitionIdentity,
} from '../expansion-pack-player-acquisition-recovery-store.js';

function clone(value) {
  return value == null ? value : structuredClone(value);
}

class MemoryRequest {
  constructor(run) {
    queueMicrotask(() => {
      try {
        this.result = run();
        this.onsuccess?.();
      } catch (error) {
        this.error = error;
        this.onerror?.();
      }
    });
  }
}

class MemoryStore {
  constructor(transaction, records, definition) {
    this.transaction = transaction;
    this.records = records;
    this.definition = definition;
    this.indexNames = { contains: (name) => this.definition.indexes.has(name) };
  }

  createIndex(name, keyPath) {
    this.definition.indexes.set(name, keyPath);
  }

  get(key) {
    const request = new MemoryRequest(() => clone(this.records.get(key)));
    this.transaction.scheduleComplete();
    return request;
  }

  put(value) {
    const record = clone(value);
    this.records.set(record[this.definition.keyPath], record);
    this.transaction.scheduleComplete();
  }

  delete(key) {
    this.records.delete(key);
    this.transaction.scheduleComplete();
  }
}

class MemoryTransaction {
  constructor(database) {
    this.database = database;
    this.completionScheduled = false;
    this.aborted = false;
    this.error = null;
  }

  objectStore(name) {
    return new MemoryStore(
      this,
      this.database.records.get(name),
      this.database.definitions.get(name),
    );
  }

  scheduleComplete() {
    if (this.completionScheduled) return;
    this.completionScheduled = true;
    setTimeout(() => {
      if (!this.aborted) this.oncomplete?.();
    }, 0);
  }

  abort() {
    this.aborted = true;
    queueMicrotask(() => this.onabort?.());
  }
}

class MemoryDatabase {
  constructor() {
    this.records = new Map();
    this.definitions = new Map();
    this.objectStoreNames = { contains: (name) => this.records.has(name) };
  }

  createObjectStore(name, { keyPath }) {
    this.records.set(name, new Map());
    this.definitions.set(name, { keyPath, indexes: new Map() });
    return new MemoryStore(
      { scheduleComplete() {} },
      this.records.get(name),
      this.definitions.get(name),
    );
  }

  transaction() {
    return new MemoryTransaction(this);
  }

  close() {}
}

function memoryIndexedDb() {
  const database = new MemoryDatabase();
  const openCalls = [];
  let initialized = false;
  return {
    database,
    openCalls,
    factory: {
      open(name, version) {
        openCalls.push({ name, version });
        const request = {};
        queueMicrotask(() => {
          try {
            request.result = database;
            request.transaction = database.transaction();
            if (!initialized) {
              initialized = true;
              request.onupgradeneeded?.();
            }
            queueMicrotask(() => request.onsuccess?.());
          } catch (error) {
            request.error = error;
            queueMicrotask(() => request.onerror?.());
          }
        });
        return request;
      },
    },
  };
}

const COMMITMENT = '11'.repeat(32);
const SESSION = 'acquire-session-0001';

function acquisitionIdentity(overrides = {}) {
  return {
    walletAddress: '0x111',
    parentRootId: '0x222',
    makerVersionNumber: '7',
    makerVersionId: 'maker-root-v7',
    releaseId: '0x333',
    accessKind: 'PAID_ONCE',
    priceAtomic: '6000000',
    contentCommitment: COMMITMENT,
    ...overrides,
  };
}

function signedFixture(bytes = 'AQID', signature = 'signature:exact:0001') {
  return {
    bytes,
    signature,
    digest: TransactionDataBuilder.getDigestFromBytes(fromBase64(bytes)),
    signedAt: '2026-08-11T08:00:00.000Z',
  };
}

function verifiedReceipt(identityValue, signed, overrides = {}) {
  const identity = expansionPackPlayerAcquisitionIdentity(identityValue);
  return {
    verifiedReadback: true,
    passId: '0x444',
    transactionDigest: signed.digest,
    holder: identity.walletAddress,
    parentRootId: identity.parentRootId,
    makerVersionNumber: identity.makerVersionNumber,
    makerVersionId: identity.makerVersionId,
    releaseId: identity.releaseId,
    accessKind: identity.accessKind,
    priceAtomic: identity.priceAtomic,
    contentCommitment: identity.contentCommitment,
    ...overrides,
  };
}

function finalizedFailure(signed, overrides = {}) {
  return {
    finalized: true,
    transactionDigest: signed.digest,
    executionStatus: 'FAILURE',
    executionError: {
      kind: 'MoveAbort',
      message: 'MoveAbort EInvalidLifecycle',
      command: 2,
      abortCode: '17',
    },
    ...overrides,
  };
}

test('immutable acquisition key isolates wallet, parent, Maker version, release, access, price and content', async () => {
  const memory = memoryIndexedDb();
  const store = createExpansionPackPlayerAcquisitionRecoveryStore({
    indexedDB: memory.factory,
    clock: () => 1000,
  });
  const variants = [
    acquisitionIdentity(),
    acquisitionIdentity({ walletAddress: '0x112' }),
    acquisitionIdentity({ parentRootId: '0x223' }),
    acquisitionIdentity({ makerVersionNumber: '8' }),
    acquisitionIdentity({ makerVersionId: 'maker-root-v7-hotfix' }),
    acquisitionIdentity({ releaseId: '0x334' }),
    acquisitionIdentity({ accessKind: 'FREE', priceAtomic: '0' }),
    acquisitionIdentity({ priceAtomic: '6000001' }),
    acquisitionIdentity({ contentCommitment: '22'.repeat(32) }),
  ];
  const keys = variants.map((identity) => expansionPackPlayerAcquisitionIdentity(identity).key);
  assert.equal(new Set(keys).size, variants.length);

  for (let index = 0; index < variants.length; index += 1) {
    const signed = signedFixture(Buffer.from(`transaction-${index}`).toString('base64'), `sig-${index}-exact`);
    const result = await store.persistSignedTransaction(variants[index], signed, {
      expectedRevision: 0,
      sessionId: `session-isolation-${String(index).padStart(2, '0')}`,
    });
    assert.equal(result.record.key, keys[index]);
    assert.equal(result.record.signed.digest, signed.digest);
  }
  for (let index = 0; index < variants.length; index += 1) {
    const loaded = await store.loadPending(variants[index]);
    assert.equal(loaded.key, keys[index]);
    assert.equal(loaded.signed.signature, `sig-${index}-exact`);
  }
  assert.deepEqual(memory.openCalls[0], {
    name: EXPANSION_PACK_PLAYER_ACQUISITION_DATABASE_NAME,
    version: EXPANSION_PACK_PLAYER_ACQUISITION_DATABASE_VERSION,
  });
  assert.equal(
    memory.database.records.get(EXPANSION_PACK_PLAYER_ACQUISITION_PENDING_STORE).size,
    variants.length,
  );
});

test('persists exact signed bytes/signature/digest and verifies durable readback', async () => {
  const memory = memoryIndexedDb();
  const store = createExpansionPackPlayerAcquisitionRecoveryStore({
    indexedDB: memory.factory,
    clock: () => 2000,
  });
  const identity = acquisitionIdentity();
  const signed = signedFixture();
  const saved = await store.persistSignedTransaction(identity, signed, {
    expectedRevision: 0,
    sessionId: SESSION,
  });
  assert.equal(saved.saved, true);
  assert.equal(saved.verified, true);
  assert.equal(saved.idempotent, false);
  assert.equal(saved.record.revision, 1);
  assert.equal(saved.record.state, EXPANSION_PACK_PLAYER_ACQUISITION_STATE.SIGNED);
  assert.deepEqual(saved.record.signed, signed);
  assert.equal(Object.isFrozen(saved.record), true);
  assert.equal(Object.isFrozen(saved.record.signed), true);
  assert.equal('snapshot' in saved.record, false);
  assert.equal('assets' in saved.record, false);
  assert.equal('manifest' in saved.record, false);

  const loaded = await store.loadPending(identity);
  assert.deepEqual(loaded.signed, signed);
  assert.equal(loaded.sessionId, SESSION);

  await assert.rejects(
    store.persistSignedTransaction(identity, { ...signed, digest: 'wrong-digest' }, {
      expectedRevision: 1,
      sessionId: SESSION,
    }),
    (caught) => caught.code === EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.DIGEST_MISMATCH,
  );
});

test('stale CAS and recovery-session writers cannot mutate a pending transaction', async () => {
  const memory = memoryIndexedDb();
  const store = createExpansionPackPlayerAcquisitionRecoveryStore({ indexedDB: memory.factory });
  const identity = acquisitionIdentity();
  const signed = signedFixture();
  await store.persistSignedTransaction(identity, signed, {
    expectedRevision: 0,
    sessionId: SESSION,
  });
  const broadcasting = await store.checkpointPending(identity, {
    state: EXPANSION_PACK_PLAYER_ACQUISITION_STATE.BROADCASTING,
  }, {
    expectedRevision: 1,
    sessionId: SESSION,
  });
  assert.equal(broadcasting.revision, 2);
  assert.equal(broadcasting.attemptCount, 1);
  assert.deepEqual(broadcasting.signed, signed);

  await assert.rejects(
    store.checkpointPending(identity, {
      state: EXPANSION_PACK_PLAYER_ACQUISITION_STATE.OUTCOME_PENDING,
      lastErrorCode: 'TRANSACTION_OUTCOME_PENDING',
    }, {
      expectedRevision: 1,
      sessionId: SESSION,
    }),
    (caught) => (
      caught.code === EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.CAS_CONFLICT
      && caught.details.actualRevision === 2
    ),
  );
  await assert.rejects(
    store.checkpointPending(identity, {
      state: EXPANSION_PACK_PLAYER_ACQUISITION_STATE.OUTCOME_PENDING,
    }, {
      expectedRevision: 2,
      sessionId: 'another-session-0001',
    }),
    (caught) => caught.code === EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.SESSION_CONFLICT,
  );
  assert.deepEqual((await store.loadPending(identity)).signed, signed);
});

test('requires durable exact receipt before guarded replay-byte cleanup', async () => {
  const memory = memoryIndexedDb();
  const store = createExpansionPackPlayerAcquisitionRecoveryStore({
    indexedDB: memory.factory,
    clock: () => 3000,
  });
  const identity = acquisitionIdentity();
  const signed = signedFixture();
  await store.persistSignedTransaction(identity, signed, {
    expectedRevision: 0,
    sessionId: SESSION,
  });

  await assert.rejects(
    store.cleanupPending(identity, {
      expectedRevision: 1,
      receiptRevision: 1,
      sessionId: SESSION,
      transactionDigest: signed.digest,
    }),
    (caught) => caught.code === EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.RECEIPT_REQUIRED,
  );
  assert.ok(await store.loadPending(identity));

  const receipt = await store.storeVerifiedReceipt(
    identity,
    verifiedReceipt(identity, signed),
    { expectedRevision: 1, sessionId: SESSION },
  );
  assert.equal(receipt.verified, true);
  assert.equal(receipt.record.receiptRevision, 1);
  assert.equal(receipt.record.pendingRevision, 1);
  assert.equal(receipt.record.transactionDigest, signed.digest);
  assert.ok(await store.loadPending(identity), 'signed replay bytes survive receipt storage');
  assert.ok(await store.loadVerifiedReceipt(identity));
  assert.equal(
    memory.database.records.get(EXPANSION_PACK_PLAYER_ACQUISITION_RECEIPT_STORE).size,
    1,
  );

  const cleaned = await store.cleanupPending(identity, {
    expectedRevision: 1,
    receiptRevision: 1,
    sessionId: SESSION,
    transactionDigest: signed.digest,
  });
  assert.deepEqual(cleaned, { deleted: true, alreadyClean: false });
  assert.equal(await store.loadPending(identity), null);
  assert.equal((await store.loadVerifiedReceipt(identity)).transactionDigest, signed.digest);
});

test('ambiguous broadcast outcome reloads and replays only the exact persisted transaction', async () => {
  const memory = memoryIndexedDb();
  const identity = acquisitionIdentity();
  const signed = signedFixture('dHJhbnNhY3Rpb24tYW1iaWd1b3Vz', 'signature:ambiguous:0001');
  const firstSession = createExpansionPackPlayerAcquisitionRecoveryStore({
    indexedDB: memory.factory,
  });
  await firstSession.persistSignedTransaction(identity, signed, {
    expectedRevision: 0,
    sessionId: SESSION,
  });
  const broadcasting = await firstSession.checkpointPending(identity, {
    state: EXPANSION_PACK_PLAYER_ACQUISITION_STATE.BROADCASTING,
  }, {
    expectedRevision: 1,
    sessionId: SESSION,
  });
  const ambiguous = await firstSession.checkpointPending(identity, {
    state: EXPANSION_PACK_PLAYER_ACQUISITION_STATE.OUTCOME_PENDING,
    lastErrorCode: 'TRANSACTION_OUTCOME_PENDING',
  }, {
    expectedRevision: broadcasting.revision,
    sessionId: SESSION,
  });
  assert.equal(ambiguous.revision, 3);

  const afterReload = createExpansionPackPlayerAcquisitionRecoveryStore({
    indexedDB: memory.factory,
  });
  const recovered = await afterReload.loadPending(identity);
  assert.equal(recovered.state, EXPANSION_PACK_PLAYER_ACQUISITION_STATE.OUTCOME_PENDING);
  assert.equal(recovered.lastErrorCode, 'TRANSACTION_OUTCOME_PENDING');
  assert.deepEqual(recovered.signed, signed);

  const differentSigned = signedFixture('bmV3LXRyYW5zYWN0aW9u', 'signature:different:0001');
  await assert.rejects(
    afterReload.persistSignedTransaction(identity, differentSigned, {
      expectedRevision: recovered.revision,
      sessionId: SESSION,
    }),
    (caught) => (
      caught.code
      === EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.SIGNED_TRANSACTION_IMMUTABLE
    ),
  );
  const replaying = await afterReload.checkpointPending(identity, {
    state: EXPANSION_PACK_PLAYER_ACQUISITION_STATE.BROADCASTING,
  }, {
    expectedRevision: recovered.revision,
    sessionId: SESSION,
  });
  assert.equal(replaying.revision, 4);
  assert.equal(replaying.attemptCount, 2);
  assert.deepEqual(replaying.signed, signed);
});

test('archives exact finalized failure before removing replay bytes and permits only a fresh digest', async () => {
  const memory = memoryIndexedDb();
  const identity = acquisitionIdentity();
  const signed = signedFixture('ZmFpbGVkLXRyYW5zYWN0aW9u', 'signature:failed:0001');
  const store = createExpansionPackPlayerAcquisitionRecoveryStore({
    indexedDB: memory.factory,
    clock: () => 4000,
  });
  await store.persistSignedTransaction(identity, signed, {
    expectedRevision: 0,
    sessionId: SESSION,
  });
  const broadcasting = await store.checkpointPending(identity, {
    state: EXPANSION_PACK_PLAYER_ACQUISITION_STATE.BROADCASTING,
  }, {
    expectedRevision: 1,
    sessionId: SESSION,
  });
  const archived = await store.storeFinalizedFailure(
    identity,
    finalizedFailure(signed),
    { expectedRevision: broadcasting.revision, sessionId: SESSION },
  );
  assert.equal(archived.verified, true);
  assert.equal(archived.record.transactionDigest, signed.digest);
  assert.equal(archived.record.executionStatus, 'FAILURE');
  assert.equal(archived.record.pendingRevision, broadcasting.revision);
  assert.equal(await store.loadPending(identity), null);
  assert.deepEqual(
    await store.loadFinalizedFailure(identity, signed.digest),
    archived.record,
  );
  assert.equal(
    memory.database.records.get(EXPANSION_PACK_PLAYER_ACQUISITION_FAILURE_STORE).size,
    1,
  );

  const repeated = await store.storeFinalizedFailure(
    identity,
    finalizedFailure(signed),
    { expectedRevision: broadcasting.revision, sessionId: SESSION },
  );
  assert.equal(repeated.idempotent, true);
  await assert.rejects(
    store.persistSignedTransaction(identity, signed, {
      expectedRevision: 0,
      sessionId: 'fresh-session-0001',
    }),
    (caught) => (
      caught.code === EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.ALREADY_FINALIZED_FAILED
    ),
  );

  const fresh = signedFixture('ZnJlc2gtdHJhbnNhY3Rpb24=', 'signature:fresh:0001');
  const savedFresh = await store.persistSignedTransaction(identity, fresh, {
    expectedRevision: 0,
    sessionId: 'fresh-session-0001',
  });
  assert.equal(savedFresh.record.signed.digest, fresh.digest);
});

test('unverified, wrong-digest and stale finalized failure evidence preserves exact pending bytes', async () => {
  const memory = memoryIndexedDb();
  const identity = acquisitionIdentity();
  const signed = signedFixture('ZmFpbHVyZS1ndWFyZA==', 'signature:failure-guard:0001');
  const store = createExpansionPackPlayerAcquisitionRecoveryStore({ indexedDB: memory.factory });
  await store.persistSignedTransaction(identity, signed, {
    expectedRevision: 0,
    sessionId: SESSION,
  });
  for (const [evidence, options, expectedCode] of [
    [finalizedFailure(signed, { finalized: false }), { expectedRevision: 1, sessionId: SESSION },
      EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.FINALIZED_FAILURE_INVALID],
    [finalizedFailure(signed, { transactionDigest: 'another-digest' }),
      { expectedRevision: 1, sessionId: SESSION },
      EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.DIGEST_MISMATCH],
    [finalizedFailure(signed), { expectedRevision: 2, sessionId: SESSION },
      EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.CAS_CONFLICT],
    [finalizedFailure(signed), { expectedRevision: 1, sessionId: 'wrong-session-0001' },
      EXPANSION_PACK_PLAYER_ACQUISITION_ERROR.SESSION_CONFLICT],
  ]) {
    await assert.rejects(
      store.storeFinalizedFailure(identity, evidence, options),
      (caught) => caught.code === expectedCode,
    );
    assert.deepEqual((await store.loadPending(identity)).signed, signed);
  }
});
