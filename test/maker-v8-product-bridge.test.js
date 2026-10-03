import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { IDBFactory } from 'fake-indexeddb';
import { createMakerV8LocalPlayerStore } from '../maker-v8-local-player-store.js';
import { createMakerV8LocalPlayerControls } from '../maker-v8-local-player-controls.js';
import { createMakerV8DraftPersistence } from '../maker-v8-draft-store.js';
import { canonicalMakerV8Json } from '../maker-v8-compiler.js';

import {
  createMakerV8ProductBridge,
  makerV8DocumentFromProductDraft,
} from '../maker-v8-product-bridge.js';
import { MAKER_V8_DEFAULT_ASSET_BASE64, seedMinimalArtworkDraft } from './fixtures/maker-v8-minimal-artwork.js';
import { assertMakerV8Document } from '../maker-v8-document.js';
import { prepareCreatorStylePng } from '../maker-v8-creator-image.js';
import { prepareCreatorStructure } from '../maker-v8-creator-structure.js';
import { fromBase64, toBase64 } from '@mysten/sui/utils';
import { sha256 } from '@noble/hashes/sha2.js';
import { MAKER_V8_PROJECT_ZIP_ENTRY } from '../maker-v8-project-zip.js';
import {
  MAKER_V8_PLAYER_LOADOUT_SCHEMA,
  MAKER_V8_PLAYER_RECIPE_SCHEMA,
  makerV8PlayerRecipeCommitmentV8,
} from '../maker-v8-player-controller.js';

const address = `0x${'12'.repeat(32)}`;
const publicationConfigContext = { window: {} };
runInNewContext(await readFile(new URL('../public-v8/config.js', import.meta.url), 'utf8'), publicationConfigContext);
const publicationRuntime = JSON.parse(JSON.stringify(publicationConfigContext.window.SoulidityMakerV8));

test('real author projection recovers old local checkpoints without weakening identity or CAS', async () => {
  const idb = new IDBFactory();
  const drafts = createMakerV8DraftPersistence(idb, { databaseName: 'legacy-player', now: () => 100 });
  const checkpoints = createMakerV8LocalPlayerStore(idb);
  let race = null;
  const bridge = createMakerV8ProductBridge({ productRuntime: runtimeHarness().productRuntime, drafts,
    localPlayerStore: { load: binding => checkpoints.load(binding), async save(input) {
      if (race) { const winner = race; race = null; await checkpoints.save({ ...input, checkpoint: winner }); }
      return checkpoints.save(input);
    } } });
  const request = req => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
  const hash = text => [...sha256(new TextEncoder().encode(text))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const binding = serialized => { const outer = JSON.parse(serialized); const inner = JSON.parse(outer.checkpoint); return { draftId: inner.draftId, draftRevision: inner.draftRevision, documentHash: inner.documentHash, assetHash: outer.assetHash }; };
  const rewrite = (serialized, edit) => { const outer = JSON.parse(serialized); const inner = JSON.parse(outer.checkpoint); edit(inner, outer); outer.checkpoint = canonicalMakerV8Json(inner); return canonicalMakerV8Json(outer); };
  try {
    for (const mode of ['migration', 'current', 'race']) {
      const draftId = `legacy-${mode}`;
      await seedMinimalArtworkDraft(drafts, { draftId, name: 'Legacy', createdAt: 100 });
      const db = await request(idb.open('legacy-player', 4));
      const tx = db.transaction(['drafts', 'versions'], 'readwrite');
      const done = new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); });
      const raw = await request(tx.objectStore('drafts').get(draftId));
      raw.document.rules = [{ key: 'old', kind: 'REQUIRE', left: { partKey: 'base', itemKey: 'default' }, right: { partKey: 'base', itemKey: 'default' }, payload: {} }];
      raw.document.parts[0].items.push({ ...structuredClone(raw.document.parts[0].items[0]), key: 'alternate', label: 'Alternate', displayOrder: 1 });
      raw.document.rules.push({ key: 'exclude-alternate', kind: 'EXCLUDE', left: { partKey: 'base', itemKey: 'alternate' }, right: { partKey: 'base', itemKey: 'alternate' }, payload: {} });
      tx.objectStore('drafts').put(raw); tx.objectStore('versions').put(raw); await done; db.close();
      const session = await bridge.openLocalPlayer({ draftId, expectedRevision: 1 });
      assert.equal(session.getSnapshot().document.rules[0].trigger.source, 'BASE');
      const current = await session.exportCheckpoint();
      const legacy = rewrite(current, inner => {
        inner.documentHash = hash(canonicalMakerV8Json(raw.document));
        inner.profile.name = 'Preserved OC'; inner.soulDocuments.soulMd = 'Original soul'; inner.soulDocuments.memoryMd = 'Original memory'; inner.soulDocuments.skillMd = 'Original skill';
      });
      const oldRecord = await checkpoints.save({ binding: binding(legacy), checkpoint: legacy, expected: null });
      const winner = rewrite(current, inner => { inner.profile.name = 'Newer current checkpoint'; });
      if (mode === 'current') await checkpoints.save({ binding: binding(current), checkpoint: winner, expected: null });
      if (mode === 'race') race = winner;
      const recovered = await session.loadCheckpoint();
      assert.equal(recovered.revision, 1);
      await session.restoreCheckpoint(recovered.checkpoint, 0);
      assert.equal(session.getSnapshot().profile.name, mode === 'migration' ? 'Preserved OC' : 'Newer current checkpoint');
      assert.deepEqual(await checkpoints.load(binding(legacy)), oldRecord);
      if (mode === 'migration') {
        const saved = JSON.parse(JSON.parse(legacy).checkpoint);
        assert.deepEqual(session.getSnapshot().recipe, saved.recipe);
        assert.deepEqual(session.getSnapshot().soulDocuments, saved.soulDocuments);
        await session.restoreCheckpoint(legacy, session.getSnapshot().revision);
        for (const edit of [
          inner => { inner.documentHash = 'f'.repeat(64); },
          inner => { inner.draftRevision = 2; },
          (inner, outer) => { outer.assetHash = 'e'.repeat(64); },
          inner => { inner.recipe.selections[0].itemKey = 'missing-item'; },
          inner => { inner.recipe.selections[0].itemKey = 'alternate'; },
        ]) {
          const before = session.getSnapshot();
          await assert.rejects(session.restoreCheckpoint(rewrite(legacy, edit), before.revision));
          assert.deepEqual(session.getSnapshot(), before);
        }
      }
    }
  } finally { bridge.dispose(); drafts.close(); checkpoints.close(); }
});
const byteHash = (bytesBase64) => [...sha256(fromBase64(bytesBase64))]
  .map((byte) => byte.toString(16).padStart(2, '0')).join('');

async function recoveryFixture(drafts) {
  const bridge = createMakerV8ProductBridge({ productRuntime: runtimeHarness().productRuntime, drafts });
  const source = await seedMinimalArtworkDraft(drafts, { draftId: 'recovery-source', name: 'Original name' });
  const snapshot = await bridge.getDraft({ draftId: source.draftId });
  const document = structuredClone(snapshot.draft.document);
  document.metadata.summary = 'Pending window with unsaved work';
  const assets = structuredClone(snapshot.assets);
  const extra = { ...assets[0], assetId: 'pending-image', bytesBase64: 'AQID', byteLength: 3, sha256: byteHash('AQID') };
  document.assets.push({ id: extra.assetId, kind: extra.kind, mediaType: extra.mediaType, byteLength: extra.byteLength });
  document.parts[0].items[0].styles.push({ ...structuredClone(document.parts[0].items[0].styles[0]),
    key: 'pending-style', displayOrder: 1, assetId: extra.assetId });
  assets.push(extra);
  return { bridge, snapshot, input: { sourceDraftId: source.draftId,
    draftId: 'maker-recovery-12345678-1234-4234-8234-123456789abc', document, assets } };
}

test('recovery copy preserves the complete pending snapshot and leaves the newer source untouched offline', async () => {
  const idb = new IDBFactory();
  const drafts = createMakerV8DraftPersistence(idb);
  const { bridge, snapshot, input } = await recoveryFixture(drafts);
  try {
    const latest = structuredClone(snapshot.draft.document);
    latest.metadata.summary = 'Other window won';
    latest.assets[0].byteLength = 3;
    const source = await drafts.compareAndSwapBundle({ draftId: input.sourceDraftId, expectedRevision: 1,
      document: latest, assetUpserts: [{ assetId: snapshot.assets[0].assetId, expectedRevision: 1,
        kind: snapshot.assets[0].kind, mediaType: snapshot.assets[0].mediaType, bytesBase64: 'BAUG' }] });
    const offlineRuntime = runtimeHarness().productRuntime;
    offlineRuntime.ready = async () => { throw new Error('Network unavailable'); };
    offlineRuntime.wallet.getCurrentAccount = async () => { throw new Error('Wallet unavailable'); };
    const offline = createMakerV8ProductBridge({ drafts, productRuntime: offlineRuntime });
    await assert.rejects(offline.ready(), /Network unavailable/);
    const result = await offline.recoverDraftCopy(input);
    assert.equal(result.draft.draftId, input.draftId);
    assert.equal(result.draft.revision, 1);
    assert.deepEqual(result.draft.document, input.document);
    for (const asset of input.assets) {
      const copy = result.assets.find(row => row.assetId === asset.assetId);
      assert.equal(copy.draftId, input.draftId);
      assert.equal(copy.revision, 1);
      for (const field of ['kind', 'mediaType', 'bytesBase64', 'byteLength', 'sha256']) assert.equal(copy[field], asset[field]);
    }
    assert.deepEqual(await bridge.getDraft({ draftId: input.sourceDraftId }), source);
    assert.deepEqual(await bridge.recoverDraftCopy({ ...input, assets: [...input.assets].reverse() }), result);
    assert.equal((await drafts.listVersions(input.draftId)).length, 1);
    const reopened = createMakerV8DraftPersistence(idb);
    try {
      const exported = await reopened.export(input.draftId);
      assert.deepEqual({ draft: exported.draft, assets: exported.assets }, result);
    } finally { reopened.close(); }
    offline.dispose();
  } finally { bridge.dispose(); drafts.close(); }
});

test('simultaneous recovery copies with the same ID converge only after exact duplicate readback', async () => {
  const drafts = createMakerV8DraftPersistence(new IDBFactory());
  let duplicates = 0;
  const { bridge, input } = await recoveryFixture({ ...drafts, async createBundle(value) {
    try { return await drafts.createBundle(value); } catch (error) {
      if (error.code === 'MAKER_V8_DRAFT_EXISTS') duplicates += 1;
      throw error;
    }
  } });
  try {
    const [first, second] = await Promise.all([bridge.recoverDraftCopy(input), bridge.recoverDraftCopy(input)]);
    assert.equal(duplicates, 1);
    assert.deepEqual(first, second);
    assert.equal((await drafts.listVersions(input.draftId)).length, 1);
    const changed = structuredClone(input);
    changed.document.metadata.summary = 'Different pending intent';
    await assert.rejects(bridge.recoverDraftCopy(changed), { code: 'MAKER_V8_PRODUCT_RECOVERY_TARGET_MISMATCH' });
    const changedBytes = structuredClone(input);
    changedBytes.assets[1].bytesBase64 = 'BAUG';
    changedBytes.assets[1].sha256 = byteHash('BAUG');
    await assert.rejects(bridge.recoverDraftCopy(changedBytes), { code: 'MAKER_V8_PRODUCT_RECOVERY_TARGET_MISMATCH' });
    assert.deepEqual(await bridge.getDraft({ draftId: input.draftId }), first);
  } finally { bridge.dispose(); drafts.close(); }
});

test('recovery failure before or after atomic creation retries the same ID without swallowing I/O errors', async (context) => {
  for (const committed of [false, true]) await context.test(committed ? 'unknown commit' : 'disk failure', async () => {
    const drafts = createMakerV8DraftPersistence(new IDBFactory());
    let failOnce = true;
    const failure = new Error('Controlled durable write failure');
    const { bridge, input } = await recoveryFixture({ ...drafts, async createBundle(value) {
      if (value.draftId.startsWith('maker-recovery-') && failOnce) {
        failOnce = false;
        if (committed) await drafts.createBundle(value);
        throw failure;
      }
      return drafts.createBundle(value);
    } });
    try {
      await assert.rejects(bridge.recoverDraftCopy(input), error => error === failure);
      if (!committed) {
        assert.equal(await drafts.load(input.draftId), null);
        assert.deepEqual(await drafts.listAssets(input.draftId), []);
        assert.deepEqual(await drafts.listVersions(input.draftId), []);
      }
      const result = await bridge.recoverDraftCopy(input);
      assert.deepEqual(result.draft.document, input.document);
      assert.equal(result.draft.revision, 1);
      assert.equal((await drafts.list()).length, 2);
      assert.equal((await drafts.listVersions(input.draftId)).length, 1);
    } finally { bridge.dispose(); drafts.close(); }
  });
});

test('recovery refuses invalid IDs and missing, extra, corrupt or misbound snapshot assets before creating anything', async () => {
  const drafts = createMakerV8DraftPersistence(new IDBFactory());
  const { bridge, input, snapshot } = await recoveryFixture(drafts);
  try {
    for (const mutate of [
      value => { value.sourceDraftId = 'INVALID'; },
      value => { value.sourceDraftId = value.draftId; },
      value => { value.draftId = 'ordinary-draft'; },
      value => { value.draftId = 'maker-recovery-'; },
      value => { value.document.metadata.name = null; },
      value => { value.assets = undefined; },
      value => { value.assets.pop(); },
      value => { value.assets.push(structuredClone(value.assets[0])); },
      value => { value.assets[1].assetId = value.assets[0].assetId; },
      value => { value.assets[0].bytesBase64 = 'BAUG'; },
      value => { value.assets[0].bytesBase64 += '\n'; },
      value => { value.assets[0].sha256 = 'f'.repeat(64); },
      value => { value.assets[0].byteLength += 1; },
      value => { value.assets[0].mediaType = 'image/jpeg'; },
      value => { value.assets[0].kind = 'cover'; },
      value => { value.assets[0].draftId = 'another-draft'; },
      value => { value.document.assets[0].byteLength += 1; },
    ]) {
      const invalid = structuredClone(input); mutate(invalid);
      await assert.rejects(bridge.recoverDraftCopy(invalid));
      assert.equal(await drafts.load(input.draftId), null);
      assert.deepEqual(await drafts.listAssets(input.draftId), []);
    }
    assert.deepEqual(await bridge.getDraft({ draftId: input.sourceDraftId }), snapshot);
    assert.equal((await drafts.list()).length, 1);
  } finally { bridge.dispose(); drafts.close(); }
});

test('duplicate recovery never accepts missing or corrupt readback and propagates read failure', async () => {
  const drafts = createMakerV8DraftPersistence(new IDBFactory());
  let readbackMutation = () => {};
  const { bridge, input } = await recoveryFixture({ ...drafts, async export(id) {
    const bundle = structuredClone(await drafts.export(id));
    readbackMutation(bundle);
    return bundle;
  } });
  try {
    const saved = await bridge.recoverDraftCopy(input);
    for (const mutate of [
      bundle => { bundle.assets.pop(); },
      bundle => { bundle.assets[0].sha256 = 'f'.repeat(64); },
      bundle => { bundle.assets[0].draftId = input.sourceDraftId; },
    ]) {
      readbackMutation = mutate;
      await assert.rejects(bridge.recoverDraftCopy(input), { code: 'MAKER_V8_PRODUCT_RECOVERY_ASSETS_INVALID' });
    }
    const failure = new Error('Controlled readback failure');
    readbackMutation = () => { throw failure; };
    await assert.rejects(bridge.recoverDraftCopy(input), error => error === failure);
    readbackMutation = () => {};
    assert.deepEqual(await bridge.recoverDraftCopy(input), saved);
    assert.equal((await drafts.listVersions(input.draftId)).length, 1);
  } finally { bridge.dispose(); drafts.close(); }
});

test('bridge deletes one local draft through storage CAS without touching other assets or signing', async () => {
  const drafts = createMakerV8DraftPersistence(new IDBFactory());
  const runtime = runtimeHarness();
  const bridge = createMakerV8ProductBridge({ productRuntime: runtime.productRuntime, drafts });
  try {
    const a = await seedMinimalArtworkDraft(drafts, { draftId: 's1-delete-a', name: 'Delete A' });
    const b = await seedMinimalArtworkDraft(drafts, { draftId: 's1-keep-b', name: 'Keep B' });
    const before = await bridge.getDraft({ draftId: b.draftId });
    await assert.rejects(bridge.deleteDraft({ draftId: a.draftId, expectedRevision: a.revision + 1 }), /another tab/);
    assert.equal((await bridge.getDraft({ draftId: a.draftId })).draft.revision, a.revision);
    assert.equal(await bridge.deleteDraft({ draftId: a.draftId, expectedRevision: a.revision }), true);
    assert.equal(await drafts.load(a.draftId), null);
    assert.deepEqual(await drafts.listAssets(a.draftId), []);
    assert.deepEqual(await bridge.getDraft({ draftId: b.draftId }), before);
    assert.equal(await bridge.deleteDraft({ draftId: a.draftId, expectedRevision: a.revision }), false);
  } finally { bridge.dispose(); drafts.close(); }
});

test('PNG replacement and complete snapshot history atomically roundtrip shared bytes with real storage CAS', async () => {
  const drafts = createMakerV8DraftPersistence(new IDBFactory());
  const bridge = createMakerV8ProductBridge({ productRuntime: runtimeHarness().productRuntime, drafts });
  try {
    const a = await seedMinimalArtworkDraft(drafts, { draftId: 'png-a', name: 'PNG A' });
    const b = await seedMinimalArtworkDraft(drafts, { draftId: 'png-b', name: 'PNG B' });
    const other = await bridge.getDraft({ draftId: b.draftId });
    const original = await bridge.getDraft({ draftId: a.draftId });
    // A second Style shares the existing image. Only the chosen Style may change.
    const doc = structuredClone(original.draft.document);
    doc.parts[0].items[0].styles.push({ ...structuredClone(doc.parts[0].items[0].styles[0]), key: 'shared', displayOrder: 1 });
    await bridge.replaceDraftDocument({ draftId: a.draftId, expectedRevision: a.revision, document: doc });
    const before = await bridge.getDraft({ draftId: a.draftId });
    const bytes = fromBase64(MAKER_V8_DEFAULT_ASSET_BASE64);
    const prepared = prepareCreatorStylePng({ document: before.draft.document, assets: before.assets,
      partKey: 'base', itemKey: 'default', styleKey: 'default', bytes });
    const after = await bridge.dispatchDraftTransaction({ draftId: a.draftId, expectedRevision: before.draft.revision,
      commands: prepared.commands, assetUpserts: prepared.assetUpserts });
    const chosenId = after.draft.document.parts[0].items[0].styles[0].assetId;
    assert.notEqual(chosenId, before.assets[0].assetId);
    assert.deepEqual(after.assets.find(row => row.assetId === before.assets[0].assetId), before.assets[0]);
    const restore = snapshot => bridge.replaceDraftSnapshot({ draftId: a.draftId,
      expectedRevision: snapshot.expectedRevision, document: snapshot.draft.document, assets: snapshot.assets });
    const undone = await restore({ ...before, expectedRevision: after.draft.revision });
    assert.deepEqual(undone.draft.document, before.draft.document);
    assert.deepEqual(undone.assets.map(row => row.bytesBase64), before.assets.map(row => row.bytesBase64));
    assert.equal(undone.assets.length, 1);
    const redone = await restore({ ...after, expectedRevision: undone.draft.revision });
    assert.deepEqual(redone.draft.document, after.draft.document);
    assert.equal(redone.assets.find(row => row.assetId === chosenId).bytesBase64, MAKER_V8_DEFAULT_ASSET_BASE64);
    await assert.rejects(restore({ ...before, expectedRevision: undone.draft.revision }), /another tab/);
    const invalid = structuredClone(before); invalid.assets[0].bytesBase64 = 'AQ==';
    await assert.rejects(restore({ ...invalid, expectedRevision: redone.draft.revision }));
    assert.deepEqual(await bridge.getDraft({ draftId: a.draftId }), redone);
    assert.deepEqual(await bridge.getDraft({ draftId: b.draftId }), other);
  } finally { bridge.dispose(); drafts.close(); }
});

