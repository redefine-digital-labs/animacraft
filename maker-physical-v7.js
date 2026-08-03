/**
 * Animacraft physical Style assets v7.
 *
 * This is an additive product/document model. It deliberately does not alter
 * the already deployed v6 Item Product contract. In v7 a Part is the slot, an
 * ItemFamily is the product family, and one StyleProduct is the smallest exact
 * purchasable/equippable good. Color is part of the immutable PNG product; a
 * Smart Color channel is never an asset attribute.
 */

export const PHYSICAL_STYLE_CATALOG_V7_SCHEMA =
  'animacraft.physical-style-catalog.v7';
export const PHYSICAL_STYLE_CATALOG_V7_DRAFT_SCHEMA =
  'animacraft.physical-style-catalog-draft.v7';
export const ITEM_FAMILY_V7_SCHEMA = 'animacraft.item-family.v7';
export const STYLE_PRODUCT_V7_SCHEMA = 'animacraft.style-product.v7';
export const STYLE_ASSET_V7_SCHEMA = 'animacraft.style-asset.v7';
export const THIRD_PARTY_STYLE_PRODUCT_PACKAGE_V7_SCHEMA =
  'animacraft.third-party-style-product-package.v7';
export const PHYSICAL_STYLE_CATALOG_V7_EXTENSION_KEY = 'physicalStyleCatalogV7';

export const STYLE_PRODUCT_SUPPLY_MODES = Object.freeze({
  INCLUDED: 'INCLUDED',
  OPEN_EDITION: 'OPEN_EDITION',
  LIMITED_EDITION: 'LIMITED_EDITION',
});

export const STYLE_PRODUCT_ADMISSION_CLASSES = Object.freeze({
  OFFICIAL: 'OFFICIAL',
  CERTIFIED: 'CERTIFIED',
  OPEN: 'OPEN',
});

export const STYLE_PRODUCT_RIGHTS_ORIGINS = Object.freeze({
  ONCHAIN_NATIVE: 'ONCHAIN_NATIVE',
  LICENSE_WRAPPED: 'LICENSE_WRAPPED',
});

export const STYLE_ASSET_KINDS = Object.freeze({
  SOUL_LOCAL: 'SOUL_LOCAL',
  OWNED: 'OWNED',
});

export const PHYSICAL_PART_BEHAVIORS = Object.freeze({
  FIXED: 'FIXED',
  SOUL_LOCAL: 'SOUL_LOCAL',
  OPEN: 'OPEN',
  HYBRID: 'HYBRID',
});

export const STYLE_PRODUCT_PLAYER_STATES = Object.freeze({
  INCLUDED: 'INCLUDED',
  OWNED: 'OWNED',
  FOR_SALE: 'FOR_SALE',
  SOLD_OUT: 'SOLD_OUT',
  UNAVAILABLE: 'UNAVAILABLE',
});

const SAFE_KEY = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,255}$/;
const HASH_32 = /^(?:0x)?[0-9a-f]{64}$/i;
const SUI_ADDRESS = /^0x[0-9a-f]+$/i;
const MAX_CANVAS_SIDE = 32_768;
const MAX_TEXT_BYTES = 2_000;
const MAX_PRICE_ATOMIC = 1_000_000_000_000_000;
const MAX_SUPPLY = 1_000_000_000;
const MAX_BPS = 10_000;
const FORBIDDEN_COLOR_FIELDS = new Set([
  'smartColor',
  'smartColorChannel',
  'colorChannel',
  'colorChannelId',
  'swatches',
  'tint',
]);

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function string(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function integer(value, fallback = 0) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : fallback;
}

function nonNegativeInteger(value, fallback = 0, maximum = Number.MAX_SAFE_INTEGER) {
  const number = integer(value, fallback);
  return number >= 0 && number <= maximum ? number : fallback;
}

function positiveInteger(value, fallback = 0, maximum = Number.MAX_SAFE_INTEGER) {
  const number = integer(value, fallback);
  return number > 0 && number <= maximum ? number : fallback;
}

function enumValue(value, values, fallback) {
  return Object.values(values).includes(value) ? value : fallback;
}

function nullablePositiveInteger(value, maximum = Number.MAX_SAFE_INTEGER) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 && number <= maximum
    ? number
    : null;
}

