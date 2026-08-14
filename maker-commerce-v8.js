export const MAKER_COMMERCE_V8_SCHEMA = 'animacraft.maker-commerce.v8';

export const MAKER_V8_RIGHTS_ORIGINS = Object.freeze({
  ONCHAIN_NATIVE: 'ONCHAIN_NATIVE',
  LICENSE_WRAPPED: 'LICENSE_WRAPPED',
});

export const MAKER_V8_COMPLETE_MODES = Object.freeze({
  UNLIMITED_FREE: 'UNLIMITED_FREE',
  FREE_QUOTA_THEN_PAID: 'FREE_QUOTA_THEN_PAID',
  PAID_EVERY_TIME: 'PAID_EVERY_TIME',
  FREE_QUOTA_THEN_BLOCK: 'FREE_QUOTA_THEN_BLOCK',
});

export const MAKER_V8_ACCESS_MODES = Object.freeze({
  FREE: 'FREE',
  ONE_TIME_PAID: 'ONE_TIME_PAID',
});

export const MAKER_V8_PACK_ACCESS_MODES = Object.freeze({
  FREE: 'FREE',
  ONE_TIME_PAID: 'ONE_TIME_PAID',
  INCLUDED_WITH_MAKER: 'INCLUDED_WITH_MAKER',
});

export const MAKER_V8_LIFECYCLES = Object.freeze({
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  PAUSED: 'PAUSED',
  ARCHIVED: 'ARCHIVED',
});

export const DEFAULT_MAKER_V8_PROTOCOL_COMMERCE = Object.freeze({
  primaryContentFeeBps: 1_000,
  fixedCompleteFeeAtomic: 0,
  makerMarketFeeBps: 250,
  soulMarketFeeBps: 250,
});

const SAFE_ID = /^[a-zA-Z0-9_-]+$/;
const MAX_PRICE_ATOMIC = 1_000_000_000_000;
const MAX_QUOTA = 1_000_000_000;
const MAX_ROYALTY_BPS = 1_000;
const ROYALTY_STEP_BPS = 50;
const MAX_PROTOCOL_FEE_BPS = 10_000;

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function integer(value, fallback = 0) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : fallback;
}

function boundedAtomic(value, fallback = 0) {
  const number = integer(value, fallback);
  return number >= 0 && number <= MAX_PRICE_ATOMIC ? number : fallback;
}

function boundedQuota(value, fallback = 0) {
  const number = integer(value, fallback);
  return number >= 0 && number <= MAX_QUOTA ? number : fallback;
}

function royaltyBps(value, fallback = 0) {
  const number = integer(value, fallback);
  return number >= 0
    && number <= MAX_ROYALTY_BPS
    && number % ROYALTY_STEP_BPS === 0
    ? number
    : fallback;
}

function uniqueIds(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || ''))
    .filter(Boolean))].sort();
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function issue(issues, path, code, message) {
  issues.push(Object.freeze({ path, code, message }));
}

export function createMakerV8CompletionPolicy(overrides = {}) {
  const mode = Object.values(MAKER_V8_COMPLETE_MODES).includes(overrides.mode)
    ? overrides.mode
    : MAKER_V8_COMPLETE_MODES.UNLIMITED_FREE;
  const paid = mode === MAKER_V8_COMPLETE_MODES.FREE_QUOTA_THEN_PAID
    || mode === MAKER_V8_COMPLETE_MODES.PAID_EVERY_TIME;
  const quota = mode === MAKER_V8_COMPLETE_MODES.FREE_QUOTA_THEN_PAID
    || mode === MAKER_V8_COMPLETE_MODES.FREE_QUOTA_THEN_BLOCK;
  return deepFreeze({
    mode,
    freeQuotaPerWallet: quota ? boundedQuota(overrides.freeQuotaPerWallet, 1) : 0,
    priceAtomic: paid ? boundedAtomic(overrides.priceAtomic, 1) : 0,
    totalCap: overrides.totalCap === null || overrides.totalCap === undefined
      ? null
      : boundedQuota(overrides.totalCap, 1),
  });
}

