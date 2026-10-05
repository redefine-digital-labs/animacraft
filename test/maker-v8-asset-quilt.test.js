import assert from 'node:assert/strict';
import test from 'node:test';
import { fromBase64, toBase64 } from '@mysten/sui/utils';
import { sha256 } from '@noble/hashes/sha2.js';
import { EncryptedObject } from '@mysten/seal';
import { makerV8WalrusUploadIdV8 } from '../maker-v8-walrus.js';
import { MAKER_V8_PROTECTED_ASSET_SCHEMA, MAKER_V8_SEAL_CIPHERTEXT_MEDIA_TYPE, deriveMakerV8ProtectedAssetSealIdentityV8 } from '../maker-v8-protected-transport.js';
import { createMakerV8AssetQuiltV8, makerV8QuiltPatchIdV8, makerV8WalrusAssetPathV8 } from '../maker-v8-asset-quilt.js';
import { createMakerV8PublicationTransportV8 } from '../maker-v8-publication-transport.js';
import { createCharacterMakerV8Starter } from '../maker-v8-document.js';
import { createMainnetWalrusManifestFetcher } from '../app.js';
const { BlobReader } = await import(new URL('./files/readers/blob.mjs', import.meta.resolve('@mysten/walrus')));
const { parseQuiltPatchId } = await import(new URL('./utils/quilts.mjs', import.meta.resolve('@mysten/walrus')));
const owner = `0x${'12'.repeat(32)}`;
const hash = bytes => Buffer.from(sha256(bytes)).toString('hex');
const assets = Array.from({ length: 9 }, (_, i) => ({ assetId: `asset-${i}`, mediaType: 'image/png',
  bytesBase64: toBase64(new Uint8Array(2000 + i * 127).fill(i + 1)) }));
function harness() {
  const bindings = new Map(), uploads = new Map(), contents = new Map(), signed = [], prepares = [];
  let shardReads = 0;
  const publisher = {
    async bindAssetLayout(key, { schemaVersion, owner, sourceSha256, source }) {
      if (bindings.has(key)) return structuredClone(bindings.get(key));
      const eligible = source.filter(asset => {
        const upload = uploads.get(asset.uploadId);
        return !upload || upload.status === 'SIGNATURE_REQUIRED' && upload.stage === 'REGISTER';
      }).map(asset => asset.assetId);
      const members = eligible.length > 1 ? eligible : [];
      for (const asset of source) if (members.includes(asset.assetId) && uploads.has(asset.uploadId)) uploads.get(asset.uploadId).revision++;
      const binding = { schemaVersion, owner, sourceSha256, members,
        layoutSha256: hash(new TextEncoder().encode(JSON.stringify({ sourceSha256, members }))), key, revision: 1 };
      bindings.set(key, binding); return structuredClone(binding);
    },
    async getNumShards() { shardReads++; return 1000; },
    async loadPublicationBinding(key) { return structuredClone(bindings.get(key) ?? null); },
    async savePublicationBinding(key, expected, value) {
      if ((bindings.get(key)?.revision ?? null) !== expected) throw Object.assign(new Error('CAS'), { code: 'MAKER_V8_WALRUS_CAS_MISMATCH' });
      bindings.set(key, { ...value, key, revision: (expected ?? 0) + 1 });
    },
    async load(id) { return structuredClone(uploads.get(id) ?? null); },
    async loadContent(id) { return structuredClone(contents.get(id) ?? null); },
    async prepare(input) {
      if (uploads.has(input.uploadId)) throw Object.assign(new Error('exists'), { code: 'MAKER_V8_WALRUS_UPLOAD_EXISTS' });
      prepares.push(input);
      const bytes = fromBase64(input.bytesBase64), byteSha256 = hash(bytes);
      const blobId = Buffer.from(sha256(bytes)).toString('base64url');
      contents.set(input.uploadId, { ...input, byteSha256, byteLength: bytes.length });
      const view = { uploadId: input.uploadId, byteSha256, blobId, blobObjectId: `0x${'ab'.repeat(32)}`,
        stage: 'REGISTER', status: 'SIGNATURE_REQUIRED', revision: 1 };
      uploads.set(input.uploadId, view); return view;
    },
    async requestSignature(id, expected) {
      const prior = uploads.get(id);
      if (expected && prior.revision !== expected.revision) throw Object.assign(new Error('stale review'), { code: 'MAKER_V8_WALRUS_CONTEXT_CHANGED' }); assert.equal(prior.status, 'SIGNATURE_REQUIRED');
      signed.push([id, prior.stage]); prior.status = 'RECOVERY_REQUIRED'; return structuredClone(prior);
    },
    async resume(id) {
      const prior = uploads.get(id); assert.equal(prior.status, 'RECOVERY_REQUIRED');
      if (prior.stage === 'REGISTER') { prior.stage = 'CERTIFY'; prior.status = 'SIGNATURE_REQUIRED'; }
      else { prior.stage = 'COMPLETE'; prior.status = 'COMPLETE'; }
      return structuredClone(prior);
    },
  };
  return { publisher, bindings, uploads, contents, signed, prepares, shardReads: () => shardReads };
}
async function sdkRead(group, h) {
  const raw = fromBase64(h.contents.get(group.upload.uploadId).bytesBase64);
  const blob = new BlobReader({ blobId: group.upload.blobId, numShards: 1000,
    client: { readBlob: async () => raw } });
  await blob.getBytes();
  const quilt = blob.getQuiltReader();
  for (const asset of group.assets) {
    const parsed = parseQuiltPatchId(asset.blobId);
    assert.equal(parsed.quiltId, group.upload.blobId);
    assert.deepEqual(await quilt.readerForPatchId(asset.blobId).getBytes(), fromBase64(asset.bytesBase64));
  }
}

