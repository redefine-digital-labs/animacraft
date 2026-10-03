import assert from 'node:assert/strict';
import test from 'node:test';
import { createCreatorCharacterStarter } from '../maker-v8-creator-structure.js';
import { packPublicationAuthoringContent } from '../maker-v8-pack-authoring.js';
import { compileMakerV8PackDefinitionRowsV8 } from '../maker-v8-pack-definitions-compiler.js';
import { packDefinitionCommitmentV8 } from '../maker-v8-pack-definition-wire.js';

import { createCharacterMakerV8Starter } from '../maker-v8-document.js';
import {
  MAKER_V8_CLOCK_OBJECT_ID,
  MAKER_V8_PAYMENT_COIN_TYPE,
  MAKER_V8_ROLE_CONFIG_ROLES,
  MAKER_V8_ROLES,
  MAKER_V8_RUNTIME_SCHEMA,
} from '../maker-v8-runtime.js';
import {
  MAKER_V8_PRODUCT_READ_ONLY_EXECUTION,
  MAKER_V8_PRODUCT_RUNTIME_SCHEMA,
  createMakerV8ProductRuntime,
  makerV8PackRenderAssetId,
  createMakerV8PackParentLoaderV8,
  getMakerV8ProductRuntime,
  initializeMakerV8ProductRuntime,
} from '../maker-v8-product-runtime.js';

const objectId = (value) => `0x${BigInt(value).toString(16).padStart(64, '0')}`;
const rootId = objectId(500);
const manifestSha256 = 'ab'.repeat(32);

test('Pack parent loader requires certified exact active Root/version/content and asset inventory', async () => {
  const document = createCharacterMakerV8Starter();
  const player = { rootId, makerVersion: '4', lifecycle: 'ACTIVE', document,
    evidence: { rootId, makerVersion: '4', contentCommitment: manifestSha256 },
    certifiedAssets: document.assets.map(asset => ({ assetId: asset.id, mediaType: asset.mediaType,
      byteLength: asset.byteLength, sha256: 'cd'.repeat(32) })) };
  let current = { status: 'READY', player };
  const load = createMakerV8PackParentLoaderV8({ loadPlayer: async requested => { assert.equal(requested, rootId); return current; } });
  const binding = { rootId, rootVersion: '4', rootContentCommitment: manifestSha256 };
  const parent = await load(binding);
  assert.deepEqual(parent.document, document);
  assert.equal(parent.assets[0].sha256, 'cd'.repeat(32));
  assert.ok(Object.isFrozen(parent.document));
  for (const mutate of [
    row => { row.status = 'ERROR'; },
    row => { row.player.rootId = objectId(999); },
    row => { row.player.makerVersion = '5'; },
    row => { row.player.lifecycle = 'PAUSED'; },
    row => { row.player.evidence.contentCommitment = 'ee'.repeat(32); },
    row => { row.player.certifiedAssets = []; },
    row => { row.player.certifiedAssets[0].byteLength += 1; },
  ]) {
    current = structuredClone({ status: 'READY', player }); mutate(current);
    await assert.rejects(load(binding), { code: 'MAKER_V8_PRODUCT_PACK_PARENT_DRIFT' });
  }
});

test('protected Pack parent uses committed plaintext identity without substituting ciphertext metadata', async () => {
  const document = structuredClone(createCharacterMakerV8Starter());
  const style = document.parts[0].items[0].styles[0];
  style.protected = true;
  style.payload.animacraftSourceAsset = { sha256: 'ab'.repeat(32), mediaType: 'image/png', byteLength: 1 };
  const player = { rootId, makerVersion: '4', lifecycle: 'ACTIVE', document,
    evidence: { rootId, makerVersion: '4', contentCommitment: manifestSha256 },
    certifiedAssets: [{ assetId: document.assets[0].id, mediaType: 'application/vnd.animacraft.seal-ciphertext',
      byteLength: 321, sha256: 'cd'.repeat(32) }] };
  let current = structuredClone(player);
  const load = createMakerV8PackParentLoaderV8({ loadPlayer: async () => ({ status: 'READY', player: current }) });
  const binding = { rootId, rootVersion: '4', rootContentCommitment: manifestSha256 };
  const parent = await load(binding);
  assert.equal(parent.assets[0].sha256, 'ab'.repeat(32));
  assert.equal(parent.assets[0].mediaType, 'image/png');
  assert.equal(parent.assets[0].byteLength, 1);
  current.certifiedAssets[0].sha256 = 'ef'.repeat(32);
  current.certifiedAssets[0].byteLength = 400;
  assert.deepEqual((await load(binding)).assets, parent.assets);
  assert.equal(current.certifiedAssets[0].byteLength, 400, 'ciphertext record remains intact');
  for (const mutate of [
    row => { delete row.document.parts[0].items[0].styles[0].payload.animacraftSourceAsset; },
    row => { row.document.parts[0].items[0].styles[0].payload.animacraftSourceAsset.byteLength = 2; },
    row => { row.certifiedAssets[0].sha256 = 'invalid'; },
    row => { row.certifiedAssets[0].mediaType = 'image/png'; },
    row => { row.certifiedAssets[0].byteLength = 0; },
    row => { row.document.parts[0].items[0].styles.push({ ...structuredClone(style), key: 'shared' }); },
  ]) {
    current = structuredClone(player); mutate(current);
    await assert.rejects(load(binding), { code: 'MAKER_V8_PRODUCT_PACK_PARENT_DRIFT' });
  }
});

