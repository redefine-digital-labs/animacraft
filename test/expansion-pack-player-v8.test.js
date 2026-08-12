import assert from 'node:assert/strict';
import test from 'node:test';

import { createMakerV5Document } from '../maker-v4.js';
import {
  EXPANSION_PACK_MANIFEST_SCHEMA,
  canonicalExpansionPackJson,
  hashExpansionPackContent,
  protectExpansionPackPublicationCandidate,
} from '../expansion-pack-publication.js';
import {
  MAKER_SEAL_PRODUCT_PACK,
  deriveExpansionPackSealReleaseCommitmentV8,
  deriveMakerSealIdV5,
} from '../maker-seal-v5.js';
import {
  EXPANSION_PACK_V8_ACCESS,
  EXPANSION_PACK_V8_LIFECYCLE,
} from '../expansion-pack-publication-v8-app.js';
import {
  EXPANSION_PACK_PLAYER_V8_TRANSPORT_ERROR,
  expansionPackPlayerSessionRefV8,
  materializeExpansionPackPlayerEntryV8,
  matchesExpansionPackSealPublicPolicyV8,
  mergeVerifiedExpansionPackPlayersV8,
  restoreExpansionPackPlayerSessionRefsV8,
  verifyExpansionPackPlayerReleaseV8,
} from '../expansion-pack-player-v8.js';

const PARENT_HASH = '11'.repeat(32);
const RELEASE_ID = '0x300';

function baseDocument() {
  const document = createMakerV5Document({ makerId: 'maker-root', name: 'Base', creator: 'Maker' });
  document.version.versionId = 'maker-root-v7';
  document.version.number = 7;
  return document;
}

function parentRelease(overrides = {}) {
  return {
    rootMakerId: 'maker-root',
    baseMakerRootId: '0x100',
    parentLegacyMakerId: '0x200',
    versionNumber: '7',
    versionId: 'maker-root-v7',
    manifestBlobId: 'parent-quilt',
    manifestHash: PARENT_HASH,
    ownershipEpoch: 4,
    ...overrides,
  };
}