export function createMakerV8AccessPolicy(overrides = {}) {
  const mode = Object.values(MAKER_V8_ACCESS_MODES).includes(overrides.mode)
    ? overrides.mode
    : MAKER_V8_ACCESS_MODES.FREE;
  return deepFreeze({
    mode,
    purchasePriceAtomic: mode === MAKER_V8_ACCESS_MODES.ONE_TIME_PAID
      ? boundedAtomic(overrides.purchasePriceAtomic, 1)
      : 0,
  });
}

export function createMakerV8PackPolicy(packId, overrides = {}) {
  const accessMode = Object.values(MAKER_V8_PACK_ACCESS_MODES).includes(overrides.accessMode)
    ? overrides.accessMode
    : MAKER_V8_PACK_ACCESS_MODES.FREE;
  return deepFreeze({
    packId: String(packId || ''),
    accessMode,
    purchasePriceAtomic: accessMode === MAKER_V8_PACK_ACCESS_MODES.ONE_TIME_PAID
      ? boundedAtomic(overrides.purchasePriceAtomic, 1)
      : 0,
    completion: createMakerV8CompletionPolicy(overrides.completion),
  });
}

/**
 * Creates a fresh v8 commerce record. This constructor is the only API that
 * accepts partial input. Validation/canonicalization APIs require the exact v8
 * schema and never infer data from a v5 or legacy publication record.
 */
export function createMakerV8Commerce(overrides = {}) {
  const policies = Array.isArray(overrides.packPolicies)
    ? overrides.packPolicies.map((policy) => (
      createMakerV8PackPolicy(policy?.packId, policy)
    ))
    : [];
  return deepFreeze({
    schemaVersion: MAKER_COMMERCE_V8_SCHEMA,
    rightsOrigin: Object.values(MAKER_V8_RIGHTS_ORIGINS).includes(overrides.rightsOrigin)
      ? overrides.rightsOrigin
      : MAKER_V8_RIGHTS_ORIGINS.ONCHAIN_NATIVE,
    rightsOriginConfirmed: overrides.rightsOriginConfirmed === true,
    makerAccess: createMakerV8AccessPolicy(overrides.makerAccess),
    baseCompletion: createMakerV8CompletionPolicy(overrides.baseCompletion),
    packPolicies: policies,
    soulCreatorRoyaltyBps: royaltyBps(overrides.soulCreatorRoyaltyBps, 250),
    makerSourceRoyaltyBps: royaltyBps(overrides.makerSourceRoyaltyBps, 300),
    makerResaleRoyaltyBps: royaltyBps(overrides.makerResaleRoyaltyBps, 500),
  });
}

function validateCompletionPolicy(policy, path, issues) {
  if (!isRecord(policy)) {
    issue(issues, path, 'MAKER_V8_COMPLETION_POLICY_REQUIRED', 'A Complete policy is required.');
    return;
  }
  if (!Object.values(MAKER_V8_COMPLETE_MODES).includes(policy.mode)) {
    issue(issues, `${path}.mode`, 'MAKER_V8_COMPLETION_MODE_INVALID', 'Complete mode is invalid.');
    return;
  }
  const quota = policy.mode === MAKER_V8_COMPLETE_MODES.FREE_QUOTA_THEN_PAID
    || policy.mode === MAKER_V8_COMPLETE_MODES.FREE_QUOTA_THEN_BLOCK;
  const paid = policy.mode === MAKER_V8_COMPLETE_MODES.FREE_QUOTA_THEN_PAID
    || policy.mode === MAKER_V8_COMPLETE_MODES.PAID_EVERY_TIME;
  if (!Number.isSafeInteger(policy.freeQuotaPerWallet)
    || policy.freeQuotaPerWallet < 0
    || policy.freeQuotaPerWallet > MAX_QUOTA
    || (quota && policy.freeQuotaPerWallet === 0)
    || (!quota && policy.freeQuotaPerWallet !== 0)) {
    issue(issues, `${path}.freeQuotaPerWallet`, 'MAKER_V8_COMPLETION_QUOTA_INVALID', 'Complete quota does not match its mode.');
  }
  if (!Number.isSafeInteger(policy.priceAtomic)
    || policy.priceAtomic < 0
    || policy.priceAtomic > MAX_PRICE_ATOMIC
    || (paid && policy.priceAtomic === 0)
    || (!paid && policy.priceAtomic !== 0)) {
    issue(issues, `${path}.priceAtomic`, 'MAKER_V8_COMPLETION_PRICE_INVALID', 'Complete price does not match its mode.');
  }
  if (policy.totalCap !== null && (
    !Number.isSafeInteger(policy.totalCap)
    || policy.totalCap <= 0
    || policy.totalCap > MAX_QUOTA
  )) {
    issue(issues, `${path}.totalCap`, 'MAKER_V8_COMPLETION_CAP_INVALID', 'Complete cap must be null or a positive integer.');
  }
}

