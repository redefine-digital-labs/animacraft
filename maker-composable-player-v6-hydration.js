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
} from './maker-composable-v6.js';

const HASH = /^(?:0x)?[0-9a-f]{64}$/i;
const SUI_ID = /^0x[0-9a-f]+$/i;
const EMPTY_COMMITMENT = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

const PROFILE_MODE = Object.freeze({
  [COMPOSABLE_PROFILE_MODES.FIXED]: 0,
  [COMPOSABLE_PROFILE_MODES.COMPOSABLE]: 1,
});
const THIRD_PARTY_POLICY = Object.freeze({
  [THIRD_PARTY_ADMISSION_MODES.DISABLED]: 0,
  [THIRD_PARTY_ADMISSION_MODES.CERTIFIED]: 1,
  [THIRD_PARTY_ADMISSION_MODES.OPEN]: 2,
});
const ADMISSION_SOURCE = Object.freeze({
  [ITEM_ORIGIN_CLASSES.OFFICIAL]: 0,
  [ITEM_ORIGIN_CLASSES.CERTIFIED]: 1,
  [ITEM_ORIGIN_CLASSES.OPEN]: 2,
});
const ACCESS_KIND = Object.freeze({
  [ITEM_ACCESS_MODES.EMBEDDED]: 0,
  [ITEM_ACCESS_MODES.FREE_CLAIM]: 1,
  [ITEM_ACCESS_MODES.PAID_ONCE]: 2,
});
const BINDING_KIND = Object.freeze({
  [ITEM_BINDING_MODES.EMBEDDED]: 0,
  [ITEM_BINDING_MODES.ACCOUNT]: 1,
  [ITEM_BINDING_MODES.SOUL_BOUND]: 2,
  [ITEM_BINDING_MODES.OWNED]: 3,
});
const RIGHTS_KIND = Object.freeze({
  [ITEM_RIGHTS_ORIGINS.ONCHAIN_NATIVE]: 0,
  [ITEM_RIGHTS_ORIGINS.LICENSE_WRAPPED]: 1,
});

