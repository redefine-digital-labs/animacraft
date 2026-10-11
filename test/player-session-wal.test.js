import assert from 'node:assert/strict';
import test from 'node:test';

import { createCharacterMakerV5Starter } from '../maker-v4.js';
import { createMakerWorkspace } from '../maker-workspace.js';
import {
  clearPlayerSessionWal,
  listPlayerSessionWals,
  loadPlayerSessionWal,
  playerSessionWalStorageKey,
  writePlayerSessionWal,
} from '../player-session-wal.js';

function memoryStorage() {
  const records = new Map();
  return {
    records,
    get length() {
      return records.size;
    },
    key(index) {
      return [...records.keys()][index] ?? null;
    },
    getItem(key) {
      return records.has(key) ? records.get(key) : null;
    },
    setItem(key, value) {
      records.set(String(key), String(value));
    },
    removeItem(key) {
      records.delete(String(key));
    },
  };
}

function playerSession(document, {
  name = 'Mira',
  memoryMd = '# Mira memory',
  makerVersionId = document.version.versionId,
} = {}) {
  return {
    makerVersionId,
    recipe: structuredClone(document.defaultRecipe),
    profile: {
      name,
      world: 'Moonlit world',
      description: '',
      tags: '',
    },
    livingContent: {
      schemaVersion: 'animacraft.living-content.v1',
      soulMd: `# ${name}`,
      memoryMd,
      skillMd: `---\nname: ${name.toLowerCase().replaceAll(' ', '-')}\n---\n# ${name} skill`,
      customized: {
        soulMd: true,
        memoryMd: true,
        skillMd: true,
      },
    },
    enabledExpansionIds: [],
    updatedAt: new Date(1_000).toISOString(),
  };
}

function restoredMakerRepository(document) {
  return {
    async load(makerKey) {
      return {
        makerKey,
        revision: 0,
        document: structuredClone(document),
        recipe: structuredClone(document.defaultRecipe),
        assets: [],
        metadata: {},
        savedAt: 100,
      };
    },
    async save() {
      throw new Error('The restored Maker document must remain clean.');
    },
    async flush() {
      return { persistedRevision: 0 };
    },
    getStatus() {
      return { persistedRevision: 0, savedAt: 100 };
    },
  };
}

function playerSessionCasBackend(initialRecord = null) {
  let record = initialRecord ? structuredClone(initialRecord) : null;
  return {
    async load(sessionKey) {
      if (!record || record.sessionKey !== sessionKey) return null;
      return structuredClone(record);
    },
    async save(sessionKey, session, metadata) {
      const persistedRevision = Number.isSafeInteger(record?.revision)
        ? record.revision
        : null;
      if (
        persistedRevision !== metadata.baseRevision
        || (persistedRevision !== null && metadata.revision <= persistedRevision)
      ) {
        return {
          committed: false,
          conflict: true,
          persistedRevision,
          writerId: record?.writerId || '',
          savedAt: record?.savedAt ?? null,
        };
      }
      record = {
        sessionKey,
        session: structuredClone(session),
        revision: metadata.revision,
        baseRevision: metadata.baseRevision,
        writerId: metadata.writerId,
        savedAt: 10_000 + metadata.revision,
      };
      return {
        committed: true,
        conflict: false,
        persistedRevision: record.revision,
        writerId: record.writerId,
        savedAt: record.savedAt,
      };
    },
    current() {
      return record ? structuredClone(record) : null;
    },
  };
}

