/**
 * Additive bridge between a Maker v5 editor document and the independent
 * `animacraft.maker-composable.v6` companion manifest.
 *
 * The editable v6 draft lives only at `document.extensions.composableV6`.
 * Maker v5 publication continues to use its existing allowlist and therefore
 * never copies this private draft into the immutable base Maker manifest.
 */

import {
  COMPOSABLE_PROFILE_MODES,
  ITEM_ACCESS_MODES,
  ITEM_BINDING_MODES,
  ITEM_ORIGIN_CLASSES,
  MAKER_COMPOSABLE_V6_SCHEMA,
  collectCompatibilityProfileV6Issues,
  collectComposableProfileV6Issues,
  collectItemProductV6Issues,
  createCompatibilityProfileV6,
  createComposableProfileV6,
  createItemProductV6,
  validateLoadoutV6,
} from './maker-composable-v6.js';

export const MAKER_COMPOSABLE_V6_DRAFT_SCHEMA = 'animacraft.maker-composable-draft.v6';
export const MAKER_COMPOSABLE_V6_EXTENSION_KEY = 'composableV6';
export const MAKER_COMPOSABLE_V6_BASE_SCHEMA = 'animacraft.maker.v5';
export const MAKER_COMPATIBILITY_DEFINITION_V6_SCHEMA =
  'animacraft.compatibility-definition.v6';
export const ITEM_PRODUCT_DEFINITION_V6_SCHEMA =
  'animacraft.item-product-definition.v6';

const HASH = /^(?:0x)?[0-9a-f]{64}$/i;
const SAFE_KEY = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,255}$/;
const DRAFT_FIELDS = new Set([
  'schemaVersion',
  'profile',
  'compatibility',
  'compatibilitySealed',
  'items',
  'extensionsHash',
]);

