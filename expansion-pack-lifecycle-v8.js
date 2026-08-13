import { normalizeStructTag, normalizeSuiAddress } from '@mysten/sui/utils';
import {
  parseCommerceProtocolConfigV5,
  parseMakerRootV5,
} from './chain-commerce-v5.js';
import {
  EXPANSION_PACK_V8_LIFECYCLE,
  EXPANSION_PACK_V8_MODULE,
  ExpansionPackV8AppError,
  buildArchiveExpansionPackV8,
  buildPauseExpansionPackV8,
  buildResumeExpansionPackV8,
  parseExpansionPackAdminCapV8,
  parseExpansionPackReleaseV8,
  parseExpansionPackTreasuryV8,
  queryIndependentExtensionLockV5,
  readExpansionPackV8Submission,
} from './expansion-pack-publication-v8-app.js';

export const EXPANSION_PACK_LIFECYCLE_ACTIONS_V8 = Object.freeze({
  DRAFT: Object.freeze(['archive']),
  SEALED: Object.freeze(['archive']),
  ADMITTED: Object.freeze(['archive']),
  ACTIVE: Object.freeze(['pause']),
  PAUSED: Object.freeze(['resume', 'archive']),
  ARCHIVED: Object.freeze([]),
});

export const EXPANSION_PACK_LIFECYCLE_DESCRIPTOR_V8 = Object.freeze({
  DRAFT: Object.freeze({ lifecycle: 0, terminal: false, transitions: Object.freeze({ archive: 5 }) }),
  SEALED: Object.freeze({ lifecycle: 1, terminal: false, transitions: Object.freeze({ archive: 5 }) }),
  ADMITTED: Object.freeze({ lifecycle: 2, terminal: false, transitions: Object.freeze({ archive: 5 }) }),
  ACTIVE: Object.freeze({ lifecycle: 3, terminal: false, transitions: Object.freeze({ pause: 4 }) }),
  PAUSED: Object.freeze({ lifecycle: 4, terminal: false, transitions: Object.freeze({ resume: 3, archive: 5 }) }),
  ARCHIVED: Object.freeze({ lifecycle: 5, terminal: true, transitions: Object.freeze({}) }),
});

const STATE_BY_LIFECYCLE = Object.freeze(Object.fromEntries(
  Object.entries(EXPANSION_PACK_LIFECYCLE_DESCRIPTOR_V8)
    .map(([state, descriptor]) => [descriptor.lifecycle, state]),
));

function fail(code, message, details = {}) {
  throw new ExpansionPackV8AppError(message, code, details);
}

function exactId(value, label) {
  try {
    return normalizeSuiAddress(String(value ?? '').trim());
  } catch {
    fail('EXPANSION_PACK_V8_OBJECT_ID_INVALID', `${label} must be an exact Sui object ID.`, {
      label,
      value,
    });
  }
}

function sameId(left, right) {
  try {
    return normalizeSuiAddress(left) === normalizeSuiAddress(right);
  } catch {
    return false;
  }
}

function objectId(value) {
  return value?.objectId || value?.id || value?.data?.objectId || value?.data?.id || '';
}

function objectType(value) {
  return value?.type || value?.data?.type || value?.content?.type || value?.data?.content?.type || '';
}

function objectVersion(value) {
  const version = String(value?.version ?? value?.data?.version ?? '').trim();
  try {
    if (!version || BigInt(version) < 1n) throw new Error('range');
  } catch {
    fail('EXPANSION_PACK_V8_CHAIN_READBACK_MISMATCH',
      'ExpansionPackReleaseV8 object version is missing or invalid.');
  }
  return version;
}

function objectDigest(value) {
  const digest = String(value?.digest ?? value?.data?.digest ?? '').trim();
  if (!digest) fail(
    'EXPANSION_PACK_V8_CHAIN_READBACK_MISMATCH',
    'ExpansionPackReleaseV8 object digest is missing.',
  );
  return digest;
}

function isShared(value) {
  const owner = value?.owner || value?.data?.owner;
  return Boolean(owner?.Shared || owner?.shared || owner?.$kind === 'Shared' || owner === 'Shared');
}

