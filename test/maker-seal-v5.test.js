import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeSuiAddress } from '@mysten/sui/utils';

import {
  MAKER_SEAL_ASSET_V5_SCHEMA,
  MAKER_SEAL_COMPLETE_OUTPUT_V5_SCHEMA,
  MAKER_SEAL_PRODUCT_BASE,
  MAKER_SEAL_PRODUCT_PACK,
  assertMakerSealPolicyReadbackV5,
  bindMakerCompleteOutputCiphertextV5,
  buildMakerCompleteOutputSealApprovalTransactionV5,
  buildMakerSealPublicationPlanV5,
  buildSoulBoundCompleteOutputSealApprovalTransactionV5,
  decryptMakerCompleteOutputV5,
  decryptMakerSealAssetV5,
  deriveMakerCompleteOutputSealIdV5,
  deriveMakerSealIdV5,
  digestMakerSealAssetV5,
  encryptMakerCompleteOutputV5,
  makerCompleteOutputSealRecoveryPayloadV5,
  makerSealRecoveryPayloadV5,
  makerV5PaidSealBindings,
  parseMakerSealPolicyV5,
  protectMakerV5PaidPackAssetsForPublication,
  restoreMakerSealPublicationBundleV5,
  verifyMakerCompleteOutputCiphertextV5,
  verifyMakerCompleteOutputSealRecoveryPayloadV5,
  verifyMakerSealRecoveryPayloadV5,
} from '../maker-seal-v5.js';

const id = (value) => normalizeSuiAddress(`0x${value}`);
const PACKAGE_ID = id('a1');
const POLICY_ID = id('a2');
const ROOT_ID = id('a3');
const TABLE_ID = id('a4');
const SERVER_ID = id('a5');
const PAYER_ID = id('a6');
const SOUL_ID = id('a7');
const ANIMACRAFT_PROVENANCE_ID = id('a8');
const OUTPUT_PROVENANCE_ID = id('a9');
const SOUL_STATE_ID = id('aa');

const bytes = (value) => new TextEncoder().encode(value);
const blob = (value) => new Blob([bytes(value)], { type: 'image/png' });

function sourceBundle() {
  const manifest = {
    schemaVersion: 'animacraft.maker.v4',
    assets: [
      { id: 'base-art', identifier: 'assets/base.png', mediaType: 'image/png' },
      { id: 'free-pack-art', identifier: 'assets/free-pack.png', mediaType: 'image/png' },
      { id: 'premium-art', identifier: 'assets/premium.png', mediaType: 'image/png' },
      { id: 'public-preview', identifier: 'assets/preview.png', mediaType: 'image/png' },
    ],
    moveProjectionV2: {
      commerce: {
        makerAccess: {
          mode: 'ONE_TIME_PAID',
          purchasePriceAtomic: 10_000_000,
        },
        packPolicies: [
          {
            packId: 'free-pack',
            accessMode: 'FREE',
            purchasePriceAtomic: 0,
          },
          {
            packId: 'premium',
            accessMode: 'ONE_TIME_PAID',
            purchasePriceAtomic: 6_000_000,
          },
        ],
        styleProducts: [
          {
            partKey: 'body',
            itemKey: 'base',
            styleKey: 'default',
            packId: null,
            rowKind: 'VISUAL',
          },
          {
            partKey: 'accessory',
            itemKey: 'free',
            styleKey: 'gold',
            packId: 'free-pack',
            rowKind: 'VISUAL',
          },
          {
            partKey: 'hair',
            itemKey: 'long',
            styleKey: 'blue',
            packId: 'premium',
            rowKind: 'VISUAL',
          },
        ],
      },
      items: [
        {
          projectionKind: 'style',
          partKey: 'body',
          itemKey: 'base',
          sourcePartId: 'body',
          sourceItemId: 'base',
          sourceStyleId: 'default',
          assetRef: { assetId: 'base-art' },
        },
        {
          projectionKind: 'style',
          partKey: 'accessory',
          itemKey: 'free',
          sourcePartId: 'accessory',
          sourceItemId: 'free',
          sourceStyleId: 'gold',
          assetRef: { assetId: 'free-pack-art' },
        },
        {
          projectionKind: 'style',
          partKey: 'hair',
          itemKey: 'long',
          sourcePartId: 'hair',
          sourceItemId: 'long',
          sourceStyleId: 'blue',
          assetRef: { assetId: 'premium-art' },
        },
      ],
    },
  };
  const entries = [
    {
      assetId: 'base-art',
      identifier: 'assets/base.png',
      kind: 'style-asset',
      blob: blob('base art'),
    },
    {
      assetId: 'free-pack-art',
      identifier: 'assets/free-pack.png',
      kind: 'style-asset',
      blob: blob('free pack art'),
    },
    {
      assetId: 'premium-art',
      identifier: 'assets/premium.png',
      kind: 'style-asset',
      blob: blob('premium art'),
    },
    {
      assetId: 'public-preview',
      identifier: 'assets/preview.png',
      kind: 'cover-asset',
      blob: blob('public preview'),
    },
    {
      identifier: 'maker.json',
      kind: 'maker-manifest',
      blob: new Blob([JSON.stringify(manifest)], { type: 'application/json' }),
    },
  ];
  return {
    manifest,
    manifestJson: JSON.stringify(manifest),
    entries,
    assetEntries: entries.slice(0, -1),
    renderAssetEntries: entries.slice(0, -1),
  };
}

