import {
  COMPOSABLE_PROFILE_MODES,
  ITEM_ORIGIN_CLASSES,
  THIRD_PARTY_ADMISSION_MODES,
  createComposableProfileV6,
} from './maker-composable-v6.js';
import {
  getMakerComposableV6Draft,
  normalizeMakerComposableV6Draft,
} from './maker-composable-v6-bridge.js';
import {
  createOfficialEmbeddedItemProductDraftV6,
  deriveMakerLocalCompatibilityV6,
} from './maker-composable-v6-workspace.js';
import {
  PHYSICAL_PART_BEHAVIORS,
  STYLE_PRODUCT_ADMISSION_CLASSES,
  STYLE_PRODUCT_SUPPLY_MODES,
  createPhysicalStyleCatalogV7,
} from './maker-physical-v7.js';
import {
  addMakerStyleProductV7,
  createPhysicalStyleCatalogV7DraftForDocument,
  getPhysicalStyleCatalogV7Draft,
  setPhysicalStyleCatalogV7Draft,
} from './maker-physical-v7-workspace.js';

export const MAKER_WARDROBE_V7_SCHEMA = 'animacraft.maker-wardrobe.v7';
export const MAKER_WARDROBE_V7_EXTENSION_KEY = 'wardrobeV7';
export const MAKER_WARDROBE_V7_PART_MODES = Object.freeze({
  FIXED: 'FIXED',
  SLOT: 'SLOT',
});

function array(value) {
  return Array.isArray(value) ? value : [];
}

