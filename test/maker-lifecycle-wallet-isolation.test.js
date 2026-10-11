import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import { createCharacterMakerV5Starter } from '../maker-v4.js';
import { createMakerWorkspace } from '../maker-workspace.js';

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

function sourceFunction(source, name, nextDeclaration) {
  const start = source.indexOf(`${name}(`);
  const end = source.indexOf(`\n${nextDeclaration}`, start);
  assert.ok(start >= 0 && end > start, `could not isolate ${name}`);
  return source.slice(start, end);
}

function lifecycleBinding({
  ownerWallet,
  rootMakerId = 'wallet-root',
  makerObjectId = '0x1111',
} = {}) {
  return {
    schema: 'animacraft.chain-binding.v1',
    rootMakerId,
    ownerWallet,
    makerObjectId,
    makerTreasuryObjectId: '0x2222',
    makerAdminCapObjectId: '0x3333',
    publishDigest: 'digest-one',
    archived: false,
    mintingEnabled: true,
    mintFeeEnabled: false,
    mintPriceAtomic: 0,
    royaltyBps: 200,
    pausedEconomics: null,
    publishedVersions: [{
      rootMakerId,
      versionId: `${rootMakerId}-v1`,
      versionNumber: 1,
      makerObjectId,
      makerTreasuryObjectId: '0x2222',
      makerAdminCapObjectId: '0x3333',
      publishDigest: 'digest-one',
      archived: false,
      mintingEnabled: true,
      mintFeeEnabled: false,
      mintPriceAtomic: 0,
      royaltyBps: 200,
      current: true,
    }],
  };
}

test('Workspace refuses to persist wallet A chain authority in wallet B context', async () => (
  withAnimationFrame(async () => {
    const walletA = '0xaaa';
    const walletB = '0xbbb';
    const makerId = 'wallet-root';
    const makerKey = `${walletB}:${makerId}`;
    const document = createCharacterMakerV5Starter({
      makerId,
      name: 'Wallet isolation fixture',
    });
    let persisted = null;
    const repository = {
      async load(requestedMakerKey) {
        assert.equal(requestedMakerKey, makerKey);
        return null;
      },
      async save(requestedMakerKey, snapshot) {
        assert.equal(requestedMakerKey, makerKey);
        persisted = structuredClone(snapshot);
        return {
          confirmed: true,
          conflict: false,
          persistedRevision: snapshot.revision,
          savedAt: 1_000,
        };
      },
      async flush() {},
      getStatus() {
        return {
          persistedRevision: persisted?.revision ?? null,
          savedAt: persisted ? 1_000 : null,
        };
      },
    };
    const workspace = createMakerWorkspace({
      callbacks: {},
      draftRepository: repository,
      walStorage: null,
      loadPlayerSessionRecord: async () => null,
      savePlayerSessionRecord: async () => {},
    });

    await workspace.setContext({
      makerKey,
      walletAddress: walletB,
      document,
      recipe: document.defaultRecipe,
      chainBinding: lifecycleBinding({ ownerWallet: walletA, rootMakerId: makerId }),
    });
    workspace.executeDocument('Trigger wallet-isolated persistence', ({ document: next }) => {
      next.metadata.summary = 'Saved only in wallet B without wallet A authority.';
    });
    const result = await workspace.save();

    assert.equal(result.confirmed, true);
    assert.equal(
      persisted.metadata.chainBinding,
      null,
      'a stale chain binding must not cross the wallet boundary even if the caller passes it',
    );
    assert.equal(persisted.metadata.walletAddress, walletB);
    workspace.destroy();
  })
));

