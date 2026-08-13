/**
 * Independent Expansion Pack authoring projects.
 *
 * The parent Maker is captured once as a read-only snapshot. Authoring
 * commands only change the additive Pack overlay and always return a new
 * project, so a Pack editor can never silently rewrite the parent Maker.
 */

import {
  EXPANSION_PACK_SCHEMA,
  checkExpansionPackCompatibility,
  mergeExpansionPack,
  namespaceId,
} from './expansion-packs.js';
import { BLEND_MODES } from './maker-renderer.js';
import {
  createMakerRuleIndex,
  evaluateRecipe,
  normalizeRecipe,
} from './maker-rules.js';

export const EXPANSION_PACK_PROJECT_SCHEMA = 'animacraft.expansion-pack-project.v2';
export const EXPANSION_PACK_INHERITANCE_SCHEMA = 'animacraft.expansion-pack-inheritance.v2';
export const EXPANSION_PACK_PARENT_BINDING_SCHEMA = 'animacraft.expansion-pack-parent-binding.v2';
export const EXPANSION_PACK_PARENT_BINDING_KINDS = Object.freeze({
  LOCAL_DRAFT: 'local-draft',
  PUBLISHED_RELEASE: 'published-release',
});
export const EXPANSION_PACK_ACCESS_MODES = Object.freeze({
  FREE: 'FREE',
  PAID_ONCE: 'PAID_ONCE',
});
export const EXPANSION_PACK_PAYMENT_CURRENCY = 'USDC';
export const EXPANSION_PACK_PAYMENT_DECIMALS = 6;
export const EXPANSION_PACK_PROTOCOL_FEE_BPS = 1000;
export const EXPANSION_PACK_WARDROBE_SCHEMA = 'animacraft.expansion-pack-wardrobe.v1';
export const EXPANSION_PACK_PART_MODES = Object.freeze({
  FIXED: 'FIXED',
  SLOT: 'SLOT',
});
export const EXPANSION_PACK_PARENT_INHERITANCE = Object.freeze({
  schemaVersion: EXPANSION_PACK_INHERITANCE_SCHEMA,
  mode: 'read-only-parent-release',
  releaseIdentity: 'pin-root-release-version-blob-sha256',
  documentSchema: 'inherit-readonly',
  parentMetadata: 'reference-readonly',
  canvas: 'inherit-readonly',
  renderer: 'inherit-readonly',
  layerTracks: 'inherit-readonly-plus-additive',
  baseDefinitions: 'inherit-readonly',
  baseAssets: 'inherit-readonly-plus-additive',
  selectionRules: 'inherit-readonly-plus-additive',
  smartColorChannels: 'inherit-readonly-plus-additive',
  defaultRecipe: 'inherit-readonly',
  livingContent: 'inherit-readonly',
  wardrobeCompatibility: 'inherit-by-part',
  parentCommerce: 'inherit-as-prerequisite',
  license: 'reference-parent-readonly',
});

export class ExpansionPackProjectError extends Error {
  constructor(message, code = 'invalid-expansion-pack-project', details = {}) {
    super(message);
    this.name = 'ExpansionPackProjectError';
    this.code = code;
    this.details = details;
  }
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function requireText(value, label, code = 'missing-project-field') {
  const result = String(value ?? '').trim();
  if (!result) throw new ExpansionPackProjectError(`${label} is required.`, code, { field: label });
  return result;
}

function requireLocalId(value, label, namespace) {
  const id = requireText(value, label, 'missing-local-id');
  try {
    namespaceId(namespace, id);
  } catch (error) {
    throw new ExpansionPackProjectError(
      `${label} must be a valid Pack-local id.`,
      'invalid-local-id',
      { id, cause: error?.code || '' },
    );
  }
  return id;
}

function makerRootId(maker) {
  return String(
    maker?.version?.rootMakerId
    ?? maker?.makerId
    ?? maker?.rootMakerId
    ?? maker?.metadata?.id
    ?? maker?.id
    ?? '',
  ).trim();
}

function makerVersionNumber(maker) {
  const version = maker?.version;
  if (version && typeof version === 'object') {
    return String(version.number ?? version.versionId ?? '').trim();
  }
  return String(version ?? maker?.makerVersion ?? '').trim();
}

function makerVersionId(maker) {
  const version = maker?.version;
  if (version && typeof version === 'object') return String(version.versionId ?? '').trim();
  return '';
}

function makerManifestHash(maker) {
  return String(
    maker?.manifestHash
    ?? maker?.contentHash
    ?? maker?.template?.manifestHash
    ?? maker?.publication?.manifestHash
    ?? '',
  ).trim().replace(/^0x/i, '').toLowerCase();
}

function makerReleaseId(maker) {
  return String(
    maker?.releaseId
    ?? maker?.makerObjectId
    ?? maker?.objectId
    ?? maker?.publication?.releaseId
    ?? maker?.publication?.makerObjectId
    ?? '',
  ).trim();
}

function makerManifestBlobId(maker) {
  return String(
    maker?.manifestBlobId
    ?? maker?.quiltId
    ?? maker?.template?.quiltId
    ?? maker?.publication?.manifestBlobId
    ?? maker?.publication?.quiltId
    ?? '',
  ).trim();
}

function hasOwnFields(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length);
}

function normalizeManifestSha256(value) {
  return String(value ?? '').trim().replace(/^0x/i, '').toLowerCase();
}

function exactReleaseIdentity(binding) {
  return [
    binding.kind,
    binding.rootMakerId,
    binding.releaseId || '~local',
    binding.versionId || binding.versionNumber,
    binding.manifestBlobId || '~local',
    binding.manifestHash || '~local',
  ].join('|');
}

function normalizeWalletAddress(value) {
  return requireText(value, 'Wallet address', 'missing-project-wallet').toLowerCase();
}

function safeNamespace(value, packId) {
  const requested = String(value ?? '').trim();
  if (requested) {
    try {
      namespaceId(requested, 'probe');
      return requested;
    } catch (error) {
      throw new ExpansionPackProjectError(
        'Expansion Pack namespace is invalid.',
        'invalid-pack-namespace',
        { namespace: requested, cause: error?.code || '' },
      );
    }
  }
  let generated = String(packId || 'pack')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 58);
  if (!/^[A-Za-z]/.test(generated)) generated = `pack-${generated}`;
  if (generated.length < 2) generated = 'pack';
  return generated;
}

