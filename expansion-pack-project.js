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

export const EXPANSION_PACK_PROJECT_SCHEMA = 'animacraft.expansion-pack-project.v2';
export const EXPANSION_PACK_INHERITANCE_SCHEMA = 'animacraft.expansion-pack-inheritance.v2';
export const EXPANSION_PACK_PARENT_BINDING_SCHEMA = 'animacraft.expansion-pack-parent-binding.v2';
export const EXPANSION_PACK_PARENT_BINDING_KINDS = Object.freeze({
  LOCAL_DRAFT: 'local-draft',
  PUBLISHED_RELEASE: 'published-release',
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
  project.pack = overlay;
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