export class MakerComposableV6BridgeError extends Error {
  constructor(message, code = 'maker-composable-v6-bridge-error', details = {}) {
    super(message);
    this.name = 'MakerComposableV6BridgeError';
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

function string(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function commitment(value) {
  const normalized = string(value).toLowerCase();
  return HASH.test(normalized) ? normalized : '';
}

function issue(issues, path, code, message) {
  issues.push({ path, code, message });
}

function prefixedIssue(issues, entry, prefix = 'extensions.composableV6') {
  issue(
    issues,
    entry.path ? `${prefix}.${entry.path}` : prefix,
    entry.code,
    entry.message,
  );
}

function rawDraftFrom(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (Object.hasOwn(value, 'extensions')) {
    const extension = value.extensions?.[MAKER_COMPOSABLE_V6_EXTENSION_KEY];
    return extension && typeof extension === 'object' && !Array.isArray(extension)
      ? extension
      : null;
  }
  return value;
}

function documentFrom(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.hasOwn(value, 'extensions')
    ? value
    : null;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])]),
  );
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function hex(bytes) {
  return [...new Uint8Array(bytes)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256Bytes(bytes) {
  if (!globalThis.crypto?.subtle) {
    throw new MakerComposableV6BridgeError(
      'SHA-256 is unavailable in this runtime.',
      'sha256-unavailable',
    );
  }
  return hex(await globalThis.crypto.subtle.digest('SHA-256', bytes));
}

async function hashStableValue(value) {
  return sha256Bytes(new TextEncoder().encode(stableJson(value)));
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

/**
 * Canonical compatibility bytes committed on Sui. Walrus locators and the
 * commitment itself are deliberately excluded so moving the same bytes does
 * not change their identity and a draft cannot self-assert its own hash.
 */
export function createCompatibilityDefinitionV6(value) {
  const profile = createCompatibilityProfileV6(value);
  return stableValue({
    schemaVersion: MAKER_COMPATIBILITY_DEFINITION_V6_SCHEMA,
    makerRootId: profile.makerRootId,
    canvas: profile.canvas,
    coordinate: profile.coordinate,
    renderer: profile.renderer,
    layerTrackIds: profile.layerTrackIds,
    slots: profile.slots,
    maskPolicyHash: profile.maskPolicyHash,
    rulesHash: profile.rulesHash,
    fallbackProductIds: profile.fallbackProductIds,
    fallbackLoadoutHash: profile.fallbackLoadoutHash,
    extensionsHash: profile.extensionsHash,
  });
}

/**
 * Canonical ProductDefinition committed on Sui. Transport locators,
 * validation readback, Maker certification and manifestHash are not
 * executable definition bytes and therefore never participate in the hash.
 */
export function createItemProductDefinitionV6(value) {
  const product = createItemProductV6(value);
  return stableValue({
    schemaVersion: ITEM_PRODUCT_DEFINITION_V6_SCHEMA,
    id: product.id,
    version: product.version,
    parentVersionId: product.parentVersionId,
    makerRootId: product.makerRootId,
    compatibilityHash: product.compatibilityHash,
    creator: product.creator,
    publisher: product.publisher,
    originClass: product.originClass,
    display: {
      name: product.display.name,
      description: product.display.description,
      thumbnailHash: product.display.thumbnailHash,
    },
    components: product.components.map((component) => ({
      id: component.id,
      layerTrackId: component.layerTrackId,
      assetHash: component.assetHash,
      assetWidth: component.assetWidth,
      assetHeight: component.assetHeight,
      transform: component.transform,
      baseSource: component.baseSource,
    })),
    contentHash: product.contentHash,
    slotClaims: product.slotClaims,
    requires: product.requires,
    excludes: product.excludes,
    rightsOrigin: product.rightsOrigin,
    rightsManifestHash: product.rightsManifestHash,
    access: product.access,
    makerEcosystemFeeBps: product.makerEcosystemFeeBps,
    extensionsHash: product.extensionsHash,
  });
}

export async function hashCompatibilityDefinitionV6(value) {
  return hashStableValue(createCompatibilityDefinitionV6(value));
}

export async function hashItemProductDefinitionV6(value) {
  return hashStableValue(createItemProductDefinitionV6(value));
}

function collectUnknownDraftFields(issues, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  Object.keys(value).forEach((key) => {
    if (!DRAFT_FIELDS.has(key)) {
      issue(
        issues,
        `extensions.composableV6.${key}`,
        'unknown_companion_draft_field',
        'This field is not part of the v6 companion draft. Commit future data through extensionsHash.',
      );
    }
  });
}

function collectBaseReferenceIssues(
  issues,
  document,
  {
    baseManifest,
    baseMakerRootId,
    baseManifestHash,
  },
) {
  const manifest = object(baseManifest);
  const manifestVersion = object(manifest.version);
  const documentVersion = object(document?.version);
  const rootId = string(baseMakerRootId);

  if (manifest.schemaVersion !== MAKER_COMPOSABLE_V6_BASE_SCHEMA) {
    issue(
      issues,
      'baseMaker.manifestSchemaVersion',
      'invalid_base_manifest_schema',
      `The companion must reference an ${MAKER_COMPOSABLE_V6_BASE_SCHEMA} base manifest.`,
    );
  }
  if (!SAFE_KEY.test(rootId)) {
    issue(
      issues,
      'baseMaker.makerRootId',
      'missing_base_maker_root',
      'The exact on-chain MakerRootV5 object ID is required.',
    );
  }
  for (const [field, code] of [
    ['rootMakerId', 'invalid_base_family_id'],
    ['versionId', 'invalid_base_version_id'],
  ]) {
    if (!SAFE_KEY.test(string(manifestVersion[field]))) {
      issue(
        issues,
        `baseMaker.${field}`,
        code,
        'The base Maker manifest must contain a stable version identity.',
      );
    }
  }
  if (!Number.isSafeInteger(manifestVersion.number) || manifestVersion.number <= 0) {
    issue(
      issues,
      'baseMaker.versionNumber',
      'invalid_base_version_number',
      'The base Maker version number must be a positive integer.',
    );
  }
  if (!HASH.test(string(baseManifestHash))) {
    issue(
      issues,
      'baseMaker.manifestHash',
      'missing_base_manifest_hash',
      'The exact SHA-256 hash of the immutable base Maker manifest is required.',
    );
  }

  if (document && Object.keys(documentVersion).length) {
    for (const field of ['rootMakerId', 'versionId', 'number']) {
      if (documentVersion[field] !== manifestVersion[field]) {
        issue(
          issues,
          `baseMaker.${field}`,
          'base_document_version_mismatch',
          'The companion and base publication must be built from the same Maker document version.',
        );
      }
    }
  }
}

function collectFallbackIssues(issues, draft, { deferDependencyGraph = false } = {}) {
  const products = Array.isArray(draft.items) ? draft.items : [];
  const fallbackIds = Array.isArray(draft.compatibility?.fallbackProductIds)
    ? draft.compatibility.fallbackProductIds
    : [];
  const productsById = new Map(products.map((product) => [product.id, product]));

  fallbackIds.forEach((productId, index) => {
    const product = productsById.get(productId);
    const path = `extensions.composableV6.compatibility.fallbackProductIds[${index}]`;
    if (!product) {
      issue(
        issues,
        path,
        'missing_fallback_product',
        'Every fallback reference must resolve to a published Item Product.',
      );
      return;
    }
    if (
      product.originClass !== ITEM_ORIGIN_CLASSES.OFFICIAL
      || product.access?.mode !== ITEM_ACCESS_MODES.EMBEDDED
      || product.access?.binding !== ITEM_BINDING_MODES.EMBEDDED
      || product.access?.priceAtomic !== 0
    ) {
      issue(
        issues,
        path,
        'fallback_product_not_free_embedded_official',
        'The release fallback must use validated Official Items embedded for free in the base Maker.',
      );
    }
  });

  const result = validateLoadoutV6({
    profile: draft.profile,
    compatibility: draft.compatibility,
    products,
    selected: fallbackIds,
    transferSafe: true,
  });
  result.issues
    .filter((entry) => !deferDependencyGraph || ![
      'missing_required_item',
      'excluded_item_selected',
    ].includes(entry.code))
    .forEach((entry) => prefixedIssue(
    issues,
    entry,
    'extensions.composableV6.fallbackLoadout',
  ));
}

function collectBaseSourceIssues(issues, draft, baseManifest) {
  const parts = Array.isArray(baseManifest?.parts) ? baseManifest.parts : [];
  const assets = Array.isArray(baseManifest?.assets) ? baseManifest.assets : [];
  draft.items.forEach((product, productIndex) => {
    product.components.forEach((component, componentIndex) => {
      if (!component.baseSource) return;
      const path = `extensions.composableV6.items[${productIndex}].components[${componentIndex}].baseSource`;
      const part = parts.find((entry) => entry?.id === component.baseSource.partId);
      const item = part?.items?.find((entry) => entry?.id === component.baseSource.itemId);
      const style = item?.styles?.find((entry) => entry?.id === component.baseSource.styleId);
      if (!style) {
        issue(
          issues,
          path,
          'missing_component_base_source',
          'Official baseSource must resolve to one exact Part, Item and Style in the immutable base Maker manifest.',
        );
        return;
      }
      if (style.layerTrackId !== component.layerTrackId) {
        issue(
          issues,
          `${path}.styleId`,
          'component_base_source_track_mismatch',
          'The referenced base Style and v6 Component must use the same Layer Track.',
        );
      }
      const asset = assets.find((entry) => entry?.id === style.assetId);
      if (!asset) {
        issue(
          issues,
          `${path}.styleId`,
          'missing_component_base_asset',
          'The referenced base Style PNG must exist in the exact immutable base Maker manifest.',
        );
        return;
      }
      for (const field of ['width', 'height']) {
        if (!Number.isSafeInteger(asset[field]) || asset[field] <= 0) {
          issue(
            issues,
            `${path}.styleId`,
            'missing_component_base_asset_dimensions',
            'The referenced base Style PNG requires exact source width and height.',
          );
          break;
        }
      }
    });
  });
}

function findBaseStyleAndAsset(baseManifest, baseSource) {
  const part = (Array.isArray(baseManifest?.parts) ? baseManifest.parts : [])
    .find((entry) => entry?.id === baseSource?.partId);
  const item = (Array.isArray(part?.items) ? part.items : [])
    .find((entry) => entry?.id === baseSource?.itemId);
  const style = (Array.isArray(item?.styles) ? item.styles : [])
    .find((entry) => entry?.id === baseSource?.styleId);
  const asset = (Array.isArray(baseManifest?.assets) ? baseManifest.assets : [])
    .find((entry) => entry?.id === style?.assetId);
  return { style, asset };
}

function canonicalRulesSource(baseManifest) {
  return (Array.isArray(baseManifest?.parts) ? baseManifest.parts : []).map((part) => ({
    id: string(part?.id),
    visibleWhen: clone(part?.visibleWhen ?? null),
    requires: clone(Array.isArray(part?.requires) ? part.requires : []),
    excludes: clone(Array.isArray(part?.excludes) ? part.excludes : []),
    items: (Array.isArray(part?.items) ? part.items : []).map((item) => ({
      id: string(item?.id),
      visibleWhen: clone(item?.visibleWhen ?? null),
      requires: clone(Array.isArray(item?.requires) ? item.requires : []),
      excludes: clone(Array.isArray(item?.excludes) ? item.excludes : []),
      styles: (Array.isArray(item?.styles) ? item.styles : []).map((style) => ({
        id: string(style?.id),
        visibleWhen: clone(style?.visibleWhen ?? null),
        requires: clone(Array.isArray(style?.requires) ? style.requires : []),
        excludes: clone(Array.isArray(style?.excludes) ? style.excludes : []),
      })),
    })),
  }));
}

async function canonicalizeCompatibilityForBuild(draft, baseManifest) {
  const compatibility = createCompatibilityProfileV6(draft.compatibility);
  compatibility.renderer.commitment = await hashStableValue({
    schemaVersion: 'animacraft.renderer-definition.v6',
    version: compatibility.renderer.version,
  });
  compatibility.maskPolicyHash = await hashStableValue({
    schemaVersion: 'animacraft.mask-policy.v6',
    policy: clone(baseManifest?.maskPolicy ?? null),
  });
  compatibility.rulesHash = await hashStableValue({
    schemaVersion: 'animacraft.selection-rules.v6',
    rules: canonicalRulesSource(baseManifest),
  });
  compatibility.fallbackLoadoutHash = await hashStableValue({
    schemaVersion: 'animacraft.fallback-loadout.v6',
    productIds: [...compatibility.fallbackProductIds],
  });
  // The CompatibilityDefinition is already embedded in the independently
  // uploaded companion. It has no second, caller-controlled Walrus locator.
  compatibility.manifestBlobId = '';
  compatibility.manifestHash = await hashCompatibilityDefinitionV6(compatibility);
  return compatibility;
}

async function canonicalizeProductForBuild(
  productValue,
  { compatibility, baseManifest, baseManifestHash },
) {
  const product = createItemProductV6(productValue);
  product.makerRootId = compatibility.makerRootId;
  product.compatibilityHash = compatibility.manifestHash;

  const officialBaseBacked = product.originClass === ITEM_ORIGIN_CLASSES.OFFICIAL
    && product.access?.mode === ITEM_ACCESS_MODES.EMBEDDED
    && product.access?.binding === ITEM_BINDING_MODES.EMBEDDED
    && product.components.length > 0
    && product.components.every((component) => component.baseSource);

  if (officialBaseBacked) {
    product.display.thumbnailBlobId = '';
    product.display.thumbnailHash = '';
    product.manifestBlobId = '';
    product.components = await Promise.all(product.components.map(async (component) => {
      const { asset } = findBaseStyleAndAsset(baseManifest, component.baseSource);
      const assetHash = commitment(asset?.sha256 || asset?.contentHash || asset?.digest)
        || await hashStableValue({
          schemaVersion: 'animacraft.base-asset-reference.v6',
          baseManifestHash,
          asset: {
            id: string(asset?.id),
            identifier: string(asset?.identifier),
            width: Number(asset?.width || 0),
            height: Number(asset?.height || 0),
          },
        });
      return {
        ...component,
        assetBlobId: '',
        assetHash,
        assetWidth: Number(asset?.width || 0),
        assetHeight: Number(asset?.height || 0),
      };
    }));
    product.rightsManifestHash = await hashStableValue({
      schemaVersion: 'animacraft.base-item-rights.v6',
      baseManifestHash,
      rightsOrigin: product.rightsOrigin,
      license: clone(baseManifest?.metadata?.license ?? null),
    });
  }

  product.contentHash = await hashStableValue({
    schemaVersion: 'animacraft.item-content.v6',
    components: product.components.map((component) => ({
      layerTrackId: component.layerTrackId,
      assetHash: component.assetHash,
      assetWidth: component.assetWidth,
      assetHeight: component.assetHeight,
      transform: component.transform,
      baseSource: component.baseSource,
    })),
  });
  // Validation is produced only by the later Sui validator action. Creator
  // JSON and imported manifests can never pre-authorize publication.
  product.validation = { passed: false, attestationId: '', epoch: 0 };
  product.manifestHash = await hashItemProductDefinitionV6(product);
  return product;
}

async function canonicalizeDraftForBuild(draft, context) {
  const compatibility = await canonicalizeCompatibilityForBuild(
    draft,
    context.baseManifest,
  );
  const items = [];
  for (const product of draft.items) {
    items.push(await canonicalizeProductForBuild(product, {
      compatibility,
      baseManifest: context.baseManifest,
      baseManifestHash: context.baseManifestHash,
    }));
  }
  return {
    ...clone(draft),
    compatibility,
    items,
  };
}

/** Normalize the editable extension without mutating its caller. */
export function normalizeMakerComposableV6Draft(value = {}) {
  const source = object(value);
  return {
    schemaVersion: MAKER_COMPOSABLE_V6_DRAFT_SCHEMA,
    profile: createComposableProfileV6(source.profile),
    compatibility: createCompatibilityProfileV6(source.compatibility),
    compatibilitySealed: source.compatibilitySealed === true,
    items: (Array.isArray(source.items) ? source.items : [])
      .map((product) => createItemProductV6(product)),
    extensionsHash: commitment(source.extensionsHash),
  };
}

/** Return a detached normalized draft, or null when the Maker is Fixed/default. */
export function getMakerComposableV6Draft(document) {
  const value = rawDraftFrom(document);
  return value ? normalizeMakerComposableV6Draft(value) : null;
}

/**
 * Attach a normalized creator draft at the only supported extension path.
 * The Maker document and existing extension values are preserved immutably.
 */
export function attachMakerComposableV6Draft(document, value = {}) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new TypeError('A Maker v5 document object is required.');
  }
  const next = clone(document);
  next.extensions = object(next.extensions);
  next.extensions[MAKER_COMPOSABLE_V6_EXTENSION_KEY] = normalizeMakerComposableV6Draft(value);
  return next;
}

/** Remove only the private v6 companion draft and preserve every other extension. */
export function detachMakerComposableV6Draft(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new TypeError('A Maker v5 document object is required.');
  }
  const next = clone(document);
  next.extensions = object(next.extensions);
  delete next.extensions[MAKER_COMPOSABLE_V6_EXTENSION_KEY];
  return next;
}

