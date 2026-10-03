import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';

import { indexedDB } from 'fake-indexeddb';
import { bindMakerV8SourceAssets } from '../maker-v8-source-asset.js';
import { toBase58, toBase64 } from '@mysten/sui/utils';

import {
  MAKER_V8_PACK_STUDIO_SCHEMA,
  createMakerV8PackStudioV8,
} from '../maker-v8-pack-adapters.js';
import { createMakerV8PackPersistenceV8 } from '../maker-v8-pack-persistence.js';
import { createMakerV8DraftPersistence } from '../maker-v8-draft-store.js';
import { createCharacterMakerV8Starter } from '../maker-v8-document.js';
import { assertPackAuthoring, assertPackAuthoringContent, packAuthoringContent, preparePackEdits, preparePackStructure } from '../maker-v8-pack-authoring.js';
import { prepareCreatorColorChange } from '../maker-v8-creator-colors.js';
import { evaluateMakerV8Visibility } from '../maker-v8-visibility.js';
import { makerV8RuleIssue } from '../maker-v8-rules.js';
import { createMakerV8PackTransportV8 } from '../maker-v8-pack-transport.js';
import { createMakerV8ProductBridge } from '../maker-v8-product-bridge.js';
import { MAKER_V8_DEFAULT_ASSET_BASE64 } from './fixtures/maker-v8-minimal-artwork.js';

const id = (value) => `0x${BigInt(value).toString(16).padStart(64, '0')}`;
const digest = (value) => toBase58(new Uint8Array(32).fill(value));
const hash = (value) => value.repeat(64).slice(0, 64);
const ref = (value) => ({ objectId: id(value), version: String(value), digest: digest(value) });

function bindings() {
  const rootId = id(1);
  const rootVersion = '4';
  const rootContentCommitment = hash('a');
  const owner = id(90);
  const catalogId = id(20);
  const productBindingCommitment = hash('b');
  const callCapSetCommitment = hash('c');
  return {
    root: {
      objectRef: ref(1), makerVersion: rootVersion, contentCommitment: rootContentCommitment,
      lifecycle: 'ACTIVE', owner, adminCapId: id(10), controlEpoch: '2',
    },
    makerAdmin: {
      objectRef: { ...ref(10), objectId: id(10) }, protocolVersion: 8,
      rootId, owner, controlEpoch: '2',
    },
    definitionRegistry: {
      objectRef: ref(2), rootId, rootVersion, rootContentCommitment,
      baseRegistryId: id(3), sealed: true, admissionCeiling: 'OPEN',
    },
    baseRegistry: {
      objectRef: ref(3), rootId, makerVersion: rootVersion,
      rootContentCommitment, sealed: true,
    },
    packRegistry: {
      objectRef: ref(4), rootId, rootVersion, rootContentCommitment,
      definitionRegistryId: id(2), admissionAuthorityId: id(5),
      admissionPolicyCommitment: hash('d'), revision: '7',
    },
    admissionAuthority: {
      objectRef: ref(5), rootId, rootVersion, rootContentCommitment,
    },
    physicalRegistry: {
      objectRef: ref(6), catalogId, productBindingCommitment, callCapSetCommitment,
      rootId, makerVersion: rootVersion, rootContentCommitment,
      baseRegistryId: id(3), revision: '0',
    },
    marketRegistry: {
      objectRef: ref(7), catalogId, productBindingCommitment, callCapSetCommitment,
      rootId, makerVersion: rootVersion, rootContentCommitment,
      treasuryId: id(8), sealed: true, revision: '0',
    },
    releaseConfig: {
      objectRef: ref(9), catalogId, productBindingCommitment, callCapSetCommitment,
    },
  };
}

function harness({ loadParent = null, transport = null } = {}) {
  const rootId = id(1);
  const calls = { discover: 0, context: 0, bindings: 0 };
  const chain = {
    async discover() {
      calls.discover += 1;
      return [{ binding: { rootId } }];
    },
    async loadContext() {
      calls.context += 1;
      return { root: { objectId: rootId } };
    },
    async loadPackAuthoringContext(root, account) {
      calls.bindings += 1;
      assert.equal(root.objectId, rootId);
      assert.equal(account, id(90));
      return bindings();
    },
  };
  const wallet = { async getCurrentAccount() { return { address: id(90) }; } };
  const persistence = createMakerV8PackPersistenceV8(indexedDB, {
    databaseName: `pack-adapters-${crypto.randomUUID()}`,
  });
  let time = 100;
  const studio = createMakerV8PackStudioV8({
    chain,
    loadParent,
    wallet,
    persistence,
    transport,
    now: () => time++,
  });
  return { studio, persistence, calls, rootId, wallet };
}

test('Pack artwork cannot be persisted by a different connected author', async () => {
  const { studio, persistence, rootId, wallet } = harness();
  try {
    const draft = await studio.createPackDraft({ draftId: 'owned-artwork', rootId,
      metadata: { semanticPackId: 'owned_artwork', name: 'Owned artwork' } });
    wallet.getCurrentAccount = async () => ({ address: id(91) });
    await assert.rejects(studio.upsertAsset({ draftId: draft.draftId, expectedRevision: 1,
      style: { partKey: 'base', itemKey: 'default', styleKey: 'added', layerTrackKey: 'base' },
      asset: { assetId: 'added-png', mediaType: 'image/png', bytesBase64: 'AQ==' } }),
    { code: 'MAKER_V8_PACK_ACCOUNT_DRIFT' });
    assert.deepEqual(await studio.load(draft.draftId), draft);
    assert.deepEqual(await persistence.listAssets(draft.draftId), []);
  } finally { persistence.close(); }
});

