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
