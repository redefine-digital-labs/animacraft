import {
  EXPANSION_PACK_MANIFEST_IDENTIFIER,
  EXPANSION_PACK_PUBLICATION_CANDIDATE_SCHEMA,
  EXPANSION_PACK_TRANSPORT_PROTECTION_SCHEMA,
  canonicalExpansionPackJson,
  expansionPackManifestContent,
  hashExpansionPackContent,
} from './expansion-pack-publication.js';
import {
  MAKER_SEAL_ASSET_V5_SCHEMA,
  MAKER_SEAL_CIPHERTEXT_MEDIA_TYPE,
  MAKER_SEAL_PRODUCT_PACK,
  deriveExpansionPackSealReleaseCommitmentV8,
  deriveMakerSealIdV5,
} from './maker-seal-v5.js';

export const EXPANSION_PACK_PUBLICATION_PLAN_SCHEMA =
  'animacraft.expansion-pack-publication-plan.v5';
export const EXPANSION_PACK_PUBLICATION_RECOVERY_SCHEMA =
  'animacraft.expansion-pack-publication-recovery.v5';

export const EXPANSION_PACK_PUBLICATION_ACTION_STATUS = Object.freeze({
  PENDING: 'PENDING',
  INTENT: 'INTENT',
  SUBMITTED: 'SUBMITTED',
  CONFIRMED: 'CONFIRMED',
});

export const EXPANSION_PACK_PUBLICATION_STAGES = Object.freeze({
  PARENT_VERIFYING: 'PARENT_VERIFYING',
  WALRUS_PREPARING: 'WALRUS_PREPARING',
  WALRUS_REGISTERING: 'WALRUS_REGISTERING',
  WALRUS_CERTIFYING: 'WALRUS_CERTIFYING',
  PACK_CREATING: 'PACK_CREATING',
  PACK_MATERIALIZING: 'PACK_MATERIALIZING',
  PACK_MANIFEST_BINDING: 'PACK_MANIFEST_BINDING',
  STYLES_REGISTERING: 'STYLES_REGISTERING',
  PACK_SEALING: 'PACK_SEALING',
  PACK_SEAL_POLICY_BINDING: 'PACK_SEAL_POLICY_BINDING',
  PACK_ADMITTING: 'PACK_ADMITTING',
  PACK_ACTIVATING: 'PACK_ACTIVATING',
  COMPLETE: 'COMPLETE',
});

export const EXPANSION_PACK_PUBLICATION_TRANSPORTS = Object.freeze({
  READBACK: 'READBACK',
  LOCAL: 'LOCAL',
  WALRUS: 'WALRUS',
  SUI: 'SUI',
});

export const EXPANSION_PACK_V8_MOVE_MODULE = 'expansion_pack_v8';
export const EXPANSION_PACK_V8_MOVE_FUNCTIONS = Object.freeze({
  CREATE: 'create_expansion_pack_v8',
  BIND_MANIFEST: 'bind_expansion_pack_manifest_v8',
  REGISTER_STYLE: 'register_style_asset_v8',
  SEAL: 'seal_expansion_pack_v8',
  BIND_SEAL_POLICY: 'bind_expansion_pack_seal_policy_v8',
  ADMIT: 'admit_expansion_pack_with_authority_v8',
  ACTIVATE: 'activate_expansion_pack_v8',
});

const SHA256 = /^(?:0x)?[0-9a-f]{64}$/i;
const SUI_ID = /^0x[0-9a-f]+$/i;
const NONCE = /^[a-zA-Z0-9._:-]{16,256}$/;

