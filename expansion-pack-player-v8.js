import {
  checkExpansionPackCompatibility,
  mergeExpansionPacks,
} from './expansion-packs.js';
import {
  EXPANSION_PACK_MANIFEST_SCHEMA,
  EXPANSION_PACK_TRANSPORT_PROTECTION_SCHEMA,
  canonicalExpansionPackJson,
  expansionPackManifestContent,
  hashExpansionPackContent,
} from './expansion-pack-publication.js';
import {
  EXPANSION_PACK_V8_ACCESS,
  EXPANSION_PACK_V8_LIFECYCLE,
} from './expansion-pack-publication-v8-app.js';
import {
  MAKER_SEAL_ASSET_V5_SCHEMA,
  MAKER_SEAL_CIPHERTEXT_MEDIA_TYPE,
  MAKER_SEAL_PRODUCT_PACK,
  deriveExpansionPackSealReleaseCommitmentV8,
  deriveMakerSealIdV5,
} from './maker-seal-v5.js';

export const EXPANSION_PACK_PLAYER_V8_SCHEMA = 'animacraft.expansion-pack-player.v1';
export const EXPANSION_PACK_PLAYER_SESSION_SCHEMA =
  'animacraft.expansion-pack-player-session.v1';

export const EXPANSION_PACK_PLAYER_V8_TRANSPORT_ERROR = Object.freeze({
  NOT_READY: 'EXPANSION_PACK_PLAYER_V8_TRANSPORT_NOT_READY',
  PUBLIC_POLICY_MISMATCH: 'EXPANSION_PACK_PLAYER_V8_SEAL_PUBLIC_POLICY_MISMATCH',
  SALES_DISABLED: 'EXPANSION_PACK_V8_RELEASE_DISABLED',
  RESOLVER_MISSING: 'EXPANSION_PACK_PLAYER_V8_RUNTIME_RESOLVER_MISSING',
  RUNTIME_INVALID: 'EXPANSION_PACK_PLAYER_V8_RUNTIME_ASSET_INVALID',
});

const SHA256 = /^[0-9a-f]{64}$/;
const SUI_ID = /^0x[0-9a-f]+$/i;
const U64_MAX = (1n << 64n) - 1n;