function string(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
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

/**
 * Product attestations may survive a synchronization only when the complete
 * executable/product definition is unchanged. Validation/certification and
 * manifest locators are outputs of that definition, while `supply.minted` is
 * a live counter; everything else is definition identity and participates.
 */
function sourceSignature(product) {
  const semantic = clone(product && typeof product === 'object' ? product : {});
  delete semantic.validation;
  delete semantic.certification;
  delete semantic.manifestBlobId;
  delete semantic.manifestHash;
  if (semantic.supply && typeof semantic.supply === 'object') {
    semantic.supply = { ...semantic.supply };
    delete semantic.supply.minted;
  }
  return JSON.stringify(stableValue(semantic));
}

function wardrobeSynchronizationSignature(document) {
  const composable = clone(document?.extensions?.composableV6 || null);
  if (composable && typeof composable === 'object') {
    composable.compatibilitySealed = false;
  }
  return JSON.stringify(stableValue({
    wardrobeV7: clone(document?.extensions?.[MAKER_WARDROBE_V7_EXTENSION_KEY] || null),
    composableV6: composable,
    physicalStyleCatalogV7: clone(document?.extensions?.physicalStyleCatalogV7 || null),
  }));
}

function usesOfficialProductNamespace(value) {
  return string(value).toLowerCase().startsWith('official:');
}

function uniqueMakerItemProducts(products, issues) {
  const seen = new Set();
  const result = [];
  array(products).forEach((product, index) => {
    const productId = string(product?.id);
    const path = `extensions.composableV6.items.${index}.id`;
    if (
      product?.originClass !== ITEM_ORIGIN_CLASSES.OFFICIAL
      && usesOfficialProductNamespace(productId)
    ) {
      issues.push(issue(path, 'wardrobe_reserved_official_product_id', 'A non-Official Item Product cannot use the reserved official:* identity namespace.'));
      return;
    }
    if (seen.has(productId)) {
      issues.push(issue(path, 'wardrobe_duplicate_item_product_id', `Duplicate Item Product ID ${productId || '(empty)'} was removed during wardrobe synchronization.`));
      return;
    }
    seen.add(productId);
    result.push(product);
  });
  return result;
}

function officialStyleProductId(entry) {
  return `style-product:${entry.part.id}:${entry.item.id}:${entry.style.id}:v1`;
}

function officialV6ProductId(entry) {
  return `official:${entry.part.id}:${entry.item.id}:${entry.style.id}:v1`;
}

function sanitizeThirdPartyStyleFamilies(
  families,
  issues,
  { officialProductIds = new Set(), officialV6ProductIds = new Set() } = {},
) {
  const seenProductIds = new Set();
  const seenV6ProductIds = new Set();
  return array(families).map((family, familyIndex) => ({
    ...clone(family),
    styles: array(family?.styles).filter((product, productIndex) => {
      if (product?.admissionClass === STYLE_PRODUCT_ADMISSION_CLASSES.OFFICIAL) return false;
      const productId = string(product?.id);
      const v6ProductId = string(product?.v6ProductId);
      const path = `extensions.physicalStyleCatalogV7.families.${familyIndex}.styles.${productIndex}`;
      if (usesOfficialProductNamespace(productId) || usesOfficialProductNamespace(v6ProductId)) {
        issues.push(issue(`${path}.id`, 'wardrobe_reserved_official_product_id', 'A non-Official Style Product cannot use or bind the reserved official:* identity namespace.'));
        return false;
      }
      if (officialProductIds.has(productId) || officialV6ProductIds.has(v6ProductId)) {
        issues.push(issue(`${path}.id`, 'wardrobe_official_product_id_collision', 'A third-party Style Product cannot occupy an identity generated for an Official Maker Style.'));
        return false;
      }
      if (seenProductIds.has(productId)) {
        issues.push(issue(`${path}.id`, 'wardrobe_duplicate_style_product_id', `Duplicate Style Product ID ${productId || '(empty)'} was removed during wardrobe synchronization.`));
        return false;
      }
      if (seenV6ProductIds.has(v6ProductId)) {
        issues.push(issue(`${path}.v6ProductId`, 'wardrobe_duplicate_v6_product_id', `Duplicate v6 Product identity ${v6ProductId || '(empty)'} was removed during wardrobe synchronization.`));
        return false;
      }
      seenProductIds.add(productId);
      seenV6ProductIds.add(v6ProductId);
      return true;
    }),
  })).filter((family) => family.styles.length);
}

function enforceUniqueCatalogProductIds(catalog, issues) {
  const rows = array(catalog?.families).flatMap((family, familyIndex) => (
    array(family?.styles).map((product, productIndex) => ({
      familyIndex,
      productIndex,
      product,
      official: product?.admissionClass === STYLE_PRODUCT_ADMISSION_CLASSES.OFFICIAL,
    }))
  ));
  // Official Maker-generated identities always win over a conflicting
  // third-party row, independent of its earlier persisted array position.
  const ranked = [...rows].sort((left, right) => (
    Number(right.official) - Number(left.official)
    || left.familyIndex - right.familyIndex
    || left.productIndex - right.productIndex
  ));
  const accepted = new Set();
  const productIds = new Set();
  const v6ProductIds = new Set();
  ranked.forEach((row) => {
    const productId = string(row.product?.id);
    const v6ProductId = string(row.product?.v6ProductId);
    const token = `${row.familyIndex}:${row.productIndex}`;
    const path = `extensions.physicalStyleCatalogV7.families.${row.familyIndex}.styles.${row.productIndex}`;
    if (!row.official && (usesOfficialProductNamespace(productId) || usesOfficialProductNamespace(v6ProductId))) {
      issues.push(issue(`${path}.id`, 'wardrobe_reserved_official_product_id', 'A non-Official Style Product cannot use or bind the reserved official:* identity namespace.'));
      return;
    }
    if (productIds.has(productId)) {
      issues.push(issue(`${path}.id`, 'wardrobe_duplicate_style_product_id', `Duplicate Style Product ID ${productId || '(empty)'} was removed during wardrobe synchronization.`));
      return;
    }
    if (v6ProductIds.has(v6ProductId)) {
      issues.push(issue(`${path}.v6ProductId`, 'wardrobe_duplicate_v6_product_id', `Duplicate v6 Product identity ${v6ProductId || '(empty)'} was removed during wardrobe synchronization.`));
      return;
    }
    productIds.add(productId);
    v6ProductIds.add(v6ProductId);
    accepted.add(token);
  });
  return {
    ...catalog,
    families: array(catalog?.families).map((family, familyIndex) => ({
      ...family,
      styles: array(family?.styles).filter((_, productIndex) => (
        accepted.has(`${familyIndex}:${productIndex}`)
      )),
    })).filter((family) => family.styles.length),
  };
}

function styleEntries(document, slotPartIds = null) {
  return array(document?.parts)
    .filter((part) => slotPartIds === null || slotPartIds.has(string(part?.id)))
    .flatMap((part) => array(part?.items).flatMap((item) => (
    array(item?.styles).map((style) => ({ part, item, style }))
  )));
}

function issue(path, code, message) {
  return { path, code, message };
}

function stylePath(entry) {
  return `parts.${entry.part.id}.items.${entry.item.id}.styles.${entry.style.id}`;
}

function runtimeAsset(document, assetId, resolveAsset) {
  const descriptor = array(document?.assets).find((candidate) => candidate?.id === assetId) || {};
  const runtime = typeof resolveAsset === 'function' ? resolveAsset(assetId) || {} : {};
  return {
    ...descriptor,
    ...runtime,
    assetId,
    assetBlobId: descriptor.assetBlobId || descriptor.blobId || runtime.assetBlobId || runtime.blobId || '',
    assetHash: descriptor.assetHash || descriptor.contentHash || runtime.assetHash || runtime.contentHash || '',
    width: Number(runtime.width || descriptor.width || 0),
    height: Number(runtime.height || descriptor.height || 0),
  };
}

function defaultProductIds(document, products) {
  const exact = new Map(products.map((product) => {
    const source = product.components?.[0]?.baseSource;
    return [`${source?.partId || ''}\u0000${source?.itemId || ''}\u0000${source?.styleId || ''}`, product];
  }));
  const bySlot = new Map();
  products.forEach((product) => {
    const slotId = product.slotClaims?.[0]?.slotId;
    if (slotId && !bySlot.has(slotId)) bySlot.set(slotId, product);
  });
  const chosen = [];
  const selectedSlots = new Set();
  array(document?.defaultRecipe?.selections).forEach((selection) => {
    const product = exact.get(`${selection.partId}\u0000${selection.itemId}\u0000${selection.styleId}`);
    if (!product || selectedSlots.has(selection.partId)) return;
    selectedSlots.add(selection.partId);
    chosen.push(product.id);
  });
  array(document?.parts).forEach((part) => {
    if (selectedSlots.has(part.id)) return;
    const product = bySlot.get(part.id);
    if (!product) return;
    selectedSlots.add(part.id);
    chosen.push(product.id);
  });
  return chosen;
}

export function makerWardrobeV7Enabled(document) {
  return getMakerComposableV6Draft(document)?.profile?.mode
    === COMPOSABLE_PROFILE_MODES.COMPOSABLE;
}

function normalizedPartModes(document) {
  const stored = document?.extensions?.[MAKER_WARDROBE_V7_EXTENSION_KEY]?.partModes;
  const source = stored && typeof stored === 'object' && !Array.isArray(stored)
    ? stored
    : {};
  return Object.fromEntries(array(document?.parts).map((part) => [
    string(part?.id),
    source[part?.id] === MAKER_WARDROBE_V7_PART_MODES.SLOT
      ? MAKER_WARDROBE_V7_PART_MODES.SLOT
      : MAKER_WARDROBE_V7_PART_MODES.FIXED,
  ]).filter(([partId]) => partId));
}

/**
 * Return the persisted creator policy. Old documents and newly-created Parts
 * have no entry and therefore normalize to FIXED. When the Maker-wide switch
 * is off the effective policy is always FIXED, while the creator's explicit
 * choices remain available for a reversible re-enable.
 */
export function makerWardrobeV7PartModes(document, { effective = true } = {}) {
  const modes = normalizedPartModes(document);
  if (!effective || makerWardrobeV7Enabled(document)) return modes;
  return Object.fromEntries(Object.keys(modes).map((partId) => [
    partId,
    MAKER_WARDROBE_V7_PART_MODES.FIXED,
  ]));
}

export function makerWardrobeV7PartMode(document, partId, options = {}) {
  return makerWardrobeV7PartModes(document, options)[string(partId)]
    || MAKER_WARDROBE_V7_PART_MODES.FIXED;
}

function persistPartModes(document, partModes) {
  document.extensions ||= {};
  document.extensions[MAKER_WARDROBE_V7_EXTENSION_KEY] = {
    schemaVersion: MAKER_WARDROBE_V7_SCHEMA,
    partModes: Object.fromEntries(array(document.parts).map((part) => [
      part.id,
      partModes?.[part.id] === MAKER_WARDROBE_V7_PART_MODES.SLOT
        ? MAKER_WARDROBE_V7_PART_MODES.SLOT
        : MAKER_WARDROBE_V7_PART_MODES.FIXED,
    ])),
  };
}

export function makerWardrobeV7Summary(document) {
  const draft = getMakerComposableV6Draft(document);
  const catalog = getPhysicalStyleCatalogV7Draft(document);
  const partModes = makerWardrobeV7PartModes(document);
  return {
    schemaVersion: MAKER_WARDROBE_V7_SCHEMA,
    enabled: draft?.profile?.mode === COMPOSABLE_PROFILE_MODES.COMPOSABLE,
    fixedPartCount: Object.values(partModes)
      .filter((mode) => mode === MAKER_WARDROBE_V7_PART_MODES.FIXED).length,
    configuredSlotCount: Object.values(partModes)
      .filter((mode) => mode === MAKER_WARDROBE_V7_PART_MODES.SLOT).length,
    slotCount: array(draft?.compatibility?.slots).length,
    itemProductCount: array(draft?.items).length,
    styleProductCount: array(catalog?.families)
      .reduce((sum, family) => sum + array(family?.styles).length, 0),
    openToValidatedThirdPartyItems: draft?.profile?.thirdPartyAdmission
      === THIRD_PARTY_ADMISSION_MODES.OPEN,
  };
}

export function synchronizeMakerWardrobeV7(document, {
  makerRootId = '',
  profileId = '',
  creator = '',
  rendererVersion = 'animacraft.shared-renderer.v5',
  resolveAsset = null,
} = {}) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new TypeError('A Maker document is required.');
  }
  const current = getMakerComposableV6Draft(document);
  if (!current || current.profile.mode !== COMPOSABLE_PROFILE_MODES.COMPOSABLE) {
    return { document, issues: [], summary: makerWardrobeV7Summary(document) };
  }
  if (current.compatibilitySealed) {
    const candidate = clone(document);
    candidate.extensions ||= {};
    candidate.extensions.composableV6 = normalizeMakerComposableV6Draft({
      ...current,
      compatibilitySealed: false,
    });
    const synchronized = synchronizeMakerWardrobeV7(candidate, {
      makerRootId,
      profileId,
      creator,
      rendererVersion,
      resolveAsset,
    });
    if (
      synchronized.issues.length === 0
      && wardrobeSynchronizationSignature(candidate)
        === wardrobeSynchronizationSignature(document)
    ) {
      return {
        document,
        issues: [],
        summary: makerWardrobeV7Summary(document),
      };
    }
    return {
      document,
      issues: [issue('extensions.composableV6.compatibilitySealed', 'wardrobe_compatibility_locked', 'Start a new Maker version before changing a locked wardrobe.')],
      summary: makerWardrobeV7Summary(document),
    };
  }

  const rootId = string(makerRootId)
    || string(current.compatibility?.makerRootId)
    || string(document?.version?.rootMakerId);
  const actor = string(creator) || string(document?.metadata?.creator);
  const partModes = makerWardrobeV7PartModes(document, { effective: false });
  persistPartModes(document, partModes);
  const slotPartIds = new Set(Object.entries(partModes)
    .filter(([, mode]) => mode === MAKER_WARDROBE_V7_PART_MODES.SLOT)
    .map(([partId]) => partId));
  const initialCompatibility = deriveMakerLocalCompatibilityV6(document, {
    makerRootId: rootId,
    rendererVersion,
    slotPartIds: [...slotPartIds],
  });
  const issues = [];
  if (slotPartIds.size === 0) {
    issues.push(issue(
      `extensions.${MAKER_WARDROBE_V7_EXTENSION_KEY}.partModes`,
      'wardrobe_slot_required',
      'Choose at least one Part as a wardrobe Slot before publication.',
    ));
  }
  const oldV6ById = new Map(array(current.items)
    .filter((product) => product.originClass === ITEM_ORIGIN_CLASSES.OFFICIAL)
    .map((product) => [product.id, product]));
  const thirdPartyProducts = array(current.items)
    .filter((product) => (
      product.originClass !== ITEM_ORIGIN_CLASSES.OFFICIAL
      && array(product.slotClaims).length > 0
      && array(product.slotClaims).every((claim) => slotPartIds.has(string(claim?.slotId)))
    ))
    .map(clone);
  const officialProducts = [];
  const eligibleEntries = [];

  styleEntries(document, slotPartIds).forEach((entry) => {
    const path = stylePath(entry);
    if (!entry.style.assetId) {
      issues.push(issue(`${path}.assetId`, 'wardrobe_style_png_required', 'Upload a PNG before this Style can become an equippable asset.'));
      return;
    }
    if (string(entry.style.colorChannelId)) {
      issues.push(issue(`${path}.colorChannelId`, 'wardrobe_smart_color_bake_required', 'Bake this Smart Color result into a fixed PNG Style before assetizing it.'));
      return;
    }
    const asset = runtimeAsset(document, entry.style.assetId, resolveAsset);
    if (!asset.width || !asset.height) {
      issues.push(issue(`${path}.assetId`, 'wardrobe_png_dimensions_required', 'The source PNG width and height must be available before assetizing this Style.'));
      return;
    }
    try {
      const fresh = createOfficialEmbeddedItemProductDraftV6({
        document,
        compatibility: initialCompatibility,
        partId: entry.part.id,
        itemId: entry.item.id,
        styleId: entry.style.id,
        asset,
        creator: actor,
        publisher: actor,
      });
      const previous = oldV6ById.get(fresh.id);
      officialProducts.push(previous && sourceSignature(previous) === sourceSignature(fresh)
        ? clone(previous)
        : fresh);
      eligibleEntries.push(entry);
    } catch (error) {
      issues.push(issue(path, error?.code || 'wardrobe_item_product_failed', error?.message || 'This Style could not become an Item Product.'));
    }
  });

  const fallbackProductIds = defaultProductIds(document, officialProducts);
  const compatibility = deriveMakerLocalCompatibilityV6(document, {
    makerRootId: rootId,
    rendererVersion,
    fallbackProductIds,
    slotPartIds: [...slotPartIds],
  });
  array(compatibility.slots).filter((slot) => slot.required === true).forEach((slot) => {
    const hasFallback = officialProducts.some((product) => (
      fallbackProductIds.includes(product.id)
      && array(product.slotClaims).some((claim) => claim.slotId === slot.id)
    ));
    if (!hasFallback) {
      issues.push(issue(
        `extensions.${MAKER_WARDROBE_V7_EXTENSION_KEY}.partModes.${slot.id}`,
        'wardrobe_required_slot_fallback_required',
        'A required wardrobe Slot needs one valid included fallback Style.',
      ));
    }
  });
  const items = uniqueMakerItemProducts(
    [...officialProducts, ...thirdPartyProducts],
    issues,
  ).map((product) => ({
    ...product,
    makerRootId: compatibility.makerRootId,
    compatibilityHash: compatibility.manifestHash,
  }));
  document.extensions ||= {};
  document.extensions.composableV6 = normalizeMakerComposableV6Draft({
    ...current,
    profile: createComposableProfileV6({
      ...current.profile,
      mode: COMPOSABLE_PROFILE_MODES.COMPOSABLE,
      thirdPartyAdmission: THIRD_PARTY_ADMISSION_MODES.OPEN,
      itemAssetization: true,
    }),
    compatibility,
    compatibilitySealed: false,
    items,
  });

  const previousCatalog = getPhysicalStyleCatalogV7Draft(document);
  let catalog = createPhysicalStyleCatalogV7DraftForDocument(document, {
    makerRootId: rootId,
    profileId: string(profileId) || string(previousCatalog?.target?.profileId) || `profile:${rootId}:v7`,
    compatibilityHash: compatibility.manifestHash,
    certified: true,
    open: true,
  });
  catalog.partPolicies = array(document.parts).map((part) => ({
    partId: part.id,
    behavior: slotPartIds.has(part.id)
      ? PHYSICAL_PART_BEHAVIORS.HYBRID
      : PHYSICAL_PART_BEHAVIORS.FIXED,
    required: part.required === true,
    maxSourceKind: slotPartIds.has(part.id)
      ? STYLE_PRODUCT_ADMISSION_CLASSES.OPEN
      : STYLE_PRODUCT_ADMISSION_CLASSES.OFFICIAL,
  }));
  const officialProductIds = new Set(eligibleEntries.map(officialStyleProductId));
  const officialV6ProductIds = new Set(eligibleEntries.map(officialV6ProductId));
  catalog.families = sanitizeThirdPartyStyleFamilies(
    array(previousCatalog?.families).filter((family) => slotPartIds.has(string(family?.targetPartId))),
    issues,
    { officialProductIds, officialV6ProductIds },
  );
  const previousStyleProducts = new Map(array(previousCatalog?.families)
    .flatMap((family) => array(family.styles))
    .filter((product) => product.admissionClass === STYLE_PRODUCT_ADMISSION_CLASSES.OFFICIAL)
    .map((product) => [product.id, product]));
  eligibleEntries.forEach((entry) => {
    const asset = runtimeAsset(document, entry.style.assetId, resolveAsset);
    const added = addMakerStyleProductV7(catalog, {
      document,
      partId: entry.part.id,
      itemId: entry.item.id,
      styleId: entry.style.id,
      asset,
      creator: actor,
      publisher: actor,
      admissionClass: STYLE_PRODUCT_ADMISSION_CLASSES.OFFICIAL,
      supplyMode: STYLE_PRODUCT_SUPPLY_MODES.INCLUDED,
    });
    catalog = added.catalog;
    const previous = previousStyleProducts.get(added.productId);
    if (!previous) return;
    const family = catalog.families.find((candidate) => candidate.id === added.familyId);
    const index = family?.styles.findIndex((product) => product.id === added.productId) ?? -1;
    if (!family || index < 0) return;
    const fresh = family.styles[index];
    family.styles[index] = {
      ...fresh,
      creator: previous.creator || fresh.creator,
      publisher: previous.publisher || fresh.publisher,
      supply: clone(previous.supply),
      commerce: clone(previous.commerce),
      rights: clone(previous.rights),
      ...(sourceSignature(previous) === sourceSignature(fresh) ? {
        validation: clone(previous.validation),
        certification: clone(previous.certification),
        manifestBlobId: previous.manifestBlobId,
        manifestHash: previous.manifestHash,
      } : {}),
    };
  });
  catalog = enforceUniqueCatalogProductIds(catalog, issues);
  setPhysicalStyleCatalogV7Draft(document, createPhysicalStyleCatalogV7(catalog));
  return { document, issues, summary: makerWardrobeV7Summary(document) };
}

