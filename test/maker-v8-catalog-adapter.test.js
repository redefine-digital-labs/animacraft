import assert from 'node:assert/strict';
import test from 'node:test';

import { createCharacterMakerV8Starter } from '../maker-v8-document.js';
import {
  MAKER_V8_PLAYER_VIEW_SCHEMA,
  MAKER_V8_PLAZA_VIEW_SCHEMA,
  createMakerV8CatalogAdapter,
} from '../maker-v8-catalog-adapter.js';

const objectId = (value) => `0x${BigInt(value).toString(16).padStart(64, '0')}`;
const rootId = objectId(100);
const manifestSha256 = 'ab'.repeat(32);

function manifest() {
  const document = structuredClone(createCharacterMakerV8Starter({
    makerKey: 'catalog-maker',
    name: 'Catalog Maker',
  }));
  document.metadata.summary = 'A strict public Maker';
  document.metadata.coverAssetId = 'base-default';
  return {
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
}

function activation(id = rootId, makerKey = 'catalog-maker') {
  return {
    type: `${objectId(7)}::release_v8::MakerV8Activated`,
    transactionDigest: '4'.repeat(44),
    binding: { rootId: id },
    makerKey,
  };
}

function root({
  id = rootId,
  lifecycle = 'ACTIVE',
  makerKey = 'catalog-maker',
  sha256 = manifestSha256,
  makerVersion = 1,
  versionCommitment = '11'.repeat(32),
  previousRootId = null,
  previousVersionCommitment = null,
  successorRootId = null,
} = {}) {
  return {
    objectId: id,
    version: 9n,
    digest: '5'.repeat(44),
    lifecycle,
    makerKey,
    makerVersion: BigInt(makerVersion),
    versionCommitment,
    previousRootId,
    previousVersionCommitment,
    successorRootId,
    creatorAddress: objectId(901),
    ownerAddress: objectId(902),
    contentCommitment: sha256,
    rendererCommitment: 'aa'.repeat(32),
    content: {
      manifestBlobId: `manifest-${id.slice(-4)}`,
      manifestSha256: sha256,
    },
  };
}

function manifestRead(value = manifest(), overrides = {}) {
  return {
    schemaVersion: 'animacraft.maker-v8-manifest-read.v1',
    blobId: `manifest-${rootId.slice(-4)}`,
    sha256: manifestSha256,
    byteLength: 1024,
    manifest: value,
    ...overrides,
  };
}

function adapter({ activations = [activation()], loadContext, loadManifest } = {}) {
  const chain = {
    async discover() { return activations; },
    async loadContext(value) {
      if (loadContext) return loadContext(value);
      return { root: root({ id: value.binding.rootId, makerKey: value.makerKey }) };
    },
  };
  const manifests = {
    async load(pointer) {
      if (loadManifest) return loadManifest(pointer);
      return manifestRead(manifest(), { blobId: pointer.blobId, sha256: pointer.sha256 });
    },
  };
  return createMakerV8CatalogAdapter({ chain, manifests });
}

test('resolves Activation to exact ACTIVE Root and emits Plaza and Player view models', async () => {
  const catalog = adapter();
  const plaza = await catalog.loadPlaza();

  assert.equal(plaza.schemaVersion, MAKER_V8_PLAZA_VIEW_SCHEMA);
  assert.equal(plaza.status, 'READY');
  assert.equal(plaza.makers.length, 1);
  assert.equal(plaza.makers[0].rootId, rootId);
  assert.equal(plaza.makers[0].title, 'Catalog Maker');
  assert.equal(plaza.makers[0].coverAsset.blobId, 'asset-blob');
  assert.equal(plaza.makers[0].evidence.manifestSha256, manifestSha256);
  assert.deepEqual(plaza.diagnostics, []);
  assert.equal(Object.isFrozen(plaza), true);
  assert.equal(Object.isFrozen(plaza.makers[0].evidence), true);

  const player = await catalog.loadPlayer(rootId);
  assert.equal(player.schemaVersion, MAKER_V8_PLAYER_VIEW_SCHEMA);
  assert.equal(player.status, 'READY');
  assert.equal(player.player.evidence.rendererCommitment, 'aa'.repeat(32));
  assert.equal(player.player.document.lineage.makerKey, 'catalog-maker');
  assert.equal(player.player.certifiedAssets[0].sha256, 'cd'.repeat(32));
});

test('Maker Info display fields come from the verified manifest without replacing chain creator identity', async () => {
  const value = manifest();
  value.document.metadata.creator = 'Studio 🌍';
  value.document.metadata.style = '水彩世界';
  const catalog = adapter({
    loadContext: async () => ({ root: { ...root(), creatorName: 'Untrusted root alias', style: 'Alias style' } }),
    loadManifest: async (pointer) => manifestRead(value, { blobId: pointer.blobId, sha256: pointer.sha256 }),
  });
  const card = (await catalog.loadPlaza()).makers[0];
  const player = (await catalog.loadPlayer(rootId)).player;
  for (const view of [card, player]) {
    assert.equal(view.creatorName, value.document.metadata.creator);
    assert.equal(view.style, value.document.metadata.style);
    assert.equal(view.creatorAddress, objectId(901));
    assert.equal(view.ownerAddress, objectId(902));
  }
  const emptyCard = (await adapter().loadPlaza()).makers[0];
  assert.equal(emptyCard.creatorName, '');
  assert.equal(emptyCard.style, '');
});

test('manifest discovery uses certified nested content and never the retired top-level pointer', async () => {
  const current = root();
  current.fields = { manifest_blob_id: 'retired-wrong-blob', manifest_sha256: 'ff'.repeat(32) };
  const seen = [];
  const catalog = adapter({
    loadContext: async () => ({ root: current }),
    loadManifest: async pointer => {
      seen.push(pointer);
      return manifestRead(manifest(), { blobId: pointer.blobId, sha256: pointer.sha256 });
    },
  });
  assert.equal((await catalog.loadPlaza()).status, 'READY');
  assert.deepEqual(seen, [{ blobId: current.content.manifestBlobId, sha256: manifestSha256 }]);
  const legacy = root(); delete legacy.content;
  legacy.fields = current.fields;
  const rejected = await adapter({ loadContext: async () => ({ root: legacy }) }).loadPlaza();
  assert.equal(rejected.status, 'ERROR');
  assert.equal(rejected.diagnostics[0].code, 'MAKER_V8_ROOT_FIELDS_INVALID');
});

test('preserves every Root and Manifest failure as a diagnostic instead of an empty Plaza', async () => {
  const failedRootId = objectId(101);
  const failedManifestId = objectId(102);
  const activations = [
    activation(rootId),
    activation(failedRootId, 'root-failure'),
    activation(failedManifestId, 'manifest-failure'),
  ];
  const catalog = adapter({
    activations,
    async loadContext(value) {
      if (value.binding.rootId === failedRootId) {
        const error = new Error('Root read failed');
        error.code = 'MAKER_V8_OBJECT_READ_FAILED';
        error.layer = 'readback';
        throw error;
      }
      return { root: root({ id: value.binding.rootId, makerKey: value.makerKey }) };
    },
    async loadManifest(pointer) {
      if (pointer.blobId.endsWith('0066')) {
        const error = new Error('Manifest unavailable');
        error.code = 'MAKER_V8_MANIFEST_FETCH_FAILED';
        error.layer = 'TRANSPORT';
        throw error;
      }
      return manifestRead(manifest(), { blobId: pointer.blobId, sha256: pointer.sha256 });
    },
  });

  const plaza = await catalog.loadPlaza();
  assert.equal(plaza.status, 'DEGRADED');
  assert.equal(plaza.makers.length, 1);
  assert.equal(plaza.stats.observedActivationCount, 3);
  assert.equal(plaza.stats.errorCount, 2);
  assert.deepEqual(
    new Set(plaza.diagnostics.map((entry) => entry.code)),
    new Set(['MAKER_V8_OBJECT_READ_FAILED', 'MAKER_V8_MANIFEST_FETCH_FAILED']),
  );
  assert.equal(plaza.diagnostics.every((entry) => entry.severity === 'ERROR'), true);
  assert.equal(plaza.diagnostics.some((entry) => entry.rootId === failedRootId), true);
  assert.equal(plaza.diagnostics.some((entry) => entry.rootId === failedManifestId), true);
});

test('all Manifest failures produce ERROR, never the valid EMPTY state', async () => {
  const catalog = adapter({
    async loadManifest() {
      const error = new Error('hash mismatch');
      error.code = 'MAKER_V8_MANIFEST_HASH_MISMATCH';
      error.layer = 'INTEGRITY';
      throw error;
    },
  });
  const plaza = await catalog.loadPlaza();
  assert.equal(plaza.status, 'ERROR');
  assert.equal(plaza.makers.length, 0);
  assert.equal(plaza.diagnostics[0].code, 'MAKER_V8_MANIFEST_HASH_MISMATCH');

  const player = await catalog.loadPlayer(rootId);
  assert.equal(player.status, 'ERROR');
  assert.equal(player.player, null);
  assert.equal(player.diagnostics[0].layer, 'INTEGRITY');
});

test('Root commitment/Manifest lineage drift is fail-closed and diagnostic', async () => {
  const commitmentDrift = adapter({
    async loadContext() {
      const value = root();
      value.contentCommitment = 'ef'.repeat(32);
      return { root: value };
    },
  });
  const commitment = await commitmentDrift.loadPlaza();
  assert.equal(commitment.status, 'ERROR');
  assert.equal(commitment.diagnostics[0].code, 'MAKER_V8_ROOT_MANIFEST_COMMITMENT_MISMATCH');

  const lineageDrift = manifest();
  lineageDrift.document.lineage.makerKey = 'another-maker';
  const lineage = adapter({
    async loadManifest(pointer) {
      return manifestRead(lineageDrift, { blobId: pointer.blobId, sha256: pointer.sha256 });
    },
  });
  const read = await lineage.loadPlayer(rootId);
  assert.equal(read.status, 'ERROR');
  assert.equal(read.diagnostics[0].code, 'MAKER_V8_CATALOG_MANIFEST_LINEAGE_MISMATCH');
});

test('inactive Roots are explicit and discovery failure remains an ERROR diagnostic', async () => {
  let manifestCalls = 0;
  const inactive = adapter({
    async loadContext() { return { root: root({ lifecycle: 'PAUSED' }) }; },
    async loadManifest() { manifestCalls += 1; return manifestRead(); },
  });
  const plaza = await inactive.loadPlaza();
  assert.equal(plaza.status, 'EMPTY');
  assert.equal(plaza.stats.inactiveRootCount, 1);
  assert.equal(plaza.diagnostics[0].code, 'MAKER_V8_ROOT_NOT_ACTIVE');
  assert.equal(plaza.diagnostics[0].severity, 'INFO');
  assert.equal(manifestCalls, 0);
  const player = await inactive.loadPlayer(rootId);
  assert.equal(player.status, 'ERROR');
  assert.equal(player.diagnostics[0].code, 'MAKER_V8_ROOT_NOT_ACTIVE');

  const failed = createMakerV8CatalogAdapter({
    chain: {
      async discover() { throw new Error('GraphQL unavailable'); },
      async loadContext() { throw new Error('unreachable'); },
    },
    manifests: { async load() { throw new Error('unreachable'); } },
  });
  const failedPlaza = await failed.loadPlaza();
  assert.equal(failedPlaza.status, 'ERROR');
  assert.equal(failedPlaza.diagnostics.length, 1);
  assert.notEqual(failedPlaza.status, 'EMPTY');
});

test('creator lineage loads archived manifests and proves the exact predecessor chain', async () => {
  const firstRootId = objectId(110);
  const secondRootId = objectId(111);
  const firstCommitment = '31'.repeat(32);
  const secondCommitment = '32'.repeat(32);
  const firstActivation = activation(firstRootId);
  const secondActivation = activation(secondRootId);
  const firstDocument = manifest();
  const secondDocument = manifest();
  secondDocument.document.lineage.version = 2;
  secondDocument.document.lineage.previousRootId = firstRootId;
  secondDocument.document.lineage.previousVersionCommitment = firstCommitment;
  const roots = new Map([
    [firstRootId, root({
      id: firstRootId,
      lifecycle: 'ARCHIVED',
      makerVersion: 1,
      versionCommitment: firstCommitment,
      successorRootId: secondRootId,
    })],
    [secondRootId, root({
      id: secondRootId,
      lifecycle: 'ACTIVE',
      makerVersion: 2,
      versionCommitment: secondCommitment,
      previousRootId: firstRootId,
      previousVersionCommitment: firstCommitment,
    })],
  ]);
  const documents = new Map([
    [firstRootId, firstDocument],
    [secondRootId, secondDocument],
  ]);
  const catalog = createMakerV8CatalogAdapter({
    chain: {
      async discover() { return [firstActivation, secondActivation]; },
      async loadContext(value) { return { root: roots.get(value.binding.rootId) }; },
    },
    manifests: {
      async load(pointer) {
        const entry = [...roots.entries()].find(([, value]) => value.content.manifestBlobId === pointer.blobId);
        return manifestRead(documents.get(entry[0]), { blobId: pointer.blobId, sha256: pointer.sha256 });
      },
    },
  });
  const lineage = await catalog.loadLineage({ makerKey: 'catalog-maker' });
  assert.deepEqual(lineage.map((entry) => [entry.makerVersion, entry.lifecycle]), [[2, 'ACTIVE'], [1, 'ARCHIVED']]);
  assert.equal(lineage[0].previousRootId, firstRootId);
  assert.equal(lineage[1].successorRootId, secondRootId);
  assert.equal(lineage[0].document.lineage.previousVersionCommitment, firstCommitment);

  roots.get(firstRootId).successorRootId = objectId(999);
  await assert.rejects(
    catalog.loadLineage({ makerKey: 'catalog-maker' }),
    (error) => error.code === 'MAKER_V8_LINEAGE_LINK_INVALID',
  );
});