function runtime() {
  return {
    schemaVersion: MAKER_V8_RUNTIME_SCHEMA,
    protocolVersion: 8,
    enabled: true,
    catalogId: objectId(300),
    protocolConfigId: objectId(301),
    protocolTreasuryId: objectId(302),
    paymentCoinType: MAKER_V8_PAYMENT_COIN_TYPE,
    clockObjectId: MAKER_V8_CLOCK_OBJECT_ID,
    roles: Object.fromEntries(MAKER_V8_ROLES.map((role, index) => [role, {
      typeOriginPackageId: objectId(100 + index),
      callablePackageId: objectId(100 + index),
    }])),
    roleConfigIds: Object.fromEntries(MAKER_V8_ROLE_CONFIG_ROLES.map((role, index) => (
      [role, objectId(200 + index)]
    ))),
    makerBindings: [],
  };
}

function productFixture() {
  const document = structuredClone(createCharacterMakerV8Starter({
    makerKey: 'product-maker',
    name: 'Product Maker',
  }));
  document.metadata.coverAssetId = 'base-default';
  const manifest = {
    schemaVersion: 'animacraft.maker-v8-manifest.v2',
    protocolVersion: 8,
    document,
    certifiedAssets: [{
      assetId: 'base-default',
      blobId: 'asset-blob',
      mediaType: 'image/png',
      byteLength: 1,
      sha256: 'cd'.repeat(32),
    }],
  };
  const activation = {
    type: `${objectId(106)}::release_v8::MakerV8Activated`,
    transactionDigest: '4'.repeat(44),
    binding: { rootId },
    makerKey: 'product-maker',
  };
  const root = {
    objectId: rootId,
    version: 9n,
    digest: '5'.repeat(44),
    lifecycle: 'ACTIVE',
    makerKey: 'product-maker',
    makerVersion: 1n,
    creatorAddress: objectId(901),
    ownerAddress: objectId(902),
    contentCommitment: manifestSha256,
    content: { manifestBlobId: 'manifest-blob', manifestSha256 },
    rendererCommitment: '12'.repeat(32),
    binding: { baseRegistryId: objectId(903) },
    fields: {
      content: { manifest_blob_id: 'manifest-blob', manifest_sha256: Array(32).fill(0xab) },
    },
  };
  return { activation, root, manifest };
}

function harness({ ownedInventory = null, packManifestAdapter = null, publicPacks = null, loadPackDefinitions = null } = {}) {
  const fixture = productFixture();
  const calls = {
    ready: 0,
    account: 0,
    reconnect: 0,
    inventory: 0,
    asset: 0,
  };
  const chain = {
    ...(loadPackDefinitions ? { loadPackDefinitions } : {}),
    async ready() { calls.ready += 1; },
    async discover() { return [fixture.activation]; },
    async loadContext() { return { root: fixture.root }; },
    async discoverPackReleases(root) {
      assert.equal(root.objectId, rootId);
      return publicPacks ?? (ownedInventory?.packPasses ?? []).map(pass => ({ ...pass.release, admission: pass.admission }));
    },
    async inventory(address, root) {
      calls.inventory += 1;
      assert.equal(address, objectId(902));
      assert.equal(root.objectId, rootId);
      return ownedInventory ?? { adminCaps: [], soulBundles: [], physicalAssets: [] };
    },
  };
  const manifestAdapter = {
    async load(pointer) {
      return {
        schemaVersion: 'animacraft.maker-v8-manifest-read.v1',
        blobId: pointer.blobId,
        sha256: pointer.sha256,
        byteLength: 1024,
        manifest: fixture.manifest,
      };
    },
  };
  const compiler = {
    async loadTrustedContext() { return 'trusted'; },
    async assertContextFresh() { return true; },
    async recoverStage() { return 'stage'; },
    async recoverCheckpoint() { return 'checkpoint'; },
  };
  const browserAdapters = {
    wallet: {
      async getCurrentAccount() { calls.account += 1; return { address: objectId(902), network: 'mainnet' }; },
      async reconnect() { calls.reconnect += 1; return { address: objectId(902), network: 'mainnet' }; },
      subscribe(listener) { listener({ account: null }); return () => {}; },
      dispose() {},
      async signExactTransaction() { throw new Error('must not be exposed'); },
    },
    rpc: {},
    compiler,
    transactions: {
      async broadcastExactTransaction() { throw new Error('must not be exposed'); },
    },
  };
  const options = {
    runtime: runtime(),
    chain,
    manifestAdapter,
    assetAdapter: {
      schemaVersion: 'animacraft.maker-v8-certified-asset-read.v1',
      async load(asset) {
        calls.asset += 1;
        return { ...asset, schemaVersion: this.schemaVersion, bytesBase64: 'AQ==' };
      },
    },
    browserAdapters,
    ...(packManifestAdapter ? { packManifestAdapter } : {}),
  };
  return { options, fixture, calls, browserAdapters, compiler };
}

