import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { indexedDB } from 'fake-indexeddb';
import { toBase58, toBase64 } from '@mysten/sui/utils';

import {
  MAKER_V8_PACK_DOCUMENT_SCHEMA,
  MAKER_V8_PACK_DRAFT_SCHEMA,
} from '../maker-v8-pack-controller.js';
import {
  MAKER_V8_PACK_PERSISTENCE_SCHEMA,
  createMakerV8PackPersistenceV8,
} from '../maker-v8-pack-persistence.js';

const id = (value) => `0x${BigInt(value).toString(16).padStart(64, '0')}`;
const hash = (byte) => byte.repeat(32);
const digest = (byte) => toBase58(new Uint8Array(32).fill(byte));
const ref = (value) => ({ objectId: id(value), version: String(value), digest: digest(value) });

function documentFixture() {
  const rootId = id(1);
  const owner = id(90);
  const rootVersion = '4';
  const content = hash('aa');
  const catalogId = id(20);
  const product = hash('bb');
  const caps = hash('cc');
  return {
    schemaVersion: MAKER_V8_PACK_DOCUMENT_SCHEMA,
    protocolVersion: 8,
    metadata: {
      semanticPackId: 'moon_accessories',
      name: 'Moon Accessories',
      summary: 'Optional moonlit accessories for the approved Maker.',
      coverAssetId: 'moon_asset_0',
    },
    author: { address: owner, role: 'MAKER_OWNER' },
    admission: { makerApproval: 'REQUIRED', expectedPackRegistryRevision: '7' },
    access: { kind: 'FREE', priceAtomic: '0' },
    completion: {
      mode: 'UNLIMITED_FREE', priceAtomic: '0', freeQuotaPerWallet: '0', totalCap: '0',
    },
    styles: [{
      sequence: '0',
      partKey: 'accessory',
      itemKey: 'moon_item_0',
      styleKey: 'moon_style_0',
      layerTrackKey: 'accessory_front',
      colorChannelKey: 'accent',
      defaultSwatchKey: 'moonlit',
      asset: {
        assetId: 'moon_asset_0', mediaType: 'image/png', byteLength: 1024,
        sha256: hash('dd'), blobId: 'walrus-pack-style-1',
        contentCommitment: hash('ee'), protected: false, sealBindingCommitment: null,
      },
    }],
    bindings: {
      root: {
        objectRef: ref(1), makerVersion: rootVersion, contentCommitment: content,
        lifecycle: 'ACTIVE', owner, adminCapId: id(10), controlEpoch: '2',
      },
      makerAdmin: {
        objectRef: ref(10), protocolVersion: 8, rootId, owner, controlEpoch: '2',
      },
      definitionRegistry: {
        objectRef: ref(2), rootId, rootVersion, rootContentCommitment: content,
        baseRegistryId: id(3), sealed: true, admissionCeiling: 'OPEN',
      },
      baseRegistry: {
        objectRef: ref(3), rootId, makerVersion: rootVersion,
        rootContentCommitment: content, sealed: true,
      },
      packRegistry: {
        objectRef: ref(4), rootId, rootVersion, rootContentCommitment: content,
        definitionRegistryId: id(2), admissionAuthorityId: id(5),
        admissionPolicyCommitment: hash('13'), revision: '7',
      },
      admissionAuthority: {
        objectRef: ref(5), rootId, rootVersion, rootContentCommitment: content,
      },
      physicalRegistry: {
        objectRef: ref(6), catalogId, productBindingCommitment: product,
        callCapSetCommitment: caps, rootId, makerVersion: rootVersion,
        rootContentCommitment: content, baseRegistryId: id(3), revision: '0',
      },
      marketRegistry: {
        objectRef: ref(7), catalogId, productBindingCommitment: product,
        callCapSetCommitment: caps, rootId, makerVersion: rootVersion,
        rootContentCommitment: content, treasuryId: id(8), sealed: true, revision: '0',
      },
      releaseConfig: {
        objectRef: ref(9), catalogId, productBindingCommitment: product,
        callCapSetCommitment: caps,
      },
    },
  };
}

