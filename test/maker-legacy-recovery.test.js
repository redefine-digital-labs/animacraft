import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LEGACY_CREATOR_DATABASE_NAME,
  LEGACY_RECOVERY_EXPORT_SCHEMA,
  LEGACY_WORKSPACE_DATABASE_NAME,
  legacyRecoveryExportPayload,
  normalizeRecoveredMakerRecipe,
  prepareRecoveredMakerAssets,
  scanLegacyMakerDrafts,
} from '../maker-legacy-recovery.js';

function v5Document(id, name = id) {
  return {
    schemaVersion: 'animacraft.maker.v5',
    version: { rootMakerId: id, versionId: `${id}-v1`, number: 1 },
    metadata: { id, name },
    parts: [],
    defaultRecipe: {
      selections: [{ partId: 'hair', itemId: 'long', styleId: 'black' }],
      colors: [],
    },
  };
}

class MemoryStorage {
  constructor(initial = {}) {
    this.values = new Map(Object.entries(initial));
    this.setCalls = [];
    this.removeCalls = [];
  }

  get length() {
    return this.values.size;
  }

  key(index) {
    return [...this.values.keys()][index] ?? null;
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.setCalls.push([key, value]);
    this.values.set(String(key), String(value));
  }

  removeItem(key) {
    this.removeCalls.push(key);
    this.values.delete(key);
  }
}

class MemoryRequest {
  constructor(transaction, read) {
    this.result = undefined;
    this.error = null;
    transaction.pending += 1;
    queueMicrotask(() => {
      try {
        this.result = read();
        this.onsuccess?.();
      } catch (error) {
        this.error = error;
        this.onerror?.();
      } finally {
        transaction.pending -= 1;
        transaction.scheduleComplete();
      }
    });
  }
}

class MemoryStore {
  constructor(transaction, records) {
    this.transaction = transaction;
    this.records = records;
  }

  getAll() {
    return new MemoryRequest(this.transaction, () => clone(this.records));
  }
}

class MemoryTransaction {
  constructor(database, storeNames, mode) {
    assert.equal(mode, 'readonly', 'the recovery scanner must only create readonly transactions');
    this.database = database;
    this.storeNames = new Set(Array.isArray(storeNames) ? storeNames : [storeNames]);
    this.pending = 0;
    this.completionScheduled = false;
    this.error = null;
  }

  objectStore(name) {
    assert.equal(this.storeNames.has(name), true);
    return new MemoryStore(this, this.database.stores.get(name));
  }

  scheduleComplete() {
    if (this.pending || this.completionScheduled) return;
    this.completionScheduled = true;
    queueMicrotask(() => this.oncomplete?.());
  }
}

class MemoryDatabase {
  constructor(name, stores = {}) {
    this.name = name;
    this.stores = new Map(
      Object.entries(stores).map(([storeName, records]) => [storeName, clone(records)]),
    );
    this.objectStoreNames = {
      contains: (storeName) => this.stores.has(storeName),
    };
    this.transactionModes = [];
    this.closed = false;
  }

  transaction(storeNames, mode) {
    this.transactionModes.push(mode);
    return new MemoryTransaction(this, storeNames, mode);
  }

  close() {
    this.closed = true;
  }
}

class MemoryIndexedDb {
  constructor(databases = {}) {
    this.databaseMap = new Map(
      Object.entries(databases).map(([name, stores]) => [name, new MemoryDatabase(name, stores)]),
    );
    this.openCalls = [];
    this.deleteCalls = [];
    this.failedOpens = new Set();
  }

  async databases() {
    return [...this.databaseMap.keys()].map((name) => ({ name, version: 1 }));
  }

  open(name) {
    this.openCalls.push(name);
    const request = {};
    queueMicrotask(() => {
      if (this.failedOpens.has(name)) {
        request.error = new Error(`${name} is blocked`);
        request.onerror?.();
        return;
      }
      request.result = this.databaseMap.get(name);
      if (request.result) {
        request.onsuccess?.();
      } else {
        request.error = new Error(`Unexpected attempt to create ${name}`);
        request.onerror?.();
      }
    });
    return request;
  }

