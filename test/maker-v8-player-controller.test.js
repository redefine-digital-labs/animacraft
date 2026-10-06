import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { createMakerV8PlayerPersistenceV8 } from '../maker-v8-player-adapters.js';
import { nativeIntegrationFixture } from './fixtures/maker-v8-native-integration.js';
import { attestMakerV8Runtime } from '../maker-v8-chain.js';
import { makerV8PublicationExpiration } from '../maker-v8-publication-expiration.js';
import { createMakerV8CatalogAdapter } from '../maker-v8-catalog-adapter.js';
import { nativeInitialEvidenceFixture, nativeInitialInputFixture } from './fixtures/native-initial-content.js';

import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions';
import { toBase58, toBase64 } from '@mysten/sui/utils';

import {
  createCharacterMakerV8Starter,
} from '../maker-v8-document.js';
import {
  MAKER_V8_PLAYER_ACTIONS,
  MAKER_V8_PLAYER_CONTEXT_SCHEMA,
  MAKER_V8_PLAYER_PLAN_SCHEMA,
  MAKER_V8_PLAYER_READBACK_SCHEMA,
  MAKER_V8_PLAYER_RECIPE_SCHEMA,
  MakerV8PlayerControllerError,
  createMakerV8PlayerControllerV8,
  makerV8PlayerContextCommitmentV8,
  makerV8PlayerRecipeCommitmentV8,
} from '../maker-v8-player-controller.js';
import {
  MAKER_V8_PRODUCT_RUNTIME_SCHEMA,
} from '../maker-v8-product-runtime.js';
import {
  MAKER_V8_CLOCK_OBJECT_ID,
  MAKER_V8_PAYMENT_COIN_TYPE,
  MAKER_V8_ROLE_CONFIG_ROLES,
  MAKER_V8_ROLES,
  MAKER_V8_RUNTIME_SCHEMA,
} from '../maker-v8-runtime.js';

const id = (value) => `0x${BigInt(value).toString(16).padStart(64, '0')}`;
const hash = (byte) => byte.repeat(32);
const clone = (value) => structuredClone(value);
const CHAIN = '35834a8a';
const GAS_DIGEST = toBase58(new Uint8Array(32).fill(3));
const SIGNATURE = toBase64(new Uint8Array(64).fill(9));
const ROOT_ID = id(500);
const HOLDER = id(902);
const RENDER_INPUT = Object.freeze({
  nativeSoul: {
    name: 'Native Soul', description: 'Native completion', currentKioskId: null, currentKioskCapOnChainId: null,
    mintNonce: '12'.repeat(16), expectedContentObjectId: id(812),
    initialStateConfig: [], initialContent: [
      { kind: 0, name: 'soul', slotReadModeMask: 3, downloadPolicy: 'public', setActive: false, blobObjectId: id(810), expectedVersionIndex: '0', encryptedEnvelope: 'ciphertext' },
      { kind: 1, name: 'default', slotReadModeMask: 3, downloadPolicy: 'public', setActive: false, blobObjectId: id(811), expectedVersionIndex: '0', encryptedEnvelope: 'ciphertext' },
    ],
  },
  render: Object.freeze({
    blobId: 'render-blob', sha256: hash('de'),
    blobCommitment: hash('ad'), byteLength: 128,
  }),
});
const MATERIALIZE_INPUT = Object.freeze({
  selectionIndex: 0,
  soulId: id(800),
  materializationKey: 'paper-copy-1',
});

function runtime() {
  return {
    schemaVersion: MAKER_V8_RUNTIME_SCHEMA,
    protocolVersion: 8,
    enabled: true,
    catalogId: id(300),
    protocolConfigId: id(301),
    protocolTreasuryId: id(302),
    paymentCoinType: MAKER_V8_PAYMENT_COIN_TYPE,
    clockObjectId: MAKER_V8_CLOCK_OBJECT_ID,
    roles: Object.fromEntries(MAKER_V8_ROLES.map((role, index) => [role, {
      typeOriginPackageId: id(100 + index),
      callablePackageId: id(100 + index),
    }])),
    roleConfigIds: Object.fromEntries(MAKER_V8_ROLE_CONFIG_ROLES.map((role, index) => (
      [role, id(200 + index)]
    ))),
    makerBindings: [],
  };
}

function documentFixture() {
  const document = clone(createCharacterMakerV8Starter({
    makerKey: 'player-maker',
    name: 'Player Maker',
  }));
  document.metadata.summary = 'Exact Player fixture';
  document.metadata.coverAssetId = 'base-default';
  document.composition.mode = 'COMPOSABLE';
  document.composition.thirdPartyAdmission = 'OPEN';
  document.colors = [{
    key: 'primary',
    label: 'Primary',
    defaultSwatchKey: 'red',
    swatches: [
      { key: 'blue', label: 'Blue', rgba: '#0000ffff', stops: [] },
      { key: 'red', label: 'Red', rgba: '#ff0000ff', stops: [] },
    ],
  }];
  const baseStyle = document.parts[0].items[0].styles[0];
  baseStyle.colorChannelKey = 'primary';
  baseStyle.defaultSwatchKey = 'red';
  baseStyle.physical = {
    material: 'Paper',
    issuance: 'FREE_CLAIM',
    proof: 'NONE',
    priceAtomic: '0',
    maxSupply: '100',
    transferable: true,
  };
  document.tracks.push({
    key: 'accessory-track', label: 'Accessories', renderOrder: 1, locked: false,
  });
  document.parts.push({
    key: 'accessory', label: 'Accessory', kind: 'STANDARD',
    renderOrder: 1, menuOrder: 1, visible: true, required: false,
    wardrobeMode: 'SLOT', capacity: 1, payload: {},
    items: [{
      key: 'cap', label: 'Cap', status: 'PUBLIC', displayOrder: 0,
      defaultStyleKey: 'default', payload: {},
      styles: [{
        key: 'default', label: 'Default', displayOrder: 0,
        trackKey: 'accessory-track', colorChannelKey: null, defaultSwatchKey: null,
        assetId: 'cap-default', protected: false,
        transform: { x: 0, y: 0, scale: 1, rotation: 0 },
        opacity: 1, blendMode: 'normal', physical: null, payload: {},
      }],
    }],
  });
  document.parts.push({
    key: 'pack-slot', label: 'Pack slot', kind: 'STANDARD',
    renderOrder: 2, menuOrder: 2, visible: true, required: false,
    wardrobeMode: 'SLOT', capacity: 2, payload: {},
    items: [{
      key: 'empty', label: 'Empty', status: 'PUBLIC', displayOrder: 0,
      defaultStyleKey: 'default', payload: {},
      styles: [{
        key: 'default', label: 'Default', displayOrder: 0,
        trackKey: 'accessory-track', colorChannelKey: null, defaultSwatchKey: null,
        assetId: 'pack-slot-default', protected: false,
        transform: { x: 0, y: 0, scale: 1, rotation: 0 },
        opacity: 1, blendMode: 'normal', physical: null, payload: {},
      }],
    }],
  });
  document.assets.push(
    { id: 'cap-default', kind: 'layer', mediaType: 'image/png', byteLength: 1 },
    { id: 'pack-slot-default', kind: 'layer', mediaType: 'image/png', byteLength: 1 },
  );
  document.defaultRecipe.selections.push({
    partKey: 'accessory', itemKey: 'cap', styleKey: 'default',
  });
  document.defaultRecipe.colors = [{ channelKey: 'primary', swatchKey: 'red' }];
  document.rules = [{
    key: 'base-needs-cap', kind: 'REQUIRE',
    trigger: { source: 'BASE', sourceKey: null, partKey: 'base', itemKey: 'default', styleKey: null },
    targetMode: 'ALL',
    targets: [{ source: 'BASE', sourceKey: null, partKey: 'accessory', itemKey: 'cap', styleKey: null }],
    payload: {},
  }];
  return document;
}

function playerFixture(overrides = {}) {
  const document = overrides.document ?? documentFixture();
  const certifiedAssets = document.assets.map((asset, index) => ({
    assetId: asset.id,
    blobId: `asset-blob-${index}`,
    mediaType: asset.mediaType,
    byteLength: asset.byteLength,
    sha256: String(index + 1).padStart(2, '0').repeat(32),
  }));
  const activationEventType = `${id(106)}::release_v8::MakerV8Activated`;
  return {
    schemaVersion: 'animacraft.maker-v8-player-view.v1',
    id: ROOT_ID,
    rootId: ROOT_ID,
    makerKey: document.lineage.makerKey,
    makerVersion: String(document.lineage.version),
    title: document.metadata.name,
    summary: document.metadata.summary,
    creatorName: document.metadata.creator ?? '',
    style: document.metadata.style ?? '',
    composableBinding: { definitionRegistryId: id(601), baseRegistryId: id(602), packRegistryId: id(603), admissionAuthorityId: id(604) },
    creatorAddress: id(901),
    ownerAddress: HOLDER,
    lifecycle: 'ACTIVE',
    coverAsset: certifiedAssets.find((asset) => asset.assetId === document.metadata.coverAssetId),
    document,
    certifiedAssets,
    evidence: {
      activationEventType,
      activationTransactionDigest: '4'.repeat(44),
      rootId: ROOT_ID,
      rootVersion: '9',
      rootDigest: '5'.repeat(44),
      makerVersion: String(document.lineage.version),
      lifecycle: 'ACTIVE',
      contentCommitment: makerV8PlayerContextCommitmentV8({ schemaVersion: 'animacraft.maker-v8-public-content.v1', document }),
      rendererCommitment: hash('cd'),
      manifestBlobId: 'manifest-blob',
      manifestSha256: makerV8PlayerContextCommitmentV8({ schemaVersion: 'animacraft.maker-v8-manifest.v2', protocolVersion: 8, document, certifiedAssets }),
      manifestByteLength: 2048,
    },
    ...overrides,
  };
}

function targetFor(action, sourceRuntime = runtime()) {
  const packageId = (role) => sourceRuntime.roles[role].callablePackageId;
  return {
    [MAKER_V8_PLAYER_ACTIONS.ACQUIRE_MAKER_ACCESS]:
      `${packageId('core')}::treasury_v8::claim_free_maker_access_v8`,
    [MAKER_V8_PLAYER_ACTIONS.ACQUIRE_PACK_ACCESS]:
      `${packageId('runtime')}::runtime_v8::issue_free_pack_pass_v8`,
    [MAKER_V8_PLAYER_ACTIONS.COMMIT_LOADOUT]:
      `${packageId('runtime')}::runtime_v8::create_maker_loadout_v8`,
    [MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT]:
      `${packageId('release')}::release_v8::finish_unprotected_complete_v8`,
    [MAKER_V8_PLAYER_ACTIONS.MATERIALIZE_PHYSICAL]:
      `${packageId('physical')}::physical_v8::claim_free_base_style_v8`,
  }[action];
}

function memoryPersistence(calls) {
  const records = new Map();
  const active = new Map();
  return {
    async requirePersistentStorage() { calls.order.push('persistence:required'); return true; },
    async preflightQuota() { calls.order.push('persistence:quota'); return true; },
    async create(record) {
      calls.create += 1;
      if (records.has(record.actionId)) throw new Error('duplicate action');
      if (active.has(record.scopeKey)) throw new Error('duplicate scope');
      records.set(record.actionId, clone(record));
      active.set(record.scopeKey, record.actionId);
      return clone(record);
    },
    async load(actionId) {
      calls.loadRecord += 1;
      return records.has(actionId) ? clone(records.get(actionId)) : null;
    },
    async compareAndSwap(actionId, revision, next) {
      calls.cas += 1;
      const current = records.get(actionId);
      if (!current || current.revision !== revision) {
        const error = new Error('CAS conflict');
        error.code = 'TEST_CAS_CONFLICT';
        throw error;
      }
      records.set(actionId, clone(next));
      if (['FINALIZED_SUCCESS', 'FINALIZED_FAILURE', 'EXPIRED_NOT_FOUND', 'CANCELLED_UNSIGNED'].includes(next.status)) {
        active.delete(next.scopeKey);
      } else active.set(next.scopeKey, actionId);
      return clone(next);
    },
    async resolveActive(scopeKey) { return active.get(scopeKey) ?? null; },
    async resolveRootActive({ rootId, signer }) {
      return [...active.values()].find(actionId => {
        const record = records.get(actionId);
        return record.playerIdentity.rootId === rootId && record.plan.signer === signer;
      }) ?? null;
    },
    async reclaimSignatureIntent({ actionId, revision, signatureIntent, checkedAt }) {
      const current = records.get(actionId);
      if (!current || current.revision !== revision
        || current.signatureIntent?.sessionId !== signatureIntent.sessionId
        || checkedAt < signatureIntent.leaseExpiresAt) throw new Error('not reclaimable');
      const next = {
        ...clone(current), revision: revision + 1, updatedAt: checkedAt,
        status: 'PREPARED', signatureIntent: null, error: null,
      };
      records.set(actionId, next);
      return clone(next);
    },
    inspect(actionId) { return clone(records.get(actionId)); },
    mutate(actionId, mutate) {
      const next = clone(records.get(actionId));
      mutate(next);
      records.set(actionId, next);
    },
  };
}