function uniqueStrings(values) {
  return [...new Set(array(values).map(string).filter(Boolean))];
}

function clone(value) {
  return structuredClone(value);
}

function utf8Length(value) {
  return new TextEncoder().encode(String(value || '')).length;
}

function stableValue(value) {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [
    key,
    stableValue(value[key]),
  ]));
}

function issue(issues, path, code, message) {
  issues.push({ path, code, message });
}

function findForbiddenColorFields(value, path = '', results = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => findForbiddenColorFields(entry, `${path}[${index}]`, results));
    return results;
  }
  if (!value || typeof value !== 'object') return results;
  Object.entries(value).forEach(([key, entry]) => {
    const nextPath = path ? `${path}.${key}` : key;
    if (FORBIDDEN_COLOR_FIELDS.has(key)) results.push(nextPath);
    findForbiddenColorFields(entry, nextPath, results);
  });
  return results;
}

export function createStyleProductV7(value = {}) {
  const input = object(value);
  const exactPng = object(input.exactPng);
  const thumbnail = object(input.thumbnail);
  const supply = object(input.supply);
  const commerce = object(input.commerce);
  const rights = object(input.rights);
  const validation = object(input.validation);
  const certification = input.certification === null
    ? null
    : object(input.certification);
  const mode = enumValue(
    supply.mode,
    STYLE_PRODUCT_SUPPLY_MODES,
    STYLE_PRODUCT_SUPPLY_MODES.INCLUDED,
  );
  return {
    schemaVersion: STYLE_PRODUCT_V7_SCHEMA,
    id: string(input.id),
    version: positiveInteger(input.version, 1),
    // Stable logical v6 ItemProduct identity. The v7 chain object is always
    // published against the independently admitted v6 object resolved from
    // this key; a caller-supplied Sui object ID is never accepted here.
    v6ProductId: string(input.v6ProductId),
    familyId: string(input.familyId),
    targetMakerRootId: string(input.targetMakerRootId),
    targetProfileId: string(input.targetProfileId),
    targetPartId: string(input.targetPartId),
    name: string(input.name),
    description: string(input.description),
    creator: string(input.creator),
    publisher: string(input.publisher),
    admissionClass: enumValue(
      input.admissionClass,
      STYLE_PRODUCT_ADMISSION_CLASSES,
      STYLE_PRODUCT_ADMISSION_CLASSES.OPEN,
    ),
    exactPng: {
      assetId: string(exactPng.assetId),
      blobId: string(exactPng.blobId),
      contentHash: string(exactPng.contentHash).replace(/^0x/i, '').toLowerCase(),
      mediaType: string(exactPng.mediaType) || 'image/png',
      width: positiveInteger(exactPng.width, 0, MAX_CANVAS_SIDE),
      height: positiveInteger(exactPng.height, 0, MAX_CANVAS_SIDE),
    },
    thumbnail: {
      assetId: string(thumbnail.assetId),
      blobId: string(thumbnail.blobId),
      contentHash: string(thumbnail.contentHash).replace(/^0x/i, '').toLowerCase(),
    },
    placement: {
      layerTrackId: string(input.placement?.layerTrackId),
      x: Number.isFinite(Number(input.placement?.x)) ? Number(input.placement.x) : 0,
      y: Number.isFinite(Number(input.placement?.y)) ? Number(input.placement.y) : 0,
      scale: Number.isFinite(Number(input.placement?.scale)) ? Number(input.placement.scale) : 1,
      rotation: Number.isFinite(Number(input.placement?.rotation)) ? Number(input.placement.rotation) : 0,
      opacity: Number.isFinite(Number(input.placement?.opacity)) ? Number(input.placement.opacity) : 1,
      blendMode: string(input.placement?.blendMode) || 'normal',
    },
    baseSource: input.baseSource
      ? {
          partId: string(input.baseSource.partId),
          itemId: string(input.baseSource.itemId),
          styleId: string(input.baseSource.styleId),
        }
      : null,
    supply: {
      mode,
      cap: mode === STYLE_PRODUCT_SUPPLY_MODES.LIMITED_EDITION
        ? nullablePositiveInteger(supply.cap, MAX_SUPPLY)
        : null,
      minted: nonNegativeInteger(supply.minted, 0, MAX_SUPPLY),
    },
    commerce: {
      priceAtomic: nonNegativeInteger(commerce.priceAtomic, 0, MAX_PRICE_ATOMIC),
      coinType: string(commerce.coinType),
      coinSymbol: string(commerce.coinSymbol) || 'USDC',
      protocolFeeBps: nonNegativeInteger(commerce.protocolFeeBps, 1_000, MAX_BPS),
      makerEcosystemFeeBps: nonNegativeInteger(commerce.makerEcosystemFeeBps, 0, MAX_BPS),
      creatorRoyaltyBps: nonNegativeInteger(commerce.creatorRoyaltyBps, 0, MAX_BPS),
    },
    rights: {
      origin: enumValue(
        rights.origin,
        STYLE_PRODUCT_RIGHTS_ORIGINS,
        STYLE_PRODUCT_RIGHTS_ORIGINS.LICENSE_WRAPPED,
      ),
      manifestHash: string(rights.manifestHash).replace(/^0x/i, '').toLowerCase(),
    },
    validation: {
      passed: validation.passed === true,
      attestationId: string(validation.attestationId),
      epoch: nonNegativeInteger(validation.epoch),
    },
    certification: certification
      ? {
          certifier: string(certification.certifier),
          ownershipEpoch: nonNegativeInteger(certification.ownershipEpoch),
        }
      : null,
    manifestBlobId: string(input.manifestBlobId),
    manifestHash: string(input.manifestHash).replace(/^0x/i, '').toLowerCase(),
    extensionsHash: string(input.extensionsHash).replace(/^0x/i, '').toLowerCase(),
  };
}

