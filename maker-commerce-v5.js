export const MAKER_COMMERCE_V5_SCHEMA = 'animacraft.maker-commerce.v5';

export const RIGHTS_ORIGINS = Object.freeze({
  ONCHAIN_NATIVE: 'ONCHAIN_NATIVE',
  LICENSE_WRAPPED: 'LICENSE_WRAPPED',
});

export const COMPLETION_MODES = Object.freeze({
  UNLIMITED_FREE: 'UNLIMITED_FREE',
  FREE_QUOTA_THEN_PAID: 'FREE_QUOTA_THEN_PAID',
  PAID_EVERY_TIME: 'PAID_EVERY_TIME',
  FREE_QUOTA_THEN_BLOCK: 'FREE_QUOTA_THEN_BLOCK',
});

export const PACK_ACCESS_MODES = Object.freeze({
  FREE: 'FREE',
  ONE_TIME_PAID: 'ONE_TIME_PAID',
  REQUIRED_CORE: 'REQUIRED_CORE',
});

export const MAKER_ACCESS_MODES = Object.freeze({
  FREE: 'FREE',
  ONE_TIME_PAID: 'ONE_TIME_PAID',
});

export const ONCHAIN_MAKER_STATES = Object.freeze({
  ACTIVE: 'ACTIVE',
  PAUSED: 'PAUSED',
  SALE_PENDING: 'SALE_PENDING',
  ARCHIVED: 'ARCHIVED',
});

export const WORKSPACE_MAKER_STATES = Object.freeze({
  DRAFT: 'DRAFT',
  PUBLISHING: 'PUBLISHING',
  RECOVERABLE: 'RECOVERABLE',
  VERSION_DRAFT: 'VERSION_DRAFT',
});

export const DEFAULT_PROTOCOL_COMMERCE_V5 = Object.freeze({
  enabled: false,
  primaryContentFeeBps: 1_000,
  fixedCompleteFeeAtomic: 0,
  makerMarketFeeBps: 250,
  soulMarketFeeBps: 250,
});

const SAFE_ID = /^[a-zA-Z0-9_-]+$/;
const MAX_PRICE_ATOMIC = 1_000_000_000_000;
const MAX_QUOTA = 1_000_000_000;
const MAX_ROYALTY_BPS = 500;

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
  return number >= 0 && number <= MAX_ROYALTY_BPS && number % 50 === 0
    ? number
    : fallback;
}

export function createCompletionPolicyV5(overrides = {}) {
  const mode = Object.values(COMPLETION_MODES).includes(overrides.mode)
    ? overrides.mode
    : COMPLETION_MODES.UNLIMITED_FREE;
  const priceAtomic = mode === COMPLETION_MODES.FREE_QUOTA_THEN_PAID
    || mode === COMPLETION_MODES.PAID_EVERY_TIME
    ? boundedAtomic(overrides.priceAtomic)
    : 0;
  const freeQuotaPerWallet = mode === COMPLETION_MODES.FREE_QUOTA_THEN_PAID
    || mode === COMPLETION_MODES.FREE_QUOTA_THEN_BLOCK
    ? boundedQuota(overrides.freeQuotaPerWallet)
    : 0;
  return {
    mode,
    freeQuotaPerWallet,
    priceAtomic,
    totalCap: overrides.totalCap === null || overrides.totalCap === undefined
      ? null
      : boundedQuota(overrides.totalCap),
  };
}

export function createMakerAccessPolicyV5(overrides = {}) {
  const mode = Object.values(MAKER_ACCESS_MODES).includes(overrides.mode)
    ? overrides.mode
    : MAKER_ACCESS_MODES.FREE;
  return {
    mode,
    purchasePriceAtomic: mode === MAKER_ACCESS_MODES.ONE_TIME_PAID
      ? boundedAtomic(overrides.purchasePriceAtomic)
      : 0,
  };
}