export function makerWardrobeV7ReleaseSourceIdentity(document, {
  makerRootId = '',
  profileId = '',
  creator = '',
  rendererVersion = 'animacraft.shared-renderer.v5',
} = {}) {
  return JSON.stringify(stableValue({
    document: clone(document),
    context: {
      makerRootId: string(makerRootId),
      profileId: string(profileId),
      creator: string(creator),
      rendererVersion: string(rendererVersion),
    },
  }));
}

/**
 * Build one detached publication document. Wardrobe derivation happens only
 * on this clone, and its exact v6 compatibility contract is sealed before any
 * v4, v6 or v7 publisher receives it.
 */
export function createMakerWardrobeV7ReleaseSnapshot(document, options = {}) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new TypeError('A Maker document is required.');
  }
  const sourceIdentity = makerWardrobeV7ReleaseSourceIdentity(document, options);
  const snapshot = clone(document);
  const synchronized = makerWardrobeV7Enabled(snapshot)
    ? synchronizeMakerWardrobeV7(snapshot, options)
    : { document: snapshot, issues: [], summary: makerWardrobeV7Summary(snapshot) };
  if (synchronized.issues.length === 0 && makerWardrobeV7Enabled(snapshot)) {
    const draft = getMakerComposableV6Draft(snapshot);
    snapshot.extensions ||= {};
    snapshot.extensions.composableV6 = normalizeMakerComposableV6Draft({
      ...draft,
      compatibilitySealed: true,
    });
  }
  return {
    document: snapshot,
    sourceIdentity,
    issues: synchronized.issues,
    summary: makerWardrobeV7Summary(snapshot),
  };
}