function atomicToDecimal(value, decimals = EXPANSION_PACK_PAYMENT_DECIMALS) {
  let amount;
  try {
    amount = BigInt(String(value ?? 0));
  } catch {
    amount = 0n;
  }
  const scale = 10n ** BigInt(decimals);
  const whole = amount / scale;
  const fraction = (amount % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function decimalToAtomic(value, decimals = EXPANSION_PACK_PAYMENT_DECIMALS) {
  const normalized = String(value ?? '').trim();
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/.exec(normalized);
  if (!match || (match[2] || '').length > decimals) {
    throw new ExpansionPackProjectError(
      `Pack price must be a non-negative ${EXPANSION_PACK_PAYMENT_CURRENCY} amount with at most ${decimals} decimal places.`,
      'invalid-pack-purchase-price',
      { value: normalized, decimals },
    );
  }
  const fraction = (match[2] || '').padEnd(decimals, '0');
  return (BigInt(match[1]) * (10n ** BigInt(decimals)) + BigInt(fraction || '0')).toString();
}

export function normalizeExpansionPackCommerce(value = {}) {
  const requestedAccessMode = String(value?.accessMode || EXPANSION_PACK_ACCESS_MODES.FREE)
    .trim()
    .toUpperCase();
  const accessMode = requestedAccessMode === 'PAID'
    ? EXPANSION_PACK_ACCESS_MODES.PAID_ONCE
    : requestedAccessMode;
  if (!Object.values(EXPANSION_PACK_ACCESS_MODES).includes(accessMode)) {
    throw new ExpansionPackProjectError(
      'Expansion Pack access must be Free or Paid Once.',
      'invalid-pack-access-mode',
      { accessMode },
    );
  }
  const requestedDecimal = Object.hasOwn(value || {}, 'priceDecimal')
    ? String(value.priceDecimal ?? '').trim()
    : atomicToDecimal(value?.purchasePriceAtomic ?? value?.price ?? '0');
  const purchasePriceAtomic = accessMode === EXPANSION_PACK_ACCESS_MODES.FREE
    ? '0'
    : decimalToAtomic(requestedDecimal || '0');
  return {
    schemaVersion: 'animacraft.expansion-pack-commerce.v8',
    accessMode,
    purchasePriceAtomic,
    priceDecimal: accessMode === EXPANSION_PACK_ACCESS_MODES.FREE
      ? '0'
      : atomicToDecimal(purchasePriceAtomic),
    currency: EXPANSION_PACK_PAYMENT_CURRENCY,
    decimals: EXPANSION_PACK_PAYMENT_DECIMALS,
    protocolFeeBps: EXPANSION_PACK_PROTOCOL_FEE_BPS,
    entitlement: accessMode === EXPANSION_PACK_ACCESS_MODES.FREE
      ? 'ACTIVE_RELEASE_FREE_ACCESS'
      : 'PERMANENT_WALLET_BOUND_PASS',
    completeMode: 'INHERIT_BASE_AND_UNLIMITED_AFTER_ACCESS',
  };
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  if (ArrayBuffer.isView(value)) return value;
  seen.add(value);
  Reflect.ownKeys(value).forEach((key) => deepFreeze(value[key], seen));
  return Object.freeze(value);
}

function lockParentSnapshot(project, snapshot) {
  const frozenSnapshot = deepFreeze(snapshot);
  Object.defineProperty(project, 'parentSnapshot', {
    value: frozenSnapshot,
    enumerable: true,
    configurable: false,
    writable: false,
  });
  return project;
}

export function createExpansionPackParentBinding(parentMaker, releaseEvidence = null) {
  const evidenceProvided = hasOwnFields(releaseEvidence);
  const evidence = evidenceProvided ? releaseEvidence : {};
  const rootMakerId = requireText(
    evidence.rootMakerId ?? evidence.parentRootId ?? makerRootId(parentMaker),
    'Parent Maker root id',
    'missing-parent-maker-id',
  );
  const evidenceVersionNumber = evidence.versionNumber ?? evidence.parentVersion;
  const evidenceVersionId = evidence.versionId;
  const evidenceReleaseId = evidence.releaseId ?? evidence.makerObjectId;
  const evidenceManifestBlobId = evidence.manifestBlobId ?? evidence.quiltId;
  const evidenceManifestHash = evidence.manifestHash ?? evidence.manifestSha256;
  const versionNumber = requireText(
    evidenceVersionNumber ?? makerVersionNumber(parentMaker),
    'Parent Maker version',
    'missing-parent-maker-version',
  );
  const versionId = String(evidenceVersionId ?? makerVersionId(parentMaker)).trim();
  const releaseId = String(
    evidenceReleaseId ?? makerReleaseId(parentMaker),
  ).trim();
  const manifestBlobId = String(
    evidenceManifestBlobId ?? makerManifestBlobId(parentMaker),
  ).trim();
  const manifestHash = normalizeManifestSha256(
    evidenceManifestHash ?? makerManifestHash(parentMaker),
  );
  const documentRootId = makerRootId(parentMaker);
  const documentVersionNumber = makerVersionNumber(parentMaker);
  const documentVersionId = makerVersionId(parentMaker);
  const documentManifestHash = makerManifestHash(parentMaker);
  const mismatch = [];
  if (documentRootId && documentRootId !== rootMakerId) mismatch.push('rootMakerId');
  if (documentVersionNumber && documentVersionNumber !== versionNumber) mismatch.push('versionNumber');
  if (documentVersionId && versionId && documentVersionId !== versionId) mismatch.push('versionId');
  if (documentManifestHash && manifestHash && documentManifestHash !== manifestHash) {
    mismatch.push('manifestHash');
  }
  if (mismatch.length) {
    throw new ExpansionPackProjectError(
      'Parent release evidence does not match the selected Maker document.',
      'parent-release-document-mismatch',
      { fields: mismatch },
    );
  }

  const completePublishedRelease = Boolean(
    String(evidenceReleaseId ?? '').trim()
    && String(evidenceVersionId ?? '').trim()
    && String(evidenceVersionNumber ?? '').trim()
    && String(evidenceManifestBlobId ?? '').trim()
    && /^[0-9a-f]{64}$/.test(normalizeManifestSha256(evidenceManifestHash)),
  );
  if (evidenceProvided && evidence.identityVerified !== true) {
    throw new ExpansionPackProjectError(
      'Published parent release evidence must be explicitly identity-verified.',
      'unverified-published-parent-release',
      { identityVerified: evidence.identityVerified === true },
    );
  }
  if (evidenceProvided && !completePublishedRelease) {
    throw new ExpansionPackProjectError(
      'Published parent release evidence must include an exact release id, version id, manifest Blob/Quilt id and SHA-256.',
      'incomplete-published-parent-release',
      {
        missing: [
          !String(evidenceReleaseId ?? '').trim() && 'releaseId',
          !String(evidenceVersionId ?? '').trim() && 'versionId',
          !String(evidenceVersionNumber ?? '').trim() && 'versionNumber',
          !String(evidenceManifestBlobId ?? '').trim() && 'manifestBlobId',
          !/^[0-9a-f]{64}$/.test(normalizeManifestSha256(evidenceManifestHash)) && 'manifestHash',
        ].filter(Boolean),
      },
    );
  }
  const kind = evidenceProvided && evidence.identityVerified === true && completePublishedRelease
    ? EXPANSION_PACK_PARENT_BINDING_KINDS.PUBLISHED_RELEASE
    : EXPANSION_PACK_PARENT_BINDING_KINDS.LOCAL_DRAFT;
  const binding = {
    schemaVersion: EXPANSION_PACK_PARENT_BINDING_SCHEMA,
    kind,
    rootMakerId,
    versionNumber,
    versionId,
    releaseId: kind === EXPANSION_PACK_PARENT_BINDING_KINDS.PUBLISHED_RELEASE ? releaseId : '',
    manifestBlobId: kind === EXPANSION_PACK_PARENT_BINDING_KINDS.PUBLISHED_RELEASE
      ? manifestBlobId
      : '',
    manifestHash,
    publishable: kind === EXPANSION_PACK_PARENT_BINDING_KINDS.PUBLISHED_RELEASE,
  };
  binding.identity = exactReleaseIdentity(binding);
  return binding;
}

function emptyPack(binding, options) {
  return {
    schemaVersion: EXPANSION_PACK_SCHEMA,
    packId: options.packId,
    namespace: options.namespace,
    name: options.name,
    version: options.version,
    baseMakerId: binding.rootMakerId,
    baseVersion: binding.versionNumber,
    baseVersionId: binding.versionId,
    baseReleaseId: binding.releaseId,
    baseManifestBlobId: binding.manifestBlobId,
    baseBindingKind: binding.kind,
    ...(binding.manifestHash ? { baseManifestHash: binding.manifestHash } : {}),
    layerTracks: [],
    colorChannels: [],
    assets: [],
    parts: [],
    rules: [],
    wardrobe: {
      schemaVersion: EXPANSION_PACK_WARDROBE_SCHEMA,
      partModes: {},
    },
    commerce: normalizeExpansionPackCommerce(),
  };
}

function parentReleaseSnapshot(parentMaker, binding) {
  const snapshot = clone(parentMaker);
  if (binding.kind === EXPANSION_PACK_PARENT_BINDING_KINDS.PUBLISHED_RELEASE) {
    snapshot.releaseId = binding.releaseId;
    snapshot.manifestBlobId = binding.manifestBlobId;
    snapshot.manifestHash = binding.manifestHash;
  }
  return snapshot;
}

function stableComparableValue(value) {
  if (Array.isArray(value)) return value.map(stableComparableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => [key, stableComparableValue(value[key])]),
  );
}

function comparableJson(value) {
  return JSON.stringify(stableComparableValue(value));
}

function inheritedAssetIdentity(asset) {
  return {
    id: String(asset?.id ?? asset?.assetId ?? ''),
    identifier: String(asset?.identifier ?? ''),
    kind: String(asset?.kind ?? ''),
    mediaType: String(asset?.mediaType ?? asset?.contentType ?? ''),
    contentHash: String(
      asset?.sha256
      ?? asset?.contentHash
      ?? asset?.digest
      ?? '',
    ).replace(/^0x/i, '').toLowerCase(),
    byteLength: Number.isSafeInteger(Number(asset?.byteLength ?? asset?.size))
      ? Number(asset?.byteLength ?? asset?.size)
      : null,
    width: Number.isSafeInteger(Number(asset?.width)) ? Number(asset.width) : null,
    height: Number.isSafeInteger(Number(asset?.height)) ? Number(asset.height) : null,
  };
}

/**
 * The immutable contract a Pack inherits from its parent release.
 *
 * Publication receipts, local Blob/Object URLs and release transport fields
 * are intentionally excluded. Everything that can change the player's
 * rendered result, choices, Soul defaults, rights or wardrobe compatibility
 * remains part of the comparison.
 */
function inheritedParentContract(maker) {
  const extensions = maker?.extensions || {};
  return {
    documentSchema: String(maker?.schemaVersion ?? ''),
    metadata: clone(maker?.metadata ?? null),
    canvas: clone(maker?.canvas ?? null),
    renderer: clone(
      maker?.renderer
      ?? extensions?.composableV6?.compatibility?.renderer
      ?? null,
    ),
    layerTracks: clone(Array.isArray(maker?.layerTracks) ? maker.layerTracks : []),
    colorChannels: clone(
      Array.isArray(maker?.colorChannels)
        ? maker.colorChannels
        : Array.isArray(maker?.palettes)
          ? maker.palettes
          : [],
    ),
    assets: clone(Array.isArray(maker?.assets) ? maker.assets.map(inheritedAssetIdentity) : []),
    parts: clone(partsOf(maker)),
    selectionRules: clone(Array.isArray(maker?.rules) ? maker.rules : []),
    defaultRecipe: clone(maker?.defaultRecipe ?? null),
    livingContent: clone(maker?.livingContent ?? null),
    parentCommerce: clone(maker?.commerce ?? null),
    wardrobeCompatibility: {
      wardrobeV7: clone(extensions?.wardrobeV7 ?? null),
      composableV6: clone(extensions?.composableV6 ?? null),
      physicalStyleCatalogV7: clone(extensions?.physicalStyleCatalogV7 ?? null),
    },
  };
}

function inheritedParentContractMismatches(leftMaker, rightMaker) {
  const left = inheritedParentContract(leftMaker);
  const right = inheritedParentContract(rightMaker);
  return Object.keys(left).filter((field) => comparableJson(left[field]) !== comparableJson(right[field]));
}

function rebasePackParentFields(packValue, binding) {
  const pack = clone(packValue);
  pack.baseMakerId = binding.rootMakerId;
  pack.baseVersion = binding.versionNumber;
  pack.baseVersionId = binding.versionId;
  pack.baseReleaseId = binding.releaseId;
  pack.baseManifestBlobId = binding.manifestBlobId;
  pack.baseBindingKind = binding.kind;
  pack.baseManifestHash = binding.manifestHash;
  return pack;
}

function normalizedMigratedPack(overlay, binding) {
  const pack = clone(overlay);
  pack.layerTracks = Array.isArray(pack.layerTracks) ? pack.layerTracks : [];
  if (!Array.isArray(pack.colorChannels)) {
    pack.colorChannels = Array.isArray(pack.palettes) ? pack.palettes : [];
  }
  delete pack.palettes;
  pack.assets = Array.isArray(pack.assets) ? pack.assets : [];
  pack.parts = Array.isArray(pack.parts) ? pack.parts : [];
  pack.rules = Array.isArray(pack.rules) ? pack.rules : [];
  if (!Object.hasOwn(pack, 'wardrobe')) {
    pack.wardrobe = {
      schemaVersion: EXPANSION_PACK_WARDROBE_SCHEMA,
      partModes: {},
    };
  }
  pack.commerce = normalizeExpansionPackCommerce(pack.commerce || {});
  return rebasePackParentFields(pack, binding);
}

/** Create a wallet-bound Pack project with an immutable parent snapshot. */
export function createExpansionPackProject(parentMaker, options = {}) {
  if (!parentMaker || typeof parentMaker !== 'object' || Array.isArray(parentMaker)) {
    throw new ExpansionPackProjectError(
      'A parent Maker document is required.',
      'missing-parent-maker',
    );
  }
  const binding = createExpansionPackParentBinding(
    parentMaker,
    Object.hasOwn(options, 'parentRelease')
      ? { ...(options.parentRelease || {}), requirePublishedRelease: true }
      : null,
  );
  const packId = requireText(options.packId, 'Expansion Pack id', 'missing-pack-id');
  const namespace = safeNamespace(options.namespace, packId);
  const name = String(options.name ?? 'Untitled Expansion Pack').trim() || 'Untitled Expansion Pack';
  const version = String(options.version ?? '1.0.0').trim() || '1.0.0';
  const now = Number.isFinite(options.now) ? Number(options.now) : Date.now();
  const project = {
    schemaVersion: EXPANSION_PACK_PROJECT_SCHEMA,
    projectId: String(options.projectId ?? packId).trim() || packId,
    packId,
    ownerWalletAddress: normalizeWalletAddress(options.walletAddress),
    name,
    namespace,
    version,
    parentBinding: binding,
    inheritance: clone(EXPANSION_PACK_PARENT_INHERITANCE),
    pack: emptyPack(binding, { packId, namespace, name, version }),
    publication: {
      state: 'draft',
      publishable: binding.publishable,
      chainState: 'unpublished',
    },
    createdAt: now,
    updatedAt: now,
  };
  return lockParentSnapshot(project, deepFreeze(parentReleaseSnapshot(parentMaker, binding)));
}

/**
 * Migrate one legacy embedded expansionDraft into an independent project.
 *
 * The overlay is copied verbatim after its immutable parent binding has been
 * checked. Missing binding fields are not inferred: an embedded draft must
 * prove which exact parent release it belongs to before it can leave that
 * Maker document.
 */
export function createExpansionPackProjectFromOverlay(parentMaker, overlayValue, options = {}) {
  if (!overlayValue || typeof overlayValue !== 'object' || Array.isArray(overlayValue)) {
    throw new ExpansionPackProjectError(
      'An embedded Expansion Pack overlay is required.',
      'missing-pack-overlay',
    );
  }
  const overlay = clone(overlayValue);
  if (overlay.schemaVersion !== EXPANSION_PACK_SCHEMA) {
    throw new ExpansionPackProjectError(
      'Embedded Expansion Pack uses an unsupported schema.',
      'unsupported-pack-schema',
      { expected: EXPANSION_PACK_SCHEMA, actual: overlay.schemaVersion },
    );
  }
  const binding = createExpansionPackParentBinding(
    parentMaker,
    Object.hasOwn(options, 'parentRelease')
      ? { ...(options.parentRelease || {}), requirePublishedRelease: true }
      : null,
  );
  const actualRootMakerId = requireText(
    overlay.baseMakerId,
    'Expansion Pack parent Maker id',
    'missing-pack-parent-maker-id',
  );
  const actualVersion = requireText(
    overlay.baseVersion,
    'Expansion Pack parent version',
    'missing-pack-parent-version',
  );
  const actualVersionId = String(overlay.baseVersionId ?? '').trim();
  const actualReleaseId = String(overlay.baseReleaseId ?? '').trim();
  const actualManifestBlobId = String(overlay.baseManifestBlobId ?? '').trim();
  const actualBindingKind = String(overlay.baseBindingKind ?? '').trim();
  const actualManifestHash = String(overlay.baseManifestHash ?? '').trim();
  if (actualRootMakerId !== binding.rootMakerId) {
    throw new ExpansionPackProjectError(
      'Expansion Pack parent Maker does not match the selected Maker.',
      'parent-maker-id-mismatch',
      { expected: binding.rootMakerId, actual: actualRootMakerId },
    );
  }
  if (actualVersion !== binding.versionNumber) {
    throw new ExpansionPackProjectError(
      'Expansion Pack parent version does not match the selected Maker release.',
      'parent-version-mismatch',
      { expected: binding.versionNumber, actual: actualVersion },
    );
  }
  if (actualVersionId !== binding.versionId) {
    throw new ExpansionPackProjectError(
      'Expansion Pack parent version id does not match the selected Maker release.',
      'parent-version-id-mismatch',
      { expected: binding.versionId, actual: actualVersionId },
    );
  }
  if (actualReleaseId !== binding.releaseId) {
    throw new ExpansionPackProjectError(
      'Expansion Pack parent release id does not match the selected Maker release.',
      'parent-release-id-mismatch',
      { expected: binding.releaseId, actual: actualReleaseId },
    );
  }
  if (actualManifestBlobId !== binding.manifestBlobId) {
    throw new ExpansionPackProjectError(
      'Expansion Pack parent manifest Blob/Quilt id does not match the selected Maker release.',
      'parent-manifest-blob-mismatch',
      { expected: binding.manifestBlobId, actual: actualManifestBlobId },
    );
  }
  if (actualBindingKind !== binding.kind) {
    throw new ExpansionPackProjectError(
      'Expansion Pack parent binding kind does not match the selected Maker release.',
      'parent-binding-kind-mismatch',
      { expected: binding.kind, actual: actualBindingKind },
    );
  }
  if (actualManifestHash !== binding.manifestHash) {
    throw new ExpansionPackProjectError(
      'Expansion Pack parent manifest does not match the selected Maker release.',
      'parent-manifest-mismatch',
      { expected: binding.manifestHash, actual: actualManifestHash },
    );
  }

  const packId = requireText(overlay.packId, 'Expansion Pack id', 'missing-pack-id');
  const namespace = safeNamespace(overlay.namespace, packId);
  const name = String(overlay.name ?? 'Untitled Expansion Pack').trim() || 'Untitled Expansion Pack';
  const version = requireText(overlay.version, 'Expansion Pack version', 'missing-pack-version');
  const project = createExpansionPackProject(parentMaker, {
    packId,
    namespace,
    name,
    version,
    walletAddress: options.walletAddress,
    projectId: options.projectId ?? packId,
    ...(Object.hasOwn(options, 'parentRelease') ? { parentRelease: options.parentRelease } : {}),
    now: Number.isFinite(options.now) ? Number(options.now) : Date.now(),
  });
  project.pack = normalizedMigratedPack(overlay, binding);
  project.name = name;
  project.namespace = namespace;
  project.version = version;
  return project;
}

/** Reapply the read-only guarantee after an IndexedDB structured clone. */
export function rehydrateExpansionPackProject(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ExpansionPackProjectError('Expansion Pack project is required.');
  }
  const project = clone(input);
  project.inheritance ||= clone(EXPANSION_PACK_PARENT_INHERITANCE);
  if (project.pack && typeof project.pack === 'object' && !Array.isArray(project.pack)) {
    project.pack.layerTracks = Array.isArray(project.pack.layerTracks) ? project.pack.layerTracks : [];
    if (!Array.isArray(project.pack.colorChannels)) {
      project.pack.colorChannels = Array.isArray(project.pack.palettes)
        ? project.pack.palettes
        : [];
    }
    delete project.pack.palettes;
    project.pack.assets = Array.isArray(project.pack.assets) ? project.pack.assets : [];
    project.pack.parts = Array.isArray(project.pack.parts) ? project.pack.parts : [];
    project.pack.rules = Array.isArray(project.pack.rules) ? project.pack.rules : [];
    if (!Object.hasOwn(project.pack, 'wardrobe')) {
      project.pack.wardrobe = {
        schemaVersion: EXPANSION_PACK_WARDROBE_SCHEMA,
        partModes: {},
      };
    } else if (
      project.pack.wardrobe
      && typeof project.pack.wardrobe === 'object'
      && !Array.isArray(project.pack.wardrobe)
    ) {
      project.pack.wardrobe = {
        ...project.pack.wardrobe,
        schemaVersion: project.pack.wardrobe.schemaVersion ?? EXPANSION_PACK_WARDROBE_SCHEMA,
        partModes: Object.hasOwn(project.pack.wardrobe, 'partModes')
          ? project.pack.wardrobe.partModes
          : {},
      };
    }
    project.pack.commerce = normalizeExpansionPackCommerce(project.pack.commerce || {});
  }
  if (!project.parentSnapshot || typeof project.parentSnapshot !== 'object') {
    throw new ExpansionPackProjectError(
      'Expansion Pack project is missing its parent snapshot.',
      'missing-parent-snapshot',
    );
  }
  return lockParentSnapshot(project, deepFreeze(project.parentSnapshot));
}