export function createDefaultMakerCommerceV5(overrides = {}) {
  return {
    schemaVersion: MAKER_COMMERCE_V5_SCHEMA,
    rightsOrigin: Object.values(RIGHTS_ORIGINS).includes(overrides.rightsOrigin)
      ? overrides.rightsOrigin
      : RIGHTS_ORIGINS.LICENSE_WRAPPED,
    rightsOriginConfirmed: overrides.rightsOriginConfirmed === true,
    makerAccess: createMakerAccessPolicyV5(overrides.makerAccess),
    baseCompletion: createCompletionPolicyV5(overrides.baseCompletion),
    packPolicies: [],
    soulCreatorRoyaltyBps: royaltyBps(overrides.soulCreatorRoyaltyBps, 250),
    makerSourceRoyaltyBps: royaltyBps(overrides.makerSourceRoyaltyBps, 250),
    makerResaleRoyaltyBps: royaltyBps(
      overrides.makerResaleRoyaltyBps,
      MAX_ROYALTY_BPS,
    ),
  };
}

export function createPackCommercePolicyV5(packId, overrides = {}) {
  const accessMode = Object.values(PACK_ACCESS_MODES).includes(overrides.accessMode)
    ? overrides.accessMode
    : PACK_ACCESS_MODES.FREE;
  return {
    packId: String(packId || ''),
    accessMode,
    purchasePriceAtomic: accessMode === PACK_ACCESS_MODES.ONE_TIME_PAID
      ? boundedAtomic(overrides.purchasePriceAtomic)
      : 0,
    completion: createCompletionPolicyV5(overrides.completion),
  };
}

export function normalizeMakerCommerceV5(value, { packIds = [] } = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const normalized = createDefaultMakerCommerceV5(source);
  const declaredPackIds = [...new Set(packIds.map(String).filter(Boolean))];
  const sourcePolicies = new Map(
    (Array.isArray(source.packPolicies) ? source.packPolicies : [])
      .filter((policy) => policy && typeof policy === 'object')
      .map((policy) => [String(policy.packId || ''), policy]),
  );
  normalized.packPolicies = declaredPackIds.map((packId) => (
    createPackCommercePolicyV5(packId, sourcePolicies.get(packId))
  ));
  return normalized;
}

function completionPolicyRequiresV5(policy) {
  return Boolean(
    policy?.mode !== COMPLETION_MODES.UNLIMITED_FREE
    || policy?.freeQuotaPerWallet !== 0
    || policy?.priceAtomic !== 0
    || policy?.totalCap !== null
  );
}

export function makerCommerceV5RequiresRelease(
  value,
  { packIds = [] } = {},
) {
  const declaredPackIds = [...new Set(packIds.map(String).filter(Boolean))];
  const normalized = normalizeMakerCommerceV5(value, {
    packIds: declaredPackIds,
  });
  const defaults = createDefaultMakerCommerceV5();
  const sourcePackPolicies = Array.isArray(value?.packPolicies)
    ? value.packPolicies
    : [];
  return Boolean(
    normalized.rightsOriginConfirmed === true
    || normalized.rightsOrigin !== defaults.rightsOrigin
    || normalized.makerAccess.mode !== defaults.makerAccess.mode
    || normalized.makerAccess.purchasePriceAtomic !== 0
    || completionPolicyRequiresV5(normalized.baseCompletion)
    || declaredPackIds.length > 0
    || sourcePackPolicies.length > 0
    || normalized.packPolicies.length > 0
    || normalized.soulCreatorRoyaltyBps !== defaults.soulCreatorRoyaltyBps
    || normalized.makerSourceRoyaltyBps !== defaults.makerSourceRoyaltyBps
    || normalized.makerResaleRoyaltyBps !== defaults.makerResaleRoyaltyBps
  );
}

function pushIssue(issues, path, code, message) {
  issues.push({ path, code, message });
}

