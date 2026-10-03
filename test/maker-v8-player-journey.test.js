import test from 'node:test';
import assert from 'node:assert/strict';
import { crc32, deflateSync } from 'node:zlib';
import { sha256 } from '@noble/hashes/sha2.js';
import { fromBase64, toBase64 } from '@mysten/sui/utils';
import { EncryptedObject } from '@mysten/seal';

import {
  createMakerV8PlayerJourneyV8,
  mapMakerV8SmartColorPixelsV8,
  renderMakerV8PlayerRecipePngV8,
  renderMakerV8DraftRecipePngV8,
} from '../maker-v8-player-journey.js';
import { createCharacterMakerV8Starter } from '../maker-v8-document.js';
import { nativeInitialInputFixture } from './fixtures/native-initial-content.js';
import { deriveMakerV8NativeContentIdV8 } from '../maker-v8-native-content-identity.js';
import {
  MAKER_V8_PLAYER_LOADOUT_SCHEMA,
  MAKER_V8_PLAYER_RECIPE_SCHEMA,
  makerV8PlayerRecipeCommitmentV8,
} from '../maker-v8-player-controller.js';
import {
  MAKER_V8_PROTECTED_RENDER_SCHEMA,
  deriveMakerV8SealEncryptionIdentityV8,
} from '../maker-v8-protected-transport.js';

const id = (value) => `0x${value.toString(16).padStart(64, '0')}`;
const ROOT = id(1);
const SIGNER = id(2);
const SOUL = id(3);
const DIGEST = '7'.repeat(44);
const HASH = 'a'.repeat(64);
const RENDER_BYTES = 'AQIDBA==';
const RENDER_HASH = [...sha256(fromBase64(RENDER_BYTES))]
  .map((byte) => byte.toString(16).padStart(2, '0')).join('');
const BASE_SELECTION = Object.freeze({
  source: 'BASE', partKey: 'base', itemKey: 'default', styleKey: 'default',
  trackKey: 'base-track', colorChannelKey: null, defaultSwatchKey: null,
  releaseId: null, semanticPackId: null, externalProductId: null,
  ownedExternalItemId: null,
});

function protectedIdentity() {
  return Object.freeze({
    schemaVersion: 'animacraft.maker-v8-protected-render-identity.v1',
    rootId: ROOT,
    makerVersion: '1',
    rootContentCommitment: HASH,
    signer: SIGNER,
    outputKey: 'portrait',
    scopeKey: 'complete/portrait',
    assetKey: `receipt-${SIGNER.slice(2)}-0`,
    releasePackageId: id(91),
    productBindingCommitment: 'b'.repeat(64),
    policyCommitment: 'c'.repeat(64),
    sealPolicyConfigId: id(92),
    sealRegistryId: id(93),
    sealRuntimeRevision: '0',
  });
}

function playerFixture() {
  return {
    rootId: ROOT,
    makerVersion: '1',
    lifecycle: 'ACTIVE',
    evidence: { contentCommitment: HASH },
    certifiedAssets: [{
      assetId: 'base-default', blobId: 'blob-base', mediaType: 'image/png',
      byteLength: 4, sha256: RENDER_HASH,
    }],
    document: {
      canvas: { width: 8, height: 8, pixelMode: 'pixelated' },
      composition: { mode: 'FIXED', thirdPartyAdmission: 'DISABLED', itemAssetization: false },
      tracks: [{ key: 'base-track', renderOrder: 0 }],
      colors: [],
      parts: [{
        menuOrder: 0,
        capacity: 1,
        key: 'base', items: [{
          key: 'default', status: 'PUBLIC', styles: [{
            key: 'default', trackKey: 'base-track', assetId: 'base-default',
            colorChannelKey: null, defaultSwatchKey: null,
            transform: { x: 0, y: 0, scale: 1, rotation: 0 },
            opacity: 1, blendMode: 'normal', displayOrder: 0,
          }],
        }],
      }],
      outputs: [{ key: 'portrait', protected: false }],
    },
  };
}

function addComposablePart(player, { key, trackKey, menuOrder }) {
  player.document.tracks.push({ key: trackKey, renderOrder: menuOrder });
  player.document.parts.push({ key, menuOrder, capacity: 1, items: [] });
}

test('draft PNG hides condition-false layers using the complete recipe without dropping selections or assets', async () => {
  const document = structuredClone(createCharacterMakerV8Starter());
  const target = structuredClone(document.parts[0]);
  Object.assign(target, { key: 'hat', kind: 'STANDARD', required: false, menuOrder: 1, renderOrder: 1 });
  target.items[0].styles[0].assetId = null;
  document.parts.push(target);
  document.parts[0].items[0].styles[0].visibleWhen = {
    op: 'selected', source: 'BASE', sourceKey: null, partKey: 'hat', itemKey: 'default', styleKey: 'default',
  };
  const assets = [{ assetId: 'base-default', kind: 'layer', mediaType: 'image/png', byteLength: 1, bytesBase64: 'AQ==',
    sha256: [...sha256(new Uint8Array([1]))].map(byte => byte.toString(16).padStart(2, '0')).join('') }];
  const drawn = [];
  const input = {
    document, assets,
    canvasFactory() { return {
      getContext() { return { clearRect() {}, save() {}, restore() {}, translate() {}, rotate() {}, scale() {}, drawImage(source) { drawn.push(source.label); } }; },
      async convertToBlob() { return new Blob([new Uint8Array([1])], { type: 'image/png' }); },
    }; },
    async decodeImage() { return { source: { label: 'base-image', width: 1, height: 1 }, close() {} }; },
  };
  const original = structuredClone({ document, assets });
  await renderMakerV8DraftRecipePngV8(input);
  assert.deepEqual(drawn, []);
  const recipe = structuredClone(document.defaultRecipe);
  recipe.selections.push({ partKey: 'hat', itemKey: 'default', styleKey: 'default' });
  await renderMakerV8DraftRecipePngV8({ ...input, recipe });
  assert.deepEqual(drawn, ['base-image']);
  assert.deepEqual({ document, assets }, original);
  assert.equal(recipe.selections.length, 2);
  await assert.rejects(renderMakerV8DraftRecipePngV8({ ...input, assets: [] }),
    { code: 'MAKER_V8_PLAYER_JOURNEY_DRAFT_ASSET_DRIFT' }, 'A hidden layer does not relax draft asset metadata checks.');
});

test('transparent draft export preserves background dependencies, all selections and source bytes', async () => {
  const document = structuredClone(createCharacterMakerV8Starter());
  document.parts[0].exportBackground = true;
  const figure = structuredClone(document.parts[0]);
  Object.assign(figure, { key: 'figure', exportBackground: false, kind: 'STANDARD', required: false, menuOrder: 1, renderOrder: 1 });
  figure.items[0].styles[0].visibleWhen = { op: 'selected', source: 'BASE', sourceKey: null,
    partKey: 'base', itemKey: 'default', styleKey: 'default' };
  document.parts.push(figure);
  document.defaultRecipe.selections.push({ partKey: 'figure', itemKey: 'default', styleKey: 'default' });
  document.canvas = { width: 2048, height: 1536, pixelMode: 'smooth' };
  const assets = [{ assetId: 'base-default', kind: 'layer', mediaType: 'image/png', byteLength: 1, bytesBase64: 'AQ==',
    sha256: [...sha256(new Uint8Array([1]))].map(byte => byte.toString(16).padStart(2, '0')).join('') }];
  let draws = 0;
  const input = { document, assets, exportOptions: { sizeMode: 'standard', transparent: true },
    canvasFactory: () => ({ getContext: () => ({ clearRect() {}, save() {}, restore() {}, translate() {}, rotate() {}, scale() {}, drawImage() { draws++; } }),
      convertToBlob: async () => new Blob([new Uint8Array([1])], { type: 'image/png' }) }),
    decodeImage: async () => ({ source: { width: 1, height: 1 }, close() {} }) };
  const before = structuredClone({ document, assets });
  assert.equal((await renderMakerV8DraftRecipePngV8(input)).width, 1024);
  assert.equal(draws, 1, 'Hidden background still satisfies the visible figure dependency.');
  assert.deepEqual({ document, assets }, before);
  await renderMakerV8DraftRecipePngV8({ ...input, exportOptions: null });
  assert.equal(draws, 3, 'Normal preview still contains both original layers.');
  document.parts[1].exportBackground = true;
  await renderMakerV8DraftRecipePngV8(input);
  assert.equal(draws, 3, 'All backgrounds yield a valid transparent image.');
  await assert.rejects(renderMakerV8DraftRecipePngV8({ ...input, assets: [] }),
    { code: 'MAKER_V8_PLAYER_JOURNEY_DRAFT_ASSET_DRIFT' });
});

test('certified PNG visibility filters only after BASE selection identity validation and exact contextual reads', async () => {
  const player = playerFixture();
  player.document.parts[0].items[0].styles[0].visibleWhen = {
    op: 'selected', source: 'PACK', sourceKey: 'sample-pack', partKey: 'hat', itemKey: 'default', styleKey: 'default',
  };
  let choiceReads = 0;
  let loads = 0;
  const input = {
    player, recipe: { rootId: ROOT, selections: [structuredClone(BASE_SELECTION)], colors: [] }, signer: SIGNER,
    productRuntime: {
      choices: { async load() { choiceReads += 1; return choicesFixture(); } },
      assets: { async load() { loads += 1; throw new Error('Hidden layer must not load.'); } },
    },
    canvasFactory() { return {
      getContext() { return { clearRect() {}, save() {}, restore() {}, translate() {}, rotate() {}, scale() {}, drawImage() { throw new Error('Hidden layer must not draw.'); } }; },
      async convertToBlob() { return new Blob([new Uint8Array([1])], { type: 'image/png' }); },
    }; },
    async decodeImage() { throw new Error('Hidden layer must not decode.'); },
  };
  const original = structuredClone(input.recipe);
  await renderMakerV8PlayerRecipePngV8(input);
  assert.equal(choiceReads, 1); assert.equal(loads, 0);
  assert.deepEqual(input.recipe, original);
  await assert.rejects(renderMakerV8PlayerRecipePngV8({ ...input,
    recipe: { ...input.recipe, selections: [{ ...BASE_SELECTION, trackKey: 'forged' }] },
  }), { code: 'MAKER_V8_PLAYER_JOURNEY_BASE_STYLE_INVALID' });
  delete player.document.parts[0].items[0].styles[0].visibleWhen;
  player.document.parts[0].exportBackground = true;
  const readsBeforeExport = choiceReads;
  const exported = await renderMakerV8PlayerRecipePngV8({ ...input,
    exportOptions: { sizeMode: 'standard', transparent: true } });
  assert.equal(exported.width, 8);
  assert.equal(choiceReads, readsBeforeExport + 1, 'Transparent export still reads current signer-bound choices.');
  assert.equal(loads, 0);
  assert.deepEqual(input.recipe, original);
  await assert.rejects(renderMakerV8PlayerRecipePngV8({ ...input,
    exportOptions: { sizeMode: 'standard', transparent: true },
    recipe: { ...input.recipe, selections: [{ ...BASE_SELECTION, trackKey: 'forged' }] },
  }), { code: 'MAKER_V8_PLAYER_JOURNEY_BASE_STYLE_INVALID' });
});

function loadoutForRecipe(recipe) {
  const colors = new Map(recipe.colors.map((entry) => [entry.channelKey, entry.swatchKey]));
  const selections = recipe.selections.map((selection, selectionIndex) => ({
    selectionIndex,
    ...structuredClone(selection),
    swatchKey: selection.colorChannelKey === null
      ? null : colors.get(selection.colorChannelKey) ?? selection.defaultSwatchKey,
  }));
  const usedPacks = [...new Map(selections.filter((selection) => selection.source === 'PACK')
    .map((selection) => [selection.releaseId, {
      releaseId: selection.releaseId,
      semanticPackId: selection.semanticPackId,
    }])).values()].sort((left, right) => (
    left.semanticPackId < right.semanticPackId ? -1
      : left.semanticPackId > right.semanticPackId ? 1
        : left.releaseId < right.releaseId ? -1 : left.releaseId > right.releaseId ? 1 : 0
  ));
  return {
    schemaVersion: MAKER_V8_PLAYER_LOADOUT_SCHEMA,
    rootId: recipe.rootId,
    makerVersion: recipe.makerVersion,
    rootContentCommitment: recipe.rootContentCommitment,
    outputKey: recipe.outputKey,
    selections,
    usedPacks,
    recipeCommitment: makerV8PlayerRecipeCommitmentV8(recipe),
  };
}