test('explicit parent binding verifies exact source, preserves authoring and atomically cold reopens', async () => {
  const parents = createMakerV8DraftPersistence(indexedDB, { databaseName: `rebind-parent-${crypto.randomUUID()}` });
  await parents.createBundle({ draftId: 'parent', document: createCharacterMakerV8Starter(), createdAt: 10,
    assets: [{ assetId: 'base-default', kind: 'layer', mediaType: 'image/png', bytesBase64: 'AA==' }] });
  const parent = await parents.export('parent');
  const certified = { document: bindMakerV8SourceAssets(parent.draft.document, parent.assets),
    assets: parent.assets.map(({ assetId, kind, mediaType, byteLength, sha256 }) => ({ assetId, kind, mediaType, byteLength, sha256 })) };
  let returned = structuredClone(certified);
  let duringRead = async () => {};
  const { studio, persistence, rootId, wallet } = harness({ loadParent: async binding => {
    assert.equal(binding.rootId, rootId); await duringRead(); return returned;
  } });
  const renderInputs = [];
  const pngBytes = Buffer.from(MAKER_V8_DEFAULT_ASSET_BASE64, 'base64');
  const png = { schemaVersion: 'animacraft.maker-v8-player-render.v1', mediaType: 'image/png',
    width: 1, height: 1, bytesBase64: MAKER_V8_DEFAULT_ASSET_BASE64,
    byteLength: pngBytes.length, sha256: createHash('sha256').update(pngBytes).digest('hex') };
  const unavailable = async () => { throw new Error('No remote operation in binding preview test'); };
  const bridge = createMakerV8ProductBridge({ drafts: parents, pack: studio,
    productRuntime: { ready: async () => true,
      catalog: { loadPlaza: unavailable, loadPlayer: unavailable },
      wallet: { getCurrentAccount: async () => ({ ...await wallet.getCurrentAccount(), network: 'mainnet' }), reconnect: unavailable } },
    rendering: { renderDraft: async input => { renderInputs.push(structuredClone(input)); return png; } } });
  const created = await studio.createPackDraft({ draftId: 'child', parent,
    metadata: { semanticPackId: 'child', name: 'Child' } });
  returned.assets[0].sha256 = 'ff'.repeat(32);
  await assert.rejects(studio.bindPublishedParent({ draftId: 'child', expectedRevision: 1, rootId }),
    { code: 'MAKER_V8_PACK_PARENT_CONTENT_MISMATCH' });
  assert.deepEqual(await studio.load('child'), created);
  returned = structuredClone(certified);
  duringRead = async () => { wallet.getCurrentAccount = async () => ({ address: id(91) }); };
  await assert.rejects(studio.bindPublishedParent({ draftId: 'child', expectedRevision: 1, rootId }), { code: 'MAKER_V8_PACK_ACCOUNT_DRIFT' });
  wallet.getCurrentAccount = async () => ({ address: id(90) });
  duringRead = async () => { await studio.save({ draftId: 'child', expectedRevision: 1, fields: { name: 'Concurrent edit' } }); };
  await assert.rejects(studio.bindPublishedParent({ draftId: 'child', expectedRevision: 1, rootId }));
  assert.equal((await studio.load('child')).document.bindings.kind, 'LOCAL_DRAFT');
  duringRead = async () => {};
  const bound = await bridge.bindPackParent({ draftId: 'child', expectedRevision: 2, rootId });
  assert.equal(bound.revision, 3);
  assert.equal(bound.document.bindings.root.objectRef.objectId, rootId);
  assert.deepEqual(bound.document.authoringParent, parent);
  assert.deepEqual(await studio.load('child'), bound);
  assert.deepEqual((await studio.loadPreview('child')).document, parent.draft.document);
  const saved = await studio.save({ draftId: 'child', expectedRevision: 3, fields: { name: 'Bound child' } });
  assert.equal(saved.revision, 4);
  await assert.rejects(studio.bindPublishedParent({ draftId: 'child', expectedRevision: 4, rootId }),
    { code: 'MAKER_V8_PACK_REBIND_INVALID' });
  await assert.rejects(studio.preparePublication({ draftId: 'child', expectedRevision: 4 }));
  const withArtwork = await studio.upsertAsset({ draftId: 'child', expectedRevision: 4,
    style: { partKey: 'base', itemKey: 'default', styleKey: 'child-style',
      layerTrackKey: parent.draft.document.parts[0].items[0].styles[0].trackKey },
    asset: { assetId: 'child-png', mediaType: 'image/png', bytesBase64: MAKER_V8_DEFAULT_ASSET_BASE64 } });
  await persistence.close();
  assert.deepEqual(await bridge.loadPackDraft('child'), withArtwork.draft);
  assert.deepEqual(await bridge.renderPackPreview({ draftId: 'child',
    selection: { partKey: 'base', itemKey: 'default', styleKey: 'child-style' } }), png);
  assert.equal(renderInputs.length, 1);
  assert.equal(renderInputs[0].recipe.selections.find(row => row.partKey === 'base').styleKey, 'child-style');
  assert.equal(renderInputs[0].assets.find(row => row.assetId === 'child-png').bytesBase64, MAKER_V8_DEFAULT_ASSET_BASE64);
  assert.deepEqual(await parents.export('parent'), parent);
  bridge.dispose(); await persistence.close(); await parents.close();
});