export function setMakerWardrobeV7Enabled(document, enabled, options = {}) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new TypeError('A Maker document is required.');
  }
  const current = getMakerComposableV6Draft(document);
  if (current?.compatibilitySealed && makerWardrobeV7Enabled(document) !== (enabled === true)) {
    const error = new Error('Start a new Maker version before changing a locked wardrobe.');
    error.code = 'MAKER_WARDROBE_V7_LOCKED';
    throw error;
  }
  const rootId = string(options.makerRootId)
    || string(current?.compatibility?.makerRootId)
    || string(document?.version?.rootMakerId);
  const compatibility = current?.compatibility || deriveMakerLocalCompatibilityV6(document, {
    makerRootId: rootId,
    rendererVersion: options.rendererVersion || 'animacraft.shared-renderer.v5',
  });
  document.extensions ||= {};
  document.extensions.composableV6 = normalizeMakerComposableV6Draft({
    ...(current || {}),
    profile: createComposableProfileV6({
      ...(current?.profile || {}),
      mode: enabled ? COMPOSABLE_PROFILE_MODES.COMPOSABLE : COMPOSABLE_PROFILE_MODES.FIXED,
      thirdPartyAdmission: enabled
        ? THIRD_PARTY_ADMISSION_MODES.OPEN
        : THIRD_PARTY_ADMISSION_MODES.DISABLED,
      itemAssetization: enabled === true,
    }),
    compatibility,
    compatibilitySealed: false,
    items: array(current?.items),
  });
  if (!enabled) {
    const catalog = getPhysicalStyleCatalogV7Draft(document);
    if (catalog) setPhysicalStyleCatalogV7Draft(document, {
      ...catalog,
      enabled: false,
      admission: { certified: false, open: false },
      partPolicies: array(document.parts).map((part) => ({
        partId: part.id,
        behavior: PHYSICAL_PART_BEHAVIORS.FIXED,
        required: part.required === true,
        maxSourceKind: STYLE_PRODUCT_ADMISSION_CLASSES.OFFICIAL,
      })),
    });
    return { document, issues: [], summary: makerWardrobeV7Summary(document) };
  }
  return synchronizeMakerWardrobeV7(document, options);
}