  deleteDatabase(name) {
    this.deleteCalls.push(name);
    throw new Error('The recovery scanner must never delete a database.');
  }
}

function clone(value) {
  return structuredClone(value);
}

test('scans v4 Workspace documents and orphaned assets with no writes', async () => {
  const document = v5Document('moon-maker', 'Moon Maker');
  const indexedDB = new MemoryIndexedDb({
    [LEGACY_WORKSPACE_DATABASE_NAME]: {
      'maker-documents': [
        {
          makerKey: '0xabc:moon-maker',
          document,
          metadata: {
            walletAddress: '0xabc',
            draftRevision: 12,
            recipe: document.defaultRecipe,
          },
          savedAt: 1_200,
        },
      ],
      'maker-assets': [
        {
          id: '0xabc:moon-maker::hair',
          makerKey: '0xabc:moon-maker',
          assetId: 'hair',
          blob: new Blob(['hair-png'], { type: 'image/png' }),
          savedAt: 1_190,
        },
        {
          id: '0xaaa:orphan::only',
          makerKey: '0xaaa:orphan',
          assetId: 'only',
          blob: new Blob(['orphan'], { type: 'image/png' }),
          savedAt: 800,
        },
      ],
    },
  });
  const localStorage = new MemoryStorage({ unrelated: 'keep me' });

  const records = await scanLegacyMakerDrafts({ indexedDB, localStorage });

  assert.equal(records.length, 2);
  const recovered = records.find((record) => record.makerKey === '0xabc:moon-maker');
  assert.equal(recovered.source, 'workspace-v4');
  assert.equal(recovered.walletAddress, '0xabc');
  assert.equal(recovered.makerId, 'moon-maker');
  assert.equal(recovered.savedAt, 1_200);
  assert.equal(recovered.revision, 12);
  assert.equal(recovered.document.metadata.name, 'Moon Maker');
  assert.deepEqual(recovered.recipe, document.defaultRecipe);
  assert.equal(recovered.assetCount, 1);
  assert.equal(await recovered.assets[0].blob.text(), 'hair-png');
  assert.equal(recovered.recoverable, true);
  assert.deepEqual(recovered.issues, []);
  assert.equal(recovered.raw.databaseName, LEGACY_WORKSPACE_DATABASE_NAME);
  assert.equal(recovered.raw.documentRecord.makerKey, '0xabc:moon-maker');

  const orphan = records.find((record) => record.makerKey === '0xaaa:orphan');
  assert.equal(orphan.document, null);
  assert.equal(orphan.assetCount, 1);
  assert.equal(orphan.recoverable, false);
  assert.equal(orphan.issues[0].code, 'orphaned-assets');

  assert.deepEqual(indexedDB.openCalls, [LEGACY_WORKSPACE_DATABASE_NAME]);
  assert.deepEqual(indexedDB.deleteCalls, []);
  assert.deepEqual(
    indexedDB.databaseMap.get(LEGACY_WORKSPACE_DATABASE_NAME).transactionModes,
    ['readonly'],
  );
  assert.deepEqual(localStorage.setCalls, []);
  assert.deepEqual(localStorage.removeCalls, []);
  assert.equal(localStorage.getItem('unrelated'), 'keep me');
});

