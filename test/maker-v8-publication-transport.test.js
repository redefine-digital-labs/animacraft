import assert from 'node:assert/strict';
import test from 'node:test';

import { fromBase64, toBase64 } from '@mysten/sui/utils';
import { sha256 } from '@noble/hashes/sha2.js';
import { EncryptedObject } from '@mysten/seal';

import { createCharacterMakerV8Starter } from '../maker-v8-document.js';
import { compileMakerV8LivingContentV8 } from '../maker-v8-living-content-compiler.js';
import { createMakerV8PublicationTransportV8, MAKER_V8_PUBLICATION_TRANSPORT_SCHEMA } from '../maker-v8-publication-transport.js';
import { makerV8WalrusUploadIdV8 } from '../maker-v8-walrus.js';
import {
  MAKER_V8_PROTECTED_ASSET_SCHEMA,
  MAKER_V8_SEAL_CIPHERTEXT_MEDIA_TYPE,
  deriveMakerV8ProtectedAssetSealIdentityV8,
} from '../maker-v8-protected-transport.js';

const OWNER = `0x${'12'.repeat(32)}`;
const ASSET_BYTES = new Uint8Array([1]);
const MANIFEST_BYTES = new TextEncoder().encode('{"manifest":8}');
const hex = (bytes) => [...bytes]
  .map((byte) => byte.toString(16).padStart(2, '0')).join('');
const id = (value) => `0x${value.toString(16).padStart(64, '0')}`;

function encrypted(identity, nonce = 7) {
  const derived = deriveMakerV8ProtectedAssetSealIdentityV8(identity);
  const bytes = EncryptedObject.serialize({
    version: 0,
    packageId: derived.packageId,
    id: derived.sealId,
    services: [[id(90), 1]],
    threshold: 1,
    encryptedShares: {
      BonehFranklinBLS12381: {
        nonce: new Uint8Array(96).fill(nonce),
        encryptedShares: [new Uint8Array(32).fill(8)],
        encryptedRandomness: new Uint8Array(32).fill(9),
      },
    },
    ciphertext: {
      Aes256Gcm: { blob: new Uint8Array([5, 6, 7, 8]), aad: fromBase64(derived.aadBase64) },
    },
  }).toBytes();
  return {
    schemaVersion: MAKER_V8_PROTECTED_ASSET_SCHEMA,
    mediaType: MAKER_V8_SEAL_CIPHERTEXT_MEDIA_TYPE,
    bytesBase64: toBase64(bytes),
    byteLength: bytes.length,
    sha256: hex(sha256(bytes)),
    packageId: derived.packageId,
    sealId: derived.sealId,
    aadSha256: derived.aadSha256,
  };
}