test('unpublished parent supports isolated Pack create save reopen without chain discovery or publication', async () => {
  const parents = createMakerV8DraftPersistence(indexedDB, { databaseName: `pack-parent-${crypto.randomUUID()}` });
  const { studio, persistence, calls } = harness();
  try {
    const document = structuredClone(createCharacterMakerV8Starter());
    document.parts[0].items[0].styles[0].transform.x = 1.25;
    await parents.createBundle({ draftId: 'local-parent', document, createdAt: 10,
      assets: [{ assetId: 'base-default', kind: 'layer', mediaType: 'image/png', bytesBase64: 'AA==' }] });
    const parent = await parents.export('local-parent');
    const draft = await studio.createPackDraft({ draftId: 'local-child', parent,
      metadata: { semanticPackId: 'local_child', name: 'Local child' } });
    assert.equal(draft.document.bindings.kind, 'LOCAL_DRAFT');
    assert.equal(draft.document.admission.expectedPackRegistryRevision, null);
    const saved = await studio.save({ draftId: draft.draftId, expectedRevision: 1,
      fields: { name: 'Saved child' } });
    assert.deepEqual(await studio.load(draft.draftId), saved);
    assert.deepEqual(await persistence.load(draft.draftId), saved);
    const changedParent = structuredClone(document);
    changedParent.metadata.summary = 'Changed after capture';
    await parents.compareAndSwap({ draftId: 'local-parent', expectedRevision: 1,
      document: changedParent, updatedAt: 20 });
    assert.deepEqual((await studio.load(draft.draftId)).document.bindings.parent, parent);
    assert.equal((await studio.preview(draft.draftId)).rootId, null);
    assert.equal((await studio.export(draft.draftId)).draft.revision, 2);
    await assert.rejects(studio.preparePublication({ draftId: draft.draftId, expectedRevision: 2 }),
      { code: 'MAKER_V8_PACK_PARENT_NOT_PUBLISHED' });
    assert.deepEqual(calls, { discover: 0, context: 0, bindings: 0 });
    const broken = structuredClone(parent); broken.draftSha256 = '0'.repeat(64);
    await assert.rejects(studio.createPackDraft({ draftId: 'bad-child', parent: broken,
      metadata: { semanticPackId: 'bad_child', name: 'Bad' } }));
    assert.equal(await persistence.load('bad-child'), null);
  } finally { parents.close(); persistence.close(); }
});

test('Pack economics save exact fields and reject invalid changes without altering the parent', async () => {
  const parents = createMakerV8DraftPersistence(indexedDB, { databaseName: `pack-economics-${crypto.randomUUID()}` });
  const { studio, persistence, calls } = harness();
  try {
    await parents.createBundle({ draftId: 'economic-parent', document: createCharacterMakerV8Starter(), createdAt: 10,
      assets: [{ assetId: 'base-default', kind: 'layer', mediaType: 'image/png', bytesBase64: 'AA==' }] });
    const parent = await parents.export('economic-parent');
    let draft = await studio.createPackDraft({ draftId: 'economic-child', parent,
      metadata: { semanticPackId: 'economic_child', name: 'Economic child' } });
    for (const fields of [
      { accessKind: 'PAID', accessPriceAtomic: '999999999999', completeMode: 'FREE_QUOTA_THEN_PAID', completePriceAtomic: '25', freeQuotaPerWallet: '3', totalCap: '8' },
      { accessKind: 'INCLUDED_WITH_MAKER', accessPriceAtomic: '0', completeMode: 'FREE_QUOTA_THEN_BLOCK', completePriceAtomic: '0', freeQuotaPerWallet: '3', totalCap: '8' },
      { accessKind: 'FREE', accessPriceAtomic: '0', completeMode: 'PAID_EVERY_TIME', completePriceAtomic: '25', freeQuotaPerWallet: '0', totalCap: '0' },
    ]) {
      draft = await studio.save({ draftId: draft.draftId, expectedRevision: draft.revision, fields });
      persistence.close();
      assert.deepEqual(await studio.load(draft.draftId), draft);
      assert.deepEqual(draft.document.access, { kind: fields.accessKind, priceAtomic: fields.accessPriceAtomic });
      assert.deepEqual(draft.document.completion, { mode: fields.completeMode, priceAtomic: fields.completePriceAtomic,
        freeQuotaPerWallet: fields.freeQuotaPerWallet, totalCap: fields.totalCap });
    }
    for (const fields of [{ accessPriceAtomic: '1' }, { completePriceAtomic: '-1' },
      { completePriceAtomic: '9007199254740993' }, { completePriceAtomic: '1e3' },
      { completeMode: 'FREE_QUOTA_THEN_PAID', freeQuotaPerWallet: '3', totalCap: '2' }]) {
      await assert.rejects(studio.save({ draftId: draft.draftId, expectedRevision: draft.revision, fields }));
      assert.deepEqual(await studio.load(draft.draftId), draft);
    }
    assert.deepEqual(await parents.export('economic-parent'), parent);
    assert.deepEqual(calls, { discover: 0, context: 0, bindings: 0 });
  } finally { parents.close(); persistence.close(); }
});