test('builds one frozen read runtime with explicit no-JSON-RPC/no-write capabilities', async () => {
  const { options, calls, browserAdapters } = harness();
  const product = createMakerV8ProductRuntime(options);

  assert.equal(product.schemaVersion, MAKER_V8_PRODUCT_RUNTIME_SCHEMA);
  assert.deepEqual(product.capabilities, {
    network: 'mainnet',
    transport: 'SUI_GRPC_GRAPHQL',
    readOnly: true,
    jsonRpc: false,
    legacyProtocol: false,
    walletSignature: false,
    broadcast: false,
  });
  assert.equal(MAKER_V8_PRODUCT_READ_ONLY_EXECUTION.allowWalletSignature, false);
  assert.equal(MAKER_V8_PRODUCT_READ_ONLY_EXECUTION.allowBroadcast, false);
  assert.equal(Object.hasOwn(product, 'transactions'), false);
  assert.equal(Object.hasOwn(product.wallet, 'signExactTransaction'), false);
  assert.equal(Object.hasOwn(product, 'rpc'), false);
  assert.equal(product.compiler, browserAdapters.compiler);
  assert.equal(Object.isFrozen(product), true);
  assert.equal(Object.hasOwn(product, 'market'), false);
  assert.equal(Object.isFrozen(product.assets), true);

  assert.equal(await product.ready(), true);
  assert.equal(calls.ready, 1);
});

test('adapts wallet, inventory, compiler and manifest-bound Player without exposing writes', async () => {
  const { options, calls } = harness();
  const product = createMakerV8ProductRuntime(options);

  assert.equal((await product.wallet.getCurrentAccount()).network, 'mainnet');
  assert.equal((await product.wallet.reconnect()).network, 'mainnet');
  assert.equal(calls.account, 1);
  assert.equal(calls.reconnect, 1);

  const inventory = await product.inventory.load({ address: objectId(902) });
  assert.equal(inventory.items.length, 0);
  assert.equal(inventory.status, 'EMPTY');
  assert.equal(inventory.rootId, null);
  assert.equal(calls.inventory, 1);

  const player = await product.catalog.loadPlayer(rootId);
  assert.equal(player.status, 'READY', JSON.stringify(player));
  assert.equal(player.player.document.lineage.makerKey, 'product-maker');
  assert.equal(await product.compiler.loadTrustedContext(), 'trusted');

  const loadedAsset = await product.assets.load(productFixture().manifest.certifiedAssets[0]);
  assert.equal(loadedAsset.bytesBase64, 'AQ==');
  assert.equal(calls.asset, 1);
});

test('inventory projects certified player content for contextual Player use and Soulidity handoff', async () => {
  const externalProductId = objectId(950);
  const { options } = harness({
    ownedInventory: {
      adminCaps: [], soulBundles: [], physicalAssets: [],
      makerAccessPasses: [{ objectId: objectId(940), paidAtomic: '0', issuedAtMs: '10' }],
      packControls: [],
      packPasses: [{ objectId: objectId(941), releaseId: objectId(960), releaseContentCommitment: '1'.repeat(64) }],
      externalControls: [],
      ownedBaseItems: [{
        objectId: objectId(942), ownershipEpoch: 3n, partKey: 'body', itemKey: 'hair',
        itemPayloadCommitment: '2'.repeat(64), equipLock: {
          loadoutId: objectId(944), equipRevision: '8', selectionIndex: '0',
        }, transferable: true,
      }],
      ownedExternalItems: [{
        objectId: objectId(943), productId: externalProductId, ownershipEpoch: 2n,
        assetContentCommitment: '3'.repeat(64), equipLock: null, transferable: true,
        product: {
          objectId: externalProductId, partKey: 'body', itemKey: 'hat', styleKey: 'violet',
        },
      }],
      makerLoadouts: [{
        objectId: objectId(944), revision: 8n, selectionCount: 1n,
        commitment: '4'.repeat(64), selections: [{ fields: { selection_index: '0' } }],
      }],
    },
  });
  const product = createMakerV8ProductRuntime(options);
  const inventory = await product.inventory.load({ address: objectId(902), rootId });
  assert.equal(inventory.status, 'READY');
  assert.equal(inventory.rootId, rootId);
  assert.deepEqual(inventory.items.map((item) => item.kind).sort(), [
    'MAKER_ACCESS', 'MAKER_LOADOUT', 'OWNED_BASE_ITEM', 'OWNED_EXTERNAL_ITEM', 'PACK_ACCESS',
  ].sort());
  assert.equal(inventory.items.find((item) => item.kind === 'OWNED_BASE_ITEM').equipped, true);
  assert.equal(inventory.items.find((item) => item.kind === 'OWNED_EXTERNAL_ITEM').styleKey, 'violet');
  assert.equal(inventory.items.find((item) => item.kind === 'MAKER_LOADOUT').selectionCount, '1');
});