test('normalizes creator draft keys before matching their separate asset keys', async () => {
  const document = v5Document('night-maker', 'Night Maker');
  const indexedDB = new MemoryIndexedDb({
    [LEGACY_CREATOR_DATABASE_NAME]: {
      'maker-drafts': [
        {
          makerKey: 'animacraft-maker-draft-v2:0xdef:night-maker',
          draft: {
            templateId: 'night-maker',
            savedAt: '2026-07-26T12:00:00.000Z',
            manifest: document,
            makerRecipeV4: document.defaultRecipe,
            revision: 7,
          },
          savedAt: 9_000,
        },
        {
          makerKey: 'animacraft-maker-draft-v2:0xdef:old-maker',
          draft: {
            templateId: 'old-maker',
            manifest: {
              schemaVersion: 'animacraft.maker.v4',
              version: { rootMakerId: 'old-maker' },
              parts: [],
            },
          },
          savedAt: 8_000,
        },
      ],
      'maker-assets': [
        {
          id: '0xdef:night-maker:hair',
          makerKey: '0xdef:night-maker',
          assetKey: 'hair',
          blob: new Blob(['night-hair'], { type: 'image/png' }),
          savedAt: 8_900,
        },
      ],
    },
  });

  const records = await scanLegacyMakerDrafts({
    indexedDB,
    localStorage: new MemoryStorage(),
  });

  const recovered = records.find((record) => record.makerKey === '0xdef:night-maker');
  assert.equal(recovered.source, 'creator-drafts');
  assert.equal(recovered.sourceKey, 'animacraft-maker-draft-v2:0xdef:night-maker');
  assert.equal(recovered.walletAddress, '0xdef');
  assert.equal(recovered.makerId, 'night-maker');
  assert.equal(recovered.savedAt, 9_000);
  assert.equal(recovered.revision, 7);
  assert.equal(recovered.assetCount, 1);
  assert.equal(await recovered.assets[0].blob.text(), 'night-hair');
  assert.equal(recovered.recoverable, true);

  const incompatible = records.find((record) => record.makerKey === '0xdef:old-maker');
  assert.equal(incompatible.document, null);
  assert.equal(incompatible.recoverable, false);
  assert.equal(incompatible.issues[0].code, 'legacy-document-incompatible');
  assert.equal(
    incompatible.raw.draftRecord.draft.manifest.schemaVersion,
    'animacraft.maker.v4',
  );
});

test('recovers referenced assets only through unique explicit identities', async () => {
  const document = v5Document('asset-maker', 'Asset Maker');
  document.assets = [
    { id: 'hair-front', kind: 'layer', mediaType: 'image/png' },
    { id: 'hair-back', kind: 'layer', mediaType: 'image/png' },
  ];
  document.parts = [{
    id: 'hair',
    items: [{
      id: 'long-hair',
      styles: [
        { id: 'front', assetId: 'hair-front' },
        { id: 'back', assetId: 'hair-back' },
      ],
    }],
  }];
  document.colorChannels = [];
  document.layerTracks = [];

  assert.throws(
    () => prepareRecoveredMakerAssets(document, [
      { assetKey: 'unrelated-one', blob: new Blob(['one'], { type: 'image/png' }) },
      { assetKey: 'unrelated-two', blob: new Blob(['two'], { type: 'image/png' }) },
    ]),
    /missing recoverable data.*hair-front.*hair-back/,
  );

  assert.throws(
    () => prepareRecoveredMakerAssets(document, [
      { assetId: 'hair-front', blob: new Blob(['one'], { type: 'image/png' }) },
      { assetKey: 'hair-front', blob: new Blob(['two'], { type: 'image/png' }) },
      { assetId: 'hair-back', blob: new Blob(['back'], { type: 'image/png' }) },
    ]),
    /matches multiple preserved local records/,
  );

  const recovered = prepareRecoveredMakerAssets(document, [
    { assetKey: 'hair-front', blob: new Blob(['front'], { type: 'image/png' }) },
    { id: 'legacy:hair-back', blob: new Blob(['back'], { type: 'image/png' }) },
  ]);
  assert.deepEqual(recovered.map((asset) => asset.assetId), ['hair-front', 'hair-back']);
  assert.equal(await recovered[0].blob.text(), 'front');
  assert.equal(await recovered[1].blob.text(), 'back');
});

