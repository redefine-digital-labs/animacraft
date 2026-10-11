import assert from 'node:assert/strict';
import test from 'node:test';

import { createCharacterMakerV5Starter, createMakerV5Document } from '../maker-v4.js';
import { createItem, createStyle, synchronizeDefaultRecipe } from '../maker-document-ops.js';
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
    // Workspace teardown intentionally flushes pending persistence without
    // blocking navigation. Keep the test frame shim alive through that turn.
    await new Promise((resolve) => setTimeout(resolve, 0));
    globalThis.requestAnimationFrame = previous;
  }
}

function addRemoteStyleAsset(document, style, assetId) {
  style.assetId = assetId;
  style.positionConfirmed = true;
  document.assets.push({
    id: assetId,
    identifier: `${assetId}.png`,
    kind: 'layer',
    mediaType: 'image/png',
    width: 1024,
    height: 1024,
    url: `https://assets.example/${assetId}.png`,
  });
}

function publishableStarter(makerId) {
  const document = createCharacterMakerV5Starter({
    makerId,
    name: 'Rule Preflight Fixture',
    creator: 'Test Creator',
  });
  document.metadata.license.note = 'Test-only fixture.';
  document.parts.forEach((part) => {
    part.items.forEach((item) => item.styles.forEach((style) => {
      addRemoteStyleAsset(document, style, `${part.id}-${item.id}-${style.id}-asset`);
    }));
  });
  synchronizeDefaultRecipe(document);
  return document;
}

test('same-key context replaces an early shell with the restored v5 draft', async () => withAnimationFrame(async () => {
  const workspace = createMakerWorkspace({ callbacks: {} });
  const shell = createMakerV5Document({ makerId: 'restore-race', name: 'Early shell' });
  const restored = createCharacterMakerV5Starter({ makerId: 'restore-race', name: 'Restored Maker' });

  await workspace.setContext({ makerKey: 'wallet:restore-race', walletAddress: '', document: shell });
  await workspace.setContext({
    makerKey: 'wallet:restore-race',
    walletAddress: '',
    document: restored,
    replaceDocument: true,
  });

  const result = workspace.getDocument();
  assert.equal(result.metadata.name, 'Restored Maker');
  assert.equal(result.parts.length, 8);
  assert.ok(result.parts.every((part) => part.items[0].styles.length === 1));
  assert.ok(result.parts.every((part) => part.items[0].defaultStyleId === part.items[0].styles[0].id));
  workspace.destroy();
}));

