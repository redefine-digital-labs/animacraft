import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAKER_DRAFT_ASSET_STORE,
  MAKER_DRAFT_CHECKPOINT_LIMIT,
  MAKER_DRAFT_CHECKPOINT_STORE,
  MAKER_DRAFT_DATABASE_NAME,
  MAKER_DRAFT_DELETED_FIELD,
  MAKER_DRAFT_PROJECT_STORE,
  commitMakerDraftSnapshot,
  deleteMakerDraftProject,
  listMakerDraftCheckpoints,
  listMakerDraftProjects,
  loadMakerDraftAssets,
  loadMakerDraftCheckpoint,
  loadMakerDraftDocument,
  makerDraftAssetRecordId,
  makerDraftCheckpointRecordId,
  restoreMakerDraftCheckpoint,
} from '../maker-draft-store.js';

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

  add(value) {
    const copy = structuredClone(value);
    const key = copy[this.definition.keyPath];
    if (this.records.has(key)) throw new Error(`Duplicate key: ${key}`);
    this.records.set(key, copy);
    this.transaction.scheduleComplete();
  }

  get(key) {
    const request = new MemoryRequest(() => structuredClone(this.records.get(key)));
    this.transaction.scheduleComplete();
    return request;
  }

  getAll() {
    const request = new MemoryRequest(() => structuredClone([...this.records.values()]));
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
  const openCalls = [];
  let initialized = false;
  return {
    database,
    openCalls,
    factory: {
      open(name) {
        openCalls.push(name);
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
    await run(memory);
  } finally {
    globalThis.indexedDB = previous;
  }
}

test('uses an isolated v6 database and stable Maker asset keys', async () => withMemoryIndexedDb(async (memory) => {
  assert.equal(makerDraftAssetRecordId(' maker ', ' png '), 'maker::png');
  await commitMakerDraftSnapshot(
    'maker',
    { metadata: { name: 'First' }, parts: [] },
    { draftRevision: 1, draftBaseRevision: null, draftCommittedAt: 100, walletAddress: '0xabc' },
    [{ assetId: 'png', blob: new Blob(['image']) }],
  );
  assert.ok(memory.openCalls.every((name) => name === MAKER_DRAFT_DATABASE_NAME));
  assert.ok(memory.database.records.has(MAKER_DRAFT_PROJECT_STORE));
  assert.ok(memory.database.records.has(MAKER_DRAFT_ASSET_STORE));
  assert.ok(memory.database.records.has(MAKER_DRAFT_CHECKPOINT_STORE));

  const project = await loadMakerDraftDocument('maker');
  const assets = await loadMakerDraftAssets('maker');
  const checkpoints = await listMakerDraftCheckpoints('maker');
  assert.equal(project.document.metadata.name, 'First');
  assert.equal(project.metadata.draftRevision, 1);
  assert.equal(project.savedAt, 100);
  assert.equal(assets[0].assetId, 'png');
  assert.equal(assets[0].savedAt, 100);
  assert.equal(checkpoints.length, 1);
  assert.equal(checkpoints[0].revision, 1);
  assert.equal(checkpoints[0].document.metadata.name, 'First');
  assert.equal('assets' in checkpoints[0], false);
}));

test('atomically refuses an older document revision after a newer revision exists', async () => (
  withMemoryIndexedDb(async () => {
    const newest = await commitMakerDraftSnapshot(
      'maker',
      { metadata: { name: 'Newest' }, parts: [] },
      { draftRevision: 8, draftBaseRevision: null, draftCommittedAt: 800 },
    );
    const stale = await commitMakerDraftSnapshot(
      'maker',
      { metadata: { name: 'Stale late write' }, parts: [] },
      { draftRevision: 7, draftBaseRevision: null, draftCommittedAt: 900 },
      [{ assetId: 'stale-asset', blob: new Blob(['stale']) }],
    );

    assert.equal(newest.committed, true);
    assert.equal(stale.committed, false);
    assert.equal(stale.persistedRevision, 8);
    assert.equal((await loadMakerDraftDocument('maker')).document.metadata.name, 'Newest');
    assert.deepEqual(await loadMakerDraftAssets('maker'), []);
  })
));

test('a stale branch cannot overwrite a newer branch even with a larger local revision', async () => (
  withMemoryIndexedDb(async () => {
    await commitMakerDraftSnapshot(
      'maker',
      { metadata: { name: 'Shared base' }, parts: [] },
      { draftRevision: 5, draftBaseRevision: null, draftCommittedAt: 500 },
    );
    await commitMakerDraftSnapshot(
      'maker',
      { metadata: { name: 'Newer tab branch' }, parts: [] },
      { draftRevision: 7, draftBaseRevision: 5, draftCommittedAt: 700 },
    );
    const staleHigherRevision = await commitMakerDraftSnapshot(
      'maker',
      { metadata: { name: 'Stale tab with more local edits' }, parts: [] },
      { draftRevision: 99, draftBaseRevision: 5, draftCommittedAt: 900 },
      [{ assetId: 'must-not-write', blob: new Blob(['stale']) }],
    );

    assert.equal(staleHigherRevision.committed, false);
    assert.equal(staleHigherRevision.conflict, true);
    assert.equal(staleHigherRevision.persistedRevision, 7);
    assert.equal((await loadMakerDraftDocument('maker')).document.metadata.name, 'Newer tab branch');
    assert.deepEqual(await loadMakerDraftAssets('maker'), []);
  })
));

test('an equal revision with different content is a conflict and never replaces the immutable snapshot', async () => (
  withMemoryIndexedDb(async () => {
    await commitMakerDraftSnapshot(
      'maker',
      { metadata: { name: 'First writer wins revision 3' }, parts: [] },
      { draftRevision: 3, draftBaseRevision: null, draftCommittedAt: 300 },
    );
    const conflict = await commitMakerDraftSnapshot(
      'maker',
      { metadata: { name: 'Different content using revision 3' }, parts: [] },
      { draftRevision: 3, draftBaseRevision: null, draftCommittedAt: 301 },
    );

    assert.equal(conflict.committed, false);
    assert.equal(conflict.conflict, true);
    assert.equal(conflict.persistedRevision, 3);
    assert.equal(
      (await loadMakerDraftDocument('maker')).document.metadata.name,
      'First writer wins revision 3',
    );
  })
));

test('lists projects by wallet without localStorage and deletes a project with its assets', async () => (
  withMemoryIndexedDb(async () => {
    await commitMakerDraftSnapshot(
      'maker-a',
      { metadata: { name: 'A' }, parts: [] },
      { draftRevision: 1, draftBaseRevision: null, draftCommittedAt: 100, walletAddress: '0xaaa', rootMakerId: 'root-a' },
      [{ assetId: 'a-png', blob: new Blob(['a']) }],
    );
    await commitMakerDraftSnapshot(
      'maker-b',
      { metadata: { name: 'B' }, parts: [] },
      { draftRevision: 2, draftBaseRevision: null, draftCommittedAt: 200, walletAddress: '0xbbb', rootMakerId: 'root-b' },
      [{ assetId: 'b-png', blob: new Blob(['b']) }],
    );

    const all = await listMakerDraftProjects();
    assert.deepEqual(all.map((record) => record.makerKey), ['maker-b', 'maker-a']);
    assert.deepEqual(
      (await listMakerDraftProjects({ walletAddress: '0xaaa' })).map((record) => record.makerKey),
      ['maker-a'],
    );

    const deletion = await deleteMakerDraftProject('maker-a', { expectedBaseRevision: 1 });
    assert.equal(deletion.deleted, true);
    assert.equal(deletion.persistedRevision, 2);
    const tombstone = await loadMakerDraftDocument('maker-a');
    assert.equal(tombstone.document, null);
    assert.equal(tombstone.metadata[MAKER_DRAFT_DELETED_FIELD], true);
    assert.deepEqual(
      (await listMakerDraftProjects()).map((record) => record.makerKey),
      ['maker-b'],
    );
    assert.deepEqual(await loadMakerDraftAssets('maker-a'), []);
    assert.deepEqual(await listMakerDraftCheckpoints('maker-a'), []);
    assert.equal((await loadMakerDraftDocument('maker-b')).document.metadata.name, 'B');
    assert.equal((await loadMakerDraftAssets('maker-b')).length, 1);
    assert.equal((await listMakerDraftCheckpoints('maker-b')).length, 1);
  })
));

test('keeps the newest 20 immutable document checkpoints without duplicating asset blobs', async () => (
  withMemoryIndexedDb(async () => {
    assert.equal(makerDraftCheckpointRecordId('maker', 3), 'maker::3');
    for (let revision = 1; revision <= MAKER_DRAFT_CHECKPOINT_LIMIT + 5; revision += 1) {
      await commitMakerDraftSnapshot(
        'maker',
        { metadata: { name: `Revision ${revision}` }, parts: [{ id: `part-${revision}` }] },
        {
          draftRevision: revision,
          draftBaseRevision: revision === 1 ? null : revision - 1,
          draftCommittedAt: revision * 100,
          recipe: { selections: [{ itemId: `item-${revision}` }] },
          walletAddress: '0xowner',
        },
        revision === 1
          ? [{ assetId: 'shared-png', blob: new Blob(['only stored once']) }]
          : [],
      );
    }

    const checkpoints = await listMakerDraftCheckpoints('maker');
    assert.equal(checkpoints.length, MAKER_DRAFT_CHECKPOINT_LIMIT);
    assert.deepEqual(
      checkpoints.map((checkpoint) => checkpoint.revision),
      Array.from(
        { length: MAKER_DRAFT_CHECKPOINT_LIMIT },
        (_, index) => MAKER_DRAFT_CHECKPOINT_LIMIT + 5 - index,
      ),
    );
    assert.equal(checkpoints.at(-1).document.metadata.name, 'Revision 6');
    assert.equal(checkpoints[0].recipe.selections[0].itemId, 'item-25');
    assert.equal(checkpoints[0].metadata.walletAddress, '0xowner');
    assert.equal(checkpoints[0].savedAt, 2500);
    assert.equal('assets' in checkpoints[0], false);
    assert.equal((await loadMakerDraftAssets('maker')).length, 1);

    const loaded = await loadMakerDraftCheckpoint('maker', 10);
    loaded.document.metadata.name = 'Mutated caller copy';
    assert.equal(
      (await loadMakerDraftCheckpoint('maker', 10)).document.metadata.name,
      'Revision 10',
    );
  })
));

test('restores a checkpoint as a new revision above the current CAS revision', async () => (
  withMemoryIndexedDb(async () => {
    await commitMakerDraftSnapshot(
      'maker',
      { metadata: { name: 'Historical' }, parts: [{ id: 'historical' }] },
      {
        draftRevision: 4,
        draftBaseRevision: null,
        draftCommittedAt: 400,
        recipe: { selections: [{ itemId: 'historical-item' }] },
      },
      [{ assetId: 'historical-png', blob: new Blob(['png']) }],
    );
    await commitMakerDraftSnapshot(
      'maker',
      { metadata: { name: 'Current' }, parts: [{ id: 'current' }] },
      {
        draftRevision: 9,
        draftBaseRevision: 4,
        draftCommittedAt: 900,
        recipe: { selections: [{ itemId: 'current-item' }] },
      },
    );

    const restored = await restoreMakerDraftCheckpoint('maker', 4, {
      minimumRevision: 12,
      draftCommittedAt: 1300,
      expectedBaseRevision: 9,
    });
    assert.equal(restored.committed, true);
    assert.equal(restored.persistedRevision, 13);
    assert.equal(restored.restoredFromRevision, 4);

    const project = await loadMakerDraftDocument('maker');
    assert.equal(project.document.metadata.name, 'Historical');
    assert.equal(project.metadata.draftRevision, 13);
    assert.equal(project.metadata.draftBaseRevision, 9);
    assert.equal(project.metadata.restoredFromRevision, 4);
    assert.equal(project.metadata.recipe.selections[0].itemId, 'historical-item');
    assert.equal(project.savedAt, 1300);
    assert.equal((await loadMakerDraftAssets('maker')).length, 1);
    assert.deepEqual(
      (await listMakerDraftCheckpoints('maker')).map((checkpoint) => checkpoint.revision),
      [13, 9, 4],
    );

    const stale = await commitMakerDraftSnapshot(
      'maker',
      { metadata: { name: 'Late stale write' }, parts: [] },
      { draftRevision: 12, draftBaseRevision: 9, draftCommittedAt: 1400 },
    );
    assert.equal(stale.committed, false);
    assert.equal(stale.persistedRevision, 13);
    assert.equal((await loadMakerDraftDocument('maker')).document.metadata.name, 'Historical');
  })
));

test('a stale checkpoint restore cannot replace a revision committed by another tab', async () => (
  withMemoryIndexedDb(async () => {
    await commitMakerDraftSnapshot(
      'maker',
      { metadata: { name: 'Historical' }, parts: [] },
      { draftRevision: 1, draftBaseRevision: null, draftCommittedAt: 100 },
    );
    await commitMakerDraftSnapshot(
      'maker',
      { metadata: { name: 'Tab A base' }, parts: [] },
      { draftRevision: 5, draftBaseRevision: 1, draftCommittedAt: 500 },
    );
    await commitMakerDraftSnapshot(
      'maker',
      { metadata: { name: 'Tab B newest' }, parts: [] },
      { draftRevision: 6, draftBaseRevision: 5, draftCommittedAt: 600 },
    );

    const staleRestore = await restoreMakerDraftCheckpoint('maker', 1, {
      minimumRevision: 8,
      draftCommittedAt: 900,
      expectedBaseRevision: 5,
    });

    assert.equal(staleRestore.committed, false);
    assert.equal(staleRestore.conflict, true);
    assert.equal(staleRestore.persistedRevision, 6);
    assert.equal((await loadMakerDraftDocument('maker')).document.metadata.name, 'Tab B newest');
    assert.deepEqual(
      (await listMakerDraftCheckpoints('maker')).map((checkpoint) => checkpoint.revision),
      [6, 5, 1],
    );
  })
));

test('delete uses expected-base CAS, preserves a newer branch, and leaves a tombstone', async () => (
  withMemoryIndexedDb(async () => {
    await commitMakerDraftSnapshot(
      'maker',
      { metadata: { name: 'Base' }, parts: [] },
      { draftRevision: 5, draftBaseRevision: null, draftCommittedAt: 500 },
      [{ assetId: 'png', blob: new Blob(['png']) }],
    );
    await commitMakerDraftSnapshot(
      'maker',
      { metadata: { name: 'Newer tab' }, parts: [] },
      { draftRevision: 6, draftBaseRevision: 5, draftCommittedAt: 600 },
    );

    const staleDelete = await deleteMakerDraftProject('maker', { expectedBaseRevision: 5 });
    assert.equal(staleDelete.deleted, false);
    assert.equal(staleDelete.conflict, true);
    assert.equal(staleDelete.persistedRevision, 6);
    assert.equal((await loadMakerDraftDocument('maker')).document.metadata.name, 'Newer tab');
    assert.equal((await loadMakerDraftAssets('maker')).length, 1);
    assert.deepEqual(
      (await listMakerDraftCheckpoints('maker')).map((checkpoint) => checkpoint.revision),
      [6, 5],
    );

    const deleted = await deleteMakerDraftProject('maker', { expectedBaseRevision: 6 });
    assert.equal(deleted.deleted, true);
    assert.equal(deleted.persistedRevision, 7);
    assert.equal((await loadMakerDraftDocument('maker')).metadata[MAKER_DRAFT_DELETED_FIELD], true);
    assert.deepEqual(await listMakerDraftProjects(), []);
    assert.deepEqual(await loadMakerDraftAssets('maker'), []);
    assert.deepEqual(await listMakerDraftCheckpoints('maker'), []);

    const staleResurrection = await commitMakerDraftSnapshot(
      'maker',
      { metadata: { name: 'Must not return' }, parts: [] },
      { draftRevision: 99, draftBaseRevision: 6, draftCommittedAt: 9900 },
    );
    const recreateWithoutBase = await commitMakerDraftSnapshot(
      'maker',
      { metadata: { name: 'Must not recreate' }, parts: [] },
      { draftRevision: 100, draftBaseRevision: null, draftCommittedAt: 10000 },
    );
    assert.equal(staleResurrection.committed, false);
    assert.equal(staleResurrection.persistedRevision, 7);
    assert.equal(recreateWithoutBase.committed, false);
    assert.equal(recreateWithoutBase.persistedRevision, 7);
    assert.equal((await loadMakerDraftDocument('maker')).metadata[MAKER_DRAFT_DELETED_FIELD], true);
  })
));

test('safe empty reads do not require IndexedDB and atomic commits require a revision', async () => {
  const previous = globalThis.indexedDB;
  delete globalThis.indexedDB;
  try {
    assert.equal(await loadMakerDraftDocument(''), null);
    assert.deepEqual(await loadMakerDraftAssets(''), []);
    assert.deepEqual(await listMakerDraftCheckpoints(''), []);
    await assert.doesNotReject(() => deleteMakerDraftProject(''));
    await assert.rejects(
      () => commitMakerDraftSnapshot('maker', { parts: [] }, {}),
      /non-negative Maker draft revision/,
    );
    await assert.rejects(
      () => commitMakerDraftSnapshot('maker', { parts: [] }, { draftRevision: 1 }),
      /base revision/,
    );
  } finally {
    globalThis.indexedDB = previous;
  }
});
