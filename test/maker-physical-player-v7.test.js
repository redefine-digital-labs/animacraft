import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMPLETION_MODES,
  RIGHTS_ORIGINS,
  createDefaultMakerCommerceV5,
} from '../maker-commerce-v5.js';
import { createMakerV5Document } from '../maker-v4.js';
import { createItemProductDefinitionV6 } from '../maker-composable-v6-bridge.js';
import { flattenMakerV4RecipeV2 } from '../maker-publication-v4.js';
import {
  PHYSICAL_V7_INITIAL_LOADOUT_SCHEMA,
  PHYSICAL_V7_TRUSTED_PLAYER_SCHEMA,
  MakerPhysicalPlayerV7Error,
  buildPhysicalV7InitialLoadoutSummary,
  hydratePhysicalV7PlayerState,
  verifyPhysicalV7InitialLoadoutSummary,
} from '../maker-physical-player-v7.js';

const id = (value) => `0x${BigInt(value).toString(16).padStart(64, '0')}`;
const IDS = Object.freeze({
  physicalConfig: id(1),
  physicalRegistry: id(2),
  v6Config: id(3),
  v5Config: id(4),
  v6Profile: id(5),
  physicalProfile: id(6),
  makerRoot: id(7),
  v6Product: id(8),
  styleProduct: id(9),
  family: id(10),
  attestation: id(11),
  profilesTable: id(12),
  stylesTable: id(13),
  admissionsTable: id(14),
  creator: id(15),
});
const SLOT_HASH = 'a'.repeat(64);
const RENDERER_HASH = 'b'.repeat(64);
const FAMILY_HASH = 'c'.repeat(64);
const CONTENT_HASH = 'd'.repeat(64);
const POLICY_HASH = 'e'.repeat(64);

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

async function sha(bytes) {
  return Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
}

function object(objectId, value) {
  return { objectId, json: { fields: value } };
}

function documentFixture() {
  const document = createMakerV5Document({
    makerId: 'physical-player-v7',
    name: 'Physical Player v7',
    creator: IDS.creator,
  });
  document.layerTracks = [{ id: 'hair-track', name: 'Hair', order: 0, locked: true, referenceAssetId: null }];
  document.assets = [
    {
      id: 'cover',
      identifier: 'cover.png',
      kind: 'maker-cover',
      mediaType: 'image/png',
      width: 1024,
      height: 1024,
      sha256: '9'.repeat(64),
    },
    {
      id: 'hair-png',
      identifier: 'hair.png',
      kind: 'layer',
      mediaType: 'image/png',
      width: 1024,
      height: 1024,
      sha256: 'f'.repeat(64),
    },
  ];
  document.metadata.coverAssetId = 'cover';
  document.metadata.license.note = 'Physical Player v7 test license.';
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
      styles: [{
        id: 'blue',
        name: 'Blue',
        displayOrder: 0,
        assetId: 'hair-png',
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
      }],
    }],
  }];
  document.defaultRecipe = {
    selections: [{ partId: 'hair', itemId: 'long', styleId: 'blue' }],
    colors: [],
  };
  document.commerce = createDefaultMakerCommerceV5({
    rightsOrigin: RIGHTS_ORIGINS.LICENSE_WRAPPED,
    rightsOriginConfirmed: true,
    baseCompletion: { mode: COMPLETION_MODES.UNLIMITED_FREE },
  });
  document.publication.royaltyBps = document.commerce.makerSourceRoyaltyBps;
  return document;
}