export class ExpansionPackPublicationRecoveryError extends Error {
  constructor(message, code = 'EXPANSION_PACK_PUBLICATION_RECOVERY_ERROR', details = {}) {
    super(message);
    this.name = 'ExpansionPackPublicationRecoveryError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new ExpansionPackPublicationRecoveryError(message, code, details);
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function clone(value) {
  return structuredClone(value);
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

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
}

function required(value, label) {
  const normalized = text(value);
  if (!normalized) {
    fail('EXPANSION_PACK_PUBLICATION_CONTEXT_MISSING', `${label} is required.`, { label });
  }
  return normalized;
}

function exactId(value, label) {
  const normalized = required(value, label).toLowerCase();
  if (!SUI_ID.test(normalized)) {
    fail(
      'EXPANSION_PACK_PUBLICATION_OBJECT_ID_INVALID',
      `${label} must be a Sui object ID.`,
      { label, value: text(value) },
    );
  }
  return normalized;
}

function sameId(left, right) {
  try {
    return BigInt(exactId(left, 'Sui object ID'))
      === BigInt(exactId(right, 'Sui object ID'));
  } catch {
    return false;
  }
}

function hash(value, label) {
  const normalized = required(value, label).replace(/^0x/i, '').toLowerCase();
  if (!SHA256.test(normalized)) {
    fail(
      'EXPANSION_PACK_PUBLICATION_COMMITMENT_INVALID',
      `${label} must be an exact 32-byte hexadecimal commitment.`,
      { label, value: text(value) },
    );
  }
  return normalized;
}

function u64(value, label) {
  let normalized;
  try {
    if (value == null || value === '') throw new Error('missing');
    if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error('unsafe');
    if (typeof value === 'string' && !/^\d+$/.test(value.trim())) throw new Error('syntax');
    normalized = BigInt(value);
  } catch {
    fail('EXPANSION_PACK_PUBLICATION_U64_INVALID', `${label} must be an unsigned integer.`);
  }
  if (normalized < 0n || normalized > 18_446_744_073_709_551_615n) {
    fail('EXPANSION_PACK_PUBLICATION_U64_INVALID', `${label} must fit an unsigned 64-bit integer.`);
  }
  return normalized.toString();
}

function normalizedAccess(candidate, context) {
  const draft = object(candidate.manifest?.commerce);
  const declared = context.accessKind ?? draft.accessKind ?? draft.accessMode;
  const accessKind = declared === 0 || declared === '0' || text(declared).toUpperCase() === 'FREE'
    ? 0
    : declared === 1 || declared === '1' || ['PAID', 'PAID_ONCE'].includes(text(declared).toUpperCase())
      ? 1
      : -1;
  if (accessKind < 0) {
    fail('EXPANSION_PACK_PUBLICATION_ACCESS_INVALID', 'Pack access must be Free or Paid Once.');
  }
  const purchasePriceAtomic = u64(
    context.purchasePriceAtomic ?? draft.purchasePriceAtomic ?? draft.price ?? 0,
    'Pack purchase price',
  );
  if ((accessKind === 0 && purchasePriceAtomic !== '0')
      || (accessKind === 1 && purchasePriceAtomic === '0')) {
    fail(
      'EXPANSION_PACK_PUBLICATION_ACCESS_PRICE_MISMATCH',
      'Free Pack access requires zero price; Paid Pack access requires a positive price.',
    );
  }
  return { accessKind, purchasePriceAtomic };
}

function timestamp(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  if (!Number.isFinite(date.getTime())) {
    fail('EXPANSION_PACK_PUBLICATION_TIME_INVALID', 'Publication time is invalid.');
  }
  return date.toISOString();
}

function outputRef(actionId, field, path = []) {
  return { $output: { actionId, field, path } };
}

function contextRef(field) {
  return { $context: field };
}

function actionKey(value) {
  return encodeURIComponent(String(value)).replace(/%/g, '_');
}

function moveTarget(packageId, functionName, moduleName = EXPANSION_PACK_V8_MOVE_MODULE) {
  return `${packageId}::${moduleName}::${functionName}`;
}

function action({
  id,
  stage,
  transport,
  target,
  inputs,
  outputs,
  authority,
  policy = null,
  typeArguments = [],
}) {
  return {
    id,
    stage,
    transport,
    target,
    authority,
    inputs,
    outputs,
    policy,
    typeArguments,
  };
}

function assertCandidate(candidateValue) {
  const candidate = object(candidateValue);
  if (
    candidate.schemaVersion !== EXPANSION_PACK_PUBLICATION_CANDIDATE_SCHEMA
    || candidate.readyForTransport !== true
    || candidate.published !== false
    || candidate.chainConnected !== false
  ) {
    fail(
      'EXPANSION_PACK_PUBLICATION_CANDIDATE_INVALID',
      'A transport-ready, unpublished Expansion Pack candidate is required.',
    );
  }
  const manifestJson = required(candidate.manifestJson, 'Expansion Pack manifest JSON');
  if (canonicalExpansionPackJson(candidate.manifest) !== manifestJson) {
    fail(
      'EXPANSION_PACK_PUBLICATION_MANIFEST_BYTES_CHANGED',
      'The canonical Expansion Pack manifest bytes changed after candidate preparation.',
    );
  }
  const files = array(candidate.files);
  if (!files.length || files[0]?.identifier !== EXPANSION_PACK_MANIFEST_IDENTIFIER) {
    fail(
      'EXPANSION_PACK_PUBLICATION_MANIFEST_FILE_MISSING',
      'The Expansion Pack manifest must be the first Walrus quilt file.',
    );
  }
  const identifiers = new Set();
  files.forEach((file, index) => {
    const identifier = required(file?.identifier, `Walrus file ${index} identifier`);
    if (identifiers.has(identifier)) {
      fail(
        'EXPANSION_PACK_PUBLICATION_FILE_DUPLICATE',
        `Walrus identifier ${identifier} is duplicated.`,
        { identifier },
      );
    }
    identifiers.add(identifier);
    hash(file?.sha256, `Walrus file ${identifier} SHA-256`);
  });
  return candidate;
}

async function verifyCandidateCommitments(candidate) {
  const manifestSha256 = hash(candidate.manifestSha256, 'Expansion Pack manifest SHA-256');
  const observedManifestSha256 = await hashExpansionPackContent(candidate.manifestJson);
  if (observedManifestSha256 !== manifestSha256) {
    fail(
      'EXPANSION_PACK_PUBLICATION_MANIFEST_HASH_MISMATCH',
      'The exact Expansion Pack manifest bytes do not match their declared SHA-256.',
      { expected: manifestSha256, actual: observedManifestSha256 },
    );
  }
  if (hash(candidate.files[0]?.sha256, 'Manifest file SHA-256') !== manifestSha256) {
    fail(
      'EXPANSION_PACK_PUBLICATION_MANIFEST_FILE_HASH_MISMATCH',
      'The manifest file descriptor does not match the exact manifest bytes.',
    );
  }
  const contentCommitment = hash(candidate.contentCommitment, 'Pack content commitment');
  const observedContentCommitment = await hashExpansionPackContent(
    canonicalExpansionPackJson(expansionPackManifestContent(candidate.manifest)),
  );
  if (
    observedContentCommitment !== contentCommitment
    || hash(candidate.manifest?.integrity?.contentCommitment, 'Manifest content commitment')
      !== contentCommitment
  ) {
    fail(
      'EXPANSION_PACK_PUBLICATION_CONTENT_COMMITMENT_MISMATCH',
      'The Expansion Pack semantic content does not match the declared Sui commitment.',
      { expected: contentCommitment, actual: observedContentCommitment },
    );
  }
  const candidateCommitment = hash(candidate.candidateCommitment, 'Pack candidate commitment');
  const expectedCandidateCommitment = await hashExpansionPackContent(canonicalExpansionPackJson({
    manifestSha256,
    parentIdentity: candidate.manifest?.parent?.identity,
    packId: candidate.manifest?.pack?.id,
    packVersion: candidate.manifest?.pack?.version,
  }));
  if (candidateCommitment !== expectedCandidateCommitment) {
    fail(
      'EXPANSION_PACK_PUBLICATION_CANDIDATE_COMMITMENT_MISMATCH',
      'The Expansion Pack candidate commitment does not match its immutable release identity.',
    );
  }
  return { manifestSha256, contentCommitment, candidateCommitment };
}

async function packStyleAssets(candidate) {
  const overlay = object(candidate.manifest?.overlay);
  const assets = new Map(array(overlay.assets).map((entry) => [text(entry?.id), entry]));
  const styles = [];
  for (const part of array(overlay.parts)) {
    for (const item of array(part?.items)) {
      for (const style of array(item?.styles)) {
        const assetId = required(
          style?.assetId,
          `Pack Style ${text(part?.id)}/${text(item?.id)}/${text(style?.id)} asset id`,
        );
        const asset = assets.get(assetId);
        if (!asset) {
          fail(
            'EXPANSION_PACK_PUBLICATION_STYLE_ASSET_NOT_LOCAL',
            'Every independently registered Pack Style must use a Pack-local immutable asset.',
            { partId: part?.id, itemId: item?.id, styleId: style?.id, assetId },
          );
        }
        const row = {
          partId: required(
            part?.id || part?.extendsPartId || part?.targetPartId,
            'Pack Part id',
          ),
          itemId: required(
            item?.id || item?.extendsItemId || item?.targetItemId,
            'Pack Item id',
          ),
          styleId: required(style?.id, 'Pack Style id'),
          assetId,
          assetIdentifier: required(asset?.identifier, `Pack asset ${assetId} identifier`),
          assetSha256: hash(asset?.sha256, `Pack asset ${assetId} SHA-256`),
          mediaType: required(asset?.mediaType, `Pack asset ${assetId} media type`),
          layerTrackId: required(style?.layerTrackId, `Pack Style ${style?.id} layer track`),
          transform: clone(object(style?.transform)),
          opacity: Number(style?.opacity ?? 1),
          blendMode: text(style?.blendMode) || 'normal',
        };
        styles.push({
          ...row,
          styleCommitment: await hashExpansionPackContent(stableJson(row)),
        });
      }
    }
  }
  styles.sort((left, right) => (
    left.partId.localeCompare(right.partId)
    || left.itemId.localeCompare(right.itemId)
    || left.styleId.localeCompare(right.styleId)
  ));
  if (!styles.length) {
    fail(
      'EXPANSION_PACK_PUBLICATION_EMPTY',
      'An Expansion Pack release must register at least one exact Style asset.',
    );
  }
  const keys = new Set();
  styles.forEach((style) => {
    const key = `${style.partId}\u0000${style.itemId}\u0000${style.styleId}`;
    if (keys.has(key)) {
      fail(
        'EXPANSION_PACK_PUBLICATION_STYLE_DUPLICATE',
        'A Pack may register each Part/Item/Style identity only once.',
        { partId: style.partId, itemId: style.itemId, styleId: style.styleId },
      );
    }
    keys.add(key);
  });
  return styles;
}

async function bindStyleSealIds(styles, planContext, contentCommitment, releaseId) {
  const sealReleaseCommitment = planContext.accessKind === 1
    ? (await deriveExpansionPackSealReleaseCommitmentV8({
        releaseId,
        contentCommitment,
      })).id.replace(/^0x/i, '').toLowerCase()
    : '';
  return Promise.all(styles.map(async (style) => ({
    ...style,
    assetSealId: planContext.accessKind === 1
      ? (await deriveMakerSealIdV5({
          releaseCommitment: sealReleaseCommitment,
          productKind: MAKER_SEAL_PRODUCT_PACK,
          partKey: style.partId,
          itemKey: style.itemId,
          styleKey: style.styleId,
          packKey: planContext.packId,
          assetDigest: style.assetSha256,
        })).id.replace(/^0x/i, '').toLowerCase()
      : '',
  })));
}

async function verifyTransportProtection(
  candidate,
  styles,
  planContext,
  contentCommitment,
  releaseId,
) {
  const section = object(candidate.manifest?.transportProtection);
  const declaredTransportCommitment = text(
    candidate.manifest?.integrity?.transportSetCommitment,
  );
  if (planContext.accessKind === 0) {
    if (Object.keys(section).length || declaredTransportCommitment || candidate.transportProtected === true) {
      fail(
        'EXPANSION_PACK_PUBLICATION_FREE_TRANSPORT_PROTECTED',
        'A free Expansion Pack cannot contain paid Seal transport metadata.',
      );
    }
    return styles;
  }
  if (
    candidate.transportProtected !== true
    || section.schemaVersion !== EXPANSION_PACK_TRANSPORT_PROTECTION_SCHEMA
    || section.mode !== 'SEAL_PAID_PACK'
  ) {
    fail(
      'EXPANSION_PACK_PUBLICATION_PAID_TRANSPORT_MISSING',
      'A paid Expansion Pack must encrypt every Pack-local PNG before Walrus upload.',
    );
  }
  if (hash(section.contentCommitment, 'Transport content commitment') !== contentCommitment) {
    fail(
      'EXPANSION_PACK_PUBLICATION_TRANSPORT_COMMITMENT_MISMATCH',
      'The paid transport descriptor is bound to a different Pack content commitment.',
    );
  }
  const scoped = await deriveExpansionPackSealReleaseCommitmentV8({
    releaseId,
    contentCommitment,
  });
  const sealReleaseCommitment = scoped.id.replace(/^0x/i, '').toLowerCase();
  if (
    !sameId(section.releaseId, releaseId)
    || hash(section.sealReleaseCommitment, 'Transport Seal release commitment')
      !== sealReleaseCommitment
  ) {
    fail(
      'EXPANSION_PACK_PUBLICATION_TRANSPORT_RELEASE_MISMATCH',
      'The paid transport descriptor belongs to another Expansion Pack Release object.',
    );
  }
  const sourceCandidateCommitment = hash(
    section.sourceCandidateCommitment,
    'Transport source candidate commitment',
  );
  const sourceManifestSha256 = hash(
    section.sourceManifestSha256,
    'Transport source manifest SHA-256',
  );
  if (
    hash(candidate.transportSource?.candidateCommitment, 'Candidate transport source commitment')
      !== sourceCandidateCommitment
    || hash(candidate.transportSource?.manifestSha256, 'Candidate transport source manifest SHA-256')
      !== sourceManifestSha256
  ) {
    fail(
      'EXPANSION_PACK_PUBLICATION_TRANSPORT_SOURCE_MISMATCH',
      'The protected candidate is not linked to the exact pre-encryption persistence lane.',
    );
  }
  const protectedAssets = array(section.assets);
  if (
    Number(section.assetCount) !== protectedAssets.length
    || protectedAssets.length !== styles.length
  ) {
    fail(
      'EXPANSION_PACK_PUBLICATION_TRANSPORT_ASSET_COUNT_MISMATCH',
      'The paid transport descriptor must contain exactly one ciphertext for every Style.',
    );
  }
  const transportSetCommitment = await hashExpansionPackContent(
    canonicalExpansionPackJson(protectedAssets),
  );
  if (
    hash(section.transportSetCommitment, 'Transport set commitment') !== transportSetCommitment
    || hash(declaredTransportCommitment, 'Manifest transport set commitment')
      !== transportSetCommitment
  ) {
    fail(
      'EXPANSION_PACK_PUBLICATION_TRANSPORT_SET_MISMATCH',
      'The paid ciphertext descriptor set changed after the manifest was prepared.',
    );
  }
  const protectionByAsset = new Map();
  protectedAssets.forEach((protection) => {
    const assetId = required(protection?.assetId, 'Protected Pack asset id');
    if (protectionByAsset.has(assetId)) {
      fail(
        'EXPANSION_PACK_PUBLICATION_TRANSPORT_ASSET_DUPLICATE',
        'A paid Pack transport descriptor contains a duplicate asset id.',
        { assetId },
      );
    }
    protectionByAsset.set(assetId, protection);
  });
  const files = new Map(array(candidate.files).map((file) => [text(file?.identifier), file]));
  for (const style of styles) {
    const protection = object(protectionByAsset.get(style.assetId));
    const sealPackageId = exactId(protection.sealPackageId, 'Protected Seal package id');
    const sealId = hash(protection.sealId, 'Protected Seal id');
    const ciphertextDigest = hash(protection.ciphertextDigest, 'Protected ciphertext digest');
    const threshold = Number(protection.threshold);
    const keyServers = array(protection.keyServers);
    if (
      protection.schemaVersion !== MAKER_SEAL_ASSET_V5_SCHEMA
      || protection.mode !== 'SEAL_PAID_PACK'
      || required(protection.identifier, 'Protected asset identifier') !== style.assetIdentifier
      || hash(protection.releaseCommitment, 'Protected release commitment')
        !== sealReleaseCommitment
      || hash(protection.assetDigest, 'Protected plaintext digest') !== style.assetSha256
      || Number(protection.productKind) !== MAKER_SEAL_PRODUCT_PACK
      || text(protection.partKey) !== style.partId
      || text(protection.itemKey) !== style.itemId
      || text(protection.styleKey) !== style.styleId
      || text(protection.packKey) !== planContext.packId
      || text(protection.plaintextMediaType) !== style.mediaType
      || text(protection.ciphertextMediaType) !== MAKER_SEAL_CIPHERTEXT_MEDIA_TYPE
      || !sameId(sealPackageId, planContext.expansionPackV8TypeOriginPackageId)
      || sealId !== style.assetSealId
      || !Number.isSafeInteger(threshold)
      || threshold < 1
      || !keyServers.length
    ) {
      fail(
        'EXPANSION_PACK_PUBLICATION_TRANSPORT_BINDING_MISMATCH',
        'A paid ciphertext is not bound to its exact v8 TypeOrigin package and Pack/Part/Item/Style identity.',
        { assetId: style.assetId },
      );
    }
    let totalWeight = 0;
    const serverIds = new Set();
    keyServers.forEach((server) => {
      const objectId = exactId(server?.objectId, 'Protected Seal key server id');
      const weight = Number(server?.weight);
      if (serverIds.has(objectId) || !Number.isSafeInteger(weight) || weight < 1 || weight > 255) {
        fail(
          'EXPANSION_PACK_PUBLICATION_TRANSPORT_SERVER_INVALID',
          'Protected Seal key servers must be unique and use valid weights.',
          { assetId: style.assetId },
        );
      }
      serverIds.add(objectId);
      totalWeight += weight;
    });
    if (threshold > totalWeight) {
      fail(
        'EXPANSION_PACK_PUBLICATION_TRANSPORT_THRESHOLD_INVALID',
        'The protected Seal threshold exceeds total key-server weight.',
        { assetId: style.assetId },
      );
    }
    const expectedAad = stableJson({
      schema: MAKER_SEAL_ASSET_V5_SCHEMA,
      sealPackageId,
      sealId: `0x${sealId}`,
      releaseCommitment: `0x${sealReleaseCommitment}`,
      assetDigest: `0x${style.assetSha256}`,
      productKind: MAKER_SEAL_PRODUCT_PACK,
      partKey: style.partId,
      itemKey: style.itemId,
      styleKey: style.styleId,
      packKey: planContext.packId,
      plaintextMediaType: style.mediaType,
    });
    const file = object(files.get(style.assetIdentifier));
    if (
      text(protection.aad) !== expectedAad
      || hash(file.sha256, 'Ciphertext file SHA-256') !== ciphertextDigest
      || hash(file.plaintextSha256, 'Ciphertext file plaintext SHA-256') !== style.assetSha256
      || text(file.mediaType) !== MAKER_SEAL_CIPHERTEXT_MEDIA_TYPE
      || !Number.isSafeInteger(Number(file.byteLength))
      || Number(file.byteLength) < 1
    ) {
      fail(
        'EXPANSION_PACK_PUBLICATION_TRANSPORT_FILE_MISMATCH',
        'A paid Walrus file descriptor does not match its exact Seal ciphertext proof.',
        { assetId: style.assetId },
      );
    }
  }
  return styles;
}

function normalizedContext(candidate, contextValue, runtimeValue) {
  const context = object(contextValue);
  const runtime = object(runtimeValue);
  const parent = object(candidate.manifest?.parent);
  const pack = object(candidate.manifest?.pack);
  const access = normalizedAccess(candidate, context);
  const owner = exactId(context.owner || pack.creator, 'Expansion Pack publisher');
  if (text(pack.creator).toLowerCase() !== owner) {
    fail(
      'EXPANSION_PACK_PUBLICATION_PUBLISHER_MISMATCH',
      'The connected publisher does not match the immutable Pack creator.',
    );
  }
  const parentLegacyMakerId = exactId(
    context.parentLegacyMakerId || context.parentReleaseObjectId || parent.releaseId,
    'Parent legacy OCMaker',
  );
  if (text(parent.releaseId).toLowerCase() !== parentLegacyMakerId) {
    fail(
      'EXPANSION_PACK_PUBLICATION_PARENT_RELEASE_MISMATCH',
      'The Sui parent release does not match the candidate parent binding.',
    );
  }
  return {
    owner,
    baseMakerRootId: exactId(context.baseMakerRootId, 'Parent MakerRootV5'),
    parentLegacyMakerId,
    independentExtensionAuthorityV5Id: exactId(
      context.independentExtensionAuthorityV5Id,
      'IndependentExtensionAuthorityV5',
    ),
    independentExtensionV5TypeOriginPackageId: exactId(
      runtime.independentExtensionV5TypeOriginPackageId
        || context.independentExtensionV5TypeOriginPackageId,
      'Independent extension v5 TypeOrigin package',
    ),
    commerceV5CallablePackageId: exactId(
      runtime.commerceV5CallablePackageId
        || runtime.callablePackageId
        || context.commerceV5CallablePackageId,
      'Commerce v5 callable package',
    ),
    expansionPackV8CallablePackageId: exactId(
      runtime.expansionPackV8CallablePackageId
        || runtime.expansionPackV8PackageId
        || context.expansionPackV8CallablePackageId,
      'Expansion Pack v8 callable package',
    ),
    expansionPackV8TypeOriginPackageId: exactId(
      runtime.expansionPackV8TypeOriginPackageId
        || context.expansionPackV8TypeOriginPackageId,
      'Expansion Pack v8 TypeOrigin package',
    ),
    commerceProtocolConfigV5Id: exactId(
      runtime.commerceProtocolConfigV5Id || context.commerceProtocolConfigV5Id,
      'CommerceProtocolConfigV5',
    ),
    paymentCoinType: required(
      runtime.paymentCoinType || context.paymentCoinType,
      'Expansion Pack payment coin type',
    ),
    parentLogicalMakerId: required(parent.rootMakerId, 'Parent logical Maker id'),
    parentVersionId: required(parent.versionId, 'Parent Maker version id'),
    parentVersion: u64(parent.versionNumber, 'Parent Maker version number'),
    parentManifestBlobId: required(parent.manifestBlobId, 'Parent manifest Blob/Quilt id'),
    parentManifestSha256: hash(parent.manifestSha256, 'Parent manifest SHA-256'),
    parentIdentity: required(parent.identity, 'Parent release identity'),
    packId: required(pack.id, 'Expansion Pack id'),
    packNamespace: required(pack.namespace, 'Expansion Pack namespace'),
    packVersion: required(pack.version, 'Expansion Pack version'),
    ...access,
  };
}

/**
 * Verify the final local/Walrus materialization after the Draft Release shell
 * exists. Paid candidates must be encrypted for that exact object ID; free
 * candidates remain public but still use the same durable stage boundary.
 */
export async function materializeExpansionPackPublicationCandidate({
  candidate: candidateValue,
  context = {},
  runtime = {},
  releaseId,
} = {}) {
  const candidate = assertCandidate(candidateValue);
  const commitments = await verifyCandidateCommitments(candidate);
  const planContext = normalizedContext(candidate, context, runtime);
  const exactReleaseId = exactId(releaseId, 'Expansion Pack Release');
  const styles = await bindStyleSealIds(
    await packStyleAssets(candidate),
    planContext,
    commitments.contentCommitment,
    exactReleaseId,
  );
  await verifyTransportProtection(
    candidate,
    styles,
    planContext,
    commitments.contentCommitment,
    exactReleaseId,
  );
  const sealReleaseCommitment = planContext.accessKind === 1
    ? (await deriveExpansionPackSealReleaseCommitmentV8({
        releaseId: exactReleaseId,
        contentCommitment: commitments.contentCommitment,
      })).id.replace(/^0x/i, '').toLowerCase()
    : '';
  const materializedStyles = styles.map(({ partId, itemId, styleId, ...style }) => ({
    ...style,
    partKey: partId,
    itemKey: itemId,
    styleKey: styleId,
  }));
  return freeze({
    packReleaseId: exactReleaseId,
    candidate: clone(candidate),
    candidateCommitment: commitments.candidateCommitment,
    contentCommitment: commitments.contentCommitment,
    manifestSha256: commitments.manifestSha256,
    manifestJson: candidate.manifestJson,
    files: clone(candidate.files),
    styles: materializedStyles,
    sealReleaseCommitment,
    transportProtected: candidate.transportProtected === true,
  });
}

/**
 * Build the immutable recovery plan. The parent is read back first, then the
 * the Draft Release shell is created and read back before local Seal
 * materialization. Walrus then receives only bytes bound to that exact object.
 * Every write has a separate durable intent and exact readback.
 */
export async function buildExpansionPackPublicationPlan({
  candidate: candidateValue,
  context = {},
  runtime = {},
} = {}) {
  const candidate = assertCandidate(candidateValue);
  const commitments = await verifyCandidateCommitments(candidate);
  const planContext = normalizedContext(candidate, context, runtime);
  if (candidate.transportProtected === true || candidate.manifest?.transportProtection) {
    fail(
      'EXPANSION_PACK_PUBLICATION_SOURCE_ALREADY_PROTECTED',
      'A new v8 publication plan must start from the unprotected authoring snapshot.',
    );
  }
  const styles = await packStyleAssets(candidate);
  const authority = {
    role: 'INDEPENDENT_EXTENSION',
    signer: contextRef('owner'),
    capability: contextRef('independentExtensionAuthorityV5Id'),
  };
  const packCreatorAuthority = {
    role: 'PACK_CREATOR',
    signer: contextRef('owner'),
    capability: contextRef('independentExtensionAuthorityV5Id'),
  };
  const packAuthority = {
    role: 'PACK_ADMIN',
    signer: contextRef('owner'),
    capability: outputRef('chain.pack.create', 'packAdminCapId'),
  };
  const actions = [
    action({
      id: 'parent.release.verify',
      stage: EXPANSION_PACK_PUBLICATION_STAGES.PARENT_VERIFYING,
      transport: EXPANSION_PACK_PUBLICATION_TRANSPORTS.READBACK,
      target: 'sui:verify-expansion-pack-parent-v8',
      authority: { role: 'READBACK', signer: contextRef('owner'), capability: null },
      inputs: {
        baseMakerRootId: contextRef('baseMakerRootId'),
        parentLegacyMakerId: contextRef('parentLegacyMakerId'),
        independentExtensionAuthorityV5Id:
          contextRef('independentExtensionAuthorityV5Id'),
        parentLogicalMakerId: contextRef('parentLogicalMakerId'),
        parentVersionId: contextRef('parentVersionId'),
        parentVersion: contextRef('parentVersion'),
        parentManifestBlobId: contextRef('parentManifestBlobId'),
        parentManifestSha256: contextRef('parentManifestSha256'),
        parentIdentity: contextRef('parentIdentity'),
      },
      outputs: [
        'parentVerified',
        'independentExtensionAuthorityVerified',
        'parentReleaseEvidenceBound',
        'parentLifecycleState',
        'parentOwnershipEpoch',
        'baseMakerRootId',
        'parentLegacyMakerId',
        'parentVersion',
        'parentManifestBlobId',
        'parentManifestSha256',
      ],
    }),
    action({
      id: 'chain.pack.create',
      stage: EXPANSION_PACK_PUBLICATION_STAGES.PACK_CREATING,
      transport: EXPANSION_PACK_PUBLICATION_TRANSPORTS.SUI,
      target: moveTarget(
        planContext.expansionPackV8CallablePackageId,
        EXPANSION_PACK_V8_MOVE_FUNCTIONS.CREATE,
      ),
      authority: packCreatorAuthority,
      typeArguments: [contextRef('paymentCoinType')],
      inputs: {
        baseMakerRootId: contextRef('baseMakerRootId'),
        parentLegacyMakerId: contextRef('parentLegacyMakerId'),
        independentExtensionAuthorityV5Id:
          contextRef('independentExtensionAuthorityV5Id'),
        commerceProtocolConfigV5Id: contextRef('commerceProtocolConfigV5Id'),
        parentVersion: contextRef('parentVersion'),
        parentManifestBlobId: contextRef('parentManifestBlobId'),
        parentManifestSha256: contextRef('parentManifestSha256'),
        packId: contextRef('packId'),
        packNamespace: contextRef('packNamespace'),
        packVersion: contextRef('packVersion'),
        contentCommitment: commitments.contentCommitment,
        accessKind: contextRef('accessKind'),
        purchasePriceAtomic: contextRef('purchasePriceAtomic'),
      },
      outputs: [
        'packReleaseId',
        'packAdminCapId',
        'packTreasuryId',
        'transactionDigest',
        'readbackVerified',
        'manifestBound',
        'lifecycleState',
        'creator',
        'baseMakerRootId',
        'parentLegacyMakerId',
        'parentVersion',
        'parentManifestBlobId',
        'parentManifestSha256',
        'packId',
        'packVersion',
        'contentCommitment',
        'accessKind',
        'purchasePriceAtomic',
      ],
    }),
    action({
      id: 'local.pack.materialize',
      stage: EXPANSION_PACK_PUBLICATION_STAGES.PACK_MATERIALIZING,
      transport: EXPANSION_PACK_PUBLICATION_TRANSPORTS.LOCAL,
      target: 'local:materialize-expansion-pack-v8',
      authority: { role: 'PACK_CREATOR', signer: contextRef('owner'), capability: null },
      inputs: {
        packReleaseId: outputRef('chain.pack.create', 'packReleaseId'),
        contentCommitment: commitments.contentCommitment,
        sourceCandidateCommitment: commitments.candidateCommitment,
        sourceManifestSha256: commitments.manifestSha256,
        accessKind: contextRef('accessKind'),
        styles: styles.map((style) => ({
          partKey: style.partId,
          itemKey: style.itemId,
          styleKey: style.styleId,
          assetIdentifier: style.assetIdentifier,
          assetSha256: style.assetSha256,
        })),
      },
      outputs: [
        'packReleaseId',
        'candidate',
        'candidateCommitment',
        'contentCommitment',
        'manifestSha256',
        'manifestJson',
        'files',
        'styles',
        'sealReleaseCommitment',
        'transportProtected',
      ],
    }),
    action({
      id: 'walrus.pack.prepare',
      stage: EXPANSION_PACK_PUBLICATION_STAGES.WALRUS_PREPARING,
      transport: EXPANSION_PACK_PUBLICATION_TRANSPORTS.WALRUS,
      target: 'walrus:prepare',
      authority,
      inputs: {
        candidateCommitment: outputRef('local.pack.materialize', 'candidateCommitment'),
        files: outputRef('local.pack.materialize', 'files'),
        manifestJson: outputRef('local.pack.materialize', 'manifestJson'),
      },
      outputs: ['uploadSessionId', 'quiltBlobId', 'walrusRecovery'],
    }),
    action({
      id: 'walrus.pack.register-upload',
      stage: EXPANSION_PACK_PUBLICATION_STAGES.WALRUS_REGISTERING,
      transport: EXPANSION_PACK_PUBLICATION_TRANSPORTS.WALRUS,
      target: 'walrus:register-and-upload',
      authority,
      inputs: {
        uploadSessionId: outputRef('walrus.pack.prepare', 'uploadSessionId'),
        quiltBlobId: outputRef('walrus.pack.prepare', 'quiltBlobId'),
        files: outputRef('local.pack.materialize', 'files'),
      },
      outputs: [
        'uploadSessionId',
        'quiltBlobId',
        'blobObjectId',
        'registerDigest',
        'uploaded',
        'walrusRecovery',
      ],
    }),
    action({
      id: 'walrus.pack.certify',
      stage: EXPANSION_PACK_PUBLICATION_STAGES.WALRUS_CERTIFYING,
      transport: EXPANSION_PACK_PUBLICATION_TRANSPORTS.WALRUS,
      target: 'walrus:certify-and-readback',
      authority,
      inputs: {
        uploadSessionId: outputRef('walrus.pack.register-upload', 'uploadSessionId'),
        quiltBlobId: outputRef('walrus.pack.register-upload', 'quiltBlobId'),
        blobObjectId: outputRef('walrus.pack.register-upload', 'blobObjectId'),
        manifestIdentifier: EXPANSION_PACK_MANIFEST_IDENTIFIER,
        manifestSha256: outputRef('local.pack.materialize', 'manifestSha256'),
        styles: outputRef('local.pack.materialize', 'styles'),
      },
      outputs: [
        'uploadSessionId',
        'quiltBlobId',
        'blobObjectId',
        'certifyDigest',
        'certified',
        'certificationVisible',
        'manifestQuiltPatchId',
        'manifestIdentifier',
        'manifestSha256',
        'filePatchIds',
        'styleRegistryCommitment',
        'walrusRecovery',
      ],
    }),
    action({
      id: 'chain.pack.manifest.bind',
      stage: EXPANSION_PACK_PUBLICATION_STAGES.PACK_MANIFEST_BINDING,
      transport: EXPANSION_PACK_PUBLICATION_TRANSPORTS.SUI,
      target: moveTarget(
        planContext.expansionPackV8CallablePackageId,
        EXPANSION_PACK_V8_MOVE_FUNCTIONS.BIND_MANIFEST,
      ),
      authority: packAuthority,
      inputs: {
        packReleaseId: outputRef('chain.pack.create', 'packReleaseId'),
        packAdminCapId: outputRef('chain.pack.create', 'packAdminCapId'),
        manifestBlobId: outputRef('walrus.pack.certify', 'quiltBlobId'),
        manifestSha256: outputRef('local.pack.materialize', 'manifestSha256'),
      },
      outputs: [
        'transactionDigest',
        'manifestBound',
        'readbackVerified',
        'manifestBlobId',
        'manifestSha256',
      ],
    }),
  ];
  styles.forEach((style, index) => actions.push(action({
    id: `chain.pack.style.register.${actionKey(`${style.partId}:${style.itemId}:${style.styleId}`)}`,
    stage: EXPANSION_PACK_PUBLICATION_STAGES.STYLES_REGISTERING,
    transport: EXPANSION_PACK_PUBLICATION_TRANSPORTS.SUI,
    target: moveTarget(
      planContext.expansionPackV8CallablePackageId,
      EXPANSION_PACK_V8_MOVE_FUNCTIONS.REGISTER_STYLE,
    ),
    authority: packAuthority,
    inputs: {
      packReleaseId: outputRef('chain.pack.create', 'packReleaseId'),
      packAdminCapId: outputRef('chain.pack.create', 'packAdminCapId'),
      partKey: style.partId,
      itemKey: style.itemId,
      styleKey: style.styleId,
      assetBlobId: outputRef(
        'walrus.pack.certify',
        'filePatchIds',
        [style.assetIdentifier],
      ),
      assetSha256: style.assetSha256,
      assetSealId: outputRef('local.pack.materialize', 'styles', [index, 'assetSealId']),
    },
    outputs: [
      'transactionDigest',
      'styleRegistered',
      'readbackVerified',
      'partKey',
      'itemKey',
      'styleKey',
      'assetBlobId',
      'assetSha256',
      'assetSealId',
    ],
    policy: clone(style),
  })));
  actions.push(action({
    id: 'chain.pack.seal',
    stage: EXPANSION_PACK_PUBLICATION_STAGES.PACK_SEALING,
    transport: EXPANSION_PACK_PUBLICATION_TRANSPORTS.SUI,
    target: moveTarget(
      planContext.expansionPackV8CallablePackageId,
      EXPANSION_PACK_V8_MOVE_FUNCTIONS.SEAL,
    ),
    authority: packAuthority,
    inputs: {
      packReleaseId: outputRef('chain.pack.create', 'packReleaseId'),
      packAdminCapId: outputRef('chain.pack.create', 'packAdminCapId'),
      styleRegistryCommitment: outputRef(
        'walrus.pack.certify',
        'styleRegistryCommitment',
      ),
    },
    outputs: [
      'transactionDigest',
      'sealed',
      'readbackVerified',
      'styleRegistryCommitment',
    ],
  }));
  if (planContext.accessKind === 1) {
    actions.push(action({
      id: 'chain.pack.seal-policy.bind',
      stage: EXPANSION_PACK_PUBLICATION_STAGES.PACK_SEAL_POLICY_BINDING,
      transport: EXPANSION_PACK_PUBLICATION_TRANSPORTS.SUI,
      target: moveTarget(
        planContext.expansionPackV8CallablePackageId,
        EXPANSION_PACK_V8_MOVE_FUNCTIONS.BIND_SEAL_POLICY,
      ),
      authority: packAuthority,
      inputs: {
        packReleaseId: outputRef('chain.pack.create', 'packReleaseId'),
        packAdminCapId: outputRef('chain.pack.create', 'packAdminCapId'),
        contentCommitment: commitments.contentCommitment,
        sealPackageId: contextRef('expansionPackV8TypeOriginPackageId'),
      },
      outputs: [
        'transactionDigest',
        'sealPolicyBound',
        'readbackVerified',
        'sealPolicyId',
        'sealReleaseCommitment',
        'sealPackageId',
      ],
    }));
  }
  actions.push(action({
    id: 'chain.pack.admit',
    stage: EXPANSION_PACK_PUBLICATION_STAGES.PACK_ADMITTING,
    transport: EXPANSION_PACK_PUBLICATION_TRANSPORTS.SUI,
    target: moveTarget(
      planContext.expansionPackV8CallablePackageId,
      EXPANSION_PACK_V8_MOVE_FUNCTIONS.ADMIT,
    ),
    authority,
    inputs: {
      packReleaseId: outputRef('chain.pack.create', 'packReleaseId'),
      baseMakerRootId: contextRef('baseMakerRootId'),
      parentLegacyMakerId: contextRef('parentLegacyMakerId'),
      independentExtensionAuthorityV5Id:
        contextRef('independentExtensionAuthorityV5Id'),
      parentVersion: contextRef('parentVersion'),
      parentManifestBlobId: contextRef('parentManifestBlobId'),
      parentManifestSha256: contextRef('parentManifestSha256'),
      parentOwnershipEpoch: outputRef('parent.release.verify', 'parentOwnershipEpoch'),
    },
    outputs: [
      'transactionDigest',
      'admitted',
      'parentBindingVerified',
      'readbackVerified',
      'baseMakerRootId',
      'parentLegacyMakerId',
      'parentVersion',
      'parentManifestBlobId',
      'parentManifestSha256',
      'parentOwnershipEpoch',
      'admittedParentOwnershipEpoch',
    ],
  }));
  actions.push(action({
    id: 'chain.pack.activate',
    stage: EXPANSION_PACK_PUBLICATION_STAGES.PACK_ACTIVATING,
    transport: EXPANSION_PACK_PUBLICATION_TRANSPORTS.SUI,
    target: moveTarget(
      planContext.expansionPackV8CallablePackageId,
      EXPANSION_PACK_V8_MOVE_FUNCTIONS.ACTIVATE,
    ),
    authority: packAuthority,
    inputs: {
      packReleaseId: outputRef('chain.pack.create', 'packReleaseId'),
      packAdminCapId: outputRef('chain.pack.create', 'packAdminCapId'),
      baseMakerRootId: contextRef('baseMakerRootId'),
      commerceProtocolConfigV5Id: contextRef('commerceProtocolConfigV5Id'),
    },
    outputs: ['transactionDigest', 'readbackVerified', 'lifecycleState'],
  }));
  const binding = {
    candidateCommitment: commitments.candidateCommitment,
    contentCommitment: commitments.contentCommitment,
    manifestSha256: commitments.manifestSha256,
    parentIdentity: planContext.parentIdentity,
    parentLegacyMakerId: planContext.parentLegacyMakerId,
    baseMakerRootId: planContext.baseMakerRootId,
    packId: planContext.packId,
    packNamespace: planContext.packNamespace,
    packVersion: planContext.packVersion,
    expansionPackV8TypeOriginPackageId: planContext.expansionPackV8TypeOriginPackageId,
    independentExtensionAuthorityV5Id:
      planContext.independentExtensionAuthorityV5Id,
    independentExtensionV5TypeOriginPackageId:
      planContext.independentExtensionV5TypeOriginPackageId,
  };
  const bindingIdentity = await hashExpansionPackContent(stableJson(binding));
  const draft = {
    schema: EXPANSION_PACK_PUBLICATION_PLAN_SCHEMA,
    version: 5,
    binding,
    bindingIdentity,
    context: planContext,
    candidate: {
      schemaVersion: candidate.schemaVersion,
      candidateCommitment: commitments.candidateCommitment,
      contentCommitment: commitments.contentCommitment,
      manifestIdentifier: EXPANSION_PACK_MANIFEST_IDENTIFIER,
      manifestSha256: commitments.manifestSha256,
      files: clone(candidate.files),
    },
    styles,
    actions,
  };
  return freeze({ ...draft, planIdentity: await hashExpansionPackContent(stableJson(draft)) });
}

export async function createExpansionPackPublicationRecovery({ plan, nonce, createdAt } = {}) {
  if (plan?.schema !== EXPANSION_PACK_PUBLICATION_PLAN_SCHEMA || plan?.version !== 5) {
    fail('EXPANSION_PACK_PUBLICATION_PLAN_INVALID', 'A supported immutable Pack publication plan is required.');
  }
  const exactNonce = required(nonce, 'Publication recovery nonce');
  if (!NONCE.test(exactNonce)) {
    fail(
      'EXPANSION_PACK_PUBLICATION_NONCE_INVALID',
      'Publication recovery nonce must contain 16-256 safe characters.',
    );
  }
  const recoveryIdentity = await hashExpansionPackContent(stableJson({
    nonce: exactNonce,
    bindingIdentity: plan.bindingIdentity,
    planIdentity: plan.planIdentity,
  }));
  const now = timestamp(createdAt);
  return freeze({
    schema: EXPANSION_PACK_PUBLICATION_RECOVERY_SCHEMA,
    version: 5,
    sequence: 0,
    nonce: exactNonce,
    recoveryIdentity,
    binding: clone(plan.binding),
    bindingIdentity: plan.bindingIdentity,
    planIdentity: plan.planIdentity,
    stage: EXPANSION_PACK_PUBLICATION_STAGES.PARENT_VERIFYING,
    currentActionIndex: 0,
    actions: plan.actions.map((entry) => ({
      id: entry.id,
      status: EXPANSION_PACK_PUBLICATION_ACTION_STATUS.PENDING,
      intentKey: '',
      progress: null,
      submission: null,
      confirmation: null,
      outputs: null,
    })),
    completed: false,
    finalizedFailures: [],
    lastError: null,
    createdAt: now,
    updatedAt: now,
  });
}

function assertActionEntry(entry, planned, index, cursor) {
  if (
    entry?.id !== planned?.id
    || !Object.values(EXPANSION_PACK_PUBLICATION_ACTION_STATUS).includes(entry?.status)
  ) {
    fail(
      'EXPANSION_PACK_PUBLICATION_RECOVERY_INVALID',
      'The Pack publication recovery action list changed.',
      { index },
    );
  }
  if (index < cursor && entry.status !== EXPANSION_PACK_PUBLICATION_ACTION_STATUS.CONFIRMED) {
    fail(
      'EXPANSION_PACK_PUBLICATION_RECOVERY_INVALID',
      'A prior Pack publication action is not confirmed.',
      { index },
    );
  }
  if (index > cursor && entry.status !== EXPANSION_PACK_PUBLICATION_ACTION_STATUS.PENDING) {
    fail(
      'EXPANSION_PACK_PUBLICATION_RECOVERY_INVALID',
      'A future Pack publication action was mutated out of order.',
      { index },
    );
  }
  if (entry.status === EXPANSION_PACK_PUBLICATION_ACTION_STATUS.PENDING) {
    if (entry.intentKey || entry.submission || entry.confirmation || entry.outputs || entry.progress) {
      fail(
        'EXPANSION_PACK_PUBLICATION_RECOVERY_INVALID',
        'A pending Pack publication action contains execution state.',
        { index },
      );
    }
  } else if (!text(entry.intentKey)) {
    fail(
      'EXPANSION_PACK_PUBLICATION_RECOVERY_INVALID',
      'A started Pack publication action is missing its intent identity.',
      { index },
    );
  }
  if (
    [
      EXPANSION_PACK_PUBLICATION_ACTION_STATUS.SUBMITTED,
      EXPANSION_PACK_PUBLICATION_ACTION_STATUS.CONFIRMED,
    ].includes(entry.status)
    && (!entry.submission || typeof entry.submission !== 'object')
  ) {
    fail(
      'EXPANSION_PACK_PUBLICATION_RECOVERY_INVALID',
      'A submitted Pack publication action is missing its durable submission.',
      { index },
    );
  }
  if (
    entry.status === EXPANSION_PACK_PUBLICATION_ACTION_STATUS.CONFIRMED
    && (!entry.confirmation || !entry.outputs)
  ) {
    fail(
      'EXPANSION_PACK_PUBLICATION_RECOVERY_INVALID',
      'A confirmed Pack publication action is missing its readback.',
      { index },
    );
  }
  return clone(entry);
}

function normalizedFinalizedFailure(value, plan) {
  const failure = object(value);
  const actionId = required(failure.actionId, 'Finalized failure action');
  const plannedAction = plan.actions.find((entry) => entry.id === actionId);
  if (!plannedAction) {
    fail(
      'EXPANSION_PACK_PUBLICATION_FINALIZED_FAILURE_INVALID',
      'A finalized failure references an unknown Pack publication action.',
      { actionId },
    );
  }
  if (plannedAction.transport !== EXPANSION_PACK_PUBLICATION_TRANSPORTS.SUI) {
    fail(
      'EXPANSION_PACK_PUBLICATION_FINALIZED_FAILURE_INVALID',
      'Only a Sui publication action can archive finalized transaction evidence.',
      { actionId, transport: plannedAction.transport },
    );
  }
  const transactionDigest = required(
    failure.transactionDigest,
    'Finalized failure transaction digest',
  );
  if (failure.finalized !== true || failure.executionStatus !== 'FAILURE') {
    fail(
      'EXPANSION_PACK_PUBLICATION_FINALIZED_FAILURE_INVALID',
      'A finalized failure must contain definitive failed execution evidence.',
      { actionId, transactionDigest },
    );
  }
  const executionError = object(failure.executionError);
  const command = executionError.command == null ? null : Number(executionError.command);
  if (command !== null && (!Number.isSafeInteger(command) || command < 0)) {
    fail(
      'EXPANSION_PACK_PUBLICATION_FINALIZED_FAILURE_INVALID',
      'A finalized failure contains an invalid command index.',
      { actionId, transactionDigest },
    );
  }
  return {
    actionId,
    transactionDigest,
    finalized: true,
    executionStatus: 'FAILURE',
    executionError: {
      kind: text(executionError.kind) || 'Unknown',
      message: text(executionError.message) || 'The Sui transaction failed.',
      command,
      abortCode: text(executionError.abortCode),
    },
    recordedAt: timestamp(required(failure.recordedAt, 'Finalized failure timestamp')),
  };
}

function finalizedFailureIdentity(value) {
  return `${value.actionId}:${value.transactionDigest}`;
}

function finalizedFailureEvidence(value) {
  return stableJson({
    actionId: value.actionId,
    transactionDigest: value.transactionDigest,
    finalized: value.finalized,
    executionStatus: value.executionStatus,
    executionError: value.executionError,
  });
}

export async function hydrateExpansionPackPublicationRecovery(value, { plan } = {}) {
  if (
    value?.schema !== EXPANSION_PACK_PUBLICATION_RECOVERY_SCHEMA
    || value?.version !== 5
    || plan?.schema !== EXPANSION_PACK_PUBLICATION_PLAN_SCHEMA
    || plan?.version !== 5
    || stableJson(value.binding) !== stableJson(plan.binding)
    || value.bindingIdentity !== plan.bindingIdentity
    || value.planIdentity !== plan.planIdentity
  ) {
    fail(
      'EXPANSION_PACK_PUBLICATION_RECOVERY_SCOPE_MISMATCH',
      'The Pack publication recovery belongs to another immutable release.',
    );
  }
  const nonce = text(value.nonce);
  const recoveryIdentity = await hashExpansionPackContent(stableJson({
    nonce,
    bindingIdentity: plan.bindingIdentity,
    planIdentity: plan.planIdentity,
  }));
  if (!NONCE.test(nonce) || recoveryIdentity !== value.recoveryIdentity) {
    fail(
      'EXPANSION_PACK_PUBLICATION_RECOVERY_NONCE_MISMATCH',
      'The Pack publication recovery identity is invalid.',
    );
  }
  const cursor = Number(value.currentActionIndex);
  const sequence = Number(value.sequence);
  if (
    !Number.isSafeInteger(cursor)
    || cursor < 0
    || cursor > plan.actions.length
    || !Number.isSafeInteger(sequence)
    || sequence < 0
    || array(value.actions).length !== plan.actions.length
  ) {
    fail('EXPANSION_PACK_PUBLICATION_RECOVERY_INVALID', 'The Pack publication recovery cursor is invalid.');
  }
  const actions = value.actions.map((entry, index) => (
    assertActionEntry(entry, plan.actions[index], index, cursor)
  ));
  const finalizedFailures = array(value.finalizedFailures).map((entry) => (
    normalizedFinalizedFailure(entry, plan)
  ));
  const finalizedFailureKeys = new Map();
  const finalizedFailureDigests = new Map();
  finalizedFailures.forEach((entry) => {
    const identity = finalizedFailureIdentity(entry);
    const evidence = finalizedFailureEvidence(entry);
    if (finalizedFailureKeys.has(identity)) {
      fail(
        'EXPANSION_PACK_PUBLICATION_FINALIZED_FAILURE_DUPLICATE',
        'A finalized Pack publication failure was archived more than once.',
        { identity },
      );
    }
    finalizedFailureKeys.set(identity, evidence);
    const existingAction = finalizedFailureDigests.get(entry.transactionDigest);
    if (existingAction) {
      fail(
        'EXPANSION_PACK_PUBLICATION_FINALIZED_FAILURE_DIGEST_REUSED',
        'One finalized Sui digest cannot be archived under more than one Pack action.',
        { transactionDigest: entry.transactionDigest, actionId: entry.actionId, existingAction },
      );
    }
    finalizedFailureDigests.set(entry.transactionDigest, entry.actionId);
  });
  const completed = cursor === plan.actions.length;
  if (Boolean(value.completed) !== completed) {
    fail(
      'EXPANSION_PACK_PUBLICATION_RECOVERY_INVALID',
      'The Pack publication completion flag does not match its cursor.',
    );
  }
  const expectedStage = completed
    ? EXPANSION_PACK_PUBLICATION_STAGES.COMPLETE
    : plan.actions[cursor].stage;
  if (value.stage !== expectedStage) {
    fail(
      'EXPANSION_PACK_PUBLICATION_RECOVERY_INVALID',
      'The Pack publication stage does not match its current action.',
    );
  }
  return freeze({
    ...clone(value),
    actions,
    finalizedFailures,
    sequence,
    currentActionIndex: cursor,
    completed,
  });
}

function assertRuntime(runtimeValue, plan) {
  const runtime = object(runtimeValue);
  if (runtime.expansionPackV8ReleaseEnabled !== true) {
    fail(
      'EXPANSION_PACK_V8_RELEASE_DISABLED',
      'Expansion Pack v8 publication is disabled.',
    );
  }
  if (runtime.network !== 'mainnet') {
    fail(
      'EXPANSION_PACK_PUBLICATION_NETWORK_MISMATCH',
      'Production Expansion Pack publication is Mainnet-only.',
    );
  }
  const fields = [
    'commerceV5CallablePackageId',
    'expansionPackV8CallablePackageId',
    'expansionPackV8TypeOriginPackageId',
    'independentExtensionV5TypeOriginPackageId',
    'commerceProtocolConfigV5Id',
    'paymentCoinType',
  ];
  const runtimeScope = {
    ...runtime,
    commerceV5CallablePackageId:
      runtime.commerceV5CallablePackageId || runtime.callablePackageId,
    expansionPackV8CallablePackageId:
      runtime.expansionPackV8CallablePackageId || runtime.expansionPackV8PackageId,
  };
  const mismatch = fields.filter((field) => (
    text(runtimeScope[field]).toLowerCase() !== text(plan.context?.[field]).toLowerCase()
  ));
  if (mismatch.length) {
    fail(
      'EXPANSION_PACK_PUBLICATION_RUNTIME_SCOPE_MISMATCH',
      'The runtime does not match this immutable Pack publication plan.',
      { fields: mismatch },
    );
  }
}

function resolve(value, recovery, plan) {
  if (Array.isArray(value)) return value.map((entry) => resolve(entry, recovery, plan));
  if (!value || typeof value !== 'object') return value;
  if (value.$context) return plan.context[value.$context];
  if (value.$output) {
    const entry = recovery.actions.find((candidate) => candidate.id === value.$output.actionId);
    if (entry?.status !== EXPANSION_PACK_PUBLICATION_ACTION_STATUS.CONFIRMED) {
      fail(
        'EXPANSION_PACK_PUBLICATION_OUTPUT_UNCONFIRMED',
        'A Pack publication action references an unconfirmed output.',
        value.$output,
      );
    }
    const result = entry.outputs?.[value.$output.field] ?? entry.confirmation?.[value.$output.field];
    const resolvedResult = array(value.$output.path).reduce((current, key) => (
      current == null ? undefined : current[key]
    ), result);
    const outputLeaf = array(value.$output.path).at(-1);
    const allowEmpty = ['assetSealId', 'sealReleaseCommitment'].includes(
      String(outputLeaf || value.$output.field || ''),
    );
    if (
      resolvedResult === undefined
      || resolvedResult === null
      || (resolvedResult === '' && !allowEmpty)
    ) {
      fail(
        'EXPANSION_PACK_PUBLICATION_OUTPUT_MISSING',
        'A confirmed Pack publication output is missing.',
        value.$output,
      );
    }
    return resolvedResult;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, resolve(entry, recovery, plan)]),
  );
}