/**
 * Rebind a Pack authored against a local parent draft to one exact published
 * parent release without mutating or discarding the Pack overlay.
 *
 * This is intentionally a pure project transformation. The caller must read
 * the published Maker and release evidence from trusted sources before
 * calling it, then persist the returned project under its new exact binding
 * identity. The old local-bound draft remains recoverable under its old key.
 */
export function rebindExpansionPackProjectToPublishedRelease(
  projectValue,
  publishedParentMaker,
  releaseEvidence = {},
  options = {},
) {
  const source = rehydrateExpansionPackProject(projectValue);
  assertProjectShape(source);
  if (source.parentBinding.kind !== EXPANSION_PACK_PARENT_BINDING_KINDS.LOCAL_DRAFT) {
    throw new ExpansionPackProjectError(
      'Only a Pack bound to a local parent draft can be rebound to a published release.',
      'pack-parent-rebind-source-not-local',
      { kind: source.parentBinding.kind },
    );
  }
  const sourceBindingErrors = [
    ...bindingIssues(source),
    ...inheritanceIssues(source),
    ...projectOverlayIssues(source),
  ].filter((issue) => issue.severity === 'error');
  if (sourceBindingErrors.length) {
    throw new ExpansionPackProjectError(
      'The local Expansion Pack binding is invalid and cannot be rebound safely.',
      'invalid-local-pack-parent-binding',
      { issues: sourceBindingErrors },
    );
  }
  if (!publishedParentMaker || typeof publishedParentMaker !== 'object' || Array.isArray(publishedParentMaker)) {
    throw new ExpansionPackProjectError(
      'A published parent Maker document is required.',
      'missing-published-parent-maker',
    );
  }

  const binding = createExpansionPackParentBinding(publishedParentMaker, {
    ...(releaseEvidence || {}),
    requirePublishedRelease: true,
  });
  if (binding.kind !== EXPANSION_PACK_PARENT_BINDING_KINDS.PUBLISHED_RELEASE) {
    throw new ExpansionPackProjectError(
      'The replacement parent must be one exact published release.',
      'parent-release-not-exact',
    );
  }
  const exactIdentityFields = [
    ['rootMakerId', 'parent-release-root-mismatch'],
    ['versionNumber', 'parent-release-version-mismatch'],
    ['versionId', 'parent-release-version-id-mismatch'],
  ];
  exactIdentityFields.forEach(([field, code]) => {
    const expected = String(source.parentBinding?.[field] ?? '').trim();
    const actual = String(binding[field] ?? '').trim();
    if (!expected || expected !== actual) {
      throw new ExpansionPackProjectError(
        `Published parent ${field} does not match the local parent snapshot.`,
        code,
        { field, expected, actual },
      );
    }
  });
  const sourceManifestHash = normalizeManifestSha256(source.parentBinding.manifestHash);
  if (/^[0-9a-f]{64}$/.test(sourceManifestHash) && sourceManifestHash !== binding.manifestHash) {
    throw new ExpansionPackProjectError(
      'Published parent manifest does not match the exact local parent commitment.',
      'parent-release-manifest-mismatch',
      { expected: sourceManifestHash, actual: binding.manifestHash },
    );
  }

  const publishedSnapshot = parentReleaseSnapshot(publishedParentMaker, binding);
  const mismatches = inheritedParentContractMismatches(source.parentSnapshot, publishedSnapshot);
  if (mismatches.length) {
    throw new ExpansionPackProjectError(
      'Published parent release changes one or more inherited Maker contracts.',
      'parent-release-inheritance-mismatch',
      { fields: mismatches },
    );
  }

  const pack = rebasePackParentFields(source.pack, binding);
  const compatibility = checkExpansionPackCompatibility(publishedSnapshot, pack);
  if (!compatibility.compatible) {
    throw new ExpansionPackProjectError(
      'Expansion Pack content is not compatible with the published parent release.',
      'pack-published-parent-incompatible',
      { errors: clone(compatibility.errors), warnings: clone(compatibility.warnings) },
    );
  }

  const rebound = {
    ...clone(source),
    parentBinding: binding,
    inheritance: clone(EXPANSION_PACK_PARENT_INHERITANCE),
    pack,
    publication: {
      state: 'draft',
      publishable: true,
      chainState: 'unpublished',
    },
    updatedAt: Number.isFinite(options.now) ? Number(options.now) : source.updatedAt,
  };
  return lockParentSnapshot(rebound, deepFreeze(publishedSnapshot));
}

export function readExpansionPackParentSnapshot(project) {
  return deepFreeze(clone(rehydrateExpansionPackProject(project).parentSnapshot));
}

function assertProjectShape(project) {
  if (project?.schemaVersion !== EXPANSION_PACK_PROJECT_SCHEMA) {
    throw new ExpansionPackProjectError(
      'Unsupported Expansion Pack project schema.',
      'unsupported-project-schema',
      { expected: EXPANSION_PACK_PROJECT_SCHEMA, actual: project?.schemaVersion },
    );
  }
  requireText(project.packId, 'Expansion Pack id', 'missing-pack-id');
  requireText(project.ownerWalletAddress, 'Wallet address', 'missing-project-wallet');
  requireText(project.parentBinding?.rootMakerId, 'Parent Maker root id', 'missing-parent-maker-id');
  requireText(project.parentBinding?.kind, 'Parent binding kind', 'missing-parent-binding-kind');
  requireText(project.parentBinding?.identity, 'Parent release identity', 'missing-parent-release-identity');
  if (!project.pack || typeof project.pack !== 'object' || Array.isArray(project.pack)) {
    throw new ExpansionPackProjectError('Expansion Pack overlay is required.', 'missing-pack-overlay');
  }
}

function mutableProject(project) {
  const copy = rehydrateExpansionPackProject(project);
  assertProjectShape(copy);
  return copy;
}

function finishMutation(project, now = Date.now()) {
  project.updatedAt = Number.isFinite(now) ? Number(now) : Date.now();
  return project;
}

export function updateExpansionPackCommerce(projectValue, patchValue = {}, options = {}) {
  const project = mutableProject(projectValue);
  if (!patchValue || typeof patchValue !== 'object' || Array.isArray(patchValue)) {
    throw new ExpansionPackProjectError(
      'Expansion Pack commerce update must be an object.',
      'invalid-pack-commerce-update',
    );
  }
  const allowed = new Set(['accessMode', 'priceDecimal']);
  const unsupported = Object.keys(patchValue).filter((field) => !allowed.has(field));
  if (unsupported.length) {
    throw new ExpansionPackProjectError(
      'Expansion Pack commerce update contains unsupported fields.',
      'unsupported-pack-commerce-update',
      { fields: unsupported },
    );
  }
  project.pack.commerce = normalizeExpansionPackCommerce({
    ...(project.pack.commerce || {}),
    ...patchValue,
  });
  return finishMutation(project, options.now);
}

function partsOf(maker) {
  return Array.isArray(maker?.parts) ? maker.parts : [];
}

function itemsOf(part) {
  return Array.isArray(part?.items) ? part.items : [];
}

function stylesOf(item) {
  return Array.isArray(item?.styles) ? item.styles : [];
}

function idOf(value) {
  return String(value?.id ?? value?.key ?? '').trim();
}

function parentSupportsComposableV6(parentSnapshot) {
  const composable = parentSnapshot?.extensions?.composableV6;
  return Boolean(
    composable
    && typeof composable === 'object'
    && !Array.isArray(composable)
    && String(composable.profile?.mode || '').toUpperCase() === 'COMPOSABLE'
    && composable.compatibility
    && typeof composable.compatibility === 'object'
    && !Array.isArray(composable.compatibility),
  );
}

function recipeContainsSelection(recipe, expected) {
  return (recipe?.selections || []).some((selection) => (
    String(selection?.partId || '') === String(expected.partId)
    && String(selection?.itemId || '') === String(expected.itemId)
    && String(selection?.styleId || '') === String(expected.styleId)
  ));
}

function makerRuleViolationCodes(result) {
  return [...new Set((result?.violations || [])
    .map((issue) => String(issue?.code || ''))
    .filter(Boolean))];
}

