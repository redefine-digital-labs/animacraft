import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  EXPANSION_PACK_WORKSPACE_LAYOUT,
  EXPANSION_PACK_WORKSPACE_SAVE_PHASES,
  createExpansionPackWorkspace,
  mountExpansionPackWorkspace,
  renderExpansionPackWorkspaceHtml,
} from '../expansion-pack-workspace.js';

function baseMaker() {
  return {
    schemaVersion: 'animacraft.maker.v5',
    version: { rootMakerId: 'maker-root', versionId: 'maker-root-v4', number: 4 },
    metadata: { id: 'maker-root', name: 'Read-only Mira Maker', creator: '0xcreator' },
    manifestHash: 'maker-root-hash',
    canvas: { width: 1024, height: 1024, pixelMode: 'smooth' },
    layerTracks: [{ id: 'body-track', name: 'Body', order: 0 }],
    colorChannels: [],
    assets: [{
      id: 'body-art',
      identifier: 'body.png',
      contentHash: 'body-hash',
      mediaType: 'image/png',
    }],
    parts: [{
      id: 'body',
      name: 'Body',
      required: true,
      allowRemove: false,
      defaultItemId: 'body-default',
      items: [{
        id: 'body-default',
        name: 'Default Body',
        defaultStyleId: 'default',
        styles: [{
          id: 'default',
          name: 'Default',
          assetId: 'body-art',
          layerTrackId: 'body-track',
          transform: { x: 0, y: 0, scale: 1, rotation: 0 },
          opacity: 1,
          blendMode: 'normal',
          visibleWhen: null,
          requires: [],
          excludes: [],
        }],
      }],
    }],
    defaultRecipe: {
      selections: [{ partId: 'body', itemId: 'body-default', styleId: 'default' }],
      colors: [],
    },
    rules: [],
  };
}

function memoryWorkspaceStore() {
  const records = new Map();
  const calls = [];
  const key = (identity) => (
    `${identity.walletAddress}:${identity.parentRootId}:${identity.parentVersion}:${identity.packId}`
  );
  return {
    records,
    calls,
    async load(identity) {
      const record = records.get(key(identity));
      return record ? structuredClone(record) : null;
    },
    async save(identity, project, options) {
      calls.push({ identity: structuredClone(identity), project: structuredClone(project), options: { ...options } });
      const recordKey = key(identity);
      const existing = records.get(recordKey) || null;
      const matches = options.expectedRevision === null
        ? !existing
        : existing?.revision === options.expectedRevision;
      if (!matches) {
        return {
          saved: false,
          conflict: true,
          persistedRevision: existing?.revision ?? null,
          savedAt: existing?.savedAt ?? null,
        };
      }
      const record = {
        project: structuredClone(project),
        revision: options.revision,
        savedAt: options.revision * 1_000,
      };
      records.set(recordKey, record);
      return {
        saved: true,
        conflict: false,
        persistedRevision: record.revision,
        savedAt: record.savedAt,
      };
    },
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolveValue, rejectValue) => {
    resolve = resolveValue;
    reject = rejectValue;
  });
  return { promise, resolve, reject };
}

async function emptyWorkspace(overrides = {}) {
  return createExpansionPackWorkspace({
    parentMaker: baseMaker(),
    walletAddress: '0xABCD',
    packId: 'moon-pack',
    namespace: 'moon',
    name: 'Moon Pack',
    store: memoryWorkspaceStore(),
    resume: false,
    clock: () => 100,
    ...overrides,
  });
}

test('initializes one empty Pack while exposing only a read-only parent summary', async () => {
  const workspace = await emptyWorkspace();
  const state = workspace.getState();

  assert.equal(state.tree.name, 'Moon Pack');
  assert.deepEqual(state.tree.parts, []);
  assert.equal(state.parent.readonly, true);
  assert.equal(state.parent.name, 'Read-only Mira Maker');
  assert.equal(state.parent.bindingKind, 'local-draft');
  assert.equal(state.parent.publishable, false);
  assert.equal(state.parent.releaseId, '');
  assert.equal(state.parent.manifestBlobId, '');
  assert.equal(state.parent.binding.kind, 'local-draft');
  assert.deepEqual(
    state.parent.inheritance.contracts.map((contract) => contract.id),
    [
      'documentSchema',
      'parentMetadata',
      'canvas',
      'renderer',
      'layerTracks',
      'baseDefinitions',
      'baseAssets',
      'selectionRules',
      'smartColorChannels',
      'defaultRecipe',
      'livingContent',
      'wardrobeCompatibility',
      'parentCommerce',
      'license',
    ],
  );
  assert.deepEqual(state.parent.counts, { parts: 1, items: 1, styles: 1, assets: 1 });
  assert.ok(Object.isFrozen(state.parent));
  assert.ok(Object.isFrozen(state.parent.parts[0]));
  assert.equal(state.save.phase, EXPANSION_PACK_WORKSPACE_SAVE_PHASES.NEW);
  assert.equal(state.dirty, true);
  assert.equal(state.preview.status, 'ready-with-issues');
  assert.equal(state.preview.contentReady, false);
  assert.equal(state.preview.publishable, false);
  assert.equal(state.preview.parentBinding.localParent, true);
  assert.equal(state.preview.parentBinding.exactPublishedParent, false);
  assert.ok(state.preview.maker);
  assert.deepEqual(state.layout, EXPANSION_PACK_WORKSPACE_LAYOUT);
  assert.throws(
    () => workspace.renamePart('body', 'Mutated parent'),
    (error) => error?.code === 'parent-definition-readonly',
  );
  assert.equal(workspace.getParentInfo().parts[0].name, 'Body');
});

test('authors and renames optional Parts, Items and Styles through immutable Pack commands', async () => {
  const workspace = await emptyWorkspace();
  const reasons = [];
  workspace.subscribe((_state, reason) => reasons.push(reason));

  workspace.addItem({
    partId: 'body',
    item: {
      id: 'armor',
      name: 'Armor',
      defaultStyleId: 'default',
      styles: [{
        id: 'default',
        name: 'Default Armor',
        assetId: 'body-art',
        layerTrackId: 'body-track',
      }],
    },
  });
  workspace.addStyle({
    partId: 'body',
    itemId: 'body-default',
    assets: [{
      id: 'spark-art',
      identifier: 'spark.png',
      contentHash: 'spark-hash',
      mediaType: 'image/png',
    }],
    style: {
      id: 'spark',
      name: 'Spark',
      assetId: 'spark-art',
      layerTrackId: 'body-track',
    },
  });
  workspace.addOptionalPart({
    part: {
      id: 'hat',
      name: 'Hat',
      defaultItemId: 'charm',
      items: [{
        id: 'charm',
        name: 'Charm',
        defaultStyleId: 'default',
        styles: [{
          id: 'default',
          name: 'Default Charm',
          assetId: 'spark-art',
          layerTrackId: 'body-track',
        }],
      }],
    },
  });

  workspace.renamePack('Moonlight Pack');
  workspace.renameItem('body', 'armor', 'Moon Armor');
  workspace.renameStyle('body', 'body-default', 'spark', 'Moon Spark');
  workspace.renamePart('hat', 'Headwear');
  workspace.renameItem('hat', 'charm', 'Moon Charm');
  workspace.renameStyle('hat', 'charm', 'default', 'Blue Charm');

  const state = workspace.getState();
  assert.equal(state.project.name, 'Moonlight Pack');
  assert.equal(state.project.pack.name, 'Moonlight Pack');
  assert.equal(state.parent.parts[0].name, 'Body');
  assert.equal(state.tree.parts[0].kind, 'parent-extension');
  assert.equal(state.tree.parts[0].items[0].name, 'Moon Armor');
  assert.equal(state.tree.parts[0].items[1].styles[0].name, 'Moon Spark');
  assert.equal(state.tree.parts[1].kind, 'optional-part');
  assert.equal(state.tree.parts[1].name, 'Headwear');
  assert.equal(state.tree.parts[1].items[0].name, 'Moon Charm');
  assert.equal(state.tree.parts[1].items[0].styles[0].name, 'Blue Charm');
  assert.equal(state.preview.status, 'content-ready-local-parent');
  assert.equal(state.preview.contentReady, true, JSON.stringify(state.preview.issues));
  assert.equal(state.preview.publishable, false, JSON.stringify(state.preview.issues));
  assert.equal(state.preview.parentBinding.localParent, true);
  assert.deepEqual(state.preview.additions, { optionalParts: 1, items: 2, styles: 3 });
  assert.ok(state.preview.maker.parts.some((part) => part.id === 'moon__hat'));
  assert.deepEqual(reasons, [
    'add-item',
    'add-style',
    'add-part',
    'rename-pack',
    'rename-item',
    'rename-style',
    'rename-part',
    'rename-item',
    'rename-style',
  ]);
});