test('Pack additive Part Item and pending Style persist without changing the parent', async () => {
  const parents = createMakerV8DraftPersistence(indexedDB, { databaseName: `pack-structure-${crypto.randomUUID()}` });
  const { studio, persistence } = harness();
  try {
    const document = structuredClone(createCharacterMakerV8Starter());
    await parents.createBundle({ draftId: 'structure-parent', document, createdAt: 10,
      assets: [{ assetId: 'base-default', kind: 'layer', mediaType: 'image/png', bytesBase64: 'AA==' }] });
    const parent = await parents.export('structure-parent');
    let draft = await studio.createPackDraft({ draftId: 'structure-child', parent,
      metadata: { semanticPackId: 'structure_child', name: 'Structure child' } });
    draft = await studio.save({ draftId: draft.draftId, expectedRevision: draft.revision,
      fields: { structure: { action: 'add-part' } } });
    const partKey = draft.document.authoring.parts.at(-1).key;
    draft = await studio.save({ draftId: draft.draftId, expectedRevision: draft.revision,
      fields: { structure: { action: 'add-item', partKey } } });
    const itemKey = draft.document.authoring.parts.at(-1).items.at(-1).key;
    draft = await studio.save({ draftId: draft.draftId, expectedRevision: draft.revision,
      fields: { structure: { action: 'add-style', partKey, itemKey } } });
    assert.deepEqual(await studio.load(draft.draftId), draft);
    const style = draft.document.authoring.parts.at(-1).items.at(-1).styles.at(-1);
    assert.equal(style.assetId, null);
    const saved = await studio.upsertAsset({ draftId: draft.draftId, expectedRevision: draft.revision,
      style: { partKey, itemKey, styleKey: style.key, layerTrackKey: style.trackKey },
      asset: { assetId: 'child-image', mediaType: 'image/png', bytesBase64: 'AQ==' } });
    assert.equal((await studio.load(draft.draftId)).document.authoring.parts.at(-1).items.at(-1).styles.at(-1).assetId, 'child-image');
    assert.deepEqual(await parents.export('structure-parent'), parent);
    const changed = structuredClone(saved.draft.document);
    changed.authoring.parts[0].label = 'Forbidden parent edit';
    assert.throws(() => assertPackAuthoring(changed), { code: 'MAKER_V8_PACK_AUTHORING_INVALID' });
    await assert.rejects(studio.save({ draftId: draft.draftId, expectedRevision: 1,
      fields: { structure: { action: 'add-part' } } }), { code: 'MAKER_V8_PACK_DRAFT_CAS_MISMATCH' });
    assert.deepEqual(await studio.load(draft.draftId), saved.draft);
    const edits = [
      { kind: 'part', field: 'label', partKey, value: 'Pack Part' },
      { kind: 'item', field: 'label', partKey, itemKey, value: 'Pack Item' },
      { kind: 'style', field: 'label', partKey, itemKey, styleKey: style.key, value: 'Pack Style' },
      ...[['style-x', '12.5'], ['style-scale', '0.5'], ['style-opacity', '75'], ['style-blend', 'multiply']]
        .map(([field, value]) => ({ kind: 'style', field, partKey, itemKey, styleKey: style.key, value })),
    ];
    const edited = await studio.save({ draftId: draft.draftId, expectedRevision: saved.draft.revision, fields: { edits } });
    const cold = await studio.load(draft.draftId);
    assert.deepEqual(cold, edited);
    const editedStyle = cold.document.authoring.parts.at(-1).items.at(-1).styles.at(-1);
    assert.equal(editedStyle.label, 'Pack Style');
    assert.equal(editedStyle.transform.x, 12.5);
    assert.equal(editedStyle.transform.scale, 0.5);
    assert.equal(editedStyle.opacity, 0.75);
    assert.equal(editedStyle.blendMode, 'multiply');
    const preview = await studio.loadPreview(draft.draftId);
    assert.deepEqual(preview.document, cold.document.authoring);
    assert.equal(preview.assets.length, parent.assets.length + 1);
    assert.equal(preview.assets.at(-1).bytesBase64, 'AQ==');
    for (const invalid of [
      { kind: 'part', field: 'label', partKey: document.parts[0].key, value: 'Parent rewrite' },
      { kind: 'style', field: 'style-scale', partKey, itemKey, styleKey: style.key, value: '0' },
      { kind: 'item', field: 'label', partKey, itemKey, value: '' },
    ]) await assert.rejects(studio.save({ draftId: draft.draftId, expectedRevision: edited.revision, fields: { edits: [invalid] } }));
    assert.deepEqual(await studio.load(draft.draftId), edited);
    const withColor = await studio.save({ draftId: draft.draftId, expectedRevision: edited.revision,
      fields: { structure: { action: 'add-channel', partKey, itemKey } } });
    const channelKey = withColor.document.authoring.colors.at(-1).key;
    const bound = await studio.save({ draftId: draft.draftId, expectedRevision: withColor.revision,
      fields: { edits: [
        { kind: 'style', field: 'assign-style-track', partKey, itemKey, styleKey: style.key, value: document.tracks[0].key },
        { kind: 'style', field: 'assign-style-color', partKey, itemKey, styleKey: style.key, value: channelKey },
      ] } });
    const rendered = await studio.loadPreview(draft.draftId);
    const boundStyle = rendered.document.parts.at(-1).items.at(-1).styles.at(-1);
    assert.equal(boundStyle.trackKey, document.tracks[0].key);
    assert.equal(boundStyle.colorChannelKey, channelKey);
    assert.equal(bound.document.styles[0].layerTrackKey, boundStyle.trackKey);
    assert.equal(bound.document.styles[0].colorChannelKey, channelKey);
    assert.equal(bound.document.styles[0].defaultSwatchKey, boundStyle.defaultSwatchKey);
    await assert.rejects(studio.save({ draftId: draft.draftId, expectedRevision: bound.revision,
      fields: { edits: [{ kind: 'style', field: 'assign-style-color', partKey, itemKey, styleKey: style.key, value: 'missing' }] } }));
    assert.deepEqual(await studio.load(draft.draftId), bound);
    const recolored = await studio.save({ draftId: draft.draftId, expectedRevision: bound.revision, fields: { edits: [
      { kind: 'color', field: 'channel-name', channelKey, value: 'Pack palette' },
      { kind: 'color', field: 'swatch-name', channelKey, swatchKey: 'default', value: 'Warm' },
      { kind: 'color', field: 'swatch-hint', channelKey, swatchKey: 'default', value: '#ff6600' },
      { kind: 'color', field: 'swatch-stop', channelKey, swatchKey: 'default', stopIndex: 0, value: '#220000' },
      { kind: 'color', field: 'add-swatch', channelKey },
    ] } });
    const channel = (await studio.load(draft.draftId)).document.authoring.colors.at(-1);
    assert.equal(channel.label, 'Pack palette');
    assert.equal(channel.swatches[0].label, 'Warm');
    assert.equal(channel.swatches[0].rgba, '#ff6600ff');
    assert.equal(channel.swatches[0].stops[0].rgba, '#220000ff');
    assert.equal(channel.swatches.length, 2);
    for (const invalid of [ { field: 'swatch-hint', value: 'red' }, { field: 'swatch-stop', stopIndex: 99, value: '#ff0000' } ]) {
      await assert.rejects(studio.save({ draftId: draft.draftId, expectedRevision: recolored.revision,
        fields: { edits: [{ kind: 'color', channelKey, swatchKey: 'default', ...invalid }] } }));
    }
    assert.deepEqual(await studio.load(draft.draftId), recolored);
    const visibilityEdit = { kind: 'style', field: 'style-visibility', partKey, itemKey, styleKey: style.key };
    const hidden = await studio.save({ draftId: draft.draftId, expectedRevision: recolored.revision, fields: { edits: [{
      ...visibilityEdit, value: { logic: 'all', polarity: 'not-selected', definitions: [`${document.parts[0].key}::${document.parts[0].items[0].key}`] },
    }] } });
    const condition = (await studio.load(draft.draftId)).document.authoring.parts.at(-1).items.at(-1).styles.at(-1).visibleWhen;
    assert.equal(evaluateMakerV8Visibility(condition, hidden.document.authoring.defaultRecipe.selections), false);
    await assert.rejects(studio.save({ draftId: draft.draftId, expectedRevision: hidden.revision,
      fields: { edits: [{ ...visibilityEdit, value: { logic: 'all', polarity: 'selected', definitions: [] } }] } }));
    assert.deepEqual(await studio.load(draft.draftId), hidden);
    const visible = await studio.save({ draftId: draft.draftId, expectedRevision: hidden.revision,
      fields: { edits: [{ ...visibilityEdit, value: null }] } });
    assert.equal(visible.document.authoring.parts.at(-1).items.at(-1).styles.at(-1).visibleWhen, null);
    const ruleEdit = { kind: 'rule', field: 'upsert-rule', ruleKey: 'pack-rule-test', value: {
      ownerDefinition: `${partKey}::${itemKey}::${style.key}`, type: 'excludes', matchMode: 'any',
      definitions: [`${document.parts[0].key}::${document.parts[0].items[0].key}`],
    } };
    const ruled = await studio.save({ draftId: draft.draftId, expectedRevision: visible.revision, fields: { edits: [ruleEdit] } });
    const selections = [...ruled.document.authoring.defaultRecipe.selections.filter(row => row.partKey !== partKey),
      { partKey, itemKey, styleKey: style.key }];
    assert.equal(makerV8RuleIssue(ruled.document.authoring.rules, selections).code, 'MAKER_V8_PLAYER_RULE_EXCLUDE_FAILED');
    const allowed = await studio.save({ draftId: draft.draftId, expectedRevision: ruled.revision,
      fields: { edits: [{ ...ruleEdit, value: { ...ruleEdit.value, type: 'requires', matchMode: 'all' } }] } });
    assert.equal(makerV8RuleIssue((await studio.load(draft.draftId)).document.authoring.rules, selections), null);
    const copiedRuleOwner = preparePackStructure(allowed.document, { action: 'copy-style', partKey, itemKey, styleKey: style.key });
    const copiedStyle = copiedRuleOwner.document.authoring.parts.find(row => row.key === partKey).items.find(row => row.key === itemKey).styles.at(-1);
    assert.deepEqual(copiedStyle.transform, allowed.document.authoring.parts.find(row => row.key === partKey).items.find(row => row.key === itemKey).styles.find(row => row.key === style.key).transform);
    assert.equal(copiedRuleOwner.document.authoring.rules.at(-1).trigger.styleKey, copiedStyle.key);
    assert.deepEqual(copiedRuleOwner.document.authoring.rules.at(-1).targets, allowed.document.authoring.rules.at(-1).targets);
    const authorIntent = packAuthoringContent(allowed.document);
    assert.match(authorIntent.commitment, /^[0-9a-f]{64}$/);
    const scoped = authorIntent.definitions;
    assert.equal(scoped.schemaVersion, 'animacraft.maker-v8-pack-definition-input.v1');
    assert.deepEqual(scoped.parts.map(row => row.key), allowed.document.authoring.parts.slice(document.parts.length).map(row => row.key));
    assert.deepEqual(scoped.rules, allowed.document.authoring.rules.slice(document.rules.length));
    assert.deepEqual(scoped.styles[0].part, { scope: 'PACK_SELF', key: partKey });
    assert.deepEqual(scoped.styles[0].color, { scope: 'PACK_SELF', key: channelKey });
    const mixed = structuredClone(allowed.document);
    const basePart = mixed.authoring.parts[0], baseItem = basePart.items[0];
    const extra = structuredClone(mixed.authoring.parts.find(row => row.key === partKey).items.find(row => row.key === itemKey).styles.find(row => row.key === style.key));
    extra.key = 'pack-in-base'; extra.assetId = 'pack-in-base-asset';
    extra.trackKey = document.tracks[0].key;
    baseItem.styles.push(extra);
    mixed.authoring.assets.push({ ...mixed.authoring.assets.find(row => row.id === mixed.styles[0].asset.assetId), id: extra.assetId });
    mixed.styles.push({ ...structuredClone(mixed.styles[0]), sequence: String(mixed.styles.length),
      partKey: basePart.key, itemKey: baseItem.key, styleKey: extra.key, layerTrackKey: extra.trackKey,
      asset: { ...mixed.styles[0].asset, assetId: extra.assetId } });
    const mixedScope = packAuthoringContent(mixed).definitions.styles.at(-1);
    assert.deepEqual(mixedScope.part, { scope: 'BASE', key: basePart.key });
    assert.deepEqual(mixedScope.track, { scope: 'BASE', key: document.tracks[0].key });
    assert.deepEqual(mixedScope.color, { scope: 'PACK_SELF', key: channelKey });
    const detached = packAuthoringContent(allowed.document);
    detached.definitions.parts[0].label = 'derived consumer mutation';
    assert.deepEqual(detached.content, authorIntent.content);
    assert.deepEqual((await studio.loadPreview(draft.draftId)).authoring, authorIntent);
    assert.deepEqual(authorIntent.content.document, allowed.document.authoring);
    const relocated = structuredClone(allowed.document);
    relocated.styles[0].asset.blobId = 'transport-only-location';
    relocated.bindings.parent.draft.revision += 1;
    assert.equal(packAuthoringContent(relocated).commitment, authorIntent.commitment);
    const variants = [
      preparePackEdits(allowed.document, [{ kind: 'style', field: 'style-x', partKey, itemKey, styleKey: style.key, value: '23.75' }]),
      preparePackEdits(allowed.document, [{ ...ruleEdit, value: { ...ruleEdit.value, type: 'excludes', matchMode: 'any' } }]),
      preparePackStructure(allowed.document, { action: 'add-part' }).document,
      copiedRuleOwner.document,
    ];
    for (const change of [
      doc => { doc.authoring.colors[0].label += ' changed'; },
      doc => { doc.authoring.tracks.at(-1).label += ' changed'; },
      doc => { doc.authoring.parts.at(-1).items.at(-1).styles.at(-1).opacity = 0.25; },
      doc => { doc.authoring.parts.at(-1).items.at(-1).styles.at(-1).blendMode = 'screen'; },
      doc => { doc.authoring.parts.at(-1).items.at(-1).styles.at(-1).visibleWhen = { op: 'selected', source: 'BASE', sourceKey: null, partKey: document.parts[0].key, itemKey: null, styleKey: null }; },
    ]) { const changed = structuredClone(allowed.document); change(changed); variants.push(changed); }
    for (const variant of variants) assert.notEqual(packAuthoringContent(variant).commitment, authorIntent.commitment);
    assert.deepEqual(packAuthoringContent(allowed.document), authorIntent);
    const readIntent = content => assertPackAuthoringContent(content, {
      expectedParent: authorIntent.content.parent, expectedCommitment: authorIntent.commitment });
    assert.deepEqual(readIntent(JSON.parse(JSON.stringify(authorIntent.content))), authorIntent);
    for (const mutate of [
      content => { content.unrecognized = true; },
      content => { content.styles[0].asset.blobId = 'unexpected-transport-field'; },
      content => { content.parent.document.metadata.name += ' forged'; content.document.metadata.name += ' forged'; },
      content => { content.parent.assets[0].sha256 = '0'.repeat(64); },
      content => { content.styles[0].asset.contentCommitment = '0'.repeat(64); },
      content => { content.styles.push(structuredClone(content.styles[0])); },
      content => { content.document.parts.at(-1).label += ' tampered'; },
      content => { content.styles[0].layerTrackKey = 'missing'; },
    ]) {
      const corrupted = structuredClone(authorIntent.content); mutate(corrupted);
      assert.throws(() => readIntent(corrupted), { code: 'MAKER_V8_PACK_AUTHORING_INVALID' });
    }
    assert.throws(() => assertPackAuthoringContent(authorIntent.content), /authenticated parent/);
    await assert.rejects(studio.save({ draftId: draft.draftId, expectedRevision: allowed.revision,
      fields: { edits: [{ ...ruleEdit, value: { ...ruleEdit.value, ownerDefinition: document.parts[0].key, definitions: [partKey] } }] } }),
    { code: 'MAKER_V8_PACK_AUTHORING_INVALID' });
    assert.deepEqual(await studio.load(draft.draftId), allowed);
    const removed = await studio.save({ draftId: draft.draftId, expectedRevision: allowed.revision,
      fields: { edits: [{ kind: 'rule', field: 'remove-rule', ruleKey: 'pack-rule-test' }] } });
    assert.deepEqual((await studio.load(draft.draftId)).document.authoring.rules, parent.draft.document.rules);
    assert.deepEqual(removed.document.styles, allowed.document.styles);
    assert.deepEqual(removed.document.bindings, allowed.document.bindings);
    await assert.rejects(studio.save({ draftId: draft.draftId, expectedRevision: removed.revision,
      fields: { edits: [{ kind: 'rule', field: 'remove-rule', ruleKey: 'missing' }] } }), { code: 'MAKER_V8_PACK_AUTHORING_INVALID' });
    assert.deepEqual(await studio.load(draft.draftId), removed);
    let tracked = await studio.save({ draftId: draft.draftId, expectedRevision: removed.revision,
      fields: { structure: { action: 'add-track' } } });
    const trackKey = tracked.document.authoring.tracks.at(-1).key;
    const editTrack = (field, extra = {}) => ({ kind: 'track', field, trackKey, ...extra });
    tracked = await studio.save({ draftId: draft.draftId, expectedRevision: tracked.revision,
      fields: { edits: [editTrack('track-name', { value: 'Pack Overlay' }), editTrack('move-track', { direction: 'up' }), editTrack('toggle-track-lock')] } });
    assert.deepEqual(await studio.load(draft.draftId), tracked);
    assert.equal(tracked.document.authoring.tracks.find(row => row.key === trackKey).locked, true);
    assert.throws(() => preparePackEdits(tracked.document, [editTrack('track-name', { value: 'Locked edit' })]), /Unlock/);
    assert.throws(() => preparePackEdits(tracked.document, [editTrack('move-track', { direction: 'down' })]), /locked/);
    assert.throws(() => preparePackEdits(tracked.document, [{ ...editTrack('toggle-track-lock'), trackKey: document.tracks[0].key }]), /read-only/);
    assert.throws(() => preparePackEdits(tracked.document, [editTrack('toggle-track-lock'), editTrack('move-track', { direction: 'up' })]), /Inherited/);
    assert.deepEqual(tracked.document.authoring.tracks.slice(0, document.tracks.length), document.tracks);
    for (const action of ['copy-style', 'copy-item', 'copy-part']) {
      const prior = tracked;
      tracked = await studio.save({ draftId: draft.draftId, expectedRevision: prior.revision,
        fields: { structure: { action, partKey, itemKey, styleKey: style.key } } });
      assert.deepEqual(await studio.load(draft.draftId), tracked);
      const added = tracked.document.styles.slice(prior.document.styles.length);
      assert.ok(added.length);
      for (const row of added) {
        const asset = await persistence.loadAsset(draft.draftId, row.asset.assetId);
        assert.equal(asset.bytesBase64, 'AQ==');
        assert.equal(asset.sha256, row.asset.sha256);
        assert.ok(!prior.document.styles.some(old => old.asset.assetId === row.asset.assetId));
      }
      assert.equal((await studio.loadPreview(draft.draftId)).assets.length,
        parent.assets.length + tracked.document.styles.length);
      await assert.rejects(studio.save({ draftId: draft.draftId, expectedRevision: prior.revision,
        fields: { structure: { action, partKey, itemKey, styleKey: style.key } } }), /changed/i);
      assert.deepEqual(await studio.load(draft.draftId), tracked);
    }
    assert.equal((await persistence.listAssets(draft.draftId)).length, tracked.document.styles.length);
    const priorOrder = tracked.document.authoring.parts.map(row => row.key);
    const lastPart = priorOrder.at(-1);
    const reordered = await studio.save({ draftId: draft.draftId, expectedRevision: tracked.revision,
      fields: { structure: { action: 'move-part', partKey: lastPart, direction: 'up' } } });
    assert.equal(reordered.document.authoring.parts.at(-2).key, lastPart);
    assert.deepEqual(reordered.document.styles, tracked.document.styles);
    assert.deepEqual(reordered.document.authoring.rules, tracked.document.authoring.rules);
    assert.deepEqual(await studio.load(draft.draftId), reordered);
    assert.throws(() => preparePackStructure(reordered.document, { action: 'move-part', partKey: lastPart, direction: 'up' }), /Inherited/);
    assert.deepEqual(await parents.export('structure-parent'), parent);
  } finally { parents.close(); persistence.close(); }
});

