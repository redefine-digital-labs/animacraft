export const MAKER_COMPOSABLE_V6_SCHEMA = 'animacraft.maker-composable.v6';
export const MAKER_COMPOSABLE_V6_SCHEMA_VERSION = 1;

export const COMPOSABLE_PROFILE_MODES = Object.freeze({
  FIXED: 'FIXED',
  COMPOSABLE: 'COMPOSABLE',
});

export const THIRD_PARTY_ADMISSION_MODES = Object.freeze({
  DISABLED: 'DISABLED',
  CERTIFIED: 'CERTIFIED',
  OPEN: 'OPEN',
});

export const ITEM_ORIGIN_CLASSES = Object.freeze({
  OFFICIAL: 'OFFICIAL',
  CERTIFIED: 'CERTIFIED',
  OPEN: 'OPEN',
});

export const ITEM_ACCESS_MODES = Object.freeze({
  EMBEDDED: 'EMBEDDED',
  FREE_CLAIM: 'FREE_CLAIM',
  PAID_ONCE: 'PAID_ONCE',
});

export const ITEM_BINDING_MODES = Object.freeze({
  EMBEDDED: 'EMBEDDED',
  ACCOUNT: 'ACCOUNT',
  SOUL_BOUND: 'SOUL_BOUND',
  OWNED: 'OWNED',
});

export const ITEM_RIGHTS_ORIGINS = Object.freeze({
  ONCHAIN_NATIVE: 'ONCHAIN_NATIVE',
  LICENSE_WRAPPED: 'LICENSE_WRAPPED',
});

export const CANVAS_ORIGINS = Object.freeze({
  TOP_LEFT: 'TOP_LEFT',
  CENTER: 'CENTER',
});

export const COORDINATE_UNITS = Object.freeze({
  PIXEL: 'PIXEL',
  NORMALIZED: 'NORMALIZED',
});

const SAFE_KEY = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,255}$/;
const HASH = /^(?:0x)?[0-9a-f]{64}$/i;
const MAX_CANVAS_SIDE = 32_768;
const MAX_PRICE_ATOMIC = 1_000_000_000_000;
const MAX_ECOSYSTEM_FEE_BPS = 1_000;
const MAX_ITEM_COMPONENTS = 256;
const MAX_ITEM_NAME_BYTES = 128;
const MAX_ITEM_DESCRIPTION_BYTES = 2_000;
const MAX_TRANSFORM_OFFSET = 1_000_000;
const MAX_TRANSFORM_SCALE = 1_000;
const MAX_TRANSFORM_ROTATION = 360_000;

export const ITEM_COMPONENT_BLEND_MODES = Object.freeze([
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
  'linear-dodge',
]);

const PROFILE_FIELDS = new Set([
  'schemaVersion',
  'mode',
  'loadoutMutable',
  'thirdPartyAdmission',
  'itemAssetization',
  'extensionsHash',
]);

const COMPATIBILITY_FIELDS = new Set([
  'schemaVersion',
  'makerRootId',
  'canvas',
  'coordinate',
  'renderer',
  'layerTrackIds',
  'slots',
  'maskPolicyHash',
  'rulesHash',
  'fallbackProductIds',
  'fallbackLoadoutHash',
  'manifestBlobId',
  'manifestHash',
  'extensionsHash',
]);

const CANVAS_FIELDS = new Set(['width', 'height']);
const COORDINATE_FIELDS = new Set(['origin', 'unit', 'pixelMode']);
const RENDERER_FIELDS = new Set(['version', 'commitment']);
const SLOT_FIELDS = new Set(['id', 'capacity', 'required', 'layerTrackIds']);

const ITEM_PRODUCT_FIELDS = new Set([
  'schemaVersion',
  'id',
  'version',
  'parentVersionId',
  'makerRootId',
  'compatibilityHash',
  'creator',
  'publisher',
  'originClass',
  'display',
  'components',
  'validation',
  'certification',
  'manifestBlobId',
  'manifestHash',
  'contentHash',
  'slotClaims',
  'requires',
  'excludes',
  'rightsOrigin',
  'rightsManifestHash',
  'access',
  'makerEcosystemFeeBps',
  'extensionsHash',
]);

const ITEM_DISPLAY_FIELDS = new Set([
  'name',
  'description',
  'thumbnailBlobId',
  'thumbnailHash',
]);
const ITEM_COMPONENT_FIELDS = new Set([
  'id',
  'layerTrackId',
  'assetBlobId',
  'assetHash',
  'assetWidth',
  'assetHeight',
  'transform',
  'baseSource',
]);
const ITEM_COMPONENT_TRANSFORM_FIELDS = new Set([
  'x',
  'y',
  'scale',
  'rotation',
  'opacity',
  'blendMode',
]);
const ITEM_COMPONENT_BASE_SOURCE_FIELDS = new Set([
  'partId',
  'itemId',
  'styleId',
]);
const VALIDATION_FIELDS = new Set(['passed', 'attestationId', 'epoch']);
const CERTIFICATION_FIELDS = new Set(['certifier', 'ownershipEpoch']);
const SLOT_CLAIM_FIELDS = new Set(['slotId', 'units']);
const ACCESS_FIELDS = new Set([
  'mode',
  'binding',
  'priceAtomic',
  'transferable',
]);

const ENTITLEMENT_FIELDS = new Set([
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

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
}

function integer(value, fallback = 0) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : fallback;
}

function nonNegativeInteger(value, fallback = 0, maximum = Number.MAX_SAFE_INTEGER) {
  const number = integer(value, fallback);
  return number >= 0 && number <= maximum ? number : fallback;
}

function positiveInteger(value, fallback = 1, maximum = Number.MAX_SAFE_INTEGER) {
  const number = integer(value, fallback);
  return number > 0 && number <= maximum ? number : fallback;
}

function string(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function utf8Length(value) {
  return new TextEncoder().encode(String(value || '')).length;
}

function enumValue(value, values, fallback) {
  return Object.values(values).includes(value) ? value : fallback;
}

function uniqueStrings(values) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => string(value).trim())
      .filter(Boolean),
  )];
}

function commitment(value) {
  const normalized = string(value).trim().toLowerCase();
  return normalized && HASH.test(normalized) ? normalized : '';
}

function issue(issues, path, code, message) {
  issues.push({ path, code, message });
}

function collectUnknownFields(issues, value, allowed, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  Object.keys(value).forEach((key) => {
    if (!allowed.has(key)) {
      issue(
        issues,
        path ? `${path}.${key}` : key,
        'unknown_schema_field',
        'This field is not part of the executable v6 schema. Commit future data through extensionsHash.',
      );
    }
  });
}

function collectCommitmentIssue(issues, value, path, { required = false } = {}) {
  if (!value) {
    if (required) {
      issue(issues, path, 'missing_commitment', 'A 32-byte hexadecimal commitment is required.');
    }
    return;
  }
  if (typeof value !== 'string' || !HASH.test(value)) {
    issue(issues, path, 'invalid_commitment', 'Commitments must be 32-byte hexadecimal hashes.');
  }
}

