import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deleteMakerWorkspaceAssets,
  deleteMakerWorkspaceDocument,
  deletePlayerWorkspaceSession,
  loadMakerWorkspaceAssets,
  loadMakerWorkspaceDocument,
  loadPlayerWorkspaceSession,
  saveMakerWorkspaceDocument,
  savePlayerWorkspaceSession,
  upsertMakerWorkspaceAssets,
  workspaceAssetRecordId,
} from '../maker-workspace-store.js';

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
  constructor(transaction, records, definition) {
    this.transaction = transaction;
    this.records = records;
    this.definition = definition;
  }

  createIndex(name, keyPath) {
    this.definition.indexes.set(name, keyPath);
  }

  put(value) {
    const copy = structuredClone(value);
    this.records.set(copy[this.definition.keyPath], copy);
    this.transaction.scheduleComplete();
  }

  get(key) {
    const request = new MemoryRequest(() => structuredClone(this.records.get(key)));
    this.transaction.scheduleComplete();
    return request;
  }

  delete(key) {
    this.records.delete(key);
    this.transaction.scheduleComplete();
  }

  index(name) {
    const keyPath = this.definition.indexes.get(name);
    const matches = (value) => [...this.records.values()].filter((record) => record[keyPath] === value);
    return {
      getAll: (value) => {
        const request = new MemoryRequest(() => structuredClone(matches(value)));
        this.transaction.scheduleComplete();
        return request;
      },
      getAllKeys: (value) => {
        const request = new MemoryRequest(() => matches(value).map((record) => record[this.definition.keyPath]));
        this.transaction.scheduleComplete();
        return request;
      },
    };
  }
}

class MemoryTransaction {
  constructor(database) {
    this.database = database;
    this.completionScheduled = false;
    this.error = null;
  }

  objectStore(name) {
    return new MemoryStore(this, this.database.records.get(name), this.database.definitions.get(name));
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
    this.definitions = new Map();
    this.objectStoreNames = { contains: (name) => this.records.has(name) };
  }

  createObjectStore(name, { keyPath }) {
    this.records.set(name, new Map());
    this.definitions.set(name, { keyPath, indexes: new Map() });
    return new MemoryStore({ scheduleComplete() {} }, this.records.get(name), this.definitions.get(name));
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
  };
}

async function withMemoryIndexedDb(run) {
  const previous = globalThis.indexedDB;
  globalThis.indexedDB = memoryIndexedDb();
  try {
    await run();
  } finally {
    globalThis.indexedDB = previous;
  }
}

test('builds stable composite asset keys and rejects blank key segments', () => {
  assert.equal(workspaceAssetRecordId(' wallet:maker ', ' layer-one '), 'wallet:maker::layer-one');
  assert.throws(() => workspaceAssetRecordId('', 'layer'), /Maker key is required/);
  assert.throws(() => workspaceAssetRecordId('maker', '  '), /Asset id is required/);
});

test('empty lookup and delete inputs are safe without IndexedDB', async () => {
  const previous = globalThis.indexedDB;
  delete globalThis.indexedDB;
  try {
    assert.equal(await loadMakerWorkspaceDocument(''), null);
    assert.deepEqual(await loadMakerWorkspaceAssets(''), []);
    assert.equal(await loadPlayerWorkspaceSession(''), null);
    await assert.doesNotReject(() => deleteMakerWorkspaceDocument(''));
    await assert.doesNotReject(() => deleteMakerWorkspaceAssets(''));
    await assert.doesNotReject(() => deletePlayerWorkspaceSession(''));
    await assert.rejects(() => saveMakerWorkspaceDocument('maker', {}), /does not support local Maker workspace storage/);
  } finally {
    globalThis.indexedDB = previous;
  }
});

test('round-trips Maker documents as structured-cloned records', async () => withMemoryIndexedDb(async () => {
  const document = { version: { versionId: 'maker-v1' }, parts: [{ id: 'body' }] };
  const metadata = { recipe: { selections: [{ partId: 'body', itemId: 'base' }] } };
  await saveMakerWorkspaceDocument('wallet:maker', document, metadata);
  document.parts[0].id = 'mutated-after-save';
  metadata.recipe.selections[0].itemId = 'mutated-after-save';
  const loaded = await loadMakerWorkspaceDocument('wallet:maker');
  assert.equal(loaded.makerKey, 'wallet:maker');
  assert.equal(loaded.document.parts[0].id, 'body');
  assert.equal(loaded.metadata.recipe.selections[0].itemId, 'base');
  assert.equal(typeof loaded.savedAt, 'number');
  await deleteMakerWorkspaceDocument('wallet:maker');
  assert.equal(await loadMakerWorkspaceDocument('wallet:maker'), null);
}));
test('upserts, scopes and selectively deletes Blob-backed Maker assets', async () => withMemoryIndexedDb(async () => {
  await upsertMakerWorkspaceAssets('maker-a', [
    { assetId: 'one', blob: new Blob(['one']), width: 10 },
    { assetId: 'two', blob: new Blob(['two']), width: 20 },
  ]);
  await upsertMakerWorkspaceAssets('maker-b', [{ assetId: 'one', blob: new Blob(['other']), width: 30 }]);
  let assets = await loadMakerWorkspaceAssets('maker-a');
  assert.deepEqual(assets.map((asset) => asset.assetId).sort(), ['one', 'two']);
  assert.ok(assets.every((asset) => asset.makerKey === 'maker-a' && asset.id.startsWith('maker-a::')));
  assert.ok(assets[0].blob instanceof Blob);

  await upsertMakerWorkspaceAssets('maker-a', [{ assetId: 'one', blob: new Blob(['updated']), width: 99 }]);
  assets = await loadMakerWorkspaceAssets('maker-a');
  assert.equal(assets.find((asset) => asset.assetId === 'one').width, 99);
  await deleteMakerWorkspaceAssets('maker-a', ['one']);
  assert.deepEqual((await loadMakerWorkspaceAssets('maker-a')).map((asset) => asset.assetId), ['two']);
  assert.equal((await loadMakerWorkspaceAssets('maker-b')).length, 1);
  await deleteMakerWorkspaceAssets('maker-a');
  assert.deepEqual(await loadMakerWorkspaceAssets('maker-a'), []);
}));

test('round-trips and removes a player draft independently of Maker documents', async () => withMemoryIndexedDb(async () => {
  const session = {
    makerVersionId: 'maker-v2',
    recipe: { selections: [{ partId: 'hair', itemId: 'long' }], colors: [] },
    profile: { name: 'Mira' },
  };
  await savePlayerWorkspaceSession('wallet:maker-v2', session);
  session.profile.name = 'Changed outside';
  const loaded = await loadPlayerWorkspaceSession('wallet:maker-v2');
  assert.equal(loaded.session.profile.name, 'Mira');
  assert.equal(typeof loaded.savedAt, 'number');
  await deletePlayerWorkspaceSession('wallet:maker-v2');
  assert.equal(await loadPlayerWorkspaceSession('wallet:maker-v2'), null);
}));
