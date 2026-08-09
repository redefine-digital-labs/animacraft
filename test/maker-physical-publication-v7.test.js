import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMPLETION_MODES,
  RIGHTS_ORIGINS,
  createDefaultMakerCommerceV5,
} from '../maker-commerce-v5.js';
import { createMakerV5Document } from '../maker-v4.js';
import { createItemProductDefinitionV6 } from '../maker-composable-v6-bridge.js';
import {
  MAKER_PHYSICAL_PUBLICATION_V7_ACTION_STATUS,
  MakerPhysicalV7PublicationError,
  beginMakerPhysicalV7PublicationAction,
  buildMakerPhysicalV7PublicationPlan,
  confirmMakerPhysicalV7PublicationAction,
  createMakerPhysicalV7PublicationCheckpoint,
  markMakerPhysicalV7PublicationSubmitted,
  nextMakerPhysicalV7PublicationAction,
  physicalV7PublicationObjectIds,
} from '../maker-physical-publication-v7.js';
import {
  advancePhysicalV7Publication,
  preparePhysicalV7Publication,
  readPhysicalV7PublicationSubmission,
  transactionFromPhysicalV7PublicationAction,
} from '../maker-physical-publication-v7-app.js';
import {
  PHYSICAL_PART_BEHAVIORS,
  STYLE_PRODUCT_ADMISSION_CLASSES,
  STYLE_PRODUCT_RIGHTS_ORIGINS,
  STYLE_PRODUCT_SUPPLY_MODES,
  createPhysicalStyleCatalogV7,
  createStyleProductV7,
} from '../maker-physical-v7.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const OWNER = '0x111';
const ROOT = '0x222';
const V6_PROFILE = '0x333';

function assetHash(styleId) {
  return styleId === 'blue' ? HASH_A : HASH_B;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

async function hashJson(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(stableValue(value)));
  return Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
}

function style(id, assetId) {
  return {
    id,
    name: id,
    displayOrder: id === 'blue' ? 0 : 1,
    assetId,
    layerTrackId: 'hair-track',
    colorChannelId: null,
    transform: { x: 0, y: 0, scale: 1, rotation: 0 },
    positionConfirmed: true,
    positionLocked: false,
    styleLocked: false,
    opacity: 1,
    blendMode: 'normal',
    visibleWhen: null,
    requires: [],
    excludes: [],
  };
}

function documentFixture() {
  const document = createMakerV5Document({ makerId: 'physical-v7', name: 'Physical v7', creator: OWNER });
  document.layerTracks = [{ id: 'hair-track', name: 'Hair', order: 0, locked: true, referenceAssetId: null }];
  document.assets = [
    { id: 'cover', identifier: 'cover.png', kind: 'maker-cover', mediaType: 'image/png', width: 1024, height: 1024 },
    { id: 'blue-png', identifier: 'blue.png', kind: 'layer', mediaType: 'image/png', width: 1024, height: 1024, sha256: HASH_A },
    { id: 'red-png', identifier: 'red.png', kind: 'layer', mediaType: 'image/png', width: 1024, height: 1024, sha256: HASH_B },
  ];
  document.metadata.coverAssetId = 'cover';
  document.metadata.license.note = 'Physical v7 test';
  document.parts = [{
    id: 'hair',
    name: 'Hair',
    menuOrder: 0,
    menuVisible: true,
    required: true,
    defaultItemId: 'long',
    parentPartId: null,
    iconAssetId: null,
    visibleWhen: null,
    requires: [],
    excludes: [],
    items: [{
      id: 'long',
      name: 'Long Hair',
      displayOrder: 0,
      importKey: 'long',
      status: 'public',
      thumbnailAssetId: null,
      visibleWhen: null,
      requires: [],
      excludes: [],
      defaultStyleId: 'blue',
      styles: [style('blue', 'blue-png'), style('red', 'red-png')],
    }],
  }];
  document.defaultRecipe = { selections: [{ partId: 'hair', itemId: 'long', styleId: 'blue' }], colors: [] };
  document.commerce = createDefaultMakerCommerceV5({
    rightsOrigin: RIGHTS_ORIGINS.LICENSE_WRAPPED,
    rightsOriginConfirmed: true,
    baseCompletion: { mode: COMPLETION_MODES.UNLIMITED_FREE },
  });
  document.publication.royaltyBps = document.commerce.makerSourceRoyaltyBps;
  return document;
}

