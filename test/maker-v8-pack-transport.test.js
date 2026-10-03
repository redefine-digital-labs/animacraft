import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createCreatorCharacterStarter } from '../maker-v8-creator-structure.js';
import { packAuthoringContent, packPublicationAuthoringContent } from '../maker-v8-pack-authoring.js';

import { toBase58, toBase64 } from '@mysten/sui/utils';

import {
  MAKER_V8_PACK_DRAFT_SCHEMA,
  MAKER_V8_PACK_DOCUMENT_SCHEMA,
  canonicalMakerV8PackJson,
} from '../maker-v8-pack-controller.js';
import {
  MAKER_V8_PACK_MANIFEST_SCHEMA,
  MAKER_V8_PACK_MANIFEST_READ_SCHEMA,
  MAKER_V8_PACK_TRANSPORT_SCHEMA,
  createMakerV8PackManifestReadAdapterV8,
  createMakerV8PackTransportV8,
  buildMakerV8PackManifestV8,
} from '../maker-v8-pack-transport.js';

const id = (value) => `0x${BigInt(value).toString(16).padStart(64, '0')}`;
const digest = (value) => toBase58(new Uint8Array(32).fill(value));
const hash = (value) => value.repeat(64).slice(0, 64);
const ref = (value) => ({ objectId: id(value), version: String(value), digest: digest(value) });
const OWNER = id(90);
const BYTES = Uint8Array.from([137, 80, 78, 71, 1, 2, 3]);
const BYTES_BASE64 = toBase64(BYTES);
const BYTES_HASH = 'cdf3cefe7ec6253d1cb4828ab654da6beb8a4727daac0c49dbf26bedf5887f79';

function document() {
  const rootId = id(1);
  const rootVersion = '4';
  const rootContentCommitment = hash('a');
  const catalogId = id(20);
  const productBindingCommitment = hash('b');
  const callCapSetCommitment = hash('c');
  return {
    schemaVersion: MAKER_V8_PACK_DOCUMENT_SCHEMA,
    protocolVersion: 8,
    metadata: {
      semanticPackId: 'moon_pack',
      name: 'Moon Pack',
      summary: 'One exact optional Style.',
      coverAssetId: 'moon_asset',
    },
    author: { address: OWNER, role: 'MAKER_OWNER' },
    admission: { makerApproval: 'REQUIRED', expectedPackRegistryRevision: '7' },
    access: { kind: 'FREE', priceAtomic: '0' },
    completion: {
      mode: 'UNLIMITED_FREE', priceAtomic: '0', freeQuotaPerWallet: '0', totalCap: '0',
    },
    styles: [{
      sequence: '0', partKey: 'accessory', itemKey: 'moon_item', styleKey: 'moon_style',
      layerTrackKey: 'accessory_front', colorChannelKey: null, defaultSwatchKey: null,
      asset: {
        assetId: 'moon_asset', mediaType: 'image/png', byteLength: BYTES.length,
        sha256: BYTES_HASH, blobId: null, contentCommitment: BYTES_HASH,
        protected: false, sealBindingCommitment: null,
      },
    }],
    bindings: {
      root: {
        objectRef: ref(1), makerVersion: rootVersion, contentCommitment: rootContentCommitment,
        lifecycle: 'ACTIVE', owner: OWNER, adminCapId: id(10), controlEpoch: '2',
      },
      makerAdmin: {
        objectRef: ref(10), protocolVersion: 8, rootId, owner: OWNER, controlEpoch: '2',
      },
      definitionRegistry: {
        objectRef: ref(2), rootId, rootVersion, rootContentCommitment,
        baseRegistryId: id(3), sealed: true, admissionCeiling: 'OPEN',
      },
      baseRegistry: {
        objectRef: ref(3), rootId, makerVersion: rootVersion, rootContentCommitment, sealed: true,
      },
      packRegistry: {
        objectRef: ref(4), rootId, rootVersion, rootContentCommitment,
        definitionRegistryId: id(2), admissionAuthorityId: id(5),
        admissionPolicyCommitment: hash('d'), revision: '7',
      },
      admissionAuthority: { objectRef: ref(5), rootId, rootVersion, rootContentCommitment },
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
      releaseConfig: { objectRef: ref(9), catalogId, productBindingCommitment, callCapSetCommitment },
    },
  };
}