test('normalizes stale recovered Recipes against the preserved Maker graph', () => {
  const document = v5Document('recipe-maker', 'Recipe Maker');
  document.parts = [{
    id: 'hair',
    items: [{
      id: 'long',
      styles: [{ id: 'black' }, { id: 'blue' }],
    }],
  }];
  document.colorChannels = [{
    id: 'hair-color',
    swatches: [{ id: 'black' }, { id: 'blue' }],
  }];
  document.defaultRecipe = {
    selections: [{ partId: 'hair', itemId: 'long', styleId: 'black' }],
    colors: [{ channelId: 'hair-color', swatchId: 'black' }],
  };

  assert.deepEqual(
    normalizeRecoveredMakerRecipe(document, {
      selections: [{ partId: 'hair', itemId: 'long', styleId: 'blue' }],
      colors: 'corrupt',
    }),
    {
      selections: [{ partId: 'hair', itemId: 'long', styleId: 'blue' }],
      colors: [{ channelId: 'hair-color', swatchId: 'black' }],
    },
  );
  assert.deepEqual(
    normalizeRecoveredMakerRecipe(document, { selections: 'corrupt', colors: [] }),
    {
      selections: [{ partId: 'hair', itemId: 'long', styleId: 'black' }],
      colors: [{ channelId: 'hair-color', swatchId: 'black' }],
    },
  );
});

test('discovers scoped/unscoped local drafts and Maker indices while preserving malformed text', async () => {
  const document = v5Document('local-maker', 'Local Maker');
  const localStorage = new MemoryStorage({
    'animacraft-maker-draft-v2:0x123:local-maker': JSON.stringify({
      templateId: 'local-maker',
      savedAt: '2026-07-26T12:34:56.000Z',
      manifest: document,
      makerRecipeV4: document.defaultRecipe,
      draftRevision: 4,
    }),
    'animacraft-maker-draft-v1': '{not-json',
    'animacraft-local-makers-v1:0x123': JSON.stringify([
      { id: 'local-maker', name: 'Local Maker', savedAt: 100 },
      { id: 'other-maker', name: 'Other Maker' },
    ]),
    'animacraft-local-makers-v1:0xempty': '[]',
    'animacraft-locale': 'zh-CN',
  });
  const indexedDB = new MemoryIndexedDb({
    [LEGACY_CREATOR_DATABASE_NAME]: {
      'maker-assets': [
        {
          id: '0x123:local-maker:base',
          makerKey: '0x123:local-maker',
          assetKey: 'base',
          blob: new Blob(['base'], { type: 'image/png' }),
          savedAt: 500,
        },
      ],
    },
  });

  const records = await scanLegacyMakerDrafts({ indexedDB, localStorage });

  const localDraft = records.find((record) => (
    record.source === 'local-storage-draft'
    && record.makerKey === '0x123:local-maker'
  ));
  assert.equal(localDraft.recoverable, true);
  assert.equal(localDraft.document.metadata.name, 'Local Maker');
  assert.equal(localDraft.revision, 4);
  assert.equal(localDraft.savedAt, Date.parse('2026-07-26T12:34:56.000Z'));
  assert.equal(localDraft.assetCount, 1);

  const malformed = records.find((record) => record.sourceKey === 'animacraft-maker-draft-v1');
  assert.equal(malformed.makerKey, 'local:daily-starlit');
  assert.equal(malformed.recoverable, false);
  assert.equal(malformed.issues[0].code, 'invalid-json');
  assert.equal(malformed.raw.rawValue, '{not-json');

  const indexRecords = records.filter((record) => record.source === 'local-storage-index');
  assert.equal(indexRecords.length, 2);
  assert.deepEqual(
    indexRecords.map((record) => record.makerKey).sort(),
    ['0x123:local-maker', '0x123:other-maker'],
  );
  assert.ok(indexRecords.every((record) => (
    !record.recoverable && record.issues[0].code === 'index-entry-only'
  )));

  assert.equal(records.some((record) => record.sourceKey === 'animacraft-local-makers-v1:0xempty'), false);
  assert.equal(records.some((record) => record.sourceKey === 'animacraft-locale'), false);
  assert.deepEqual(localStorage.setCalls, []);
  assert.deepEqual(localStorage.removeCalls, []);
  assert.equal(localStorage.getItem('animacraft-maker-draft-v1'), '{not-json');
});

test('does not open or create absent legacy databases', async () => {
  const indexedDB = new MemoryIndexedDb();
  const localStorage = new MemoryStorage({ unrelated: 'value' });

  assert.deepEqual(await scanLegacyMakerDrafts({ indexedDB, localStorage }), []);
  assert.deepEqual(indexedDB.openCalls, []);
  assert.deepEqual(indexedDB.deleteCalls, []);
  assert.deepEqual(localStorage.setCalls, []);
  assert.deepEqual(localStorage.removeCalls, []);
});