export function collectMakerV8CommerceIssues(
  value,
  { packIds = [], publish = false } = {},
) {
  const issues = [];
  if (!isRecord(value)) {
    issue(issues, 'commerce', 'MAKER_V8_COMMERCE_REQUIRED', 'Maker v8 commerce settings are required.');
    return Object.freeze(issues);
  }
  if (value.schemaVersion !== MAKER_COMMERCE_V8_SCHEMA) {
    issue(issues, 'commerce.schemaVersion', 'MAKER_V8_COMMERCE_SCHEMA_INVALID', 'Commerce schema must be animacraft.maker-commerce.v8.');
  }
  if (!Object.values(MAKER_V8_RIGHTS_ORIGINS).includes(value.rightsOrigin)) {
    issue(issues, 'commerce.rightsOrigin', 'MAKER_V8_RIGHTS_ORIGIN_INVALID', 'Choose a supported rights origin.');
  }
  if (typeof value.rightsOriginConfirmed !== 'boolean') {
    issue(issues, 'commerce.rightsOriginConfirmed', 'MAKER_V8_RIGHTS_CONFIRMATION_INVALID', 'Rights confirmation must be an explicit boolean.');
  } else if (publish && value.rightsOriginConfirmed !== true) {
    issue(issues, 'commerce.rightsOriginConfirmed', 'MAKER_V8_RIGHTS_CONFIRMATION_REQUIRED', 'Confirm the rights origin before v8 activation.');
  }

  if (!isRecord(value.makerAccess)
    || !Object.values(MAKER_V8_ACCESS_MODES).includes(value.makerAccess.mode)) {
    issue(issues, 'commerce.makerAccess.mode', 'MAKER_V8_ACCESS_MODE_INVALID', 'Choose free or one-time paid Maker access.');
  } else {
    const paid = value.makerAccess.mode === MAKER_V8_ACCESS_MODES.ONE_TIME_PAID;
    if (!Number.isSafeInteger(value.makerAccess.purchasePriceAtomic)
      || value.makerAccess.purchasePriceAtomic < 0
      || value.makerAccess.purchasePriceAtomic > MAX_PRICE_ATOMIC
      || (paid && value.makerAccess.purchasePriceAtomic === 0)
      || (!paid && value.makerAccess.purchasePriceAtomic !== 0)) {
      issue(issues, 'commerce.makerAccess.purchasePriceAtomic', 'MAKER_V8_ACCESS_PRICE_INVALID', 'Maker access price does not match its mode.');
    }
  }
  validateCompletionPolicy(value.baseCompletion, 'commerce.baseCompletion', issues);

  const declared = new Set(uniqueIds(packIds));
  const seen = new Set();
  if (!Array.isArray(value.packPolicies)) {
    issue(issues, 'commerce.packPolicies', 'MAKER_V8_PACK_POLICIES_INVALID', 'Pack policies must be an array.');
  } else {
    value.packPolicies.forEach((policy, index) => {
      const path = `commerce.packPolicies[${index}]`;
      const packId = String(policy?.packId || '');
      if (!SAFE_ID.test(packId)) {
        issue(issues, `${path}.packId`, 'MAKER_V8_PACK_ID_INVALID', 'Pack ID must be a safe identifier.');
      } else if (seen.has(packId)) {
        issue(issues, `${path}.packId`, 'MAKER_V8_PACK_POLICY_DUPLICATE', 'Each Pack must have exactly one policy.');
      } else if (!declared.has(packId)) {
        issue(issues, `${path}.packId`, 'MAKER_V8_PACK_POLICY_UNKNOWN', 'Pack policy references an undeclared v8 Pack.');
      }
      seen.add(packId);
      if (!Object.values(MAKER_V8_PACK_ACCESS_MODES).includes(policy?.accessMode)) {
        issue(issues, `${path}.accessMode`, 'MAKER_V8_PACK_ACCESS_INVALID', 'Pack access mode is invalid.');
      }
      const paid = policy?.accessMode === MAKER_V8_PACK_ACCESS_MODES.ONE_TIME_PAID;
      if (!Number.isSafeInteger(policy?.purchasePriceAtomic)
        || policy.purchasePriceAtomic < 0
        || policy.purchasePriceAtomic > MAX_PRICE_ATOMIC
        || (paid && policy.purchasePriceAtomic === 0)
        || (!paid && policy.purchasePriceAtomic !== 0)) {
        issue(issues, `${path}.purchasePriceAtomic`, 'MAKER_V8_PACK_PRICE_INVALID', 'Pack price does not match its access mode.');
      }
      validateCompletionPolicy(policy?.completion, `${path}.completion`, issues);
    });
  }
  if (publish) {
    declared.forEach((packId) => {
      if (!seen.has(packId)) {
        issue(issues, 'commerce.packPolicies', 'MAKER_V8_PACK_POLICY_REQUIRED', `Pack "${packId}" needs an exact v8 commerce policy.`);
      }
    });
  }

  for (const field of [
    'soulCreatorRoyaltyBps',
    'makerSourceRoyaltyBps',
    'makerResaleRoyaltyBps',
  ]) {
    const amount = value[field];
    if (!Number.isSafeInteger(amount)
      || amount < 0
      || amount > MAX_ROYALTY_BPS
      || amount % ROYALTY_STEP_BPS !== 0) {
      issue(issues, `commerce.${field}`, 'MAKER_V8_ROYALTY_INVALID', 'Royalty must be 0% through 10% in 0.5% steps.');
    }
  }
  if ((value.soulCreatorRoyaltyBps || 0) + (value.makerSourceRoyaltyBps || 0) > 1_000) {
    issue(issues, 'commerce', 'MAKER_V8_ROYALTY_TOTAL_INVALID', 'Soul creator and Maker source royalties cannot exceed 10% together.');
  }
  return Object.freeze(issues);
}