export async function nextExpansionPackPublicationAction({ recovery, plan, runtime } = {}) {
  const hydrated = await hydrateExpansionPackPublicationRecovery(recovery, { plan });
  assertRuntime(runtime, plan);
  if (hydrated.completed) return null;
  const planned = plan.actions[hydrated.currentActionIndex];
  return freeze({
    ...clone(planned),
    authority: resolve(planned.authority, hydrated, plan),
    typeArguments: resolve(planned.typeArguments, hydrated, plan),
    inputs: resolve(planned.inputs, hydrated, plan),
  });
}

function mutate(recovery, patch, currentPatch = null) {
  const actions = recovery.actions.map((entry, index) => (
    index === recovery.currentActionIndex && currentPatch
      ? { ...clone(entry), ...clone(currentPatch) }
      : clone(entry)
  ));
  return {
    ...clone(recovery),
    ...clone(patch),
    actions,
    sequence: Number(recovery.sequence || 0) + 1,
    updatedAt: timestamp(),
  };
}

export async function beginExpansionPackPublicationAction({ recovery, plan, runtime } = {}) {
  const hydrated = await hydrateExpansionPackPublicationRecovery(recovery, { plan });
  const planned = await nextExpansionPackPublicationAction({ recovery: hydrated, plan, runtime });
  const current = hydrated.actions[hydrated.currentActionIndex];
  if (current.status !== EXPANSION_PACK_PUBLICATION_ACTION_STATUS.PENDING) return hydrated;
  const intentKey = await hashExpansionPackContent(stableJson({
    recoveryIdentity: hydrated.recoveryIdentity,
    actionId: planned.id,
    sequence: hydrated.sequence,
  }));
  return freeze(mutate(
    hydrated,
    { stage: planned.stage, lastError: null },
    { status: EXPANSION_PACK_PUBLICATION_ACTION_STATUS.INTENT, intentKey },
  ));
}

