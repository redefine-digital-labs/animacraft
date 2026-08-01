import {
  COMPOSABLE_PROFILE_MODES,
  ITEM_ACCESS_MODES,
  ITEM_BINDING_MODES,
  ITEM_ORIGIN_CLASSES,
  ITEM_RIGHTS_ORIGINS,
  createCompatibilityProfileV6,
  createItemProductV6,
  collectCompatibilityProfileV6Issues,
  collectComposableProfileV6Issues,
  collectItemProductV6Issues,
  deriveInventoryV6,
  validateLoadoutV6,
} from './maker-composable-v6.js';
import {
  BLEND_MODES,
  normalizeBlendMode,
} from './maker-renderer.js';

const MAX_SOURCE_SIDE = 32_768;

export class MakerComposableV6WorkspaceError extends Error {
  constructor(message, code = 'maker-composable-v6-workspace-error', details = {}) {
    super(message);
    this.name = 'MakerComposableV6WorkspaceError';
    this.code = code;
    this.details = details;
  }
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
}

function clone(value) {
  if (value === undefined) return undefined;
  return structuredClone(value);
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function string(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 && number <= MAX_SOURCE_SIDE
    ? number
    : 0;
}

function first(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function issue(path, code, message) {
  return { path, code, message };
}

function prefixed(entry, prefix) {
  return {
    ...entry,
    path: entry.path ? `${prefix}.${entry.path}` : prefix,
  };
}

function dedupeIssues(issues) {
  const seen = new Set();
  return issues.filter((entry) => {
    const key = `${entry.path}\u0000${entry.code}\u0000${entry.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function tracksInRenderOrder(document) {
  return [...array(document?.layerTracks)].sort((left, right) => (
    finite(left?.order, Number.MAX_SAFE_INTEGER)
    - finite(right?.order, Number.MAX_SAFE_INTEGER)
    || string(left?.id).localeCompare(string(right?.id))
  ));
}

function findBaseSelection(document, partId, itemId, styleId) {
  const part = array(document?.parts).find((candidate) => candidate?.id === partId);
  const item = array(part?.items).find((candidate) => candidate?.id === itemId);
  const style = array(item?.styles).find((candidate) => candidate?.id === styleId);
  return { part, item, style };
}

function sourceAsset(document, style, supplied = {}) {
  const indexed = array(document?.assets)
    .find((candidate) => candidate?.id === style?.assetId);
  const explicitAssetId = string(first(supplied.assetId, supplied.id));
  if (explicitAssetId && explicitAssetId !== string(style?.assetId)) {
    throw new MakerComposableV6WorkspaceError(
      'The supplied source PNG metadata does not belong to the selected Style.',
      'source-asset-mismatch',
      { expectedAssetId: style?.assetId, actualAssetId: explicitAssetId },
    );
  }
  return {
    indexed,
    id: string(style?.assetId),
    blobId: string(first(
      supplied.assetBlobId,
      supplied.blobId,
      supplied.walrusBlobId,
      indexed?.assetBlobId,
      indexed?.blobId,
      indexed?.walrusBlobId,
    )),
    hash: string(first(
      supplied.assetHash,
      supplied.contentHash,
      supplied.hash,
      indexed?.assetHash,
      indexed?.contentHash,
      indexed?.digest,
    )),
    width: positiveInteger(first(supplied.assetWidth, supplied.width, indexed?.width)),
    height: positiveInteger(first(supplied.assetHeight, supplied.height, indexed?.height)),
  };
}

/**
 * Derive the v6 Maker-local compatibility contract from the exact v5 canvas,
 * Layer Tracks and Parts. A Part becomes one capacity-one Slot and placement
 * remains the exact v5 Style transform in the Maker canvas.
 */
export function deriveMakerLocalCompatibilityV6(document, options = {}) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new TypeError('A Maker v5 document object is required.');
  }
  const tracks = tracksInRenderOrder(document);
  const trackIds = tracks.map((track) => string(track?.id)).filter(Boolean);
  const trackSet = new Set(trackIds);
  const slots = array(document.parts).map((part) => {
    const usedTracks = [];
    array(part?.items).forEach((item) => {
      array(item?.styles).forEach((style) => {
        const trackId = string(style?.layerTrackId);
        if (trackId && trackSet.has(trackId) && !usedTracks.includes(trackId)) {
          usedTracks.push(trackId);
        }
      });
    });
    usedTracks.sort((left, right) => trackIds.indexOf(left) - trackIds.indexOf(right));
    return {
      id: string(part?.id),
      capacity: 1,
      required: part?.required === true,
      layerTrackIds: usedTracks,
    };
  });
  const canvas = object(document.canvas);
  return createCompatibilityProfileV6({
    makerRootId: string(first(
      options.makerRootId,
      document?.runtime?.makerRootObjectId,
      document?.version?.rootMakerId,
    )),
    canvas: {
      width: canvas.width,
      height: canvas.height,
    },
    coordinate: {
      origin: 'TOP_LEFT',
      unit: 'PIXEL',
      pixelMode: canvas.pixelMode === 'pixelated',
    },
    renderer: {
      version: string(options.rendererVersion),
      commitment: string(options.rendererCommitment),
    },
    layerTrackIds: trackIds,
    slots,
    maskPolicyHash: string(options.maskPolicyHash),
    rulesHash: string(options.rulesHash),
    fallbackProductIds: array(options.fallbackProductIds),
    fallbackLoadoutHash: string(options.fallbackLoadoutHash),
    manifestBlobId: string(options.manifestBlobId),
    manifestHash: string(options.manifestHash),
    extensionsHash: string(options.extensionsHash),
  });
}

/** Create one Official, free, embedded Product from one exact v5 Style PNG. */
export function createOfficialEmbeddedItemProductDraftV6({
  document,
  compatibility,
  partId,
  itemId,
  styleId,
  asset = {},
  display = {},
  productId = '',
  version = 1,
  parentVersionId = null,
  creator = '',
  publisher = '',
  validation = {},
  certification = null,
  manifestBlobId = '',
  manifestHash = '',
  contentHash = '',
  rightsOrigin = ITEM_RIGHTS_ORIGINS.LICENSE_WRAPPED,
  rightsManifestHash = '',
  makerEcosystemFeeBps = 0,
  extensionsHash = '',
} = {}) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new TypeError('A Maker v5 document object is required.');
  }
  const selected = findBaseSelection(document, partId, itemId, styleId);
  if (!selected.part || !selected.item || !selected.style) {
    throw new MakerComposableV6WorkspaceError(
      'Choose one existing Part, Item and Style before creating an embedded Item Product.',
      'missing-base-style',
      { partId, itemId, styleId },
    );
  }
  const trackId = string(selected.style.layerTrackId);
  const track = array(document.layerTracks).find((candidate) => candidate?.id === trackId);
  const slot = array(compatibility?.slots).find((candidate) => candidate?.id === partId);
  if (!track || !array(compatibility?.layerTrackIds).includes(trackId)) {
    throw new MakerComposableV6WorkspaceError(
      'The selected Style must use a Layer Track declared by the compatibility contract.',
      'unknown-base-layer-track',
      { layerTrackId: trackId },
    );
  }
  if (!slot || !array(slot.layerTrackIds).includes(trackId)) {
    throw new MakerComposableV6WorkspaceError(
      'The selected Style Layer Track is outside its Part Slot.',
      'base-style-outside-slot',
      { slotId: partId, layerTrackId: trackId },
    );
  }
  if (!selected.style.assetId) {
    throw new MakerComposableV6WorkspaceError(
      'The selected Style does not have a source PNG.',
      'missing-base-style-asset',
      { partId, itemId, styleId },
    );
  }
  const source = sourceAsset(document, selected.style, asset);
  if (!source.width || !source.height) {
    throw new MakerComposableV6WorkspaceError(
      'The immutable source PNG width and height are required. Transparent bounds are never used as dimensions.',
      'missing-source-png-dimensions',
      { assetId: source.id },
    );
  }
  const transform = object(selected.style.transform);
  const resolvedProductId = string(productId)
    || `official:${partId}:${itemId}:${styleId}:v${version}`;
  const defaultActor = string(document?.metadata?.creator);
  return createItemProductV6({
    id: resolvedProductId,
    version,
    parentVersionId,
    makerRootId: string(compatibility?.makerRootId),
    compatibilityHash: string(compatibility?.manifestHash),
    creator: string(creator) || defaultActor,
    publisher: string(publisher) || string(creator) || defaultActor,
    originClass: ITEM_ORIGIN_CLASSES.OFFICIAL,
    display: {
      name: string(display.name) || string(selected.item.name) || string(selected.style.name),
      description: string(display.description)
        || `${string(selected.part.name)} / ${string(selected.item.name)} / ${string(selected.style.name)}`,
      thumbnailBlobId: string(first(display.thumbnailBlobId, asset.thumbnailBlobId)),
      thumbnailHash: string(first(display.thumbnailHash, asset.thumbnailHash)),
    },
    components: [{
      id: `${resolvedProductId}:component`,
      layerTrackId: trackId,
      assetBlobId: source.blobId,
      assetHash: source.hash,
      assetWidth: source.width,
      assetHeight: source.height,
      transform: {
        x: finite(transform.x, 0),
        y: finite(transform.y, 0),
        scale: finite(transform.scale, 1),
        rotation: finite(transform.rotation, 0),
        opacity: finite(selected.style.opacity, 1),
        blendMode: normalizeBlendMode(selected.style.blendMode),
      },
      baseSource: { partId, itemId, styleId },
    }],
    validation,
    certification,
    manifestBlobId,
    manifestHash,
    contentHash,
    slotClaims: [{ slotId: partId, units: 1 }],
    requires: array(selected.style.requires),
    excludes: array(selected.style.excludes),
    rightsOrigin,
    rightsManifestHash,
    access: {
      mode: ITEM_ACCESS_MODES.EMBEDDED,
      binding: ITEM_BINDING_MODES.EMBEDDED,
      priceAtomic: 0,
      transferable: false,
    },
    makerEcosystemFeeBps,
    extensionsHash,
  });
}

/** Parse and technically validate an immutable Official/Certified/Open manifest. */
export function inspectThirdPartyItemManifestV6(value, {
  profile,
  compatibility,
  makerOwner = '',
  currentOwnershipEpoch = 0,
  publish = true,
  trustedAttestation = null,
} = {}) {
  let raw = value;
  if (typeof value === 'string') {
    try {
      raw = JSON.parse(value);
    } catch (error) {
      const issues = [issue('$', 'invalid-item-manifest-json', 'Item manifest JSON could not be parsed.')];
      return { valid: false, issues, product: null, error };
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    const issues = [issue('$', 'invalid-item-manifest', 'Item manifest must be a JSON object.')];
    return { valid: false, issues, product: null };
  }
  const product = createItemProductV6(raw);
  const attestation = object(trustedAttestation);
  const attestationMatches = trustedAttestation !== null
    && attestation.verified === true
    && string(attestation.attestationId)
    && string(attestation.productId) === product.id
    && string(attestation.definitionCommitment).replace(/^0x/i, '').toLowerCase()
      === string(product.manifestHash).replace(/^0x/i, '').toLowerCase()
    && (!string(attestation.profileId)
      || string(attestation.profileId) === string(attestation.expectedProfileId))
    && (!string(attestation.slotSchemaCommitment)
      || string(attestation.slotSchemaCommitment).replace(/^0x/i, '').toLowerCase()
        === string(compatibility?.manifestHash).replace(/^0x/i, '').toLowerCase());
  product.validation = attestationMatches
    ? {
        passed: true,
        attestationId: string(attestation.attestationId),
        epoch: Math.max(0, Number(attestation.epoch || 0)),
      }
    : { passed: false, attestationId: '', epoch: 0 };
  // First reject malformed/unknown source fields without accepting any
  // self-reported validation. Then run publication policy against the exact
  // normalized Product that received trusted chain readback.
  const sourceIssues = collectItemProductV6Issues(raw, {
    profile,
    compatibility,
    makerOwner,
    currentOwnershipEpoch,
    publish: false,
  });
  const issues = [
    ...sourceIssues,
    ...collectItemProductV6Issues(product, {
      profile,
      compatibility,
      makerOwner,
      currentOwnershipEpoch,
      publish,
    }),
  ];
  // Validation is one technical gate shared by Official, Certified and Open.
  // Certification is a separate Maker endorsement and never replaces it.
  if (publish && product.validation.passed !== true) {
    issues.push(issue(
      'product.validation.passed',
      'technical-validation-required',
      'Official, Certified and Open Items must all pass the same technical validation.',
    ));
  }
  if (publish && !product.validation.attestationId) {
    issues.push(issue(
      'product.validation.attestationId',
      'technical-attestation-required',
      'A technical validation attestation is required for every Item origin class.',
    ));
  }
  const normalizedIssues = dedupeIssues(issues);
  return {
    valid: normalizedIssues.length === 0,
    issues: normalizedIssues,
    product,
    originClass: product.originClass,
    technicallyValidated: attestationMatches,
    makerEndorsed: product.originClass !== ITEM_ORIGIN_CLASSES.OPEN
      && Boolean(product.certification),
  };
}

/** Apply embedded baseSource choices to the v5 player recipe immutably. */
export function mergeEmbeddedProductSelectionIntoRecipeV6(recipe, productValue) {
  const product = createItemProductV6(productValue);
  if (
    product.originClass !== ITEM_ORIGIN_CLASSES.OFFICIAL
    || product.access.mode !== ITEM_ACCESS_MODES.EMBEDDED
    || product.access.binding !== ITEM_BINDING_MODES.EMBEDDED
  ) {
    throw new MakerComposableV6WorkspaceError(
      'Only an Official embedded Item Product can select a base Maker Style.',
      'product-is-not-official-embedded',
    );
  }
  const byPart = new Map();
  product.components.forEach((component) => {
    if (!component.baseSource) return;
    const existing = byPart.get(component.baseSource.partId);
    if (existing && (
      existing.itemId !== component.baseSource.itemId
      || existing.styleId !== component.baseSource.styleId
    )) {
      throw new MakerComposableV6WorkspaceError(
        'One embedded Product cannot select conflicting base Styles in the same Part.',
        'conflicting-product-base-source',
        { partId: component.baseSource.partId },
      );
    }
    byPart.set(component.baseSource.partId, component.baseSource);
  });
  if (!byPart.size) {
    throw new MakerComposableV6WorkspaceError(
      'This embedded Product does not identify a base Maker Style.',
      'missing-product-base-source',
    );
  }
  const next = clone(object(recipe));
  const selections = array(next.selections).map((selection) => clone(selection));
  byPart.forEach((source, partId) => {
    const index = selections.findIndex((selection) => selection?.partId === partId);
    const previous = index >= 0 ? object(selections[index]) : {};
    const selection = {
      ...previous,
      partId,
      itemId: source.itemId,
      styleId: source.styleId,
    };
    if (index >= 0) selections[index] = selection;
    else selections.push(selection);
  });
  next.selections = selections;
  return next;
}

/** Convert non-base Components into exact shared-Renderer layer records. */
export function itemProductComponentsToRendererLayersV6(productValue, {
  compatibility,
  layerTracks = [],
  profile,
} = {}) {
  const product = createItemProductV6(productValue);
  const validationIssues = collectItemProductV6Issues(product, {
    profile,
    compatibility,
    publish: false,
  }).filter((entry) => ![
    'invalid_item_creator',
    'invalid_item_publisher',
  ].includes(entry.code));
  if (validationIssues.length) {
    throw new MakerComposableV6WorkspaceError(
      'The Item Product cannot be converted into Renderer layers.',
      'invalid-render-item-product',
      { issues: validationIssues },
    );
  }
  const orderedTrackIds = array(compatibility?.layerTrackIds);
  const explicitOrder = new Map(array(layerTracks).map((track, index) => [
    string(track?.id),
    finite(track?.order, index),
  ]));
  const orderFor = (trackId) => explicitOrder.has(trackId)
    ? explicitOrder.get(trackId)
    : orderedTrackIds.indexOf(trackId);
  const pixelMode = compatibility?.coordinate?.pixelMode === true ? 'nearest' : 'smooth';
  const layers = product.components
    .map((component, componentIndex) => ({ component, componentIndex }))
    .filter(({ component }) => !component.baseSource)
    .map(({ component, componentIndex }) => {
      const blendMode = normalizeBlendMode(component.transform.blendMode);
      return {
        key: `v6/${product.id}/${component.id}`,
        productId: product.id,
        componentId: component.id,
        // v6 Slots are derived one-to-one from v5 Parts. Keeping the Slot on
        // the Renderer record lets preview and final export share replacement.
        partId: product.slotClaims[0]?.slotId || '',
        trackId: component.layerTrackId,
        trackOrder: orderFor(component.layerTrackId),
        order: componentIndex,
        assetId: component.assetBlobId || component.assetHash,
        asset: {
          id: component.assetBlobId || component.assetHash,
          blobId: component.assetBlobId,
          contentHash: component.assetHash,
          width: component.assetWidth,
          height: component.assetHeight,
          mediaType: 'image/png',
        },
        transform: {
          x: component.transform.x,
          y: component.transform.y,
          width: component.assetWidth,
          height: component.assetHeight,
          scaleX: component.transform.scale,
          scaleY: component.transform.scale,
          rotation: component.transform.rotation,
          originX: component.assetWidth / 2,
          originY: component.assetHeight / 2,
        },
        transformSource: 'item-product-component',
        opacity: component.transform.opacity,
        blendMode,
        compositeOperation: BLEND_MODES[blendMode],
        pixelMode,
        colorChannel: null,
      };
    });
  return layers.sort((left, right) => (
    left.trackOrder - right.trackOrder
    || left.trackId.localeCompare(right.trackId)
    || left.order - right.order
    || left.key.localeCompare(right.key)
  ));
}

function selectedProductIds(selected) {
  return new Set(array(selected).map((entry) => (
    typeof entry === 'string' ? entry : entry?.productId
  )).filter(Boolean));
}

/** Derive fail-closed player cards from actual embedded/entitlement inventory. */
export function deriveWardrobeCardsV6({
  profile,
  compatibility,
  products = [],
  entitlements = [],
  ownerAddress = '',
  soulId = '',
  selected = [],
} = {}) {
  const inventory = deriveInventoryV6({
    products,
    entitlements,
    makerRootId: compatibility?.makerRootId || '',
    compatibilityHash: compatibility?.manifestHash || '',
    ownerAddress,
    soulId,
  });
  const inventoryByProduct = new Map();
  inventory.forEach((entry) => {
    if (!inventoryByProduct.has(entry.productId)) inventoryByProduct.set(entry.productId, []);
    inventoryByProduct.get(entry.productId).push(entry);
  });
  const selectedIds = selectedProductIds(selected);
  const composable = profile?.mode === COMPOSABLE_PROFILE_MODES.COMPOSABLE
    && profile?.loadoutMutable === true;
  return array(products)
    .filter((product) => product?.makerRootId === compatibility?.makerRootId)
    .filter((product) => !compatibility?.manifestHash
      || product?.compatibilityHash === compatibility.manifestHash)
    .map((rawProduct) => {
      const product = createItemProductV6(rawProduct);
      const technicalIssues = collectItemProductV6Issues(rawProduct, {
        profile,
        compatibility,
        publish: false,
      });
      const technicallyValidated = product.validation.passed === true
        && Boolean(product.validation.attestationId)
        && technicalIssues.length === 0;
      const usableEntries = inventoryByProduct.get(product.id) || [];
      const entitlement = usableEntries[0] || null;
      const available = technicallyValidated && Boolean(entitlement);
      let action = 'unavailable';
      if (available && product.access.binding === ITEM_BINDING_MODES.EMBEDDED) action = 'included';
      else if (available) action = 'equip';
      else if (technicallyValidated && product.access.mode === ITEM_ACCESS_MODES.FREE_CLAIM) action = 'claim';
      else if (technicallyValidated && product.access.mode === ITEM_ACCESS_MODES.PAID_ONCE) action = 'purchase';
      return {
        productId: product.id,
        name: product.display.name,
        description: product.display.description,
        thumbnailBlobId: product.display.thumbnailBlobId,
        thumbnailHash: product.display.thumbnailHash,
        originClass: product.originClass,
        accessMode: product.access.mode,
        binding: product.access.binding,
        priceAtomic: product.access.priceAtomic,
        transferable: product.access.transferable,
        technicallyValidated,
        makerEndorsed: product.originClass !== ITEM_ORIGIN_CLASSES.OPEN
          && Boolean(product.certification),
        available,
        locked: !available,
        equipped: selectedIds.has(product.id),
        canEquip: composable && available,
        action,
        entitlementId: entitlement?.entitlementId || null,
        lockedSoulId: entitlement?.binding === ITEM_BINDING_MODES.OWNED
          ? (entitlements.find((candidate) => (
              candidate.id === entitlement.entitlementId
            ))?.equippedSoulId || '')
          : '',
        disabledReason: !composable
          ? 'fixed-loadout'
          : (!available && !['claim', 'purchase'].includes(action) ? 'not-entitled' : ''),
        issues: technicalIssues,
        product,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name) || left.productId.localeCompare(right.productId));
}

/** Validate one player Wardrobe selection with the canonical v6 loadout rules. */
export function validateWardrobeLoadoutV6({
  profile,
  compatibility,
  products = [],
  entitlements = [],
  selected = [],
  ownerAddress = '',
  soulId = '',
  postMint = true,
  transferSafe = false,
} = {}) {
  const modelResult = validateLoadoutV6({
    profile,
    compatibility,
    products,
    entitlements,
    selected,
    ownerAddress,
    soulId,
    postMint,
    transferSafe,
  });
  const issues = [
    ...collectComposableProfileV6Issues(profile).map((entry) => prefixed(entry, 'loadout.profile')),
    ...collectCompatibilityProfileV6Issues(compatibility, { publish: false })
      .map((entry) => prefixed(entry, 'loadout.compatibility')),
    ...modelResult.issues,
  ];
  const normalizedIssues = dedupeIssues(issues);
  return {
    ...modelResult,
    valid: normalizedIssues.length === 0,
    issues: normalizedIssues,
    selectedProductIds: modelResult.resolved.map((entry) => entry.productId),
  };
}