test('contextual Player choices merge exact active PackPass manifests and holder-owned external Items', async () => {
  const releaseId = objectId(960);
  const externalProductId = objectId(970);
  const packContentCommitment = '1'.repeat(64);
  const { options } = harness({
    packManifestAdapter: {
      async load(input) {
        assert.deepEqual(input, {
          blobId: 'pack-manifest',
          sha256: '2'.repeat(64),
          rootId,
          rootVersion: '1',
          rootContentCommitment: manifestSha256,
          semanticPackId: 'moon_pack',
          contentCommitment: packContentCommitment,
        });
        return {
          manifest: { content: {
            metadata: { name: 'Moon Pack' },
            styles: [{
              partKey: 'body', itemKey: 'moon_hat', styleKey: 'violet',
              layerTrackKey: 'body', colorChannelKey: null, defaultSwatchKey: null,
              asset: {
                assetId: 'moon-asset', protected: false,
              },
            }],
          } },
          assets: [{
            assetId: 'moon-asset', blobId: 'moon-asset-blob', mediaType: 'image/png',
            byteLength: 10, sha256: '3'.repeat(64),
          }],
        };
      },
    },
    ownedInventory: {
      adminCaps: [], soulBundles: [], physicalAssets: [], makerAccessPasses: [],
      packControls: [], externalControls: [], makerLoadouts: [],
      ownedBaseItems: [{
        objectId: objectId(942), ownershipEpoch: 3n, partKey: 'body', itemKey: 'default',
        equipLock: null,
      }],
      packPasses: [{
        objectId: objectId(941), releaseId, releaseContentCommitment: packContentCommitment,
        release: {
          objectId: releaseId, rootId, lifecycle: 2, semanticPackId: 'moon_pack',
          manifestBlobId: 'pack-manifest', manifestSha256: '2'.repeat(64),
          contentCommitment: packContentCommitment, expectedStyleCount: '1',
          entry: { kind: 0, priceAtomic: '0', paymentCoinType: MAKER_V8_PAYMENT_COIN_TYPE },
        },
        admission: { admittedRevision: '4', admissionState: 0 },
      }],
      ownedExternalItems: [{
        objectId: objectId(943), productId: externalProductId,
        productContentCommitment: '4'.repeat(64), assetContentCommitment: '5'.repeat(64),
        ownershipEpoch: 2n,
        equipLock: null,
        product: {
          objectId: externalProductId, rootId, lifecycle: 0,
          admission: { admissionState: 0 },
          partKey: 'body', itemKey: 'external_hat', styleKey: 'blue', trackKey: 'body',
          colorChannelKey: null, defaultSwatchKey: null,
          assetBlobId: 'external-asset-blob', assetSha256: '6'.repeat(64),
          assetMediaType: 'image/png', assetByteLength: 12,
          contentCommitment: '4'.repeat(64), assetContentCommitment: '5'.repeat(64),
        },
      }],
    },
  });
  const product = createMakerV8ProductRuntime(options);
  const choices = await product.choices.load({ address: objectId(902), rootId });
  assert.equal(choices.schemaVersion, 'animacraft.maker-v8-contextual-choices.v1');
  assert.equal(choices.packStyles[0].source, 'PACK');
  assert.equal(choices.packStyles[0].releaseId, releaseId);
  assert.equal(choices.packStyles[0].assetId, makerV8PackRenderAssetId(releaseId, 'moon-asset'));
  assert.equal(choices.externalStyles[0].source, 'EXTERNAL');
  assert.equal(choices.externalStyles[0].ownedExternalItemId, objectId(943));
  assert.equal(choices.externalStyles[0].access.canEquip, true);
  assert.equal(choices.packStyles[0].access.canEquip, true);
  assert.equal(choices.baseEntitlements[0].access.canEquip, true);
  assert.equal(choices.baseEntitlements[0].ownedItemId, objectId(942));
  assert.deepEqual(choices.certifiedAssets.map((asset) => asset.blobId), [
    'external-asset-blob', 'moon-asset-blob',
  ]);
  assert.deepEqual(choices.diagnostics, []);
});