test('Workspace keeps a chain binding when its owner and root match the active context', async () => (
  withAnimationFrame(async () => {
    const wallet = '0xaaa';
    const makerId = 'wallet-root';
    const makerKey = `${wallet}:${makerId}`;
    const document = createCharacterMakerV5Starter({
      makerId,
      name: 'Same-wallet fixture',
    });
    let persisted = null;
    const repository = {
      async load() {
        return null;
      },
      async save(_makerKey, snapshot) {
        persisted = structuredClone(snapshot);
        return {
          confirmed: true,
          conflict: false,
          persistedRevision: snapshot.revision,
          savedAt: 1_000,
        };
      },
      async flush() {},
      getStatus() {
        return {
          persistedRevision: persisted?.revision ?? null,
          savedAt: persisted ? 1_000 : null,
        };
      },
    };
    const workspace = createMakerWorkspace({
      callbacks: {},
      draftRepository: repository,
      walStorage: null,
      loadPlayerSessionRecord: async () => null,
      savePlayerSessionRecord: async () => {},
    });

    await workspace.setContext({
      makerKey,
      walletAddress: wallet,
      document,
      recipe: document.defaultRecipe,
      chainBinding: lifecycleBinding({ ownerWallet: wallet, rootMakerId: makerId }),
    });
    workspace.executeDocument('Trigger same-wallet persistence', ({ document: next }) => {
      next.metadata.summary = 'Same-wallet authority remains durable.';
    });
    await workspace.save();

    assert.equal(persisted.metadata.chainBinding.ownerWallet, wallet);
    assert.equal(persisted.metadata.chainBinding.rootMakerId, makerId);
    assert.equal(persisted.metadata.chainBinding.makerObjectId, '0x1111');
    workspace.destroy();
  })
));

test('a non-owner Player can use the published document without creating a Creator draft', async () => (
  withAnimationFrame(async () => {
    const walletB = '0xbbb';
    const makerId = 'wallet-root';
    const document = createCharacterMakerV5Starter({
      makerId,
      name: 'Published Player fixture',
    });
    document.version.createdAt = '2026-07-28T00:00:00.000Z';
    let repositoryReads = 0;
    let repositoryWrites = 0;
    const workspace = createMakerWorkspace({
      callbacks: {},
      draftRepository: {
        async load() {
          repositoryReads += 1;
          return null;
        },
        async save() {
          repositoryWrites += 1;
          throw new Error('public Player must not save a Creator draft');
        },
        async flush() {},
      },
      walStorage: null,
      loadPlayerSessionRecord: async () => null,
      savePlayerSessionRecord: async () => {},
    });

    await workspace.setContext({
      makerKey: `public:${makerId}:0x1111`,
      walletAddress: walletB,
      creatorPersistenceEnabled: false,
      isPublished: true,
      document,
      publishedDocument: document,
      recipe: document.defaultRecipe,
      playerRecipe: document.defaultRecipe,
      chainBinding: null,
    });

    assert.equal(repositoryReads, 0);
    assert.equal(repositoryWrites, 0);
    assert.equal(
      workspace.executeDocument('Attempt public mutation', ({ document: next }) => {
        next.metadata.name = 'Leaked private successor';
      }),
      false,
    );
    assert.equal(await workspace.save(), null);
    const flushed = await workspace.flushPendingChanges({ reason: 'public-player-test' });
    assert.equal(flushed.creatorPersistenceSkipped, true);
    assert.equal(repositoryReads, 0);
    assert.equal(repositoryWrites, 0);
    workspace.destroy();
  })
));