function collectSafeKeyIssue(issues, value, path, code = 'invalid_id') {
  if (typeof value !== 'string' || !SAFE_KEY.test(value)) {
    issue(issues, path, code, 'Use a non-empty stable identifier with safe URL and chain characters.');
  }
}

function collectUniqueIssues(issues, values, path, code) {
  const seen = new Set();
  values.forEach((value, index) => {
    if (seen.has(value)) {
      issue(issues, `${path}[${index}]`, code, 'Values in this list must be unique.');
    }
    seen.add(value);
  });
}

export function createComposableProfileV6(overrides = {}) {
  const source = object(overrides);
  const mode = enumValue(
    source.mode,
    COMPOSABLE_PROFILE_MODES,
    COMPOSABLE_PROFILE_MODES.FIXED,
  );
  const fixed = mode === COMPOSABLE_PROFILE_MODES.FIXED;
  return {
    schemaVersion: MAKER_COMPOSABLE_V6_SCHEMA_VERSION,
    mode,
    loadoutMutable: fixed ? false : true,
    thirdPartyAdmission: fixed
      ? THIRD_PARTY_ADMISSION_MODES.DISABLED
      : enumValue(
        source.thirdPartyAdmission,
        THIRD_PARTY_ADMISSION_MODES,
        THIRD_PARTY_ADMISSION_MODES.DISABLED,
      ),
    itemAssetization: fixed ? false : source.itemAssetization === true,
    extensionsHash: commitment(source.extensionsHash),
  };
}

export function collectComposableProfileV6Issues(value) {
  const issues = [];
  const profile = object(value);
  collectUnknownFields(issues, profile, PROFILE_FIELDS, 'profile');
  if (profile.schemaVersion !== MAKER_COMPOSABLE_V6_SCHEMA_VERSION) {
    issue(issues, 'profile.schemaVersion', 'invalid_profile_schema', 'Composable profile schema must be version 1.');
  }
  if (!Object.values(COMPOSABLE_PROFILE_MODES).includes(profile.mode)) {
    issue(issues, 'profile.mode', 'invalid_profile_mode', 'Choose Fixed or Composable.');
  }
  if (typeof profile.loadoutMutable !== 'boolean') {
    issue(issues, 'profile.loadoutMutable', 'invalid_loadout_mutability', 'Loadout mutability must be explicit.');
  }
  if (!Object.values(THIRD_PARTY_ADMISSION_MODES).includes(profile.thirdPartyAdmission)) {
    issue(issues, 'profile.thirdPartyAdmission', 'invalid_admission_mode', 'Choose disabled, certified or open admission.');
  }
  if (typeof profile.itemAssetization !== 'boolean') {
    issue(issues, 'profile.itemAssetization', 'invalid_item_assetization', 'Item assetization must be explicit.');
  }
  if (profile.mode === COMPOSABLE_PROFILE_MODES.FIXED) {
    if (profile.loadoutMutable !== false) {
      issue(issues, 'profile.loadoutMutable', 'fixed_loadout_must_be_immutable', 'Fixed Makers cannot update a Loadout after mint.');
    }
    if (profile.thirdPartyAdmission !== THIRD_PARTY_ADMISSION_MODES.DISABLED) {
      issue(issues, 'profile.thirdPartyAdmission', 'fixed_third_party_must_be_disabled', 'Fixed Makers publish only their embedded catalog.');
    }
    if (profile.itemAssetization !== false) {
      issue(issues, 'profile.itemAssetization', 'fixed_assetization_must_be_disabled', 'Fixed Makers do not issue independent Item assets.');
    }
  }
  if (
    profile.mode === COMPOSABLE_PROFILE_MODES.COMPOSABLE
    && profile.loadoutMutable !== true
  ) {
    issue(issues, 'profile.loadoutMutable', 'composable_loadout_must_be_mutable', 'Composable Makers must permit revisioned Loadout updates.');
  }
  collectCommitmentIssue(issues, profile.extensionsHash, 'profile.extensionsHash');
  return issues;
}

export function createCompatibilityProfileV6(overrides = {}) {
  const source = object(overrides);
  const canvas = object(source.canvas);
  const coordinate = object(source.coordinate);
  const renderer = object(source.renderer);
  return {
    schemaVersion: MAKER_COMPOSABLE_V6_SCHEMA_VERSION,
    makerRootId: string(source.makerRootId).trim(),
    canvas: {
      width: positiveInteger(canvas.width, 1024, MAX_CANVAS_SIDE),
      height: positiveInteger(canvas.height, 1024, MAX_CANVAS_SIDE),
    },
    coordinate: {
      origin: enumValue(coordinate.origin, CANVAS_ORIGINS, CANVAS_ORIGINS.TOP_LEFT),
      unit: enumValue(coordinate.unit, COORDINATE_UNITS, COORDINATE_UNITS.PIXEL),
      pixelMode: coordinate.pixelMode === true,
    },
    renderer: {
      version: string(renderer.version).trim(),
      commitment: commitment(renderer.commitment),
    },
    layerTrackIds: uniqueStrings(source.layerTrackIds),
    slots: (Array.isArray(source.slots) ? source.slots : []).map((entry) => {
      const slot = object(entry);
      return {
        id: string(slot.id).trim(),
        // v6 Move authorizes one Product per Maker-local Slot. More complex
        // occupancy is deliberately deferred to a reviewed schema upgrade.
        capacity: 1,
        required: slot.required === true,
        layerTrackIds: uniqueStrings(slot.layerTrackIds),
      };
    }),
    maskPolicyHash: commitment(source.maskPolicyHash),
    rulesHash: commitment(source.rulesHash),
    fallbackProductIds: uniqueStrings(source.fallbackProductIds),
    fallbackLoadoutHash: commitment(source.fallbackLoadoutHash),
    manifestBlobId: string(source.manifestBlobId).trim(),
    manifestHash: commitment(source.manifestHash),
    extensionsHash: commitment(source.extensionsHash),
  };
}