function harness({ enabled = true, protectedContent = false, player = playerFixture(), persistenceOverride = null, runtimeOverride = null } = {}) {
  const sourceRuntime = runtimeOverride ?? runtime();
  const calls = {
    order: [], catalog: 0, chain: 0, account: 0, custody: 0, custodyAssert: 0,
    compile: 0, fresh: 0, build: 0, dryRun: 0, sign: 0, verify: 0,
    broadcast: 0, query: 0, readback: 0, create: 0, loadRecord: 0, cas: 0,
  };
  const controls = {
    expirationOverride: makerV8PublicationExpiration('100'),
    contextReads: 0,
    clockProgress: false,
    contextMutation: null,
    catalogError: null,
    catalogRead: null,
    chainIdentifier: CHAIN,
    account: { address: HOLDER, network: 'mainnet' },
    custodyError: null,
    custodyCertified: true,
    committedMatches: false,
    onCommittedCheck: null,
    protectedContentRequired: false,
    compilerError: null,
    freshError: null,
    fresh: true,
    targetOverride: null,
    buildTargetOverride: null,
    digestOverride: null,
    dryRun: { status: 'SUCCESS' },
    signError: null,
    verify: true,
    broadcastError: null,
    broadcastAccepted: true,
    queryResults: [],
    readbackError: null,
  };
  let walletRevision = 0;
  const walletListeners = new Set();
  controls.walletEvent = account => {
    controls.account = clone(account); walletRevision++;
    for (const listener of walletListeners) listener({ revision: walletRevision, account: clone(account) });
  };
  const productRuntime = {
    schemaVersion: MAKER_V8_PRODUCT_RUNTIME_SCHEMA,
    runtime: sourceRuntime,
    catalog: {
      async loadPlayer() {
        calls.catalog += 1;
        calls.order.push('catalog');
        if (controls.catalogError) throw controls.catalogError;
        const selected = controls.catalogRead ?? player;
        return { status: 'READY', player: clone(selected), diagnostics: [] };
      },
    },
  };
  const persistence = persistenceOverride ?? memoryPersistence(calls);
  const authority = Object.freeze({
    schemaVersion: 'animacraft.maker-v8-player-test-authority.v1',
  });
  const compiler = {
    authority,
    async preparePlayerAction({ action, player: livePlayer, recipe, context, account, input }) {
      calls.compile += 1;
      calls.order.push('compiler');
      if (controls.compilerError) throw controls.compilerError;
      const target = controls.targetOverride ?? targetFor(action, sourceRuntime);
      return {
        authority,
        plan: {
          schemaVersion: MAKER_V8_PLAYER_PLAN_SCHEMA,
          action,
          chainIdentifier: CHAIN,
          network: 'mainnet',
          signer: account.address,
          rootId: livePlayer.rootId,
          makerVersion: livePlayer.makerVersion,
          rootContentCommitment: livePlayer.evidence.contentCommitment,
          recipeCommitment: makerV8PlayerRecipeCommitmentV8(recipe),
          contextCommitment: makerV8PlayerContextCommitmentV8(context),
          descriptor: { action, signer: account.address, target, input: clone(input ?? {}),
            ...(controls.expected ? { expected: clone(controls.expected) } : {}) },
          targets: controls.planTargets ?? [target],
        },
      };
    },
    async assertPlayerActionFresh(request) {
      assert.equal(request.action, request.plan.action, 'Real compiler requires the action during signature preflight');
      calls.fresh += 1;
      calls.order.push('compiler:fresh');
      if (controls.freshError) throw controls.freshError;
      return { authority, fresh: controls.fresh };
    },
  };
  const custody = {
    async matchesCommittedPlayerLoadout(request) {
      await controls.onCommittedCheck?.(request);
      return controls.committedMatches;
    },
    async loadPlayerContext({ action, player: livePlayer, recipe, account }) {
      calls.custody += 1;
      calls.order.push('custody');
      if (controls.custodyError) throw controls.custodyError;
      return {
        schemaVersion: MAKER_V8_PLAYER_CONTEXT_SCHEMA,
        chainIdentifier: CHAIN,
        network: 'mainnet',
        action,
        account: account.address,
        rootId: livePlayer.rootId,
        makerVersion: livePlayer.makerVersion,
        rootContentCommitment: livePlayer.evidence.contentCommitment,
        lifecycle: 'ACTIVE',
        actionEligible: true,
        protectedContentRequired: controls.protectedContentRequired,
        recipeCommitment: makerV8PlayerRecipeCommitmentV8(recipe),
        builderInput: { exact: true, ...(controls.clockProgress ? { objects: { clock: {
          objectId: id(6), type: `${id(2)}::clock::Clock`, owner: { kind: 'SHARED', initialSharedVersion: '1' },
          version: String(100 + controls.contextReads++), digest: GAS_DIGEST,
          fields: { timestamp_ms: String(1000 + controls.contextReads) },
        }, treasury: { version: '1' } } } : {}), ...(controls.contextMutation ?? {}) },
      };
    },
    async assertPlayerContext() {
      calls.custodyAssert += 1;
      return controls.custodyCertified;
    },
    async readbackPlayerAction({ record }) {
      calls.readback += 1;
      calls.order.push('readback');
      if (controls.readbackError) throw controls.readbackError;
      return {
        schemaVersion: MAKER_V8_PLAYER_READBACK_SCHEMA,
        status: 'CERTIFIED',
        actionId: record.actionId,
        action: record.action,
        rootId: record.playerIdentity.rootId,
        transactionDigest: record.transaction.digest,
        evidence: { createdObjects: [] },
      };
    },
  };
  const boundary = {
    async buildExactTransaction({ descriptor }) {
      calls.build += 1;
      calls.order.push('build');
      const transaction = new Transaction();
      transaction.setSender(descriptor.signer);
      for (const target of controls.buildTargets ?? [controls.buildTargetOverride ?? descriptor.target]) {
        transaction.moveCall({ target, arguments: [] });
      }
      transaction.setGasOwner(descriptor.signer);
      transaction.setGasBudget(10_000_000);
      transaction.setGasPrice(1_000);
      transaction.setGasPayment([{
        objectId: id(999), version: '1', digest: GAS_DIGEST,
      }]);
      transaction.setExpiration(controls.expirationOverride ?? makerV8PublicationExpiration('100'));
      const bytes = await transaction.build();
      return {
        transactionBytes: toBase64(bytes),
        transactionDigest: controls.digestOverride
          ?? TransactionDataBuilder.getDigestFromBytes(bytes),
        epochWindow: { start: '100', end: '101' },
        sourceSnapshot: { action: descriptor.action },
      };
    },
    async dryRunExactTransaction() {
      calls.dryRun += 1;
      calls.order.push('dry-run');
      return clone(controls.dryRun);
    },
    async broadcastExactTransaction({ digest }) {
      calls.broadcast += 1;
      calls.order.push('broadcast');
      if (controls.broadcastError) throw controls.broadcastError;
      return { digest, accepted: controls.broadcastAccepted };
    },
  };
  const wallet = {
    subscribe(listener) {
      walletListeners.add(listener); listener({ revision: walletRevision, account: clone(controls.account) });
      return () => walletListeners.delete(listener);
    },
    async getCurrentAccount() {
      calls.account += 1;
      calls.order.push('wallet');
      if (controls.account instanceof Error) throw controls.account;
      return clone(controls.account);
    },
    async signExactTransaction({ bytes, digest, signer }) {
      calls.sign += 1;
      calls.order.push('sign');
      if (controls.signError) throw controls.signError;
      return { bytes, digest, signer, signature: SIGNATURE, signedAt: 10 };
    },
    async verifyExactSignature({ bytes, digest, signer }) {
      calls.verify += 1;
      calls.order.push('verify');
      return controls.verify ? { verified: true, bytes, digest, signer } : false;
    },
  };
  const rpc = {
    async getChainIdentifier() {
      calls.chain += 1;
      calls.order.push('chain');
      return controls.chainIdentifier;
    },
    async queryTransaction({ digest }) {
      calls.query += 1;
      calls.order.push('query');
      return controls.queryResults.length
        ? clone(controls.queryResults.shift())
        : finalizedSuccess(digest);
    },
  };
  let time = 100;
  const controller = createMakerV8PlayerControllerV8({
    productRuntime,
    compiler,
    custody,
    boundary,
    wallet,
    rpc,
    persistence,
    execution: enabled
      ? {
        allowWalletSignature: true,
        allowBroadcast: true,
        allowProtectedContent: protectedContent,
      }
      : {},
    now: () => time++,
  });
  return {
    controller, productRuntime, compiler, custody, boundary, wallet, rpc,
    persistence, controls, calls, player, sourceRuntime,
  };
}

test('real catalog Player crosses the exact controller boundary with independent commitments', async () => {
  const h = harness({ enabled: false });
  const p = h.player;
  const manifest = { schemaVersion: 'animacraft.maker-v8-manifest.v2', protocolVersion: 8,
    document: p.document, certifiedAssets: p.certifiedAssets };
  h.productRuntime.catalog = createMakerV8CatalogAdapter({
    chain: {
      async discover() { return [{ type: p.evidence.activationEventType,
        transactionDigest: p.evidence.activationTransactionDigest, binding: { rootId: p.rootId } }]; },
      async loadContext() { return { root: { objectId: p.rootId, version: '9', digest: p.evidence.rootDigest,
        makerKey: p.makerKey, makerVersion: p.makerVersion, lifecycle: 'ACTIVE',
        creatorAddress: p.creatorAddress, ownerAddress: p.ownerAddress,
        contentCommitment: p.evidence.contentCommitment, rendererCommitment: p.evidence.rendererCommitment,
        content: { manifestBlobId: p.evidence.manifestBlobId, manifestSha256: p.evidence.manifestSha256 },
        binding: { runtimeDefinitionRegistryId: p.composableBinding.definitionRegistryId,
          baseRegistryId: p.composableBinding.baseRegistryId, packRegistryId: p.composableBinding.packRegistryId,
          packAdmissionAuthorityId: p.composableBinding.admissionAuthorityId } } }; },
    },
    manifests: { async load(pointer) { return { ...pointer, manifest, byteLength: 2048 }; } },
  });
  assert.notEqual(p.evidence.manifestSha256, p.evidence.contentCommitment);
  const read = await h.productRuntime.catalog.loadPlayer(p.rootId);
  assert.equal(read.status, 'READY', JSON.stringify(read.diagnostics));
  const result = await h.controller.loadPlayer(p.rootId);
  assert.equal(result.status, 'READY', JSON.stringify(result.error));
  assert.equal(h.calls.sign, 0);
  assert.equal(h.calls.broadcast, 0);
});

test('exact Player rejects extra fields, metadata, binding and independent commitment drift', async () => {
  const mutations = [
    p => { p.unexpected = true; }, p => { p.evidence.unexpected = true; },
    p => { p.creatorName = 'wrong'; }, p => { p.style = 'wrong'; },
    p => { delete p.composableBinding; }, p => { p.composableBinding.extra = id(9); },
    p => { p.composableBinding.baseRegistryId = '0x1'; },
    p => { p.evidence.rendererCommitment = 'invalid'; },
    p => { p.evidence.contentCommitment = p.evidence.manifestSha256; },
    p => { p.evidence.contentCommitment = makerV8PlayerContextCommitmentV8({ schemaVersion: 'wrong', document: p.document }); },
    p => { p.evidence.manifestSha256 = hash('ab'); },
    p => { p.evidence.manifestByteLength = 0; },
  ];
  for (const mutate of mutations) {
    const player = playerFixture(); mutate(player);
    const h = harness({ enabled: false, player });
    assert.equal((await h.controller.loadPlayer(ROOT_ID)).status, 'ERROR');
    assert.equal(h.calls.sign, 0); assert.equal(h.calls.broadcast, 0);
  }
});