export class MakerV8CommerceValidationError extends Error {
  constructor(issues) {
    super(issues.map((entry) => `${entry.path}: ${entry.message}`).join('\n'));
    this.name = 'MakerV8CommerceValidationError';
    this.code = issues[0]?.code || 'MAKER_V8_COMMERCE_INVALID';
    this.issues = Object.freeze([...issues]);
  }
}

export function assertMakerV8Commerce(value, options) {
  const issues = collectMakerV8CommerceIssues(value, options);
  if (issues.length) throw new MakerV8CommerceValidationError(issues);
  return value;
}

export function canonicalMakerV8Commerce(value, { packIds = [], publish = false } = {}) {
  assertMakerV8Commerce(value, { packIds, publish });
  const policies = new Map(value.packPolicies.map((policy) => [policy.packId, policy]));
  return createMakerV8Commerce({
    ...value,
    makerAccess: value.makerAccess,
    baseCompletion: value.baseCompletion,
    packPolicies: uniqueIds(packIds).map((packId) => ({
      ...policies.get(packId),
      packId,
    })),
  });
}

function protocolTerms(value) {
  if (!isRecord(value)
    || !Number.isSafeInteger(value.primaryContentFeeBps)
    || value.primaryContentFeeBps < 0
    || value.primaryContentFeeBps > MAX_PROTOCOL_FEE_BPS
    || !Number.isSafeInteger(value.fixedCompleteFeeAtomic)
    || value.fixedCompleteFeeAtomic < 0
    || value.fixedCompleteFeeAtomic > MAX_PRICE_ATOMIC) {
    throw new TypeError('Maker v8 protocol commerce terms are invalid.');
  }
  return value;
}