export function collectCompatibilityProfileV6Issues(
  value,
  {
    publish = false,
    requireManifestLocator = publish,
  } = {},
) {
  const issues = [];
  const profile = object(value);
  collectUnknownFields(issues, profile, COMPATIBILITY_FIELDS, 'compatibility');
  collectUnknownFields(issues, profile.canvas, CANVAS_FIELDS, 'compatibility.canvas');
  collectUnknownFields(issues, profile.coordinate, COORDINATE_FIELDS, 'compatibility.coordinate');
  collectUnknownFields(issues, profile.renderer, RENDERER_FIELDS, 'compatibility.renderer');
  (Array.isArray(profile.slots) ? profile.slots : []).forEach((slot, index) => {
    collectUnknownFields(issues, slot, SLOT_FIELDS, `compatibility.slots[${index}]`);
  });

  if (profile.schemaVersion !== MAKER_COMPOSABLE_V6_SCHEMA_VERSION) {
    issue(issues, 'compatibility.schemaVersion', 'invalid_compatibility_schema', 'Compatibility schema must be version 1.');
  }
  collectSafeKeyIssue(issues, profile.makerRootId, 'compatibility.makerRootId', 'invalid_maker_root');
  for (const side of ['width', 'height']) {
    const valueAtSide = profile.canvas?.[side];
    if (!Number.isSafeInteger(valueAtSide) || valueAtSide <= 0 || valueAtSide > MAX_CANVAS_SIDE) {
      issue(issues, `compatibility.canvas.${side}`, 'invalid_canvas_size', `Canvas ${side} must be between 1 and ${MAX_CANVAS_SIDE}.`);
    }
  }
  if (!Object.values(CANVAS_ORIGINS).includes(profile.coordinate?.origin)) {
    issue(issues, 'compatibility.coordinate.origin', 'invalid_canvas_origin', 'Choose a supported canvas origin.');
  }
  if (!Object.values(COORDINATE_UNITS).includes(profile.coordinate?.unit)) {
    issue(issues, 'compatibility.coordinate.unit', 'invalid_coordinate_unit', 'Choose pixel or normalized canvas units.');
  }
  if (typeof profile.coordinate?.pixelMode !== 'boolean') {
    issue(issues, 'compatibility.coordinate.pixelMode', 'invalid_pixel_mode', 'Pixel mode must be explicit.');
  }
  if (publish && !string(profile.renderer?.version).trim()) {
    issue(issues, 'compatibility.renderer.version', 'missing_renderer_version', 'A Renderer version is required for publication.');
  }
  collectCommitmentIssue(issues, profile.renderer?.commitment, 'compatibility.renderer.commitment', { required: publish });

  const layerTrackIds = Array.isArray(profile.layerTrackIds) ? profile.layerTrackIds : [];
  collectUniqueIssues(issues, layerTrackIds, 'compatibility.layerTrackIds', 'duplicate_layer_track');
  layerTrackIds.forEach((id, index) => collectSafeKeyIssue(
    issues,
    id,
    `compatibility.layerTrackIds[${index}]`,
    'invalid_layer_track',
  ));
  if (publish && layerTrackIds.length === 0) {
    issue(issues, 'compatibility.layerTrackIds', 'missing_layer_tracks', 'At least one Layer Track is required.');
  }

  const slots = Array.isArray(profile.slots) ? profile.slots : [];
  collectUniqueIssues(issues, slots.map((slot) => slot?.id), 'compatibility.slots', 'duplicate_slot');
  slots.forEach((slot, index) => {
    collectSafeKeyIssue(issues, slot?.id, `compatibility.slots[${index}].id`, 'invalid_slot');
    if (slot?.capacity !== 1) {
      issue(issues, `compatibility.slots[${index}].capacity`, 'invalid_slot_capacity', 'v6 Slots have an exact capacity of one Item Product.');
    }
    if (typeof slot?.required !== 'boolean') {
      issue(issues, `compatibility.slots[${index}].required`, 'invalid_required_slot', 'Required must be explicit.');
    }
    const slotTracks = Array.isArray(slot?.layerTrackIds) ? slot.layerTrackIds : [];
    collectUniqueIssues(issues, slotTracks, `compatibility.slots[${index}].layerTrackIds`, 'duplicate_slot_layer_track');
    slotTracks.forEach((trackId, trackIndex) => {
      if (!layerTrackIds.includes(trackId)) {
        issue(
          issues,
          `compatibility.slots[${index}].layerTrackIds[${trackIndex}]`,
          'unknown_slot_layer_track',
          'Slot Layer Tracks must be declared by this Compatibility Profile.',
        );
      }
    });
  });
  if (publish && slots.length === 0) {
    issue(issues, 'compatibility.slots', 'missing_slots', 'At least one Maker-local Slot is required.');
  }

  const fallbackProductIds = Array.isArray(profile.fallbackProductIds)
    ? profile.fallbackProductIds
    : [];
  collectUniqueIssues(issues, fallbackProductIds, 'compatibility.fallbackProductIds', 'duplicate_fallback_product');
  fallbackProductIds.forEach((id, index) => collectSafeKeyIssue(
    issues,
    id,
    `compatibility.fallbackProductIds[${index}]`,
    'invalid_fallback_product',
  ));
  if (publish && fallbackProductIds.length === 0) {
    issue(issues, 'compatibility.fallbackProductIds', 'missing_fallback_loadout', 'A complete free fallback Loadout is required.');
  }

  collectCommitmentIssue(issues, profile.maskPolicyHash, 'compatibility.maskPolicyHash', { required: publish });
  collectCommitmentIssue(issues, profile.rulesHash, 'compatibility.rulesHash', { required: publish });
  collectCommitmentIssue(issues, profile.fallbackLoadoutHash, 'compatibility.fallbackLoadoutHash', { required: publish });
  collectCommitmentIssue(issues, profile.manifestHash, 'compatibility.manifestHash', { required: publish });
  collectCommitmentIssue(issues, profile.extensionsHash, 'compatibility.extensionsHash');
  if (requireManifestLocator && !string(profile.manifestBlobId).trim()) {
    issue(issues, 'compatibility.manifestBlobId', 'missing_compatibility_manifest', 'The immutable Compatibility manifest Blob ID is required.');
  }
  return issues;
}