export class MakerComposablePlayerV6HydrationError extends Error {
  constructor(message, code = 'COMPOSABLE_PLAYER_V6_HYDRATION_ERROR', details = {}) {
    super(message);
    this.name = 'MakerComposablePlayerV6HydrationError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new MakerComposablePlayerV6HydrationError(message, code, details);
}

function string(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
}

function clone(value) {
  return structuredClone(value);
}

function id(value) {
  const result = string(value).toLowerCase();
  return SUI_ID.test(result) ? result : '';
}

function commitment(value) {
  const result = string(value).replace(/^0x/i, '').toLowerCase();
  return HASH.test(result) ? result : '';
}

// The Move publication path commits an absent extension surface as SHA-256
// of empty bytes. Walrus JSON keeps that same value as an empty string so a
// future schema cannot accidentally treat the two representations as
// different products.
function optionalCommitment(value) {
  return commitment(value) || EMPTY_COMMITMENT;
}

function atomic(value) {
  try {
    const parsed = BigInt(value);
    return parsed >= 0n && parsed <= ((1n << 64n) - 1n) ? parsed.toString() : '';
  } catch {
    return '';
  }
}

function numeric(value) {
  const result = Number(value);
  return Number.isSafeInteger(result) && result >= 0 ? result : -1;
}

function listIds(value) {
  return array(value).map(id);
}

function sameIds(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function issue(issues, code, message, details = {}) {
  issues.push({ code, message, details });
}

function itemChainRecord(chainProducts, product) {
  const matches = array(chainProducts).filter((entry) => (
    commitment(entry?.definitionCommitment) === commitment(product.manifestHash)
  ));
  return matches.length === 1 ? matches[0] : null;
}

function profileIssues(companion, trusted, issues) {
  const profile = createComposableProfileV6(companion.profile);
  const compatibility = createCompatibilityProfileV6(companion.compatibility);
  const onchain = object(trusted.profile);
  const rootId = id(companion.baseMaker?.makerRootId);
  if (!rootId
      || !string(trusted.companionManifestBlobId)
      || !commitment(trusted.companionManifestHash)
      || !commitment(trusted.validatorPolicyCommitment)
      || numeric(trusted.validatorEpoch) < 0) {
    issue(
      issues,
      'trusted-query-identity-missing',
      'Trusted hydration requires exact Maker root, companion Blob/hash, and validator policy commitment.',
    );
  }
  if (!id(onchain.id) || onchain.sealed !== true) {
    issue(issues, 'profile-not-sealed', 'MakerProfileV6 is missing or not sealed.');
  }
  if (id(onchain.rootId) !== rootId
      || numeric(onchain.mode) !== PROFILE_MODE[profile.mode]
      || typeof onchain.loadoutMutable !== 'boolean'
      || Boolean(onchain.loadoutMutable) !== profile.loadoutMutable
      || typeof onchain.itemAssetization !== 'boolean'
      || Boolean(onchain.itemAssetization) !== profile.itemAssetization
      || numeric(onchain.thirdPartyPolicy) !== THIRD_PARTY_POLICY[profile.thirdPartyAdmission]) {
    issue(issues, 'profile-policy-mismatch', 'On-chain MakerProfileV6 policy differs from the companion manifest.');
  }
  if (commitment(onchain.slotSchemaCommitment) !== commitment(compatibility.manifestHash)
      || commitment(onchain.rendererCommitment) !== commitment(compatibility.renderer?.commitment)
      || commitment(onchain.extensionsHash) !== optionalCommitment(profile.extensionsHash)) {
    issue(issues, 'profile-commitment-mismatch', 'On-chain profile commitments differ from the companion manifest.');
  }
  if (string(onchain.companionManifestBlobId) !== string(trusted.companionManifestBlobId)
      || commitment(onchain.companionManifestHash)
        !== commitment(trusted.companionManifestHash)) {
    issue(issues, 'profile-companion-mismatch', 'MakerProfileV6 does not point to the exact queried companion Blob and bytes.');
  }
  return { profile, compatibility };
}

function productIssues({
  product,
  chainProduct,
  chainProductIds,
  profileId,
  rootId,
  trusted,
  issues,
}) {
  if (!chainProduct) {
    issue(issues, 'product-chain-record-missing', 'Exactly one matching ItemProductV6 is required.', {
      productId: product.id,
    });
    return null;
  }
  const productObjectId = id(chainProduct.id);
  const official = product.originClass === ITEM_ORIGIN_CLASSES.OFFICIAL;
  const expectedRequired = product.requires.map((logicalId) => chainProductIds.get(logicalId) || '');
  const expectedExcluded = product.excludes.map((logicalId) => chainProductIds.get(logicalId) || '');
  const comparisons = [
    [numeric(chainProduct.originKind), ADMISSION_SOURCE[product.originClass]],
    [commitment(chainProduct.definitionCommitment), commitment(product.manifestHash)],
    [commitment(chainProduct.assetCommitment), commitment(product.contentHash)],
    [string(chainProduct.slotKey), string(product.slotClaims[0]?.slotId)],
    [commitment(chainProduct.slotSchemaCommitment), commitment(product.compatibilityHash)],
    [numeric(chainProduct.rightsOrigin), RIGHTS_KIND[product.rightsOrigin]],
    [numeric(chainProduct.accessKind), ACCESS_KIND[product.access.mode]],
    [numeric(chainProduct.bindingKind), BINDING_KIND[product.access.binding]],
    [atomic(chainProduct.priceAtomic), String(product.access.priceAtomic)],
    [numeric(chainProduct.makerEcosystemFeeBps), Number(product.makerEcosystemFeeBps)],
    [Boolean(chainProduct.transferable), product.access.transferable],
    [id(chainProduct.publisher), id(product.publisher)],
    [id(chainProduct.originalCreator), id(product.creator)],
    [commitment(chainProduct.extensionsHash), optionalCommitment(product.extensionsHash)],
  ];
  if (!productObjectId
      || comparisons.some(([left, right]) => left !== right)
      || typeof chainProduct.transferable !== 'boolean'
      || !Array.isArray(chainProduct.requiredProductIds)
      || !Array.isArray(chainProduct.excludedProductIds)
      || !sameIds(listIds(chainProduct.requiredProductIds), expectedRequired)
      || !sameIds(listIds(chainProduct.excludedProductIds), expectedExcluded)
      || (official
        ? id(chainProduct.sourceRootId) !== rootId
        : Boolean(id(chainProduct.sourceRootId)))) {
    issue(issues, 'product-chain-record-mismatch', 'ItemProductV6 fields differ from the immutable Item manifest.', {
      productId: product.id,
      productObjectId,
    });
    return null;
  }

  const admissions = array(trusted.admissions).filter((entry) => (
    id(entry?.profileId) === profileId && id(entry?.productId) === productObjectId
  ));
  const admission = admissions.length === 1 ? admissions[0] : null;
  if (!admission
      || admission.active !== true
      || numeric(admission.sourceKind) !== ADMISSION_SOURCE[product.originClass]
      || commitment(admission.definitionCommitment) !== commitment(product.manifestHash)
      || commitment(admission.assetCommitment) !== commitment(product.contentHash)
      || string(admission.slotKey) !== string(product.slotClaims[0]?.slotId)
      || numeric(admission.rightsOrigin) !== RIGHTS_KIND[product.rightsOrigin]
      || numeric(admission.accessKind) !== ACCESS_KIND[product.access.mode]
      || numeric(admission.bindingKind) !== BINDING_KIND[product.access.binding]
      || atomic(admission.priceAtomic) !== String(product.access.priceAtomic)
      || numeric(admission.makerEcosystemFeeBps) !== Number(product.makerEcosystemFeeBps)
      || typeof admission.transferable !== 'boolean'
      || Boolean(admission.transferable) !== product.access.transferable
      || !Array.isArray(admission.requiredProductIds)
      || !Array.isArray(admission.excludedProductIds)
      || !sameIds(listIds(admission.requiredProductIds), expectedRequired)
      || !sameIds(listIds(admission.excludedProductIds), expectedExcluded)
      || id(admission.publisher) !== id(product.publisher)
      || !id(admission.admittedBy)
      || numeric(admission.admittedAtMs) < 0) {
    issue(issues, 'product-admission-mismatch', 'The Product is not actively admitted with its exact immutable policy.', {
      productId: product.id,
      productObjectId,
    });
    return null;
  }

  const attestationId = id(admission.attestationId);
  const attestations = array(trusted.attestations).filter((entry) => id(entry?.id) === attestationId);
  const attestation = attestations.length === 1 ? attestations[0] : null;
  if (!attestationId
      || !attestation
      || id(attestation.profileId) !== profileId
      || id(attestation.productId) !== productObjectId
      || commitment(attestation.definitionCommitment) !== commitment(product.manifestHash)
      || commitment(attestation.slotSchemaCommitment) !== commitment(product.compatibilityHash)
      || commitment(attestation.validatorPolicyCommitment)
        !== commitment(trusted.validatorPolicyCommitment)
      || numeric(attestation.validatorEpoch) !== numeric(trusted.validatorEpoch)
      || numeric(attestation.issuedAtMs) < 0) {
    issue(issues, 'validator-attestation-missing', 'A trusted on-chain ValidatorAttestationV6 is required.', {
      productId: product.id,
      productObjectId,
    });
    return null;
  }
  return { productObjectId, admission, attestation };
}

/**
 * Converts an exact Walrus companion plus trusted Sui query records into the
 * only catalog shape the Player may treat as validated. Manifest-declared
 * validation/certification fields are discarded and rebuilt from Admission +
 * ValidatorAttestation readback.
 */
export function hydrateTrustedMakerComposableV6Catalog({
  companionManifest,
  trustedChainState,
} = {}) {
  const companion = object(companionManifest);
  const trusted = object(trustedChainState);
  const issues = [];
  if (trusted.queryVerified !== true) {
    fail(
      'COMPOSABLE_PLAYER_V6_UNTRUSTED_CHAIN_SOURCE',
      'Catalog hydration accepts only records returned by the configured Sui query client.',
    );
  }
  const { profile, compatibility } = profileIssues(companion, trusted, issues);
  const profileId = id(trusted.profile?.id);
  const rootId = id(companion.baseMaker?.makerRootId);
  const manifestProducts = array(companion.items).map(createItemProductV6);
  const chainByLogical = new Map(manifestProducts.map((product) => [
    product.id,
    itemChainRecord(trusted.products, product),
  ]));
  const chainProductIds = new Map([...chainByLogical].map(([logicalId, record]) => [
    logicalId,
    id(record?.id),
  ]));
  const hydrated = [];
  manifestProducts.forEach((product) => {
    const verified = productIssues({
      product,
      chainProduct: chainByLogical.get(product.id),
      chainProductIds,
      profileId,
      rootId,
      trusted,
      issues,
    });
    if (!verified) return;
    hydrated.push({
      ...product,
      // Never trust the same fields from Walrus JSON.
      validation: {
        passed: true,
        attestationId: verified.attestation.id,
        epoch: numeric(verified.attestation.validatorEpoch),
      },
      certification: product.originClass === ITEM_ORIGIN_CLASSES.OPEN
        ? null
        : {
            certifier: string(verified.admission.admittedBy),
            ownershipEpoch: numeric(verified.admission.ownershipEpoch) < 0
              ? 0
              : numeric(verified.admission.ownershipEpoch),
          },
    });
  });
  if (issues.length) {
    fail(
      'COMPOSABLE_PLAYER_V6_CHAIN_CATALOG_MISMATCH',
      'The v6 Player catalog failed trusted chain hydration.',
      { issues },
    );
  }
  return {
    trusted: true,
    profile,
    compatibility,
    products: hydrated,
    productObjectIds: Object.fromEntries(chainProductIds),
    profileObjectId: profileId,
    companionManifestBlobId: trusted.companionManifestBlobId,
    companionManifestHash: commitment(trusted.companionManifestHash),
    validatorEpoch: numeric(trusted.validatorEpoch),
  };
}
