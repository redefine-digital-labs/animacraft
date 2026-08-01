import {
  hashMakerComposableV6LoadoutSelections,
} from './maker-composable-player-v6.js';
import {
  collectCompatibilityProfileV6Issues,
  collectComposableProfileV6Issues,
  collectItemProductV6Issues,
} from './maker-composable-v6.js';

export const COMPOSABLE_V6_OC_APPEARANCE_SCHEMA =
  'animacraft.oc-appearance-companion.v6';

const COMPOSABLE_V6_MANIFEST_SCHEMA = 'animacraft.maker-composable.v6';
const COMPOSABLE_V6_MODE = 'COMPOSABLE';
const COMPOSABLE_V6_BINDINGS = new Set([
  'EMBEDDED',
  'ACCOUNT',
  'SOUL_BOUND',
  'OWNED',
]);
const COMPOSABLE_V6_COMPLETION_FIELDS = new Set([
  'loadout',
  'appearanceRevision',
  'profileObjectId',
  'companionManifestBlobId',
  'companionManifestHash',
  'productObjectIds',
  'entitlements',
  'companionManifest',
]);
const COMPOSABLE_V6_ENTITLEMENT_FIELDS = new Set([
  'schemaVersion',
  'id',
  'productId',
  'itemVersion',
  'makerRootId',
  'compatibilityHash',
  'binding',
  'holderAddress',
  'soulId',
  'ownerAddress',
  'equippedSoulId',
  'issuedAtMs',
  'paidAtomic',
  'rightsSnapshotHash',
  'issuanceNonce',
  'extensionsHash',
]);
const COMPOSABLE_V6_MANIFEST_FIELDS = new Set([
  'schemaVersion',
  'baseMaker',
  'profile',
  'compatibility',
  'compatibilitySealed',
  'items',
  'fallbackLoadout',
  'extensionsHash',
]);
const COMPOSABLE_V6_BASE_BINDING_FIELDS = new Set([
  'manifestSchemaVersion',
  'makerRootId',
  'rootMakerId',
  'versionId',
  'versionNumber',
  'manifestHash',
]);
const COMPOSABLE_V6_FALLBACK_FIELDS = new Set(['productIds', 'commitment']);
const SUI_ID = /^0x[0-9a-f]{1,64}$/i;

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalValue(value[key])]),
  );
}