function projectForSnapshot(snapshot, overrides = {}) {
  return {
    schemaVersion: 'animacraft.local-player-project.v8',
    imageExport: { sizeMode: 'original', transparent: false },
    enabledPackReleaseIds: [...new Set(snapshot.recipe.selections.filter(row => row.source === 'PACK').map(row => row.releaseId))].sort(),
    profile: { name: 'Nova' },
    soul: {},
    recipe: structuredClone(snapshot.recipe),
    loadout: structuredClone(snapshot.loadout),
    render: {
      schemaVersion: 'animacraft.maker-v8-player-render.v1',
      mediaType: 'image/png',
      width: snapshot.player.document.canvas.width,
      height: snapshot.player.document.canvas.height,
      byteLength: 4,
      sha256: RENDER_HASH,
    },
    ...structuredClone(overrides),
  };
}

function choicesFixture(overrides = {}) {
  return {
    schemaVersion: 'animacraft.maker-v8-contextual-choices.v1',
    address: SIGNER,
    rootId: ROOT,
    baseEntitlements: [],
    packStyles: [],
    externalStyles: [],
    certifiedAssets: [],
    diagnostics: [],
    ...structuredClone(overrides),
    packStyles: (overrides.packStyles || []).map(choice => ({
      access: { accessible: true, canEquip: true, reason: '' }, ...structuredClone(choice),
    })),
    externalStyles: (overrides.externalStyles || []).map(choice => ({
      access: { accessible: true, canEquip: true, reason: '' }, ...structuredClone(choice),
    })),
  };
}

function harness({
  inventory = [],
  inventoryLoader = null,
  uploadStatus = 'COMPLETE',
  playerData = playerFixture(),
  selections = [structuredClone(BASE_SELECTION)],
  colors = [],
  protectedTransport = null,
  onActionPrepared = null,
  onUploadPrepared = null,
  nativeContentOverride = undefined,
  nativeContentStatus = 'READY',
  nativeSyncStatus = 'COMPLETE',
  onNativeFinalize = null,
  activePlayerUnavailable = false,
  onNativePreflight = null,
  onQuote = null,
  renderOverride = null,
  nativeJournal = { completion: null, actions: new Map() },
  completeIdentity = { actionId: 'completeOutput-id', soulId: SOUL, transactionDigest: DIGEST },
} = {}) {
  const recipe = {
    schemaVersion: MAKER_V8_PLAYER_RECIPE_SCHEMA,
    rootId: ROOT,
    makerVersion: '1',
    rootContentCommitment: HASH,
    selections: structuredClone(selections),
    colors: structuredClone(colors),
    outputKey: 'portrait',
  };
  let snapshot = {
    status: 'READY', player: playerData, recipe, loadout: loadoutForRecipe(recipe),
  };
  const calls = [];
  let inventoryLoads = 0;
  const player = {
    getSnapshot() { return activePlayerUnavailable ? { status: 'UNAVAILABLE' } : snapshot; },
    async quotePlayerCompletion() {
      calls.push('quote');
      const overview = { rootId: ROOT, signer: SIGNER, recipeCommitment: snapshot.loadout.recipeCommitment,
        completePaymentQuote: {}, entryPaymentQuote: {}, totalBusinessAmountAtomic: '0' };
      return onQuote ? onQuote(overview) : overview;
    },
    async loadPlayer() { calls.push('load'); return activePlayerUnavailable ? { status: 'UNAVAILABLE' } : snapshot; },
    setRecipe(next) {
      const nextRecipe = structuredClone(next);
      snapshot = { ...snapshot, recipe: nextRecipe, loadout: loadoutForRecipe(nextRecipe) };
    },
    async resolveProtectedOutputIdentity() {
      calls.push('resolveProtectedOutputIdentity');
      return protectedIdentity();
    },
    async preparePlayerAction({ action, input }) {
      calls.push(`prepare:${action}`);
      calls.push({ action, input: structuredClone(input) });
      await onActionPrepared?.(action);
      const prepared = { status: 'PREPARED', actionId: action === 'completeOutput' ? completeIdentity.actionId : `${action}-id` };
      nativeJournal.actions.set(prepared.actionId, prepared);
      return prepared;
    },
    async executePlayerAction(actionId) {
      calls.push(`execute:${actionId}`);
      const complete = actionId.startsWith('completeOutput');
      const result = {
        status: 'FINALIZED_SUCCESS',
        actionId,
        transactionDigest: complete ? completeIdentity.transactionDigest : `digest-${actionId}`,
        certificate: complete ? {
          evidence: {
            objects: [{ type: `${id(9)}::soul::Soul`, objectId: completeIdentity.soulId }],
            certifiedEvent: { type: `${id(10)}::output_v8::NativeSoulBoundV8`, fields: { soul_id: completeIdentity.soulId, root_id: ROOT, original_holder: SIGNER } },
          },
        } : { evidence: { objects: [] } },
      };
      nativeJournal.actions.set(actionId, result);
      return result;
    },
    async recoverPlayerAction(actionId) {
      calls.push(`recover:${actionId}`);
      return structuredClone(nativeJournal.actions.get(actionId));
    },
  };
  let durable = null;
  let currentUpload = null;
  const walrus = {
    publisher: {
      async load() { return currentUpload; },
      async prepare(input) {
        const bytes = fromBase64(input.bytesBase64);
        const byteSha256 = [...sha256(bytes)]
          .map((byte) => byte.toString(16).padStart(2, '0')).join('');
        currentUpload = {
          status: uploadStatus === 'SIGNATURE_REQUIRED' ? uploadStatus : 'COMPLETE',
          blobId: 'blob-render', byteSha256, byteLength: bytes.length,
        };
        durable = {
          encoded: {
            blobId: 'blob-render',
            rootHash: toBase64(Uint8Array.from({ length: 32 }, () => 9)),
          },
          byteSha256,
        };
        calls.push({ upload: structuredClone(input) });
        await onUploadPrepared?.();
        return currentUpload;
      },
      async requestSignature() {
        calls.push('upload:requestSignature');
        return currentUpload;
      },
      async resume() { return currentUpload; },
    },
    persistence: { async load() { return durable; } },
  };
  const productRuntime = {
    inventory: {
      async load(input) {
        inventoryLoads += 1;
        if (inventoryLoader) return inventoryLoader(input);
        return { status: inventory.length ? 'READY' : 'EMPTY', items: inventory };
      },
    },
    choices: { async load() { return choicesFixture(); } },
    assets: { async load() { return { assetId: 'base-default', blobId: 'blob-base', mediaType: 'image/png', byteLength: 4, sha256: RENDER_HASH, bytesBase64: 'AQIDBA==' }; } },
  };
  const journey = createMakerV8PlayerJourneyV8({
    player,
    productRuntime,
    walrus,
    protectedTransport,
    // Orchestration fixture only: this does not upload or certify native content.
    nativeContent: nativeContentOverride === undefined ? {
      async preflight() { await onNativePreflight?.(); },
      async loadCompletion() { return structuredClone(nativeJournal.completion); },
      async saveCompletion(value) { nativeJournal.completion = structuredClone(value); },
      async clearCompletion({ actionId }) {
        assert.equal(nativeJournal.completion.actionId, actionId);
        nativeJournal.completion = null;
      },
      async retireFinalizedCompletion({ actionId, soulId, transactionDigest }) {
        assert.equal(nativeJournal.completion.actionId, actionId);
        assert.equal(soulId, nativeJournal.actions.get(actionId).certificate.evidence.certifiedEvent.fields.soul_id);
        assert.equal(transactionDigest, nativeJournal.actions.get(actionId).transactionDigest);
        calls.push(`retire:${actionId}`);
        nativeJournal.completion = null;
      },
      async prepare({ assertBeforeSignature }) {
        await assertBeforeSignature({ kind: 'STORAGE_UPLOAD', purpose: 'NATIVE_CONTENT',
          uploadId: 'native-test-content', byteLength: 4, byteSha256: RENDER_HASH });
        return { status: nativeContentStatus, nativeSoul: nativeInitialInputFixture({
          name: 'Nova', description: 'A test character', currentKioskId: null, currentKioskCapOnChainId: null,
          mintNonce: '12'.repeat(16),
          expectedContentObjectId: deriveMakerV8NativeContentIdV8({ soulidityOriginalPackageId: id(90), kioskRegistryId: id(91) }, SIGNER, '12'.repeat(16)),
          initialStateConfig: [],
          initialContent: [
            { kind: 0, name: 'soul', slotReadModeMask: 3, downloadPolicy: 'public', setActive: false, blobObjectId: id(70), expectedVersionIndex: '0' },
            { kind: 1, name: 'default', slotReadModeMask: 3, downloadPolicy: 'public', setActive: false, blobObjectId: id(71), expectedVersionIndex: '0' },
          ],
        }, id(90)) };
      },
      async finalize({ action, assertBeforeSignature }) { await onNativeFinalize?.({ action, assertBeforeSignature }); return { status: nativeSyncStatus,
        soulId: action.certificate.evidence.certifiedEvent.fields.soul_id, transactionDigest: action.transactionDigest }; },
    } : nativeContentOverride,
    render: renderOverride ?? (async () => ({
      schemaVersion: 'animacraft.maker-v8-player-render.v1',
      mediaType: 'image/png', width: 8, height: 8, bytesBase64: RENDER_BYTES,
      byteLength: 4, sha256: RENDER_HASH,
    })),
  });
  return {
    walrus,
    // Explicit simulated confirmations for orchestration tests, never real wallet approval.
    journey: { ...journey, complete: (input, options = { confirmStep: async () => true }) => journey.complete(input, options) },
    calls,
    project: () => projectForSnapshot(snapshot),
    snapshot: () => structuredClone(snapshot),
    inventoryLoads: () => inventoryLoads,
    mutateRecipe(patch) {
      const nextRecipe = { ...snapshot.recipe, ...structuredClone(patch) };
      snapshot = { ...snapshot, recipe: nextRecipe, loadout: loadoutForRecipe(nextRecipe) };
    },
    mutateLoadout(mutator) {
      const nextLoadout = structuredClone(snapshot.loadout);
      mutator(nextLoadout);
      snapshot = { ...snapshot, loadout: nextLoadout };
    },
  };
}

test('missing or refused overview confirmation does not prepare, acquire or upload', async () => {
  for (const options of [{}, { confirmStep: async () => false }]) {
    const current = harness();
    await assert.rejects(current.journey.complete({ rootId: ROOT, signer: SIGNER,
      selections: [BASE_SELECTION], project: current.project() }, options), {
      code: options.confirmStep ? 'MAKER_V8_PLAYER_JOURNEY_CONFIRMATION_CANCELLED' : 'MAKER_V8_PLAYER_JOURNEY_CONFIRMATION_REQUIRED',
    });
    assert.ok(current.calls.includes('quote'));
    assert.equal(current.calls.some(call => typeof call === 'string' && call.startsWith('prepare:')), false);
    assert.equal(current.calls.some(call => typeof call === 'string' && call.startsWith('execute:')), false);
    assert.equal(current.calls.some(call => call?.upload), false);
  }
});

test('each transaction requires its own confirmation and a cancelled final Complete resumes the original action', async () => {
  const nativeJournal = { completion: null, actions: new Map() };
  const first = harness({ nativeJournal });
  const steps = [];
  await assert.rejects(first.journey.complete({ rootId: ROOT, signer: SIGNER,
    selections: [BASE_SELECTION], project: first.project() }, {
    confirmStep: async step => {
      assert.equal(Object.isFrozen(step), true);
      assert.equal(step.rootId, ROOT); assert.equal(step.signer, SIGNER);
      steps.push(step.kind === 'PLAYER_ACTION' ? step.action : step.purpose || step.kind);
      return step.action !== 'completeOutput';
    },
  }), { code: 'MAKER_V8_PLAYER_JOURNEY_CONFIRMATION_CANCELLED' });
  assert.deepEqual(steps, ['COMPLETION_OVERVIEW', 'acquireMakerAccess', 'commitLoadout', 'NATIVE_CONTENT', 'completeOutput']);
  assert.equal(nativeJournal.completion.actionId, 'completeOutput-id');
  assert.equal(first.calls.includes('execute:completeOutput-id'), false);
  const second = harness({ nativeJournal });
  const resumed = [];
  const result = await second.journey.complete({ rootId: ROOT, signer: SIGNER,
    selections: [BASE_SELECTION], project: second.project() }, { confirmStep: async step => {
    resumed.push(step.record.actionId); return true;
  } });
  assert.equal(result.status, 'HANDOFF_READY');
  assert.deepEqual(resumed, ['completeOutput-id']);
  assert.equal(second.calls.some(call => typeof call === 'string' && call.startsWith('prepare:')), false);
  assert.equal(second.calls.some(call => call?.upload), false);
});