function documentFor(bundle) {
  return {
    metadata: { coverAssetId: 'public-preview' },
    assets: structuredClone(bundle.manifest.assets),
    layerTracks: [],
    parts: [],
    extensions: { expansionDrafts: [] },
  };
}

function mockSealClient() {
  const plaintextByCiphertext = new Map();
  return {
    plaintextByCiphertext,
    async encrypt({ data }) {
      const ciphertext = Uint8Array.from([
        83,
        69,
        65,
        76,
        ...data,
      ]);
      plaintextByCiphertext.set(
        Buffer.from(ciphertext).toString('hex'),
        new Uint8Array(data),
      );
      return { encryptedObject: ciphertext };
    },
    async decrypt({ data, checkShareConsistency }) {
      assert.equal(checkShareConsistency, true);
      return plaintextByCiphertext.get(Buffer.from(data).toString('hex'));
    },
  };
}

async function protectedFixture() {
  const bundle = sourceBundle();
  const sealClient = mockSealClient();
  const protectedBundle = await protectMakerV5PaidPackAssetsForPublication({
    document: documentFor(bundle),
    bundle,
    runtimeAssets: new Map(),
    sealClient,
    sealPackageId: PACKAGE_ID,
    threshold: 1,
    serverConfigs: [{
      objectId: SERVER_ID,
      weight: 1,
      aggregatorUrl: 'https://seal.example',
      apiKeyName: 'X-API-Key',
      apiKey: 'runtime-secret',
    }],
  });
  return { bundle, protectedBundle, sealClient };
}

test('Seal ID derivation is byte-for-byte compatible with the Move BCS fixture', async () => {
  const result = await deriveMakerSealIdV5({
    releaseCommitment: new Uint8Array(32).fill(1),
    productKind: MAKER_SEAL_PRODUCT_PACK,
    partKey: 'hair',
    itemKey: 'long',
    styleKey: 'blue',
    packKey: 'premium',
    assetDigest: new Uint8Array(32).fill(2),
  });
  assert.equal(
    result.id,
    '0x6da3874b2b4a12432119d07c4eac287c7d77a6fc411003f47ea73a38f0f548f2',
  );
});

