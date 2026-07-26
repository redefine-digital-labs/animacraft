import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearMakerDraftWal,
  listMakerDraftWals,
  loadMakerDraftWal,
  makerDraftWalSnapshotsEqual,
  makerDraftWalStorageKey,
  writeMakerDraftWal,
} from '../maker-draft-wal.js';

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
    values,
  };
}

function snapshot({
  revision = 1,
  baseRevision = 0,
  name = 'Maker',
  recipeItem = 'item-a',
} = {}) {
  return {
    revision,
    baseRevision,
    document: {
      version: { rootMakerId: 'maker-root' },
      metadata: { name },
      parts: [],
    },
    recipe: {
      selections: [{ partId: 'part-a', itemId: recipeItem }],
      colors: [],
    },
    journal: [{ label: `Rename ${name}` }],
  };
}

test('WAL synchronously stores JSON state while excluding Blob bytes and blob URLs', () => {
  const storage = memoryLocalStorage();
  const input = snapshot({ revision: 4, baseRevision: 3, name: 'Recover me' });
  input.document.assets = [{
    id: 'asset-a',
    url: 'blob:https://example.invalid/private-bytes',
    blob: new Blob(['secret-binary-payload']),
  }];

  assert.equal(writeMakerDraftWal(storage, 'wallet:maker', input, {
    writerId: 'tab-a',
    walletAddress: '0xabc',
    updatedAt: 1234,
  }), true);

  const raw = storage.getItem(makerDraftWalStorageKey('wallet:maker', 'tab-a'));
  assert.ok(raw);
  assert.doesNotMatch(raw, /secret-binary-payload|blob:https/);
  const restored = loadMakerDraftWal(storage, 'wallet:maker', { writerId: 'tab-a' });
  assert.equal(restored.revision, 4);
  assert.equal(restored.baseRevision, 3);
  assert.equal(restored.document.metadata.name, 'Recover me');
  assert.equal(restored.document.assets[0].url, '');
  assert.equal('blob' in restored.document.assets[0], false);
});

test('each browser tab keeps an independent WAL branch and only equivalent content is cleared', () => {
  const storage = memoryLocalStorage();
  const tabA = snapshot({ revision: 4, baseRevision: 3, name: 'Tab A branch' });
  const tabB = snapshot({ revision: 4, baseRevision: 3, name: 'Tab B branch' });
  writeMakerDraftWal(storage, 'wallet:maker', tabA, { writerId: 'tab-a', updatedAt: 100 });
  writeMakerDraftWal(storage, 'wallet:maker', tabB, { writerId: 'tab-b', updatedAt: 200 });

  assert.equal(listMakerDraftWals(storage, 'wallet:maker').length, 2);
  assert.equal(
    clearMakerDraftWal(storage, 'wallet:maker', {
      writerId: 'tab-a',
      expectedSnapshot: tabB,
    }),
    false,
  );
  assert.equal(loadMakerDraftWal(storage, 'wallet:maker', { writerId: 'tab-a' }).document.metadata.name, 'Tab A branch');

  assert.equal(
    clearMakerDraftWal(storage, 'wallet:maker', {
      writerId: 'tab-b',
      expectedSnapshot: tabB,
    }),
    true,
  );
  assert.equal(storage.getItem(makerDraftWalStorageKey('wallet:maker', 'tab-b')), null);
  assert.equal(loadMakerDraftWal(storage, 'wallet:maker', { writerId: 'tab-a' }).document.metadata.name, 'Tab A branch');
});

test('WAL equivalence compares document and recipe rather than incomparable local revisions', () => {
  const olderLocalRevision = snapshot({
    revision: 2,
    baseRevision: 1,
    name: 'Same content',
    recipeItem: 'same-item',
  });
  const newerLocalRevision = snapshot({
    revision: 99,
    baseRevision: 80,
    name: 'Same content',
    recipeItem: 'same-item',
  });
  const divergentRecipe = snapshot({
    revision: 2,
    baseRevision: 1,
    name: 'Same content',
    recipeItem: 'different-item',
  });

  assert.equal(makerDraftWalSnapshotsEqual(olderLocalRevision, newerLocalRevision), true);
  assert.equal(makerDraftWalSnapshotsEqual(olderLocalRevision, divergentRecipe), false);
});