export function createItemProductV6(overrides = {}) {
  const source = object(overrides);
  const accessSource = object(source.access);
  const displaySource = object(source.display);
  const validationSource = object(source.validation);
  const certificationSource = source.certification === null
    ? null
    : object(source.certification);
  const binding = enumValue(
    accessSource.binding,
    ITEM_BINDING_MODES,
    ITEM_BINDING_MODES.EMBEDDED,
  );
  const embedded = binding === ITEM_BINDING_MODES.EMBEDDED;
  const mode = embedded
    ? ITEM_ACCESS_MODES.EMBEDDED
    : enumValue(accessSource.mode, ITEM_ACCESS_MODES, ITEM_ACCESS_MODES.FREE_CLAIM);
  const paid = mode === ITEM_ACCESS_MODES.PAID_ONCE;
  return {
    schemaVersion: MAKER_COMPOSABLE_V6_SCHEMA_VERSION,
    id: string(source.id).trim(),
    version: positiveInteger(source.version, 1),
    parentVersionId: string(source.parentVersionId).trim() || null,
    makerRootId: string(source.makerRootId).trim(),
    compatibilityHash: commitment(source.compatibilityHash),
    creator: string(source.creator).trim(),
    publisher: string(source.publisher).trim(),
    originClass: enumValue(
      source.originClass,
      ITEM_ORIGIN_CLASSES,
      ITEM_ORIGIN_CLASSES.OFFICIAL,
    ),
    display: {
      name: string(displaySource.name).trim(),
      description: string(displaySource.description).trim(),
      thumbnailBlobId: string(displaySource.thumbnailBlobId).trim(),
      thumbnailHash: commitment(displaySource.thumbnailHash),
    },
    components: (Array.isArray(source.components) ? source.components : [])
      .map((entry) => {
        const component = object(entry);
        const transform = object(component.transform);
        const baseSource = component.baseSource === null
          || component.baseSource === undefined
          ? null
          : object(component.baseSource);
        return {
          id: string(component.id).trim(),
          layerTrackId: string(component.layerTrackId).trim(),
          assetBlobId: string(component.assetBlobId).trim(),
          assetHash: commitment(component.assetHash),
          // These are the immutable source-PNG dimensions. The Renderer must
          // never derive placement or scale from the non-transparent bounds.
          assetWidth: positiveInteger(component.assetWidth, 0, MAX_CANVAS_SIDE),
          assetHeight: positiveInteger(component.assetHeight, 0, MAX_CANVAS_SIDE),
          transform: {
            x: finiteNumber(transform.x, 0),
            y: finiteNumber(transform.y, 0),
            scale: finiteNumber(transform.scale, 1),
            rotation: finiteNumber(transform.rotation, 0),
            opacity: finiteNumber(transform.opacity, 1),
            blendMode: ITEM_COMPONENT_BLEND_MODES.includes(transform.blendMode)
              ? transform.blendMode
              : 'normal',
          },
          baseSource: baseSource
            ? {
                partId: string(baseSource.partId).trim(),
                itemId: string(baseSource.itemId).trim(),
                styleId: string(baseSource.styleId).trim(),
              }
            : null,
        };
      }),
    validation: {
      passed: validationSource.passed === true,
      attestationId: string(validationSource.attestationId).trim(),
      epoch: nonNegativeInteger(validationSource.epoch),
    },
    certification: certificationSource === null
      ? null
      : {
        certifier: string(certificationSource.certifier).trim(),
        ownershipEpoch: nonNegativeInteger(certificationSource.ownershipEpoch),
      },
    manifestBlobId: string(source.manifestBlobId).trim(),
    manifestHash: commitment(source.manifestHash),
    contentHash: commitment(source.contentHash),
    slotClaims: (Array.isArray(source.slotClaims) ? source.slotClaims : []).map((entry) => {
      const claim = object(entry);
      return {
        slotId: string(claim.slotId).trim(),
        // The on-chain v6 selection record has one exact Slot and implicit
        // occupancy of one.
        units: 1,
      };
    }),
    requires: uniqueStrings(source.requires),
    excludes: uniqueStrings(source.excludes),
    rightsOrigin: enumValue(
      source.rightsOrigin,
      ITEM_RIGHTS_ORIGINS,
      ITEM_RIGHTS_ORIGINS.LICENSE_WRAPPED,
    ),
    rightsManifestHash: commitment(source.rightsManifestHash),
    access: {
      mode,
      binding,
      priceAtomic: paid
        ? nonNegativeInteger(accessSource.priceAtomic, 0, MAX_PRICE_ATOMIC)
        : 0,
      transferable: binding === ITEM_BINDING_MODES.OWNED
        && accessSource.transferable === true,
    },
    makerEcosystemFeeBps: nonNegativeInteger(
      source.makerEcosystemFeeBps,
      0,
      MAX_ECOSYSTEM_FEE_BPS,
    ),
    extensionsHash: commitment(source.extensionsHash),
  };
}

