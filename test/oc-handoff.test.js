import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveLivingContent, soulidityContentManifest } from '../living-content.js';
import { synchronizeDefaultRecipe } from '../maker-document-ops.js';
import {
  buildMakerV4OcPackage,
  buildMakerV4OcUploadEntries,
} from '../maker-publication-v4.js';
import { createCharacterMakerV5Starter } from '../maker-v4.js';
import {
  COMPOSABLE_V6_OC_APPEARANCE_SCHEMA,
  attachComposableV6OcAppearanceCompanion,
  buildComposableV6OcAppearanceCompanion,
  canonicalOcPackageFingerprint,
  certifiedLivingContentSource,
  createPlayerCompletionSnapshot,
  verifyComposableV6OcAppearanceCompanion,
} from '../oc-handoff.js';

function playableMaker() {
  const document = createCharacterMakerV5Starter({
    makerId: 'handoff-maker',
    name: 'Handoff Maker',
    creator: 'Soul Atelier',
  });
  Object.assign(document.metadata, {
    summary: 'A production handoff fixture.',
    coverAssetId: 'cover',
  });
  document.metadata.license.note = 'Personal use.';
  document.assets.push({
    id: 'cover',
    identifier: 'cover.png',
    kind: 'maker-cover',
    mediaType: 'image/png',
    width: document.canvas.width,
    height: document.canvas.height,
    url: 'memory://cover',
  });
  document.parts.forEach((part, index) => {
    const item = part.items[0];
    const style = item.styles[0];
    style.assetId = `art-${index}`;
    style.layerTrackId = document.layerTracks[index].id;
    style.positionConfirmed = true;
    item.status = 'public';
    document.assets.push({
      id: style.assetId,
      identifier: `${style.assetId}.png`,
      kind: 'layer',
      mediaType: 'image/png',
      width: document.canvas.width,
      height: document.canvas.height,
      url: `memory://${style.assetId}`,
    });
  });
  synchronizeDefaultRecipe(document);
  return document;
}

