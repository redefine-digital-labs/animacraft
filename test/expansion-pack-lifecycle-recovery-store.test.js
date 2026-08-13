import assert from 'node:assert/strict';
import test from 'node:test';
import { fromBase64 } from '@mysten/bcs';
import { TransactionDataBuilder } from '@mysten/sui/transactions';

import {
  EXPANSION_PACK_LIFECYCLE_DATABASE_NAME,
  EXPANSION_PACK_LIFECYCLE_FAILURE_STORE,
  EXPANSION_PACK_LIFECYCLE_PENDING_STORE,
  EXPANSION_PACK_LIFECYCLE_RECEIPT_STORE,
  EXPANSION_PACK_LIFECYCLE_RECOVERY_ERROR,
  createExpansionPackLifecycleRecoveryStore,
  expansionPackLifecycleRecoveryIdentity,
} from '../expansion-pack-lifecycle-recovery-store.js';

function clone(value) { return value == null ? value : structuredClone(value); }
class Request {
  constructor(run) {
    queueMicrotask(() => {
      try { this.result = run(); this.onsuccess?.(); }
      catch (error) { this.error = error; this.onerror?.(); }
    });
  }
}
class Store {
  constructor(transaction, records, definition) {
    this.transaction = transaction; this.records = records; this.definition = definition;
  }
  createIndex(name, keyPath) { this.definition.indexes.set(name, keyPath); }
  get(key) { const request = new Request(() => clone(this.records.get(key))); this.transaction.touch(); return request; }
  put(value) { this.records.set(value[this.definition.keyPath], clone(value)); this.transaction.touch(); }
  delete(key) { this.records.delete(key); this.transaction.touch(); }
}
class Transaction {
  constructor(database) { this.database = database; this.scheduled = false; }
  objectStore(name) { return new Store(this, this.database.records.get(name), this.database.definitions.get(name)); }
  touch() {
    if (this.scheduled) return;
    this.scheduled = true;
    setTimeout(() => this.oncomplete?.(), 0);
  }
}
class Database {
  constructor() {
    this.records = new Map(); this.definitions = new Map();
    this.objectStoreNames = { contains: (name) => this.records.has(name) };
  }
  createObjectStore(name, { keyPath }) {
    this.records.set(name, new Map()); this.definitions.set(name, { keyPath, indexes: new Map() });
    return new Store({ touch() {} }, this.records.get(name), this.definitions.get(name));
  }
  transaction() { return new Transaction(this); }
  close() {}
}
function memoryIndexedDB() {
  const database = new Database();
  let initialized = false;
  const opens = [];
  return {
    database, opens,
    factory: { open(name, version) {
      opens.push({ name, version });
      const request = {};
      queueMicrotask(() => {
        request.result = database;
        if (!initialized) { initialized = true; request.onupgradeneeded?.(); }
        queueMicrotask(() => request.onsuccess?.());
      });
      return request;
    } },
  };
}

const SESSION = 'lifecycle-session-0001';
function identity(overrides = {}) {
  return {
    walletAddress: '0x9', releaseId: '0x3', adminCapId: '0x4', parentRootId: '0x1',
    action: 'pause', fromLifecycle: 3, toLifecycle: 4, ...overrides,
  };
}
function signed(bytes = 'AQID') {
  return {
    bytes,
    signature: 'exact-signature-0001',
    digest: TransactionDataBuilder.getDigestFromBytes(fromBase64(bytes)),
    signedAt: '2026-08-14T00:00:00.000Z',
  };
}

test('identity binds wallet, release, admin, parent, action and exact transition', () => {
  const variants = [
    identity(), identity({ walletAddress: '0xa' }), identity({ releaseId: '0x30' }),
    identity({ adminCapId: '0x40' }), identity({ parentRootId: '0x10' }),
    identity({ action: 'resume', fromLifecycle: 4, toLifecycle: 3 }),
  ];
  assert.equal(new Set(variants.map((entry) => expansionPackLifecycleRecoveryIdentity(entry).key)).size,
    variants.length);
  assert.throws(() => expansionPackLifecycleRecoveryIdentity(identity({
    action: 'archive', fromLifecycle: 3, toLifecycle: 5,
  })), { code: EXPANSION_PACK_LIFECYCLE_RECOVERY_ERROR.IDENTITY_INVALID });
});