export function collectItemProductV6Issues(
  value,
  {
    profile,
    compatibility,
    makerOwner = '',
    currentOwnershipEpoch = 0,
    publish = false,
    requireTrustedValidation = publish,
    requireCertification = publish,
  } = {},
) {
  const issues = [];
  const product = object(value);
  collectUnknownFields(issues, product, ITEM_PRODUCT_FIELDS, 'product');
  collectUnknownFields(issues, product.display, ITEM_DISPLAY_FIELDS, 'product.display');
  (Array.isArray(product.components) ? product.components : []).forEach((component, index) => {
    collectUnknownFields(issues, component, ITEM_COMPONENT_FIELDS, `product.components[${index}]`);
    collectUnknownFields(
      issues,
      component?.transform,
      ITEM_COMPONENT_TRANSFORM_FIELDS,
      `product.components[${index}].transform`,
    );
    if (component?.baseSource !== null && component?.baseSource !== undefined) {
      collectUnknownFields(
        issues,
        component.baseSource,
        ITEM_COMPONENT_BASE_SOURCE_FIELDS,
        `product.components[${index}].baseSource`,
      );
    }
  });
  collectUnknownFields(issues, product.validation, VALIDATION_FIELDS, 'product.validation');
  if (product.certification !== null && product.certification !== undefined) {
    collectUnknownFields(issues, product.certification, CERTIFICATION_FIELDS, 'product.certification');
  }
  collectUnknownFields(issues, product.access, ACCESS_FIELDS, 'product.access');
  (Array.isArray(product.slotClaims) ? product.slotClaims : []).forEach((claim, index) => {
    collectUnknownFields(issues, claim, SLOT_CLAIM_FIELDS, `product.slotClaims[${index}]`);
  });

  if (product.schemaVersion !== MAKER_COMPOSABLE_V6_SCHEMA_VERSION) {
    issue(issues, 'product.schemaVersion', 'invalid_item_schema', 'Item Product schema must be version 1.');
  }
  collectSafeKeyIssue(issues, product.id, 'product.id', 'invalid_item_id');
  if (!Number.isSafeInteger(product.version) || product.version <= 0) {
    issue(issues, 'product.version', 'invalid_item_version', 'Item Product version must be a positive integer.');
  }
  if (product.parentVersionId !== null && product.parentVersionId !== undefined) {
    collectSafeKeyIssue(issues, product.parentVersionId, 'product.parentVersionId', 'invalid_parent_item_version');
  }
  collectSafeKeyIssue(issues, product.makerRootId, 'product.makerRootId', 'invalid_maker_root');
  collectCommitmentIssue(issues, product.compatibilityHash, 'product.compatibilityHash', { required: publish });
  collectSafeKeyIssue(issues, product.creator, 'product.creator', 'invalid_item_creator');
  collectSafeKeyIssue(issues, product.publisher, 'product.publisher', 'invalid_item_publisher');
  if (!Object.values(ITEM_ORIGIN_CLASSES).includes(product.originClass)) {
    issue(issues, 'product.originClass', 'invalid_item_origin', 'Choose Official, Certified or Open.');
  }

  const productComponents = Array.isArray(product.components) ? product.components : [];
  const officialBaseBacked = product.originClass === ITEM_ORIGIN_CLASSES.OFFICIAL
    && product.access?.mode === ITEM_ACCESS_MODES.EMBEDDED
    && product.access?.binding === ITEM_BINDING_MODES.EMBEDDED
    && productComponents.length > 0
    && productComponents.every((component) => component?.baseSource);

  const display = object(product.display);
  if (publish && !string(display.name).trim()) {
    issue(issues, 'product.display.name', 'missing_item_display_name', 'Published Item Products require a player-facing name.');
  }
  if (utf8Length(display.name) > MAX_ITEM_NAME_BYTES) {
    issue(issues, 'product.display.name', 'item_display_name_too_long', `Item Product names may use at most ${MAX_ITEM_NAME_BYTES} UTF-8 bytes.`);
  }
  if (publish && !string(display.description).trim()) {
    issue(issues, 'product.display.description', 'missing_item_description', 'Published Item Products require a player-facing description.');
  }
  if (utf8Length(display.description) > MAX_ITEM_DESCRIPTION_BYTES) {
    issue(issues, 'product.display.description', 'item_description_too_long', `Item Product descriptions may use at most ${MAX_ITEM_DESCRIPTION_BYTES} UTF-8 bytes.`);
  }
  if ((publish && !officialBaseBacked) || display.thumbnailBlobId) {
    collectSafeKeyIssue(
      issues,
      display.thumbnailBlobId,
      'product.display.thumbnailBlobId',
      'invalid_item_thumbnail_blob',
    );
  }
  collectCommitmentIssue(
    issues,
    display.thumbnailHash,
    'product.display.thumbnailHash',
    { required: publish && !officialBaseBacked },
  );

  const components = productComponents;
  if (publish && components.length === 0) {
    issue(issues, 'product.components', 'missing_item_components', 'A published Item Product must resolve at least one immutable render Component.');
  }
  if (components.length > MAX_ITEM_COMPONENTS) {
    issue(issues, 'product.components', 'too_many_item_components', `One Item Product may contain at most ${MAX_ITEM_COMPONENTS} simultaneous render Components.`);
  }
  collectUniqueIssues(
    issues,
    components.map((component) => component?.id),
    'product.components',
    'duplicate_item_component',
  );
  components.forEach((component, index) => {
    const path = `product.components[${index}]`;
    collectSafeKeyIssue(issues, component?.id, `${path}.id`, 'invalid_item_component_id');
    collectSafeKeyIssue(issues, component?.layerTrackId, `${path}.layerTrackId`, 'invalid_component_layer_track');
    const componentUsesBaseManifest = officialBaseBacked && component?.baseSource;
    if ((publish && !componentUsesBaseManifest) || component?.assetBlobId) {
      collectSafeKeyIssue(issues, component?.assetBlobId, `${path}.assetBlobId`, 'invalid_component_asset_blob');
    }
    collectCommitmentIssue(issues, component?.assetHash, `${path}.assetHash`, { required: publish });
    for (const field of ['assetWidth', 'assetHeight']) {
      if (!Number.isSafeInteger(component?.[field])
          || component[field] <= 0
          || component[field] > MAX_CANVAS_SIDE) {
        issue(
          issues,
          `${path}.${field}`,
          'invalid_component_asset_dimension',
          `Component source PNG ${field} must be a positive integer no greater than ${MAX_CANVAS_SIDE}; transparent bounds never replace the source dimensions.`,
        );
      }
    }
    const transform = object(component?.transform);
    for (const field of ['x', 'y']) {
      if (typeof transform[field] !== 'number'
          || !Number.isFinite(transform[field])
          || Math.abs(transform[field]) > MAX_TRANSFORM_OFFSET) {
        issue(issues, `${path}.transform.${field}`, 'invalid_component_offset', `Component ${field} must be a finite Maker-local offset within +/-${MAX_TRANSFORM_OFFSET}.`);
      }
    }
    if (typeof transform.scale !== 'number'
        || !Number.isFinite(transform.scale)
        || transform.scale <= 0
        || transform.scale > MAX_TRANSFORM_SCALE) {
      issue(issues, `${path}.transform.scale`, 'invalid_component_scale', `Component scale must be greater than zero and at most ${MAX_TRANSFORM_SCALE}.`);
    }
    if (typeof transform.rotation !== 'number'
        || !Number.isFinite(transform.rotation)
        || Math.abs(transform.rotation) > MAX_TRANSFORM_ROTATION) {
      issue(issues, `${path}.transform.rotation`, 'invalid_component_rotation', `Component rotation must be finite and within +/-${MAX_TRANSFORM_ROTATION} degrees.`);
    }
    if (typeof transform.opacity !== 'number'
        || !Number.isFinite(transform.opacity)
        || transform.opacity < 0
        || transform.opacity > 1) {
      issue(issues, `${path}.transform.opacity`, 'invalid_component_opacity', 'Component opacity must be between zero and one.');
    }
    if (!ITEM_COMPONENT_BLEND_MODES.includes(transform.blendMode)) {
      issue(issues, `${path}.transform.blendMode`, 'invalid_component_blend_mode', 'Component blend mode must be supported by the shared Renderer.');
    }
    if (component?.baseSource !== null && component?.baseSource !== undefined) {
      if (product.originClass !== ITEM_ORIGIN_CLASSES.OFFICIAL) {
        issue(issues, `${path}.baseSource`, 'external_component_cannot_use_base_source', 'Only Official embedded content may identify a base Maker Part, Item and Style source.');
      }
      for (const field of ['partId', 'itemId', 'styleId']) {
        collectSafeKeyIssue(
          issues,
          component.baseSource?.[field],
          `${path}.baseSource.${field}`,
          'invalid_component_base_source',
        );
      }
    }
  });

  if (typeof product.validation?.passed !== 'boolean') {
    issue(issues, 'product.validation.passed', 'invalid_validation_status', 'Compatibility and safety validation must be explicit.');
  }
  if (requireTrustedValidation && product.validation?.passed !== true) {
    issue(issues, 'product.validation.passed', 'validation_required', 'Every published Item must pass compatibility and safety validation.');
  }
  if (requireTrustedValidation && !string(product.validation?.attestationId).trim()) {
    issue(issues, 'product.validation.attestationId', 'validation_attestation_required', 'A validation attestation is required for publication.');
  }
  if (!Number.isSafeInteger(product.validation?.epoch) || product.validation.epoch < 0) {
    issue(issues, 'product.validation.epoch', 'invalid_validation_epoch', 'Validation epoch must be a non-negative integer.');
  }

  const productCertification = product.certification;
  if (product.originClass === ITEM_ORIGIN_CLASSES.OPEN) {
    if (productCertification !== null) {
      issue(issues, 'product.certification', 'open_item_cannot_be_certified', 'Open means validated but not endorsed by the Maker.');
    }
  } else if (requireCertification) {
    if (!productCertification || typeof productCertification !== 'object') {
      issue(issues, 'product.certification', 'maker_certification_required', 'Official and Certified Items snapshot the Maker authority epoch.');
    } else {
      if (string(productCertification.certifier) !== string(makerOwner)) {
        issue(issues, 'product.certification.certifier', 'stale_maker_certifier', 'The current Maker owner must issue this publication status.');
      }
      if (productCertification.ownershipEpoch !== currentOwnershipEpoch) {
        issue(issues, 'product.certification.ownershipEpoch', 'stale_certification_epoch', 'Certification must match the current Maker ownership epoch.');
      }
    }
  }

  const capabilityIssues = profile
    ? collectComposableProfileV6Issues(profile)
    : [];
  capabilityIssues.forEach((entry) => issue(
    issues,
    `product.target.${entry.path}`,
    entry.code,
    entry.message,
  ));
  if (profile) {
    if (
      profile.mode === COMPOSABLE_PROFILE_MODES.FIXED
      && product.access?.binding !== ITEM_BINDING_MODES.EMBEDDED
    ) {
      issue(issues, 'product.access.binding', 'fixed_item_must_be_embedded', 'Fixed Makers use only their embedded catalog.');
    }
    if (
      product.originClass === ITEM_ORIGIN_CLASSES.CERTIFIED
      && ![
        THIRD_PARTY_ADMISSION_MODES.CERTIFIED,
        THIRD_PARTY_ADMISSION_MODES.OPEN,
      ].includes(profile.thirdPartyAdmission)
    ) {
      issue(issues, 'product.originClass', 'certified_item_not_admitted', 'This Maker does not admit Certified third-party Items.');
    }
    if (
      product.originClass === ITEM_ORIGIN_CLASSES.OPEN
      && profile.thirdPartyAdmission !== THIRD_PARTY_ADMISSION_MODES.OPEN
    ) {
      issue(issues, 'product.originClass', 'open_item_not_admitted', 'Open Item publication requires an Open Maker profile.');
    }
    if (
      product.access?.binding === ITEM_BINDING_MODES.OWNED
      && profile.itemAssetization !== true
    ) {
      issue(issues, 'product.access.binding', 'owned_item_assetization_disabled', 'Owned Items require Maker Item assetization.');
    }
  }
  if (product.originClass === ITEM_ORIGIN_CLASSES.OFFICIAL && publish) {
    if (string(product.publisher) !== string(makerOwner)) {
      issue(issues, 'product.publisher', 'official_item_requires_maker_owner', 'Official Items are published by the current Maker owner.');
    }
  }
  if (
    [ITEM_ORIGIN_CLASSES.CERTIFIED, ITEM_ORIGIN_CLASSES.OPEN].includes(product.originClass)
    && publish
    && string(product.publisher) !== string(product.creator)
  ) {
    issue(issues, 'product.publisher', 'third_party_publisher_must_be_creator', 'Third-party Item publication must be finalized by its Creator.');
  }

  if (compatibility) {
    if (product.makerRootId !== compatibility.makerRootId) {
      issue(issues, 'product.makerRootId', 'item_maker_mismatch', 'Item Product must target this exact Maker Root.');
    }
    if (product.compatibilityHash !== compatibility.manifestHash) {
      issue(issues, 'product.compatibilityHash', 'item_compatibility_mismatch', 'Item Product must target this exact Compatibility commitment.');
    }
  }

  collectCommitmentIssue(issues, product.manifestHash, 'product.manifestHash', { required: publish });
  collectCommitmentIssue(issues, product.contentHash, 'product.contentHash', { required: publish });
  collectCommitmentIssue(issues, product.rightsManifestHash, 'product.rightsManifestHash', { required: publish });
  collectCommitmentIssue(issues, product.extensionsHash, 'product.extensionsHash');
  if (publish && !officialBaseBacked && !string(product.manifestBlobId).trim()) {
    issue(issues, 'product.manifestBlobId', 'missing_item_manifest', 'The immutable Item manifest Blob ID is required.');
  }
  if (!Object.values(ITEM_RIGHTS_ORIGINS).includes(product.rightsOrigin)) {
    issue(issues, 'product.rightsOrigin', 'invalid_item_rights_origin', 'Choose on-chain native or license-wrapped rights.');
  }

  const slotClaims = Array.isArray(product.slotClaims) ? product.slotClaims : [];
  collectUniqueIssues(issues, slotClaims.map((claim) => claim?.slotId), 'product.slotClaims', 'duplicate_slot_claim');
  const slotsById = new Map(
    (Array.isArray(compatibility?.slots) ? compatibility.slots : [])
      .map((slot) => [slot.id, slot]),
  );
  slotClaims.forEach((claim, index) => {
    collectSafeKeyIssue(issues, claim?.slotId, `product.slotClaims[${index}].slotId`, 'invalid_slot_claim');
    if (claim?.units !== 1) {
      issue(issues, `product.slotClaims[${index}].units`, 'invalid_slot_units', 'v6 Item Products occupy exactly one unit in one Slot.');
    }
    if (compatibility) {
      const slot = slotsById.get(claim?.slotId);
      if (!slot) {
        issue(issues, `product.slotClaims[${index}].slotId`, 'unknown_item_slot', 'Item Product claims an undeclared Maker-local Slot.');
      }
    }
  });
  if (slotClaims.length !== 1) {
    issue(issues, 'product.slotClaims', 'item_requires_exactly_one_slot', 'A v6 Item Product must claim exactly one Maker-local Slot.');
  }
  const claimedSlot = slotClaims.length === 1
    ? slotsById.get(slotClaims[0]?.slotId)
    : null;
  if (claimedSlot) {
    components.forEach((component, index) => {
      if (!claimedSlot.layerTrackIds.includes(component?.layerTrackId)) {
        issue(
          issues,
          `product.components[${index}].layerTrackId`,
          'component_track_outside_claimed_slot',
          'Every render Component Layer Track must belong to the Item Product\'s one claimed Slot.',
        );
      }
    });
  }

  const requires = Array.isArray(product.requires) ? product.requires : [];
  const excludes = Array.isArray(product.excludes) ? product.excludes : [];
  collectUniqueIssues(issues, requires, 'product.requires', 'duplicate_requirement');
  collectUniqueIssues(issues, excludes, 'product.excludes', 'duplicate_exclusion');
  requires.forEach((id, index) => collectSafeKeyIssue(issues, id, `product.requires[${index}]`, 'invalid_requirement'));
  excludes.forEach((id, index) => collectSafeKeyIssue(issues, id, `product.excludes[${index}]`, 'invalid_exclusion'));
  if (requires.includes(product.id) || excludes.includes(product.id)) {
    issue(issues, 'product', 'self_referential_item_rule', 'An Item Product cannot require or exclude itself.');
  }
  requires.filter((id) => excludes.includes(id)).forEach((id) => {
    issue(issues, 'product', 'contradictory_item_rule', `Item Product cannot both require and exclude ${id}.`);
  });

  if (!Object.values(ITEM_ACCESS_MODES).includes(product.access?.mode)) {
    issue(issues, 'product.access.mode', 'invalid_item_access', 'Choose embedded, free claim or paid once.');
  }
  if (!Object.values(ITEM_BINDING_MODES).includes(product.access?.binding)) {
    issue(issues, 'product.access.binding', 'invalid_item_binding', 'Choose embedded, account, Soul-bound or owned.');
  }
  if (
    product.access?.binding === ITEM_BINDING_MODES.EMBEDDED
    && product.access?.mode !== ITEM_ACCESS_MODES.EMBEDDED
  ) {
    issue(issues, 'product.access', 'embedded_access_mismatch', 'Embedded Items do not issue a separate claim or purchase entitlement.');
  }
  if (
    product.access?.binding !== ITEM_BINDING_MODES.EMBEDDED
    && product.access?.mode === ITEM_ACCESS_MODES.EMBEDDED
  ) {
    issue(issues, 'product.access', 'entitlement_access_mismatch', 'Non-embedded Items must be claimed or purchased.');
  }
  if (product.access?.mode === ITEM_ACCESS_MODES.PAID_ONCE) {
    if (!Number.isSafeInteger(product.access.priceAtomic) || product.access.priceAtomic <= 0 || product.access.priceAtomic > MAX_PRICE_ATOMIC) {
      issue(issues, 'product.access.priceAtomic', 'invalid_item_price', 'Paid Items require a positive bounded fixed price.');
    }
  } else if (product.access?.priceAtomic !== 0) {
    issue(issues, 'product.access.priceAtomic', 'free_item_has_price', 'Embedded and free-claim Items must have zero price.');
  }
  if (
    product.access?.transferable === true
    && product.access?.binding !== ITEM_BINDING_MODES.OWNED
  ) {
    issue(issues, 'product.access.transferable', 'only_owned_items_transfer', 'Only independently owned Items can transfer.');
  }
  if (!Number.isSafeInteger(product.makerEcosystemFeeBps)
      || product.makerEcosystemFeeBps < 0
      || product.makerEcosystemFeeBps > MAX_ECOSYSTEM_FEE_BPS) {
    issue(issues, 'product.makerEcosystemFeeBps', 'invalid_maker_ecosystem_fee', `Maker ecosystem fee must be between 0 and ${MAX_ECOSYSTEM_FEE_BPS} bps.`);
  }
  return issues;
}