test('controller loads signer-bound definitions and retained attachment layout without writes', async () => {
  const h = harness({ enabled: false });
  const rootId = h.player.rootId;
  const context = {
    choices: { schemaVersion: 'animacraft.maker-v8-contextual-choices.v1', address: HOLDER, rootId,
      baseEntitlements: [], packStyles: [], externalStyles: [], certifiedAssets: [], diagnostics: [] },
    definitions: { schemaVersion: 'animacraft.maker-v8-player-definitions.v1', address: HOLDER, rootId,
      packs: [{ releaseId: id(981), definitionCommitment: '12'.repeat(32), ownedParts: [], rules: [] }], currentLoadout: { objectId: id(980), revision: '3', layout: {
        bindings: [{ releaseId: id(981), definitionCommitment: '12'.repeat(32) }],
        profiles: [{ releaseId: id(981), partKey: 'retained', capacity: '2', profileCommitment: '34'.repeat(32) }],
      } } },
  };
  let reads = 0;
  h.productRuntime.playerContext = { async load(input) {
    assert.deepEqual(input, { address: HOLDER, rootId }); reads++; return context;
  } };
  const snapshot = await h.controller.loadPlayer(rootId);
  assert.equal(snapshot.status, 'READY');
  assert.equal(reads, 1);
  assert.deepEqual(snapshot.player.definitionContext, context.definitions);
  assert.deepEqual(snapshot.player.contextualChoices, context.choices);
  assert.notEqual(snapshot.player.definitionContext, context.definitions);
  assert.ok(Object.isFrozen(snapshot.player.definitionContext.currentLoadout.layout.profiles[0]));
  assert.equal(h.calls.sign, 0); assert.equal(h.calls.compile, 0); assert.equal(h.calls.custody, 0);
  context.definitions.currentLoadout.layout.profiles[0].capacity = '5';
  assert.equal(snapshot.player.definitionContext.currentLoadout.layout.profiles[0].capacity, '2');

  const selection = { source: 'PACK', partKey: 'pack-slot', itemKey: 'addition', styleKey: 'style',
    trackKey: 'pack-overlay', colorChannelKey: null, defaultSwatchKey: null,
    releaseId: id(981), semanticPackId: 'extras', externalProductId: null, ownedExternalItemId: null };
  context.choices.packStyles = [{ ...selection, definitionCommitment: '12'.repeat(32),
    definitionScope: { track: { source: 'PACK', sourceId: id(981), key: 'pack-overlay' } } }];
  context.definitions.packs = [{ releaseId: id(981), semanticPackId: 'extras', definitionCommitment: '12'.repeat(32),
    ownedParts: [], rules: [],
    document: { tracks: [{ key: 'pack-overlay', renderOrder: 99 }] },
    styleReferences: [{ part: { scope: 'BASE', key: 'pack-slot' }, itemKey: 'addition', styleKey: 'style',
      track: { scope: 'PACK_SELF', key: 'pack-overlay' } }] }];
  const ready = await h.controller.loadPlayer(rootId);
  const selected = h.controller.setRecipe({ ...ready.recipe, selections: [...ready.recipe.selections, selection] });
  assert.equal(selected.selections.at(-1).trackKey, 'pack-overlay');
  assert.equal(h.controller.getSnapshot().loadout.selections.at(-1).selectionIndex, 2);
  const wrongTrack = { ...selection, releaseId: id(982) };
  assert.throws(() => h.controller.setRecipe({ ...ready.recipe, selections: [...ready.recipe.selections, wrongTrack] }),
    { code: 'MAKER_V8_PLAYER_SELECTION_REFERENCE_INVALID' });
  context.definitions.packs[0].rules = [{ key: 'no-cap', kind: 'EXCLUDE', targetMode: 'ANY', payload: {},
    trigger: { source: 'BASE', sourceKey: null, partKey: 'pack-slot', itemKey: 'addition', styleKey: 'style' },
    targets: [{ source: 'BASE', sourceKey: null, partKey: 'accessory', itemKey: 'cap', styleKey: null }] }];
  const ruleReady = await h.controller.loadPlayer(rootId);
  assert.equal(ruleReady.status, 'READY');
  assert.throws(() => h.controller.setRecipe({ ...ruleReady.recipe, selections: [...ruleReady.recipe.selections, selection] }),
    { code: 'MAKER_V8_PLAYER_RULE_EXCLUDE_FAILED' });
  assert.equal(h.calls.sign, 0); assert.equal(h.calls.custody, 0);
  context.definitions.packs[0].rules = [];

  for (const mutate of [
    value => { value.definitions.rootId = id(999); },
    value => { value.choices.address = id(999); },
    value => { value.choices.diagnostics.push({ code: 'READ_FAILED' }); },
    value => { value.definitions.currentLoadout.layout.profiles[0].releaseId = id(999); },
  ]) {
    const changed = structuredClone(context); mutate(changed);
    h.productRuntime.playerContext.load = async () => changed;
    const failed = await h.controller.loadPlayer(rootId);
    assert.equal(failed.status, 'ERROR');
    assert.equal(failed.player, null, 'Invalid contexts must not retain previously ready authority');
  }
});

test('own-Part recipes allocate canonical new Packs and preserve unselected committed attachment slots', async () => {
  const h = harness({ enabled: false });
  const rootId = h.player.rootId;
  const packs = [
    { releaseId: id(980), semanticPackId: 'retained', key: 'unused', capacity: 3 },
    { releaseId: id(981), semanticPackId: 'z-pack', key: 'plume', capacity: 2 },
    { releaseId: id(982), semanticPackId: 'a-pack', key: 'plume', capacity: 2 },
  ].map(row => {
    const part = { key: row.key, menuOrder: 99, capacity: row.capacity, required: false, wardrobeMode: 'FIXED', items: [] };
    return { releaseId: row.releaseId, semanticPackId: row.semanticPackId, definitionCommitment: '12'.repeat(32),
      ownedParts: [part], rules: [], document: { parts: [part] }, styleReferences: [{
        part: { scope: 'PACK_SELF', key: row.key }, itemKey: 'item', styleKey: 'style',
        track: { scope: 'BASE', key: 'accessory-track' },
      }] };
  });
  const selected = packs.slice(1).map(pack => ({ source: 'PACK', partKey: 'plume', itemKey: 'item', styleKey: 'style',
    trackKey: 'accessory-track', colorChannelKey: null, defaultSwatchKey: null, releaseId: pack.releaseId,
    semanticPackId: pack.semanticPackId, externalProductId: null, ownedExternalItemId: null }));
  const binding = pack => ({ releaseId: pack.releaseId, definitionCommitment: pack.definitionCommitment });
  const profile = pack => ({ releaseId: pack.releaseId, partKey: pack.ownedParts[0].key,
    capacity: String(pack.ownedParts[0].capacity), profileCommitment: '34'.repeat(32) });
  const context = { choices: { schemaVersion: 'animacraft.maker-v8-contextual-choices.v1', address: HOLDER, rootId,
    baseEntitlements: [], externalStyles: [], certifiedAssets: [], diagnostics: [],
    packStyles: selected.map(selection => ({ ...selection, definitionCommitment: '12'.repeat(32), definitionScope: {
      part: { source: 'PACK', sourceId: selection.releaseId, key: 'plume' },
      track: { source: 'BASE', sourceId: rootId, key: 'accessory-track' }, color: null,
    } })) }, definitions: { schemaVersion: 'animacraft.maker-v8-player-definitions.v1', rootId, address: HOLDER, packs,
    currentLoadout: { objectId: id(979), revision: '1', layout: { bindings: [binding(packs[0])], profiles: [profile(packs[0])] } } } };
  h.productRuntime.playerContext = { async load() { return context; } };
  const ready = await h.controller.loadPlayer(rootId);
  assert.equal(ready.status, 'READY');
  const recipe = h.controller.setRecipe({ ...ready.recipe, selections: [...ready.recipe.selections, ...selected] });
  const allocation = h.controller.getSnapshot().loadout.selections.filter(row => row.source === 'PACK');
  assert.deepEqual(allocation.map(row => [row.semanticPackId, row.selectionIndex]), [['a-pack', 7], ['z-pack', 9]]);
  assert.deepEqual(h.controller.setRecipe(recipe), recipe, 'Canonicalization cannot change new attachment order on a second pass');
  assert.throws(() => h.controller.setRecipe({ ...ready.recipe, selections: [...ready.recipe.selections,
    selected[0], selected[0], selected[0]] }), { code: 'MAKER_V8_PLAYER_SELECTION_REFERENCE_INVALID' });
  context.definitions.currentLoadout.layout = {
    bindings: [packs[0], packs[2], packs[1]].map(binding), profiles: [packs[0], packs[2], packs[1]].map(profile),
  };
  const reopened = await h.controller.loadPlayer(rootId);
  h.controller.setRecipe({ ...reopened.recipe, selections: [...reopened.recipe.selections, selected[0]] });
  assert.equal(h.controller.getSnapshot().loadout.selections.at(-1).selectionIndex, 9,
    'Removing a selection from a committed Pack cannot shift later committed Pack slots');
  for (const pack of packs.slice(1)) {
    pack.document.colors = [{ key: 'primary', swatches: [{ key: 'red' }, { key: 'blue' }] }];
    pack.styleReferences[0].color = { scope: 'PACK_SELF', key: 'primary' };
  }
  for (const row of [...selected, ...context.choices.packStyles]) {
    row.colorChannelKey = 'primary'; row.defaultSwatchKey = 'red';
  }
  for (const row of context.choices.packStyles) row.definitionScope.color = { source: 'PACK', sourceId: row.releaseId, key: 'primary' };
  const colored = await h.controller.loadPlayer(rootId);
  const colorRecipe = h.controller.setRecipe({ ...colored.recipe, selections: [...colored.recipe.selections, ...selected],
    colors: [{ channelKey: 'primary', swatchKey: 'blue' },
      { releaseId: packs[1].releaseId, channelKey: 'primary', swatchKey: 'blue' },
      { releaseId: packs[2].releaseId, channelKey: 'primary', swatchKey: 'red' }] });
  assert.deepEqual(h.controller.getSnapshot().loadout.selections.map(row => row.swatchKey), ['blue', null, 'red', 'blue']);
  assert.deepEqual(h.controller.setRecipe(colorRecipe), colorRecipe, 'Scoped color normalization is idempotent');
  for (const colors of [[...colorRecipe.colors, colorRecipe.colors[0]],
    [{ releaseId: id(999), channelKey: 'primary', swatchKey: 'red' }],
    [{ releaseId: null, channelKey: 'primary', swatchKey: 'red' }]]) {
    assert.throws(() => h.controller.setRecipe({ ...colorRecipe, colors }), { code: 'MAKER_V8_PLAYER_RECIPE_COLOR_INVALID' });
  }
  assert.equal(h.calls.sign, 0);
});

test('definition reads reject wallet A to B to A and preserve disconnected public browsing', async () => {
  const h = harness({ enabled: false });
  let reads = 0;
  h.productRuntime.playerContext = { async load() {
    reads++;
    h.controls.walletEvent({ address: id(999), network: 'mainnet' });
    h.controls.walletEvent({ address: HOLDER, network: 'mainnet' });
    return {};
  } };
  const failed = await h.controller.loadPlayer(h.player.rootId);
  assert.equal(failed.status, 'ERROR');
  assert.equal(failed.lastError.code, 'MAKER_V8_PLAYER_ACCOUNT_DRIFT');
  h.controls.account = null;
  const publicRead = await h.controller.loadPlayer(h.player.rootId);
  assert.equal(publicRead.status, 'READY');
  assert.equal(reads, 1, 'Disconnected public browsing never loads another holder context');
  assert.equal(Object.hasOwn(publicRead.player, 'definitionContext'), false);
});