function input() {
  return {
    owner: OWNER,
    draft: {
      schemaVersion: MAKER_V8_PACK_DRAFT_SCHEMA,
      draftId: 'moon-pack',
      revision: 2,
      createdAt: 1,
      updatedAt: 2,
      document: document(),
      publication: {
        attemptId: null, status: 'UNPREPARED', chain: null, updatedAt: null, lastError: null,
      },
    },
    assets: [{
      schemaVersion: 'animacraft.maker-v8-pack-asset.v1',
      draftId: 'moon-pack',
      assetId: 'moon_asset',
      revision: 1,
      createdAt: 2,
      updatedAt: 2,
      mediaType: 'image/png',
      bytesBase64: BYTES_BASE64,
      byteLength: BYTES.length,
      sha256: BYTES_HASH,
    }],
  };
}

function harness() {
  const uploads = new Map();
  const calls = [];
  const publisher = {
    async load(uploadId) { return uploads.get(uploadId) ?? null; },
    async prepare(value) {
      const upload = {
        uploadId: value.uploadId,
        status: 'SIGNATURE_REQUIRED',
        blobId: value.mediaType === 'application/json' ? 'pack_manifest_blob_00001' : 'pack_asset_blob_0000001',
      };
      uploads.set(value.uploadId, upload);
      calls.push(['prepare', value.mediaType]);
      return upload;
    },
    async requestSignature(uploadId) {
      const upload = { ...uploads.get(uploadId), status: 'RECOVERY_REQUIRED' };
      uploads.set(uploadId, upload);
      calls.push(['sign', upload.blobId]);
      return upload;
    },
    async resume(uploadId) {
      const upload = { ...uploads.get(uploadId), status: 'COMPLETE' };
      uploads.set(uploadId, upload);
      calls.push(['recover', upload.blobId]);
      return upload;
    },
  };
  return { transport: createMakerV8PackTransportV8({ publisher }), calls };
}

test('Pack transport rejects local parent before prepare, signing or recovery can upload bytes', async () => {
  const { transport, calls } = harness();
  const local = input();
  local.draft.document.bindings = { kind: 'LOCAL_DRAFT', parent: {
    schemaVersion: 'animacraft.maker-v8-draft-export.v1',
    draft: { draftId: 'local-parent', revision: 1, document: createCreatorCharacterStarter() },
    assets: [], draftSha256: 'ab'.repeat(32),
  } };
  local.draft.document.admission.expectedPackRegistryRevision = null;
  for (const method of ['prepare', 'requestSignature', 'recover']) {
    await assert.rejects(transport[method](local), { code: 'MAKER_V8_PACK_PARENT_NOT_PUBLISHED' });
    assert.deepEqual(calls, []);
  }
});

test('Pack transport certifies every Style asset and one canonical Manifest before publication', async () => {
  const { transport, calls } = harness();
  assert.equal(transport.schemaVersion, MAKER_V8_PACK_TRANSPORT_SCHEMA);
  let view = await transport.prepare(input());
  assert.equal(view.status, 'TRANSPORT_SIGNATURE_REQUIRED');
  assert.equal(view.stage, 'ASSET');
  view = await transport.requestSignature(input());
  assert.equal(view.status, 'TRANSPORT_RECOVERY_REQUIRED');
  view = await transport.recover(input());
  assert.equal(view.stage, 'MANIFEST');
  assert.equal(view.status, 'TRANSPORT_SIGNATURE_REQUIRED');
  view = await transport.requestSignature(input());
  assert.equal(view.status, 'TRANSPORT_RECOVERY_REQUIRED');
  view = await transport.recover(input());
  assert.equal(view.status, 'PUBLICATION_TRANSPORT_READY');
  assert.equal(view.prepared.document.styles[0].asset.blobId, 'pack_asset_blob_0000001');
  assert.equal(view.prepared.manifest.blobId, 'pack_manifest_blob_00001');
  assert.match(view.prepared.manifest.sha256, /^[0-9a-f]{64}$/);
  const manifest = JSON.parse(new TextDecoder().decode(
    Buffer.from(view.prepared.manifest.bytesBase64, 'base64'),
  ));
  assert.equal(manifest.schemaVersion, MAKER_V8_PACK_MANIFEST_SCHEMA);
  assert.equal(manifest.content.styles[0].asset.blobId, 'pack_asset_blob_0000001');
  const before = structuredClone(view.prepared.document);
  const encoded = buildMakerV8PackManifestV8(view.prepared.document);
  assert.equal(encoded.bytesBase64, view.prepared.manifest.bytesBase64);
  assert.equal(encoded.sha256, view.prepared.manifest.sha256);
  assert.deepEqual(view.prepared.document, before);
  assert.deepEqual(calls.map(([kind]) => kind), [
    'prepare', 'sign', 'recover', 'prepare', 'sign', 'recover',
  ]);
});

