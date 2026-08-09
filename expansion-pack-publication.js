/**
 * Pure, transport-neutral publication model for an independent Expansion Pack.
 *
 * This module deliberately performs no Walrus upload, Sui transaction or
 * chain readback. It only creates a canonical candidate whose exact parent
 * release and content commitments can be verified by a later transport layer.
 */

import {
  EXPANSION_PACK_PARENT_BINDING_KINDS,
  preflightExpansionPackProject,
  rehydrateExpansionPackProject,
} from './expansion-pack-project.js';

export const EXPANSION_PACK_MANIFEST_SCHEMA = 'animacraft.expansion-pack-manifest.v1';
export const EXPANSION_PACK_PUBLICATION_CANDIDATE_SCHEMA =
  'animacraft.expansion-pack-publication-candidate.v1';
export const EXPANSION_PACK_MANIFEST_IDENTIFIER = 'animacraft-expansion-pack-manifest.json';
export const EXPANSION_PACK_COMMERCE_DRAFT_SCHEMA = 'animacraft.expansion-pack-commerce-draft.v1';
export const EXPANSION_PACK_RIGHTS_DRAFT_SCHEMA = 'animacraft.expansion-pack-rights-draft.v1';
export const EXPANSION_PACK_LIFECYCLE_DRAFT_SCHEMA = 'animacraft.expansion-pack-lifecycle-draft.v1';

const SHA256 = /^[0-9a-f]{64}$/;

export class ExpansionPackPublicationError extends Error {
  constructor(message, code = 'expansion-pack-publication-error', details = {}) {
    super(message);
    this.name = 'ExpansionPackPublicationError';
    this.code = code;
    this.details = details;
  }
}

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return String(value ?? '').trim();
}

function required(value, field, code = 'missing-expansion-pack-publication-field') {
  const result = text(value);
  if (!result) throw new ExpansionPackPublicationError(`${field} is required.`, code, { field });
  return result;
}

function stableValue(value) {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => [key, stableValue(value[key])]),
  );
}

export function canonicalExpansionPackJson(value) {
  return JSON.stringify(stableValue(value));
}

function bytesToHex(value) {
  return [...new Uint8Array(value)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function hashExpansionPackContent(value) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new ExpansionPackPublicationError(
      'SHA-256 is unavailable in this runtime.',
      'expansion-pack-sha256-unavailable',
    );
  }
  const bytes = typeof value === 'string'
    ? new TextEncoder().encode(value)
    : value instanceof Uint8Array
      ? value
      : new Uint8Array(value);
  return bytesToHex(await subtle.digest('SHA-256', bytes));
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
}

function normalizeHash(value, field) {
  const hash = text(value).replace(/^0x/i, '').toLowerCase();
  if (!SHA256.test(hash)) {
    throw new ExpansionPackPublicationError(
      `${field} must be an exact SHA-256.`,
      'invalid-expansion-pack-content-hash',
      { field, value: text(value) },
    );
  }
  return hash;
}

function safeIdentifier(value, field) {
  const identifier = required(value, field, 'missing-expansion-pack-asset-identifier');
  if (
    identifier === EXPANSION_PACK_MANIFEST_IDENTIFIER
    || identifier.startsWith('/')
    || identifier.includes('\\')
    || identifier.split('/').includes('..')
  ) {
    throw new ExpansionPackPublicationError(
      `${field} is not a safe Pack-local Walrus identifier.`,
      'invalid-expansion-pack-asset-identifier',
      { field, identifier },
    );
  }
  return identifier;
}

function assetDescriptor(assetValue) {
  const asset = plainObject(assetValue);
  const id = required(asset.id ?? asset.assetId, 'Asset id', 'missing-expansion-pack-asset-id');
  const identifier = safeIdentifier(asset.identifier, `Asset ${id} identifier`);
  const mediaType = required(
    asset.mediaType ?? asset.contentType ?? asset.blob?.type,
    `Asset ${id} media type`,
    'missing-expansion-pack-asset-media-type',
  );
  const sha256 = normalizeHash(
    asset.sha256 ?? asset.contentHash ?? asset.digest,
    `Asset ${id} SHA-256`,
  );
  const byteLengthValue = Number(asset.byteLength ?? asset.size ?? asset.blob?.size);
  const widthValue = Number(asset.width);
  const heightValue = Number(asset.height);
  return {
    id,
    identifier,
    kind: text(asset.kind) || 'layer',
    mediaType,
    sha256,
    ...(Number.isSafeInteger(byteLengthValue) && byteLengthValue >= 0
      ? { byteLength: byteLengthValue }
      : {}),
    ...(Number.isSafeInteger(widthValue) && widthValue > 0 ? { width: widthValue } : {}),
    ...(Number.isSafeInteger(heightValue) && heightValue > 0 ? { height: heightValue } : {}),
  };
}