function mergedRuleGraphIssues(project, merged) {
  const issues = [];
  try {
    const index = createMakerRuleIndex(merged);
    const previewRecipe = createExpansionPackProjectPreviewRecipe(project, merged);
    const previewEvaluation = evaluateRecipe(merged, previewRecipe, { index });
    if (!previewEvaluation.valid) {
      issues.push({
        severity: 'error',
        code: 'pack-preview-recipe-rule-violation',
        path: 'previewRecipe',
        violations: makerRuleViolationCodes(previewEvaluation),
        message: 'The merged Expansion Pack preview Recipe violates Maker rules or visibility conditions.',
      });
    }

    const graphResult = normalizeRecipe(
      merged,
      { selections: [], colors: merged.defaultRecipe?.colors || [] },
      { index },
    );
    if (!graphResult.valid) {
      const exhausted = makerRuleViolationCodes(graphResult).includes('constraint-search-limit');
      issues.push({
        severity: 'error',
        code: exhausted ? 'pack-rule-search-limit' : 'unsatisfiable-pack-rule-graph',
        path: 'rules',
        message: exhausted
          ? 'Expansion Pack rule validation reached its safety limit.'
          : 'No playable public Recipe satisfies the merged Expansion Pack rule graph.',
      });
      return issues;
    }

    let reachableStyleCount = 0;
    let inconclusiveStyleCount = 0;
    partsOf(merged).forEach((part) => {
      itemsOf(part)
        .filter((item) => item?.enabled !== false && String(item?.status || 'public').toLowerCase() === 'public')
        .forEach((item) => {
          let itemHasReachableStyle = false;
          let itemReachabilityConclusive = true;
          stylesOf(item).forEach((style) => {
            const expected = { partId: idOf(part), itemId: idOf(item), styleId: idOf(style) };
            const candidateResult = normalizeRecipe(
              merged,
              {
                selections: [expected],
                colors: merged.defaultRecipe?.colors || [],
              },
              { index, lockedPartIds: [expected.partId] },
            );
            const reachable = candidateResult.valid
              && recipeContainsSelection(candidateResult.documentRecipe, expected);
            if (reachable) {
              itemHasReachableStyle = true;
              reachableStyleCount += 1;
              return;
            }
            if (makerRuleViolationCodes(candidateResult).includes('constraint-search-limit')) {
              itemReachabilityConclusive = false;
              inconclusiveStyleCount += 1;
              issues.push({
                severity: 'error',
                code: 'pack-rule-search-limit',
                path: `${expected.partId}/${expected.itemId}/${expected.styleId}`,
                message: 'A public Style could not be proven reachable before the rule-search safety limit.',
              });
              return;
            }
            issues.push({
              severity: 'error',
              code: 'unreachable-public-style-rules',
              path: `${expected.partId}/${expected.itemId}/${expected.styleId}`,
              message: 'A public Style cannot appear in any valid merged player Recipe.',
            });
          });
          if (!itemHasReachableStyle && itemReachabilityConclusive) {
            issues.push({
              severity: 'error',
              code: 'unreachable-public-item-rules',
              path: `${idOf(part)}/${idOf(item)}`,
              message: 'A public Item cannot appear in any valid merged player Recipe.',
            });
          }
        });
    });
    if (reachableStyleCount === 0 && inconclusiveStyleCount === 0) {
      issues.push({
        severity: 'error',
        code: 'unsatisfiable-pack-rule-graph',
        path: 'rules',
        message: 'No public Style can appear in a playable merged Recipe.',
      });
    }
  } catch (error) {
    issues.push({
      severity: 'error',
      code: 'pack-rule-evaluation-failed',
      path: 'rules',
      message: error?.message || 'Merged Expansion Pack rules could not be evaluated.',
    });
  }
  return issues;
}

function findParentPart(project, partId) {
  return partsOf(project.parentSnapshot).find((part) => idOf(part) === partId) || null;
}

function findPackPart(project, partId) {
  return partsOf(project.pack).find((part) => (
    idOf(part) === partId
    || String(part?.extendsPartId ?? part?.targetPartId ?? '').trim() === partId
  )) || null;
}

function findOrCreatePartExtension(project, partId) {
  let extension = findPackPart(project, partId);
  if (extension && idOf(extension)) {
    throw new ExpansionPackProjectError(
      'A Pack-owned Part cannot extend a parent Part with the same id.',
      'pack-part-target-collision',
      { partId },
    );
  }
  if (!extension) {
    extension = { extendsPartId: partId, items: [] };
    project.pack.parts.push(extension);
  }
  extension.items = itemsOf(extension);
  return extension;
}

function appendDefinitions(project, definitions = {}) {
  const groups = [
    ['assets', 'asset'],
    ['layerTracks', 'Layer Track'],
    ['colorChannels', 'Smart Color channel'],
  ];
  groups.forEach(([field, label]) => {
    const additions = Array.isArray(definitions[field]) ? definitions[field] : [];
    project.pack[field] = Array.isArray(project.pack[field]) ? project.pack[field] : [];
    additions.forEach((value) => {
      const id = requireLocalId(idOf(value), `${label} id`, project.namespace);
      if (project.pack[field].some((candidate) => idOf(candidate) === id)) {
        throw new ExpansionPackProjectError(
          `${label} ${id} already exists in this Pack.`,
          'duplicate-pack-definition',
          { field, id },
        );
      }
      project.pack[field].push(clone(value));
    });
  });
}

function packDefinitions(project, field) {
  project.pack[field] = Array.isArray(project.pack[field]) ? project.pack[field] : [];
  return project.pack[field];
}

function parentDefinition(project, field, id) {
  const source = field === 'colorChannels'
    ? project.parentSnapshot?.colorChannels ?? project.parentSnapshot?.palettes
    : project.parentSnapshot?.[field];
  return (Array.isArray(source) ? source : []).find((value) => idOf(value) === id) || null;
}

function readonlyParentDefinition(kind, id) {
  throw new ExpansionPackProjectError(
    `${kind} ${id} belongs to the read-only parent Maker.`,
    'parent-definition-readonly',
    { kind, id },
  );
}

function editablePackDefinition(project, field, id, kind) {
  if (parentDefinition(project, field, id)) readonlyParentDefinition(kind, id);
  const value = packDefinitions(project, field).find((candidate) => idOf(candidate) === id) || null;
  if (!value) readonlyParentDefinition(kind, id);
  return value;
}

function reusableDefinition(value, ignoredFields = []) {
  const ignored = new Set([
    'id',
    'key',
    'order',
    'renderOrder',
    'expansionPackId',
    'expansionNamespace',
    ...ignoredFields,
  ]);
  return stableComparableValue(Object.fromEntries(
    Object.entries(value || {}).filter(([field]) => !ignored.has(field)),
  ));
}

function exactReusableDefinition(parent, candidate, ignoredFields = []) {
  return comparableJson(reusableDefinition(parent, ignoredFields))
    === comparableJson(reusableDefinition(candidate, ignoredFields));
}

function normalizePackTrackOrder(project) {
  packDefinitions(project, 'layerTracks').forEach((track, index) => {
    track.order = index;
    delete track.renderOrder;
    delete track.transform;
    if (typeof track.locked !== 'boolean') track.locked = false;
    track.referenceAssetId ??= null;
  });
}

function normalizedLayerTrack(value, namespace, index) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ExpansionPackProjectError('Layer Track must be an object.', 'invalid-pack-layer-track');
  }
  const track = clone(value);
  track.id = requireLocalId(idOf(track), 'Layer Track id', namespace);
  delete track.key;
  delete track.renderOrder;
  delete track.transform;
  track.name = requireText(track.name ?? track.id, 'Layer Track name', 'missing-layer-track-name');
  track.order = index;
  track.locked = track.locked === true;
  track.referenceAssetId = track.referenceAssetId == null
    ? null
    : requireText(track.referenceAssetId, 'Layer Track reference Asset id', 'missing-layer-track-reference-asset');
  return track;
}

/** Add a Pack-owned Layer Track. Parent Tracks remain reusable but immutable. */
export function addExpansionPackLayerTrack(projectValue, trackValue = {}, options = {}) {
  const project = mutableProject(projectValue);
  const tracks = packDefinitions(project, 'layerTracks');
  const track = normalizedLayerTrack(trackValue, project.namespace, tracks.length);
  const inherited = parentDefinition(project, 'layerTracks', track.id);
  if ((inherited && !exactReusableDefinition(inherited, track, ['transform']))
    || tracks.some((candidate) => idOf(candidate) === track.id)) {
    throw new ExpansionPackProjectError(
      `Layer Track ${track.id} already exists in the parent Maker or this Pack.`,
      'duplicate-pack-layer-track',
      { id: track.id },
    );
  }
  tracks.push(track);
  normalizePackTrackOrder(project);
  return finishMutation(project, options.now);
}

export function renameExpansionPackLayerTrack(projectValue, trackIdValue, nameValue, options = {}) {
  const project = mutableProject(projectValue);
  const trackId = requireText(trackIdValue, 'Layer Track id', 'missing-layer-track-id');
  const track = editablePackDefinition(project, 'layerTracks', trackId, 'layerTrack');
  if (track.locked) {
    throw new ExpansionPackProjectError('Unlock the Layer Track before renaming it.', 'pack-layer-track-locked', { trackId });
  }
  track.name = requireText(nameValue, 'Layer Track name', 'missing-layer-track-name');
  return finishMutation(project, options.now);
}

export function setExpansionPackLayerTrackLocked(projectValue, trackIdValue, lockedValue, options = {}) {
  const project = mutableProject(projectValue);
  const trackId = requireText(trackIdValue, 'Layer Track id', 'missing-layer-track-id');
  editablePackDefinition(project, 'layerTracks', trackId, 'layerTrack').locked = lockedValue === true;
  return finishMutation(project, options.now);
}

export function moveExpansionPackLayerTrack(projectValue, trackIdValue, targetIndexValue, options = {}) {
  const project = mutableProject(projectValue);
  const trackId = requireText(trackIdValue, 'Layer Track id', 'missing-layer-track-id');
  const tracks = packDefinitions(project, 'layerTracks');
  const fromIndex = tracks.findIndex((track) => idOf(track) === trackId);
  if (fromIndex < 0) readonlyParentDefinition('layerTrack', trackId);
  const targetIndex = Number(targetIndexValue);
  if (!Number.isSafeInteger(targetIndex) || targetIndex < 0 || targetIndex >= tracks.length) {
    throw new ExpansionPackProjectError('Layer Track target position is out of range.', 'invalid-pack-layer-track-position', {
      trackId,
      targetIndex: targetIndexValue,
    });
  }
  if (tracks[fromIndex].locked || tracks[targetIndex].locked) {
    throw new ExpansionPackProjectError('Locked Layer Tracks cannot be reordered.', 'pack-layer-track-locked', { trackId });
  }
  const [track] = tracks.splice(fromIndex, 1);
  tracks.splice(targetIndex, 0, track);
  normalizePackTrackOrder(project);
  return finishMutation(project, options.now);
}

export function removeExpansionPackLayerTrack(projectValue, trackIdValue, options = {}) {
  const project = mutableProject(projectValue);
  const trackId = requireText(trackIdValue, 'Layer Track id', 'missing-layer-track-id');
  const track = editablePackDefinition(project, 'layerTracks', trackId, 'layerTrack');
  if (track.locked) {
    throw new ExpansionPackProjectError('Unlock the Layer Track before removing it.', 'pack-layer-track-locked', { trackId });
  }
  const referenced = partsOf(project.pack).some((part) => itemsOf(part).some((item) => (
    stylesOf(item).some((style) => String(style.layerTrackId || '') === trackId)
  )));
  if (referenced) {
    throw new ExpansionPackProjectError('Layer Track is still referenced by a Pack Style.', 'pack-layer-track-in-use', { trackId });
  }
  project.pack.layerTracks = packDefinitions(project, 'layerTracks').filter((candidate) => candidate !== track);
  normalizePackTrackOrder(project);
  return finishMutation(project, options.now);
}

function normalizedHexColor(value, label) {
  const color = String(value ?? '').trim().toLowerCase();
  if (!/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/.test(color)) {
    throw new ExpansionPackProjectError(`${label} must be a six- or eight-digit hex color.`, 'invalid-pack-color', { value });
  }
  return color;
}

function normalizedSwatch(value, namespace) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ExpansionPackProjectError('Smart Color swatch must be an object.', 'invalid-pack-color-swatch');
  }
  const swatch = clone(value);
  swatch.id = requireLocalId(idOf(swatch), 'Smart Color swatch id', namespace);
  delete swatch.key;
  swatch.name = requireText(swatch.name ?? swatch.id, 'Smart Color swatch name', 'missing-color-swatch-name');
  swatch.hintColor = normalizedHexColor(swatch.hintColor, 'Smart Color hint');
  if (!Array.isArray(swatch.stops) || swatch.stops.length < 2) {
    throw new ExpansionPackProjectError('Smart Color swatch needs at least two stops.', 'invalid-pack-color-stops');
  }
  swatch.stops = swatch.stops.map((stop) => {
    const offset = Number(stop?.offset);
    if (!Number.isFinite(offset) || offset < 0 || offset > 1) {
      throw new ExpansionPackProjectError('Smart Color stop offsets must be between zero and one.', 'invalid-pack-color-stop-offset', { offset });
    }
    return { offset, color: normalizedHexColor(stop?.color, 'Smart Color stop') };
  });
  if (swatch.stops[0].offset !== 0 || swatch.stops.at(-1).offset !== 1
    || swatch.stops.some((stop, index) => index > 0 && stop.offset <= swatch.stops[index - 1].offset)) {
    throw new ExpansionPackProjectError('Smart Color stops must be strictly ordered from zero through one.', 'invalid-pack-color-stops');
  }
  return swatch;
}

