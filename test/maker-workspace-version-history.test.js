import assert from 'node:assert/strict';
import test from 'node:test';

import { createCharacterMakerV5Starter } from '../maker-v4.js';
import { createMakerWorkspace } from '../maker-workspace.js';

class FakeRoot {
  constructor() {
    this.innerHTML = '';
  }

  addEventListener() {}
  removeEventListener() {}
  contains() { return false; }
  querySelector() { return null; }
}

function actionTarget(action, dataset = {}) {
  const target = {
    dataset: { action, ...dataset },
    matches: () => false,
  };
  target.closest = () => target;
  return target;
}

async function waitFor(predicate, message = 'Timed out waiting for the workspace action.') {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > 1_000) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function withAnimationFrame(run) {
  const previous = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (callback) => {
    callback();
    return 1;
  };
  try {
    await run();
  } finally {
    globalThis.requestAnimationFrame = previous;
  }
}

test('Creator version history flushes before listing and restores a checkpoint as the new persisted revision', async () => withAnimationFrame(async () => {
  const creatorRoot = new FakeRoot();
  const makerKey = 'wallet:history-maker';
  const current = createCharacterMakerV5Starter({ makerId: 'history-maker', name: 'Current Maker' });
  const historical = structuredClone(current);
  historical.metadata.name = 'Historical Maker';
  const restored = structuredClone(historical);
  let persistedRevision = 3;
  let didRestore = false;
  const calls = [];
  const callbacks = [];
  const repository = {
    getStatus(key) {
      assert.equal(key, makerKey);
      return { persistedRevision, savedAt: 3_000 };
    },
    async listCheckpoints(key) {
      calls.push(['list', key]);
      return didRestore ? [
        { revision: 7, document: restored, metadata: { name: 'Historical Maker' }, savedAt: 7_000 },
        { revision: 3, document: current, metadata: { name: 'Current Maker' }, savedAt: 3_000 },
        { revision: 1, document: historical, metadata: { name: 'Historical Maker' }, savedAt: 1_000 },
      ] : [
        { revision: 3, document: current, metadata: { name: 'Current Maker' }, savedAt: 3_000 },
        { revision: 1, document: historical, metadata: { name: 'Historical Maker' }, savedAt: 1_000 },
      ];
    },
    async restoreCheckpoint(key, revision) {
      calls.push(['restore', key, revision]);
      assert.equal(key, makerKey);
      assert.equal(revision, 1);
      didRestore = true;
      persistedRevision = 7;
      return {
        makerKey: key,
        restoredFromRevision: revision,
        revision: 7,
        persistedRevision: 7,
        committed: true,
        conflict: false,
        document: structuredClone(restored),
        recipe: structuredClone(restored.defaultRecipe),
        metadata: { draftRevision: 7 },
        savedAt: 7_000,
      };
    },
    async load(key) {
      calls.push(['load', key]);
      return {
        makerKey: key,
        revision: 7,
        document: structuredClone(restored),
        recipe: structuredClone(restored.defaultRecipe),
        metadata: { draftRevision: 7 },
        assets: [],
        savedAt: 7_000,
      };
    },
    async flush() {
      calls.push(['flush']);
      return { persistedRevision };
    },
  };
  const workspace = createMakerWorkspace({
    creatorRoot,
    draftRepository: repository,
    callbacks: { onRestored: (payload) => callbacks.push(payload) },
  });
  const previousWindow = globalThis.window;
  const confirmations = [];
  globalThis.window = {
    confirm(message) {
      confirmations.push(message);
      return true;
    },
  };
  try {
    await workspace.setContext({
      makerKey,
      walletAddress: '',
      document: current,
      assets: [],
    });
    assert.match(creatorRoot.innerHTML, /data-action="open-version-history"/);

    const flushReasons = [];
    const originalFlush = workspace.flushPendingChanges.bind(workspace);
    workspace.flushPendingChanges = async (options) => {
      flushReasons.push(options.reason);
      return originalFlush(options);
    };
    workspace.handleCreatorClick({ target: actionTarget('open-version-history') });
    await waitFor(() => workspace.versionHistoryStatus === 'ready');

    assert.deepEqual(flushReasons, ['open-version-history']);
    assert.deepEqual(calls[0], ['list', makerKey]);
    assert.match(creatorRoot.innerHTML, /Historical Maker/);
    assert.match(creatorRoot.innerHTML, /data-action="restore-checkpoint" data-revision="1"/);

    workspace.handleCreatorClick({
      target: actionTarget('restore-checkpoint', { revision: '1' }),
    });
    await waitFor(() => workspace.versionHistoryStatus === 'ready' && workspace.getDocument().metadata.name === 'Historical Maker');

    assert.deepEqual(flushReasons, ['open-version-history', 'restore-version-history']);
    assert.ok(confirmations[0].includes('Historical Maker'));
    assert.ok(confirmations[0].includes('1'));
    assert.ok(calls.some((call) => call[0] === 'restore' && call[1] === makerKey && call[2] === 1));
    assert.ok(calls.some((call) => call[0] === 'load' && call[1] === makerKey));
    assert.equal(workspace.store.getState().revision, 7);
    assert.equal(workspace.store.getState().savedRevision, 7);
    assert.equal(workspace.store.getState().dirty, false);
    assert.equal(callbacks.length, 1);
    assert.equal(callbacks[0].revision, 7);
    assert.equal(callbacks[0].restoredFromRevision, 1);
    assert.match(creatorRoot.innerHTML, /data-action="restore-checkpoint" data-revision="3"/);
  } finally {
    workspace.destroy();
    globalThis.window = previousWindow;
  }
}));

test('successful save status uses the repository save time', async () => withAnimationFrame(async () => {
  const savedAt = Date.UTC(2026, 6, 26, 13, 14);
  const repository = {
    getStatus: () => ({ persistedRevision: 1, savedAt }),
    save: async (_key, snapshot) => ({
      confirmed: true,
      requestedRevision: snapshot.revision,
      persistedRevision: snapshot.revision,
    }),
    flush: async () => ({ persistedRevision: 1, savedAt }),
  };
  const workspace = createMakerWorkspace({ draftRepository: repository, locale: 'zh' });
  const document = createCharacterMakerV5Starter({ makerId: 'save-time', name: 'Save Time' });
  try {
    await workspace.setContext({
      makerKey: 'wallet:save-time',
      walletAddress: '',
      document,
      assets: [],
    });
    workspace.context.walletAddress = '0x1';
    workspace.executeDocument('Rename Maker', ({ document: next }) => {
      next.metadata.name = 'Saved Maker';
    });
    workspace.autosave.cancel();
    await workspace.save();

    const state = workspace.store.getState();
    assert.equal(state.saveState, 'saved');
    assert.match(state.saveMessage, /^已保存 /);
    assert.equal(workspace.saveStateText(state), state.saveMessage);
  } finally {
    workspace.context.walletAddress = '';
    workspace.destroy();
  }
}));