test('new pending-PNG structure cold-reopens, renders existing layers and uploads first bytes atomically', async () => {
  const drafts = createMakerV8DraftPersistence(new IDBFactory());
  const draws = [];
  const bridge = createMakerV8ProductBridge({ productRuntime: runtimeHarness().productRuntime, drafts,
    rendering: {
      canvasFactory: () => ({ getContext: () => ({ clearRect() {}, save() {}, restore() {}, translate() {}, rotate() {}, scale() {},
        drawImage(source) { draws.push(source.label); } }),
      convertToBlob: async () => new Blob([Uint8Array.of(9, 8, 7)], { type: 'image/png' }) }),
      decodeImage: async () => ({ source: { label: 'saved-layer', width: 1, height: 1 }, close() {} }),
    } });
  try {
    const a = await seedMinimalArtworkDraft(drafts, { draftId: 'pending-png', name: 'Pending PNG' });
    const prepared = prepareCreatorStructure({ document: a.document, action: 'add-part' });
    await bridge.replaceDraftDocument({ draftId: a.draftId, expectedRevision: a.revision, document: prepared.document });
    const reopened = await bridge.getDraft({ draftId: a.draftId });
    assert.equal(reopened.draft.document.parts[1].items[0].styles[0].assetId, null);
    assert.equal(reopened.assets.length, 1);
    assert.throws(() => assertMakerV8Document(reopened.draft.document, { mode: 'compile' }));
    await bridge.renderDraftPreview({ draftId: a.draftId });
    assert.equal(draws.length, 1, 'pending styles do not conceal or fabricate existing pixels');
    const png = prepareCreatorStylePng({ document: reopened.draft.document, assets: reopened.assets,
      ...prepared.selection, bytes: fromBase64(MAKER_V8_DEFAULT_ASSET_BASE64) });
    const saved = await bridge.dispatchDraftTransaction({ draftId: a.draftId, expectedRevision: reopened.draft.revision,
      commands: png.commands, assetUpserts: png.assetUpserts });
    assert.equal(saved.assets.length, 2);
    assertMakerV8Document(saved.draft.document, { mode: 'compile' });
    assert.deepEqual(saved.assets[0], reopened.assets[0]);
    await bridge.renderDraftPreview({ draftId: a.draftId });
    assert.equal(draws.length, 3);
    await assert.rejects(bridge.dispatchDraftTransaction({ draftId: a.draftId, expectedRevision: reopened.draft.revision,
      commands: png.commands, assetUpserts: png.assetUpserts }), /another tab/);
    assert.deepEqual(await bridge.getDraft({ draftId: a.draftId }), saved);
  } finally { bridge.dispose(); drafts.close(); }
});

function exactEmptyPlayerState({ rootId, commitment, document = {} } = {}) {
  const recipe = {
    schemaVersion: MAKER_V8_PLAYER_RECIPE_SCHEMA,
    rootId,
    makerVersion: '1',
    rootContentCommitment: commitment,
    selections: [],
    colors: [],
    outputKey: 'soul',
  };
  return {
    status: 'READY',
    player: {
      rootId,
      makerVersion: '1',
      lifecycle: 'ACTIVE',
      certifiedAssets: [],
      document,
      evidence: { contentCommitment: commitment },
    },
    recipe,
    loadout: {
      schemaVersion: MAKER_V8_PLAYER_LOADOUT_SCHEMA,
      rootId,
      makerVersion: '1',
      rootContentCommitment: commitment,
      outputKey: recipe.outputKey,
      selections: [],
      usedPacks: [],
      recipeCommitment: makerV8PlayerRecipeCommitmentV8(recipe),
    },
    execution: { writeEnabled: true },
    diagnostics: [],
    lastError: null,
  };
}

function publicPlayerAuthority(rootId, commitment, overrides = {}) {
  return {
    status: 'READY',
    diagnostics: [],
    player: {
      rootId,
      makerVersion: '1',
      lifecycle: 'ACTIVE',
      evidence: { contentCommitment: commitment },
      ...overrides,
    },
  };
}

function runtimeHarness({ connected = false, contextualChoices = null, lineage = null } = {}) {
  let account = connected ? { address, network: 'mainnet' } : null;
  const walletListeners = new Set();
  const calls = { ready: 0, plaza: 0, player: 0, reconnect: 0, asset: 0 };
  const productRuntime = {
    runtime: publicationRuntime,
    capabilities: { transport: 'SUI_GRPC_GRAPHQL' },
    async ready() { calls.ready += 1; return true; },
    catalog: {
      async loadPlaza() {
        calls.plaza += 1;
        return {
          status: 'READY',
          makers: [{ id: `0x${'34'.repeat(32)}`, title: 'Certified Maker' }],
          diagnostics: [],
        };
      },
      async loadPlayer(rootId) {
        calls.player += 1;
        return { status: 'READY', player: { rootId, title: 'Certified Maker' }, diagnostics: [] };
      },
    },
    assets: {
      async load(asset) {
        calls.asset += 1;
        return { ...asset, bytesBase64: 'AQ==' };
      },
    },
    wallet: {
      async getCurrentAccount() {
        if (!account) {
          const error = new Error('not connected');
          error.code = 'MAKER_V8_BROWSER_WALLET_NOT_CONNECTED';
          throw error;
        }
        return account;
      },
      async reconnect() {
        calls.reconnect += 1;
        account = { address, network: 'mainnet' };
        for (const listener of walletListeners) listener({ account });
        return account;
      },
      subscribe(listener) {
        walletListeners.add(listener);
        listener({ account });
        return () => walletListeners.delete(listener);
      },
      dispose() { walletListeners.clear(); },
    },
  };
  if (contextualChoices) {
    productRuntime.choices = {
      async load(input) {
        calls.choices = (calls.choices ?? 0) + 1;
        assert.equal(input.address, address);
        return structuredClone(contextualChoices);
      },
    };
  }
  if (lineage) {
    productRuntime.lineage = {
      async load(input) {
        calls.lineage = (calls.lineage ?? 0) + 1;
        assert.equal(input.makerKey, lineage[0].makerKey);
        return structuredClone(lineage);
      },
    };
  }
  return {
    productRuntime,
    calls,
    setAccount(next) {
      account = next;
      for (const listener of walletListeners) listener({ account });
    },
  };
}

function draftHarness() {
  const rows = new Map();
  const assets = new Map();
  const histories = new Map();
  const calls = {
    create: 0, createBundle: 0, successor: 0, cas: 0, bundle: 0,
    replace: 0, close: 0, import: 0,
  };
  return {
    calls,
    mutateDraft(draftId, patch) {
      rows.set(draftId, { ...rows.get(draftId), ...structuredClone(patch) });
    },
    mutateAsset(draftId, assetId, patch) {
      const key = `${draftId}:${assetId}`;
      assets.set(key, { ...assets.get(key), ...structuredClone(patch) });
    },
    mutateDraft(draftId, patch) {
      rows.set(draftId, { ...rows.get(draftId), ...structuredClone(patch) });
    },
    drafts: {
      async createBundle({ draftId, document, assets: initialAssets, createdAt }) {
        calls.create += 1;
        calls.createBundle += 1;
        const row = { draftId, document, revision: 1, createdAt, updatedAt: createdAt };
        rows.set(draftId, structuredClone(row));
        histories.set(draftId, [structuredClone(row)]);
        const createdAssets = initialAssets.map((entry) => {
          const asset = {
            ...entry,
            draftId,
            revision: 1,
            createdAt,
            updatedAt: createdAt,
            byteLength: Buffer.from(entry.bytesBase64, 'base64').length,
            sha256: byteHash(entry.bytesBase64),
          };
          assets.set(`${draftId}:${asset.assetId}`, structuredClone(asset));
          return asset;
        });
        return { draft: structuredClone(row), assets: structuredClone(createdAssets) };
      },
      async createSuccessor({ sourceDraftId, sourceExpectedRevision, draftId, document, createdAt }) {
        calls.successor += 1;
        const source = rows.get(sourceDraftId);
        assert.equal(source.revision, sourceExpectedRevision);
        const row = { draftId, document, revision: 1, createdAt, updatedAt: createdAt };
        rows.set(draftId, structuredClone(row));
        histories.set(draftId, [structuredClone(row)]);
        const copied = [...assets.values()].filter((asset) => asset.draftId === sourceDraftId).map((asset) => {
          const next = { ...asset, draftId, revision: 1, createdAt, updatedAt: createdAt };
          assets.set(`${draftId}:${next.assetId}`, structuredClone(next));
          return next;
        });
        return { draft: structuredClone(row), assets: structuredClone(copied) };
      },
      async load(draftId) { return rows.has(draftId) ? structuredClone(rows.get(draftId)) : null; },
      async list() { return [...rows.values()].map((row) => structuredClone(row)); },
      async compareAndSwap({ draftId, expectedRevision, document, updatedAt }) {
        calls.cas += 1;
        const current = rows.get(draftId);
        assert.equal(current.revision, expectedRevision);
        const next = { ...current, revision: expectedRevision + 1, document, updatedAt };
        rows.set(draftId, structuredClone(next));
        histories.get(draftId).push(structuredClone(next));
        return structuredClone(next);
      },
      async compareAndSwapBundle({
        draftId, expectedRevision, document, assetUpserts = [], assetDeletes = [], updatedAt,
      }) {
        calls.bundle += 1;
        const current = rows.get(draftId);
        assert.equal(current.revision, expectedRevision);
        for (const entry of assetDeletes) {
          const key = `${draftId}:${entry.assetId}`;
          const asset = assets.get(key);
          assert.equal(asset.revision, entry.expectedRevision);
          assets.delete(key);
        }
        for (const entry of assetUpserts) {
          const key = `${draftId}:${entry.assetId}`;
          const currentAsset = assets.get(key) ?? null;
          assert.equal(currentAsset?.revision ?? null, entry.expectedRevision);
          assets.set(key, {
            ...entry,
            draftId,
            revision: currentAsset ? currentAsset.revision + 1 : 1,
            byteLength: Buffer.from(entry.bytesBase64, 'base64').length,
            sha256: byteHash(entry.bytesBase64),
          });
        }
        const next = { ...current, revision: expectedRevision + 1, document, updatedAt };
        rows.set(draftId, structuredClone(next));
        histories.get(draftId).push(structuredClone(next));
        return {
          draft: structuredClone(next),
          assets: [...assets.values()]
            .filter((asset) => asset.draftId === draftId)
            .map((asset) => structuredClone(asset)),
        };
      },
      async listVersions(draftId) {
        return [...(histories.get(draftId) || [])].reverse().map((row) => structuredClone(row));
      },
      async restoreVersion({ draftId, expectedRevision, revision, updatedAt }) {
        const current = rows.get(draftId);
        assert.equal(current.revision, expectedRevision);
        const historical = histories.get(draftId).find((row) => row.revision === revision);
        const next = { ...current, revision: current.revision + 1, document: structuredClone(historical.document), updatedAt };
        rows.set(draftId, structuredClone(next));
        histories.get(draftId).push(structuredClone(next));
        return structuredClone(next);
      },
      async export(draftId) { return { schemaVersion: 'export', draft: structuredClone(rows.get(draftId)) }; },
      async importBundle(bundle) { calls.import += 1; return structuredClone(bundle); },
      async replaceBundle({ draftId, expectedRevision, bundle, updatedAt }) {
        calls.replace += 1;
        const current = rows.get(draftId);
        assert.equal(current.revision, expectedRevision);
        const next = {
          ...current,
          revision: expectedRevision + 1,
          updatedAt,
          document: structuredClone(bundle.draft.document),
        };
        rows.set(draftId, structuredClone(next));
        histories.get(draftId).push(structuredClone(next));
        return { draft: structuredClone(next), assets: [] };
      },
      async listAssets(draftId) {
        return [...assets.values()]
          .filter((asset) => asset.draftId === draftId)
          .map((asset) => structuredClone(asset));
      },
      async upsertAsset(input) {
        const key = `${input.draftId}:${input.assetId}`;
        const current = assets.get(key) ?? null;
        assert.equal(current?.revision ?? null, input.expectedRevision ?? null);
        const next = {
          ...structuredClone(input),
          revision: current ? current.revision + 1 : 1,
          byteLength: Buffer.from(input.bytesBase64, 'base64').length,
          sha256: byteHash(input.bytesBase64),
        };
        assets.set(key, next);
        return structuredClone(next);
      },
      close() { calls.close += 1; },
    },
  };
}

test('product draft maps to one exact Maker v8 document without legacy payloads', () => {
  const document = makerV8DocumentFromProductDraft({
    makerId: 'moon-maker',
    name: 'Moon Maker',
    description: 'A bounded description',
    canvas: 'Portrait · 1080×1920 px',
    startingStructure: 'character',
  });
  assertMakerV8Document(document, { mode: 'draft' });
  assert.equal(document.schemaVersion, 'animacraft.maker.v8');
  assert.equal(document.protocolVersion, 8);
  assert.equal(document.lineage.makerKey, 'moon-maker');
  assert.equal(document.metadata.name, 'Moon Maker');
  assert.equal(document.metadata.summary, 'A bounded description');
  assert.deepEqual([document.canvas.width, document.canvas.height], [1080, 1920]);
  assert.equal(Object.hasOwn(document, 'legacy'), false);
});

test('approved New Maker structures create the eight-Part character skeleton or a truly blank v8 document', async () => {
  const character = makerV8DocumentFromProductDraft({
    makerId: 'character-maker', name: 'Character Maker', startingStructure: 'character',
  });
  const blank = makerV8DocumentFromProductDraft({
    makerId: 'blank-maker', name: 'Blank Maker', startingStructure: 'blank',
  });
  assertMakerV8Document(character, { mode: 'draft' });
  assertMakerV8Document(blank, { mode: 'draft' });
  assert.equal(character.parts.length, 8);
  assert.equal(character.tracks.length, 8);
  assert.equal(character.assets.length, 0);
  assert.equal(character.defaultRecipe.selections.length, 8);
  assert.deepEqual(character.parts.filter(part => part.required).map(part => part.key), ['skin-base', 'eyes']);
  assert.deepEqual(makerV8DocumentFromProductDraft({ makerId: 'character-maker', name: 'Character Maker' }), character);
  assert.deepEqual(blank.parts, []);
  assert.deepEqual(blank.tracks, []);
  assert.deepEqual(blank.assets, []);
  assert.deepEqual(blank.defaultRecipe.selections, []);

  const { productRuntime } = runtimeHarness();
  const { drafts, calls } = draftHarness();
  const bridge = createMakerV8ProductBridge({ productRuntime, drafts });
  const created = await bridge.createDraft({
    makerId: 'blank-created', name: 'Blank Created', startingStructure: 'blank',
  });
  const persisted = await bridge.getDraft({ draftId: created.draftId });
  assert.deepEqual(persisted.draft.document.parts, []);
  assert.deepEqual(persisted.assets, []);
  assert.equal(calls.createBundle, 1);
  await assert.rejects(
    bridge.createDraft({
      makerId: 'invalid-structure', name: 'Invalid', startingStructure: 'Character',
    }),
    { code: 'MAKER_V8_PRODUCT_STARTING_STRUCTURE_INVALID', layer: 'DRAFT' },
  );
  assert.equal(calls.createBundle, 1, 'invalid structure never reaches durable creation');
  bridge.dispose();
});

test('real New Maker character skeleton cold-reopens at either canvas size and first PNG leaves seven pending styles', async (context) => {
  for (const [canvas, width, height, startingStructure] of [
    ['1024×1024', 1024, 1024, 'character'], ['1080×1920', 1080, 1920, undefined],
  ]) await context.test(canvas, async () => {
    const idb = new IDBFactory();
    let drafts = createMakerV8DraftPersistence(idb);
    let draws = 0;
    const rendering = {
      canvasFactory: () => ({ getContext: () => ({ clearRect() {}, save() {}, restore() {}, translate() {}, rotate() {}, scale() {},
        drawImage() { draws += 1; } }), convertToBlob: async () => new Blob([Uint8Array.of(9, 8, 7)], { type: 'image/png' }) }),
      decodeImage: async () => ({ source: { width: 1, height: 1 }, close() {} }),
    };
    let bridge = createMakerV8ProductBridge({ productRuntime: runtimeHarness().productRuntime, drafts, rendering });
    try {
      const created = await bridge.createDraft({ draftId: 'new-character', name: 'New Character', canvas, startingStructure });
      const doc = created.document;
      const parts = ['background', 'back-hair', 'skin-base', 'outfit', 'eyes', 'mouth', 'front-hair', 'accessory'];
      assert.deepEqual(doc.parts.map(part => part.key), parts);
      assert.equal(doc.tracks.length, 8);
      assert.equal(doc.defaultRecipe.selections.length, 8);
      assert.deepEqual([doc.canvas.width, doc.canvas.height], [width, height]);
      assert.deepEqual(doc.assets, []);
      for (const [index, part] of doc.parts.entries()) {
        assert.equal(part.required, ['skin-base', 'eyes'].includes(part.key));
        assert.equal(part.kind, part.required ? 'LAST_BASTION' : 'STANDARD');
        assert.equal(part.renderOrder, index);
        assert.equal(part.items.length, 1);
        const item = part.items[0];
        assert.equal(item.styles.length, 1);
        const style = item.styles[0];
        assert.equal(style.assetId, null);
        assert.deepEqual(style.payload.animacraftEditor, { positionConfirmed: false, positionLocked: false, styleLocked: false });
        assert.equal(style.trackKey, doc.tracks[index].key);
        assert.deepEqual(doc.defaultRecipe.selections[index], { partKey: part.key, itemKey: item.key, styleKey: style.key });
      }
      assertMakerV8Document(doc, { mode: 'draft' });
      assert.throws(() => assertMakerV8Document(doc, { mode: 'compile' }), error =>
        error.issues.length === 8 && error.issues.every(issue => issue.code === 'MAKER_V8_STYLE_ASSET_UNKNOWN'));
      assert.deepEqual((await bridge.getDraft({ draftId: created.draftId })).assets, []);
      bridge.dispose();
      drafts = createMakerV8DraftPersistence(idb);
      bridge = createMakerV8ProductBridge({ productRuntime: runtimeHarness().productRuntime, drafts, rendering });
      const reopened = await bridge.getDraft({ draftId: created.draftId });
      assert.deepEqual(reopened.draft, created);
      assert.deepEqual(reopened.assets, []);
      await bridge.renderDraftPreview({ draftId: created.draftId });
      assert.equal(draws, 0, 'pending PNGs never become manufactured placeholder artwork');
      const selection = doc.defaultRecipe.selections.find(row => row.partKey === 'skin-base');
      const png = prepareCreatorStylePng({ document: doc, assets: reopened.assets,
        ...selection, bytes: fromBase64(MAKER_V8_DEFAULT_ASSET_BASE64) });
      const saved = await bridge.dispatchDraftTransaction({ draftId: created.draftId, expectedRevision: 1,
        commands: png.commands, assetUpserts: png.assetUpserts });
      assert.equal(saved.draft.revision, 2);
      assert.equal(saved.assets.length, 1);
      assert.equal(saved.assets[0].bytesBase64, MAKER_V8_DEFAULT_ASSET_BASE64);
      const styles = saved.draft.document.parts.flatMap(part => part.items.flatMap(item => item.styles));
      assert.equal(styles.filter(style => style.assetId === null).length, 7);
      assertMakerV8Document(saved.draft.document, { mode: 'draft' });
      assert.throws(() => assertMakerV8Document(saved.draft.document, { mode: 'compile' }), error =>
        error.issues.length === 7 && error.issues.every(issue => issue.code === 'MAKER_V8_STYLE_ASSET_UNKNOWN'));
      const rendered = await bridge.renderDraftPreview({ draftId: created.draftId });
      assert.deepEqual([rendered.width, rendered.height], [width, height]);
      assert.equal(draws, 1, 'only the uploaded Style is rendered');
      assert.deepEqual(await bridge.getDraft({ draftId: created.draftId }), saved);
    } finally { bridge.dispose(); drafts.close(); }
  });
});