test('currentWorkspaceChainBinding cannot relabel wallet A chain state as wallet B', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  const source = sourceFunction(
    app,
    'function currentWorkspaceChainBinding',
    'function revokeLocalMakerCoverObjectUrl',
  );
  const walletA = '0xaaa';
  const walletB = '0xbbb';
  const template = {
    id: 'wallet-root',
    owner: walletA,
    objectId: '0x1111',
    treasuryId: '0x2222',
    adminCapId: '0x3333',
    mintingEnabled: true,
    mintFeeEnabled: false,
    mintPriceAtomic: 0,
    royaltyBps: 200,
    pausedEconomics: null,
  };
  const state = {
    walletAddress: walletB,
    makerObjectId: template.objectId,
    makerTreasuryObjectId: template.treasuryId,
    makerAdminCapObjectId: template.adminCapId,
    publishDigest: 'digest-one',
    makerArchived: false,
  };
  const currentWorkspaceChainBinding = runInNewContext(`(${source})`, {
    state,
    activeTemplate: () => template,
    templateIsOwnedByWallet: (candidate) => (
      String(candidate?.owner || '').toLowerCase()
      === String(state.walletAddress || '').toLowerCase()
    ),
    currentMakerV4Source: () => null,
    suiJsonId: (value) => String(value || ''),
    currentPublishedMakerVersionRecord: () => null,
    makerModels: new Map(),
    publishedMakerVersionHistory: () => [],
    mergePublishedMakerVersions: (sources) => sources.flat().filter(Boolean),
    normalizedWorkspacePausedEconomics: () => null,
  });
  const document = {
    version: {
      rootMakerId: template.id,
    },
  };

  assert.equal(
    currentWorkspaceChainBinding(document),
    null,
    'wallet B must never receive a chain binding assembled from wallet A template state',
  );

  state.walletAddress = walletA;
  const sameWallet = currentWorkspaceChainBinding(document);
  assert.equal(sameWallet.ownerWallet, walletA);
  assert.equal(sameWallet.rootMakerId, template.id);
});

test('wallet switching preserves public play but only from the immutable published snapshot', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  const publicActivation = sourceFunction(
    app,
    'function activatePublishedMakerForPlayer',
    'async function flushActiveMakerBeforeWalletChange',
  );
  assert.match(
    publicActivation,
    /model\.publishedMakerDocumentV4[\s\S]*?makerDocumentV4:\s*structuredClone\(publishedDocument\)/,
  );
  assert.match(publicActivation, /makerAdminCapObjectId:\s*''/);
  assert.match(publicActivation, /template\.owned = false/);

  const walletTransition = sourceFunction(
    app,
    'async function applyWalletConnection',
    'let walletConnectionApplyQueue',
  );
  assert.match(
    walletTransition,
    /state\.page === 'make'[\s\S]*?activatePublishedMakerForPlayer\(currentTemplate\.id\)/,
    'a Player already using the Maker stays on its immutable published version',
  );
  assert.match(
    walletTransition,
    /state\.pendingWalletPage === 'make'[\s\S]*?activatePublishedMakerForPlayer\(pendingTemplate\.id\)/,
    'a newly connected non-owner can still enter a public Maker',
  );
  assert.match(
    walletTransition,
    /currentTemplate\?\.owner[\s\S]*?!templateIsOwnedByWallet\(currentTemplate, connection\.address\)/,
    'Creator-owned state from the previous wallet must still be isolated',
  );
});