export async function recordExpansionPackPublicationProgress({
  recovery,
  plan,
  actionId,
  progress,
} = {}) {
  const hydrated = await hydrateExpansionPackPublicationRecovery(recovery, { plan });
  const current = hydrated.actions[hydrated.currentActionIndex];
  if (
    current?.id !== actionId
    || ![
      EXPANSION_PACK_PUBLICATION_ACTION_STATUS.INTENT,
      EXPANSION_PACK_PUBLICATION_ACTION_STATUS.SUBMITTED,
    ].includes(current.status)
  ) {
    fail(
      'EXPANSION_PACK_PUBLICATION_PROGRESS_OUT_OF_ORDER',
      'Pack publication progress is out of order.',
    );
  }
  if (!progress || typeof progress !== 'object' || Array.isArray(progress)) {
    fail(
      'EXPANSION_PACK_PUBLICATION_PROGRESS_INVALID',
      'Pack publication progress must be a serializable object.',
    );
  }
  return freeze(mutate(hydrated, {}, { progress: clone(progress) }));
}

export async function markExpansionPackPublicationSubmitted({
  recovery,
  plan,
  actionId,
  submission,
} = {}) {
  const hydrated = await hydrateExpansionPackPublicationRecovery(recovery, { plan });
  const current = hydrated.actions[hydrated.currentActionIndex];
  if (
    current?.id !== actionId
    || current.status !== EXPANSION_PACK_PUBLICATION_ACTION_STATUS.INTENT
  ) {
    fail(
      'EXPANSION_PACK_PUBLICATION_SUBMISSION_OUT_OF_ORDER',
      'Pack publication submission is out of order.',
    );
  }
  if (!submission || typeof submission !== 'object' || Array.isArray(submission)) {
    fail(
      'EXPANSION_PACK_PUBLICATION_SUBMISSION_INVALID',
      'Pack publication submission must be a durable object.',
    );
  }
  return freeze(mutate(hydrated, {}, {
    status: EXPANSION_PACK_PUBLICATION_ACTION_STATUS.SUBMITTED,
    submission: clone(submission),
  }));
}

