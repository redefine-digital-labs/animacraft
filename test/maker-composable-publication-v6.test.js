import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  COMPOSABLE_PROFILE_MODES,
  ITEM_ACCESS_MODES,
  ITEM_BINDING_MODES,
  ITEM_ORIGIN_CLASSES,
  ITEM_RIGHTS_ORIGINS,
  THIRD_PARTY_ADMISSION_MODES,
  createCompatibilityProfileV6,
  createComposableProfileV6,
  createItemProductV6,
} from '../maker-composable-v6.js';
import {
  MAKER_COMPOSABLE_V6_DRAFT_SCHEMA,
  attachMakerComposableV6Draft,
  hashMakerComposableV6BaseManifest,
} from '../maker-composable-v6-bridge.js';
import {
  MAKER_COMPOSABLE_PUBLICATION_V6_ACTION_STATUS,
  MAKER_COMPOSABLE_PUBLICATION_V6_STAGES,
  MAKER_COMPOSABLE_V6_MOVE_FUNCTIONS,
  MakerComposableV6PublicationError,
  beginMakerComposableV6PublicationAction,
  buildMakerComposableV6PublicationPlan,
  confirmMakerComposableV6PublicationAction,
  createMakerComposableV6PublicationCheckpoint,
  hydrateMakerComposableV6PublicationCheckpoint,
  markMakerComposableV6PublicationSubmitted,
  nextMakerComposableV6PublicationAction,
  serializeMakerComposableV6PublicationCheckpoint,
} from '../maker-composable-publication-v6.js';
import { createMakerV5Document } from '../maker-v4.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const HASH_D = 'd'.repeat(64);
const HASH_E = 'e'.repeat(64);
const HASH_F = 'f'.repeat(64);
const ROOT_ID = '0xa11ce';
const OWNER = '0x0a11ce';
const THIRD_PARTY = '0x0b0b';

function product({
  id,
  originClass,
  slotId,
  trackId,
  access,
  binding,
  priceAtomic = 0,
  transferable = false,
  requires = [],
  excludes = [],
} = {}) {
  const endorsed = originClass !== ITEM_ORIGIN_CLASSES.OPEN;
  const publisher = originClass === ITEM_ORIGIN_CLASSES.OFFICIAL
    ? OWNER
    : THIRD_PARTY;
  return createItemProductV6({
    id,
    version: 1,
    makerRootId: ROOT_ID,
    compatibilityHash: HASH_E,
    creator: publisher,
    publisher,
    originClass,
    display: {
      name: id,
      description: `${id} release fixture`,
      thumbnailBlobId: `walrus-thumb-${id}`,
      thumbnailHash: HASH_A,
    },
    components: [{
      id: `${id}-component`,
      layerTrackId: trackId,
      assetBlobId: `walrus-asset-${id}`,
      assetHash: HASH_B,
      assetWidth: 1024,
      assetHeight: 1024,
      transform: {
        x: 0,
        y: 0,
        scale: 1,
        rotation: 0,
        opacity: 1,
        blendMode: 'normal',
      },
      baseSource: null,
    }],
    validation: {
      passed: true,
      attestationId: `technical-${id}`,
      epoch: 7,
    },
    certification: endorsed
      ? { certifier: OWNER, ownershipEpoch: 4 }
      : null,
    manifestBlobId: `walrus-manifest-${id}`,
    manifestHash: HASH_C,
    contentHash: HASH_D,
    slotClaims: [{ slotId, units: 1 }],
    requires,
    excludes,
    rightsOrigin: ITEM_RIGHTS_ORIGINS.ONCHAIN_NATIVE,
    rightsManifestHash: HASH_A,
    access: {
      mode: access,
      binding,
      priceAtomic,
      transferable,
    },
    makerEcosystemFeeBps: access === ITEM_ACCESS_MODES.PAID_ONCE ? 500 : 0,
  });
}