test('nine assets share one durable upload, SDK reads exact bytes, cold recovery pins shard layout', async () => {
  const h = harness();
  const first = await createMakerV8AssetQuiltV8(h).prepare({ owner, assets });
  assert.equal(h.prepares.length, 1); assert.equal(h.signed.length, 0);
  await sdkRead(first, h);
  h.publisher.getNumShards = async () => { throw new Error('must not query a new layout on recovery'); };
  await h.publisher.requestSignature(first.upload.uploadId);
  const cold = await createMakerV8AssetQuiltV8(h).prepare({ owner, assets: [...assets].reverse() });
  assert.equal(cold.upload.status, 'RECOVERY_REQUIRED');
  assert.deepEqual(cold.assets, first.assets); assert.equal(h.prepares.length, 1);
  assert.equal(h.shardReads(), 1); assert.equal(h.signed.length, 1);
  await sdkRead(cold, h);
});

test('simultaneous tabs select one durable quilt; changed bytes use a distinct group', async () => {
  const h = harness();
  const [a, b] = await Promise.all([createMakerV8AssetQuiltV8(h).prepare({ owner, assets }),
    createMakerV8AssetQuiltV8(h).prepare({ owner, assets: [...assets].reverse() })]);
  assert.deepEqual(a.assets, b.assets); assert.equal(h.bindings.size, 1); assert.equal(h.uploads.size, 1);
  const changed = structuredClone(assets); changed[0].bytesBase64 = toBase64(new Uint8Array([9]));
  const c = await createMakerV8AssetQuiltV8(h).prepare({ owner, assets: changed });
  assert.notEqual(a.upload.uploadId, c.upload.uploadId);
});

test('tampered encoding binding or durable upload is rejected without a signature', async () => {
  for (const tamper of ['numShards', 'quiltSha256', 'owner', 'upload', 'content']) {
    const h = harness(), service = createMakerV8AssetQuiltV8(h);
    const group = await service.prepare({ owner, assets });
    const binding = [...h.bindings.values()][0];
    if (tamper === 'numShards') binding.numShards = 999;
    if (tamper === 'quiltSha256') binding.quiltSha256 = '00'.repeat(32);
    if (tamper === 'owner') binding.owner = `0x${'34'.repeat(32)}`;
    if (tamper === 'upload') h.uploads.get(group.upload.uploadId).byteSha256 = '00'.repeat(32);
    if (tamper === 'content') h.contents.get(group.upload.uploadId).bytesBase64 = 'AQ==';
    await assert.rejects(service.prepare({ owner, assets }), { code: 'MAKER_V8_ASSET_QUILT_INVALID' });
    assert.equal(h.signed.length, 0);
  }
});