function publicPackFixture(kind = 0) {
  const release = {
    objectId: objectId(960), rootId, lifecycle: 2, semanticPackId: 'moon_pack',
    manifestBlobId: 'pack-manifest', manifestSha256: '2'.repeat(64),
    contentCommitment: '1'.repeat(64), expectedStyleCount: '1',
    entry: { kind, priceAtomic: kind === 1 ? '1250000' : '0', paymentCoinType: MAKER_V8_PAYMENT_COIN_TYPE },
    admission: { admittedRevision: '4', admissionState: 0 },
  };
  const reads = [];
  const packManifestAdapter = { async load(input) {
    reads.push(input);
    return { manifest: { content: { metadata: { name: 'Moon Pack' }, styles: [{
      partKey: 'body', itemKey: 'moon_hat', styleKey: 'violet', layerTrackKey: 'body',
      colorChannelKey: null, defaultSwatchKey: null, asset: { assetId: 'moon-asset', protected: true },
    }] } }, assets: [{ assetId: 'moon-asset', blobId: 'encrypted-asset-blob', mediaType: 'image/png',
      byteLength: 10, sha256: '3'.repeat(64), protected: true }] };
  } };
  return { release, reads, packManifestAdapter };
}

test('different Releases can expose same-named artwork without merging content identities', async () => {
  const first = publicPackFixture();
  const second = { ...structuredClone(first.release), objectId: objectId(961), semanticPackId: 'other_pack',
    manifestBlobId: 'other-manifest', manifestSha256: '4'.repeat(64) };
  const originalRead = await first.packManifestAdapter.load({});
  const original = structuredClone(originalRead);
  const { options } = harness({ publicPacks: [first.release, second], packManifestAdapter: {
    async load(input) {
      if (input.semanticPackId === first.release.semanticPackId) return originalRead;
      const read = structuredClone(originalRead);
      read.assets[0].blobId = 'other-artwork'; read.assets[0].sha256 = '5'.repeat(64);
      return read;
    },
  } });
  const product = createMakerV8ProductRuntime(options);
  const choices = await product.choices.load({ address: objectId(902), rootId });
  assert.equal(choices.packStyles.length, 2);
  const [a, b] = choices.packStyles.map(row => row.assetId);
  assert.notEqual(a, b);
  const assets = new Map(choices.certifiedAssets.map(row => [row.assetId, row]));
  assert.equal(assets.get(a).blobId, 'encrypted-asset-blob');
  assert.equal(assets.get(b).blobId, 'other-artwork');
  assert.equal(assets.get(b).sha256, '5'.repeat(64));
  assert.deepEqual(originalRead, original, 'Certified manifest IDs are not rewritten');
  assert.equal(makerV8PackRenderAssetId(first.release.objectId, 'x'.repeat(128)).length, 69);
  assert.throws(() => makerV8PackRenderAssetId('0x1', 'art'));
  assert.throws(() => makerV8PackRenderAssetId(first.release.objectId, 'x'.repeat(129)));
});