test('overview is read-only and declining the following exact transaction retains preparation without execution', async () => {
  const current = harness();
  const kinds = [];
  await assert.rejects(current.journey.complete({ rootId: ROOT, signer: SIGNER,
    selections: [BASE_SELECTION], project: current.project() }, { confirmStep: async step => {
      kinds.push(step.kind);
      if (step.kind === 'COMPLETION_OVERVIEW') {
        assert.equal(current.calls.some(call => typeof call === 'string' && call.startsWith('prepare:')), false);
        assert.equal(current.calls.some(call => call?.upload), false);
        assert.ok(Object.isFrozen(step.overview));
        return true;
      }
      return false;
    } }), { code: 'MAKER_V8_PLAYER_JOURNEY_CONFIRMATION_CANCELLED' });
  assert.deepEqual(kinds, ['COMPLETION_OVERVIEW', 'PLAYER_ACTION']);
  assert.ok(current.calls.includes('prepare:acquireMakerAccess'));
  assert.equal(current.calls.some(call => typeof call === 'string' && call.startsWith('execute:')), false);
});

test('missing, failed, foreign or stale overview cannot reach acquisition or upload', async () => {
  for (const kind of ['missing', 'failed', 'root', 'wallet', 'recipe', 'changed']) {
    let current;
    current = harness({ onQuote: async quote => {
      if (kind === 'missing') return null;
      if (kind === 'failed') throw new Error('Exact quota read failed');
      if (kind === 'root') quote.rootId = id(900);
      if (kind === 'wallet') quote.signer = id(901);
      if (kind === 'recipe') quote.recipeCommitment = 'b'.repeat(64);
      if (kind === 'changed') current.mutateRecipe({ colors: [{ channelKey: 'primary', swatchKey: 'green' }] });
      return quote;
    } });
    await assert.rejects(current.journey.complete({ rootId: ROOT, signer: SIGNER,
      selections: [BASE_SELECTION], project: current.project() }));
    assert.equal(current.calls.some(call => typeof call === 'string' && /^(prepare|execute):/.test(call)), false, kind);
    assert.equal(current.calls.some(call => call?.upload), false, kind);
  }
});

test('retry keeps the finalized Soul while an explicit new-completion confirmation starts a distinct action', async () => {
  const nativeJournal = { completion: null, actions: new Map() };
  const first = harness({ nativeJournal });
  const initial = await first.journey.complete({ rootId: ROOT, signer: SIGNER,
    selections: [BASE_SELECTION], project: first.project() });
  assert.equal(nativeJournal.completion.actionId, initial.actionId);
  const second = harness({ nativeJournal, completeIdentity: {
    actionId: 'completeOutput-second', soulId: id(808), transactionDigest: 'second-digest',
  } });
  const input = { rootId: ROOT, signer: SIGNER, selections: [BASE_SELECTION], project: second.project() };
  const recovered = await second.journey.complete(input, {});
  assert.equal(recovered.soulId, initial.soulId);
  assert.equal(recovered.recovered, true);
  assert.deepEqual(second.calls, ['recover:completeOutput-id']);
  const newCompletionFrom = { actionId: initial.actionId, soulId: initial.soulId, transactionDigest: initial.transactionDigest };
  await assert.rejects(second.journey.complete(input, { startNew: true, newCompletionFrom,
    confirmStep: async step => { assert.equal(step.kind, 'NEW_COMPLETION'); return false; },
  }), { code: 'MAKER_V8_PLAYER_JOURNEY_CONFIRMATION_CANCELLED' });
  assert.equal(nativeJournal.completion.actionId, initial.actionId);
  const confirmations = [];
  const result = await second.journey.complete(input, { startNew: true, newCompletionFrom,
    confirmStep: async step => { confirmations.push(step.kind); return true; },
  });
  assert.equal(confirmations[0], 'NEW_COMPLETION');
  assert.equal(result.actionId, 'completeOutput-second');
  assert.equal(result.soulId, id(808));
  assert.equal(nativeJournal.completion.actionId, result.actionId);
  assert.ok(second.calls.indexOf('retire:completeOutput-id') < second.calls.indexOf('prepare:completeOutput'));
  const before = [...second.calls];
  await assert.rejects(second.journey.complete(input, { startNew: true, newCompletionFrom, confirmStep: async () => true }),
    { code: 'MAKER_V8_PLAYER_JOURNEY_COMPLETED_RECORD_REQUIRED' });
  assert.deepEqual(second.calls, before, 'an old new-completion button cannot clear or execute the newer action');
});

test('an edit or abort while a confirmation is visible cannot execute the prepared step', async () => {
  for (const abort of [false, true]) {
    const current = harness();
    const controller = new AbortController();
    await assert.rejects(current.journey.complete({ rootId: ROOT, signer: SIGNER,
      selections: [BASE_SELECTION], project: current.project() }, {
      signal: controller.signal,
      confirmStep: async () => {
        if (abort) controller.abort();
        else current.mutateRecipe({ colors: [{ channelKey: 'primary', swatchKey: 'green' }] });
        return true;
      },
    }));
    assert.equal(current.calls.some(call => typeof call === 'string' && call.startsWith('execute:')), false);
  }
});

test('render upload follows ENCODED and both signature/recovery stages, preserving the second unsigned stage on cancel', async () => {
  const current = harness();
  let raw = null;
  const signs = [];
  const publicView = () => raw === null ? null : { ...raw,
    status: ['ENCODED', 'UPLOADED'].includes(raw.status) ? 'SIGNATURE_REQUIRED'
      : raw.status.endsWith('_SIGNED') ? 'RECOVERY_REQUIRED' : raw.status };
  // Real publisher states (tested separately in maker-v8-walrus.test.js), not a real wallet/relay.
  current.walrus.publisher.prepare = async input => {
    raw = { status: 'ENCODED', revision: 1, blobId: 'stateful-render', byteLength: 4,
      byteSha256: RENDER_HASH, uploadId: input.uploadId };
    return { ...raw };
  };
  current.walrus.publisher.load = async () => publicView();
  current.walrus.publisher.requestSignature = async uploadId => {
    assert.equal(uploadId, raw.uploadId);
    signs.push(raw.status);
    assert.ok(['ENCODED', 'UPLOADED'].includes(raw.status));
    raw = { ...raw, revision: raw.revision + 1, status: raw.status === 'ENCODED' ? 'REGISTER_SIGNED' : 'CERTIFY_SIGNED' };
    return publicView();
  };
  current.walrus.publisher.resume = async () => {
    assert.ok(['REGISTER_SIGNED', 'CERTIFY_SIGNED'].includes(raw.status));
    raw = { ...raw, revision: raw.revision + 1, status: raw.status === 'REGISTER_SIGNED' ? 'UPLOADED' : 'COMPLETE' };
    return publicView();
  };
  current.walrus.persistence.load = async () => ({ encoded: { blobId: raw.blobId,
    rootHash: toBase64(new Uint8Array(32).fill(9)) }, byteSha256: RENDER_HASH });
  const input = { rootId: ROOT, signer: SIGNER, selections: [BASE_SELECTION], project: current.project() };
  const renderSteps = [];
  await assert.rejects(current.journey.complete(input, { confirmStep: async step => {
    if (step.purpose !== 'RENDER') return true;
    renderSteps.push(step); return renderSteps.length < 2;
  } }), { code: 'MAKER_V8_PLAYER_JOURNEY_CONFIRMATION_CANCELLED' });
  assert.deepEqual(signs, ['ENCODED']);
  assert.equal(raw.status, 'UPLOADED');
  assert.equal(renderSteps[0].uploadId, renderSteps[1].uploadId);
  let confirmedAgain = 0;
  const result = await current.journey.complete(input, { confirmStep: async step => {
    if (step.purpose === 'RENDER') { confirmedAgain++; assert.equal(step.uploadId, raw.uploadId); }
    return true;
  } });
  assert.equal(result.status, 'HANDOFF_READY');
  assert.equal(confirmedAgain, 1);
  assert.deepEqual(signs, ['ENCODED', 'UPLOADED']);
  assert.equal(raw.status, 'COMPLETE');
});

test('render storage confirmation is separate from entry and refuses before its wallet request', async () => {
  const current = harness({ uploadStatus: 'SIGNATURE_REQUIRED' });
  const confirmed = [];
  await assert.rejects(current.journey.complete({ rootId: ROOT, signer: SIGNER,
    selections: [BASE_SELECTION], project: current.project() }, { confirmStep: async step => {
    confirmed.push(step);
    return step.kind !== 'STORAGE_UPLOAD';
  } }), { code: 'MAKER_V8_PLAYER_JOURNEY_CONFIRMATION_CANCELLED' });
  assert.equal(confirmed.at(-1).purpose, 'RENDER');
  assert.equal(confirmed.at(-1).byteSha256, RENDER_HASH);
  assert.equal(current.calls.includes('upload:requestSignature'), false);
  assert.equal(current.calls.includes('execute:completeOutput-id'), false);
});

test('approved high-level flow acquires access, commits the loadout, uploads PNG, completes Soul and hands to Soulidity', async () => {
  const { journey, calls, project } = harness();
  const result = await journey.complete({
    rootId: ROOT,
    signer: SIGNER,
    selections: [BASE_SELECTION],
    project: project(),
  });
  assert.equal(result.status, 'HANDOFF_READY');
  assert.equal(result.soulId, SOUL);
  assert.match(result.handoffUrl, /^https:\/\/www\.soulidity\.ai\/my-souls\?/);
  assert.match(result.handoffUrl, new RegExp(`soul=${SOUL}`));
  assert.deepEqual(calls.filter((entry) => typeof entry === 'string' && entry.startsWith('prepare:')), [
    'prepare:acquireMakerAccess',
    'prepare:commitLoadout',
    'prepare:completeOutput',
  ]);
});

test('an enabled but unused Pack does not enter the completion acquisition or used-Pack path', async () => {
  const { journey, calls, project } = harness();
  const visible = project();
  visible.enabledPackReleaseIds = [id(900)];
  const result = await journey.complete({ rootId: ROOT, signer: SIGNER,
    selections: [BASE_SELECTION], project: visible });
  assert.equal(result.status, 'HANDOFF_READY');
  assert.deepEqual(calls.filter(entry => typeof entry === 'string' && entry.startsWith('prepare:')), [
    'prepare:acquireMakerAccess', 'prepare:commitLoadout', 'prepare:completeOutput',
  ]);
  assert.deepEqual(visible.loadout.usedPacks, []);
});

test('one composable journey acquires assetized Base and Pack access while using the already-owned external Item', async () => {
  const pack = {
    ...BASE_SELECTION,
    source: 'PACK',
    partKey: 'hat',
    itemKey: 'moon-hat',
    styleKey: 'violet',
    trackKey: 'hat-track',
    releaseId: id(30),
    semanticPackId: 'moon-pack',
  };
  const external = {
    ...BASE_SELECTION,
    source: 'EXTERNAL',
    partKey: 'accessory',
    itemKey: 'external-pin',
    styleKey: 'gold',
    trackKey: 'accessory-track',
    externalProductId: id(31),
    ownedExternalItemId: id(32),
  };
  const playerData = playerFixture();
  playerData.document.composition = {
    mode: 'COMPOSABLE', thirdPartyAdmission: 'OPEN', itemAssetization: true,
  };
  addComposablePart(playerData, { key: 'hat', trackKey: 'hat-track', menuOrder: 1 });
  addComposablePart(playerData, { key: 'accessory', trackKey: 'accessory-track', menuOrder: 2 });
  const selections = [BASE_SELECTION, pack, external];
  const { journey, calls, project } = harness({
    playerData,
    selections,
    inventory: [{
      kind: 'OWNED_EXTERNAL_ITEM',
      id: external.ownedExternalItemId,
      rootId: ROOT,
      sourceId: external.externalProductId,
      partKey: external.partKey,
      itemKey: external.itemKey,
      styleKey: external.styleKey,
    }],
  });
  const result = await journey.complete({
    rootId: ROOT,
    signer: SIGNER,
    selections,
    project: project(),
  });
  assert.equal(result.status, 'HANDOFF_READY');
  assert.deepEqual(calls.filter((entry) => typeof entry === 'string' && entry.startsWith('prepare:')), [
    'prepare:acquireMakerAccess',
    'prepare:acquireBaseItem',
    'prepare:acquirePackAccess',
    'prepare:commitLoadout',
    'prepare:completeOutput',
  ]);
});

