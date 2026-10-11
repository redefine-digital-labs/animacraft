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
    this.removeCalls = [];
    this.setCalls = [];
    this.failNextSet = false;
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
    this.setCalls.push(String(key));
    if (this.failNextSet) {
      this.failNextSet = false;
      throw new Error('simulated marker write failure');
    }
    this.records.set(String(key), String(value));
  }

  removeItem(key) {
    this.removeCalls.push(String(key));
    this.records.delete(key);
  }
}

class MemoryDatabase {
  constructor(name, stores = {}) {
    this.name = name;
    this.stores = new Map(
      Object.entries(stores).map(([storeName, records]) => [storeName, new Map(Object.entries(records))]),
    );
  }
}

class MemoryIndexedDb {
  constructor(databases = {}) {
    this.databasesByName = new Map(
      Object.entries(databases).map(([name, stores]) => [name, new MemoryDatabase(name, stores)]),
    );
    this.databaseListCalls = 0;
    this.openCalls = [];
    this.deleteCalls = [];
    this.failNextList = false;
  }

  async databases() {
    this.databaseListCalls += 1;
    if (this.failNextList) {
      this.failNextList = false;
      throw new Error('simulated database listing failure');
    }
    return [...this.databasesByName.keys()].map((name) => ({ name, version: 1 }));
  }

  open(name) {
    this.openCalls.push(name);
    throw new Error('Non-destructive initialization must not open a database.');
  }