test('local draft operations do not wait for pending or failed chain readiness', async (context) => {
  for (const failed of [false, true]) {
    await context.test(failed ? 'failed chain' : 'pending chain', async () => {
      const { productRuntime, calls } = runtimeHarness();
      const storage = draftHarness();
      let rejectReady;
      productRuntime.ready = () => {
        calls.ready += 1;
        return new Promise((_resolve, reject) => { rejectReady = reject; });
      };
      let renders = 0;
      const bridge = createMakerV8ProductBridge({
        productRuntime,
        drafts: storage.drafts,
        rendering: {
          async renderDraft({ document, assets }) {
            renders += 1;
            assert.equal(document.metadata.name, 'Offline edited');
            assert.equal(assets.length, document.assets.length);
            return {
              schemaVersion: 'animacraft.maker-v8-player-render.v1', mediaType: 'image/png',
              width: 1024, height: 1024, bytesBase64: 'AQ==', byteLength: 1, sha256: byteHash('AQ=='),
            };
          },
        },
      });
      assert.deepEqual(await bridge.listDrafts(), []);
      assert.equal(calls.ready, 0, 'local storage must not initialize remote authority');
      const remote = bridge.ready().catch((error) => error);
      const unavailable = new Error('chain service unavailable');
      if (failed) { rejectReady(unavailable); await remote; }
      const first = await bridge.createDraft({ makerId: 'offline', name: 'Offline', startingStructure: 'character' });
      assert.equal((await bridge.listDrafts()).length, 1);
      assert.equal((await bridge.getDraft({ draftId: 'offline' })).assets.length, 0);
      const document = structuredClone(first.document);
      document.metadata.name = 'Offline edited';
      const edited = await bridge.replaceDraftDocument({ draftId: 'offline', expectedRevision: 1, document });
      assert.equal(edited.revision, 2);
      assert.equal((await bridge.listDraftVersions({ draftId: 'offline' })).length, 2);
      const exported = await bridge.exportProject({ makerId: 'offline' });
      assert.equal(exported.project.draft.revision, 2);
      assert.deepEqual(await bridge.importProject(exported.project), exported.project);
      assert.equal((await bridge.renderDraftPreview({ draftId: 'offline' })).sha256, byteHash('AQ=='));
      assert.equal(renders, 1);
      const restored = await bridge.restoreDraftVersion({ draftId: 'offline', expectedRevision: 2, revision: 1 });
      assert.equal(restored.document.metadata.name, 'Offline');
      await assert.rejects(
        bridge.replaceDraftDocument({ draftId: 'offline', expectedRevision: 1, document }),
        { code: 'MAKER_V8_PRODUCT_DRAFT_CAS_MISMATCH' },
      );
      if (!failed) rejectReady(unavailable);
      assert.equal(await remote, unavailable);
      await assert.rejects(bridge.getTemplate({ makerId: `0x${'34'.repeat(32)}` }), unavailable);
      assert.equal((await bridge.listTemplates()).status, 'ERROR');
      assert.equal(calls.plaza, 0);
      assert.equal(calls.player, 0);
      assert.equal(calls.reconnect, 0);
      assert.equal(calls.ready, 1);
      assert.equal((await bridge.listDrafts()).length, 1);
      assert.equal(bridge.getState().runtime.status, 'ERROR');
      bridge.dispose();
    });
  }
});

test('local Player bridge uses exact durable drafts without remote or authenticated Player authority', async () => {
  const runtime = runtimeHarness();
  const storage = draftHarness();
  let rendered;
  const bridge = createMakerV8ProductBridge({
    productRuntime: runtime.productRuntime, drafts: storage.drafts,
    rendering: { async renderDraft(input) {
      rendered = input;
      return { schemaVersion: 'animacraft.maker-v8-player-render.v1', mediaType: 'image/png',
        width: 1024, height: 1024, bytesBase64: 'AQ==', byteLength: 1, sha256: byteHash('AQ==') };
    } },
  });
  await seedMinimalArtworkDraft(storage.drafts, { draftId: 'local-player', name: 'Local Player' });
  const session = await bridge.openLocalPlayer({ draftId: 'local-player', expectedRevision: 1 });
  const snapshot = session.getSnapshot();
  assert.equal(snapshot.mode, 'LOCAL_DRAFT');
  assert.equal((await session.getAssets()).length, 1);
  assert.equal((await session.renderPreview()).sha256, byteHash('AQ=='));
  assert.deepEqual(rendered.document, snapshot.document);
  assert.deepEqual(rendered.recipe, snapshot.recipe);
  assert.equal(rendered.assets[0].draftId, 'local-player');
  const saved = await session.exportCheckpoint();
  assert.equal(JSON.parse(saved).schemaVersion, 'animacraft.maker-v8-local-player-bundle-checkpoint.v1');
  session.setPersonalization({ profile: { ...snapshot.profile, name: 'Temporary' }, soulDocuments: snapshot.soulDocuments }, 0);
  assert.equal((await session.restoreCheckpoint(saved, 1)).profile.name, '');
  assert.equal(storage.calls.cas, 0);
  assert.equal(storage.calls.bundle, 0);
  assert.equal(runtime.calls.ready, 0);
  assert.equal(runtime.calls.player, 0);
  assert.equal(runtime.calls.reconnect, 0);
  assert.equal(bridge.getState().capabilities.player, false);
  for (const action of ['complete', 'sign', 'acquire', 'commitLoadout', 'exportSoul']) assert.equal(session[action], undefined);
  await assert.rejects(bridge.openLocalPlayer({ draftId: 'local-player', expectedRevision: 2 }), { code: 'STALE_LOCAL_PLAYER' });
  assert.throws(() => session.getSnapshot(), { code: 'STALE_LOCAL_PLAYER' });
  bridge.dispose();
});

test('local export and preview have independent render lanes with exact snapshotted options and dimensions', async () => {
  const storage = draftHarness();
  const pending = [];
  const bridge = createMakerV8ProductBridge({ productRuntime: runtimeHarness().productRuntime, drafts: storage.drafts,
    rendering: { renderDraft: input => new Promise(resolve => pending.push({ input, resolve })) } });
  await seedMinimalArtworkDraft(storage.drafts, { draftId: 'local-player', name: 'Local Player' });
  const session = await bridge.openLocalPlayer({ draftId: 'local-player', expectedRevision: 1 });
  const options = { sizeMode: 'standard', transparent: true };
  const preview = session.renderPreview();
  const exported = session.renderPreview(options);
  options.sizeMode = 'original'; options.transparent = false;
  while (pending.length < 2) await new Promise(resolve => setImmediate(resolve));
  const png = { schemaVersion: 'animacraft.maker-v8-player-render.v1', mediaType: 'image/png',
    width: 1024, height: 1024, bytesBase64: 'AQ==', byteLength: 1, sha256: byteHash('AQ==') };
  const exportCall = pending.find(row => row.input.exportOptions);
  assert.deepEqual(exportCall.input.exportOptions, { sizeMode: 'standard', transparent: true });
  exportCall.resolve(png);
  pending.find(row => row.input.exportOptions === null).resolve(png);
  await Promise.all([preview, exported]);
  const wrong = session.renderPreview({ sizeMode: 'standard' });
  while (pending.length < 3) await new Promise(resolve => setImmediate(resolve));
  pending[2].resolve({ ...png, width: 9 });
  await assert.rejects(wrong, { code: 'MAKER_V8_LOCAL_PLAYER_EXPORT_SIZE_MISMATCH' });
  assert.equal(session.getSnapshot().revision, 0);
  bridge.dispose();
});

test('local checkpoint cold recovery rejects changed asset bytes even with unchanged draft metadata', async () => {
  const runtime = runtimeHarness();
  const storage = draftHarness();
  const bridge = createMakerV8ProductBridge({ productRuntime: runtime.productRuntime, drafts: storage.drafts });
  await seedMinimalArtworkDraft(storage.drafts, { draftId: 'local-player', name: 'Local Player' });
  const first = await bridge.openLocalPlayer({ draftId: 'local-player', expectedRevision: 1 });
  const serialized = await first.exportCheckpoint();
  const assets = await storage.drafts.listAssets('local-player');
  storage.mutateAsset('local-player', assets[0].assetId, { bytesBase64: 'Ag==', sha256: byteHash('Ag==') });
  await assert.rejects(first.exportCheckpoint(), { code: 'STALE_LOCAL_PLAYER' });
  const second = await bridge.openLocalPlayer({ draftId: 'local-player', expectedRevision: 1 });
  const before = second.getSnapshot();
  await assert.rejects(second.restoreCheckpoint(serialized, 0), { code: 'MAKER_V8_LOCAL_PLAYER_CHECKPOINT_INVALID' });
  assert.deepEqual(second.getSnapshot(), before);
  bridge.dispose();
});

test('local bridge checkpoint persistence cold-recovers exact content without remote Player storage', async () => {
  const runtime = runtimeHarness();
  const storage = draftHarness();
  const checkpointStore = createMakerV8LocalPlayerStore(new IDBFactory());
  const bridge = createMakerV8ProductBridge({ productRuntime: runtime.productRuntime, drafts: storage.drafts, localPlayerStore: checkpointStore });
  try {
    await seedMinimalArtworkDraft(storage.drafts, { draftId: 'local-player', name: 'Local Player' });
    const first = await bridge.openLocalPlayer({ draftId: 'local-player', expectedRevision: 1 });
    assert.equal(await first.loadCheckpoint(), null);
    const state = first.getSnapshot();
    first.setPersonalization({ profile: { ...state.profile, name: 'Saved local OC' }, soulDocuments: state.soulDocuments }, 0);
    const controls = createMakerV8LocalPlayerControls({ session: { ...first,
      async renderPreview() { return { ...first.getSnapshot().document.canvas }; },
    }, pngExport: { createUrl: () => 'blob:local-export', revokeUrl() {}, download() {} } });
    await controls.initialize();
    await controls.dispatch('player-preview-export');
    await controls.dispatch('player-export-size', { sizeMode: 'original' });
    await controls.dispatch('player-export-background', { transparent: 'true' });
    await controls.flush();
    const saved = await first.loadCheckpoint();
    assert.ok(saved, 'Export option changes automatically persist through the real bundle store.');
    await controls.dispose();
    const second = await bridge.openLocalPlayer({ draftId: 'local-player', expectedRevision: 1 });
    assert.equal(second.getSnapshot().profile.name, '');
    const recovered = await second.loadCheckpoint();
    assert.deepEqual(recovered, saved);
    await second.restoreCheckpoint(recovered.checkpoint, 0);
    assert.equal(second.getSnapshot().profile.name, 'Saved local OC');
    assert.deepEqual(second.getSnapshot().imageExport, { sizeMode: 'original', transparent: true });
    await assert.rejects(second.captureCheckpointSave().commit(null), { code: 'LOCAL_PLAYER_STORE_CAS_CONFLICT' });
    assert.deepEqual(await second.captureCheckpointSave().commit({ revision: saved.revision, contentHash: saved.contentHash }), saved);
    assert.equal(runtime.calls.ready, 0);
    assert.equal(runtime.calls.player, 0);
    assert.equal(storage.calls.cas, 0);
    assert.equal(storage.calls.bundle, 0);
  } finally { bridge.dispose(); checkpointStore.close(); }
});

test('captured local save tasks retain immutable bytes and original binding after a newer session invalidates their model', async () => {
  const runtime = runtimeHarness();
  const storage = draftHarness();
  const checkpointStore = createMakerV8LocalPlayerStore(new IDBFactory());
  const bridge = createMakerV8ProductBridge({ productRuntime: runtime.productRuntime, drafts: storage.drafts, localPlayerStore: checkpointStore });
  try {
    await seedMinimalArtworkDraft(storage.drafts, { draftId: 'local-player', name: 'Local Player' });
    const old = await bridge.openLocalPlayer({ draftId: 'local-player', expectedRevision: 1 });
    let state = old.getSnapshot();
    old.setPersonalization({ profile: { ...state.profile, name: 'First' }, soulDocuments: state.soulDocuments }, state.revision);
    const first = old.captureCheckpointSave();
    state = old.getSnapshot();
    old.setPersonalization({ profile: { ...state.profile, name: 'Latest' }, soulDocuments: state.soulDocuments }, state.revision);
    const latest = old.captureCheckpointSave();
    const active = await bridge.openLocalPlayer({ draftId: 'local-player', expectedRevision: 1 });
    assert.throws(() => old.captureCheckpointSave(), { code: 'STALE_LOCAL_PLAYER' });
    const a = await first.commit(null);
    const b = await latest.commit({ revision: a.revision, contentHash: a.contentHash });
    assert.equal(JSON.parse(JSON.parse(a.checkpoint).checkpoint).profile.name, 'First');
    assert.equal(JSON.parse(JSON.parse(b.checkpoint).checkpoint).profile.name, 'Latest');
    assert.equal(active.getSnapshot().profile.name, '', 'An old commit cannot mutate the active UI model.');
    assert.deepEqual(await active.loadCheckpoint(), b);
    await active.restoreCheckpoint(b.checkpoint, 0);
    assert.equal(active.getSnapshot().profile.name, 'Latest');
  } finally { bridge.dispose(); checkpointStore.close(); }
});

test('local Player rejects same-revision cold-read asset/document drift and late renders', async (context) => {
  for (const drift of ['asset', 'document', 'revision', 'recipe', 'new-session', 'dispose']) {
    await context.test(drift, async () => {
      const runtime = runtimeHarness();
      const storage = draftHarness();
      let release;
      let entered;
      const started = new Promise((resolve) => { entered = resolve; });
      const gate = new Promise((resolve) => { release = resolve; });
      const bridge = createMakerV8ProductBridge({
        productRuntime: runtime.productRuntime, drafts: storage.drafts,
        rendering: { async renderDraft() {
          entered();
          await gate;
          return { schemaVersion: 'animacraft.maker-v8-player-render.v1', mediaType: 'image/png',
            width: 1024, height: 1024, bytesBase64: 'AQ==', byteLength: 1, sha256: byteHash('AQ==') };
        } },
      });
      const draft = await seedMinimalArtworkDraft(storage.drafts, { draftId: 'local-player', name: 'Local Player' });
      // Add a second legal Output so a pure recipe mutation need not edit the source.
      const document = structuredClone(draft.document);
      document.outputs.push({ ...structuredClone(document.outputs[0]), key: 'second-output' });
      await bridge.replaceDraftDocument({ draftId: 'local-player', expectedRevision: 1, document });
      const session = await bridge.openLocalPlayer({ draftId: 'local-player', expectedRevision: 2 });
      const pending = session.renderPreview();
      const rejected = assert.rejects(pending, { code: 'STALE_LOCAL_PLAYER' });
      await started;
      if (drift === 'asset') {
        const asset = (await session.getAssets())[0];
        const bytes = Buffer.from(asset.bytesBase64, 'base64');
        bytes[0] ^= 1;
        storage.mutateAsset('local-player', 'base-default', { bytesBase64: bytes.toString('base64') });
      }
      if (drift === 'document') {
        const row = await storage.drafts.load('local-player');
        row.document.metadata.name = 'Changed by another tab';
        storage.mutateDraft('local-player', { document: row.document });
      }
      if (drift === 'revision') storage.mutateDraft('local-player', { revision: 3 });
      if (drift === 'recipe') {
        session.setRecipe({ ...structuredClone(session.getSnapshot().recipe), outputKey: 'second-output' }, 0);
      }
      if (drift === 'new-session') await bridge.openLocalPlayer({ draftId: 'local-player', expectedRevision: 2 });
      if (drift === 'dispose') bridge.dispose();
      release();
      await rejected;
      assert.equal(runtime.calls.ready, 0);
      bridge.dispose();
    });
  }
});

test('Creator mutation and explicit close invalidate only local Player handles', async () => {
  const runtime = runtimeHarness();
  const storage = draftHarness();
  const bridge = createMakerV8ProductBridge({ productRuntime: runtime.productRuntime, drafts: storage.drafts });
  const draft = await seedMinimalArtworkDraft(storage.drafts, { draftId: 'local-player', name: 'Local Player' });
  const first = await bridge.openLocalPlayer({ draftId: 'local-player', expectedRevision: 1 });
  first.dispose();
  assert.throws(() => first.getSnapshot(), { code: 'STALE_LOCAL_PLAYER' });
  const second = await bridge.openLocalPlayer({ draftId: 'local-player', expectedRevision: 1 });
  first.dispose();
  assert.equal(second.getSnapshot().draftId, 'local-player', 'Old close must not invalidate a newer session.');
  await bridge.replaceDraftDocument({ draftId: 'local-player', expectedRevision: 1, document: draft.document });
  assert.throws(() => second.getSnapshot(), { code: 'STALE_LOCAL_PLAYER' });
  assert.equal(runtime.calls.ready, 0);
  bridge.dispose();
});

test('late local Player hydration cannot revive after a newer open or bridge disposal', async (context) => {
  for (const dispose of [false, true]) {
    await context.test(dispose ? 'dispose' : 'newer open', async () => {
      const runtime = runtimeHarness();
      const storage = draftHarness();
      const load = storage.drafts.load;
      let intercept = false;
      let release;
      let entered;
      const gate = new Promise((resolve) => { release = resolve; });
      const started = new Promise((resolve) => { entered = resolve; });
      storage.drafts.load = async (id) => {
        const record = await load(id);
        if (intercept) { intercept = false; entered(); await gate; }
        return record;
      };
      const bridge = createMakerV8ProductBridge({ productRuntime: runtime.productRuntime, drafts: storage.drafts });
      await seedMinimalArtworkDraft(storage.drafts, { draftId: 'local-player', name: 'Local Player' });
      intercept = true;
      const pending = bridge.openLocalPlayer({ draftId: 'local-player', expectedRevision: 1 });
      const rejected = assert.rejects(pending, { code: 'STALE_LOCAL_PLAYER' });
      await started;
      let newer;
      if (dispose) bridge.dispose();
      else newer = await bridge.openLocalPlayer({ draftId: 'local-player', expectedRevision: 1 });
      release();
      await rejected;
      if (newer) assert.equal(newer.getSnapshot().draftId, 'local-player');
      assert.equal(runtime.calls.ready, 0);
      bridge.dispose();
    });
  }
});

test('local storage failures are preserved without initializing chain authority', async () => {
  const { productRuntime, calls } = runtimeHarness();
  const storage = draftHarness();
  const unavailable = new Error('IndexedDB unavailable');
  storage.drafts.list = async () => { throw unavailable; };
  const bridge = createMakerV8ProductBridge({ productRuntime, drafts: storage.drafts });
  await assert.rejects(bridge.listDrafts(), unavailable);
  assert.equal(calls.ready, 0);
  bridge.dispose();
});

test('bridge exposes truthful read surfaces and a soft wallet disconnect', async () => {
  const { productRuntime, calls } = runtimeHarness();
  const { drafts } = draftHarness();
  const bridge = createMakerV8ProductBridge({ productRuntime, drafts });
  const observed = [];
  const off = bridge.subscribe((state) => observed.push(state));

  assert.equal((await bridge.getWalletState()).status, 'disconnected');
  assert.equal((await bridge.connectWallet()).status, 'connected');
  assert.equal((await bridge.listTemplates()).makers[0].title, 'Certified Maker');
  assert.equal((await bridge.getTemplate({ makerId: `0x${'34'.repeat(32)}` })).title, 'Certified Maker');
  assert.deepEqual(await bridge.listDrafts(), []);
  const certifiedAsset = {
    assetId: 'base-default',
    blobId: 'walrus-asset',
    mediaType: 'image/png',
    byteLength: 1,
    sha256: 'ab'.repeat(32),
  };
  const artwork = await bridge.loadCertifiedAsset({ asset: certifiedAsset });
  assert.equal(artwork.dataUrl, 'data:image/png;base64,AQ==');
  assert.equal(artwork.sha256, certifiedAsset.sha256);
  assert.equal(calls.asset, 1);
  assert.equal((await bridge.disconnectWallet()).status, 'disconnected');
  assert.equal((await bridge.getWalletState()).status, 'disconnected');
  assert.equal(calls.ready, 1, 'runtime readiness is memoized');
  assert.equal(calls.reconnect, 1);
  assert.ok(observed.some((entry) => entry.runtime.status === 'READY'));
  assert.equal(Object.hasOwn(bridge, 'preparePublication'), false);
  assert.equal(Object.hasOwn(bridge, 'performMarketAction'), false);
  off();
  bridge.dispose();
});

test('Template Plaza lists only certified runtime Makers and ignores local starter injection', async () => {
  const { productRuntime } = runtimeHarness();
  const { drafts } = draftHarness();
  const bridge = createMakerV8ProductBridge({
    productRuntime,
    drafts,
    starters: {
      list() { throw new Error('local starter catalogs must not be consulted'); },
      has() { return true; },
      load() { throw new Error('local starter Makers must not be opened'); },
    },
  });
  const templates = await bridge.listTemplates();
  assert.deepEqual(templates.makers.map((maker) => maker.title), ['Certified Maker']);
  assert.equal(Object.hasOwn(templates, 'bundledStarterCount'), false);
  bridge.dispose();
});

test('certified artwork rejects executable image formats before reaching the view', async () => {
  const { productRuntime } = runtimeHarness();
  const { drafts } = draftHarness();
  const bridge = createMakerV8ProductBridge({ productRuntime, drafts });
  await assert.rejects(
    bridge.loadCertifiedAsset({
      asset: {
        assetId: 'unsafe-vector',
        blobId: 'walrus-svg',
        mediaType: 'image/svg+xml',
        byteLength: 1,
        sha256: 'cd'.repeat(32),
      },
    }),
    (error) => error.code === 'MAKER_V8_PRODUCT_ASSET_MEDIA_UNSAFE'
      && error.layer === 'ASSET',
  );
  bridge.dispose();
});