export function createItemFamilyV7(value = {}) {
  const input = object(value);
  return {
    schemaVersion: ITEM_FAMILY_V7_SCHEMA,
    id: string(input.id),
    targetMakerRootId: string(input.targetMakerRootId),
    targetProfileId: string(input.targetProfileId),
    targetPartId: string(input.targetPartId),
    name: string(input.name),
    description: string(input.description),
    creator: string(input.creator),
    styles: array(input.styles).map((product) => createStyleProductV7({
      ...product,
      familyId: string(product?.familyId) || string(input.id),
      targetMakerRootId: string(product?.targetMakerRootId) || string(input.targetMakerRootId),
      targetProfileId: string(product?.targetProfileId) || string(input.targetProfileId),
      targetPartId: string(product?.targetPartId) || string(input.targetPartId),
    })),
  };
}

export function createPhysicalStyleCatalogV7(value = {}) {
  const input = object(value);
  const target = object(input.target);
  const admission = object(input.admission);
  return {
    schemaVersion: input.schemaVersion === PHYSICAL_STYLE_CATALOG_V7_SCHEMA
      ? PHYSICAL_STYLE_CATALOG_V7_SCHEMA
      : PHYSICAL_STYLE_CATALOG_V7_DRAFT_SCHEMA,
    enabled: input.enabled === true,
    target: {
      makerRootId: string(target.makerRootId),
      profileId: string(target.profileId),
      compatibilityHash: string(target.compatibilityHash).replace(/^0x/i, '').toLowerCase(),
    },
    admission: {
      certified: admission.certified === true,
      open: admission.open === true,
    },
    partPolicies: array(input.partPolicies).map((policy) => ({
      partId: string(policy?.partId || policy?.slotKey),
      behavior: enumValue(
        policy?.behavior,
        PHYSICAL_PART_BEHAVIORS,
        PHYSICAL_PART_BEHAVIORS.SOUL_LOCAL,
      ),
      required: policy?.required === true,
      maxSourceKind: enumValue(
        policy?.maxSourceKind,
        STYLE_PRODUCT_ADMISSION_CLASSES,
        STYLE_PRODUCT_ADMISSION_CLASSES.OFFICIAL,
      ),
    })),
    families: array(input.families).map(createItemFamilyV7),
    extensionsHash: string(input.extensionsHash).replace(/^0x/i, '').toLowerCase(),
  };
}

/**
 * Portable, off-chain authoring envelope for one independently supplied exact
 * Style Product. It intentionally contains no Maker owner capability: any
 * creator may prepare the package, while the target Maker still decides
 * whether to admit it. The PNG must already be an immutable exact colorway;
 * Smart Color metadata is rejected by the shared Product validator.
 */