export function collectMakerCommerceV5Issues(
  value,
  { packIds = [], publish = false } = {},
) {
  const issues = [];
  if (!value || typeof value !== 'object') {
    pushIssue(issues, 'commerce', 'invalid_commerce', 'Commerce settings are required.');
    return issues;
  }
  if (value.schemaVersion !== MAKER_COMMERCE_V5_SCHEMA) {
    pushIssue(issues, 'commerce.schemaVersion', 'invalid_commerce_schema', 'Commerce schema must be v5.');
  }
  if (!Object.values(RIGHTS_ORIGINS).includes(value.rightsOrigin)) {
    pushIssue(issues, 'commerce.rightsOrigin', 'invalid_rights_origin', 'Choose an on-chain native or license-wrapped rights origin.');
  }
  if (
    Object.hasOwn(value, 'rightsOriginConfirmed')
    && typeof value.rightsOriginConfirmed !== 'boolean'
  ) {
    pushIssue(
      issues,
      'commerce.rightsOriginConfirmed',
      'invalid_rights_origin_confirmation',
      'Rights-origin confirmation must be an explicit boolean.',
    );
  }
  if (publish && value.rightsOriginConfirmed !== true) {
    pushIssue(
      issues,
      'commerce.rightsOriginConfirmed',
      'rights_origin_confirmation_required',
      'Confirm the Maker rights origin before the first Commerce v5 publication.',
    );
  }
  if (!value.makerAccess || !Object.values(MAKER_ACCESS_MODES).includes(value.makerAccess.mode)) {
    pushIssue(issues, 'commerce.makerAccess.mode', 'invalid_maker_access', 'Choose free or one-time paid Maker access.');
  } else {
    const paid = value.makerAccess.mode === MAKER_ACCESS_MODES.ONE_TIME_PAID;
    if (!Number.isSafeInteger(value.makerAccess.purchasePriceAtomic)
      || value.makerAccess.purchasePriceAtomic < 0
      || value.makerAccess.purchasePriceAtomic > MAX_PRICE_ATOMIC
      || (paid && value.makerAccess.purchasePriceAtomic === 0)
      || (!paid && value.makerAccess.purchasePriceAtomic !== 0)) {
      pushIssue(issues, 'commerce.makerAccess.purchasePriceAtomic', 'invalid_maker_access_price', 'The purchase price does not match this Maker access policy.');
    }
  }
  const validatePolicy = (policy, path) => {
    if (!policy || typeof policy !== 'object') {
      pushIssue(issues, path, 'invalid_completion_policy', 'A completion policy is required.');
      return;
    }
    if (!Object.values(COMPLETION_MODES).includes(policy.mode)) {
      pushIssue(issues, `${path}.mode`, 'invalid_completion_mode', 'Choose a supported Complete policy.');
      return;
    }
    const quotaMode = policy.mode === COMPLETION_MODES.FREE_QUOTA_THEN_PAID
      || policy.mode === COMPLETION_MODES.FREE_QUOTA_THEN_BLOCK;
    const paidMode = policy.mode === COMPLETION_MODES.FREE_QUOTA_THEN_PAID
      || policy.mode === COMPLETION_MODES.PAID_EVERY_TIME;
    if (!Number.isSafeInteger(policy.freeQuotaPerWallet)
      || policy.freeQuotaPerWallet < 0
      || policy.freeQuotaPerWallet > MAX_QUOTA
      || (quotaMode && policy.freeQuotaPerWallet === 0)
      || (!quotaMode && policy.freeQuotaPerWallet !== 0)) {
      pushIssue(issues, `${path}.freeQuotaPerWallet`, 'invalid_complete_quota', 'The free quota does not match this Complete policy.');
    }
    if (!Number.isSafeInteger(policy.priceAtomic)
      || policy.priceAtomic < 0
      || policy.priceAtomic > MAX_PRICE_ATOMIC
      || (paidMode && policy.priceAtomic === 0)
      || (!paidMode && policy.priceAtomic !== 0)) {
      pushIssue(issues, `${path}.priceAtomic`, 'invalid_complete_price', 'The price does not match this Complete policy.');
    }
    if (policy.totalCap !== null && (
      !Number.isSafeInteger(policy.totalCap)
      || policy.totalCap <= 0
      || policy.totalCap > MAX_QUOTA
    )) {
      pushIssue(issues, `${path}.totalCap`, 'invalid_complete_cap', 'The total Complete cap must be empty or a positive integer.');
    }
  };
  validatePolicy(value.baseCompletion, 'commerce.baseCompletion');

  const declared = new Set(packIds.map(String).filter(Boolean));
  const seen = new Set();
  if (!Array.isArray(value.packPolicies)) {
    pushIssue(issues, 'commerce.packPolicies', 'invalid_pack_policies', 'Pack policies must be an array.');
  } else {
    value.packPolicies.forEach((policy, index) => {
      const path = `commerce.packPolicies[${index}]`;
      const packId = String(policy?.packId || '');
      if (!SAFE_ID.test(packId)) pushIssue(issues, `${path}.packId`, 'invalid_pack_id', 'Pack ID must be a safe identifier.');
      else if (seen.has(packId)) pushIssue(issues, `${path}.packId`, 'duplicate_pack_policy', 'Each Pack can have only one commerce policy.');
      else if (!declared.has(packId)) pushIssue(issues, `${path}.packId`, 'unknown_pack_policy', 'This commerce policy references an unknown Pack.');
      seen.add(packId);
      if (!Object.values(PACK_ACCESS_MODES).includes(policy?.accessMode)) {
        pushIssue(issues, `${path}.accessMode`, 'invalid_pack_access', 'Choose a supported Pack access policy.');
      }
      const paid = policy?.accessMode === PACK_ACCESS_MODES.ONE_TIME_PAID;
      if (!Number.isSafeInteger(policy?.purchasePriceAtomic)
        || policy.purchasePriceAtomic < 0
        || policy.purchasePriceAtomic > MAX_PRICE_ATOMIC
        || (paid && policy.purchasePriceAtomic === 0)
        || (!paid && policy.purchasePriceAtomic !== 0)) {
        pushIssue(issues, `${path}.purchasePriceAtomic`, 'invalid_pack_price', 'The purchase price does not match this Pack access policy.');
      }
      validatePolicy(policy?.completion, `${path}.completion`);
    });
  }
  if (publish) {
    declared.forEach((packId) => {
      if (!seen.has(packId)) {
        pushIssue(issues, 'commerce.packPolicies', 'missing_pack_policy', `Expansion Pack "${packId}" needs an on-chain access policy.`);
      }
    });
  }
  [
    ['soulCreatorRoyaltyBps', value.soulCreatorRoyaltyBps],
    ['makerSourceRoyaltyBps', value.makerSourceRoyaltyBps],
    ['makerResaleRoyaltyBps', value.makerResaleRoyaltyBps],
  ].forEach(([field, amount]) => {
    if (!Number.isSafeInteger(amount)
      || amount < 0
      || amount > MAX_ROYALTY_BPS
      || amount % 50 !== 0) {
      pushIssue(issues, `commerce.${field}`, 'invalid_royalty', 'Royalty must be 0% through 5% in 0.5% steps.');
    }
  });
  if ((value.soulCreatorRoyaltyBps || 0) + (value.makerSourceRoyaltyBps || 0) > 1_000) {
    pushIssue(issues, 'commerce', 'royalty_total_too_high', 'Soul creator and Maker source royalties cannot exceed 10% together.');
  }
  return issues;
}