function notFound(digest, watermarkEpoch = '1') {
  return {
    status: 'NOT_FOUND', digest, epoch: null, effectsFingerprint: null,
    eventsDigest: null, error: null,
    absence: {
      schemaVersion: 'animacraft.sui-transaction-absence.v8',
      kind: 'SUI_GRPC_TRANSACTION_NOT_FOUND',
      grpcCode: 'NOT_FOUND',
      grpcService: 'sui.rpc.v2.LedgerService',
      grpcMethod: 'GetTransaction',
      requestedDigest: digest,
      chainIdentifier: CHAIN,
      watermarkEpoch,
      watermarkCheckpointSequence: '10',
      watermarkCheckpointDigest: '6'.repeat(44),
    },
  };
}

function finalizedSuccess(digest) {
  return {
    status: 'FINALIZED_SUCCESS', digest, epoch: '1',
    effectsFingerprint: `0x${'7'.repeat(64)}`, eventsDigest: null,
    error: null, absence: null,
  };
}

function finalizedFailure(digest, message = 'Move abort') {
  return {
    status: 'FINALIZED_FAILURE', digest, epoch: '1',
    effectsFingerprint: `0x${'8'.repeat(64)}`, eventsDigest: null,
    error: { message }, absence: null,
  };
}

function overviewFixture(request) {
  return { rootId: request.player.rootId, signer: request.account.address,
    recipeCommitment: makerV8PlayerRecipeCommitmentV8(request.recipe),
    completePaymentQuote: { paymentCoinType: MAKER_V8_PAYMENT_COIN_TYPE, totalAmountAtomic: '9007199254740993' },
    entryPaymentQuote: { paymentCoinType: MAKER_V8_PAYMENT_COIN_TYPE, totalAmountAtomic: '7',
      maker: { required: true, priceAtomic: '7' }, packs: [], baseItems: [] },
    totalBusinessAmountAtomic: '9007199254741000' };
}

test('read-only completion overview returns detached exact totals without WAL, compiler, transaction or signing work', async () => {
  const h = harness({ enabled: false });
  let source;
  h.custody.quotePlayerCompletion = async request => { source = overviewFixture(request); return source; };
  await h.controller.loadPlayer(ROOT_ID);
  const quote = await h.controller.quotePlayerCompletion();
  assert.equal(quote.totalBusinessAmountAtomic, '9007199254741000');
  assert.equal(Object.isFrozen(quote.entryPaymentQuote.maker), true);
  source.entryPaymentQuote.maker.priceAtomic = '0';
  assert.equal(quote.entryPaymentQuote.maker.priceAtomic, '7');
  for (const key of ['custody', 'custodyAssert', 'compile', 'fresh', 'build', 'dryRun', 'sign', 'verify', 'broadcast', 'query', 'create', 'loadRecord', 'cas']) {
    assert.equal(h.calls[key], 0, key);
  }
  assert.equal(h.calls.order.some(value => value.startsWith('persistence:')), false);
});

test('completion overview invalidates wallet A to B to A, Recipe edits, Root reloads and competing reads', async () => {
  for (const mutation of ['wallet-roundtrip', 'wallet-unreported', 'recipe', 'root-reload', 'new-quote']) {
    const h = harness({ enabled: false });
    await h.controller.loadPlayer(ROOT_ID);
    let notify; const started = new Promise(resolve => { notify = resolve; });
    let release; const paused = new Promise(resolve => { release = resolve; });
    let reads = 0;
    h.custody.quotePlayerCompletion = async request => {
      if (++reads === 1) { notify(); await paused; }
      return overviewFixture(request);
    };
    const pending = h.controller.quotePlayerCompletion();
    const rejected = assert.rejects(pending, { code: 'MAKER_V8_PLAYER_QUOTE_STALE' });
    await started;
    if (mutation === 'wallet-roundtrip') {
      h.controls.walletEvent({ address: id(999), network: 'mainnet' });
      h.controls.walletEvent({ address: HOLDER, network: 'mainnet' });
    } else if (mutation === 'wallet-unreported') h.controls.account = { address: id(999), network: 'mainnet' };
    else if (mutation === 'recipe') h.controller.updateRecipe({ colors: [{ channelKey: 'primary', swatchKey: 'blue' }] });
    else if (mutation === 'root-reload') await h.controller.loadPlayer(ROOT_ID);
    else await h.controller.quotePlayerCompletion();
    release(); await rejected;
    assert.equal(h.calls.sign, 0);
    assert.equal(h.calls.create, 0);
  }
});

test('completion overview refuses unknown readers and mismatched identity, coin or total', async () => {
  const missing = harness({ enabled: false }); await missing.controller.loadPlayer(ROOT_ID);
  await assert.rejects(missing.controller.quotePlayerCompletion());
  for (const mutate of [
    value => { value.rootId = id(999); }, value => { value.signer = id(999); },
    value => { value.recipeCommitment = hash('ab'); }, value => { value.entryPaymentQuote.paymentCoinType = 'other'; },
    value => { value.totalBusinessAmountAtomic = '0'; }, value => { value.builderInput = {}; },
  ]) {
    const h = harness({ enabled: false }); await h.controller.loadPlayer(ROOT_ID);
    h.custody.quotePlayerCompletion = async request => { const value = overviewFixture(request); mutate(value); return value; };
    await assert.rejects(h.controller.quotePlayerCompletion(), { code: 'MAKER_V8_PLAYER_QUOTE_INVALID' });
  }
});

test('read-only production state loads exact Player and permits local Recipe edits while writes fail closed', async () => {
  const { controller, calls } = harness({ enabled: false });
  const loaded = await controller.loadPlayer(ROOT_ID);
  assert.equal(loaded.status, 'READY');
  assert.equal(loaded.execution.writeEnabled, false);
  assert.match(loaded.execution.disabledReason, /disabled/i);
  assert.equal(loaded.player.lifecycle, 'ACTIVE');
  assert.equal(loaded.recipe.schemaVersion, MAKER_V8_PLAYER_RECIPE_SCHEMA);
  assert.equal(loaded.loadout.selections.length, 2);
  assert.equal(loaded.loadout.selections[0].swatchKey, 'red');

  const updated = controller.updateRecipe({
    colors: [{ channelKey: 'primary', swatchKey: 'blue' }],
  });
  assert.equal(updated.colors[0].swatchKey, 'blue');
  assert.equal(controller.getSnapshot().loadout.selections[0].swatchKey, 'blue');

  await assert.rejects(
    controller.preparePlayerAction({
      action: MAKER_V8_PLAYER_ACTIONS.ACQUIRE_MAKER_ACCESS,
    }),
    (error) => error.code === 'MAKER_V8_PLAYER_WRITES_DISABLED'
      && error.layer === 'GATE',
  );
  assert.equal(calls.chain, 0);
  assert.equal(calls.account, 0);
});

test('read failures and private Manifest content become visible ERROR state without substitution', async () => {
  const failed = harness({ enabled: false });
  const readError = new Error('manifest transport unavailable');
  readError.code = 'TEST_MANIFEST_UNAVAILABLE';
  readError.layer = 'TRANSPORT';
  failed.controls.catalogError = readError;
  const snapshot = await failed.controller.loadPlayer(ROOT_ID);
  assert.equal(snapshot.status, 'ERROR');
  assert.equal(snapshot.player, null);
  assert.equal(snapshot.diagnostics.length, 1);
  assert.equal(snapshot.diagnostics[0].code, 'TEST_MANIFEST_UNAVAILABLE');
  assert.equal(snapshot.diagnostics[0].layer, 'TRANSPORT');

  const privateDocument = documentFixture();
  privateDocument.parts[1].items.push({
    key: 'secret', label: 'Secret', status: 'PRIVATE', displayOrder: 1,
    defaultStyleKey: 'default', payload: {},
    styles: [{
      key: 'default', label: 'Secret', displayOrder: 0,
      trackKey: 'accessory-track', colorChannelKey: null, defaultSwatchKey: null,
      assetId: 'cap-default', protected: false,
      transform: { x: 0, y: 0, scale: 1, rotation: 0 },
      opacity: 1, blendMode: 'normal', physical: null, payload: {},
    }],
  });
  const privateHarness = harness({
    enabled: false,
    player: playerFixture({ document: privateDocument }),
  });
  const privateSnapshot = await privateHarness.controller.loadPlayer(ROOT_ID);
  assert.equal(privateSnapshot.status, 'ERROR');
  assert.equal(
    privateSnapshot.diagnostics[0].code,
    'MAKER_V8_PLAYER_PRIVATE_DEFINITION_FORBIDDEN',
  );
});

test('Recipe validation rejects invalid/private-like refs, Track drift, and rules before any execution RPC', async () => {
  const { controller, calls } = harness();
  await controller.loadPlayer(ROOT_ID);
  const original = controller.getSnapshot().recipe;
  const withoutRequiredRuleTarget = {
    ...clone(original),
    selections: clone(original.selections.filter((entry) => entry.partKey !== 'accessory')),
  };
  assert.throws(
    () => controller.setRecipe(withoutRequiredRuleTarget),
    (error) => error.code === 'MAKER_V8_PLAYER_RULE_REQUIRE_FAILED',
  );

  const privateLike = clone(original);
  privateLike.selections[1].itemKey = 'secret';
  assert.throws(
    () => controller.setRecipe(privateLike),
    (error) => error.code === 'MAKER_V8_PLAYER_RECIPE_REFERENCE_INVALID',
  );

  const trackDrift = clone(original);
  trackDrift.selections[0].trackKey = 'accessory-track';
  assert.throws(
    () => controller.setRecipe(trackDrift),
    (error) => error.code === 'MAKER_V8_PLAYER_BASE_SELECTION_DRIFT',
  );

  const invalidPack = clone(original);
  invalidPack.selections.push({
    source: 'PACK', partKey: 'pack-slot', itemKey: 'moon', styleKey: 'glow',
    trackKey: 'accessory-track', colorChannelKey: null, defaultSwatchKey: null,
    releaseId: 'not-an-id', semanticPackId: 'moon-pack',
    externalProductId: null, ownedExternalItemId: null,
  });
  assert.throws(
    () => controller.setRecipe(invalidPack),
    (error) => error.code === 'MAKER_V8_PLAYER_ID_INVALID',
  );

  const unknownColor = clone(original);
  unknownColor.colors = [{ channelKey: 'primary', swatchKey: 'missing' }];
  assert.throws(
    () => controller.setRecipe(unknownColor),
    (error) => error.code === 'MAKER_V8_PLAYER_RECIPE_COLOR_INVALID',
  );

  const unknownOutput = clone(original);
  unknownOutput.outputKey = 'missing-output';
  assert.throws(
    () => controller.setRecipe(unknownOutput),
    (error) => error.code === 'MAKER_V8_PLAYER_OUTPUT_UNKNOWN',
  );
  assert.equal(calls.chain, 0);
  assert.equal(calls.account, 0);
  assert.equal(calls.custody, 0);
  assert.equal(calls.compile, 0);
});

test('certified Player rejects newly invisible selected Styles atomically before any execution RPC', async () => {
  const document = documentFixture();
  document.rules = [];
  document.parts[0].items[0].styles[0].visibleWhen = {
    op: 'selected', source: 'BASE', sourceKey: null, partKey: 'accessory', itemKey: 'cap', styleKey: 'default',
  };
  const { controller, calls } = harness({ player: playerFixture({ document }) });
  await controller.loadPlayer(ROOT_ID);
  const original = controller.getSnapshot();
  assert.equal(original.status, 'READY');
  const beforeCalls = clone(calls);
  const invalid = clone(original.recipe);
  invalid.selections = invalid.selections.filter(selection => selection.partKey !== 'accessory');
  assert.throws(() => controller.setRecipe(invalid), { code: 'MAKER_V8_RECIPE_STYLE_NOT_VISIBLE' });
  const rejected = controller.getSnapshot();
  assert.equal(rejected.lastError.code, 'MAKER_V8_RECIPE_STYLE_NOT_VISIBLE');
  assert.deepEqual({ ...rejected, lastError: original.lastError }, original);
  assert.deepEqual(calls, beforeCalls);
});