export function createThirdPartyStyleProductPackageV7(value = {}) {
  const input = object(value);
  const target = object(input.target);
  const familyInput = object(input.family);
  const productInput = object(input.product || input.styleProduct);
  const targetMakerRootId = string(target.makerRootId)
    || string(productInput.targetMakerRootId);
  const targetProfileId = string(target.profileId)
    || string(productInput.targetProfileId);
  const targetPartId = string(target.partId)
    || string(familyInput.targetPartId)
    || string(productInput.targetPartId);
  const family = createItemFamilyV7({
    ...familyInput,
    targetMakerRootId,
    targetProfileId,
    targetPartId,
    styles: [],
  });
  const product = createStyleProductV7({
    ...productInput,
    familyId: string(productInput.familyId) || family.id,
    targetMakerRootId,
    targetProfileId,
    targetPartId,
    admissionClass: enumValue(
      productInput.admissionClass,
      STYLE_PRODUCT_ADMISSION_CLASSES,
      STYLE_PRODUCT_ADMISSION_CLASSES.OPEN,
    ),
    baseSource: null,
  });
  return {
    schemaVersion: THIRD_PARTY_STYLE_PRODUCT_PACKAGE_V7_SCHEMA,
    target: {
      makerRootId: targetMakerRootId,
      profileId: targetProfileId,
      partId: targetPartId,
      compatibilityHash: string(target.compatibilityHash).replace(/^0x/i, '').toLowerCase(),
    },
    family: { ...family, styles: [] },
    product,
    authoring: {
      independent: true,
      template: input.authoring?.template === true,
      note: string(input.authoring?.note),
    },
  };
}

export function collectThirdPartyStyleProductPackageV7Issues(value, {
  publish = false,
} = {}) {
  const raw = object(value);
  const packageValue = createThirdPartyStyleProductPackageV7(raw);
  const issues = [];
  if (raw.schemaVersion !== THIRD_PARTY_STYLE_PRODUCT_PACKAGE_V7_SCHEMA) {
    issue(issues, 'schemaVersion', 'invalid_supplier_package_schema', 'Third-party Style package schema is not supported.');
  }
  if (!SAFE_KEY.test(packageValue.target.makerRootId)) {
    issue(issues, 'target.makerRootId', 'missing_target_maker', 'Target Maker root is required.');
  }
  if (!SAFE_KEY.test(packageValue.target.profileId)) {
    issue(issues, 'target.profileId', 'missing_target_profile', 'Target compatibility Profile is required.');
  }
  if (!SAFE_KEY.test(packageValue.target.partId)) {
    issue(issues, 'target.partId', 'missing_target_part', 'Target Part slot is required.');
  }
  if (!HASH_32.test(packageValue.target.compatibilityHash)) {
    issue(issues, 'target.compatibilityHash', 'missing_compatibility_hash', 'The exact target compatibility commitment is required.');
  }
  if (!SAFE_KEY.test(packageValue.family.id)) {
    issue(issues, 'family.id', 'invalid_item_family_id', 'Independent supply requires one Item Family ID.');
  }
  if (!packageValue.family.name) {
    issue(issues, 'family.name', 'missing_item_family_name', 'Independent supply requires an Item Family name.');
  }
  if (packageValue.family.targetPartId !== packageValue.target.partId) {
    issue(issues, 'family.targetPartId', 'family_target_mismatch', 'Item Family must target the declared Part slot.');
  }
  if (object(raw.product || raw.styleProduct).baseSource) {
    issue(issues, 'product.baseSource', 'maker_local_source_forbidden', 'Independent Style packages cannot depend on a Maker-local Style record.');
  }
  if (packageValue.product.exactPng.assetId) {
    issue(issues, 'product.exactPng.assetId', 'maker_local_asset_forbidden', 'Independent Style packages must reference an exact Walrus PNG, not a Maker-local Asset ID.');
  }
  if (!packageValue.product.exactPng.blobId) {
    issue(issues, 'product.exactPng.blobId', 'supplier_png_blob_required', 'Independent supply requires the exact PNG Walrus Blob ID.');
  }
  if (!HASH_32.test(packageValue.product.exactPng.contentHash)) {
    issue(issues, 'product.exactPng.contentHash', 'supplier_png_hash_required', 'Independent supply requires the exact PNG SHA-256 hash.');
  }
  if (!HASH_32.test(packageValue.product.rights.manifestHash)) {
    issue(issues, 'product.rights.manifestHash', 'supplier_rights_hash_required', 'Independent supply requires an exact rights snapshot hash.');
  }
  if (packageValue.product.admissionClass === STYLE_PRODUCT_ADMISSION_CLASSES.OFFICIAL) {
    issue(issues, 'product.admissionClass', 'official_supplier_forbidden', 'Independent suppliers must use Certified or Open admission. Official is reserved for the Maker creator.');
  }
  collectStyleProductV7Issues({
    ...packageValue.product,
    ...object(raw.product || raw.styleProduct),
    familyId: packageValue.product.familyId,
    targetMakerRootId: packageValue.product.targetMakerRootId,
    targetProfileId: packageValue.product.targetProfileId,
    targetPartId: packageValue.product.targetPartId,
    baseSource: null,
  }, {
    publish,
    target: {
      makerRootId: packageValue.target.makerRootId,
      profileId: packageValue.target.profileId,
    },
    family: packageValue.family,
  }).forEach((entry) => issue(issues, `product.${entry.path}`, entry.code, entry.message));
  return issues;
}

