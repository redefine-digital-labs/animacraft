import assert from 'node:assert/strict';
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
  assert.match(html, /Soul \/ Living Content/);
  assert.match(html, /Wardrobe compatibility/);
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
  assert.match(html, /Read-only parent Maker/);
  assert.match(html, /Local draft parent/);
  assert.match(html, /Content ready · local parent only|Ready with issues/);
  assert.match(html, /Inherited contract/);
  assert.match(html, /Smart Color/);
  assert.match(html, /data-action="request-add-part"/);
  assert.match(html, /data-action="save-pack"/);
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
  assert.match(html, /data-action="delete-style"/);
  assert.match(html, /data-action="delete-item"/);
  assert.match(html, /data-action="delete-part"/);

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
      dataset: { action: 'delete-style', partId: 'body', itemId: 'armor', styleId: 'default' },
    },
  });
  state = workspace.getState();
  assert.deepEqual(state.tree.parts[0].items[0].styles, []);
  mounted.unmount();
});