export function createItemEntitlementV6(productValue, overrides = {}) {
  const product = object(productValue);
  const source = object(overrides);
  const binding = product.access?.binding;
  return {
    schemaVersion: MAKER_COMPOSABLE_V6_SCHEMA_VERSION,
    id: string(source.id).trim(),
    productId: string(product.id).trim(),
    itemVersion: positiveInteger(product.version, 1),
    makerRootId: string(product.makerRootId).trim(),
    compatibilityHash: commitment(product.compatibilityHash),
    binding,
    holderAddress: binding === ITEM_BINDING_MODES.ACCOUNT
      ? string(source.holderAddress).trim()
      : null,
    soulId: binding === ITEM_BINDING_MODES.SOUL_BOUND
      ? string(source.soulId).trim()
      : null,
    ownerAddress: binding === ITEM_BINDING_MODES.OWNED
      ? string(source.ownerAddress).trim()
      : null,
    equippedSoulId: binding === ITEM_BINDING_MODES.OWNED
      ? string(source.equippedSoulId).trim() || null
      : null,
    issuedAtMs: nonNegativeInteger(source.issuedAtMs),
    paidAtomic: nonNegativeInteger(source.paidAtomic, 0, MAX_PRICE_ATOMIC),
    rightsSnapshotHash: commitment(source.rightsSnapshotHash || product.rightsManifestHash),
    issuanceNonce: string(source.issuanceNonce).trim(),
    extensionsHash: commitment(source.extensionsHash),
  };
}