function harness({ protectedAsset = false } = {}) {
  const uploads = new Map();
  const contents = new Map();
  const calls = [];
  const publisher = {
    async load(uploadId) { return uploads.get(uploadId) ?? null; },
    async loadContent(uploadId) { return contents.get(uploadId) ?? null; },
    async prepare(input) {
      const bytes = fromBase64(input.bytesBase64);
      const view = {
        uploadId: input.uploadId,
        status: 'SIGNATURE_REQUIRED',
        blobObjectId: `0x${'a'.repeat(64)}`,
        blobId: input.mediaType === 'application/json' ? 'manifest-blob'
          : input.mediaType === 'application/vnd.animacraft.living-content-bundle+bcs' ? 'living-blob' : 'asset-blob',
        byteSha256: hex(sha256(bytes)),
      };
      uploads.set(input.uploadId, view);
      contents.set(input.uploadId, {
        schemaVersion: 'animacraft.maker-v8-walrus-upload.v1',
        uploadId: input.uploadId,
        owner: input.owner,
        mediaType: input.mediaType,
        bytesBase64: input.bytesBase64,
        byteLength: bytes.length,
        byteSha256: hex(sha256(bytes)),
      });
      calls.push(['prepare', input.mediaType]);
      return view;
    },
    async requestSignature(uploadId) {
      const prior = uploads.get(uploadId);
      assert.equal(prior.status, 'SIGNATURE_REQUIRED');
      const next = { ...prior, status: 'RECOVERY_REQUIRED' };
      uploads.set(uploadId, next);
      calls.push(['sign', prior.blobId]);
      return next;
    },
    async resume(uploadId) {
      const prior = uploads.get(uploadId);
      assert.equal(prior.status, 'RECOVERY_REQUIRED');
      const next = { ...prior, status: 'COMPLETE' };
      uploads.set(uploadId, next);
      calls.push(['recover', prior.blobId]);
      return next;
    },
  };
  const compiler = {
    async prepareProtectedAssetIdentities(input) {
      assert.deepEqual(input.document.parts[0].items[0].styles[0].payload.animacraftSourceAsset,
        { sha256: hex(sha256(ASSET_BYTES)), mediaType: 'image/png', byteLength: ASSET_BYTES.length });
      assert.equal(input.livingContentTransport.blobId, 'living-blob');
      calls.push(['identity', input.assetTransports.length]);
      return {
        assets: protectedAsset ? [{
          assetId: 'base-default',
          identity: {
            schemaVersion: 'animacraft.maker-v8-protected-asset-identity.v1',
            signer: OWNER,
            scopeKind: 0,
            scopeKey: 'maker/base',
            assetKey: 'base/default/default',
            rootContentCommitment: '11'.repeat(32),
            makerVersion: '1',
            releasePackageId: id(3),
            productBindingCommitment: '22'.repeat(32),
            policyCommitment: '33'.repeat(32),
            sealPolicyConfigId: id(4),
            assetContentCommitment: '44'.repeat(32),
          },
        }] : [],
      };
    },
    async prepareTransportManifest(input) {
      const living = await compileMakerV8LivingContentV8(input.document);
      assert.deepEqual(input.livingContentTransport, { blobId: 'living-blob', blobObjectId: `0x${'a'.repeat(64)}`, bytesBase64: toBase64(Uint8Array.from(living.bytes)) });
      assert.equal(input.assetTransports[0].blobId, 'asset-blob');
      calls.push(['manifest', input.assetTransports.length]);
      return {
        manifest: {
          sha256: hex(sha256(MANIFEST_BYTES)),
          bytesBase64: toBase64(MANIFEST_BYTES),
        },
      };
    },
  };
  const publication = {
    async prepare(input) {
      const living = await compileMakerV8LivingContentV8(input.document);
      assert.deepEqual(input.transport.livingContent, { blobId: 'living-blob', blobObjectId: `0x${'a'.repeat(64)}`, bytesBase64: toBase64(Uint8Array.from(living.bytes)) });
      calls.push(['publication', input.transport.manifest.blobId]);
      return { attemptId: 'attempt-1', status: 'ACTIVE' };
    },
  };
  const protector = protectedAsset ? {
    async protectAsset(request) {
      calls.push(['protect', request.identity.assetKey]);
      return encrypted(request.identity);
    },
  } : null;
  return {
    transport: createMakerV8PublicationTransportV8({ publisher, compiler, publication, protector }),
    calls,
    uploads, contents, publisher, protector,
  };
}

function input() {
  return {
    document: createCharacterMakerV8Starter({ makerKey: 'fresh', name: 'Fresh' }),
    signerAddress: OWNER,
    attemptNonce: 'fresh-attempt-1',
    assets: [{
      assetId: 'base-default',
      kind: 'layer',
      mediaType: 'image/png',
      bytesBase64: toBase64(ASSET_BYTES),
    }],
  };
}

function protectedInput() {
  const value = input();
  value.document = structuredClone(value.document);
  value.document.parts[0].items[0].styles[0].protected = true;
  return value;
}