test('native Complete cold record revalidates full initial content evidence before any query or signature', async () => {
  const h = harness(); const pkg = id(71);
  h.controls.expected = { nativeSoul: { nativeBinding: { soulOriginalType: `${pkg}::soul::Soul` } } };
  const input = { ...RENDER_INPUT, nativeSoul: nativeInitialInputFixture(RENDER_INPUT.nativeSoul, pkg) };
  await h.controller.loadPlayer(ROOT_ID);
  const prepared = await h.controller.preparePlayerAction({ action: MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT, input });
  const record = h.persistence.inspect(prepared.actionId);
  const proof = nativeInitialEvidenceFixture({ input: input.nativeSoul, originalPackageId: pkg,
    soulId: id(40), stateId: id(41), signer: HOLDER, transactionDigest: record.transaction.digest });
  h.controls.queryResults.push({ ...finalizedSuccess(record.transaction.digest), effectsFingerprint: `0x${proof.effectsSha256}` });
  h.custody.readbackPlayerAction = async ({ record }) => ({ schemaVersion: MAKER_V8_PLAYER_READBACK_SCHEMA,
    status: 'CERTIFIED', actionId: record.actionId, action: record.action, rootId: ROOT_ID,
    transactionDigest: record.transaction.digest, evidence: { effectsBcsSha256: proof.effectsSha256,
      nativeContentEvidence: proof.evidence, certifiedEvent: { fields: { root_id: ROOT_ID, original_holder: HOLDER,
        soul_id: id(40), soul_state_id: id(41) } } } });
  assert.equal((await h.controller.executePlayerAction(prepared.actionId)).status, 'FINALIZED_SUCCESS');
  const calls = { sign: h.calls.sign, query: h.calls.query };
  h.persistence.mutate(prepared.actionId, row => { row.certificate.evidence.nativeContentEvidence.objects.pop(); });
  await assert.rejects(h.controller.recoverPlayerAction(prepared.actionId), { code: 'MAKER_V8_NATIVE_CONTENT_EVIDENCE_INVALID' });
  assert.deepEqual({ sign: h.calls.sign, query: h.calls.query }, calls);
});

test('positive access flow validates, builds, dry-runs, durably signs, broadcasts, and certifies readback', async () => {
  const { controller, calls, persistence } = harness();
  await controller.loadPlayer(ROOT_ID);
  const prepared = await controller.preparePlayerAction({
    action: MAKER_V8_PLAYER_ACTIONS.ACQUIRE_MAKER_ACCESS,
  });
  assert.equal(prepared.status, 'PREPARED');
  assert.equal(calls.create, 1);
  assert.equal(calls.sign, 0);
  assert.equal(calls.broadcast, 0);
  const durablePrepared = persistence.inspect(prepared.actionId);
  assert.equal(durablePrepared.status, 'PREPARED');
  assert.equal(durablePrepared.signature, null);

  const finalized = await controller.executePlayerAction(prepared.actionId);
  assert.equal(finalized.status, 'FINALIZED_SUCCESS');
  assert.equal(finalized.certificate.status, 'CERTIFIED');
  assert.equal(calls.sign, 1);
  assert.equal(calls.verify, 1);
  assert.equal(calls.build, 2);
  assert.equal(calls.dryRun, 2);
  assert.equal(calls.broadcast, 1);
  assert.equal(calls.query, 1);
  assert.equal(calls.readback, 1);
  const durableFinal = persistence.inspect(prepared.actionId);
  assert.equal(durableFinal.signature.signature, SIGNATURE);
  assert.equal(durableFinal.transaction.digest, finalized.transactionDigest);
  assert.ok(calls.order.indexOf('sign') < calls.order.indexOf('broadcast'));
  assert.ok(calls.order.indexOf('broadcast') < calls.order.indexOf('query'));
  assert.ok(calls.order.indexOf('query') < calls.order.indexOf('readback'));
});

test('Maker entry action exposes its detached exact quote without signing during preparation', async () => {
  const current = harness();
  const quote = { rootId: ROOT_ID, kind: 1, priceAtomic: '17', paymentCoinType: MAKER_V8_PAYMENT_COIN_TYPE };
  current.controls.expected = { makerEntryQuote: quote };
  await current.controller.loadPlayer(ROOT_ID);
  const prepared = await current.controller.preparePlayerAction({ action: MAKER_V8_PLAYER_ACTIONS.ACQUIRE_MAKER_ACCESS });
  assert.deepEqual(prepared.makerEntryQuote, quote);
  quote.priceAtomic = '0';
  assert.equal((await current.controller.getPendingPlayerAction({ rootId: ROOT_ID })).makerEntryQuote.priceAtomic, '17');
  assert.equal(current.calls.sign, 0);
  assert.equal(current.calls.broadcast, 0);
});

test('Complete action view retains the detached prepared payment quote through pending lookup', async () => {
  const current = harness();
  const quote = { paymentCoinType: MAKER_V8_PAYMENT_COIN_TYPE,
    maker: { amountAtomic: '9007199254741000' }, packs: [], totalAmountAtomic: '9007199254741000' };
  current.controls.expected = { completePaymentQuote: quote };
  await current.controller.loadPlayer(ROOT_ID);
  const prepared = await current.controller.preparePlayerAction({ action: MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT, input: RENDER_INPUT });
  assert.deepEqual(prepared.completePaymentQuote, quote);
  assert.throws(() => { prepared.completePaymentQuote.maker.amountAtomic = '0'; }, TypeError);
  quote.maker.amountAtomic = '0';
  const pending = await current.controller.getPendingPlayerAction({ rootId: ROOT_ID });
  assert.equal(pending.actionId, prepared.actionId);
  assert.equal(pending.completePaymentQuote.maker.amountAtomic, '9007199254741000');
  assert.equal(current.calls.sign, 0);
  assert.equal(current.calls.broadcast, 0);
});

test('Pack admission/acquisition, Complete, loadout, and Physical actions use exact injected custody/compiler targets', async () => {
  const cases = [
    [MAKER_V8_PLAYER_ACTIONS.ACQUIRE_PACK_ACCESS, {
      releaseId: id(700), semanticPackId: 'moon-pack',
    }],
    [MAKER_V8_PLAYER_ACTIONS.COMMIT_LOADOUT, {}],
    [MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT, RENDER_INPUT],
    [MAKER_V8_PLAYER_ACTIONS.MATERIALIZE_PHYSICAL, MATERIALIZE_INPUT],
  ];
  for (const [action, input] of cases) {
    const current = harness();
    await current.controller.loadPlayer(ROOT_ID);
    const prepared = await current.controller.preparePlayerAction({ action, input });
    assert.equal(prepared.action, action);
    assert.equal(prepared.status, 'PREPARED');
    assert.equal(current.calls.custody, 1);
    assert.equal(current.calls.custodyAssert, 1);
    assert.equal(current.calls.compile, 1);
    assert.equal(current.calls.build, 1);
    assert.equal(current.calls.dryRun, 1);
  }

  const packHarness = harness();
  await packHarness.controller.loadPlayer(ROOT_ID);
  const recipe = clone(packHarness.controller.getSnapshot().recipe);
  recipe.selections.push({
    source: 'PACK', partKey: 'pack-slot', itemKey: 'moon', styleKey: 'glow',
    trackKey: 'accessory-track', colorChannelKey: null, defaultSwatchKey: null,
    releaseId: id(700), semanticPackId: 'moon-pack',
    externalProductId: null, ownedExternalItemId: null,
  });
  packHarness.controller.setRecipe(recipe);
  assert.deepEqual(packHarness.controller.getSnapshot().loadout.usedPacks, [{
    releaseId: id(700), semanticPackId: 'moon-pack',
  }]);
  packHarness.controls.custodyCertified = false;
  await assert.rejects(
    packHarness.controller.preparePlayerAction({
      action: MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT,
      input: RENDER_INPUT,
    }),
    (error) => error.code === 'MAKER_V8_PLAYER_CUSTODY_CERTIFICATE_INVALID'
      && error.layer === 'CUSTODY',
  );
  assert.equal(packHarness.calls.compile, 0);
  assert.equal(packHarness.calls.build, 0);

  const forbiddenDocument = documentFixture();
  forbiddenDocument.outputs[0].allowedPackPolicy = {
    kind: 'ALLOWLIST', packIds: ['approved-pack'],
  };
  const forbidden = harness({
    player: playerFixture({ document: forbiddenDocument }),
  });
  await forbidden.controller.loadPlayer(ROOT_ID);
  const forbiddenRecipe = clone(forbidden.controller.getSnapshot().recipe);
  forbiddenRecipe.selections.push({
    source: 'PACK', partKey: 'pack-slot', itemKey: 'moon', styleKey: 'glow',
    trackKey: 'accessory-track', colorChannelKey: null, defaultSwatchKey: null,
    releaseId: id(700), semanticPackId: 'moon-pack',
    externalProductId: null, ownedExternalItemId: null,
  });
  assert.throws(
    () => forbidden.controller.setRecipe(forbiddenRecipe),
    (error) => error.code === 'MAKER_V8_PLAYER_OUTPUT_PACK_FORBIDDEN',
  );
});

test('holder-owned external composables occupy exact SLOT capacity and cannot impersonate Physical assets', async () => {
  const current = harness();
  await current.controller.loadPlayer(ROOT_ID);
  const recipe = clone(current.controller.getSnapshot().recipe);
  const productId = id(720);
  const ownedItemId = id(721);
  recipe.selections.push({
    source: 'EXTERNAL', partKey: 'pack-slot', itemKey: 'third-party-hat',
    styleKey: 'violet', trackKey: 'accessory-track', colorChannelKey: null,
    defaultSwatchKey: null, releaseId: null, semanticPackId: null,
    externalProductId: productId, ownedExternalItemId: ownedItemId,
  });
  current.controller.setRecipe(recipe);
  const snapshot = current.controller.getSnapshot();
  const external = snapshot.loadout.selections.find((entry) => entry.source === 'EXTERNAL');
  const externalRecipe = snapshot.recipe.selections.find((entry) => entry.source === 'EXTERNAL');
  assert.equal(external.externalProductId, productId);
  assert.equal(external.ownedExternalItemId, ownedItemId);
  assert.equal(external.selectionIndex, 2);

  const duplicate = clone(snapshot.recipe);
  duplicate.selections.push({
    ...externalRecipe,
    partKey: 'pack-slot',
  });
  assert.throws(
    () => current.controller.setRecipe(duplicate),
    (error) => error.code === 'MAKER_V8_PLAYER_OWNED_EXTERNAL_ITEM_REUSED',
  );
  await assert.rejects(
    current.controller.preparePlayerAction({
      action: MAKER_V8_PLAYER_ACTIONS.MATERIALIZE_PHYSICAL,
      input: { ...MATERIALIZE_INPUT, selectionIndex: snapshot.loadout.selections.indexOf(external) },
    }),
    (error) => error.code === 'MAKER_V8_PLAYER_EXTERNAL_PHYSICAL_UNSUPPORTED',
  );
});

