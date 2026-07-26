import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LEGACY_WORKSPACE_DATABASE,
  MAKER_DRAFT_SCHEMA_EPOCH,
  MAKER_DRAFT_SCHEMA_EPOCH_KEY,
  initializeMakerDraftStorage,
} from '../maker-storage-initializer.js';

class MemoryStorage {
  constructor(entries = {}) {
    this.records = new Map(Object.entries(entries));
  }

  get length() {
    return this.records.size;
  }

  key(index) {
    return [...this.records.keys()][index] ?? null;
  }

  getItem(key) {
    return this.records.has(key) ? this.records.get(key) : null;
  }

  setItem(key, value) {
    this.records.set(String(key), String(value));
  }

  removeItem(key) {
    this.records.delete(key);
  }
}

class MemoryTransaction {
  constructor(database, storeNames) {
    this.database = database;
    this.storeNames = storeNames;
    this.error = null;
    queueMicrotask(() => this.oncomplete?.());
  }

  objectStore(name) {
    if (!this.storeNames.includes(name)) throw new Error(`Store ${name} is outside this transaction.`);
    return {
      clear: () => this.database.stores.get(name).clear(),
    };
  }
}

class MemoryDatabase {
  constructor(name, stores = {}) {
    this.name = name;
    this.stores = new Map(
      Object.entries(stores).map(([storeName, records]) => [storeName, new Map(Object.entries(records))]),
    );
    this.objectStoreNames = {
      contains: (storeName) => this.stores.has(storeName),
    };
  }

  transaction(storeNames) {
    return new MemoryTransaction(this, storeNames);
  }

  close() {}
}

class MemoryIndexedDb {
  constructor(databases = {}) {
    this.databases = new Map(
      Object.entries(databases).map(([name, stores]) => [name, new MemoryDatabase(name, stores)]),
    );
    this.deleteCalls = [];
    this.failNextDelete = false;
  }

  deleteDatabase(name) {
    this.deleteCalls.push(name);
    const request = {};
    queueMicrotask(() => {
      if (this.failNextDelete) {
        this.failNextDelete = false;
        request.error = new Error('simulated delete failure');
        request.onerror?.();
        return;
      }
      this.databases.delete(name);
      request.onsuccess?.();
    });
    return request;
  }

  open(name) {
    const request = {};
    queueMicrotask(() => {
      let database = this.databases.get(name);
      if (!database) {
        database = new MemoryDatabase(name);
        this.databases.set(name, database);
        request.result = database;
        request.onupgradeneeded?.({ oldVersion: 0 });
      } else {
        request.result = database;
      }
      queueMicrotask(() => request.onsuccess?.());
    });
    return request;
  }
}

function legacyData() {
  return new MemoryIndexedDb({
    'animacraft-creator-drafts': {
      'maker-drafts': { old: { makerKey: 'old' } },
      'maker-assets': { asset: { makerKey: 'old' } },
      'maker-uploads': { upload: { makerKey: 'old' } },
    },
    [LEGACY_WORKSPACE_DATABASE]: {
      'maker-documents': { maker: { makerKey: 'maker' } },
      'maker-assets': { asset: { makerKey: 'maker' } },
      'player-sessions': { player: { sessionKey: 'player' } },
    },
    'wallet-provider-cache': {
      sessions: { wallet: { address: '0x123' } },
    },
  });
}

test('first initialization clears only legacy Maker drafts and records the epoch last', async () => {
  const indexedDB = legacyData();
  const localStorage = new MemoryStorage({
    'animacraft-maker-draft-v1': 'old draft',
    'animacraft-maker-draft-v2:0x123:maker': 'old draft',
    'animacraft-local-makers-v1:0x123': 'old index',
    'animacraft-locale': 'zh-CN',
    'dapp-kit:wallet-connection': '0x123',
  });

  const result = await initializeMakerDraftStorage({ indexedDB, localStorage });

  assert.equal(result.performed, true);
  assert.equal(result.epoch, MAKER_DRAFT_SCHEMA_EPOCH);
  assert.deepEqual(result.clearedDatabases, ['animacraft-creator-drafts']);
  assert.deepEqual(result.clearedWorkspaceStores.sort(), ['maker-assets', 'maker-documents']);
  assert.equal(indexedDB.databases.has('animacraft-creator-drafts'), false);
  assert.equal(indexedDB.databases.get(LEGACY_WORKSPACE_DATABASE).stores.get('maker-documents').size, 0);
  assert.equal(indexedDB.databases.get(LEGACY_WORKSPACE_DATABASE).stores.get('maker-assets').size, 0);
  assert.equal(indexedDB.databases.get(LEGACY_WORKSPACE_DATABASE).stores.get('player-sessions').size, 1);
  assert.equal(indexedDB.databases.get('wallet-provider-cache').stores.get('sessions').size, 1);
  assert.equal(localStorage.getItem('animacraft-maker-draft-v1'), null);
  assert.equal(localStorage.getItem('animacraft-maker-draft-v2:0x123:maker'), null);
  assert.equal(localStorage.getItem('animacraft-local-makers-v1:0x123'), null);
  assert.equal(localStorage.getItem('animacraft-locale'), 'zh-CN');
  assert.equal(localStorage.getItem('dapp-kit:wallet-connection'), '0x123');
  assert.equal(localStorage.getItem(MAKER_DRAFT_SCHEMA_EPOCH_KEY), MAKER_DRAFT_SCHEMA_EPOCH);
});