export function collectItemEntitlementV6Issues(value, { product } = {}) {
  const issues = [];
  const entitlement = object(value);
  collectUnknownFields(issues, entitlement, ENTITLEMENT_FIELDS, 'entitlement');
  if (entitlement.schemaVersion !== MAKER_COMPOSABLE_V6_SCHEMA_VERSION) {
    issue(issues, 'entitlement.schemaVersion', 'invalid_entitlement_schema', 'Item Entitlement schema must be version 1.');
  }
  collectSafeKeyIssue(issues, entitlement.id, 'entitlement.id', 'invalid_entitlement_id');
  collectSafeKeyIssue(issues, entitlement.productId, 'entitlement.productId', 'invalid_entitlement_product');
  collectSafeKeyIssue(issues, entitlement.makerRootId, 'entitlement.makerRootId', 'invalid_maker_root');
  collectCommitmentIssue(issues, entitlement.compatibilityHash, 'entitlement.compatibilityHash', { required: true });
  collectCommitmentIssue(issues, entitlement.rightsSnapshotHash, 'entitlement.rightsSnapshotHash', { required: true });
  collectCommitmentIssue(issues, entitlement.extensionsHash, 'entitlement.extensionsHash');
  if (!Object.values(ITEM_BINDING_MODES).includes(entitlement.binding)) {
    issue(issues, 'entitlement.binding', 'invalid_entitlement_binding', 'Entitlement binding is invalid.');
  }
  if (entitlement.binding === ITEM_BINDING_MODES.EMBEDDED) {
    issue(issues, 'entitlement.binding', 'embedded_item_has_no_entitlement', 'Embedded Items are derived directly from the Maker catalog.');
  }
  if (entitlement.binding === ITEM_BINDING_MODES.ACCOUNT) {
    collectSafeKeyIssue(issues, entitlement.holderAddress, 'entitlement.holderAddress', 'missing_account_holder');
    if (entitlement.soulId !== null || entitlement.ownerAddress !== null || entitlement.equippedSoulId !== null) {
      issue(issues, 'entitlement', 'account_entitlement_has_foreign_holder', 'Account entitlement may only identify its holder address.');
    }
  }
  if (entitlement.binding === ITEM_BINDING_MODES.SOUL_BOUND) {
    collectSafeKeyIssue(issues, entitlement.soulId, 'entitlement.soulId', 'missing_soul_holder');
    if (entitlement.holderAddress !== null || entitlement.ownerAddress !== null || entitlement.equippedSoulId !== null) {
      issue(issues, 'entitlement', 'soul_entitlement_has_foreign_holder', 'Soul-bound entitlement may only identify its Soul.');
    }
  }
  if (entitlement.binding === ITEM_BINDING_MODES.OWNED) {
    collectSafeKeyIssue(issues, entitlement.ownerAddress, 'entitlement.ownerAddress', 'missing_item_owner');
    if (entitlement.holderAddress !== null || entitlement.soulId !== null) {
      issue(issues, 'entitlement', 'owned_entitlement_has_foreign_holder', 'Owned entitlement may only identify its owner and optional equipped Soul.');
    }
    if (entitlement.equippedSoulId !== null) {
      collectSafeKeyIssue(issues, entitlement.equippedSoulId, 'entitlement.equippedSoulId', 'invalid_equipped_soul');
    }
  }
  if (!Number.isSafeInteger(entitlement.itemVersion) || entitlement.itemVersion <= 0) {
    issue(issues, 'entitlement.itemVersion', 'invalid_entitlement_version', 'Entitlement must pin a positive Item Product version.');
  }
  if (!Number.isSafeInteger(entitlement.issuedAtMs) || entitlement.issuedAtMs < 0) {
    issue(issues, 'entitlement.issuedAtMs', 'invalid_entitlement_timestamp', 'Issued time must be a non-negative integer.');
  }
  if (!Number.isSafeInteger(entitlement.paidAtomic) || entitlement.paidAtomic < 0 || entitlement.paidAtomic > MAX_PRICE_ATOMIC) {
    issue(issues, 'entitlement.paidAtomic', 'invalid_entitlement_payment', 'Paid amount must be a non-negative bounded integer.');
  }
  if (!string(entitlement.issuanceNonce).trim()) {
    issue(issues, 'entitlement.issuanceNonce', 'missing_issuance_nonce', 'Entitlement issuance requires a recovery-safe nonce.');
  }
  if (product) {
    if (entitlement.productId !== product.id
        || entitlement.itemVersion !== product.version
        || entitlement.makerRootId !== product.makerRootId
        || entitlement.compatibilityHash !== product.compatibilityHash) {
      issue(issues, 'entitlement', 'entitlement_product_mismatch', 'Entitlement must pin the exact Item Product identity.');
    }
    if (entitlement.binding !== product.access?.binding) {
      issue(issues, 'entitlement.binding', 'entitlement_binding_mismatch', 'Entitlement binding must match the published Item Product.');
    }
    if (entitlement.rightsSnapshotHash !== product.rightsManifestHash) {
      issue(issues, 'entitlement.rightsSnapshotHash', 'rights_snapshot_mismatch', 'Entitlement must snapshot the published Rights Manifest.');
    }
  }
  return issues;
}

