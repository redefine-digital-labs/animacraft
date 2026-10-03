import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { canonicalMakerV8Json } from '../maker-v8-compiler.js';
import { createCharacterMakerV8Starter } from '../maker-v8-document.js';
import {
  MAKER_V8_CERTIFIED_ASSET_ADAPTER_SCHEMA,
  MAKER_V8_MANIFEST_ADAPTER_SCHEMA,
  MakerV8ManifestError,
  assertMakerV8Manifest,
  createMakerV8CertifiedAssetAdapter,
  createMakerV8ManifestAdapter,
} from '../maker-v8-manifest-adapter.js';
import { MAKER_V8_SEAL_CIPHERTEXT_MEDIA_TYPE } from '../maker-v8-protected-transport.js';

const encoder = new TextEncoder();

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function manifestFixture() {
  const document = structuredClone(createCharacterMakerV8Starter({
    makerKey: 'catalog-maker',
    name: 'Catalog Maker',
  }));
  document.metadata.summary = 'Verified Maker v8 manifest';
  document.metadata.coverAssetId = 'base-default';
  const manifest = {
    schemaVersion: 'animacraft.maker-v8-manifest.v2',
    protocolVersion: 8,
    document,
    certifiedAssets: [{
      assetId: 'base-default',
      blobId: 'asset-blob-1',
      mediaType: 'image/png',
      byteLength: 1,
      sha256: '11'.repeat(32),
    }],
  };
  const text = canonicalMakerV8Json(manifest);
  const bytes = encoder.encode(text);
  return { manifest, text, bytes, sha256: hash(bytes) };
}

async function readText(text, options = {}) {
  const bytes = encoder.encode(text);
  const adapter = createMakerV8ManifestAdapter({
    fetcher: async () => bytes,
    ...options,
  });
  return adapter.load({ blobId: 'manifest-blob', sha256: hash(bytes) });
}

test('loads only byte-bounded canonical Manifest bytes with an exact SHA-256', async () => {
  const fixture = manifestFixture();
  let request;
  const adapter = createMakerV8ManifestAdapter({
    maximumBytes: fixture.bytes.length,
    async fetcher(value) {
      request = value;
      return { bytes: fixture.bytes };
    },
  });
  const loaded = await adapter.load({
    blobId: 'manifest-blob',
    sha256: fixture.sha256,
  });

  assert.equal(adapter.schemaVersion, MAKER_V8_MANIFEST_ADAPTER_SCHEMA);
  assert.equal(request.blobId, 'manifest-blob');
  assert.equal(request.maximumBytes, fixture.bytes.length);
  assert.equal(loaded.sha256, fixture.sha256);
  assert.equal(loaded.byteLength, fixture.bytes.length);
  assert.equal(loaded.manifest.document.metadata.name, 'Catalog Maker');
  assert.equal(loaded.manifest.certifiedAssets[0].blobId, 'asset-blob-1');
  assert.equal(Object.isFrozen(loaded), true);
  assert.equal(Object.isFrozen(loaded.manifest), true);
  assert.equal(Object.isFrozen(loaded.manifest.document.parts), true);
});

test('rejects transport overflow and mismatched activated-Root hashes before JSON use', async () => {
  const fixture = manifestFixture();
  const overflow = createMakerV8ManifestAdapter({
    maximumBytes: fixture.bytes.length - 1,
    fetcher: async () => fixture.bytes,
  });
  await assert.rejects(
    overflow.load({ blobId: 'manifest-blob', sha256: fixture.sha256 }),
    (error) => error instanceof MakerV8ManifestError
      && error.code === 'MAKER_V8_MANIFEST_BYTE_BUDGET_EXCEEDED',
  );

  const mismatch = createMakerV8ManifestAdapter({ fetcher: async () => fixture.bytes });
  await assert.rejects(
    mismatch.load({ blobId: 'manifest-blob', sha256: '22'.repeat(32) }),
    (error) => error.code === 'MAKER_V8_MANIFEST_HASH_MISMATCH'
      && error.layer === 'INTEGRITY',
  );

  const responseOverflow = createMakerV8ManifestAdapter({
    maximumBytes: 10,
    fetcher: async () => new Response('{}', { headers: { 'content-length': '11' } }),
  });
  await assert.rejects(
    responseOverflow.load({ blobId: 'manifest-blob', sha256: '22'.repeat(32) }),
    (error) => error.code === 'MAKER_V8_MANIFEST_BYTE_BUDGET_EXCEEDED',
  );
});