function normalizedColorChannel(value, namespace, index) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ExpansionPackProjectError('Smart Color channel must be an object.', 'invalid-pack-color-channel');
  }
  const channel = clone(value);
  channel.id = requireLocalId(idOf(channel), 'Smart Color channel id', namespace);
  delete channel.key;
  channel.name = requireText(channel.name ?? channel.id, 'Smart Color channel name', 'missing-color-channel-name');
  channel.order = index;
  channel.mode = String(channel.mode || 'gradient-map');
  if (channel.mode !== 'gradient-map') {
    throw new ExpansionPackProjectError('Smart Color channel mode must be gradient-map.', 'invalid-pack-color-channel-mode');
  }
  channel.swatches = (Array.isArray(channel.swatches) ? channel.swatches : [])
    .map((swatch) => normalizedSwatch(swatch, namespace));
  const ids = new Set();
  channel.swatches.forEach((swatch) => {
    if (ids.has(swatch.id)) {
      throw new ExpansionPackProjectError(`Smart Color swatch ${swatch.id} is duplicated.`, 'duplicate-pack-color-swatch', { id: swatch.id });
    }
    ids.add(swatch.id);
  });
  if (!channel.swatches.length) {
    throw new ExpansionPackProjectError('Smart Color channel needs at least one swatch.', 'empty-pack-color-channel');
  }
  channel.defaultSwatchId = String(channel.defaultSwatchId || channel.swatches[0].id);
  if (!ids.has(channel.defaultSwatchId)) {
    throw new ExpansionPackProjectError('Smart Color default swatch does not exist.', 'missing-pack-default-color-swatch', {
      channelId: channel.id,
      swatchId: channel.defaultSwatchId,
    });
  }
  return channel;
}

function normalizePackColorOrder(project) {
  packDefinitions(project, 'colorChannels').forEach((channel, index) => { channel.order = index; });
}

export function addExpansionPackColorChannel(projectValue, channelValue = {}, options = {}) {
  const project = mutableProject(projectValue);
  const channels = packDefinitions(project, 'colorChannels');
  const channel = normalizedColorChannel(channelValue, project.namespace, channels.length);
  const inherited = parentDefinition(project, 'colorChannels', channel.id);
  if ((inherited && !exactReusableDefinition(inherited, channel))
    || channels.some((candidate) => idOf(candidate) === channel.id)) {
    throw new ExpansionPackProjectError(
      `Smart Color channel ${channel.id} already exists in the parent Maker or this Pack.`,
      'duplicate-pack-color-channel',
      { id: channel.id },
    );
  }
  channels.push(channel);
  normalizePackColorOrder(project);
  return finishMutation(project, options.now);
}

export function updateExpansionPackColorChannel(projectValue, channelIdValue, patchValue = {}, options = {}) {
  const project = mutableProject(projectValue);
  const channelId = requireText(channelIdValue, 'Smart Color channel id', 'missing-color-channel-id');
  const channel = editablePackDefinition(project, 'colorChannels', channelId, 'colorChannel');
  if (!patchValue || typeof patchValue !== 'object' || Array.isArray(patchValue)) {
    throw new ExpansionPackProjectError('Smart Color channel update must be an object.', 'invalid-pack-color-channel-update');
  }
  const allowed = new Set(['name', 'defaultSwatchId']);
  const unsupported = Object.keys(patchValue).filter((field) => !allowed.has(field));
  if (unsupported.length) {
    throw new ExpansionPackProjectError('Smart Color channel update contains unsupported fields.', 'unsupported-pack-color-channel-update', { fields: unsupported });
  }
  if (Object.hasOwn(patchValue, 'name')) {
    channel.name = requireText(patchValue.name, 'Smart Color channel name', 'missing-color-channel-name');
  }
  if (Object.hasOwn(patchValue, 'defaultSwatchId')) {
    const swatchId = requireText(patchValue.defaultSwatchId, 'Default swatch id', 'missing-color-swatch-id');
    if (!channel.swatches.some((swatch) => idOf(swatch) === swatchId)) {
      throw new ExpansionPackProjectError('Smart Color default swatch does not exist.', 'missing-pack-default-color-swatch', { channelId, swatchId });
    }
    channel.defaultSwatchId = swatchId;
  }
  return finishMutation(project, options.now);
}

export function addExpansionPackColorSwatch(projectValue, channelIdValue, swatchValue = {}, options = {}) {
  const project = mutableProject(projectValue);
  const channelId = requireText(channelIdValue, 'Smart Color channel id', 'missing-color-channel-id');
  const channel = editablePackDefinition(project, 'colorChannels', channelId, 'colorChannel');
  const swatch = normalizedSwatch(swatchValue, project.namespace);
  if (channel.swatches.some((candidate) => idOf(candidate) === swatch.id)) {
    throw new ExpansionPackProjectError(`Smart Color swatch ${swatch.id} already exists.`, 'duplicate-pack-color-swatch', { id: swatch.id });
  }
  channel.swatches.push(swatch);
  return finishMutation(project, options.now);
}

export function updateExpansionPackColorSwatch(projectValue, channelIdValue, swatchIdValue, patchValue = {}, options = {}) {
  const project = mutableProject(projectValue);
  const channelId = requireText(channelIdValue, 'Smart Color channel id', 'missing-color-channel-id');
  const swatchId = requireText(swatchIdValue, 'Smart Color swatch id', 'missing-color-swatch-id');
  const channel = editablePackDefinition(project, 'colorChannels', channelId, 'colorChannel');
  const index = channel.swatches.findIndex((swatch) => idOf(swatch) === swatchId);
  if (index < 0) {
    throw new ExpansionPackProjectError(`Smart Color swatch ${swatchId} does not exist.`, 'missing-pack-color-swatch', { channelId, swatchId });
  }
  if (!patchValue || typeof patchValue !== 'object' || Array.isArray(patchValue)) {
    throw new ExpansionPackProjectError('Smart Color swatch update must be an object.', 'invalid-pack-color-swatch-update');
  }
  const allowed = new Set(['name', 'hintColor', 'stops']);
  const unsupported = Object.keys(patchValue).filter((field) => !allowed.has(field));
  if (unsupported.length) {
    throw new ExpansionPackProjectError('Smart Color swatch update contains unsupported fields.', 'unsupported-pack-color-swatch-update', { fields: unsupported });
  }
  channel.swatches[index] = normalizedSwatch({ ...channel.swatches[index], ...patchValue, id: swatchId }, project.namespace);
  return finishMutation(project, options.now);
}

export function removeExpansionPackColorSwatch(projectValue, channelIdValue, swatchIdValue, options = {}) {
  const project = mutableProject(projectValue);
  const channelId = requireText(channelIdValue, 'Smart Color channel id', 'missing-color-channel-id');
  const swatchId = requireText(swatchIdValue, 'Smart Color swatch id', 'missing-color-swatch-id');
  const channel = editablePackDefinition(project, 'colorChannels', channelId, 'colorChannel');
  if (!channel.swatches.some((swatch) => idOf(swatch) === swatchId)) {
    throw new ExpansionPackProjectError(`Smart Color swatch ${swatchId} does not exist.`, 'missing-pack-color-swatch', { channelId, swatchId });
  }
  if (channel.swatches.length <= 1) {
    throw new ExpansionPackProjectError('A Smart Color channel must keep at least one swatch.', 'last-pack-color-swatch', { channelId });
  }
  channel.swatches = channel.swatches.filter((swatch) => idOf(swatch) !== swatchId);
  if (channel.defaultSwatchId === swatchId) channel.defaultSwatchId = channel.swatches[0].id;
  return finishMutation(project, options.now);
}

export function removeExpansionPackColorChannel(projectValue, channelIdValue, options = {}) {
  const project = mutableProject(projectValue);
  const channelId = requireText(channelIdValue, 'Smart Color channel id', 'missing-color-channel-id');
  const channel = editablePackDefinition(project, 'colorChannels', channelId, 'colorChannel');
  const referenced = partsOf(project.pack).some((part) => itemsOf(part).some((item) => (
    stylesOf(item).some((style) => String(style.colorChannelId || style.paletteId || '') === channelId)
  )));
  if (referenced) {
    throw new ExpansionPackProjectError('Smart Color channel is still referenced by a Pack Style.', 'pack-color-channel-in-use', { channelId });
  }
  project.pack.colorChannels = packDefinitions(project, 'colorChannels').filter((candidate) => candidate !== channel);
  normalizePackColorOrder(project);
  return finishMutation(project, options.now);
}

function normalizedStyle(style, namespace) {
  if (!style || typeof style !== 'object' || Array.isArray(style)) {
    throw new ExpansionPackProjectError('Style must be an object.', 'invalid-pack-style');
  }
  const copy = clone(style);
  copy.id = requireLocalId(idOf(copy), 'Style id', namespace);
  delete copy.key;
  copy.transform = {
    x: 0,
    y: 0,
    scale: 1,
    rotation: 0,
    ...(copy.transform && typeof copy.transform === 'object' ? copy.transform : {}),
  };
  copy.opacity = Number.isFinite(copy.opacity) ? Number(copy.opacity) : 1;
  copy.blendMode = String(copy.blendMode || 'normal');
  copy.colorChannelId = copy.colorChannelId == null || copy.colorChannelId === ''
    ? null
    : String(copy.colorChannelId);
  copy.visibleWhen = copy.visibleWhen ?? null;
  copy.requires = Array.isArray(copy.requires) ? copy.requires : [];
  copy.excludes = Array.isArray(copy.excludes) ? copy.excludes : [];
  return copy;
}

function normalizedItem(item, namespace) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw new ExpansionPackProjectError('Item must be an object.', 'invalid-pack-item');
  }
  const copy = clone(item);
  copy.id = requireLocalId(idOf(copy), 'Item id', namespace);
  delete copy.key;
  copy.styles = stylesOf(copy).map((style) => normalizedStyle(style, namespace));
  const ids = new Set();
  copy.styles.forEach((style) => {
    if (ids.has(style.id)) {
      throw new ExpansionPackProjectError(
        `Style ${style.id} appears more than once in Item ${copy.id}.`,
        'duplicate-pack-style',
        { itemId: copy.id, styleId: style.id },
      );
    }
    ids.add(style.id);
  });
  copy.defaultStyleId = String(copy.defaultStyleId || copy.styles[0]?.id || '');
  if (copy.defaultStyleId && !copy.styles.some((style) => style.id === copy.defaultStyleId)) {
    throw new ExpansionPackProjectError(
      `Default Style ${copy.defaultStyleId} does not exist in Item ${copy.id}.`,
      'missing-pack-default-style',
      { itemId: copy.id, styleId: copy.defaultStyleId },
    );
  }
  copy.requires = Array.isArray(copy.requires) ? copy.requires : [];
  copy.excludes = Array.isArray(copy.excludes) ? copy.excludes : [];
  return copy;
}

function normalizedRuleSelector(value) {
  if (typeof value === 'string') {
    const [partId, itemId, styleId] = value.split(value.includes('/') ? '/' : ':');
    return {
      partId: requireText(partId, 'Rule selector Part id', 'invalid-pack-rule-selector'),
      ...(itemId ? { itemId: String(itemId) } : {}),
      ...(styleId ? { styleId: String(styleId) } : {}),
    };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ExpansionPackProjectError('Rule selector must be an object.', 'invalid-pack-rule-selector');
  }
  const selector = {
    ...(value.scope === 'base' || value.scope === 'pack' ? { scope: value.scope } : {}),
    partId: requireText(
      value.partId ?? value.partKey ?? value.part,
      'Rule selector Part id',
      'invalid-pack-rule-selector',
    ),
  };
  const itemId = String(value.itemId ?? value.itemKey ?? value.item ?? '').trim();
  const itemIds = Array.isArray(value.itemIds ?? value.itemKeys)
    ? [...new Set((value.itemIds ?? value.itemKeys).map((id) => String(id).trim()).filter(Boolean))].sort()
    : [];
  const styleId = String(value.styleId ?? value.styleKey ?? '').trim();
  const styleIds = Array.isArray(value.styleIds ?? value.styleKeys)
    ? [...new Set((value.styleIds ?? value.styleKeys).map((id) => String(id).trim()).filter(Boolean))].sort()
    : [];
  if (itemId) selector.itemId = itemId;
  if (itemIds.length) selector.itemIds = itemIds;
  if (styleId) selector.styleId = styleId;
  if (styleIds.length) selector.styleIds = styleIds;
  return selector;
}

function normalizedRuleTargets(value) {
  const targets = (Array.isArray(value) ? value : value == null ? [] : [value])
    .map(normalizedRuleSelector);
  if (!targets.length) {
    throw new ExpansionPackProjectError('Rule needs at least one target.', 'empty-pack-rule-targets');
  }
  return targets;
}