function draftFixture({ draftId = 'moon-pack', revision = 1, updatedAt = 100 } = {}) {
  return {
    schemaVersion: MAKER_V8_PACK_DRAFT_SCHEMA,
    draftId,
    revision,
    createdAt: 100,
    updatedAt,
    document: documentFixture(),
    publication: {
      attemptId: null, status: 'UNPREPARED', chain: null, updatedAt: null, lastError: null,
    },
  };
}

test('Pack Studio IndexedDB persists exact v8 drafts with strict CAS and cold reread', async () => {
  const persistence = createMakerV8PackPersistenceV8(indexedDB, {
    databaseName: `pack-${crypto.randomUUID()}`,
  });
  assert.equal(persistence.schemaVersion, MAKER_V8_PACK_PERSISTENCE_SCHEMA);
  assert.deepEqual(persistence.capabilities, { durable: true, atomicCas: true });

  const created = await persistence.create(draftFixture());
  assert.equal(created.revision, 1);
  assert.equal(Object.isFrozen(created), true);
  assert.equal((await persistence.verify('moon-pack')).document.metadata.name, 'Moon Accessories');

  const next = structuredClone(created);
  next.revision = 2;
  next.updatedAt = 101;
  next.document.metadata.summary = 'Saved in strict fresh-v8 Pack storage.';
  const saved = await persistence.compareAndSwap({
    draftId: 'moon-pack', expectedRevision: 1, next,
  });
  assert.equal(saved.revision, 2);
  assert.equal((await persistence.list())[0].document.metadata.summary, next.document.metadata.summary);

  const bytes = new Uint8Array([1, 2, 3]);
  const assetSha256 = createHash('sha256').update(bytes).digest('hex');
  const assetNext = structuredClone(saved);
  assetNext.revision = 3;
  assetNext.updatedAt = 102;
  Object.assign(assetNext.document.styles[0].asset, {
    byteLength: bytes.length,
    sha256: assetSha256,
    contentCommitment: assetSha256,
    blobId: null,
  });
  const persistedAsset = await persistence.upsertAsset({
    draftId: 'moon-pack',
    expectedRevision: 2,
    next: assetNext,
    assetId: 'moon_asset_0',
    mediaType: 'image/png',
    bytesBase64: toBase64(bytes),
    updatedAt: 102,
  });
  assert.equal(persistedAsset.draft.revision, 3);
  assert.equal(persistedAsset.asset.sha256, assetSha256);
  assert.equal((await persistence.listAssets('moon-pack'))[0].byteLength, 3);
  assert.equal((await persistence.loadAsset('moon-pack', 'moon_asset_0')).revision, 1);

  await assert.rejects(
    persistence.compareAndSwap({ draftId: 'moon-pack', expectedRevision: 1, next }),
    { code: 'MAKER_V8_PACK_DRAFT_CAS_MISMATCH' },
  );
  assert.equal(await persistence.delete({ draftId: 'moon-pack', expectedRevision: 3 }), true);
  assert.equal(await persistence.load('moon-pack'), null);
  assert.deepEqual(await persistence.listAssets('moon-pack'), []);
  persistence.close();
});

test('Pack persistence refuses deletion after durable publication evidence exists', async () => {
  const persistence = createMakerV8PackPersistenceV8(indexedDB, {
    databaseName: `pack-published-${crypto.randomUUID()}`,
  });
  const draft = draftFixture({ draftId: 'durable-pack' });
  draft.publication = {
    attemptId: 'pack-attempt-1', status: 'READY', chain: null, updatedAt: 100, lastError: null,
  };
  await persistence.create(draft);
  await assert.rejects(
    persistence.delete({ draftId: 'durable-pack', expectedRevision: 1 }),
    { code: 'MAKER_V8_PACK_DRAFT_DELETE_FORBIDDEN' },
  );
  assert.ok(await persistence.load('durable-pack'));
  persistence.close();
});