function string(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizedHash(value, label) {
  const result = string(value).replace(/^0x/i, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(result)) {
    throw new TypeError(`${label} must be an exact 32-byte hash.`);
  }
  return result;
}

function normalizedSuiId(value, label) {
  const result = string(value).toLowerCase();
  if (!SUI_ID.test(result)) throw new TypeError(`${label} must be an exact Sui object ID.`);
  return `0x${result.slice(2).padStart(64, '0')}`;
}

function stableJson(value) {
  return JSON.stringify(canonicalValue(value));
}

async function sha256(value) {
  if (!globalThis.crypto?.subtle) {
    throw new TypeError('SHA-256 is unavailable for the Composable v6 OC package.');
  }
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((entry) => entry.toString(16).padStart(2, '0'))
    .join('');
}

function assertOnlyFields(value, allowed, label) {
  Object.keys(value).forEach((key) => {
    if (!allowed.has(key)) throw new TypeError(`${label} contains unknown field ${key}.`);
  });
}

function assertNoUnknownModelFields(issues, label) {
  const unknown = issues.find((issue) => issue?.code === 'unknown_schema_field');
  if (unknown) throw new TypeError(`${label} contains unknown field ${unknown.path}.`);
}

function documentComposableMode(document, value) {
  return document?.extensions?.composableV6?.profile?.mode
    || value?.companionManifest?.profile?.mode
    || '';
}

function normalizeComposableV6(value, { document = null } = {}) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Composable v6 completion state must be an object.');
  }
  // MakerWorkspace supplies a lightweight loadout state for every Player.
  // Only an explicit Composable profile may cross the immutable OC boundary;
  // Fixed Makers therefore retain the byte-for-byte v5/v4 package shape.
  if (documentComposableMode(document, value) !== COMPOSABLE_V6_MODE) return null;
  assertOnlyFields(value, COMPOSABLE_V6_COMPLETION_FIELDS, 'Composable v6 completion state');
  const loadout = Array.isArray(value.loadout)
    ? value.loadout.map((entry) => String(entry || '').trim()).filter(Boolean)
    : null;
  const appearanceRevision = Number(value.appearanceRevision);
  if (
    !loadout
    || !Number.isSafeInteger(appearanceRevision)
    || appearanceRevision < 0
  ) {
    throw new TypeError('Composable v6 completion state requires an exact loadout and revision.');
  }
  if (new Set(loadout).size !== loadout.length) {
    throw new TypeError('Composable v6 completion state contains duplicate Product identities.');
  }
  const productObjectIds = value.productObjectIds === undefined
    ? null
    : value.productObjectIds;
  if (
    productObjectIds !== null
    && (!productObjectIds || typeof productObjectIds !== 'object' || Array.isArray(productObjectIds))
  ) {
    throw new TypeError('Composable v6 Product object identities must be an object map.');
  }
  const entitlements = value.entitlements === undefined ? null : value.entitlements;
  if (entitlements !== null && !Array.isArray(entitlements)) {
    throw new TypeError('Composable v6 entitlements must be an exact array snapshot.');
  }
  (entitlements || []).forEach((entitlement, index) => {
    if (!entitlement || typeof entitlement !== 'object' || Array.isArray(entitlement)) {
      throw new TypeError(`Composable v6 entitlement ${index + 1} must be an object.`);
    }
    assertOnlyFields(
      entitlement,
      COMPOSABLE_V6_ENTITLEMENT_FIELDS,
      `Composable v6 entitlement ${index + 1}`,
    );
  });
  const companionManifest = value.companionManifest === undefined
    ? null
    : value.companionManifest;
  if (
    companionManifest !== null
    && (!companionManifest || typeof companionManifest !== 'object' || Array.isArray(companionManifest))
  ) {
    throw new TypeError('Composable v6 companion manifest must be an object.');
  }
  return {
    loadout,
    appearanceRevision,
    ...(value.profileObjectId !== undefined
      ? { profileObjectId: string(value.profileObjectId) }
      : {}),
    ...(value.companionManifestBlobId !== undefined
      ? { companionManifestBlobId: string(value.companionManifestBlobId) }
      : {}),
    ...(value.companionManifestHash !== undefined
      ? { companionManifestHash: string(value.companionManifestHash) }
      : {}),
    ...(productObjectIds !== null ? { productObjectIds: clone(productObjectIds) } : {}),
    ...(entitlements !== null ? { entitlements: clone(entitlements) } : {}),
    ...(companionManifest !== null ? { companionManifest: clone(companionManifest) } : {}),
  };
}

function entitlementIdentity(entitlement, product, productObjectId) {
  const binding = product?.access?.binding;
  if (binding === 'EMBEDDED') return null;
  if (!entitlement) {
    throw new TypeError(`Composable v6 Product ${product.id} is missing its verified entitlement.`);
  }
  if (
    string(entitlement.productId) !== product.id
    || Number(entitlement.itemVersion) !== Number(product.version)
    || string(entitlement.makerRootId) !== string(product.makerRootId)
    || normalizedHash(entitlement.compatibilityHash, 'Entitlement compatibility hash')
      !== normalizedHash(product.compatibilityHash, 'Product compatibility hash')
    || normalizedHash(entitlement.rightsSnapshotHash, 'Entitlement rights snapshot hash')
      !== normalizedHash(product.rightsManifestHash, 'Product rights manifest hash')
    || entitlement.binding !== binding
  ) {
    throw new TypeError(`Composable v6 Product ${product.id} entitlement does not match its immutable Product.`);
  }
  const result = {
    entitlementId: normalizedSuiId(entitlement.id, `${product.id} entitlement ID`),
    binding,
  };
  if (binding === 'ACCOUNT') {
    result.holderAddress = normalizedSuiId(entitlement.holderAddress, `${product.id} holder`);
    if (entitlement.soulId !== null || entitlement.ownerAddress !== null || entitlement.equippedSoulId !== null) {
      throw new TypeError(`Composable v6 Product ${product.id} account entitlement has foreign identity fields.`);
    }
  } else if (binding === 'SOUL_BOUND') {
    result.soulId = normalizedSuiId(entitlement.soulId, `${product.id} Soul`);
    if (entitlement.holderAddress !== null || entitlement.ownerAddress !== null || entitlement.equippedSoulId !== null) {
      throw new TypeError(`Composable v6 Product ${product.id} Soul entitlement has foreign identity fields.`);
    }
  } else if (binding === 'OWNED') {
    result.ownerAddress = normalizedSuiId(entitlement.ownerAddress, `${product.id} owner`);
    result.ownedInstanceId = normalizedSuiId(entitlement.id, `${product.id} owned instance`);
    if (entitlement.holderAddress !== null || entitlement.soulId !== null) {
      throw new TypeError(`Composable v6 Product ${product.id} owned entitlement has foreign identity fields.`);
    }
    const equippedSoulId = string(entitlement.equippedSoulId);
    if (equippedSoulId) {
      result.equippedSoulId = normalizedSuiId(equippedSoulId, `${product.id} equipped Soul`);
    }
  } else {
    throw new TypeError(`Composable v6 Product ${product.id} has an unsupported binding.`);
  }
  // The chain ItemProductV6 is the exact product identity used by the
  // loadout hash. Keep it beside the entitlement identity for auditability.
  result.productObjectId = productObjectId;
  return result;
}