test('distinguishes local content readiness from an exact published parent release', async () => {
  const parent = baseMaker();
  delete parent.manifestHash;
  const workspace = await emptyWorkspace({
    parentMaker: parent,
    parentRelease: {
      identityVerified: true,
      releaseId: '0xmaker-release-v4',
      versionId: 'maker-root-v4',
      versionNumber: '4',
      manifestBlobId: 'walrus-parent-v4',
      manifestHash: 'ab'.repeat(32),
    },
  });
  workspace.addItem({
    partId: 'body',
    item: {
      id: 'armor',
      name: 'Armor',
      styles: [{ id: 'default', assetId: 'body-art', layerTrackId: 'body-track' }],
    },
  });

  const state = workspace.getState();
  assert.equal(state.parent.bindingKind, 'published-release');
  assert.equal(state.parent.publishable, true);
  assert.equal(state.parent.releaseId, '0xmaker-release-v4');
  assert.equal(state.parent.manifestBlobId, 'walrus-parent-v4');
  assert.equal(state.parent.manifestHash, 'ab'.repeat(32));
  assert.equal(state.preview.status, 'publishable');
  assert.equal(state.preview.contentReady, true);
  assert.equal(state.preview.publishable, true);
  assert.equal(state.preview.parentBinding.localParent, false);
  assert.equal(state.preview.parentBinding.exactPublishedParent, true);

  const html = renderExpansionPackWorkspaceHtml(state);
  assert.match(html, /Exact published release/);
  assert.match(html, /0xmaker-release-v4/);
  assert.match(html, /walrus-parent-v4/);
  assert.match(html, new RegExp('ab'.repeat(32)));
  assert.match(html, /data-publication-preflight-only/);
  assert.doesNotMatch(html, /request-rebind-parent/);
});

test('updates and deletes Pack-owned Style data without exposing parent definitions to mutation', async () => {
  const workspace = await emptyWorkspace();
  const reasons = [];
  workspace.subscribe((_state, reason) => reasons.push(reason));
  workspace.addItem({
    partId: 'body',
    item: {
      id: 'armor',
      name: 'Armor',
      styles: [{
        id: 'default',
        name: 'Default Armor',
        assetId: 'body-art',
        layerTrackId: 'body-track',
      }],
    },
  });
  workspace.addStyle({
    partId: 'body',
    itemId: 'body-default',
    style: {
      id: 'spark',
      name: 'Spark',
      assetId: 'body-art',
      layerTrackId: 'body-track',
    },
  });
  workspace.addOptionalPart({
    part: {
      id: 'hat',
      name: 'Hat',
      items: [{
        id: 'cap',
        name: 'Cap',
        styles: [{
          id: 'default',
          name: 'Default Cap',
          assetId: 'body-art',
          layerTrackId: 'body-track',
        }],
      }],
    },
  });

  const beforeUpdate = workspace.getState();
  workspace.updateStyle('body', 'armor', 'default', {
    transform: { x: -12, y: 8, scale: 0.5, rotation: 15 },
    opacity: 0.4,
    blendMode: 'screen',
  });
  let state = workspace.getState();
  const armorStyle = state.tree.parts[0].items.find((item) => item.id === 'armor').styles[0];
  assert.deepEqual(armorStyle.transform, { x: -12, y: 8, scale: 0.5, rotation: 15 });
  assert.equal(armorStyle.opacity, 0.4);
  assert.equal(armorStyle.blendMode, 'screen');
  assert.equal(beforeUpdate.tree.parts[0].items[0].styles[0].opacity, 1);
  assert.equal(state.parent.parts[0].items[0].styles[0].name, 'Default');

  workspace.removeStyle('body', 'body-default', 'spark');
  state = workspace.getState();
  assert.equal(state.tree.parts[0].items.some((item) => item.id === 'body-default'), false);
  workspace.removeItem('body', 'armor');
  state = workspace.getState();
  assert.equal(state.tree.parts.some((part) => part.id === 'body'), false);
  workspace.removePart('hat');
  assert.deepEqual(workspace.getState().tree.parts, []);

  const readonly = (error) => error?.code === 'parent-definition-readonly';
  assert.throws(() => workspace.removePart('body'), readonly);
  assert.throws(() => workspace.removeItem('body', 'body-default'), readonly);
  assert.throws(() => workspace.removeStyle('body', 'body-default', 'default'), readonly);
  assert.throws(
    () => workspace.updateStyle('body', 'body-default', 'default', { opacity: 0.5 }),
    readonly,
  );
  assert.deepEqual(reasons, [
    'add-item',
    'add-style',
    'add-part',
    'update-style',
    'remove-style',
    'remove-item',
    'remove-part',
  ]);
});

test('save state never claims a newer in-memory edit was persisted by an older save', async () => {
  const baseStore = memoryWorkspaceStore();
  let releaseFirstSave;
  let delayed = true;
  const store = {
    ...baseStore,
    async save(...args) {
      if (delayed) {
        delayed = false;
        await new Promise((resolve) => { releaseFirstSave = resolve; });
      }
      return baseStore.save(...args);
    },
  };
  const workspace = await emptyWorkspace({ store });

  const firstSave = workspace.save();
  await Promise.resolve();
  assert.equal(workspace.getState().save.phase, EXPANSION_PACK_WORKSPACE_SAVE_PHASES.SAVING);
  workspace.renamePack('Changed while saving');
  releaseFirstSave();
  await firstSave;

  let state = workspace.getState();
  assert.equal(state.revision, 1);
  assert.equal(state.dirty, true);
  assert.equal(state.save.phase, EXPANSION_PACK_WORKSPACE_SAVE_PHASES.DIRTY);
  assert.equal(baseStore.calls[0].project.name, 'Moon Pack');

  await workspace.save();
  state = workspace.getState();
  assert.equal(state.revision, 2);
  assert.equal(state.dirty, false);
  assert.equal(state.save.phase, EXPANSION_PACK_WORKSPACE_SAVE_PHASES.SAVED);
  assert.equal(baseStore.calls[1].project.name, 'Changed while saving');
});