function normalizedExpansionPackRule(value, namespace) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ExpansionPackProjectError('Expansion Pack rule must be an object.', 'invalid-pack-rule');
  }
  const type = String(value.type ?? value.kind ?? '').trim();
  if (!['requires', 'excludes'].includes(type)) {
    throw new ExpansionPackProjectError('Expansion Pack rule type must be requires or excludes.', 'invalid-pack-rule-type', { type });
  }
  const rule = {
    id: requireLocalId(idOf(value), 'Expansion Pack rule id', namespace),
    type,
    trigger: normalizedRuleSelector(value.trigger ?? value.when ?? value.if ?? value.source ?? value.left),
    targets: normalizedRuleTargets(value.targets ?? value[type] ?? value.target ?? value.right),
  };
  return rule;
}

/** Add a Pack rule. Compatibility preflight remains the authority for additive base/local scope. */
export function addExpansionPackRule(projectValue, ruleValue = {}, options = {}) {
  const project = mutableProject(projectValue);
  const rules = packDefinitions(project, 'rules');
  const rule = normalizedExpansionPackRule(ruleValue, project.namespace);
  if (rules.some((candidate) => idOf(candidate) === rule.id)) {
    throw new ExpansionPackProjectError(`Expansion Pack rule ${rule.id} already exists.`, 'duplicate-pack-rule', { id: rule.id });
  }
  rules.push(rule);
  const compatibility = checkExpansionPackCompatibility(project.parentSnapshot, project.pack);
  if (!compatibility.compatible) {
    throw new ExpansionPackProjectError('Expansion Pack rule is not compatible with the parent Maker.', 'invalid-pack-rule-model', {
      errors: clone(compatibility.errors),
    });
  }
  return finishMutation(project, options.now);
}

export function updateExpansionPackRule(projectValue, ruleIdValue, patchValue = {}, options = {}) {
  const project = mutableProject(projectValue);
  const ruleId = requireText(ruleIdValue, 'Expansion Pack rule id', 'missing-pack-rule-id');
  const index = packDefinitions(project, 'rules').findIndex((rule) => idOf(rule) === ruleId);
  if (index < 0) readonlyParentDefinition('rule', ruleId);
  if (!patchValue || typeof patchValue !== 'object' || Array.isArray(patchValue)) {
    throw new ExpansionPackProjectError('Expansion Pack rule update must be an object.', 'invalid-pack-rule-update');
  }
  const allowed = new Set(['type', 'trigger', 'targets']);
  const unsupported = Object.keys(patchValue).filter((field) => !allowed.has(field));
  if (unsupported.length) {
    throw new ExpansionPackProjectError('Expansion Pack rule update contains unsupported fields.', 'unsupported-pack-rule-update', { fields: unsupported });
  }
  const current = project.pack.rules[index];
  project.pack.rules[index] = normalizedExpansionPackRule({ ...current, ...patchValue, id: ruleId }, project.namespace);
  const compatibility = checkExpansionPackCompatibility(project.parentSnapshot, project.pack);
  if (!compatibility.compatible) {
    throw new ExpansionPackProjectError('Expansion Pack rule is not compatible with the parent Maker.', 'invalid-pack-rule-model', {
      errors: clone(compatibility.errors),
    });
  }
  return finishMutation(project, options.now);
}

export function removeExpansionPackRule(projectValue, ruleIdValue, options = {}) {
  const project = mutableProject(projectValue);
  const ruleId = requireText(ruleIdValue, 'Expansion Pack rule id', 'missing-pack-rule-id');
  if (!packDefinitions(project, 'rules').some((rule) => idOf(rule) === ruleId)) {
    readonlyParentDefinition('rule', ruleId);
  }
  project.pack.rules = project.pack.rules.filter((rule) => idOf(rule) !== ruleId);
  return finishMutation(project, options.now);
}

function normalizedVisibilityCondition(value) {
  if (value == null) return null;
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(normalizedVisibilityCondition);
  if (!value || typeof value !== 'object') {
    throw new ExpansionPackProjectError('Visibility condition must be an object.', 'invalid-pack-visibility-condition');
  }
  if (value.op === 'selected' || value.partId || value.partKey || value.part) {
    return { ...normalizedRuleSelector(value), op: 'selected' };
  }
  if (value.op === 'not') {
    return { op: 'not', condition: normalizedVisibilityCondition(value.condition) };
  }
  if (value.op === 'all' || value.op === 'any') {
    if (!Array.isArray(value.conditions) || !value.conditions.length) {
      throw new ExpansionPackProjectError('Grouped visibility conditions cannot be empty.', 'invalid-pack-visibility-condition');
    }
    return { op: value.op, conditions: value.conditions.map(normalizedVisibilityCondition) };
  }
  throw new ExpansionPackProjectError('Unsupported visibility condition.', 'invalid-pack-visibility-condition');
}

function selectorBelongsToPack(selector, namespace) {
  if (selector?.scope === 'base') return false;
  const prefix = `${namespace}__`;
  return String(selector?.partId || '').startsWith(prefix)
    || String(selector?.itemId || '').startsWith(prefix)
    || (selector?.itemIds || []).some((id) => String(id).startsWith(prefix))
    || String(selector?.styleId || '').startsWith(prefix)
    || (selector?.styleIds || []).some((id) => String(id).startsWith(prefix));
}

function validatePackRuleSafety(merged, project) {
  const namespace = project.namespace;
  const rules = Array.isArray(merged?.rules) ? merged.rules : [];
  rules
    .filter((rule) => String(rule?.expansionPackId || '') === String(project.packId || ''))
    .forEach((rule) => {
      const triggerIsPack = selectorBelongsToPack(rule.trigger, namespace);
      const targetHasPack = (Array.isArray(rule.targets) ? rule.targets : [])
        .some((target) => selectorBelongsToPack(target, namespace));
      if (rule.type === 'requires' && !triggerIsPack) {
        throw new ExpansionPackProjectError(
          'A Pack requires-rule may only trigger from Pack-owned content.',
          'pack-rule-breaks-base-recipe',
          { ruleId: rule.id },
        );
      }
      if (rule.type === 'excludes' && !triggerIsPack && !targetHasPack) {
        throw new ExpansionPackProjectError(
          'A Pack excludes-rule must involve Pack-owned content.',
          'pack-rule-breaks-base-recipe',
          { ruleId: rule.id },
        );
      }
    });
}

function applyEmbeddedRulePatch(owner, patchValue) {
  if (!patchValue || typeof patchValue !== 'object' || Array.isArray(patchValue)) {
    throw new ExpansionPackProjectError('Definition rule update must be an object.', 'invalid-pack-definition-rule-update');
  }
  const allowed = new Set(['requires', 'excludes', 'visibleWhen']);
  const unsupported = Object.keys(patchValue).filter((field) => !allowed.has(field));
  if (unsupported.length) {
    throw new ExpansionPackProjectError('Definition rule update contains unsupported fields.', 'unsupported-pack-definition-rule-update', { fields: unsupported });
  }
  if (Object.hasOwn(patchValue, 'requires')) {
    owner.requires = patchValue.requires == null
      || (Array.isArray(patchValue.requires) && patchValue.requires.length === 0)
      ? []
      : normalizedRuleTargets(patchValue.requires);
  }
  if (Object.hasOwn(patchValue, 'excludes')) {
    owner.excludes = patchValue.excludes == null
      || (Array.isArray(patchValue.excludes) && patchValue.excludes.length === 0)
      ? []
      : normalizedRuleTargets(patchValue.excludes);
  }
  if (Object.hasOwn(patchValue, 'visibleWhen')) {
    owner.visibleWhen = normalizedVisibilityCondition(patchValue.visibleWhen);
  }
}

function validateEmbeddedRuleMutation(project) {
  const compatibility = checkExpansionPackCompatibility(project.parentSnapshot, project.pack);
  if (!compatibility.compatible) {
    throw new ExpansionPackProjectError('Definition rules are not compatible with the parent Maker.', 'invalid-pack-rule-model', {
      errors: clone(compatibility.errors),
    });
  }
  validatePackRuleSafety(compatibility.merged, project);
}

export function updateExpansionPackPartRules(projectValue, partIdValue, patchValue = {}, options = {}) {
  const project = mutableProject(projectValue);
  const partId = requireText(partIdValue, 'Part id', 'missing-target-part');
  applyEmbeddedRulePatch(editablePackPart(project, partId), patchValue);
  validateEmbeddedRuleMutation(project);
  return finishMutation(project, options.now);
}

export function updateExpansionPackItemRules(projectValue, partIdValue, itemIdValue, patchValue = {}, options = {}) {
  const project = mutableProject(projectValue);
  const partId = requireText(partIdValue, 'Part id', 'missing-target-part');
  const itemId = requireText(itemIdValue, 'Item id', 'missing-target-item');
  applyEmbeddedRulePatch(editablePackItem(project, partId, itemId), patchValue);
  validateEmbeddedRuleMutation(project);
  return finishMutation(project, options.now);
}

export function updateExpansionPackStyleRules(
  projectValue,
  partIdValue,
  itemIdValue,
  styleIdValue,
  patchValue = {},
  options = {},
) {
  const project = mutableProject(projectValue);
  const partId = requireText(partIdValue, 'Part id', 'missing-target-part');
  const itemId = requireText(itemIdValue, 'Item id', 'missing-target-item');
  const styleId = requireText(styleIdValue, 'Style id', 'missing-target-style');
  applyEmbeddedRulePatch(editablePackStyle(project, partId, itemId, styleId), patchValue);
  validateEmbeddedRuleMutation(project);
  return finishMutation(project, options.now);
}

export function setExpansionPackPartMode(projectValue, partIdValue, modeValue, options = {}) {
  const project = mutableProject(projectValue);
  const partId = requireText(partIdValue, 'Part id', 'missing-target-part');
  editablePackPart(project, partId);
  const mode = String(modeValue || '').toUpperCase();
  if (!Object.values(EXPANSION_PACK_PART_MODES).includes(mode)) {
    throw new ExpansionPackProjectError('Part mode must be FIXED or SLOT.', 'invalid-pack-part-mode', { mode: modeValue });
  }
  if (mode === EXPANSION_PACK_PART_MODES.SLOT && !parentSupportsComposableV6(project.parentSnapshot)) {
    throw new ExpansionPackProjectError(
      'SLOT mode requires an exact parent snapshot with composable v6 compatibility.',
      'pack-slot-requires-composable-v6-parent',
      { partId },
    );
  }
  project.pack.wardrobe.partModes[partId] = mode;
  return finishMutation(project, options.now);
}

/** Add a Pack-owned Item to either a parent Part or a Pack-owned Part. */
export function addExpansionPackItem(projectValue, input = {}, options = {}) {
  const project = mutableProject(projectValue);
  const partId = requireText(input.partId, 'Target Part id', 'missing-target-part');
  const item = normalizedItem(input.item, project.namespace);
  const parentPart = findParentPart(project, partId);
  const packPart = findPackPart(project, partId);
  if (!parentPart && !packPart) {
    throw new ExpansionPackProjectError(
      `Target Part ${partId} does not exist in the parent Maker or this Pack.`,
      'missing-target-part',
      { partId },
    );
  }
  const target = parentPart ? findOrCreatePartExtension(project, partId) : packPart;
  target.items = itemsOf(target);
  if (target.items.some((candidate) => !candidate.extendsItemId && idOf(candidate) === item.id)) {
    throw new ExpansionPackProjectError(
      `Item ${item.id} already exists in target Part ${partId}.`,
      'duplicate-pack-item',
      { partId, itemId: item.id },
    );
  }
  appendDefinitions(project, input);
  target.items.push(item);
  if (!parentPart && idOf(target) && !String(target.defaultItemId || '')) {
    target.defaultItemId = item.id;
  }
  return finishMutation(project, options.now);
}

