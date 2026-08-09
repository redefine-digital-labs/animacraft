import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EXPANSION_PACK_DRAFT_DATABASE_NAME,
  EXPANSION_PACK_DRAFT_DATABASE_VERSION,
  EXPANSION_PACK_DRAFT_STORE,
  createExpansionPackDraftStore,
  expansionPackDraftKey,
} from '../expansion-pack-draft-store.js';
import {
  addExpansionPackOptionalPart,
  createExpansionPackProject,
} from '../expansion-pack-project.js';

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

  get(key) {
    const request = new MemoryRequest(() => clone(this.records.get(key)));
    this.transaction.scheduleComplete();
    return request;
  }

  getAll() {
    const request = new MemoryRequest(() => clone([...this.records.values()]));
    this.transaction.scheduleComplete();
    return request;
  }

  put(value) {
    const copy = clone(value);
    this.records.set(copy[this.definition.keyPath], copy);
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
    this.error = null;
    this.aborted = false;
  }

  objectStore(name) {
    return new MemoryStore(this, this.database.records.get(name), this.database.definitions.get(name));
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
    return new MemoryStore({ scheduleComplete() {} }, this.records.get(name), this.definitions.get(name));
  }

  transaction() {
    return new MemoryTransaction(this);
  }

  close() {}
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
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

function baseMaker(rootMakerId = 'maker-root') {
  return {
    schemaVersion: 'animacraft.maker.v5',
    version: { rootMakerId, versionId: `${rootMakerId}-v1`, number: 1 },
    metadata: { id: rootMakerId, name: 'Parent' },
    canvas: { width: 1024, height: 1024 },
    layerTracks: [],
    colorChannels: [],
    assets: [],
    parts: [],
    rules: [],
  };
}

function project(packId = 'pack-a', walletAddress = '0xABCD', rootMakerId = 'maker-root') {
  return createExpansionPackProject(baseMaker(rootMakerId), {
    packId,
    namespace: packId.replace(/[^A-Za-z0-9_-]/g, '-'),
    name: packId,
    walletAddress,
    now: 10,
  });
}

function identityOf(projectValue, overrides = {}) {
  return {
    walletAddress: projectValue.ownerWalletAddress,
    parentRootId: projectValue.parentBinding.rootMakerId,
    parentVersion: projectValue.parentBinding.versionNumber,
    parentBindingKind: projectValue.parentBinding.kind,
    parentVersionId: projectValue.parentBinding.versionId,
    parentReleaseId: projectValue.parentBinding.releaseId,
    parentManifestBlobId: projectValue.parentBinding.manifestBlobId,
    parentManifestHash: projectValue.parentBinding.manifestHash,
    packId: projectValue.packId,
    ...overrides,
  };
}

test('uses an isolated database and an exact wallet:parent:version:pack key', async () => {
  const memory = memoryIndexedDb();
  const store = createExpansionPackDraftStore({ indexedDB: memory.factory, clock: () => 100 });
  const source = project();
  const identity = identityOf(source);

  assert.equal(
    expansionPackDraftKey(identity),
    '0xabcd:maker-root:1:local-draft:maker-root-v1:~local:~local:~local-uncommitted:pack-a',
  );
  const result = await store.save(identity, source, { expectedRevision: null });
  assert.equal(result.saved, true);
  assert.equal(result.persistedRevision, 1);
  assert.ok(memory.openCalls.every(({ name, version }) => (
    name === EXPANSION_PACK_DRAFT_DATABASE_NAME
    && version === EXPANSION_PACK_DRAFT_DATABASE_VERSION
  )));
  assert.ok(memory.database.records.has(EXPANSION_PACK_DRAFT_STORE));

  const loaded = await store.load(identity);
  assert.equal(loaded.revision, 1);
  assert.equal(loaded.savedAt, 100);
  assert.ok(Object.isFrozen(loaded.project.parentSnapshot));
  assert.ok(Object.isFrozen(loaded.project.parentSnapshot.parts));
});

test('atomically refuses stale writes while independent Pack lanes remain independent', async () => {
  const memory = memoryIndexedDb();
  let now = 100;
  const store = createExpansionPackDraftStore({ indexedDB: memory.factory, clock: () => ++now });
  const first = project('pack-a');
  const secondPack = project('pack-b');
  const aIdentity = identityOf(first);
  const bIdentity = identityOf(secondPack);

  await store.save(aIdentity, first, { expectedRevision: null, revision: 1 });
  const second = addExpansionPackOptionalPart(first, {
    part: { id: 'hat', name: 'Hat', items: [] },
  });
  const latest = await store.save(aIdentity, second, { expectedRevision: 1, revision: 2 });
  assert.equal(latest.saved, true);

  const stale = await store.save(aIdentity, first, { expectedRevision: 1, revision: 2 });
  assert.equal(stale.saved, false);
  assert.equal(stale.conflict, true);
  assert.equal(stale.persistedRevision, 2);
  assert.equal((await store.load(aIdentity)).project.pack.parts.length, 1);

  const independent = await store.save(bIdentity, secondPack, { expectedRevision: null });
  assert.equal(independent.saved, true);
  const listed = await store.list({ walletAddress: '0xABCD', parentRootId: 'maker-root', parentVersion: '1' });
  assert.deepEqual(new Set(listed.map((record) => record.packId)), new Set(['pack-a', 'pack-b']));
});