test('Complete output Seal ID is byte-for-byte compatible with the Move BCS fixture', async () => {
  const result = await deriveMakerCompleteOutputSealIdV5({
    makerRootId: '0x1234',
    payer: '0xabcd',
    recipeHash: new Uint8Array(32).fill(3),
    outputNonce: new Uint8Array(32).fill(4),
    outputDigest: new Uint8Array(32).fill(5),
  });
  assert.equal(
    result.id,
    '0x85c58c270f9bd6270c39c1a44aa63e3ce92d071b45a77f9d7973a90da8bbc311',
  );
});

test('Complete output stays encrypted until its exact on-chain payer entitlement is read back', async () => {
  const sealClient = mockSealClient();
  const plaintext = bytes('final oc png bytes');
  const encrypted = await encryptMakerCompleteOutputV5({
    sealClient,
    sealPackageId: PACKAGE_ID,
    makerRootId: ROOT_ID,
    payer: PAYER_ID,
    recipeHash: new Uint8Array(32).fill(6),
    outputNonce: new Uint8Array(32).fill(7),
    outputBytes: plaintext,
    threshold: 1,
    serverConfigs: [{
      objectId: SERVER_ID,
      weight: 1,
      aggregatorUrl: 'https://seal.example',
    }],
  });
  await assert.doesNotReject(() => verifyMakerCompleteOutputCiphertextV5(
    encrypted,
    { expectedProtection: encrypted.protection },
  ));
  await assert.rejects(
    () => verifyMakerCompleteOutputCiphertextV5(
      { ...encrypted, blob: new Blob([plaintext], { type: 'image/png' }) },
      { expectedProtection: encrypted.protection },
    ),
    (error) => error?.code === 'MAKER_SEAL_V5_COMPLETE_OUTPUT_CIPHERTEXT',
  );
  assert.equal(
    encrypted.protection.schemaVersion,
    MAKER_SEAL_COMPLETE_OUTPUT_V5_SCHEMA,
  );
  const bound = bindMakerCompleteOutputCiphertextV5(encrypted, {
    ciphertextBlobId: 'walrus-final-oc-ciphertext-patch',
    publicPreviewUrl: 'https://preview.example/lowres.webp',
  });
  assert.equal(
    bound.completeOutput.ciphertextBlobId,
    'walrus-final-oc-ciphertext-patch',
  );
  assert.equal(
    bound.completeOutput.publicPreviewUrl,
    'https://preview.example/lowres.webp',
  );
  const recovery = makerCompleteOutputSealRecoveryPayloadV5(bound);
  await assert.doesNotReject(
    () => verifyMakerCompleteOutputSealRecoveryPayloadV5(recovery),
  );

  const entitlement = Object.freeze({
    rootId: ROOT_ID,
    sealId: bound.protection.sealId,
    payer: PAYER_ID,
    recipeHash: bound.protection.recipeHash,
    outputNonce: bound.protection.outputNonce,
    outputDigest: bound.protection.outputDigest,
    ciphertextBlobId: 'walrus-final-oc-ciphertext-patch',
    boundSoulId: '',
    soulBound: false,
  });
  const expectedIdBytes = Uint8Array.from(
    Buffer.from(bound.protection.sealId.slice(2), 'hex'),
  );
  const decrypted = await decryptMakerCompleteOutputV5({
    encryptedBlob: bound.blob,
    protection: bound.protection,
    entitlement,
    sealClient,
    sessionKey: { isExpired: () => false },
    txBytes: Uint8Array.of(1),
    parseEncryptedObject: () => ({
      packageId: PACKAGE_ID,
      id: expectedIdBytes,
    }),
  });
  assert.equal(decrypted.type, 'image/png');
  assert.deepEqual(
    new Uint8Array(await decrypted.arrayBuffer()),
    plaintext,
  );

  await assert.rejects(
    () => decryptMakerCompleteOutputV5({
      encryptedBlob: bound.blob,
      protection: bound.protection,
      entitlement: {
        ...entitlement,
        payer: id('ffff'),
      },
      sealClient,
      sessionKey: { isExpired: () => false },
      txBytes: Uint8Array.of(1),
      parseEncryptedObject: () => ({
        packageId: PACKAGE_ID,
        id: expectedIdBytes,
      }),
    }),
    (error) => (
      error?.code === 'MAKER_SEAL_V5_COMPLETE_OUTPUT_ENTITLEMENT_MISMATCH'
      || error?.code === 'MAKER_SEAL_V5_COMPLETE_OUTPUT_ID'
    ),
  );

  const approval = buildMakerCompleteOutputSealApprovalTransactionV5({
    callablePackageId: PACKAGE_ID,
    makerRootId: ROOT_ID,
    sealId: entitlement.sealId,
    sender: PAYER_ID,
    entitlement,
  });
  assert.equal(
    approval.getData().commands[0].MoveCall.function,
    'seal_approve_complete_output_v5',
  );

  const soulBoundEntitlement = Object.freeze({
    ...entitlement,
    boundSoulId: SOUL_ID,
    soulBound: true,
  });
  assert.throws(
    () => buildMakerCompleteOutputSealApprovalTransactionV5({
      callablePackageId: PACKAGE_ID,
      makerRootId: ROOT_ID,
      sealId: entitlement.sealId,
      sender: PAYER_ID,
      entitlement: soulBoundEntitlement,
    }),
    { code: 'MAKER_SEAL_V5_SOUL_BOUND_APPROVAL_REQUIRED' },
  );
  const soulApproval =
    buildSoulBoundCompleteOutputSealApprovalTransactionV5({
      callablePackageId: PACKAGE_ID,
      makerRootId: ROOT_ID,
      animacraftProvenanceId: ANIMACRAFT_PROVENANCE_ID,
      outputProvenanceId: OUTPUT_PROVENANCE_ID,
      soulStateId: SOUL_STATE_ID,
      sealId: entitlement.sealId,
      sender: PAYER_ID,
      entitlement: soulBoundEntitlement,
    });
  const soulApprovalCall =
    soulApproval.getData().commands[0].MoveCall;
  assert.equal(soulApprovalCall.module, 'animacraft_output_seal');
  assert.equal(
    soulApprovalCall.function,
    'seal_approve_animacraft_complete_output_v5',
  );
  assert.equal(soulApprovalCall.arguments.length, 5);
});