function fixtureDocument({
  cycle = false,
  description = '',
  officialExternalDependency = false,
} = {}) {
  const document = createMakerV5Document({
    makerId: 'composable-release-fixture',
    creator: OWNER,
    version: {
      versionId: 'composable-release-v4',
      versionNumber: 4,
      parentVersionId: 'composable-release-v3',
      compatibility: 'compatible',
    },
  });
  const compatibility = createCompatibilityProfileV6({
    makerRootId: ROOT_ID,
    canvas: { width: 1024, height: 1024 },
    coordinate: { origin: 'TOP_LEFT', unit: 'PIXEL', pixelMode: false },
    renderer: { version: 'renderer-v6.1', commitment: HASH_A },
    layerTrackIds: ['body-track', 'outfit-track', 'accessory-track'],
    slots: [
      { id: 'body', capacity: 1, required: true, layerTrackIds: ['body-track'] },
      { id: 'outfit', capacity: 1, required: false, layerTrackIds: ['outfit-track'] },
      { id: 'accessory', capacity: 1, required: false, layerTrackIds: ['accessory-track'] },
    ],
    maskPolicyHash: HASH_B,
    rulesHash: HASH_C,
    fallbackProductIds: ['official-body'],
    fallbackLoadoutHash: HASH_D,
    manifestBlobId: 'walrus-compatibility-v6',
    manifestHash: HASH_E,
  });
  const official = product({
    id: 'official-body',
    originClass: ITEM_ORIGIN_CLASSES.OFFICIAL,
    slotId: 'body',
    trackId: 'body-track',
    access: ITEM_ACCESS_MODES.EMBEDDED,
    binding: ITEM_BINDING_MODES.EMBEDDED,
    requires: [],
  });
  official.display.description += description;
  const certified = product({
    id: 'certified-outfit',
    originClass: ITEM_ORIGIN_CLASSES.CERTIFIED,
    slotId: 'outfit',
    trackId: 'outfit-track',
    access: ITEM_ACCESS_MODES.PAID_ONCE,
    binding: ITEM_BINDING_MODES.ACCOUNT,
    priceAtomic: 2_500_000,
    requires: cycle
      ? ['official-body', 'open-accessory']
      : ['official-body'],
  });
  const open = product({
    id: 'open-accessory',
    originClass: ITEM_ORIGIN_CLASSES.OPEN,
    slotId: 'accessory',
    trackId: 'accessory-track',
    access: ITEM_ACCESS_MODES.FREE_CLAIM,
    binding: ITEM_BINDING_MODES.OWNED,
    transferable: true,
    excludes: ['certified-outfit'],
  });
  const officialExternal = officialExternalDependency
    ? product({
        id: 'official-extra',
        originClass: ITEM_ORIGIN_CLASSES.OFFICIAL,
        slotId: 'accessory',
        trackId: 'accessory-track',
        access: ITEM_ACCESS_MODES.EMBEDDED,
        binding: ITEM_BINDING_MODES.EMBEDDED,
        requires: ['certified-outfit'],
      })
    : null;
  return attachMakerComposableV6Draft(document, {
    schemaVersion: MAKER_COMPOSABLE_V6_DRAFT_SCHEMA,
    profile: createComposableProfileV6({
      mode: COMPOSABLE_PROFILE_MODES.COMPOSABLE,
      thirdPartyAdmission: THIRD_PARTY_ADMISSION_MODES.OPEN,
      itemAssetization: true,
      extensionsHash: HASH_F,
    }),
    compatibility,
    compatibilitySealed: true,
    items: [open, certified, official, ...(officialExternal ? [officialExternal] : [])],
    extensionsHash: '',
  });
}

function baseManifest(document) {
  return {
    schemaVersion: 'animacraft.maker.v5',
    version: structuredClone(document.version),
    metadata: { id: document.metadata.id, name: document.metadata.name },
  };
}