function entitlementUsableForContext(entitlement, { ownerAddress, soulId }) {
  if (entitlement.binding === ITEM_BINDING_MODES.ACCOUNT) {
    return entitlement.holderAddress === ownerAddress;
  }
  if (entitlement.binding === ITEM_BINDING_MODES.SOUL_BOUND) {
    return Boolean(soulId) && entitlement.soulId === soulId;
  }
  if (entitlement.binding === ITEM_BINDING_MODES.OWNED) {
    return entitlement.ownerAddress === ownerAddress
      && (!entitlement.equippedSoulId || entitlement.equippedSoulId === soulId);
  }
  return false;
}

export function deriveInventoryV6({
  products = [],
  entitlements = [],
  makerRootId = '',
  compatibilityHash = '',
  ownerAddress = '',
  soulId = '',
} = {}) {
  const productById = new Map(
    (Array.isArray(products) ? products : [])
      .filter((product) => product?.makerRootId === makerRootId)
      .filter((product) => !compatibilityHash || product?.compatibilityHash === compatibilityHash)
      .map((product) => [product.id, product]),
  );
  const result = [];
  productById.forEach((product) => {
    if (product.access?.binding === ITEM_BINDING_MODES.EMBEDDED) {
      result.push({
        productId: product.id,
        entitlementId: null,
        binding: ITEM_BINDING_MODES.EMBEDDED,
        product,
      });
    }
  });
  (Array.isArray(entitlements) ? entitlements : []).forEach((entitlement) => {
    const product = productById.get(entitlement?.productId);
    if (!product) return;
    if (collectItemEntitlementV6Issues(entitlement, { product }).length > 0) return;
    if (!entitlementUsableForContext(entitlement, { ownerAddress, soulId })) return;
    result.push({
      productId: product.id,
      entitlementId: entitlement.id,
      binding: entitlement.binding,
      product,
    });
  });
  return result;
}

function selectedInventoryEntry(inventory, selection) {
  if (typeof selection === 'string') {
    return inventory.find((entry) => entry.productId === selection) || null;
  }
  if (!selection || typeof selection !== 'object') return null;
  return inventory.find((entry) => (
    entry.productId === selection.productId
    && (selection.entitlementId === undefined
      || selection.entitlementId === entry.entitlementId)
  )) || null;
}

export function validateLoadoutV6({
  profile,
  compatibility,
  products = [],
  entitlements = [],
  selected = [],
  ownerAddress = '',
  soulId = '',
  postMint = false,
  transferSafe = false,
} = {}) {
  const issues = [];
  if (
    postMint
    && (
      profile?.mode !== COMPOSABLE_PROFILE_MODES.COMPOSABLE
      || profile?.loadoutMutable !== true
    )
  ) {
    issue(issues, 'loadout', 'fixed_loadout_immutable', 'This Maker does not permit post-mint Loadout changes.');
  }
  const inventory = deriveInventoryV6({
    products,
    entitlements,
    makerRootId: compatibility?.makerRootId || '',
    compatibilityHash: compatibility?.manifestHash || '',
    ownerAddress,
    soulId,
  });
  const selectionList = Array.isArray(selected) ? selected : [];
  const resolved = [];
  selectionList.forEach((selection, index) => {
    const entry = selectedInventoryEntry(inventory, selection);
    if (!entry) {
      issue(issues, `loadout.selected[${index}]`, 'item_not_in_inventory', 'Selected Item is not usable by this account or Soul.');
      return;
    }
    resolved.push(entry);
  });
  const selectedIds = resolved.map((entry) => entry.productId);
  collectUniqueIssues(issues, selectedIds, 'loadout.selected', 'duplicate_loadout_item');
  const selectedSet = new Set(selectedIds);
  const occupancy = {};
  const slotById = new Map(
    (Array.isArray(compatibility?.slots) ? compatibility.slots : [])
      .map((slot) => [slot.id, slot]),
  );

  resolved.forEach((entry, index) => {
    const product = entry.product;
    (Array.isArray(product.slotClaims) ? product.slotClaims : []).forEach((claim) => {
      occupancy[claim.slotId] = (occupancy[claim.slotId] || 0) + claim.units;
    });
    (Array.isArray(product.requires) ? product.requires : []).forEach((requiredId) => {
      if (!selectedSet.has(requiredId)) {
        issue(issues, `loadout.selected[${index}]`, 'missing_required_item', `${product.id} requires ${requiredId}.`);
      }
    });
    (Array.isArray(product.excludes) ? product.excludes : []).forEach((excludedId) => {
      if (selectedSet.has(excludedId)) {
        issue(issues, `loadout.selected[${index}]`, 'excluded_item_selected', `${product.id} cannot combine with ${excludedId}.`);
      }
    });
    if (
      transferSafe
      && ![
        ITEM_BINDING_MODES.EMBEDDED,
        ITEM_BINDING_MODES.SOUL_BOUND,
      ].includes(entry.binding)
    ) {
      issue(issues, `loadout.selected[${index}]`, 'loadout_not_transfer_safe', 'Account-licensed and independently owned Items must be removed before Soul transfer.');
    }
  });

  Object.entries(occupancy).forEach(([slotId, used]) => {
    const slot = slotById.get(slotId);
    if (!slot) {
      issue(issues, `loadout.slots.${slotId}`, 'unknown_loadout_slot', 'Loadout uses an undeclared Slot.');
    } else if (used > slot.capacity) {
      issue(issues, `loadout.slots.${slotId}`, 'slot_capacity_exceeded', `${slotId} uses ${used} of ${slot.capacity} allowed units.`);
    }
  });
  slotById.forEach((slot, slotId) => {
    if (slot.required === true && !occupancy[slotId]) {
      issue(issues, `loadout.slots.${slotId}`, 'required_slot_empty', `Required Slot ${slotId} is empty.`);
    }
  });
  return {
    valid: issues.length === 0,
    issues,
    occupancy,
    resolved,
  };
}

export function isTransferSafeLoadoutV6(options = {}) {
  const result = validateLoadoutV6({ ...options, transferSafe: true });
  return result.valid;
}

export function canTransferOwnedEntitlementV6(entitlement, product) {
  return Boolean(
    entitlement
    && product
    && entitlement.binding === ITEM_BINDING_MODES.OWNED
    && product.access?.binding === ITEM_BINDING_MODES.OWNED
    && product.access?.transferable === true
    && !entitlement.equippedSoulId
    && collectItemEntitlementV6Issues(entitlement, { product }).length === 0
  );
}