function splitAmount(grossAtomic, feeBps) {
  const protocolAtomic = Math.floor((grossAtomic * feeBps) / 10_000);
  return Object.freeze({
    grossAtomic,
    protocolAtomic,
    makerAtomic: grossAtomic - protocolAtomic,
  });
}

export function quoteMakerV8Access(
  commerce,
  { ownsMakerAccess = false, protocol = DEFAULT_MAKER_V8_PROTOCOL_COMMERCE } = {},
) {
  assertMakerV8Commerce(commerce, { packIds: commerce.packPolicies.map((entry) => entry.packId) });
  protocolTerms(protocol);
  if (commerce.makerAccess.mode === MAKER_V8_ACCESS_MODES.FREE) {
    return deepFreeze({ valid: true, reason: 'FREE_ACCESS', ...splitAmount(0, 0) });
  }
  if (ownsMakerAccess) {
    return deepFreeze({ valid: false, reason: 'ALREADY_OWNED', ...splitAmount(0, 0) });
  }
  return deepFreeze({
    valid: true,
    reason: 'PURCHASE_REQUIRED',
    ...splitAmount(commerce.makerAccess.purchasePriceAtomic, protocol.primaryContentFeeBps),
  });
}

export function quoteMakerV8Pack(
  commerce,
  packId,
  { ownsMakerAccess = false, ownedPackIds = [], protocol = DEFAULT_MAKER_V8_PROTOCOL_COMMERCE } = {},
) {
  assertMakerV8Commerce(commerce, { packIds: commerce.packPolicies.map((entry) => entry.packId) });
  protocolTerms(protocol);
  const policy = commerce.packPolicies.find((entry) => entry.packId === packId);
  if (!policy) return deepFreeze({ valid: false, reason: 'UNKNOWN_PACK', ...splitAmount(0, 0) });
  if (ownedPackIds.includes(packId)) {
    return deepFreeze({ valid: false, reason: 'ALREADY_OWNED', ...splitAmount(0, 0) });
  }
  if (policy.accessMode === MAKER_V8_PACK_ACCESS_MODES.INCLUDED_WITH_MAKER) {
    if (!ownsMakerAccess && commerce.makerAccess.mode !== MAKER_V8_ACCESS_MODES.FREE) {
      return deepFreeze({ valid: false, reason: 'MAKER_ACCESS_REQUIRED', ...splitAmount(0, 0) });
    }
    return deepFreeze({ valid: true, reason: 'INCLUDED_WITH_MAKER', ...splitAmount(0, 0) });
  }
  const gross = policy.accessMode === MAKER_V8_PACK_ACCESS_MODES.ONE_TIME_PAID
    ? policy.purchasePriceAtomic
    : 0;
  return deepFreeze({
    valid: true,
    reason: gross ? 'PURCHASE_REQUIRED' : 'FREE_CLAIM',
    ...splitAmount(gross, protocol.primaryContentFeeBps),
  });
}

function completionCharge(policy, walletCount, totalCount) {
  if (policy.totalCap !== null && totalCount >= policy.totalCap) {
    return { blocked: true, reason: 'TOTAL_CAP_REACHED', amount: 0 };
  }
  if (policy.mode === MAKER_V8_COMPLETE_MODES.UNLIMITED_FREE) {
    return { blocked: false, reason: 'FREE', amount: 0 };
  }
  if (policy.mode === MAKER_V8_COMPLETE_MODES.PAID_EVERY_TIME) {
    return { blocked: false, reason: 'PAID', amount: policy.priceAtomic };
  }
  if (walletCount < policy.freeQuotaPerWallet) {
    return { blocked: false, reason: 'FREE_QUOTA', amount: 0 };
  }
  if (policy.mode === MAKER_V8_COMPLETE_MODES.FREE_QUOTA_THEN_PAID) {
    return { blocked: false, reason: 'PAID_AFTER_QUOTA', amount: policy.priceAtomic };
  }
  return { blocked: true, reason: 'FREE_QUOTA_EXHAUSTED', amount: 0 };
}