function runtime(enabled = false) {
  return {
    network: 'mainnet',
    callablePackageId: '0x111',
    commerceProtocolConfigV5Id: '0x777',
    compositionV6TypeOriginPackageId: '0x222',
    compositionProtocolConfigV6Id: '0x333',
    compositionProtocolTreasuryV6Id: '0x444',
    compositionRegistryV6Id: '0x555',
    compositionV6SoulOwnerProofTypeOriginPackageId: '0x999',
    compositionV6SoulOwnerProofType:
      '0x999::animacraft_soul_owner_proof_v6::AnimacraftSoulOwnerProofV6',
    soulidityTypeOriginPackageId: '0x998',
    paymentCoinType: '0x2::usdc::USDC',
    commerceV5ReleaseEnabled: true,
    canonicalSoulMintEnabled: true,
    compositionV6ReleaseEnabled: enabled,
  };
}

async function planFor(document = fixtureDocument(), runtimeConfig = runtime(false)) {
  const manifest = baseManifest(document);
  const json = JSON.stringify(manifest);
  return buildMakerComposableV6PublicationPlan({
    document,
    baseManifest: manifest,
    baseManifestJson: json,
    baseManifestHash: await hashMakerComposableV6BaseManifest(json),
    baseMakerRootId: ROOT_ID,
    makerOwner: OWNER,
    currentOwnershipEpoch: 4,
    context: {
      makerKey: 'maker:composable-release-fixture',
      owner: OWNER,
      makerControlCapId: '0xcafe',
      validatorCapId: '0xaaaa',
      validatorAddress: '0xbbbb',
      openAdmissionSubmitter: OWNER,
    },
    runtime: runtimeConfig,
  });
}

async function beginAndConfirm(checkpoint, plan, runtimeConfig, confirmation) {
  const action = await nextMakerComposableV6PublicationAction({
    checkpoint,
    plan,
    runtime: runtimeConfig,
  });
  let next = await beginMakerComposableV6PublicationAction({
    checkpoint,
    plan,
    runtime: runtimeConfig,
    now: '2026-07-31T00:00:00.000Z',
  });
  next = await markMakerComposableV6PublicationSubmitted({
    checkpoint: next,
    plan,
    actionId: action.id,
    submission: action.transport === 'SUI'
      ? { transactionDigest: `submitted-${action.id}` }
      : { uploadId: `submitted-${action.id}` },
    now: '2026-07-31T00:00:01.000Z',
  });
  return confirmMakerComposableV6PublicationAction({
    checkpoint: next,
    plan,
    actionId: action.id,
    confirmation,
    now: '2026-07-31T00:00:02.000Z',
  });
}