test('Player completion snapshot becomes the exact Walrus OC profile and certified handoff source', async () => {
  const document = playableMaker();
  const profile = {
    name: 'Mira',
    world: 'Astral Courier',
    description: 'A calm courier between worlds.',
    tags: ['starlight', 'courier'],
  };
  const resolvedLivingContent = resolveLivingContent(document.livingContent, {
    maker: document.metadata,
    profile,
  });
  Object.assign(resolvedLivingContent, {
    soulMd: '# Player-authored Soul\n\nMira keeps her own voice.',
    memoryMd: '# Player-authored Memory\n\nA calm courier between worlds.',
    skillMd: '---\nname: mira-courier\n---\n# Player-authored courier skill',
  });
  const reviewedImageBlob = new Blob(['reviewed-png'], { type: 'image/png' });
  const reviewedImageExport = {
    sizeMode: 'standard',
    transparentBackground: true,
    width: 1024,
    height: 1024,
    mediaType: 'image/png',
  };
  const completion = createPlayerCompletionSnapshot({
    document,
    recipe: document.defaultRecipe,
    profile,
    livingContent: resolvedLivingContent,
    composableV6: {
      loadout: ['item:official', 'item:official', 'item:certified'],
      appearanceRevision: 7,
    },
    imageBlob: reviewedImageBlob,
    imageExport: reviewedImageExport,
  });
  assert.equal(Object.isFrozen(completion), true);
  assert.equal(Object.isFrozen(completion.recipe), true);
  assert.equal(Object.isFrozen(completion.profile), true);
  assert.equal(Object.isFrozen(completion.livingContent), true);
  assert.equal(Object.isFrozen(completion.imageExport), true);
  assert.equal(completion.imageBlob, reviewedImageBlob);
  assert.notEqual(completion.imageExport, reviewedImageExport);
  assert.deepEqual(completion.imageExport, reviewedImageExport);
  assert.equal(completion.imageBlob.type, 'image/png');
  assert.equal(completion.imageExport.transparentBackground, true);
  assert.equal(completion.composableV6, undefined, 'Fixed Maker keeps the existing v5 package shape');
  assert.equal(completion.livingContent.soulMd, '# Player-authored Soul\n\nMira keeps her own voice.');
  assert.equal(completion.livingContent.memoryMd, '# Player-authored Memory\n\nA calm courier between worlds.');
  assert.equal(completion.livingContent.skillMd, '---\nname: mira-courier\n---\n# Player-authored courier skill');

  profile.name = 'Changed after Complete';
  resolvedLivingContent.soulMd = '# Changed after Complete';
  resolvedLivingContent.memoryMd = '# Changed after Complete';
  resolvedLivingContent.skillMd = '---\nname: changed\n---\n# Changed after Complete';
  assert.equal(completion.profile.name, 'Mira');
  assert.match(completion.livingContent.soulMd, /Player-authored Soul/);
  assert.match(completion.livingContent.memoryMd, /Player-authored Memory/);
  assert.match(completion.livingContent.skillMd, /name: mira-courier/);

  const livingContent = soulidityContentManifest(completion.livingContent, {
    maker: document.metadata,
    makerId: '0x123',
    profile: completion.profile,
  });
  const bridge = buildMakerV4OcPackage({
    document,
    recipe: completion.recipe,
    profile: completion.profile,
    livingContent,
    makerObjectId: '0x123',
    manifestBlobId: 'certified-maker-quilt',
    createdAt: '2026-07-27T12:00:00.000Z',
    integrity: {
      recipeEncoding: 'BCS vector<RecipeSlot>',
      recipeHashAlgorithm: 'SHA-256',
      recipeHash: 'ab'.repeat(32),
    },
  });
  const entries = buildMakerV4OcUploadEntries(
    completion.imageBlob,
    bridge,
  );
  assert.equal(entries[0].blob, reviewedImageBlob);
  const uploadedProfile = JSON.parse(await entries[1].blob.text());

  assert.deepEqual(uploadedProfile.recipe, bridge.fullRecipe);
  assert.deepEqual(uploadedProfile.profile, completion.profile);
  assert.deepEqual(
    certifiedLivingContentSource(uploadedProfile),
    completion.livingContent,
  );
  assert.match(uploadedProfile.livingContent.content.soulMd, /Mira/);
  assert.match(uploadedProfile.livingContent.content.memoryMd, /calm courier between worlds/);
  assert.match(uploadedProfile.livingContent.content.skillMd, /name: mira-courier/);
  assert.doesNotMatch(uploadedProfile.livingContent.content.soulMd, /Changed after Complete/);
  assert.equal(uploadedProfile.maker.manifestBlobId, 'certified-maker-quilt');
});

test('Player completion fails closed without the exact non-empty reviewed PNG', () => {
  const document = playableMaker();
  const base = {
    document,
    recipe: document.defaultRecipe,
    profile: { name: 'Mira' },
    livingContent: {
      soulMd: '# Mira',
      memoryMd: '# Mira Memory',
      skillMd: '---\nname: mira\n---\n# Mira Skill',
    },
    imageExport: {
      sizeMode: 'standard',
      transparentBackground: false,
      width: 1024,
      height: 1024,
      mediaType: 'image/png',
    },
  };
  const invalidBlobs = [
    undefined,
    new Blob([], { type: 'image/png' }),
    new Blob(['not-png'], { type: 'image/jpeg' }),
  ];

  invalidBlobs.forEach((imageBlob) => {
    assert.throws(
      () => createPlayerCompletionSnapshot({ ...base, imageBlob }),
      (error) => error instanceof TypeError
        && /exact reviewed PNG/.test(error.message),
    );
  });
});