test('wallet, network, protected-content, execution gates, and target/digest drift fail in their exact layers', async () => {
  assert.throws(
    () => createMakerV8PlayerControllerV8({
      productRuntime: harness({ enabled: false }).productRuntime,
      execution: { allowWalletSignature: true, allowBroadcast: false },
    }),
    (error) => error.code === 'MAKER_V8_PLAYER_EXECUTION_GATE_INVALID',
  );

  const network = harness();
  await network.controller.loadPlayer(ROOT_ID);
  network.controls.chainIdentifier = 'wrong-chain';
  await assert.rejects(
    network.controller.preparePlayerAction({
      action: MAKER_V8_PLAYER_ACTIONS.ACQUIRE_MAKER_ACCESS,
    }),
    (error) => error.code === 'MAKER_V8_PLAYER_NETWORK_DRIFT'
      && error.layer === 'CONTEXT',
  );
  assert.equal(network.calls.account, 0);
  assert.equal(network.calls.compile, 0);

  const disconnected = harness();
  await disconnected.controller.loadPlayer(ROOT_ID);
  disconnected.controls.account = new Error('not connected');
  await assert.rejects(
    disconnected.controller.preparePlayerAction({
      action: MAKER_V8_PLAYER_ACTIONS.ACQUIRE_MAKER_ACCESS,
    }),
    (error) => error.code === 'MAKER_V8_PLAYER_WALLET_UNAVAILABLE'
      && error.layer === 'WALLET',
  );

  const protectedFlow = harness();
  await protectedFlow.controller.loadPlayer(ROOT_ID);
  protectedFlow.controls.protectedContentRequired = true;
  await assert.rejects(
    protectedFlow.controller.preparePlayerAction({
      action: MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT,
      input: RENDER_INPUT,
    }),
    (error) => error.code === 'MAKER_V8_PLAYER_PROTECTED_CONTENT_DISABLED'
      && error.layer === 'GATE',
  );
  assert.equal(protectedFlow.calls.compile, 0);

  const protectedEnabled = harness({ protectedContent: true });
  await protectedEnabled.controller.loadPlayer(ROOT_ID);
  protectedEnabled.controls.protectedContentRequired = true;
  const protectedPrepared = await protectedEnabled.controller.preparePlayerAction({
    action: MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT,
    input: RENDER_INPUT,
  });
  assert.equal(protectedPrepared.status, 'PREPARED');
  assert.equal(protectedEnabled.calls.compile, 1);

  const targetDrift = harness();
  await targetDrift.controller.loadPlayer(ROOT_ID);
  targetDrift.controls.targetOverride = targetFor(
    MAKER_V8_PLAYER_ACTIONS.MATERIALIZE_PHYSICAL,
    targetDrift.sourceRuntime,
  );
  await assert.rejects(
    targetDrift.controller.preparePlayerAction({
      action: MAKER_V8_PLAYER_ACTIONS.ACQUIRE_MAKER_ACCESS,
    }),
    (error) => error.code === 'MAKER_V8_PLAYER_TARGET_FORBIDDEN'
      && error.layer === 'COMPILER',
  );
  assert.equal(targetDrift.calls.build, 0);

  const digestDrift = harness();
  await digestDrift.controller.loadPlayer(ROOT_ID);
  digestDrift.controls.digestOverride = 'wrong-digest';
  await assert.rejects(
    digestDrift.controller.preparePlayerAction({
      action: MAKER_V8_PLAYER_ACTIONS.ACQUIRE_MAKER_ACCESS,
    }),
    (error) => error.code === 'MAKER_V8_PLAYER_TRANSACTION_DRIFT'
      && error.layer === 'BUILD',
  );
  assert.equal(digestDrift.calls.create, 0);
  assert.equal(digestDrift.calls.sign, 0);
});

test('broadcast uncertainty recovers query-first without replacement signing', async () => {
  const current = harness();
  await current.controller.loadPlayer(ROOT_ID);
  const prepared = await current.controller.preparePlayerAction({
    action: MAKER_V8_PLAYER_ACTIONS.ACQUIRE_MAKER_ACCESS,
  });
  current.controls.broadcastError = new Error('connection lost after send');
  await assert.rejects(
    current.controller.executePlayerAction(prepared.actionId),
    (error) => error.code === 'MAKER_V8_PLAYER_BROADCAST_OUTCOME_UNKNOWN'
      && error.layer === 'BROADCAST' && error.retryable === true,
  );
  assert.equal(current.persistence.inspect(prepared.actionId).status, 'SIGNED');
  assert.equal(current.calls.sign, 1);
  assert.equal(current.calls.query, 0);

  current.controls.broadcastError = null;
  current.controls.queryResults.push(finalizedSuccess(
    current.persistence.inspect(prepared.actionId).transaction.digest,
  ));
  const recovered = await current.controller.recoverPlayerAction(prepared.actionId);
  assert.equal(recovered.status, 'FINALIZED_SUCCESS');
  assert.equal(current.calls.sign, 1);
  assert.equal(current.calls.broadcast, 1);
  assert.equal(current.calls.query, 1);
  assert.equal(current.calls.readback, 1);
  assert.ok(current.calls.order.lastIndexOf('query') < current.calls.order.lastIndexOf('readback'));
});

test('prepare resumes an existing acquisition before already-owned custody preflight', async () => {
  const current = harness();
  await current.controller.loadPlayer(ROOT_ID);
  const input = { action: MAKER_V8_PLAYER_ACTIONS.ACQUIRE_MAKER_ACCESS };
  const prepared = await current.controller.preparePlayerAction(input);
  current.controls.broadcastError = new Error('response lost');
  await assert.rejects(current.controller.executePlayerAction(prepared.actionId));
  const custodyCalls = current.calls.custody;
  current.controls.custodyError = new Error('Maker access is already owned');
  current.controls.queryResults.push(finalizedSuccess(
    current.persistence.inspect(prepared.actionId).transaction.digest));
  const resumed = await current.controller.preparePlayerAction(input);
  assert.equal(resumed.actionId, prepared.actionId);
  assert.equal(resumed.status, 'FINALIZED_SUCCESS');
  assert.equal(current.calls.custody, custodyCalls);
  assert.equal(current.calls.sign, 1);
  assert.equal(current.calls.broadcast, 1);
});

test('NOT_FOUND recovery never signs again and replays only the identical persisted artifact when explicit', async () => {
  const current = harness();
  await current.controller.loadPlayer(ROOT_ID);
  const prepared = await current.controller.preparePlayerAction({
    action: MAKER_V8_PLAYER_ACTIONS.ACQUIRE_MAKER_ACCESS,
  });
  current.controls.broadcastError = new Error('uncertain send');
  await assert.rejects(current.controller.executePlayerAction(prepared.actionId));
  current.controls.broadcastError = null;
  const digest = current.persistence.inspect(prepared.actionId).transaction.digest;
  current.controls.queryResults.push(notFound(digest));
  const observed = await current.controller.recoverPlayerAction(
    prepared.actionId,
    { replayIfNotFound: false },
  );
  assert.equal(observed.status, 'OUTCOME_UNKNOWN');
  assert.equal(observed.recoveryState, 'NOT_FOUND_REPLAY_AVAILABLE');
  assert.equal(current.calls.broadcast, 1);
  assert.equal(current.calls.sign, 1);

  current.controls.queryResults.push(notFound(digest));
  const replayed = await current.controller.recoverPlayerAction(
    prepared.actionId,
    { replayIfNotFound: true },
  );
  assert.equal(replayed.status, 'BROADCAST_ACCEPTED');
  assert.equal(replayed.recoveryState, 'REPLAYED_EXACT_SIGNATURE');
  assert.equal(current.calls.broadcast, 2);
  assert.equal(current.calls.sign, 1);
  assert.equal(current.calls.verify, 2);
  const lastQuery = current.calls.order.lastIndexOf('query');
  const lastBroadcast = current.calls.order.lastIndexOf('broadcast');
  assert.ok(lastQuery < lastBroadcast);
});

test('Pack acquisition remains the same pending operation after a visible recipe color change', async () => {
  const current = harness();
  await current.controller.loadPlayer(ROOT_ID);
  const input = { action: MAKER_V8_PLAYER_ACTIONS.ACQUIRE_PACK_ACCESS,
    input: { releaseId: id(700), semanticPackId: 'moon-pack' } };
  const prepared = await current.controller.preparePlayerAction(input);
  current.controller.updateRecipe({ colors: [{ channelKey: 'primary', swatchKey: 'blue' }] });
  const resumed = await current.controller.preparePlayerAction(input);
  assert.equal(resumed.actionId, prepared.actionId);
  assert.equal(current.calls.compile, 1);
  assert.equal(current.calls.create, 1);
  assert.equal(current.calls.sign, 0);
  assert.equal(current.calls.broadcast, 0);
});

test('entry recovery after recipe changes queries the original signed Pack purchase instead of compiling or paying again', async () => {
  const current = harness();
  await current.controller.loadPlayer(ROOT_ID);
  const input = { action: MAKER_V8_PLAYER_ACTIONS.ACQUIRE_PACK_ACCESS,
    input: { releaseId: id(700), semanticPackId: 'moon-pack' } };
  const prepared = await current.controller.preparePlayerAction(input);
  current.controls.broadcastError = new Error('response lost');
  await assert.rejects(current.controller.executePlayerAction(prepared.actionId));
  const original = current.persistence.inspect(prepared.actionId);
  current.controller.updateRecipe({ colors: [{ channelKey: 'primary', swatchKey: 'blue' }] });
  current.controls.custodyError = new Error('must query original transaction before new purchase preflight');
  current.controls.queryResults.push(finalizedSuccess(original.transaction.digest));
  const resumed = await current.controller.preparePlayerAction(input);
  assert.equal(resumed.actionId, prepared.actionId);
  assert.equal(resumed.status, 'FINALIZED_SUCCESS');
  assert.equal(current.calls.compile, 1);
  assert.equal(current.calls.create, 1);
  assert.equal(current.calls.sign, 1);
  assert.equal(current.calls.broadcast, 1);
  assert.deepEqual(current.persistence.inspect(prepared.actionId).transaction, original.transaction);
});

test('pending Root discovery survives unavailable Pack custody without signing, querying, or rebuilding', async () => {
  const current = harness();
  await current.controller.loadPlayer(ROOT_ID);
  assert.equal(await current.controller.getPendingPlayerAction(), null);
  const prepared = await current.controller.preparePlayerAction({ action: MAKER_V8_PLAYER_ACTIONS.ACQUIRE_PACK_ACCESS,
    input: { releaseId: id(700), semanticPackId: 'moon-pack' } });
  current.controls.broadcastError = new Error('response lost');
  await assert.rejects(current.controller.executePlayerAction(prepared.actionId));
  current.controls.custodyError = new Error('Release is no longer purchasable');
  current.controls.compilerError = new Error('Do not rebuild');
  const before = { compile: current.calls.compile, sign: current.calls.sign,
    broadcast: current.calls.broadcast, order: current.calls.order.length };
  const pending = await current.controller.getPendingPlayerAction();
  assert.equal(pending.actionId, prepared.actionId);
  assert.equal(pending.status, 'SIGNED');
  assert.equal(current.calls.compile, before.compile);
  assert.equal(current.calls.sign, before.sign);
  assert.equal(current.calls.broadcast, before.broadcast);
  assert.equal(current.calls.order.slice(before.order).includes('query'), false);
  current.controls.catalogError = new Error('Current Player catalog cannot load');
  const failedLoad = await current.controller.loadPlayer(ROOT_ID);
  assert.equal(failedLoad.status, 'ERROR');
  assert.equal(failedLoad.player, null);
  const withoutPlayer = await current.controller.getPendingPlayerAction({ rootId: ROOT_ID });
  assert.equal(withoutPlayer.actionId, prepared.actionId);
  assert.equal(current.calls.sign, before.sign);
  assert.equal(current.calls.broadcast, before.broadcast);
});

test('entry recovery keeps different Pack releases isolated while Complete remains recipe-bound', async () => {
  const current = harness();
  await current.controller.loadPlayer(ROOT_ID);
  const first = await current.controller.preparePlayerAction({ action: MAKER_V8_PLAYER_ACTIONS.ACQUIRE_PACK_ACCESS,
    input: { releaseId: id(700), semanticPackId: 'moon-pack' } });
  const other = await current.controller.preparePlayerAction({ action: MAKER_V8_PLAYER_ACTIONS.ACQUIRE_PACK_ACCESS,
    input: { releaseId: id(701), semanticPackId: 'sun-pack' } });
  assert.notEqual(first.actionId, other.actionId);
  assert.notEqual(current.persistence.inspect(first.actionId).scopeKey, current.persistence.inspect(other.actionId).scopeKey);
  const before = await current.controller.preparePlayerAction({ action: MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT, input: RENDER_INPUT });
  current.controller.updateRecipe({ colors: [{ channelKey: 'primary', swatchKey: 'blue' }] });
  const after = await current.controller.preparePlayerAction({ action: MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT, input: RENDER_INPUT });
  assert.notEqual(current.persistence.inspect(before.actionId).scopeKey, current.persistence.inspect(after.actionId).scopeKey);
  assert.equal(current.calls.sign, 0);
});