test('a selected external Item must be holder-owned before any access acquisition or signing', async () => {
  const external = {
    ...BASE_SELECTION,
    source: 'EXTERNAL',
    partKey: 'accessory',
    itemKey: 'external-pin',
    styleKey: 'gold',
    trackKey: 'accessory-track',
    externalProductId: id(41),
    ownedExternalItemId: id(42),
  };
  const playerData = playerFixture();
  playerData.document.composition = {
    mode: 'COMPOSABLE', thirdPartyAdmission: 'OPEN', itemAssetization: false,
  };
  addComposablePart(playerData, { key: 'accessory', trackKey: 'accessory-track', menuOrder: 1 });
  const { journey, calls, project } = harness({
    playerData,
    selections: [BASE_SELECTION, external],
    inventory: [],
  });
  await assert.rejects(
    journey.complete({
      rootId: ROOT,
      signer: SIGNER,
      selections: [BASE_SELECTION, external],
      project: project(),
    }),
    (error) => error.code === 'MAKER_V8_PLAYER_JOURNEY_EXTERNAL_ITEM_NOT_HELD'
      && error.layer === 'INVENTORY',
  );
  assert.deepEqual(calls, []);
});

test('a non-final Walrus upload returns one recoverable product state and never completes a Soul', async () => {
  const { journey, calls, project } = harness({
    inventory: [{ kind: 'MAKER_ACCESS', rootId: ROOT }],
    uploadStatus: 'SIGNATURE_REQUIRED',
  });
  const result = await journey.complete({
    rootId: ROOT,
    signer: SIGNER,
    selections: [BASE_SELECTION],
    project: project(),
  });
  assert.equal(result.status, 'RECOVERY_REQUIRED');
  assert.equal(result.stage, 'RENDER_UPLOAD');
  assert.equal(calls.some((entry) => entry === 'prepare:completeOutput'), false);
});

test('protected Output fails before any chain action when the server-only Seal transport is absent', async () => {
  const playerData = playerFixture();
  playerData.makerVersion = '1';
  playerData.evidence = { contentCommitment: HASH };
  playerData.document.outputs[0].protected = true;
  const { journey, calls, project } = harness({ playerData });
  await assert.rejects(
    journey.complete({
      rootId: ROOT,
      signer: SIGNER,
      selections: [BASE_SELECTION],
      project: project(),
    }),
    (error) => error.code === 'MAKER_V8_PLAYER_PROTECTED_TRANSPORT_REQUIRED'
      && error.layer === 'BLOCKED_EXTERNAL_SECRET',
  );
  assert.deepEqual(calls, []);
});

test('protected Output uploads only exact server-produced ciphertext before Complete', async () => {
  const playerData = playerFixture();
  playerData.makerVersion = '1';
  playerData.evidence = { contentCommitment: HASH };
  playerData.document.outputs[0].protected = true;
  let ciphertext = null;
  let ciphertextHash = null;
  let request = null;
  const { journey, calls, project } = harness({
    playerData,
    protectedTransport: {
      async protect(value) {
        request = value;
        const derived = deriveMakerV8SealEncryptionIdentityV8(value.identity);
        const bytes = EncryptedObject.serialize({
          version: 0,
          packageId: derived.packageId,
          id: derived.sealId,
          services: [[id(90), 1]],
          threshold: 1,
          encryptedShares: {
            BonehFranklinBLS12381: {
              nonce: new Uint8Array(96).fill(7),
              encryptedShares: [new Uint8Array(32).fill(8)],
              encryptedRandomness: new Uint8Array(32).fill(9),
            },
          },
          ciphertext: {
            Aes256Gcm: {
              blob: new Uint8Array([5, 6, 7, 8]),
              aad: fromBase64(derived.aadBase64),
            },
          },
        }).toBytes();
        ciphertext = toBase64(bytes);
        ciphertextHash = [...sha256(bytes)]
          .map((byte) => byte.toString(16).padStart(2, '0')).join('');
        return {
          schemaVersion: MAKER_V8_PROTECTED_RENDER_SCHEMA,
          mediaType: 'application/vnd.animacraft.seal-ciphertext',
          bytesBase64: ciphertext,
          byteLength: bytes.length,
          sha256: ciphertextHash,
          packageId: derived.packageId,
          sealId: derived.sealId,
          aadSha256: derived.aadSha256,
        };
      },
    },
  });
  const result = await journey.complete({
    rootId: ROOT,
    signer: SIGNER,
    selections: [BASE_SELECTION],
    project: project(),
  });
  assert.equal(result.status, 'HANDOFF_READY');
  assert.equal(request.identity.scopeKey, 'complete/portrait');
  assert.equal(request.identity.assetKey, `receipt-${SIGNER.slice(2)}-0`);
  assert.equal(request.render.bytesBase64, RENDER_BYTES);
  const upload = calls.find((entry) => entry?.upload);
  assert.equal(upload.upload.mediaType, 'application/vnd.animacraft.seal-ciphertext');
  assert.equal(upload.upload.bytesBase64, ciphertext);
  const complete = calls.find((entry) => entry?.action === 'completeOutput');
  assert.equal(complete.input.render.sha256, ciphertextHash);
});

test('renderer refuses an admitted external Item that lacks certified media bytes', async () => {
  const external = {
    ...BASE_SELECTION,
    source: 'EXTERNAL',
    itemKey: 'external-hat',
    styleKey: 'violet',
    externalProductId: id(20),
    ownedExternalItemId: id(21),
  };
  await assert.rejects(
    renderMakerV8PlayerRecipePngV8({
      player: playerFixture(),
      recipe: { rootId: ROOT, selections: [external] },
      signer: SIGNER,
      productRuntime: {
        assets: { async load() { throw new Error('not reached'); } },
        choices: {
          async load() {
            return choicesFixture({ externalStyles: [{ ...external, assetId: null }] });
          },
        },
      },
      canvasFactory() { throw new Error('not reached'); },
    }),
    (error) => error.code === 'MAKER_V8_EXTERNAL_ASSET_RENDER_METADATA_UNAVAILABLE'
      && error.layer === 'CONTRACT',
  );
});

test('public renderer always point-reads live choices and ignores forged caller context', async () => {
  const external = {
    ...BASE_SELECTION,
    source: 'EXTERNAL',
    itemKey: 'external-hat',
    styleKey: 'violet',
    externalProductId: id(51),
    ownedExternalItemId: id(52),
  };
  const attacks = [
    { ...external, partKey: 'ghost-part' },
    { ...external, externalProductId: id(53), ownedExternalItemId: id(54) },
    external,
  ];
  let liveChoiceLoads = 0;
  let assetLoads = 0;
  for (const [index, selection] of attacks.entries()) {
    const fakeAssetId = `caller-fake-${index}`;
    const callerChoices = choicesFixture({
      externalStyles: [{ ...selection, assetId: fakeAssetId }],
      certifiedAssets: [{
        assetId: fakeAssetId,
        blobId: `caller-blob-${index}`,
        mediaType: 'image/png',
        byteLength: 4,
        sha256: RENDER_HASH,
      }],
    });
    await assert.rejects(
      renderMakerV8PlayerRecipePngV8({
        player: playerFixture(),
        recipe: { rootId: ROOT, selections: [selection], colors: [] },
        signer: SIGNER,
        // Deliberately supplied by an untrusted caller. The public API must
        // ignore it and observe the live loader's revoked empty authority.
        contextualChoices: callerChoices,
        productRuntime: {
          choices: {
            async load(input) {
              liveChoiceLoads += 1;
              assert.deepEqual(input, { address: SIGNER, rootId: ROOT });
              return choicesFixture();
            },
          },
          assets: {
            async load() {
              assetLoads += 1;
              throw new Error('revoked choices must fail before asset loading');
            },
          },
        },
        canvasFactory() { throw new Error('revoked choices must fail before canvas'); },
      }),
      { code: 'MAKER_V8_EXTERNAL_ASSET_RENDER_METADATA_UNAVAILABLE' },
    );
    assert.equal(liveChoiceLoads, index + 1);
  }
  assert.equal(assetLoads, 0);
});

test('bridge-shaped Pack and External players exact-dedupe live certified assets and render PNG', async () => {
  const cases = [
    {
      label: 'Pack',
      collection: 'packStyles',
      assetId: 'bridge-pack-asset',
      blobId: 'bridge-pack-blob',
      selection: {
        ...BASE_SELECTION,
        source: 'PACK',
        itemKey: 'pack-hat',
        styleKey: 'moon',
        releaseId: id(55),
        semanticPackId: 'moon-pack',
      },
    },
    {
      label: 'External',
      collection: 'externalStyles',
      assetId: 'bridge-external-asset',
      blobId: 'bridge-external-blob',
      selection: {
        ...BASE_SELECTION,
        source: 'EXTERNAL',
        itemKey: 'external-hat',
        styleKey: 'violet',
        externalProductId: id(56),
        ownedExternalItemId: id(57),
      },
    },
  ];
  for (const scenario of cases) {
    const asset = {
      assetId: scenario.assetId,
      blobId: scenario.blobId,
      mediaType: 'image/png',
      byteLength: 4,
      sha256: RENDER_HASH,
    };
    const contextualChoices = choicesFixture({
      [scenario.collection]: [{
        ...scenario.selection,
        id: `${scenario.label.toLowerCase()}:choice`,
        label: `${scenario.label} choice`,
        assetId: scenario.assetId,
        protected: false,
      }],
      certifiedAssets: [structuredClone(asset)],
    });
    const player = playerFixture();
    // This is the actual public Player shape after bridge.mergeContextualChoices:
    // the contextual descriptor is already in the top-level certified asset set.
    player.certifiedAssets.push(structuredClone(asset));
    player.contextualChoices = structuredClone(contextualChoices);
    let liveLoads = 0;
    let assetLoads = 0;
    const drawn = [];
    const result = await renderMakerV8PlayerRecipePngV8({
      player,
      recipe: { rootId: ROOT, selections: [scenario.selection], colors: [] },
      signer: SIGNER,
      productRuntime: {
        choices: {
          async load(input) {
            liveLoads += 1;
            assert.deepEqual(input, { address: SIGNER, rootId: ROOT });
            return {
              ...structuredClone(player.contextualChoices),
              // Exact evidence with a different insertion order must canonical-dedupe.
              certifiedAssets: [{
                sha256: asset.sha256,
                byteLength: asset.byteLength,
                mediaType: asset.mediaType,
                blobId: asset.blobId,
                assetId: asset.assetId,
              }],
            };
          },
        },
        assets: {
          async load(pointer) {
            assetLoads += 1;
            assert.deepEqual(pointer, asset);
            return { ...pointer, bytesBase64: RENDER_BYTES };
          },
        },
      },
      canvasFactory() {
        return {
          width: 0,
          height: 0,
          getContext() {
            return {
              clearRect() {}, save() {}, restore() {}, translate() {}, rotate() {}, scale() {},
              drawImage(source) { drawn.push(source.label); },
            };
          },
          async convertToBlob() {
            return new Blob([Uint8Array.from([9, 8, 7])], { type: 'image/png' });
          },
        };
      },
      async decodeImage() {
        return { source: { label: `${scenario.label.toLowerCase()}-image`, width: 1, height: 1 }, close() {} };
      },
    });
    assert.equal(liveLoads, 1);
    assert.equal(assetLoads > 0, true);
    assert.equal(result.mediaType, 'image/png');
    assert.equal(result.bytesBase64, 'CQgH');
    assert.deepEqual(drawn, [`${scenario.label.toLowerCase()}-image`]);
  }
});