test('Player completion rejects invalid reviewed PNG export settings', () => {
  const document = playableMaker();
  const base = {
    document,
    recipe: document.defaultRecipe,
    profile: { name: 'Mira' },
    livingContent: {
      soulMd: '# Mira',
      memoryMd: '# Mira Memory',
      skillMd: '---\nname: mira\n---\n# Mira Skill',
    },
    imageBlob: new Blob(['reviewed-png'], { type: 'image/png' }),
  };
  const valid = {
    sizeMode: 'standard',
    transparentBackground: false,
    width: 1024,
    height: 1024,
    mediaType: 'image/png',
  };
  const invalidSettings = [
    undefined,
    { ...valid, sizeMode: 'thumbnail' },
    { ...valid, transparentBackground: 'false' },
    { ...valid, width: 0 },
    { ...valid, height: 1.5 },
    { ...valid, mediaType: 'image/jpeg' },
  ];

  invalidSettings.forEach((imageExport) => {
    assert.throws(
      () => createPlayerCompletionSnapshot({ ...base, imageExport }),
      (error) => error instanceof TypeError
        && /reviewed PNG export settings/.test(error.message),
    );
  });
});

test('Player completion rejects ambiguous Composable v6 loadout state', () => {
  const document = playableMaker();
  document.extensions ||= {};
  document.extensions.composableV6 = { profile: { mode: 'COMPOSABLE' } };
  const base = {
    document,
    recipe: document.defaultRecipe,
    profile: { name: 'Mira' },
    livingContent: {
      soulMd: '# Mira',
      memoryMd: '# Mira Memory',
      skillMd: '---\nname: mira\n---\n# Mira Skill',
    },
    imageBlob: new Blob(['reviewed-png'], { type: 'image/png' }),
    imageExport: {
      sizeMode: 'standard',
      transparentBackground: false,
      width: 1024,
      height: 1024,
      mediaType: 'image/png',
    },
  };
  for (const composableV6 of [
    [],
    { loadout: 'item:a', appearanceRevision: 0 },
    { loadout: ['item:a', 'item:a'], appearanceRevision: 0 },
    { loadout: ['item:a'], appearanceRevision: -1 },
    { loadout: ['item:a'], appearanceRevision: 1.5 },
  ]) {
    assert.throws(
      () => createPlayerCompletionSnapshot({ ...base, composableV6 }),
      (error) => error instanceof TypeError && /Composable v6/.test(error.message),
    );
  }
});