export function inspectThirdPartyStyleProductPackageV7(value, { publish = false } = {}) {
  let raw = value;
  try {
    if (typeof value === 'string') raw = JSON.parse(value);
  } catch (error) {
    return {
      valid: false,
      package: null,
      issues: [{ path: '$', code: 'invalid_json', message: 'Third-party Style package JSON could not be parsed.' }],
      error,
    };
  }
  const packageValue = createThirdPartyStyleProductPackageV7(raw);
  const issues = collectThirdPartyStyleProductPackageV7Issues(raw, { publish });
  return { valid: issues.length === 0, package: packageValue, issues };
}

export function collectStyleProductV7Issues(value, {
  publish = false,
  target = null,
  family = null,
} = {}) {
  const raw = object(value);
  const product = createStyleProductV7(raw);
  const issues = [];
  if (!SAFE_KEY.test(product.id)) issue(issues, 'id', 'invalid_style_product_id', 'Style Product ID is required.');
  if (!SAFE_KEY.test(product.v6ProductId)) issue(issues, 'v6ProductId', 'invalid_v6_product_id', 'Style Product must bind one admitted v6 Item Product.');
  if (!SAFE_KEY.test(product.familyId)) issue(issues, 'familyId', 'invalid_family_id', 'Style Product must belong to one Item Family.');
  if (!SAFE_KEY.test(product.targetPartId)) issue(issues, 'targetPartId', 'invalid_target_part', 'Style Product must target one exact Part slot.');
  if (target?.makerRootId && product.targetMakerRootId !== target.makerRootId) {
    issue(issues, 'targetMakerRootId', 'maker_target_mismatch', 'Style Product targets a different Maker.');
  }
  if (target?.profileId && product.targetProfileId !== target.profileId) {
    issue(issues, 'targetProfileId', 'profile_target_mismatch', 'Style Product targets a different compatibility Profile.');
  }
  if (family && (
    product.familyId !== family.id
    || product.targetPartId !== family.targetPartId
  )) issue(issues, 'familyId', 'family_target_mismatch', 'Style Product must use its Item Family and Part.');
  if (!product.name) issue(issues, 'name', 'missing_style_product_name', 'Style Product name is required.');
  if (utf8Length(product.name) > 128) issue(issues, 'name', 'style_product_name_too_large', 'Style Product name is too large.');
  if (utf8Length(product.description) > MAX_TEXT_BYTES) issue(issues, 'description', 'style_product_description_too_large', 'Style Product description is too large.');
  if (product.exactPng.mediaType !== 'image/png') issue(issues, 'exactPng.mediaType', 'png_required', 'Each Style Product must own one exact PNG.');
  if (!product.exactPng.assetId && !product.exactPng.blobId) issue(issues, 'exactPng', 'missing_exact_png', 'Each Style Product requires one exact source PNG.');
  if (!product.exactPng.width || !product.exactPng.height) issue(issues, 'exactPng', 'missing_png_dimensions', 'Exact source PNG dimensions are required.');
  if (publish && !product.exactPng.blobId) issue(issues, 'exactPng.blobId', 'missing_png_blob', 'Published Style Product requires a Walrus PNG Blob ID.');
  if (publish && !HASH_32.test(product.exactPng.contentHash)) issue(issues, 'exactPng.contentHash', 'missing_png_hash', 'Published Style Product requires an exact PNG hash.');
  if (!product.placement.layerTrackId) issue(issues, 'placement.layerTrackId', 'missing_layer_track', 'Style Product needs one exact Layer Track placement.');
  if (!(product.placement.scale > 0)) issue(issues, 'placement.scale', 'invalid_scale', 'Style Product scale must be positive.');
  if (product.placement.opacity < 0 || product.placement.opacity > 1) issue(issues, 'placement.opacity', 'invalid_opacity', 'Style Product opacity must be between 0 and 1.');
  if (product.supply.mode === STYLE_PRODUCT_SUPPLY_MODES.INCLUDED && product.commerce.priceAtomic !== 0) {
    issue(issues, 'commerce.priceAtomic', 'included_product_must_be_free', 'Included Style Product cannot charge a purchase price.');
  }
  if (product.supply.mode === STYLE_PRODUCT_SUPPLY_MODES.LIMITED_EDITION) {
    if (!product.supply.cap) issue(issues, 'supply.cap', 'limited_supply_cap_required', 'Limited Edition requires a positive supply cap.');
    if (product.supply.cap && product.supply.minted > product.supply.cap) issue(issues, 'supply.minted', 'minted_exceeds_cap', 'Minted supply exceeds the Style Product cap.');
  }
  if (product.commerce.protocolFeeBps + product.commerce.makerEcosystemFeeBps > MAX_BPS) {
    issue(issues, 'commerce', 'primary_split_exceeds_total', 'Protocol and Maker ecosystem fees cannot exceed 100%.');
  }
  if (publish && !SUI_ADDRESS.test(product.creator)) issue(issues, 'creator', 'invalid_style_creator', 'Published Style Product requires a Sui creator address.');
  if (publish && !SUI_ADDRESS.test(product.publisher)) issue(issues, 'publisher', 'invalid_style_publisher', 'Published Style Product requires a Sui publisher address.');
  if (publish && (!product.validation.passed || !product.validation.attestationId)) {
    issue(issues, 'validation', 'technical_validation_required', 'Official, Certified and Open Style Products all require technical validation.');
  }
  if (publish && product.admissionClass === STYLE_PRODUCT_ADMISSION_CLASSES.CERTIFIED && !product.certification?.certifier) {
    issue(issues, 'certification', 'maker_certification_required', 'Certified Style Product requires Maker certification.');
  }
  if (publish && !HASH_32.test(product.rights.manifestHash)) issue(issues, 'rights.manifestHash', 'rights_snapshot_required', 'Published Style Product requires a rights snapshot hash.');
  findForbiddenColorFields(raw).forEach((path) => {
    issue(issues, path, 'smart_color_not_assetized', 'Smart Color is not part of a v7 Style Product. Publish each exact colorway as a separate Style Product.');
  });
  return issues;
}