function assertEqual(actual, expected, code, message, details = {}) {
  if (String(actual ?? '').toLowerCase() !== String(expected ?? '').toLowerCase()) {
    fail(code, message, { ...details, expected, actual });
  }
}

function assertTrue(value, code, message) {
  if (value !== true) fail(code, message);
}

async function validateConfirmation(actionValue, confirmation) {
  const actionId = actionValue.id;
  if (actionId === 'parent.release.verify') {
    assertTrue(
      confirmation.parentVerified,
      'EXPANSION_PACK_PARENT_READBACK_FAILED',
      'The exact parent Maker release was not verified.',
    );
    assertTrue(
      confirmation.independentExtensionAuthorityVerified,
      'EXPANSION_PACK_PARENT_AUTHORITY_FAILED',
      'The irreversible independent-extension authority was not verified.',
    );
    if (confirmation.parentReleaseEvidenceBound !== true) {
      fail(
        'EXPANSION_PACK_PARENT_EVIDENCE_READBACK_INVALID',
        'Parent verification did not prove the exact Root-owned release evidence.',
      );
    }
    assertEqual(
      confirmation.parentLifecycleState,
      'PAUSED',
      'EXPANSION_PACK_PARENT_INACTIVE',
      'The parent Maker must be Paused before independent Pack publication.',
    );
    u64(confirmation.parentOwnershipEpoch, 'Parent ownership epoch');
    ['baseMakerRootId', 'parentLegacyMakerId', 'parentVersion', 'parentManifestBlobId', 'parentManifestSha256']
      .forEach((field) => assertEqual(
        confirmation[field],
        actionValue.inputs[field],
        'EXPANSION_PACK_PARENT_READBACK_MISMATCH',
        `Parent readback field ${field} does not match the immutable Pack binding.`,
        { field },
      ));
  } else if (actionId === 'local.pack.materialize') {
    assertEqual(
      confirmation.packReleaseId,
      actionValue.inputs.packReleaseId,
      'EXPANSION_PACK_LOCAL_RELEASE_MISMATCH',
      'The local materialization belongs to another Pack Release.',
    );
    assertEqual(
      confirmation.contentCommitment,
      actionValue.inputs.contentCommitment,
      'EXPANSION_PACK_LOCAL_COMMITMENT_MISMATCH',
      'The local materialization changed the semantic Pack commitment.',
    );
    const candidate = assertCandidate(confirmation.candidate);
    const commitments = await verifyCandidateCommitments(candidate);
    ['candidateCommitment', 'contentCommitment', 'manifestSha256']
      .forEach((field) => assertEqual(
        confirmation[field],
        commitments[field],
        'EXPANSION_PACK_LOCAL_CANDIDATE_MISMATCH',
        `The local materialization field ${field} does not match its candidate.`,
      ));
    if (confirmation.manifestJson !== candidate.manifestJson
      || stableJson(confirmation.files) !== stableJson(candidate.files)) {
      fail(
        'EXPANSION_PACK_LOCAL_CANDIDATE_MISMATCH',
        'The local materialization manifest/files do not match its candidate.',
      );
    }
    const paid = Number(actionValue.inputs.accessKind) === 1;
    if (paid) {
      assertEqual(
        candidate.transportSource?.candidateCommitment,
        actionValue.inputs.sourceCandidateCommitment,
        'EXPANSION_PACK_LOCAL_SOURCE_MISMATCH',
        'The protected candidate belongs to another source snapshot.',
      );
      assertEqual(
        candidate.transportSource?.manifestSha256,
        actionValue.inputs.sourceManifestSha256,
        'EXPANSION_PACK_LOCAL_SOURCE_MISMATCH',
        'The protected candidate belongs to another source manifest.',
      );
    } else {
      assertEqual(
        confirmation.candidateCommitment,
        actionValue.inputs.sourceCandidateCommitment,
        'EXPANSION_PACK_LOCAL_SOURCE_MISMATCH',
        'Free materialization changed the source candidate.',
      );
      assertEqual(
        confirmation.manifestSha256,
        actionValue.inputs.sourceManifestSha256,
        'EXPANSION_PACK_LOCAL_SOURCE_MISMATCH',
        'Free materialization changed the source manifest.',
      );
    }
    const expectedSealReleaseCommitment = paid
      ? (await deriveExpansionPackSealReleaseCommitmentV8({
          releaseId: actionValue.inputs.packReleaseId,
          contentCommitment: actionValue.inputs.contentCommitment,
        })).id.replace(/^0x/i, '').toLowerCase()
      : '';
    assertEqual(
      confirmation.sealReleaseCommitment,
      expectedSealReleaseCommitment,
      'EXPANSION_PACK_LOCAL_RELEASE_MISMATCH',
      'The local Seal commitment does not bind the exact Pack Release object.',
    );
    const expectedStyles = array(actionValue.inputs.styles);
    const observedStyles = array(confirmation.styles);
    if (expectedStyles.length !== observedStyles.length) {
      fail(
        'EXPANSION_PACK_LOCAL_STYLE_MISMATCH',
        'The local materialization changed the Pack Style set.',
      );
    }
    for (let index = 0; index < expectedStyles.length; index += 1) {
      const expected = expectedStyles[index];
      const observed = object(observedStyles[index]);
      ['partKey', 'itemKey', 'styleKey', 'assetIdentifier', 'assetSha256']
        .forEach((field) => assertEqual(
          observed[field],
          expected[field],
          'EXPANSION_PACK_LOCAL_STYLE_MISMATCH',
          `The local materialized Style field ${field} changed.`,
        ));
      if (paid) {
        const expectedSealId = (await deriveMakerSealIdV5({
          releaseCommitment: expectedSealReleaseCommitment,
          productKind: MAKER_SEAL_PRODUCT_PACK,
          partKey: expected.partKey,
          itemKey: expected.itemKey,
          styleKey: expected.styleKey,
          packKey: candidate.manifest?.pack?.id,
          assetDigest: expected.assetSha256,
        })).id.replace(/^0x/i, '').toLowerCase();
        assertEqual(
          observed.assetSealId,
          expectedSealId,
          'EXPANSION_PACK_LOCAL_STYLE_MISMATCH',
          'A materialized Style Seal ID is not scoped to the exact Pack Release.',
        );
      } else if (text(observed.assetSealId)) {
        fail(
          'EXPANSION_PACK_LOCAL_STYLE_MISMATCH',
          'A free Pack Style cannot acquire a Seal ID during materialization.',
        );
      }
    }
    if (paid !== (confirmation.transportProtected === true)) {
      fail(
        'EXPANSION_PACK_LOCAL_TRANSPORT_MISMATCH',
        'Local Seal materialization does not match the Pack access mode.',
      );
    }
  } else if (actionId === 'walrus.pack.prepare') {
    assertEqual(
      confirmation.walrusRecovery?.stage,
      'encoded',
      'EXPANSION_PACK_WALRUS_PREPARE_INVALID',
      'Walrus prepare must persist an encoded recovery checkpoint.',
    );
    assertEqual(
      confirmation.walrusRecovery?.uploadSessionId,
      confirmation.uploadSessionId,
      'EXPANSION_PACK_WALRUS_SESSION_MISMATCH',
      'Walrus recovery belongs to another upload session.',
    );
    assertEqual(
      confirmation.walrusRecovery?.quiltBlobId,
      confirmation.quiltBlobId,
      'EXPANSION_PACK_WALRUS_BLOB_MISMATCH',
      'Walrus recovery belongs to another Quilt Blob.',
    );
  } else if (actionId === 'walrus.pack.register-upload') {
    assertTrue(
      confirmation.uploaded,
      'EXPANSION_PACK_WALRUS_UPLOAD_INCOMPLETE',
      'Walrus registration did not reach the uploaded checkpoint.',
    );
    ['uploadSessionId', 'quiltBlobId'].forEach((field) => assertEqual(
      confirmation[field],
      actionValue.inputs[field],
      'EXPANSION_PACK_WALRUS_UPLOAD_SCOPE_MISMATCH',
      `Walrus upload field ${field} changed between recovery steps.`,
      { field },
    ));
    assertEqual(
      confirmation.walrusRecovery?.stage,
      'uploaded',
      'EXPANSION_PACK_WALRUS_UPLOAD_INCOMPLETE',
      'Walrus upload must persist the uploaded recovery checkpoint.',
    );
  } else if (actionId === 'walrus.pack.certify') {
    assertTrue(
      confirmation.certified,
      'EXPANSION_PACK_WALRUS_CERTIFICATION_FAILED',
      'Walrus certification is not confirmed.',
    );
    assertTrue(
      confirmation.certificationVisible,
      'EXPANSION_PACK_WALRUS_CERTIFICATION_NOT_VISIBLE',
      'The certified Walrus Blob object is not visible yet.',
    );
    ['uploadSessionId', 'quiltBlobId', 'blobObjectId', 'manifestIdentifier', 'manifestSha256']
      .forEach((field) => assertEqual(
        confirmation[field],
        actionValue.inputs[field],
        'EXPANSION_PACK_WALRUS_CERTIFICATION_SCOPE_MISMATCH',
        `Walrus certification field ${field} does not match the immutable upload.`,
        { field },
      ));
    assertEqual(
      confirmation.walrusRecovery?.stage,
      'certified',
      'EXPANSION_PACK_WALRUS_CERTIFICATION_FAILED',
      'Walrus certification must persist the certified recovery checkpoint.',
    );
    const filePatchIds = object(confirmation.filePatchIds);
    assertEqual(
      confirmation.manifestQuiltPatchId,
      filePatchIds[actionValue.inputs.manifestIdentifier],
      'EXPANSION_PACK_WALRUS_MANIFEST_PATCH_MISMATCH',
      'The certified manifest Quilt patch does not match its identifier.',
    );
    const registryRows = actionValue.inputs.styles.map((style) => {
      const assetBlobId = required(
        filePatchIds[style.assetIdentifier],
        `Certified Pack asset ${style.assetIdentifier} Quilt patch`,
      );
      return {
        partKey: style.partKey,
        itemKey: style.itemKey,
        styleKey: style.styleKey,
        assetBlobId,
        assetSha256: style.assetSha256,
        assetSealId: style.assetSealId,
      };
    });
    const registryCommitment = await hashExpansionPackContent(stableJson(registryRows));
    assertEqual(
      confirmation.styleRegistryCommitment,
      registryCommitment,
      'EXPANSION_PACK_STYLE_REGISTRY_COMMITMENT_MISMATCH',
      'The Style registry commitment does not match the exact certified asset patches.',
    );
  } else if (actionId === 'chain.pack.create') {
    assertTrue(
      confirmation.readbackVerified,
      'EXPANSION_PACK_CHAIN_READBACK_FAILED',
      'The Pack release object and event were not verified after submission.',
    );
    if (confirmation.manifestBound !== false) {
      fail(
        'EXPANSION_PACK_CHAIN_MANIFEST_BINDING_FAILED',
        'A newly created Pack shell must not bind a manifest before Seal materialization.',
      );
    }
    assertEqual(
      confirmation.lifecycleState,
      'DRAFT',
      'EXPANSION_PACK_CHAIN_LIFECYCLE_INVALID',
      'A newly created Pack release must read back as Draft.',
    );
    exactId(confirmation.packReleaseId, 'Expansion Pack release object');
    exactId(confirmation.packAdminCapId, 'Expansion Pack AdminCap');
    exactId(confirmation.packTreasuryId, 'Expansion Pack Treasury');
    required(confirmation.transactionDigest, 'Expansion Pack transaction digest');
    assertEqual(
      confirmation.creator,
      actionValue.authority.signer,
      'EXPANSION_PACK_CHAIN_CREATOR_MISMATCH',
      'The Pack release creator does not match the signing wallet.',
    );
    [
      'baseMakerRootId',
      'parentLegacyMakerId',
      'parentVersion',
      'parentManifestBlobId',
      'parentManifestSha256',
      'packId',
      'packVersion',
      'contentCommitment',
      'accessKind',
      'purchasePriceAtomic',
    ].forEach((field) => assertEqual(
      confirmation[field],
      actionValue.inputs[field],
      'EXPANSION_PACK_CHAIN_CREATE_READBACK_MISMATCH',
      `Created Pack field ${field} does not match the immutable publication plan.`,
      { field },
    ));
  } else if (actionId === 'chain.pack.manifest.bind') {
    assertTrue(
      confirmation.manifestBound,
      'EXPANSION_PACK_CHAIN_MANIFEST_BINDING_FAILED',
      'The Pack release did not bind its certified Walrus manifest.',
    );
    assertTrue(
      confirmation.readbackVerified,
      'EXPANSION_PACK_CHAIN_MANIFEST_BINDING_FAILED',
      'The exact Pack manifest binding was not verified after submission.',
    );
    required(confirmation.transactionDigest, 'Pack manifest binding transaction digest');
    ['manifestBlobId', 'manifestSha256'].forEach((field) => assertEqual(
      confirmation[field],
      actionValue.inputs[field],
      'EXPANSION_PACK_CHAIN_MANIFEST_BINDING_MISMATCH',
      `Pack manifest binding field ${field} does not match the certified Quilt.`,
      { field },
    ));
  } else if (actionId.startsWith('chain.pack.style.register.')) {
    assertTrue(
      confirmation.styleRegistered,
      'EXPANSION_PACK_CHAIN_STYLE_READBACK_FAILED',
      'The exact Pack Style asset was not registered.',
    );
    assertTrue(
      confirmation.readbackVerified,
      'EXPANSION_PACK_CHAIN_STYLE_READBACK_FAILED',
      'The exact Pack Style registration was not verified.',
    );
    required(confirmation.transactionDigest, 'Pack Style transaction digest');
    ['partKey', 'itemKey', 'styleKey', 'assetBlobId', 'assetSha256', 'assetSealId']
      .forEach((field) => assertEqual(
        confirmation[field],
        actionValue.inputs[field],
        'EXPANSION_PACK_CHAIN_STYLE_READBACK_MISMATCH',
        `Registered Pack Style field ${field} does not match the immutable plan.`,
        { field },
      ));
  } else if (actionId === 'chain.pack.seal') {
    assertTrue(
      confirmation.sealed,
      'EXPANSION_PACK_CHAIN_SEAL_FAILED',
      'The Pack content registry was not sealed.',
    );
    assertTrue(
      confirmation.readbackVerified,
      'EXPANSION_PACK_CHAIN_SEAL_READBACK_FAILED',
      'The sealed Pack content was not verified.',
    );
    required(confirmation.transactionDigest, 'Pack seal transaction digest');
    assertEqual(
      confirmation.styleRegistryCommitment,
      actionValue.inputs.styleRegistryCommitment,
      'EXPANSION_PACK_CHAIN_SEAL_COMMITMENT_MISMATCH',
      'The sealed Style registry commitment does not match the certified Pack assets.',
    );
  } else if (actionId === 'chain.pack.seal-policy.bind') {
    assertTrue(
      confirmation.sealPolicyBound,
      'EXPANSION_PACK_CHAIN_SEAL_POLICY_FAILED',
      'The paid Pack Seal policy was not bound.',
    );
    assertTrue(
      confirmation.readbackVerified,
      'EXPANSION_PACK_CHAIN_SEAL_POLICY_READBACK_FAILED',
      'The paid Pack Seal policy binding was not verified.',
    );
    assertEqual(
      confirmation.sealPolicyId,
      actionValue.inputs.packReleaseId,
      'EXPANSION_PACK_CHAIN_SEAL_POLICY_MISMATCH',
      'The paid Pack Seal policy is not the exact Release object.',
    );
    if (!sameId(confirmation.sealPackageId, actionValue.inputs.sealPackageId)) {
      fail(
        'EXPANSION_PACK_CHAIN_SEAL_POLICY_MISMATCH',
        'The paid Pack Seal policy is not pinned to the immutable v8 TypeOrigin package.',
        {
          expected: actionValue.inputs.sealPackageId,
          actual: confirmation.sealPackageId,
        },
      );
    }
    const expectedSealReleaseCommitment = (
      await deriveExpansionPackSealReleaseCommitmentV8({
        releaseId: actionValue.inputs.packReleaseId,
        contentCommitment: actionValue.inputs.contentCommitment,
      })
    ).id.replace(/^0x/i, '').toLowerCase();
    assertEqual(
      confirmation.sealReleaseCommitment,
      expectedSealReleaseCommitment,
      'EXPANSION_PACK_CHAIN_SEAL_POLICY_MISMATCH',
      'The paid Pack Seal policy commitment is not scoped to the exact Release object.',
    );
    required(confirmation.transactionDigest, 'Pack Seal policy transaction digest');
  } else if (actionId === 'chain.pack.admit') {
    assertTrue(
      confirmation.admitted,
      'EXPANSION_PACK_CHAIN_ADMISSION_FAILED',
      'The Pack was not admitted by the exact parent Maker.',
    );
    assertTrue(
      confirmation.parentBindingVerified,
      'EXPANSION_PACK_CHAIN_PARENT_BINDING_FAILED',
      'The Pack admission does not bind the exact parent release.',
    );
    assertTrue(
      confirmation.readbackVerified,
      'EXPANSION_PACK_CHAIN_ADMISSION_READBACK_FAILED',
      'The Pack admission event and object were not verified.',
    );
    required(confirmation.transactionDigest, 'Pack admission transaction digest');
    const expectedParentOwnershipEpoch = u64(
      actionValue.inputs.parentOwnershipEpoch,
      'Expected parent ownership epoch',
    );
    const parentOwnershipEpoch = u64(
      confirmation.parentOwnershipEpoch,
      'Confirmed parent ownership epoch',
    );
    const admittedParentOwnershipEpoch = u64(
      confirmation.admittedParentOwnershipEpoch,
      'Confirmed admitted parent ownership epoch',
    );
    if (parentOwnershipEpoch !== expectedParentOwnershipEpoch
      || admittedParentOwnershipEpoch !== expectedParentOwnershipEpoch) {
      fail(
        'EXPANSION_PACK_CHAIN_ADMISSION_EPOCH_MISMATCH',
        'Pack admission must bind the exact verified parent ownership epoch.',
        {
          expected: expectedParentOwnershipEpoch,
          parent: parentOwnershipEpoch,
          admitted: admittedParentOwnershipEpoch,
        },
      );
    }
    [
      'baseMakerRootId',
      'parentLegacyMakerId',
      'parentVersion',
      'parentManifestBlobId',
      'parentManifestSha256',
    ].forEach((field) => assertEqual(
      confirmation[field],
      actionValue.inputs[field],
      'EXPANSION_PACK_CHAIN_ADMISSION_MISMATCH',
      `Pack admission field ${field} does not match the exact parent.`,
      { field },
    ));
  } else if (actionId === 'chain.pack.activate') {
    assertTrue(
      confirmation.readbackVerified,
      'EXPANSION_PACK_CHAIN_ACTIVATION_READBACK_FAILED',
      'The active Pack release was not verified.',
    );
    assertEqual(
      confirmation.lifecycleState,
      'ACTIVE',
      'EXPANSION_PACK_CHAIN_LIFECYCLE_INVALID',
      'A completed Pack publication must read back as Active.',
    );
    required(confirmation.transactionDigest, 'Pack activation transaction digest');
  }
}