async function v6Logical(styleId) {
  const logicalId = `official:hair:long:${styleId}:v1`;
  const product = {
    id: logicalId,
    creator: OWNER,
    publisher: OWNER,
    originClass: 'OFFICIAL',
    rightsOrigin: 'LICENSE_WRAPPED',
    components: [{
      id: `component:${styleId}`,
      baseSource: { partId: 'hair', itemId: 'long', styleId },
      layerTrackId: 'hair-track',
      assetHash: assetHash(styleId),
      assetWidth: 1024,
      assetHeight: 1024,
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, blendMode: 'normal' },
    }],
    contentHash: styleId === 'blue' ? 'c'.repeat(64) : 'd'.repeat(64),
  };
  product.manifestHash = await hashJson(createItemProductDefinitionV6(product));
  return product;
}

async function v6Publication() {
  const products = [await v6Logical('blue'), await v6Logical('red')];
  const actions = [
    { id: 'chain.profile.create', inputs: {} },
    ...products.map((product) => ({
      id: `chain.product.publish.${encodeURIComponent(product.id).replace(/%/g, '_')}`,
      inputs: {
        originKind: 0,
        familyCommitment: 'e'.repeat(64),
        definitionCommitment: product.manifestHash,
        assetCommitment: product.contentHash,
      },
    })),
    ...products.map((product) => ({ id: `chain.product.attest.${encodeURIComponent(product.id).replace(/%/g, '_')}`, inputs: {} })),
    ...products.map((product) => ({ id: `chain.product.admit.${encodeURIComponent(product.id).replace(/%/g, '_')}`, inputs: {} })),
  ];
  const plan = {
    schema: 'animacraft.maker-composable-release-plan.v6',
    planIdentity: HASH_A,
    bindingIdentity: HASH_B,
    context: {
      owner: OWNER,
      makerControlCapId: '0x444',
      baseMakerRootId: ROOT,
      callablePackageId: '0x555',
      commerceProtocolConfigV5Id: '0x666',
      compositionProtocolConfigV6Id: '0x777',
    },
    companion: {
      manifest: {
        items: products,
        compatibility: { renderer: { commitment: HASH_B } },
      },
    },
    actions,
  };
  const checkpointActions = actions.map((action, index) => {
    let outputs = {};
    if (action.id === 'chain.profile.create') outputs = { profileId: V6_PROFILE };
    if (action.id.startsWith('chain.product.publish.')) outputs = { productId: index === 1 ? '0x901' : '0x902' };
    if (action.id.startsWith('chain.product.attest.')) outputs = { attestationId: index === 3 ? '0xa01' : '0xa02' };
    return { id: action.id, status: 'CONFIRMED', outputs, confirmation: outputs };
  });
  return {
    plan,
    checkpoint: {
      schema: 'animacraft.maker-composable-publication.v6',
      completed: true,
      planIdentity: plan.planIdentity,
      bindingIdentity: plan.bindingIdentity,
      currentActionIndex: actions.length,
      actions: checkpointActions,
    },
  };
}