test('fresh owned chain hydration records the wallet owner and retains every immutable version', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  const hydration = app.slice(
    app.indexOf('async function hydrateChainMaker'),
    app.indexOf('\nasync function loadChainMakers'),
  );
  const assignment = hydration.slice(
    hydration.indexOf('Object.assign(template,'),
    hydration.indexOf('if (!templates.includes(template))'),
  );
  assert.match(
    assignment,
    /owner:\s*object\.owned\s*\?[\s\S]{0,100}state\.walletAddress/,
    'a fresh owned chain card must record the connected wallet before later versions hydrate',
  );
  assert.match(
    hydration,
    /setPublishedMakerVersionHistory\(template,\s*\[[\s\S]*?publishedMakerVersionHistory\(template\),[\s\S]*?chainVersionRecord/,
    'each hydrated immutable object must merge into the stable root history',
  );

  const helperStart = app.indexOf('function normalizedPublishedMakerVersion(');
  const helperEnd = app.indexOf('\nfunction currentPublishedMakerVersionRecord', helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart);
  const helpers = runInNewContext(`(() => {
    ${app.slice(helperStart, helperEnd)}
    return { mergePublishedMakerVersions };
  })()`, {
    suiJsonId: (value) => String(value || ''),
    safeDraftText: (value, fallback = '') => String(value || fallback),
    normalizedWorkspacePausedEconomics: () => null,
    normalizedMakerUpdatedAtMs: (value) => String(value || ''),
    pausedEconomicsForLiveMaker: () => null,
    comparableSuiId: (value) => String(value || '').toLowerCase(),
  });
  const versions = [
    {
      rootMakerId: 'wallet-root',
      versionId: 'wallet-root-v1',
      versionNumber: 1,
      makerObjectId: '0x1111',
      current: false,
    },
    {
      rootMakerId: 'wallet-root',
      versionId: 'wallet-root-v2',
      versionNumber: 2,
      makerObjectId: '0x2222',
      current: true,
    },
  ];
  const forward = helpers.mergePublishedMakerVersions(versions, {
    rootMakerId: 'wallet-root',
    currentMakerObjectId: '0x2222',
  });
  const reverse = helpers.mergePublishedMakerVersions(versions.toReversed(), {
    rootMakerId: 'wallet-root',
    currentMakerObjectId: '0x2222',
  });

  assert.deepEqual(
    JSON.parse(JSON.stringify(forward)),
    JSON.parse(JSON.stringify(reverse)),
    'history order must not depend on asynchronous hydration completion order',
  );
  assert.deepEqual(
    [...forward].map((entry) => entry.versionId),
    ['wallet-root-v2', 'wallet-root-v1'],
  );
  assert.equal(forward.filter((entry) => entry.current).length, 1);
});

test('Workspace explicit null pause snapshot and empty AdminCap override stale local recovery state', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  const source = sourceFunction(
    app,
    'async function recoverStableMakerIndex',
    'function currentDraftRecoveryRecord',
  );
  const owner = '0xaaa';
  const makerId = 'wallet-root';
  const oldPauseSnapshot = {
    makerObjectId: '0x1111',
    mintFeeEnabled: true,
    mintPriceAtomic: 2_500_000,
    royaltyBps: 300,
    makerUpdatedAtMs: '100',
    capturedAt: '2026-07-28T00:00:00.000Z',
  };
  const document = {
    version: {
      rootMakerId: makerId,
      versionId: `${makerId}-v2`,
      number: 2,
    },
    metadata: {
      name: 'Recovered Maker',
      creator: 'Creator',
      style: 'Fixture',
      summary: 'Recovery fixture.',
      license: {
        kind: 'personal-use',
        note: 'Fixture.',
      },
    },
    publication: {
      royaltyBps: 200,
      mintingEnabled: true,
      mintFeeEnabled: false,
      mintPriceAtomic: 0,
    },
    canvas: {
      width: 1024,
      height: 1024,
    },
    defaultRecipe: {},
  };
  const chainBinding = {
    ...lifecycleBinding({ ownerWallet: owner, rootMakerId: makerId }),
    makerAdminCapObjectId: '',
    pausedEconomics: null,
  };
  const template = {
    id: makerId,
    source: 'chain',
    owner,
    owned: true,
    objectId: '0x1111',
    treasuryId: '0x2222',
    adminCapId: '0xstale',
    pausedEconomics: structuredClone(oldPauseSnapshot),
    publishedVersions: [],
    chainBindingPinned: true,
  };
  const model = {
    makerDocumentV4: structuredClone(document),
    makerRecipeV4: {},
    publishedMakerDocumentV4: null,
    publishedMakerRecipeV4: null,
    publishDigest: '',
    makerObjectId: '0x1111',
    makerTreasuryObjectId: '0x2222',
    makerAdminCapObjectId: '0xstale',
    makerArchived: false,
    pausedEconomics: structuredClone(oldPauseSnapshot),
    publishedMakerVersions: [],
  };
  const templates = [template];
  const makerModels = new Map([[makerId, model]]);
  const state = {
    walletAddress: owner,
    templateId: makerId,
    draftSaveStatus: '',
    draftSaveMessage: '',
  };
  const recoverStableMakerIndex = runInNewContext(`(${source})`, {
    state,
    makerWorkspace: {
      async listDraftProjects({ walletAddress }) {
        assert.equal(walletAddress, owner);
        return [{
          makerKey: `${owner}:${makerId}`,
          document: structuredClone(document),
          metadata: {
            rootMakerId: makerId,
            walletAddress: owner,
            chainBinding: structuredClone(chainBinding),
          },
        }];
      },
    },
    loadedStableMakerIndexes: new Set(),
    safeDraftText: (value, fallback = '') => String(value || fallback),
    isSafeKey: (value) => Boolean(value),
    normalizedWorkspaceChainBinding: (metadata) => structuredClone(metadata.chainBinding),
    normalizedWorkspacePublishedSnapshot: () => null,
    pausedEconomicsWithRecoveredLocalWitness: (durable) => durable ?? null,
    templates,
    comparableSuiId: (value) => String(value || '').toLowerCase(),
    makerModels,
    createMakerModel: () => ({}),
    isMakerV4Document: (value) => Boolean(value?.version?.rootMakerId),
    cloneV4Recipe: (value) => structuredClone(value),
    mergePublishedMakerVersions: (sources) => sources.flat().filter(Boolean),
    persistLocalMakerIndex: () => {},
    renderAll: () => {},
    restoreLocalMakerCoversFromV6: async () => {},
    creatorLicenseLabels: {
      'personal-use': 'Personal use',
    },
    shortAddress: (value) => String(value || ''),
    structuredClone,
    console,
    t: (key) => key,
    renderMakerLifecycle: () => {},
  });

  await recoverStableMakerIndex(owner);

  assert.equal(
    template.pausedEconomics,
    null,
    'explicit Workspace null means Resume completed and must clear stale local pause economics',
  );
  assert.equal(
    model.pausedEconomics,
    null,
    'the editor model must receive the same explicit pause-snapshot clear',
  );
  assert.equal(
    template.adminCapId,
    '',
    'an explicit empty cap invalidates a stale local authority hint',
  );
  assert.equal(model.makerAdminCapObjectId, '');
});