test('flush persists the last Pack mutation that lands while an older snapshot is saving', async () => {
  const baseStore = memoryWorkspaceStore();
  let releaseFirstSave;
  let firstSaveStarted;
  const firstSaveStartedPromise = new Promise((resolve) => { firstSaveStarted = resolve; });
  let delayed = true;
  const store = {
    ...baseStore,
    async save(...args) {
      if (delayed) {
        delayed = false;
        firstSaveStarted();
        await new Promise((resolve) => { releaseFirstSave = resolve; });
      }
      return baseStore.save(...args);
    },
  };
  const workspace = await emptyWorkspace({ store });

  workspace.renamePack('First queued name');
  const flush = workspace.flush();
  await firstSaveStartedPromise;
  workspace.renamePack('Last name before pagehide');
  releaseFirstSave();

  const result = await flush;
  const state = workspace.getState();
  assert.equal(result.saved, true);
  assert.deepEqual(result.identity, state.identity);
  assert.equal(baseStore.calls.length, 2);
  assert.equal(baseStore.calls[0].project.name, 'First queued name');
  assert.equal(baseStore.calls[1].project.name, 'Last name before pagehide');
  assert.equal(state.project.name, 'Last name before pagehide');
  assert.equal(state.dirty, false);
  assert.equal(state.save.phase, EXPANSION_PACK_WORKSPACE_SAVE_PHASES.SAVED);
});

test('resumes the exact persisted Pack revision instead of creating a second embedded draft', async () => {
  const store = memoryWorkspaceStore();
  const first = await emptyWorkspace({ store });
  first.renamePack('Persisted Moon Pack');
  await first.save();

  const resumed = await createExpansionPackWorkspace({
    parentMaker: baseMaker(),
    walletAddress: '0xabcd',
    packId: 'moon-pack',
    namespace: 'moon',
    name: 'Ignored fresh name',
    store,
    resume: true,
    clock: () => 500,
  });
  const state = resumed.getState();
  assert.equal(state.project.name, 'Persisted Moon Pack');
  assert.equal(state.revision, 1);
  assert.equal(state.dirty, false);
  assert.equal(state.save.phase, EXPANSION_PACK_WORKSPACE_SAVE_PHASES.SAVED);
});

test('a save conflict stays locked to the old base revision until explicit reload', async () => {
  const store = memoryWorkspaceStore();
  const workspace = await emptyWorkspace({ store });
  await workspace.save();
  const identity = workspace.getState().identity;
  const recordKey = (
    `${identity.walletAddress}:${identity.parentRootId}:${identity.parentVersion}:${identity.packId}`
  );
  const remote = structuredClone(store.records.get(recordKey));
  remote.revision = 2;
  remote.savedAt = 2_000;
  remote.project.name = 'Remote Pack';
  remote.project.pack.name = 'Remote Pack';
  store.records.set(recordKey, remote);

  workspace.renamePack('Conflicting local Pack');
  const conflict = await workspace.save();
  assert.equal(conflict.conflict, true);
  let state = workspace.getState();
  assert.equal(state.revision, 1);
  assert.equal(state.save.remoteRevision, 2);
  assert.equal(state.save.phase, EXPANSION_PACK_WORKSPACE_SAVE_PHASES.CONFLICT);

  await workspace.save();
  assert.equal(store.calls.at(-1).options.expectedRevision, 1);
  assert.equal(store.records.get(recordKey).project.name, 'Remote Pack');

  await workspace.reload({ force: true });
  state = workspace.getState();
  assert.equal(state.project.name, 'Remote Pack');
  assert.equal(state.revision, 2);
  assert.equal(state.dirty, false);
  assert.equal(state.save.phase, EXPANSION_PACK_WORKSPACE_SAVE_PHASES.SAVED);
});

test('renders and mounts in a host-owned scroll surface without a nested viewport', async () => {
  const workspace = await emptyWorkspace();
  const html = renderExpansionPackWorkspaceHtml(workspace.getState());
  assert.match(html, /data-scroll-owner="host"/);
  assert.match(html, /data-nested-scroll="false"/);
  assert.match(html, /data-maker-editor-shell="expansion-pack"/);
  assert.match(html, /class="v4-studio-topbar"/);
  assert.match(html, /class="v4-studio-tabs"/);
  assert.match(html, /class="v4-studio-workspace"/);
  assert.match(html, /data-shared-maker-part-browser/);
  assert.match(html, /class="v4-canvas-column"/);
  assert.match(html, /class="v4-inspector"/);
  assert.match(html, /Local draft parent/);
  assert.match(html, /Content ready · local parent only|Ready with issues/);
  assert.match(html, /Inherited · read only/);
  assert.match(html, /Smart Color/);
  assert.match(html, /data-action="request-add-part"/);
  assert.match(html, /data-action="save-pack"/);
  assert.equal((html.match(/data-expansion-pack-preview-canvas/g) || []).length, 1);
  assert.doesNotMatch(html, /v4-expansion-card|expansion-pack-workspace-layout/);
  assert.doesNotMatch(html, /expansion-pack-(?:parent|preview|authoring)-panel/);
  assert.doesNotMatch(html, /expansion-pack-embedded-rules|data-definition-rules/);
  assert.doesNotMatch(html, /data-action="(?:open-preview|request-rebind-parent)"/);
  assert.doesNotMatch(html, /overflow\s*:/i);
  assert.doesNotMatch(html, /100vh|100dvh/i);

  const events = new Map();
  const root = {
    innerHTML: '',
    addEventListener(type, listener) { events.set(type, listener); },
    removeEventListener(type) { events.delete(type); },
  };
  const addRequests = [];
  const mounted = mountExpansionPackWorkspace(root, workspace, {
    onRequestAdd: (request) => addRequests.push(request),
  });
  assert.match(root.innerHTML, /Expansion Pack Studio/);

  events.get('change')({
    target: { value: 'Mounted Pack', dataset: { renameKind: 'pack' } },
  });
  assert.equal(workspace.getState().project.name, 'Mounted Pack');
  assert.match(root.innerHTML, /value="Mounted Pack"/);

  events.get('click')({
    target: { dataset: { action: 'request-add-item', partId: 'body' } },
  });
  assert.equal(addRequests[0].kind, 'item');
  assert.equal(addRequests[0].partId, 'body');

  mounted.unmount();
  assert.equal(root.innerHTML, '');
  assert.equal(events.size, 0);
});