export function validateMakerCommerceV5(value, options) {
  const issues = collectMakerCommerceV5Issues(value, options);
  if (issues.length) {
    const error = new Error(issues[0].message);
    error.name = 'MakerCommerceV5ValidationError';
    error.issues = issues;
    throw error;
  }
  return value;
}

export function expansionPackIds(document) {
  const drafts = document?.extensions?.expansionDrafts;
  if (Array.isArray(drafts) && drafts.length) {
    return [...new Set(drafts.map((pack) => String(pack?.packId || '')).filter(Boolean))];
  }
  return [...new Set(
    (Array.isArray(document?.expansionPacks) ? document.expansionPacks : [])
      .map((pack) => String(pack?.id || pack?.packId || ''))
      .filter(Boolean),
  )];
}

export function recipeUsedPackIds(document, recipe) {
  const selections = new Map(
    (Array.isArray(recipe?.selections) ? recipe.selections : [])
      .map((selection) => [String(selection?.partId || ''), {
        itemId: String(selection?.itemId || ''),
        styleId: String(selection?.styleId || ''),
      }]),
  );
  const used = new Set();
  (Array.isArray(document?.parts) ? document.parts : []).forEach((part) => {
    const selection = selections.get(String(part?.id || ''));
    if (!selection?.itemId) return;
    const item = (Array.isArray(part.items) ? part.items : [])
      .find((candidate) => String(candidate?.id || '') === selection.itemId);
    if (!item) return;
    const style = (Array.isArray(item.styles) ? item.styles : [])
      .find((candidate) => String(candidate?.id || '') === selection.styleId);
    [
      part?.expansionPackId ?? part?.packId,
      item?.expansionPackId ?? item?.packId,
      style?.expansionPackId ?? style?.packId,
    ].map((packId) => String(packId || ''))
      .filter(Boolean)
      .forEach((packId) => used.add(packId));
  });
  return [...used].sort();
}