test('local Maker index quota failures remain best-effort and cannot block Workspace lifecycle saves', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  const source = sourceFunction(
    app,
    'function persistLocalMakerIndex',
    'function loadLocalMakerIndex',
  );
  const owner = '0xaaa';
  let warning = '';
  const persistLocalMakerIndex = runInNewContext(`(${source})`, {
    state: { walletAddress: owner },
    templates: [{
      id: 'durable-maker',
      owner,
      source: 'chain',
      objectId: '0x1111',
      name: 'Durable Maker',
      category: 'daily',
      creator: 'Creator',
      style: 'Portrait',
      license: 'Personal use',
      royaltyBps: 200,
      mintingEnabled: false,
      mintFeeEnabled: true,
      mintPriceAtomic: 123,
      price: '123',
      accent: '#000000',
      secondary: '#ffffff',
      summary: 'Lifecycle witness fixture',
      licenseNote: 'Fixture',
      pausedEconomics: { makerObjectId: '0x1111' },
    }],
    makerModels: new Map([['durable-maker', {
      makerObjectId: '0x1111',
      makerTreasuryObjectId: '0x2222',
      makerAdminCapObjectId: '0x3333',
      publishDigest: 'digest',
      makerArchived: false,
    }]]),
    suiJsonId: (value) => String(value || ''),
    safeDraftText: (value, fallback = '') => String(value || fallback),
    normalizedWorkspacePausedEconomics: (value) => value,
    publishedMakerVersionHistory: () => [],
    stableMakerCoverUrl: (value) => String(value || ''),
    localMakerIndexKey: (value) => `index:${value}`,
    localStorage: {
      setItem() {
        const error = new Error('Quota exceeded');
        error.name = 'QuotaExceededError';
        throw error;
      },
    },
    console: {
      warn(message) {
        warning = message;
      },
    },
  });

  assert.doesNotThrow(() => {
    assert.equal(persistLocalMakerIndex(owner), false);
  });
  assert.match(warning, /local Maker index/);
});