test('the same Pack id stays isolated across immutable parent Maker versions', async () => {
  const memory = memoryIndexedDb();
  const store = createExpansionPackDraftStore({ indexedDB: memory.factory });
  const v1 = project('pack-a');
  const v2 = createExpansionPackProject({
    ...baseMaker(),
    version: { rootMakerId: 'maker-root', versionId: 'maker-root-v2', number: 2 },
  }, {
    packId: 'pack-a',
    namespace: 'pack-a',
    name: 'pack-a-v2',
    walletAddress: '0xabcd',
  });
  const v1Identity = identityOf(v1);
  const v2Identity = identityOf(v2);

  await store.save(v1Identity, v1, { expectedRevision: null });
  await store.save(v2Identity, v2, { expectedRevision: null });

  assert.equal((await store.load(v1Identity)).project.parentBinding.versionNumber, '1');
  assert.equal((await store.load(v2Identity)).project.parentBinding.versionNumber, '2');
  assert.equal((await store.list({
    walletAddress: '0xabcd',
    parentRootId: 'maker-root',
    parentVersion: '2',
  })).length, 1);
});

test('the same numeric parent version cannot collide across exact published release identities', async () => {
  const memory = memoryIndexedDb();
  const store = createExpansionPackDraftStore({ indexedDB: memory.factory });
  const makePublished = (releaseId, manifestBlobId, manifestHash) => createExpansionPackProject(
    baseMaker(),
    {
      packId: 'pack-a',
      namespace: 'pack-a',
      name: releaseId,
      walletAddress: '0xabcd',
      parentRelease: {
        identityVerified: true,
        releaseId,
        versionId: 'maker-root-v1',
        versionNumber: '1',
        manifestBlobId,
        manifestHash,
      },
    },
  );
  const left = makePublished('0xrelease-a', 'quilt-a', '11'.repeat(32));
  const right = makePublished('0xrelease-b', 'quilt-b', '22'.repeat(32));
  const leftIdentity = identityOf(left);
  const rightIdentity = identityOf(right);

  assert.notEqual(expansionPackDraftKey(leftIdentity), expansionPackDraftKey(rightIdentity));
  await store.save(leftIdentity, left, { expectedRevision: null });
  await store.save(rightIdentity, right, { expectedRevision: null });

  assert.equal((await store.load(leftIdentity)).project.parentBinding.releaseId, '0xrelease-a');
  assert.equal((await store.load(rightIdentity)).project.parentBinding.releaseId, '0xrelease-b');
  assert.equal((await store.list({
    walletAddress: '0xabcd',
    parentRootId: 'maker-root',
    parentVersion: '1',
  })).length, 2);
  assert.equal((await store.list({
    walletAddress: '0xabcd',
    parentRootId: 'maker-root',
    parentVersion: '1',
    parentReleaseId: '0xrelease-b',
  })).length, 1);
});

test('rejects cross-Pack, cross-parent and cross-wallet writes before IndexedDB changes', async () => {
  const memory = memoryIndexedDb();
  const store = createExpansionPackDraftStore({ indexedDB: memory.factory });
  const source = project('pack-a', '0xabcd', 'maker-root');

  const sourceIdentity = identityOf(source);
  const mismatchedIdentities = [
    { ...sourceIdentity, packId: 'pack-b' },
    { ...sourceIdentity, parentRootId: 'other-root' },
    { ...sourceIdentity, parentVersion: '2' },
    { ...sourceIdentity, walletAddress: '0x9999' },
    { ...sourceIdentity, parentVersionId: 'maker-root-v2' },
  ];
  for (const identity of mismatchedIdentities) {
    await assert.rejects(
      store.save(identity, source, { expectedRevision: null }),
      (error) => error?.code === 'expansion-pack-draft-key-mismatch',
    );
  }
  assert.equal(memory.database.records.size, 0);
});

test('deletion also requires the latest persisted revision', async () => {
  const memory = memoryIndexedDb();
  const store = createExpansionPackDraftStore({ indexedDB: memory.factory });
  const source = project();
  const identity = identityOf(source);
  await store.save(identity, source, { expectedRevision: null });

  const staleDelete = await store.delete(identity, { expectedRevision: 2 });
  assert.equal(staleDelete.deleted, false);
  assert.equal(staleDelete.conflict, true);
  assert.equal((await store.load(identity)).revision, 1);

  const deleted = await store.delete(identity, { expectedRevision: 1 });
  assert.equal(deleted.deleted, true);
  assert.equal(await store.load(identity), null);
});