export async function confirmExpansionPackPublicationAction({
  recovery,
  plan,
  actionId,
  confirmation,
} = {}) {
  const hydrated = await hydrateExpansionPackPublicationRecovery(recovery, { plan });
  const current = hydrated.actions[hydrated.currentActionIndex];
  if (
    current?.id !== actionId
    || current.status !== EXPANSION_PACK_PUBLICATION_ACTION_STATUS.SUBMITTED
  ) {
    fail(
      'EXPANSION_PACK_PUBLICATION_CONFIRMATION_OUT_OF_ORDER',
      'Pack publication confirmation is out of order.',
    );
  }
  const planned = plan.actions[hydrated.currentActionIndex];
  const actionValue = {
    ...planned,
    authority: resolve(planned.authority, hydrated, plan),
    inputs: resolve(planned.inputs, hydrated, plan),
  };
  if (planned.transport === EXPANSION_PACK_PUBLICATION_TRANSPORTS.SUI) {
    const submittedDigest = required(
      current.submission?.transactionDigest || current.submission?.digest,
      'Submitted Sui transaction digest',
    );
    const confirmationDigest = required(
      confirmation?.transactionDigest,
      'Confirmed Sui transaction digest',
    );
    if (submittedDigest !== confirmationDigest) {
      fail(
        'EXPANSION_PACK_PUBLICATION_CONFIRMATION_DIGEST_MISMATCH',
        'The Sui readback digest does not match the exact persisted signed transaction.',
        { actionId, expected: submittedDigest, actual: confirmationDigest },
      );
    }
  }
  await validateConfirmation(actionValue, object(confirmation));
  const outputs = Object.fromEntries(array(planned.outputs).map((field) => {
    const value = confirmation?.[field];
    if (value === undefined || value === null
      || (value === '' && !['assetSealId', 'sealReleaseCommitment'].includes(field))) {
      fail(
        'EXPANSION_PACK_PUBLICATION_CONFIRMATION_INCOMPLETE',
        `Confirmed Pack publication action is missing ${field}.`,
        { actionId, field },
      );
    }
    return [field, clone(value)];
  }));
  const actions = hydrated.actions.map((entry, index) => (
    index === hydrated.currentActionIndex
      ? {
          ...clone(entry),
          status: EXPANSION_PACK_PUBLICATION_ACTION_STATUS.CONFIRMED,
          confirmation: clone(confirmation),
          outputs,
        }
      : clone(entry)
  ));
  const cursor = hydrated.currentActionIndex + 1;
  return freeze({
    ...clone(hydrated),
    sequence: hydrated.sequence + 1,
    actions,
    currentActionIndex: cursor,
    completed: cursor === plan.actions.length,
    stage: cursor === plan.actions.length
      ? EXPANSION_PACK_PUBLICATION_STAGES.COMPLETE
      : plan.actions[cursor].stage,
    lastError: null,
    updatedAt: timestamp(),
  });
}