/**
 * Build the canonical immutable Appearance companion for a completed v6 OC.
 * The input must be the already reviewed completion snapshot plus the exact
 * trusted Walrus/Sui companion binding. No live mutable Player state is read.
 */
export async function buildComposableV6OcAppearanceCompanion({
  document,
  completion,
  makerObjectId = '',
  baseManifestBlobId = '',
} = {}) {
  const state = normalizeComposableV6(completion?.composableV6, { document });
  if (!state) return null;
  const manifest = state.companionManifest;
  if (!manifest || manifest.schemaVersion !== COMPOSABLE_V6_MANIFEST_SCHEMA) {
    throw new TypeError('Composable v6 Complete requires the exact published companion manifest.');
  }
  assertOnlyFields(manifest, COMPOSABLE_V6_MANIFEST_FIELDS, 'Composable v6 companion manifest');
  if (!manifest.baseMaker || typeof manifest.baseMaker !== 'object' || Array.isArray(manifest.baseMaker)) {
    throw new TypeError('Composable v6 companion is missing its base Maker binding.');
  }
  assertOnlyFields(manifest.baseMaker, COMPOSABLE_V6_BASE_BINDING_FIELDS, 'Composable v6 base Maker binding');
  if (!manifest.fallbackLoadout || typeof manifest.fallbackLoadout !== 'object' || Array.isArray(manifest.fallbackLoadout)) {
    throw new TypeError('Composable v6 companion is missing its fallback Loadout binding.');
  }
  assertOnlyFields(manifest.fallbackLoadout, COMPOSABLE_V6_FALLBACK_FIELDS, 'Composable v6 fallback Loadout');
  assertNoUnknownModelFields(
    collectComposableProfileV6Issues(manifest.profile),
    'Composable v6 profile',
  );
  assertNoUnknownModelFields(
    collectCompatibilityProfileV6Issues(manifest.compatibility),
    'Composable v6 Compatibility profile',
  );
  (Array.isArray(manifest.items) ? manifest.items : []).forEach((product, index) => {
    assertNoUnknownModelFields(
      collectItemProductV6Issues(product),
      `Composable v6 Product ${index + 1}`,
    );
  });
  if (manifest.profile?.mode !== COMPOSABLE_V6_MODE || manifest.compatibilitySealed !== true) {
    throw new TypeError('Composable v6 Complete requires a sealed Composable profile.');
  }
  const documentVersion = document?.version || {};
  if (
    string(manifest.baseMaker?.rootMakerId) !== string(documentVersion.rootMakerId)
    || string(manifest.baseMaker?.versionId) !== string(documentVersion.versionId)
    || Number(manifest.baseMaker?.versionNumber) !== Number(documentVersion.number)
    || normalizedSuiId(manifest.baseMaker?.makerRootId, 'Companion MakerRootV5 object ID')
      !== normalizedSuiId(makerObjectId, 'Completed MakerRootV5 object ID')
  ) {
    throw new TypeError('Composable v6 companion does not bind the completed Maker version and root.');
  }
  const manifestHash = await sha256(stableJson(manifest));
  if (manifestHash !== normalizedHash(state.companionManifestHash, 'Companion manifest hash')) {
    throw new TypeError('Composable v6 companion bytes do not match the trusted manifest hash.');
  }
  const companionBlobId = string(state.companionManifestBlobId);
  const baseBlobId = string(baseManifestBlobId);
  if (!companionBlobId || !baseBlobId) {
    throw new TypeError('Composable v6 Complete requires exact base and companion Walrus Blob IDs.');
  }
  const profileObjectId = normalizedSuiId(state.profileObjectId, 'MakerProfileV6 object ID');
  const compatibilityHash = normalizedHash(
    manifest.compatibility?.manifestHash,
    'Compatibility manifest hash',
  );
  const compatibilityBlobId = string(manifest.compatibility?.manifestBlobId);
  if (!compatibilityBlobId) {
    throw new TypeError('Composable v6 Complete requires the immutable Compatibility Blob ID.');
  }

  const products = Array.isArray(manifest.items) ? manifest.items : [];
  const productByLogicalId = new Map(products.map((product) => [string(product?.id), product]));
  if (productByLogicalId.size !== products.length) {
    throw new TypeError('Composable v6 companion Product identities must be unique.');
  }
  const objectIds = state.productObjectIds;
  if (!objectIds || typeof objectIds !== 'object' || Array.isArray(objectIds)) {
    throw new TypeError('Composable v6 Complete requires the verified ItemProductV6 object map.');
  }
  Object.keys(objectIds).forEach((logicalId) => {
    if (!productByLogicalId.has(logicalId)) {
      throw new TypeError(`Composable v6 Product object map contains unknown Product ${logicalId}.`);
    }
  });
  const entitlementByProduct = new Map();
  (state.entitlements || []).forEach((entitlement) => {
    const productId = string(entitlement.productId);
    if (!productByLogicalId.has(productId) || entitlementByProduct.has(productId)) {
      throw new TypeError(`Composable v6 entitlement identity is unknown or duplicated for ${productId}.`);
    }
    entitlementByProduct.set(productId, entitlement);
  });

  const selections = state.loadout.map((logicalProductId) => {
    const product = productByLogicalId.get(logicalProductId);
    if (!product) throw new TypeError(`Composable v6 loadout references unknown Product ${logicalProductId}.`);
    const claims = Array.isArray(product.slotClaims) ? product.slotClaims : [];
    if (claims.length !== 1 || !string(claims[0]?.slotId) || Number(claims[0]?.units) !== 1) {
      throw new TypeError(`Composable v6 Product ${logicalProductId} must occupy exactly one Slot.`);
    }
    const binding = product.access?.binding;
    if (!COMPOSABLE_V6_BINDINGS.has(binding)) {
      throw new TypeError(`Composable v6 Product ${logicalProductId} has an invalid binding.`);
    }
    const productObjectId = normalizedSuiId(
      objectIds[logicalProductId],
      `${logicalProductId} ItemProductV6 object ID`,
    );
    const entitlement = entitlementIdentity(
      entitlementByProduct.get(logicalProductId),
      product,
      productObjectId,
    );
    return {
      logicalProductId,
      productObjectId,
      itemVersion: Number(product.version),
      productManifestHash: normalizedHash(product.manifestHash, `${logicalProductId} manifest hash`),
      slotId: string(claims[0].slotId),
      binding,
      entitlement,
    };
  });
  const loadoutHash = await hashMakerComposableV6LoadoutSelections(
    selections.map((selection) => ({
      productId: selection.productObjectId,
      slotKey: selection.slotId,
      bindingMode: selection.binding,
      ownedInstanceId: selection.entitlement?.ownedInstanceId || '',
    })),
  );
  const companion = {
    schemaVersion: COMPOSABLE_V6_OC_APPEARANCE_SCHEMA,
    appearanceRevision: state.appearanceRevision,
    loadoutHash,
    binding: {
      makerRootObjectId: normalizedSuiId(makerObjectId, 'MakerRootV5 object ID'),
      rootMakerId: string(documentVersion.rootMakerId),
      makerVersionId: string(documentVersion.versionId),
      baseManifestBlobId: baseBlobId,
      baseManifestHash: normalizedHash(manifest.baseMaker?.manifestHash, 'Base Maker manifest hash'),
      profileObjectId,
      companionManifestBlobId: companionBlobId,
      companionManifestHash: manifestHash,
      compatibilityManifestBlobId: compatibilityBlobId,
      compatibilityManifestHash: compatibilityHash,
    },
    selections,
  };
  return deepFreeze({
    companion,
    integrityHash: await sha256(stableJson(companion)),
  });
}

