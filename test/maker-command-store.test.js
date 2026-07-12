import assert from 'node:assert/strict';
import test from 'node:test';

import { createMakerCommandStore } from '../maker-command-store.js';

function fixture() {
  return {
    document: { metadata: { name: 'Original' }, parts: [] },
    recipe: { selections: [], colors: [] },
  };
}

test('clones initial state and executes commands against an isolated draft', () => {
  const source = fixture();
  const store = createMakerCommandStore(source.document, source.recipe);
  source.document.metadata.name = 'Mutated outside';
  assert.equal(store.getState().document.metadata.name, 'Original');

  store.execute('Rename Maker', ({ document, recipe }) => {
    document.metadata.name = 'Renamed';
    recipe.selections.push({ partId: 'body', itemId: 'base' });
  });
  const state = store.getState();
  assert.equal(state.document.metadata.name, 'Renamed');
  assert.deepEqual(state.recipe.selections, [{ partId: 'body', itemId: 'base' }]);
  assert.equal(state.dirty, true);
  assert.equal(state.canUndo, true);
  assert.equal(state.undoLabel, 'Rename Maker');
});
test('undo and redo restore both document and recipe snapshots', () => {
  const source = fixture();
  const store = createMakerCommandStore(source.document, source.recipe);
  store.execute('First edit', ({ document }) => { document.metadata.name = 'First'; });
  store.execute('Second edit', ({ document, recipe }) => {
    document.metadata.name = 'Second';
    recipe.selections.push({ partId: 'hair', itemId: 'long' });
  });

  assert.equal(store.undo(), true);
  assert.equal(store.getState().document.metadata.name, 'First');
  assert.deepEqual(store.getState().recipe.selections, []);
  assert.equal(store.getState().redoLabel, 'Second edit');
  assert.equal(store.redo(), true);
  assert.equal(store.getState().document.metadata.name, 'Second');
  assert.equal(store.getState().recipe.selections[0].itemId, 'long');
  assert.equal(store.redo(), false);
});

test('a new command after undo clears the redo branch', () => {
  const source = fixture();
  const store = createMakerCommandStore(source.document, source.recipe);
  store.execute('One', ({ document }) => { document.metadata.name = 'One'; });
  store.execute('Two', ({ document }) => { document.metadata.name = 'Two'; });
  store.undo();
  store.execute('Branch', ({ document }) => { document.metadata.name = 'Branch'; });
  assert.equal(store.getState().canRedo, false);
  assert.equal(store.redo(), false);
  assert.deepEqual(store.exportJournal().map((entry) => entry.label), ['One', 'Branch']);
});

test('a throwing mutator is atomic and does not notify listeners', () => {
  const source = fixture();
  const store = createMakerCommandStore(source.document, source.recipe);
  const events = [];
  store.subscribe((_, event) => events.push(event));
  assert.throws(() => store.execute('Broken', ({ document }) => {
    document.metadata.name = 'Should not commit';
    throw new Error('stop');
  }), /stop/);
  assert.equal(store.getState().document.metadata.name, 'Original');
  assert.equal(store.getState().revision, 0);
  assert.deepEqual(events, []);
});

test('publishes reasoned subscription events and supports unsubscribe', () => {
  const source = fixture();
  const store = createMakerCommandStore(source.document, source.recipe);
  const events = [];
  const unsubscribe = store.subscribe((state, event) => events.push({ revision: state.revision, ...event }));
  store.execute('Edit', ({ document }) => { document.metadata.name = 'Edited'; });
  store.setSaveState('saving', 'Saving…');
  store.setSaveState('saved', 'Saved');
  store.undo();
  store.redo();
  unsubscribe();
  store.setSaveState('error', 'offline');
  assert.deepEqual(events.map((event) => event.reason), ['execute', 'save-state', 'save-state', 'undo', 'redo']);
  assert.equal(store.getState().saveState, 'error');
  assert.equal(store.getState().saveMessage, 'offline');
});

test('replace resets history by default and can mark a loaded draft dirty', () => {
  const source = fixture();
  const store = createMakerCommandStore(source.document, source.recipe);
  store.execute('Old edit', ({ document }) => { document.metadata.name = 'Old'; });
  store.replace({ metadata: { name: 'Loaded' }, parts: [] }, { selections: [], colors: [] });
  assert.equal(store.getState().document.metadata.name, 'Loaded');
  assert.equal(store.getState().canUndo, false);
  assert.equal(store.getState().dirty, false);
  store.replace({ metadata: { name: 'Imported' }, parts: [] }, { selections: [], colors: [] }, { markSaved: false });
  assert.equal(store.getState().dirty, true);
  assert.equal(store.getState().saveState, 'dirty');
});

test('bounds retained command history', () => {
  const source = fixture();
  const store = createMakerCommandStore(source.document, source.recipe, { historyLimit: 10 });
  for (let index = 1; index <= 15; index += 1) {
    store.execute(`Edit ${index}`, ({ document }) => { document.metadata.name = `Name ${index}`; });
  }
  assert.equal(store.exportJournal().length, 10);
  let undoCount = 0;
  while (store.undo()) undoCount += 1;
  assert.equal(undoCount, 10);
  assert.equal(store.getState().document.metadata.name, 'Name 5');
});