test('release plan byte-locks the independent companion before audited Move actions', async () => {
  const plan = await planFor();
  assert.equal(plan.schema, 'animacraft.maker-composable-release-plan.v6');
  assert.match(plan.companion.manifestHash, /^[0-9a-f]{64}$/);
  assert.equal(plan.binding.companionManifestHash, plan.companion.manifestHash);
  assert.equal(plan.binding.baseMakerRootId, ROOT_ID);
  assert.equal(plan.binding.baseVersionId, 'composable-release-v4');
  assert.equal(plan.context.commerceProtocolConfigV5Id, '0x777');
  assert.equal(plan.summary.itemCount, 3);
  assert.equal(plan.summary.officialCount, 1);
  assert.equal(plan.summary.certifiedCount, 1);
  assert.equal(plan.summary.openCount, 1);
  assert.equal(plan.summary.validatorAttestationCount, 3);
  assert.equal(plan.summary.makerEndorsementCount, 2);
  assert.equal(plan.summary.baseOfficialCount, 1);
  assert.equal(plan.summary.postSealExternalCount, 2);
  assert.deepEqual(plan.actions.slice(0, 3).map((action) => action.id), [
    'walrus.companion.upload',
    'walrus.companion.certify',
    'chain.profile.create',
  ]);
  const sealIndex = plan.actions.findIndex((action) => action.id === 'chain.profile.seal');
  const officialAttestationIndex = plan.actions.findIndex((action) => (
    action.id === 'chain.product.attest.official-body'
  ));
  const officialAdmissionIndex = plan.actions.findIndex((action) => (
    action.id === 'chain.product.admit.official-body'
  ));
  const firstExternalPublishIndex = plan.actions.findIndex((action) => (
    action.id === 'chain.product.publish.certified-outfit'
  ));
  assert.ok(officialAttestationIndex < sealIndex);
  assert.ok(sealIndex < officialAdmissionIndex);
  assert.ok(officialAdmissionIndex < firstExternalPublishIndex);
  assert.deepEqual(plan.actions.slice(3).map((action) => action.id), [
    'chain.product.publish.official-body',
    'chain.product.attest.official-body',
    'chain.profile.seal',
    'chain.product.admit.official-body',
    'chain.product.publish.certified-outfit',
    'chain.product.attest.certified-outfit',
    'chain.product.admit.certified-outfit',
    'chain.product.publish.open-accessory',
    'chain.product.attest.open-accessory',
    'chain.product.admit.open-accessory',
  ]);
  const v5GatedActionNames = new Set(Object.values(MAKER_COMPOSABLE_V6_MOVE_FUNCTIONS)
    .filter((name) => !name.startsWith('profile_companion_')));
  const v5GatedActions = plan.actions.filter((action) => (
    action.transport === 'SUI'
      && v5GatedActionNames.has(action.target.split('::').at(-1))
  ));
  assert.equal(v5GatedActions.length, 11);
  v5GatedActions.forEach((action) => {
    assert.deepEqual(action.inputs.commerceProtocolConfigV5Id, {
      $context: 'commerceProtocolConfigV5Id',
    });
  });
});

test('Official, Certified and Open policies preserve validation, endorsement, binding and payment', async () => {
  const plan = await planFor();
  const publishes = plan.actions.filter((action) => action.id.includes('.publish.'));
  const official = publishes.find((action) => action.policy.originClass === 'OFFICIAL');
  const certified = publishes.find((action) => action.policy.originClass === 'CERTIFIED');
  const open = publishes.find((action) => action.policy.originClass === 'OPEN');
  assert.equal(official.policy.technicalValidation.onchainValidatorAttestationRequired, true);
  assert.equal(certified.policy.technicalValidation.onchainValidatorAttestationRequired, true);
  assert.equal(open.policy.technicalValidation.onchainValidatorAttestationRequired, true);
  assert.equal(official.policy.makerEndorsement.required, true);
  assert.equal(certified.policy.makerEndorsement.required, true);
  assert.equal(open.policy.makerEndorsement.required, false);
  assert.equal(certified.policy.economics.accessMode, ITEM_ACCESS_MODES.PAID_ONCE);
  assert.equal(certified.policy.economics.bindingMode, ITEM_BINDING_MODES.ACCOUNT);
  assert.equal(certified.policy.economics.priceAtomic, '2500000');
  assert.equal(certified.policy.economics.makerEcosystemFeeBps, 500);
  assert.equal(open.policy.economics.bindingMode, ITEM_BINDING_MODES.OWNED);
  assert.equal(open.policy.economics.transferable, true);
  assert.equal(official.inputs.originKind, 0);
  assert.equal(certified.inputs.originKind, 1);
  assert.equal(open.inputs.originKind, 2);
  assert.match(official.target, /::composition_v6::publish_official_item_product_v6$/);
  assert.match(certified.target, /::composition_v6::publish_external_item_product_v6$/);
});