function physicalProduct(styleId) {
  return createStyleProductV7({
    id: `style-product:hair:long:${styleId}:v1`,
    v6ProductId: `official:hair:long:${styleId}:v1`,
    familyId: 'family:hair:long',
    targetMakerRootId: 'physical-v7',
    targetProfileId: 'physical-profile',
    targetPartId: 'hair',
    name: styleId,
    creator: OWNER,
    publisher: OWNER,
    admissionClass: STYLE_PRODUCT_ADMISSION_CLASSES.OFFICIAL,
    exactPng: { assetId: `${styleId}-png`, contentHash: assetHash(styleId), mediaType: 'image/png', width: 1024, height: 1024 },
    placement: { layerTrackId: 'hair-track', x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, blendMode: 'normal' },
    baseSource: { partId: 'hair', itemId: 'long', styleId },
    supply: { mode: STYLE_PRODUCT_SUPPLY_MODES.INCLUDED },
    commerce: { priceAtomic: 0 },
    rights: { origin: STYLE_PRODUCT_RIGHTS_ORIGINS.LICENSE_WRAPPED },
  });
}

function catalogFixture() {
  return createPhysicalStyleCatalogV7({
    enabled: true,
    target: { makerRootId: 'physical-v7', profileId: 'physical-profile' },
    admission: { certified: true, open: true },
    families: [{
      id: 'family:hair:long',
      targetMakerRootId: 'physical-v7',
      targetProfileId: 'physical-profile',
      targetPartId: 'hair',
      name: 'Long Hair',
      creator: OWNER,
      styles: [physicalProduct('blue'), physicalProduct('red')],
    }],
  });
}

function runtime(enabled = false) {
  return {
    network: 'mainnet',
    callablePackageId: '0x555',
    physicalV7CallablePackageId: '0x557',
    commerceProtocolConfigV5Id: '0x666',
    compositionProtocolConfigV6Id: '0x777',
    physicalProtocolConfigV7Id: '0x888',
    physicalRegistryV7Id: '0x889',
    commerceV5ReleaseEnabled: true,
    compositionV6ReleaseEnabled: true,
    canonicalSoulMintEnabled: true,
    physicalStyleV7ReleaseEnabled: enabled,
  };
}

async function planFixture() {
  const document = documentFixture();
  return buildPlan({ document });
}

async function buildPlan({ document = documentFixture(), catalog = catalogFixture() } = {}) {
  return buildMakerPhysicalV7PublicationPlan({
    document,
    catalog,
    v6Publication: await v6Publication(),
    baseManifest: document,
    baseManifestBlobId: 'base-maker-quilt',
    runtime: runtime(false),
  });
}

test('v7 plan is strictly rooted in completed v6 and maps one admitted v6 object per exact Style', async () => {
  const plan = await planFixture();
  assert.deepEqual(plan.summary, {
    partPolicyCount: 1,
    familyCount: 1,
    styleProductCount: 2,
    baseIncludedCount: 2,
    packIncludedCount: 0,
    purchasableCount: 0,
    definitionQuiltCount: 1,
    assetVerificationCount: 2,
  });
  assert.equal(plan.projection.partPolicies[0].behavior, PHYSICAL_PART_BEHAVIORS.SOUL_LOCAL);
  assert.equal(plan.projection.partPolicies[0].behaviorKind, 1);
  assert.deepEqual(plan.projection.products.map((entry) => entry.v6ProductObjectId), ['0x901', '0x902']);
  assert.ok(plan.actions.some((entry) => entry.id === 'chain.physical-profile.seal'));
  assert.equal(plan.actions.filter((entry) => entry.id.startsWith('chain.family.publish.')).length, 1);
  assert.equal(plan.actions.filter((entry) => entry.id.startsWith('chain.style-product.publish.')).length, 2);
  assert.equal(plan.context.coreCallablePackageId, '0x555');
  assert.equal(plan.context.physicalV7CallablePackageId, '0x557');
  assert.ok(
    plan.actions
      .filter((entry) => entry.transport === 'SUI')
      .every((entry) => entry.target.startsWith('0x557::physical_composition_v7::')),
  );
});