test('the same epoch is idempotent and never clears drafts created after initialization', async () => {
  const indexedDB = legacyData();
  const localStorage = new MemoryStorage();
  await initializeMakerDraftStorage({ indexedDB, localStorage });

  indexedDB.databases.set('animacraft-creator-drafts', new MemoryDatabase('animacraft-creator-drafts', {
    'maker-drafts': { newMaker: { makerKey: 'newMaker' } },
  }));
  localStorage.setItem('animacraft-local-makers-v1:0x456', 'new maker index');
  const deleteCallCount = indexedDB.deleteCalls.length;

  const result = await initializeMakerDraftStorage({ indexedDB, localStorage });

  assert.equal(result.performed, false);
  assert.equal(indexedDB.deleteCalls.length, deleteCallCount);
  assert.equal(
    indexedDB.databases.get('animacraft-creator-drafts').stores.get('maker-drafts').size,
    1,
  );
  assert.equal(localStorage.getItem('animacraft-local-makers-v1:0x456'), 'new maker index');
});

test('a missing marker can only repeat the legacy allowlist and never deletes the v6 workspace', async () => {
  const indexedDB = legacyData();
  const localStorage = new MemoryStorage();
  await initializeMakerDraftStorage({ indexedDB, localStorage });

  indexedDB.databases.set('animacraft-maker-workspace-v6', new MemoryDatabase(
    'animacraft-maker-workspace-v6',
    {
      'maker-projects': { current: { makerId: 'current', revision: 12 } },
      'maker-assets': { currentAsset: { makerId: 'current' } },
    },
  ));
  indexedDB.databases.set('animacraft-creator-drafts', new MemoryDatabase(
    'animacraft-creator-drafts',
    { 'maker-drafts': { legacyAgain: { makerKey: 'legacyAgain' } } },
  ));
  localStorage.removeItem(MAKER_DRAFT_SCHEMA_EPOCH_KEY);

  const result = await initializeMakerDraftStorage({ indexedDB, localStorage });

  assert.equal(result.performed, true);
  assert.equal(indexedDB.databases.has('animacraft-creator-drafts'), false);
  assert.equal(
    indexedDB.databases.get('animacraft-maker-workspace-v6').stores.get('maker-projects').size,
    1,
  );
  assert.equal(
    indexedDB.databases.get('animacraft-maker-workspace-v6').stores.get('maker-assets').size,
    1,
  );
});

test('a failed cleanup does not write the epoch and can be retried safely', async () => {
  const indexedDB = legacyData();
  const localStorage = new MemoryStorage();
  indexedDB.failNextDelete = true;

  await assert.rejects(
    initializeMakerDraftStorage({ indexedDB, localStorage }),
    /simulated delete failure/,
  );
  assert.equal(localStorage.getItem(MAKER_DRAFT_SCHEMA_EPOCH_KEY), null);

  const result = await initializeMakerDraftStorage({ indexedDB, localStorage });
  assert.equal(result.performed, true);
  assert.equal(localStorage.getItem(MAKER_DRAFT_SCHEMA_EPOCH_KEY), MAKER_DRAFT_SCHEMA_EPOCH);
});

test('concurrent callers share one awaited initialization', async () => {
  const indexedDB = legacyData();
  const localStorage = new MemoryStorage();

  const [first, second] = await Promise.all([
    initializeMakerDraftStorage({ indexedDB, localStorage }),
    initializeMakerDraftStorage({ indexedDB, localStorage }),
  ]);

  assert.equal(first.performed, true);
  assert.equal(second.performed, true);
  assert.equal(indexedDB.deleteCalls.filter((name) => name === 'animacraft-creator-drafts').length, 1);
});

test('refuses destructive initialization when a persistent marker cannot be stored', async () => {
  const indexedDB = legacyData();

  await assert.rejects(
    initializeMakerDraftStorage({ indexedDB, localStorage: {} }),
    /Persistent localStorage is required/,
  );
  assert.equal(indexedDB.deleteCalls.length, 0);
});