test('duplicate bridge and live asset evidence rejects every descriptor drift before asset loading', async () => {
  const selection = {
    ...BASE_SELECTION,
    source: 'PACK',
    itemKey: 'pack-hat',
    styleKey: 'moon',
    releaseId: id(58),
    semanticPackId: 'moon-pack',
  };
  const asset = {
    assetId: 'bridge-pack-asset',
    blobId: 'bridge-pack-blob',
    mediaType: 'image/png',
    byteLength: 4,
    sha256: RENDER_HASH,
  };
  const drifts = [
    ['blobId', (value) => { value.blobId = 'different-blob'; }, 'MAKER_V8_PLAYER_JOURNEY_RENDER_ASSET_COLLISION'],
    ['mediaType', (value) => { value.mediaType = 'image/webp'; }, 'MAKER_V8_PLAYER_JOURNEY_RENDER_ASSET_COLLISION'],
    ['byteLength', (value) => { value.byteLength = 5; }, 'MAKER_V8_PLAYER_JOURNEY_RENDER_ASSET_COLLISION'],
    ['sha256', (value) => { value.sha256 = 'b'.repeat(64); }, 'MAKER_V8_PLAYER_JOURNEY_RENDER_ASSET_COLLISION'],
    ['bytesBase64', (value) => { value.bytesBase64 = RENDER_BYTES; }, 'MAKER_V8_PLAYER_JOURNEY_RENDER_ASSET_INVALID'],
    ['provenance', (value) => { value.provenance = { blobRef: asset.blobId }; }, 'MAKER_V8_PLAYER_JOURNEY_RENDER_ASSET_INVALID'],
  ];
  for (const [field, mutate, expectedCode] of drifts) {
    const player = playerFixture();
    player.certifiedAssets.push(structuredClone(asset));
    const liveAsset = structuredClone(asset);
    mutate(liveAsset);
    let liveLoads = 0;
    let assetLoads = 0;
    await assert.rejects(
      renderMakerV8PlayerRecipePngV8({
        player,
        recipe: { rootId: ROOT, selections: [selection], colors: [] },
        signer: SIGNER,
        productRuntime: {
          choices: {
            async load(input) {
              liveLoads += 1;
              assert.deepEqual(input, { address: SIGNER, rootId: ROOT });
              return choicesFixture({
                packStyles: [{ ...selection, assetId: asset.assetId, protected: false }],
                certifiedAssets: [liveAsset],
              });
            },
          },
          assets: {
            async load() {
              assetLoads += 1;
              throw new Error(`${field} drift must fail before asset loading`);
            },
          },
        },
        canvasFactory() { throw new Error(`${field} drift must fail before canvas`); },
      }),
      (error) => error.code === expectedCode
        && (expectedCode !== 'MAKER_V8_PLAYER_JOURNEY_RENDER_ASSET_COLLISION'
          || error.details.assetId === asset.assetId),
    );
    assert.equal(liveLoads, 1, field);
    assert.equal(assetLoads, 0, field);
  }
});

test('completion never acquires or signs when the contextual ownership inventory is incomplete', async () => {
  const { calls, snapshot, project } = harness();
  const exactSnapshot = snapshot();
  const unsafe = createMakerV8PlayerJourneyV8({
    nativeContent: { async preflight() {}, async loadCompletion() { return null; }, async saveCompletion() {}, async clearCompletion() {}, async prepare() { throw new Error('not reached'); }, async finalize() { throw new Error('not reached'); } },
    player: {
      getSnapshot() { return structuredClone(exactSnapshot); },
      async quotePlayerCompletion() { return { rootId: ROOT, signer: SIGNER,
        recipeCommitment: exactSnapshot.loadout.recipeCommitment,
        completePaymentQuote: {}, entryPaymentQuote: {} }; },
      async loadPlayer() { throw new Error('not reached'); },
      async setRecipe() {},
      async preparePlayerAction() { calls.push('prepare'); throw new Error('not reached'); },
      async executePlayerAction() { throw new Error('not reached'); },
      async recoverPlayerAction() { throw new Error('not reached'); },
    },
    productRuntime: {
      inventory: { async load() { return { status: 'ERROR', items: [], diagnostics: [{ code: 'READ_FAILED' }] }; } },
      choices: { async load() { throw new Error('not reached'); } },
      assets: { async load() { throw new Error('not reached'); } },
    },
    walrus: {
      publisher: {
        async prepare() {}, async requestSignature() {}, async resume() {}, async load() {},
      },
      persistence: { async load() {} },
    },
    render: async () => ({
      schemaVersion: 'animacraft.maker-v8-player-render.v1', mediaType: 'image/png',
      width: 8, height: 8, bytesBase64: RENDER_BYTES, byteLength: 4, sha256: RENDER_HASH,
    }),
  });
  await assert.rejects(
    unsafe.complete({ rootId: ROOT, signer: SIGNER, selections: [BASE_SELECTION], project: project() },
      { confirmStep: async () => true }),
    (error) => error.code === 'MAKER_V8_PLAYER_JOURNEY_INVENTORY_INCOMPLETE'
      && error.layer === 'INVENTORY',
  );
  assert.deepEqual(calls, []);
});

test('native content dependency and deployment preflight fail before acquisition or storage costs', async () => {
  for (const provider of [null, {
    async preflight() { throw Object.assign(new Error('Wrong native deployment'), { code: 'WRONG_NATIVE_DEPLOYMENT' }); },
    async loadCompletion() { return null; }, async saveCompletion() {}, async clearCompletion() {},
    async prepare() { throw new Error('not reached'); }, async finalize() { throw new Error('not reached'); },
  }]) {
    const h = harness({ nativeContentOverride: provider });
    await assert.rejects(h.journey.complete({ rootId: ROOT, signer: SIGNER,
      selections: [BASE_SELECTION], project: h.project() }), {
      code: provider === null ? 'MAKER_V8_PLAYER_NATIVE_CONTENT_REQUIRED' : 'WRONG_NATIVE_DEPLOYMENT',
    });
    assert.deepEqual(h.calls, []);
    assert.equal(h.inventoryLoads(), 0);
  }
});

test('Soul text/profile mutation during an asynchronous completion stops before the next signature', async () => {
  let submitted;
  const h = harness({ onActionPrepared: () => { submitted.profile.name = 'Changed after submission'; } });
  submitted = h.project();
  await assert.rejects(h.journey.complete({ rootId: ROOT, signer: SIGNER,
    selections: [BASE_SELECTION], project: submitted }), { code: 'MAKER_V8_PLAYER_JOURNEY_VISIBLE_INTENT_DRIFT' });
  assert.equal(h.calls.some(call => typeof call === 'string' && call.startsWith('execute:')), false);
  assert.equal(h.calls.some(call => typeof call === 'object' && call.upload), false);
});

test('post-mint envelope confirmation can be declined and cold recovery confirms only the same Soul', async () => {
  const nativeJournal = { completion: null, actions: new Map() };
  let envelopesSigned = 0;
  const onNativeFinalize = async ({ action, assertBeforeSignature }) => {
    const fields = action.certificate.evidence.certifiedEvent.fields;
    await assertBeforeSignature({ kind: 'NATIVE_ENVELOPES', soulId: fields.soul_id,
      stateId: fields.soul_state_id, transactionDigest: '8'.repeat(43), gasBudgetMist: '1000000', envelopeCount: 3 });
    envelopesSigned++;
  };
  const first = harness({ nativeJournal, onNativeFinalize });
  await assert.rejects(first.journey.complete({ rootId: ROOT, signer: SIGNER,
    selections: [BASE_SELECTION], project: first.project() }, { confirmStep: async step => step.kind !== 'NATIVE_ENVELOPES' }),
  { code: 'MAKER_V8_PLAYER_JOURNEY_CONFIRMATION_CANCELLED' });
  assert.equal(envelopesSigned, 0);
  assert.equal(nativeJournal.completion.actionId, 'completeOutput-id');
  const cold = harness({ nativeJournal, onNativeFinalize }); const steps = [];
  const result = await cold.journey.complete({ rootId: ROOT, signer: SIGNER,
    selections: [BASE_SELECTION], project: cold.project() }, { confirmStep: async step => { steps.push(step); return true; } });
  assert.equal(result.status, 'HANDOFF_READY'); assert.equal(result.soulId, SOUL);
  assert.deepEqual(steps.map(step => step.kind), ['NATIVE_ENVELOPES']);
  assert.equal(envelopesSigned, 1);
  assert.equal(cold.calls.includes('prepare:completeOutput'), false);
});

test('pending encrypted content cannot mint; pending post-mint sidecars cannot announce handoff ready', async () => {
  const preparing = harness({ nativeContentStatus: 'RECOVERY_REQUIRED' });
  const pending = await preparing.journey.complete({ rootId: ROOT, signer: SIGNER,
    selections: [BASE_SELECTION], project: preparing.project() });
  assert.equal(pending.stage, 'NATIVE_CONTENT');
  assert.equal(preparing.calls.includes('prepare:completeOutput'), false);
  const syncing = harness({ nativeSyncStatus: 'RECOVERY_REQUIRED' });
  const sync = await syncing.journey.complete({ rootId: ROOT, signer: SIGNER,
    selections: [BASE_SELECTION], project: syncing.project() });
  assert.deepEqual(sync, { status: 'RECOVERY_REQUIRED', stage: 'NATIVE_CONTENT_SYNC',
    actionId: 'completeOutput-id', soulId: SOUL, transactionDigest: DIGEST,
    message: 'Soul mint is complete. Resume encrypted-content finalization; do not mint again.', reason: null });
  assert.equal(Object.hasOwn(sync, 'handoffUrl'), false);
});

test('post-mint recovery in a new journey queries the saved action without preparing new content or another mint', async () => {
  const nativeJournal = { completion: null, actions: new Map() };
  const first = harness({ nativeSyncStatus: 'RECOVERY_REQUIRED', nativeJournal });
  const pending = await first.journey.complete({ rootId: ROOT, signer: SIGNER,
    selections: [BASE_SELECTION], project: first.project() });
  assert.equal(pending.stage, 'NATIVE_CONTENT_SYNC');
  assert.equal(nativeJournal.completion.actionId, 'completeOutput-id');
  // A newly constructed journey models refresh. Even if its preparation path
  // is now unavailable, it must resume sidecars for the already minted Soul.
  const second = harness({ nativeContentStatus: 'RECOVERY_REQUIRED', nativeJournal });
  const recovered = await second.journey.complete({ rootId: ROOT, signer: SIGNER,
    selections: [BASE_SELECTION], project: second.project() });
  assert.equal(recovered.status, 'HANDOFF_READY');
  assert.equal(recovered.soulId, SOUL);
  assert.deepEqual(second.calls, ['recover:completeOutput-id']);
  assert.equal(second.inventoryLoads(), 0);
  assert.equal(nativeJournal.completion.actionId, 'completeOutput-id');
});

test('finalized Soul recovery survives a paused Maker and unavailable new-issuance preflight', async () => {
  const nativeJournal = { completion: null, actions: new Map() };
  const first = harness({ nativeSyncStatus: 'RECOVERY_REQUIRED', nativeJournal });
  await first.journey.complete({ rootId: ROOT, signer: SIGNER,
    selections: [BASE_SELECTION], project: first.project() });
  for (const activePlayerUnavailable of [true, false]) {
    const journal = structuredClone(nativeJournal);
    const second = harness({ nativeJournal: journal, activePlayerUnavailable,
      onNativePreflight() { assert.fail('New issuance must not gate finalized recovery'); } });
    const result = await second.journey.complete({ rootId: ROOT, signer: SIGNER,
      selections: [], project: {} }); // Recovery uses the saved project, not today's draft.
    assert.equal(result.status, 'HANDOFF_READY');
    assert.equal(result.soulId, SOUL);
    assert.deepEqual(second.calls, ['recover:completeOutput-id']);
    assert.equal(second.inventoryLoads(), 0);
    assert.equal(journal.completion.actionId, 'completeOutput-id');
  }
});

test('unsigned completion recovery still checks current new-issuance preflight before signing', async () => {
  const nativeJournal = { completion: null, actions: new Map() };
  const h = harness({ nativeJournal,
    onNativePreflight() { throw Object.assign(new Error('Mint paused'), { code: 'MINT_PAUSED' }); } });
  nativeJournal.completion = { rootId: ROOT, signer: SIGNER, actionId: 'completeOutput-id', project: h.project() };
  nativeJournal.actions.set('completeOutput-id', { actionId: 'completeOutput-id', status: 'PREPARED' });
  await assert.rejects(h.journey.complete({ rootId: ROOT, signer: SIGNER,
    selections: [BASE_SELECTION], project: h.project() }), { code: 'MINT_PAUSED' });
  assert.deepEqual(h.calls, ['recover:completeOutput-id']);
  assert.equal(nativeJournal.completion.actionId, 'completeOutput-id');
});