test('declared HYBRID policy reaches the exact on-chain registration action', async () => {
  const catalog = catalogFixture();
  catalog.partPolicies = [{
    partId: 'hair',
    behavior: PHYSICAL_PART_BEHAVIORS.HYBRID,
    required: true,
    maxSourceKind: STYLE_PRODUCT_ADMISSION_CLASSES.OPEN,
  }];
  const plan = await buildPlan({ catalog });
  const policy = plan.projection.partPolicies[0];
  const action = plan.actions.find((entry) => entry.id === 'chain.part-policy.register.hair');

  assert.deepEqual(policy, {
    partId: 'hair',
    slotKey: 'hair',
    behavior: PHYSICAL_PART_BEHAVIORS.HYBRID,
    behaviorKind: 3,
    required: true,
    maxSourceKind: 2,
  });
  assert.equal(action.inputs.behaviorKind, 3);
  assert.equal(action.inputs.required, true);
  assert.equal(action.inputs.maxSourceKind, 2);
  assert.equal(action.policy.behavior, PHYSICAL_PART_BEHAVIORS.HYBRID);
});

test('declared policies reject a required OPEN Part before any action exists', async () => {
  const catalog = catalogFixture();
  catalog.partPolicies = [{
    partId: 'hair',
    behavior: PHYSICAL_PART_BEHAVIORS.OPEN,
    required: true,
    maxSourceKind: STYLE_PRODUCT_ADMISSION_CLASSES.OPEN,
  }];
  await assert.rejects(
    buildPlan({ catalog }),
    (error) => (
      error instanceof MakerPhysicalV7PublicationError
      && error.code === 'PHYSICAL_V7_REQUIRED_OPEN_PART_INVALID'
    ),
  );
});

test('declared policies reject source-class drift from the Move policy contract', async () => {
  const catalog = catalogFixture();
  catalog.partPolicies = [{
    partId: 'hair',
    behavior: PHYSICAL_PART_BEHAVIORS.SOUL_LOCAL,
    required: true,
    maxSourceKind: STYLE_PRODUCT_ADMISSION_CLASSES.OPEN,
  }];
  await assert.rejects(
    buildPlan({ catalog }),
    (error) => (
      error instanceof MakerPhysicalV7PublicationError
      && error.code === 'PHYSICAL_V7_PART_POLICY_SOURCE_KIND_MISMATCH'
    ),
  );
});

test('declared policy sets reject duplicate and missing Part coverage', async () => {
  const duplicate = catalogFixture();
  const hairPolicy = {
    partId: 'hair',
    behavior: PHYSICAL_PART_BEHAVIORS.HYBRID,
    required: true,
    maxSourceKind: STYLE_PRODUCT_ADMISSION_CLASSES.OPEN,
  };
  duplicate.partPolicies = [hairPolicy, { ...hairPolicy }];
  await assert.rejects(
    buildPlan({ catalog: duplicate }),
    (error) => (
      error instanceof MakerPhysicalV7PublicationError
      && error.code === 'PHYSICAL_V7_PART_POLICY_DUPLICATE'
    ),
  );

  const document = documentFixture();
  document.parts.push({
    id: 'eyes',
    name: 'Eyes',
    menuOrder: 1,
    menuVisible: true,
    required: false,
    defaultItemId: 'gaze',
    parentPartId: null,
    iconAssetId: null,
    visibleWhen: null,
    requires: [],
    excludes: [],
    items: [{
      id: 'gaze',
      name: 'Gaze',
      displayOrder: 0,
      importKey: 'gaze',
      status: 'public',
      thumbnailAssetId: null,
      visibleWhen: null,
      requires: [],
      excludes: [],
      defaultStyleId: 'soft',
      styles: [{ ...style('soft', 'blue-png'), displayOrder: 0 }],
    }],
  });
  document.defaultRecipe.selections.push({ partId: 'eyes', itemId: 'gaze', styleId: 'soft' });
  const missing = catalogFixture();
  missing.partPolicies = [hairPolicy];
  await assert.rejects(
    buildPlan({ document, catalog: missing }),
    (error) => (
      error instanceof MakerPhysicalV7PublicationError
      && error.code === 'PHYSICAL_V7_PART_POLICY_MISSING'
      && error.details.partIds.includes('eyes')
    ),
  );

  const complete = catalogFixture();
  complete.partPolicies = [hairPolicy, {
    partId: 'eyes',
    behavior: PHYSICAL_PART_BEHAVIORS.OPEN,
    required: false,
    maxSourceKind: STYLE_PRODUCT_ADMISSION_CLASSES.OPEN,
  }];
  const plan = await buildPlan({ document, catalog: complete });
  assert.equal(plan.summary.partPolicyCount, 2);
  const eyesAction = plan.actions.find((entry) => entry.id === 'chain.part-policy.register.eyes');
  assert.equal(eyesAction.inputs.behaviorKind, 2);
  assert.equal(eyesAction.inputs.required, false);
});