export async function recordExpansionPackPublicationFinalizedFailure({
  recovery,
  plan,
  actionId,
  error,
  recordedAt,
} = {}) {
  const hydrated = await hydrateExpansionPackPublicationRecovery(recovery, { plan });
  const current = hydrated.actions[hydrated.currentActionIndex];
  const exactActionId = required(actionId || current?.id, 'Finalized failure action');
  const failure = object(error?.finalizedFailure);
  const transactionDigest = required(
    failure.transactionDigest || error?.digest,
    'Finalized failure transaction digest',
  );
  const normalized = normalizedFinalizedFailure({
    actionId: exactActionId,
    transactionDigest,
    finalized: failure.finalized,
    executionStatus: failure.executionStatus,
    executionError: failure.executionError,
    recordedAt: timestamp(recordedAt || new Date()),
  }, plan);
  const identity = finalizedFailureIdentity(normalized);
  const digestOwner = array(hydrated.finalizedFailures).find((entry) => (
    entry.transactionDigest === transactionDigest
  ));
  if (digestOwner && digestOwner.actionId !== exactActionId) {
    fail(
      'EXPANSION_PACK_PUBLICATION_FINALIZED_FAILURE_DIGEST_REUSED',
      'One finalized Sui digest cannot be archived under more than one Pack action.',
      { transactionDigest, actionId: exactActionId, existingAction: digestOwner.actionId },
    );
  }
  const existing = digestOwner;
  if (existing && finalizedFailureEvidence(existing) !== finalizedFailureEvidence(normalized)) {
    fail(
      'EXPANSION_PACK_PUBLICATION_FINALIZED_FAILURE_CONFLICT',
      'Conflicting finalized failure evidence exists for the same Pack transaction.',
      { identity },
    );
  }
  const submittedDigest = text(
    current?.submission?.transactionDigest || current?.submission?.digest,
  );
  const planned = plan.actions[hydrated.currentActionIndex];
  if (
    current?.id !== exactActionId
    || planned?.transport !== EXPANSION_PACK_PUBLICATION_TRANSPORTS.SUI
    || current?.status !== EXPANSION_PACK_PUBLICATION_ACTION_STATUS.SUBMITTED
  ) {
    if (current?.status === EXPANSION_PACK_PUBLICATION_ACTION_STATUS.PENDING && existing) {
      return hydrated;
    }
    fail(
      'EXPANSION_PACK_PUBLICATION_FINALIZED_FAILURE_OUT_OF_ORDER',
      'A finalized transaction failure does not match the current submitted Sui action.',
      { actionId: exactActionId, transactionDigest },
    );
  }
  if (!submittedDigest || submittedDigest !== transactionDigest) {
    fail(
      'EXPANSION_PACK_PUBLICATION_FINALIZED_FAILURE_DIGEST_MISMATCH',
      'The finalized failed digest does not match the exact persisted signed transaction.',
      { expected: submittedDigest, actual: transactionDigest },
    );
  }
  const finalizedFailures = existing
    ? clone(hydrated.finalizedFailures)
    : [...clone(hydrated.finalizedFailures), normalized];
  return freeze(mutate(
    hydrated,
    {
      finalizedFailures,
      lastError: {
        code: 'TRANSACTION_FINALIZED_FAILURE',
        message: normalized.executionError.message,
        actionId: exactActionId,
        transactionDigest,
        finalized: true,
        at: normalized.recordedAt,
      },
    },
    {
      status: EXPANSION_PACK_PUBLICATION_ACTION_STATUS.PENDING,
      intentKey: '',
      progress: null,
      submission: null,
      confirmation: null,
      outputs: null,
    },
  ));
}