export function collectPhysicalStyleCatalogV7Issues(value, { publish = false } = {}) {
  const catalog = createPhysicalStyleCatalogV7(value);
  const rawFamilies = array(object(value).families);
  const issues = [];
  if (!catalog.enabled && publish) issue(issues, 'enabled', 'physical_catalog_disabled', 'Physical Style catalog is not enabled for publication.');
  if (!SAFE_KEY.test(catalog.target.makerRootId)) issue(issues, 'target.makerRootId', 'missing_target_maker', 'Target Maker root is required.');
  if (!SAFE_KEY.test(catalog.target.profileId)) issue(issues, 'target.profileId', 'missing_target_profile', 'Target compatibility Profile is required.');
  if (publish && !HASH_32.test(catalog.target.compatibilityHash)) issue(issues, 'target.compatibilityHash', 'missing_compatibility_hash', 'Publication requires the exact compatibility commitment.');
  const familyIds = new Set();
  const productIds = new Set();
  const v6ProductIds = new Set();
  catalog.families.forEach((family, familyIndex) => {
    const prefix = `families[${familyIndex}]`;
    if (!SAFE_KEY.test(family.id)) issue(issues, `${prefix}.id`, 'invalid_item_family_id', 'Item Family ID is required.');
    if (familyIds.has(family.id)) issue(issues, `${prefix}.id`, 'duplicate_item_family_id', 'Item Family IDs must be unique.');
    familyIds.add(family.id);
    if (!SAFE_KEY.test(family.targetPartId)) issue(issues, `${prefix}.targetPartId`, 'invalid_target_part', 'Item Family must target one Part.');
    if (!family.name) issue(issues, `${prefix}.name`, 'missing_item_family_name', 'Item Family name is required.');
    if (!family.styles.length) issue(issues, `${prefix}.styles`, 'empty_item_family', 'Item Family must contain at least one exact Style Product.');
    family.styles.forEach((product, productIndex) => {
      if (productIds.has(product.id)) issue(issues, `${prefix}.styles[${productIndex}].id`, 'duplicate_style_product_id', 'Style Product IDs must be globally unique.');
      productIds.add(product.id);
      if (v6ProductIds.has(product.v6ProductId)) issue(issues, `${prefix}.styles[${productIndex}].v6ProductId`, 'duplicate_v6_product_id', 'Each exact Style Product must bind a different admitted v6 Item Product.');
      v6ProductIds.add(product.v6ProductId);
      const rawProduct = object(rawFamilies[familyIndex]?.styles?.[productIndex]);
      collectStyleProductV7Issues({
        ...product,
        ...rawProduct,
        familyId: product.familyId,
        targetMakerRootId: product.targetMakerRootId,
        targetProfileId: product.targetProfileId,
        targetPartId: product.targetPartId,
      }, {
        publish,
        target: catalog.target,
        family,
      }).forEach((entry) => issue(
        issues,
        `${prefix}.styles[${productIndex}].${entry.path}`,
        entry.code,
        entry.message,
      ));
      if (product.admissionClass === STYLE_PRODUCT_ADMISSION_CLASSES.CERTIFIED && !catalog.admission.certified) {
        issue(issues, `${prefix}.styles[${productIndex}].admissionClass`, 'certified_admission_disabled', 'This Maker does not accept Certified third-party Style Products.');
      }
      if (product.admissionClass === STYLE_PRODUCT_ADMISSION_CLASSES.OPEN && !catalog.admission.open) {
        issue(issues, `${prefix}.styles[${productIndex}].admissionClass`, 'open_admission_disabled', 'This Maker does not accept Open validated Style Products.');
      }
    });
  });
  return issues;
}