function collectReferencedAssetIds(pack) {
  const ids = new Set();
  list(pack?.parts).forEach((part) => list(part?.items).forEach((item) => (
    list(item?.styles).forEach((style) => {
      const assetId = text(style?.assetId);
      if (assetId) ids.add(assetId);
    })
  )));
  return [...ids].sort();
}

function publicationAssets(project) {
  const descriptors = list(project.pack?.assets)
    .map(assetDescriptor)
    .sort((left, right) => (
      left.identifier.localeCompare(right.identifier)
      || left.id.localeCompare(right.id)
    ));
  const ids = new Set();
  const identifiers = new Set();
  descriptors.forEach((descriptor) => {
    if (ids.has(descriptor.id)) {
      throw new ExpansionPackPublicationError(
        `Asset id ${descriptor.id} is duplicated.`,
        'duplicate-expansion-pack-asset-id',
        { assetId: descriptor.id },
      );
    }
    if (identifiers.has(descriptor.identifier)) {
      throw new ExpansionPackPublicationError(
        `Asset identifier ${descriptor.identifier} is duplicated.`,
        'duplicate-expansion-pack-asset-identifier',
        { identifier: descriptor.identifier },
      );
    }
    ids.add(descriptor.id);
    identifiers.add(descriptor.identifier);
  });

  const parentAssetIds = new Set(list(project.parentSnapshot?.assets)
    .map((asset) => text(asset?.id ?? asset?.assetId))
    .filter(Boolean));
  const referencedAssetIds = collectReferencedAssetIds(project.pack);
  const unresolved = referencedAssetIds.filter((assetId) => (
    !ids.has(assetId) && !parentAssetIds.has(assetId)
  ));
  if (unresolved.length) {
    throw new ExpansionPackPublicationError(
      'One or more Pack Styles reference an unknown asset.',
      'unknown-expansion-pack-style-asset',
      { assetIds: unresolved },
    );
  }
  return {
    descriptors,
    referencedPackAssetIds: referencedAssetIds.filter((assetId) => ids.has(assetId)),
    referencedParentAssetIds: referencedAssetIds.filter((assetId) => parentAssetIds.has(assetId)),
  };
}

function exactParentBinding(bindingValue) {
  const binding = plainObject(bindingValue);
  if (
    binding.kind !== EXPANSION_PACK_PARENT_BINDING_KINDS.PUBLISHED_RELEASE
    || binding.publishable !== true
  ) {
    throw new ExpansionPackPublicationError(
      'An independent Pack publication candidate requires an exact published parent release.',
      'expansion-pack-parent-release-not-publishable',
      { kind: binding.kind || '' },
    );
  }
  return {
    schemaVersion: required(binding.schemaVersion, 'Parent binding schema'),
    kind: binding.kind,
    rootMakerId: required(binding.rootMakerId, 'Parent Maker root id'),
    releaseId: required(binding.releaseId, 'Parent Maker release id'),
    versionId: required(binding.versionId, 'Parent Maker version id'),
    versionNumber: required(binding.versionNumber, 'Parent Maker version number'),
    manifestBlobId: required(binding.manifestBlobId, 'Parent manifest Blob/Quilt id'),
    manifestSha256: normalizeHash(binding.manifestHash, 'Parent manifest SHA-256'),
    identity: required(binding.identity, 'Parent release identity'),
  };
}

function packOverlay(pack, descriptors) {
  return {
    schemaVersion: required(pack?.schemaVersion, 'Expansion Pack schema'),
    layerTracks: structuredClone(list(pack?.layerTracks)),
    colorChannels: structuredClone(list(pack?.colorChannels)),
    assets: structuredClone(descriptors),
    parts: structuredClone(list(pack?.parts)),
    rules: structuredClone(list(pack?.rules)),
  };
}

function draftCommerce(project, override) {
  const source = {
    ...plainObject(project.pack?.commerce),
    ...plainObject(override),
  };
  return {
    schemaVersion: EXPANSION_PACK_COMMERCE_DRAFT_SCHEMA,
    projectionState: 'not-built',
    accessMode: text(source.accessMode) || 'FREE',
    completeMode: text(source.completeMode) || 'FREE_UNLIMITED',
    price: text(source.price) || '0',
    currency: text(source.currency) || 'USDC',
    protocolFeeBps: Number.isSafeInteger(Number(source.protocolFeeBps))
      ? Number(source.protocolFeeBps)
      : 1000,
  };
}