test('enforces exact Manifest/document/certified-asset schemas and canonical JSON', async () => {
  const fixture = manifestFixture();
  const unknown = structuredClone(fixture.manifest);
  unknown.legacyPackageId = 'forbidden';
  await assert.rejects(
    readText(canonicalMakerV8Json(unknown)),
    (error) => error.code === 'MAKER_V8_MANIFEST_FIELDS_INVALID'
      && error.layer === 'SCHEMA',
  );

  const metadataDrift = structuredClone(fixture.manifest);
  metadataDrift.certifiedAssets[0].byteLength = 2;
  await assert.rejects(
    readText(canonicalMakerV8Json(metadataDrift)),
    (error) => error.code === 'MAKER_V8_MANIFEST_ASSET_METADATA_MISMATCH',
  );

  const pretty = JSON.stringify(fixture.manifest, null, 2);
  await assert.rejects(
    readText(pretty),
    (error) => error.code === 'MAKER_V8_MANIFEST_NONCANONICAL'
      && error.layer === 'INTEGRITY',
  );

  const wrongVersion = structuredClone(fixture.manifest);
  wrongVersion.protocolVersion = 7;
  assert.throws(
    () => assertMakerV8Manifest(wrongVersion),
    (error) => error.code === 'MAKER_V8_MANIFEST_VERSION_INVALID',
  );
});

test('protected public Styles bind certified Seal ciphertext while preserving plaintext author metadata', () => {
  const fixture = manifestFixture();
  fixture.manifest.document.metadata.coverAssetId = null;
  fixture.manifest.document.parts[0].items[0].styles[0].protected = true;
  assert.throws(() => assertMakerV8Manifest(fixture.manifest), { code: 'MAKER_V8_SOURCE_ASSET_MISMATCH' });
  fixture.manifest.document.parts[0].items[0].styles[0].payload.animacraftSourceAsset = {
    sha256: fixture.manifest.certifiedAssets[0].sha256, mediaType: 'image/png', byteLength: 1,
  };
  fixture.manifest.certifiedAssets[0] = {
    ...fixture.manifest.certifiedAssets[0],
    mediaType: MAKER_V8_SEAL_CIPHERTEXT_MEDIA_TYPE,
    byteLength: 321,
  };
  const checked = assertMakerV8Manifest(fixture.manifest);
  assert.equal(checked.document.assets[0].mediaType, 'image/png');
  assert.equal(checked.document.assets[0].byteLength, 1);
  assert.equal(checked.certifiedAssets[0].mediaType, MAKER_V8_SEAL_CIPHERTEXT_MEDIA_TYPE);
  assert.equal(checked.certifiedAssets[0].byteLength, 321);

  const leaked = structuredClone(fixture.manifest);
  leaked.certifiedAssets[0].mediaType = 'image/png';
  assert.throws(
    () => assertMakerV8Manifest(leaked),
    (error) => error.code === 'MAKER_V8_MANIFEST_ASSET_METADATA_MISMATCH',
  );
});

test('loads certified asset bytes only after exact length and hash verification', async () => {
  const bytes = Uint8Array.from([1, 2, 3, 4]);
  const asset = {
    assetId: 'base-default',
    blobId: 'asset-blob-1',
    mediaType: 'image/png',
    byteLength: bytes.length,
    sha256: hash(bytes),
  };
  let request;
  const adapter = createMakerV8CertifiedAssetAdapter({
    maximumBytes: 32,
    async fetcher(value) {
      request = value;
      return new Response(bytes, { headers: { 'content-length': String(bytes.length) } });
    },
  });
  const loaded = await adapter.load(asset);
  assert.equal(adapter.schemaVersion, MAKER_V8_CERTIFIED_ASSET_ADAPTER_SCHEMA);
  assert.equal(request.blobId, asset.blobId);
  assert.equal(request.maximumBytes, 32);
  assert.deepEqual(loaded, {
    schemaVersion: MAKER_V8_CERTIFIED_ASSET_ADAPTER_SCHEMA,
    assetId: asset.assetId,
    blobId: asset.blobId,
    mediaType: asset.mediaType,
    byteLength: bytes.length,
    sha256: asset.sha256,
    bytesBase64: Buffer.from(bytes).toString('base64'),
  });
  assert.equal(Object.isFrozen(loaded), true);

  await assert.rejects(
    createMakerV8CertifiedAssetAdapter({ fetcher: async () => bytes.subarray(0, 2) }).load(asset),
    (error) => error.code === 'MAKER_V8_MANIFEST_ASSET_LENGTH_MISMATCH'
      && error.layer === 'INTEGRITY',
  );
  await assert.rejects(
    createMakerV8CertifiedAssetAdapter({ fetcher: async () => bytes }).load({
      ...asset,
      sha256: 'ff'.repeat(32),
    }),
    (error) => error.code === 'MAKER_V8_MANIFEST_ASSET_HASH_MISMATCH'
      && error.layer === 'INTEGRITY',
  );
});

test('requires an explicit fetcher and canonical lowercase hash identity', async () => {
  assert.throws(
    () => createMakerV8ManifestAdapter(),
    (error) => error.code === 'MAKER_V8_MANIFEST_FETCHER_REQUIRED',
  );
  const fixture = manifestFixture();
  const adapter = createMakerV8ManifestAdapter({ fetcher: async () => fixture.bytes });
  await assert.rejects(
    adapter.load({ blobId: 'manifest-blob', sha256: fixture.sha256.toUpperCase() }),
    (error) => error.code === 'MAKER_V8_MANIFEST_HASH_INVALID',
  );
});