/** Hash the exact JSON bytes uploaded as the immutable base Maker manifest. */
export async function hashMakerComposableV6BaseManifest(manifestJson) {
  const json = typeof manifestJson === 'string'
    ? manifestJson
    : JSON.stringify(manifestJson);
  if (!json) {
    throw new MakerComposableV6BridgeError(
      'The base Maker manifest JSON is required.',
      'missing-base-manifest-json',
    );
  }
  return sha256Bytes(new TextEncoder().encode(json));
}

/**
 * Collect release-blocking companion issues. A Maker without this extension,
 * or an explicit Fixed profile, does not need a v6 companion manifest.
 */
export function collectMakerComposableV6PreflightIssues(
  value,
  {
    publish = true,
    makerOwner = '',
    currentOwnershipEpoch = 0,
    baseManifest = null,
    baseMakerRootId = '',
    baseManifestHash = '',
    requireTrustedValidation = publish,
    requireCertification = publish,
    requireCompatibilityManifestLocator = publish,
    deferDependencyGraphToPublicationPlan = false,
  } = {},
) {
  const raw = rawDraftFrom(value);
  if (!raw) return [];

  const issues = [];
  collectUnknownDraftFields(issues, raw);
  if (raw.schemaVersion !== MAKER_COMPOSABLE_V6_DRAFT_SCHEMA) {
    issue(
      issues,
      'extensions.composableV6.schemaVersion',
      'invalid_companion_draft_schema',
      `Companion drafts must use ${MAKER_COMPOSABLE_V6_DRAFT_SCHEMA}.`,
    );
  }
  if (typeof raw.compatibilitySealed !== 'boolean') {
    issue(
      issues,
      'extensions.composableV6.compatibilitySealed',
      'invalid_compatibility_seal_state',
      'The compatibility seal state must be explicit.',
    );
  }
  if (!Array.isArray(raw.items)) {
    issue(
      issues,
      'extensions.composableV6.items',
      'invalid_companion_items',
      'The v6 companion Item Product catalog must be an array.',
    );
  }
  if (raw.extensionsHash && !HASH.test(raw.extensionsHash)) {
    issue(
      issues,
      'extensions.composableV6.extensionsHash',
      'invalid_extensions_hash',
      'extensionsHash must be a 32-byte hexadecimal commitment.',
    );
  }
  const draft = normalizeMakerComposableV6Draft(raw);
  collectComposableProfileV6Issues(raw.profile ?? draft.profile)
    .forEach((entry) => prefixedIssue(issues, entry));
  if (draft.profile.mode === COMPOSABLE_PROFILE_MODES.FIXED) return issues;

  collectCompatibilityProfileV6Issues(
    raw.compatibility ?? draft.compatibility,
    {
      publish,
      requireManifestLocator: requireCompatibilityManifestLocator,
    },
  ).forEach((entry) => prefixedIssue(issues, entry));

  if (publish && raw.compatibilitySealed !== true) {
    issue(
      issues,
      'extensions.composableV6.compatibilitySealed',
      'compatibility_not_sealed',
      'Composable publication must seal the exact compatibility contract before Items are admitted.',
    );
  }

  const rawItems = Array.isArray(raw.items) ? raw.items : [];
  const seen = new Set();
  rawItems.forEach((productValue, index) => {
    const product = createItemProductV6(productValue);
    if (seen.has(product.id)) {
      issue(
        issues,
        `extensions.composableV6.items[${index}].id`,
        'duplicate_item_product',
        'A companion release may publish only one current record for an Item Product ID.',
      );
    }
    seen.add(product.id);
    collectItemProductV6Issues(productValue, {
      profile: draft.profile,
      compatibility: draft.compatibility,
      makerOwner,
      currentOwnershipEpoch,
      publish,
      requireTrustedValidation,
      requireCertification,
    }).forEach((entry) => prefixedIssue(
      issues,
      entry,
      `extensions.composableV6.items[${index}]`,
    ));
  });

  if (publish && rawItems.length === 0) {
    issue(
      issues,
      'extensions.composableV6.items',
      'missing_companion_items',
      'Composable publication requires its validated Item Product catalog.',
    );
  }
  if (publish) collectFallbackIssues(issues, draft, {
    deferDependencyGraph: deferDependencyGraphToPublicationPlan,
  });
  if (publish) collectBaseSourceIssues(issues, draft, baseManifest);

  if (publish) {
    if (draft.compatibility.makerRootId !== string(baseMakerRootId)) {
      issue(
        issues,
        'extensions.composableV6.compatibility.makerRootId',
        'companion_base_root_mismatch',
        'Compatibility and every Item must target the exact MakerRootV5 object used by this release.',
      );
    }
    collectBaseReferenceIssues(
      issues,
      documentFrom(value),
      { baseManifest, baseMakerRootId, baseManifestHash },
    );
  }
  return issues;
}