test('paid Base, free Pack under paid Base, and paid Pack Styles are all protected exactly once', async () => {
  const { protectedBundle } = await protectedFixture();
  const bindings = makerV5PaidSealBindings(protectedBundle.manifest);
  assert.deepEqual(
    bindings.map(({ assetId, productKind, packKey }) => ({
      assetId,
      productKind,
      packKey,
    })),
    [
      { assetId: 'base-art', productKind: MAKER_SEAL_PRODUCT_BASE, packKey: '' },
      {
        assetId: 'free-pack-art',
        productKind: MAKER_SEAL_PRODUCT_BASE,
        packKey: 'free-pack',
      },
      {
        assetId: 'premium-art',
        productKind: MAKER_SEAL_PRODUCT_PACK,
        packKey: 'premium',
      },
    ],
  );
  assert.equal(protectedBundle.seal.paidAssetCount, 3);
  assert.equal(
    protectedBundle.entries
      .filter((entry) => entry.kind === 'sealed-paid-pack-asset').length,
    3,
  );
  assert.equal(
    protectedBundle.manifest.assets
      .filter((asset) => asset.protection).length,
    3,
  );
  assert.deepEqual(
    protectedBundle.manifest.seal.keyServers,
    [{
      objectId: SERVER_ID,
      weight: 1,
      aggregatorUrl: 'https://seal.example',
    }],
    'API credentials must never enter immutable public Maker metadata',
  );
});