/** Add one visual Style to a parent Item or a Pack-owned Item. */
export function addExpansionPackStyle(projectValue, input = {}, options = {}) {
  const project = mutableProject(projectValue);
  const partId = requireText(input.partId, 'Target Part id', 'missing-target-part');
  const itemId = requireText(input.itemId, 'Target Item id', 'missing-target-item');
  const style = normalizedStyle(input.style, project.namespace);
  const parentPart = findParentPart(project, partId);
  const parentItem = itemsOf(parentPart).find((item) => idOf(item) === itemId) || null;
  let targetItem = null;

  if (parentItem) {
    const extension = findOrCreatePartExtension(project, partId);
    targetItem = extension.items.find((item) => (
      String(item?.extendsItemId ?? item?.targetItemId ?? '').trim() === itemId
    ));
    if (!targetItem) {
      targetItem = { extendsItemId: itemId, styles: [] };
      extension.items.push(targetItem);
    }
  } else {
    const packPart = findPackPart(project, partId);
    targetItem = itemsOf(packPart).find((item) => idOf(item) === itemId) || null;
  }

  if (!targetItem) {
    throw new ExpansionPackProjectError(
      `Target Item ${partId}/${itemId} does not exist in the parent Maker or this Pack.`,
      'missing-target-item',
      { partId, itemId },
    );
  }
  targetItem.styles = stylesOf(targetItem);
  if (targetItem.styles.some((candidate) => idOf(candidate) === style.id)) {
    throw new ExpansionPackProjectError(
      `Style ${style.id} already exists in target Item ${partId}/${itemId}.`,
      'duplicate-pack-style',
      { partId, itemId, styleId: style.id },
    );
  }
  appendDefinitions(project, input);
  targetItem.styles.push(style);
  if (idOf(targetItem) && !String(targetItem.defaultStyleId || '')) {
    targetItem.defaultStyleId = style.id;
  }
  return finishMutation(project, options.now);
}

/** Add a new optional player-menu Part. Required Parts are never allowed. */
export function addExpansionPackOptionalPart(projectValue, input = {}, options = {}) {
  const project = mutableProject(projectValue);
  if (!input.part || typeof input.part !== 'object' || Array.isArray(input.part)) {
    throw new ExpansionPackProjectError('Optional Part must be an object.', 'invalid-pack-part');
  }
  const part = clone(input.part);
  part.id = requireLocalId(idOf(part), 'Part id', project.namespace);
  delete part.key;
  delete part.extendsPartId;
  delete part.extendsPartKey;
  delete part.targetPartId;
  part.required = false;
  part.allowRemove = true;
  part.items = itemsOf(part).map((item) => normalizedItem(item, project.namespace));
  const itemIds = new Set();
  part.items.forEach((item) => {
    if (itemIds.has(item.id)) {
      throw new ExpansionPackProjectError(
        `Item ${item.id} appears more than once in Part ${part.id}.`,
        'duplicate-pack-item',
        { partId: part.id, itemId: item.id },
      );
    }
    itemIds.add(item.id);
  });
  part.defaultItemId = String(part.defaultItemId || part.items[0]?.id || '');
  if (part.defaultItemId && !part.items.some((item) => item.id === part.defaultItemId)) {
    throw new ExpansionPackProjectError(
      `Default Item ${part.defaultItemId} does not exist in Part ${part.id}.`,
      'missing-pack-default-item',
      { partId: part.id, itemId: part.defaultItemId },
    );
  }
  part.requires = Array.isArray(part.requires) ? part.requires : [];
  part.excludes = Array.isArray(part.excludes) ? part.excludes : [];
  if (findParentPart(project, part.id) || findPackPart(project, part.id)) {
    throw new ExpansionPackProjectError(
      `Part ${part.id} already exists in the parent Maker or this Pack.`,
      'duplicate-pack-part',
      { partId: part.id },
    );
  }
  appendDefinitions(project, input);
  project.pack.parts.push(part);
  return finishMutation(project, options.now);
}

function editablePackPart(project, partId) {
  const part = findPackPart(project, partId);
  if (!part || !idOf(part)) {
    throw new ExpansionPackProjectError(
      `Part ${partId} belongs to the read-only parent Maker.`,
      'parent-definition-readonly',
      { kind: 'part', partId },
    );
  }
  return part;
}

function editablePackItem(project, partId, itemId) {
  const part = findPackPart(project, partId);
  const item = itemsOf(part).find((candidate) => idOf(candidate) === itemId) || null;
  if (!item) {
    throw new ExpansionPackProjectError(
      `Item ${partId}/${itemId} belongs to the read-only parent Maker.`,
      'parent-definition-readonly',
      { kind: 'item', partId, itemId },
    );
  }
  return item;
}

function editablePackStyle(project, partId, itemId, styleId) {
  const part = findPackPart(project, partId);
  const item = itemsOf(part).find((candidate) => (
    idOf(candidate) === itemId
    || String(candidate?.extendsItemId ?? candidate?.targetItemId ?? '').trim() === itemId
  )) || null;
  const style = stylesOf(item).find((candidate) => idOf(candidate) === styleId) || null;
  if (!style) {
    throw new ExpansionPackProjectError(
      `Style ${partId}/${itemId}/${styleId} is not owned by this Expansion Pack.`,
      'parent-definition-readonly',
      { kind: 'style', partId, itemId, styleId },
    );
  }
  return style;
}

function removeEmptyParentExtension(project, part) {
  if (!partTargetIdOf(part) || itemsOf(part).length > 0) return;
  project.pack.parts = partsOf(project.pack).filter((candidate) => candidate !== part);
}

function partTargetIdOf(part) {
  return String(part?.extendsPartId ?? part?.targetPartId ?? '').trim();
}

export function removeExpansionPackPart(projectValue, partIdValue, options = {}) {
  const project = mutableProject(projectValue);
  const partId = requireText(partIdValue, 'Part id', 'missing-target-part');
  const part = editablePackPart(project, partId);
  project.pack.parts = partsOf(project.pack).filter((candidate) => candidate !== part);
  delete project.pack.wardrobe.partModes[partId];
  return finishMutation(project, options.now);
}

export function removeExpansionPackItem(
  projectValue,
  partIdValue,
  itemIdValue,
  options = {},
) {
  const project = mutableProject(projectValue);
  const partId = requireText(partIdValue, 'Part id', 'missing-target-part');
  const itemId = requireText(itemIdValue, 'Item id', 'missing-target-item');
  const part = findPackPart(project, partId);
  const item = editablePackItem(project, partId, itemId);
  part.items = itemsOf(part).filter((candidate) => candidate !== item);
  if (idOf(part) && String(part.defaultItemId || '') === itemId) {
    part.defaultItemId = idOf(part.items[0]);
  }
  removeEmptyParentExtension(project, part);
  return finishMutation(project, options.now);
}

export function removeExpansionPackStyle(
  projectValue,
  partIdValue,
  itemIdValue,
  styleIdValue,
  options = {},
) {
  const project = mutableProject(projectValue);
  const partId = requireText(partIdValue, 'Part id', 'missing-target-part');
  const itemId = requireText(itemIdValue, 'Item id', 'missing-target-item');
  const styleId = requireText(styleIdValue, 'Style id', 'missing-target-style');
  const part = findPackPart(project, partId);
  const item = itemsOf(part).find((candidate) => (
    idOf(candidate) === itemId
    || String(candidate?.extendsItemId ?? candidate?.targetItemId ?? '').trim() === itemId
  )) || null;
  const style = editablePackStyle(project, partId, itemId, styleId);
  item.styles = stylesOf(item).filter((candidate) => candidate !== style);
  if (idOf(item) && String(item.defaultStyleId || '') === styleId) {
    item.defaultStyleId = idOf(item.styles[0]);
  }
  if (!idOf(item) && item.styles.length === 0) {
    part.items = itemsOf(part).filter((candidate) => candidate !== item);
  }
  removeEmptyParentExtension(project, part);
  return finishMutation(project, options.now);
}

const STYLE_UPDATE_FIELDS = new Set([
  'assetId',
  'layerTrackId',
  'colorChannelId',
  'transform',
  'opacity',
  'blendMode',
]);
const TRANSFORM_UPDATE_FIELDS = new Set(['x', 'y', 'scale', 'rotation']);

function finiteStyleNumber(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new ExpansionPackProjectError(
      `Style ${field} must be a finite number.`,
      'invalid-pack-style-number',
      { field, value },
    );
  }
  return number;
}

export function updateExpansionPackStyle(
  projectValue,
  partIdValue,
  itemIdValue,
  styleIdValue,
  patchValue = {},
  options = {},
) {
  const project = mutableProject(projectValue);
  const partId = requireText(partIdValue, 'Part id', 'missing-target-part');
  const itemId = requireText(itemIdValue, 'Item id', 'missing-target-item');
  const styleId = requireText(styleIdValue, 'Style id', 'missing-target-style');
  if (!patchValue || typeof patchValue !== 'object' || Array.isArray(patchValue)) {
    throw new ExpansionPackProjectError('Style update must be an object.', 'invalid-pack-style-update');
  }
  const unsupported = Object.keys(patchValue).filter((field) => !STYLE_UPDATE_FIELDS.has(field));
  if (unsupported.length) {
    throw new ExpansionPackProjectError(
      'Style update contains unsupported fields.',
      'unsupported-pack-style-update',
      { fields: unsupported },
    );
  }
  const style = editablePackStyle(project, partId, itemId, styleId);
  appendDefinitions(project, options);
  if (Object.hasOwn(patchValue, 'assetId')) {
    style.assetId = requireText(patchValue.assetId, 'Style asset id', 'missing-pack-style-asset');
  }
  if (Object.hasOwn(patchValue, 'layerTrackId')) {
    style.layerTrackId = requireText(
      patchValue.layerTrackId,
      'Style Layer Track id',
      'missing-pack-style-layer-track',
    );
  }
  if (Object.hasOwn(patchValue, 'colorChannelId')) {
    style.colorChannelId = patchValue.colorChannelId == null || patchValue.colorChannelId === ''
      ? null
      : requireText(
        patchValue.colorChannelId,
        'Style Smart Color channel id',
        'missing-pack-style-color-channel',
      );
  }
  if (Object.hasOwn(patchValue, 'transform')) {
    if (!patchValue.transform || typeof patchValue.transform !== 'object' || Array.isArray(patchValue.transform)) {
      throw new ExpansionPackProjectError('Style transform update must be an object.', 'invalid-pack-style-transform');
    }
    const unsupportedTransform = Object.keys(patchValue.transform)
      .filter((field) => !TRANSFORM_UPDATE_FIELDS.has(field));
    if (unsupportedTransform.length) {
      throw new ExpansionPackProjectError(
        'Style transform update contains unsupported fields.',
        'unsupported-pack-style-transform',
        { fields: unsupportedTransform },
      );
    }
    const transform = {
      x: 0,
      y: 0,
      scale: 1,
      rotation: 0,
      ...(style.transform && typeof style.transform === 'object' ? style.transform : {}),
    };
    Object.entries(patchValue.transform).forEach(([field, value]) => {
      const number = finiteStyleNumber(value, `transform.${field}`);
      if (field === 'scale' && number <= 0) {
        throw new ExpansionPackProjectError(
          'Style scale must be greater than zero.',
          'invalid-pack-style-scale',
          { value: number },
        );
      }
      transform[field] = number;
    });
    style.transform = transform;
  }
  if (Object.hasOwn(patchValue, 'opacity')) {
    const opacity = finiteStyleNumber(patchValue.opacity, 'opacity');
    if (opacity < 0 || opacity > 1) {
      throw new ExpansionPackProjectError(
        'Style opacity must be between 0 and 1.',
        'invalid-pack-style-opacity',
        { value: opacity },
      );
    }
    style.opacity = opacity;
  }
  if (Object.hasOwn(patchValue, 'blendMode')) {
    const blendMode = String(patchValue.blendMode ?? '').trim().toLowerCase();
    if (!Object.hasOwn(BLEND_MODES, blendMode)) {
      throw new ExpansionPackProjectError(
        `Unsupported Style blend mode: ${blendMode || '(empty)'}.`,
        'invalid-pack-style-blend-mode',
        { blendMode },
      );
    }
    style.blendMode = blendMode;
  }
  return finishMutation(project, options.now);
}

export function renameExpansionPack(projectValue, nameValue, options = {}) {
  const project = mutableProject(projectValue);
  const name = requireText(nameValue, 'Expansion Pack name', 'missing-pack-name');
  project.name = name;
  project.pack.name = name;
  return finishMutation(project, options.now);
}

export function renameExpansionPackPart(projectValue, partIdValue, nameValue, options = {}) {
  const project = mutableProject(projectValue);
  const partId = requireText(partIdValue, 'Part id', 'missing-target-part');
  editablePackPart(project, partId).name = requireText(nameValue, 'Part name', 'missing-part-name');
  return finishMutation(project, options.now);
}

export function renameExpansionPackItem(
  projectValue,
  partIdValue,
  itemIdValue,
  nameValue,
  options = {},
) {
  const project = mutableProject(projectValue);
  const partId = requireText(partIdValue, 'Part id', 'missing-target-part');
  const itemId = requireText(itemIdValue, 'Item id', 'missing-target-item');
  editablePackItem(project, partId, itemId).name = requireText(
    nameValue,
    'Item name',
    'missing-item-name',
  );
  return finishMutation(project, options.now);
}

