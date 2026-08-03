import {
  PHYSICAL_STYLE_CATALOG_V7_EXTENSION_KEY,
  THIRD_PARTY_STYLE_PRODUCT_PACKAGE_V7_SCHEMA,
  STYLE_PRODUCT_ADMISSION_CLASSES,
  STYLE_PRODUCT_RIGHTS_ORIGINS,
  STYLE_PRODUCT_SUPPLY_MODES,
  collectPhysicalStyleCatalogV7Issues,
  createThirdPartyStyleProductPackageV7,
  createItemFamilyV7,
  createPhysicalStyleCatalogV7,
  createStyleProductV7,
  inspectThirdPartyStyleProductPackageV7,
} from './maker-physical-v7.js';

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function string(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function getPhysicalStyleCatalogV7Draft(document) {
  const value = document?.extensions?.[PHYSICAL_STYLE_CATALOG_V7_EXTENSION_KEY];
  return value && typeof value === 'object' && !Array.isArray(value)
    ? createPhysicalStyleCatalogV7(value)
    : null;
}

export function setPhysicalStyleCatalogV7Draft(document, value) {
  document.extensions ||= {};
  document.extensions[PHYSICAL_STYLE_CATALOG_V7_EXTENSION_KEY] =
    createPhysicalStyleCatalogV7(value);
  return document.extensions[PHYSICAL_STYLE_CATALOG_V7_EXTENSION_KEY];
}

export function createPhysicalStyleCatalogV7DraftForDocument(document, {
  makerRootId = '',
  profileId = '',
  compatibilityHash = '',
  certified = true,
  open = false,
} = {}) {
  const v6 = object(document?.extensions?.composableV6);
  return createPhysicalStyleCatalogV7({
    enabled: true,
    target: {
      makerRootId: string(makerRootId)
        || string(v6.compatibility?.makerRootId)
        || string(document?.version?.rootMakerId),
      profileId: string(profileId)
        || string(v6.profile?.id)
        || `profile:${string(document?.version?.rootMakerId) || 'maker'}:v7`,
      compatibilityHash: string(compatibilityHash)
        || string(v6.compatibility?.manifestHash),
    },
    admission: { certified, open },
    families: [],
  });
}

function selectedRecords(document, partId, itemId, styleId) {
  const part = array(document?.parts).find((candidate) => candidate?.id === partId);
  const item = array(part?.items).find((candidate) => candidate?.id === itemId);
  const style = array(item?.styles).find((candidate) => candidate?.id === styleId);
  return { part, item, style };
}

export function addMakerStyleProductV7(catalogValue, {
  document,
  partId,
  itemId,
  styleId,
  asset = {},
  creator = '',
  publisher = '',
  admissionClass = STYLE_PRODUCT_ADMISSION_CLASSES.OFFICIAL,
  supplyMode = STYLE_PRODUCT_SUPPLY_MODES.INCLUDED,
  supplyCap = null,
  priceAtomic = 0,
  coinType = '',
  coinSymbol = 'USDC',
  creatorRoyaltyBps = 0,
  makerEcosystemFeeBps = 0,
  rightsOrigin = STYLE_PRODUCT_RIGHTS_ORIGINS.LICENSE_WRAPPED,
  rightsManifestHash = '',
} = {}) {
  const catalog = createPhysicalStyleCatalogV7(catalogValue);
  const { part, item, style } = selectedRecords(document, partId, itemId, styleId);
  if (!part || !item || !style) {
    const error = new Error('Choose one existing Part, Item and Style.');
    error.code = 'PHYSICAL_V7_STYLE_SELECTION_REQUIRED';
    throw error;
  }
  if (!style.assetId) {
    const error = new Error('Upload the exact Style PNG before creating a Style Product.');
    error.code = 'PHYSICAL_V7_EXACT_PNG_REQUIRED';
    throw error;
  }
  if (string(style.colorChannelId)) {
    const error = new Error('This Style is still linked to Smart Color. Bake the exact current color into a separate PNG Style and unlink Smart Color before creating a Style Product.');
    error.code = 'PHYSICAL_V7_SMART_COLOR_MUST_BE_BAKED';
    throw error;
  }
  const descriptor = array(document.assets).find((candidate) => candidate?.id === style.assetId) || {};
  const familyId = `family:${part.id}:${item.id}`;
  const productId = `style-product:${part.id}:${item.id}:${style.id}:v1`;
  const v6ProductId = `official:${part.id}:${item.id}:${style.id}:v1`;
  const transform = object(style.transform);
  const product = createStyleProductV7({
    id: productId,
    v6ProductId,
    familyId,
    targetMakerRootId: catalog.target.makerRootId,
    targetProfileId: catalog.target.profileId,
    targetPartId: part.id,
    name: style.name || item.name,
    description: `${part.name} / ${item.name} / ${style.name}`,
    creator,
    publisher: publisher || creator,
    admissionClass,
    exactPng: {
      assetId: style.assetId,
      blobId: string(asset.blobId) || string(descriptor.blobId) || string(descriptor.assetBlobId),
      contentHash: string(asset.contentHash) || string(descriptor.contentHash) || string(descriptor.assetHash),
      mediaType: 'image/png',
      width: Number(asset.width || descriptor.width || 0),
      height: Number(asset.height || descriptor.height || 0),
    },
    thumbnail: {
      assetId: style.assetId,
      blobId: string(asset.thumbnailBlobId) || string(descriptor.thumbnailBlobId),
      contentHash: string(asset.thumbnailHash) || string(descriptor.thumbnailHash),
    },
    placement: {
      layerTrackId: style.layerTrackId,
      x: finite(transform.x, 0),
      y: finite(transform.y, 0),
      scale: finite(transform.scale, 1),
      rotation: finite(transform.rotation, 0),
      opacity: finite(style.opacity, 1),
      blendMode: string(style.blendMode) || 'normal',
    },
    baseSource: { partId: part.id, itemId: item.id, styleId: style.id },
    supply: { mode: supplyMode, cap: supplyCap, minted: 0 },
    commerce: {
      priceAtomic: supplyMode === STYLE_PRODUCT_SUPPLY_MODES.INCLUDED ? 0 : priceAtomic,
      coinType,
      coinSymbol,
      protocolFeeBps: 1_000,
      makerEcosystemFeeBps,
      creatorRoyaltyBps,
    },
    rights: { origin: rightsOrigin, manifestHash: rightsManifestHash },
    validation: { passed: false, attestationId: '', epoch: 0 },
  });
  const existingFamilyIndex = catalog.families.findIndex((candidate) => candidate.id === familyId);
  if (existingFamilyIndex < 0) {
    catalog.families.push(createItemFamilyV7({
      id: familyId,
      targetMakerRootId: catalog.target.makerRootId,
      targetProfileId: catalog.target.profileId,
      targetPartId: part.id,
      name: item.name,
      description: `${part.name} / ${item.name}`,
      creator,
      styles: [product],
    }));
  } else {
    const family = catalog.families[existingFamilyIndex];
    const existingProductIndex = family.styles.findIndex((candidate) => candidate.id === product.id);
    if (existingProductIndex >= 0) family.styles[existingProductIndex] = product;
    else family.styles.push(product);
  }
  return { catalog: createPhysicalStyleCatalogV7(catalog), familyId, productId };
}

export function updateStyleProductV7(catalogValue, productId, patch = {}) {
  const catalog = createPhysicalStyleCatalogV7(catalogValue);
  let updated = null;
  catalog.families = catalog.families.map((family) => ({
    ...family,
    styles: family.styles.map((product) => {
      if (product.id !== productId) return product;
      updated = createStyleProductV7({
        ...product,
        ...patch,
        supply: { ...product.supply, ...object(patch.supply) },
        commerce: { ...product.commerce, ...object(patch.commerce) },
        rights: { ...product.rights, ...object(patch.rights) },
      });
      return updated;
    }),
  }));
  return { catalog: createPhysicalStyleCatalogV7(catalog), product: updated };
}

export function removeStyleProductV7(catalogValue, productId) {
  const catalog = createPhysicalStyleCatalogV7(catalogValue);
  catalog.families = catalog.families
    .map((family) => ({
      ...family,
      styles: family.styles.filter((product) => product.id !== productId),
    }))
    .filter((family) => family.styles.length > 0);
  return createPhysicalStyleCatalogV7(catalog);
}

export function inspectPhysicalStyleCatalogManifestV7(value, { publish = false } = {}) {
  let raw = value;
  try {
    if (typeof value === 'string') raw = JSON.parse(value);
  } catch (error) {
    return {
      valid: false,
      catalog: null,
      issues: [{ path: '$', code: 'invalid_json', message: 'Style catalog JSON could not be parsed.' }],
      error,
    };
  }
  const catalog = createPhysicalStyleCatalogV7(raw);
  const issues = collectPhysicalStyleCatalogV7Issues(raw, { publish });
  return { valid: issues.length === 0, catalog, issues };
}

/**
 * Downloadable starting point for an independent third-party Style creator.
 * No Maker owner capability or wallet proof is embedded in the template.
 */
export function createThirdPartyStyleProductTemplateV7(catalogValue, {
  targetPartId = '',
  creator = '',
} = {}) {
  const catalog = createPhysicalStyleCatalogV7(catalogValue);
  const partId = string(targetPartId);
  return createThirdPartyStyleProductPackageV7({
    schemaVersion: THIRD_PARTY_STYLE_PRODUCT_PACKAGE_V7_SCHEMA,
    target: {
      makerRootId: catalog.target.makerRootId,
      profileId: catalog.target.profileId,
      partId,
      compatibilityHash: catalog.target.compatibilityHash,
    },
    family: {
      id: `family:third-party:${partId || 'part'}:replace-me`,
      targetMakerRootId: catalog.target.makerRootId,
      targetProfileId: catalog.target.profileId,
      targetPartId: partId,
      name: 'Replace with Item family name',
      description: 'One product family for compatible exact Style Products.',
      creator,
    },
    product: {
      id: `style-product:third-party:${partId || 'part'}:replace-me:v1`,
      v6ProductId: 'REPLACE_WITH_ADMITTED_V6_PRODUCT_LOGICAL_ID',
      version: 1,
      familyId: `family:third-party:${partId || 'part'}:replace-me`,
      targetMakerRootId: catalog.target.makerRootId,
      targetProfileId: catalog.target.profileId,
      targetPartId: partId,
      name: 'Replace with exact Style/colorway name',
      description: 'One fixed-color exact PNG Style Product.',
      creator,
      publisher: creator,
      admissionClass: STYLE_PRODUCT_ADMISSION_CLASSES.OPEN,
      exactPng: {
        assetId: '',
        blobId: 'REPLACE_WITH_WALRUS_BLOB_ID',
        contentHash: 'REPLACE_WITH_64_HEX_SHA256',
        mediaType: 'image/png',
        width: 0,
        height: 0,
      },
      thumbnail: { assetId: '', blobId: '', contentHash: '' },
      placement: {
        layerTrackId: 'REPLACE_WITH_COMPATIBLE_LAYER_TRACK_ID',
        x: 0,
        y: 0,
        scale: 1,
        rotation: 0,
        opacity: 1,
        blendMode: 'normal',
      },
      supply: { mode: STYLE_PRODUCT_SUPPLY_MODES.OPEN_EDITION, cap: null, minted: 0 },
      commerce: {
        priceAtomic: 0,
        coinType: '',
        coinSymbol: 'USDC',
        protocolFeeBps: 1_000,
        makerEcosystemFeeBps: 0,
        creatorRoyaltyBps: 0,
      },
      rights: {
        origin: STYLE_PRODUCT_RIGHTS_ORIGINS.LICENSE_WRAPPED,
        manifestHash: 'REPLACE_WITH_64_HEX_RIGHTS_HASH',
      },
      validation: { passed: false, attestationId: '', epoch: 0 },
    },
    authoring: {
      independent: true,
      template: true,
      note: 'Upload one fixed-color PNG, replace every REPLACE_WITH value, then send this JSON to the target Maker for admission and technical validation.',
    },
  });
}

export function importThirdPartyStyleProductPackageV7(catalogValue, packageInput, {
  publish = false,
  document = null,
} = {}) {
  const catalog = createPhysicalStyleCatalogV7(catalogValue);
  const inspection = inspectThirdPartyStyleProductPackageV7(packageInput, { publish });
  if (!inspection.valid || !inspection.package) {
    const error = new Error(inspection.issues[0]?.message || 'Third-party Style package is invalid.');
    error.code = 'PHYSICAL_V7_SUPPLIER_PACKAGE_INVALID';
    error.issues = inspection.issues;
    throw error;
  }
  const packageValue = inspection.package;
  if (
    packageValue.target.makerRootId !== catalog.target.makerRootId
    || packageValue.target.profileId !== catalog.target.profileId
    || packageValue.target.compatibilityHash !== catalog.target.compatibilityHash
  ) {
    const error = new Error('Third-party Style package targets a different Maker compatibility profile.');
    error.code = 'PHYSICAL_V7_SUPPLIER_TARGET_MISMATCH';
    throw error;
  }
  if (document) {
    const targetPartExists = array(document.parts)
      .some((part) => part?.id === packageValue.target.partId);
    if (!targetPartExists) {
      const error = new Error('Third-party Style package targets a Part that does not exist in this Maker.');
      error.code = 'PHYSICAL_V7_SUPPLIER_PART_INCOMPATIBLE';
      throw error;
    }
    const targetTrackExists = array(document.layerTracks)
      .some((track) => track?.id === packageValue.product.placement.layerTrackId);
    if (!targetTrackExists) {
      const error = new Error('Third-party Style package targets a Layer Track that does not exist in this Maker.');
      error.code = 'PHYSICAL_V7_SUPPLIER_TRACK_INCOMPATIBLE';
      throw error;
    }
  }
  if (
    packageValue.product.admissionClass === STYLE_PRODUCT_ADMISSION_CLASSES.CERTIFIED
    && !catalog.admission.certified
  ) {
    const error = new Error('This Maker does not accept Certified third-party Style Products.');
    error.code = 'PHYSICAL_V7_CERTIFIED_ADMISSION_DISABLED';
    throw error;
  }
  if (
    packageValue.product.admissionClass === STYLE_PRODUCT_ADMISSION_CLASSES.OPEN
    && !catalog.admission.open
  ) {
    const error = new Error('This Maker does not accept Open validated third-party Style Products.');
    error.code = 'PHYSICAL_V7_OPEN_ADMISSION_DISABLED';
    throw error;
  }
  const family = createItemFamilyV7({
    ...packageValue.family,
    styles: [packageValue.product],
  });
  const existingFamily = catalog.families.find((candidate) => candidate.id === family.id);
  if (existingFamily && (
    existingFamily.targetPartId !== family.targetPartId
    || existingFamily.targetMakerRootId !== family.targetMakerRootId
    || existingFamily.targetProfileId !== family.targetProfileId
  )) {
    const error = new Error('Third-party Item Family ID conflicts with another target.');
    error.code = 'PHYSICAL_V7_SUPPLIER_FAMILY_CONFLICT';
    throw error;
  }
  const duplicateProduct = catalog.families.some((candidate) => (
    candidate.styles.some((product) => product.id === family.styles[0].id)
  ));
  if (duplicateProduct) {
    const error = new Error('Style Product ID already exists in this Maker catalog.');
    error.code = 'PHYSICAL_V7_SUPPLIER_PRODUCT_DUPLICATE';
    throw error;
  }
  if (existingFamily) existingFamily.styles.push(family.styles[0]);
  else catalog.families.push(family);
  return {
    catalog: createPhysicalStyleCatalogV7(catalog),
    familyId: family.id,
    productId: family.styles[0].id,
  };
}

export function collectPhysicalStyleCatalogDocumentIssuesV7(document, { publish = false } = {}) {
  const catalog = getPhysicalStyleCatalogV7Draft(document);
  if (!catalog) return [];
  const issues = collectPhysicalStyleCatalogV7Issues(catalog, { publish });
  const partIds = new Set(array(document?.parts).map((part) => part.id));
  const layerTrackIds = new Set(array(document?.layerTracks).map((track) => track.id));
  catalog.families.forEach((family, familyIndex) => {
    if (!partIds.has(family.targetPartId)) issues.push({
      path: `families[${familyIndex}].targetPartId`,
      code: 'unknown_document_part',
      message: 'Item Family targets a Part that no longer exists in this Maker.',
    });
    family.styles.forEach((product, productIndex) => {
      if (!layerTrackIds.has(product.placement.layerTrackId)) issues.push({
        path: `families[${familyIndex}].styles[${productIndex}].placement.layerTrackId`,
        code: 'unknown_document_layer_track',
        message: 'Style Product targets a Layer Track that does not exist in this Maker.',
      });
      if (!product.baseSource) return;
      const selected = selectedRecords(
        document,
        product.baseSource.partId,
        product.baseSource.itemId,
        product.baseSource.styleId,
      );
      if (!selected.style || selected.style.assetId !== product.exactPng.assetId) issues.push({
        path: `families[${familyIndex}].styles[${productIndex}].baseSource`,
        code: 'base_style_png_changed',
        message: 'The source Style or exact PNG changed. Rebuild this Style Product before publication.',
      });
      if (selected.style && string(selected.style.colorChannelId)) issues.push({
        path: `families[${familyIndex}].styles[${productIndex}].baseSource`,
        code: 'base_style_uses_smart_color',
        message: 'The source Style was linked to Smart Color after this Product was created. Bake the exact color into a separate PNG Style and unlink Smart Color.',
      });
    });
  });
  return issues;
}