test('Pack choices retain certified authored rendering and reject index substitution', async () => {
  const f = publicPackFixture();
  const original = f.packManifestAdapter.load;
  const parent = createCreatorCharacterStarter();
  parent.assets.push({ id: 'base-image', kind: 'layer', mediaType: 'image/png', byteLength: 3 });
  for (const part of parent.parts) part.items[0].styles[0].assetId = 'base-image';
  const document = structuredClone(parent);
  const part = document.parts[0], item = part.items[0];
  const authored = { ...structuredClone(item.styles[0]), key: 'violet', assetId: 'moon-asset', trackKey: parent.tracks[0].key, protected: false,
    colorChannelKey: null, defaultSwatchKey: null, transform: { x: 12.5, y: -8, scale: 0.5, rotation: 15 },
    opacity: 0.75, blendMode: 'multiply', displayOrder: 2,
    visibleWhen: { op: 'selected', source: 'BASE', sourceKey: null, partKey: document.parts[1].key, itemKey: null, styleKey: null },
    payload: { animacraftSourceAsset: { sha256: 'ab'.repeat(32), mediaType: 'image/png', byteLength: 7 } } };
  item.styles.push(authored);
  const style = { sequence: '0', partKey: part.key, itemKey: item.key, styleKey: 'violet',
    layerTrackKey: authored.trackKey, colorChannelKey: null, defaultSwatchKey: null,
    asset: { assetId: 'moon-asset', contentCommitment: 'ab'.repeat(32), protected: false, mediaType: 'image/png', byteLength: 7 } };
  const published = packPublicationAuthoringContent({ styles: [style], authoring: document,
    bindings: { kind: 'LOCAL_DRAFT', parent: { draft: { document: parent }, assets: [{ assetId: 'base-image',
      kind: 'layer', mediaType: 'image/png', byteLength: 3, sha256: '11'.repeat(32) }] } } });
  let authoring = structuredClone(published.content);
  const compiled = await compileMakerV8PackDefinitionRowsV8(authoring, { expectedParent: authoring.parent, semanticPackId: f.release.semanticPackId });
  const commitment = Buffer.from(packDefinitionCommitmentV8(f.release.objectId, Array(32).fill(0x11), compiled.rows)).toString('hex');
  let bundle = { releaseId: f.release.objectId, contentCommitment: f.release.contentCommitment,
    semanticPackId: f.release.semanticPackId, definitionCommitment: commitment, rows: compiled.rows };
  let reads = 0;
  f.packManifestAdapter.load = async input => {
    const read = await original(input);
    read.manifest.content.authoring = authoring;
    read.manifest.content.styles = [style];
    return read;
  };
  const { options } = harness({ publicPacks: [f.release], packManifestAdapter: f.packManifestAdapter,
    loadPackDefinitions: async input => {
      assert.deepEqual(input, { releaseId: f.release.objectId, contentCommitment: f.release.contentCommitment, semanticPackId: f.release.semanticPackId });
      reads++; return bundle;
    } });
  const product = createMakerV8ProductRuntime(options);
  const load = () => product.choices.load({ address: objectId(902), rootId });
  const choice = (await load()).packStyles[0];
  const render = choice.render;
  assert.equal(reads, 1, 'All-Base Style still reads authored rule/visibility definitions');
  assert.equal(choice.definitionCommitment, commitment);
  assert.deepEqual(choice.definitionScope, {
    part: { source: 'BASE', sourceId: rootId, key: part.key },
    track: { source: 'BASE', sourceId: rootId, key: authored.trackKey },
    color: null,
  });
  assert.ok(Object.isFrozen(choice.definitionScope.track));
  const loadedContext = await product.playerContext.load({ address: objectId(902), rootId });
  assert.deepEqual(loadedContext.choices.packStyles[0], choice);
  assert.deepEqual(loadedContext.definitions.packs[0], {
    releaseId: f.release.objectId, semanticPackId: f.release.semanticPackId,
    contentCommitment: f.release.contentCommitment, definitionCommitment: commitment,
    document: authoring.document, styleReferences: compiled.styleReferences, ownedParts: compiled.ownedParts, rules: compiled.rules,
  });
  assert.equal(loadedContext.definitions.currentLoadout, null);
  assert.notEqual(loadedContext.definitions.packs[0].document, authoring.document);
  assert.deepEqual(render.transform, authored.transform);
  assert.equal(render.opacity, 0.75); assert.equal(render.blendMode, 'multiply');
  assert.deepEqual(render.sourceAsset, authored.payload.animacraftSourceAsset);
  assert.deepEqual(render.visibleWhen, authored.visibleWhen);
  assert.notEqual(render.visibleWhen, authored.visibleWhen);
  for (const key of ['parts', 'tracks']) {
    authoring = structuredClone(published.content); authoring.parent.document[key] = [];
    await assert.rejects(load());
  }
  authoring = structuredClone(published.content);
  const correctBundle = bundle;
  for (const change of [value => { value.releaseId = objectId(999); },
    value => { value.definitionCommitment = 'ff'.repeat(32); },
    value => { value.rows.visibility = []; }]) {
    bundle = structuredClone(correctBundle); change(bundle);
    await assert.rejects(load(), { code: 'MAKER_V8_PRODUCT_PACK_DEFINITIONS_DRIFT' });
  }
  bundle = correctBundle;
  style.sequence = '1';
  await assert.rejects(load(), { code: 'MAKER_V8_PRODUCT_PACK_RENDER_DRIFT' });
  style.sequence = '0';
  style.asset.assetId = 'substituted';
  await assert.rejects(load(), { code: 'MAKER_V8_PRODUCT_PACK_RENDER_DRIFT' });
  style.asset.assetId = 'moon-asset';
  authoring.document.tracks.push({ key: 'pack-overlay', label: 'Pack overlay', renderOrder: 99, locked: false });
  authoring.document.parts[0].items[0].styles.find(row => row.key === 'violet').trackKey = 'pack-overlay';
  authoring.styles[0].layerTrackKey = 'pack-overlay';
  style.layerTrackKey = 'pack-overlay';
  const ownTrack = await compileMakerV8PackDefinitionRowsV8(authoring, { expectedParent: authoring.parent, semanticPackId: f.release.semanticPackId });
  bundle = { ...correctBundle, rows: ownTrack.rows,
    definitionCommitment: Buffer.from(packDefinitionCommitmentV8(f.release.objectId, Array(32).fill(0x11), ownTrack.rows)).toString('hex') };
  const ownChoice = (await load()).packStyles[0];
  assert.deepEqual(ownChoice.definitionScope.track, { source: 'PACK', sourceId: f.release.objectId, key: 'pack-overlay' });
  assert.equal((await product.playerContext.load({ address: objectId(902), rootId })).definitions.packs[0].document.tracks.at(-1).renderOrder, 99);
  const ownPart = structuredClone(authoring.document.parts[0]);
  ownPart.key = 'plume'; ownPart.label = 'Plume'; ownPart.required = false;
  ownPart.menuOrder = 99;
  ownPart.items = [structuredClone(ownPart.items[0])];
  ownPart.items[0].styles = ownPart.items[0].styles.filter(row => row.key === 'violet');
  ownPart.items[0].defaultStyleKey = 'violet';
  authoring.document.parts[0].items[0].styles = authoring.document.parts[0].items[0].styles.filter(row => row.key !== 'violet');
  authoring.document.parts.push(ownPart);
  authoring.styles[0].partKey = style.partKey = 'plume';
  const ownCompiled = await compileMakerV8PackDefinitionRowsV8(authoring, { expectedParent: authoring.parent, semanticPackId: f.release.semanticPackId });
  bundle = { ...correctBundle, rows: ownCompiled.rows,
    definitionCommitment: Buffer.from(packDefinitionCommitmentV8(f.release.objectId, Array(32).fill(0x11), ownCompiled.rows)).toString('hex') };
  const ownPartChoice = (await load()).packStyles[0];
  assert.deepEqual(ownPartChoice.definitionScope.part, { source: 'PACK', sourceId: f.release.objectId, key: 'plume' });
  assert.equal(parent.parts.some(row => row.key === 'plume'), false);
  authoring.document.colors.push({ key: 'pack-color', label: 'Pack Color', defaultSwatchKey: 'red',
    swatches: [{ key: 'red', label: 'Red', rgba: '#ff0000ff', stops: [] }] });
  for (const row of [authoring.document.parts.at(-1).items[0].styles[0], authoring.styles[0], style]) {
    row.colorChannelKey = 'pack-color'; row.defaultSwatchKey = 'red';
  }
  const colored = await compileMakerV8PackDefinitionRowsV8(authoring, { expectedParent: authoring.parent, semanticPackId: f.release.semanticPackId });
  bundle = { ...correctBundle, rows: colored.rows,
    definitionCommitment: Buffer.from(packDefinitionCommitmentV8(f.release.objectId, Array(32).fill(0x11), colored.rows)).toString('hex') };
  assert.deepEqual((await load()).packStyles[0].definitionScope.color,
    { source: 'PACK', sourceId: f.release.objectId, key: 'pack-color' });
});