test('paid PNG bytes cannot reappear publicly under a different Asset ID', async () => {
  const bundle = sourceBundle();
  const publicPreview = bundle.entries.find(
    (entry) => entry.assetId === 'public-preview',
  );
  publicPreview.blob = blob('premium art');
  await assert.rejects(
    () => protectMakerV5PaidPackAssetsForPublication({
      document: documentFor(bundle),
      bundle,
      runtimeAssets: new Map(),
      sealClient: mockSealClient(),
      sealPackageId: PACKAGE_ID,
      threshold: 1,
      serverConfigs: [{
        objectId: SERVER_ID,
        weight: 1,
        aggregatorUrl: 'https://seal.example',
      }],
    }),
    (error) => (
      error?.code === 'MAKER_SEAL_V5_PAID_CONTENT_PUBLIC_COPY'
      && error?.publicAssetId === 'public-preview'
      && error?.paidAssetIds?.includes('premium-art')
    ),
  );
});

test('Seal recovery retains verified ciphertext and maps certified Quilt patch IDs', async () => {
  const { bundle, protectedBundle } = await protectedFixture();
  const recovery = makerSealRecoveryPayloadV5(protectedBundle);
  await assert.doesNotReject(() => verifyMakerSealRecoveryPayloadV5(recovery));

  const restored = await restoreMakerSealPublicationBundleV5({
    sourceBundle: bundle,
    manifestJson: protectedBundle.manifestJson,
    sealRecovery: recovery,
  });
  assert.equal(
    restored.entries.filter((entry) => entry.kind === 'sealed-paid-pack-asset').length,
    3,
  );

  const files = protectedBundle.entries.map((entry, index) => ({
    id: `quilt-patch-${index}`,
    identifier: entry.identifier,
  }));
  const plan = buildMakerSealPublicationPlanV5({
    manifest: protectedBundle.manifest,
    sealRecovery: recovery,
    entries: protectedBundle.entries,
    files,
  });
  assert.equal(plan.required, true);
  assert.equal(plan.registrations.length, 3);
  plan.registrations.forEach((registration) => {
    const index = protectedBundle.entries.findIndex(
      (entry) => entry.assetId === registration.assetId,
    );
    assert.equal(registration.ciphertextBlobId, `quilt-patch-${index}`);
  });

  const tampered = {
    ...recovery,
    ciphertextAssets: recovery.ciphertextAssets.map((asset, index) => (
      index === 0
        ? { ...asset, blob: blob('tampered') }
        : asset
    )),
  };
  await assert.rejects(
    () => verifyMakerSealRecoveryPayloadV5(tampered),
    (error) => error?.code === 'MAKER_SEAL_V5_RECOVERY_CIPHERTEXT',
  );
});

test('Seal recovery rejects disjoint Asset IDs before restoring any upload entry', async () => {
  const { bundle, protectedBundle } = await protectedFixture();
  const recovery = makerSealRecoveryPayloadV5(protectedBundle);
  const disjoint = {
    ...recovery,
    ciphertextAssets: recovery.ciphertextAssets.map((asset, index) => (
      index === 0
        ? { ...asset, assetId: 'public-preview' }
        : asset
    )),
  };
  await assert.rejects(
    () => restoreMakerSealPublicationBundleV5({
      sourceBundle: bundle,
      manifestJson: protectedBundle.manifestJson,
      sealRecovery: disjoint,
    }),
    (error) => error?.code === 'MAKER_SEAL_V5_RECOVERY_COVERAGE',
  );
});

test('Seal recovery cannot replace same-ID ciphertext with plaintext and rewrite its checkpoint digest', async () => {
  const { bundle, protectedBundle } = await protectedFixture();
  const recovery = makerSealRecoveryPayloadV5(protectedBundle);
  const target = recovery.ciphertextAssets[0];
  const plaintextEntry = bundle.entries.find(
    (entry) => entry.assetId === target.assetId,
  );
  const plaintextDigest = await digestMakerSealAssetV5(plaintextEntry.blob);
  const forged = {
    ...recovery,
    ciphertextAssets: recovery.ciphertextAssets.map((asset, index) => (
      index === 0
        ? {
          ...asset,
          blob: plaintextEntry.blob,
          ciphertextDigest: `0x${Buffer.from(plaintextDigest).toString('hex')}`,
        }
        : asset
    )),
  };
  await assert.rejects(
    () => restoreMakerSealPublicationBundleV5({
      sourceBundle: bundle,
      manifestJson: protectedBundle.manifestJson,
      sealRecovery: forged,
    }),
    (error) => (
      error?.code === 'MAKER_SEAL_V5_RECOVERY_PROTECTION'
      || error?.code === 'MAKER_SEAL_V5_RECOVERY_CIPHERTEXT'
    ),
  );
});