test('NOT_FOUND beyond the signed epoch expires terminally without replay or replacement signing', async () => {
  const current = harness();
  await current.controller.loadPlayer(ROOT_ID);
  const prepared = await current.controller.preparePlayerAction({
    action: MAKER_V8_PLAYER_ACTIONS.ACQUIRE_MAKER_ACCESS,
  });
  current.controls.broadcastError = new Error('uncertain send');
  await assert.rejects(current.controller.executePlayerAction(prepared.actionId));
  current.controls.broadcastError = null;
  const digest = current.persistence.inspect(prepared.actionId).transaction.digest;
  current.controls.queryResults.push(notFound(digest, '102'));
  const expired = await current.controller.recoverPlayerAction(
    prepared.actionId,
    { replayIfNotFound: true },
  );
  assert.equal(expired.status, 'EXPIRED_NOT_FOUND');
  assert.equal(current.calls.broadcast, 1);
  assert.equal(current.calls.sign, 1);
  assert.equal(current.persistence.inspect(prepared.actionId).status, 'EXPIRED_NOT_FOUND');
});

test('finalized failure is terminal while readback failure remains visibly retryable and never rebroadcasts', async () => {
  const failed = harness();
  await failed.controller.loadPlayer(ROOT_ID);
  const preparedFailure = await failed.controller.preparePlayerAction({
    action: MAKER_V8_PLAYER_ACTIONS.ACQUIRE_MAKER_ACCESS,
  });
  const failureDigest = failed.persistence.inspect(preparedFailure.actionId).transaction.digest;
  failed.controls.queryResults.push(finalizedFailure(failureDigest, 'Move abort 42'));
  const terminal = await failed.controller.executePlayerAction(preparedFailure.actionId);
  assert.equal(terminal.status, 'FINALIZED_FAILURE');
  assert.equal(terminal.error.layer, 'FINALITY');
  assert.equal(failed.calls.readback, 0);

  const unreadable = harness();
  await unreadable.controller.loadPlayer(ROOT_ID);
  const preparedReadback = await unreadable.controller.preparePlayerAction({
    action: MAKER_V8_PLAYER_ACTIONS.ACQUIRE_MAKER_ACCESS,
  });
  unreadable.controls.readbackError = new Error('historical object unavailable');
  await assert.rejects(
    unreadable.controller.executePlayerAction(preparedReadback.actionId),
    (error) => error.code === 'MAKER_V8_PLAYER_READBACK_FAILED'
      && error.layer === 'READBACK' && error.retryable === true,
  );
  assert.equal(
    unreadable.persistence.inspect(preparedReadback.actionId).status,
    'FINALIZED_UNCERTIFIED',
  );
  const broadcasts = unreadable.calls.broadcast;
  unreadable.controls.readbackError = null;
  unreadable.controls.queryResults.push(finalizedSuccess(
    unreadable.persistence.inspect(preparedReadback.actionId).transaction.digest,
  ));
  const certified = await unreadable.controller.recoverPlayerAction(preparedReadback.actionId);
  assert.equal(certified.status, 'FINALIZED_SUCCESS');
  assert.equal(unreadable.calls.broadcast, broadcasts);
  assert.equal(unreadable.calls.sign, 1);
});

test('wallet definitive rejection returns to PREPARED, while uncertain signing never auto-retries', async () => {
  const rejected = harness();
  await rejected.controller.loadPlayer(ROOT_ID);
  const prepared = await rejected.controller.preparePlayerAction({
    action: MAKER_V8_PLAYER_ACTIONS.ACQUIRE_MAKER_ACCESS,
  });
  const rejection = new Error('user rejected');
  rejection.definitiveRejection = true;
  rejection.signedArtifactCreated = false;
  rejected.controls.signError = rejection;
  await assert.rejects(
    rejected.controller.executePlayerAction(prepared.actionId),
    (error) => error.code === 'MAKER_V8_PLAYER_WALLET_REQUEST_REJECTED',
  );
  assert.equal(rejected.persistence.inspect(prepared.actionId).status, 'PREPARED');
  assert.equal(rejected.calls.broadcast, 0);

  const uncertain = harness();
  await uncertain.controller.loadPlayer(ROOT_ID);
  const uncertainPrepared = await uncertain.controller.preparePlayerAction({
    action: MAKER_V8_PLAYER_ACTIONS.ACQUIRE_MAKER_ACCESS,
  });
  uncertain.controls.signError = new Error('wallet channel disappeared');
  await assert.rejects(
    uncertain.controller.executePlayerAction(uncertainPrepared.actionId),
    (error) => error.code === 'MAKER_V8_PLAYER_SIGNATURE_OUTCOME_UNKNOWN',
  );
  assert.equal(
    uncertain.persistence.inspect(uncertainPrepared.actionId).status,
    'SIGNING_UNKNOWN',
  );
  const recovery = await uncertain.controller.recoverPlayerAction(uncertainPrepared.actionId);
  assert.equal(recovery.recoveryState, 'SIGNATURE_OUTCOME_UNKNOWN');
  assert.equal(uncertain.calls.sign, 1);
  assert.equal(uncertain.calls.broadcast, 0);
});

test('controller errors expose stable code/layer/retryable metadata', () => {
  const error = new MakerV8PlayerControllerError(
    'TEST_PLAYER_ERROR', 'visible', 'READBACK', { objectId: ROOT_ID }, true,
  );
  assert.equal(error.name, 'MakerV8PlayerControllerError');
  assert.equal(error.code, 'TEST_PLAYER_ERROR');
  assert.equal(error.layer, 'READBACK');
  assert.equal(error.retryable, true);
  assert.equal(error.details.objectId, ROOT_ID);
  assert.equal(Object.isFrozen(error.details), true);
});


test('Player controller accepts production ValidDuring and retains exact legacy Epoch recovery bytes', async () => {
  for (const expiration of [makerV8PublicationExpiration('100'), { Epoch: '101' }]) {
    const h = harness();
    h.controls.expirationOverride = expiration;
    await h.controller.loadPlayer(h.player.rootId);
    const prepared = await h.controller.preparePlayerAction({ action: MAKER_V8_PLAYER_ACTIONS.ACQUIRE_MAKER_ACCESS });
    const original = h.persistence.inspect(prepared.actionId).transaction;
    const resumed = await h.controller.preparePlayerAction({ action: MAKER_V8_PLAYER_ACTIONS.ACQUIRE_MAKER_ACCESS });
    assert.equal(resumed.actionId, prepared.actionId);
    assert.deepEqual(h.persistence.inspect(resumed.actionId).transaction, original);
    assert.equal(h.calls.sign, 0);
    assert.equal(h.calls.broadcast, 0);
  }
});

test('Player controller rejects expiration chain/window/timestamp drift before simulation or signing', async () => {
  const mutations = [
    e => { e.ValidDuring.chain = GAS_DIGEST; },
    e => { e.ValidDuring.minEpoch = '99'; },
    e => { e.ValidDuring.maxEpoch = '102'; },
    e => { e.ValidDuring.minEpoch = null; },
    e => { e.ValidDuring.maxEpoch = null; },
    e => { e.ValidDuring.minTimestamp = '1'; },
    e => { e.ValidDuring.maxTimestamp = '1'; },
  ];
  for (const mutate of mutations) {
    const h = harness();
    const expiration = makerV8PublicationExpiration('100'); mutate(expiration);
    h.controls.expirationOverride = expiration;
    await h.controller.loadPlayer(h.player.rootId);
    await assert.rejects(h.controller.preparePlayerAction({ action: MAKER_V8_PLAYER_ACTIONS.ACQUIRE_MAKER_ACCESS }),
      { code: 'MAKER_V8_PLAYER_TRANSACTION_DRIFT' });
    assert.equal(h.calls.dryRun, 0); assert.equal(h.calls.sign, 0); assert.equal(h.calls.broadcast, 0);
  }
});


test('Clock advancement survives preparation, signature preflight and cold recovery with exact transaction bytes', async () => {
  const h = harness(); h.controls.clockProgress = true;
  await h.controller.loadPlayer(h.player.rootId);
  const prepared = await h.controller.preparePlayerAction({ action: MAKER_V8_PLAYER_ACTIONS.ACQUIRE_MAKER_ACCESS });
  const original = h.persistence.inspect(prepared.actionId).transaction;
  const cold = createMakerV8PlayerControllerV8({ productRuntime: h.productRuntime,
    compiler: h.compiler, custody: h.custody, boundary: h.boundary, wallet: h.wallet,
    rpc: h.rpc, persistence: h.persistence, execution: { allowWalletSignature: true, allowBroadcast: true } });
  await cold.loadPlayer(h.player.rootId);
  const restored = await cold.preparePlayerAction({ action: MAKER_V8_PLAYER_ACTIONS.ACQUIRE_MAKER_ACCESS });
  assert.equal(restored.actionId, prepared.actionId);
  const completed = await cold.executePlayerAction(prepared.actionId);
  assert.equal(completed.status, 'FINALIZED_SUCCESS');
  assert.deepEqual(h.persistence.inspect(prepared.actionId).transaction, original);
  assert.equal(h.calls.sign, 1); assert.equal(h.calls.broadcast, 1);
});


test('Clock normalization retains ownership, fees and all nonvolatile fields, and blocks backward clock before signing', async () => {
  const mutations = [
    c => { c.builderInput.objects.clock.version = '1'; },
    c => { c.builderInput.objects.clock.fields.timestamp_ms = '1'; },
    c => { c.builderInput.objects.clock.owner.initialSharedVersion = '2'; },
    c => { c.builderInput.objects.clock.objectId = id(99); },
    c => { c.builderInput.objects.clock.type = `${id(2)}::fake::Clock`; },
    c => { c.builderInput.objects.clock.fields.extra = true; },
    c => { c.builderInput.objects.treasury.version = '2'; },
    c => { c.builderInput.fee = '1'; },
  ];
  for (const mutate of mutations) {
    const h = harness(); h.controls.clockProgress = true;
    await h.controller.loadPlayer(h.player.rootId);
    const prepared = await h.controller.preparePlayerAction({ action: MAKER_V8_PLAYER_ACTIONS.ACQUIRE_MAKER_ACCESS });
    const load = h.custody.loadPlayerContext;
    h.custody.loadPlayerContext = async request => { const c = await load(request); mutate(c); return c; };
    await assert.rejects(h.controller.executePlayerAction(prepared.actionId), { code: 'MAKER_V8_PLAYER_CONTEXT_DRIFT' });
    assert.equal(h.calls.sign, 0); assert.equal(h.calls.broadcast, 0);
    assert.equal(h.persistence.inspect(prepared.actionId).status, 'PREPARED');
  }
});

test('explicit preparation retains and retires only unsigned records missing the original custody snapshot', async () => {
  const source = harness(); source.controls.clockProgress = true;
  const compiler = source.compiler.preparePlayerAction;
  source.compiler.preparePlayerAction = async request => { const result = await compiler(request);
    result.plan.descriptor.schemaVersion = 'animacraft.maker-v8-player-descriptor.v2'; return result; };
  await source.controller.loadPlayer(source.player.rootId);
  const prepared = await source.controller.preparePlayerAction({ action: MAKER_V8_PLAYER_ACTIONS.ACQUIRE_MAKER_ACCESS });
  const legacy = source.persistence.inspect(prepared.actionId);
  delete legacy.transaction.build.custodyContext;
  legacy.plan.contextCommitment = hash('ca');
  legacy.actionId = makerV8PlayerContextCommitmentV8({ plan: legacy.plan, digest: legacy.transaction.digest });
  const cold = harness(); cold.controls.clockProgress = true;
  await cold.persistence.create(legacy);
  await cold.controller.loadPlayer(cold.player.rootId);
  const next = await cold.controller.preparePlayerAction({ action: MAKER_V8_PLAYER_ACTIONS.ACQUIRE_MAKER_ACCESS });
  assert.notEqual(next.actionId, legacy.actionId);
  const retained = cold.persistence.inspect(legacy.actionId);
  assert.equal(retained.status, 'CANCELLED_UNSIGNED');
  assert.deepEqual(retained.plan, legacy.plan); assert.deepEqual(retained.transaction, legacy.transaction);
  assert.equal(cold.calls.sign, 0); assert.equal(cold.calls.broadcast, 0);
  assert.equal(cold.persistence.inspect(next.actionId).status, 'PREPARED');
});