test('unowned public free/paid/included Packs are visible without granting equip or fetching protected asset bytes', async t => {
  for (const kind of [0, 1, 2]) for (const makerAccess of [false, true]) {
    await t.test(`kind ${kind}, MakerAccess ${makerAccess}`, async () => {
      const f = publicPackFixture(kind);
      const { options, calls } = harness({ publicPacks: [f.release], packManifestAdapter: f.packManifestAdapter,
        ownedInventory: { packPasses: [], makerAccessPasses: makerAccess ? [{ objectId: objectId(980) }] : [] } });
      const choices = await createMakerV8ProductRuntime(options).choices.load({ address: objectId(902), rootId });
      assert.equal(choices.packStyles.length, 1);
      const choice = choices.packStyles[0];
      assert.equal(choice.owned, false);
      assert.deepEqual(choice.entry, f.release.entry);
      assert.equal(choice.access.accessible, false);
      assert.equal(choice.access.canEquip, false);
      assert.equal(choice.access.availableForAcquire, kind !== 2 || makerAccess);
      assert.ok(choice.access.reason.length > 0);
      assert.equal(calls.asset, 0, 'public manifest descriptors do not authorize protected asset reads');
      assert.equal(f.reads.length, 1);
      assert.equal(f.reads[0].contentCommitment, f.release.contentCommitment);
      assert.equal(choices.certifiedAssets.length, 1);
    });
  }
});

test('owned Pack merges into one public release choice and cannot be purchased twice', async () => {
  const f = publicPackFixture(1);
  const pass = { objectId: objectId(941), releaseId: f.release.objectId,
    releaseContentCommitment: f.release.contentCommitment, release: f.release, admission: f.release.admission };
  const { options } = harness({ publicPacks: [f.release], packManifestAdapter: f.packManifestAdapter,
    ownedInventory: { packPasses: [pass, { ...pass, objectId: objectId(942) }], makerAccessPasses: [] } });
  const choices = await createMakerV8ProductRuntime(options).choices.load({ address: objectId(902), rootId });
  assert.equal(choices.packStyles.length, 1);
  assert.equal(f.reads.length, 1);
  assert.equal(choices.packStyles[0].owned, true);
  assert.deepEqual(choices.packStyles[0].access, { accessible: true, canEquip: true, availableForAcquire: false, reason: '' });
});