test('public Template detail never loads wallet inventory or contextual choices', async () => {
  const rootId = `0x${'34'.repeat(32)}`;
  const packAsset = {
    assetId: 'pack-art', blobId: 'pack-art-blob', mediaType: 'image/png',
    byteLength: 1, sha256: 'ab'.repeat(32),
  };
  const { productRuntime, calls } = runtimeHarness({
    connected: true,
    contextualChoices: {
      schemaVersion: 'animacraft.maker-v8-contextual-choices.v1',
      certifiedAssets: [packAsset], packStyles: [], externalStyles: [],
      baseEntitlements: [], diagnostics: [],
    },
  });
  productRuntime.catalog.loadPlayer = async () => ({
    status: 'READY', diagnostics: [], player: {
      rootId, title: 'Certified Maker', certifiedAssets: [],
    },
  });
  const { drafts } = draftHarness();
  const bridge = createMakerV8ProductBridge({ productRuntime, drafts });
  const player = await bridge.getTemplate({ makerId: rootId });
  assert.equal(Object.hasOwn(player, 'contextualChoices'), false);
  assert.deepEqual(player.certifiedAssets, []);
  assert.equal(calls.choices ?? 0, 0);
  assert.equal(Object.hasOwn(bridge, 'listWardrobe'), false);
  bridge.dispose();
});

test('Creator saves an existing complete artwork draft with CAS and produces a public preview', async () => {
  const { productRuntime } = runtimeHarness();
  const { drafts, calls } = draftHarness();
  let clock = 10;
  const bridge = createMakerV8ProductBridge({ productRuntime, drafts, now: () => clock++ });
  const input = {
    makerId: 'creator-draft',
    name: 'Creator Draft',
    description: 'First revision',
    canvas: '1024×1024',
  };
  const created = await seedMinimalArtworkDraft(drafts, { draftId: input.makerId, name: input.name, createdAt: 10 });
  assert.equal(created.revision, 1);
  const updated = await bridge.saveDraft({ ...input, description: 'Second revision' });
  assert.equal(updated.revision, 2);
  assert.equal(updated.document.metadata.summary, 'Second revision');
  const preview = await bridge.previewMaker(input);
  assert.equal(preview.document.protocolVersion, 8);
  assert.equal(preview.preview.parts.length, 1);
  assert.deepEqual(preview.issues, []);
  assert.equal(calls.create, 1);
  assert.equal(calls.createBundle, 1);
  assert.equal(calls.cas, 1);
  bridge.dispose();
});

test('Creator batch editing commits document and artwork through one draft CAS', async () => {
  const { productRuntime } = runtimeHarness();
  const { drafts, calls } = draftHarness();
  let clock = 50;
  const bridge = createMakerV8ProductBridge({ productRuntime, drafts, now: () => clock++ });
  const created = await bridge.createDraft({
    makerId: 'atomic-creator', name: 'Atomic Creator', description: '', canvas: '1024×1024',
  });
  const result = await bridge.dispatchDraftTransaction({
    draftId: created.draftId,
    expectedRevision: created.revision,
    commands: [{
      type: 'asset.upsert',
      row: { id: 'accent', kind: 'layer', mediaType: 'image/png', byteLength: 2 },
    }],
    assetUpserts: [{
      assetId: 'accent', expectedRevision: null, kind: 'layer', mediaType: 'image/png',
      bytesBase64: toBase64(new Uint8Array([4, 5])),
    }],
  });
  assert.equal(result.draft.revision, 2);
  assert.equal(result.draft.document.assets.some((asset) => asset.id === 'accent'), true);
  assert.equal(result.assets.some((asset) => asset.assetId === 'accent'), true);
  assert.equal(calls.bundle, 1);
  bridge.dispose();
});

test('approved Version history creates only an exact archived N+1 successor draft', async () => {
  const previousRootId = `0x${'45'.repeat(32)}`;
  const versionCommitment = 'ab'.repeat(32);
  const lineageDocument = makerV8DocumentFromProductDraft({ makerId: 'lineage-maker', name: 'Lineage Maker' });
  const lineage = [{
    rootId: previousRootId,
    makerKey: 'lineage-maker',
    makerVersion: 1,
    versionCommitment,
    previousRootId: null,
    previousVersionCommitment: null,
    successorRootId: null,
    lifecycle: 'ARCHIVED',
    ownerAddress: address,
    document: lineageDocument,
  }];
  const { productRuntime, calls } = runtimeHarness({ connected: true, lineage });
  const { drafts, calls: draftCalls } = draftHarness();
  let clock = 600;
  const bridge = createMakerV8ProductBridge({ productRuntime, drafts, now: () => clock++ });
  const source = await seedMinimalArtworkDraft(drafts, {
    draftId: 'lineage-maker', name: 'Lineage Maker', createdAt: 600,
  });
  const observed = await bridge.listMakerLineage({ draftId: source.draftId });
  assert.equal(observed[0].rootId, previousRootId);
  const successor = await bridge.createSuccessorDraft({
    draftId: source.draftId,
    expectedRevision: source.revision,
    previousRootId,
  });
  assert.equal(successor.draft.document.lineage.version, 2);
  assert.equal(successor.draft.document.lineage.previousRootId, previousRootId);
  assert.equal(successor.draft.document.lineage.previousVersionCommitment, versionCommitment);
  assert.equal(successor.assets.length, 1);
  assert.equal(draftCalls.successor, 1);
  assert.equal(calls.lineage, 2);

  lineage[0].ownerAddress = `0x${'99'.repeat(32)}`;
  await assert.rejects(
    bridge.createSuccessorDraft({
      draftId: source.draftId,
      expectedRevision: source.revision,
      previousRootId,
    }),
    (error) => error.code === 'MAKER_V8_PRODUCT_SUCCESSOR_PREDECESSOR_INVALID',
  );
  bridge.dispose();
});

test('Creator undo and redo replace the exact v8 document through durable CAS', async () => {
  const { productRuntime } = runtimeHarness();
  const { drafts, calls } = draftHarness();
  let clock = 40;
  const bridge = createMakerV8ProductBridge({ productRuntime, drafts, now: () => clock++ });
  const created = await bridge.createDraft({
    makerId: 'undo-draft',
    name: 'Undo Draft',
    description: 'Original',
    canvas: '1024×1024',
  });
  const original = structuredClone(created.document);
  const changed = await bridge.dispatchDraftCommand({
    draftId: created.draftId,
    expectedRevision: created.revision,
    command: {
      type: 'part.upsert',
      row: {
        ...structuredClone(created.document.parts[0]),
        label: 'Changed Base',
      },
    },
  });
  assert.equal(changed.revision, 2);
  assert.equal(changed.document.parts[0].label, 'Changed Base');

  const undone = await bridge.replaceDraftDocument({
    draftId: created.draftId,
    expectedRevision: changed.revision,
    document: original,
  });
  assert.equal(undone.revision, 3);
  assert.deepEqual(undone.document, original);
  assertMakerV8Document(undone.document, { mode: 'draft' });
  assert.equal(calls.cas, 2);

  assert.deepEqual((await bridge.listDraftVersions({ draftId: created.draftId })).map((row) => row.revision), [3, 2, 1]);
  const restored = await bridge.restoreDraftVersion({
    draftId: created.draftId,
    expectedRevision: undone.revision,
    revision: changed.revision,
  });
  assert.equal(restored.revision, 4);
  assert.equal(restored.document.parts[0].label, 'Changed Base');

  await assert.rejects(
    bridge.replaceDraftDocument({
      draftId: created.draftId,
      expectedRevision: undone.revision,
      document: changed.document,
    }),
    (error) => error.code === 'MAKER_V8_PRODUCT_DRAFT_CAS_MISMATCH'
      && error.layer === 'DRAFT',
  );
  bridge.dispose();
});

test('Creator Project ZIP is a real bounded archive around the exact v8 export', async () => {
  const { productRuntime } = runtimeHarness();
  const { drafts, calls } = draftHarness();
  const bridge = createMakerV8ProductBridge({ productRuntime, drafts, now: () => 80 });
  const created = await bridge.createDraft({ makerId: 'zip-draft', name: 'ZIP Draft', canvas: '1024×1024' });
  const archive = await bridge.exportProjectZip({ makerId: created.draftId });
  assert.equal(archive.mediaType, 'application/zip');
  assert.equal(archive.fileName, 'zip-draft.animacraft.zip');
  assert.equal(fromBase64(archive.bytesBase64).byteLength, archive.byteLength);
  const imported = await bridge.importProjectZip({ bytesBase64: archive.bytesBase64 });
  assert.equal(imported.draft.draftId, created.draftId);
  assert.equal(calls.import, 1);
  const replaced = await bridge.replaceDraftFromProjectZip({
    draftId: created.draftId,
    expectedRevision: created.revision,
    bytesBase64: archive.bytesBase64,
  });
  assert.equal(replaced.draft.revision, 2);
  assert.equal(calls.replace, 1);
  const tampered = fromBase64(archive.bytesBase64);
  tampered[30 + MAKER_V8_PROJECT_ZIP_ENTRY.length] ^= 1;
  await assert.rejects(
    bridge.importProjectZip({ bytesBase64: toBase64(tampered) }),
    (error) => error.code === 'MAKER_V8_PROJECT_ZIP_CRC_MISMATCH',
  );
  bridge.dispose();
});

test('explicitly disabled execution rejects publication before wallet or runtime calls', async () => {
  const context = { window: {} };
  runInNewContext(await readFile(new URL('../public-v8/config.js', import.meta.url), 'utf8'), context);
  const { productRuntime, calls } = runtimeHarness({ connected: true });
  const { drafts } = draftHarness();
  let signatures = 0;
  const bridge = createMakerV8ProductBridge({
    productRuntime, drafts,
    execution: { ...context.window.SoulidityV8Execution, allowWalletSignature: false, allowBroadcast: false },
    publication: {
      async prepare() { throw new Error('Not a preparation test'); },
      async resume() { throw new Error('Not a recovery test'); },
      async requestSignature() { signatures += 1; },
      async recoverOutcome() { throw new Error('Not a recovery test'); },
    },
  });
  try {
    await assert.rejects(bridge.signMakerPublication({ attemptId: 'historical-attempt' }),
      { code: 'MAKER_V8_PRODUCT_EXECUTION_DISABLED' });
    await assert.rejects(bridge.continueMakerPublication({ draftId: 'historical-draft' }),
      { code: 'MAKER_V8_PRODUCT_EXECUTION_DISABLED' });
    assert.equal(signatures, 0);
    assert.equal(calls.ready, 0);
    assert.equal(calls.reconnect, 0);
  } finally { bridge.dispose(); }
});

test('exact saved Maker review never saves a projection and rejects stale drafts before signing', async () => {
  const { productRuntime } = runtimeHarness({ connected: true });
  const source = draftHarness();
  await seedMinimalArtworkDraft(source.drafts, { draftId: 'review-maker', name: 'Original' });
  const bindings = new Map();
  let signs = 0;
  const step = { id: 'upload-one', revision: 1, digest: 'digest-one', stage: 'REGISTER', gasBudgetMist: '1000' };
  const bridge = createMakerV8ProductBridge({ productRuntime, drafts: source.drafts,
    publication: {}, publicationTransport: {
      async loadBinding(key) { return bindings.get(key) ?? null; },
      async saveBinding(key, expected, value) { const result = { ...value, key, revision: (expected ?? 0) + 1 }; bindings.set(key, result); return result; },
      async prepareReview() { return { status: 'TRANSPORT_SIGNATURE_REQUIRED', stage: 'ASSET', upload: { uploadId: step.id }, step, plan: null }; },
      async signReviewed() { signs += 1; },
    }, execution: { allowWalletSignature: true, allowBroadcast: true } });
  const view = await bridge.prepareMakerPublication({ draftId: 'review-maker', expectedRevision: 1 });
  assert.equal(view.scope.draftRevision, 1);
  assert.equal(view.nextAction, 'SIGN');
  assert.equal(source.calls.cas, 0);
  source.mutateDraft('review-maker', { revision: 2 });
  await assert.rejects(bridge.signMakerPublication({ reviewId: view.reviewId }), { code: 'MAKER_V8_PRODUCT_PUBLICATION_STALE' });
  assert.equal(signs, 0);
  for (const name of ['preparePublication', 'resumePublication', 'recoverPublication', 'requestPublicationSignature']) {
    assert.equal(Object.hasOwn(bridge, name), false, 'retired unscoped publication API is removed');
  }
  bridge.dispose();
});

function publicationReviewHarness() {
  const runtime = runtimeHarness({ connected: true });
  const source = draftHarness();
  const bindings = new Map();
  let uploadRevision = 1, signed = false, complete = false, pauseSign = null, pausePrepare = null, prepares = 0;
  const calls = [];
  const transport = {
    async loadBinding(key) { return structuredClone(bindings.get(key) ?? null); },
    async saveBinding(key, expected, value) {
      assert.equal(bindings.get(key)?.revision ?? null, expected);
      const result = { ...structuredClone(value), key, revision: (expected ?? 0) + 1 };
      bindings.set(key, result); return structuredClone(result);
    },
    async prepareReview(input) {
      prepares += 1;
      if (pausePrepare) await pausePrepare();
      calls.push(['prepare', input.attemptNonce]);
      if (complete) return { plan: { attemptId: 'exact-attempt' } };
      const upload = { uploadId: 'exact-upload', revision: uploadRevision, stage: 'REGISTER',
        epochs: 3, deletable: false,
        status: signed ? 'RECOVERY_REQUIRED' : 'SIGNATURE_REQUIRED', transactionDigest: signed ? 'exact-digest' : null };
      return { status: signed ? 'TRANSPORT_RECOVERY_REQUIRED' : 'TRANSPORT_SIGNATURE_REQUIRED',
        stage: 'ASSET', upload, plan: null,
        step: signed ? null : { id: upload.uploadId, revision: uploadRevision, stage: 'REGISTER',
          status: 'SIGNATURE_REQUIRED', digest: 'exact-digest', gasBudgetMist: '10000000', gasPriceMist: '1000',
          storageEpochs: 3, deletable: false, storageCostAtomic: null, relayTipMist: null } };
    },
    async signReviewed(step, check) {
      assert.equal(step.revision, uploadRevision);
      await check();
      if (pauseSign) await pauseSign();
      calls.push(['sign', step.digest]); signed = true; uploadRevision += 1;
    },
    async continueReviewed(step) {
      assert.equal(step.revision, uploadRevision);
      calls.push(['continue', step.digest]); complete = true; uploadRevision += 1;
    },
  };
  const rootId = `0x${'34'.repeat(32)}`;
  const publication = {
    async inspect() { return { plan: { attemptId: 'exact-attempt', status: 'COMPLETE', immutable: { signerAddress: address } },
      identity: { rootId, makerVersion: 1, complete: true } }; },
    async lookupFinalized() { return { rootId, makerVersion: 1, complete: true }; },
  };
  const makeBridge = (runtimeConfig = runtime.productRuntime.runtime) => createMakerV8ProductBridge({
    productRuntime: { ...runtime.productRuntime, runtime: runtimeConfig }, drafts: source.drafts,
    publication, publicationTransport: transport, execution: { allowWalletSignature: true, allowBroadcast: true } });
  return { ...runtime, ...source, calls, bindings, rootId, makeBridge, publication,
    pauseSign(value) { pauseSign = value; }, pausePrepare(value) { pausePrepare = value; },
    get prepares() { return prepares; } };
}

test('Creator publication reviews one step, signs only it, and explicit continuation cold-recovers certified Root', async () => {
  const value = publicationReviewHarness();
  await seedMinimalArtworkDraft(value.drafts, { draftId: 'publish-maker', name: 'Frozen Original' });
  const bridge = value.makeBridge();
  const prepared = await bridge.prepareMakerPublication({ draftId: 'publish-maker', expectedRevision: 1 });
  assert.equal(prepared.nextAction, 'SIGN');
  assert.equal(prepared.frozenMakerName, 'Frozen Original');
  assert.equal(value.calls.some(([kind]) => ['sign', 'continue'].includes(kind)), false);
  const signed = await bridge.signMakerPublication({ reviewId: prepared.reviewId });
  assert.equal(signed.nextAction, 'CONTINUE');
  assert.equal(value.calls.filter(([kind]) => kind === 'sign').length, 1);
  assert.equal(value.calls.filter(([kind]) => kind === 'continue').length, 0);
  bridge.dispose();
  const restored = value.makeBridge();
  const recovered = await restored.inspectMakerPublication({ draftId: 'publish-maker', expectedRevision: 1 });
  assert.equal(recovered.nextAction, 'CONTINUE');
  assert.equal(value.calls.filter(([kind]) => kind === 'continue').length, 0);
  const done = await restored.continueMakerPublication({ reviewId: recovered.reviewId });
  assert.equal(done.status, 'COMPLETE');
  assert.equal(done.rootId, value.rootId);
  const before = value.prepares;
  assert.equal((await restored.getPublishedMaker({ draftId: 'publish-maker' })).rootId, value.rootId);
  assert.equal(value.prepares, before, 'catalog lookup must not create a new publication');
  restored.dispose();
});

test('signed publication keeps its original snapshot after edits and two bridge instances cannot prompt twice', async () => {
  const value = publicationReviewHarness();
  await seedMinimalArtworkDraft(value.drafts, { draftId: 'publish-maker', name: 'Frozen Original' });
  const first = value.makeBridge(), second = value.makeBridge();
  const a = await first.prepareMakerPublication({ draftId: 'publish-maker', expectedRevision: 1 });
  const b = await second.prepareMakerPublication({ draftId: 'publish-maker', expectedRevision: 1 });
  let release;
  value.pauseSign(() => new Promise(resolve => { release = resolve; }));
  const signing = first.signMakerPublication({ reviewId: a.reviewId });
  while (!release) await new Promise(resolve => setImmediate(resolve));
  const competing = second.signMakerPublication({ reviewId: b.reviewId });
  release();
  await signing;
  await assert.rejects(competing, { code: 'MAKER_V8_PRODUCT_PUBLICATION_STALE' });
  assert.equal(value.calls.filter(([kind]) => kind === 'sign').length, 1);
  const record = await value.drafts.load('publish-maker');
  value.mutateDraft('publish-maker', { revision: 2, document: { ...record.document,
    metadata: { ...record.document.metadata, name: 'New unsent work' } } });
  const old = await second.prepareMakerPublication({ draftId: 'publish-maker', expectedRevision: 2 });
  assert.equal(old.scope.draftRevision, 1);
  assert.equal(old.scope.currentSavedRevision, 2);
  assert.equal(old.scope.publishingEarlierRevision, true);
  assert.equal(old.frozenMakerName, 'Frozen Original');
  assert.equal(old.nextAction, 'CONTINUE');
  assert.equal((await value.drafts.load('publish-maker')).document.metadata.name, 'New unsent work');
  first.dispose(); second.dispose();
});

test('wallet changes and route cancellation cannot authorize stale publication', async () => {
  for (const change of ['wallet', 'route', 'cancel']) {
    const value = publicationReviewHarness();
    await seedMinimalArtworkDraft(value.drafts, { draftId: 'publish-maker', name: 'Original' });
    const bridge = value.makeBridge();
    const review = await bridge.prepareMakerPublication({ draftId: 'publish-maker', expectedRevision: 1 });
    if (change === 'wallet') value.setAccount({ address: `0x${'56'.repeat(32)}`, network: 'mainnet' });
    else if (change === 'route') bridge.navigate({ name: 'plaza' });
    else bridge.cancelMakerPublicationReview();
    await assert.rejects(bridge.signMakerPublication({ reviewId: review.reviewId }), { code: 'MAKER_V8_PRODUCT_PUBLICATION_STALE' });
    assert.equal(value.calls.some(([kind]) => kind === 'sign'), false);
    bridge.dispose();
  }
});

test('first definitive rejection permits edited re-review while unknown signing retains the frozen source', async () => {
  for (const rejected of [true, false]) {
    const value = publicationReviewHarness();
    await seedMinimalArtworkDraft(value.drafts, { draftId: 'rejected-maker', name: 'Original' });
    const bridge = value.makeBridge();
    const review = await bridge.prepareMakerPublication({ draftId: 'rejected-maker', expectedRevision: 1 });
    value.pauseSign(async () => { throw Object.assign(new Error('wallet outcome'), rejected
      ? { definitiveRejection: true, signedArtifactCreated: false } : { code: 'UNKNOWN_WALLET_RESULT' }); });
    await assert.rejects(bridge.signMakerPublication({ reviewId: review.reviewId }));
    const record = await value.drafts.load('rejected-maker');
    value.mutateDraft('rejected-maker', { revision: 2, document: { ...record.document,
      metadata: { ...record.document.metadata, name: 'Corrected' } } });
    const next = await bridge.prepareMakerPublication({ draftId: 'rejected-maker', expectedRevision: 2 });
    assert.equal(next.scope.draftRevision, rejected ? 2 : 1);
    assert.equal(next.frozenMakerName, rejected ? 'Corrected' : 'Original');
    assert.equal(value.calls.some(([kind]) => kind === 'sign'), false);
    bridge.dispose();
  }
});