async function fixture({ paid = false, withPass = true, paidTransport = true } = {}) {
  const parent = parentRelease();
  const assetBytes = new TextEncoder().encode('published paid Pack fixture PNG');
  const assetHash = await hashExpansionPackContent(assetBytes);
  const content = {
    pack: {
      id: 'pack-one',
      namespace: 'packone',
      name: 'Pack One',
      version: '1.0.0',
      creator: '0xabc',
    },
    parent: {
      schemaVersion: 'animacraft.expansion-pack-parent-binding.v2',
      kind: 'published-release',
      rootMakerId: parent.rootMakerId,
      releaseId: parent.parentLegacyMakerId,
      versionId: parent.versionId,
      versionNumber: parent.versionNumber,
      manifestBlobId: parent.manifestBlobId,
      manifestSha256: parent.manifestHash,
      identity: 'parent-identity',
    },
    inheritance: {},
    overlay: {
      schemaVersion: 'animacraft.expansion-pack.v1',
      layerTracks: [{ id: 'hat-track', name: 'Hat', order: 0 }],
      colorChannels: [],
      assets: [{
        id: 'hat-art',
        identifier: 'assets/hat.png',
        kind: 'layer',
        mediaType: 'image/png',
        sha256: assetHash,
        byteLength: 100,
        width: 1024,
        height: 1024,
      }],
      parts: [{
        id: 'hat',
        name: 'Hat',
        required: false,
        allowRemove: true,
        menuVisible: true,
        defaultItemId: 'default',
        items: [{
          id: 'default',
          name: 'Default',
          defaultStyleId: 'default',
          styles: [{
            id: 'default',
            name: 'Default',
            assetId: 'hat-art',
            layerTrackId: 'hat-track',
            transform: { x: 0, y: 0, scale: 1, rotation: 0 },
            opacity: 1,
            blendMode: 'normal',
          }],
        }],
      }],
      rules: [],
    },
    assetReferences: { pack: ['hat-art'], parent: [] },
    commerce: {
      schemaVersion: 'animacraft.expansion-pack-commerce-draft.v1',
      projectionState: 'not-built',
      accessMode: paid ? 'PAID_ONCE' : 'FREE',
      completeMode: 'INHERIT_BASE_AND_UNLIMITED_AFTER_ACCESS',
      purchasePriceAtomic: paid ? '6000000' : '0',
      price: paid ? '6000000' : '0',
      priceDecimal: paid ? '6' : '0',
      currency: 'USDC',
      decimals: 6,
      protocolFeeBps: 1000,
      entitlement: 'WALLET_BOUND_PERMANENT',
    },
    rights: {
      schemaVersion: 'animacraft.expansion-pack-rights-draft.v1',
      projectionState: 'not-built',
      origin: 'INHERIT_PARENT',
      parentLicenseCommitment: '33'.repeat(32),
      parentManifestSha256: PARENT_HASH,
      declaration: '',
    },
    lifecycle: {
      schemaVersion: 'animacraft.expansion-pack-lifecycle-draft.v1',
      state: 'DRAFT',
      chainState: 'UNPUBLISHED',
      salesEnabled: false,
      contentAvailable: false,
    },
  };
  const contentCommitment = await hashExpansionPackContent(canonicalExpansionPackJson(content));
  const scopedRelease = paid ? await deriveExpansionPackSealReleaseCommitmentV8({
    releaseId: RELEASE_ID,
    contentCommitment,
  }) : null;
  const sealReleaseCommitment = scopedRelease?.id.replace(/^0x/i, '') || '';
  const derivedSeal = paid ? await deriveMakerSealIdV5({
    releaseCommitment: sealReleaseCommitment,
    productKind: MAKER_SEAL_PRODUCT_PACK,
    partKey: 'hat',
    itemKey: 'default',
    styleKey: 'default',
    packKey: 'pack-one',
    assetDigest: assetHash,
  }) : null;
  const sealPackageId = `0x${'77'.repeat(32)}`;
  let manifest = {
    schemaVersion: EXPANSION_PACK_MANIFEST_SCHEMA,
    kind: 'independent-expansion-pack',
    ...content,
    integrity: {
      algorithm: 'sha256',
      assetSetCommitment: '44'.repeat(32),
      contentCommitment,
    },
    publicationBoundary: {
      candidateOnly: true,
      parentChainReadback: 'required',
      walrus: 'not-uploaded',
      sui: 'not-registered',
      admission: 'not-created',
      sealPolicy: 'not-created',
    },
  };
  let manifestJson = canonicalExpansionPackJson(manifest);
  if (paid && paidTransport) {
    const sourceManifestSha256 = await hashExpansionPackContent(manifestJson);
    const protectedPublication = await protectExpansionPackPublicationCandidate({
      manifest,
      manifestJson,
      manifestSha256: sourceManifestSha256,
      manifestIdentifier: 'animacraft-expansion-pack-manifest.json',
      contentCommitment,
      candidateCommitment: 'aa'.repeat(32),
      files: [{
        identifier: 'animacraft-expansion-pack-manifest.json',
        mediaType: 'application/json',
        sha256: sourceManifestSha256,
        byteLength: new TextEncoder().encode(manifestJson).byteLength,
      }, {
        identifier: 'assets/hat.png',
        mediaType: 'image/png',
        sha256: assetHash,
        byteLength: assetBytes.byteLength,
      }],
    }, {
      pack: {
        assets: [{
          id: 'hat-art',
          blob: new Blob([assetBytes], { type: 'image/png' }),
        }],
      },
    }, {
      sealClient: {
        async encrypt({ data }) {
          return { encryptedObject: new Uint8Array([83, 69, 65, 76, ...data]) };
        },
      },
      sealPackageId,
      releaseId: RELEASE_ID,
      threshold: 1,
      serverConfigs: [{
        objectId: `0x${'99'.repeat(32)}`,
        weight: 1,
        aggregatorUrl: 'https://seal.example',
      }],
    });
    manifest = protectedPublication.candidate.manifest;
    manifestJson = protectedPublication.candidate.manifestJson;
  }
  const manifestSha256 = await hashExpansionPackContent(manifestJson);
  const sealId = manifest.transportProtection?.assets?.[0]?.sealId || derivedSeal?.id || '';
  const release = {
    objectId: RELEASE_ID,
    parentRootId: parent.baseMakerRootId,
    parentLegacyMakerId: parent.parentLegacyMakerId,
    parentVersion: parent.versionNumber,
    parentManifestBlobId: parent.manifestBlobId,
    parentManifestSha256: parent.manifestHash,
    packId: content.pack.id,
    namespace: content.pack.namespace,
    packVersion: content.pack.version,
    creator: content.pack.creator,
    manifestBlobId: 'pack-quilt',
    manifestSha256,
    contentCommitment,
    sealPolicyId: paid ? RELEASE_ID : '',
    sealPackageId: paid ? sealPackageId : '',
    sealReleaseCommitment,
    styleRegistryCommitment: '55'.repeat(32),
    accessKind: paid ? EXPANSION_PACK_V8_ACCESS.PAID_ONCE : EXPANSION_PACK_V8_ACCESS.FREE,
    purchasePriceAtomic: BigInt(content.commerce.purchasePriceAtomic),
    lifecycle: EXPANSION_PACK_V8_LIFECYCLE.ACTIVE,
    lifecycleState: 'ACTIVE',
    admittedParentOwnershipEpoch: 4n,
    styleCount: 1n,
  };
  const styleRecords = [{
    partKey: 'hat',
    itemKey: 'default',
    styleKey: 'default',
    assetBlobId: 'hat-patch-id',
    assetSha256: assetHash,
    assetSealId: paid ? sealId.replace(/^0x/i, '') : '',
  }];
  const passes = withPass ? [{
    objectId: '0x400',
    releaseId: release.objectId,
    parentRootId: parent.baseMakerRootId,
    holder: '0xdef',
    paidAtomic: release.purchasePriceAtomic,
    admittedParentOwnershipEpoch: 4n,
    contentCommitment,
  }] : [];
  return {
    parent,
    manifest,
    manifestJson,
    release,
    styleRecords,
    passes,
    sealPackageId,
    contentCommitment,
    sealReleaseCommitment,
  };
}