test('same-key chain successor rebind replaces document, recipe and assets before the next version is saved', async () => withAnimationFrame(async () => {
  const makerKey = '0xcreator:successor-rebind';
  const walletAddress = '0xcreator';
  const v1 = createCharacterMakerV5Starter({
    makerId: 'successor-rebind',
    name: 'Successor v1',
  });
  const v1Style = v1.parts[0].items[0].styles[0];
  addRemoteStyleAsset(v1, v1Style, 'v1-style-png');
  synchronizeDefaultRecipe(v1);

  const v2 = structuredClone(v1);
  v2.metadata.name = 'Successor v2';
  v2.version = {
    ...v2.version,
    number: 2,
    parentVersionId: v1.version.versionId,
    versionId: 'successor-rebind-v2',
    createdAt: '2026-07-28T02:00:00.000Z',
  };
  const v2Style = v2.parts[0].items[0].styles[0];
  v2Style.assetId = 'v2-style-png';
  v2.assets = [{
    id: 'v2-style-png',
    identifier: 'v2-style-png.png',
    kind: 'layer',
    mediaType: 'image/png',
    width: 1024,
    height: 1024,
    url: 'https://assets.example/v2-style-png.png',
  }];
  synchronizeDefaultRecipe(v2);

  let persistedRevision = null;
  let persistedSnapshot = null;
  const repository = {
    async load() {
      return null;
    },
    async save(requestedMakerKey, snapshot) {
      assert.equal(requestedMakerKey, makerKey);
      persistedRevision = snapshot.revision;
      persistedSnapshot = structuredClone(snapshot);
      return {
        confirmed: true,
        conflict: false,
        persistedRevision,
        savedAt: 1_000,
      };
    },
    async flush() {},
    getStatus() {
      return {
        persistedRevision,
        latestRequestedRevision: persistedRevision,
        savedAt: persistedRevision === null ? null : 1_000,
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
    walletAddress,
    document: v1,
    recipe: v1.defaultRecipe,
    isPublished: true,
    publishedDocument: v1,
    publishedRecipe: v1.defaultRecipe,
    assets: [{
      assetId: 'v1-style-png',
      url: 'https://assets.example/v1-style-png.png',
    }],
  });
  await workspace.setContext({
    makerKey,
    walletAddress,
    document: v2,
    recipe: v2.defaultRecipe,
    isPublished: true,
    publishedDocument: v2,
    publishedRecipe: v2.defaultRecipe,
    assets: [{
      assetId: 'v2-style-png',
      url: 'https://assets.example/v2-style-png.png',
    }],
    replaceDocument: true,
  });

  assert.equal(workspace.getDocument().version.versionId, 'successor-rebind-v2');
  const reboundAssets = workspace.getPlayerSnapshot().assets;
  assert.equal(reboundAssets.has('v2-style-png'), true);
  assert.equal(reboundAssets.has('v1-style-png'), false);

  const saved = await workspace.save({ automatic: false, force: true });
  assert.equal(saved.confirmed, true);
  assert.equal(persistedSnapshot.document.version.versionId, 'successor-rebind-v2');
  assert.deepEqual(
    persistedSnapshot.assets.map((asset) => asset.assetId),
    ['v2-style-png'],
  );

  assert.equal(workspace.beginNextVersion(), true);
  const v3 = workspace.getDocument();
  assert.equal(v3.version.number, 3);
  assert.equal(v3.version.parentVersionId, 'successor-rebind-v2');
  await workspace.save({ automatic: false });
  workspace.destroy();
}));

test('remote-backed drafts preserve readable URLs across restore, save, and Player handoff', async () => withAnimationFrame(async () => {
  const makerKey = '0xcreator:remote-backed';
  const walletAddress = '0xcreator';
  const document = createCharacterMakerV5Starter({
    makerId: 'remote-backed',
    name: 'Remote-backed Maker',
  });
  const style = document.parts[0].items[0].styles[0];
  style.assetId = 'remote-layer';
  style.positionConfirmed = true;
  document.assets.push({
    id: style.assetId,
    identifier: 'remote-layer.png',
    kind: 'layer',
    mediaType: 'image/png',
    width: 1024,
    height: 1024,
  });
  const savedDocument = structuredClone(document);
  let savedSnapshot = null;
  const repository = {
    async load(requestedMakerKey) {
      assert.equal(requestedMakerKey, makerKey);
      return {
        makerKey,
        revision: 0,
        document: structuredClone(savedDocument),
        recipe: structuredClone(savedDocument.defaultRecipe),
        // Legacy saves could contain metadata but no Blob or stable URL.
        assets: [{ assetId: style.assetId, url: '', thumbnailUrl: '', source: 'remote' }],
        metadata: {},
        savedAt: 123,
      };
    },
    async save(requestedMakerKey, snapshot) {
      assert.equal(requestedMakerKey, makerKey);
      savedSnapshot = structuredClone(snapshot);
      return {
        confirmed: true,
        conflict: false,
        persistedRevision: snapshot.revision,
        savedAt: 456,
      };
    },
    async flush() {
      return { persistedRevision: savedSnapshot?.revision ?? 0 };
    },
    getStatus() {
      return { persistedRevision: savedSnapshot?.revision ?? 0, savedAt: 456 };
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
    walletAddress,
    document,
    assets: [{
      assetId: style.assetId,
      identifier: 'remote-layer.png',
      url: 'https://assets.example/remote-layer.png',
      source: 'remote',
    }],
  });

  assert.equal(
    workspace.runtimeAsset(style.assetId).url,
    'https://assets.example/remote-layer.png',
    'an incomplete legacy asset record must not replace the readable manifest source',
  );
  workspace.executeDocument('Rename remote-backed Maker', ({ document: next }) => {
    next.metadata.name = 'Saved remote-backed Maker';
  });
  const result = await workspace.save();
  assert.equal(result.confirmed, true);
  assert.equal(
    savedSnapshot.assets.find((asset) => asset.assetId === style.assetId).url,
    'https://assets.example/remote-layer.png',
    'stable remote URLs must remain in the persisted draft',
  );
  workspace.destroy();
}));

test('Workspace refresh preserves the published chain binding and immutable predecessor snapshot', async () => withAnimationFrame(async () => {
  const makerKey = '0xcreator:stable-root';
  const walletAddress = '0xcreator';
  const published = createCharacterMakerV5Starter({
    makerId: 'stable-root',
    name: 'Published v1',
  });
  const successor = structuredClone(published);
  successor.version = {
    ...successor.version,
    versionId: 'stable-root-v2',
    number: 2,
    parentVersionId: published.version.versionId,
    createdAt: null,
  };
  let persisted = null;
  const repository = {
    async load(requestedMakerKey) {
      assert.equal(requestedMakerKey, makerKey);
      return persisted ? structuredClone(persisted) : null;
    },
    async save(requestedMakerKey, snapshot) {
      assert.equal(requestedMakerKey, makerKey);
      persisted = {
        makerKey,
        revision: snapshot.revision,
        document: structuredClone(snapshot.document),
        recipe: structuredClone(snapshot.recipe),
        assets: structuredClone(snapshot.assets || []),
        metadata: structuredClone(snapshot.metadata || {}),
        savedAt: 1_000 + snapshot.revision,
      };
      return {
        confirmed: true,
        conflict: false,
        persistedRevision: snapshot.revision,
        savedAt: persisted.savedAt,
      };
    },
    async flush() {},
    getStatus() {
      return {
        persistedRevision: persisted?.revision ?? null,
        savedAt: persisted?.savedAt ?? null,
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
  const firstBinding = {
    rootMakerId: 'stable-root',
    ownerWallet: walletAddress,
    makerObjectId: '0x1111',
    makerTreasuryObjectId: '0x2222',
    makerAdminCapObjectId: '0x3333',
    publishDigest: 'digest-one',
    pausedEconomics: {
      makerObjectId: '0x1111',
      mintFeeEnabled: true,
      mintPriceAtomic: 42,
      royaltyBps: 300,
      makerUpdatedAtMs: '100',
      pendingMutation: {
        digest: 'pause-digest',
        kind: 'pause',
        expectedMintingEnabled: false,
        expectedArchived: false,
        createdAt: '2026-07-28T00:01:00.000Z',
      },
      capturedAt: '2026-07-28T00:00:00.000Z',
    },
    publishedVersions: [
      {
        rootMakerId: 'stable-root',
        versionId: 'stable-root-v1',
        parentVersionId: '',
        versionNumber: 1,
        makerObjectId: '0x1111',
        makerTreasuryObjectId: '0x2222',
        makerAdminCapObjectId: '0x3333',
        publishDigest: 'digest-one',
        makerPreviousTransaction: 'pause-digest',
        archived: false,
        mintingEnabled: true,
        mintFeeEnabled: true,
        mintPriceAtomic: 42,
        royaltyBps: 300,
        current: true,
      },
      {
        rootMakerId: 'stable-root',
        versionId: 'stable-root-v0',
        versionNumber: 0,
        makerObjectId: '0x0111',
        makerTreasuryObjectId: '0x0222',
        makerAdminCapObjectId: '0x0333',
        publishDigest: 'digest-zero',
        archived: true,
        mintingEnabled: false,
        mintFeeEnabled: false,
        mintPriceAtomic: 0,
        royaltyBps: 100,
        current: false,
      },
    ],
  };
  await workspace.setContext({
    makerKey,
    walletAddress,
    document: successor,
    recipe: successor.defaultRecipe,
    publishedDocument: published,
    publishedRecipe: published.defaultRecipe,
    chainBinding: firstBinding,
  });
  assert.equal(persisted.metadata.chainBinding.makerObjectId, '0x1111');
  assert.equal(
    persisted.metadata.chainBinding.pausedEconomics.pendingMutation.digest,
    'pause-digest',
  );
  assert.deepEqual(
    persisted.metadata.chainBinding.publishedVersions.map((entry) => entry.versionId),
    ['stable-root-v1', 'stable-root-v0'],
  );
  assert.equal(persisted.metadata.publishedSnapshot.document.version.versionId, published.version.versionId);

  await workspace.setContext({
    makerKey,
    walletAddress,
    chainBinding: {
      ...firstBinding,
      makerObjectId: '0xaaaa',
      makerTreasuryObjectId: '0xbbbb',
      makerAdminCapObjectId: '0xcccc',
      pausedEconomics: {
        ...firstBinding.pausedEconomics,
        makerObjectId: '0xaaaa',
      },
    },
  });
  const metadataOnlySave = await workspace.save({ force: true });
  assert.equal(metadataOnlySave.confirmed, true);
  assert.equal(persisted.revision, 1, 'a metadata-only chain update must advance the durable revision');
  assert.equal(persisted.metadata.chainBinding.makerObjectId, '0xaaaa');
  assert.equal(persisted.metadata.chainBinding.pausedEconomics.mintPriceAtomic, 42);
  assert.equal(
    persisted.metadata.chainBinding.pausedEconomics.pendingMutation.kind,
    'pause',
  );
  assert.equal(
    persisted.metadata.chainBinding.publishedVersions[0].makerPreviousTransaction,
    'pause-digest',
  );
  workspace.destroy();

  let restoredPayload = null;
  const reloaded = createMakerWorkspace({
    callbacks: {
      onRestored(payload) {
        restoredPayload = payload;
      },
    },
    draftRepository: repository,
    walStorage: null,
    loadPlayerSessionRecord: async () => null,
    savePlayerSessionRecord: async () => {},
  });
  await reloaded.setContext({
    makerKey,
    walletAddress,
    document: successor,
    recipe: successor.defaultRecipe,
  });
  assert.equal(reloaded.getDocument().version.versionId, 'stable-root-v2');
  assert.equal(restoredPayload.metadata.chainBinding.makerObjectId, '0xaaaa');
  assert.equal(
    restoredPayload.metadata.chainBinding.pausedEconomics.pendingMutation.digest,
    'pause-digest',
  );
  assert.equal(restoredPayload.metadata.chainBinding.publishedVersions.length, 2);
  assert.equal(
    restoredPayload.metadata.chainBinding.publishedVersions[1].makerObjectId,
    '0x0111',
  );
  assert.equal(
    restoredPayload.metadata.publishedSnapshot.document.version.versionId,
    published.version.versionId,
  );
  reloaded.destroy();
}));

test('Player Expansion Pack choices restore by wallet and Maker version, then clear on Maker switch', async () => withAnimationFrame(async () => {
  const makerKey = 'wallet:session-expansions';
  const walletAddress = '0xplayer';
  const document = createCharacterMakerV5Starter({
    makerId: 'session-expansions',
    name: 'Session Expansions',
  });
  document.extensions.expansionDrafts = [
    { packId: 'moon-pack', name: 'Moon Pack' },
    { packId: 'costume-pack', name: 'Costume Pack' },
  ];
  const savedDocument = structuredClone(document);
  const repository = {
    async load(requestedMakerKey) {
      if (requestedMakerKey !== makerKey) return null;
      return {
        makerKey,
        revision: 0,
        document: structuredClone(savedDocument),
        recipe: structuredClone(savedDocument.defaultRecipe),
        assets: [],
        metadata: {},
        savedAt: 123,
      };
    },
    async save() {
      throw new Error('The restored fixture must not create a Maker revision.');
    },
    async flush() {
      return { persistedRevision: 0 };
    },
    getStatus() {
      return { persistedRevision: 0, savedAt: 123 };
    },
  };
  const sessionWrites = [];
  const restoredMemory = '# Restored player memory\n\nThis belongs only to the restored OC.';
  const workspace = createMakerWorkspace({
    callbacks: {},
    draftRepository: repository,
    walStorage: null,
    async loadPlayerSessionRecord(sessionKey) {
      assert.equal(sessionKey, `${walletAddress}::${document.version.versionId}`);
      return {
        session: {
          makerVersionId: document.version.versionId,
          recipe: structuredClone(document.defaultRecipe),
          profile: { name: 'Restored OC' },
          livingContent: {
            schemaVersion: 'animacraft.living-content.v1',
            soulMd: '# Restored Soul',
            memoryMd: restoredMemory,
            skillMd: '---\nname: restored-oc\n---\n# Restored skill',
            customized: {
              soulMd: true,
              memoryMd: true,
              skillMd: true,
            },
          },
          enabledExpansionIds: ['moon-pack', 'foreign-maker-pack'],
        },
        savedAt: 456,
      };
    },
    async savePlayerSessionRecord(sessionKey, session) {
      sessionWrites.push({ sessionKey, session: structuredClone(session) });
    },
  });

  await workspace.setContext({
    makerKey,
    walletAddress,
    document,
    assets: [],
  });

  assert.deepEqual([...workspace.enabledExpansionIds], ['moon-pack']);
  assert.equal(workspace.playerProfile.name, 'Restored OC');
  assert.equal(workspace.playerLivingContentDraft().memoryMd, restoredMemory);
  assert.equal(workspace.playerLivingContentDraft().customized.memoryMd, true);

  const autosavedMemory = '# Autosaved player memory\n\nThis survives reload.';
  workspace.handlePlayerChange({
    target: {
      dataset: { action: 'player-soul-document', soulKey: 'memoryMd' },
      value: autosavedMemory,
    },
  });
  await workspace.sessionAutosave.flush();
  assert.equal(sessionWrites[0].sessionKey, `${walletAddress}::${document.version.versionId}`);
  assert.deepEqual(sessionWrites[0].session.enabledExpansionIds, ['moon-pack']);
  assert.equal(sessionWrites[0].session.livingContent.memoryMd, autosavedMemory);
  assert.equal(sessionWrites[0].session.livingContent.customized.memoryMd, true);

  workspace.sessionAutosave();
  const otherMaker = createCharacterMakerV5Starter({
    makerId: 'other-session-maker',
    name: 'Other Session Maker',
  });
  await workspace.setContext({
    makerKey: 'wallet:other-session-maker',
    walletAddress: '',
    document: otherMaker,
    assets: [],
  });

  assert.equal(workspace.enabledExpansionIds.size, 0);
  assert.equal(workspace.playerLivingContentDraft().customized.memoryMd, false);
  assert.doesNotMatch(workspace.playerLivingContentDraft().memoryMd, /Autosaved player memory/);
  assert.ok(sessionWrites.length >= 2);
  assert.ok(sessionWrites.every((entry) => entry.sessionKey === `${walletAddress}::${document.version.versionId}`));
  assert.ok(sessionWrites.every((entry) => entry.session.enabledExpansionIds.length === 1));
  workspace.destroy();
}));

test('a delayed Player Soul restore for one wallet cannot contaminate the same Maker version in another wallet', async () => withAnimationFrame(async () => {
  let releaseWalletA;
  let reportWalletAStarted;
  const walletAStarted = new Promise((resolve) => {
    reportWalletAStarted = resolve;
  });
  const walletARelease = new Promise((resolve) => {
    releaseWalletA = resolve;
  });
  const document = createCharacterMakerV5Starter({
    makerId: 'shared-version-wallet-isolation',
    name: 'Shared Version Wallet Isolation',
  });
  const persistedDocument = structuredClone(document);
  const repository = {
    async load(makerKey) {
      return {
        makerKey,
        revision: 0,
        document: structuredClone(persistedDocument),
        recipe: structuredClone(persistedDocument.defaultRecipe),
        assets: [],
        metadata: {},
        savedAt: 123,
      };
    },
    async save() {
      throw new Error('A clean restored fixture must not create a Maker revision.');
    },
    async flush() {
      return { persistedRevision: 0 };
    },
    getStatus() {
      return { persistedRevision: 0, savedAt: 123 };
    },
  };
  const sessionFor = (name, memoryMd) => ({
    session: {
      makerVersionId: document.version.versionId,
      recipe: structuredClone(document.defaultRecipe),
      profile: { name },
      livingContent: {
        schemaVersion: 'animacraft.living-content.v1',
        soulMd: `# ${name}`,
        memoryMd,
        skillMd: `---\nname: ${name.toLowerCase()}\n---\n# ${name} skill`,
        customized: {
          soulMd: true,
          memoryMd: true,
          skillMd: true,
        },
      },
      enabledExpansionIds: [],
    },
    savedAt: 456,
  });
  const workspace = createMakerWorkspace({
    callbacks: {},
    draftRepository: repository,
    walStorage: null,
    async loadPlayerSessionRecord(sessionKey) {
      if (sessionKey === `0xwallet-a::${document.version.versionId}`) {
        reportWalletAStarted();
        await walletARelease;
        return sessionFor('Wallet A OC', '# Wallet A private memory');
      }
      if (sessionKey === `0xwallet-b::${document.version.versionId}`) {
        return sessionFor('Wallet B OC', '# Wallet B private memory');
      }
      throw new Error(`Unexpected Player session key: ${sessionKey}`);
    },
    async savePlayerSessionRecord() {
      throw new Error('No Player session is dirty in this restore-only fixture.');
    },
  });

  const openingWalletA = workspace.setContext({
    makerKey: '0xwallet-a:shared-version-wallet-isolation',
    walletAddress: '0xwallet-a',
    document,
    assets: [],
  });
  await walletAStarted;

  const openingWalletB = workspace.setContext({
    makerKey: '0xwallet-b:shared-version-wallet-isolation',
    walletAddress: '0xwallet-b',
    document,
    assets: [],
  });
  await openingWalletB;
  assert.equal(workspace.playerProfile.name, 'Wallet B OC');
  assert.equal(workspace.playerLivingContentDraft().memoryMd, '# Wallet B private memory');

  releaseWalletA();
  await openingWalletA;
  assert.equal(workspace.context.walletAddress, '0xwallet-b');
  assert.equal(workspace.playerProfile.name, 'Wallet B OC');
  assert.equal(
    workspace.playerLivingContentDraft().memoryMd,
    '# Wallet B private memory',
    'the late Wallet A session must be ignored after Wallet B becomes current',
  );
  assert.doesNotMatch(workspace.playerLivingContentDraft().memoryMd, /Wallet A/);
  workspace.context.walletAddress = '';
  workspace.destroy();
}));

test('preflight blocks a default Recipe that violates requires or excludes', async () => withAnimationFrame(async () => {
  const workspace = createMakerWorkspace({ callbacks: {} });
  const document = publishableStarter('default-rule-violation');
  const background = document.parts.find((part) => part.id === 'background');
  background.excludes = [{ partId: 'skin-base' }];

  await workspace.setContext({
    makerKey: 'wallet:default-rule-violation',
    walletAddress: '',
    document,
    assets: [],
  });

  const issues = workspace.getPublicationIssues();
  const defaultIssues = issues.filter((issue) => issue.code === 'default_recipe_rule_violation');
  assert.equal(defaultIssues.length, 1);
  assert.equal(defaultIssues[0].path, 'defaultRecipe');
  assert.match(defaultIssues[0].message, /excludes-rule/);
  assert.equal(issues.some((issue) => issue.code === 'unsatisfiable_maker_rules'), false);
  workspace.destroy();
}));

test('preflight blocks an invalid requires default even when another playable Recipe can repair it', async () => withAnimationFrame(async () => {
  const workspace = createMakerWorkspace({ callbacks: {} });
  const document = publishableStarter('default-requires-violation');
  const background = document.parts.find((part) => part.id === 'background');
  const accessory = document.parts.find((part) => part.id === 'accessory');
  const requiredItem = createItem(accessory, 'Required Charm');
  requiredItem.styles[0].layerTrackId = 'accessory-track';
  addRemoteStyleAsset(document, requiredItem.styles[0], 'required-charm-asset');
  accessory.items.push(requiredItem);
  background.requires = [{ partId: accessory.id, itemId: requiredItem.id }];

  await workspace.setContext({
    makerKey: 'wallet:default-requires-violation',
    walletAddress: '',
    document,
    assets: [],
  });

  const issues = workspace.getPublicationIssues();
  const defaultIssues = issues.filter((issue) => issue.code === 'default_recipe_rule_violation');
  assert.equal(defaultIssues.length, 1);
  assert.match(defaultIssues[0].message, /requires-rule/);
  assert.equal(issues.some((issue) => issue.code === 'unsatisfiable_maker_rules'), false);
  workspace.destroy();
}));

test('preflight blocks a Maker whose required Parts make the rule graph unsatisfiable', async () => withAnimationFrame(async () => {
  const workspace = createMakerWorkspace({ callbacks: {} });
  const document = publishableStarter('unsatisfiable-rule-graph');
  const skin = document.parts.find((part) => part.id === 'skin-base');
  skin.excludes = [{ partId: 'eyes' }];

  await workspace.setContext({
    makerKey: 'wallet:unsatisfiable-rule-graph',
    walletAddress: '',
    document,
    assets: [],
  });

  const issues = workspace.getPublicationIssues();
  const graphIssues = issues.filter((issue) => issue.code === 'unsatisfiable_maker_rules');
  assert.equal(graphIssues.length, 1);
  assert.equal(graphIssues[0].path, 'rules');
  assert.match(graphIssues[0].message, /No playable public Recipe/);
  workspace.destroy();
}));

test('preflight identifies rule-unreachable public Styles and Items without flagging reachable siblings', async () => withAnimationFrame(async () => {
  const workspace = createMakerWorkspace({ callbacks: {} });
  const document = publishableStarter('unreachable-public-options');
  const background = document.parts.find((part) => part.id === 'background');
  const reachableItem = background.items[0];

  const blockedStyle = createStyle(reachableItem, 'Blocked Style');
  blockedStyle.layerTrackId = document.layerTracks.find((track) => track.id === 'background-track').id;
  blockedStyle.requires = [{ partId: background.id, itemId: 'impossible-item' }];
  addRemoteStyleAsset(document, blockedStyle, 'blocked-style-asset');
  reachableItem.styles.push(blockedStyle);

  const unreachableItem = createItem(background, 'Impossible Item');
  unreachableItem.requires = [{ partId: background.id, itemId: reachableItem.id }];
  unreachableItem.styles[0].layerTrackId = 'background-track';
  addRemoteStyleAsset(document, unreachableItem.styles[0], 'impossible-item-asset');
  background.items.push(unreachableItem);

  await workspace.setContext({
    makerKey: 'wallet:unreachable-public-options',
    walletAddress: '',
    document,
    assets: [],
  });

  const issues = workspace.getPublicationIssues();
  const unreachableStyles = issues
    .filter((issue) => issue.code === 'unreachable_public_style_rules')
    .map((issue) => issue.path)
    .sort();
  assert.deepEqual(unreachableStyles, [
    `background/${reachableItem.id}/${blockedStyle.id}`,
    `background/${unreachableItem.id}/${unreachableItem.styles[0].id}`,
  ].sort());
  assert.deepEqual(
    issues.filter((issue) => issue.code === 'unreachable_public_item_rules').map((issue) => issue.path),
    [`background/${unreachableItem.id}`],
  );
  assert.equal(
    issues.some((issue) => (
      issue.code === 'unreachable_public_item_rules'
      && issue.path === `background/${reachableItem.id}`
    )),
    false,
  );
  assert.equal(issues.some((issue) => issue.code === 'unsatisfiable_maker_rules'), false);
  workspace.destroy();
}));

test('preflight reports one actionable missing runtime asset per public Style', async () => withAnimationFrame(async () => {
  const workspace = createMakerWorkspace({ callbacks: {} });
  const document = createCharacterMakerV5Starter({
    makerId: 'preflight-starter',
    name: 'Preflight Starter',
    creator: 'Test Creator',
  });
  document.metadata.license.note = 'Test-only fixture.';
  document.parts.forEach((part, index) => {
    const item = part.items[0];
    const style = item.styles[0];
    style.assetId = `${part.id}-asset`;
    style.layerTrackId = document.layerTracks[index].id;
    style.positionConfirmed = true;
    item.status = 'public';
    document.assets.push({
      id: style.assetId,
      identifier: `${style.assetId}.png`,
      kind: 'layer',
      mediaType: 'image/png',
      width: 1024,
      height: 1024,
    });
  });
  synchronizeDefaultRecipe(document);
  await workspace.setContext({ makerKey: 'wallet:preflight-starter', walletAddress: '', document, assets: [] });

  const issues = workspace.getPublicationIssues();
  const uploadIssues = issues.filter((issue) => issue.code === 'runtime_asset_missing');
  assert.equal(uploadIssues.length, 8);
  assert.deepEqual(uploadIssues.map((issue) => issue.path.split('/')[0]), document.parts.map((part) => part.id));
  assert.equal(issues.filter((issue) => issue.code === 'position_unconfirmed').length, 0);
  workspace.destroy();
}));

test('Creator player test can use renderable draft/private Items while the published Player only exposes public Items', async () => withAnimationFrame(async () => {
  const workspace = createMakerWorkspace({ callbacks: {} });
  const document = createCharacterMakerV5Starter({ makerId: 'visibility-boundary', name: 'Visibility Boundary' });
  const part = document.parts[0];
  const draftItem = part.items[0];
  const privateItem = createItem(part, 'Private Item');
  part.items.push(privateItem);
  const publicItem = createItem(part, 'Public Item');
  part.items.push(publicItem);
  const incompleteDraft = createItem(part, 'Incomplete Draft');
  part.items.push(incompleteDraft);

  [
    [draftItem, 'draft'],
    [privateItem, 'private'],
    [publicItem, 'public'],
  ].forEach(([item, status], index) => {
    item.status = status;
    const style = item.styles[0];
    style.name = `${status} Style`;
    style.assetId = `${status}-asset`;
    style.layerTrackId = document.layerTracks[index].id;
    style.positionConfirmed = true;
    document.assets.push({
      id: style.assetId,
      identifier: `${style.assetId}.png`,
      kind: 'layer',
      mediaType: 'image/png',
      width: 1024,
      height: 1024,
      url: `https://assets.example/${style.assetId}.png`,
    });
  });
  incompleteDraft.status = 'draft';
  incompleteDraft.styles[0].name = 'Missing PNG';
  part.defaultItemId = publicItem.id;
  synchronizeDefaultRecipe(document);

  await workspace.setContext({
    makerKey: 'wallet:visibility-boundary-draft',
    walletAddress: '',
    document,
    isPublished: false,
  });
  assert.deepEqual(
    workspace.playerVisibleItems(workspace.runtimeDocument().parts[0]).map((item) => item.status),
    ['draft', 'private', 'public'],
  );

  await workspace.setContext({
    makerKey: 'wallet:visibility-boundary-published',
    walletAddress: '',
    document,
    isPublished: true,
  });
  assert.deepEqual(
    workspace.playerVisibleItems(workspace.runtimeDocument().parts[0]).map((item) => item.status),
    ['public'],
  );
  workspace.destroy();
}));

test('every Creator Studio tool tab is selectable and invalid tabs fall back to Parts & Items', async () => withAnimationFrame(async () => {
  const workspace = createMakerWorkspace({ callbacks: {} });
  const document = createCharacterMakerV5Starter({ makerId: 'tool-tabs', name: 'Tool Tabs' });
  await workspace.setContext({ makerKey: 'wallet:tool-tabs', walletAddress: '', document, assets: [] });

  for (const tab of ['structure', 'info', 'layers', 'colors', 'rules', 'expansions', 'soul', 'validate']) {
    workspace.openCreatorTab(tab);
    assert.equal(workspace.creatorTab, tab);
  }

  workspace.openCreatorTab('not-a-tool');
  assert.equal(workspace.creatorTab, 'structure');
  workspace.destroy();
}));

test('Soul Markdown is an independent undoable Maker document edit', async () => withAnimationFrame(async () => {
  const workspace = createMakerWorkspace({ callbacks: {} });
  const document = createCharacterMakerV5Starter({ makerId: 'soul-text', name: 'Soul Text' });
  await workspace.setContext({ makerKey: 'wallet:soul-text', walletAddress: '', document, assets: [] });

  const memoryMarkdown = '# Maker memory\n\nThis memory belongs only to this Maker.';
  assert.equal(workspace.captureCreatorText({
    value: memoryMarkdown,
    dataset: { action: 'soul-document-content', soulKey: 'memoryMd' },
  }), true);
  assert.equal(workspace.flushPendingCreatorText(), true);
  assert.equal(workspace.getDocument().livingContent.memoryMd, memoryMarkdown);
  assert.equal(workspace.getDocument().livingContent.customized.memoryMd, true);
  assert.equal(workspace.store.getState().canUndo, true);

  workspace.store.undo();
  assert.equal(workspace.getDocument().livingContent, null);
  workspace.destroy();
}));

test('Draft Recovery commits an isolated v5 copy and verifies it before returning', async () => {
  const records = new Map();
  const calls = [];
  const repository = {
    async load(makerKey) {
      calls.push(`load:${makerKey}`);
      return records.has(makerKey) ? structuredClone(records.get(makerKey)) : null;
    },
    async save(makerKey, snapshot) {
      calls.push(`save:${makerKey}:${snapshot.revision}`);
      records.set(makerKey, {
        makerKey,
        revision: snapshot.revision,
        document: structuredClone(snapshot.document),
        recipe: structuredClone(snapshot.recipe),
        assets: structuredClone(snapshot.assets),
        metadata: structuredClone(snapshot.metadata),
        savedAt: 123,
      });
      return { confirmed: true, conflict: false, persistedRevision: snapshot.revision };
    },
    async flush(makerKey) {
      calls.push(`flush:${makerKey}`);
      return { persistedRevision: 0 };
    },
  };
  const workspace = createMakerWorkspace({ callbacks: {}, draftRepository: repository });
  const document = createCharacterMakerV5Starter({
    makerId: 'recovered-copy',
    name: 'Recovered Copy',
  });
  const assets = [{ assetId: 'recovery-png', blob: new Blob(['png'], { type: 'image/png' }) }];

  const recovered = await workspace.commitRecoveredDraftCopy({
    makerKey: 'wallet:recovered-copy',
    document,
    recipe: document.defaultRecipe,
    assets,
    metadata: { walletAddress: 'wallet' },
  });

  assert.equal(recovered.document.metadata.name, 'Recovered Copy');
  assert.equal(recovered.assets[0].assetId, 'recovery-png');
  assert.equal(recovered.metadata.recoveryCopy, true);
  assert.deepEqual(calls, [
    'load:wallet:recovered-copy',
    'save:wallet:recovered-copy:0',
    'flush:wallet:recovered-copy',
    'load:wallet:recovered-copy',
  ]);
  await assert.rejects(
    workspace.commitRecoveredDraftCopy({
      makerKey: 'wallet:recovered-copy',
      document,
      assets,
    }),
    /already exists/,
  );
  workspace.destroy();
});

test('Draft Recovery rejects a copy when persisted PNG bytes do not match', async () => {
  let saved = null;
  const repository = {
    async load(makerKey) {
      if (!saved) return null;
      return {
        makerKey,
        revision: saved.revision,
        document: structuredClone(saved.document),
        recipe: structuredClone(saved.recipe),
        assets: [{
          ...structuredClone(saved.assets[0]),
          blob: new Blob(['corrupt'], { type: 'image/png' }),
        }],
        metadata: structuredClone(saved.metadata),
        savedAt: 123,
      };
    },
    async save(_makerKey, snapshot) {
      saved = structuredClone(snapshot);
      return { confirmed: true, conflict: false, persistedRevision: snapshot.revision };
    },
    async flush() {
      return { persistedRevision: 0 };
    },
  };
  const workspace = createMakerWorkspace({ callbacks: {}, draftRepository: repository });
  const document = createCharacterMakerV5Starter({
    makerId: 'corrupt-recovery-copy',
    name: 'Corrupt Recovery Copy',
  });

  await assert.rejects(
    workspace.commitRecoveredDraftCopy({
      makerKey: 'wallet:corrupt-recovery-copy',
      document,
      assets: [{
        assetId: 'recovery-png',
        identifier: 'recovery.png',
        kind: 'layer',
        mediaType: 'image/png',
        width: 1,
        height: 1,
        blob: new Blob(['png'], { type: 'image/png' }),
      }],
    }),
    /read-back verification/,
  );
  workspace.destroy();
});

test('pending Creator text is committed before toolbar actions and becomes undoable', async () => withAnimationFrame(async () => {
  const workspace = createMakerWorkspace({ callbacks: {} });
  const document = createCharacterMakerV5Starter({ makerId: 'text-buffer', name: 'Text Buffer' });
  await workspace.setContext({ makerKey: 'wallet:text-buffer', walletAddress: '', document, assets: [] });

  const partId = workspace.getDocument().parts[0].id;
  workspace.selectedPartId = partId;
  assert.equal(workspace.captureCreatorText({ value: 'Renamed Background', dataset: { action: 'part-name' } }), true);
  assert.equal(workspace.flushPendingCreatorText(), true);
  assert.equal(workspace.getDocument().parts[0].name, 'Renamed Background');
  assert.equal(workspace.store.getState().canUndo, true);
  workspace.store.undo();
  assert.equal(workspace.getDocument().parts[0].name, 'Background');
  workspace.destroy();
}));

test('discarding a published Maker version draft restores and immediately saves the published snapshot', async () => withAnimationFrame(async () => {
  const makerKey = '0xcreator:discard-version';
  const published = createCharacterMakerV5Starter({
    makerId: 'discard-version',
    name: 'Published Maker',
  });
  synchronizeDefaultRecipe(published);
  const publishedRecipe = structuredClone(published.defaultRecipe);
  const draft = structuredClone(published);
  draft.version = {
    ...draft.version,
    versionId: 'discard-version-v2',
    number: 2,
    parentVersionId: published.version.versionId,
    compatibility: 'compatible',
  };
  draft.metadata.name = 'Version Draft';

  let savedSnapshot = null;
  let saveCalls = 0;
  let deletedCheckpointCalls = 0;
  const synchronizedSnapshots = [];
  const savedPayloads = [];
  const retainedCheckpoints = ['checkpoint-1'];
  const repository = {
    async save(requestedMakerKey, snapshot) {
      assert.equal(requestedMakerKey, makerKey);
      saveCalls += 1;
      savedSnapshot = snapshot;
      return {
        confirmed: true,
        conflict: false,
        persistedRevision: snapshot.revision,
        savedAt: 456,
      };
    },
    async flush() {
      return { persistedRevision: savedSnapshot?.revision ?? 0 };
    },
    getStatus() {
      return {
        persistedRevision: savedSnapshot?.revision ?? null,
        savedAt: 456,
      };
    },
    async deleteCheckpoint() {
      deletedCheckpointCalls += 1;
    },
  };
  const workspace = createMakerWorkspace({
    callbacks: {
      onDocumentChange(payload) {
        synchronizedSnapshots.push(payload);
      },
      onSaved(payload) {
        savedPayloads.push(payload);
      },
    },
    draftRepository: repository,
    walStorage: null,
    loadPlayerSessionRecord: async () => null,
    savePlayerSessionRecord: async () => {},
  });

  await workspace.setContext({
    makerKey,
    walletAddress: '',
    document: draft,
    assets: [],
    isPublished: false,
    publishedDocument: published,
    publishedRecipe,
  });
  assert.equal(await workspace.discardVersionDraft(), false, 'an unpublished Maker cannot discard to a release');
  assert.equal(saveCalls, 0);

  await workspace.setContext({
    makerKey,
    walletAddress: '0xcreator',
    isPublished: true,
  });
  const retainedBlob = new Blob(['draft-asset'], { type: 'image/png' });
  workspace.assets.set('detached-draft-blob', {
    assetId: 'detached-draft-blob',
    identifier: 'detached-draft-blob.png',
    kind: 'layer',
    mediaType: 'image/png',
    blob: retainedBlob,
  });
  workspace.captureCreatorText({
    value: 'Pending draft name',
    dataset: { action: 'maker-name' },
  });
  workspace.selectedPartId = 'missing-draft-part';
  workspace.selectedItemId = 'missing-draft-item';
  workspace.selectedStyleId = 'missing-draft-style';
  workspace.playerExportOpen = true;
  workspace.playerExportState = 'ready';
  workspace.playerExportSnapshot = { versionId: draft.version.versionId };

  const result = await workspace.discardVersionDraft();
  await workspace.playerSessionTransitionPromise;
  const state = workspace.store.getState();
  assert.equal(result, true);
  assert.equal(state.document.version.versionId, published.version.versionId);
  assert.equal(state.document.metadata.name, 'Published Maker');
  assert.deepEqual(state.recipe, publishedRecipe);
  assert.equal(state.canUndo, false);
  assert.equal(state.canRedo, false);
  assert.equal(state.dirty, false);
  assert.equal(workspace.playerExportOpen, false);
  assert.equal(workspace.playerExportSnapshot, null);
  assert.equal(workspace.selectedPartId, published.parts[0].id);
  assert.equal(workspace.assets.get('detached-draft-blob').blob, retainedBlob);
  assert.equal(savedSnapshot.document.version.versionId, published.version.versionId);
  assert.deepEqual(savedSnapshot.recipe, publishedRecipe);
  assert.equal(
    savedSnapshot.assets.find((asset) => asset.assetId === 'detached-draft-blob').blob,
    retainedBlob,
  );
  assert.deepEqual(retainedCheckpoints, ['checkpoint-1']);
  assert.equal(deletedCheckpointCalls, 0);
  assert.equal(published.version.versionId, 'discard-version-v1', 'the published source remains immutable');
  assert.equal(published.metadata.name, 'Published Maker');
  assert.equal(synchronizedSnapshots.length, 1);
  assert.equal(synchronizedSnapshots[0].event.reason, 'discard-version-draft');
  assert.equal(
    synchronizedSnapshots[0].document.version.versionId,
    published.version.versionId,
    'the outer Creator model is synchronized only after persistence succeeds',
  );
  assert.equal(savedPayloads.length, 1);
  assert.equal(savedPayloads[0].revision, state.revision);

  assert.equal(
    await workspace.discardVersionDraft(),
    false,
    'the restored release is no longer a distinct version draft',
  );
  assert.equal(saveCalls, 1);
  workspace.destroy();
}));

test('a failed version-draft discard leaves the complete editing session untouched', async () => withAnimationFrame(async () => {
  const makerKey = '0xcreator:discard-version-failure';
  const published = createCharacterMakerV5Starter({
    makerId: 'discard-version-failure',
    name: 'Published Maker',
  });
  synchronizeDefaultRecipe(published);
  const draft = structuredClone(published);
  draft.version = {
    ...draft.version,
    versionId: 'discard-version-failure-v2',
    number: 2,
    parentVersionId: published.version.versionId,
  };
  draft.metadata.name = 'Version Draft';

  let saveCalls = 0;
  const synchronizedSnapshots = [];
  const repository = {
    async save(requestedMakerKey) {
      assert.equal(requestedMakerKey, makerKey);
      saveCalls += 1;
      return {
        confirmed: false,
        conflict: true,
        persistedRevision: 9,
      };
    },
    async flush() {
      return { persistedRevision: 0 };
    },
    getStatus() {
      return {
        persistedRevision: 0,
        latestRequestedRevision: 0,
        savedAt: 123,
      };
    },
  };
  const workspace = createMakerWorkspace({
    callbacks: {
      onDocumentChange(payload) {
        synchronizedSnapshots.push(payload);
      },
    },
    draftRepository: repository,
    walStorage: null,
    loadPlayerSessionRecord: async () => null,
    savePlayerSessionRecord: async () => {},
  });

  await workspace.setContext({
    makerKey,
    walletAddress: '',
    document: draft,
    assets: [],
    isPublished: true,
    publishedDocument: published,
    publishedRecipe: published.defaultRecipe,
  });
  await workspace.setContext({ makerKey, walletAddress: '0xcreator' });
  workspace.executeDocument('Keep this draft edit', ({ document }) => {
    document.metadata.summary = 'Unsaved draft-only summary';
  });
  workspace.autosave.cancel();
  synchronizedSnapshots.length = 0;

  const selectedPart = workspace.getDocument().parts[1];
  const selectedItem = selectedPart.items[0];
  const selectedStyle = selectedItem.styles[0];
  workspace.selectedPartId = selectedPart.id;
  workspace.selectedItemId = selectedItem.id;
  workspace.selectedStyleId = selectedStyle.id;
  workspace.playerPartId = selectedPart.id;
  workspace.playerUndo = [{ recipe: { marker: 'player-undo' } }];
  workspace.playerRedo = [{ recipe: { marker: 'player-redo' } }];
  workspace.playerExportOpen = true;
  workspace.playerExportState = 'ready';
  workspace.playerExportSnapshot = { versionId: draft.version.versionId };
  assert.equal(workspace.captureCreatorText({
    value: 'Pending draft title',
    dataset: { action: 'maker-name' },
  }), true);

  const beforeStore = workspace.store.snapshotForSave();
  const beforePlayerRecipe = structuredClone(workspace.playerRecipe);
  const beforePlayerUndo = structuredClone(workspace.playerUndo);
  const beforePlayerRedo = structuredClone(workspace.playerRedo);
  const beforePendingText = structuredClone(workspace.pendingCreatorText);

  assert.equal(await workspace.discardVersionDraft(), false);
  workspace.textAutosave.cancel();
  workspace.autosave.cancel();

  const afterStore = workspace.store.snapshotForSave();
  assert.deepEqual(afterStore.document, beforeStore.document);
  assert.deepEqual(afterStore.recipe, beforeStore.recipe);
  assert.deepEqual(afterStore.journal, beforeStore.journal);
  assert.equal(workspace.store.getState().canUndo, true);
  assert.equal(workspace.selectedPartId, selectedPart.id);
  assert.equal(workspace.selectedItemId, selectedItem.id);
  assert.equal(workspace.selectedStyleId, selectedStyle.id);
  assert.equal(workspace.playerPartId, selectedPart.id);
  assert.deepEqual(workspace.playerRecipe, beforePlayerRecipe);
  assert.deepEqual(workspace.playerUndo, beforePlayerUndo);
  assert.deepEqual(workspace.playerRedo, beforePlayerRedo);
  assert.equal(workspace.playerExportOpen, true);
  assert.equal(workspace.playerExportState, 'ready');
  assert.deepEqual(workspace.playerExportSnapshot, { versionId: draft.version.versionId });
  assert.deepEqual(workspace.pendingCreatorText, beforePendingText);
  assert.equal(synchronizedSnapshots.length, 0);
  assert.equal(saveCalls, 1);
  workspace.destroy();
}));

test('deleting the active draft waits for an in-flight save and blocks every later autosave', async () => withAnimationFrame(async () => {
  const makerKey = '0xcreator:delete-concurrency';
  const document = createCharacterMakerV5Starter({
    makerId: 'delete-concurrency',
    name: 'Delete Concurrency',
  });
  let releaseSave;
  let notifySaveStarted;
  const saveStarted = new Promise((resolve) => {
    notifySaveStarted = resolve;
  });
  const saveGate = new Promise((resolve) => {
    releaseSave = resolve;
  });
  const calls = [];
  let pendingSave = Promise.resolve();
  let saveCalls = 0;
  let savedCallbacks = 0;
  const repository = {
    save(requestedMakerKey, snapshot) {
      assert.equal(requestedMakerKey, makerKey);
      saveCalls += 1;
      calls.push('save:start');
      notifySaveStarted();
      pendingSave = saveGate.then(() => {
        calls.push('save:finish');
        return {
          confirmed: true,
          conflict: false,
          persistedRevision: snapshot.revision,
          savedAt: 456,
        };
      });
      return pendingSave;
    },
    async flush(requestedMakerKey) {
      assert.equal(requestedMakerKey, makerKey);
      await pendingSave;
      calls.push('flush');
      return { persistedRevision: 1 };
    },
    getStatus() {
      return { persistedRevision: 0, savedAt: 123 };
    },
    async deleteProject(requestedMakerKey) {
      assert.equal(requestedMakerKey, makerKey);
      calls.push('delete');
      return {
        makerKey,
        deleted: true,
        persistedRevision: 2,
        savedAt: 789,
      };
    },
  };
  const workspace = createMakerWorkspace({
    callbacks: {
      onSaved() {
        savedCallbacks += 1;
      },
    },
    draftRepository: repository,
    walStorage: null,
    loadPlayerSessionRecord: async () => null,
    savePlayerSessionRecord: async () => {},
  });

  await workspace.setContext({
    makerKey,
    walletAddress: '',
    document,
    assets: [],
  });
  await workspace.setContext({ makerKey, walletAddress: '0xcreator' });
  workspace.executeDocument('Dirty before delete', ({ document: next }) => {
    next.metadata.summary = 'This save must finish before the tombstone.';
  });
  workspace.autosave.cancel();
  assert.equal(workspace.captureCreatorText({
    value: 'Never resurrect this Maker',
    dataset: { action: 'maker-name' },
  }), true);

  const inFlightSave = workspace.save({ automatic: true });
  await saveStarted;
  const deletion = workspace.deleteDraftProject(makerKey);
  assert.equal(
    workspace.executeDocument('Blocked during delete', ({ document: next }) => {
      next.metadata.name = 'Resurrected';
    }),
    false,
  );
  workspace.autosave();
  const lateAutosave = workspace.autosave.flush();
  releaseSave();
  await Promise.all([inFlightSave, lateAutosave, deletion]);

  assert.deepEqual(calls, ['save:start', 'save:finish', 'flush', 'delete']);
  assert.equal(saveCalls, 1);
  assert.equal(savedCallbacks, 0, 'the isolated in-flight save cannot publish stale outer state');
  assert.equal(workspace.pendingCreatorText, null);
  assert.equal(await workspace.save(), null);
  workspace.autosave();
  await workspace.autosave.flush();
  assert.equal(saveCalls, 1, 'a delayed timer cannot write after the deletion tombstone');
  workspace.destroy();
}));