function playerSessionCasMapBackend(initialRecords = []) {
  const records = new Map(
    initialRecords.map((record) => [record.sessionKey, structuredClone(record)]),
  );
  return {
    async load(sessionKey) {
      const record = records.get(sessionKey);
      return record ? structuredClone(record) : null;
    },
    async save(sessionKey, session, metadata) {
      const existing = records.get(sessionKey) || null;
      const persistedRevision = Number.isSafeInteger(existing?.revision)
        ? existing.revision
        : null;
      if (
        persistedRevision !== metadata.baseRevision
        || (persistedRevision !== null && metadata.revision <= persistedRevision)
      ) {
        return {
          committed: false,
          conflict: true,
          persistedRevision,
          writerId: existing?.writerId || '',
          savedAt: existing?.savedAt ?? null,
        };
      }
      const record = {
        sessionKey,
        session: structuredClone(session),
        revision: metadata.revision,
        baseRevision: metadata.baseRevision,
        writerId: metadata.writerId,
        savedAt: 20_000 + metadata.revision,
      };
      records.set(sessionKey, record);
      return {
        committed: true,
        conflict: false,
        persistedRevision: record.revision,
        writerId: record.writerId,
        savedAt: record.savedAt,
      };
    },
    current(sessionKey) {
      const record = records.get(sessionKey);
      return record ? structuredClone(record) : null;
    },
  };
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

test('Player session WAL writes synchronously and compare-and-swap clearing preserves newer edits', () => {
  const storage = memoryStorage();
  const sessionKey = '0xwallet::maker-version';
  const first = {
    makerVersionId: 'maker-version',
    profile: { name: 'First' },
  };
  const second = {
    makerVersionId: 'maker-version',
    profile: { name: 'Second' },
  };

  assert.equal(writePlayerSessionWal(storage, sessionKey, {
    revision: 1,
    session: first,
  }, {
    writerId: 'tab-a',
    updatedAt: 100,
  }), true);
  assert.ok(
    storage.getItem(playerSessionWalStorageKey(sessionKey, 'tab-a')),
    'the Player edit must exist synchronously before any IndexedDB promise runs',
  );
  assert.deepEqual(loadPlayerSessionWal(storage, sessionKey, { writerId: 'tab-a' }), {
    schemaVersion: 1,
    sessionKey,
    writerId: 'tab-a',
    revision: 1,
    baseRevision: null,
    session: first,
    updatedAt: 100,
    storageKey: playerSessionWalStorageKey(sessionKey, 'tab-a'),
  });

  writePlayerSessionWal(storage, sessionKey, {
    revision: 2,
    session: second,
  }, {
    writerId: 'tab-a',
    updatedAt: 200,
  });
  assert.equal(clearPlayerSessionWal(storage, sessionKey, {
    writerId: 'tab-a',
    expectedWriterId: 'tab-a',
    throughRevision: 1,
    expectedSession: first,
  }), false);
  assert.equal(loadPlayerSessionWal(storage, sessionKey, { writerId: 'tab-a' }).revision, 2);
  assert.equal(clearPlayerSessionWal(storage, sessionKey, {
    writerId: 'tab-a',
    expectedWriterId: 'tab-a',
    throughRevision: 2,
    expectedSession: first,
  }), false);
  assert.equal(loadPlayerSessionWal(storage, sessionKey, { writerId: 'tab-a' }).session.profile.name, 'Second');
  assert.equal(clearPlayerSessionWal(storage, sessionKey, {
    writerId: 'tab-a',
    expectedWriterId: 'tab-a',
    throughRevision: 2,
    expectedSession: second,
  }), true);
  assert.equal(loadPlayerSessionWal(storage, sessionKey), null);
});

test('a live Player edit writes WAL immediately and a confirmed session save clears it', async () => (
  withAnimationFrame(async () => {
    const storage = memoryStorage();
    const document = createCharacterMakerV5Starter({
      makerId: 'player-wal-save',
      name: 'Player WAL Save',
    });
    const sessionKey = `0xwallet::${document.version.versionId}`;
    const writes = [];
    const workspace = createMakerWorkspace({
      callbacks: {},
      draftRepository: restoredMakerRepository(document),
      walStorage: storage,
      loadPlayerSessionRecord: async () => null,
      async savePlayerSessionRecord(key, session) {
        writes.push({ key, session: structuredClone(session) });
      },
    });

    await workspace.setContext({
      makerKey: '0xwallet:player-wal-save',
      walletAddress: '0xwallet',
      document,
      assets: [],
    });
    workspace.handlePlayerChange({
      target: {
        dataset: { action: 'player-profile-name' },
        value: 'Synchronous WAL OC',
      },
    });

    const immediate = loadPlayerSessionWal(storage, sessionKey);
    assert.equal(immediate.revision, 1);
    assert.equal(immediate.session.profile.name, 'Synchronous WAL OC');
    assert.equal(writes.length, 0, 'IndexedDB persistence must still be pending at this point');

    await workspace.sessionAutosave.flush();
    assert.equal(writes.length, 1);
    assert.equal(writes[0].key, sessionKey);
    assert.equal(writes[0].session.profile.name, 'Synchronous WAL OC');
    assert.equal(loadPlayerSessionWal(storage, sessionKey), null);
    assert.equal(workspace.playerSaveState, 'saved');
    workspace.context.walletAddress = '';
    workspace.destroy();
  })
));

test('non-default Smart Color survives immediate WAL, confirmed save and crash recovery refreshes', async () => (
  withAnimationFrame(async () => {
    const storage = memoryStorage();
    const document = createCharacterMakerV5Starter({
      makerId: 'player-smart-color-wal',
      name: 'Player Smart Color WAL',
    });
    document.colorChannels.push({
      id: 'skin-tone',
      name: 'Skin tone',
      order: 0,
      mode: 'gradient-map',
      defaultSwatchId: 'warm',
      swatches: [
        {
          id: 'warm',
          name: 'Warm',
          hintColor: '#d68f72',
          stops: [{ offset: 0, color: '#3b1e18' }, { offset: 1, color: '#fff1e9' }],
        },
        {
          id: 'cool',
          name: 'Cool',
          hintColor: '#9db4d9',
          stops: [{ offset: 0, color: '#18233b' }, { offset: 1, color: '#eef4ff' }],
        },
        {
          id: 'violet',
          name: 'Violet',
          hintColor: '#8268c7',
          stops: [{ offset: 0, color: '#211532' }, { offset: 1, color: '#f1eaff' }],
        },
      ],
    });
    document.defaultRecipe.colors = [{ channelId: 'skin-tone', swatchId: 'warm' }];

    const sessionKey = `0xwallet::${document.version.versionId}`;
    const backend = playerSessionCasBackend();
    const context = {
      makerKey: '0xwallet:player-smart-color-wal',
      walletAddress: '0xwallet',
      document,
      assets: [],
    };
    const original = createMakerWorkspace({
      callbacks: {},
      draftRepository: restoredMakerRepository(document),
      walStorage: storage,
      playerWalWriterId: 'smart-color-original',
      loadPlayerSessionRecord: (key) => backend.load(key),
      savePlayerSessionRecord: (key, session, metadata) => backend.save(key, session, metadata),
    });
    await original.setContext(context);

    const coolRecipe = structuredClone(original.playerRecipe);
    coolRecipe.colors = [{ channelId: 'skin-tone', swatchId: 'cool' }];
    assert.equal(original.setPlayerRecipe(coolRecipe, 'Choose cool skin tone'), true);

    const immediateCool = loadPlayerSessionWal(storage, sessionKey, {
      writerId: 'smart-color-original',
    });
    assert.equal(immediateCool.revision, 1);
    assert.deepEqual(immediateCool.session.recipe.colors, [
      { channelId: 'skin-tone', swatchId: 'cool' },
    ]);
    assert.equal(backend.current(), null, 'the durable session must still be pending');

    await original.sessionAutosave.flush();
    assert.deepEqual(backend.current().session.recipe.colors, [
      { channelId: 'skin-tone', swatchId: 'cool' },
    ]);
    assert.equal(loadPlayerSessionWal(storage, sessionKey), null);
    assert.equal(original.playerSaveState, 'saved');

    const violetRecipe = structuredClone(original.playerRecipe);
    violetRecipe.colors = [{ channelId: 'skin-tone', swatchId: 'violet' }];
    assert.equal(original.setPlayerRecipe(violetRecipe, 'Choose violet skin tone'), true);
    original.sessionAutosave.cancel();
    assert.deepEqual(
      loadPlayerSessionWal(storage, sessionKey, {
        writerId: 'smart-color-original',
      }).session.recipe.colors,
      [{ channelId: 'skin-tone', swatchId: 'violet' }],
      'the second non-default color must be recoverable before IndexedDB runs',
    );
    assert.deepEqual(
      backend.current().session.recipe.colors,
      [{ channelId: 'skin-tone', swatchId: 'cool' }],
      'the simulated crash leaves the last confirmed color unchanged',
    );
    original.context.walletAddress = '';
    original.destroy();

    const recovered = createMakerWorkspace({
      callbacks: {},
      draftRepository: restoredMakerRepository(document),
      walStorage: storage,
      playerWalWriterId: 'smart-color-recovery',
      loadPlayerSessionRecord: (key) => backend.load(key),
      savePlayerSessionRecord: (key, session, metadata) => backend.save(key, session, metadata),
    });
    await recovered.setContext(context);

    assert.deepEqual(recovered.playerRecipe.colors, [
      { channelId: 'skin-tone', swatchId: 'violet' },
    ]);
    assert.deepEqual(backend.current().session.recipe.colors, [
      { channelId: 'skin-tone', swatchId: 'violet' },
    ]);
    assert.equal(backend.current().revision, 2);
    assert.equal(listPlayerSessionWals(storage, sessionKey).length, 0);
    assert.equal(recovered.playerSaveState, 'saved');
    recovered.context.walletAddress = '';
    recovered.destroy();

    const refreshed = createMakerWorkspace({
      callbacks: {},
      draftRepository: restoredMakerRepository(document),
      walStorage: storage,
      playerWalWriterId: 'smart-color-refresh',
      loadPlayerSessionRecord: (key) => backend.load(key),
      savePlayerSessionRecord: (key, session, metadata) => backend.save(key, session, metadata),
    });
    await refreshed.setContext(context);

    assert.deepEqual(
      refreshed.playerRecipe.colors,
      [{ channelId: 'skin-tone', swatchId: 'violet' }],
      'a later refresh must restore the color from the confirmed durable session',
    );
    assert.equal(refreshed.playerPersistedRevision, 2);
    assert.equal(listPlayerSessionWals(storage, sessionKey).length, 0);
    refreshed.context.walletAddress = '';
    refreshed.destroy();
  })
));

test('two Workspaces at one revision keep independent WAL branches and surface the losing CAS conflict', async () => (
  withAnimationFrame(async () => {
    const storage = memoryStorage();
    const document = createCharacterMakerV5Starter({
      makerId: 'player-wal-two-writers',
      name: 'Player WAL Two Writers',
    });
    const sessionKey = `0xwallet::${document.version.versionId}`;
    const backend = playerSessionCasBackend();
    const errorsA = [];
    const errorsB = [];
    const workspaceA = createMakerWorkspace({
      callbacks: { onPlayerSaveError: (error) => errorsA.push(error) },
      draftRepository: restoredMakerRepository(document),
      walStorage: storage,
      playerWalWriterId: 'writer-a',
      loadPlayerSessionRecord: (key) => backend.load(key),
      savePlayerSessionRecord: (key, session, metadata) => backend.save(key, session, metadata),
    });
    const workspaceB = createMakerWorkspace({
      callbacks: { onPlayerSaveError: (error) => errorsB.push(error) },
      draftRepository: restoredMakerRepository(document),
      walStorage: storage,
      playerWalWriterId: 'writer-b',
      loadPlayerSessionRecord: (key) => backend.load(key),
      savePlayerSessionRecord: (key, session, metadata) => backend.save(key, session, metadata),
    });
    const context = {
      makerKey: '0xwallet:player-wal-two-writers',
      walletAddress: '0xwallet',
      document,
      assets: [],
    };
    await workspaceA.setContext(context);
    await workspaceB.setContext(context);

    workspaceA.handlePlayerChange({
      target: {
        dataset: { action: 'player-profile-name' },
        value: 'Writer A OC',
      },
    });
    workspaceB.handlePlayerChange({
      target: {
        dataset: { action: 'player-profile-name' },
        value: 'Writer B OC',
      },
    });
    workspaceA.sessionAutosave.cancel();
    workspaceB.sessionAutosave.cancel();

    const walA = loadPlayerSessionWal(storage, sessionKey, { writerId: 'writer-a' });
    const walB = loadPlayerSessionWal(storage, sessionKey, { writerId: 'writer-b' });
    assert.equal(walA.revision, 1);
    assert.equal(walA.baseRevision, null);
    assert.equal(walA.session.profile.name, 'Writer A OC');
    assert.equal(walB.revision, 1);
    assert.equal(walB.baseRevision, null);
    assert.equal(walB.session.profile.name, 'Writer B OC');
    assert.equal(listPlayerSessionWals(storage, sessionKey).length, 2);

    const savedA = await workspaceA.savePlayerSession();
    assert.equal(savedA.saved, true);
    assert.equal(backend.current().session.profile.name, 'Writer A OC');
    assert.equal(
      listPlayerSessionWals(storage, sessionKey)
        .some((candidate) => candidate.writerId === 'writer-a'),
      false,
    );
    assert.equal(
      loadPlayerSessionWal(storage, sessionKey, { writerId: 'writer-b' }).session.profile.name,
      'Writer B OC',
      'Writer A must never clear Writer B’s recovery branch',
    );

    const savedB = await workspaceB.savePlayerSession();
    assert.equal(savedB.saved, false);
    assert.equal(savedB.error.code, 'PLAYER_SESSION_CONFLICT');
    assert.equal(backend.current().session.profile.name, 'Writer A OC');
    assert.equal(errorsA.length, 0);
    assert.equal(errorsB.length, 1);
    assert.equal(errorsB[0].code, 'PLAYER_SESSION_CONFLICT');
    assert.equal(workspaceB.playerSaveState, 'error');
    assert.equal(
      workspaceB.playerSaveError,
      workspaceB.tr('playerSessionConflict', { count: 1 }),
    );
    assert.match(workspaceB.playerSaveStatusText(), /recovery copy/);
    assert.equal(workspaceB.playerSaveConflictRevision, 1);
    assert.equal(
      loadPlayerSessionWal(storage, sessionKey, { writerId: 'writer-b' }).session.profile.name,
      'Writer B OC',
      'a failed CAS must preserve the losing writer’s exact recovery branch',
    );

    workspaceA.context.walletAddress = '';
    workspaceA.destroy();

    const retriedB = await workspaceB.retryPlayerSessionSave();
    assert.equal(retriedB.saved, true);
    assert.equal(backend.current().revision, 2);
    assert.equal(backend.current().baseRevision, 1);
    assert.equal(backend.current().writerId, 'writer-b');
    assert.equal(backend.current().session.profile.name, 'Writer B OC');
    assert.equal(workspaceB.playerPersistedRevision, 2);
    assert.equal(workspaceB.playerSaveConflictRevision, null);
    assert.equal(workspaceB.playerSaveState, 'saved');
    assert.equal(
      listPlayerSessionWals(storage, sessionKey)
        .some((candidate) => candidate.writerId === 'writer-b'),
      false,
      'successful Retry must clear only Writer B’s rebased recovery branch',
    );

    workspaceB.context.walletAddress = '';
    workspaceB.destroy();
  })
));

test('a losing CAS branch survives refresh under a new writer and can be explicitly retried', async () => (
  withAnimationFrame(async () => {
    const storage = memoryStorage();
    const document = createCharacterMakerV5Starter({
      makerId: 'player-wal-refresh-conflict',
      name: 'Player WAL Refresh Conflict',
    });
    const sessionKey = `0xwallet::${document.version.versionId}`;
    const backend = playerSessionCasBackend();
    const context = {
      makerKey: '0xwallet:player-wal-refresh-conflict',
      walletAddress: '0xwallet',
      document,
      assets: [],
    };
    const winner = createMakerWorkspace({
      callbacks: {},
      draftRepository: restoredMakerRepository(document),
      walStorage: storage,
      playerWalWriterId: 'winner-tab',
      loadPlayerSessionRecord: (key) => backend.load(key),
      savePlayerSessionRecord: (key, session, metadata) => backend.save(key, session, metadata),
    });
    const loser = createMakerWorkspace({
      callbacks: {},
      draftRepository: restoredMakerRepository(document),
      walStorage: storage,
      playerWalWriterId: 'loser-before-refresh',
      loadPlayerSessionRecord: (key) => backend.load(key),
      savePlayerSessionRecord: (key, session, metadata) => backend.save(key, session, metadata),
    });
    await winner.setContext(context);
    await loser.setContext(context);

    winner.handlePlayerChange({
      target: {
        dataset: { action: 'player-profile-name' },
        value: 'Persisted winner',
      },
    });
    loser.handlePlayerChange({
      target: {
        dataset: { action: 'player-profile-name' },
        value: 'Unsaved loser survives refresh',
      },
    });
    winner.sessionAutosave.cancel();
    loser.sessionAutosave.cancel();
    assert.equal((await winner.savePlayerSession()).saved, true);
    const losingSave = await loser.savePlayerSession();
    assert.equal(losingSave.saved, false);
    assert.equal(losingSave.error.code, 'PLAYER_SESSION_CONFLICT');
    assert.equal(
      loadPlayerSessionWal(storage, sessionKey, {
        writerId: 'loser-before-refresh',
      }).session.profile.name,
      'Unsaved loser survives refresh',
    );

    winner.context.walletAddress = '';
    loser.context.walletAddress = '';
    winner.destroy();
    loser.destroy();

    const refreshed = createMakerWorkspace({
      callbacks: {},
      draftRepository: restoredMakerRepository(document),
      walStorage: storage,
      playerWalWriterId: 'new-writer-after-refresh',
      loadPlayerSessionRecord: (key) => backend.load(key),
      savePlayerSessionRecord: (key, session, metadata) => backend.save(key, session, metadata),
    });
    await refreshed.setContext(context);

    assert.equal(refreshed.playerProfile.name, 'Unsaved loser survives refresh');
    assert.equal(refreshed.playerSaveState, 'error');
    assert.equal(refreshed.playerSaveErrorCode, 'PLAYER_SESSION_CONFLICT');
    assert.equal(refreshed.playerSaveConflictRevision, 1);
    assert.equal(refreshed.playerRecoveryBranches.length, 1);
    assert.equal(
      refreshed.playerRecoveryBranches[0].writerId,
      'loser-before-refresh',
    );

    const recovered = await refreshed.retryPlayerSessionSave();
    assert.equal(recovered.saved, true);
    assert.equal(backend.current().revision, 2);
    assert.equal(backend.current().baseRevision, 1);
    assert.equal(backend.current().writerId, 'new-writer-after-refresh');
    assert.equal(
      backend.current().session.profile.name,
      'Unsaved loser survives refresh',
    );
    assert.equal(refreshed.playerSaveState, 'saved');
    assert.equal(refreshed.playerRecoveryBranches.length, 0);
    assert.equal(listPlayerSessionWals(storage, sessionKey).length, 0);

    refreshed.context.walletAddress = '';
    refreshed.destroy();
  })
));

test('divergent foreign branches remain selectable and can be saved one after another', async () => (
  withAnimationFrame(async () => {
    const storage = memoryStorage();
    const document = createCharacterMakerV5Starter({
      makerId: 'player-wal-divergent-recovery',
      name: 'Player WAL Divergent Recovery',
    });
    const sessionKey = `0xwallet::${document.version.versionId}`;
    const branchA = playerSession(document, {
      name: 'Recovery branch A',
      memoryMd: '# Branch A memory',
    });
    const branchB = playerSession(document, {
      name: 'Recovery branch B',
      memoryMd: '# Branch B memory',
    });
    writePlayerSessionWal(storage, sessionKey, {
      revision: 1,
      baseRevision: null,
      session: branchA,
    }, {
      writerId: 'foreign-a',
      updatedAt: 2_000,
    });
    writePlayerSessionWal(storage, sessionKey, {
      revision: 1,
      baseRevision: null,
      session: branchB,
    }, {
      writerId: 'foreign-b',
      updatedAt: 1_000,
    });
    const backend = playerSessionCasBackend();
    const workspace = createMakerWorkspace({
      callbacks: {},
      draftRepository: restoredMakerRepository(document),
      walStorage: storage,
      playerWalWriterId: 'review-tab',
      loadPlayerSessionRecord: (key) => backend.load(key),
      savePlayerSessionRecord: (key, session, metadata) => backend.save(key, session, metadata),
    });
    await workspace.setContext({
      makerKey: '0xwallet:player-wal-divergent-recovery',
      walletAddress: '0xwallet',
      document,
      assets: [],
    });

    assert.equal(workspace.playerSaveState, 'error');
    assert.equal(workspace.playerSaveErrorCode, 'PLAYER_SESSION_CONFLICT');
    assert.deepEqual(
      workspace.playerRecoveryBranches.map((branch) => branch.writerId),
      ['foreign-a', 'foreign-b'],
    );
    assert.equal(workspace.playerRecoverySelectedWriterId, 'foreign-a');
    assert.equal(workspace.playerProfile.name, 'Recovery branch A');

    assert.equal(workspace.activatePlayerRecoveryBranch('foreign-b'), true);
    assert.equal(workspace.playerProfile.name, 'Recovery branch B');
    assert.equal(
      workspace.playerLivingContentDraft().memoryMd,
      '# Branch B memory',
    );
    assert.equal(workspace.activatePlayerRecoveryBranch('foreign-a'), true);
    assert.equal(workspace.playerProfile.name, 'Recovery branch A');

    const savedA = await workspace.retryPlayerSessionSave();
    assert.equal(savedA.saved, true);
    assert.equal(backend.current().revision, 2);
    assert.equal(backend.current().session.profile.name, 'Recovery branch A');
    assert.equal(workspace.playerRecoveryBranches.length, 1);
    assert.equal(workspace.playerRecoverySelectedWriterId, 'foreign-b');
    assert.equal(workspace.playerSaveState, 'error');
    assert.equal(
      workspace.playerProfile.name,
      'Recovery branch B',
      'the next unresolved branch must become the actual preview, not only the active label',
    );
    assert.equal(
      workspace.playerLivingContentDraft().memoryMd,
      '# Branch B memory',
    );

    const savedB = await workspace.retryPlayerSessionSave();
    assert.equal(savedB.saved, true);
    assert.equal(backend.current().revision, 3);
    assert.equal(backend.current().baseRevision, 2);
    assert.equal(backend.current().session.profile.name, 'Recovery branch B');
    assert.equal(workspace.playerSaveState, 'saved');
    assert.equal(workspace.playerRecoveryBranches.length, 0);
    assert.equal(listPlayerSessionWals(storage, sessionKey).length, 0);

    workspace.context.walletAddress = '';
    workspace.destroy();
  })
));

test('published Maker version promotion, Undo and Redo keep Player sessions isolated by version', async () => (
  withAnimationFrame(async () => {
    const storage = memoryStorage();
    const publishedV1 = createCharacterMakerV5Starter({
      makerId: 'player-session-version-transition',
      name: 'Player Session Version Transition',
    });
    const backend = playerSessionCasMapBackend();
    const workspace = createMakerWorkspace({
      callbacks: {},
      draftRepository: restoredMakerRepository(publishedV1),
      walStorage: storage,
      playerWalWriterId: 'version-transition-tab',
      loadPlayerSessionRecord: (key) => backend.load(key),
      savePlayerSessionRecord: (key, session, metadata) => backend.save(key, session, metadata),
    });
    await workspace.setContext({
      makerKey: '0xwallet:player-session-version-transition',
      walletAddress: '0xwallet',
      document: publishedV1,
      publishedDocument: structuredClone(publishedV1),
      isPublished: true,
      assets: [],
    });
    const v1Key = `0xwallet::${publishedV1.version.versionId}`;

    workspace.handlePlayerChange({
      target: {
        dataset: { action: 'player-profile-name' },
        value: 'Pending v1 Player',
      },
    });
    assert.equal(workspace.sessionAutosave.pending(), true);
    assert.equal(
      loadPlayerSessionWal(storage, v1Key, {
        writerId: 'version-transition-tab',
      }).session.profile.name,
      'Pending v1 Player',
    );

    assert.equal(workspace.executeDocument('Start Maker v2', ({ document }) => {
      document.metadata.summary = 'The first post-publication edit.';
    }), true);
    await workspace.playerSessionTransitionPromise;

    const promotedV2 = structuredClone(workspace.getDocument());
    const v2Key = `0xwallet::${promotedV2.version.versionId}`;
    assert.equal(promotedV2.version.number, 2);
    assert.notEqual(v2Key, v1Key);
    assert.equal(backend.current(v1Key).revision, 1);
    assert.equal(backend.current(v1Key).session.profile.name, 'Pending v1 Player');
    assert.equal(backend.current(v2Key).revision, 1);
    assert.equal(backend.current(v2Key).session.profile.name, 'Pending v1 Player');
    assert.equal(workspace.playerSessionKey, v2Key);
    assert.equal(workspace.playerPersistedRevision, 1);

    workspace.handlePlayerChange({
      target: {
        dataset: { action: 'player-profile-name' },
        value: 'Independent v2 Player',
      },
    });
    await workspace.sessionAutosave.flush();
    assert.equal(backend.current(v2Key).revision, 2);
    assert.equal(backend.current(v2Key).session.profile.name, 'Independent v2 Player');
    assert.equal(backend.current(v1Key).session.profile.name, 'Pending v1 Player');

    workspace.store.undo();
    await workspace.playerSessionTransitionPromise;
    assert.equal(workspace.getDocument().version.versionId, publishedV1.version.versionId);
    assert.equal(workspace.playerSessionKey, v1Key);
    assert.equal(workspace.playerPersistedRevision, 1);
    assert.equal(workspace.playerProfile.name, 'Pending v1 Player');

    workspace.handlePlayerChange({
      target: {
        dataset: { action: 'player-profile-name' },
        value: 'Independent v1 after Undo',
      },
    });
    await workspace.sessionAutosave.flush();
    assert.equal(backend.current(v1Key).revision, 2);
    assert.equal(backend.current(v1Key).session.profile.name, 'Independent v1 after Undo');
    assert.equal(backend.current(v2Key).session.profile.name, 'Independent v2 Player');

    workspace.store.redo();
    await workspace.playerSessionTransitionPromise;
    assert.equal(workspace.getDocument().version.versionId, promotedV2.version.versionId);
    assert.equal(workspace.playerSessionKey, v2Key);
    assert.equal(workspace.playerPersistedRevision, 2);
    assert.equal(workspace.playerProfile.name, 'Independent v2 Player');

    workspace.handlePlayerChange({
      target: {
        dataset: { action: 'player-profile-name' },
        value: 'Independent v2 after Redo',
      },
    });
    await workspace.sessionAutosave.flush();
    assert.equal(backend.current(v2Key).revision, 3);
    assert.equal(backend.current(v2Key).session.profile.name, 'Independent v2 after Redo');
    assert.equal(backend.current(v1Key).revision, 2);
    assert.equal(backend.current(v1Key).session.profile.name, 'Independent v1 after Undo');

    workspace.autosave.cancel();
    workspace.context.walletAddress = '';
    workspace.destroy();
  })
));

test('a failed Player session load during version transition is retryable and never locks context switching', async () => (
  withAnimationFrame(async () => {
    const storage = memoryStorage();
    const publishedV1 = createCharacterMakerV5Starter({
      makerId: 'player-session-transition-retry',
      name: 'Player Session Transition Retry',
    });
    const backend = playerSessionCasMapBackend();
    const sessionLoadKeys = [];
    const playerSaveErrors = [];
    let failNextSessionLoad = false;
    const workspace = createMakerWorkspace({
      callbacks: {
        onPlayerSaveError(error) {
          playerSaveErrors.push(error);
        },
      },
      draftRepository: restoredMakerRepository(publishedV1),
      walStorage: storage,
      playerWalWriterId: 'transition-retry-tab',
      async loadPlayerSessionRecord(key) {
        sessionLoadKeys.push(key);
        if (failNextSessionLoad) {
          failNextSessionLoad = false;
          throw new Error('simulated IndexedDB session read failure');
        }
        return backend.load(key);
      },
      savePlayerSessionRecord: (key, session, metadata) => backend.save(key, session, metadata),
    });
    await workspace.setContext({
      makerKey: '0xwallet:player-session-transition-retry',
      walletAddress: '0xwallet',
      document: publishedV1,
      publishedDocument: structuredClone(publishedV1),
      isPublished: true,
      assets: [],
    });

    failNextSessionLoad = true;
    assert.equal(workspace.executeDocument('Start retryable Maker v2', ({ document }) => {
      document.metadata.summary = 'Promote while the Player session database is unavailable.';
    }), true);
    await workspace.playerSessionTransitionPromise;

    const promotedV2 = structuredClone(workspace.getDocument());
    const v1Key = `0xwallet::${publishedV1.version.versionId}`;
    const v2Key = `0xwallet::${promotedV2.version.versionId}`;
    assert.notEqual(v2Key, v1Key);
    assert.deepEqual(sessionLoadKeys, [v1Key, v2Key]);
    assert.equal(workspace.playerSaveState, 'error');
    assert.equal(workspace.playerSaveErrorCode, 'PLAYER_SESSION_RESTORE_FAILED');
    assert.match(workspace.playerSaveError, /simulated IndexedDB session read failure/);
    assert.equal(workspace.playerSessionSwitchInProgress, false);
    assert.equal(workspace.contextSwitchInProgress, false);
    assert.equal(playerSaveErrors.length, 1);

    const retry = await workspace.retryPlayerSessionSave();
    assert.equal(retry.saved, true);
    assert.deepEqual(sessionLoadKeys, [v1Key, v2Key, v2Key]);
    assert.equal(workspace.playerSaveState, 'saved');
    assert.equal(workspace.playerSaveErrorCode, '');
    assert.equal(workspace.playerSessionSwitchInProgress, false);
    assert.equal(workspace.contextSwitchInProgress, false);
    assert.equal(backend.current(v2Key).revision, 1);

    workspace.autosave.cancel();
    const currentRevision = workspace.store.getState().revision;
    workspace.store.setSaveState('saved', 'Saved for context-switch assertion', {
      revision: currentRevision,
    });
    assert.equal(workspace.hasUnsavedChanges(), false);
    await workspace.setContext(null);
    assert.equal(workspace.context, null);
    assert.equal(workspace.contextSwitchInProgress, false);
    workspace.destroy();
  })
));

test('a newer Player WAL is restored and written back before it is cleared', async () => (
  withAnimationFrame(async () => {
    const storage = memoryStorage();
    const document = createCharacterMakerV5Starter({
      makerId: 'player-wal-recovery',
      name: 'Player WAL Recovery',
    });
    const sessionKey = `0xwallet::${document.version.versionId}`;
    const persisted = playerSession(document, {
      name: 'Persisted OC',
      memoryMd: '# Persisted memory',
    });
    const recovered = playerSession(document, {
      name: 'Recovered WAL OC',
      memoryMd: '# Newer synchronous WAL memory',
    });
    writePlayerSessionWal(storage, sessionKey, {
      revision: 7,
      session: recovered,
    }, {
      writerId: 'crashed-tab',
      updatedAt: 2_000,
    });
    const writes = [];
    const workspace = createMakerWorkspace({
      callbacks: {},
      draftRepository: restoredMakerRepository(document),
      walStorage: storage,
      loadPlayerSessionRecord: async () => ({
        session: persisted,
        savedAt: 1_000,
      }),
      async savePlayerSessionRecord(key, session) {
        assert.ok(
          loadPlayerSessionWal(storage, key),
          'the recovery WAL must remain until the durable write succeeds',
        );
        writes.push({ key, session: structuredClone(session) });
      },
    });

    await workspace.setContext({
      makerKey: '0xwallet:player-wal-recovery',
      walletAddress: '0xwallet',
      document,
      assets: [],
    });

    assert.equal(workspace.playerProfile.name, 'Recovered WAL OC');
    assert.equal(
      workspace.playerLivingContentDraft().memoryMd,
      '# Newer synchronous WAL memory',
    );
    assert.equal(writes.length, 1);
    assert.equal(writes[0].key, sessionKey);
    assert.equal(writes[0].session.profile.name, 'Recovered WAL OC');
    assert.equal(writes[0].session.livingContent.memoryMd, '# Newer synchronous WAL memory');
    assert.equal(loadPlayerSessionWal(storage, sessionKey), null);
    assert.equal(workspace.playerSessionRevision, 7);
    assert.equal(workspace.playerSaveState, 'saved');
    workspace.context.walletAddress = '';
    workspace.destroy();
  })
));

for (const [clockCase, walUpdatedAt] of [
  ['the same millisecond', 1_000],
  ['a clock rollback', 250],
]) {
  test(`Player WAL recovery uses baseRevision during ${clockCase} instead of wall-clock ordering`, async () => (
    withAnimationFrame(async () => {
      const storage = memoryStorage();
      const document = createCharacterMakerV5Starter({
        makerId: `player-wal-${clockCase.replaceAll(' ', '-')}`,
        name: `Player WAL ${clockCase}`,
      });
      const sessionKey = `0xwallet::${document.version.versionId}`;
      const persisted = playerSession(document, {
        name: 'Persisted Revision Four',
        memoryMd: '# Persisted revision four',
      });
      const recovered = playerSession(document, {
        name: 'Recovered Revision Five',
        memoryMd: '# Newer revision survives clock anomalies',
      });
      const backend = playerSessionCasBackend({
        sessionKey,
        session: persisted,
        revision: 4,
        baseRevision: 3,
        writerId: 'persisted-writer',
        savedAt: 1_000,
      });
      writePlayerSessionWal(storage, sessionKey, {
        revision: 5,
        baseRevision: 4,
        session: recovered,
      }, {
        writerId: 'crashed-writer',
        updatedAt: walUpdatedAt,
      });
      const workspace = createMakerWorkspace({
        callbacks: {},
        draftRepository: restoredMakerRepository(document),
        walStorage: storage,
        playerWalWriterId: 'recovery-writer',
        loadPlayerSessionRecord: (key) => backend.load(key),
        savePlayerSessionRecord: (key, session, metadata) => backend.save(key, session, metadata),
      });

      await workspace.setContext({
        makerKey: `0xwallet:player-wal-${clockCase.replaceAll(' ', '-')}`,
        walletAddress: '0xwallet',
        document,
        assets: [],
      });

      assert.equal(workspace.playerProfile.name, 'Recovered Revision Five');
      assert.equal(
        workspace.playerLivingContentDraft().memoryMd,
        '# Newer revision survives clock anomalies',
      );
      assert.equal(backend.current().revision, 5);
      assert.equal(backend.current().baseRevision, 4);
      assert.equal(backend.current().writerId, 'recovery-writer');
      assert.equal(backend.current().session.profile.name, 'Recovered Revision Five');
      assert.equal(listPlayerSessionWals(storage, sessionKey).length, 0);
      assert.equal(workspace.playerPersistedRevision, 5);
      assert.equal(workspace.playerSaveState, 'saved');
      workspace.context.walletAddress = '';
      workspace.destroy();
    })
  ));
}

test('a newer WAL for the wrong Maker version is cleared without replacing the valid persisted session', async () => (
  withAnimationFrame(async () => {
    const storage = memoryStorage();
    const document = createCharacterMakerV5Starter({
      makerId: 'player-wal-version-isolation',
      name: 'Player WAL Version Isolation',
    });
    const sessionKey = `0xwallet::${document.version.versionId}`;
    const persisted = playerSession(document, {
      name: 'Current Version OC',
      memoryMd: '# Current version memory',
    });
    const wrongVersion = playerSession(document, {
      name: 'Wrong Version OC',
      memoryMd: '# Must never be restored',
      makerVersionId: 'different-maker-version',
    });
    writePlayerSessionWal(storage, sessionKey, {
      revision: 9,
      session: wrongVersion,
    }, {
      writerId: 'old-version-tab',
      updatedAt: 2_000,
    });
    let writes = 0;
    const workspace = createMakerWorkspace({
      callbacks: {},
      draftRepository: restoredMakerRepository(document),
      walStorage: storage,
      loadPlayerSessionRecord: async () => ({
        session: persisted,
        savedAt: 1_000,
      }),
      async savePlayerSessionRecord() {
        writes += 1;
      },
    });

    await workspace.setContext({
      makerKey: '0xwallet:player-wal-version-isolation',
      walletAddress: '0xwallet',
      document,
      assets: [],
    });

    assert.equal(workspace.playerProfile.name, 'Current Version OC');
    assert.equal(workspace.playerLivingContentDraft().memoryMd, '# Current version memory');
    assert.doesNotMatch(workspace.playerLivingContentDraft().memoryMd, /Must never/);
    assert.equal(writes, 0, 'the invalid WAL must not be written into the current session');
    assert.equal(loadPlayerSessionWal(storage, sessionKey), null);
    workspace.context.walletAddress = '';
    workspace.destroy();
  })
));