/** Add the v6 companion without modifying any existing v5 canonical field. */
export function attachComposableV6OcAppearanceCompanion(ocBundle, appearance) {
  if (!appearance) return ocBundle;
  if (!ocBundle?.package || typeof ocBundle.package !== 'object') {
    throw new TypeError('A Maker v5 OC bundle is required for the v6 Appearance companion.');
  }
  const next = clone(ocBundle);
  next.package.composableAppearance = clone(appearance.companion);
  next.package.integrity = {
    ...(next.package.integrity || {}),
    composableAppearanceHash: normalizedHash(
      appearance.integrityHash,
      'Composable Appearance integrity hash',
    ),
  };
  next.packageJson = JSON.stringify(next.package);
  return next;
}

/** Recompute and verify the exact companion stored in a restored OC package. */
export async function verifyComposableV6OcAppearanceCompanion({
  document,
  completion,
  packageValue,
  makerObjectId = '',
  baseManifestBlobId = '',
} = {}) {
  const expected = await buildComposableV6OcAppearanceCompanion({
    document,
    completion,
    makerObjectId,
    baseManifestBlobId,
  });
  const actual = packageValue?.composableAppearance || null;
  const recordedHash = packageValue?.integrity?.composableAppearanceHash || '';
  if (!expected) {
    if (actual || recordedHash) throw new TypeError('Fixed OC package contains an unexpected v6 Appearance companion.');
    return true;
  }
  if (
    stableJson(actual) !== stableJson(expected.companion)
    || normalizedHash(recordedHash, 'Restored Composable Appearance hash')
      !== expected.integrityHash
  ) {
    throw new TypeError('Restored Composable v6 Appearance does not match the immutable completion snapshot.');
  }
  return true;
}

