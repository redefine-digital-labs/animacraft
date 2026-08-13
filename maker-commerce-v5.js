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

export const MAKER_COMMERCE_V5_RELEASE_REASONS = Object.freeze({
  INVALID_COMMERCE: 'invalid_commerce',
  INVALID_LEGACY_ROYALTY: 'invalid_legacy_royalty',
  RIGHTS_ONCHAIN_NATIVE: 'rights_onchain_native',
  RIGHTS_ORIGIN_CONFIRMED: 'rights_origin_confirmed',
  EMBEDDED_EXPANSION_PACK: 'embedded_expansion_pack',
  PACK_PAID_ACCESS: 'pack_paid_access',
  PACK_COMPLETION_POLICY: 'pack_completion_policy',
  MAKER_PAID_ACCESS: 'maker_paid_access',
  BASE_COMPLETION_POLICY: 'base_completion_policy',
  MAKER_SOURCE_ROYALTY_MISMATCH: 'maker_source_royalty_mismatch',
  SOUL_CREATOR_ROYALTY: 'soul_creator_royalty',
  MAKER_RESALE_ROYALTY: 'maker_resale_royalty',
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

const MAKER_COMMERCE_V5_RELEASE_ISSUES = Object.freeze({
  [MAKER_COMMERCE_V5_RELEASE_REASONS.INVALID_COMMERCE]: Object.freeze({
    code: 'commerce_v5_invalid_commerce',
    path: 'commerce',
    message: 'Commerce settings are malformed and cannot be safely represented by a legacy v4 release.',
  }),
  [MAKER_COMMERCE_V5_RELEASE_REASONS.INVALID_LEGACY_ROYALTY]: Object.freeze({
    code: 'commerce_v5_invalid_legacy_royalty',
    path: 'publication.royaltyBps',
    message: 'The legacy publication royalty is invalid, so Commerce royalty compatibility cannot be proven.',
  }),
  [MAKER_COMMERCE_V5_RELEASE_REASONS.RIGHTS_ONCHAIN_NATIVE]: Object.freeze({
    code: 'commerce_v5_rights_onchain_native',
    path: 'commerce.rightsOrigin',
    message: 'On-chain-native rights require the Commerce v5 release gate.',
  }),
  [MAKER_COMMERCE_V5_RELEASE_REASONS.RIGHTS_ORIGIN_CONFIRMED]: Object.freeze({
    code: 'commerce_v5_rights_origin_confirmed',
    path: 'commerce.rightsOriginConfirmed',
    message: 'Traditional-license rights were confirmed early. Withdraw the early confirmation in Commerce & Rights, or wait for Commerce v5.',
  }),
  [MAKER_COMMERCE_V5_RELEASE_REASONS.EMBEDDED_EXPANSION_PACK]: Object.freeze({
    code: 'commerce_v5_embedded_expansion_pack',
    path: 'commerce.packPolicies',
    message: 'Embedded Expansion Packs require the Commerce v5 release gate; independent Pack drafts do not block the parent Maker.',
  }),
  [MAKER_COMMERCE_V5_RELEASE_REASONS.PACK_PAID_ACCESS]: Object.freeze({
    code: 'commerce_v5_pack_paid_access',
    path: 'commerce.packPolicies',
    message: 'Paid Expansion Pack access requires the Commerce v5 release gate.',
  }),
  [MAKER_COMMERCE_V5_RELEASE_REASONS.PACK_COMPLETION_POLICY]: Object.freeze({
    code: 'commerce_v5_pack_completion_policy',
    path: 'commerce.packPolicies',
    message: 'Expansion Pack Complete quotas, prices or caps require the Commerce v5 release gate.',
  }),
  [MAKER_COMMERCE_V5_RELEASE_REASONS.MAKER_PAID_ACCESS]: Object.freeze({
    code: 'commerce_v5_maker_paid_access',
    path: 'commerce.makerAccess',
    message: 'Paid Maker access requires the Commerce v5 release gate.',
  }),
  [MAKER_COMMERCE_V5_RELEASE_REASONS.BASE_COMPLETION_POLICY]: Object.freeze({
    code: 'commerce_v5_base_completion_policy',
    path: 'commerce.baseCompletion',
    message: 'Maker Complete quotas, prices or caps require the Commerce v5 release gate.',
  }),
  [MAKER_COMMERCE_V5_RELEASE_REASONS.MAKER_SOURCE_ROYALTY_MISMATCH]: Object.freeze({
    code: 'commerce_v5_maker_source_royalty_mismatch',
    path: 'commerce.makerSourceRoyaltyBps',
    message: 'The Maker source royalty must exactly match the legacy publication royalty while the Commerce v5 gate is closed.',
  }),
  [MAKER_COMMERCE_V5_RELEASE_REASONS.SOUL_CREATOR_ROYALTY]: Object.freeze({
    code: 'commerce_v5_soul_creator_royalty',
    path: 'commerce.soulCreatorRoyaltyBps',
    message: 'A custom Soul creator royalty requires the Commerce v5 release gate.',
  }),
  [MAKER_COMMERCE_V5_RELEASE_REASONS.MAKER_RESALE_ROYALTY]: Object.freeze({
    code: 'commerce_v5_maker_resale_royalty',
    path: 'commerce.makerResaleRoyaltyBps',
    message: 'A custom Maker resale royalty requires the Commerce v5 release gate.',
  }),
});

function canonicalRoyaltyBps(value) {
  return Boolean(
    Number.isSafeInteger(value)
    && value >= 0
    && value <= MAX_ROYALTY_BPS
    && value % 50 === 0
  );
}

/**
 * Returns every stable reason that prevents a Commerce-v5 draft from being
 * projected into a legacy v4 release. Reasons are emitted in a fixed order so
 * Preflight, tests and other callers can render the same diagnosis.
 */
export function makerCommerceV5ReleaseReasons(value, options = {}) {
  const { packIds = [] } = options;
  const declaredPackIds = [...new Set(packIds.map(String).filter(Boolean))];
  const legacyPublicationRoyaltyBps = options.legacyPublicationRoyaltyBps;
  const source = value;
  if (collectMakerCommerceV5Issues(source, {
    packIds: declaredPackIds,
    publish: false,
  }).length) {
    return [MAKER_COMMERCE_V5_RELEASE_REASONS.INVALID_COMMERCE];
  }

  const reasons = [];
  const normalized = normalizeMakerCommerceV5(source, {
    packIds: declaredPackIds,
  });
  const defaults = createDefaultMakerCommerceV5();
  const hasLegacyPublicationRoyaltyContext = Object.hasOwn(
    options,
    'legacyPublicationRoyaltyBps',
  );
  if (
    hasLegacyPublicationRoyaltyContext
    && !canonicalRoyaltyBps(legacyPublicationRoyaltyBps)
  ) {
    reasons.push(MAKER_COMMERCE_V5_RELEASE_REASONS.INVALID_LEGACY_ROYALTY);
  }

  if (normalized.rightsOrigin === RIGHTS_ORIGINS.ONCHAIN_NATIVE) {
    reasons.push(MAKER_COMMERCE_V5_RELEASE_REASONS.RIGHTS_ONCHAIN_NATIVE);
  }
  if (
    normalized.rightsOrigin === RIGHTS_ORIGINS.LICENSE_WRAPPED
    && normalized.rightsOriginConfirmed === true
  ) {
    reasons.push(MAKER_COMMERCE_V5_RELEASE_REASONS.RIGHTS_ORIGIN_CONFIRMED);
  }

  if (declaredPackIds.length > 0 || source.packPolicies.length > 0) {
    reasons.push(MAKER_COMMERCE_V5_RELEASE_REASONS.EMBEDDED_EXPANSION_PACK);
  }
  if (normalized.packPolicies.some((policy) => (
    policy.accessMode === PACK_ACCESS_MODES.ONE_TIME_PAID
  ))) {
    reasons.push(MAKER_COMMERCE_V5_RELEASE_REASONS.PACK_PAID_ACCESS);
  }
  if (normalized.packPolicies.some((policy) => (
    completionPolicyRequiresV5(policy.completion)
  ))) {
    reasons.push(MAKER_COMMERCE_V5_RELEASE_REASONS.PACK_COMPLETION_POLICY);
  }

  if (normalized.makerAccess.mode === MAKER_ACCESS_MODES.ONE_TIME_PAID) {
    reasons.push(MAKER_COMMERCE_V5_RELEASE_REASONS.MAKER_PAID_ACCESS);
  }
  if (completionPolicyRequiresV5(normalized.baseCompletion)) {
    reasons.push(MAKER_COMMERCE_V5_RELEASE_REASONS.BASE_COMPLETION_POLICY);
  }

  const makerSourceRoyaltyMirrorsLegacyPublication = Boolean(
    hasLegacyPublicationRoyaltyContext
    && canonicalRoyaltyBps(legacyPublicationRoyaltyBps)
    && source.makerSourceRoyaltyBps === legacyPublicationRoyaltyBps
  );
  // v1 Makers created by the affected legacy UI wrote publication=300 while
  // leaving Commerce at its synthetic default 250. This narrow, explicit
  // compatibility option is never inferred by the model helper itself.
  const knownLegacyDefaultRoyaltyMismatch = Boolean(
    options.allowLegacyDefaultRoyaltyFallback === true
    && source.makerSourceRoyaltyBps === defaults.makerSourceRoyaltyBps
    && legacyPublicationRoyaltyBps === 300
  );
  if (
    hasLegacyPublicationRoyaltyContext
      ? !makerSourceRoyaltyMirrorsLegacyPublication && !knownLegacyDefaultRoyaltyMismatch
      : source.makerSourceRoyaltyBps !== defaults.makerSourceRoyaltyBps
  ) {
    reasons.push(MAKER_COMMERCE_V5_RELEASE_REASONS.MAKER_SOURCE_ROYALTY_MISMATCH);
  }
  if (normalized.soulCreatorRoyaltyBps !== defaults.soulCreatorRoyaltyBps) {
    reasons.push(MAKER_COMMERCE_V5_RELEASE_REASONS.SOUL_CREATOR_ROYALTY);
  }
  if (normalized.makerResaleRoyaltyBps !== defaults.makerResaleRoyaltyBps) {
    reasons.push(MAKER_COMMERCE_V5_RELEASE_REASONS.MAKER_RESALE_ROYALTY);
  }
  return reasons;
}

export function makerCommerceV5ReleaseIssues(value, options = {}) {
  return makerCommerceV5ReleaseReasons(value, options)
    .map((reason) => ({
      reason,
      ...MAKER_COMMERCE_V5_RELEASE_ISSUES[reason],
    }));
}

export function makerCommerceV5RequiresRelease(
  value,
  options = {},
) {
  return makerCommerceV5ReleaseReasons(value, options).length > 0;
}

export function makerCommerceV5AllowsLegacyDefaultRoyaltyFallback(
  document,
  context = {},
) {
  return Boolean(
    document?.version?.number === 1
    && document.version.parentVersionId === null
    && document.version.createdAt === null
    && context.isPublished !== true
    && !context.publishedDocument
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