test('different drafts sharing one Walrus upload serialize wallet prompts and late preparation stays cancelled', async () => {
  const value = publicationReviewHarness();
  await seedMinimalArtworkDraft(value.drafts, { draftId: 'first-maker', name: 'First' });
  await seedMinimalArtworkDraft(value.drafts, { draftId: 'second-maker', name: 'Second' });
  const first = value.makeBridge(), second = value.makeBridge();
  const a = await first.prepareMakerPublication({ draftId: 'first-maker', expectedRevision: 1 });
  const b = await second.prepareMakerPublication({ draftId: 'second-maker', expectedRevision: 1 });
  let release;
  value.pauseSign(() => new Promise(resolve => { release = resolve; }));
  const signing = first.signMakerPublication({ reviewId: a.reviewId });
  while (!release) await new Promise(resolve => setImmediate(resolve));
  const rejected = assert.rejects(second.signMakerPublication({ reviewId: b.reviewId }));
  release(); await signing; await rejected;
  assert.equal(value.calls.filter(([kind]) => kind === 'sign').length, 1);
  let releasePrepare;
  value.pausePrepare(() => new Promise(resolve => { releasePrepare = resolve; }));
  const late = first.prepareMakerPublication({ draftId: 'first-maker', expectedRevision: 1 });
  while (!releasePrepare) await new Promise(resolve => setImmediate(resolve));
  first.cancelMakerPublicationReview(); releasePrepare();
  await assert.rejects(late, { code: 'MAKER_V8_PRODUCT_PUBLICATION_STALE' });
  first.dispose(); second.dispose();
});

test('different releases retain distinct bindings but share the wallet lock for content-deduplicated uploads', async () => {
  const value = publicationReviewHarness();
  await seedMinimalArtworkDraft(value.drafts, { draftId: 'cross-release', name: 'Same source' });
  const first = value.makeBridge();
  const second = value.makeBridge({ ...publicationRuntime, catalogId: `0x${'77'.repeat(32)}` });
  const a = await first.prepareMakerPublication({ draftId: 'cross-release', expectedRevision: 1 });
  const b = await second.prepareMakerPublication({ draftId: 'cross-release', expectedRevision: 1 });
  assert.notEqual(a.scope.releaseIdentity, b.scope.releaseIdentity);
  assert.equal(a.step.id, b.step.id);
  let release;
  value.pauseSign(() => new Promise(resolve => { release = resolve; }));
  const signing = first.signMakerPublication({ reviewId: a.reviewId });
  while (!release) await new Promise(resolve => setImmediate(resolve));
  const rejected = assert.rejects(second.signMakerPublication({ reviewId: b.reviewId }));
  release(); await signing; await rejected;
  assert.equal(value.calls.filter(([kind]) => kind === 'sign').length, 1);
  first.dispose(); second.dispose();
});

test('an authenticated scaffold Root is withheld until final activation is certified complete', async () => {
  const value = publicationReviewHarness();
  await seedMinimalArtworkDraft(value.drafts, { draftId: 'partial-maker', name: 'Partial' });
  const bridge = value.makeBridge();
  let review = await bridge.prepareMakerPublication({ draftId: 'partial-maker', expectedRevision: 1 });
  review = await bridge.signMakerPublication({ reviewId: review.reviewId });
  value.publication.inspect = async () => ({ plan: { attemptId: 'exact-attempt', revision: 3,
    status: 'ACTIVE', immutable: { signerAddress: address },
    current: { kind: 'BASE_CHUNK', outcome: { status: 'OUTCOME_PENDING', digest: 'exact-digest' } } },
    identity: { rootId: value.rootId, makerVersion: 1, complete: false } });
  const partial = await bridge.continueMakerPublication({ reviewId: review.reviewId });
  assert.equal(partial.rootId, null);
  assert.equal(partial.status, 'OUTCOME_PENDING');
  bridge.dispose();
});

test('mismatched signing and broadcast gates fail before any runtime or wallet side effect', () => {
  const { productRuntime, calls } = runtimeHarness();
  const { drafts } = draftHarness();
  assert.throws(
    () => createMakerV8ProductBridge({
      productRuntime,
      drafts,
      execution: { allowWalletSignature: true, allowBroadcast: false },
    }),
    (error) => error.code === 'MAKER_V8_PRODUCT_EXECUTION_GATE_INVALID',
  );
  assert.equal(calls.ready, 0);
  assert.equal(calls.reconnect, 0);
});

test('Pack local parent capture uses its durable export without requiring a published Plaza match', async () => {
  const { productRuntime } = runtimeHarness({ connected: true });
  const drafts = createMakerV8DraftPersistence(new IDBFactory(), { databaseName: 'pack-local-parent' });
  const unavailable = async () => { throw new Error('No publication in local authoring'); };
  const pack = { createPackDraft: async input => input, load: unavailable, save: unavailable,
    preview: unavailable, export: unavailable, resumePublication: unavailable,
    requestPublicationSignature: unavailable, recoverPublicationOutcome: unavailable,
    replayPackPublication: unavailable, performLifecycle: unavailable };
  const bridge = createMakerV8ProductBridge({ productRuntime, drafts, pack });
  try {
    await seedMinimalArtworkDraft(drafts, { draftId: 'parent', name: 'Local parent' });
    const captured = await bridge.createPackDraft({ makerDraftId: 'parent', draftId: 'child' });
    assert.deepEqual(captured.parent, await drafts.export('parent'));
    assert.equal(captured.rootId, undefined);
    await assert.rejects(bridge.createPackDraft({ makerDraftId: 'parent', rootId: 'ambiguous', draftId: 'child' }),
      { code: 'MAKER_V8_PRODUCT_PACK_PARENT_AMBIGUOUS' });
  } finally { bridge.dispose(); drafts.close(); }
});

for (const bound of [false, true]) test(`Pack merged preview uses captured workspace and exact selection, rejects stale revision and wallet (bound=${bound})`, async () => {
  const h = runtimeHarness({ connected: true });
  const drafts = createMakerV8DraftPersistence(new IDBFactory(), { databaseName: 'pack-parent-preview' });
  const unavailable = async () => { throw new Error('No chain operation in parent preview'); };
  let child, duringRender = () => {};
  const inputs = [];
  const pack = { createPackDraft: unavailable, load: async () => structuredClone(child), save: unavailable,
    loadPreview: async () => {
      const parent = child.document.authoringParent ?? child.document.bindings.parent;
      return structuredClone({ draft: child, document: parent.draft.document, assets: parent.assets });
    },
    preview: unavailable, export: unavailable, resumePublication: unavailable,
    requestPublicationSignature: unavailable, recoverPublicationOutcome: unavailable,
    replayPackPublication: unavailable, performLifecycle: unavailable };
  const png = { schemaVersion: 'animacraft.maker-v8-player-render.v1', mediaType: 'image/png',
    width: 1, height: 1, bytesBase64: MAKER_V8_DEFAULT_ASSET_BASE64,
    byteLength: fromBase64(MAKER_V8_DEFAULT_ASSET_BASE64).length, sha256: byteHash(MAKER_V8_DEFAULT_ASSET_BASE64) };
  const bridge = createMakerV8ProductBridge({ productRuntime: h.productRuntime, drafts, pack,
    rendering: { async renderDraft(input) { inputs.push(structuredClone(input)); duringRender(); return png; } } });
  try {
    const source = await seedMinimalArtworkDraft(drafts, { draftId: 'preview-parent', name: 'Captured parent' });
    const parent = await drafts.export(source.draftId);
    child = { draftId: 'preview-child', revision: 1,
      document: { author: { address }, bindings: { kind: 'LOCAL_DRAFT', parent } } };
    if (bound) {
      child.document.authoringParent = structuredClone(parent);
      child.document.bindings = { root: { objectRef: { objectId: `0x${'34'.repeat(32)}` } } };
    }
    const edited = structuredClone(source.document); edited.metadata.name = 'Later live Maker';
    await bridge.replaceDraftDocument({ draftId: source.draftId, expectedRevision: source.revision, document: edited });
    assert.deepEqual(await bridge.renderPackPreview({ draftId: child.draftId }), png);
    assert.deepEqual(inputs[0], { document: parent.draft.document, assets: parent.assets, recipe: parent.draft.document.defaultRecipe });
    assert.equal((await bridge.getDraft({ draftId: source.draftId })).draft.document.metadata.name, 'Later live Maker');
    const selection = parent.draft.document.defaultRecipe.selections[0];
    await bridge.renderPackPreview({ draftId: child.draftId, selection });
    assert.deepEqual(inputs[1].recipe.selections[0], selection);
    await assert.rejects(bridge.renderPackPreview({ draftId: child.draftId,
      selection: { ...selection, styleKey: 'missing' } }), { code: 'MAKER_V8_PACK_PREVIEW_SELECTION_INVALID' });
    const savedBindings = structuredClone(child.document.bindings);
    duringRender = () => { child.document.bindings = { root: { objectRef: { objectId: `0x${'35'.repeat(32)}` } } }; };
    await assert.rejects(bridge.renderPackPreview({ draftId: child.draftId }), { code: 'STALE_PACK_PREVIEW' });
    child.document.bindings = savedBindings;
    const captured = child.document.authoringParent ?? child.document.bindings.parent;
    const capturedHash = captured.draftSha256;
    duringRender = () => { captured.draftSha256 = 'ff'.repeat(32); };
    await assert.rejects(bridge.renderPackPreview({ draftId: child.draftId }), { code: 'STALE_PACK_PREVIEW' });
    captured.draftSha256 = capturedHash;
    duringRender = () => { child.revision += 1; };
    await assert.rejects(bridge.renderPackPreview({ draftId: child.draftId }), { code: 'STALE_PACK_PREVIEW' });
    duringRender = () => h.setAccount({ address: `0x${'70'.repeat(32)}`, network: 'mainnet' });
    await assert.rejects(bridge.renderPackPreview({ draftId: child.draftId }), { code: 'STALE_PACK_PREVIEW' });
    assert.equal(h.calls.plaza, 0);
  } finally { bridge.dispose(); drafts.close(); }
});

test('Composable Maker inspection uses exact published authority and excludes fixed or disabled Parts', async () => {
  const { productRuntime } = runtimeHarness({ connected: true });
  const { drafts } = draftHarness();
  const record = await seedMinimalArtworkDraft(drafts, { draftId: 'composable-target', name: 'Target' });
  const document = structuredClone(record.document);
  document.composition = { mode: 'COMPOSABLE', thirdPartyAdmission: 'CERTIFIED', itemAssetization: true };
  document.parts[0].wardrobeMode = 'SLOT'; document.parts[0].capacity = 2;
  const rootId = `0x${'34'.repeat(32)}`;
  const authority = { rootId, lifecycle: 'ACTIVE', document, makerVersion: '1',
    composableBinding: { definitionRegistryId: `0x${'35'.repeat(32)}`, baseRegistryId: `0x${'36'.repeat(32)}`,
      packRegistryId: `0x${'37'.repeat(32)}`, admissionAuthorityId: `0x${'38'.repeat(32)}` },
    evidence: { rootId, makerVersion: '1', contentCommitment: 'a'.repeat(64) } };
  productRuntime.catalog.loadPlayer = async () => ({ status: 'READY', diagnostics: [], player: authority });
  let hasMakerControl = true;
  productRuntime.inventory = { load: async () => ({ address, status: 'READY', diagnostics: [],
    items: [{ kind: hasMakerControl ? 'MAKER_ADMIN' : 'EXTERNAL_PRODUCT_CONTROL', id: 'maker-admin', rootId }] }) };
  const source = { uploadId: 'walrus-certified-source', artworkRevision: 2,
    binding: { address, rootId, makerVersion: '1', contentCommitment: 'a'.repeat(64) },
    payload: { partKey: document.parts[0].key, itemKey: 'hat', styleKey: 'blue', layerTrackKey: document.tracks[0].key,
      colorChannelKey: null, defaultSwatchKey: null, assetSha256: 'b'.repeat(64) } };
  const bridge = createMakerV8ProductBridge({ productRuntime, drafts,
    composableTransport: { productSource: async () => structuredClone(source) },
    composable: { build: async input => ({ ...input, signer: address }), prepare() { assert.fail('read only'); }, recover() {} } });
  try {
    assert.equal((await bridge.listComposableMakers())[0].rootId, rootId);
    assert.equal((await bridge.getComposableMaker({ rootId })).parts[0].capacity, 2);
    const admission = await bridge.reviewComposableAdmission({ rootId, productId: 'external-product', action: 'ADMIT_CERTIFIED' });
    assert.equal(admission.makerAdminId, 'maker-admin');
    assert.equal(admission.packRegistryId, authority.composableBinding.packRegistryId);
    await assert.rejects(bridge.reviewComposableAdmission({ rootId, productId: 'external-product', action: 'ADMIT_OPEN' }), { code: 'MAKER_V8_COMPOSABLE_ADMISSION_UNAVAILABLE' });
    hasMakerControl = false;
    await assert.rejects(bridge.reviewComposableAdmission({ rootId, productId: 'external-product', action: 'ADMIT_CERTIFIED' }), { code: 'MAKER_V8_COMPOSABLE_ADMISSION_UNAVAILABLE' });
    hasMakerControl = true;
    const review = await bridge.reviewComposableUpload({ uploadId: source.uploadId });
    assert.equal(review.action, 'CREATE_PRODUCT');
    assert.equal(review.documentSha256, undefined, 'authority loader derives request hash; PNG hash is not request identity');
    assert.equal(review.definitionRegistryId, authority.composableBinding.definitionRegistryId);
    assert.deepEqual(review.payload, source.payload);
    source.binding.makerVersion = '2';
    await assert.rejects(bridge.reviewComposableUpload({ uploadId: source.uploadId }), { code: 'MAKER_V8_COMPOSABLE_TARGET_CHANGED' });
    source.binding.makerVersion = '1';
    document.parts[0].wardrobeMode = 'FIXED';
    assert.deepEqual((await bridge.getComposableMaker({ rootId })).parts, []);
    document.parts[0].wardrobeMode = 'SLOT'; document.composition.thirdPartyAdmission = 'DISABLED';
    assert.deepEqual((await bridge.getComposableMaker({ rootId })).parts, []);
    authority.lifecycle = 'PAUSED';
    await assert.rejects(bridge.getComposableMaker({ rootId }), { code: 'MAKER_V8_COMPOSABLE_TARGET_UNAVAILABLE' });
    authority.lifecycle = 'ACTIVE'; authority.evidence.rootId = 'another-root';
    await assert.rejects(bridge.getComposableMaker({ rootId }), { code: 'MAKER_V8_COMPOSABLE_TARGET_UNAVAILABLE' });
  } finally { bridge.dispose(); drafts.close(); }
});

test('Composable inventory separates controlled Products and rejects partial or wrong-wallet reads', async () => {
  const { productRuntime } = runtimeHarness({ connected: true });
  const { drafts } = draftHarness();
  const controlled = { kind: 'EXTERNAL_PRODUCT_CONTROL', id: 'product', rootId: 'root', lifecycle: 0, objectIds: ['product', 'admin-cap'] };
  let result = { address, status: 'READY', diagnostics: [], items: [controlled, { kind: 'OWNED_EXTERNAL_ITEM', id: 'instance' }] };
  productRuntime.inventory = { async load(input) { assert.deepEqual(input, { address }); return result; } };
  const bridge = createMakerV8ProductBridge({ productRuntime, drafts,
    composable: { build: async input => ({ ...input, signer: address }), prepare() { assert.fail('must not sign'); }, recover() {} } });
  try {
    assert.deepEqual((await bridge.listComposableProducts()).products, [controlled]);
    const item = await bridge.reviewComposableItem({ productId: controlled.id });
    assert.equal(item.action, 'MINT_ITEM');
    assert.equal(item.adminCapId, 'admin-cap');
    assert.equal(item.payload.recipient, address);
    assert.equal((await bridge.reviewComposableProduct({ productId: controlled.id, action: 'PAUSE_PRODUCT' })).action, 'PAUSE_PRODUCT');
    await assert.rejects(bridge.reviewComposableProduct({ productId: controlled.id, action: 'RESUME_PRODUCT' }), { code: 'MAKER_V8_COMPOSABLE_PRODUCT_UNAVAILABLE' });
    await assert.rejects(bridge.reviewComposableProduct({ productId: controlled.id, action: 'TRANSFER_CONTROL', recipient: address }), { code: 'MAKER_V8_COMPOSABLE_RECIPIENT_INVALID' });
    const recipient = `0x${'45'.repeat(32)}`;
    assert.equal((await bridge.reviewComposableProduct({ productId: controlled.id, action: 'TRANSFER_CONTROL', recipient })).payload.recipient, recipient);
    await assert.rejects(bridge.reviewComposableItem({ productId: 'not-controlled' }), { code: 'MAKER_V8_COMPOSABLE_PRODUCT_UNAVAILABLE' });
    result = { ...result, items: [{ ...controlled, lifecycle: 1 }] };
    assert.equal((await bridge.reviewComposableProduct({ productId: controlled.id, action: 'RESUME_PRODUCT' })).action, 'RESUME_PRODUCT');
    assert.equal((await bridge.reviewComposableProduct({ productId: controlled.id, action: 'ARCHIVE_PRODUCT' })).action, 'ARCHIVE_PRODUCT');
    await assert.rejects(bridge.reviewComposableItem({ productId: controlled.id }), { code: 'MAKER_V8_COMPOSABLE_PRODUCT_UNAVAILABLE' });
    result = { ...result, items: [{ ...controlled, lifecycle: 2 }] };
    await assert.rejects(bridge.reviewComposableProduct({ productId: controlled.id, action: 'ARCHIVE_PRODUCT' }), { code: 'MAKER_V8_COMPOSABLE_PRODUCT_UNAVAILABLE' });
    assert.equal((await bridge.reviewComposableProduct({ productId: controlled.id, action: 'TRANSFER_CONTROL', recipient })).payload.recipient, recipient);
    result = { ...result, items: [controlled] };
    result = { ...result, status: 'DEGRADED', diagnostics: [{ code: 'READ_FAILED' }] };
    await assert.rejects(bridge.listComposableProducts(), { code: 'MAKER_V8_COMPOSABLE_INVENTORY_INCOMPLETE' });
    result = { ...result, address: 'another-wallet' };
    await assert.rejects(bridge.listComposableProducts(), { code: 'MAKER_V8_COMPOSABLE_WALLET_CHANGED' });
  } finally { bridge.dispose(); drafts.close(); }
});

test('Composable review reads fresh authority without signing or weakening execution gates', async () => {
  const { productRuntime } = runtimeHarness({ connected: true });
  const { drafts } = draftHarness();
  const calls = [];
  const input = { action: 'MINT_ITEM', productId: 'exact-product' };
  const bridge = createMakerV8ProductBridge({ productRuntime, drafts, composable: {
    async build(value) { calls.push('build'); return { checked: value }; },
    async prepare() { calls.push('sign'); },
    async recover() { calls.push('recover'); },
  }, execution: { allowWalletSignature: false, allowBroadcast: false } });
  try {
    assert.deepEqual(await bridge.reviewComposableAction(input), { checked: input });
    assert.deepEqual(calls, ['build']);
    await assert.rejects(bridge.prepareComposableAction(input), { code: 'MAKER_V8_PRODUCT_EXECUTION_DISABLED' });
    assert.deepEqual(calls, ['build']);
  } finally { bridge.dispose(); drafts.close(); }
});