test('audited function constants match the actual composition_v6 public entry surface', async () => {
  const source = await readFile(
    new URL('../move/animacraft/sources/composition_v6.move', import.meta.url),
    'utf8',
  );
  Object.values(MAKER_COMPOSABLE_V6_MOVE_FUNCTIONS).forEach((functionName) => {
    assert.match(source, new RegExp(`public fun\\s+${functionName}\\s*\\(`));
  });
  [
    MAKER_COMPOSABLE_V6_MOVE_FUNCTIONS.CREATE_PROFILE,
    MAKER_COMPOSABLE_V6_MOVE_FUNCTIONS.PUBLISH_OFFICIAL_PRODUCT,
    MAKER_COMPOSABLE_V6_MOVE_FUNCTIONS.PUBLISH_EXTERNAL_PRODUCT,
    MAKER_COMPOSABLE_V6_MOVE_FUNCTIONS.PUBLISH_VALIDATOR_ATTESTATION,
    MAKER_COMPOSABLE_V6_MOVE_FUNCTIONS.SEAL_PROFILE,
    MAKER_COMPOSABLE_V6_MOVE_FUNCTIONS.ADMIT_OFFICIAL,
    MAKER_COMPOSABLE_V6_MOVE_FUNCTIONS.ADMIT_CERTIFIED,
    MAKER_COMPOSABLE_V6_MOVE_FUNCTIONS.ADMIT_OPEN,
  ].forEach((functionName) => {
    assert.match(
      source,
      new RegExp(`public fun\\s+${functionName}\\s*\\([\\s\\S]*?v5_config:\\s*&CommerceProtocolConfigV5,`),
    );
  });
  assert.match(
    source,
    /public fun\s+create_maker_profile_v6\s*\([\s\S]*?config:\s*&CompositionProtocolConfigV6,[\s\S]*?v5_config:\s*&CommerceProtocolConfigV5,[\s\S]*?renderer_commitment:\s*vector<u8>,[\s\S]*?companion_manifest_blob_id:\s*String,[\s\S]*?companion_manifest_hash:\s*vector<u8>,[\s\S]*?extensions_hash:\s*vector<u8>,[\s\S]*?ctx:\s*&mut TxContext,/,
  );
  assert.match(
    source,
    /public fun\s+publish_external_item_product_v6\s*\([\s\S]*?v5_config:\s*&CommerceProtocolConfigV5,[\s\S]*?origin_kind:\s*u8,[\s\S]*?family_commitment:\s*vector<u8>,/,
  );
});

test('disabled v6 gate allows only plan/checkpoint preview and rejects Walrus or Sui writes', async () => {
  const plan = await planFor();
  const checkpoint = await createMakerComposableV6PublicationCheckpoint({
    plan,
    nonce: 'release-nonce-disabled-0001',
    createdAt: '2026-07-31T00:00:00.000Z',
  });
  await assert.rejects(
    nextMakerComposableV6PublicationAction({
      checkpoint,
      plan,
      runtime: runtime(false),
    }),
    (failure) => failure instanceof MakerComposableV6PublicationError
      && failure.code === 'COMPOSABLE_V6_RELEASE_DISABLED',
  );
  assert.equal(checkpoint.stage, MAKER_COMPOSABLE_PUBLICATION_V6_STAGES.COMPANION_LOCKED);
  assert.equal(checkpoint.actions[0].status, MAKER_COMPOSABLE_PUBLICATION_V6_ACTION_STATUS.PENDING);
  assert.equal(plan.actions[0].id, 'walrus.companion.upload');
});

test('enabled gate still rejects a changed runtime tuple or wrong Soul owner-proof TypeOrigin', async () => {
  const plan = await planFor();
  let checkpoint = await createMakerComposableV6PublicationCheckpoint({
    plan,
    nonce: 'release-nonce-runtime-scope-01',
  });
  checkpoint = await beginAndConfirm(checkpoint, plan, runtime(true), {
    blobId: 'walrus-companion-blob',
    observedHash: plan.companion.manifestHash,
  });
  checkpoint = await beginAndConfirm(checkpoint, plan, runtime(true), {
    blobId: 'walrus-companion-blob',
    certified: true,
    observedHash: plan.companion.manifestHash,
  });

  await assert.rejects(
    nextMakerComposableV6PublicationAction({
      checkpoint,
      plan,
      runtime: {
        ...runtime(true),
        compositionProtocolConfigV6Id: '0x9999',
      },
    }),
    (failure) => failure.code === 'COMPOSABLE_V6_RUNTIME_SCOPE_MISMATCH',
  );
  await assert.rejects(
    nextMakerComposableV6PublicationAction({
      checkpoint,
      plan,
      runtime: {
        ...runtime(true),
        commerceProtocolConfigV5Id: '0x8888',
      },
    }),
    (failure) => failure.code === 'COMPOSABLE_V6_RUNTIME_SCOPE_MISMATCH'
      && failure.details.fields.includes('commerceProtocolConfigV5Id'),
  );
  await assert.rejects(
    nextMakerComposableV6PublicationAction({
      checkpoint,
      plan,
      runtime: {
        ...runtime(true),
        compositionV6SoulOwnerProofType:
          '0x998::animacraft_soul_owner_proof_v6::AnimacraftSoulOwnerProofV6',
      },
    }),
    (failure) => failure.code === 'COMPOSABLE_V6_RUNTIME_PROOF_TYPE_MISMATCH',
  );
});

test('enabled gate rejects a runtime missing the live Commerce v5 emergency gate object', async () => {
  const plan = await planFor();
  const checkpoint = await createMakerComposableV6PublicationCheckpoint({
    plan,
    nonce: 'release-nonce-v5-gate-object-01',
  });
  await assert.rejects(
    nextMakerComposableV6PublicationAction({
      checkpoint,
      plan,
      runtime: {
        ...runtime(true),
        commerceProtocolConfigV5Id: '',
      },
    }),
    (failure) => failure.code === 'COMPOSABLE_V6_RUNTIME_INCOMPLETE'
      && failure.details.fields.includes('commerceProtocolConfigV5Id'),
  );
});

test('checkpoint nonce is bound to base root/version/hash and exact companion hash', async () => {
  const plan = await planFor();
  const checkpoint = await createMakerComposableV6PublicationCheckpoint({
    plan,
    nonce: 'release-nonce-scope-0000001',
  });
  const recovered = await hydrateMakerComposableV6PublicationCheckpoint(
    JSON.parse(serializeMakerComposableV6PublicationCheckpoint(checkpoint)),
    { plan },
  );
  assert.equal(recovered.binding.companionManifestHash, plan.companion.manifestHash);

  const changedPlan = await planFor(fixtureDocument({ description: ' changed' }));
  assert.notEqual(changedPlan.companion.manifestHash, plan.companion.manifestHash);
  await assert.rejects(
    hydrateMakerComposableV6PublicationCheckpoint(checkpoint, { plan: changedPlan }),
    (failure) => failure.code === 'COMPOSABLE_V6_PUBLICATION_CHECKPOINT_SCOPE_MISMATCH',
  );

  const tampered = structuredClone(checkpoint);
  tampered.nonce = 'release-nonce-other-0000001';
  await assert.rejects(
    hydrateMakerComposableV6PublicationCheckpoint(tampered, { plan }),
    (failure) => failure.code === 'COMPOSABLE_V6_PUBLICATION_CHECKPOINT_NONCE_MISMATCH',
  );
});

test('intent/submission/readback advance in order and resolve earlier object outputs', async () => {
  const plan = await planFor();
  const runtimeConfig = runtime(true);
  let checkpoint = await createMakerComposableV6PublicationCheckpoint({
    plan,
    nonce: 'release-nonce-transitions-01',
  });
  checkpoint = await beginAndConfirm(checkpoint, plan, runtimeConfig, {
    blobId: 'walrus-companion-blob',
    uploadDigest: 'upload-digest',
    observedHash: plan.companion.manifestHash,
  });
  checkpoint = await beginAndConfirm(checkpoint, plan, runtimeConfig, {
    blobId: 'walrus-companion-blob',
    certified: true,
    observedHash: plan.companion.manifestHash,
  });
  let next = await nextMakerComposableV6PublicationAction({
    checkpoint,
    plan,
    runtime: runtimeConfig,
  });
  assert.equal(next.id, 'chain.profile.create');
  assert.equal(next.inputs.rootId, ROOT_ID);
  assert.equal(next.inputs.commerceProtocolConfigV5Id, '0x777');
  assert.equal(next.inputs.compositionRegistryV6Id, '0x555');
  assert.equal(next.inputs.companionManifestBlobId, 'walrus-companion-blob');
  assert.equal(next.inputs.companionManifestHash, plan.companion.manifestHash);
  assert.equal(next.inputs.extensionsHash, HASH_F);
  assert.notEqual(next.inputs.extensionsHash, next.inputs.companionManifestHash);
  checkpoint = await beginAndConfirm(checkpoint, plan, runtimeConfig, {
    profileId: '0xabc1',
    companionManifestBlobId: 'walrus-companion-blob',
    companionManifestHash: plan.companion.manifestHash,
    transactionDigest: 'profile-digest',
    readbackVerified: true,
  });
  next = await nextMakerComposableV6PublicationAction({
    checkpoint,
    plan,
    runtime: runtimeConfig,
  });
  assert.equal(next.id, 'chain.product.publish.official-body');
  assert.equal(next.inputs.profileId, '0xabc1');
  assert.equal(next.policy.economics.bindingMode, ITEM_BINDING_MODES.EMBEDDED);
});

test('the pure checkpoint can recoverably complete the full multi-authority release plan', async () => {
  const plan = await planFor();
  const runtimeConfig = runtime(true);
  let checkpoint = await createMakerComposableV6PublicationCheckpoint({
    plan,
    nonce: 'release-nonce-full-state-machine',
  });
  let objectCounter = 0x1000;
  while (!checkpoint.completed) {
    const next = await nextMakerComposableV6PublicationAction({
      checkpoint,
      plan,
      runtime: runtimeConfig,
    });
    let confirmation;
    if (next.id === 'walrus.companion.upload') {
      confirmation = {
        blobId: 'walrus-companion-blob',
        uploadDigest: 'upload-digest',
        observedHash: plan.companion.manifestHash,
      };
    } else if (next.id === 'walrus.companion.certify') {
      confirmation = {
        blobId: 'walrus-companion-blob',
        certified: true,
        observedHash: plan.companion.manifestHash,
      };
    } else {
      confirmation = {
        transactionDigest: `digest-${next.id}`,
        readbackVerified: true,
      };
      if (next.id === 'chain.profile.create') {
        confirmation.profileId = `0x${(objectCounter += 1).toString(16)}`;
        confirmation.companionManifestBlobId = 'walrus-companion-blob';
        confirmation.companionManifestHash = plan.companion.manifestHash;
      }
      if (next.id.startsWith('chain.product.publish.')) {
        confirmation.productId = `0x${(objectCounter += 1).toString(16)}`;
      }
      if (next.id.startsWith('chain.product.attest.')) {
        confirmation.attestationId = `0x${(objectCounter += 1).toString(16)}`;
      }
      if (next.id === 'chain.profile.seal') confirmation.sealedReadback = true;
      if (next.id.startsWith('chain.product.admit.')) {
        confirmation.admissionReadback = true;
      }
    }
    checkpoint = await beginAndConfirm(
      checkpoint,
      plan,
      runtimeConfig,
      confirmation,
    );
  }
  assert.equal(checkpoint.stage, MAKER_COMPOSABLE_PUBLICATION_V6_STAGES.COMPLETE);
  assert.equal(checkpoint.currentActionIndex, plan.actions.length);
  assert.ok(checkpoint.actions.every((entry) => (
    entry.status === MAKER_COMPOSABLE_PUBLICATION_V6_ACTION_STATUS.CONFIRMED
  )));
  assert.equal(await nextMakerComposableV6PublicationAction({
    checkpoint,
    plan,
    runtime: runtimeConfig,
  }), null);
});

test('submission cannot skip the durable intent and chain confirmation requires readback', async () => {
  const plan = await planFor();
  let checkpoint = await createMakerComposableV6PublicationCheckpoint({
    plan,
    nonce: 'release-nonce-readback-0001',
  });
  await assert.rejects(
    markMakerComposableV6PublicationSubmitted({
      checkpoint,
      plan,
      actionId: 'walrus.companion.upload',
      submission: { uploadId: 'early' },
    }),
    (failure) => failure.code === 'COMPOSABLE_V6_PUBLICATION_INTENT_MISSING',
  );
  checkpoint = await beginAndConfirm(checkpoint, plan, runtime(true), {
    blobId: 'walrus-companion-blob',
    observedHash: plan.companion.manifestHash,
  });
  checkpoint = await beginAndConfirm(checkpoint, plan, runtime(true), {
    blobId: 'walrus-companion-blob',
    certified: true,
    observedHash: plan.companion.manifestHash,
  });
  checkpoint = await beginMakerComposableV6PublicationAction({
    checkpoint,
    plan,
    runtime: runtime(true),
  });
  await assert.rejects(
    confirmMakerComposableV6PublicationAction({
      checkpoint,
      plan,
      actionId: 'chain.profile.create',
      confirmation: { profileId: '0xabc1', transactionDigest: 'digest' },
    }),
    (failure) => failure.code === 'COMPOSABLE_V6_CHAIN_READBACK_REQUIRED',
  );
  await assert.rejects(
    confirmMakerComposableV6PublicationAction({
      checkpoint,
      plan,
      actionId: 'chain.profile.create',
      confirmation: {
        profileId: '0xabc1',
        companionManifestBlobId: 'wrong-walrus-blob',
        companionManifestHash: plan.companion.manifestHash,
        transactionDigest: 'digest',
        readbackVerified: true,
      },
    }),
    (failure) => failure.code === 'COMPOSABLE_V6_PROFILE_COMPANION_READBACK_MISMATCH',
  );
});

test('rule cycles fail closed because Move requires every target admitted first', async () => {
  await assert.rejects(
    planFor(fixtureDocument({ cycle: true })),
    (failure) => failure.code === 'COMPOSABLE_V6_PUBLICATION_RULE_CYCLE',
  );
});

test('Official base Items cannot depend on optional external signer products', async () => {
  await assert.rejects(
    planFor(fixtureDocument({ officialExternalDependency: true })),
    (failure) => failure.code
      === 'COMPOSABLE_V6_PUBLICATION_OFFICIAL_DEPENDS_ON_EXTERNAL'
      && failure.details.productId === 'official-extra'
      && failure.details.externalTargets.includes('certified-outfit'),
  );
});

test('begin is idempotent for an already persisted intent', async () => {
  const plan = await planFor();
  let checkpoint = await createMakerComposableV6PublicationCheckpoint({
    plan,
    nonce: 'release-nonce-idempotent-001',
  });
  checkpoint = await beginMakerComposableV6PublicationAction({
    checkpoint,
    plan,
    runtime: runtime(true),
  });
  const sequence = checkpoint.sequence;
  const intentKey = checkpoint.actions[0].intentKey;
  const repeated = await beginMakerComposableV6PublicationAction({
    checkpoint,
    plan,
    runtime: runtime(true),
  });
  assert.equal(repeated.sequence, sequence);
  assert.equal(repeated.actions[0].status, MAKER_COMPOSABLE_PUBLICATION_V6_ACTION_STATUS.INTENT);
  assert.equal(repeated.actions[0].intentKey, intentKey);
});