test('canonical patch URLs interoperate with SDK and AC reader; invalid identity never fetches', async () => {
  const blob = Buffer.alloc(32, 42).toString('base64url');
  const patch = makerV8QuiltPatchIdV8(blob, 1, 13);
  assert.deepEqual(parseQuiltPatchId(patch), { quiltId: blob, patchId: { version: 1, startIndex: 1, endIndex: 13 } });
  assert.equal(makerV8WalrusAssetPathV8(blob), `/v1/blobs/${blob}`);
  const fetched = [];
  const fetcher = createMainnetWalrusManifestFetcher({ fetcher: async (url) => {
    fetched.push(url); return new Response(new Uint8Array([1]));
  } });
  await fetcher({ blobId: patch });
  assert.ok(fetched[0].endsWith(`/v1/blobs/by-quilt-patch-id/${patch}`));
  const bad = Buffer.from(patch, 'base64url'); bad[32] = 2;
  await assert.rejects(fetcher({ blobId: bad.toString('base64url') }));
  assert.throws(() => makerV8WalrusAssetPathV8(patch.slice(0, -1) + 'B'));
  assert.equal(fetched.length, 1);
});

function input() {
  const document = structuredClone(createCharacterMakerV8Starter({ makerKey: 'grouped', name: 'Grouped' }));
  const template = document.assets[0], style = document.parts[0].items[0].styles[0];
  document.assets = assets.map(asset => ({ ...template, id: asset.assetId, byteLength: fromBase64(asset.bytesBase64).length }));
  document.parts[0].items[0].styles = assets.map((asset, i) => ({ ...structuredClone(style), key: i ? `style-${i}` : style.key, assetId: asset.assetId }));
  return { document, signerAddress: owner, attemptNonce: 'grouped-1', assets: assets.map(asset => ({ ...asset, kind: template.kind })) };
}
test('fresh nine-file publication uses only Living Content, one asset group and Manifest across cold restarts', async () => {
  const h = harness(), candidate = input(); let final = null;
  const compiler = { async prepareTransportManifest(value) {
    assert.equal(value.assetTransports.length, 9);
    const group = { assets: value.assetTransports, upload: [...h.uploads.values()].find(u => u.blobId === parseQuiltPatchId(value.assetTransports[0].blobId).quiltId) };
    await sdkRead(group, h);
    const bytes = new TextEncoder().encode(JSON.stringify(value.assetTransports));
    return { manifest: { sha256: hash(bytes), bytesBase64: toBase64(bytes) } };
  } };
  const publication = { async prepare(value) { final = value; return { attemptId: 'grouped', status: 'ACTIVE' }; } };
  let view;
  for (let n = 0; n < 15; n++) {
    const transport = createMakerV8PublicationTransportV8({ publisher: h.publisher, compiler, publication });
    view = await transport.prepare(candidate);
    if (view.status === 'PUBLICATION_READY') break;
    if (view.stage === 'ASSET') { assert.equal(view.assetCount, 9); assert.equal(view.completedAssets, 0); }
    if (view.status === 'TRANSPORT_SIGNATURE_REQUIRED') await transport.requestSignature(candidate);
    else await transport.recover(candidate);
  }
  assert.equal(view.status, 'PUBLICATION_READY');
  assert.equal(h.prepares.length, 3); assert.equal(h.signed.length, 6);
  assert.equal(new Set(h.signed.map(([id]) => id)).size, 3);
  assert.equal(final.transport.assets.length, 9);
  assert.equal(final.transport.livingContent.blobId.length, 43, 'Soul bundle remains a real standalone Blob');
  assert.equal(final.transport.manifest.blobId.length, 43);
});