function deploymentSealPolicy(data, overrides = {}) {
  const protection = data.manifest.transportProtection.assets[0];
  return {
    threshold: protection.threshold,
    keyServers: protection.keyServers.map((server) => ({
      ...server,
      apiKeyName: 'X-API-Key',
      apiKey: 'local-secret-never-published',
    })),
    ...overrides,
  };
}

test('accepts only an exact parent-bound, manifest-bound and entitled v8 Pack', async () => {
  const data = await fixture();
  const verified = await verifyExpansionPackPlayerReleaseV8({
    baseDocument: baseDocument(),
    parentRelease: data.parent,
    release: data.release,
    manifestBytes: new TextEncoder().encode(data.manifestJson),
    styleRecords: data.styleRecords,
    passes: data.passes,
    walletAddress: '0xdef',
  });
  const entry = await materializeExpansionPackPlayerEntryV8(verified, {
    resolveRuntimeAsset({ asset }) {
      return {
        localAssetId: asset.assetId,
        sha256: asset.assetSha256,
        url: 'https://aggregator.example/hat.png',
      };
    },
  });
  assert.equal(entry.trusted, true);
  assert.equal(entry.access.kind, 'FREE');
  assert.equal(entry.access.entitled, true);
  assert.equal(entry.access.accessible, true);
  assert.equal(entry.pack.packId, 'pack-one');
  assert.equal(entry.assets[0].assetBlobId, 'hat-patch-id');
});

test('an active free Pack without its chain Pass is claimable but not locally enabled', async () => {
  const data = await fixture({ withPass: false });
  const entry = await verifyExpansionPackPlayerReleaseV8({
    baseDocument: baseDocument(),
    parentRelease: data.parent,
    release: data.release,
    manifest: data.manifestJson,
    styleRecords: data.styleRecords,
    walletAddress: '0xdef',
  });
  assert.equal(entry.access.availableForAcquire, true);
  assert.equal(entry.access.accessible, false);
  assert.equal(entry.access.reason, 'ENTITLEMENT_REQUIRED');
});

test('parent ownership transfer suspends existing Pass access until exact re-admission', async () => {
  const data = await fixture();
  const transferredParent = parentRelease({ ownershipEpoch: 5 });
  const stale = await verifyExpansionPackPlayerReleaseV8({
    baseDocument: baseDocument(),
    parentRelease: transferredParent,
    release: data.release,
    manifest: data.manifestJson,
    styleRecords: data.styleRecords,
    passes: data.passes,
    walletAddress: '0xdef',
  });
  assert.equal(stale.access.entitled, true);
  assert.equal(stale.access.availableForAcquire, false);
  assert.equal(stale.access.accessible, false);
  assert.equal(stale.access.reason, 'PARENT_READMISSION_REQUIRED');

  let resolutionCount = 0;
  const suspended = await materializeExpansionPackPlayerEntryV8(stale, {
    resolveRuntimeAsset() {
      resolutionCount += 1;
      throw new Error('stale admission must never resolve artwork');
    },
  });
  assert.equal(suspended.playerUsable, false);
  assert.equal(resolutionCount, 0);

  const readmitted = await verifyExpansionPackPlayerReleaseV8({
    baseDocument: baseDocument(),
    parentRelease: transferredParent,
    release: {
      ...data.release,
      admittedParentOwnershipEpoch: 5n,
    },
    manifest: data.manifestJson,
    styleRecords: data.styleRecords,
    passes: data.passes,
    walletAddress: '0xdef',
  });
  assert.equal(readmitted.access.entitled, true);
  assert.equal(readmitted.access.accessible, true);
  assert.equal(readmitted.access.reason, '');
});