test('v7 plan fails closed when exact Styles reuse one v6 Product', async () => {
  const catalog = catalogFixture();
  catalog.families[0].styles[1].v6ProductId = catalog.families[0].styles[0].v6ProductId;
  const document = documentFixture();
  await assert.rejects(
    buildMakerPhysicalV7PublicationPlan({
      document,
      catalog,
      v6Publication: await v6Publication(),
      baseManifest: document,
      baseManifestBlobId: 'base-maker-quilt',
      runtime: runtime(false),
    }),
    (error) => error instanceof MakerPhysicalV7PublicationError && error.code === 'PHYSICAL_V7_CATALOG_INVALID',
  );
});

test('v7 checkpoint is recoverable, ordered and performs zero action while gate is closed', async () => {
  const plan = await planFixture();
  let checkpoint = await createMakerPhysicalV7PublicationCheckpoint({ plan, nonce: 'physical-v7-recovery-0001' });
  await assert.rejects(
    nextMakerPhysicalV7PublicationAction({ checkpoint, plan, runtime: runtime(false) }),
    (error) => error.code === 'PHYSICAL_V7_RELEASE_DISABLED',
  );
  checkpoint = await beginMakerPhysicalV7PublicationAction({ checkpoint, plan, runtime: runtime(true) });
  assert.equal(checkpoint.actions[0].status, MAKER_PHYSICAL_PUBLICATION_V7_ACTION_STATUS.INTENT);
  const action = await nextMakerPhysicalV7PublicationAction({ checkpoint, plan, runtime: runtime(true) });
  assert.equal(action.transport, 'WALRUS');
  assert.throws(() => transactionFromPhysicalV7PublicationAction(action), /Sui v7 action/);
  checkpoint = await markMakerPhysicalV7PublicationSubmitted({ checkpoint, plan, actionId: action.id, submission: { digest: 'tx-1' } });
  checkpoint = await confirmMakerPhysicalV7PublicationAction({
    checkpoint,
    plan,
    actionId: action.id,
    confirmation: {
      blobId: 'base-maker-quilt',
      identifier: 'blue.png',
      observedHash: HASH_A,
      certified: true,
      assetVerified: true,
    },
  });
  assert.equal(checkpoint.currentActionIndex, 1);
});

