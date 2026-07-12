import assert from 'node:assert/strict';
import test from 'node:test';

import { createCharacterMakerV4Starter, createMakerV4Document } from '../maker-v4.js';
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

test('same-key context replaces an early shell with the restored v4 draft', async () => withAnimationFrame(async () => {
  const workspace = createMakerWorkspace({ callbacks: {} });
  const shell = createMakerV4Document({ makerId: 'restore-race', name: 'Early shell' });
  const restored = createCharacterMakerV4Starter({ makerId: 'restore-race', name: 'Restored Maker' });

  await workspace.setContext({ makerKey: 'wallet:restore-race', walletAddress: '', document: shell });
  await workspace.setContext({ makerKey: 'wallet:restore-race', walletAddress: '', document: restored });

  const result = workspace.getDocument();
  assert.equal(result.metadata.name, 'Restored Maker');
  assert.equal(result.parts.length, 8);
  assert.ok(result.parts.every((part) => part.items[0].variants[0].layerBindings.length === 1));
  workspace.destroy();
}));

test('starter preflight reports one actionable upload issue per pending Part', async () => withAnimationFrame(async () => {
  const workspace = createMakerWorkspace({ callbacks: {} });
  const document = createCharacterMakerV4Starter({ makerId: 'preflight-starter', name: 'Preflight Starter' });
  await workspace.setContext({ makerKey: 'wallet:preflight-starter', walletAddress: '', document, assets: [] });

  const issues = workspace.getPublicationIssues();
  const uploadIssues = issues.filter((issue) => issue.code === 'runtime_asset_missing');
  assert.equal(uploadIssues.length, 8);
  assert.deepEqual(uploadIssues.map((issue) => issue.path.split('/')[0]), document.parts.map((part) => part.id));
  assert.equal(issues.filter((issue) => issue.code === 'position_unconfirmed').length, 0);
  workspace.destroy();
}));

test('every Creator Studio tool tab is selectable and invalid tabs fall back to Parts & Items', async () => withAnimationFrame(async () => {
  const workspace = createMakerWorkspace({ callbacks: {} });
  const document = createCharacterMakerV4Starter({ makerId: 'tool-tabs', name: 'Tool Tabs' });
  await workspace.setContext({ makerKey: 'wallet:tool-tabs', walletAddress: '', document, assets: [] });

  for (const tab of ['structure', 'layers', 'colors', 'rules', 'expansions', 'validate']) {
    workspace.openCreatorTab(tab);
    assert.equal(workspace.creatorTab, tab);
  }

  workspace.openCreatorTab('not-a-tool');
  assert.equal(workspace.creatorTab, 'structure');
  workspace.destroy();
}));

test('pending Creator text is committed before toolbar actions and becomes undoable', async () => withAnimationFrame(async () => {
  const workspace = createMakerWorkspace({ callbacks: {} });
  const document = createCharacterMakerV4Starter({ makerId: 'text-buffer', name: 'Text Buffer' });
  await workspace.setContext({ makerKey: 'wallet:text-buffer', walletAddress: '0x1', document, assets: [] });

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