test('Pack choices fail closed on public policy drift or owned/public evidence mismatch', async t => {
  for (const [label, mutate] of Object.entries({
    anotherRoot: f => { f.release.rootId = objectId(999); },
    paused: f => { f.release.lifecycle = 3; },
    revoked: f => { f.release.admission.admissionState = 1; },
    noEntry: f => { delete f.release.entry; },
    invalidKind: f => { f.release.entry.kind = 3; },
    paidZero: f => { f.release.entry.priceAtomic = '0'; },
    paidOverflow: f => { f.release.entry.priceAtomic = '1000000000001'; },
    anotherCoin: f => { f.release.entry.paymentCoinType = '0x2::sui::SUI'; },
    duplicateRelease: f => { f.publicPacks.push(f.release); },
    ownedMissingPublic: f => { f.publicPacks.length = 0; },
    ownedCommitment: f => { f.pass.releaseContentCommitment = '9'.repeat(64); },
    ownedPrice: f => { f.pass.release.entry.priceAtomic = '999'; },
    ownedAdmission: f => { f.pass.admission.admissionState = 1; },
  })) await t.test(label, async () => {
    const f = publicPackFixture(1);
    f.publicPacks = [f.release];
    f.pass = { objectId: objectId(941), releaseId: f.release.objectId,
      releaseContentCommitment: f.release.contentCommitment, release: structuredClone(f.release),
      admission: structuredClone(f.release.admission) };
    mutate(f);
    const { options } = harness({ publicPacks: f.publicPacks, packManifestAdapter: f.packManifestAdapter,
      ownedInventory: { packPasses: [f.pass], makerAccessPasses: [] } });
    await assert.rejects(createMakerV8ProductRuntime(options).choices.load({ address: objectId(902), rootId }),
      { code: 'MAKER_V8_PRODUCT_PACK_CHOICE_DRIFT' });
    assert.equal(f.reads.length, 0);
  });
});

test('choices retain current-loadout locks and block absent admission without duplicating Product assets', async () => {
  const productId = objectId(950), itemId = objectId(951), loadoutId = objectId(952);
  const item = { objectId: itemId, productId, productContentCommitment: '4'.repeat(64), assetContentCommitment: '5'.repeat(64), ownershipEpoch: 2n, equipLock: null,
    product: { objectId: productId, rootId, lifecycle: 0, admission: { admissionState: 0 }, partKey: 'body', itemKey: 'hat', styleKey: 'blue', trackKey: 'body',
      colorChannelKey: null, defaultSwatchKey: null, contentCommitment: '4'.repeat(64), assetContentCommitment: '5'.repeat(64),
      assetBlobId: 'actual', assetSha256: '6'.repeat(64), assetByteLength: 12, assetMediaType: 'image/png' } };
  const owned = { ownedExternalItems: [item, { ...structuredClone(item), objectId: objectId(953) }], ownedBaseItems: [], packPasses: [], makerLoadouts: [] };
  const { options } = harness({ ownedInventory: owned }); const product = createMakerV8ProductRuntime(options);
  const load = () => product.choices.load({ address: objectId(902), rootId });
  let choices = await load(); assert.equal(choices.externalStyles.length, 2); assert.equal(choices.certifiedAssets.length, 1);
  assert.equal(choices.externalStyles[0].ownershipEpoch, '2');
  item.equipLock = { loadoutId, equipRevision: '3', selectionIndex: '0' };
  assert.equal((await load()).externalStyles[0].access.canEquip, false);
  owned.makerLoadouts = [{ objectId: loadoutId, rootId, holder: objectId(902), revision: '4',
    packDefinitionLayout: { bindings: [], profiles: [] }, selections: [{ fields: { vec: [{ fields: {
    selection_index: '0', access_subject: itemId, source_epoch: '2', source_class: '2', source_definition_id: productId,
    part_key: 'body', item_key: 'hat', style_key: 'blue',
  } }] } }] }];
  choices = await load(); assert.equal(choices.externalStyles[0].access.canEquip, true);
  assert.equal(choices.externalStyles[0].access.equippedInCurrentLoadout, true);
  assert.deepEqual(choices.externalStyles[0].equipLock, item.equipLock);
  const context = await product.playerContext.load({ address: objectId(902), rootId });
  assert.deepEqual(context.definitions.currentLoadout, {
    objectId: loadoutId, revision: '4', layout: { bindings: [], profiles: [] },
  });
  item.ownershipEpoch = 3n; assert.equal((await load()).externalStyles[0].access.canEquip, false); item.ownershipEpoch = 2n;
  item.product.admission = null; assert.match((await load()).externalStyles[0].access.reason, /not been admitted/);
  item.product.admission = { admissionState: 1 }; assert.equal((await load()).externalStyles[0].access.canEquip, false);
  item.product.admission = { admissionState: 0 }; delete item.equipLock;
  assert.equal((await load()).externalStyles[0].access.canEquip, false); item.equipLock = null;
  owned.ownedExternalItems[1].product.assetSha256 = '7'.repeat(64);
  await assert.rejects(load(), { code: 'MAKER_V8_PRODUCT_EXTERNAL_ASSET_DRIFT' });
});

test('application singleton is stable and refuses silent reconfiguration', () => {
  const first = harness();
  const initialized = initializeMakerV8ProductRuntime(first.options);
  assert.equal(initializeMakerV8ProductRuntime(first.options), initialized);
  assert.equal(initializeMakerV8ProductRuntime(), initialized);
  assert.equal(getMakerV8ProductRuntime(), initialized);

  const second = harness();
  assert.throws(
    () => initializeMakerV8ProductRuntime(second.options),
    (error) => error.code === 'MAKER_V8_PRODUCT_SINGLETON_RECONFIGURE_FORBIDDEN',
  );
});