  deleteDatabase(name) {
    this.deleteCalls.push(name);
    throw new Error('Non-destructive initialization must not delete a database.');
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

function assertLegacyDatabasesIntact(indexedDB) {
  assert.equal(
    indexedDB.databasesByName.get('animacraft-creator-drafts').stores.get('maker-drafts').size,
    1,
  );
  assert.equal(
    indexedDB.databasesByName.get('animacraft-creator-drafts').stores.get('maker-assets').size,
    1,
  );
  assert.equal(
    indexedDB.databasesByName.get(LEGACY_WORKSPACE_DATABASE).stores.get('maker-documents').size,
    1,
  );
  assert.equal(
    indexedDB.databasesByName.get(LEGACY_WORKSPACE_DATABASE).stores.get('maker-assets').size,
    1,
  );
  assert.equal(
    indexedDB.databasesByName.get(LEGACY_WORKSPACE_DATABASE).stores.get('player-sessions').size,
    1,
  );
  assert.deepEqual(indexedDB.openCalls, []);
  assert.deepEqual(indexedDB.deleteCalls, []);
}

test('first initialization preserves every legacy draft and only records inspection metadata', async () => {
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
  assert.deepEqual(result.clearedDatabases, []);
  assert.deepEqual(result.clearedWorkspaceStores, []);
  assert.deepEqual(result.removedLocalStorageKeys, []);
  assert.deepEqual(result.inspection, {
    databaseListing: 'complete',
    preservedDatabaseNames: ['animacraft-creator-drafts', LEGACY_WORKSPACE_DATABASE],
    legacyWorkspacePresent: true,
    preservedLocalStorageKeys: [
      'animacraft-local-makers-v1:0x123',
      'animacraft-maker-draft-v1',
      'animacraft-maker-draft-v2:0x123:maker',
    ],
  });

  assertLegacyDatabasesIntact(indexedDB);
  assert.equal(indexedDB.databasesByName.get('wallet-provider-cache').stores.get('sessions').size, 1);
  assert.equal(localStorage.getItem('animacraft-maker-draft-v1'), 'old draft');
  assert.equal(localStorage.getItem('animacraft-maker-draft-v2:0x123:maker'), 'old draft');
  assert.equal(localStorage.getItem('animacraft-local-makers-v1:0x123'), 'old index');
  assert.equal(localStorage.getItem('animacraft-locale'), 'zh-CN');
  assert.equal(localStorage.getItem('dapp-kit:wallet-connection'), '0x123');
  assert.deepEqual(localStorage.removeCalls, []);
  assert.equal(localStorage.getItem(MAKER_DRAFT_SCHEMA_EPOCH_KEY), MAKER_DRAFT_SCHEMA_EPOCH);
});

test('the same epoch remains read-only and reports newly discovered legacy drafts', async () => {
  const indexedDB = legacyData();
  const localStorage = new MemoryStorage();
  await initializeMakerDraftStorage({ indexedDB, localStorage });

  indexedDB.databasesByName.set('animacraft-creator-drafts', new MemoryDatabase(
    'animacraft-creator-drafts',
    { 'maker-drafts': { newMaker: { makerKey: 'newMaker' } } },
  ));
  localStorage.setItem('animacraft-local-makers-v1:0x456', 'new maker index');
  const markerWriteCount = localStorage.setCalls.filter(
    (key) => key === MAKER_DRAFT_SCHEMA_EPOCH_KEY,
  ).length;

  const result = await initializeMakerDraftStorage({ indexedDB, localStorage });

  assert.equal(result.performed, false);
  assert.deepEqual(result.inspection.preservedLocalStorageKeys, ['animacraft-local-makers-v1:0x456']);
  assert.equal(
    indexedDB.databasesByName.get('animacraft-creator-drafts').stores.get('maker-drafts').size,
    1,
  );
  assert.equal(
    localStorage.setCalls.filter((key) => key === MAKER_DRAFT_SCHEMA_EPOCH_KEY).length,
    markerWriteCount,
  );
  assert.deepEqual(localStorage.removeCalls, []);
  assert.deepEqual(indexedDB.openCalls, []);
  assert.deepEqual(indexedDB.deleteCalls, []);
});

test('a missing marker never clears legacy storage and never touches the v6 workspace', async () => {
  const indexedDB = legacyData();
  const localStorage = new MemoryStorage();
  await initializeMakerDraftStorage({ indexedDB, localStorage });

  indexedDB.databasesByName.set('animacraft-maker-workspace-v6', new MemoryDatabase(
    'animacraft-maker-workspace-v6',
    {
      'maker-projects': { current: { makerId: 'current', revision: 12 } },
      'maker-assets': { currentAsset: { makerId: 'current' } },
    },
  ));
  localStorage.removeItem(MAKER_DRAFT_SCHEMA_EPOCH_KEY);
  localStorage.removeCalls = [];

  const result = await initializeMakerDraftStorage({ indexedDB, localStorage });

  assert.equal(result.performed, true);
  assertLegacyDatabasesIntact(indexedDB);
  assert.equal(
    indexedDB.databasesByName.get('animacraft-maker-workspace-v6').stores.get('maker-projects').size,
    1,
  );
  assert.equal(
    indexedDB.databasesByName.get('animacraft-maker-workspace-v6').stores.get('maker-assets').size,
    1,
  );
  assert.deepEqual(localStorage.removeCalls, []);
});

test('a marker write failure still preserves all draft data and can be retried safely', async () => {
  const indexedDB = legacyData();
  const localStorage = new MemoryStorage({
    'animacraft-maker-draft-v1': 'recover me',
  });
  localStorage.failNextSet = true;

  await assert.rejects(
    initializeMakerDraftStorage({ indexedDB, localStorage }),
    /simulated marker write failure/,
  );
  assert.equal(localStorage.getItem(MAKER_DRAFT_SCHEMA_EPOCH_KEY), null);
  assert.equal(localStorage.getItem('animacraft-maker-draft-v1'), 'recover me');
  assertLegacyDatabasesIntact(indexedDB);

  const result = await initializeMakerDraftStorage({ indexedDB, localStorage });
  assert.equal(result.performed, true);
  assert.equal(localStorage.getItem(MAKER_DRAFT_SCHEMA_EPOCH_KEY), MAKER_DRAFT_SCHEMA_EPOCH);
  assert.equal(localStorage.getItem('animacraft-maker-draft-v1'), 'recover me');
});

test('concurrent callers share one awaited non-destructive initialization', async () => {
  const indexedDB = legacyData();
  const localStorage = new MemoryStorage();

  const [first, second] = await Promise.all([
    initializeMakerDraftStorage({ indexedDB, localStorage }),
    initializeMakerDraftStorage({ indexedDB, localStorage }),
  ]);

  assert.equal(first.performed, true);
  assert.equal(second.performed, true);
  assert.equal(indexedDB.databaseListCalls, 1);
  assert.equal(
    localStorage.setCalls.filter((key) => key === MAKER_DRAFT_SCHEMA_EPOCH_KEY).length,
    1,
  );
  assertLegacyDatabasesIntact(indexedDB);
});

test('a database-listing failure never falls back to opening or deleting legacy data', async () => {
  const indexedDB = legacyData();
  const localStorage = new MemoryStorage({
    'animacraft-maker-draft-v1': 'recover me',
  });
  indexedDB.failNextList = true;

  const result = await initializeMakerDraftStorage({ indexedDB, localStorage });

  assert.deepEqual(result.inspection, {
    databaseListing: 'failed',
    preservedDatabaseNames: [],
    legacyWorkspacePresent: null,
    inspectionError: 'simulated database listing failure',
    preservedLocalStorageKeys: ['animacraft-maker-draft-v1'],
  });
  assert.equal(localStorage.getItem('animacraft-maker-draft-v1'), 'recover me');
  assertLegacyDatabasesIntact(indexedDB);
});

test('unsupported database listing stays non-destructive and does not require delete APIs', async () => {
  const localStorage = new MemoryStorage({
    'animacraft-maker-draft-v1': 'recover me',
  });
  const indexedDB = {
    open() {
      throw new Error('must not be called');
    },
  };

  const result = await initializeMakerDraftStorage({ indexedDB, localStorage });

  assert.equal(result.inspection.databaseListing, 'unsupported');
  assert.deepEqual(result.inspection.preservedDatabaseNames, []);
  assert.equal(result.inspection.legacyWorkspacePresent, null);
  assert.deepEqual(result.inspection.preservedLocalStorageKeys, ['animacraft-maker-draft-v1']);
  assert.equal(localStorage.getItem('animacraft-maker-draft-v1'), 'recover me');
  assert.deepEqual(localStorage.removeCalls, []);
});

test('refuses initialization when the inspection marker cannot be stored', async () => {
  const indexedDB = legacyData();

  await assert.rejects(
    initializeMakerDraftStorage({ indexedDB, localStorage: {} }),
    /Persistent localStorage is required/,
  );
  assert.equal(indexedDB.databaseListCalls, 0);
  assert.deepEqual(indexedDB.openCalls, []);
  assert.deepEqual(indexedDB.deleteCalls, []);
});