test('signed bytes are durably persisted before broadcast and remain immutable under CAS', async () => {
  const memory = memoryIndexedDB();
  const store = createExpansionPackLifecycleRecoveryStore({ indexedDB: memory.factory, clock: () => 1000 });
  const exact = signed();
  const saved = await store.persistSignedTransaction(identity(), exact, {
    expectedRevision: 0, sessionId: SESSION,
  });
  assert.equal(saved.verified, true);
  assert.deepEqual(saved.record.signed, exact);
  assert.equal(memory.database.records.get(EXPANSION_PACK_LIFECYCLE_PENDING_STORE).size, 1);
  assert.equal(memory.opens[0].name, EXPANSION_PACK_LIFECYCLE_DATABASE_NAME);

  const broadcasting = await store.checkpointPending(identity(), { state: 'BROADCASTING' }, {
    expectedRevision: 1, sessionId: SESSION,
  });
  assert.equal(broadcasting.revision, 2);
  assert.equal(broadcasting.attemptCount, 1);
  assert.deepEqual(broadcasting.signed, exact);

  await assert.rejects(store.checkpointPending(identity(), { state: 'OUTCOME_PENDING' }, {
    expectedRevision: 1, sessionId: SESSION,
  }), { code: EXPANSION_PACK_LIFECYCLE_RECOVERY_ERROR.CAS_CONFLICT });
  await assert.rejects(store.persistSignedTransaction(identity(), signed('BAUG'), {
    expectedRevision: 2, sessionId: SESSION,
  }), { code: EXPANSION_PACK_LIFECYCLE_RECOVERY_ERROR.SIGNED_IMMUTABLE });
});

test('only exact successful readback retires pending bytes into verified receipt', async () => {
  const memory = memoryIndexedDB();
  const store = createExpansionPackLifecycleRecoveryStore({ indexedDB: memory.factory, clock: () => 2000 });
  const exact = signed();
  await store.persistSignedTransaction(identity(), exact, { expectedRevision: 0, sessionId: SESSION });
  await assert.rejects(store.storeVerifiedReceipt(identity(), {
    readbackVerified: true, transactionDigest: exact.digest,
    previousLifecycle: 2, lifecycle: 4,
  }, { expectedRevision: 1, sessionId: SESSION }), {
    code: EXPANSION_PACK_LIFECYCLE_RECOVERY_ERROR.RECEIPT_INVALID,
  });
  assert.ok(await store.loadPending(identity()));

  const receipt = await store.storeVerifiedReceipt(identity(), {
    readbackVerified: true, transactionDigest: exact.digest,
    previousLifecycle: 3, lifecycle: 4,
  }, { expectedRevision: 1, sessionId: SESSION });
  assert.equal(receipt.executionStatus, 'SUCCESS');
  assert.equal(await store.loadPending(identity()), null);
  assert.equal((await store.loadVerifiedReceipt(identity())).transactionDigest, exact.digest);
  assert.equal(memory.database.records.get(EXPANSION_PACK_LIFECYCLE_RECEIPT_STORE).size, 1);
});

test('only definitive finalized failure retires replay bytes and blocks replacement signing', async () => {
  const memory = memoryIndexedDB();
  const store = createExpansionPackLifecycleRecoveryStore({ indexedDB: memory.factory, clock: () => 3000 });
  const exact = signed();
  await store.persistSignedTransaction(identity(), exact, { expectedRevision: 0, sessionId: SESSION });
  await assert.rejects(store.storeFinalizedFailure(identity(), {
    finalized: false, executionStatus: 'FAILURE', transactionDigest: exact.digest,
  }, { expectedRevision: 1, sessionId: SESSION }), {
    code: EXPANSION_PACK_LIFECYCLE_RECOVERY_ERROR.FINALIZED_FAILURE_INVALID,
  });
  assert.ok(await store.loadPending(identity()));

  const failure = await store.storeFinalizedFailure(identity(), {
    finalized: true, executionStatus: 'FAILURE', transactionDigest: exact.digest,
    executionError: { kind: 'MoveAbort', message: 'EInvalidLifecycle' },
  }, { expectedRevision: 1, sessionId: SESSION });
  assert.equal(failure.executionStatus, 'FAILURE');
  assert.equal(await store.loadPending(identity()), null);
  assert.equal((await store.loadFinalizedFailure(identity(), exact.digest)).transactionDigest,
    exact.digest);
  assert.equal(memory.database.records.get(EXPANSION_PACK_LIFECYCLE_FAILURE_STORE).size, 1);
  await assert.rejects(store.persistSignedTransaction(identity(), exact, {
    expectedRevision: 0, sessionId: SESSION,
  }), { code: EXPANSION_PACK_LIFECYCLE_RECOVERY_ERROR.ALREADY_FINALIZED_FAILED });
  await assert.rejects(store.persistSignedTransaction(identity(), signed('BAUG'), {
    expectedRevision: 0, sessionId: SESSION,
  }), { code: EXPANSION_PACK_LIFECYCLE_RECOVERY_ERROR.ALREADY_FINALIZED_FAILED });
});