test('Maker and Pack call the same host-neutral shell renderer', async () => {
  const [makerSource, packSource, stylesSource] = await Promise.all([
    readFile(new URL('../maker-workspace.js', import.meta.url), 'utf8'),
    readFile(new URL('../expansion-pack-workspace.js', import.meta.url), 'utf8'),
    readFile(new URL('../styles.css', import.meta.url), 'utf8'),
  ]);
  for (const source of [makerSource, packSource]) {
    assert.match(source, /import \{ renderMakerEditorShell \} from '\.\/maker-editor-shell\.js';/);
    assert.match(source, /renderMakerEditorShell\(\{/);
  }
  assert.doesNotMatch(packSource, /function renderDefinitionTabs/);
  assert.doesNotMatch(stylesSource, /expansion-pack-workspace-layout/);
  assert.doesNotMatch(stylesSource, /expansion-pack-(?:parent|preview|authoring)-panel/);
  assert.doesNotMatch(stylesSource, /expansion-pack-embedded-rules/);
});

test('shared Part list keeps inherited rows read only and Pack delta actions editable', async () => {
  const workspace = await emptyWorkspace();
  workspace.addOptionalPart({
    part: {
      id: 'hat',
      name: 'Hat',
      items: [{
        id: 'cap',
        name: 'Cap',
        styles: [{ id: 'default', name: 'Default', assetId: 'body-art', layerTrackId: 'body-track' }],
      }],
    },
  });
  const html = renderExpansionPackWorkspaceHtml(workspace.getState());
  assert.match(html, /class="maker-part-list[^\"]*" data-part-list/);
  assert.match(html, /class="[^\"]*readonly[^\"]*"[^>]*data-part-row data-part-id="body"/);
  assert.match(html, /data-part-row data-part-id="hat"/);
  assert.match(html, /data-part-actions data-part-id="hat"/);
  assert.match(html, /data-action="delete-pack-part" data-part-id="hat"/);
  assert.doesNotMatch(html, /data-action="delete-part"/);
});

test('Part, Item and Style inspectors reuse one compact Combination Rules control', async () => {
  const workspace = await emptyWorkspace();
  workspace.addOptionalPart({
    part: {
      id: 'hat',
      name: 'Hat',
      items: [{
        id: 'cap',
        name: 'Cap',
        styles: [{ id: 'default', name: 'Default', assetId: 'body-art', layerTrackId: 'body-track' }],
      }],
    },
  });
  const html = renderExpansionPackWorkspaceHtml(workspace.getState());
  assert.equal((html.match(/data-shared-definition-rule-control/g) || []).length, 3);
  assert.equal((html.match(/class="v4-object-rule-entry"/g) || []).length, 3);
  assert.equal((html.match(/data-action="edit-pack-selection-rules"/g) || []).length, 3);
  assert.doesNotMatch(html, /expansion-pack-embedded-rules|data-definition-rules|<select[^>]*multiple/);

  const rulesHtml = renderExpansionPackWorkspaceHtml(workspace.getState(), {}, { activeSection: 'rules' });
  assert.match(rulesHtml, /class="v4-inline-empty v4-pack-rule-empty"/);
  assert.equal((rulesHtml.match(/data-action="add-pack-rule"/g) || []).length, 1);
  assert.doesNotMatch(rulesHtml, /expansion-pack-embedded-rules|data-definition-rules/);

  workspace.addRule({
    id: 'hat-rule',
    type: 'excludes',
    trigger: { scope: 'pack', partId: 'hat', itemId: 'cap' },
    targets: [{ scope: 'base', partId: 'body' }],
  });
  const populatedRulesHtml = renderExpansionPackWorkspaceHtml(
    workspace.getState(),
    {},
    { activeSection: 'rules' },
  );
  assert.match(populatedRulesHtml, /data-shared-rule-list/);
  assert.match(populatedRulesHtml, /data-rule-summary-row/);
  assert.doesNotMatch(populatedRulesHtml, /v4-rule-group|expansion-pack-rule-row|<select[^>]*multiple/);

  const [makerSource, packSource, sharedSource, stylesSource] = await Promise.all([
    readFile(new URL('../maker-workspace.js', import.meta.url), 'utf8'),
    readFile(new URL('../expansion-pack-workspace.js', import.meta.url), 'utf8'),
    readFile(new URL('../maker-definition-rule-control.js', import.meta.url), 'utf8'),
    readFile(new URL('../styles.css', import.meta.url), 'utf8'),
  ]);
  for (const source of [makerSource, packSource]) {
    assert.match(source, /renderDefinitionCombinationRuleControl\(/);
    assert.match(source, /renderSharedRuleListEditor\(/);
    assert.match(source, /renderSharedRuleTargetTree\(/);
  }
  assert.match(sharedSource, /export function renderSharedRuleListEditor/);
  assert.doesNotMatch(packSource, /selectorMultiSelect|v4-rule-group|v4-pack-rule-fields/);
  assert.doesNotMatch(stylesSource, /\.v4-rule-group|\.v4-pack-rule-fields|select\[multiple\]/);
});

test('nested Pack control clicks stay inside the Pack adapter boundary', async () => {
  const workspace = await emptyWorkspace();
  workspace.addOptionalPart({
    part: {
      id: 'hat',
      name: 'Hat',
      items: [{ id: 'cap', name: 'Cap', styles: [] }],
    },
  });
  const events = new Map();
  const root = {
    innerHTML: '',
    addEventListener(type, listener) { events.set(type, listener); },
    removeEventListener(type) { events.delete(type); },
    querySelector() { return { focus() {} }; },
  };
  const workspaceBoundary = {};
  const button = {
    dataset: {
      action: 'edit-pack-selection-rules',
      ruleOwner: 'hat::cap',
      ruleOwnerType: 'item',
    },
    closest(selector) {
      return selector === '[data-expansion-pack-workspace]' ? workspaceBoundary : null;
    },
  };
  const nestedIcon = {
    dataset: {},
    closest(selector) {
      if (selector === '[data-expansion-pack-workspace]') return workspaceBoundary;
      if (selector === '[data-action]') return button;
      return null;
    },
  };
  const sections = [];
  let stops = 0;
  const mounted = mountExpansionPackWorkspace(root, workspace, {
    onSectionChange: (...args) => sections.push(args),
  });
  events.get('click')({ target: nestedIcon, stopPropagation() { stops += 1; } });
  assert.equal(stops, 1);
  assert.equal(sections[0][0], 'rules');
  assert.deepEqual(sections[0][1], { owner: 'hat::cap', ownerType: 'item' });
  assert.match(root.innerHTML, /data-active-section="rules"/);

  const plainChild = {
    dataset: {},
    closest(selector) {
      return selector === '[data-expansion-pack-workspace]' ? workspaceBoundary : null;
    },
  };
  events.get('click')({ target: plainChild, stopPropagation() { stops += 1; } });
  assert.equal(stops, 2, 'even non-action clicks stop at the Pack boundary');
  mounted.unmount();
});

test('merged preview re-renders automatically after every Pack delta mutation', async () => {
  const workspace = await emptyWorkspace();
  const events = new Map();
  const root = {
    innerHTML: '',
    addEventListener(type, listener) { events.set(type, listener); },
    removeEventListener(type) { events.delete(type); },
  };
  const previews = [];
  const mounted = mountExpansionPackWorkspace(root, workspace, {
    onRendered: (preview) => previews.push(preview),
  });
  assert.equal(previews.length, 1);
  workspace.addOptionalPart({ part: { id: 'hat', name: 'Hat', items: [] } });
  assert.equal(previews.length, 2);
  assert.equal(previews.at(-1).additions.optionalParts, 1);
  assert.equal((root.innerHTML.match(/data-expansion-pack-preview-canvas/g) || []).length, 1);
  assert.doesNotMatch(root.innerHTML, /data-action="open-preview"/);
  mounted.unmount();
});

test('renders per-Style PNG and render controls, delegating PNG parsing to the host', async () => {
  const workspace = await emptyWorkspace();
  workspace.addItem({
    partId: 'body',
    item: {
      id: 'armor',
      name: 'Armor',
      styles: [{
        id: 'default',
        name: 'Default Armor',
        assetId: 'body-art',
        layerTrackId: 'body-track',
      }],
    },
  });
  workspace.addOptionalPart({
    part: {
      id: 'hat',
      name: 'Hat',
      items: [{
        id: 'cap',
        name: 'Cap',
        styles: [{
          id: 'default',
          name: 'Default Cap',
          assetId: 'body-art',
          layerTrackId: 'body-track',
        }],
      }],
    },
  });
  const html = renderExpansionPackWorkspaceHtml(workspace.getState());
  assert.match(html, /data-asset-request="true"/);
  assert.match(html, /data-style-field="transform\.x"/);
  assert.match(html, /data-style-field="transform\.y"/);
  assert.match(html, /data-style-field="transform\.scale"/);
  assert.match(html, /data-style-field="transform\.rotation"/);
  assert.match(html, /data-style-field="opacity"/);
  assert.match(html, /data-style-field="blendMode"/);
  assert.match(html, /data-action="delete-pack-style"/);
  assert.match(html, /data-action="delete-pack-item"/);
  assert.match(html, /data-action="delete-pack-part"/);
  assert.match(html, /data-action="request-commerce-rights"/);
  assert.doesNotMatch(html, /data-pack-commerce-field=/);
  assert.doesNotMatch(html, /<select[^>]*pack-commerce/i);

  const events = new Map();
  const root = {
    innerHTML: '',
    addEventListener(type, listener) { events.set(type, listener); },
    removeEventListener(type) { events.delete(type); },
  };
  const assetRequests = [];
  const errors = [];
  const mounted = mountExpansionPackWorkspace(root, workspace, {
    onError: (error) => errors.push(error),
    onRequestAsset: (request) => {
      assetRequests.push(request);
      return {
        assetId: 'armor-upload-art',
        asset: {
          id: 'armor-upload-art',
          identifier: 'armor-upload.png',
          contentHash: 'armor-upload-hash',
          mediaType: 'image/png',
        },
      };
    },
  });
  const file = { name: 'armor-upload.png', type: 'image/png' };
  const fileTarget = {
    files: [file],
    value: '/fake/armor-upload.png',
    dataset: {
      assetRequest: 'true',
      partId: 'body',
      itemId: 'armor',
      styleId: 'default',
    },
  };
  events.get('change')({ target: fileTarget });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(errors.length, 0);
  assert.equal(assetRequests.length, 1);
  assert.equal(assetRequests[0].file, file);
  assert.equal(fileTarget.value, '');
  let state = workspace.getState();
  assert.equal(state.tree.parts[0].items[0].styles[0].assetId, 'armor-upload-art');
  assert.ok(state.project.pack.assets.some((asset) => asset.id === 'armor-upload-art'));

  events.get('change')({
    target: {
      value: '-33',
      dataset: {
        styleField: 'transform.x',
        partId: 'body',
        itemId: 'armor',
        styleId: 'default',
      },
    },
  });
  events.get('change')({
    target: {
      value: 'multiply',
      dataset: {
        styleField: 'blendMode',
        partId: 'body',
        itemId: 'armor',
        styleId: 'default',
      },
    },
  });
  state = workspace.getState();
  assert.equal(state.tree.parts[0].items[0].styles[0].transform.x, -33);
  assert.equal(state.tree.parts[0].items[0].styles[0].blendMode, 'multiply');

  events.get('click')({
    target: {
      dataset: { action: 'delete-pack-style', partId: 'body', itemId: 'armor', styleId: 'default' },
    },
  });
  state = workspace.getState();
  assert.deepEqual(state.tree.parts[0].items[0].styles, []);
  mounted.unmount();
});

test('commits a deferred Style asset only while the exact unlocked workspace snapshot is still mounted', async () => {
  const scenarios = [
    { name: 'normal', invalidate() {}, committed: true },
    {
      name: 'stale mutation',
      invalidate({ workspace }) { workspace.renamePack('Changed while parsing'); },
      committed: false,
    },
    {
      name: 'removed style',
      invalidate({ workspace }) { workspace.removeStyle('body', 'armor', 'default'); },
      committed: false,
      styleRemoved: true,
    },
    {
      name: 'publication lock',
      invalidate({ publication }) { publication.locked = true; },
      committed: false,
    },
    {
      name: 'unmounted',
      invalidate({ mounted }) { mounted.unmount(); },
      committed: false,
    },
  ];

  for (const scenario of scenarios) {
    const workspace = await emptyWorkspace();
    workspace.addItem({
      partId: 'body',
      item: {
        id: 'armor',
        name: 'Armor',
        styles: [{ id: 'default', name: 'Default', assetId: 'body-art', layerTrackId: 'body-track' }],
      },
    });
    const events = new Map();
    const root = {
      innerHTML: '',
      addEventListener(type, listener) { events.set(type, listener); },
      removeEventListener(type) { events.delete(type); },
    };
    const publication = { locked: false };
    const upload = deferred();
    const committed = [];
    const discarded = [];
    const mounted = mountExpansionPackWorkspace(root, workspace, {
      copy: () => ({ publicationState: publication }),
      onRequestAsset: () => upload.promise,
      onAssetCommitted: (value) => committed.push(value.assetId),
      onAssetDiscarded: (value) => discarded.push(value.assetId),
    });
    events.get('change')({
      target: {
        files: [{ name: `${scenario.name}.png`, type: 'image/png' }],
        value: '/fake/upload.png',
        dataset: { assetRequest: 'true', partId: 'body', itemId: 'armor', styleId: 'default' },
      },
    });
    scenario.invalidate({ workspace, publication, mounted });
    upload.resolve({
      assetId: `asset-${scenario.name}`,
      asset: {
        id: `asset-${scenario.name}`,
        identifier: `${scenario.name}.png`,
        contentHash: `hash-${scenario.name}`,
        mediaType: 'image/png',
      },
    });
    await new Promise((resolve) => setImmediate(resolve));

    const state = workspace.getState();
    const style = state.tree.parts[0].items[0].styles[0];
    assert.equal(Boolean(style?.assetId === `asset-${scenario.name}`), scenario.committed, scenario.name);
    assert.equal(state.project.pack.assets.some((asset) => asset.id === `asset-${scenario.name}`), scenario.committed, scenario.name);
    assert.deepEqual(committed, scenario.committed ? [`asset-${scenario.name}`] : [], scenario.name);
    assert.deepEqual(discarded, scenario.committed ? [] : [`asset-${scenario.name}`], scenario.name);
    mounted.unmount();
  }
});

test('discards a canceled deferred Style asset without attaching its descriptor', async () => {
  const workspace = await emptyWorkspace();
  workspace.addItem({
    partId: 'body',
    item: {
      id: 'armor',
      name: 'Armor',
      styles: [{ id: 'default', name: 'Default', assetId: 'body-art', layerTrackId: 'body-track' }],
    },
  });
  const events = new Map();
  const root = {
    innerHTML: '',
    addEventListener(type, listener) { events.set(type, listener); },
    removeEventListener(type) { events.delete(type); },
  };
  const upload = deferred();
  const discarded = [];
  const mounted = mountExpansionPackWorkspace(root, workspace, {
    onRequestAsset: () => upload.promise,
    onAssetDiscarded: (value) => discarded.push(value.assetId),
  });
  events.get('change')({
    target: {
      files: [{ name: 'cancel.png', type: 'image/png' }],
      value: '/fake/cancel.png',
      dataset: { assetRequest: 'true', partId: 'body', itemId: 'armor', styleId: 'default' },
    },
  });
  upload.resolve({
    canceled: true,
    assetId: 'canceled-asset',
    asset: { id: 'canceled-asset', identifier: 'cancel.png', mediaType: 'image/png' },
  });
  await new Promise((resolve) => setImmediate(resolve));

  const state = workspace.getState();
  assert.equal(state.tree.parts[0].items[0].styles[0].assetId, 'body-art');
  assert.equal(state.project.pack.assets.some((asset) => asset.id === 'canceled-asset'), false);
  assert.deepEqual(discarded, ['canceled-asset']);
  mounted.unmount();
});

test('Pack Studio commerce summary is read-only and delegates navigation to its host', async () => {
  const workspace = await emptyWorkspace();
  const events = new Map();
  const root = {
    innerHTML: '',
    addEventListener(type, listener) { events.set(type, listener); },
    removeEventListener(type) { events.delete(type); },
  };
  const requests = [];
  const mounted = mountExpansionPackWorkspace(root, workspace, {
    onRequestCommerceRights: (state) => requests.push(state.identity.packId),
  });

  assert.match(root.innerHTML, />Commerce &amp; Rights</);
  assert.doesNotMatch(root.innerHTML, /data-pack-commerce-field=/);
  events.get('click')({ target: { dataset: { action: 'request-commerce-rights' } } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(requests, ['moon-pack']);
  assert.equal(workspace.getState().dirty, true, 'navigation cannot mutate commerce or persistence state');
  mounted.unmount();
});

test('authors Pack-owned tracks, Smart Color, rules and wardrobe without mutating parent definitions', async () => {
  const composableParent = baseMaker();
  composableParent.extensions = {
    composableV6: {
      profile: { mode: 'COMPOSABLE' },
      compatibility: {
        canvas: { width: 1024, height: 1024 },
        layerTrackIds: ['body-track'],
        slots: [],
      },
    },
  };
  const workspace = await emptyWorkspace({ parentMaker: composableParent });
  workspace.addOptionalPart({ part: { id: 'hat', name: 'Hat', items: [] } });
  workspace.addItem({
    partId: 'hat',
    item: {
      id: 'cap',
      name: 'Cap',
      styles: [{ id: 'default', name: 'Default', assetId: 'body-art', layerTrackId: 'body-track' }],
    },
  });

  workspace.addLayerTrack({ id: 'back', name: 'Back' });
  workspace.addLayerTrack({ id: 'front', name: 'Front' });
  workspace.renameLayerTrack('front', 'Foreground');
  workspace.moveLayerTrack('front', 0);
  workspace.setLayerTrackLocked('front', true);
  workspace.updateStyle('hat', 'cap', 'default', { layerTrackId: 'back' });
  workspace.addColorChannel({
    id: 'cloth',
    name: 'Cloth',
    swatches: [{
      id: 'blue',
      name: 'Blue',
      hintColor: '#3366ff',
      stops: [{ offset: 0, color: '#112244' }, { offset: 1, color: '#88aaff' }],
    }],
  });
  workspace.addColorSwatch('cloth', {
    id: 'red',
    name: 'Red',
    hintColor: '#ff3355',
    stops: [{ offset: 0, color: '#441122' }, { offset: 1, color: '#ff8899' }],
  });
  workspace.updateColorChannel('cloth', { defaultSwatchId: 'red' });
  workspace.updateColorSwatch('cloth', 'red', { name: 'Rose' });
  workspace.updateStyle('hat', 'cap', 'default', { colorChannelId: 'cloth' });
  workspace.addRule({
    id: 'cap-rule',
    type: 'excludes',
    trigger: { scope: 'pack', partId: 'hat', itemId: 'cap' },
    targets: [{ scope: 'base', partId: 'body', itemId: 'body-default' }],
  });
  workspace.updateRule('cap-rule', { type: 'requires' });
  workspace.updatePartRules('hat', { visibleWhen: { scope: 'base', partId: 'body', op: 'selected' } });
  workspace.updateItemRules('hat', 'cap', { requires: [{ scope: 'base', partId: 'body' }] });
  workspace.updateStyleRules('hat', 'cap', 'default', { excludes: [{ scope: 'base', partId: 'body', itemId: 'body-default' }] });
  workspace.setPartMode('hat', 'SLOT');

  let state = workspace.getState();
  assert.deepEqual(state.tree.layerTracks.map((track) => [track.id, track.name, track.locked]), [
    ['front', 'Foreground', true],
    ['back', 'Back', false],
  ]);
  assert.equal(state.tree.colorChannels[0].defaultSwatchId, 'red');
  assert.equal(state.tree.colorChannels[0].swatches[1].name, 'Rose');
  assert.equal(state.tree.parts[0].items[0].styles[0].layerTrackId, 'back');
  assert.equal(state.tree.parts[0].items[0].styles[0].colorChannelId, 'cloth');
  assert.equal(state.tree.rules[0].type, 'requires');
  assert.equal(state.tree.parts[0].wardrobeMode, 'SLOT');
  assert.equal(state.parent.layerTracks[0].name, 'Body');
  assert.deepEqual(state.parent.colorChannels, []);
  assert.deepEqual(state.parent.rules, []);

  workspace.removeRule('cap-rule');
  workspace.updateStyle('hat', 'cap', 'default', { colorChannelId: null });
  workspace.removeColorSwatch('cloth', 'blue');
  workspace.removeColorChannel('cloth');
  workspace.updateStyle('hat', 'cap', 'default', { layerTrackId: 'body-track' });
  workspace.setLayerTrackLocked('front', false);
  workspace.removeLayerTrack('front');
  workspace.removeLayerTrack('back');
  state = workspace.getState();
  assert.deepEqual(state.tree.layerTracks, []);
  assert.deepEqual(state.tree.colorChannels, []);
  assert.deepEqual(state.tree.rules, []);
});

test('shared checkbox edits retain every global and embedded target', async () => {
  const workspace = await emptyWorkspace();
  workspace.addOptionalPart({
    part: {
      id: 'hat',
      name: 'Hat',
      items: [{
        id: 'cap',
        name: 'Cap',
        styles: [{ id: 'default', name: 'Default', assetId: 'body-art', layerTrackId: 'body-track' }],
      }],
    },
  });
  const bodyPart = { scope: 'base', partId: 'body' };
  const bodyItem = { scope: 'base', partId: 'body', itemId: 'body-default' };
  workspace.addRule({
    id: 'two-targets',
    type: 'excludes',
    trigger: { scope: 'pack', partId: 'hat', itemId: 'cap' },
    targets: [bodyPart, bodyItem],
  });
  workspace.updateStyleRules('hat', 'cap', 'default', { excludes: [bodyPart, bodyItem] });
  const events = new Map();
  const root = {
    innerHTML: '',
    addEventListener(type, listener) { events.set(type, listener); },
    removeEventListener(type) { events.delete(type); },
  };
  const mounted = mountExpansionPackWorkspace(root, workspace, {
    activeSection: 'rules',
    selectedPackRuleId: 'two-targets',
  });
  assert.match(root.innerHTML, /data-pack-rule-editor/);
  assert.doesNotMatch(root.innerHTML, /v4-rule-group|<select[^>]*multiple|data-rule-field=/);
  events.get('change')({
    target: {
      checked: false,
      value: 'base|body||',
      dataset: { action: 'pack-rule-target-choice', ruleId: 'two-targets' },
    },
  });
  events.get('change')({
    target: {
      checked: true,
      value: 'base|body||',
      dataset: { action: 'pack-rule-target-choice', ruleId: 'two-targets' },
    },
  });
  events.get('click')({
    target: {
      dataset: {
        action: 'edit-pack-selection-rules',
        ruleOwner: 'hat::cap::default',
        ruleOwnerType: 'style',
      },
    },
    stopPropagation() {},
  });
  events.get('change')({
    target: {
      checked: false,
      value: 'base|body||',
      dataset: {
        action: 'pack-definition-rule-target-choice',
        definitionRuleField: 'excludes',
        definitionKind: 'style',
        partId: 'hat',
        itemId: 'cap',
        styleId: 'default',
      },
    },
  });
  events.get('change')({
    target: {
      checked: true,
      value: 'base|body||',
      dataset: {
        action: 'pack-definition-rule-target-choice',
        definitionRuleField: 'excludes',
        definitionKind: 'style',
        partId: 'hat',
        itemId: 'cap',
        styleId: 'default',
      },
    },
  });
  const state = workspace.getState();
  assert.deepEqual(new Set(state.tree.rules[0].targets.map(JSON.stringify)), new Set([bodyPart, bodyItem].map(JSON.stringify)));
  assert.deepEqual(new Set(state.tree.parts[0].items[0].styles[0].rules.excludes.map(JSON.stringify)), new Set([bodyPart, bodyItem].map(JSON.stringify)));
  mounted.unmount();
});

test('other rule edits preserve all/any/not visibility logic and advanced conditions stay read-only', async () => {
  const workspace = await emptyWorkspace();
  workspace.addOptionalPart({
    part: {
      id: 'hat',
      name: 'Hat',
      items: [{
        id: 'cap',
        name: 'Cap',
        styles: [{ id: 'default', name: 'Default', assetId: 'body-art', layerTrackId: 'body-track' }],
      }],
    },
  });
  const advanced = {
    op: 'all',
    conditions: [
      { op: 'selected', scope: 'base', partId: 'body' },
      {
        op: 'any',
        conditions: [
          { op: 'selected', scope: 'base', partId: 'body', itemId: 'body-default' },
          { op: 'not', condition: { op: 'selected', scope: 'pack', partId: 'hat', itemId: 'cap' } },
        ],
      },
    ],
  };
  workspace.updateStyleRules('hat', 'cap', 'default', { visibleWhen: advanced });
  const events = new Map();
  const root = {
    innerHTML: '',
    addEventListener(type, listener) { events.set(type, listener); },
    removeEventListener(type) { events.delete(type); },
  };
  const mounted = mountExpansionPackWorkspace(root, workspace, {
    activeSection: 'rules',
    ruleOwner: 'hat::cap::default',
    ruleOwnerType: 'style',
  });
  assert.match(root.innerHTML, /Advanced condition · read only/);
  assert.match(root.innerHTML, /data-pack-definition-rule-editor[^>]*data-rule-advanced="true"/);
  assert.doesNotMatch(root.innerHTML, /data-definition-rules|v4-rule-group|<select[^>]*multiple/);
  events.get('change')({
    target: {
      checked: true,
      value: 'base|body||',
      dataset: {
        action: 'pack-definition-rule-target-choice',
        definitionRuleField: 'requires',
        definitionKind: 'style',
        partId: 'hat',
        itemId: 'cap',
        styleId: 'default',
      },
    },
  });
  events.get('change')({
    target: {
      checked: true,
      value: 'selected',
      dataset: {
        action: 'pack-visibility-target-choice',
        visibilityOp: 'selected',
        definitionKind: 'style',
        partId: 'hat',
        itemId: 'cap',
        styleId: 'default',
      },
    },
  });
  const styleRules = workspace.getState().tree.parts[0].items[0].styles[0].rules;
  assert.deepEqual(styleRules.visibleWhen, advanced);
  assert.deepEqual(styleRules.requires, [{ scope: 'base', partId: 'body' }]);
  mounted.unmount();
});

test('simple Pack rule edits preserve hidden multi-target selectors and nested visibility siblings', async () => {
  const workspace = await emptyWorkspace();
  workspace.addOptionalPart({
    part: {
      id: 'hat',
      name: 'Hat',
      items: [{
        id: 'cap',
        name: 'Cap',
        styles: [{ id: 'default', name: 'Default', assetId: 'body-art', layerTrackId: 'body-track' }],
      }],
    },
  });
  const multiTarget = {
    scope: 'base',
    partId: 'body',
    itemIds: ['body-default'],
  };
  const nestedVisibility = {
    op: 'all',
    conditions: [
      { op: 'selected', scope: 'base', partId: 'body' },
      { op: 'not', condition: { op: 'selected', scope: 'base', partId: 'body', itemIds: ['body-default'] } },
    ],
  };
  workspace.updateStyleRules('hat', 'cap', 'default', {
    requires: [multiTarget],
    visibleWhen: nestedVisibility,
  });
  workspace.addRule({
    id: 'complex-global',
    type: 'excludes',
    trigger: { scope: 'pack', partId: 'hat', itemId: 'cap' },
    targets: [multiTarget],
  });
  const events = new Map();
  const root = {
    innerHTML: '',
    addEventListener(type, listener) { events.set(type, listener); },
    removeEventListener(type) { events.delete(type); },
  };
  const mounted = mountExpansionPackWorkspace(root, workspace, {
    activeSection: 'rules',
    selectedPackRuleId: 'complex-global',
  });
  assert.match(root.innerHTML, /data-rule-advanced="true"/);
  events.get('change')({
    target: {
      checked: true,
      value: 'base|body||',
      dataset: { action: 'pack-rule-target-choice', ruleId: 'complex-global' },
    },
  });
  events.get('click')({
    target: {
      dataset: {
        action: 'edit-pack-selection-rules',
        ruleOwner: 'hat::cap::default',
        ruleOwnerType: 'style',
      },
    },
    stopPropagation() {},
  });
  assert.doesNotMatch(root.innerHTML, /value="base\|body\|\|" checked[^>]*data-definition-rule-field="requires"/);
  events.get('change')({
    target: {
      checked: true,
      value: 'base|body||',
      dataset: {
        action: 'pack-definition-rule-target-choice',
        definitionRuleField: 'requires',
        definitionKind: 'style',
        partId: 'hat',
        itemId: 'cap',
        styleId: 'default',
      },
    },
  });
  const rules = workspace.getState().tree.parts[0].items[0].styles[0].rules;
  assert.deepEqual(workspace.getState().tree.rules[0].targets, [
    multiTarget,
    { scope: 'base', partId: 'body' },
  ]);
  assert.deepEqual(rules.requires, [multiTarget, { scope: 'base', partId: 'body' }]);
  assert.deepEqual(rules.visibleWhen, nestedVisibility);
  mounted.unmount();
});

test('definition tabs expose structured editors, retain local active state and support keyboard navigation', async () => {
  const workspace = await emptyWorkspace();
  workspace.addOptionalPart({ part: { id: 'hat', name: 'Hat', items: [] } });
  workspace.addItem({
    partId: 'hat',
    item: { id: 'cap', name: 'Cap', styles: [{ id: 'default', name: 'Default', assetId: 'body-art', layerTrackId: 'body-track' }] },
  });
  workspace.addLayerTrack({ id: 'hat-track', name: 'Hat Track' });
  const events = new Map();
  const focused = [];
  const root = {
    innerHTML: '',
    addEventListener(type, listener) { events.set(type, listener); },
    removeEventListener(type) { events.delete(type); },
    querySelector(selector) { return { focus() { focused.push(selector); } }; },
  };
  const sections = [];
  const mounted = mountExpansionPackWorkspace(root, workspace, {
    onSectionChange: (section) => sections.push(section),
  });

  assert.match(root.innerHTML, /role="tablist"/);
  assert.match(root.innerHTML, /data-section="structure"/);
  assert.match(root.innerHTML, /data-section="layers"/);
  assert.match(root.innerHTML, /data-section="colors"/);
  assert.match(root.innerHTML, /data-section="rules"/);
  assert.match(root.innerHTML, /data-section="wardrobe"/);
  assert.match(root.innerHTML, /data-action="request-add-item"/);
  assert.match(root.innerHTML, /data-style-field="layerTrackId"/);
  assert.match(root.innerHTML, /option value="body-track" selected/);
  assert.match(root.innerHTML, /option value="hat-track"/);
  assert.doesNotMatch(root.innerHTML, /<textarea/);

  events.get('click')({
    target: { dataset: { action: 'select-pack-section', section: 'layers' } },
    stopPropagation() {},
  });
  assert.match(root.innerHTML, /data-active-section="layers"/);
  assert.match(root.innerHTML, /Parent definitions · read only/);
  assert.match(root.innerHTML, /data-action="add-layer-track"/);

  events.get('click')({ target: { dataset: { action: 'add-layer-track' } }, stopPropagation() {} });
  assert.equal(workspace.getState().tree.layerTracks[1].id, 'track-2');
  assert.match(root.innerHTML, /data-track-id="track-2"/);

  events.get('keydown')({
    key: 'ArrowRight',
    target: { dataset: { section: 'layers' } },
    preventDefault() {},
  });
  assert.match(root.innerHTML, /data-active-section="colors"/);
  assert.deepEqual(sections, ['layers', 'colors']);
  assert.equal(focused.length, 2);

  events.get('click')({ target: { dataset: { action: 'select-pack-section', section: 'structure' } }, stopPropagation() {} });
  events.get('change')({
    target: {
      value: 'hat-track',
      dataset: { styleField: 'layerTrackId', partId: 'hat', itemId: 'cap', styleId: 'default' },
    },
  });
  assert.equal(workspace.getState().tree.parts[0].items[0].styles[0].layerTrackId, 'hat-track');

  events.get('click')({ target: { dataset: { action: 'select-pack-section', section: 'wardrobe' } }, stopPropagation() {} });
  assert.match(root.innerHTML, /data-action="set-pack-part-mode"/);
  mounted.unmount();
  assert.equal(events.size, 0);
});

test('Wardrobe Slot stays disabled when the exact parent lacks Composable v6 compatibility', async () => {
  const workspace = await emptyWorkspace();
  workspace.addOptionalPart({ part: { id: 'hat', name: 'Hat', items: [] } });
  const events = new Map();
  const root = {
    innerHTML: '',
    addEventListener(type, listener) { events.set(type, listener); },
    removeEventListener(type) { events.delete(type); },
  };
  const mounted = mountExpansionPackWorkspace(root, workspace, { activeSection: 'wardrobe' });
  assert.equal(workspace.getState().tree.supportsComposableV6, false);
  assert.match(root.innerHTML, /Wardrobe Slot requires a parent Maker with Composable v6 compatibility/);
  assert.match(root.innerHTML, /data-mode="SLOT"[^>]*disabled/);
  events.get('click')({
    target: { dataset: { action: 'set-pack-part-mode', partId: 'hat', mode: 'SLOT' } },
    stopPropagation() {},
  });
  assert.equal(workspace.getState().tree.parts[0].wardrobeMode, 'FIXED');
  mounted.unmount();
});

test('deterministic Color add uses localized default swatch copy', async () => {
  const workspace = await emptyWorkspace();
  const events = new Map();
  const root = {
    innerHTML: '',
    addEventListener(type, listener) { events.set(type, listener); },
    removeEventListener(type) { events.delete(type); },
  };
  const mounted = mountExpansionPackWorkspace(root, workspace, {
    copy: { defaultSwatch: '默认色板' },
  });
  events.get('click')({ target: { dataset: { action: 'add-color-channel' } }, stopPropagation() {} });
  assert.equal(workspace.getState().tree.colorChannels[0].swatches[0].name, '默认色板');
  mounted.unmount();
});

test('new Pack rule starts with distinct Pack trigger and inherited target', async () => {
  const workspace = await emptyWorkspace();
  workspace.addOptionalPart({ part: { id: 'hat', name: 'Hat', items: [] } });
  workspace.addItem({
    partId: 'hat',
    item: { id: 'cap', name: 'Cap', styles: [{ id: 'default', name: 'Default', assetId: 'body-art', layerTrackId: 'body-track' }] },
  });
  const events = new Map();
  const root = {
    innerHTML: '',
    addEventListener(type, listener) { events.set(type, listener); },
    removeEventListener(type) { events.delete(type); },
    querySelector() { return { focus() {} }; },
  };
  const mounted = mountExpansionPackWorkspace(root, workspace);

  events.get('click')({
    target: { dataset: { action: 'select-pack-section', section: 'rules' } },
    stopPropagation() {},
  });
  assert.match(root.innerHTML, /data-default-selector="pack\|hat\|cap\|"/);
  assert.match(root.innerHTML, /data-default-target="base\|body\|\|"/);
  events.get('click')({
    target: {
      dataset: {
        action: 'add-pack-rule',
        defaultSelector: 'pack|hat|cap|',
        defaultTarget: 'base|body||',
      },
    },
    stopPropagation() {},
  });

  const [rule] = workspace.getState().tree.rules;
  assert.deepEqual(rule.trigger, { scope: 'pack', partId: 'hat', itemId: 'cap' });
  assert.deepEqual(rule.targets, [{ scope: 'base', partId: 'body' }]);
  assert.notDeepEqual(rule.trigger, rule.targets[0]);
  mounted.unmount();
});

test('publication locking blocks both rendered controls and synthetic mutation events', async () => {
  const workspace = await emptyWorkspace();
  workspace.addOptionalPart({
    part: {
      id: 'hat',
      name: 'Hat',
      items: [{ id: 'cap', name: 'Cap', styles: [] }],
    },
  });
  workspace.addRule({
    id: 'locked-rule',
    type: 'excludes',
    trigger: { scope: 'pack', partId: 'hat', itemId: 'cap' },
    targets: [{ scope: 'base', partId: 'body' }],
  });
  const events = new Map();
  const root = {
    innerHTML: '',
    addEventListener(type, listener) { events.set(type, listener); },
    removeEventListener(type) { events.delete(type); },
  };
  let backRequests = 0;
  let commerceRequests = 0;
  const mounted = mountExpansionPackWorkspace(root, workspace, {
    activeSection: 'rules',
    selectedPackRuleId: 'locked-rule',
    copy: { publicationState: { locked: true } },
    onRequestBackToMaker: () => { backRequests += 1; },
    onRequestCommerceRights: () => { commerceRequests += 1; },
  });
  assert.match(root.innerHTML, /data-publication-locked="true"/);
  assert.match(root.innerHTML, /data-action="request-add-item"[^>]*disabled/);
  assert.match(root.innerHTML, /data-action="request-back-to-maker"[^>]*disabled/);
  assert.match(root.innerHTML, /data-action="request-commerce-rights"[^>]*disabled/);
  assert.match(root.innerHTML, /data-action="save-pack"[^>]*disabled/);
  assert.match(root.innerHTML, /data-rename-kind="pack"[^>]*disabled/);
  assert.match(root.innerHTML, /data-pack-rule-editor/);
  events.get('click')({ target: { dataset: { action: 'add-layer-track' } }, stopPropagation() {} });
  events.get('click')({ target: { dataset: { action: 'request-back-to-maker' } }, stopPropagation() {} });
  events.get('click')({ target: { dataset: { action: 'request-commerce-rights' } }, stopPropagation() {} });
  events.get('click')({
    target: { dataset: { action: 'select-pack-section', section: 'structure' } },
    stopPropagation() {},
  });
  events.get('change')({ target: { value: 'Blocked rename', dataset: { renameKind: 'pack' } } });
  events.get('change')({
    target: {
      checked: true,
      value: 'base|body|body-default|',
      dataset: { action: 'pack-rule-target-choice', ruleId: 'locked-rule' },
    },
  });
  assert.equal(workspace.getState().tree.layerTracks.length, 0);
  assert.equal(workspace.getState().project.name, 'Moon Pack');
  assert.deepEqual(workspace.getState().tree.rules[0].targets, [{ scope: 'base', partId: 'body' }]);
  assert.equal(backRequests, 0);
  assert.equal(commerceRequests, 0);
  assert.match(root.innerHTML, /data-active-section="rules"/);
  mounted.unmount();
});