test('Pack linked Part order respects whole track locks and parent boundaries', () => {
  const parent = createCharacterMakerV8Starter();
  let pack = { styles: [], bindings: { kind: 'LOCAL_DRAFT', parent: { draft: { document: parent } } } };
  pack = preparePackStructure(pack, { action: 'add-part' }).document;
  pack = preparePackStructure(pack, { action: 'add-part' }).document;
  const last = pack.authoring.parts.at(-1), trackKey = last.items[0].styles[0].trackKey;
  const locked = preparePackEdits(pack, [{ kind: 'track', field: 'toggle-track-lock', trackKey }]);
  assert.throws(() => preparePackStructure(locked, { action: 'move-part', partKey: last.key, direction: 'up' }), /locked/);
  const moved = preparePackStructure(pack, { action: 'move-part', partKey: last.key, direction: 'up' }).document;
  assert.equal(moved.authoring.parts.at(-2).key, last.key);
  assert.equal(moved.authoring.tracks.at(-2).key, trackKey);
  const restored = preparePackStructure(moved, { action: 'move-part', partKey: last.key,
    targetKey: pack.authoring.parts.at(-2).key }).document;
  assert.deepEqual(restored, pack);
  assert.throws(() => preparePackStructure(locked, { action: 'move-part', partKey: last.key,
    targetKey: pack.authoring.parts.at(-2).key }), /locked/);
  assert.throws(() => preparePackStructure(pack, { action: 'move-part', partKey: last.key,
    targetKey: parent.parts[0].key }), /Inherited/);
  assert.throws(() => preparePackStructure(pack, { action: 'move-part', partKey: last.key, targetKey: 'missing' }), /target/);
  assert.throws(() => preparePackStructure(moved, { action: 'move-part', partKey: parent.parts[0].key, direction: 'down' }), /read-only/);
  assert.deepEqual(moved.authoring.parts.slice(0, parent.parts.length), parent.parts);
});

