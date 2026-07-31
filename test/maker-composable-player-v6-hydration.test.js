import assert from 'node:assert/strict';
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
  MakerComposablePlayerV6HydrationError,
  hydrateTrustedMakerComposableV6Catalog,
} from '../maker-composable-player-v6-hydration.js';

const EMPTY_COMMITMENT = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const RENDERER_HASH = 'a'.repeat(64);
const COMPATIBILITY_HASH = 'b'.repeat(64);
const PRODUCT_HASH = 'c'.repeat(64);
const ASSET_HASH = 'd'.repeat(64);
const AUXILIARY_HASH = 'e'.repeat(64);
const VALIDATOR_POLICY_HASH = 'f'.repeat(64);
const COMPANION_HASH = '9'.repeat(64);
const ROOT_ID = '0xa11ce';
const PROFILE_ID = '0x100';
const PRODUCT_ID = '0x101';
const ATTESTATION_ID = '0x102';
const PUBLISHER = '0xb0b';
const ADMITTER = '0xc0de';

function fixture() {
  const profile = createComposableProfileV6({
    mode: COMPOSABLE_PROFILE_MODES.COMPOSABLE,
    thirdPartyAdmission: THIRD_PARTY_ADMISSION_MODES.OPEN,
    itemAssetization: true,
    extensionsHash: '',
  });
  const compatibility = createCompatibilityProfileV6({
    makerRootId: ROOT_ID,
    canvas: { width: 1024, height: 1024 },
    coordinate: { origin: 'TOP_LEFT', unit: 'PIXEL', pixelMode: false },
    renderer: { version: 'renderer-v6.1', commitment: RENDERER_HASH },
    layerTrackIds: ['hair-front'],
    slots: [{
      id: 'hair',
      capacity: 1,
      required: false,
      layerTrackIds: ['hair-front'],
    }],
    maskPolicyHash: AUXILIARY_HASH,
    rulesHash: AUXILIARY_HASH,
    fallbackProductIds: ['open-hair'],
    fallbackLoadoutHash: AUXILIARY_HASH,
    manifestBlobId: 'walrus-compatibility-v6',
    manifestHash: COMPATIBILITY_HASH,
    extensionsHash: '',
  });
  const product = createItemProductV6({
    id: 'open-hair',
    version: 1,
    makerRootId: ROOT_ID,
    compatibilityHash: COMPATIBILITY_HASH,
    creator: PUBLISHER,
    publisher: PUBLISHER,
    originClass: ITEM_ORIGIN_CLASSES.OPEN,
    display: {
      name: 'Open hair',
      description: 'Third-party hair verified on Sui.',
      thumbnailBlobId: 'walrus-open-hair-thumb',
      thumbnailHash: AUXILIARY_HASH,
    },
    components: [{
      id: 'open-hair-front',
      layerTrackId: 'hair-front',
      assetBlobId: 'walrus-open-hair-png',
      assetHash: ASSET_HASH,
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
    // These fields are deliberately untrusted during Player hydration.
    validation: { passed: true, attestationId: 'self-reported', epoch: 999 },
    certification: null,
    manifestBlobId: 'walrus-open-hair-manifest',
    manifestHash: PRODUCT_HASH,
    contentHash: ASSET_HASH,
    slotClaims: [{ slotId: 'hair', units: 1 }],
    requires: [],
    excludes: [],
    rightsOrigin: ITEM_RIGHTS_ORIGINS.ONCHAIN_NATIVE,
    rightsManifestHash: AUXILIARY_HASH,
    access: {
      mode: ITEM_ACCESS_MODES.FREE_CLAIM,
      binding: ITEM_BINDING_MODES.ACCOUNT,
      priceAtomic: 0,
      transferable: false,
    },
    makerEcosystemFeeBps: 0,
    extensionsHash: '',
  });
  const companionManifest = {
    baseMaker: { makerRootId: ROOT_ID },
    profile,
    compatibility,
    items: [product],
  };
  const trustedChainState = {
    queryVerified: true,
    companionManifestBlobId: 'walrus-composable-companion',
    companionManifestHash: COMPANION_HASH,
    validatorPolicyCommitment: VALIDATOR_POLICY_HASH,
    validatorEpoch: 4,
    profile: {
      id: PROFILE_ID,
      rootId: ROOT_ID,
      mode: 1,
      loadoutMutable: true,
      itemAssetization: true,
      thirdPartyPolicy: 2,
      slotSchemaCommitment: COMPATIBILITY_HASH,
      rendererCommitment: RENDERER_HASH,
      companionManifestBlobId: 'walrus-composable-companion',
      companionManifestHash: COMPANION_HASH,
      extensionsHash: EMPTY_COMMITMENT,
      sealed: true,
    },
    products: [{
      id: PRODUCT_ID,
      sourceRootId: null,
      publisher: PUBLISHER,
      originalCreator: PUBLISHER,
      originKind: 2,
      definitionCommitment: PRODUCT_HASH,
      assetCommitment: ASSET_HASH,
      slotKey: 'hair',
      slotSchemaCommitment: COMPATIBILITY_HASH,
      rightsOrigin: 0,
      accessKind: 1,
      bindingKind: 1,
      priceAtomic: '0',
      makerEcosystemFeeBps: 0,
      transferable: false,
      requiredProductIds: [],
      excludedProductIds: [],
      extensionsHash: EMPTY_COMMITMENT,
    }],
    admissions: [{
      profileId: PROFILE_ID,
      productId: PRODUCT_ID,
      sourceKind: 2,
      attestationId: ATTESTATION_ID,
      admittedBy: ADMITTER,
      admittedAtMs: 1_786_000_000_000,
      definitionCommitment: PRODUCT_HASH,
      assetCommitment: ASSET_HASH,
      slotKey: 'hair',
      rightsOrigin: 0,
      accessKind: 1,
      bindingKind: 1,
      priceAtomic: '0',
      makerEcosystemFeeBps: 0,
      transferable: false,
      requiredProductIds: [],
      excludedProductIds: [],
      publisher: PUBLISHER,
      active: true,
    }],
    attestations: [{
      id: ATTESTATION_ID,
      profileId: PROFILE_ID,
      productId: PRODUCT_ID,
      definitionCommitment: PRODUCT_HASH,
      slotSchemaCommitment: COMPATIBILITY_HASH,
      validatorPolicyCommitment: VALIDATOR_POLICY_HASH,
      validatorEpoch: 4,
      issuedAtMs: 1_786_000_000_001,
    }],
  };
  return { companionManifest, trustedChainState };
}

test('hydrates Player catalog only from exact Sui profile, admission and attestation readback', () => {
  const input = fixture();
  const hydrated = hydrateTrustedMakerComposableV6Catalog(input);
  assert.equal(hydrated.trusted, true);
  assert.equal(hydrated.profileObjectId, PROFILE_ID);
  assert.deepEqual(hydrated.productObjectIds, { 'open-hair': PRODUCT_ID });
  assert.equal(hydrated.products[0].validation.passed, true);
  assert.equal(hydrated.products[0].validation.attestationId, ATTESTATION_ID);
  assert.equal(hydrated.products[0].validation.epoch, 4);
  assert.equal(hydrated.validatorEpoch, 4);
  assert.equal(hydrated.products[0].certification, null);
});

test('rejects manifest self-report when no trusted ValidatorAttestation exists', () => {
  const input = fixture();
  input.trustedChainState.attestations = [];
  assert.throws(
    () => hydrateTrustedMakerComposableV6Catalog(input),
    (error) => {
      assert.ok(error instanceof MakerComposablePlayerV6HydrationError);
      assert.equal(error.code, 'COMPOSABLE_PLAYER_V6_CHAIN_CATALOG_MISMATCH');
      assert.ok(error.details.issues.some((entry) => entry.code === 'validator-attestation-missing'));
      return true;
    },
  );
});

test('rejects records not marked as originating from the trusted Sui query boundary', () => {
  const input = fixture();
  input.trustedChainState.queryVerified = false;
  assert.throws(
    () => hydrateTrustedMakerComposableV6Catalog(input),
    { code: 'COMPOSABLE_PLAYER_V6_UNTRUSTED_CHAIN_SOURCE' },
  );
});

test('rejects validator policy, immutable product and active admission drift', () => {
  for (const mutate of [
    (chain) => { chain.attestations[0].validatorPolicyCommitment = AUXILIARY_HASH; },
    (chain) => { chain.attestations[0].validatorEpoch = chain.validatorEpoch - 1; },
    (chain) => { chain.products[0].assetCommitment = AUXILIARY_HASH; },
    (chain) => { chain.products[0].originKind = 1; },
    (chain) => { delete chain.products[0].priceAtomic; },
    (chain) => { chain.admissions[0].sourceKind = 1; },
    (chain) => { chain.admissions[0].active = false; },
  ]) {
    const input = fixture();
    mutate(input.trustedChainState);
    assert.throws(
      () => hydrateTrustedMakerComposableV6Catalog(input),
      { code: 'COMPOSABLE_PLAYER_V6_CHAIN_CATALOG_MISMATCH' },
    );
  }
});

test('rejects a missing trusted companion identity even when all JSON fields self-match', () => {
  const input = fixture();
  input.trustedChainState.companionManifestHash = '';
  input.trustedChainState.profile.companionManifestHash = '';
  assert.throws(
    () => hydrateTrustedMakerComposableV6Catalog(input),
    (error) => {
      assert.ok(error.details.issues.some((entry) => entry.code === 'trusted-query-identity-missing'));
      return true;
    },
  );
});