test('accepts publication-protected paid Seal transport and rejects missing or unscoped proof', async () => {
  const paid = await fixture({ paid: true });
  assert.equal(paid.manifest.transportProtection.contentCommitment, paid.contentCommitment);
  assert.equal(
    paid.manifest.transportProtection.sealReleaseCommitment,
    paid.sealReleaseCommitment,
  );
  assert.notEqual(paid.sealReleaseCommitment, paid.contentCommitment);
  assert.equal(paid.passes[0].contentCommitment, paid.contentCommitment);
  const entry = await verifyExpansionPackPlayerReleaseV8({
    baseDocument: baseDocument(),
    parentRelease: paid.parent,
    release: paid.release,
    manifest: paid.manifestJson,
    styleRecords: paid.styleRecords,
    passes: paid.passes,
    walletAddress: '0xdef',
    expectedSealPackageId: paid.sealPackageId,
  });
  assert.equal(entry.access.kind, 'PAID_ONCE');
  assert.equal(entry.access.entitled, true);
  assert.equal(entry.assets[0].protection.mode, 'SEAL_PAID_PACK');
  assert.equal(
    entry.assets[0].protection.releaseCommitment,
    `0x${paid.sealReleaseCommitment}`,
  );
  assert.match(entry.assets[0].protection.ciphertextDigest, /^0x[0-9a-f]{64}$/);

  const missing = await fixture({ paid: true, paidTransport: false });
  await assert.rejects(
    verifyExpansionPackPlayerReleaseV8({
      baseDocument: baseDocument(),
      parentRelease: missing.parent,
      release: missing.release,
      manifest: missing.manifestJson,
      styleRecords: missing.styleRecords,
      passes: missing.passes,
      walletAddress: '0xdef',
    }),
    { code: 'EXPANSION_PACK_PLAYER_PAID_TRANSPORT_MISSING' },
  );

  await assert.rejects(
    verifyExpansionPackPlayerReleaseV8({
      baseDocument: baseDocument(),
      parentRelease: paid.parent,
      release: paid.release,
      manifest: paid.manifestJson,
      styleRecords: paid.styleRecords,
      passes: paid.passes,
      walletAddress: '0xdef',
      expectedSealPackageId: '0x78',
    }),
    { code: 'EXPANSION_PACK_PLAYER_SEAL_BINDING_MISMATCH' },
  );

  await assert.rejects(
    verifyExpansionPackPlayerReleaseV8({
      baseDocument: baseDocument(),
      parentRelease: paid.parent,
      release: { ...paid.release, objectId: '0x301' },
      manifest: paid.manifestJson,
      styleRecords: paid.styleRecords,
      passes: paid.passes,
      walletAddress: '0xdef',
      expectedSealPackageId: paid.sealPackageId,
    }),
    { code: 'EXPANSION_PACK_PLAYER_PAID_TRANSPORT_MISSING' },
  );

  const wrongCommitmentManifest = structuredClone(paid.manifest);
  wrongCommitmentManifest.transportProtection.sealReleaseCommitment = 'ff'.repeat(32);
  const wrongCommitmentJson = canonicalExpansionPackJson(wrongCommitmentManifest);
  await assert.rejects(
    verifyExpansionPackPlayerReleaseV8({
      baseDocument: baseDocument(),
      parentRelease: paid.parent,
      release: {
        ...paid.release,
        manifestSha256: await hashExpansionPackContent(wrongCommitmentJson),
      },
      manifest: wrongCommitmentJson,
      styleRecords: paid.styleRecords,
      passes: paid.passes,
      walletAddress: '0xdef',
      expectedSealPackageId: paid.sealPackageId,
    }),
    { code: 'EXPANSION_PACK_PLAYER_PAID_TRANSPORT_MISSING' },
  );
});

