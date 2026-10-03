import assert from 'node:assert/strict';
import test from 'node:test';

import { createCharacterMakerV8Starter } from '../maker-v8-document.js';
import {
  applyMakerV8WorkspaceCommand,
  createMakerV8Workspace,
  exportMakerV8Project,
} from '../maker-v8-workspace.js';

function starter() {
  return createCharacterMakerV8Starter({ makerKey: 'studio', name: 'Studio' });
}

test('Maker Info display fields save and clear through exact metadata commands and history', async () => {
  const workspace = createMakerV8Workspace({ document: starter() });
  const original = structuredClone(workspace.getState().document.metadata);
  const metadata = { ...original, creator: '作者 🌍', style: '水彩世界' };
  workspace.dispatch({ type: 'metadata.set', metadata });
  assert.deepEqual(workspace.getState().document.metadata, metadata);
  const exported = await exportMakerV8Project(workspace.getState().document);
  assert.deepEqual(exported.document.metadata, metadata);
  workspace.undo();
  assert.deepEqual(workspace.getState().document.metadata, original);
  workspace.redo();
  assert.deepEqual(workspace.getState().document.metadata, metadata);
  const before = workspace.getState();
  for (const invalid of [{ ...metadata, creator: null }, { ...metadata, style: '🌍'.repeat(33) },
    { ...metadata, creatorName: 'Alias' }, { ...metadata, owner: 'Fake' }]) {
    assert.throws(() => workspace.dispatch({ type: 'metadata.set', metadata: invalid }));
    assert.deepEqual(workspace.getState(), before);
  }
  workspace.dispatch({ type: 'metadata.set', metadata: original });
  assert.deepEqual(workspace.getState().document.metadata, original);
  workspace.undo();
  assert.deepEqual(workspace.getState().document.metadata, metadata);
});

test('Soul author commands preserve literal drafts and participate in atomic undo and redo', () => {
  const workspace = createMakerV8Workspace({ document: starter() });
  const original = structuredClone(workspace.getState().document.livingContent);
  const content = { ...original, soulMd: '  # 原文\r\n{{OC_NAME}}\n', memoryMd: '',
    customized: { ...original.customized, soulMd: true, memoryMd: true } };
  workspace.dispatch({ type: 'livingContent.set', livingContent: content });
  assert.deepEqual(workspace.getState().document.livingContent, content);
  content.soulMd = 'external mutation';
  workspace.undo();
  assert.deepEqual(workspace.getState().document.livingContent, original);
  workspace.redo();
  assert.equal(workspace.getState().document.livingContent.soulMd, '  # 原文\r\n{{OC_NAME}}\n');
  const before = workspace.getState();
  assert.throws(() => workspace.dispatch({ type: 'livingContent.set', livingContent: { ...original, memoryMd: null } }));
  assert.deepEqual(workspace.getState(), before);
});

test('workspace applies exact v8 commands and preserves undo/redo history', () => {
  const workspace = createMakerV8Workspace({ document: starter(), historyLimit: 4 });
  const metadata = structuredClone(workspace.getState().document.metadata);
  metadata.name = 'Edited Maker';
  workspace.dispatch({ type: 'metadata.set', metadata });
  assert.equal(workspace.getState().document.metadata.name, 'Edited Maker');
  assert.equal(workspace.getState().canUndo, true);
  workspace.undo();
  assert.equal(workspace.getState().document.metadata.name, 'Studio');
  workspace.redo();
  assert.equal(workspace.getState().document.metadata.name, 'Edited Maker');
  assert.equal(workspace.getState().issues.length, 0);
});

test('private author items stay in the draft and are absent from public preview', () => {
  const document = structuredClone(starter());
  const part = structuredClone(document.parts[0]);
  const privateItem = structuredClone(part.items[0]);
  privateItem.key = 'private-item';
  privateItem.label = 'Private Item';
  privateItem.status = 'PRIVATE';
  privateItem.defaultStyleKey = 'private-style';
  privateItem.styles[0].key = 'private-style';
  privateItem.styles[0].label = 'Private Style';
  part.items.push(privateItem);

  const next = applyMakerV8WorkspaceCommand(document, { type: 'part.upsert', row: part });
  assert.equal(next.parts[0].items.length, 2);
  const workspace = createMakerV8Workspace({ document: next });
  assert.equal(workspace.preview().parts[0].items.length, 1);
  assert.equal(workspace.getState().document.parts[0].items[1].status, 'PRIVATE');
});

test('invalid references and compiler-owned payloads are rejected atomically', () => {
  const document = starter();
  assert.throws(
    () => applyMakerV8WorkspaceCommand(document, { type: 'track.remove', key: 'base-track' }),
    { code: 'MAKER_V8_TRACK_UNKNOWN' },
  );
  const part = structuredClone(document.parts[0]);
  part.payload = { packageId: `0x${'11'.repeat(32)}` };
  assert.throws(
    () => applyMakerV8WorkspaceCommand(document, { type: 'part.upsert', row: part }),
    { code: 'MAKER_V8_COMPILER_FIELD_FORBIDDEN' },
  );
  assert.equal(document.tracks.length, 1);
});

test('project export binds the exact canonical Maker v8 document', async () => {
  const bundle = await exportMakerV8Project(starter());
  assert.equal(bundle.schemaVersion, 'animacraft.maker-v8-project-export.v1');
  assert.equal(bundle.document.schemaVersion, 'animacraft.maker.v8');
  assert.match(bundle.documentSha256, /^[0-9a-f]{64}$/);
  assert.equal(Object.isFrozen(bundle), true);
});