async function hydrationFixture({ substituteRegistryValue = false } = {}) {
  const assetBytes = new TextEncoder().encode('late external exact png bytes');
  const assetHash = await sha(assetBytes);
  const definition = createItemProductDefinitionV6({
    id: 'external:hair:long:blue:v1',
    version: 1,
    makerRootId: 'physical-player-v7',
    compatibilityHash: SLOT_HASH,
    creator: IDS.creator,
    publisher: IDS.creator,
    originClass: 'CERTIFIED',
    display: { name: 'Supplier Blue', description: '', thumbnailHash: '' },
    components: [{
      id: 'supplier-blue-component',
      layerTrackId: 'hair-track',
      assetHash,
      assetWidth: 1024,
      assetHeight: 1024,
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, blendMode: 'normal' },
      baseSource: { partId: 'hair', itemId: 'long', styleId: 'blue' },
    }],
    contentHash: CONTENT_HASH,
    slotClaims: [{ slotId: 'hair', units: 1 }],
    rightsOrigin: 'LICENSE_WRAPPED',
    access: { mode: 'EMBEDDED', binding: 'EMBEDDED', priceAtomic: 0 },
  });
  const definitionBytes = new TextEncoder().encode(stableJson(definition));
  const definitionHash = await sha(definitionBytes);
  const styleRegistryValue = substituteRegistryValue ? id(999) : IDS.styleProduct;
  const objects = new Map([
    [IDS.physicalConfig, object(IDS.physicalConfig, {
      enabled: true,
      registry_id: IDS.physicalRegistry,
      v6_config_id: IDS.v6Config,
      v5_config_id: IDS.v5Config,
    })],
    [IDS.physicalRegistry, object(IDS.physicalRegistry, {
      config_id: IDS.physicalConfig,
      profiles: IDS.profilesTable,
      style_products: IDS.stylesTable,
    })],
    [IDS.v6Config, object(IDS.v6Config, {
      enabled: true,
      validator_policy_commitment: [...Buffer.from(POLICY_HASH, 'hex')],
      validator_epoch: 9,
    })],
    [IDS.v6Profile, object(IDS.v6Profile, {
      config_id: IDS.v6Config,
      root_id: IDS.makerRoot,
      slot_schema_commitment: [...Buffer.from(SLOT_HASH, 'hex')],
      renderer_commitment: [...Buffer.from(RENDERER_HASH, 'hex')],
      admissions: IDS.admissionsTable,
      sealed: true,
    })],
    [IDS.physicalProfile, object(IDS.physicalProfile, {
      config_id: IDS.physicalConfig,
      v6_profile_id: IDS.v6Profile,
      root_id: IDS.makerRoot,
      slot_schema_commitment: [...Buffer.from(SLOT_HASH, 'hex')],
      renderer_commitment: [...Buffer.from(RENDERER_HASH, 'hex')],
      sealed: true,
    })],
    [IDS.v6Product, object(IDS.v6Product, {
      config_id: IDS.v6Config,
      publisher: IDS.creator,
      original_creator: IDS.creator,
      origin_kind: 1,
      family_commitment: [...Buffer.from(FAMILY_HASH, 'hex')],
      definition_commitment: [...Buffer.from(definitionHash, 'hex')],
      asset_commitment: [...Buffer.from(CONTENT_HASH, 'hex')],
      slot_key: 'hair',
      slot_schema_commitment: [...Buffer.from(SLOT_HASH, 'hex')],
      rights_origin: 1,
      access_kind: 0,
      binding_kind: 2,
      price_atomic: '0',
      maker_ecosystem_fee_bps: 0,
      transferable: false,
      required_product_ids: [],
      excluded_product_ids: [],
    })],
    [IDS.family, object(IDS.family, {
      config_id: IDS.physicalConfig,
      profile_id: IDS.physicalProfile,
      seed_v6_product_id: IDS.v6Product,
      creator: IDS.creator,
      slot_key: 'hair',
      family_key: 'long',
      family_commitment: [...Buffer.from(FAMILY_HASH, 'hex')],
    })],
    [IDS.styleProduct, object(IDS.styleProduct, {
      config_id: IDS.physicalConfig,
      profile_id: IDS.physicalProfile,
      v6_profile_id: IDS.v6Profile,
      family_id: IDS.family,
      v6_product_id: IDS.v6Product,
      original_creator: IDS.creator,
      slot_key: 'hair',
      style_key: 'blue',
      recipe_item_key: 'long',
      source_kind: 1,
      entitlement_kind: 0,
      supply_kind: 0,
      definition_commitment: [...Buffer.from(definitionHash, 'hex')],
      asset_commitment: [...Buffer.from(CONTENT_HASH, 'hex')],
      definition_blob_id: 'supplier-definition-blob',
      definition_identifier: '',
      asset_blob_id: 'supplier-png-blob',
      asset_identifier: '',
      renderer_commitment: [...Buffer.from(RENDERER_HASH, 'hex')],
      active: true,
    })],
    [IDS.attestation, object(IDS.attestation, {
      config_id: IDS.v6Config,
      profile_id: IDS.v6Profile,
      product_id: IDS.v6Product,
      definition_commitment: [...Buffer.from(definitionHash, 'hex')],
      slot_schema_commitment: [...Buffer.from(SLOT_HASH, 'hex')],
      validator_policy_commitment: [...Buffer.from(POLICY_HASH, 'hex')],
      validator_epoch: 9,
      issued_at_ms: 1,
    })],
  ]);
  const tables = new Map([
    [IDS.profilesTable, [{ name: { json: IDS.v6Profile }, value: { json: IDS.physicalProfile } }]],
    [IDS.stylesTable, [{ name: { json: IDS.v6Product }, value: { json: styleRegistryValue } }]],
    [IDS.admissionsTable, [{
      name: { json: IDS.v6Product },
      value: { json: {
        source_kind: 1,
        attestation_id: IDS.attestation,
        definition_commitment: [...Buffer.from(definitionHash, 'hex')],
        asset_commitment: [...Buffer.from(CONTENT_HASH, 'hex')],
        slot_key: 'hair',
        rights_origin: 1,
        access_kind: 0,
        binding_kind: 2,
        price_atomic: '0',
        maker_ecosystem_fee_bps: 0,
        transferable: false,
        required_product_ids: [],
        excluded_product_ids: [],
        publisher: IDS.creator,
        active: true,
      } },
    }]],
  ]);
  const client = {
    async getObjects({ objectIds }) {
      return { objects: objectIds.map((objectId) => objects.get(objectId)).filter(Boolean) };
    },
    async listDynamicFields({ parentId }) {
      return { dynamicFields: tables.get(parentId) || [], hasNextPage: false, cursor: null };
    },
  };
  return {
    client,
    definitionBytes,
    assetBytes,
    definitionHash,
  };
}