test('matches only exact public Seal policy metadata and never reads local API keys', async () => {
  const data = await fixture({ paid: true, withPass: false });
  const protection = data.manifest.transportProtection.assets[0];
  const publishedPolicy = {
    threshold: protection.threshold,
    keyServers: [{
      ...protection.keyServers[0],
      objectId: '0x000a',
    }],
  };
  const configuredServer = {
    objectId: '0xA',
    weight: protection.keyServers[0].weight,
    aggregatorUrl: protection.keyServers[0].aggregatorUrl,
    apiKeyName: 'X-API-Key',
  };
  Object.defineProperty(configuredServer, 'apiKey', {
    enumerable: true,
    get() {
      throw new Error('public matcher read a local API key');
    },
  });
  const exactDeployment = {
    threshold: protection.threshold,
    keyServers: [configuredServer],
  };
  assert.equal(
    matchesExpansionPackSealPublicPolicyV8(publishedPolicy, exactDeployment),
    true,
  );
  assert.equal(matchesExpansionPackSealPublicPolicyV8(publishedPolicy, {
    ...exactDeployment,
    threshold: protection.threshold + 1,
  }), false);
  assert.equal(matchesExpansionPackSealPublicPolicyV8(publishedPolicy, {
    ...exactDeployment,
    keyServers: [],
  }), false);
  assert.equal(matchesExpansionPackSealPublicPolicyV8(publishedPolicy, {
    ...exactDeployment,
    keyServers: [publishedPolicy.keyServers[0], {
      ...publishedPolicy.keyServers[0],
      objectId: '0xb',
    }],
  }), false);
  assert.equal(matchesExpansionPackSealPublicPolicyV8({
    ...publishedPolicy,
    keyServers: [publishedPolicy.keyServers[0], {
      ...publishedPolicy.keyServers[0],
      objectId: '0xb',
    }],
  }, {
    ...exactDeployment,
    keyServers: [publishedPolicy.keyServers[0], {
      ...publishedPolicy.keyServers[0],
      objectId: '0x000a',
    }],
  }), false);
  assert.equal(matchesExpansionPackSealPublicPolicyV8(publishedPolicy, {
    ...exactDeployment,
    keyServers: [{ ...protection.keyServers[0], objectId: '0x1234' }],
  }), false);
  assert.equal(matchesExpansionPackSealPublicPolicyV8(publishedPolicy, {
    ...exactDeployment,
    keyServers: [{ ...publishedPolicy.keyServers[0], weight: 2 }],
  }), false);
  assert.equal(matchesExpansionPackSealPublicPolicyV8(publishedPolicy, {
    ...exactDeployment,
    keyServers: [{
      ...publishedPolicy.keyServers[0],
      aggregatorUrl: 'https://other-seal.example',
    }],
  }), false);
});

