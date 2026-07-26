import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createMakerCommandStore } from '../maker-command-store.js';
import {
  MAKER_DRAFT_REVISION_FIELD,
  createMakerDraftRepository,
} from '../maker-draft-repository.js';
import {
  loadMakerDraftWal,
  makerDraftWalStorageKey,
  writeMakerDraftWal,
} from '../maker-draft-wal.js';
import { createCharacterMakerV5Starter } from '../maker-v4.js';
import { createMakerWorkspace } from '../maker-workspace.js';

const appSource = readFileSync(new URL('../app.js', import.meta.url), 'utf8');

function commandStoreFixture() {
  return createMakerCommandStore(
    { metadata: { name: 'Initial Maker' }, parts: [] },
    { selections: [], colors: [] },
  );
}

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function memoryLocalStorage() {
  const values = new Map();
  return {
    get length() {
      return values.size;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(String(key), String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

class HtmlRoot {
  constructor() {
    this.innerHTML = '';
  }

  addEventListener() {}
  removeEventListener() {}
  querySelector() { return null; }
}

function persistentMemoryStorage(overrides = {}) {
  const documents = new Map();
  const assets = new Map();
  const adapter = {
    async loadDocument(makerKey) {
      return documents.has(makerKey) ? structuredClone(documents.get(makerKey)) : null;
    },
    async saveDocument(makerKey, document, metadata) {
      documents.set(makerKey, {
        makerKey,
        document: structuredClone(document),
        metadata: structuredClone(metadata),
        savedAt: metadata.draftCommittedAt,
      });
    },
    async loadAssets(makerKey) {
      return structuredClone(assets.get(makerKey) || []);
    },
    async upsertAssets(makerKey, records) {
      assets.set(makerKey, structuredClone(records));
    },
    ...overrides,
  };
  return { adapter, documents, assets };
}

function repositorySnapshot(revision, name) {
  return {
    revision,
    baseRevision: null,
    document: { metadata: { name }, parts: [] },
    recipe: { selections: [], colors: [] },
    journal: [{ label: `Rename to ${name}` }],
    assets: [],
  };
}

function emptyIndexedDb() {
  const stores = new Set();
  const database = {
    objectStoreNames: {
      contains: (name) => stores.has(name),
    },
    createObjectStore(name) {
      stores.add(name);
      return { createIndex() {} };
    },
    transaction() {
      let completionScheduled = false;
      const transaction = {
        error: null,
        objectStore() {
          const scheduleComplete = () => {
            if (completionScheduled) return;
            completionScheduled = true;
            setTimeout(() => transaction.oncomplete?.(), 0);
          };
          return {
            get() {
              const request = {};
              queueMicrotask(() => {
                request.result = undefined;
                request.onsuccess?.();
                scheduleComplete();
              });
              return request;
            },
            put() {
              scheduleComplete();
            },
          };
        },
      };
      return transaction;
    },
    close() {},
  };
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

async function withWorkspaceGlobals(run) {
  const previousAnimationFrame = globalThis.requestAnimationFrame;
  const previousIndexedDb = globalThis.indexedDB;
  globalThis.requestAnimationFrame = (callback) => {
    callback();
    return 1;
  };
  globalThis.indexedDB = emptyIndexedDb();
  try {
    await run();
  } finally {
    globalThis.requestAnimationFrame = previousAnimationFrame;
    globalThis.indexedDB = previousIndexedDb;
  }
}

function controllableDraftRepository({ load } = {}) {
  const snapshots = [];
  return {
    snapshots,
    async load(makerKey) {
      return load ? load(makerKey) : null;
    },
    async save(makerKey, snapshot) {
      const captured = structuredClone(snapshot);
      snapshots.push({ makerKey, snapshot: captured });
      return {
        makerKey,
        requestedRevision: captured.revision,
        persistedRevision: captured.revision,
        confirmed: true,
        superseded: false,
      };
    },
    async flush() {
      return { pending: 0 };
    },
    getStatus() {
      return { pending: 0, saving: false };
    },
  };
}

test('an older save acknowledgement never marks a newer edit as saved', () => {
  const store = commandStoreFixture();
  store.execute('First edit', ({ document }) => {
    document.metadata.name = 'First revision';
  });
  const saving = store.snapshotForSave();

  store.setSaveState('saving', 'Saving…');
  store.execute('Second edit', ({ document }) => {
    document.metadata.name = 'Second revision';
  });
  store.setSaveState('saved', 'Saved', { revision: saving.revision });

  const state = store.getState();
  assert.equal(state.revision, 2);
  assert.equal(state.savedRevision, 1);
  assert.equal(state.dirty, true);
  assert.equal(state.saveState, 'dirty');
  assert.equal(state.document.metadata.name, 'Second revision');
});

test('a save snapshot is immutable while subsequent edits continue', () => {
  const store = commandStoreFixture();
  store.execute('Rename Maker', ({ document, recipe }) => {
    document.metadata.name = 'Snapshot name';
    recipe.selections.push({ partId: 'hair', itemId: 'long' });
  });
  const snapshot = store.snapshotForSave();

  store.execute('Keep editing', ({ document, recipe }) => {
    document.metadata.name = 'Live name';
    recipe.selections[0].itemId = 'short';
  });

  assert.equal(snapshot.revision, 1);
  assert.equal(snapshot.document.metadata.name, 'Snapshot name');
  assert.equal(snapshot.recipe.selections[0].itemId, 'long');
  assert.equal(store.getState().document.metadata.name, 'Live name');
});

test('only acknowledging the current revision clears dirty state', () => {
  const store = commandStoreFixture();
  store.execute('First edit', ({ document }) => {
    document.metadata.name = 'First';
  });
  const first = store.snapshotForSave();
  store.execute('Second edit', ({ document }) => {
    document.metadata.name = 'Second';
  });
  const second = store.snapshotForSave();

  store.setSaveState('saved', 'First saved', { revision: first.revision });
  assert.equal(store.getState().dirty, true);
  store.setSaveState('saved', 'Second saved', { revision: second.revision });
  assert.equal(store.getState().dirty, false);
  assert.equal(store.getState().saveState, 'saved');
  assert.equal(store.getState().savedRevision, second.revision);
});

test('a fresh repository instance restores the latest confirmed Maker after refresh', async () => {
  const storage = persistentMemoryStorage();
  const beforeRefresh = createMakerDraftRepository({ storage: storage.adapter, clock: () => 100 });
  await beforeRefresh.save('wallet::maker-one', repositorySnapshot(1, 'Survives refresh'));
  await beforeRefresh.flush('wallet::maker-one');

  const afterRefresh = createMakerDraftRepository({ storage: storage.adapter, clock: () => 200 });
  const restored = await afterRefresh.load('wallet::maker-one');

  assert.equal(restored.revision, 1);
  assert.equal(restored.document.metadata.name, 'Survives refresh');
  assert.equal(restored.metadata[MAKER_DRAFT_REVISION_FIELD], 1);
});

test('switching Maker A to Maker B before a delayed save completes never cross-writes their snapshots', async () => {
  const makerAWriteStarted = deferred();
  const releaseMakerAWrite = deferred();
  const storage = persistentMemoryStorage({
    async saveDocument(makerKey, document, metadata) {
      if (makerKey === 'wallet::maker-a') {
        makerAWriteStarted.resolve();
        await releaseMakerAWrite.promise;
      }
      storage.documents.set(makerKey, {
        makerKey,
        document: structuredClone(document),
        metadata: structuredClone(metadata),
        savedAt: metadata.draftCommittedAt,
      });
    },
  });
  const repository = createMakerDraftRepository({ storage: storage.adapter });

  // This models switching before the former 850 ms autosave window elapsed:
  // each queued write must retain the key and immutable snapshot it captured.
  const makerASave = repository.save('wallet::maker-a', repositorySnapshot(1, 'Maker A'));
  await makerAWriteStarted.promise;
  const makerBSave = repository.save('wallet::maker-b', repositorySnapshot(1, 'Maker B'));
  await makerBSave;
  releaseMakerAWrite.resolve();
  await makerASave;

  assert.equal(storage.documents.get('wallet::maker-a').document.metadata.name, 'Maker A');
  assert.equal(storage.documents.get('wallet::maker-b').document.metadata.name, 'Maker B');
});

test('a stale revision requested after a newer refresh snapshot cannot overwrite it', async () => {
  const storage = persistentMemoryStorage();
  const firstSession = createMakerDraftRepository({ storage: storage.adapter });
  await firstSession.save('wallet::maker-one', repositorySnapshot(4, 'Newest'));

  const refreshedSession = createMakerDraftRepository({ storage: storage.adapter });
  await refreshedSession.load('wallet::maker-one');
  const staleResult = await refreshedSession.save(
    'wallet::maker-one',
    repositorySnapshot(3, 'Stale async completion'),
  );

  assert.equal(staleResult.superseded, true);
  assert.equal(staleResult.confirmed, false);
  assert.equal(storage.documents.get('wallet::maker-one').document.metadata.name, 'Newest');
});

test('a brand-new Maker is durably committed before its first context finishes opening', async () => (
  withWorkspaceGlobals(async () => {
    const saveStarted = deferred();
    const releaseSave = deferred();
    const draftRepository = controllableDraftRepository();
    draftRepository.save = async (makerKey, snapshot) => {
      const captured = structuredClone(snapshot);
      draftRepository.snapshots.push({ makerKey, snapshot: captured });
      saveStarted.resolve();
      await releaseSave.promise;
      return {
        makerKey,
        requestedRevision: captured.revision,
        persistedRevision: captured.revision,
        confirmed: true,
        superseded: false,
        conflict: false,
      };
    };
    const workspace = createMakerWorkspace({ draftRepository, callbacks: {}, walStorage: null });
    const document = createCharacterMakerV5Starter({
      makerId: 'initial-persistence',
      name: 'Initial Maker survives refresh',
    });

    let contextResolved = false;
    const opening = workspace.setContext({
      makerKey: 'wallet::initial-persistence',
      walletAddress: '0x1',
      document,
      assets: [],
    }).then(() => {
      contextResolved = true;
    });
    await saveStarted.promise;

    assert.equal(contextResolved, false);
    assert.equal(draftRepository.snapshots.length, 1);
    assert.equal(draftRepository.snapshots[0].snapshot.revision, 0);
    assert.equal(draftRepository.snapshots[0].snapshot.baseRevision, null);
    assert.equal(
      draftRepository.snapshots[0].snapshot.document.metadata.name,
      'Initial Maker survives refresh',
    );

    releaseSave.resolve();
    await opening;
    assert.equal(contextResolved, true);
    assert.equal(workspace.store.getState().persistedRevision, 0);
    workspace.context.walletAddress = '';
    workspace.destroy();
  })
));

test('a command writes synchronous WAL state and a refresh recovers it before the debounce fires', async () => (
  withWorkspaceGlobals(async () => {
    const walStorage = memoryLocalStorage();
    const writerId = 'tab-a';
    const makerKey = 'wallet::wal-recovery';
    const initial = createCharacterMakerV5Starter({
      makerId: 'wal-recovery',
      name: 'Persisted baseline',
    });
    const firstRepository = controllableDraftRepository();
    const firstWorkspace = createMakerWorkspace({
      draftRepository: firstRepository,
      callbacks: {},
      walStorage,
      walWriterId: writerId,
    });
    await firstWorkspace.setContext({
      makerKey,
      walletAddress: '0x1',
      document: initial,
      assets: [],
    });

    firstWorkspace.store.execute('Unsaved crash edit', ({ document }) => {
      document.metadata.name = 'Recovered after crash';
    });
    const synchronousWal = loadMakerDraftWal(walStorage, makerKey, { writerId });
    assert.equal(synchronousWal.document.metadata.name, 'Recovered after crash');
    assert.equal(synchronousWal.baseRevision, 0);
    firstWorkspace.autosave.cancel();
    firstWorkspace.context.walletAddress = '';
    firstWorkspace.destroy();

    const secondRepository = controllableDraftRepository({
      load() {
        return {
          makerKey,
          revision: 0,
          document: initial,
          recipe: initial.defaultRecipe,
          assets: [],
          savedAt: 100,
        };
      },
    });
    const secondWorkspace = createMakerWorkspace({
      draftRepository: secondRepository,
      callbacks: {},
      walStorage,
      walWriterId: writerId,
    });
    await secondWorkspace.setContext({
      makerKey,
      walletAddress: '0x1',
      document: initial,
      assets: [],
    });

    assert.equal(secondWorkspace.restoreError, '');
    assert.equal(secondWorkspace.getDocument().metadata.name, 'Recovered after crash');
    assert.equal(secondRepository.snapshots.length, 1);
    assert.equal(secondRepository.snapshots[0].snapshot.document.metadata.name, 'Recovered after crash');
    assert.equal(walStorage.getItem(makerDraftWalStorageKey(makerKey, writerId)), null);
    secondWorkspace.context.walletAddress = '';
    secondWorkspace.destroy();
  })
));

test('same-revision WAL divergence is preserved, blocks editing, and can be exported', async () => (
  withWorkspaceGlobals(async () => {
    const walStorage = memoryLocalStorage();
    const writerId = 'tab-a';
    const makerKey = 'wallet::same-revision-wal';
    const persisted = createCharacterMakerV5Starter({
      makerId: 'same-revision-wal',
      name: 'Other tab revision 4',
    });
    const unsaved = structuredClone(persisted);
    unsaved.metadata.name = 'My tab revision 4';
    writeMakerDraftWal(walStorage, makerKey, {
      revision: 4,
      baseRevision: 3,
      document: unsaved,
      recipe: unsaved.defaultRecipe,
      journal: [],
    }, { writerId, updatedAt: 400 });
    const exports = [];
    const root = new HtmlRoot();
    const workspace = createMakerWorkspace({
      creatorRoot: root,
      walStorage,
      walWriterId: writerId,
      draftRepository: controllableDraftRepository({
        load() {
          return {
            makerKey,
            revision: 4,
            document: persisted,
            recipe: persisted.defaultRecipe,
            assets: [],
            savedAt: 450,
          };
        },
      }),
      callbacks: {
        onEmergencyRecoveryExport(payload) {
          exports.push(payload);
        },
      },
    });
    await workspace.setContext({
      makerKey,
      walletAddress: '0x1',
      document: persisted,
      assets: [],
    });

    assert.match(workspace.restoreError, /conflicts with a newer Maker revision/);
    assert.match(root.innerHTML, /data-action="export-emergency-recovery"/);
    assert.equal(loadMakerDraftWal(walStorage, makerKey, { writerId }).document.metadata.name, 'My tab revision 4');
    assert.equal(workspace.exportEmergencyRecoveryJson(), true);
    assert.equal(exports.length, 1);
    assert.match(exports[0].content, /My tab revision 4/);
    workspace.context.walletAddress = '';
    workspace.destroy();
  })
));

test('a lower local WAL revision is never discarded when its document differs', async () => (
  withWorkspaceGlobals(async () => {
    const walStorage = memoryLocalStorage();
    const writerId = 'tab-a';
    const makerKey = 'wallet::lower-revision-wal';
    const persisted = createCharacterMakerV5Starter({
      makerId: 'lower-revision-wal',
      name: 'Persisted revision 8',
    });
    const unsaved = structuredClone(persisted);
    unsaved.metadata.name = 'Older-numbered independent branch';
    writeMakerDraftWal(walStorage, makerKey, {
      revision: 2,
      baseRevision: 1,
      document: unsaved,
      recipe: unsaved.defaultRecipe,
      journal: [],
    }, { writerId, updatedAt: 200 });
    const workspace = createMakerWorkspace({
      walStorage,
      walWriterId: writerId,
      draftRepository: controllableDraftRepository({
        load() {
          return {
            makerKey,
            revision: 8,
            document: persisted,
            recipe: persisted.defaultRecipe,
            assets: [],
            savedAt: 800,
          };
        },
      }),
      callbacks: {},
    });
    await workspace.setContext({
      makerKey,
      walletAddress: '0x1',
      document: persisted,
      assets: [],
    });

    assert.notEqual(workspace.restoreError, '');
    assert.equal(
      loadMakerDraftWal(walStorage, makerKey, { writerId }).document.metadata.name,
      'Older-numbered independent branch',
    );
    workspace.context.walletAddress = '';
    workspace.destroy();
  })
));

test('content-equivalent WAL is cleared even when local revision numbers differ', async () => (
  withWorkspaceGlobals(async () => {
    const walStorage = memoryLocalStorage();
    const writerId = 'tab-a';
    const makerKey = 'wallet::equivalent-wal';
    const starter = createCharacterMakerV5Starter({
      makerId: 'equivalent-wal',
      name: 'Already durable',
    });
    const normalizer = createMakerWorkspace({ callbacks: {}, walStorage: null });
    await normalizer.setContext({
      makerKey,
      walletAddress: '',
      document: starter,
      assets: [],
    });
    const persisted = normalizer.getDocument();
    const persistedRecipe = normalizer.getCreatorRecipe();
    normalizer.destroy();
    writeMakerDraftWal(walStorage, makerKey, {
      revision: 1,
      baseRevision: null,
      document: persisted,
      recipe: persistedRecipe,
      journal: [],
    }, { writerId, updatedAt: 100 });
    const workspace = createMakerWorkspace({
      walStorage,
      walWriterId: writerId,
      draftRepository: controllableDraftRepository({
        load() {
          return {
            makerKey,
            revision: 9,
            document: persisted,
            recipe: persistedRecipe,
            assets: [],
            savedAt: 900,
          };
        },
      }),
      callbacks: {},
    });
    await workspace.setContext({
      makerKey,
      walletAddress: '0x1',
      document: persisted,
      assets: [],
    });

    assert.equal(workspace.restoreError, '');
    assert.equal(walStorage.getItem(makerDraftWalStorageKey(makerKey, writerId)), null);
    workspace.context.walletAddress = '';
    workspace.destroy();
  })
));

test('WAL quota failure is visible until the full v6 snapshot succeeds', async () => (
  withWorkspaceGlobals(async () => {
    const failingWalStorage = {
      length: 0,
      key() { return null; },
      getItem() { return null; },
      setItem() { throw new Error('quota exceeded'); },
      removeItem() {},
    };
    const repository = controllableDraftRepository();
    const document = createCharacterMakerV5Starter({
      makerId: 'wal-quota',
      name: 'WAL quota',
    });
    const workspace = createMakerWorkspace({
      draftRepository: repository,
      callbacks: {},
      walStorage: failingWalStorage,
      walWriterId: 'tab-a',
    });
    await workspace.setContext({
      makerKey: 'wallet::wal-quota',
      walletAddress: '0x1',
      document,
      assets: [],
    });
    repository.snapshots.length = 0;

    const previousWarn = console.warn;
    console.warn = () => {};
    try {
      workspace.store.execute('Edit without WAL capacity', ({ document: next }) => {
        next.metadata.name = 'Needs immediate full save';
      });
    } finally {
      console.warn = previousWarn;
    }
    assert.equal(workspace.store.getState().saveState, 'error');
    assert.match(workspace.store.getState().saveMessage, /Emergency recovery cache failed/);

    workspace.autosave.cancel();
    await workspace.save();
    assert.equal(workspace.store.getState().saveState, 'saved');
    assert.equal(repository.snapshots.length, 1);
    workspace.context.walletAddress = '';
    workspace.destroy();
  })
));

test('flush commits pending Creator text even when the input never blurred', async () => (
  withWorkspaceGlobals(async () => {
    const draftRepository = controllableDraftRepository();
    const workspace = createMakerWorkspace({ draftRepository, callbacks: {} });
    const document = createCharacterMakerV5Starter({
      makerId: 'pending-text',
      name: 'Before typing',
    });
    await workspace.setContext({
      makerKey: 'wallet::pending-text',
      walletAddress: '0x1',
      document,
      assets: [],
    });
    draftRepository.snapshots.length = 0;

    assert.equal(workspace.captureCreatorText({
      value: 'Typed but not blurred',
      dataset: { action: 'part-name' },
    }), true);
    assert.equal(workspace.hasUnsavedChanges(), true);

    const result = await workspace.flushPendingChanges({ reason: 'pagehide' });
    assert.equal(result.saved, true);
    assert.equal(result.reason, 'pagehide');
    assert.equal(draftRepository.snapshots.length, 1);
    assert.equal(
      draftRepository.snapshots[0].snapshot.document.parts[0].name,
      'Typed but not blurred',
    );
    assert.equal(workspace.hasUnsavedChanges(), false);
    workspace.destroy();
  })
));

test('visibility flush persists a dirty command and clears the unload guard state', async () => (
  withWorkspaceGlobals(async () => {
    const draftRepository = controllableDraftRepository();
    const workspace = createMakerWorkspace({ draftRepository, callbacks: {} });
    const document = createCharacterMakerV5Starter({
      makerId: 'visibility-flush',
      name: 'Visible',
    });
    await workspace.setContext({
      makerKey: 'wallet::visibility-flush',
      walletAddress: '0x1',
      document,
      assets: [],
    });

    workspace.store.execute('Rename before hiding', ({ document: next }) => {
      next.metadata.name = 'Hidden but persisted';
    });
    assert.equal(workspace.hasUnsavedChanges(), true);

    const result = await workspace.flushPendingChanges({ reason: 'visibility-hidden' });
    assert.equal(result.saved, true);
    assert.equal(draftRepository.snapshots.at(-1).snapshot.document.metadata.name, 'Hidden but persisted');
    assert.equal(workspace.hasUnsavedChanges(), false);
    workspace.destroy();
  })
));

test('switching Maker within the autosave delay flushes A under its own key before opening B', async () => (
  withWorkspaceGlobals(async () => {
    const draftRepository = controllableDraftRepository();
    const workspace = createMakerWorkspace({ draftRepository, callbacks: {} });
    const makerA = createCharacterMakerV5Starter({ makerId: 'maker-a', name: 'Maker A' });
    const makerB = createCharacterMakerV5Starter({ makerId: 'maker-b', name: 'Maker B' });
    await workspace.setContext({
      makerKey: 'wallet::maker-a',
      walletAddress: '0x1',
      document: makerA,
      assets: [],
    });
    workspace.store.execute('Edit A', ({ document }) => {
      document.metadata.name = 'Maker A edited';
    });

    await workspace.setContext({
      makerKey: 'wallet::maker-b',
      walletAddress: '0x1',
      document: makerB,
      assets: [],
    });
    workspace.store.execute('Edit B', ({ document }) => {
      document.metadata.name = 'Maker B edited';
    });
    await workspace.flushPendingChanges({ reason: 'test' });

    assert.deepEqual(
      draftRepository.snapshots.map(({ makerKey, snapshot }) => [
        makerKey,
        snapshot.document.metadata.name,
      ]),
      [
        ['wallet::maker-a', 'Maker A'],
        ['wallet::maker-a', 'Maker A edited'],
        ['wallet::maker-b', 'Maker B'],
        ['wallet::maker-b', 'Maker B edited'],
      ],
    );
    workspace.destroy();
  })
));

test('Maker switching accepts an in-flight save acknowledgement before advancing the context epoch', async () => (
  withWorkspaceGlobals(async () => {
    const revisionOneStarted = deferred();
    const releaseRevisionOne = deferred();
    const storage = persistentMemoryStorage({
      async saveDocument(makerKey, document, metadata) {
        if (
          makerKey === 'wallet::epoch-maker-a'
          && metadata[MAKER_DRAFT_REVISION_FIELD] === 1
        ) {
          revisionOneStarted.resolve();
          await releaseRevisionOne.promise;
        }
        storage.documents.set(makerKey, {
          makerKey,
          document: structuredClone(document),
          metadata: structuredClone(metadata),
          savedAt: metadata.draftCommittedAt,
        });
      },
    });
    const repository = createMakerDraftRepository({ storage: storage.adapter });
    const workspace = createMakerWorkspace({
      draftRepository: repository,
      callbacks: {},
      walStorage: null,
    });
    const makerA = createCharacterMakerV5Starter({
      makerId: 'epoch-maker-a',
      name: 'Epoch Maker A',
    });
    const makerB = createCharacterMakerV5Starter({
      makerId: 'epoch-maker-b',
      name: 'Epoch Maker B',
    });
    await workspace.setContext({
      makerKey: 'wallet::epoch-maker-a',
      walletAddress: '0x1',
      document: makerA,
      assets: [],
    });
    workspace.store.execute('Edit A while save starts', ({ document }) => {
      document.metadata.name = 'Epoch Maker A saved';
    });
    const savingA = workspace.save();
    await revisionOneStarted.promise;

    let switched = false;
    const switching = workspace.setContext({
      makerKey: 'wallet::epoch-maker-b',
      walletAddress: '0x1',
      document: makerB,
      assets: [],
    }).then(() => {
      switched = true;
    });
    await Promise.resolve();
    assert.equal(switched, false);

    releaseRevisionOne.resolve();
    await Promise.all([savingA, switching]);
    assert.equal(storage.documents.get('wallet::epoch-maker-a').document.metadata.name, 'Epoch Maker A saved');
    assert.equal(workspace.makerKey, 'wallet::epoch-maker-b');
    assert.equal(workspace.restoreError, '');
    workspace.context.walletAddress = '';
    workspace.destroy();
  })
));

test('a delayed local restore cannot replace a dirty Workspace store', async () => (
  withWorkspaceGlobals(async () => {
    const restoreStarted = deferred();
    const releaseRestore = deferred();
    const staleDocument = createCharacterMakerV5Starter({
      makerId: 'restore-guard',
      name: 'Stale saved Maker',
    });
    const draftRepository = controllableDraftRepository({
      async load() {
        restoreStarted.resolve();
        await releaseRestore.promise;
        return {
          revision: 9,
          document: staleDocument,
          recipe: staleDocument.defaultRecipe,
          assets: [],
          savedAt: 900,
        };
      },
    });
    const workspace = createMakerWorkspace({ draftRepository, callbacks: {} });
    const shell = createCharacterMakerV5Starter({
      makerId: 'restore-guard',
      name: 'Initial shell',
    });

    const settingContext = workspace.setContext({
      makerKey: 'wallet::restore-guard',
      walletAddress: '0x1',
      document: shell,
      assets: [],
    });
    await restoreStarted.promise;
    workspace.store.execute('Live edit during restore', ({ document }) => {
      document.metadata.name = 'Live unsaved edit';
    });
    releaseRestore.resolve();
    await settingContext;

    assert.equal(workspace.getDocument().metadata.name, 'Live unsaved edit');
    assert.equal(workspace.store.getState().dirty, true);
    await workspace.flushPendingChanges({ reason: 'test-cleanup' });
    workspace.destroy();
  })
));

test('Creator mutations stay locked until the persisted Maker revision finishes restoring', async () => (
  withWorkspaceGlobals(async () => {
    const restoreStarted = deferred();
    const releaseRestore = deferred();
    const persisted = createCharacterMakerV5Starter({
      makerId: 'restore-lock',
      name: 'Persisted revision 9',
    });
    const draftRepository = controllableDraftRepository({
      async load() {
        restoreStarted.resolve();
        await releaseRestore.promise;
        return {
          makerKey: 'wallet::restore-lock',
          revision: 9,
          document: persisted,
          recipe: persisted.defaultRecipe,
          assets: [],
          savedAt: 900,
        };
      },
    });
    const workspace = createMakerWorkspace({ draftRepository, callbacks: {} });
    const shell = createCharacterMakerV5Starter({
      makerId: 'restore-lock',
      name: 'Temporary shell',
    });

    const settingContext = workspace.setContext({
      makerKey: 'wallet::restore-lock',
      walletAddress: '0x1',
      document: shell,
      assets: [],
    });
    await restoreStarted.promise;
    assert.equal(workspace.restoreInProgress, true);
    workspace.executeDocument('Unsafe early edit', ({ document }) => {
      document.metadata.name = 'Must never be committed';
    });
    assert.equal(workspace.getDocument().metadata.name, 'Temporary shell');

    releaseRestore.resolve();
    await settingContext;
    assert.equal(workspace.restoreInProgress, false);
    assert.equal(workspace.restoreError, '');
    assert.equal(workspace.getDocument().metadata.name, 'Persisted revision 9');
    assert.equal(workspace.store.getState().dirty, false);
    workspace.destroy();
  })
));

test('a persisted newer revision becomes a blocking conflict instead of an autosave loop', async () => (
  withWorkspaceGlobals(async () => {
    let saveCalls = 0;
    let initialSaveComplete = false;
    const repository = controllableDraftRepository();
    repository.save = async (makerKey, snapshot) => {
      saveCalls += 1;
      if (!initialSaveComplete) {
        initialSaveComplete = true;
        return {
          makerKey,
          requestedRevision: snapshot.revision,
          persistedRevision: snapshot.revision,
          confirmed: true,
          superseded: false,
          conflict: false,
        };
      }
      return {
        makerKey,
        requestedRevision: snapshot.revision,
        persistedRevision: 9,
        confirmed: false,
        superseded: true,
        conflict: false,
      };
    };
    const workspace = createMakerWorkspace({ draftRepository: repository, callbacks: {} });
    const document = createCharacterMakerV5Starter({
      makerId: 'newer-conflict',
      name: 'Conflict',
    });
    await workspace.setContext({
      makerKey: 'wallet::newer-conflict',
      walletAddress: '0x1',
      document,
      assets: [],
    });
    saveCalls = 0;
    workspace.store.execute('Local revision 1', ({ document: next }) => {
      next.metadata.name = 'Unsafe older write';
    });

    await workspace.save();
    assert.equal(saveCalls, 1);
    assert.equal(workspace.store.getState().saveState, 'error');
    assert.match(workspace.store.getState().saveMessage, /another Animacraft tab/);
    workspace.autosave.cancel();
    workspace.destroy();
  })
));

test('manual Save cancels the pending autosave and a clean Save is a no-op', async () => (
  withWorkspaceGlobals(async () => {
    const draftRepository = controllableDraftRepository();
    const workspace = createMakerWorkspace({ draftRepository, callbacks: {} });
    const document = createCharacterMakerV5Starter({
      makerId: 'manual-save',
      name: 'Before',
    });
    await workspace.setContext({
      makerKey: 'wallet::manual-save',
      walletAddress: '0x1',
      document,
      assets: [],
    });
    draftRepository.snapshots.length = 0;
    workspace.store.execute('Rename once', ({ document: next }) => {
      next.metadata.name = 'Saved exactly once';
    });

    const result = await workspace.save();
    await workspace.autosave.flush();
    assert.equal(result.confirmed, true);
    assert.equal(draftRepository.snapshots.length, 1);

    const cleanResult = await workspace.save();
    assert.equal(cleanResult.noop, true);
    assert.equal(draftRepository.snapshots.length, 1);
    workspace.destroy();
  })
));

test('failed flush blocks leaving Creator and opening Player', async () => (
  withWorkspaceGlobals(async () => {
    let libraryCalls = 0;
    let playerCalls = 0;
    let publishCalls = 0;
    const workspace = createMakerWorkspace({
      draftRepository: controllableDraftRepository(),
      callbacks: {
        onBackToLibrary() {
          libraryCalls += 1;
        },
        onOpenPlayer() {
          playerCalls += 1;
        },
        onPublish() {
          publishCalls += 1;
        },
      },
    });
    const document = createCharacterMakerV5Starter({
      makerId: 'failed-navigation-flush',
      name: 'Stay in Creator',
    });
    await workspace.setContext({
      makerKey: 'wallet::failed-navigation-flush',
      walletAddress: '0x1',
      document,
      assets: [],
    });
    workspace.flushPendingChanges = async () => ({ saved: false });
    const eventFor = (action) => ({
      target: {
        closest() {
          return {
            dataset: { action },
            matches() {
              return false;
            },
          };
        },
      },
    });

    workspace.handleCreatorClick(eventFor('back-library'));
    await Promise.resolve();
    workspace.handleCreatorClick(eventFor('open-player'));
    await Promise.resolve();
    workspace.blockingPublicationIssues = () => [];
    workspace.handleCreatorClick(eventFor('publish'));
    await Promise.resolve();
    assert.equal(libraryCalls, 0);
    assert.equal(playerCalls, 0);
    assert.equal(publishCalls, 0);
    assert.equal(workspace.playerCreatorPreview, false);
    assert.equal(workspace.store.getState().saveState, 'error');
    workspace.destroy();
  })
));

test('an in-flight display image import is discarded after switching Maker', async () => (
  withWorkspaceGlobals(async () => {
    const previousCreateImageBitmap = globalThis.createImageBitmap;
    const bitmapReady = deferred();
    let closeCalls = 0;
    globalThis.createImageBitmap = async () => bitmapReady.promise;
    try {
      const workspace = createMakerWorkspace({
        draftRepository: controllableDraftRepository(),
        callbacks: {},
      });
      const makerA = createCharacterMakerV5Starter({ makerId: 'asset-maker-a', name: 'Maker A' });
      const makerB = createCharacterMakerV5Starter({ makerId: 'asset-maker-b', name: 'Maker B' });
      await workspace.setContext({
        makerKey: 'wallet::asset-maker-a',
        walletAddress: '0x1',
        document: makerA,
        assets: [],
      });
      const importing = workspace.importDisplayAsset(
        new Blob(['png'], { type: 'image/png' }),
        'part-icon',
        workspace.captureMakerOperation(),
      );
      await Promise.resolve();
      await workspace.setContext({
        makerKey: 'wallet::asset-maker-b',
        walletAddress: '0x1',
        document: makerB,
        assets: [],
      });
      bitmapReady.resolve({
        width: 256,
        height: 256,
        close() {
          closeCalls += 1;
        },
      });

      assert.equal(await importing, null);
      assert.equal(workspace.makerKey, 'wallet::asset-maker-b');
      assert.equal(workspace.assets.size, 0);
      assert.equal(closeCalls, 1);
      workspace.destroy();
    } finally {
      globalThis.createImageBitmap = previousCreateImageBitmap;
    }
  })
));

test('a completed Item thumbnail import immediately flushes its document and Blob in one v6 snapshot', async () => (
  withWorkspaceGlobals(async () => {
    const previousCreateImageBitmap = globalThis.createImageBitmap;
    globalThis.createImageBitmap = async () => ({
      width: 320,
      height: 240,
      close() {},
    });
    try {
      const repository = controllableDraftRepository();
      const workspace = createMakerWorkspace({
        draftRepository: repository,
        callbacks: {},
        walStorage: null,
      });
      const document = createCharacterMakerV5Starter({
        makerId: 'thumbnail-flush',
        name: 'Thumbnail Flush',
      });
      await workspace.setContext({
        makerKey: 'wallet::thumbnail-flush',
        walletAddress: '0x1',
        document,
        assets: [],
      });
      repository.snapshots.length = 0;
      const selected = workspace.selectedCreatorRecords();
      const file = new Blob(['thumbnail-pixels'], { type: 'image/png' });
      Object.defineProperty(file, 'name', { value: 'thumbnail.png' });

      await workspace.handleCreatorChange({
        target: {
          dataset: { action: 'item-thumbnail' },
          files: [file],
          value: '',
        },
      });

      assert.equal(repository.snapshots.length, 1);
      const persisted = repository.snapshots[0].snapshot;
      const persistedItem = persisted.document.parts
        .find((part) => part.id === selected.part.id).items
        .find((item) => item.id === selected.item.id);
      assert.ok(persistedItem.thumbnailAssetId);
      const asset = persisted.assets.find((record) => record.assetId === persistedItem.thumbnailAssetId);
      assert.ok(asset?.blob instanceof Blob);
      assert.equal(await asset.blob.text(), 'thumbnail-pixels');
      assert.equal(workspace.store.getState().dirty, false);
      workspace.context.walletAddress = '';
      workspace.destroy();
    } finally {
      globalThis.createImageBitmap = previousCreateImageBitmap;
    }
  })
));

test('Undo retains the detached runtime Blob needed by the restored document', async () => (
  withWorkspaceGlobals(async () => {
    const workspace = createMakerWorkspace({
      draftRepository: controllableDraftRepository(),
      callbacks: {},
    });
    const document = createCharacterMakerV5Starter({
      makerId: 'undo-asset',
      name: 'Undo Asset',
    });
    const style = document.parts[0].items[0].styles[0];
    style.assetId = 'old-style-png';
    document.assets.push({
      id: 'old-style-png',
      identifier: 'old-style-png.png',
      kind: 'style',
      mediaType: 'image/png',
      width: 1024,
      height: 1024,
    });
    await workspace.setContext({
      makerKey: 'wallet::undo-asset',
      walletAddress: '0x1',
      document,
      assets: [{ assetId: 'old-style-png', url: 'https://assets.example/old-style-png.png' }],
    });
    workspace.assets.set('new-style-png', {
      assetId: 'new-style-png',
      url: 'https://assets.example/new-style-png.png',
    });
    workspace.executeDocument('Replace PNG metadata', ({ document: next }) => {
      const target = next.parts[0].items[0].styles[0];
      target.assetId = 'new-style-png';
      next.assets = [{
        id: 'new-style-png',
        identifier: 'new-style-png.png',
        kind: 'style',
        mediaType: 'image/png',
        width: 1024,
        height: 1024,
      }];
    });

    assert.ok(workspace.runtimeAsset('old-style-png'));
    workspace.store.undo();
    assert.equal(workspace.getDocument().parts[0].items[0].styles[0].assetId, 'old-style-png');
    assert.ok(workspace.runtimeAsset('old-style-png'));
    workspace.destroy();
  })
));

test('browser lifecycle events flush hidden drafts and warn before unloading dirty work', () => {
  assert.match(
    appSource,
    /beforeunload[\s\S]*?hasUnsavedChanges[\s\S]*?flushPendingChanges[\s\S]*?reason:\s*'beforeunload'/,
  );
  assert.match(
    appSource,
    /addEventListener\('pagehide'[\s\S]*?flushPendingChanges[\s\S]*?reason:\s*'pagehide'/,
  );
  assert.match(
    appSource,
    /addEventListener\('visibilitychange'[\s\S]*?visibilityState\s*===\s*'hidden'[\s\S]*?reason:\s*'visibility-hidden'/,
  );
});

test('legacy shell callbacks attribute Workspace updates to the captured Maker key', () => {
  assert.match(
    appSource,
    /function syncV4WorkspaceState\(\{[\s\S]*?makerKey = ''[\s\S]*?belongsToActiveMaker[\s\S]*?if \(!belongsToActiveMaker\)[\s\S]*?return false;/,
  );
  assert.match(
    appSource,
    /onRestored\(payload\)\s*\{\s*if \(!syncV4WorkspaceState\(payload\)\) return;/,
  );
  assert.match(
    appSource,
    /onDocumentChange\(payload\)\s*\{\s*if \(!syncV4WorkspaceState\(payload\)\) return;/,
  );
  assert.match(
    appSource,
    /onSaved\(payload\)\s*\{\s*if \(!syncV4WorkspaceState\(payload\)\) return;/,
  );
  assert.match(
    appSource,
    /if \(targetTemplate\.owner\) persistLocalMakerIndex\(targetTemplate\.owner\);/,
  );
});