export async function recordExpansionPackPublicationError({ recovery, plan, error } = {}) {
  const hydrated = await hydrateExpansionPackPublicationRecovery(recovery, { plan });
  return freeze({
    ...clone(hydrated),
    sequence: hydrated.sequence + 1,
    lastError: {
      code: text(error?.code) || 'EXPANSION_PACK_PUBLICATION_ACTION_FAILED',
      message: text(error?.message) || 'Expansion Pack publication failed.',
      actionId: hydrated.actions[hydrated.currentActionIndex]?.id || '',
      at: timestamp(),
    },
    updatedAt: timestamp(),
  });
}

export function completedExpansionPackPublication({ plan, recovery } = {}) {
  if (!recovery?.completed) {
    fail(
      'EXPANSION_PACK_PUBLICATION_INCOMPLETE',
      'Expansion Pack publication is not complete.',
    );
  }
  const output = (actionId, field) => recovery.actions
    .find((entry) => entry.id === actionId)?.outputs?.[field];
  return freeze({
    packReleaseId: exactId(output('chain.pack.create', 'packReleaseId'), 'Expansion Pack release'),
    packAdminCapId: exactId(output('chain.pack.create', 'packAdminCapId'), 'Expansion Pack AdminCap'),
    packTreasuryId: exactId(output('chain.pack.create', 'packTreasuryId'), 'Expansion Pack Treasury'),
    transactionDigest: required(
      output('chain.pack.activate', 'transactionDigest'),
      'Expansion Pack activation transaction digest',
    ),
    manifestBlobId: required(output('walrus.pack.certify', 'quiltBlobId'), 'Pack manifest Blob ID'),
    manifestQuiltPatchId: required(
      output('walrus.pack.certify', 'manifestQuiltPatchId'),
      'Pack manifest Quilt patch ID',
    ),
    manifestSha256: hash(
      output('local.pack.materialize', 'manifestSha256'),
      'Pack manifest SHA-256',
    ),
    candidateCommitment: hash(
      output('local.pack.materialize', 'candidateCommitment'),
      'Pack candidate commitment',
    ),
    parentLegacyMakerId: exactId(plan?.context?.parentLegacyMakerId, 'Parent legacy OCMaker'),
    baseMakerRootId: exactId(plan?.context?.baseMakerRootId, 'Parent MakerRootV5'),
  });
}