function exactType(value, expected, label) {
  let actual = '';
  try { actual = normalizeStructTag(String(objectType(value))); } catch { /* handled below */ }
  if (actual !== normalizeStructTag(expected)) {
    fail('EXPANSION_PACK_V8_TYPE_ORIGIN_MISMATCH', `${label} has the wrong stable TypeOrigin.`, {
      expected: normalizeStructTag(expected), actual,
    });
  }
}

async function exactObjects(suiClient, ids, label) {
  if (!suiClient?.getObjects) {
    fail('EXPANSION_PACK_V8_CLIENT_MISSING', 'A Sui client with getObjects is required.');
  }
  const requested = ids.map((id) => exactId(id, `${label} ID`));
  const response = await suiClient.getObjects({
    objectIds: requested,
    include: { json: true, type: true, owner: true },
  });
  const entries = (response?.objects || response?.data || response || [])
    .filter((entry) => entry && !entry.error);
  return requested.map((id) => {
    const found = entries.find((entry) => sameId(objectId(entry), id));
    if (!found) fail(
      'EXPANSION_PACK_V8_CHAIN_READBACK_MISMATCH',
      `${label} ${id} is not visible in the fresh chain read.`,
    );
    return found;
  });
}

function optionalExactMatch(supplied, authoritative, label) {
  if (supplied != null && String(supplied).trim() && !sameId(supplied, authoritative)) {
    fail('EXPANSION_PACK_V8_CHAIN_READBACK_MISMATCH', `${label} does not match the Release authority.`, {
      supplied: exactId(supplied, label), authoritative,
    });
  }
}

function parseParent(value, runtime) {
  const origin = exactId(runtime?.commerceV5TypeOriginPackageId, 'Commerce v5 TypeOrigin');
  exactType(value, `${origin}::commerce_v5::MakerRootV5`, 'Parent MakerRootV5');
  return parseMakerRootV5(value);
}

function parseConfig(value, runtime) {
  const origin = exactId(runtime?.commerceV5TypeOriginPackageId, 'Commerce v5 TypeOrigin');
  exactType(value, `${origin}::commerce_v5::CommerceProtocolConfigV5`, 'CommerceProtocolConfigV5');
  const result = parseCommerceProtocolConfigV5(value);
  if (!isShared(value)) fail(
    'EXPANSION_PACK_V8_CHAIN_READBACK_MISMATCH',
    'CommerceProtocolConfigV5 must be the exact shared v5 config.',
  );
  return result;
}

async function optionalIndependentExtensionLock(suiClient, runtime, rootId) {
  try {
    return await queryIndependentExtensionLockV5(suiClient, { runtime, rootId });
  } catch (error) {
    if (error?.code === 'EXPANSION_PACK_V8_PARENT_LOCK_MISSING') return null;
    throw error;
  }
}