export function renameExpansionPackStyle(
  projectValue,
  partIdValue,
  itemIdValue,
  styleIdValue,
  nameValue,
  options = {},
) {
  const project = mutableProject(projectValue);
  const partId = requireText(partIdValue, 'Part id', 'missing-target-part');
  const itemId = requireText(itemIdValue, 'Item id', 'missing-target-item');
  const styleId = requireText(styleIdValue, 'Style id', 'missing-target-style');
  editablePackStyle(project, partId, itemId, styleId).name = requireText(
    nameValue,
    'Style name',
    'missing-style-name',
  );
  return finishMutation(project, options.now);
}

/** Build the same additive Maker view used by runtime compatibility checks. */
export function mergeExpansionPackProjectPreview(projectValue) {
  const project = rehydrateExpansionPackProject(projectValue);
  assertProjectShape(project);
  return mergeExpansionPack(project.parentSnapshot, project.pack);
}

/**
 * Build a merged-preview Recipe that keeps every parent default unless the
 * Pack owns a choice for that Part. This makes newly authored Pack artwork
 * visible immediately without ever changing the inherited parent recipe.
 */
export function createExpansionPackProjectPreviewRecipe(projectValue, makerValue = null) {
  const project = rehydrateExpansionPackProject(projectValue);
  assertProjectShape(project);
  const maker = makerValue || mergeExpansionPack(project.parentSnapshot, project.pack);
  const packId = String(project.packId || '');
  const recipe = clone(maker?.defaultRecipe || { selections: [], colors: [] });
  recipe.selections = Array.isArray(recipe.selections) ? recipe.selections : [];
  recipe.colors = Array.isArray(recipe.colors) ? recipe.colors : [];
  const selections = new Map(recipe.selections.map((selection) => [String(selection?.partId || ''), selection]));

  const colors = new Map(recipe.colors.map((color) => [String(color?.channelId || ''), color]));
  const channels = Array.isArray(maker?.colorChannels)
    ? maker.colorChannels
    : Array.isArray(maker?.palettes)
      ? maker.palettes
      : [];
  channels.forEach((channel) => {
    const channelId = idOf(channel);
    if (!channelId || colors.has(channelId)) return;
    const swatches = Array.isArray(channel?.swatches) ? channel.swatches : [];
    const swatchId = String(channel?.defaultSwatchId || idOf(swatches[0]) || '');
    if (swatchId) colors.set(channelId, { channelId, swatchId });
  });
  recipe.colors = channels.flatMap((channel) => {
    const color = colors.get(idOf(channel));
    return color?.swatchId ? [clone(color)] : [];
  });

  partsOf(maker).forEach((part) => {
    const partId = idOf(part);
    const items = itemsOf(part);
    const packItem = [...items].reverse().find((item) => String(item?.expansionPackId || '') === packId);
    let item = packItem || null;
    let style = item
      ? stylesOf(item).find((candidate) => idOf(candidate) === String(item.defaultStyleId || ''))
        || [...stylesOf(item)].reverse().find((candidate) => String(candidate?.expansionPackId || '') === packId)
        || stylesOf(item)[0]
      : null;

    if (!item) {
      item = [...items].reverse().find((candidate) => (
        stylesOf(candidate).some((styleCandidate) => String(styleCandidate?.expansionPackId || '') === packId)
      )) || null;
      style = item
        ? [...stylesOf(item)].reverse().find((candidate) => String(candidate?.expansionPackId || '') === packId)
        : null;
    }
    if (!partId || !item || !style) return;
    selections.set(partId, {
      partId,
      itemId: idOf(item),
      styleId: idOf(style),
    });
  });

  recipe.selections = partsOf(maker).flatMap((part) => {
    const selection = selections.get(idOf(part));
    return selection?.itemId ? [clone(selection)] : [];
  });
  return recipe;
}

function bindingIssues(project) {
  const issues = [];
  const expected = project.parentBinding || {};
  const actual = {
    rootMakerId: makerRootId(project.parentSnapshot),
    versionNumber: makerVersionNumber(project.parentSnapshot),
    versionId: makerVersionId(project.parentSnapshot),
    releaseId: makerReleaseId(project.parentSnapshot),
    manifestBlobId: makerManifestBlobId(project.parentSnapshot),
    manifestHash: makerManifestHash(project.parentSnapshot),
  };
  [
    ['rootMakerId', 'parent-root-mismatch'],
    ['versionNumber', 'parent-version-mismatch'],
    ['versionId', 'parent-version-id-mismatch'],
    ...(expected.kind === EXPANSION_PACK_PARENT_BINDING_KINDS.PUBLISHED_RELEASE
      ? [
        ['releaseId', 'parent-release-id-mismatch'],
        ['manifestBlobId', 'parent-manifest-blob-mismatch'],
      ]
      : []),
  ].forEach(([field, code]) => {
    if (String(expected[field] ?? '') !== String(actual[field] ?? '')) {
      issues.push({
        severity: 'error',
        code,
        field,
        expected: String(expected[field] ?? ''),
        actual: String(actual[field] ?? ''),
      });
    }
  });
  if (actual.manifestHash && String(expected.manifestHash ?? '') !== actual.manifestHash) {
    issues.push({
      severity: 'error',
      code: 'parent-manifest-mismatch',
      field: 'manifestHash',
      expected: String(expected.manifestHash ?? ''),
      actual: actual.manifestHash,
    });
  }
  const published = expected.kind === EXPANSION_PACK_PARENT_BINDING_KINDS.PUBLISHED_RELEASE;
  const exactFields = published
    ? ['rootMakerId', 'versionNumber', 'versionId', 'releaseId', 'manifestBlobId', 'manifestHash']
    : ['rootMakerId', 'versionNumber'];
  exactFields.forEach((field) => {
    const value = String(expected[field] ?? '').trim();
    if (!value || (field === 'manifestHash' && !/^[0-9a-f]{64}$/.test(value))) {
      issues.push({ severity: 'error', code: 'incomplete-parent-release-binding', field });
    }
  });
  if (!Object.values(EXPANSION_PACK_PARENT_BINDING_KINDS).includes(expected.kind)) {
    issues.push({ severity: 'error', code: 'invalid-parent-binding-kind' });
  }
  if (Boolean(expected.publishable) !== published) {
    issues.push({ severity: 'error', code: 'parent-publishable-flag-mismatch' });
  }
  if (String(expected.identity ?? '') !== exactReleaseIdentity(expected)) {
    issues.push({ severity: 'error', code: 'parent-release-identity-mismatch' });
  }
  if (String(project.pack?.baseMakerId ?? '') !== actual.rootMakerId) {
    issues.push({ severity: 'error', code: 'pack-parent-root-mismatch' });
  }
  if (String(project.pack?.baseVersion ?? '') !== actual.versionNumber) {
    issues.push({ severity: 'error', code: 'pack-parent-version-mismatch' });
  }
  [
    ['baseVersionId', 'versionId', 'pack-parent-version-id-mismatch'],
    ['baseReleaseId', 'releaseId', 'pack-parent-release-id-mismatch'],
    ['baseManifestBlobId', 'manifestBlobId', 'pack-parent-manifest-blob-mismatch'],
    ['baseBindingKind', 'kind', 'pack-parent-binding-kind-mismatch'],
  ].forEach(([packField, bindingField, code]) => {
    if (String(project.pack?.[packField] ?? '') !== String(expected[bindingField] ?? '')) {
      issues.push({ severity: 'error', code });
    }
  });
  if (String(project.pack?.baseManifestHash ?? '') !== String(expected.manifestHash ?? '')) {
    issues.push({ severity: 'error', code: 'pack-parent-manifest-mismatch' });
  }
  if (!published && String(project.publication?.state || 'draft') !== 'draft') {
    issues.push({
      severity: 'error',
      code: 'local-parent-cannot-enter-publication',
      message: 'A Pack bound to a local Maker draft cannot enter a publication state.',
    });
  }
  if (Boolean(project.publication?.publishable) !== published) {
    issues.push({ severity: 'error', code: 'project-publishable-flag-mismatch' });
  }
  return issues;
}

function inheritanceIssues(project) {
  const actual = project.inheritance || {};
  return Object.entries(EXPANSION_PACK_PARENT_INHERITANCE)
    .filter(([field, expected]) => String(actual[field] ?? '') !== String(expected))
    .map(([field, expected]) => ({
      severity: 'error',
      code: 'pack-parent-inheritance-mismatch',
      field,
      expected,
      actual: actual[field],
      message: `Expansion Pack parent inheritance field "${field}" cannot be overridden.`,
    }));
}

function projectOverlayIssues(project) {
  const issues = [];
  const exactFields = [
    ['packId', project.packId, project.pack?.packId],
    ['namespace', project.namespace, project.pack?.namespace],
    ['version', project.version, project.pack?.version],
  ];
  exactFields.forEach(([field, projectValue, packValue]) => {
    if (String(projectValue ?? '') !== String(packValue ?? '')) {
      issues.push({
        severity: 'error',
        code: 'project-pack-metadata-mismatch',
        field,
        projectValue: String(projectValue ?? ''),
        packValue: String(packValue ?? ''),
      });
    }
  });
  if (String(project.name ?? '') !== String(project.pack?.name ?? '')) {
    issues.push({
      severity: 'warning',
      code: 'project-pack-name-mismatch',
      message: 'The project display name and publishable Pack name differ.',
    });
  }
  let commerce;
  try {
    commerce = normalizeExpansionPackCommerce(project.pack?.commerce || {});
  } catch (error) {
    issues.push({
      severity: 'error',
      code: error.code || 'invalid-pack-commerce',
      message: error.message,
    });
    return issues;
  }
  if (
    commerce.accessMode === EXPANSION_PACK_ACCESS_MODES.PAID_ONCE
    && BigInt(commerce.purchasePriceAtomic) <= 0n
  ) {
    issues.push({
      severity: 'error',
      code: 'paid-pack-price-required',
      message: `Paid Once access requires a positive ${EXPANSION_PACK_PAYMENT_CURRENCY} price.`,
    });
  }
  const slotPartIds = Object.entries(project.pack?.wardrobe?.partModes || {})
    .filter(([, mode]) => mode === EXPANSION_PACK_PART_MODES.SLOT)
    .map(([partId]) => partId);
  if (slotPartIds.length && !parentSupportsComposableV6(project.parentSnapshot)) {
    issues.push({
      severity: 'error',
      code: 'pack-slot-requires-composable-v6-parent',
      partIds: slotPartIds,
      message: 'SLOT mode requires an exact parent snapshot with composable v6 compatibility.',
    });
  }
  return issues;
}

/** Validate binding, additive semantics and preview readiness before publish. */
export function preflightExpansionPackProject(projectValue) {
  let project;
  try {
    project = rehydrateExpansionPackProject(projectValue);
    assertProjectShape(project);
  } catch (error) {
    const issue = { severity: 'error', code: error.code || 'invalid-expansion-pack-project', message: error.message };
    return {
      valid: false,
      publishable: false,
      issues: [issue],
      errors: [issue],
      warnings: [],
      compatibility: null,
      preview: null,
    };
  }
  const issues = [
    ...bindingIssues(project),
    ...inheritanceIssues(project),
    ...projectOverlayIssues(project),
  ];
  const hasContent = partsOf(project.pack).length > 0;
  if (!hasContent) {
    issues.push({
      severity: 'error',
      code: 'empty-expansion-pack',
      message: 'Add at least one Item, Style or optional Part before publishing.',
    });
  }
  partsOf(project.pack).forEach((part) => {
    itemsOf(part).forEach((item) => {
      if (!item.extendsItemId && stylesOf(item).length === 0) {
        issues.push({
          severity: 'error',
          code: 'pack-item-without-style',
          partId: idOf(part) || String(part.extendsPartId || ''),
          itemId: idOf(item),
          message: 'Every Pack-owned Item must contain at least one Style.',
        });
      }
    });
  });

  const compatibility = checkExpansionPackCompatibility(project.parentSnapshot, project.pack);
  compatibility.errors.forEach((entry) => issues.push({ severity: 'error', ...entry }));
  compatibility.warnings.forEach((entry) => issues.push({ severity: 'warning', ...entry }));
  if (compatibility.merged) issues.push(...mergedRuleGraphIssues(project, compatibility.merged));
  const errors = issues.filter((issue) => issue.severity === 'error');
  const warnings = issues.filter((issue) => issue.severity !== 'error');
  const publishable = errors.length === 0
    && project.parentBinding.kind === EXPANSION_PACK_PARENT_BINDING_KINDS.PUBLISHED_RELEASE
    && project.parentBinding.publishable === true;
  return {
    valid: errors.length === 0,
    publishable,
    issues,
    errors,
    warnings,
    compatibility,
    preview: errors.length === 0 ? compatibility.merged : null,
  };
}