test('Pack transport rejects substituted bytes, incomplete sets, protected rows and author drift', async () => {
  const { transport, calls } = harness();
  const substituted = input();
  substituted.assets[0].bytesBase64 = toBase64(Uint8Array.from([1, 2, 3]));
  await assert.rejects(transport.prepare(substituted), {
    code: 'MAKER_V8_PACK_TRANSPORT_ASSET_INVALID',
  });
  const incomplete = input();
  incomplete.assets = [];
  await assert.rejects(transport.prepare(incomplete), {
    code: 'MAKER_V8_PACK_TRANSPORT_ASSET_SET_INVALID',
  });
  const protectedInput = input();
  protectedInput.draft.document.styles[0].asset.protected = true;
  protectedInput.draft.document.styles[0].asset.sealBindingCommitment = hash('e');
  await assert.rejects(transport.prepare(protectedInput), {
    code: 'MAKER_V8_PACK_TRANSPORT_ASSET_DRIFT',
  });
  const wrongAuthor = input();
  wrongAuthor.owner = id(91);
  await assert.rejects(transport.prepare(wrongAuthor), {
    code: 'MAKER_V8_PACK_TRANSPORT_AUTHOR_DRIFT',
  });
  assert.deepEqual(calls, []);
});

test('authored Pack Manifest binds complete content to independent parent and exact Style inventory', async () => {
  const { transport } = harness();
  await transport.prepare(input()); await transport.requestSignature(input()); await transport.recover(input());
  await transport.requestSignature(input());
  const view = await transport.recover(input());
  const manifest = JSON.parse(Buffer.from(view.prepared.manifest.bytesBase64, 'base64').toString());
  const parent = createCreatorCharacterStarter();
  parent.assets.push({ id: 'base-png', kind: 'layer', mediaType: 'image/png', byteLength: 7 });
  for (const part of parent.parts) part.items[0].styles[0].assetId = 'base-png';
  const privateItem = structuredClone(parent.parts[0].items[0]);
  privateItem.key = 'private-item'; privateItem.status = 'PRIVATE';
  privateItem.styles[0].assetId = 'private-png';
  parent.parts[0].items.push(privateItem);
  parent.assets.push({ id: 'private-png', kind: 'layer', mediaType: 'image/png', byteLength: 7 });
  const row = { ...manifest.content.styles[0], itemKey: 'accessory-default', layerTrackKey: 'accessory-track' };
  manifest.content.styles = [row];
  const local = { styles: [row], bindings: { kind: 'LOCAL_DRAFT', parent: { draft: { document: parent },
    assets: parent.assets.map(asset => ({ assetId: asset.id, kind: asset.kind, mediaType: asset.mediaType, byteLength: asset.byteLength, sha256: BYTES_HASH })) } } };
  const authored = packPublicationAuthoringContent(local);
  assert.equal(authored.content.parent.document.parts[0].items.length, 1);
  assert.equal(authored.content.parent.assets.length, 1);
  assert.equal(parent.parts[0].items.length, 2);
  const inheritedSource = authored.content.parent.document.parts[0].items[0].styles[0].payload.animacraftSourceAsset;
  assert.deepEqual(inheritedSource, { sha256: BYTES_HASH, mediaType: 'image/png', byteLength: 7 });
  assert.deepEqual(authored.content.document.parts[0].items[0].styles[0].payload.animacraftSourceAsset, inheritedSource);
  assert.equal(parent.parts[0].items[0].styles[0].payload.animacraftSourceAsset, undefined,
    'publication projection does not rewrite the captured draft');
  const staleParent = structuredClone(local);
  staleParent.bindings.parent.draft.document.parts[0].items[0].styles[0].payload.animacraftSourceAsset = {
    ...inheritedSource, sha256: 'ef'.repeat(32),
  };
  assert.throws(() => packPublicationAuthoringContent(staleParent), { code: 'MAKER_V8_SOURCE_ASSET_MISMATCH' });
  manifest.content.authoring = authored.content;
  const hashBytes = value => createHash('sha256').update(value).digest('hex');
  const commit = content => hashBytes(canonicalMakerV8PackJson({ ...content,
    styles: content.styles.map(style => ({ ...style, asset: { assetId: style.asset.assetId,
      contentCommitment: style.asset.contentCommitment, protected: style.asset.protected } })) }));
  manifest.contentCommitment = commit(manifest.content);
  const changed = structuredClone(manifest.content);
  changed.authoring.document.parts.at(-1).items[0].styles.at(-1).transform.x = 12.5;
  assert.notEqual(commit(changed), manifest.contentCommitment);
  const read = async (candidate, loadParent) => {
    const bytes = new TextEncoder().encode(canonicalMakerV8PackJson(candidate));
    const reader = createMakerV8PackManifestReadAdapterV8({ fetcher: async () => bytes, loadParent });
    return reader.load({ blobId: 'authored-manifest', sha256: hashBytes(bytes), rootId: candidate.content.rootId,
      rootVersion: candidate.content.rootVersion, rootContentCommitment: candidate.content.rootContentCommitment,
      semanticPackId: candidate.content.semanticPackId, contentCommitment: candidate.contentCommitment });
  };
  const loadParent = async binding => {
    assert.equal(binding.rootContentCommitment, manifest.content.rootContentCommitment);
    return authored.content.parent;
  };
  assert.deepEqual((await read(manifest, loadParent)).manifest.content.authoring, authored.content);
  await assert.rejects(read(manifest, null), /authenticated parent/);
  const wrongParent = structuredClone(authored.content.parent); wrongParent.document.metadata.name += ' wrong';
  await assert.rejects(read(manifest, async () => wrongParent), /authenticated parent/);
  const tampered = structuredClone(manifest); tampered.content = changed;
  await assert.rejects(read(tampered, loadParent), { code: 'MAKER_V8_PACK_MANIFEST_CONTENT_DRIFT' });
  const drifted = structuredClone(manifest); drifted.content.styles[0].layerTrackKey = 'wrong-track';
  drifted.contentCommitment = commit(drifted.content);
  await assert.rejects(read(drifted, loadParent), { code: 'MAKER_V8_PACK_MANIFEST_CONTENT_DRIFT' });
  const leaking = structuredClone(manifest);
  leaking.content.authoring = packAuthoringContent(local).content;
  leaking.contentCommitment = commit(leaking.content);
  await assert.rejects(read(leaking, async () => leaking.content.authoring.parent), /private definitions/);
});

