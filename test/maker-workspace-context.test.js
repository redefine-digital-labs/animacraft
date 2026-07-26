import assert from 'node:assert/strict';
import test from 'node:test';

import { createCharacterMakerV5Starter, createMakerV5Document } from '../maker-v4.js';
import { createItem, synchronizeDefaultRecipe } from '../maker-document-ops.js';
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

  for (const tab of ['structure', 'layers', 'colors', 'rules', 'expansions', 'soul', 'validate']) {
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