function runtime() {
  return {
    physicalStyleV7ReleaseEnabled: true,
    physicalProtocolConfigV7Id: IDS.physicalConfig,
    physicalRegistryV7Id: IDS.physicalRegistry,
    compositionProtocolConfigV6Id: IDS.v6Config,
    commerceProtocolConfigV5Id: IDS.v5Config,
  };
}

test('hydrates a late external Style absent from the immutable v6 companion', async () => {
  const fixture = await hydrationFixture();
  const hydrated = await hydratePhysicalV7PlayerState({
    runtime: runtime(),
    client: fixture.client,
    makerRootObjectId: IDS.makerRoot,
    v6Trusted: {
      trusted: true,
      profileObjectId: IDS.v6Profile,
      companionManifest: { items: [] },
      productObjectIds: {},
    },
    definitionLoader: async () => fixture.definitionBytes,
    assetLoader: async () => fixture.assetBytes,
  });
  assert.equal(hydrated.schemaVersion, PHYSICAL_V7_TRUSTED_PLAYER_SCHEMA);
  assert.equal(hydrated.styleProducts.length, 1);
  assert.equal(hydrated.styleProducts[0].logicalV6ProductId, 'external:hair:long:blue:v1');
  assert.equal(hydrated.styleProducts[0].definitionVerified, true);
  assert.equal(hydrated.styleProducts[0].assetVerified, true);
});

test('rejects a v7 registry substitution before Walrus bytes can authorize it', async () => {
  const fixture = await hydrationFixture({ substituteRegistryValue: true });
  await assert.rejects(
    hydratePhysicalV7PlayerState({
      runtime: runtime(),
      client: fixture.client,
      makerRootObjectId: IDS.makerRoot,
      v6Trusted: { trusted: true, profileObjectId: IDS.v6Profile, companionManifest: { items: [] } },
      definitionLoader: async () => fixture.definitionBytes,
      assetLoader: async () => fixture.assetBytes,
    }),
    (error) => error instanceof MakerPhysicalPlayerV7Error,
  );
});

test('builds exact v5 recipe-order rows and a deterministic Move BCS commitment', async () => {
  const document = documentFixture();
  const flattened = flattenMakerV4RecipeV2(document, document.defaultRecipe);
  const selected = flattened.styleSelections[0];
  const trusted = {
    schemaVersion: PHYSICAL_V7_TRUSTED_PLAYER_SCHEMA,
    trusted: true,
    queryVerified: true,
    sealed: true,
    physicalProtocolConfigObjectId: IDS.physicalConfig,
    physicalRegistryObjectId: IDS.physicalRegistry,
    physicalProfileObjectId: IDS.physicalProfile,
    v6ProfileObjectId: IDS.v6Profile,
    makerRootObjectId: IDS.makerRoot,
    styleProducts: [{
      objectId: IDS.styleProduct,
      familyObjectId: IDS.family,
      v6ProductObjectId: IDS.v6Product,
      slotKey: selected.partKey,
      recipeItemKey: selected.itemKey,
      styleKey: selected.styleKey,
      definitionVerified: true,
      assetVerified: true,
    }],
  };
  const summary = await buildPhysicalV7InitialLoadoutSummary({
    document,
    recipe: document.defaultRecipe,
    flattened,
    recipeHash: '1'.repeat(64),
    trusted,
  });
  assert.equal(summary.schemaVersion, PHYSICAL_V7_INITIAL_LOADOUT_SCHEMA);
  assert.deepEqual(summary.visualRecipeIndices, [0]);
  assert.equal(summary.initialAuthorizationRows[0].recipeIndex, 0);
  assert.equal(summary.initialAuthorizationRows[0].recipeItemKey, selected.itemKey);
  assert.match(summary.authorizationCommitment, /^[0-9a-f]{64}$/);
  assert.equal((await buildPhysicalV7InitialLoadoutSummary({
    document,
    recipe: document.defaultRecipe,
    flattened,
    recipeHash: '1'.repeat(64),
    trusted,
  })).authorizationCommitment, summary.authorizationCommitment);
  assert.equal(await verifyPhysicalV7InitialLoadoutSummary({
    document,
    recipe: document.defaultRecipe,
    flattened,
    recipeHash: '1'.repeat(64),
    trusted,
    summary,
  }), true);
});