export function setMakerWardrobeV7PartMode(document, partId, mode, options = {}) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new TypeError('A Maker document is required.');
  }
  const normalizedPartId = string(partId);
  if (!array(document.parts).some((part) => part?.id === normalizedPartId)) {
    const error = new Error('Choose an existing Maker Part.');
    error.code = 'MAKER_WARDROBE_V7_PART_REQUIRED';
    throw error;
  }
  if (!Object.values(MAKER_WARDROBE_V7_PART_MODES).includes(mode)) {
    const error = new Error('Wardrobe Part mode must be FIXED or SLOT.');
    error.code = 'MAKER_WARDROBE_V7_PART_MODE_INVALID';
    throw error;
  }
  const current = getMakerComposableV6Draft(document);
  if (current?.compatibilitySealed) {
    const error = new Error('Start a new Maker version before changing a locked wardrobe.');
    error.code = 'MAKER_WARDROBE_V7_LOCKED';
    throw error;
  }
  const partModes = makerWardrobeV7PartModes(document, { effective: false });
  partModes[normalizedPartId] = mode;
  persistPartModes(document, partModes);
  if (!makerWardrobeV7Enabled(document)) {
    return { document, issues: [], summary: makerWardrobeV7Summary(document) };
  }
  return synchronizeMakerWardrobeV7(document, options);
}