export function quoteMakerV8Complete(
  commerce,
  {
    usedPackIds = [],
    ownsMakerAccess = false,
    ownedPackIds = [],
    walletBaseCount = 0,
    walletPackCounts = {},
    totalBaseCount = 0,
    totalPackCounts = {},
    protocol = DEFAULT_MAKER_V8_PROTOCOL_COMMERCE,
  } = {},
) {
  assertMakerV8Commerce(commerce, { packIds: commerce.packPolicies.map((entry) => entry.packId) });
  protocolTerms(protocol);
  let blockedReason = '';
  const missingEntitlements = [];
  const lineItems = [];
  let contentAtomic = 0;

  if (commerce.makerAccess.mode === MAKER_V8_ACCESS_MODES.ONE_TIME_PAID && !ownsMakerAccess) {
    blockedReason = 'MAKER_ACCESS_REQUIRED';
  }
  const base = completionCharge(
    commerce.baseCompletion,
    boundedQuota(walletBaseCount),
    boundedQuota(totalBaseCount),
  );
  lineItems.push({ scope: 'base', ...base });
  if (base.blocked) blockedReason ||= base.reason;
  contentAtomic += base.amount;

  uniqueIds(usedPackIds).forEach((packId) => {
    const policy = commerce.packPolicies.find((entry) => entry.packId === packId);
    if (!policy) {
      missingEntitlements.push(packId);
      return;
    }
    const included = policy.accessMode === MAKER_V8_PACK_ACCESS_MODES.INCLUDED_WITH_MAKER
      && (commerce.makerAccess.mode === MAKER_V8_ACCESS_MODES.FREE || ownsMakerAccess);
    if (!included && !ownedPackIds.includes(packId)) {
      missingEntitlements.push(packId);
      return;
    }
    const charge = completionCharge(
      policy.completion,
      boundedQuota(walletPackCounts[packId]),
      boundedQuota(totalPackCounts[packId]),
    );
    lineItems.push({ scope: 'pack', packId, ...charge });
    if (charge.blocked) blockedReason ||= charge.reason;
    contentAtomic += charge.amount;
  });

  const fixedProtocolAtomic = protocol.fixedCompleteFeeAtomic;
  const split = splitAmount(contentAtomic, protocol.primaryContentFeeBps);
  const reason = blockedReason === 'MAKER_ACCESS_REQUIRED'
    ? blockedReason
    : missingEntitlements.length
      ? 'PACK_ACCESS_REQUIRED'
      : blockedReason || 'READY';
  return deepFreeze({
    valid: !blockedReason && missingEntitlements.length === 0,
    reason,
    usedPackIds: uniqueIds(usedPackIds),
    missingEntitlements,
    lineItems,
    contentAtomic,
    fixedProtocolAtomic,
    protocolContentAtomic: split.protocolAtomic,
    protocolAtomic: split.protocolAtomic + fixedProtocolAtomic,
    makerAtomic: split.makerAtomic,
    grossAtomic: contentAtomic + fixedProtocolAtomic,
  });
}

export function canTransitionMakerV8Lifecycle(from, to) {
  if (from === to) return true;
  return {
    [MAKER_V8_LIFECYCLES.DRAFT]: new Set([MAKER_V8_LIFECYCLES.ACTIVE]),
    [MAKER_V8_LIFECYCLES.ACTIVE]: new Set([
      MAKER_V8_LIFECYCLES.PAUSED,
      MAKER_V8_LIFECYCLES.ARCHIVED,
    ]),
    [MAKER_V8_LIFECYCLES.PAUSED]: new Set([
      MAKER_V8_LIFECYCLES.ACTIVE,
      MAKER_V8_LIFECYCLES.ARCHIVED,
    ]),
    [MAKER_V8_LIFECYCLES.ARCHIVED]: new Set(),
  }[from]?.has(to) || false;
}