test('native recovery resumes the same unsigned action, retires terminal failures, and preserves uncertain outcomes', async () => {
  for (const status of ['PREPARED', 'FINALIZED_FAILURE', 'EXPIRED_NOT_FOUND', 'OUTCOME_UNKNOWN']) {
    const nativeJournal = { completion: null, actions: new Map() };
    const h = harness({ nativeJournal });
    nativeJournal.completion = { rootId: ROOT, signer: SIGNER, actionId: 'completeOutput-id', project: h.project() };
    nativeJournal.actions.set('completeOutput-id', { actionId: 'completeOutput-id', status });
    const run = () => h.journey.complete({ rootId: ROOT, signer: SIGNER, selections: [BASE_SELECTION], project: h.project() });
    if (['FINALIZED_FAILURE', 'EXPIRED_NOT_FOUND'].includes(status)) {
      await assert.rejects(run(), { code: 'MAKER_V8_PLAYER_JOURNEY_ACTION_FAILED' });
      assert.equal(nativeJournal.completion, null);
      assert.equal(nativeJournal.actions.has('completeOutput-id'), true);
    } else {
      const result = await run();
      assert.equal(result.status, status === 'PREPARED' ? 'HANDOFF_READY' : 'RECOVERY_REQUIRED');
      assert.equal(nativeJournal.completion.actionId, 'completeOutput-id');
    }
    assert.deepEqual(h.calls, status === 'PREPARED'
      ? ['recover:completeOutput-id', 'execute:completeOutput-id'] : ['recover:completeOutput-id']);
    assert.equal(h.inventoryLoads(), 0);
  }
});

test('completion re-renders the exact selected export and preserves it through finalized recovery', async (t) => {
  // Identical deterministic PNG vectors are decoded by Soulidity's raw artwork
  // reader tests: selected dimensions and alpha must survive the whole boundary.
  const pngVector = ({ width, height }, alpha) => {
    const chunk = (name, bytes) => {
      const type = Buffer.from(name), size = Buffer.alloc(4), checksum = Buffer.alloc(4);
      size.writeUInt32BE(bytes.length); checksum.writeUInt32BE(crc32(Buffer.concat([type, bytes])));
      return Buffer.concat([size, type, bytes, checksum]);
    };
    const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
    const pixels = Buffer.alloc(height * (1 + width * 4));
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels.set([23, 45, 67, alpha], y * (1 + width * 4) + 1 + x * 4);
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
      chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
  };
  for (const sizeMode of ['standard', 'original']) for (const transparent of [false, true]) {
    await t.test(`${sizeMode}/${transparent}`, async () => {
      const playerData = playerFixture();
      playerData.document.canvas = { ...playerData.document.canvas, width: 1080, height: 1920 };
      const nativeJournal = { completion: null, actions: new Map() };
      const dimensions = sizeMode === 'standard' ? { width: 576, height: 1024 } : { width: 1080, height: 1920 };
      const settings = { sizeMode, transparent };
      const png = pngVector(dimensions, transparent ? 0 : 255);
      const bytesBase64 = toBase64(png);
      const imageHash = Buffer.from(sha256(png)).toString('hex');
      let renders = 0;
      const current = harness({ playerData, nativeJournal, renderOverride: async input => {
        renders += 1;
        assert.deepEqual(input.exportOptions, settings);
        assert.equal(Object.isFrozen(input.exportOptions), true);
        assert.deepEqual(input.recipe, project.recipe);
        return { schemaVersion: 'animacraft.maker-v8-player-render.v1', mediaType: 'image/png',
          ...dimensions, bytesBase64, byteLength: png.length, sha256: imageHash };
      } });
      const project = current.project();
      project.imageExport = settings;
      Object.assign(project.render, dimensions, { byteLength: png.length, sha256: imageHash });
      const first = await current.journey.complete({ rootId: ROOT, signer: SIGNER, selections: [BASE_SELECTION], project });
      assert.equal(first.status, 'HANDOFF_READY');
      assert.equal(renders, 1);
      assert.deepEqual(nativeJournal.completion.project.imageExport, settings);
      assert.deepEqual(nativeJournal.completion.project.render, project.render);
      assert.equal(current.calls.find(call => call?.upload)?.upload.bytesBase64, bytesBase64,
        'storage receives exactly the selected PNG, not a main-preview substitute');
      const completionRender = current.calls.find(call => call?.action === 'completeOutput').input.render;
      assert.equal(completionRender.sha256, imageHash, 'CompleteOutput receives the exact uploaded PNG hash');
      assert.equal(completionRender.blobId, 'blob-render');
      const cold = harness({ nativeJournal, activePlayerUnavailable: true, renderOverride: () => assert.fail('Recovery must not re-render another image') });
      const recovered = await cold.journey.complete({ rootId: ROOT, signer: SIGNER, selections: [BASE_SELECTION], project });
      assert.equal(recovered.completedProjectHash, first.completedProjectHash);
      assert.equal(recovered.soulId, first.soulId);
      assert.deepEqual(cold.calls, ['recover:completeOutput-id']);
    });
  }
});

test('selected export validation and re-render drift fail before acquisition or upload', async () => {
  for (const change of [
    p => { delete p.imageExport; },
    p => { p.imageExport = { sizeMode: 'standard' }; },
    p => { p.imageExport.transparent = 'true'; },
    p => { p.imageExport.extra = true; },
    p => { p.render.width += 1; },
    p => { p.render.sha256 = 'a'.repeat(64); },
    p => { p.render.byteLength = 12 * 1024 * 1024 + 1; },
  ]) {
    const h = harness(); const project = h.project(); change(project);
    await assert.rejects(h.journey.complete({ rootId: ROOT, signer: SIGNER, selections: [BASE_SELECTION], project }));
    assert.equal(h.inventoryLoads(), 0);
    assert.equal(h.calls.some(call => typeof call === 'string' && call.startsWith('prepare:')), false);
    assert.equal(h.calls.some(call => call?.upload), false);
  }
  let entered = false;
  const h = harness({ renderOverride: () => { entered = true; throw new Error('exact byte boundary accepted'); } });
  const project = h.project(); project.render.byteLength = 12 * 1024 * 1024;
  await assert.rejects(h.journey.complete({ rootId: ROOT, signer: SIGNER, selections: [BASE_SELECTION], project }), /exact byte boundary accepted/);
  assert.equal(entered, true);
  assert.equal(h.inventoryLoads(), 0);
});

test('completion rejects ordered Recipe, Colors, Output, Loadout, and render evidence drift before inventory or signing', async () => {
  const second = {
    ...BASE_SELECTION,
    itemKey: 'second',
    styleKey: 'second',
  };
  const playerData = playerFixture();
  playerData.document.parts[0].capacity = 2;
  playerData.document.parts[0].items.push({
    key: 'second',
    status: 'PUBLIC',
    styles: [{
      key: 'second',
      trackKey: 'base-track',
      colorChannelKey: null,
      defaultSwatchKey: null,
    }],
  });
  for (const mutate of [
    (request) => { request.selections.reverse(); },
    (request) => { request.project.recipe.colors = [{ channelKey: 'hair', swatchKey: 'mint' }]; },
    (request) => { request.project.recipe.outputKey = 'forged-output'; },
    (request) => { request.project.loadout.recipeCommitment = 'b'.repeat(64); },
    (request) => { request.project.render.sha256 = 'b'.repeat(64); },
  ]) {
    const current = harness({
      playerData: structuredClone(playerData),
      selections: [BASE_SELECTION, second],
    });
    const request = {
      rootId: ROOT,
      signer: SIGNER,
      selections: [structuredClone(BASE_SELECTION), structuredClone(second)],
      project: current.project(),
    };
    mutate(request);
    await assert.rejects(
      current.journey.complete(request),
      (error) => [
        'MAKER_V8_PLAYER_JOURNEY_VISIBLE_INTENT_DRIFT',
        'MAKER_V8_PLAYER_JOURNEY_RENDER_INTENT_DRIFT',
      ].includes(error.code),
    );
    assert.equal(current.inventoryLoads(), 0);
    assert.equal(current.calls.some((entry) => String(entry).startsWith('prepare:')), false);
  }
});

test('completion intent preserves an unused attachment before a selected Pack-owned Part', async () => {
  const playerData = playerFixture();
  const selected = { ...BASE_SELECTION, source: 'PACK', partKey: 'plume', releaseId: id(71), semanticPackId: 'own' };
  const part = { key: 'plume', capacity: 1, menuOrder: 1, required: false, items: [] };
  const commitment = 'ab'.repeat(32);
  playerData.contextualChoices = choicesFixture({ packStyles: [{ ...selected, definitionCommitment: commitment,
    definitionScope: { part: { source: 'PACK', sourceId: id(71), key: 'plume' },
      track: { source: 'BASE', sourceId: ROOT, key: 'base-track' }, color: null } }] });
  playerData.definitionContext = { rootId: ROOT, address: SIGNER, packs: [{ releaseId: id(71), semanticPackId: 'own',
    definitionCommitment: commitment, ownedParts: [part], rules: [], document: { parts: [part] },
    styleReferences: [{ part: { scope: 'PACK_SELF', key: 'plume' }, itemKey: selected.itemKey, styleKey: selected.styleKey }] }],
    currentLoadout: { layout: {
      bindings: [{ releaseId: id(70), definitionCommitment: commitment }],
      profiles: [{ releaseId: id(70), partKey: 'unused', capacity: '2', profileCommitment: commitment }],
    } } };
  const h = harness({ playerData, selections: [BASE_SELECTION, selected],
    onNativePreflight: () => { throw new Error('scoped intent accepted before inventory'); } });
  h.mutateLoadout(loadout => { loadout.selections[1].selectionIndex = 3; });
  await assert.rejects(h.journey.complete({ rootId: ROOT, signer: SIGNER, selections: [BASE_SELECTION, selected], project: h.project() }),
    /scoped intent accepted before inventory/);
  h.mutateLoadout(loadout => { loadout.selections[1].selectionIndex = 1; });
  await assert.rejects(h.journey.complete({ rootId: ROOT, signer: SIGNER, selections: [BASE_SELECTION, selected], project: h.project() }),
    { code: 'MAKER_V8_PLAYER_JOURNEY_VISIBLE_INTENT_DRIFT' });
  assert.equal(h.inventoryLoads(), 0);
  assert.equal(h.calls.some(row => String(row).startsWith('prepare:')), false);
});

test('completion independently rebuilds the canonical Loadout before inventory or any signature', async () => {
  const unusedRelease = id(70);
  for (const forge of [
    (loadout) => { loadout.selections[0].selectionIndex = 99; },
    (loadout) => { loadout.selections[0].swatchKey = 'forged-swatch'; },
    (loadout) => {
      loadout.usedPacks.push({ releaseId: unusedRelease, semanticPackId: 'unused-pack' });
    },
  ]) {
    const current = harness();
    const project = current.project();
    forge(project.loadout);
    current.mutateLoadout(forge);
    await assert.rejects(
      current.journey.complete({
        rootId: ROOT,
        signer: SIGNER,
        selections: [BASE_SELECTION],
        project,
      }),
      { code: 'MAKER_V8_PLAYER_JOURNEY_VISIBLE_INTENT_DRIFT' },
    );
    assert.equal(current.inventoryLoads(), 0);
    assert.equal(current.calls.some((entry) => (
      typeof entry === 'string'
      && (entry.startsWith('prepare:') || entry.startsWith('execute:') || entry.includes('requestSignature'))
    )), false);
  }
});

test('completion rechecks the exact visible intent after inventory before the first signature', async () => {
  let inventoryStarted;
  let releaseInventory;
  const started = new Promise((resolve) => { inventoryStarted = resolve; });
  const current = harness({
    inventoryLoader: async () => {
      inventoryStarted();
      await new Promise((resolve) => { releaseInventory = resolve; });
      return { status: 'EMPTY', items: [] };
    },
  });
  const pending = current.journey.complete({
    rootId: ROOT,
    signer: SIGNER,
    selections: [BASE_SELECTION],
    project: current.project(),
  });
  await started;
  current.mutateRecipe({ outputKey: 'changed-while-loading-inventory' });
  releaseInventory();
  await assert.rejects(pending, {
    code: 'MAKER_V8_PLAYER_JOURNEY_VISIBLE_INTENT_DRIFT',
  });
  assert.equal(current.calls.some((entry) => String(entry).startsWith('prepare:')), false);
});