/** Canonical bytes for Walrus + future Sui commitments. Transport URLs and live counters are excluded. */
export function createPhysicalStyleCatalogPublicationV7(value) {
  const catalog = createPhysicalStyleCatalogV7(value);
  const issues = collectPhysicalStyleCatalogV7Issues(catalog, { publish: true });
  if (issues.length) {
    const error = new Error('Physical Style catalog is not publishable.');
    error.code = 'PHYSICAL_STYLE_CATALOG_V7_INVALID';
    error.issues = issues;
    throw error;
  }
  return stableValue({
    schemaVersion: PHYSICAL_STYLE_CATALOG_V7_SCHEMA,
    target: catalog.target,
    admission: catalog.admission,
    partPolicies: catalog.partPolicies,
    families: catalog.families.map((family) => ({
      schemaVersion: ITEM_FAMILY_V7_SCHEMA,
      id: family.id,
      targetMakerRootId: family.targetMakerRootId,
      targetProfileId: family.targetProfileId,
      targetPartId: family.targetPartId,
      name: family.name,
      description: family.description,
      creator: family.creator,
      styles: family.styles.map((product) => ({
        schemaVersion: STYLE_PRODUCT_V7_SCHEMA,
        id: product.id,
        version: product.version,
        v6ProductId: product.v6ProductId,
        familyId: product.familyId,
        targetMakerRootId: product.targetMakerRootId,
        targetProfileId: product.targetProfileId,
        targetPartId: product.targetPartId,
        name: product.name,
        description: product.description,
        creator: product.creator,
        publisher: product.publisher,
        admissionClass: product.admissionClass,
        exactPng: { ...product.exactPng, assetId: '' },
        thumbnail: { ...product.thumbnail, assetId: '' },
        placement: product.placement,
        supply: { ...product.supply, minted: 0 },
        commerce: product.commerce,
        rights: product.rights,
        certification: product.certification,
        extensionsHash: product.extensionsHash,
      })),
    })),
    extensionsHash: catalog.extensionsHash,
  });
}