test('Pack color edits cannot change inherited channels', () => {
  const parent = prepareCreatorColorChange({ document: createCharacterMakerV8Starter(), action: 'add-channel' }).document;
  const pack = { styles: [], bindings: { kind: 'LOCAL_DRAFT', parent: { draft: { document: parent } } } };
  assert.throws(() => preparePackEdits(pack, [{ kind: 'color', field: 'swatch-hint',
    channelKey: parent.colors[0].key, swatchKey: 'default', value: '#ff0000' }]),
  { code: 'MAKER_V8_PACK_AUTHORING_INVALID' });
});

test('production Pack Studio facade reads exact bindings and persists local artwork with CAS', async () => {
  const { studio, persistence, calls, rootId } = harness();
  assert.equal(studio.schemaVersion, MAKER_V8_PACK_STUDIO_SCHEMA);
  const draft = await studio.createPackDraft({
    draftId: 'moon-pack',
    rootId,
    metadata: { semanticPackId: 'moon_pack', name: 'Moon Pack', summary: 'Exact optional Styles.' },
    access: { kind: 'FREE', priceAtomic: '0' },
    completion: { mode: 'UNLIMITED_FREE', priceAtomic: '0', freeQuotaPerWallet: '0', totalCap: '0' },
  });
  assert.equal(draft.revision, 1);
  assert.equal(draft.document.author.address, id(90));
  assert.equal(draft.document.admission.expectedPackRegistryRevision, '7');
  assert.deepEqual(calls, { discover: 1, context: 1, bindings: 1 });

  const bytesBase64 = toBase64(Uint8Array.from([137, 80, 78, 71, 1, 2, 3]));
  const savedAsset = await studio.upsertAsset({
    draftId: draft.draftId,
    expectedRevision: draft.revision,
    style: {
      partKey: 'accessory', itemKey: 'moon_item', styleKey: 'moon_style',
      layerTrackKey: 'accessory_front', colorChannelKey: null, defaultSwatchKey: null,
    },
    asset: { assetId: 'moon_asset', mediaType: 'image/png', bytesBase64 },
  });
  assert.equal(savedAsset.draft.revision, 2);
  assert.equal(savedAsset.draft.document.styles.length, 1);
  assert.equal(savedAsset.asset.bytesBase64, bytesBase64);
  assert.equal(savedAsset.draft.document.metadata.coverAssetId, 'moon_asset');

  const saved = await studio.save({
    draftId: draft.draftId,
    expectedRevision: 2,
    fields: { name: 'Moon Pack Revised', summary: 'Revised.', accessKind: 'FREE', accessPriceAtomic: '0' },
  });
  assert.equal(saved.revision, 3);
  assert.equal(saved.document.metadata.name, 'Moon Pack Revised');
  const preview = await studio.preview(draft.draftId);
  assert.equal(preview.styleCount, 1);
  assert.equal(preview.styles[0].availability, 'LOCAL_READY');
  assert.equal(preview.styles[0].previewBlobId, null);
  assert.equal((await studio.list()).length, 1);
  assert.equal((await studio.export(draft.draftId)).draft.revision, 3);

  await assert.rejects(
    studio.preparePublication({ draftId: draft.draftId, expectedRevision: 3 }),
    (error) => error.code === 'MAKER_V8_PACK_ASSET_BLOB_REQUIRED',
  );
  persistence.close();
});