test('Pack Manifest reader binds canonical Walrus bytes to the active Release and public assets', async () => {
  const { transport } = harness();
  let view = await transport.prepare(input());
  view = await transport.requestSignature(input());
  view = await transport.recover(input());
  view = await transport.requestSignature(input());
  view = await transport.recover(input());
  const bytes = Buffer.from(view.prepared.manifest.bytesBase64, 'base64');
  const checkedDocument = view.prepared.document;
  const reader = createMakerV8PackManifestReadAdapterV8({
    fetcher: async ({ blobId }) => {
      assert.equal(blobId, view.prepared.manifest.blobId);
      return new Uint8Array(bytes);
    },
  });
  const loaded = await reader.load({
    blobId: view.prepared.manifest.blobId,
    sha256: view.prepared.manifest.sha256,
    rootId: checkedDocument.bindings.root.objectRef.objectId,
    rootVersion: checkedDocument.bindings.root.makerVersion,
    rootContentCommitment: checkedDocument.bindings.root.contentCommitment,
    semanticPackId: checkedDocument.metadata.semanticPackId,
    contentCommitment: view.prepared.manifest.contentCommitment,
  });
  assert.equal(loaded.schemaVersion, MAKER_V8_PACK_MANIFEST_READ_SCHEMA);
  assert.equal(loaded.manifest.content.semanticPackId, 'moon_pack');
  assert.deepEqual(loaded.assets, [{
    assetId: 'moon_asset',
    blobId: 'pack_asset_blob_0000001',
    mediaType: 'image/png',
    byteLength: BYTES.length,
    sha256: BYTES_HASH,
  }]);

  await assert.rejects(reader.load({
    blobId: view.prepared.manifest.blobId,
    sha256: view.prepared.manifest.sha256,
    rootId: checkedDocument.bindings.root.objectRef.objectId,
    rootVersion: checkedDocument.bindings.root.makerVersion,
    rootContentCommitment: checkedDocument.bindings.root.contentCommitment,
    semanticPackId: 'another_pack',
    contentCommitment: view.prepared.manifest.contentCommitment,
  }), { code: 'MAKER_V8_PACK_MANIFEST_BINDING_DRIFT' });

  const tamperedReader = createMakerV8PackManifestReadAdapterV8({
    fetcher: async () => Uint8Array.from([...bytes.slice(0, -1), bytes.at(-1) ^ 1]),
  });
  await assert.rejects(tamperedReader.load({
    blobId: view.prepared.manifest.blobId,
    sha256: view.prepared.manifest.sha256,
    rootId: checkedDocument.bindings.root.objectRef.objectId,
    rootVersion: checkedDocument.bindings.root.makerVersion,
    rootContentCommitment: checkedDocument.bindings.root.contentCommitment,
    semanticPackId: checkedDocument.metadata.semanticPackId,
    contentCommitment: view.prepared.manifest.contentCommitment,
  }), { code: 'MAKER_V8_PACK_MANIFEST_HASH_DRIFT' });
});