function independentParentOperational({ parent, config, lock, release, runtime }) {
  if (!lock) return false;
  let paymentCoinLinked = false;
  try {
    const expectedPaymentCoin = normalizeStructTag(String(runtime?.paymentCoinType || ''));
    paymentCoinLinked = normalizeStructTag(parent.paymentCoinType) === expectedPaymentCoin
      && normalizeStructTag(config.paymentCoinType) === expectedPaymentCoin;
  } catch {
    return false;
  }
  return parent.lifecycle === 1
    && !parent.activeListingId
    && parent.styleRegistrySealed === true
    && sameId(parent.currentControlCapId, lock.retiredControlCapId)
    && parent.ownershipEpoch === release.admittedParentOwnershipEpoch
    && parent.ownershipEpoch === lock.lockedOwnershipEpoch
    && lock.retiredControlCapEpoch + 1n === lock.lockedOwnershipEpoch
    && lock.finalized === true
    && sameId(lock.authorityId, runtime?.independentExtensionAuthorityV5Id)
    && sameId(lock.legacyMakerId, parent.legacyMakerId)
    && sameId(lock.legacyMakerId, release.parentLegacyMakerId)
    && sameId(lock.protocolConfigId, parent.protocolConfigId)
    && sameId(lock.protocolConfigId, config.objectId)
    && sameId(lock.protocolAdminCapId, config.legacyAdminCapId)
    && sameId(lock.owner, parent.currentOwner)
    && typeof lock.auditHash === 'string'
    && /^[0-9a-f]{64}$/.test(lock.auditHash)
    && config.enabled === true
    && Boolean(String(config.logicalAuxiliaryBlobId || '').trim())
    && Boolean(String(config.soulBindingProofType || '').trim())
    && parent.logicalAuxiliaryBlobId === config.logicalAuxiliaryBlobId
    && paymentCoinLinked;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

/** Fresh, Release-authoritative lifecycle read used immediately before signing. */
export async function readExpansionPackLifecycleV8({
  suiClient,
  runtime,
  walletAddress,
  releaseId,
  adminCapId,
  treasuryId,
  parentRootId,
} = {}) {
  const wallet = exactId(walletAddress, 'Wallet address');
  const [releaseObject] = await exactObjects(suiClient, [releaseId], 'ExpansionPackReleaseV8');
  const release = Object.freeze({
    ...parseExpansionPackReleaseV8(releaseObject, { runtime }),
    objectVersion: objectVersion(releaseObject),
    objectDigest: objectDigest(releaseObject),
  });
  optionalExactMatch(adminCapId, release.adminCapId, 'ExpansionPackAdminCapV8 ID');
  optionalExactMatch(treasuryId, release.treasuryId, 'ExpansionPackTreasuryV8 ID');
  optionalExactMatch(parentRootId, release.parentRootId, 'Parent MakerRootV5 ID');

  const [capObject, treasuryObject, parentObject] = await exactObjects(suiClient, [
    release.adminCapId, release.treasuryId, release.parentRootId,
  ], 'Expansion Pack linked object');
  const adminCap = parseExpansionPackAdminCapV8(capObject, { runtime });
  const treasury = parseExpansionPackTreasuryV8(treasuryObject, {
    runtime,
    paymentCoinType: runtime?.paymentCoinType,
  });
  const parent = parseParent(parentObject, runtime);
  const [configObject] = await exactObjects(
    suiClient,
    [parent.protocolConfigId],
    'CommerceProtocolConfigV5',
  );
  const config = parseConfig(configObject, runtime);
  const state = STATE_BY_LIFECYCLE[release.lifecycle];
  const lock = state === 'PAUSED'
    ? await optionalIndependentExtensionLock(suiClient, runtime, parent.objectId)
    : null;

  const linkageReady = sameId(adminCap.releaseId, release.objectId)
    && sameId(treasury.releaseId, release.objectId)
    && sameId(adminCap.objectId, release.adminCapId)
    && sameId(treasury.objectId, release.treasuryId)
    && sameId(adminCap.creator, release.creator)
    && sameId(adminCap.owner, release.creator)
    && sameId(parent.objectId, release.parentRootId)
    && sameId(parent.protocolConfigId, config.objectId)
    && isShared(releaseObject)
    && isShared(treasuryObject)
    && isShared(parentObject);
  if (!linkageReady) fail(
    'EXPANSION_PACK_V8_CHAIN_READBACK_MISMATCH',
    'Release, AdminCap, Treasury, owner and parent linkage are not exact.',
  );

  const authorityReady = sameId(wallet, adminCap.owner) && sameId(wallet, release.creator);
  const runtimeReady = runtime?.expansionPackV8ReleaseEnabled === true;
  const resumeParentReady = independentParentOperational({ parent, config, lock, release, runtime });
  const parentReady = state === 'PAUSED'
    ? resumeParentReady
    : parent.lifecycle === 1
      && parent.ownershipEpoch === release.admittedParentOwnershipEpoch
      && config.enabled;
  const stateActions = EXPANSION_PACK_LIFECYCLE_ACTIONS_V8[state] || [];
  const allowedActions = authorityReady && runtimeReady
    ? stateActions.filter((kind) => kind !== 'resume' || resumeParentReady)
    : [];

  return deepFreeze({
    state,
    lifecycle: release.lifecycle,
    release,
    adminCap,
    treasury,
    parent: { ...parent, config, independentExtensionLock: lock, operational: parentReady },
    authorityReady,
    allowedActions: [...allowedActions],
    readbackVerified: true,
  });
}

function callablePackage(runtime) {
  return exactId(
    runtime?.expansionPackV8CallablePackageId || runtime?.expansionPackV8PackageId,
    'Expansion Pack v8 callable package',
  );
}

/** Create one lifecycle action plus its existing audited transaction builder output. */
export function createExpansionPackLifecycleAction({ kind, runtime, descriptor, sender } = {}) {
  const normalizedKind = String(kind || '').toLowerCase();
  if (!['pause', 'resume', 'archive'].includes(normalizedKind)) {
    fail('EXPANSION_PACK_V8_LIFECYCLE_ACTION_INVALID', 'Lifecycle action must be pause, resume or archive.');
  }
  if (descriptor?.readbackVerified !== true || !descriptor?.release || !descriptor?.adminCap) {
    fail('EXPANSION_PACK_V8_LIFECYCLE_DESCRIPTOR_INVALID', 'A fresh verified lifecycle descriptor is required.');
  }
  const signer = exactId(sender, 'Transaction sender');
  if (!descriptor.authorityReady || !sameId(signer, descriptor.adminCap.owner)) {
    fail('EXPANSION_PACK_V8_OWNER_MISMATCH', 'The sender does not own the exact ExpansionPackAdminCapV8.');
  }
  if (!descriptor.allowedActions?.includes(normalizedKind)) {
    fail('EXPANSION_PACK_V8_LIFECYCLE_ACTION_NOT_ALLOWED', `${normalizedKind} is not allowed by the fresh lifecycle descriptor.`);
  }
  const fromLifecycle = Number(descriptor.lifecycle);
  const toLifecycle = EXPANSION_PACK_LIFECYCLE_DESCRIPTOR_V8[descriptor.state]
    ?.transitions?.[normalizedKind];
  const inputs = {
    packReleaseId: descriptor.release.objectId,
    packAdminCapId: descriptor.adminCap.objectId,
  };
  if (normalizedKind === 'resume') {
    inputs.baseMakerRootId = descriptor.parent.objectId;
    inputs.commerceProtocolConfigV5Id = descriptor.parent.config.objectId;
  }
  const functionName = `${normalizedKind}_expansion_pack_v8`;
  const action = deepFreeze({
    id: `chain.pack.${normalizedKind}`,
    transport: 'SUI',
    target: `${callablePackage(runtime)}::${EXPANSION_PACK_V8_MODULE}::${functionName}`,
    authority: { signer },
    typeArguments: [],
    inputs,
    fromLifecycle,
    toLifecycle,
  });
  const common = {
    runtime,
    releaseId: inputs.packReleaseId,
    adminCapId: inputs.packAdminCapId,
    sender: signer,
  };
  const transaction = normalizedKind === 'pause'
    ? buildPauseExpansionPackV8(common)
    : normalizedKind === 'archive'
      ? buildArchiveExpansionPackV8(common)
      : buildResumeExpansionPackV8({
        ...common,
        parentRootId: inputs.baseMakerRootId,
        protocolConfigId: inputs.commerceProtocolConfigV5Id,
      });
  return Object.freeze({ action, transaction, fromLifecycle, toLifecycle });
}

/** Strict readback facade requiring the exact stable from/to transition. */
export async function readExpansionPackLifecycleSubmission({
  action,
  submission,
  suiClient,
  runtime,
  fromLifecycle = action?.fromLifecycle,
  toLifecycle = action?.toLifecycle,
} = {}) {
  if (!Number.isInteger(fromLifecycle) || !Number.isInteger(toLifecycle)) {
    fail('EXPANSION_PACK_V8_LIFECYCLE_TRANSITION_INVALID', 'Exact lifecycle from/to values are required.');
  }
  const verifiedAction = { ...action, fromLifecycle, toLifecycle };
  const result = await readExpansionPackV8Submission({
    action: verifiedAction,
    submission,
    suiClient,
    runtime,
  });
  if (result.readbackVerified !== true || result.lifecycle !== toLifecycle
    || result.previousLifecycle !== fromLifecycle) {
    fail('EXPANSION_PACK_V8_CHAIN_READBACK_MISMATCH', 'Lifecycle submission did not verify the exact from/to transition.');
  }
  return deepFreeze(result);
}
