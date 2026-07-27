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