test('bridge maps the exact Player, Pack, Composable, and Maker lifecycle controller APIs without aliases', async () => {
  const { productRuntime } = runtimeHarness({ connected: true });
  const { drafts } = draftHarness();
  const calls = [];
  const player = {
    getSnapshot() { return { status: 'IDLE' }; },
    async loadPlayer(value) { calls.push(['player.load', value]); return value; },
    setRecipe(value) { calls.push(['player.set', value]); return value; },
    updateRecipe(value) { calls.push(['player.update', value]); return value; },
    resetRecipe() { calls.push(['player.reset']); return true; },
    async preparePlayerAction(value) { calls.push(['player.prepare', value]); return value; },
    async executePlayerAction(value) { calls.push(['player.execute', value]); return value; },
    async recoverPlayerAction(value) { calls.push(['player.recover', value]); return value; },
    async recoverActivePlayerAction(value) { calls.push(['player.recoverActive', value]); return value; },
    async getPlayerAction(value) { calls.push(['player.get', value]); return value; },
  };
  const pack = {
    async createPackDraft(value) { calls.push(['pack.create', value]); return value; },
    async list() { calls.push(['pack.list']); return []; },
    async load(value) { calls.push(['pack.load', value]); return value; },
    async save(value) { calls.push(['pack.save', value]); return value; },
    async bindPublishedParent(value) { calls.push(['pack.bindParent', value]); return value; },
    async upsertAsset(value) { calls.push(['pack.asset', value]); return value; },
    async preview(value) { calls.push(['pack.preview', value]); return value; },
    async export(value) { calls.push(['pack.export', value]); return value; },
    async resumePublication(value) { calls.push(['pack.resume', value]); return value; },
    async requestPublicationSignature(value) { calls.push(['pack.sign', value]); return value; },
    async recoverPublicationOutcome(value) { calls.push(['pack.query', value]); return value; },
    async replayPackPublication(value) { calls.push(['pack.replay', value]); return value; },
    async performLifecycle(value) { calls.push(['pack.lifecycle', value]); return value; },
  };
  const lifecycle = {
    async getSnapshot(value) { calls.push(['lifecycle.read', value]); return value; },
    build(value) { calls.push(['lifecycle.build', value]); return { built: value }; },
    async prepare(value) { calls.push(['lifecycle.prepare', value]); return { prepared: value }; },
    async requestSignature(value) { calls.push(['lifecycle.sign', value]); return { ticket: value }; },
    async recover(value) { calls.push(['lifecycle.recover', value]); return { recovered: value }; },
  };
  const composable = {
    async build(value) { calls.push(['composable.build', value]); return { built: value }; },
    async prepare(value) { calls.push(['composable.prepare', value]); return { ticket: value }; },
    async recover(value) { calls.push(['composable.recover', value]); return { recovered: value }; },
  };
  const bridge = createMakerV8ProductBridge({
    productRuntime,
    drafts,
    player,
    pack,
    composable,
    lifecycle,
    execution: { allowWalletSignature: true, allowBroadcast: true },
  });

  assert.equal(Object.hasOwn(bridge, 'loadPlayer'), false);
  await bridge.setPlayerRecipe({ outputKey: 'soul' });
  await bridge.preparePlayerAction({ action: 'COMPLETE_SOUL' });
  const scope = { action: 'acquireMakerAccess', input: {} };
  assert.deepEqual(await bridge.recoverActivePlayerAction(scope), scope);
  await bridge.createPackDraft({ draftId: 'pack' });
  await bridge.listPackDrafts();
  await bridge.savePackDraft({ draftId: 'pack', expectedRevision: 1 });
  const bindingRequest = { draftId: 'pack', expectedRevision: 2, rootId: 'exact-root' };
  assert.deepEqual(await bridge.bindPackParent(bindingRequest), bindingRequest);
  await bridge.upsertPackAsset({ draftId: 'pack', expectedRevision: 2 });
  await bridge.requestPackPublicationSignature({ draftId: 'pack' });
  await bridge.recoverPackPublicationOutcome({ draftId: 'pack' });
  await bridge.replayPackPublication({ draftId: 'pack' });
  const composableTicket = await bridge.prepareComposableAction({ action: 'CREATE_PRODUCT' });
  await bridge.recoverComposableAction(composableTicket);
  assert.deepEqual(await bridge.getLifecycleSnapshot({ rootId: 'exact-root' }), { rootId: 'exact-root' });
  const prepared = await bridge.prepareLifecycleAction({ action: 'PAUSE' });
  const ticket = await bridge.requestLifecycleSignature(prepared);
  await bridge.recoverLifecycleAction(ticket);

  assert.deepEqual(calls.map(([name]) => name), [
    'player.set', 'player.prepare', 'player.recoverActive',
    'pack.create', 'pack.list', 'pack.save', 'pack.bindParent', 'pack.asset', 'pack.sign', 'pack.query', 'pack.replay',
    'composable.build', 'composable.prepare', 'composable.recover',
    'lifecycle.read', 'lifecycle.build', 'lifecycle.prepare', 'lifecycle.sign', 'lifecycle.recover',
  ]);
});

test('Start Making opens one exact Fresh-v8 Player session for the selected Maker', async () => {
  const rootId = `0x${'44'.repeat(32)}`;
  const commitment = '44'.repeat(32);
  const { productRuntime } = runtimeHarness({ connected: true });
  productRuntime.catalog.loadPlayer = async (requestedRoot) => (
    publicPlayerAuthority(requestedRoot, commitment)
  );
  const { drafts } = draftHarness();
  let snapshot = { status: 'IDLE', player: null, recipe: null, loadout: null };
  const player = {
    getSnapshot() { return structuredClone(snapshot); },
    async loadPlayer(value) {
      assert.equal(value, rootId);
      snapshot = exactEmptyPlayerState({
        rootId,
        commitment,
        document: { metadata: { name: 'Selected Maker' } },
      });
      return structuredClone(snapshot);
    },
    setRecipe(value) { snapshot.recipe = structuredClone(value); return value; },
    updateRecipe(value) { return value; },
    resetRecipe() { return snapshot.recipe; },
    async preparePlayerAction(value) { return value; },
    async executePlayerAction(value) { return value; },
    async recoverPlayerAction(value) { return value; },
    async getPlayerAction(value) { return value; },
  };
  const bridge = createMakerV8ProductBridge({ productRuntime, drafts, player });
  const session = await bridge.openPlayerSession({ rootId });
  assert.equal(session.schemaVersion, 'animacraft.maker-v8-player-session.v1');
  assert.equal(session.status, 'READY');
  assert.equal(session.rootId, rootId);
  assert.equal(session.player.rootId, rootId);
  assert.equal(session.recipe.outputKey, 'soul');
  assert.equal((await bridge.getPlayerSnapshot()).player.rootId, rootId);
  await assert.rejects(
    bridge.openPlayerSession({ rootId: 'not-an-object-id' }),
    { code: 'MAKER_V8_PRODUCT_PLAYER_ROOT_INVALID' },
  );
  bridge.dispose();
});

test('two concurrent public Maker hydrations never mutate the active Player controller', async () => {
  const activeRoot = `0x${'45'.repeat(32)}`;
  const publicA = `0x${'46'.repeat(32)}`;
  const publicB = `0x${'47'.repeat(32)}`;
  const commitment = '45'.repeat(32);
  const { productRuntime } = runtimeHarness({ connected: true });
  const catalogCalls = [];
  productRuntime.catalog.loadPlayer = async (rootId) => {
    catalogCalls.push(rootId);
    await Promise.resolve();
    return publicPlayerAuthority(
      rootId,
      rootId === activeRoot ? commitment : rootId.slice(-2).repeat(32),
      { title: `Public ${rootId.slice(-2)}` },
    );
  };
  productRuntime.choices = {
    async load({ address: owner, rootId }) {
      assert.equal(rootId, activeRoot);
      return {
        schemaVersion: 'animacraft.maker-v8-contextual-choices.v1',
        address: owner,
        rootId,
        certifiedAssets: [], packStyles: [], externalStyles: [], baseEntitlements: [], diagnostics: [],
      };
    },
  };
  let state = { status: 'IDLE' };
  const statefulLoads = [];
  const player = {
    getSnapshot() { return structuredClone(state); },
    async loadPlayer(rootId) {
      statefulLoads.push(rootId);
      state = exactEmptyPlayerState({ rootId, commitment });
      return structuredClone(state);
    },
    setRecipe(value) { return value; }, updateRecipe(value) { return value; }, resetRecipe() { return state.recipe; },
    async preparePlayerAction(value) { return value; }, async executePlayerAction(value) { return value; },
    async recoverPlayerAction(value) { return value; }, async getPlayerAction(value) { return value; },
  };
  const { drafts } = draftHarness();
  const bridge = createMakerV8ProductBridge({ productRuntime, drafts, player });
  await bridge.openPlayerSession({ rootId: activeRoot });
  const before = await bridge.getPlayerSnapshot();
  const [detailA, detailB] = await Promise.all([
    bridge.getTemplate({ makerId: publicA }),
    bridge.getTemplate({ makerId: publicB }),
  ]);
  const after = await bridge.getPlayerSnapshot();
  assert.deepEqual([detailA.rootId, detailB.rootId], [publicA, publicB]);
  assert.deepEqual(catalogCalls.filter((rootId) => rootId !== activeRoot).sort(), [publicA, publicB].sort());
  assert.equal(catalogCalls.filter((rootId) => rootId === activeRoot).length, 2);
  assert.deepEqual(statefulLoads, [activeRoot]);
  assert.deepEqual(after, before);
  bridge.dispose();
});

test('bridge Player and Creator previews return canonical PNG records from the shared renderer', async () => {
  const rootId = `0x${'48'.repeat(32)}`;
  const commitment = '48'.repeat(32);
  const { productRuntime } = runtimeHarness({ connected: true });
  const { drafts } = draftHarness();
  const draft = await seedMinimalArtworkDraft(drafts, {
    draftId: 'shared-renderer', name: 'Shared Renderer',
  });
  const document = structuredClone(draft.document);
  const style = document.parts[0].items[0].styles[0];
  const selection = {
    source: 'BASE', partKey: 'base', itemKey: 'default', styleKey: 'default',
    trackKey: style.trackKey, colorChannelKey: style.colorChannelKey,
    defaultSwatchKey: style.defaultSwatchKey, releaseId: null, semanticPackId: null,
    externalProductId: null, ownedExternalItemId: null,
  };
  const recipe = {
    schemaVersion: MAKER_V8_PLAYER_RECIPE_SCHEMA,
    rootId, makerVersion: '1', rootContentCommitment: commitment,
    selections: [selection], colors: [], outputKey: document.outputs[0].key,
  };
  const loadout = {
    schemaVersion: MAKER_V8_PLAYER_LOADOUT_SCHEMA,
    rootId, makerVersion: '1', rootContentCommitment: commitment,
    outputKey: recipe.outputKey,
    selections: [{ selectionIndex: 0, ...selection, swatchKey: null }],
    usedPacks: [],
    recipeCommitment: makerV8PlayerRecipeCommitmentV8(recipe),
  };
  productRuntime.catalog.loadPlayer = async (requestedRoot) => (
    publicPlayerAuthority(requestedRoot, commitment)
  );
  productRuntime.choices = {
    async load({ address: owner, rootId: requestedRoot }) {
      return {
        schemaVersion: 'animacraft.maker-v8-contextual-choices.v1',
        address: owner,
        rootId: requestedRoot,
        baseEntitlements: [],
        packStyles: [],
        externalStyles: [],
        certifiedAssets: [],
        diagnostics: [],
      };
    },
  };
  const assetPointer = {
    assetId: 'base-default', blobId: 'certified-base', mediaType: 'image/png',
    byteLength: fromBase64(MAKER_V8_DEFAULT_ASSET_BASE64).length,
    sha256: byteHash(MAKER_V8_DEFAULT_ASSET_BASE64),
  };
  productRuntime.assets.load = async (asset) => ({
    ...asset,
    bytesBase64: MAKER_V8_DEFAULT_ASSET_BASE64,
  });
  let state = { status: 'IDLE' };
  const player = {
    getSnapshot() { return structuredClone(state); },
    async loadPlayer() {
      state = {
        status: 'READY',
        player: {
          rootId, makerVersion: '1', lifecycle: 'ACTIVE', document,
          certifiedAssets: [assetPointer], evidence: { contentCommitment: commitment },
        },
        recipe,
        loadout,
        execution: { writeEnabled: true },
      };
      return structuredClone(state);
    },
    setRecipe(value) { return value; }, updateRecipe(value) { return value; }, resetRecipe() { return recipe; },
    async preparePlayerAction(value) { return value; }, async executePlayerAction(value) { return value; },
    async recoverPlayerAction(value) { return value; }, async getPlayerAction(value) { return value; },
  };
  const operations = [];
  const context = {
    clearRect() { operations.push('clear'); }, save() { operations.push('save'); },
    restore() { operations.push('restore'); }, translate() { operations.push('translate'); },
    rotate() { operations.push('rotate'); }, scale() { operations.push('scale'); },
    drawImage(source) { operations.push(`draw:${source.label}`); },
  };
  const bridge = createMakerV8ProductBridge({
    productRuntime,
    drafts,
    player,
    rendering: {
      canvasFactory() {
        return {
          width: 0, height: 0,
          getContext() { return context; },
          async convertToBlob() { return new Blob([Uint8Array.from([9, 8, 7])], { type: 'image/png' }); },
        };
      },
      async decodeImage() { return { source: { label: 'exact-image', width: 1, height: 1 }, close() { operations.push('close'); } }; },
    },
  });
  await bridge.openPlayerSession({ rootId });
  const playerRender = await bridge.renderPlayerPreview({ rootId });
  const draftRender = await bridge.renderDraftPreview({ draftId: 'shared-renderer' });
  for (const render of [playerRender, draftRender]) {
    assert.equal(render.schemaVersion, 'animacraft.maker-v8-player-render.v1');
    assert.equal(render.mediaType, 'image/png');
    assert.equal(render.width, 1024);
    assert.equal(render.height, 1024);
    assert.equal(render.bytesBase64, 'CQgH');
    assert.equal(render.byteLength, 3);
    assert.equal(render.sha256, byteHash('CQgH'));
  }
  assert.equal(operations.filter((entry) => entry === 'draw:exact-image').length, 2);
  bridge.dispose();
});

test('Creator transient transform preview is revision-bound and never persists its override', async () => {
  const { productRuntime } = runtimeHarness(); const storage = draftHarness(), rendered = [];
  const bridge = createMakerV8ProductBridge({ productRuntime, drafts: storage.drafts,
    rendering: { async renderDraft(input) {
      rendered.push(structuredClone(input));
      return { schemaVersion: 'animacraft.maker-v8-player-render.v1', mediaType: 'image/png',
        width: 1, height: 1, bytesBase64: 'AQ==', byteLength: 1, sha256: byteHash('AQ==') };
    } } });
  try {
    await seedMinimalArtworkDraft(storage.drafts, { draftId: 'style-preview', name: 'Style Preview' });
    const before = await bridge.getDraft({ draftId: 'style-preview' });
    const override = { expectedRevision: before.draft.revision, partKey: 'base', itemKey: 'default', styleKey: 'default',
      transform: { x: 20.125, y: -10.5, scale: 0.75, rotation: 15 } };
    await bridge.renderDraftPreview({ draftId: 'style-preview', stylePreview: override });
    assert.deepEqual(rendered.at(-1).document.parts[0].items[0].styles[0].transform, override.transform);
    assert.deepEqual(await bridge.getDraft({ draftId: 'style-preview' }), before);
    for (const invalid of [null, { ...override, expectedRevision: before.draft.revision + 1 },
      { ...override, styleKey: 'missing' }, { ...override, assetId: 'override' },
      { ...override, transform: { ...override.transform, scale: 0 } }]) {
      await assert.rejects(bridge.renderDraftPreview({ draftId: 'style-preview', stylePreview: invalid }));
    }
    assert.equal(rendered.length, 1);
    const locked = structuredClone(before.draft.document);
    locked.parts[0].items[0].styles[0].payload.animacraftEditor = { positionLocked: true };
    await bridge.replaceDraftDocument({ draftId: 'style-preview', expectedRevision: before.draft.revision, document: locked });
    const next = await bridge.getDraft({ draftId: 'style-preview' });
    await assert.rejects(bridge.renderDraftPreview({ draftId: 'style-preview', stylePreview: { ...override, expectedRevision: next.draft.revision } }), /unlocked/);
    assert.equal(rendered.length, 1);
  } finally { bridge.dispose(); }
});

test('Creator preview cold-rereads document and asset identity after rendering', async () => {
  const { productRuntime } = runtimeHarness();
  const storage = draftHarness();
  let renderStarted;
  let releaseRender;
  let renderSha256 = byteHash('AQ==');
  const bridge = createMakerV8ProductBridge({
    productRuntime,
    drafts: storage.drafts,
    rendering: {
      async renderDraft() {
        renderStarted();
        await new Promise((resolve) => { releaseRender = resolve; });
        return {
          schemaVersion: 'animacraft.maker-v8-player-render.v1', mediaType: 'image/png',
          width: 1, height: 1, bytesBase64: 'AQ==', byteLength: 1, sha256: renderSha256,
        };
      },
    },
  });
  await seedMinimalArtworkDraft(storage.drafts, { draftId: 'cold-preview', name: 'Cold Preview' });
  const started = new Promise((resolve) => { renderStarted = resolve; });
  const pending = bridge.renderDraftPreview({ draftId: 'cold-preview' });
  await started;
  storage.mutateAsset('cold-preview', 'base-default', {
    revision: 2,
    bytesBase64: 'AQ==',
    byteLength: 1,
    sha256: byteHash('AQ=='),
  });
  releaseRender();
  await assert.rejects(pending, { code: 'STALE_DRAFT_PREVIEW' });

  const current = await bridge.getDraft({ draftId: 'cold-preview' });
  const changedDocument = structuredClone(current.draft.document);
  changedDocument.metadata.summary = 'Changed while rendering';
  const startedAgain = new Promise((resolve) => { renderStarted = resolve; });
  const pendingDocument = bridge.renderDraftPreview({ draftId: 'cold-preview' });
  await startedAgain;
  storage.mutateDraft('cold-preview', {
    revision: current.draft.revision + 1,
    document: changedDocument,
  });
  releaseRender();
  await assert.rejects(pendingDocument, { code: 'STALE_DRAFT_PREVIEW' });

  renderSha256 = 'f'.repeat(64);
  const invalidStarted = new Promise((resolve) => { renderStarted = resolve; });
  const invalidRecord = bridge.renderDraftPreview({ draftId: 'cold-preview' });
  await invalidStarted;
  releaseRender();
  await assert.rejects(invalidRecord, { code: 'MAKER_V8_PRODUCT_DRAFT_RENDER_INVALID' });
  bridge.dispose();
});

test('Player Recipe mutations invalidate an in-flight canonical preview inside the bridge', async () => {
  const rootId = `0x${'49'.repeat(32)}`;
  const commitment = '49'.repeat(32);
  const { productRuntime } = runtimeHarness({ connected: true });
  productRuntime.catalog.loadPlayer = async (requestedRoot) => (
    publicPlayerAuthority(requestedRoot, commitment)
  );
  let state = { status: 'IDLE' };
  const player = {
    getSnapshot() { return structuredClone(state); },
    async loadPlayer() {
      state = exactEmptyPlayerState({ rootId, commitment });
      return structuredClone(state);
    },
    async setRecipe(recipe) {
      state.recipe = structuredClone(recipe);
      state.loadout = {
        ...state.loadout,
        outputKey: state.recipe.outputKey,
        recipeCommitment: makerV8PlayerRecipeCommitmentV8(state.recipe),
      };
      return structuredClone(state.recipe);
    },
    async updateRecipe(patch) {
      return this.setRecipe({ ...state.recipe, ...structuredClone(patch) });
    },
    async resetRecipe() { return this.setRecipe({ ...state.recipe, outputKey: 'soul' }); },
    async preparePlayerAction(value) { return value; }, async executePlayerAction(value) { return value; },
    async recoverPlayerAction(value) { return value; }, async getPlayerAction(value) { return value; },
  };
  let renderStarted;
  let releaseRender;
  const { drafts } = draftHarness();
  const bridge = createMakerV8ProductBridge({
    productRuntime,
    drafts,
    player,
    rendering: {
      async renderPlayer() {
        renderStarted();
        await new Promise((resolve) => { releaseRender = resolve; });
        return {
          schemaVersion: 'animacraft.maker-v8-player-render.v1', mediaType: 'image/png',
          width: 1, height: 1, bytesBase64: 'AQ==', byteLength: 1, sha256: byteHash('AQ=='),
        };
      },
    },
  });
  await bridge.openPlayerSession({ rootId });
  const started = new Promise((resolve) => { renderStarted = resolve; });
  const pending = bridge.renderPlayerPreview({ rootId });
  await started;
  await bridge.updatePlayerRecipe({ outputKey: 'alternate' });
  releaseRender();
  await assert.rejects(pending, { code: 'STALE_PLAYER_SESSION' });

  const startedAgain = new Promise((resolve) => { renderStarted = resolve; });
  const coldPending = bridge.renderPlayerPreview({ rootId });
  await startedAgain;
  state.recipe = { ...state.recipe, outputKey: 'out-of-band' };
  state.loadout = {
    ...state.loadout,
    outputKey: state.recipe.outputKey,
    recipeCommitment: makerV8PlayerRecipeCommitmentV8(state.recipe),
  };
  releaseRender();
  await assert.rejects(coldPending, { code: 'STALE_PLAYER_SESSION' });
  bridge.dispose();
});

