import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deleteMakerUploadRecovery,
  loadMakerUploadRecovery,
  saveMakerUploadRecovery,
} from '../draft-store.js';

class MemoryRequest {
  constructor(run) {
    this.result = undefined;
    this.error = null;
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
  constructor(transaction, records, keyPath) {
    this.transaction = transaction;
    this.records = records;
    this.keyPath = keyPath;
  }

  createIndex() {}

  get(key) {
    const request = new MemoryRequest(() => structuredClone(this.records.get(key)));
    this.transaction.scheduleComplete();
    return request;
  }

  put(value) {
    const copy = structuredClone(value);
    this.records.set(copy[this.keyPath], copy);
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
    this.error = null;
    this.completionScheduled = false;
  }

  objectStore(name) {
    return new MemoryStore(this, this.database.records.get(name), this.database.keyPaths.get(name));
  }

  scheduleComplete() {
    if (this.completionScheduled) return;
    this.completionScheduled = true;
    setTimeout(() => this.oncomplete?.(), 0);
  }
}

class MemoryDatabase {
  constructor() {
    this.records = new Map();
    this.keyPaths = new Map();
    this.objectStoreNames = { contains: (name) => this.records.has(name) };
  }

  createObjectStore(name, { keyPath }) {
    this.records.set(name, new Map());
    this.keyPaths.set(name, keyPath);
    return new MemoryStore({ scheduleComplete() {} }, this.records.get(name), keyPath);
  }

  transaction() {
    return new MemoryTransaction(this);
  }

  close() {}
}

function memoryIndexedDb() {
  const database = new MemoryDatabase();
  let initialized = false;
  return {
    database,
    factory: {
      open() {
        const request = {};
        queueMicrotask(() => {
          request.result = database;
          if (!initialized) {
            initialized = true;
            request.onupgradeneeded?.();
          }
          queueMicrotask(() => request.onsuccess?.());
        });
        return request;
      },
    },
  };
}

async function withMemoryIndexedDb(run) {
  const previous = globalThis.indexedDB;
  const memory = memoryIndexedDb();
  globalThis.indexedDB = memory.factory;
  try {
    await run(memory.database);
  } finally {
    globalThis.indexedDB = previous;
  }
}

test('upload recovery save performs revision and session compare-and-swap', async () => {
  await withMemoryIndexedDb(async () => {
    const first = await saveMakerUploadRecovery(
      'wallet:maker',
      {
        uploadSessionId: 'upload-one',
        recoveryRevision: 0,
        owner: '0x1',
        quiltBlobId: 'quilt-one',
        checkpoint: { step: 'encoded', blobId: 'quilt-one' },
      },
      { expectedRevision: 0 },
    );
    assert.equal(first.recoveryRevision, 1);
    assert.equal(first.uploadSessionId, 'upload-one');
    assert.equal((await loadMakerUploadRecovery('wallet:maker')).recoveryRevision, 1);

    const second = await saveMakerUploadRecovery(
      'wallet:maker',
      { ...first, checkpoint: { step: 'registered', blobId: 'quilt-one' } },
      { expectedRevision: 1 },
    );
    assert.equal(second.recoveryRevision, 2);

    await assert.rejects(
      saveMakerUploadRecovery(
        'wallet:maker',
        { ...first, checkpoint: { step: 'uploaded', blobId: 'quilt-one' } },
        { expectedRevision: 1 },
      ),
      (error) => (
        error.code === 'UPLOAD_RECOVERY_CONFLICT'
        && error.expectedRevision === 1
        && error.actualRevision === 2
      ),
    );
    await assert.rejects(
      saveMakerUploadRecovery(
        'wallet:maker',
        { ...second, uploadSessionId: 'upload-two' },
        { expectedRevision: 2 },
      ),
      (error) => (
        error.code === 'UPLOAD_RECOVERY_CONFLICT'
        && error.uploadSessionId === 'upload-two'
        && error.actualSessionId === 'upload-one'
      ),
    );

    const current = await loadMakerUploadRecovery('wallet:maker');
    assert.equal(current.recoveryRevision, 2);
    assert.equal(current.checkpoint.step, 'registered');
  });
});

test('legacy callers remain unconditional but receive the stored revision', async () => {
  await withMemoryIndexedDb(async () => {
    const first = await saveMakerUploadRecovery('wallet:maker', {
      owner: '0xABC',
      quiltBlobId: 'legacy-quilt',
      checkpoint: { step: 'encoded', blobId: 'legacy-quilt' },
    });
    assert.equal(first.recoveryRevision, 1);
    assert.equal(first.uploadSessionId, 'legacy:0xabc:legacy-quilt');

    const replacement = await saveMakerUploadRecovery('wallet:maker', {
      uploadSessionId: 'new-unconditional-session',
      checkpoint: { step: 'encoded', blobId: 'new-quilt' },
    });
    assert.equal(replacement.recoveryRevision, 2);
    assert.equal(replacement.uploadSessionId, 'new-unconditional-session');
  });
});

test('conditional delete cannot remove a newer revision or another upload session', async () => {
  await withMemoryIndexedDb(async () => {
    const stored = await saveMakerUploadRecovery(
      'wallet:maker',
      {
        uploadSessionId: 'upload-one',
        owner: '0x1',
        quiltBlobId: 'quilt-one',
        checkpoint: { step: 'uploaded', blobId: 'quilt-one' },
      },
      { expectedRevision: 0 },
    );

    assert.equal(
      await deleteMakerUploadRecovery(
        'wallet:maker',
        { expectedRevision: stored.recoveryRevision - 1, uploadSessionId: stored.uploadSessionId },
      ),
      false,
    );
    assert.equal(
      await deleteMakerUploadRecovery(
        'wallet:maker',
        { expectedRevision: stored.recoveryRevision, uploadSessionId: 'another-session' },
      ),
      false,
    );
    assert.ok(await loadMakerUploadRecovery('wallet:maker'));

    assert.equal(
      await deleteMakerUploadRecovery(
        'wallet:maker',
        { expectedRevision: stored.recoveryRevision, uploadSessionId: stored.uploadSessionId },
      ),
      true,
    );
    assert.equal(await loadMakerUploadRecovery('wallet:maker'), null);
  });
});

test('a raw legacy record can join CAS using its deterministic identity', async () => {
  await withMemoryIndexedDb(async (database) => {
    await loadMakerUploadRecovery('initialize-stores');
    database.records.get('maker-uploads').set('wallet:legacy', {
      makerKey: 'wallet:legacy',
      owner: '0xABC',
      quiltBlobId: 'legacy-quilt',
      checkpoint: { step: 'registered', blobId: 'legacy-quilt' },
    });

    const stored = await saveMakerUploadRecovery(
      'wallet:legacy',
      {
        uploadSessionId: 'legacy:0xabc:legacy-quilt',
        recoveryRevision: 0,
        owner: '0xABC',
        quiltBlobId: 'legacy-quilt',
        checkpoint: { step: 'uploaded', blobId: 'legacy-quilt' },
      },
      { expectedRevision: 0 },
    );
    assert.equal(stored.recoveryRevision, 1);
    assert.equal(stored.uploadSessionId, 'legacy:0xabc:legacy-quilt');
  });
});