test('completion rechecks visible intent after action preparation and before Walrus signature', async () => {
  let mutateAfterPrepare;
  const actionCurrent = harness({
    onActionPrepared(action) {
      if (action === 'acquireMakerAccess') mutateAfterPrepare({ outputKey: 'action-drift' });
    },
  });
  mutateAfterPrepare = actionCurrent.mutateRecipe;
  await assert.rejects(actionCurrent.journey.complete({
    rootId: ROOT,
    signer: SIGNER,
    selections: [BASE_SELECTION],
    project: actionCurrent.project(),
  }), { code: 'MAKER_V8_PLAYER_JOURNEY_VISIBLE_INTENT_DRIFT' });
  assert.equal(actionCurrent.calls.some((entry) => entry === 'execute:acquireMakerAccess-id'), false);

  let mutateAfterUploadPrepare;
  const uploadCurrent = harness({
    inventory: [{ kind: 'MAKER_ACCESS', rootId: ROOT }],
    uploadStatus: 'SIGNATURE_REQUIRED',
    onUploadPrepared() { mutateAfterUploadPrepare({ outputKey: 'upload-drift' }); },
  });
  mutateAfterUploadPrepare = uploadCurrent.mutateRecipe;
  await assert.rejects(uploadCurrent.journey.complete({
    rootId: ROOT,
    signer: SIGNER,
    selections: [BASE_SELECTION],
    project: uploadCurrent.project(),
  }), { code: 'MAKER_V8_PLAYER_JOURNEY_VISIBLE_INTENT_DRIFT' });
  assert.equal(uploadCurrent.calls.includes('upload:requestSignature'), false);
});

test('renderer rejects partial Pack/External authority and unknown sources before loading artwork', async () => {
  const releaseId = id(61);
  const productId = id(62);
  const ownedId = id(63);
  const pack = {
    ...BASE_SELECTION,
    source: 'PACK',
    releaseId,
    semanticPackId: 'moon-pack',
  };
  const external = {
    ...BASE_SELECTION,
    source: 'EXTERNAL',
    externalProductId: productId,
    ownedExternalItemId: ownedId,
  };
  const runtime = (choices) => ({
    assets: { async load() { throw new Error('artwork must not load'); } },
    choices: { async load() { return choicesFixture(choices); } },
  });
  await assert.rejects(
    renderMakerV8PlayerRecipePngV8({
      player: playerFixture(),
      recipe: { rootId: ROOT, selections: [{ ...pack, semanticPackId: 'forged-pack' }], colors: [] },
      signer: SIGNER,
      productRuntime: runtime({
        packStyles: [{ ...pack, assetId: 'pack-asset' }], externalStyles: [],
        certifiedAssets: [{ assetId: 'pack-asset', blobId: 'pack-blob', mediaType: 'image/png', byteLength: 4, sha256: RENDER_HASH }],
      }),
      canvasFactory() { throw new Error('canvas must not open'); },
    }),
    { code: 'MAKER_V8_PLAYER_JOURNEY_PACK_STYLE_INVALID' },
  );
  const missingPackField = { ...pack, assetId: 'pack-asset' };
  delete missingPackField.defaultSwatchKey;
  await assert.rejects(
    renderMakerV8PlayerRecipePngV8({
      player: playerFixture(),
      recipe: { rootId: ROOT, selections: [pack], colors: [] },
      signer: SIGNER,
      productRuntime: runtime({
        packStyles: [missingPackField], externalStyles: [],
        certifiedAssets: [{ assetId: 'pack-asset', blobId: 'pack-blob', mediaType: 'image/png', byteLength: 4, sha256: RENDER_HASH }],
      }),
      canvasFactory() { throw new Error('canvas must not open'); },
    }),
    { code: 'MAKER_V8_PLAYER_JOURNEY_PACK_STYLE_INVALID' },
  );
  await assert.rejects(
    renderMakerV8PlayerRecipePngV8({
      player: playerFixture(),
      recipe: { rootId: ROOT, selections: [{ ...external, trackKey: 'forged-track' }], colors: [] },
      signer: SIGNER,
      productRuntime: runtime({
        packStyles: [], externalStyles: [{ ...external, assetId: 'external-asset' }],
        certifiedAssets: [{ assetId: 'external-asset', blobId: 'external-blob', mediaType: 'image/png', byteLength: 4, sha256: RENDER_HASH }],
      }),
      canvasFactory() { throw new Error('canvas must not open'); },
    }),
    { code: 'MAKER_V8_EXTERNAL_ASSET_RENDER_METADATA_UNAVAILABLE' },
  );
  await assert.rejects(
    renderMakerV8PlayerRecipePngV8({
      player: playerFixture(),
      recipe: { rootId: ROOT, selections: [{ ...BASE_SELECTION, source: 'UNKNOWN' }], colors: [] },
      signer: SIGNER,
      productRuntime: runtime({ packStyles: [], externalStyles: [], certifiedAssets: [] }),
      canvasFactory() { throw new Error('canvas must not open'); },
    }),
    { code: 'MAKER_V8_PLAYER_JOURNEY_SELECTION_AUTHORITY_INVALID' },
  );
});

test('renderer rejects unavailable contextual components before loading or drawing assets', async () => {
  for (const access of [undefined, { accessible: false, canEquip: true, reason: 'Admission revoked.' },
    { accessible: true, canEquip: false, reason: 'Instance already occupied.' }]) {
    const external = { ...BASE_SELECTION, source: 'EXTERNAL', itemKey: 'external-hat',
      styleKey: 'violet', externalProductId: id(20), ownedExternalItemId: id(21) };
    let assetReads = 0;
    await assert.rejects(renderMakerV8PlayerRecipePngV8({
      player: playerFixture(), recipe: { rootId: ROOT, selections: [external] }, signer: SIGNER,
      productRuntime: {
        assets: { async load() { assetReads += 1; throw new Error('must not load'); } },
        choices: { async load() { return choicesFixture({
          externalStyles: [{ ...external, assetId: 'external-render', access }],
          certifiedAssets: [{ assetId: 'external-render', blobId: 'external-blob',
            mediaType: 'image/png', byteLength: 4, sha256: RENDER_HASH }],
        }); } },
      },
      canvasFactory() { throw new Error('must not draw'); },
    }), { code: 'MAKER_V8_PLAYER_JOURNEY_COMPONENT_UNAVAILABLE' });
    assert.equal(assetReads, 0);
  }
});

test('renderer draws one certified external composable from the contextual Player choice', async () => {
  const external = {
    ...BASE_SELECTION,
    source: 'EXTERNAL',
    itemKey: 'external-hat',
    styleKey: 'violet',
    externalProductId: id(20),
    ownedExternalItemId: id(21),
  };
  const operations = [];
  const context = {
    save() { operations.push('save'); },
    restore() { operations.push('restore'); },
    clearRect() {},
    translate() {},
    rotate() {},
    scale() {},
    drawImage(source) { operations.push(`draw:${source.label}`); },
  };
  const result = await renderMakerV8PlayerRecipePngV8({
    player: playerFixture(),
    recipe: { rootId: ROOT, selections: [external] },
    signer: SIGNER,
    productRuntime: {
      assets: {
        async load() {
          return {
            assetId: 'external-render', blobId: 'external-blob', mediaType: 'image/png', byteLength: 4,
            sha256: RENDER_HASH, bytesBase64: 'AQIDBA==',
          };
        },
      },
      choices: {
        async load() {
          return choicesFixture({
            externalStyles: [{ ...external, assetId: 'external-render' }],
            certifiedAssets: [{
              assetId: 'external-render', blobId: 'external-blob', mediaType: 'image/png',
              byteLength: 4, sha256: RENDER_HASH,
            }],
          });
        },
      },
    },
    canvasFactory() {
      return {
        width: 0,
        height: 0,
        getContext() { return context; },
        async convertToBlob() { return new Blob([Uint8Array.from([9, 8, 7])], { type: 'image/png' }); },
      };
    },
    async decodeImage() { return { source: { label: 'external-image', width: 1, height: 1 }, close() { operations.push('close'); } }; },
  });
  assert.equal(result.mediaType, 'image/png');
  assert.equal(result.byteLength, 3);
  assert.deepEqual(operations, ['save', 'draw:external-image', 'restore', 'close']);
});

test('Smart Color deterministically gradient-maps exact RGBA pixels without mutating source bytes', () => {
  const source = new Uint8ClampedArray([
    0, 0, 0, 255,
    128, 128, 128, 255,
    255, 255, 255, 128,
  ]);
  const result = mapMakerV8SmartColorPixelsV8({ width: 3, height: 1, data: source }, {
    key: 'violet',
    label: 'Violet',
    rgba: '#7b5cffff',
    stops: [
      { offset: 0, rgba: '#ff0000ff' },
      { offset: 1, rgba: '#0000ffff' },
    ],
  });
  assert.deepEqual([...source], [
    0, 0, 0, 255,
    128, 128, 128, 255,
    255, 255, 255, 128,
  ]);
  assert.deepEqual([...result.data], [
    255, 0, 0, 255,
    127, 0, 128, 255,
    0, 0, 255, 128,
  ]);
});

test('final PNG renderer uses the recipe swatch instead of silently drawing the default asset color', async () => {
  const selected = {
    ...BASE_SELECTION,
    colorChannelKey: 'hair-color',
    defaultSwatchKey: 'violet',
  };
  const player = playerFixture();
  player.document.colors = [{
    key: 'hair-color',
    label: 'Hair',
    defaultSwatchKey: 'violet',
    swatches: [
      { key: 'violet', label: 'Violet', rgba: '#7b5cffff', stops: [] },
      { key: 'mint', label: 'Mint', rgba: '#2db7a3ff', stops: [] },
    ],
  }];
  player.document.parts[0].items[0].styles[0].colorChannelKey = 'hair-color';
  player.document.parts[0].items[0].styles[0].defaultSwatchKey = 'violet';
  const drawn = [];
  const applied = [];
  const context = {
    clearRect() {}, save() {}, restore() {}, translate() {}, rotate() {}, scale() {},
    drawImage(source) { drawn.push(source.label); },
  };
  await renderMakerV8PlayerRecipePngV8({
    player,
    recipe: {
      rootId: ROOT,
      selections: [selected],
      colors: [{ channelKey: 'hair-color', swatchKey: 'mint' }],
    },
    signer: SIGNER,
    productRuntime: {
      assets: {
        async load() {
          return {
            assetId: 'base-default', blobId: 'blob-base', mediaType: 'image/png', byteLength: 4,
            sha256: RENDER_HASH, bytesBase64: 'AQIDBA==',
          };
        },
      },
      choices: { async load() { return choicesFixture(); } },
    },
    canvasFactory() {
      return {
        width: 0,
        height: 0,
        getContext() { return context; },
        async convertToBlob() { return new Blob([Uint8Array.from([1])], { type: 'image/png' }); },
      };
    },
    async decodeImage() { return { source: { label: 'base-image', width: 1, height: 1 }, close() {} }; },
    async colorizeImage({ source, swatch }) {
      applied.push({ source: source.label, swatchKey: swatch.key });
      return { source: { label: 'mint-image', width: 1, height: 1 }, close() {} };
    },
  });
  assert.deepEqual(applied, [{ source: 'base-image', swatchKey: 'mint' }]);
  assert.deepEqual(drawn, ['mint-image']);
});