/**
 * Freeze the exact Player state that was reviewed when Complete OC was
 * pressed. The runtime document itself remains owned by MakerWorkspace; the
 * immutable fields below are the only Player-authored inputs to an OC package.
 */
export function createPlayerCompletionSnapshot({
  document,
  recipe,
  profile,
  livingContent,
  composableV6 = null,
  imageBlob,
  imageExport,
} = {}) {
  const makerVersionId = String(document?.version?.versionId || '');
  if (!makerVersionId) throw new TypeError('A Maker version is required to complete an OC.');
  if (!recipe || typeof recipe !== 'object') throw new TypeError('A completed OC recipe is required.');
  if (!profile || typeof profile !== 'object') throw new TypeError('A completed OC profile is required.');
  if (!livingContent || typeof livingContent !== 'object') {
    throw new TypeError('Resolved Living Content is required to complete an OC.');
  }
  if (
    !imageBlob
    || typeof imageBlob.arrayBuffer !== 'function'
    || imageBlob.type !== 'image/png'
    || !Number.isSafeInteger(imageBlob.size)
    || imageBlob.size <= 0
  ) {
    throw new TypeError('The exact reviewed PNG is required to complete an OC.');
  }
  if (
    !imageExport
    || !['standard', 'original'].includes(imageExport.sizeMode)
    || typeof imageExport.transparentBackground !== 'boolean'
    || !Number.isSafeInteger(imageExport.width)
    || imageExport.width <= 0
    || !Number.isSafeInteger(imageExport.height)
    || imageExport.height <= 0
    || imageExport.mediaType !== 'image/png'
  ) {
    throw new TypeError('The reviewed PNG export settings are required to complete an OC.');
  }
  const normalizedComposableV6 = normalizeComposableV6(composableV6, { document });
  return deepFreeze({
    makerVersionId,
    recipe: clone(recipe),
    profile: clone(profile),
    livingContent: clone(livingContent),
    ...(normalizedComposableV6 ? { composableV6: normalizedComposableV6 } : {}),
    // Blob bytes are immutable by platform contract, so the exact reviewed
    // object can be retained without copying a potentially large PNG.
    imageBlob,
    imageExport: clone(imageExport),
  });
}

/**
 * Canonical JSON fingerprint of the complete immutable Walrus OC profile.
 * This deliberately covers Maker/version/Quilt provenance, resolved Living
 * Content, full recipe, Sui summary and integrity metadata.
 */
export function canonicalOcPackageFingerprint(packageValue) {
  if (!packageValue || typeof packageValue !== 'object' || Array.isArray(packageValue)) {
    throw new TypeError('A canonical OC package is required.');
  }
  return JSON.stringify(canonicalValue(packageValue));
}

/**
 * Return the resolved three-document source embedded in the certified OC
 * package. Final handoff artifacts must never fall back to mutable live Maker
 * state after Walrus preparation.
 */
export function certifiedLivingContentSource(packageValue) {
  const content = packageValue?.livingContent?.content;
  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    throw new TypeError('The certified OC package is missing resolved Living Content.');
  }
  for (const key of ['soulMd', 'memoryMd', 'skillMd']) {
    if (typeof content[key] !== 'string' || !content[key].trim()) {
      throw new TypeError(`The certified OC package is missing ${key}.`);
    }
  }
  return clone(content);
}