function completionCharge(policy, walletCount, totalCount) {
  if (policy.totalCap !== null && totalCount >= policy.totalCap) {
    return { blocked: true, reason: 'TOTAL_CAP_REACHED', amount: 0 };
  }
  if (policy.mode === COMPLETION_MODES.UNLIMITED_FREE) {
    return { blocked: false, reason: 'FREE', amount: 0 };
  }
  if (policy.mode === COMPLETION_MODES.PAID_EVERY_TIME) {
    return { blocked: false, reason: 'PAID', amount: policy.priceAtomic };
  }
  if (walletCount < policy.freeQuotaPerWallet) {
    return { blocked: false, reason: 'FREE_QUOTA', amount: 0 };
  }
  if (policy.mode === COMPLETION_MODES.FREE_QUOTA_THEN_PAID) {
    return { blocked: false, reason: 'PAID_AFTER_QUOTA', amount: policy.priceAtomic };
  }
  return { blocked: true, reason: 'FREE_QUOTA_EXHAUSTED', amount: 0 };
}

export function quotePackPurchaseV5(
  commerce,
  packId,
  {
    ownedPackIds = [],
    protocol = DEFAULT_PROTOCOL_COMMERCE_V5,
  } = {},
) {
  const policy = commerce?.packPolicies?.find((entry) => entry.packId === packId);
  if (!policy) return { valid: false, reason: 'UNKNOWN_PACK', grossAtomic: 0 };
  if (ownedPackIds.includes(packId)) return { valid: false, reason: 'ALREADY_OWNED', grossAtomic: 0 };
  if (policy.accessMode === PACK_ACCESS_MODES.REQUIRED_CORE) {
    return { valid: false, reason: 'INCLUDED_CORE', grossAtomic: 0 };
  }
  const grossAtomic = policy.accessMode === PACK_ACCESS_MODES.ONE_TIME_PAID
    ? policy.purchasePriceAtomic
    : 0;
  const protocolAtomic = Math.floor(
    (grossAtomic * Number(protocol.primaryContentFeeBps || 0)) / 10_000,
  );
  return {
    valid: true,
    reason: grossAtomic ? 'PURCHASE_REQUIRED' : 'FREE_CLAIM',
    grossAtomic,
    protocolAtomic,
    makerAtomic: grossAtomic - protocolAtomic,
  };
}

export function quoteMakerPurchaseV5(
  commerce,
  {
    ownsMakerAccess = false,
    protocol = DEFAULT_PROTOCOL_COMMERCE_V5,
  } = {},
) {
  const normalized = normalizeMakerCommerceV5(commerce);
  if (normalized.makerAccess.mode === MAKER_ACCESS_MODES.FREE) {
    return { valid: false, reason: 'FREE_ACCESS', grossAtomic: 0 };
  }
  if (ownsMakerAccess) {
    return { valid: false, reason: 'ALREADY_OWNED', grossAtomic: 0 };
  }
  const grossAtomic = normalized.makerAccess.purchasePriceAtomic;
  const protocolAtomic = Math.floor(
    (grossAtomic * Number(protocol.primaryContentFeeBps || 0)) / 10_000,
  );
  return {
    valid: true,
    reason: 'PURCHASE_REQUIRED',
    grossAtomic,
    protocolAtomic,
    makerAtomic: grossAtomic - protocolAtomic,
  };
}