test('Player Pack renderer uses authenticated authored placement and appearance', async () => {
  const selection = { ...BASE_SELECTION, source: 'PACK', releaseId: id(58), semanticPackId: 'moon-pack' };
  const player = playerFixture();
  const calls = [];
  let assetLoads = 0;
  const render = { transform: { x: 12.5, y: -8, scale: 0.5, rotation: 15 },
    opacity: 0.75, blendMode: 'multiply', displayOrder: 2, sourceAsset: null };
  let definitionScope = {
    part: { source: 'BASE', sourceId: ROOT, key: selection.partKey },
    track: { source: 'BASE', sourceId: ROOT, key: selection.trackKey }, color: null,
  };
  const context = { clearRect() {}, save() {}, restore() {},
    translate(...args) { calls.push(['translate', ...args]); }, scale(...args) { calls.push(['scale', ...args]); },
    rotate(value) { calls.push(['rotate', value]); }, drawImage() { calls.push(['draw', this.globalAlpha, this.globalCompositeOperation]); } };
  const input = { player,
    recipe: { rootId: ROOT, selections: [selection], colors: [] }, signer: SIGNER,
    productRuntime: { choices: { async load() { return choicesFixture({ packStyles: [{ ...selection,
      assetId: 'base-default', protected: false, render, definitionScope }] }); } },
      assets: { async load() { assetLoads++; return { ...player.certifiedAssets[0], bytesBase64: RENDER_BYTES }; } } },
    canvasFactory: () => ({ getContext: () => context,
      async convertToBlob() { return new Blob([new Uint8Array([1])], { type: 'image/png' }); } }),
    decodeImage: async () => ({ source: { width: 1, height: 1 }, close() {} }),
  };
  await renderMakerV8PlayerRecipePngV8(input);
  assert.ok(calls.some(row => row[0] === 'translate' && row[1] === 12.75 && row[2] === -7.75));
  assert.ok(calls.some(row => row[0] === 'scale' && row[1] === 0.5 && row[2] === 0.5));
  assert.ok(calls.some(row => row[0] === 'rotate' && Math.abs(row[1] - Math.PI / 12) < 1e-12));
  assert.ok(calls.some(row => row[0] === 'draw' && row[1] === 0.75 && row[2] === 'multiply'));
  render.visibleWhen = { op: 'selected', source: 'BASE', sourceKey: null,
    partKey: 'background', itemKey: null, styleKey: null };
  const before = structuredClone(input.recipe);
  calls.length = 0;
  await renderMakerV8PlayerRecipePngV8(input);
  assert.equal(assetLoads, 1, 'Hidden Pack Style does not fetch artwork');
  assert.equal(calls.some(row => row[0] === 'draw'), false);
  assert.deepEqual(input.recipe, before, 'Visibility never removes the selection from the recipe');
  const validScope = structuredClone(definitionScope);
  for (const change of [
    scope => { scope.part.sourceId = id(999); },
    scope => { scope.track.source = 'PACK'; scope.track.sourceId = selection.releaseId; },
    scope => { scope.track.key = 'other'; },
    scope => { scope.color = { source: 'BASE', sourceId: ROOT, key: 'foreign-color' }; },
  ]) {
    definitionScope = structuredClone(validScope); change(definitionScope);
    await assert.rejects(renderMakerV8PlayerRecipePngV8(input), {
      code: 'MAKER_V8_PLAYER_JOURNEY_PACK_DEFINITION_SCOPE_INVALID',
    });
  }
  definitionScope = undefined;
  await assert.rejects(renderMakerV8PlayerRecipePngV8(input), {
    code: 'MAKER_V8_PLAYER_JOURNEY_PACK_DEFINITION_SCOPE_INVALID',
  });
  assert.equal(assetLoads, 1, 'Invalid scopes reject even hidden Styles before artwork access');
  definitionScope = structuredClone(validScope);
  definitionScope.track = { source: 'PACK', sourceId: selection.releaseId, key: 'pack-overlay' };
  selection.trackKey = 'pack-overlay';
  render.visibleWhen = null;
  const definitionCommitment = 'ab'.repeat(32);
  const definitions = { rootId: ROOT, address: SIGNER, packs: [{ releaseId: selection.releaseId,
    semanticPackId: selection.semanticPackId, definitionCommitment,
    document: { tracks: [{ key: 'pack-overlay', renderOrder: 99 }] }, styleReferences: [{
      part: { scope: 'BASE', key: selection.partKey }, itemKey: selection.itemKey, styleKey: selection.styleKey,
      track: { scope: 'PACK_SELF', key: 'pack-overlay' },
    }] }] };
  input.productRuntime.playerContext = { async load() { return { definitions, choices: choicesFixture({
    packStyles: [{ ...selection, assetId: 'base-default', protected: false, render, definitionScope, definitionCommitment }],
  }) }; } };
  await renderMakerV8PlayerRecipePngV8(input);
  assert.equal(assetLoads, 2, 'Own Track renders from the live definition context');
  definitions.packs[0].releaseId = id(999);
  await assert.rejects(renderMakerV8PlayerRecipePngV8(input), { code: 'MAKER_V8_PLAYER_JOURNEY_PACK_DEFINITION_SCOPE_INVALID' });
  assert.equal(assetLoads, 2);
});

test('owned-Part PNG visibility and transparent export do not mix same-name Parts across Releases', async () => {
  const player = playerFixture(), commitment = 'ab'.repeat(32), packStyles = [], packs = [];
  for (const n of [72, 73]) {
    const ownedParts = ['plume', 'target'].map(key => ({ key, capacity: 1, menuOrder: 0,
      exportBackground: n === 73 && key === 'target', items: [] }));
    const refs = [];
    for (const partKey of ['plume', 'target']) {
      const selection = { ...BASE_SELECTION, source: 'PACK', releaseId: id(n), semanticPackId: `pack-${n}`, partKey };
      packStyles.push({ ...selection, assetId: `${n}-${partKey}`, definitionCommitment: commitment,
        definitionScope: { part: { source: 'PACK', sourceId: id(n), key: partKey },
          track: { source: 'BASE', sourceId: ROOT, key: selection.trackKey }, color: null }, protected: false,
        render: { transform: { x: 0, y: 0, scale: 1, rotation: 0 }, opacity: 1, blendMode: 'normal', displayOrder: 0,
          visibleWhen: partKey === 'plume' ? { op: 'selected', source: 'BASE', sourceKey: null, partKey: 'target', itemKey: null, styleKey: null } : null } });
      refs.push({ part: { scope: 'PACK_SELF', key: partKey }, itemKey: selection.itemKey, styleKey: selection.styleKey });
    }
    packs.push({ releaseId: id(n), semanticPackId: `pack-${n}`, definitionCommitment: commitment,
      ownedParts, document: { parts: structuredClone(ownedParts) }, styleReferences: refs });
  }
  const assets = packStyles.map(choice => ({ ...player.certifiedAssets[0], assetId: choice.assetId }));
  const choose = (n, partKey) => { const row = packStyles.find(row => row.releaseId === id(n) && row.partKey === partKey);
    return Object.fromEntries(Object.keys(BASE_SELECTION).map(key => [key, row[key]])); };
  const selections = [choose(72, 'plume'), choose(73, 'target')];
  const loaded = [];
  const input = { player, recipe: { rootId: ROOT, selections, colors: [] }, signer: SIGNER,
    productRuntime: { playerContext: { async load() { return {
      definitions: { rootId: ROOT, address: SIGNER, packs }, choices: choicesFixture({ packStyles, certifiedAssets: assets }),
    }; } }, assets: { async load(asset) { loaded.push(asset.assetId); return { ...asset, bytesBase64: RENDER_BYTES }; } } },
    canvasFactory: () => ({ getContext: () => ({ clearRect() {}, save() {}, restore() {}, translate() {}, rotate() {}, scale() {}, drawImage() {} }),
      async convertToBlob() { return new Blob([new Uint8Array([1])], { type: 'image/png' }); } }),
    decodeImage: async () => ({ source: { width: 1, height: 1 }, close() {} }),
  };
  await renderMakerV8PlayerRecipePngV8(input);
  assert.deepEqual(loaded, ['73-target'], 'Foreign target cannot reveal this Pack plume');
  selections.push(choose(72, 'target')); loaded.length = 0;
  await renderMakerV8PlayerRecipePngV8(input);
  assert.deepEqual([...loaded].sort(), ['72-plume', '72-target', '73-target']);
  loaded.length = 0;
  await renderMakerV8PlayerRecipePngV8({ ...input, exportOptions: { sizeMode: 'standard', transparent: true } });
  assert.deepEqual([...loaded].sort(), ['72-plume', '72-target'], 'Only the exact background Part is removed');
  assert.equal(selections.length, 3, 'Visibility/export never mutates the recipe');
  for (const pack of packs) {
    pack.document.colors = [{ key: 'primary', swatches: [
      { key: 'red', rgba: pack.releaseId === id(72) ? '#ff0000ff' : '#0000ffff', stops: [] },
      { key: 'green', rgba: '#00ff00ff', stops: [] },
    ] }];
    for (const ref of pack.styleReferences) ref.color = { scope: 'PACK_SELF', key: 'primary' };
  }
  for (const row of [...packStyles, ...selections]) { row.colorChannelKey = 'primary'; row.defaultSwatchKey = 'red'; }
  for (const row of packStyles) row.definitionScope.color = { source: 'PACK', sourceId: row.releaseId, key: 'primary' };
  player.document.colors = [{ key: 'primary', swatches: [{ key: 'red', rgba: '#ffffffff', stops: [] }] }];
  input.recipe.colors = [{ channelKey: 'primary', swatchKey: 'red' },
    { releaseId: id(72), channelKey: 'primary', swatchKey: 'green' }];
  const tinted = [];
  input.colorizeImage = async ({ source, swatch }) => { tinted.push(swatch.rgba); return { source, close() {} }; };
  await renderMakerV8PlayerRecipePngV8(input);
  assert.deepEqual(tinted, ['#00ff00ff', '#0000ffff', '#00ff00ff'],
    'Pack72 override, Pack73 own default and same-name Root preset remain independent');
  input.recipe.colors[1].releaseId = id(999); loaded.length = 0;
  await assert.rejects(renderMakerV8PlayerRecipePngV8(input), { code: 'MAKER_V8_PLAYER_JOURNEY_SMART_COLOR_RECIPE_INVALID' });
  assert.deepEqual(loaded, [], 'Unknown color namespace rejects before asset loading');
});

test('preview rendering rejects SHA drift and protected Base bytes without an exact Seal decryptor', async () => {
  const canvasFactory = () => ({
    width: 0,
    height: 0,
    getContext() {
      return {
        clearRect() {}, save() {}, restore() {}, translate() {}, rotate() {}, scale() {}, drawImage() {},
      };
    },
    async convertToBlob() { return new Blob([Uint8Array.from([1])], { type: 'image/png' }); },
  });
  const runtime = (bytesBase64 = RENDER_BYTES) => ({
    assets: {
      async load() {
        return {
          assetId: 'base-default', blobId: 'blob-base', mediaType: 'image/png', byteLength: 4,
          sha256: RENDER_HASH, bytesBase64,
        };
      },
    },
    choices: { async load() { return choicesFixture(); } },
  });
  await assert.rejects(
    renderMakerV8PlayerRecipePngV8({
      player: playerFixture(),
      recipe: { rootId: ROOT, selections: [structuredClone(BASE_SELECTION)], colors: [] },
      signer: SIGNER,
      productRuntime: runtime('AQIDBQ=='),
      canvasFactory,
      async decodeImage() { throw new Error('drift must fail before decode'); },
    }),
    { code: 'MAKER_V8_PLAYER_JOURNEY_RENDER_ASSET_DRIFT' },
  );

  const protectedPlayer = playerFixture();
  protectedPlayer.document.parts[0].items[0].styles[0].protected = true;
  protectedPlayer.document.parts[0].items[0].styles[0].payload = { animacraftSourceAsset: {
    sha256: protectedPlayer.certifiedAssets[0].sha256, mediaType: 'image/png',
    byteLength: protectedPlayer.certifiedAssets[0].byteLength,
  } };
  await assert.rejects(
    renderMakerV8PlayerRecipePngV8({
      player: protectedPlayer,
      recipe: { rootId: ROOT, selections: [structuredClone(BASE_SELECTION)], colors: [] },
      signer: SIGNER,
      productRuntime: runtime(),
      canvasFactory,
      async decodeImage() { throw new Error('protected bytes must fail before decode'); },
    }),
    (error) => error.code === 'MAKER_V8_PLAYER_PROTECTED_SELECTION_BLOCKED'
      && error.layer === 'BLOCKED_EXTERNAL_SECRET',
  );
  const renderProtected = bytesBase64 => renderMakerV8PlayerRecipePngV8({
    player: protectedPlayer,
    recipe: { rootId: ROOT, selections: [structuredClone(BASE_SELECTION)], colors: [] },
    signer: SIGNER, productRuntime: runtime(), canvasFactory,
    async decryptProtectedSelection({ selectionIndex }) { return { selectionIndex, bytesBase64, byteLength: 4 }; },
    async decodeImage(bytes, mediaType) {
      assert.equal(mediaType, 'image/png');
      assert.deepEqual([...bytes], [1, 2, 3, 4]);
      return { source: { width: 1, height: 1 }, close() {} };
    },
  });
  await assert.rejects(renderProtected('AQIDBQ=='), { code: 'MAKER_V8_PLAYER_PROTECTED_SOURCE_MISMATCH' });
  await renderProtected(RENDER_BYTES);
});