async function sha256Canonical(value) {
  const bytes = new TextEncoder().encode(canonicalOcPackageFingerprint(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((entry) => entry.toString(16).padStart(2, '0'))
    .join('');
}

function composableFixture(document) {
  document.extensions ||= {};
  document.extensions.composableV6 = { profile: { mode: 'COMPOSABLE' } };
  const makerRootId = '0xa11ce';
  const compatibilityHash = '22'.repeat(32);
  const companionManifest = {
    schemaVersion: 'animacraft.maker-composable.v6',
    baseMaker: {
      makerRootId,
      rootMakerId: document.version.rootMakerId,
      versionId: document.version.versionId,
      versionNumber: document.version.number,
      manifestHash: '11'.repeat(32),
    },
    profile: { mode: 'COMPOSABLE' },
    compatibilitySealed: true,
    compatibility: {
      manifestBlobId: 'compatibility-walrus-blob',
      manifestHash: compatibilityHash,
    },
    fallbackLoadout: {
      productIds: ['item:embedded'],
      commitment: '23'.repeat(32),
    },
    items: [
      {
        id: 'item:embedded',
        version: 1,
        makerRootId,
        compatibilityHash,
        manifestHash: '31'.repeat(32),
        rightsManifestHash: '40'.repeat(32),
        slotClaims: [{ slotId: 'base', units: 1 }],
        access: { binding: 'EMBEDDED' },
      },
      {
        id: 'item:account',
        version: 2,
        makerRootId,
        compatibilityHash,
        manifestHash: '32'.repeat(32),
        rightsManifestHash: '41'.repeat(32),
        slotClaims: [{ slotId: 'hair', units: 1 }],
        access: { binding: 'ACCOUNT' },
      },
      {
        id: 'item:owned',
        version: 3,
        makerRootId,
        compatibilityHash,
        manifestHash: '33'.repeat(32),
        rightsManifestHash: '42'.repeat(32),
        slotClaims: [{ slotId: 'accessory', units: 1 }],
        access: { binding: 'OWNED' },
      },
    ],
  };
  return { makerRootId, compatibilityHash, companionManifest };
}

test('Composable Complete embeds exact Product, Slot, entitlement and manifest bindings under one integrity hash', async () => {
  const document = playableMaker();
  const { makerRootId, compatibilityHash, companionManifest } = composableFixture(document);
  const companionManifestHash = await sha256Canonical(companionManifest);
  const completion = createPlayerCompletionSnapshot({
    document,
    recipe: document.defaultRecipe,
    profile: { name: 'Composable Mira' },
    livingContent: {
      soulMd: '# Mira',
      memoryMd: '# Memory',
      skillMd: '---\nname: mira\n---\n# Skill',
    },
    composableV6: {
      loadout: ['item:embedded', 'item:account', 'item:owned'],
      appearanceRevision: 9,
      profileObjectId: '0xcafe',
      companionManifestBlobId: 'companion-walrus-blob',
      companionManifestHash,
      productObjectIds: {
        'item:embedded': '0x101',
        'item:account': '0x102',
        'item:owned': '0x103',
      },
      entitlements: [
        {
          schemaVersion: 1,
          id: '0xe01',
          productId: 'item:account',
          itemVersion: 2,
          makerRootId,
          compatibilityHash,
          binding: 'ACCOUNT',
          holderAddress: '0xbeef',
          soulId: null,
          ownerAddress: null,
          equippedSoulId: null,
          issuedAtMs: 10,
          paidAtomic: 0,
          rightsSnapshotHash: '41'.repeat(32),
          issuanceNonce: 'account-entitlement',
          extensionsHash: '',
        },
        {
          schemaVersion: 1,
          id: '0xe02',
          productId: 'item:owned',
          itemVersion: 3,
          makerRootId,
          compatibilityHash,
          binding: 'OWNED',
          holderAddress: null,
          soulId: null,
          ownerAddress: '0xbeef',
          equippedSoulId: '0x501',
          issuedAtMs: 11,
          paidAtomic: 100,
          rightsSnapshotHash: '42'.repeat(32),
          issuanceNonce: 'owned-entitlement',
          extensionsHash: '',
        },
      ],
      companionManifest,
    },
    imageBlob: new Blob(['png'], { type: 'image/png' }),
    imageExport: {
      sizeMode: 'original',
      transparentBackground: true,
      width: 1024,
      height: 1024,
      mediaType: 'image/png',
    },
  });
  const appearance = await buildComposableV6OcAppearanceCompanion({
    document,
    completion,
    makerObjectId: makerRootId,
    baseManifestBlobId: 'base-walrus-blob',
  });
  assert.equal(appearance.companion.schemaVersion, COMPOSABLE_V6_OC_APPEARANCE_SCHEMA);
  assert.equal(appearance.companion.appearanceRevision, 9);
  assert.match(appearance.companion.loadoutHash, /^[0-9a-f]{64}$/);
  assert.match(appearance.companion.binding.profileObjectId, /cafe$/);
  assert.equal(appearance.companion.binding.companionManifestHash, companionManifestHash);
  assert.equal(appearance.companion.selections[0].entitlement, null);
  assert.match(appearance.companion.selections[1].entitlement.holderAddress, /beef$/);
  assert.match(appearance.companion.selections[2].entitlement.ownedInstanceId, /e02$/);

  const bridge = buildMakerV4OcPackage({
    document,
    recipe: completion.recipe,
    profile: completion.profile,
    livingContent: completion.livingContent,
    makerObjectId: makerRootId,
    manifestBlobId: 'base-walrus-blob',
    integrity: { recipeHash: 'aa'.repeat(32) },
  });
  const finalBundle = attachComposableV6OcAppearanceCompanion(bridge, appearance);
  assert.deepEqual(finalBundle.package.composableAppearance, appearance.companion);
  assert.equal(finalBundle.package.integrity.composableAppearanceHash, appearance.integrityHash);
  assert.equal(bridge.package.composableAppearance, undefined, 'v5 builder output remains untouched');
  assert.equal(JSON.parse(finalBundle.packageJson).composableAppearance.loadoutHash, appearance.companion.loadoutHash);
  await assert.doesNotReject(verifyComposableV6OcAppearanceCompanion({
    document,
    completion,
    packageValue: finalBundle.package,
    makerObjectId: makerRootId,
    baseManifestBlobId: 'base-walrus-blob',
  }));

  const changed = structuredClone(finalBundle.package);
  changed.composableAppearance.appearanceRevision += 1;
  await assert.rejects(
    verifyComposableV6OcAppearanceCompanion({
      document,
      completion,
      packageValue: changed,
      makerObjectId: makerRootId,
      baseManifestBlobId: 'base-walrus-blob',
    }),
    /does not match/,
  );
  assert.notEqual(
    canonicalOcPackageFingerprint(finalBundle.package),
    canonicalOcPackageFingerprint(changed),
    'upload recovery fingerprint covers the entire Appearance companion',
  );
});

test('Composable Complete fails closed for unknown fields and missing chain identities', async () => {
  const document = playableMaker();
  const { makerRootId, companionManifest } = composableFixture(document);
  const base = {
    document,
    recipe: document.defaultRecipe,
    profile: { name: 'Mira' },
    livingContent: {
      soulMd: '# Mira',
      memoryMd: '# Memory',
      skillMd: '---\nname: mira\n---\n# Skill',
    },
    imageBlob: new Blob(['png'], { type: 'image/png' }),
    imageExport: {
      sizeMode: 'standard',
      transparentBackground: false,
      width: 1024,
      height: 1024,
      mediaType: 'image/png',
    },
  };
  assert.throws(
    () => createPlayerCompletionSnapshot({
      ...base,
      composableV6: { loadout: [], appearanceRevision: 0, gameplayStats: {} },
    }),
    /unknown field gameplayStats/,
  );
  const incomplete = createPlayerCompletionSnapshot({
    ...base,
    composableV6: {
      loadout: ['item:embedded'],
      appearanceRevision: 0,
      companionManifest,
    },
  });
  await assert.rejects(
    buildComposableV6OcAppearanceCompanion({
      document,
      completion: incomplete,
      makerObjectId: makerRootId,
      baseManifestBlobId: 'base-walrus-blob',
    }),
    /Companion manifest hash/,
  );
});

test('canonical OC fingerprint covers provenance, integrity and every Living Content document', () => {
  const base = {
    schemaVersion: 'animacraft.oc-package.v2',
    maker: {
      versionId: 'maker-v1',
      manifestBlobId: 'quilt-v1',
    },
    profile: { name: 'Mira' },
    livingContent: {
      content: {
        soulMd: '# Soul',
        memoryMd: '# Memory',
        skillMd: '---\nname: mira\n---\n# Skill',
      },
    },
    recipe: { selections: [], colors: [] },
    suiSummary: { recipe: [] },
    integrity: { recipeHash: '11'.repeat(32) },
  };
  const fingerprint = canonicalOcPackageFingerprint(base);
  const reordered = {
    integrity: base.integrity,
    suiSummary: base.suiSummary,
    recipe: base.recipe,
    livingContent: base.livingContent,
    profile: base.profile,
    maker: base.maker,
    schemaVersion: base.schemaVersion,
  };
  assert.equal(canonicalOcPackageFingerprint(reordered), fingerprint);

  for (const mutate of [
    (value) => { value.maker.versionId = 'maker-v2'; },
    (value) => { value.maker.manifestBlobId = 'quilt-v2'; },
    (value) => { value.integrity.recipeHash = '22'.repeat(32); },
    (value) => { value.livingContent.content.soulMd = '# Changed Soul'; },
    (value) => { value.livingContent.content.memoryMd = '# Changed Memory'; },
    (value) => { value.livingContent.content.skillMd = '---\nname: changed\n---\n# Skill'; },
  ]) {
    const changed = structuredClone(base);
    mutate(changed);
    assert.notEqual(canonicalOcPackageFingerprint(changed), fingerprint);
  }
});

test('certified handoff rejects an OC package without all three resolved documents', () => {
  assert.throws(
    () => certifiedLivingContentSource({
      livingContent: { content: { soulMd: '# Soul', memoryMd: '# Memory' } },
    }),
    /skillMd/,
  );
});