test('protected Player renders abort decrypt and reject future stale callbacks on every invalidation', async (t) => {
  for (const reason of ['set', 'update', 'reset', 'session', 'render', 'disconnect', 'dispose']) {
    await t.test(reason, async () => {
      const rootId = `0x${'59'.repeat(32)}`;
      const commitment = '59'.repeat(32);
      const { productRuntime } = runtimeHarness({ connected: true });
      productRuntime.catalog.loadPlayer = async (requestedRoot) => publicPlayerAuthority(requestedRoot, commitment);
      let snapshot;
      let decryptCalls = 0;
      let decryptInput;
      let resolveDecrypt;
      const player = {
        getSnapshot() { return structuredClone(snapshot); },
        async loadPlayer() {
          snapshot = exactEmptyPlayerState({ rootId, commitment });
          return structuredClone(snapshot);
        },
        setRecipe() { return snapshot.recipe; }, updateRecipe() { return snapshot.recipe; },
        resetRecipe() { return snapshot.recipe; },
        async preparePlayerAction(value) { return value; }, async executePlayerAction(value) { return value; },
        async recoverPlayerAction(value) { return value; }, async getPlayerAction(value) { return value; },
        async decryptProtectedSelection(input) {
          decryptCalls += 1;
          decryptInput = input;
          return new Promise(resolve => { resolveDecrypt = resolve; });
        },
      };
      let announceRender;
      const renders = [];
      const { drafts } = draftHarness();
      const bridge = createMakerV8ProductBridge({ productRuntime, drafts, player, rendering: {
        decryptProtectedSelection() { assert.fail('Rendering dependencies cannot replace the guarded callback'); },
        async renderPlayer(input) {
          let release;
          const held = new Promise(resolve => { release = resolve; });
          renders.push({ input, release });
          announceRender();
          await held;
          return { schemaVersion: 'animacraft.maker-v8-player-render.v1', mediaType: 'image/png',
            width: 1, height: 1, bytesBase64: 'AQ==', byteLength: 1, sha256: byteHash('AQ==') };
        },
      } });
      await bridge.openPlayerSession({ rootId });
      const started = new Promise(resolve => { announceRender = resolve; });
      const pending = bridge.renderPlayerPreview({ rootId }).catch(error => error);
      await started;
      const callback = renders[0].input.decryptProtectedSelection;
      const ciphertext = new Uint8Array([1, 2]);
      const suppliedSignal = new AbortController().signal;
      const decrypted = callback({ selectionIndex: 3, ciphertext, signal: suppliedSignal }).catch(error => error);
      assert.equal(decryptCalls, 1);
      assert.equal(decryptInput.selectionIndex, 3);
      assert.equal(decryptInput.ciphertext, ciphertext);
      assert.notEqual(decryptInput.signal, suppliedSignal);
      assert.equal(decryptInput.signal.aborted, false);
      let newerPending;
      if (reason === 'set') await bridge.setPlayerRecipe(snapshot.recipe);
      if (reason === 'update') await bridge.updatePlayerRecipe({});
      if (reason === 'reset') await bridge.resetPlayerRecipe();
      if (reason === 'session') await bridge.openPlayerSession({ rootId });
      if (reason === 'disconnect') await bridge.disconnectWallet();
      if (reason === 'dispose') bridge.dispose();
      if (reason === 'render') {
        const newerStarted = new Promise(resolve => { announceRender = resolve; });
        newerPending = bridge.renderPlayerPreview({ rootId }).catch(error => error);
        await newerStarted;
      }
      assert.equal(decryptInput.signal.aborted, true);
      await assert.rejects(callback({ selectionIndex: 4, ciphertext }), { code: 'STALE_PLAYER_SESSION' });
      assert.equal(decryptCalls, 1, 'stale later layers must not reach the wallet/decrypt facade');
      const latePlaintext = new Uint8Array([7, 8, 9]);
      resolveDecrypt(latePlaintext);
      assert.equal((await decrypted).code, 'STALE_PLAYER_SESSION');
      assert.deepEqual(latePlaintext, new Uint8Array(3));
      if (reason === 'render') {
        const newerDecrypt = renders[1].input.decryptProtectedSelection({ selectionIndex: 5, ciphertext });
        const newerSignal = decryptInput.signal;
        renders[0].release();
        assert.equal((await pending).code, 'STALE_PLAYER_SESSION');
        assert.equal(newerSignal.aborted, false, 'old render cleanup cannot cancel the newer render');
        const currentPlaintext = new Uint8Array([4, 5]);
        resolveDecrypt(currentPlaintext);
        assert.equal(await newerDecrypt, currentPlaintext);
        assert.deepEqual(currentPlaintext, new Uint8Array([4, 5]));
      }
      bridge.dispose();
      renders.forEach(render => render.release());
      assert.equal((await pending).code, 'STALE_PLAYER_SESSION');
      if (newerPending) assert.equal((await newerPending).code, 'STALE_PLAYER_SESSION');
    });
  }
});

async function liveExportHarness({ canvas = { width: 1080, height: 1920 }, render, decrypt } = {}) {
  const rootId = `0x${'69'.repeat(32)}`;
  const commitment = '69'.repeat(32);
  const runtime = runtimeHarness({ connected: true });
  const authority = publicPlayerAuthority(rootId, commitment);
  const controls = { read: null, catalog: null };
  runtime.productRuntime.catalog.loadPlayer = async () => {
    if (controls.catalog) await controls.catalog();
    return structuredClone(authority);
  };
  const choices = { schemaVersion: 'animacraft.maker-v8-contextual-choices.v1', address, rootId,
    baseEntitlements: [], packStyles: [], externalStyles: [], certifiedAssets: [], diagnostics: [] };
  runtime.productRuntime.choices = { async load() { return structuredClone(choices); } };
  const snapshot = exactEmptyPlayerState({ rootId, commitment, document: { canvas } });
  let reads = 0;
  const player = {
    getSnapshot() { reads += 1; return controls.read ? controls.read(snapshot) : structuredClone(snapshot); },
    async loadPlayer() { return structuredClone(snapshot); },
    setRecipe(value) { return value; }, updateRecipe(value) { return value; }, resetRecipe() { return snapshot.recipe; },
    async preparePlayerAction() { assert.fail('Export must not prepare a transaction'); },
    async executePlayerAction() { assert.fail('Export must not sign a transaction'); },
    async recoverPlayerAction() { assert.fail('Export must not recover a transaction'); },
    async getPlayerAction() { assert.fail('Export must not read completion state'); },
    ...(decrypt ? { decryptProtectedSelection: decrypt } : {}),
  };
  const renders = [];
  const record = (width, height) => ({ schemaVersion: 'animacraft.maker-v8-player-render.v1',
    mediaType: 'image/png', width, height, bytesBase64: 'AQ==', byteLength: 1, sha256: byteHash('AQ==') });
  const { drafts } = draftHarness();
  const bridge = createMakerV8ProductBridge({ productRuntime: runtime.productRuntime, drafts, player,
    rendering: { async renderPlayer(input) {
      renders.push(input);
      if (render) return render(input, record);
      const ratio = input.exportOptions?.sizeMode === 'standard' ? Math.min(1, 1024 / Math.max(canvas.width, canvas.height)) : 1;
      return record(Math.max(1, Math.round(canvas.width * ratio)), Math.max(1, Math.round(canvas.height * ratio)));
    } } });
  await bridge.openPlayerSession({ rootId });
  return { ...runtime, bridge, rootId, snapshot, authority, choices, controls, renders, record, reads: () => reads };
}

test('certified Player export captures exact options and preserves the original preview and recipe', async (t) => {
  for (const [width, height, standard] of [[1080, 1920, [576, 1024]], [800, 800, [800, 800]], [4096, 2048, [1024, 512]]]) {
    await t.test(`${width}x${height}`, async () => {
      const h = await liveExportHarness({ canvas: { width, height } });
      try {
        const before = structuredClone(h.snapshot);
        await h.bridge.getPlayerSnapshot();
        await h.bridge.updatePlayerRecipe({});
        for (const sizeMode of ['standard', 'original']) {
          for (const transparent of [false, true]) {
            const options = { sizeMode, transparent };
            const pending = h.bridge.renderPlayerExport({ rootId: h.rootId, exportOptions: options });
            options.sizeMode = 'forged'; options.transparent = !transparent;
            const result = await pending;
            assert.deepEqual([result.width, result.height], sizeMode === 'standard' ? standard : [width, height]);
            assert.deepEqual(h.renders.at(-1).exportOptions, { sizeMode, transparent });
            assert.equal(Object.isFrozen(h.renders.at(-1).exportOptions), true);
          }
        }
        const preview = await h.bridge.renderPlayerPreview({ rootId: h.rootId, exportOptions: { sizeMode: 'standard', transparent: true } });
        assert.deepEqual([preview.width, preview.height], [width, height]);
        assert.equal(h.renders.at(-1).exportOptions, null);
        assert.deepEqual(h.snapshot, before);
        assert.equal(h.calls.reconnect, 0);
      } finally { h.bridge.dispose(); }
    });
  }
});

test('certified Player export rejects malformed intent before reads and rejects wrong returned evidence', async (t) => {
  await t.test('strict options and original pixel limit', async () => {
    const h = await liveExportHarness({ canvas: { width: 4096, height: 4096 } });
    try {
      const bad = [undefined, null, {}, [], { sizeMode: 'x' }, { sizeMode: 'standard', transparent: 1 },
        { sizeMode: 'standard', extra: false }, Object.assign(Object.create(null), { sizeMode: 'standard' }),
        Object.defineProperty({}, 'sizeMode', { get() { assert.fail('Getter must not run'); }, enumerable: true }),
        Object.defineProperty({ sizeMode: 'standard' }, 'transparent', { value: true }),
        { sizeMode: 'standard', [Symbol('hidden')]: true }, { sizeMode: 'original' }];
      const reads = h.reads();
      for (const exportOptions of bad) await assert.rejects(h.bridge.renderPlayerExport({ rootId: h.rootId, exportOptions }));
      assert.equal(h.reads(), reads);
      assert.equal(h.renders.length, 0);
      const result = await h.bridge.renderPlayerExport({ rootId: h.rootId, exportOptions: { sizeMode: 'standard' } });
      assert.deepEqual([result.width, result.height], [1024, 1024]);
      assert.deepEqual(h.renders[0].exportOptions, { sizeMode: 'standard', transparent: false });
    } finally { h.bridge.dispose(); }
  });
  for (const failure of ['dimensions', 'hash', 'length']) {
    await t.test(failure, async () => {
      const h = await liveExportHarness({ render(_input, record) {
        return { ...record(576, 1024), ...(failure === 'dimensions' ? { width: 1080 }
          : failure === 'hash' ? { sha256: 'f'.repeat(64) } : { byteLength: 2 }) };
      } });
      try {
        await assert.rejects(h.bridge.renderPlayerExport({ rootId: h.rootId, exportOptions: { sizeMode: 'standard' } }),
          { code: failure === 'dimensions' ? 'MAKER_V8_PLAYER_EXPORT_SIZE_MISMATCH' : 'MAKER_V8_PRODUCT_PLAYER_RENDER_INVALID' });
      } finally { h.bridge.dispose(); }
    });
  }
});

test('certified Player preview and export use one latest-request lane with protected-byte cleanup', async (t) => {
  for (const [first, second] of [['Preview', 'Export'], ['Export', 'Preview'], ['Export', 'Export']]) {
    await t.test(`${first} to ${second}`, async () => {
      const renders = [];
      const decrypts = [];
      let entered;
      const h = await liveExportHarness({ decrypt(input) {
        return new Promise(resolve => decrypts.push({ input, resolve }));
      }, render(input, record) {
        return new Promise(resolve => { renders.push({ input, release: () => resolve(record(...(input.exportOptions?.sizeMode === 'standard' ? [576, 1024] : [1080, 1920]))) }); entered(); });
      } });
      const request = method => h.bridge[`renderPlayer${method}`]({ rootId: h.rootId, exportOptions: { sizeMode: 'standard', transparent: true } });
      try {
        const started = new Promise(resolve => { entered = resolve; });
        const older = request(first).catch(error => error);
        await started;
        const staleBytes = renders[0].input.decryptProtectedSelection({ selectionIndex: 0 }).catch(error => error);
        const reads = h.reads();
        await assert.rejects(h.bridge.renderPlayerExport({ rootId: h.rootId, exportOptions: { sizeMode: 'bad' } }));
        assert.equal(h.reads(), reads);
        assert.equal(decrypts[0].input.signal.aborted, false, 'invalid input must not cancel valid work');
        const newerStarted = new Promise(resolve => { entered = resolve; });
        const newer = request(second);
        await newerStarted;
        assert.equal(decrypts[0].input.signal.aborted, true);
        const bytes = new Uint8Array([1, 2, 3]);
        decrypts[0].resolve(bytes);
        assert.equal((await staleBytes).code, 'STALE_PLAYER_SESSION');
        assert.deepEqual(bytes, new Uint8Array(3));
        await assert.rejects(renders[0].input.decryptProtectedSelection({ selectionIndex: 1 }), { code: 'STALE_PLAYER_SESSION' });
        assert.equal(decrypts.length, 1);
        const freshBytes = renders[1].input.decryptProtectedSelection({ selectionIndex: 2 });
        renders[0].release();
        assert.equal((await older).code, 'STALE_PLAYER_SESSION');
        assert.equal(decrypts[1].input.signal.aborted, false, 'old finally cannot abort new work');
        decrypts[1].resolve(new Uint8Array([4]));
        assert.deepEqual(await freshBytes, new Uint8Array([4]));
        renders[1].release();
        assert.equal((await newer).sha256, byteHash('AQ=='));
        assert.equal(decrypts[1].input.signal.aborted, true, 'completed renderer releases its decrypt capability');
      } finally { h.bridge.dispose(); }
    });
  }
});

test('replaced Player authority reads cannot install a context or invalidate the newest render', async (t) => {
  for (const first of ['Preview', 'Export']) for (const second of ['Preview', 'Export']) {
    for (const phase of ['before-render', 'after-render']) {
      await t.test(`${first} to ${second}, ${phase}`, async () => {
        const h = await liveExportHarness();
        try {
          let releaseCatalog;
          let enteredCatalog;
          const catalogStarted = new Promise(resolve => { enteredCatalog = resolve; });
          let catalogReads = 0;
          h.controls.catalog = () => {
            catalogReads += 1;
            if (catalogReads !== (phase === 'before-render' ? 1 : 2)) return;
            return new Promise(resolve => { releaseCatalog = resolve; enteredCatalog(); });
          };
          const request = method => h.bridge[`renderPlayer${method}`]({ rootId: h.rootId, exportOptions: { sizeMode: 'standard' } });
          const older = request(first).catch(error => error);
          await catalogStarted;
          let releaseSnapshot;
          h.controls.read = snapshot => {
            h.controls.read = null;
            return new Promise(resolve => { releaseSnapshot = () => resolve(structuredClone(snapshot)); });
          };
          const newer = request(second);
          releaseCatalog();
          assert.equal((await older).code, 'STALE_PLAYER_SESSION');
          releaseSnapshot();
          const result = await newer;
          assert.deepEqual([result.width, result.height], second === 'Export' ? [576, 1024] : [1080, 1920]);
          assert.equal(h.renders.length, phase === 'before-render' ? 1 : 2);
          const current = await h.bridge.getPlayerSnapshot();
          assert.equal(current.player.rootId, h.rootId);
        } finally { h.bridge.dispose(); }
      });
    }
  }
});

test('certified Player export refuses live authority and canvas drift before accepting an image', async (t) => {
  for (const drift of ['canvas', 'recipe', 'root', 'choices', 'wallet', 'mutation', 'session', 'dispose']) {
    await t.test(drift, async () => {
      let entered;
      let release;
      const h = await liveExportHarness({ render(_input, record) {
        return new Promise(resolve => { release = () => resolve(record(576, 1024)); entered(); });
      } });
      try {
        const started = new Promise(resolve => { entered = resolve; });
        const pending = h.bridge.renderPlayerExport({ rootId: h.rootId, exportOptions: { sizeMode: 'standard' } });
        await started;
        if (drift === 'canvas') h.snapshot.player.document.canvas.width = 100;
        if (drift === 'recipe') {
          h.snapshot.recipe.outputKey = 'changed'; h.snapshot.loadout.outputKey = 'changed';
          h.snapshot.loadout.recipeCommitment = makerV8PlayerRecipeCommitmentV8(h.snapshot.recipe);
        }
        if (drift === 'root') h.authority.player.evidence.contentCommitment = '70'.repeat(32);
        if (drift === 'choices') h.choices.baseEntitlements.push({ entitlementId: 'revoked-during-render' });
        if (drift === 'wallet') h.setAccount({ address: `0x${'70'.repeat(32)}`, network: 'mainnet' });
        if (drift === 'mutation') await h.bridge.updatePlayerRecipe({});
        if (drift === 'session') await h.bridge.openPlayerSession({ rootId: h.rootId });
        if (drift === 'dispose') h.bridge.dispose();
        release();
        await assert.rejects(pending, { code: 'STALE_PLAYER_SESSION' });
      } finally { h.bridge.dispose(); }
    });
  }
});

test('lazy app Player facade does not start decrypt after a cancelled adapter load', async () => {
  const { createLazyMakerV8PlayerFacade } = await import('../app.js');
  let resolveAdapter;
  let announceLoad;
  const started = new Promise(resolve => { announceLoad = resolve; });
  let calls = 0;
  const facade = createLazyMakerV8PlayerFacade(() => new Promise(resolve => {
    resolveAdapter = resolve;
    announceLoad();
  }));
  const controller = new AbortController();
  const pending = facade.decryptProtectedSelection({ selectionIndex: 0, signal: controller.signal });
  await started;
  controller.abort();
  resolveAdapter({ getSnapshot() {}, loadPlayer() {}, setRecipe() {}, updateRecipe() {}, resetRecipe() {},
    preparePlayerAction() {}, executePlayerAction() {}, recoverPlayerAction() {}, getPlayerAction() {},
    decryptProtectedSelection() { calls += 1; } });
  await assert.rejects(pending, { name: 'AbortError' });
  await assert.rejects(facade.decryptProtectedSelection({ signal: controller.signal }), { name: 'AbortError' });
  assert.equal(calls, 0);
});

test('live contextual choices replace atomically and late or revoked authority never reattaches', async () => {
  const rootId = `0x${'4e'.repeat(32)}`;
  const commitment = '4e'.repeat(32);
  const { productRuntime } = runtimeHarness({ connected: true });
  productRuntime.catalog.loadPlayer = async (requestedRoot) => (
    publicPlayerAuthority(requestedRoot, commitment)
  );
  const bundle = (suffix) => ({
    schemaVersion: 'animacraft.maker-v8-contextual-choices.v1',
    address,
    rootId,
    baseEntitlements: [],
    packStyles: suffix ? [{ id: `pack-${suffix}`, assetId: `asset-${suffix}` }] : [],
    externalStyles: [],
    certifiedAssets: suffix ? [{
      assetId: `asset-${suffix}`, blobId: `blob-${suffix}`, mediaType: 'image/png',
      byteLength: 1, sha256: suffix.repeat(64),
    }] : [],
    diagnostics: [],
  });
  let mode = 'a';
  let holdA = false;
  let releaseA;
  let markAStarted;
  productRuntime.choices = {
    async load() {
      const observed = mode;
      if (holdA && observed === 'a') {
        markAStarted();
        await new Promise((resolve) => { releaseA = resolve; });
        holdA = false;
      }
      if (observed === 'error') throw new Error('Root paused or entitlement revoked');
      if (observed === 'invalid') {
        const invalid = bundle('');
        delete invalid.address;
        return invalid;
      }
      return structuredClone(bundle(observed === 'empty' ? '' : observed));
    },
  };
  let state = { status: 'IDLE' };
  const player = {
    getSnapshot() { return structuredClone(state); },
    async loadPlayer() {
      state = exactEmptyPlayerState({ rootId, commitment });
      return structuredClone(state);
    },
    setRecipe(value) { return value; }, updateRecipe(value) { return value; }, resetRecipe() { return state.recipe; },
    async preparePlayerAction(value) { return value; }, async executePlayerAction(value) { return value; },
    async recoverPlayerAction(value) { return value; }, async getPlayerAction(value) { return value; },
  };
  const { drafts } = draftHarness();
  const bridge = createMakerV8ProductBridge({ productRuntime, drafts, player });
  const opened = await bridge.openPlayerSession({ rootId });
  assert.deepEqual(opened.player.contextualChoices.packStyles.map((row) => row.id), ['pack-a']);

  mode = 'empty';
  const revoked = await bridge.getPlayerSnapshot();
  assert.deepEqual(revoked.player.contextualChoices.packStyles, []);
  assert.equal(revoked.player.certifiedAssets.some((asset) => asset.assetId === 'asset-a'), false);

  mode = 'a';
  holdA = true;
  const aStarted = new Promise((resolve) => { markAStarted = resolve; });
  const lateA = bridge.getPlayerSnapshot();
  await aStarted;
  mode = 'b';
  const activeB = await bridge.getPlayerSnapshot();
  releaseA();
  await assert.rejects(lateA, { code: 'STALE_PLAYER_SESSION' });
  assert.deepEqual(activeB.player.contextualChoices.packStyles.map((row) => row.id), ['pack-b']);
  assert.equal(activeB.player.certifiedAssets.some((asset) => asset.assetId === 'asset-a'), false);

  mode = 'error';
  await assert.rejects(bridge.getPlayerSnapshot(), /paused|revoked/i);
  await assert.rejects(bridge.renderPlayerPreview({ rootId }), { code: 'STALE_PLAYER_SESSION' });
  mode = 'invalid';
  await assert.rejects(
    bridge.openPlayerSession({ rootId }),
    { code: 'MAKER_V8_PRODUCT_CONTEXTUAL_AUTHORITY_INVALID' },
  );
  bridge.dispose();
});