test('an unknown pre-upgrade per-file registration is recovered before grouping untouched assets', async () => {
  const h = harness(), candidate = input();
  const asset = assets[0], bytes = fromBase64(asset.bytesBase64);
  const uploadId = makerV8WalrusUploadIdV8({ owner, purpose: `asset-${hash(new TextEncoder().encode(asset.assetId)).slice(0, 24)}`,
    contentSha256: hash(bytes) });
  await h.publisher.prepare({ uploadId, owner, ...asset, epochs: 3 });
  await h.publisher.requestSignature(uploadId);
  const transport = createMakerV8PublicationTransportV8({ publisher: h.publisher,
    compiler: { prepareTransportManifest() { throw new Error('not yet'); } }, publication: { prepare() { throw new Error('not yet'); } } });
  let view = await transport.prepare(candidate);
  h.uploads.get(view.upload.uploadId).status = 'COMPLETE';
  view = await transport.prepare(candidate);
  assert.equal(view.upload.uploadId, uploadId); assert.equal(view.status, 'TRANSPORT_RECOVERY_REQUIRED');
  assert.equal(h.bindings.size, 1); assert.equal(h.signed.length, 1);
  view = await transport.recover(candidate);
  assert.equal(view.upload.stage, 'CERTIFY'); assert.equal(h.signed.length, 1);
  await transport.requestSignature(candidate);
  view = await transport.recover(candidate);
  assert.equal(view.assetCount, 8); assert.equal(view.completedAssets, 1);
  assert.equal(h.signed.filter(([id, stage]) => id === uploadId && stage === 'REGISTER').length, 1);
});

test('protected assets are encrypted once per semantic identity and grouped as exact ciphertext through restart', async () => {
  const h = harness(), candidate = input();
  candidate.document.parts[0].items[0].styles.forEach(s => { s.protected = true; });
  const ciphertexts = new Map(); let encryptions = 0, final = null;
  const compiler = {
    async prepareProtectedAssetIdentities() { return { assets: assets.map((asset, i) => ({ assetId: asset.assetId, identity: {
      schemaVersion: 'animacraft.maker-v8-protected-asset-identity.v1', signer: owner,
      scopeKind: 0, scopeKey: 'maker/base', assetKey: `base/default/style-${i}`,
      rootContentCommitment: '11'.repeat(32), makerVersion: '1', releasePackageId: `0x${'03'.repeat(32)}`,
      productBindingCommitment: '22'.repeat(32), policyCommitment: '33'.repeat(32),
      sealPolicyConfigId: `0x${'04'.repeat(32)}`, assetContentCommitment: '44'.repeat(32),
    } })) }; },
    async prepareTransportManifest(value) {
      for (const asset of value.assetTransports) {
        assert.equal(asset.mediaType, MAKER_V8_SEAL_CIPHERTEXT_MEDIA_TYPE);
        assert.ok([...ciphertexts.values()].includes(asset.bytesBase64));
        assert.ok(!assets.some(plain => plain.bytesBase64 === asset.bytesBase64));
      }
      const group = { assets: value.assetTransports, upload: [...h.uploads.values()].find(u =>
        u.blobId === parseQuiltPatchId(value.assetTransports[0].blobId).quiltId) };
      await sdkRead(group, h);
      const bytes = new TextEncoder().encode(JSON.stringify(value.assetTransports));
      return { manifest: { sha256: hash(bytes), bytesBase64: toBase64(bytes) } };
    },
  };
  const protector = { async protectAsset(request) {
    encryptions++;
    const derived = deriveMakerV8ProtectedAssetSealIdentityV8(request.identity);
    const bytes = EncryptedObject.serialize({ version: 0, packageId: derived.packageId, id: derived.sealId,
      services: [[`0x${'90'.repeat(32)}`, 1]], threshold: 1,
      encryptedShares: { BonehFranklinBLS12381: { nonce: new Uint8Array(96).fill(encryptions),
        encryptedShares: [new Uint8Array(32).fill(8)], encryptedRandomness: new Uint8Array(32).fill(9) } },
      ciphertext: { Aes256Gcm: { blob: new Uint8Array([5, 6, 7, encryptions]), aad: fromBase64(derived.aadBase64) } },
    }).toBytes();
    ciphertexts.set(request.identity.assetKey, toBase64(bytes));
    return { schemaVersion: MAKER_V8_PROTECTED_ASSET_SCHEMA, mediaType: MAKER_V8_SEAL_CIPHERTEXT_MEDIA_TYPE,
      bytesBase64: toBase64(bytes), byteLength: bytes.length, sha256: hash(bytes), packageId: derived.packageId,
      sealId: derived.sealId, aadSha256: derived.aadSha256 };
  } };
  const publication = { async prepare(value) { final = value; return { attemptId: 'sealed', status: 'ACTIVE' }; } };
  let view;
  for (let i = 0; i < 15; i++) {
    const transport = createMakerV8PublicationTransportV8({ publisher: h.publisher, compiler, protector, publication });
    view = await transport.prepare(candidate);
    if (view.status === 'PUBLICATION_READY') break;
    if (view.status === 'TRANSPORT_SIGNATURE_REQUIRED') await transport.requestSignature(candidate);
    else await transport.recover(candidate);
  }
  assert.equal(view.status, 'PUBLICATION_READY'); assert.equal(encryptions, 9);
  assert.equal(h.signed.length, 6, 'only three register/certify pairs, no per-ciphertext signatures');
  assert.equal(final.transport.assets.length, 9);
  for (const [uploadId] of h.signed) assert.notEqual(h.contents.get(uploadId).mediaType, MAKER_V8_SEAL_CIPHERTEXT_MEDIA_TYPE);
});