async function draftRights(project, override) {
  const source = {
    ...plainObject(project.pack?.rights),
    ...plainObject(override),
  };
  const parentLicense = project.parentSnapshot?.metadata?.license ?? null;
  return {
    schemaVersion: EXPANSION_PACK_RIGHTS_DRAFT_SCHEMA,
    projectionState: 'not-built',
    origin: text(source.origin) || 'INHERIT_PARENT',
    parentLicenseCommitment: await hashExpansionPackContent(
      canonicalExpansionPackJson(parentLicense),
    ),
    parentManifestSha256: normalizeHash(
      project.parentBinding.manifestHash,
      'Parent manifest SHA-256',
    ),
    declaration: text(source.declaration),
  };
}

function draftLifecycle() {
  return {
    schemaVersion: EXPANSION_PACK_LIFECYCLE_DRAFT_SCHEMA,
    state: 'DRAFT',
    chainState: 'UNPUBLISHED',
    salesEnabled: false,
    contentAvailable: false,
  };
}

/**
 * Build a deterministic candidate for later Walrus/Sui publication.
 *
 * The returned object is not a receipt and never claims that upload,
 * certification, registration, admission or activation has occurred.
 */
export async function buildExpansionPackPublicationCandidate(projectValue, options = {}) {
  const project = rehydrateExpansionPackProject(projectValue);
  const preflight = preflightExpansionPackProject(project);
  if (!preflight.valid) {
    throw new ExpansionPackPublicationError(
      'Expansion Pack project failed publication preflight.',
      'expansion-pack-publication-preflight-failed',
      { errors: structuredClone(preflight.errors) },
    );
  }
  if (!preflight.publishable) {
    throw new ExpansionPackPublicationError(
      'A Pack bound to a local Maker draft cannot produce a publication candidate.',
      'expansion-pack-parent-release-not-publishable',
    );
  }

  const parent = exactParentBinding(project.parentBinding);
  const assets = publicationAssets(project);
  const overlay = packOverlay(project.pack, assets.descriptors);
  const commerce = draftCommerce(project, options.commerce);
  const rights = await draftRights(project, options.rights);
  const lifecycle = draftLifecycle();
  const assetSetCommitment = await hashExpansionPackContent(
    canonicalExpansionPackJson(assets.descriptors),
  );
  const content = {
    pack: {
      id: required(project.packId, 'Expansion Pack id'),
      namespace: required(project.namespace, 'Expansion Pack namespace'),
      name: required(project.name, 'Expansion Pack name'),
      version: required(project.version, 'Expansion Pack version'),
      creator: required(project.ownerWalletAddress, 'Expansion Pack creator'),
    },
    parent,
    inheritance: structuredClone(project.inheritance),
    overlay,
    assetReferences: {
      pack: assets.referencedPackAssetIds,
      parent: assets.referencedParentAssetIds,
    },
    commerce,
    rights,
    lifecycle,
  };
  const contentCommitment = await hashExpansionPackContent(canonicalExpansionPackJson(content));
  const manifest = {
    schemaVersion: EXPANSION_PACK_MANIFEST_SCHEMA,
    kind: 'independent-expansion-pack',
    ...content,
    integrity: {
      algorithm: 'sha256',
      assetSetCommitment,
      contentCommitment,
    },
    publicationBoundary: {
      candidateOnly: true,
      parentChainReadback: 'required',
      walrus: 'not-uploaded',
      sui: 'not-registered',
      admission: 'not-created',
      sealPolicy: 'not-created',
    },
  };
  const manifestJson = canonicalExpansionPackJson(manifest);
  const manifestSha256 = await hashExpansionPackContent(manifestJson);
  const candidateCommitment = await hashExpansionPackContent(canonicalExpansionPackJson({
    manifestSha256,
    parentIdentity: parent.identity,
    packId: content.pack.id,
    packVersion: content.pack.version,
  }));
  const candidate = {
    schemaVersion: EXPANSION_PACK_PUBLICATION_CANDIDATE_SCHEMA,
    state: 'CANDIDATE',
    published: false,
    chainConnected: false,
    readyForTransport: true,
    manifestIdentifier: EXPANSION_PACK_MANIFEST_IDENTIFIER,
    manifest,
    manifestJson,
    manifestSha256,
    contentCommitment,
    candidateCommitment,
    files: [
      {
        identifier: EXPANSION_PACK_MANIFEST_IDENTIFIER,
        kind: 'manifest',
        mediaType: 'application/json',
        sha256: manifestSha256,
        byteLength: new TextEncoder().encode(manifestJson).byteLength,
      },
      ...assets.descriptors,
    ],
    verification: {
      parentChainReadback: 'required',
      walrusUpload: 'not-started',
      walrusCertification: 'not-started',
      suiRegistration: 'not-started',
      makerAdmission: 'not-started',
    },
  };
  return freeze(candidate);
}