export class ExpansionPackPlayerV8Error extends Error {
  constructor(message, code = 'EXPANSION_PACK_PLAYER_V8_ERROR', details = {}) {
    super(message);
    this.name = 'ExpansionPackPlayerV8Error';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new ExpansionPackPlayerV8Error(message, code, details);
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return String(value ?? '').trim();
}

function normalizedHash(value, label) {
  const result = text(value).replace(/^0x/i, '').toLowerCase();
  if (!SHA256.test(result)) fail(
    'EXPANSION_PACK_PLAYER_COMMITMENT_INVALID',
    `${label} must be an exact SHA-256 commitment.`,
    { label, value: text(value) },
  );
  return result;
}

function same(left, right) {
  return text(left).toLowerCase() === text(right).toLowerCase();
}

function sameSuiId(left, right) {
  try {
    return BigInt(text(left)) === BigInt(text(right));
  } catch {
    return false;
  }
}

function normalizedPublicSealServers(value) {
  const servers = list(value);
  if (!servers.length) return null;
  const byId = new Map();
  for (const server of servers) {
    let objectId;
    try {
      const rawObjectId = text(server?.objectId);
      if (!SUI_ID.test(rawObjectId)) return null;
      const numericId = BigInt(rawObjectId);
      if (numericId < 0n) return null;
      objectId = `0x${numericId.toString(16)}`;
    } catch {
      return null;
    }
    const weight = Number(server?.weight);
    if (
      byId.has(objectId)
      || !Number.isSafeInteger(weight)
      || weight < 1
      || weight > 255
    ) return null;
    byId.set(objectId, {
      weight,
      aggregatorUrl: String(server?.aggregatorUrl || ''),
    });
  }
  return byId;
}

/**
 * Compare only the public Seal policy committed by a Pack ciphertext with the
 * deployment policy. Object IDs are numeric Sui identities and server order is
 * irrelevant, while server count, weights, aggregator URLs and threshold must
 * match exactly. Credential fields are deliberately never read or returned.
 */
export function matchesExpansionPackSealPublicPolicyV8(
  publishedPolicyValue,
  deploymentPolicyValue,
) {
  const publishedPolicy = object(publishedPolicyValue);
  const deploymentPolicy = object(deploymentPolicyValue);
  const publishedThreshold = Number(publishedPolicy.threshold);
  const deploymentThreshold = Number(deploymentPolicy.threshold);
  if (
    !Number.isSafeInteger(publishedThreshold)
    || publishedThreshold < 1
    || !Number.isSafeInteger(deploymentThreshold)
    || deploymentThreshold < 1
    || publishedThreshold !== deploymentThreshold
  ) return false;
  const publishedServers = normalizedPublicSealServers(publishedPolicy.keyServers);
  const deploymentServers = normalizedPublicSealServers(deploymentPolicy.keyServers);
  if (
    !publishedServers
    || !deploymentServers
    || publishedServers.size !== deploymentServers.size
  ) return false;
  for (const [objectId, published] of publishedServers) {
    const deployed = deploymentServers.get(objectId);
    if (
      !deployed
      || deployed.weight !== published.weight
      || deployed.aggregatorUrl !== published.aggregatorUrl
    ) return false;
  }
  return true;
}

function required(value, label) {
  const result = text(value);
  if (!result) fail('EXPANSION_PACK_PLAYER_FIELD_MISSING', `${label} is required.`, { label });
  return result;
}

function exactU64(value, label) {
  let result;
  try {
    if (value == null || value === '') throw new Error('missing');
    if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error('unsafe');
    if (typeof value === 'string' && !/^\d+$/.test(value.trim())) throw new Error('syntax');
    result = BigInt(value);
  } catch {
    fail(
      'EXPANSION_PACK_PLAYER_U64_INVALID',
      `${label} must be an exact unsigned 64-bit integer.`,
      { label, value },
    );
  }
  if (result < 0n || result > U64_MAX) fail(
    'EXPANSION_PACK_PLAYER_U64_INVALID',
    `${label} must be an exact unsigned 64-bit integer.`,
    { label, value },
  );
  return result;
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
}

function parentTuple(parentValue) {
  const parent = object(parentValue);
  return {
    rootMakerId: required(parent.rootMakerId, 'Parent logical Maker id'),
    baseMakerRootId: required(parent.baseMakerRootId, 'Parent MakerRootV5 id'),
    releaseId: required(parent.parentLegacyMakerId || parent.releaseId, 'Parent OCMaker id'),
    versionNumber: required(parent.versionNumber, 'Parent Maker version number'),
    versionId: required(parent.versionId, 'Parent Maker version id'),
    manifestBlobId: required(parent.manifestBlobId, 'Parent Maker manifest Blob id'),
    manifestSha256: normalizedHash(
      parent.manifestSha256 || parent.manifestHash,
      'Parent Maker manifest hash',
    ),
    ownershipEpoch: exactU64(parent.ownershipEpoch, 'Parent ownership epoch'),
  };
}

function manifestJson(value) {
  if (typeof value === 'string') return value;
  if (value instanceof Uint8Array) return new TextDecoder().decode(value);
  if (value instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(value));
  return canonicalExpansionPackJson(value);
}

function styleDefinitions(manifest) {
  return list(manifest?.overlay?.parts).flatMap((part) => list(part?.items).flatMap((item) => (
    list(item?.styles).map((style) => ({
      partKey: required(part?.id || part?.extendsPartId || part?.targetPartId, 'Pack Style Part key'),
      itemKey: required(item?.id || item?.extendsItemId || item?.targetItemId, 'Pack Style Item key'),
      styleKey: required(style?.id, 'Pack Style key'),
      assetId: required(style?.assetId, 'Pack Style asset id'),
    }))
  )));
}

function styleKey(value) {
  return [value.partKey, value.itemKey, value.styleKey].map(text).join('\u0000');
}

function exactPass(release, passes, wallet) {
  return list(passes).find((pass) => (
    same(pass?.releaseId, release.objectId)
    && same(pass?.parentRootId, release.parentRootId)
    && same(pass?.holder, wallet)
    && normalizedHash(pass?.contentCommitment, 'Pack Pass content commitment')
      === release.contentCommitment
  )) || null;
}

function runtimePack(manifest, parent) {
  const overlay = structuredClone(object(manifest.overlay));
  return {
    ...overlay,
    schemaVersion: overlay.schemaVersion,
    packId: manifest.pack.id,
    namespace: manifest.pack.namespace,
    name: manifest.pack.name,
    version: manifest.pack.version,
    baseMakerId: parent.rootMakerId,
    baseVersion: parent.versionNumber,
    baseVersionId: parent.versionId,
    baseReleaseId: parent.releaseId,
    baseManifestBlobId: parent.manifestBlobId,
    manifestHash: manifest.integrity.contentCommitment,
  };
}

function verifiedRuntimeEntry(value) {
  const entry = object(value);
  if (entry.schemaVersion !== EXPANSION_PACK_PLAYER_V8_SCHEMA || entry.trusted !== true) fail(
    'EXPANSION_PACK_PLAYER_ENTRY_UNTRUSTED',
    'Only an exactly verified Expansion Pack release may enter Player runtime hydration.',
  );
  return entry;
}

function transportReady(entry) {
  const assets = list(entry.assets);
  if (!assets.length) return false;
  const paid = text(entry.access?.kind).toUpperCase() === 'PAID_ONCE';
  return assets.every((asset) => (
    required(asset?.assetId, 'Runtime Pack asset id')
    && required(asset?.assetBlobId, 'Runtime Pack asset Blob id')
    && normalizedHash(asset?.assetSha256, 'Runtime Pack asset hash')
    && (
      paid
        ? asset?.protection?.schemaVersion === MAKER_SEAL_ASSET_V5_SCHEMA
          && asset.protection.mode === 'SEAL_PAID_PACK'
        : !asset?.protection
    )
  ));
}

/**
 * Convert an exactly verified release into its Player runtime state without
 * conflating a sale-ready ciphertext with usable artwork.
 *
 * - `transportReady` means an unowned release has enough immutable evidence to
 *   be acquired safely. For paid content this includes an exact match with the
 *   deployment's public Seal server policy.
 * - `playerUsable` becomes true only after an entitled wallet resolves every
 *   Style. Paid Styles must resolve to `blob:` URLs; a Walrus ciphertext URL can
 *   therefore never escape this boundary into an `<img>` element.
 * - `salesEnabled` only controls new acquisition. Existing Pass holders still
 *   resolve their immutable assets while the release gate is off.
 */
export async function materializeExpansionPackPlayerEntryV8(entryValue, {
  salesEnabled = true,
  resolveRuntimeAsset,
  sealPublicPolicy,
} = {}) {
  const entry = verifiedRuntimeEntry(entryValue);
  const structurallyReady = transportReady(entry);
  const paid = text(entry.access?.kind).toUpperCase() === 'PAID_ONCE';
  const entitled = entry.access?.accessible === true;
  // Deployment compatibility gates only a new paid acquisition. A wallet that
  // already holds the exact Pass must retain the verified catalog entry and be
  // able to retry resolution after local deployment configuration is repaired.
  const publicPolicyReady = !paid
    || entitled
    || (
      structurallyReady
      && list(entry.assets).every((asset) => matchesExpansionPackSealPublicPolicyV8(
        asset?.protection,
        sealPublicPolicy,
      ))
    );
  const ready = structurallyReady && publicPolicyReady;
  const canAcquire = ready
    && !entitled
    && salesEnabled === true
    && entry.access?.availableForAcquire === true;
  const access = {
    ...structuredClone(object(entry.access)),
    availableForAcquire: canAcquire,
  };
  const base = {
    ...entry,
    access,
    transportReady: ready,
    playerUsable: false,
    runtimeAssets: [],
  };
  if (!ready) {
    const publicPolicyMismatch = structurallyReady && paid && !entitled && !publicPolicyReady;
    return freeze({
      ...base,
      acquisitionBlockedReason: publicPolicyMismatch
        ? EXPANSION_PACK_PLAYER_V8_TRANSPORT_ERROR.PUBLIC_POLICY_MISMATCH
        : EXPANSION_PACK_PLAYER_V8_TRANSPORT_ERROR.NOT_READY,
      runtimeErrorMessage: publicPolicyMismatch
        ? 'The Expansion Pack Seal server policy is not supported by this deployment.'
        : 'The Expansion Pack transport is incomplete.',
    });
  }
  if (!entitled) {
    return freeze({
      ...base,
      acquisitionBlockedReason: salesEnabled === true
        ? ''
        : EXPANSION_PACK_PLAYER_V8_TRANSPORT_ERROR.SALES_DISABLED,
      runtimeErrorMessage: '',
    });
  }
  if (typeof resolveRuntimeAsset !== 'function') {
    return freeze({
      ...base,
      acquisitionBlockedReason: EXPANSION_PACK_PLAYER_V8_TRANSPORT_ERROR.RESOLVER_MISSING,
      runtimeErrorMessage: 'No reviewed Expansion Pack runtime resolver is available.',
    });
  }
  try {
    const runtimeAssets = await Promise.all(list(entry.assets).map(async (asset) => {
      const runtimeAsset = object(await resolveRuntimeAsset({ entry, asset }));
      const expectedId = required(asset.assetId, 'Runtime Pack asset id');
      const expectedSha = normalizedHash(asset.assetSha256, 'Runtime Pack asset hash');
      const url = required(runtimeAsset.url, 'Resolved runtime asset URL');
      if (
        text(runtimeAsset.localAssetId || runtimeAsset.assetId) !== expectedId
        || normalizedHash(runtimeAsset.sha256, 'Resolved runtime asset hash') !== expectedSha
        || (paid && !url.startsWith('blob:'))
      ) fail(
        EXPANSION_PACK_PLAYER_V8_TRANSPORT_ERROR.RUNTIME_INVALID,
        'A resolved Pack Style does not match its verified immutable asset.',
        { assetId: expectedId },
      );
      return runtimeAsset;
    }));
    return freeze({
      ...base,
      playerUsable: true,
      acquisitionBlockedReason: '',
      runtimeErrorMessage: '',
      runtimeAssets,
    });
  } catch (error) {
    return freeze({
      ...base,
      acquisitionBlockedReason: text(error?.code)
        || EXPANSION_PACK_PLAYER_V8_TRANSPORT_ERROR.RUNTIME_INVALID,
      runtimeErrorMessage: text(error?.message)
        || 'Expansion Pack artwork could not be verified for Player.',
    });
  }
}

/**
 * Verify one independently published v8 Pack before it may enter the Player.
 * The caller must supply exact Sui release/style/pass readback plus the exact
 * Walrus manifest bytes. No local Pack draft or string id can grant access.
 */
export async function verifyExpansionPackPlayerReleaseV8({
  baseDocument,
  parentRelease,
  release,
  manifest: manifestValue,
  manifestBytes = null,
  styleRecords = [],
  passes = [],
  walletAddress = '',
  expectedSealPackageId = '',
} = {}) {
  const parent = parentTuple(parentRelease);
  const packRelease = object(release);
  const bytesJson = manifestJson(manifestBytes ?? manifestValue);
  let manifest;
  try {
    manifest = typeof manifestValue === 'object' && manifestValue !== null
      ? structuredClone(manifestValue)
      : JSON.parse(bytesJson);
  } catch {
    fail('EXPANSION_PACK_PLAYER_MANIFEST_INVALID', 'The Expansion Pack manifest is not valid JSON.');
  }
  const canonical = canonicalExpansionPackJson(manifest);
  if (canonical !== bytesJson) fail(
    'EXPANSION_PACK_PLAYER_MANIFEST_NOT_CANONICAL',
    'The Expansion Pack manifest bytes are not the canonical published JSON.',
  );
  const observedManifestSha256 = await hashExpansionPackContent(bytesJson);
  const expectedManifestSha256 = normalizedHash(packRelease.manifestSha256, 'Pack manifest hash');
  if (observedManifestSha256 !== expectedManifestSha256) fail(
    'EXPANSION_PACK_PLAYER_MANIFEST_HASH_MISMATCH',
    'The Walrus Pack manifest does not match the Sui release.',
  );
  if (manifest.schemaVersion !== EXPANSION_PACK_MANIFEST_SCHEMA
    || manifest.kind !== 'independent-expansion-pack') fail(
    'EXPANSION_PACK_PLAYER_MANIFEST_SCHEMA_UNSUPPORTED',
    'This is not a supported independent Expansion Pack manifest.',
  );
  const manifestCommitment = await hashExpansionPackContent(
    canonicalExpansionPackJson(expansionPackManifestContent(manifest)),
  );
  const releaseId = required(packRelease.objectId, 'Pack release id');
  const releaseCommitment = normalizedHash(packRelease.contentCommitment, 'Pack content commitment');
  if (manifestCommitment !== releaseCommitment
    || normalizedHash(manifest.integrity?.contentCommitment, 'Manifest content commitment')
      !== releaseCommitment) fail(
    'EXPANSION_PACK_PLAYER_CONTENT_COMMITMENT_MISMATCH',
    'The Pack content commitment does not match its Sui release.',
  );

  const chainParentMatches = (
    same(packRelease.parentRootId, parent.baseMakerRootId)
    && same(packRelease.parentLegacyMakerId, parent.releaseId)
    && text(packRelease.parentVersion) === parent.versionNumber
    && text(packRelease.parentManifestBlobId) === parent.manifestBlobId
    && normalizedHash(packRelease.parentManifestSha256, 'Pack parent hash') === parent.manifestSha256
  );
  const manifestParent = object(manifest.parent);
  const manifestParentMatches = (
    same(manifestParent.rootMakerId, parent.rootMakerId)
    && same(manifestParent.releaseId, parent.releaseId)
    && text(manifestParent.versionNumber) === parent.versionNumber
    && text(manifestParent.versionId) === parent.versionId
    && text(manifestParent.manifestBlobId) === parent.manifestBlobId
    && normalizedHash(manifestParent.manifestSha256, 'Manifest parent hash') === parent.manifestSha256
  );
  if (!chainParentMatches || !manifestParentMatches) fail(
    'EXPANSION_PACK_PLAYER_PARENT_MISMATCH',
    'The Expansion Pack is not bound to this exact Maker release.',
  );
  if (!baseDocument
    || !same(baseDocument.version?.rootMakerId, parent.rootMakerId)
    || text(baseDocument.version?.number) !== parent.versionNumber
    || text(baseDocument.version?.versionId) !== parent.versionId) fail(
    'EXPANSION_PACK_PLAYER_DOCUMENT_MISMATCH',
    'The Player Maker document is not the exact parent version bound by this Pack.',
  );
  if (!same(packRelease.packId, manifest.pack?.id)
    || !same(packRelease.namespace, manifest.pack?.namespace)
    || text(packRelease.packVersion) !== text(manifest.pack?.version)
    || !same(packRelease.creator, manifest.pack?.creator)) fail(
    'EXPANSION_PACK_PLAYER_IDENTITY_MISMATCH',
    'The Pack manifest identity does not match its Sui release.',
  );
  const manifestAccess = text(manifest.commerce?.accessMode).toUpperCase();
  const expectedAccess = packRelease.accessKind === EXPANSION_PACK_V8_ACCESS.FREE
    ? 'FREE'
    : packRelease.accessKind === EXPANSION_PACK_V8_ACCESS.PAID_ONCE
      ? 'PAID_ONCE'
      : '';
  if (!expectedAccess
    || manifestAccess !== expectedAccess
    || BigInt(manifest.commerce?.purchasePriceAtomic || 0)
      !== BigInt(packRelease.purchasePriceAtomic || 0)) fail(
    'EXPANSION_PACK_PLAYER_COMMERCE_MISMATCH',
    'The Pack price or access mode does not match its Sui release.',
  );

  const descriptors = new Map(list(manifest.overlay?.assets).map((asset) => [text(asset?.id), asset]));
  const records = new Map(list(styleRecords).map((record) => [styleKey(record), record]));
  const definitions = styleDefinitions(manifest);
  if (BigInt(definitions.length) !== BigInt(packRelease.styleCount || 0)
    || records.size !== definitions.length) fail(
    'EXPANSION_PACK_PLAYER_STYLE_COUNT_MISMATCH',
    'The Pack manifest and exact Sui Style registry have different sizes.',
  );
  if (list(manifest.overlay?.assets).some((asset) => asset?.protection)) fail(
    'EXPANSION_PACK_PLAYER_TRANSPORT_LOCATION_INVALID',
    'Seal transport evidence must use the canonical top-level transportProtection section.',
  );
  const paid = packRelease.accessKind === EXPANSION_PACK_V8_ACCESS.PAID_ONCE;
  const transport = object(manifest.transportProtection);
  let protectionByAsset = new Map();
  let approvedSealPackageId = '';
  let pinnedSealPackageId = '';
  let sealReleaseCommitment = '';
  if (paid) {
    const scopedRelease = await deriveExpansionPackSealReleaseCommitmentV8({
      releaseId,
      contentCommitment: releaseCommitment,
    });
    sealReleaseCommitment = normalizedHash(
      scopedRelease.id,
      'Scoped Pack Seal release commitment',
    );
    const transportReleaseId = text(transport.releaseId);
    if (
      transport.schemaVersion !== EXPANSION_PACK_TRANSPORT_PROTECTION_SCHEMA
      || transport.mode !== 'SEAL_PAID_PACK'
      || !SUI_ID.test(transportReleaseId)
      || !sameSuiId(transportReleaseId, scopedRelease.releaseId)
      || normalizedHash(transport.contentCommitment, 'Transport content commitment')
        !== releaseCommitment
      || normalizedHash(
        transport.sealReleaseCommitment,
        'Transport Seal release commitment',
      ) !== sealReleaseCommitment
    ) fail(
      'EXPANSION_PACK_PLAYER_PAID_TRANSPORT_MISSING',
      'A paid Pack is missing its exact immutable Seal transport proof.',
    );
    approvedSealPackageId = text(expectedSealPackageId).toLowerCase();
    pinnedSealPackageId = text(packRelease.sealPackageId).toLowerCase();
    const sealPolicyId = text(packRelease.sealPolicyId).toLowerCase();
    const chainSealReleaseCommitment = normalizedHash(
      packRelease.sealReleaseCommitment,
      'Sui Pack Seal release commitment',
    );
    if (!SUI_ID.test(approvedSealPackageId)) fail(
      'EXPANSION_PACK_PLAYER_SEAL_PACKAGE_REQUIRED',
      'The immutable v8 TypeOrigin package is required to verify paid Seal transport.',
    );
    if (
      !SUI_ID.test(pinnedSealPackageId)
      || !sameSuiId(pinnedSealPackageId, approvedSealPackageId)
      || !SUI_ID.test(sealPolicyId)
      || !sameSuiId(sealPolicyId, releaseId)
      || chainSealReleaseCommitment !== sealReleaseCommitment
    ) fail(
      'EXPANSION_PACK_PLAYER_SEAL_BINDING_MISMATCH',
      'The paid Pack must pin its Seal policy and immutable v8 TypeOrigin package on Sui.',
    );
    normalizedHash(transport.sourceCandidateCommitment, 'Transport source candidate commitment');
    normalizedHash(transport.sourceManifestSha256, 'Transport source manifest SHA-256');
    const protectedAssets = list(transport.assets);
    if (Number(transport.assetCount) !== protectedAssets.length
      || protectedAssets.length !== definitions.length) fail(
      'EXPANSION_PACK_PLAYER_TRANSPORT_ASSET_COUNT_MISMATCH',
      'A paid Pack must publish exactly one protected ciphertext for every Style.',
    );
    const observedTransportCommitment = await hashExpansionPackContent(
      canonicalExpansionPackJson(protectedAssets),
    );
    if (
      normalizedHash(transport.transportSetCommitment, 'Transport set commitment')
        !== observedTransportCommitment
      || normalizedHash(
        manifest.integrity?.transportSetCommitment,
        'Manifest transport set commitment',
      ) !== observedTransportCommitment
    ) fail(
      'EXPANSION_PACK_PLAYER_TRANSPORT_SET_MISMATCH',
      'The paid Pack ciphertext descriptor set does not match its manifest.',
    );
    protectedAssets.forEach((protection) => {
      const assetId = required(protection?.assetId, 'Protected Pack asset id');
      if (protectionByAsset.has(assetId)) fail(
        'EXPANSION_PACK_PLAYER_TRANSPORT_ASSET_DUPLICATE',
        'A protected Pack asset is listed more than once.',
        { assetId },
      );
      protectionByAsset.set(assetId, protection);
    });
  } else if (
    packRelease.sealPolicyId
    || packRelease.sealPackageId
    || packRelease.sealReleaseCommitment
    || Object.keys(transport).length
    || text(manifest.integrity?.transportSetCommitment)
  ) {
    fail(
      'EXPANSION_PACK_PLAYER_FREE_TRANSPORT_PROTECTED',
      'A free Pack cannot carry paid Seal transport metadata.',
    );
  }

  const assets = [];
  for (const definition of definitions) {
    const descriptor = descriptors.get(definition.assetId);
    const record = records.get(styleKey(definition));
    if (!descriptor || !record) fail(
      'EXPANSION_PACK_PLAYER_STYLE_READBACK_MISSING',
      'A Pack Style is missing its exact asset descriptor or Sui registry row.',
      definition,
    );
    const assetSha256 = normalizedHash(descriptor.sha256, 'Pack asset hash');
    if (normalizedHash(record.assetSha256, 'Sui Pack asset hash') !== assetSha256) fail(
      'EXPANSION_PACK_PLAYER_STYLE_HASH_MISMATCH',
      'A Pack Style PNG hash differs between Walrus and Sui.',
      definition,
    );
    const sealId = text(record.assetSealId).replace(/^0x/i, '').toLowerCase();
    if (paid && !SHA256.test(sealId)) fail(
      'EXPANSION_PACK_PLAYER_SEAL_BINDING_MISSING',
      'A paid Pack Style is missing its deterministic Sui Seal id.',
      definition,
    );
    if (!paid && sealId) fail(
      'EXPANSION_PACK_PLAYER_FREE_STYLE_SEALED',
      'A free Pack Style unexpectedly requires paid Seal access.',
      definition,
    );
    let protection = null;
    if (paid) {
      protection = object(protectionByAsset.get(definition.assetId));
      const protectionSealId = normalizedHash(protection.sealId, 'Protected Seal id');
      const sealPackageId = text(protection.sealPackageId).toLowerCase();
      const threshold = Number(protection.threshold);
      const keyServers = list(protection.keyServers);
      if (
        protection.schemaVersion !== MAKER_SEAL_ASSET_V5_SCHEMA
        || protection.mode !== 'SEAL_PAID_PACK'
        || required(protection.identifier, 'Protected asset identifier')
          !== required(descriptor.identifier, 'Pack asset identifier')
        || normalizedHash(protection.releaseCommitment, 'Protected release commitment')
          !== sealReleaseCommitment
        || normalizedHash(protection.assetDigest, 'Protected plaintext digest') !== assetSha256
        || !SHA256.test(normalizedHash(protection.ciphertextDigest, 'Protected ciphertext digest'))
        || Number(protection.productKind) !== MAKER_SEAL_PRODUCT_PACK
        || text(protection.partKey) !== definition.partKey
        || text(protection.itemKey) !== definition.itemKey
        || text(protection.styleKey) !== definition.styleKey
        || text(protection.packKey) !== text(manifest.pack?.id)
        || text(protection.plaintextMediaType) !== text(descriptor.mediaType)
        || text(protection.ciphertextMediaType) !== MAKER_SEAL_CIPHERTEXT_MEDIA_TYPE
        || protectionSealId !== sealId
        || !SUI_ID.test(sealPackageId)
        || !sameSuiId(sealPackageId, pinnedSealPackageId)
        || !Number.isSafeInteger(threshold)
        || threshold < 1
        || !keyServers.length
      ) fail(
        'EXPANSION_PACK_PLAYER_TRANSPORT_BINDING_MISMATCH',
        'A paid Pack ciphertext is not bound to its reviewed v8 package, exact Style and plaintext.',
        definition,
      );
      let totalWeight = 0;
      const serverIds = new Set();
      keyServers.forEach((server) => {
        const serverId = text(server?.objectId).toLowerCase();
        const weight = Number(server?.weight);
        if (!SUI_ID.test(serverId)
          || serverIds.has(serverId)
          || !Number.isSafeInteger(weight)
          || weight < 1
          || weight > 255) fail(
          'EXPANSION_PACK_PLAYER_TRANSPORT_SERVER_INVALID',
          'A paid Pack contains an invalid Seal key-server policy.',
          definition,
        );
        serverIds.add(serverId);
        totalWeight += weight;
      });
      if (threshold > totalWeight) fail(
        'EXPANSION_PACK_PLAYER_TRANSPORT_THRESHOLD_INVALID',
        'The paid Pack Seal threshold exceeds total key-server weight.',
        definition,
      );
      const derived = await deriveMakerSealIdV5({
        releaseCommitment: sealReleaseCommitment,
        productKind: MAKER_SEAL_PRODUCT_PACK,
        partKey: definition.partKey,
        itemKey: definition.itemKey,
        styleKey: definition.styleKey,
        packKey: manifest.pack.id,
        assetDigest: assetSha256,
      });
      if (normalizedHash(derived.id, 'Derived Seal id') !== sealId) fail(
        'EXPANSION_PACK_PLAYER_SEAL_ID_MISMATCH',
        'The Sui Style Seal id is not the deterministic id for this Pack asset.',
        definition,
      );
      const expectedAad = canonicalExpansionPackJson({
        schema: MAKER_SEAL_ASSET_V5_SCHEMA,
        sealPackageId,
        sealId: `0x${sealId}`,
        releaseCommitment: `0x${sealReleaseCommitment}`,
        assetDigest: `0x${assetSha256}`,
        productKind: MAKER_SEAL_PRODUCT_PACK,
        partKey: definition.partKey,
        itemKey: definition.itemKey,
        styleKey: definition.styleKey,
        packKey: manifest.pack.id,
        plaintextMediaType: descriptor.mediaType,
      });
      if (text(protection.aad) !== expectedAad) fail(
        'EXPANSION_PACK_PLAYER_TRANSPORT_AAD_MISMATCH',
        'The paid Pack ciphertext AAD does not match its immutable Style identity.',
        definition,
      );
    }
    assets.push({
      ...definition,
      identifier: required(descriptor.identifier, 'Pack asset identifier'),
      mediaType: required(descriptor.mediaType, 'Pack asset media type'),
      assetSha256,
      assetBlobId: required(record.assetBlobId, 'Pack Style Walrus patch id'),
      assetSealId: sealId,
      protection: protection ? structuredClone(protection) : null,
    });
  }

  const pack = runtimePack(manifest, parent);
  const compatibility = checkExpansionPackCompatibility(baseDocument, pack);
  if (!compatibility.compatible) fail(
    'EXPANSION_PACK_PLAYER_INCOMPATIBLE',
    `The verified Pack overlay is not compatible with its bound Maker (${compatibility.errors[0]?.code || 'unknown'}).`,
    { errors: compatibility.errors },
  );
  const wallet = text(walletAddress).toLowerCase();
  const pass = wallet ? exactPass({ ...packRelease, contentCommitment: releaseCommitment }, passes, wallet) : null;
  const lifecycle = Number(packRelease.lifecycle);
  const admittedParentOwnershipEpoch = exactU64(
    packRelease.admittedParentOwnershipEpoch,
    'Pack admitted parent ownership epoch',
  );
  const parentEpochCurrent = admittedParentOwnershipEpoch === parent.ownershipEpoch;
  const availableForAcquire = lifecycle === EXPANSION_PACK_V8_LIFECYCLE.ACTIVE
    && parentEpochCurrent;
  const accessible = Boolean(pass)
    && lifecycle >= EXPANSION_PACK_V8_LIFECYCLE.ADMITTED
    && parentEpochCurrent;
  return freeze({
    schemaVersion: EXPANSION_PACK_PLAYER_V8_SCHEMA,
    trusted: true,
    identity: `${text(packRelease.objectId).toLowerCase()}::${text(packRelease.packVersion)}::${releaseCommitment}`,
    releaseId,
    parent,
    release: structuredClone(packRelease),
    manifest,
    manifestSha256: observedManifestSha256,
    contentCommitment: releaseCommitment,
    pack,
    assets,
    access: {
      kind: expectedAccess,
      priceAtomic: BigInt(packRelease.purchasePriceAtomic || 0).toString(),
      entitled: Boolean(pass),
      pass: pass ? structuredClone(pass) : null,
      availableForAcquire,
      accessible,
      reason: accessible
        ? ''
        : !wallet
          ? 'WALLET_REQUIRED'
          : !parentEpochCurrent
            ? 'PARENT_READMISSION_REQUIRED'
          : !availableForAcquire
            ? 'PACK_NOT_ACTIVE'
            : 'ENTITLEMENT_REQUIRED',
    },
  });
}

export function expansionPackPlayerSessionRefV8(entryValue) {
  const entry = object(entryValue);
  if (entry.schemaVersion !== EXPANSION_PACK_PLAYER_V8_SCHEMA || entry.trusted !== true) fail(
    'EXPANSION_PACK_PLAYER_ENTRY_UNTRUSTED',
    'Only a verified Pack release can be saved in a Player session.',
  );
  return freeze({
    schemaVersion: EXPANSION_PACK_PLAYER_SESSION_SCHEMA,
    releaseId: required(entry.releaseId, 'Pack release id'),
    packId: required(entry.pack?.packId, 'Pack id'),
    packVersion: required(entry.pack?.version, 'Pack version'),
    manifestSha256: normalizedHash(entry.manifestSha256, 'Pack manifest hash'),
    contentCommitment: normalizedHash(entry.contentCommitment, 'Pack content commitment'),
    parentRootId: required(entry.parent?.baseMakerRootId, 'Parent root id'),
    parentVersionId: required(entry.parent?.versionId, 'Parent version id'),
  });
}

export function restoreExpansionPackPlayerSessionRefsV8(entries = [], refs = []) {
  const byRelease = new Map(list(entries).map((entry) => [text(entry.releaseId).toLowerCase(), entry]));
  return freeze(list(refs).map((ref) => {
    const entry = byRelease.get(text(ref?.releaseId).toLowerCase());
    const expected = entry ? expansionPackPlayerSessionRefV8(entry) : null;
    if (!expected || canonicalExpansionPackJson(expected) !== canonicalExpansionPackJson(ref)) fail(
      'EXPANSION_PACK_PLAYER_SESSION_DRIFT',
      'A saved Player Pack release no longer matches the verified catalog.',
      { releaseId: text(ref?.releaseId) },
    );
    if (!entry.access?.accessible) fail(
      'EXPANSION_PACK_PLAYER_SESSION_ENTITLEMENT_MISSING',
      'A saved Player Pack no longer has a verified wallet entitlement.',
      { releaseId: entry.releaseId },
    );
    return entry;
  }));
}

export function mergeVerifiedExpansionPackPlayersV8(baseDocument, entries = []) {
  const verified = list(entries);
  verified.forEach((entry) => {
    if (entry?.schemaVersion !== EXPANSION_PACK_PLAYER_V8_SCHEMA
      || entry?.trusted !== true
      || entry?.access?.accessible !== true
      || entry?.playerUsable !== true) fail(
      'EXPANSION_PACK_PLAYER_ENTRY_UNTRUSTED',
      'Every enabled Expansion Pack must be verified, entitled and fully resolved.',
    );
  });
  const result = mergeExpansionPacks(baseDocument, verified.map((entry) => entry.pack), {
    returnResult: true,
  });
  if (!result.compatible) fail(
    'EXPANSION_PACK_PLAYER_MERGE_FAILED',
    'The selected verified Pack releases cannot be merged together.',
    { errors: result.errors },
  );
  return freeze({
    document: result.maker,
    sessionRefs: verified.map(expansionPackPlayerSessionRefV8),
  });
}