for (const operation of ['preparePublication', 'requestPublicationSignature', 'recoverPublicationOutcome']) {
  test(`Pack Studio rejects draft drift during ${operation} before transport side effects`, async () => {
    let calls = 0;
    const invoke = async () => { calls++; return { status: 'TRANSPORT_SIGNATURE_REQUIRED' }; };
    const { studio, persistence, rootId, wallet } = harness({ transport: {
      schemaVersion: 'animacraft.maker-v8-pack-transport.v1', prepare: invoke, requestSignature: invoke, recover: invoke,
    } });
    try {
      const draft = await studio.createPackDraft({ draftId: `race-${operation.toLowerCase()}`, rootId,
        metadata: { semanticPackId: 'race', name: 'Race', summary: '' } });
      wallet.getCurrentAccount = async () => {
        wallet.getCurrentAccount = async () => ({ address: id(90) });
        await studio.save({ draftId: draft.draftId, expectedRevision: draft.revision,
          fields: { name: 'Changed in another tab' } });
        return { address: id(90) };
      };
      await assert.rejects(studio[operation]({ draftId: draft.draftId, expectedRevision: draft.revision }),
        { code: 'MAKER_V8_PACK_DRAFT_CAS_MISMATCH' });
      assert.equal(calls, 0);
      const latest = await studio.load(draft.draftId);
      assert.equal(latest.document.metadata.name, 'Changed in another tab');
      const retried = await studio[operation]({ draftId: draft.draftId, expectedRevision: latest.revision });
      assert.equal(retried.transport.status, 'TRANSPORT_SIGNATURE_REQUIRED');
      assert.equal(calls, 1);
    } finally { persistence.close(); }
  });
}