test('decrypt verifies ciphertext envelope and plaintext before returning a PNG Blob', async () => {
  const { protectedBundle, sealClient } = await protectedFixture();
  const asset = protectedBundle.manifest.assets.find(
    (candidate) => candidate.id === 'premium-art',
  );
  const entry = protectedBundle.entries.find(
    (candidate) => candidate.assetId === 'premium-art',
  );
  const expectedIdBytes = Uint8Array.from(
    Buffer.from(asset.protection.sealId.slice(2), 'hex'),
  );
  const decrypted = await decryptMakerSealAssetV5({
    encryptedBlob: entry.blob,
    protection: asset.protection,
    sealClient,
    sessionKey: { isExpired: () => false },
    txBytes: Uint8Array.of(1),
    parseEncryptedObject: () => ({
      packageId: PACKAGE_ID,
      id: expectedIdBytes,
    }),
  });
  assert.equal(decrypted.type, 'image/png');
  assert.deepEqual(
    new Uint8Array(await decrypted.arrayBuffer()),
    bytes('premium art'),
  );

  await assert.rejects(
    () => decryptMakerSealAssetV5({
      encryptedBlob: blob('tampered ciphertext'),
      protection: asset.protection,
      sealClient,
      sessionKey: { isExpired: () => false },
      txBytes: Uint8Array.of(1),
      parseEncryptedObject: () => ({
        packageId: PACKAGE_ID,
        id: expectedIdBytes,
      }),
    }),
    (error) => error?.code === 'MAKER_SEAL_V5_CIPHERTEXT_DIGEST_MISMATCH',
  );
});

test('policy parsing accepts Sui JSON byte vectors and readback requires exact coverage', () => {
  const commitment = new Uint8Array(32).fill(7);
  const policy = parseMakerSealPolicyV5({
    objectId: POLICY_ID,
    type: `${PACKAGE_ID}::seal_v5::MakerSealPolicyV5`,
    json: {
      version: '1',
      root_id: ROOT_ID,
      release_commitment: [...commitment],
      registered_assets: { id: { id: TABLE_ID } },
      asset_count: '1',
      sealed: true,
    },
  });
  assert.equal(policy.objectId, POLICY_ID);
  assert.equal(policy.releaseCommitment, `0x${'07'.repeat(32)}`);

  const registration = {
    sealId: `0x${'08'.repeat(32)}`,
    productKind: MAKER_SEAL_PRODUCT_PACK,
    partKey: 'hair',
    itemKey: 'long',
    styleKey: 'blue',
    packKey: 'premium',
    ciphertextBlobId: 'walrus-ciphertext',
    assetDigest: `0x${'09'.repeat(32)}`,
  };
  assert.equal(assertMakerSealPolicyReadbackV5({
    policy,
    registrations: [registration],
    makerRootId: ROOT_ID,
    releaseCommitment: commitment,
    expectedRegistrations: [registration],
  }), true);
  assert.throws(
    () => assertMakerSealPolicyReadbackV5({
      policy,
      registrations: [registration],
      makerRootId: ROOT_ID,
      releaseCommitment: commitment,
      expectedRegistrations: [{
        ...registration,
        ciphertextBlobId: 'different-walrus-ciphertext',
      }],
    }),
    (error) => error?.code === 'MAKER_SEAL_V5_REGISTRATION_MISMATCH',
  );
});