test('stale or substituted source identity rejects every transport operation before upload', async () => {
  for (const operation of ['prepare', 'requestSignature', 'recover']) {
    const value = harness({ protectedAsset: true });
    const candidate = protectedInput();
    candidate.document.parts[0].items[0].styles[0].payload.animacraftSourceAsset = {
      sha256: hex(sha256(new Uint8Array([2]))), mediaType: 'image/png', byteLength: 1,
    };
    await assert.rejects(value.transport[operation](candidate), { code: 'MAKER_V8_SOURCE_ASSET_MISMATCH' });
    assert.deepEqual(value.calls, []);
  }
});

test('transport certifies actual Soul bundle, every asset and Manifest before creating the publication plan', async () => {
  const value = harness();
  let view = await value.transport.prepare(input());
  assert.equal(view.status, 'TRANSPORT_SIGNATURE_REQUIRED');
  assert.equal(view.stage, 'LIVING_CONTENT');
  assert.match(view.message, /Soul documents/);
  view = await value.transport.requestSignature(input());
  assert.equal(view.status, 'TRANSPORT_RECOVERY_REQUIRED');
  view = await value.transport.recover(input());
  assert.equal(view.stage, 'ASSET');

  view = await value.transport.requestSignature(input());
  assert.equal(view.status, 'TRANSPORT_RECOVERY_REQUIRED');
  view = await value.transport.recover(input());
  assert.equal(view.status, 'TRANSPORT_SIGNATURE_REQUIRED');
  assert.equal(view.stage, 'MANIFEST');

  view = await value.transport.requestSignature(input());
  assert.equal(view.status, 'TRANSPORT_RECOVERY_REQUIRED');
  view = await value.transport.recover(input());
  assert.equal(view.status, 'PUBLICATION_READY');
  assert.equal(view.plan.attemptId, 'attempt-1');
  assert.deepEqual(value.calls.map(([name]) => name), [
    'prepare', 'sign', 'recover',
    'prepare', 'sign', 'recover', 'manifest', 'prepare',
    'manifest', 'sign', 'manifest', 'recover', 'publication',
  ]);
});

test('transport rejects missing or substituted asset bytes before any upload', async () => {
  const value = harness();
  const invalid = input();
  invalid.assets[0].bytesBase64 = toBase64(new Uint8Array([1, 2]));
  await assert.rejects(value.transport.prepare(invalid), {
    code: 'MAKER_V8_TRANSPORT_ASSET_DRIFT',
  });
  assert.deepEqual(value.calls, []);
});

test('Soul bundle transport retains literal author bytes, rejects empty publication and never aliases the manifest', async () => {
  const value = harness();
  const authored = input(); authored.document = structuredClone(authored.document);
  authored.document.livingContent.soulMd = '  # 原文\r\n{{OC_NAME}}\n';
  await value.transport.prepare(authored);
  const actual = [...value.contents.values()][0];
  const expected = await compileMakerV8LivingContentV8(authored.document);
  assert.equal(actual.bytesBase64, toBase64(Uint8Array.from(expected.bytes)));
  assert.equal(actual.byteSha256, expected.bundleCommitment);
  assert.notEqual(actual.bytesBase64, toBase64(MANIFEST_BYTES));
  const invalid = input(); invalid.document = structuredClone(invalid.document);
  invalid.document.livingContent.memoryMd = '';
  const fresh = harness();
  await assert.rejects(fresh.transport.prepare(invalid));
  assert.deepEqual(fresh.calls, [], 'Incomplete author drafts remain saveable but do not start publication uploads.');
});

test('uncertain Soul upload resumes its durable record without another signature and rejects substituted receipts', async () => {
  const value = harness();
  const first = await value.transport.prepare(input());
  await value.transport.requestSignature(input());
  const uncertain = await value.transport.requestSignature(input());
  assert.equal(uncertain.status, 'TRANSPORT_RECOVERY_REQUIRED');
  assert.equal(value.calls.filter(([name]) => name === 'sign').length, 1);
  await value.transport.recover(input());
  assert.equal(value.calls.filter(([name]) => name === 'prepare').length, 2, 'Soul bundle reused before first asset upload.');
  value.uploads.set(first.upload.uploadId, { ...value.uploads.get(first.upload.uploadId), byteSha256: 'aa'.repeat(32) });
  await assert.rejects(value.transport.prepare(input()), { code: 'MAKER_V8_TRANSPORT_UPLOAD_DRIFT' });
  assert.equal(value.calls.some(([name]) => name === 'publication'), false);
});