test('v7 app preparation locks the certified base Quilt and durably retains in-action recovery progress', async () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const document = documentFixture();
  const publication = await preparePhysicalV7Publication({
    document,
    catalog: catalogFixture(),
    v6Publication: await v6Publication(),
    baseManifest: document,
    baseManifestBlobId: 'base-maker-quilt',
    runtime: runtime(false),
    storage,
  });
  assert.equal(publication.plan.binding.baseManifestBlobId, 'base-maker-quilt');
  assert.equal(publication.plan.actions[0].inputs.blobId, 'base-maker-quilt');

  const interrupted = await advancePhysicalV7Publication({
    publication,
    runtime: runtime(true),
    storage,
    async executeWalrusAction({ persistProgress }) {
      await persistProgress({ walrusRecovery: { stage: 'uploaded', quiltBlobId: 'base-maker-quilt' } });
      const error = new Error('temporary readback interruption');
      error.code = 'NETWORK_UNAVAILABLE';
      throw error;
    },
    async confirmAction() {
      assert.fail('The interrupted action must not be confirmed.');
    },
  });
  assert.equal(interrupted.recoverable, true);
  const durable = JSON.parse(values.get(publication.key));
  assert.deepEqual(
    durable.checkpoint.actions[0].progress.walrusRecovery,
    { stage: 'uploaded', quiltBlobId: 'base-maker-quilt' },
  );

  const resumed = await advancePhysicalV7Publication({
    publication: { ...interrupted, checkpoint: durable.checkpoint },
    runtime: runtime(true),
    storage,
    async executeWalrusAction({ checkpoint }) {
      assert.equal(checkpoint.actions[0].progress.walrusRecovery.stage, 'uploaded');
      return {
        blobId: 'base-maker-quilt',
        identifier: 'blue.png',
        observedHash: HASH_A,
        certified: true,
        assetVerified: true,
      };
    },
    async confirmAction({ submission }) {
      return submission;
    },
  });
  assert.equal(resumed.recoverable, undefined);
  assert.equal(resumed.checkpoint.currentActionIndex, 1);
  assert.equal(resumed.checkpoint.actions[0].status, 'CONFIRMED');
});

test('profile readback uses the production getObjects response shape and rejects drift', async () => {
  const plan = await planFixture();
  const action = structuredClone(plan.actions.find((entry) => entry.id === 'chain.physical-profile.create'));
  action.inputs = {
    physicalRegistryV7Id: plan.context.physicalRegistryV7Id,
    physicalProtocolConfigV7Id: plan.context.physicalProtocolConfigV7Id,
    compositionProtocolConfigV6Id: plan.context.compositionProtocolConfigV6Id,
    v6ProfileId: plan.context.v6ProfileId,
    baseMakerRootId: plan.context.baseMakerRootId,
    makerControlCapId: plan.context.makerControlCapId,
    commerceProtocolConfigV5Id: plan.context.commerceProtocolConfigV5Id,
  };
  const indexed = {
    objectTypes: { '0xb01': '0x557::physical_composition_v7::MakerPhysicalProfileV7' },
    events: [],
  };
  const suiClient = {
    async getObjects({ objectIds }) {
      assert.deepEqual(objectIds, ['0xb01']);
      return { objects: [{
        objectId: '0xb01',
        json: {
          config_id: '0x888',
          v6_profile_id: V6_PROFILE,
          root_id: ROOT,
          sealed: false,
        },
      }] };
    },
  };
  const confirmation = await readPhysicalV7PublicationSubmission({ action, submission: { digest: 'tx-1', indexed }, suiClient });
  assert.deepEqual(confirmation, { transactionDigest: 'tx-1', physicalProfileId: '0xb01', readbackVerified: true });
});

test('completed checkpoint exposes only confirmed profile/family/style object IDs', async () => {
  const plan = await planFixture();
  const actions = plan.actions.map((entry, index) => {
    const outputs = Object.fromEntries(entry.outputs.map((field) => {
      if (field === 'physicalProfileId') return [field, '0xb01'];
      if (field === 'familyObjectId') return [field, '0xb02'];
      if (field === 'styleProductObjectId') return [field, index % 2 ? '0xb03' : '0xb04'];
      if (field === 'transactionDigest') return [field, `tx-${index}`];
      if (field === 'blobId') return [field, 'definition-quilt'];
      if (field === 'identifier') return [field, 'blue.png'];
      if (field === 'observedHash') return [field, HASH_A];
      return [field, true];
    }));
    return { id: entry.id, status: 'CONFIRMED', outputs, confirmation: outputs };
  });
  const ids = physicalV7PublicationObjectIds({ plan, checkpoint: { completed: true, actions } });
  assert.equal(ids.physicalProfileObjectId, '0xb01');
  assert.equal(Object.keys(ids.familyObjectIds).length, 1);
  assert.equal(Object.keys(ids.styleProductObjectIds).length, 2);
});