test('paid transport needs deployment policy before purchase while an existing Pass survives policy drift', async () => {
  const unownedData = await fixture({ paid: true, withPass: false });
  const unownedVerified = await verifyExpansionPackPlayerReleaseV8({
    baseDocument: baseDocument(),
    parentRelease: unownedData.parent,
    release: unownedData.release,
    manifest: unownedData.manifestJson,
    styleRecords: unownedData.styleRecords,
    walletAddress: '0xdef',
    expectedSealPackageId: unownedData.sealPackageId,
  });
  const unowned = await materializeExpansionPackPlayerEntryV8(unownedVerified, {
    salesEnabled: true,
    sealPublicPolicy: deploymentSealPolicy(unownedData),
  });
  assert.equal(unowned.transportReady, true);
  assert.equal(unowned.access.availableForAcquire, true);
  assert.equal(unowned.playerUsable, false);
  assert.deepEqual(unowned.runtimeAssets, []);

  const incompatible = await materializeExpansionPackPlayerEntryV8(unownedVerified, {
    salesEnabled: true,
    sealPublicPolicy: deploymentSealPolicy(unownedData, {
      threshold: 2,
    }),
  });
  assert.equal(incompatible.transportReady, false);
  assert.equal(incompatible.access.availableForAcquire, false);
  assert.equal(
    incompatible.acquisitionBlockedReason,
    EXPANSION_PACK_PLAYER_V8_TRANSPORT_ERROR.PUBLIC_POLICY_MISMATCH,
  );

  const ownedData = await fixture({ paid: true });
  const ownedVerified = await verifyExpansionPackPlayerReleaseV8({
    baseDocument: baseDocument(),
    parentRelease: ownedData.parent,
    release: ownedData.release,
    manifest: ownedData.manifestJson,
    styleRecords: ownedData.styleRecords,
    passes: ownedData.passes,
    walletAddress: '0xdef',
    expectedSealPackageId: ownedData.sealPackageId,
  });
  const leakedCiphertext = await materializeExpansionPackPlayerEntryV8(ownedVerified, {
    sealPublicPolicy: deploymentSealPolicy(ownedData, { threshold: 2 }),
    resolveRuntimeAsset({ asset }) {
      return {
        localAssetId: asset.assetId,
        sha256: asset.assetSha256,
        url: 'https://aggregator.example/ciphertext.bcs',
      };
    },
  });
  assert.equal(leakedCiphertext.playerUsable, false);
  assert.equal(leakedCiphertext.transportReady, true);
  assert.equal(leakedCiphertext.access.entitled, true);
  assert.equal(
    leakedCiphertext.acquisitionBlockedReason,
    'EXPANSION_PACK_PLAYER_V8_RUNTIME_ASSET_INVALID',
  );

  const resolved = await materializeExpansionPackPlayerEntryV8(ownedVerified, {
    sealPublicPolicy: deploymentSealPolicy(ownedData),
    resolveRuntimeAsset({ asset }) {
      return {
        localAssetId: asset.assetId,
        sha256: asset.assetSha256,
        url: 'blob:verified-plaintext-png',
      };
    },
  });
  assert.equal(resolved.playerUsable, true);
  assert.equal(resolved.runtimeAssets[0].url, 'blob:verified-plaintext-png');
});

test('rejects parent drift, Pack manifest drift and missing exact Style rows', async () => {
  const data = await fixture();
  await assert.rejects(
    verifyExpansionPackPlayerReleaseV8({
      baseDocument: baseDocument(),
      parentRelease: parentRelease({ versionId: 'maker-root-v8' }),
      release: data.release,
      manifest: data.manifestJson,
      styleRecords: data.styleRecords,
      passes: data.passes,
      walletAddress: '0xdef',
    }),
    { code: 'EXPANSION_PACK_PLAYER_PARENT_MISMATCH' },
  );
  await assert.rejects(
    verifyExpansionPackPlayerReleaseV8({
      baseDocument: baseDocument(),
      parentRelease: data.parent,
      release: data.release,
      manifest: data.manifestJson.replace('Pack One', 'Pack Two'),
      styleRecords: data.styleRecords,
      passes: data.passes,
      walletAddress: '0xdef',
    }),
    { code: 'EXPANSION_PACK_PLAYER_MANIFEST_HASH_MISMATCH' },
  );
  await assert.rejects(
    verifyExpansionPackPlayerReleaseV8({
      baseDocument: baseDocument(),
      parentRelease: data.parent,
      release: data.release,
      manifest: data.manifestJson,
      styleRecords: [],
      passes: data.passes,
      walletAddress: '0xdef',
    }),
    { code: 'EXPANSION_PACK_PLAYER_STYLE_COUNT_MISMATCH' },
  );
});

test('session refs pin the exact release and only verified entitled overlays merge', async () => {
  const data = await fixture();
  const verified = await verifyExpansionPackPlayerReleaseV8({
    baseDocument: baseDocument(),
    parentRelease: data.parent,
    release: data.release,
    manifest: data.manifestJson,
    styleRecords: data.styleRecords,
    passes: data.passes,
    walletAddress: '0xdef',
  });
  const entry = await materializeExpansionPackPlayerEntryV8(verified, {
    resolveRuntimeAsset({ asset }) {
      return {
        localAssetId: asset.assetId,
        sha256: asset.assetSha256,
        url: 'https://aggregator.example/hat.png',
      };
    },
  });
  const ref = expansionPackPlayerSessionRefV8(entry);
  assert.equal(ref.releaseId, '0x300');
  assert.equal(restoreExpansionPackPlayerSessionRefsV8([entry], [ref])[0].identity, entry.identity);
  assert.equal(mergeVerifiedExpansionPackPlayersV8(baseDocument(), [entry]).document.parts[0].id, 'packone__hat');
  await assert.rejects(
    async () => restoreExpansionPackPlayerSessionRefsV8([entry], [{ ...ref, packVersion: '2.0.0' }]),
    { code: 'EXPANSION_PACK_PLAYER_SESSION_DRIFT' },
  );
});