test('changing author content starts a distinct bundle identity without reusing a prior pending signature', async () => {
  const value = harness();
  const first = await value.transport.prepare(input());
  const revised = input(); revised.document = structuredClone(revised.document);
  revised.document.livingContent.memoryMd += '\nNew author memory.\n';
  const next = await value.transport.prepare(revised);
  assert.notEqual(next.upload.uploadId, first.upload.uploadId);
  assert.equal(next.stage, 'LIVING_CONTENT');
  assert.equal(value.calls.filter(([name]) => name === 'sign').length, 0);
});

test('protected Base bytes are encrypted once, durably reused, and only ciphertext reaches Walrus', async () => {
  const value = harness({ protectedAsset: true });
  let view = await value.transport.prepare(protectedInput());
  assert.equal(view.status, 'TRANSPORT_SIGNATURE_REQUIRED');
  assert.equal(view.stage, 'LIVING_CONTENT');
  await value.transport.requestSignature(protectedInput());
  view = await value.transport.recover(protectedInput());
  assert.equal(view.stage, 'ASSET');
  assert.equal(value.calls.filter(([name]) => name === 'protect').length, 1);
  assert.equal(
    value.calls.some(([name, mediaType]) => name === 'prepare' && mediaType === 'image/png'),
    false,
    'plaintext publication media is never passed to the Walrus publisher',
  );
  assert.equal(
    value.calls.some(([name, mediaType]) => name === 'prepare'
      && mediaType === MAKER_V8_SEAL_CIPHERTEXT_MEDIA_TYPE),
    true,
  );

  view = await value.transport.requestSignature(protectedInput());
  assert.equal(view.status, 'TRANSPORT_RECOVERY_REQUIRED');
  assert.equal(
    value.calls.filter(([name]) => name === 'protect').length,
    1,
    'cold retry adopts the durable randomized ciphertext instead of encrypting again',
  );
});

test('a protected upload created by another tab during encryption adopts the exact durable winner', async () => {
  const value = harness({ protectedAsset: true });
  const order = item => Array.isArray(item) ? item.map(order) : item && typeof item === 'object'
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, order(item[key])])) : item;
  let winnerBytes;
  value.protector.protectAsset = async request => {
    const contentCommitment = hex(sha256(new TextEncoder().encode(JSON.stringify(order({
      schemaVersion: MAKER_V8_PUBLICATION_TRANSPORT_SCHEMA,
      identity: request.identity, plaintextSha256: hex(sha256(ASSET_BYTES)),
    })))));
    const uploadId = makerV8WalrusUploadIdV8({ owner: OWNER,
      purpose: `protected-${hex(sha256(new TextEncoder().encode('base-default'))).slice(0, 24)}`, contentSha256: contentCommitment });
    const winner = encrypted(request.identity, 8);
    winnerBytes = winner.bytesBase64;
    await value.publisher.prepare({ uploadId, owner: OWNER, mediaType: winner.mediaType, bytesBase64: winner.bytesBase64 });
    return encrypted(request.identity, 7);
  };
  await value.transport.prepare(protectedInput());
  await value.transport.requestSignature(protectedInput());
  const view = await value.transport.recover(protectedInput());
  assert.equal(view.stage, 'ASSET');
  const durable = value.contents.get(view.upload.uploadId);
  assert.equal(durable.bytesBase64, winnerBytes);
  assert.equal(view.upload.byteSha256, durable.byteSha256);
  assert.equal(value.calls.filter(([name, mediaType]) => name === 'prepare'
    && mediaType === MAKER_V8_SEAL_CIPHERTEXT_MEDIA_TYPE).length, 1);
});