test('Pack Studio rejects wallet change during asset read before invoking transport', async () => {
  let calls = 0;
  const invoke = async () => { calls++; return { status: 'TRANSPORT_SIGNATURE_REQUIRED' }; };
  const { studio, persistence, rootId, wallet } = harness({ transport: {
    schemaVersion: 'animacraft.maker-v8-pack-transport.v1', prepare: invoke, requestSignature: invoke, recover: invoke,
  } });
  try {
    const draft = await studio.createPackDraft({ draftId: 'wallet-read-race', rootId,
      metadata: { semanticPackId: 'race', name: 'Race', summary: '' } });
    let reads = 0;
    wallet.getCurrentAccount = async () => ({ address: id(++reads === 1 ? 90 : 91) });
    await assert.rejects(studio.preparePublication({ draftId: draft.draftId, expectedRevision: draft.revision }),
      { code: 'MAKER_V8_PACK_ACCOUNT_DRIFT' });
    assert.equal(calls, 0);
    assert.deepEqual(await studio.load(draft.draftId), draft);
  } finally { persistence.close(); }
});

test('replacing Pack artwork prepares only the current image while retaining the old local bytes', async () => {
  const uploads = [];
  const transport = createMakerV8PackTransportV8({ publisher: {
    load: async () => null,
    prepare: async value => { uploads.push(value); return { uploadId: value.uploadId, status: 'SIGNATURE_REQUIRED' }; },
    requestSignature: async () => { throw Error('No wallet'); }, resume: async () => { throw Error('No network'); },
  } });
  const { studio, persistence, rootId } = harness({ transport });
  try {
    let draft = await studio.createPackDraft({ draftId: 'replace-artwork', rootId,
      metadata: { semanticPackId: 'replace', name: 'Replace', summary: '' } });
    const style = { partKey: 'accessory', itemKey: 'moon', styleKey: 'red', layerTrackKey: 'front',
      colorChannelKey: null, defaultSwatchKey: null };
    for (const assetId of ['old-image', 'new-image']) {
      const result = await studio.upsertAsset({ draftId: draft.draftId, expectedRevision: draft.revision, style,
        asset: { assetId, mediaType: 'image/png', bytesBase64: toBase64(Uint8Array.of(137,80,78,71,assetId === 'old-image' ? 1 : 2)) } });
      draft = result.draft;
    }
    assert.equal(draft.document.metadata.coverAssetId, 'new-image');
    const assets = await persistence.listAssets(draft.draftId);
    assert.equal(assets.length, 2);
    const prepared = await studio.preparePublication({ draftId: draft.draftId, expectedRevision: draft.revision });
    assert.equal(prepared.transport.status, 'TRANSPORT_SIGNATURE_REQUIRED');
    assert.equal(uploads.length, 1);
    assert.equal(uploads[0].bytesBase64, assets.find(row => row.assetId === 'new-image').bytesBase64);
    assert.deepEqual(await persistence.listAssets(draft.draftId), assets);
    // Replacing another Style must not steal the chosen cover.
    for (const assetId of ['other-old', 'other-new']) {
      const result = await studio.upsertAsset({ draftId: draft.draftId, expectedRevision: draft.revision,
        style: { ...style, styleKey: 'blue' }, asset: { assetId, mediaType: 'image/png',
          bytesBase64: toBase64(Uint8Array.of(137,80,78,71,3)) } });
      draft = result.draft;
      assert.equal(draft.document.metadata.coverAssetId, 'new-image');
    }
  } finally { persistence.close(); }
});

test('Pack Studio refuses caller root drift and stale asset CAS', async () => {
  const { studio, persistence, rootId } = harness();
  await assert.rejects(
    studio.createPackDraft({
      draftId: 'wrong-root', rootId: id(99),
      metadata: { semanticPackId: 'wrong', name: 'Wrong', summary: '' },
    }),
    (error) => error.code === 'MAKER_V8_PACK_ROOT_NOT_FOUND',
  );
  const draft = await studio.createPackDraft({
    draftId: 'right-root', rootId,
    metadata: { semanticPackId: 'right', name: 'Right', summary: '' },
  });
  await assert.rejects(
    studio.save({ draftId: draft.draftId, expectedRevision: 9, fields: { name: 'Stale' } }),
    (error) => error.code === 'MAKER_V8_PACK_DRAFT_CAS_MISMATCH',
  );
  persistence.close();
});