test('BUG-014: an old standalone review cannot replace the signed quilt after cold restart', async () => {
  const h = harness(), candidate = input(), asset = assets[0];
  const uploadId = makerV8WalrusUploadIdV8({ owner,
    purpose: `asset-${hash(new TextEncoder().encode(asset.assetId)).slice(0, 24)}`,
    contentSha256: hash(fromBase64(asset.bytesBase64)) });
  const oldReview = structuredClone(await h.publisher.prepare({ uploadId, owner, ...asset, epochs: 3 }));
  const dependencies = { publisher: h.publisher,
    compiler: { prepareTransportManifest() { throw new Error('not yet'); } },
    publication: { prepare() { throw new Error('not yet'); } } };
  let transport = createMakerV8PublicationTransportV8(dependencies);
  let view = await transport.prepare(candidate);
  h.uploads.get(view.upload.uploadId).status = 'COMPLETE';
  view = await transport.prepare(candidate);
  assert.equal(view.assetCount, 9);
  const originalGroup = view.upload.uploadId;
  await transport.requestSignature(candidate);
  // Adoption invalidates an already-held review, including in the old code.
  await assert.rejects(h.publisher.requestSignature(uploadId, oldReview), { code: 'MAKER_V8_WALRUS_CONTEXT_CHANGED' });
  // Even a later deliberately refreshed standalone action cannot replace the group.
  await h.publisher.requestSignature(uploadId);
  await h.publisher.resume(uploadId);
  await h.publisher.requestSignature(uploadId);
  await h.publisher.resume(uploadId);
  const preparedBeforeRestart = h.prepares.length;
  transport = createMakerV8PublicationTransportV8(dependencies);
  view = await transport.prepare(candidate);
  assert.equal(view.upload.uploadId, originalGroup);
  assert.equal(view.assetCount, 9);
  assert.equal(view.status, 'TRANSPORT_RECOVERY_REQUIRED');
  assert.equal(h.prepares.length, preparedBeforeRestart);
  view = await transport.recover(candidate);
  assert.equal(view.upload.uploadId, originalGroup);
  assert.equal(view.upload.stage, 'CERTIFY');
  assert.equal(h.signed.filter(([id, stage]) => id === originalGroup && stage === 'REGISTER').length, 1);
});