test('async Player snapshots retain only the active session contextual choices across recipe updates', async () => {
  const rootA = `0x${'4a'.repeat(32)}`;
  const rootB = `0x${'4b'.repeat(32)}`;
  const commitmentA = 'aa'.repeat(32);
  const commitmentB = 'bb'.repeat(32);
  const { productRuntime } = runtimeHarness({ connected: true });
  productRuntime.catalog.loadPlayer = async (rootId) => publicPlayerAuthority(
    rootId,
    rootId === rootA ? commitmentA : commitmentB,
  );
  let holdNextA = false;
  let releaseAChoices;
  let markAChoicesStarted;
  let aChoicesStarted = Promise.resolve();
  productRuntime.choices = {
    async load({ address: owner, rootId }) {
      assert.equal(owner, address);
      if (rootId === rootA && holdNextA) {
        markAChoicesStarted();
        await new Promise((resolve) => { releaseAChoices = resolve; });
        holdNextA = false;
      }
      await Promise.resolve();
      const suffix = rootId === rootA ? 'a' : 'b';
      return {
        schemaVersion: 'animacraft.maker-v8-contextual-choices.v1',
        address: owner,
        rootId,
        certifiedAssets: [{
          assetId: `pack-${suffix}`, blobId: `pack-${suffix}-blob`, mediaType: 'image/png',
          byteLength: 1, sha256: suffix.repeat(64),
        }],
        packStyles: [{ id: `pack-style-${suffix}` }],
        externalStyles: [{ id: `external-style-${suffix}` }],
        baseEntitlements: [],
        diagnostics: [],
      };
    },
  };
  const snapshotFor = (rootId) => {
    const commitment = rootId === rootA ? commitmentA : commitmentB;
    const exact = exactEmptyPlayerState({ rootId, commitment });
    exact.player.certifiedAssets = [{
      assetId: 'base', blobId: `base-${rootId.slice(-2)}`, mediaType: 'image/png',
      byteLength: 1, sha256: 'cc'.repeat(32),
    }];
    return exact;
  };
  let snapshot = { status: 'IDLE', player: null, recipe: null, loadout: null };
  const player = {
    async getSnapshot() {
      await Promise.resolve();
      return structuredClone(snapshot);
    },
    async loadPlayer(rootId) {
      await Promise.resolve();
      snapshot = snapshotFor(rootId);
      return structuredClone(snapshot);
    },
    async setRecipe(recipe) { snapshot.recipe = structuredClone(recipe); return recipe; },
    async updateRecipe(patch) {
      await Promise.resolve();
      snapshot.recipe = { ...snapshot.recipe, ...structuredClone(patch) };
      snapshot.loadout = {
        ...snapshot.loadout,
        outputKey: snapshot.recipe.outputKey,
        selections: structuredClone(snapshot.recipe.selections),
        recipeCommitment: makerV8PlayerRecipeCommitmentV8(snapshot.recipe),
      };
      return structuredClone(snapshot.recipe);
    },
    async resetRecipe() { return structuredClone(snapshot.recipe); },
    async preparePlayerAction(value) { return value; },
    async executePlayerAction(value) { return value; },
    async recoverPlayerAction(value) { return value; },
    async getPlayerAction(value) { return value; },
  };
  const { drafts } = draftHarness();
  const bridge = createMakerV8ProductBridge({ productRuntime, drafts, player });

  await bridge.openPlayerSession({ rootId: rootA });
  await bridge.updatePlayerRecipe({ outputKey: 'alternate' });
  const updatedA = await bridge.getPlayerSnapshot();
  assert.equal(updatedA.player.contextualChoices.rootId, rootA);
  assert.deepEqual(updatedA.player.certifiedAssets.map((asset) => asset.assetId), ['base', 'pack-a']);
  assert.equal(updatedA.player.evidence.contentCommitment, commitmentA);
  assert.equal(updatedA.recipe.rootContentCommitment, commitmentA);
  assert.equal(updatedA.loadout.rootContentCommitment, commitmentA);

  holdNextA = true;
  aChoicesStarted = new Promise((resolve) => { markAChoicesStarted = resolve; });
  const staleA = bridge.openPlayerSession({ rootId: rootA });
  await aChoicesStarted;
  const activeB = await bridge.openPlayerSession({ rootId: rootB });
  releaseAChoices();
  await assert.rejects(staleA, { code: 'STALE_PLAYER_SESSION' });
  assert.equal(activeB.player.contextualChoices.rootId, rootB);
  const updatedB = await bridge.getPlayerSnapshot();
  assert.equal(updatedB.player.rootId, rootB);
  assert.equal(updatedB.player.contextualChoices.rootId, rootB);
  assert.deepEqual(updatedB.player.certifiedAssets.map((asset) => asset.assetId), ['base', 'pack-b']);
  assert.equal(updatedB.player.certifiedAssets.some((asset) => asset.assetId === 'pack-a'), false);
  assert.equal(updatedB.player.evidence.contentCommitment, commitmentB);
  assert.equal(updatedB.recipe.rootContentCommitment, commitmentB);
  assert.equal(updatedB.loadout.rootContentCommitment, commitmentB);
  bridge.dispose();
});

test('a deferred Root A snapshot cannot invalidate the newer Root B context', async () => {
  const rootA = `0x${'51'.repeat(32)}`;
  const rootB = `0x${'52'.repeat(32)}`;
  const commitmentA = '51'.repeat(32);
  const commitmentB = '52'.repeat(32);
  const { productRuntime } = runtimeHarness({ connected: true });
  productRuntime.catalog.loadPlayer = async (rootId) => publicPlayerAuthority(
    rootId,
    rootId === rootA ? commitmentA : commitmentB,
  );
  productRuntime.choices = {
    async load({ address: owner, rootId }) {
      return {
        schemaVersion: 'animacraft.maker-v8-contextual-choices.v1',
        address: owner,
        rootId,
        baseEntitlements: [],
        packStyles: [],
        externalStyles: [],
        certifiedAssets: [],
        diagnostics: [],
      };
    },
  };
  let snapshot = { status: 'IDLE' };
  let holdRootA = false;
  let releaseRootA;
  let markRootAStarted;
  const player = {
    async getSnapshot() {
      const captured = structuredClone(snapshot);
      if (holdRootA && captured.player?.rootId === rootA) {
        holdRootA = false;
        markRootAStarted();
        await new Promise((resolve) => { releaseRootA = resolve; });
      }
      return captured;
    },
    async loadPlayer(rootId) {
      snapshot = exactEmptyPlayerState({
        rootId,
        commitment: rootId === rootA ? commitmentA : commitmentB,
      });
      return structuredClone(snapshot);
    },
    setRecipe(value) { return value; },
    updateRecipe(value) { return value; },
    resetRecipe() { return snapshot.recipe; },
    async preparePlayerAction(value) { return value; },
    async executePlayerAction(value) { return value; },
    async recoverPlayerAction(value) { return value; },
    async getPlayerAction(value) { return value; },
  };
  const { drafts } = draftHarness();
  let renderCalls = 0;
  const bridge = createMakerV8ProductBridge({
    productRuntime,
    drafts,
    player,
    rendering: {
      async renderPlayer() {
        renderCalls += 1;
        return {
          schemaVersion: 'animacraft.maker-v8-player-render.v1',
          mediaType: 'image/png',
          width: 1,
          height: 1,
          bytesBase64: 'AQ==',
          byteLength: 1,
          sha256: byteHash('AQ=='),
        };
      },
    },
  });

  await bridge.openPlayerSession({ rootId: rootA });
  holdRootA = true;
  const rootAStarted = new Promise((resolve) => { markRootAStarted = resolve; });
  const staleA = bridge.getPlayerSnapshot();
  await rootAStarted;
  const openedB = await bridge.openPlayerSession({ rootId: rootB });
  releaseRootA();

  await assert.rejects(staleA, { code: 'STALE_PLAYER_SESSION' });
  assert.equal(openedB.player.contextualChoices.rootId, rootB);
  const currentB = await bridge.getPlayerSnapshot();
  assert.equal(currentB.player.rootId, rootB);
  assert.equal(currentB.player.contextualChoices.rootId, rootB);
  const renderedB = await bridge.renderPlayerPreview({ rootId: rootB });
  assert.equal(renderedB.sha256, byteHash('AQ=='));
  assert.equal(renderCalls, 1);
  bridge.dispose();
});

test('active Player context is wallet-bound and soft disconnect/dispose make pending work stale', async () => {
  const rootId = `0x${'4c'.repeat(32)}`;
  const walletB = `0x${'4d'.repeat(32)}`;
  const commitment = '4c'.repeat(32);
  const { productRuntime, setAccount } = runtimeHarness({ connected: true });
  productRuntime.catalog.loadPlayer = async (requestedRoot) => (
    publicPlayerAuthority(requestedRoot, commitment)
  );
  let holdChoices = false;
  let releaseChoices;
  let choicesStarted;
  productRuntime.choices = {
    async load({ address: owner, rootId: requestedRoot }) {
      if (holdChoices) {
        choicesStarted();
        await new Promise((resolve) => { releaseChoices = resolve; });
        holdChoices = false;
      }
      return {
        schemaVersion: 'animacraft.maker-v8-contextual-choices.v1',
        address: owner,
        rootId: requestedRoot,
        certifiedAssets: [], packStyles: [], externalStyles: [], baseEntitlements: [], diagnostics: [],
      };
    },
  };
  let snapshot = { status: 'IDLE' };
  const player = {
    getSnapshot() { return structuredClone(snapshot); },
    async loadPlayer() {
      snapshot = exactEmptyPlayerState({ rootId, commitment });
      return structuredClone(snapshot);
    },
    setRecipe(value) { return value; }, updateRecipe(value) { return value; }, resetRecipe() { return snapshot.recipe; },
    async preparePlayerAction(value) { return value; }, async executePlayerAction(value) { return value; },
    async recoverPlayerAction(value) { return value; }, async getPlayerAction(value) { return value; },
  };
  const { drafts } = draftHarness();
  let releaseRender;
  let renderStarted;
  const bridge = createMakerV8ProductBridge({
    productRuntime,
    drafts,
    player,
    rendering: {
      async renderPlayer() {
        renderStarted();
        await new Promise((resolve) => { releaseRender = resolve; });
        return {
          schemaVersion: 'animacraft.maker-v8-player-render.v1', mediaType: 'image/png',
          width: 1, height: 1, bytesBase64: 'AQ==', byteLength: 1, sha256: byteHash('AQ=='),
        };
      },
    },
  });
  const sessionA = await bridge.openPlayerSession({ rootId });
  assert.equal(sessionA.player.contextualChoices.address, address);
  setAccount({ address: walletB, network: 'mainnet' });
  const afterWalletChange = await bridge.getPlayerSnapshot();
  assert.equal(Object.hasOwn(afterWalletChange.player, 'contextualChoices'), false);
  await assert.rejects(bridge.renderPlayerPreview({ rootId }), { code: 'STALE_PLAYER_SESSION' });
  const sessionB = await bridge.openPlayerSession({ rootId });
  assert.equal(sessionB.player.contextualChoices.address, walletB);

  holdChoices = true;
  const started = new Promise((resolve) => { choicesStarted = resolve; });
  const pendingOpen = bridge.openPlayerSession({ rootId });
  await started;
  await bridge.disconnectWallet();
  releaseChoices();
  await assert.rejects(pendingOpen, { code: 'STALE_PLAYER_SESSION' });

  setAccount({ address: walletB, network: 'mainnet' });
  await bridge.connectWallet();
  await bridge.openPlayerSession({ rootId });
  const renderingStarted = new Promise((resolve) => { renderStarted = resolve; });
  const pendingRender = bridge.renderPlayerPreview({ rootId });
  await renderingStarted;
  bridge.dispose();
  releaseRender();
  await assert.rejects(pendingRender, { code: 'STALE_PLAYER_SESSION' });
});

test('Player cold-reads wallet identity after choices even without a wallet subscription', async () => {
  const rootId = `0x${'4f'.repeat(32)}`;
  const walletB = `0x${'50'.repeat(32)}`;
  const commitment = '4f'.repeat(32);
  const { productRuntime, setAccount } = runtimeHarness({ connected: true });
  delete productRuntime.wallet.subscribe;
  productRuntime.catalog.loadPlayer = async (requestedRoot) => (
    publicPlayerAuthority(requestedRoot, commitment)
  );
  let releaseChoices;
  let choicesStarted;
  productRuntime.choices = {
    async load({ address: owner, rootId: requestedRoot }) {
      choicesStarted();
      await new Promise((resolve) => { releaseChoices = resolve; });
      return {
        schemaVersion: 'animacraft.maker-v8-contextual-choices.v1',
        address: owner,
        rootId: requestedRoot,
        certifiedAssets: [], packStyles: [], externalStyles: [], baseEntitlements: [], diagnostics: [],
      };
    },
  };
  let snapshot = { status: 'IDLE' };
  const player = {
    getSnapshot() { return structuredClone(snapshot); },
    async loadPlayer() {
      snapshot = exactEmptyPlayerState({ rootId, commitment });
      return structuredClone(snapshot);
    },
    setRecipe(value) { return value; }, updateRecipe(value) { return value; }, resetRecipe() { return snapshot.recipe; },
    async preparePlayerAction(value) { return value; }, async executePlayerAction(value) { return value; },
    async recoverPlayerAction(value) { return value; }, async getPlayerAction(value) { return value; },
  };
  const { drafts } = draftHarness();
  const bridge = createMakerV8ProductBridge({ productRuntime, drafts, player });
  const started = new Promise((resolve) => { choicesStarted = resolve; });
  const pending = bridge.openPlayerSession({ rootId });
  await started;
  setAccount({ address: walletB, network: 'mainnet' });
  releaseChoices();
  await assert.rejects(pending, { code: 'STALE_PLAYER_SESSION' });
  await assert.rejects(bridge.renderPlayerPreview({ rootId }), { code: 'STALE_PLAYER_SESSION' });
  bridge.dispose();
});

test('completion confirmation rechecks wallet, A-B-A generation, disposal and abort before returning approval', async () => {
  for (const boundary of ['unchanged', 'wallet', 'round-trip', 'dispose', 'abort']) {
    const { productRuntime, setAccount } = runtimeHarness({ connected: true });
    const { drafts } = draftHarness();
    const rootId = `0x${'34'.repeat(32)}`;
    const signal = new AbortController();
    let approvals = 0;
    const bridge = createMakerV8ProductBridge({ productRuntime, drafts,
      execution: { allowWalletSignature: true, allowBroadcast: true },
      playerJourney: { async complete(input, options) {
        const approved = await options.confirmStep({ kind: 'PLAYER_ACTION', rootId, signer: input.signer });
        if (approved) approvals++;
        return { status: 'RECOVERY_REQUIRED' };
      } },
    });
    await bridge.ready();
    const pending = bridge.completePlayerJourney({ rootId }, { signal: signal.signal, confirmStep: async () => {
      if (boundary === 'wallet' || boundary === 'round-trip') setAccount({ address: `0x${'78'.repeat(32)}`, network: 'mainnet' });
      if (boundary === 'round-trip') setAccount({ address, network: 'mainnet' });
      if (boundary === 'dispose') bridge.dispose();
      if (boundary === 'abort') signal.abort();
      return true;
    } });
    if (boundary === 'unchanged') await pending;
    else await assert.rejects(pending);
    assert.equal(approvals, boundary === 'unchanged' ? 1 : 0, boundary);
    bridge.dispose();
  }
});

test('envelope recovery bridge binds export to the wallet and forwards staged JSON only to explicit completion', async () => {
  const { productRuntime, setAccount } = runtimeHarness({ connected: true });
  const { drafts } = draftHarness(); const rootId = `0x${'34'.repeat(32)}`; const calls = [];
  const bridge = createMakerV8ProductBridge({ productRuntime, drafts,
    execution: { allowWalletSignature: true, allowBroadcast: true },
    playerJourney: {
      async exportEnvelopeRecovery(input) { calls.push(['export', input]); return 'exact-recovery-json'; },
      async complete(input, options) { calls.push(['complete', input, options.recoveryJson]); return { status: 'RECOVERY_REQUIRED' }; },
    },
  });
  await bridge.ready();
  assert.equal(await bridge.exportPlayerEnvelopeRecovery({ rootId }), 'exact-recovery-json');
  assert.deepEqual(calls, [['export', { rootId, signer: address }]]);
  await bridge.completePlayerJourney({ rootId }, { recoveryJson: 'exact-recovery-json' });
  assert.deepEqual(calls[1], ['complete', { rootId, signer: address }, 'exact-recovery-json']);
  bridge.dispose();
  const gated = createMakerV8ProductBridge({ productRuntime, drafts,
    execution: { allowWalletSignature: false, allowBroadcast: false },
    playerJourney: { async complete() { assert.fail('Closed gate must not complete'); },
      async exportEnvelopeRecovery() { setAccount({ address: `0x${'78'.repeat(32)}`, network: 'mainnet' }); return 'wrong-wallet-file'; } },
  });
  await gated.ready();
  await assert.rejects(gated.exportPlayerEnvelopeRecovery({ rootId }), { code: 'MAKER_V8_PRODUCT_WALLET_CHANGED' });
  await assert.rejects(gated.completePlayerJourney({ rootId }, { recoveryJson: 'exact-recovery-json' }), { code: 'MAKER_V8_PRODUCT_EXECUTION_DISABLED' });
  gated.dispose();
});

test('approved Soulidity handoff is exposed only through one gated high-level Player journey', async () => {
  const { productRuntime } = runtimeHarness({ connected: true });
  const { drafts } = draftHarness();
  const calls = [];
  const receptions = [];
  const playerJourney = {
    openReception(input) { receptions.push(input); },
    async complete(input) {
      calls.push(input);
      return { status: 'HANDOFF_READY', handoffUrl: 'https://www.soulidity.ai/my-souls' };
    },
  };
  const bridge = createMakerV8ProductBridge({
    productRuntime,
    drafts,
    playerJourney,
    execution: { allowWalletSignature: true, allowBroadcast: true },
  });
  await bridge.ready();
  bridge.openPlayerReception({ rootId: `0x${'34'.repeat(32)}` });
  assert.deepEqual(receptions, [{ rootId: `0x${'34'.repeat(32)}`, signer: address }]);
  const result = await bridge.completePlayerJourney({
    rootId: `0x${'34'.repeat(32)}`,
    project: { schema: 'animacraft.local-project.v8' },
    selections: [],
  });
  assert.equal(result.status, 'HANDOFF_READY');
  assert.equal(calls[0].signer, address);
  assert.equal(Object.hasOwn(bridge, 'performMarketAction'), false);
  bridge.dispose();
  const disabled = createMakerV8ProductBridge({ productRuntime, drafts, playerJourney,
    execution: { allowWalletSignature: false, allowBroadcast: false } });
  assert.throws(() => disabled.openPlayerReception({ rootId: `0x${'34'.repeat(32)}` }), { code: 'MAKER_V8_PRODUCT_EXECUTION_DISABLED' });
  assert.equal(receptions.length, 1);
  disabled.dispose();
});