test('cold preparation never replaces legacy signed or uncertain records without custody snapshots', async t => {
  for (const signingUnknown of [false, true]) await t.test(signingUnknown ? 'signature outcome unknown' : 'broadcast outcome unknown', async () => {
    const h = harness();
    const compile = h.compiler.preparePlayerAction;
    h.compiler.preparePlayerAction = async request => { const result = await compile(request);
      result.plan.descriptor.schemaVersion = 'animacraft.maker-v8-player-descriptor.v2'; return result; };
    await h.controller.loadPlayer(h.player.rootId);
    const prepared = await h.controller.preparePlayerAction({ action: MAKER_V8_PLAYER_ACTIONS.ACQUIRE_MAKER_ACCESS });
    h.persistence.mutate(prepared.actionId, record => { delete record.transaction.build.custodyContext; });
    if (signingUnknown) h.controls.signError = new Error('wallet response lost');
    else h.controls.broadcastError = new Error('broadcast response lost');
    await assert.rejects(h.controller.executePlayerAction(prepared.actionId));
    const original = h.persistence.inspect(prepared.actionId);
    const counts = { compile: h.calls.compile, create: h.calls.create, sign: h.calls.sign, broadcast: h.calls.broadcast };
    if (!signingUnknown) h.controls.queryResults.push(notFound(original.transaction.digest));
    const cold = createMakerV8PlayerControllerV8({ productRuntime: h.productRuntime,
      compiler: h.compiler, custody: h.custody, boundary: h.boundary, wallet: h.wallet,
      rpc: h.rpc, persistence: h.persistence, execution: { allowWalletSignature: true, allowBroadcast: true } });
    await cold.loadPlayer(h.player.rootId);
    const recovered = await cold.preparePlayerAction({ action: MAKER_V8_PLAYER_ACTIONS.ACQUIRE_MAKER_ACCESS });
    assert.equal(recovered.actionId, original.actionId);
    assert.equal(recovered.status, signingUnknown ? 'SIGNING_UNKNOWN' : 'OUTCOME_UNKNOWN');
    const retained = h.persistence.inspect(original.actionId);
    assert.deepEqual(retained.plan, original.plan); assert.deepEqual(retained.transaction, original.transaction);
    assert.deepEqual(retained.signature, original.signature); assert.deepEqual(retained.signatureIntent, original.signatureIntent);
    assert.deepEqual({ compile: h.calls.compile, create: h.calls.create, sign: h.calls.sign, broadcast: h.calls.broadcast }, counts);
  });
});


test('cold journey reuses a live committed selection after finalized action indices are released', async () => {
  const h = harness();
  const ready = await h.controller.loadPlayer(ROOT_ID);
  const prepared = await h.controller.preparePlayerAction({ action: MAKER_V8_PLAYER_ACTIONS.COMMIT_LOADOUT });
  assert.equal((await h.controller.executePlayerAction(prepared.actionId)).status, 'FINALIZED_SUCCESS');
  const original = h.persistence.inspect(prepared.actionId);
  assert.equal(await h.persistence.resolveRootActive({ rootId: ROOT_ID, signer: HOLDER }), null);
  const cold = createMakerV8PlayerControllerV8({ productRuntime: h.productRuntime, compiler: h.compiler,
    custody: h.custody, boundary: h.boundary, wallet: h.wallet, rpc: h.rpc, persistence: h.persistence,
    execution: { allowWalletSignature: true, allowBroadcast: true }, now: () => 1000 });
  await cold.loadPlayer(ROOT_ID); cold.setRecipe(ready.recipe);
  h.controls.committedMatches = true;
  const before = clone(h.calls);
  assert.equal(await cold.reuseCommittedPlayerLoadout(), true);
  for (const key of ['compile', 'build', 'dryRun', 'sign', 'broadcast', 'create', 'cas']) {
    assert.equal(h.calls[key], before[key], key);
  }
  assert.deepEqual(h.persistence.inspect(prepared.actionId), original);
});

test('live mismatch still prepares the changed selection and never reuses a nonboolean proof', async () => {
  const h = harness(); await h.controller.loadPlayer(ROOT_ID);
  assert.equal(await h.controller.reuseCommittedPlayerLoadout(), false);
  const prepared = await h.controller.preparePlayerAction({ action: MAKER_V8_PLAYER_ACTIONS.COMMIT_LOADOUT });
  assert.equal(prepared.status, 'PREPARED');
  const original = h.persistence.inspect(prepared.actionId);
  h.controls.committedMatches = { certified: true };
  await assert.rejects(h.controller.reuseCommittedPlayerLoadout(), { code: 'MAKER_V8_PLAYER_CUSTODY_DRIFT' });
  assert.deepEqual(h.persistence.inspect(prepared.actionId), original);
  assert.equal(h.calls.sign, 0); assert.equal(h.calls.broadcast, 0);
});

test('exact unsigned duplicate is retired atomically with its bytes retained in real IndexedDB', async () => {
  const persistence = createMakerV8PlayerPersistenceV8(new IDBFactory(), {
    databaseName: 'committed-loadout-unsigned', storageManager: {
      async persist() { return true; }, async persisted() { return true; },
      async estimate() { return { quota: 100_000_000, usage: 0 }; },
    },
  });
  const h = harness({ persistenceOverride: persistence }); await h.controller.loadPlayer(ROOT_ID);
  const prepared = await h.controller.preparePlayerAction({ action: MAKER_V8_PLAYER_ACTIONS.COMMIT_LOADOUT });
  const original = await persistence.load(prepared.actionId);
  h.controls.committedMatches = true;
  assert.equal(await h.controller.reuseCommittedPlayerLoadout(), true);
  const retired = await persistence.load(prepared.actionId);
  assert.equal(retired.status, 'CANCELLED_UNSIGNED');
  for (const key of ['transaction', 'plan', 'recipe', 'loadout', 'input']) assert.deepEqual(retired[key], original[key], key);
  assert.equal(await persistence.resolveActive(original.scopeKey), null);
  assert.equal(await persistence.resolveRootActive({ rootId: ROOT_ID, signer: HOLDER }), null);
  assert.equal(h.calls.sign, 0); assert.equal(h.calls.broadcast, 0);
});

test('different scope and signed or uncertain work remains on its original recovery path', async () => {
  for (const mode of ['other-action', 'other-recipe', 'signed', 'unknown']) {
    const h = harness(); const ready = await h.controller.loadPlayer(ROOT_ID);
    const action = mode === 'other-action' ? MAKER_V8_PLAYER_ACTIONS.ACQUIRE_MAKER_ACCESS : MAKER_V8_PLAYER_ACTIONS.COMMIT_LOADOUT;
    const prepared = await h.controller.preparePlayerAction({ action });
    if (mode === 'other-recipe') h.controller.setRecipe({ ...ready.recipe, colors: [{ channelKey: 'primary', swatchKey: 'blue' }] });
    if (mode === 'signed' || mode === 'unknown') {
      if (mode === 'signed') h.controls.broadcastError = new Error('Broadcast response lost');
      else h.controls.signError = new Error('Wallet response lost');
      await assert.rejects(h.controller.executePlayerAction(prepared.actionId));
    }
    const original = h.persistence.inspect(prepared.actionId);
    h.controls.committedMatches = true;
    let checks = 0; h.controls.onCommittedCheck = async () => { checks++; };
    assert.equal(await h.controller.reuseCommittedPlayerLoadout(), false, mode);
    assert.deepEqual(h.persistence.inspect(prepared.actionId), original, mode);
    assert.equal(checks, 0, mode);
  }
});

test('wallet switch-back and visible recipe mutation abort reuse before unsigned retirement', async () => {
  for (const mode of ['wallet', 'recipe']) {
    const h = harness(); const ready = await h.controller.loadPlayer(ROOT_ID);
    const prepared = await h.controller.preparePlayerAction({ action: MAKER_V8_PLAYER_ACTIONS.COMMIT_LOADOUT });
    const original = h.persistence.inspect(prepared.actionId);
    h.controls.committedMatches = true;
    h.controls.onCommittedCheck = async () => {
      if (mode === 'wallet') {
        h.controls.walletEvent({ address: id(903), network: 'mainnet' });
        h.controls.walletEvent({ address: HOLDER, network: 'mainnet' });
      } else h.controller.setRecipe({ ...ready.recipe, colors: [{ channelKey: 'primary', swatchKey: 'blue' }] });
    };
    await assert.rejects(h.controller.reuseCommittedPlayerLoadout(), { code: 'MAKER_V8_PLAYER_LOADOUT_REUSE_STALE' });
    assert.deepEqual(h.persistence.inspect(prepared.actionId), original);
    assert.equal(h.calls.sign, 0); assert.equal(h.calls.broadcast, 0);
  }
});

test('concurrent signing defeats unsigned retirement CAS and retains the original WAL', async () => {
  const persistence = createMakerV8PlayerPersistenceV8(new IDBFactory(), {
    databaseName: 'committed-loadout-signing-race', storageManager: {
      async persist() { return true; }, async persisted() { return true; },
      async estimate() { return { quota: 100_000_000, usage: 0 }; },
    },
  });
  const h = harness({ persistenceOverride: persistence }); await h.controller.loadPlayer(ROOT_ID);
  const prepared = await h.controller.preparePlayerAction({ action: MAKER_V8_PLAYER_ACTIONS.COMMIT_LOADOUT });
  const original = await persistence.load(prepared.actionId);
  h.controls.committedMatches = true;
  h.controls.onCommittedCheck = async () => {
    await persistence.compareAndSwap(original.actionId, original.revision, {
      ...original, revision: original.revision + 1, updatedAt: original.updatedAt + 1,
      status: 'SIGNING', signatureIntent: { sessionId: hash('ee'), startedAt: 101, leaseExpiresAt: 1001 },
    });
  };
  await assert.rejects(h.controller.reuseCommittedPlayerLoadout(), { code: 'MAKER_V8_PLAYER_PERSISTENCE_FAILED' });
  const retained = await persistence.load(original.actionId);
  assert.equal(retained.status, 'SIGNING');
  assert.deepEqual(retained.transaction, original.transaction);
  assert.equal(await persistence.resolveRootActive({ rootId: ROOT_ID, signer: HOLDER }), original.actionId);
});


test('native Complete validates all attested package calls in exact BCS order before signing', async () => {
  const fixture = nativeIntegrationFixture(runtime());
  const sourceRuntime = (await attestMakerV8Runtime(fixture.rpc, fixture.config)).runtime;
  const native = sourceRuntime.nativeSoulIntegration;
  const targets = [
    targetFor(MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT, sourceRuntime),
    `${id(2)}::coin::zero`,
    `${id(2)}::kiosk::new`,
    `${native.kioskPackageId}::personal_kiosk::new`,
    `${native.soulidityCallablePackageId}::market::mint_animacraft_v8_in_personal_kiosk`,
    `${native.soulidityCallablePackageId}::market::finalize_soul_state`,
    `${id(2)}::transfer::public_share_object`,
    `${native.kioskPackageId}::personal_kiosk::transfer_to_sender`,
  ];
  for (const mode of ['exact', 'missing-native', 'reordered-native', 'extra-native', 'wrong-native-function']) {
    const h = harness({ runtimeOverride: sourceRuntime });
    h.controls.planTargets = targets;
    h.controls.buildTargets = [...targets];
    if (mode === 'missing-native') h.controls.buildTargets.splice(4, 1);
    if (mode === 'reordered-native') [h.controls.buildTargets[4], h.controls.buildTargets[5]]
      = [h.controls.buildTargets[5], h.controls.buildTargets[4]];
    if (mode === 'extra-native') h.controls.buildTargets.push(targets[4]);
    if (mode === 'wrong-native-function') h.controls.buildTargets[4]
      = `${native.soulidityCallablePackageId}::market::unreviewed_mint`;
    assert.equal((await h.controller.loadPlayer(ROOT_ID)).status, 'READY');
    const prepare = h.controller.preparePlayerAction({ action: MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT, input: RENDER_INPUT });
    if (mode === 'exact') {
      const prepared = await prepare;
      assert.equal(prepared.status, 'PREPARED');
      assert.deepEqual(h.persistence.inspect(prepared.actionId).transaction.targets, targets);
      assert.equal(h.calls.dryRun, 1);
    } else {
      await assert.rejects(prepare, { code: 'MAKER_V8_PLAYER_TRANSACTION_TARGET_DRIFT' }, mode);
      assert.equal(h.calls.dryRun, 0);
      assert.equal(h.calls.create, 0);
    }
    assert.equal(h.calls.sign, 0);
    assert.equal(h.calls.broadcast, 0);
  }
});