test('a blocked legacy source does not hide the other database or localStorage discoveries', async () => {
  const creatorDocument = v5Document('creator-survives');
  const localDocument = v5Document('local-survives');
  const indexedDB = new MemoryIndexedDb({
    [LEGACY_WORKSPACE_DATABASE_NAME]: {
      'maker-documents': [{
        makerKey: '0x111:blocked',
        document: v5Document('blocked'),
      }],
    },
    [LEGACY_CREATOR_DATABASE_NAME]: {
      'maker-drafts': [{
        makerKey: 'animacraft-maker-draft-v2:0x222:creator-survives',
        draft: { manifest: creatorDocument },
      }],
    },
  });
  indexedDB.failedOpens.add(LEGACY_WORKSPACE_DATABASE_NAME);
  const localStorage = new MemoryStorage({
    'animacraft-maker-draft-v2:0x333:local-survives': JSON.stringify({
      manifest: localDocument,
    }),
  });

  const records = await scanLegacyMakerDrafts({ indexedDB, localStorage });

  const scanError = records.find((record) => record.status === 'scan-error');
  assert.equal(scanError.source, 'workspace-v4');
  assert.equal(scanError.recoverable, false);
  assert.equal(scanError.issues[0].code, 'source-scan-failed');
  assert.match(scanError.raw.scanError.message, /blocked/);
  assert.equal(records.some((record) => record.makerKey === '0x222:creator-survives'), true);
  assert.equal(records.some((record) => record.makerKey === '0x333:local-survives'), true);
  assert.deepEqual(localStorage.setCalls, []);
  assert.deepEqual(localStorage.removeCalls, []);
});

test('produces a standalone JSON-safe export with embedded Blob bytes', async () => {
  const blob = new Blob(['png'], { type: 'image/png' });
  const record = {
    id: 'legacy:workspace-v4:maker',
    source: 'workspace-v4',
    makerKey: '0xabc:maker',
    assets: [{
      blob,
      bytes: new Uint8Array([1, 2, 3]),
      createdAt: new Date('2026-07-26T00:00:00.000Z'),
      supply: 1n,
    }],
    raw: { documentRecord: { name: 'Backup' } },
  };

  const payload = await legacyRecoveryExportPayload(record);
  const serialized = JSON.stringify(payload);

  assert.equal(payload.schemaVersion, LEGACY_RECOVERY_EXPORT_SCHEMA);
  assert.equal(typeof payload.exportedAt, 'string');
  assert.equal(payload.record.id, record.id);
  assert.equal(payload.record.assets[0].blob.$type, 'Blob');
  assert.equal(payload.record.assets[0].blob.dataUrl, 'data:image/png;base64,cG5n');
  assert.equal(payload.record.assets[0].bytes.$type, 'Uint8Array');
  assert.equal(payload.record.assets[0].createdAt.value, '2026-07-26T00:00:00.000Z');
  assert.deepEqual(payload.record.assets[0].supply, { $type: 'bigint', value: '1' });
  assert.match(serialized, /data:image\/png;base64,cG5n/);
  assert.equal(await blob.text(), 'png');
});

test('record ids remain stable across repeated read-only scans', async () => {
  const indexedDB = new MemoryIndexedDb({
    [LEGACY_WORKSPACE_DATABASE_NAME]: {
      'maker-documents': [{
        makerKey: '0xabc:stable-maker',
        document: v5Document('stable-maker'),
        savedAt: 123,
      }],
    },
  });
  const localStorage = new MemoryStorage();

  const first = await scanLegacyMakerDrafts({ indexedDB, localStorage });
  indexedDB.databaseMap.get(LEGACY_WORKSPACE_DATABASE_NAME).closed = false;
  const second = await scanLegacyMakerDrafts({ indexedDB, localStorage });

  assert.deepEqual(first.map((record) => record.id), second.map((record) => record.id));
  assert.equal(first[0].id.includes('stable-maker'), true);
});