export async function hashPhysicalStyleCatalogPublicationV7(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(createPhysicalStyleCatalogPublicationV7(value)));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((entry) => entry.toString(16).padStart(2, '0')).join('');
}

export function createStyleAssetV7(value = {}) {
  const input = object(value);
  return {
    schemaVersion: STYLE_ASSET_V7_SCHEMA,
    id: string(input.id),
    productId: string(input.productId),
    kind: enumValue(input.kind, STYLE_ASSET_KINDS, STYLE_ASSET_KINDS.OWNED),
    ownerAddress: string(input.ownerAddress),
    soulId: string(input.soulId),
    wardrobeId: string(input.wardrobeId),
    equippedPartId: string(input.equippedPartId),
    serial: nonNegativeInteger(input.serial),
    rightsSnapshotHash: string(input.rightsSnapshotHash).replace(/^0x/i, '').toLowerCase(),
  };
}

function entitlementProductId(value) {
  return string(value?.productId || value?.styleProductId);
}

/**
 * Derive the player-facing Part -> Item Family -> concrete Style cards.
 * It performs no chain call and never upgrades preview state into ownership.
 */
export function derivePhysicalStylePlayerCatalogV7({
  catalog: catalogValue,
  entitlements = [],
  styleAssets = [],
  selectedProductIds = [],
  releaseEnabled = false,
  creatorPreview = false,
} = {}) {
  const catalog = createPhysicalStyleCatalogV7(catalogValue);
  const owned = new Set([
    ...array(entitlements).map(entitlementProductId),
    ...array(styleAssets).map(entitlementProductId),
  ].filter(Boolean));
  const selected = new Set(uniqueStrings(selectedProductIds));
  const partMap = new Map();
  catalog.families.forEach((family) => {
    const styleCards = family.styles.map((product) => {
      const included = product.supply.mode === STYLE_PRODUCT_SUPPLY_MODES.INCLUDED;
      const isOwned = owned.has(product.id);
      const soldOut = product.supply.mode === STYLE_PRODUCT_SUPPLY_MODES.LIMITED_EDITION
        && product.supply.cap !== null
        && product.supply.minted >= product.supply.cap;
      let state = STYLE_PRODUCT_PLAYER_STATES.UNAVAILABLE;
      if (included) state = STYLE_PRODUCT_PLAYER_STATES.INCLUDED;
      else if (isOwned) state = STYLE_PRODUCT_PLAYER_STATES.OWNED;
      else if (soldOut) state = STYLE_PRODUCT_PLAYER_STATES.SOLD_OUT;
      else if (releaseEnabled) state = STYLE_PRODUCT_PLAYER_STATES.FOR_SALE;
      const usable = included || isOwned || (creatorPreview && product.admissionClass === STYLE_PRODUCT_ADMISSION_CLASSES.OFFICIAL);
      return {
        product,
        productId: product.id,
        name: product.name,
        state,
        included,
        owned: isOwned,
        soldOut,
        selected: selected.has(product.id),
        canEquip: usable,
        canPurchase: state === STYLE_PRODUCT_PLAYER_STATES.FOR_SALE,
        action: usable ? 'equip' : state === STYLE_PRODUCT_PLAYER_STATES.FOR_SALE ? 'purchase' : 'none',
        releaseEnabled,
      };
    });
    const familyCard = { ...family, styles: styleCards };
    if (!partMap.has(family.targetPartId)) partMap.set(family.targetPartId, []);
    partMap.get(family.targetPartId).push(familyCard);
  });
  return [...partMap.entries()].map(([partId, families]) => ({
    partId,
    families: families.sort((left, right) => left.name.localeCompare(right.name)),
  })).sort((left, right) => left.partId.localeCompare(right.partId));
}

export function clonePhysicalStyleCatalogV7(value) {
  return clone(createPhysicalStyleCatalogV7(value));
}