export function quoteCompleteV5(
  document,
  recipe,
  {
    commerce = document?.commerce,
    ownsMakerAccess = false,
    ownedPackIds = [],
    walletBaseCount = 0,
    walletPackCounts = {},
    totalBaseCount = 0,
    totalPackCounts = {},
    protocol = DEFAULT_PROTOCOL_COMMERCE_V5,
  } = {},
) {
  const normalized = normalizeMakerCommerceV5(commerce, {
    packIds: expansionPackIds(document),
  });
  const usedPackIds = recipeUsedPackIds(document, recipe);
  const missingEntitlements = [];
  const lineItems = [];
  let contentAtomic = 0;
  let blockedReason = '';

  if (
    normalized.makerAccess.mode === MAKER_ACCESS_MODES.ONE_TIME_PAID
    && !ownsMakerAccess
  ) {
    blockedReason = 'MAKER_ACCESS_REQUIRED';
  }

  const base = completionCharge(
    normalized.baseCompletion,
    boundedQuota(walletBaseCount),
    boundedQuota(totalBaseCount),
  );
  lineItems.push({ scope: 'base', ...base });
  if (base.blocked) blockedReason ||= base.reason;
  contentAtomic += base.amount;

  usedPackIds.forEach((packId) => {
    const pack = normalized.packPolicies.find((policy) => policy.packId === packId);
    if (!pack) {
      missingEntitlements.push(packId);
      return;
    }
    const owns = pack.accessMode === PACK_ACCESS_MODES.REQUIRED_CORE
      || pack.accessMode === PACK_ACCESS_MODES.FREE
      || ownedPackIds.includes(packId);
    if (!owns) {
      missingEntitlements.push(packId);
      return;
    }
    const charge = completionCharge(
      pack.completion,
      boundedQuota(walletPackCounts[packId]),
      boundedQuota(totalPackCounts[packId]),
    );
    lineItems.push({ scope: 'pack', packId, ...charge });
    if (charge.blocked) blockedReason ||= charge.reason;
    contentAtomic += charge.amount;
  });

  const fixedProtocolAtomic = boundedAtomic(protocol.fixedCompleteFeeAtomic);
  const protocolContentAtomic = Math.floor(
    (contentAtomic * Number(protocol.primaryContentFeeBps || 0)) / 10_000,
  );
  const valid = !missingEntitlements.length && !blockedReason;
  return {
    valid,
    reason: blockedReason === 'MAKER_ACCESS_REQUIRED'
      ? blockedReason
      : missingEntitlements.length
        ? 'PACK_ACCESS_REQUIRED'
        : blockedReason || 'READY',
    usedPackIds,
    missingEntitlements,
    lineItems,
    contentAtomic,
    fixedProtocolAtomic,
    protocolContentAtomic,
    protocolAtomic: fixedProtocolAtomic + protocolContentAtomic,
    makerAtomic: contentAtomic - protocolContentAtomic,
    grossAtomic: contentAtomic + fixedProtocolAtomic,
  };
}

export function canTransitionMakerStateV5(from, to) {
  if (from === to) return true;
  return {
    [ONCHAIN_MAKER_STATES.ACTIVE]: new Set([
      ONCHAIN_MAKER_STATES.PAUSED,
      ONCHAIN_MAKER_STATES.ARCHIVED,
    ]),
    [ONCHAIN_MAKER_STATES.PAUSED]: new Set([
      ONCHAIN_MAKER_STATES.ACTIVE,
      ONCHAIN_MAKER_STATES.SALE_PENDING,
      ONCHAIN_MAKER_STATES.ARCHIVED,
    ]),
    [ONCHAIN_MAKER_STATES.SALE_PENDING]: new Set([
      ONCHAIN_MAKER_STATES.PAUSED,
    ]),
    [ONCHAIN_MAKER_STATES.ARCHIVED]: new Set([
      ONCHAIN_MAKER_STATES.PAUSED,
    ]),
  }[from]?.has(to) || false;
}