function parseAndMatchBaseManifest(baseManifest, baseManifestJson) {
  const json = typeof baseManifestJson === 'string'
    ? baseManifestJson
    : JSON.stringify(baseManifest);
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new MakerComposableV6BridgeError(
      'The exact base Maker manifest JSON is invalid.',
      'invalid-base-manifest-json',
      { cause: String(error?.message || error) },
    );
  }
  if (stableJson(parsed) !== stableJson(baseManifest)) {
    throw new MakerComposableV6BridgeError(
      'The supplied base manifest object does not match the exact uploaded JSON.',
      'base-manifest-json-mismatch',
    );
  }
  return json;
}

/**
 * Build the immutable independent companion manifest. This is async because
 * it hashes the exact base manifest JSON bytes rather than trusting a caller's
 * claimed digest.
 */
export async function buildMakerComposableV6Manifest(
  document,
  {
    baseManifest,
    baseManifestJson,
    baseManifestHash = '',
    baseMakerRootId = '',
    makerOwner = '',
    currentOwnershipEpoch = 0,
  } = {},
) {
  const draft = getMakerComposableV6Draft(document);
  if (!draft || draft.profile.mode === COMPOSABLE_PROFILE_MODES.FIXED) return null;

  const exactBaseJson = parseAndMatchBaseManifest(baseManifest, baseManifestJson);
  const computedBaseHash = await hashMakerComposableV6BaseManifest(exactBaseJson);
  if (baseManifestHash && commitment(baseManifestHash) !== computedBaseHash) {
    throw new MakerComposableV6BridgeError(
      'The claimed base Maker manifest hash does not match the exact uploaded JSON bytes.',
      'base-manifest-hash-mismatch',
      { expected: commitment(baseManifestHash), actual: computedBaseHash },
    );
  }

  const sourceIssues = collectMakerComposableV6PreflightIssues(document, {
    publish: false,
    makerOwner,
    currentOwnershipEpoch,
    baseMakerRootId,
  }).filter((entry) => entry.code !== 'item_compatibility_mismatch');
  const canonicalDraft = await canonicalizeDraftForBuild(draft, {
    baseManifest,
    baseManifestHash: computedBaseHash,
  });
  const canonicalValue = documentFrom(document)
    ? (() => {
        const next = clone(document);
        next.extensions = object(next.extensions);
        next.extensions[MAKER_COMPOSABLE_V6_EXTENSION_KEY] = canonicalDraft;
        return next;
      })()
    : canonicalDraft;
  const publicationIssues = collectMakerComposableV6PreflightIssues(canonicalValue, {
    publish: true,
    makerOwner,
    currentOwnershipEpoch,
    baseManifest,
    baseMakerRootId,
    baseManifestHash: computedBaseHash,
    requireTrustedValidation: false,
    requireCertification: false,
    requireCompatibilityManifestLocator: false,
    deferDependencyGraphToPublicationPlan: true,
  });
  const issues = dedupeIssues([...sourceIssues, ...publicationIssues]);
  if (issues.length) {
    throw new MakerComposableV6BridgeError(
      'The Maker v6 companion failed publication preflight.',
      'companion-preflight-failed',
      { issues },
    );
  }

  const version = baseManifest.version;
  const items = [...canonicalDraft.items].sort((left, right) => (
    left.id.localeCompare(right.id)
    || left.version - right.version
  ));
  return {
    schemaVersion: MAKER_COMPOSABLE_V6_SCHEMA,
    baseMaker: {
      manifestSchemaVersion: baseManifest.schemaVersion,
      makerRootId: string(baseMakerRootId),
      rootMakerId: string(version.rootMakerId),
      versionId: string(version.versionId),
      versionNumber: Number(version.number),
      manifestHash: computedBaseHash,
    },
    profile: clone(canonicalDraft.profile),
    compatibility: clone(canonicalDraft.compatibility),
    compatibilitySealed: true,
    items: clone(items),
    fallbackLoadout: {
      productIds: [...canonicalDraft.compatibility.fallbackProductIds],
      commitment: canonicalDraft.compatibility.fallbackLoadoutHash,
    },
    extensionsHash: canonicalDraft.extensionsHash,
  };
}

// Compact aliases for callers that already scope imports to this bridge.
export const attachComposableV6 = attachMakerComposableV6Draft;
export const getComposableV6 = getMakerComposableV6Draft;
export const normalizeComposableV6 = normalizeMakerComposableV6Draft;
export const collectComposableV6Preflight = collectMakerComposableV6PreflightIssues;
export const buildComposableV6Manifest = buildMakerComposableV6Manifest;
