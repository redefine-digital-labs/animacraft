export const MAKER_COMMERCE_V8_SCHEMA = 'animacraft.maker-commerce.v8';
export const MAKER_PACK_COMMERCE_V8_SCHEMA = 'animacraft.expansion-pack-commerce.v8';

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

export const MAKER_V8_PACK_ENTITLEMENTS = Object.freeze({
  NONE: 'NONE',
  PACK_ACCESS: 'PACK_ACCESS',
  MAKER_ACCESS: 'MAKER_ACCESS',
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
});

const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,255}$/;
const MAX_PRICE_ATOMIC = 1_000_000_000_000;
const MAX_QUOTA = 1_000_000_000;
const MAX_ROYALTY_BPS = 1_000;
const ROYALTY_STEP_BPS = 50;
const MAX_PROTOCOL_FEE_BPS = 10_000;
const BPS_DENOMINATOR = 10_000n;
const U128_MAX = (1n << 128n) - 1n;

const COMPLETION_FIELDS = Object.freeze([
  'mode',
  'freeQuotaPerWallet',
  'priceAtomic',
  'totalCap',
]);
const ACCESS_FIELDS = Object.freeze(['mode', 'purchasePriceAtomic']);
const RIGHTS_EVIDENCE_FIELDS = Object.freeze(['licensor', 'evidenceAssetId']);
// A quote consumes trusted live-readback state. This is not an authorization;
// Move runtime object/capability proofs remain authoritative at execution.
const PACK_ENTITLEMENT_FIELDS = Object.freeze(['kind', 'verified']);
const MAKER_COMMERCE_FIELDS = Object.freeze([
  'schemaVersion',
  'rightsOrigin',
  'rightsOriginConfirmed',
  'rightsEvidence',
  'makerAccess',
  'baseCompletion',
  'soulCreatorRoyaltyBps',
  'makerSourceRoyaltyBps',
  'makerResaleRoyaltyBps',
]);
const PACK_POLICY_FIELDS = Object.freeze([
  'schemaVersion',
  'packId',
  'accessMode',
  'purchasePriceAtomic',
  'completion',
]);
const PROTOCOL_FIELDS = Object.freeze([
  'primaryContentFeeBps',
  'fixedCompleteFeeAtomic',
]);
const COMPLETE_INPUT_FIELDS = Object.freeze([
  'ownsMakerAccess',
  'makerLifecycle',
  'makerTreasuryIdentity',
  'walletBaseCount',
  'totalBaseCount',
  'usedPackLines',
  'protocol',
]);
const COMPLETE_PACK_LINE_FIELDS = Object.freeze([
  'packId',
  'policy',
  'entitlement',
  'lifecycle',
  'packTreasuryIdentity',
  'walletCompleteCount',
  'totalCompleteCount',
]);

function isPlainJsonRecord(value) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    return Reflect.ownKeys(value).every((key) => {
      if (typeof key !== 'string') return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return Boolean(descriptor?.enumerable && 'value' in descriptor);
    });
  } catch {
    return false;
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function issue(issues, path, code, message) {
  issues.push(Object.freeze({ path, code, message }));
}

function exactRecord(value, fields, path, issues, codePrefix, { partial = false } = {}) {
  if (!isPlainJsonRecord(value)) {
    issue(
      issues,
      path,
      `${codePrefix}_RECORD_INVALID`,
      `${path} must be a plain JSON object.`,
    );
    return false;
  }
  try {
    const allowed = new Set(fields);
    for (const key of Object.keys(value)) {
      if (!allowed.has(key)) {
        issue(
          issues,
          `${path}.${key}`,
          `${codePrefix}_FIELD_UNKNOWN`,
          `${path}.${key} is not part of the exact v8 schema.`,
        );
      }
    }
    if (!partial) {
      for (const key of fields) {
        if (!Object.hasOwn(value, key)) {
          issue(
            issues,
            `${path}.${key}`,
            `${codePrefix}_FIELD_REQUIRED`,
            `${path}.${key} is required by the exact v8 schema.`,
          );
        }
      }
    }
  } catch {
    issue(
      issues,
      path,
      `${codePrefix}_RECORD_UNREADABLE`,
      `${path} could not be read as a stable plain JSON object.`,
    );
    return false;
  }
  return true;
}

function throwIfIssues(issues) {
  if (issues.length) throw new MakerV8CommerceValidationError(issues);
}

function assertPartialRecord(value, fields, path) {
  const input = value === undefined ? {} : value;
  const issues = [];
  exactRecord(input, fields, path, issues, 'MAKER_V8_INPUT', { partial: true });
  throwIfIssues(issues);
  try {
    return Object.fromEntries(Object.keys(input).map((key) => [
      key,
      Object.getOwnPropertyDescriptor(input, key).value,
    ]));
  } catch {
    throwIfIssues([Object.freeze({
      path,
      code: 'MAKER_V8_INPUT_RECORD_UNREADABLE',
      message: `${path} could not be read as a stable plain JSON object.`,
    })]);
    return {};
  }
}

function isSafeIntegerWithin(value, minimum, maximum) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function isNonEmptyText(value, maximum = 512) {
  return typeof value === 'string'
    && value.length <= maximum
    && value.trim().length > 0;
}

function validateCompletionPolicy(policy, path, issues) {
  if (!exactRecord(
    policy,
    COMPLETION_FIELDS,
    path,
    issues,
    'MAKER_V8_COMPLETION',
  )) return;

  if (!Object.values(MAKER_V8_COMPLETE_MODES).includes(policy.mode)) {
    issue(issues, `${path}.mode`, 'MAKER_V8_COMPLETION_MODE_INVALID', 'Complete mode is invalid.');
    return;
  }

  const usesQuota = policy.mode === MAKER_V8_COMPLETE_MODES.FREE_QUOTA_THEN_PAID
    || policy.mode === MAKER_V8_COMPLETE_MODES.FREE_QUOTA_THEN_BLOCK;
  const isPaid = policy.mode === MAKER_V8_COMPLETE_MODES.FREE_QUOTA_THEN_PAID
    || policy.mode === MAKER_V8_COMPLETE_MODES.PAID_EVERY_TIME;

  if (!isSafeIntegerWithin(policy.freeQuotaPerWallet, 0, MAX_QUOTA)
    || (usesQuota && policy.freeQuotaPerWallet === 0)
    || (!usesQuota && policy.freeQuotaPerWallet !== 0)) {
    issue(
      issues,
      `${path}.freeQuotaPerWallet`,
      'MAKER_V8_COMPLETION_QUOTA_INVALID',
      'Complete quota does not match its mode.',
    );
  }
  if (!isSafeIntegerWithin(policy.priceAtomic, 0, MAX_PRICE_ATOMIC)
    || (isPaid && policy.priceAtomic === 0)
    || (!isPaid && policy.priceAtomic !== 0)) {
    issue(
      issues,
      `${path}.priceAtomic`,
      'MAKER_V8_COMPLETION_PRICE_INVALID',
      'Complete price does not match its mode.',
    );
  }
  if (policy.totalCap !== null && !isSafeIntegerWithin(policy.totalCap, 1, MAX_QUOTA)) {
    issue(
      issues,
      `${path}.totalCap`,
      'MAKER_V8_COMPLETION_CAP_INVALID',
      'Complete cap must be null or a positive safe integer.',
    );
  } else if (policy.totalCap !== null
    && Number.isSafeInteger(policy.freeQuotaPerWallet)
    && policy.totalCap < policy.freeQuotaPerWallet) {
    issue(
      issues,
      `${path}.totalCap`,
      'MAKER_V8_COMPLETION_CAP_BELOW_QUOTA',
      'Complete cap cannot be lower than the per-wallet free quota.',
    );
  }
}

function validateAccessPolicy(policy, path, issues) {
  if (!exactRecord(policy, ACCESS_FIELDS, path, issues, 'MAKER_V8_ACCESS')) return;
  if (!Object.values(MAKER_V8_ACCESS_MODES).includes(policy.mode)) {
    issue(issues, `${path}.mode`, 'MAKER_V8_ACCESS_MODE_INVALID', 'Maker access mode is invalid.');
    return;
  }
  const paid = policy.mode === MAKER_V8_ACCESS_MODES.ONE_TIME_PAID;
  if (!isSafeIntegerWithin(policy.purchasePriceAtomic, 0, MAX_PRICE_ATOMIC)
    || (paid && policy.purchasePriceAtomic === 0)
    || (!paid && policy.purchasePriceAtomic !== 0)) {
    issue(
      issues,
      `${path}.purchasePriceAtomic`,
      'MAKER_V8_ACCESS_PRICE_INVALID',
      'Maker access price does not match its mode.',
    );
  }
}

export class MakerV8CommerceValidationError extends Error {
  constructor(issues) {
    super(issues.map((entry) => `${entry.path}: ${entry.message}`).join('\n'));
    this.name = 'MakerV8CommerceValidationError';
    this.code = issues[0]?.code || 'MAKER_V8_COMMERCE_INVALID';
    this.issues = Object.freeze([...issues]);
  }
}

export function createMakerV8CompletionPolicy(overrides = {}) {
  const input = assertPartialRecord(overrides, COMPLETION_FIELDS, 'completion');
  const mode = input.mode ?? MAKER_V8_COMPLETE_MODES.UNLIMITED_FREE;
  const usesQuota = mode === MAKER_V8_COMPLETE_MODES.FREE_QUOTA_THEN_PAID
    || mode === MAKER_V8_COMPLETE_MODES.FREE_QUOTA_THEN_BLOCK;
  const isPaid = mode === MAKER_V8_COMPLETE_MODES.FREE_QUOTA_THEN_PAID
    || mode === MAKER_V8_COMPLETE_MODES.PAID_EVERY_TIME;
  const policy = {
    mode,
    freeQuotaPerWallet: input.freeQuotaPerWallet ?? (usesQuota ? 1 : 0),
    priceAtomic: input.priceAtomic ?? (isPaid ? 1 : 0),
    totalCap: input.totalCap === undefined ? null : input.totalCap,
  };
  const issues = [];
  validateCompletionPolicy(policy, 'completion', issues);
  throwIfIssues(issues);
  return deepFreeze(policy);
}

export function createMakerV8AccessPolicy(overrides = {}) {
  const input = assertPartialRecord(overrides, ACCESS_FIELDS, 'makerAccess');
  const mode = input.mode ?? MAKER_V8_ACCESS_MODES.FREE;
  const policy = {
    mode,
    purchasePriceAtomic: input.purchasePriceAtomic
      ?? (mode === MAKER_V8_ACCESS_MODES.ONE_TIME_PAID ? 1 : 0),
  };
  const issues = [];
  validateAccessPolicy(policy, 'makerAccess', issues);
  throwIfIssues(issues);
  return deepFreeze(policy);
}

/**
 * Creates the author-owned Base Maker commerce record. Pack policy is
 * deliberately absent: every Pack Release owns its independent policy.
 */
export function createMakerV8Commerce(overrides = {}) {
  const input = assertPartialRecord(overrides, MAKER_COMMERCE_FIELDS, 'commerce');
  const rightsOrigin = input.rightsOrigin ?? MAKER_V8_RIGHTS_ORIGINS.ONCHAIN_NATIVE;
  const commerce = {
    schemaVersion: input.schemaVersion ?? MAKER_COMMERCE_V8_SCHEMA,
    rightsOrigin,
    rightsOriginConfirmed: input.rightsOriginConfirmed ?? false,
    rightsEvidence: input.rightsEvidence === undefined
      ? (rightsOrigin === MAKER_V8_RIGHTS_ORIGINS.ONCHAIN_NATIVE ? null : undefined)
      : input.rightsEvidence,
    makerAccess: createMakerV8AccessPolicy(input.makerAccess),
    baseCompletion: createMakerV8CompletionPolicy(input.baseCompletion),
    soulCreatorRoyaltyBps: input.soulCreatorRoyaltyBps ?? 250,
    makerSourceRoyaltyBps: input.makerSourceRoyaltyBps ?? 300,
    makerResaleRoyaltyBps: input.makerResaleRoyaltyBps ?? 500,
  };
  assertMakerV8Commerce(commerce);
  return deepFreeze(commerce);
}

/** Creates one independent Pack Release commerce policy. */
export function createMakerV8PackPolicy(packId, overrides = {}) {
  const input = assertPartialRecord(overrides, PACK_POLICY_FIELDS, 'packPolicy');
  if (input.packId !== undefined && packId !== undefined && input.packId !== packId) {
    throwIfIssues([Object.freeze({
      path: 'packPolicy.packId',
      code: 'MAKER_V8_PACK_ID_MISMATCH',
      message: 'Pack policy ID does not match the requested Pack ID.',
    })]);
  }
  const accessMode = input.accessMode ?? MAKER_V8_PACK_ACCESS_MODES.FREE;
  const policy = {
    schemaVersion: input.schemaVersion ?? MAKER_PACK_COMMERCE_V8_SCHEMA,
    packId: input.packId ?? packId,
    accessMode,
    purchasePriceAtomic: input.purchasePriceAtomic
      ?? (accessMode === MAKER_V8_PACK_ACCESS_MODES.ONE_TIME_PAID ? 1 : 0),
    completion: createMakerV8CompletionPolicy(input.completion),
  };
  assertMakerV8PackPolicy(policy);
  return deepFreeze(policy);
}

function collectMakerV8CommerceIssuesUnsafe(value, options = {}) {
  const issues = [];
  const optionRecord = options === undefined ? {} : options;
  exactRecord(
    optionRecord,
    ['publish'],
    'options',
    issues,
    'MAKER_V8_OPTIONS',
    { partial: true },
  );
  const publish = isPlainJsonRecord(optionRecord) ? optionRecord.publish ?? false : false;
  if (typeof publish !== 'boolean') {
    issue(issues, 'options.publish', 'MAKER_V8_PUBLISH_FLAG_INVALID', 'Publish must be a boolean.');
  }
  if (!exactRecord(
    value,
    MAKER_COMMERCE_FIELDS,
    'commerce',
    issues,
    'MAKER_V8_COMMERCE',
  )) return Object.freeze(issues);

  if (value.schemaVersion !== MAKER_COMMERCE_V8_SCHEMA) {
    issue(
      issues,
      'commerce.schemaVersion',
      'MAKER_V8_COMMERCE_SCHEMA_INVALID',
      `Commerce schema must be ${MAKER_COMMERCE_V8_SCHEMA}.`,
    );
  }
  if (!Object.values(MAKER_V8_RIGHTS_ORIGINS).includes(value.rightsOrigin)) {
    issue(
      issues,
      'commerce.rightsOrigin',
      'MAKER_V8_RIGHTS_ORIGIN_INVALID',
      'Choose a supported rights origin.',
    );
  }
  if (typeof value.rightsOriginConfirmed !== 'boolean') {
    issue(
      issues,
      'commerce.rightsOriginConfirmed',
      'MAKER_V8_RIGHTS_CONFIRMATION_INVALID',
      'Rights confirmation must be an explicit boolean.',
    );
  } else if (publish === true && value.rightsOriginConfirmed !== true) {
    issue(
      issues,
      'commerce.rightsOriginConfirmed',
      'MAKER_V8_RIGHTS_CONFIRMATION_REQUIRED',
      'Confirm the rights origin before v8 activation.',
    );
  }

  if (value.rightsOrigin === MAKER_V8_RIGHTS_ORIGINS.ONCHAIN_NATIVE) {
    if (value.rightsEvidence !== null) {
      issue(
        issues,
        'commerce.rightsEvidence',
        'MAKER_V8_NATIVE_RIGHTS_EVIDENCE_FORBIDDEN',
        'Onchain-native rights must not carry author evidence.',
      );
    }
  } else if (value.rightsOrigin === MAKER_V8_RIGHTS_ORIGINS.LICENSE_WRAPPED) {
    if (exactRecord(
      value.rightsEvidence,
      RIGHTS_EVIDENCE_FIELDS,
      'commerce.rightsEvidence',
      issues,
      'MAKER_V8_RIGHTS_EVIDENCE',
    )) {
      if (!isNonEmptyText(value.rightsEvidence.licensor)) {
        issue(
          issues,
          'commerce.rightsEvidence.licensor',
          'MAKER_V8_RIGHTS_LICENSOR_REQUIRED',
          'License-wrapped rights require a non-empty licensor.',
        );
      }
      if (typeof value.rightsEvidence.evidenceAssetId !== 'string'
        || !SAFE_ID.test(value.rightsEvidence.evidenceAssetId)) {
        issue(
          issues,
          'commerce.rightsEvidence.evidenceAssetId',
          'MAKER_V8_RIGHTS_EVIDENCE_ASSET_REQUIRED',
          'License-wrapped rights require a local rights-evidence asset ID.',
        );
      }
    }
  }

  validateAccessPolicy(value.makerAccess, 'commerce.makerAccess', issues);
  validateCompletionPolicy(value.baseCompletion, 'commerce.baseCompletion', issues);

  const royaltyFields = [
    'soulCreatorRoyaltyBps',
    'makerSourceRoyaltyBps',
    'makerResaleRoyaltyBps',
  ];
  for (const field of royaltyFields) {
    const amount = value[field];
    if (!isSafeIntegerWithin(amount, 0, MAX_ROYALTY_BPS)
      || amount % ROYALTY_STEP_BPS !== 0) {
      issue(
        issues,
        `commerce.${field}`,
        'MAKER_V8_ROYALTY_INVALID',
        'Royalty must be 0% through 10% in 0.5% steps.',
      );
    }
  }
  if (Number.isSafeInteger(value.soulCreatorRoyaltyBps)
    && Number.isSafeInteger(value.makerSourceRoyaltyBps)
    && value.soulCreatorRoyaltyBps + value.makerSourceRoyaltyBps > MAX_ROYALTY_BPS) {
    issue(
      issues,
      'commerce',
      'MAKER_V8_ROYALTY_TOTAL_INVALID',
      'Soul creator and Maker source royalties cannot exceed 10% together.',
    );
  }
  return Object.freeze(issues);
}

export function collectMakerV8CommerceIssues(value, options = {}) {
  try {
    return collectMakerV8CommerceIssuesUnsafe(value, options);
  } catch {
    return Object.freeze([Object.freeze({
      path: 'commerce',
      code: 'MAKER_V8_COMMERCE_RECORD_UNREADABLE',
      message: 'commerce could not be read as a stable plain JSON object.',
    })]);
  }
}

function collectMakerV8PackPolicyIssuesUnsafe(value) {
  const issues = [];
  if (!exactRecord(
    value,
    PACK_POLICY_FIELDS,
    'packPolicy',
    issues,
    'MAKER_V8_PACK_POLICY',
  )) return Object.freeze(issues);

  if (value.schemaVersion !== MAKER_PACK_COMMERCE_V8_SCHEMA) {
    issue(
      issues,
      'packPolicy.schemaVersion',
      'MAKER_V8_PACK_SCHEMA_INVALID',
      `Pack policy schema must be ${MAKER_PACK_COMMERCE_V8_SCHEMA}.`,
    );
  }
  if (typeof value.packId !== 'string' || !SAFE_ID.test(value.packId)) {
    issue(issues, 'packPolicy.packId', 'MAKER_V8_PACK_ID_INVALID', 'Pack ID is invalid.');
  }
  if (!Object.values(MAKER_V8_PACK_ACCESS_MODES).includes(value.accessMode)) {
    issue(
      issues,
      'packPolicy.accessMode',
      'MAKER_V8_PACK_ACCESS_INVALID',
      'Pack access mode is invalid.',
    );
  } else {
    const paid = value.accessMode === MAKER_V8_PACK_ACCESS_MODES.ONE_TIME_PAID;
    if (!isSafeIntegerWithin(value.purchasePriceAtomic, 0, MAX_PRICE_ATOMIC)
      || (paid && value.purchasePriceAtomic === 0)
      || (!paid && value.purchasePriceAtomic !== 0)) {
      issue(
        issues,
        'packPolicy.purchasePriceAtomic',
        'MAKER_V8_PACK_PRICE_INVALID',
        'Pack price does not match its access mode.',
      );
    }
  }
  validateCompletionPolicy(value.completion, 'packPolicy.completion', issues);
  return Object.freeze(issues);
}

export function collectMakerV8PackPolicyIssues(value) {
  try {
    return collectMakerV8PackPolicyIssuesUnsafe(value);
  } catch {
    return Object.freeze([Object.freeze({
      path: 'packPolicy',
      code: 'MAKER_V8_PACK_POLICY_RECORD_UNREADABLE',
      message: 'packPolicy could not be read as a stable plain JSON object.',
    })]);
  }
}

export function assertMakerV8Commerce(value, options) {
  const issues = collectMakerV8CommerceIssues(value, options);
  throwIfIssues(issues);
  return value;
}

export function assertMakerV8PackPolicy(value) {
  const issues = collectMakerV8PackPolicyIssues(value);
  throwIfIssues(issues);
  return value;
}

export function canonicalMakerV8Commerce(value, options = {}) {
  assertMakerV8Commerce(value, options);
  return createMakerV8Commerce({
    schemaVersion: value.schemaVersion,
    rightsOrigin: value.rightsOrigin,
    rightsOriginConfirmed: value.rightsOriginConfirmed,
    rightsEvidence: value.rightsEvidence === null ? null : { ...value.rightsEvidence },
    makerAccess: { ...value.makerAccess },
    baseCompletion: { ...value.baseCompletion },
    soulCreatorRoyaltyBps: value.soulCreatorRoyaltyBps,
    makerSourceRoyaltyBps: value.makerSourceRoyaltyBps,
    makerResaleRoyaltyBps: value.makerResaleRoyaltyBps,
  });
}

export function canonicalMakerV8PackPolicy(value) {
  assertMakerV8PackPolicy(value);
  return createMakerV8PackPolicy(value.packId, {
    schemaVersion: value.schemaVersion,
    packId: value.packId,
    accessMode: value.accessMode,
    purchasePriceAtomic: value.purchasePriceAtomic,
    completion: { ...value.completion },
  });
}

function collectProtocolIssues(value, path, issues) {
  if (!exactRecord(value, PROTOCOL_FIELDS, path, issues, 'MAKER_V8_PROTOCOL')) return;
  if (!isSafeIntegerWithin(value.primaryContentFeeBps, 0, MAX_PROTOCOL_FEE_BPS)) {
    issue(
      issues,
      `${path}.primaryContentFeeBps`,
      'MAKER_V8_PROTOCOL_FEE_INVALID',
      'Primary protocol fee BPS must be a safe integer from 0 through 10,000.',
    );
  }
  if (!isSafeIntegerWithin(value.fixedCompleteFeeAtomic, 0, MAX_PRICE_ATOMIC)) {
    issue(
      issues,
      `${path}.fixedCompleteFeeAtomic`,
      'MAKER_V8_PROTOCOL_FIXED_FEE_INVALID',
      'Fixed Complete fee must be a supported safe-integer atomic amount.',
    );
  }
}

function checkedU128Add(left, right, label) {
  const result = left + right;
  if (result > U128_MAX) {
    throw new RangeError(`${label} exceeds u128.`);
  }
  return result;
}

function checkedU128Multiply(left, right, label) {
  const result = left * right;
  if (result > U128_MAX) {
    throw new RangeError(`${label} exceeds u128.`);
  }
  return result;
}

function splitAtomic(amountAtomic, feeBps) {
  const amount = BigInt(amountAtomic);
  const bps = BigInt(feeBps);
  const product = checkedU128Multiply(amount, bps, 'Protocol fee multiplication');
  const protocol = product / BPS_DENOMINATOR;
  if (amount > 0n && bps > 0n && protocol === 0n) {
    return Object.freeze({ valid: false, reason: 'PROTOCOL_SHARE_ROUNDS_TO_ZERO' });
  }
  return Object.freeze({
    valid: true,
    gross: amount,
    protocol,
    treasury: amount - protocol,
  });
}

function decimal(value) {
  return value.toString(10);
}

function quoteAmounts(gross, protocol, treasuryField, treasury) {
  return {
    grossAtomic: decimal(gross),
    protocolAtomic: decimal(protocol),
    [treasuryField]: decimal(treasury),
  };
}

function zeroQuoteAmounts(treasuryField) {
  return quoteAmounts(0n, 0n, treasuryField, 0n);
}

function normalizeQuoteInput(value, fields, path) {
  const issues = [];
  const input = value === undefined ? {} : value;
  exactRecord(input, fields, path, issues, 'MAKER_V8_QUOTE', { partial: true });
  throwIfIssues(issues);
  try {
    return Object.fromEntries(Object.keys(input).map((key) => [
      key,
      Object.getOwnPropertyDescriptor(input, key).value,
    ]));
  } catch {
    throwIfIssues([Object.freeze({
      path,
      code: 'MAKER_V8_QUOTE_RECORD_UNREADABLE',
      message: `${path} could not be read as a stable plain JSON object.`,
    })]);
    return {};
  }
}

function normalizeLifecycle(value, fallback, path, issues) {
  const lifecycle = value ?? fallback;
  if (!Object.values(MAKER_V8_LIFECYCLES).includes(lifecycle)) {
    issue(issues, path, 'MAKER_V8_LIFECYCLE_INVALID', 'Lifecycle is invalid.');
  }
  return lifecycle;
}

function normalizeBoolean(value, fallback, path, issues) {
  const result = value ?? fallback;
  if (typeof result !== 'boolean') {
    issue(issues, path, 'MAKER_V8_QUOTE_BOOLEAN_INVALID', `${path} must be a boolean.`);
  }
  return result;
}

function normalizeCount(value, fallback, path, issues) {
  const result = value ?? fallback;
  if (!isSafeIntegerWithin(result, 0, MAX_QUOTA)) {
    issue(
      issues,
      path,
      'MAKER_V8_COMPLETE_COUNT_INVALID',
      `${path} must be a supported non-negative safe integer.`,
    );
  }
  return result;
}

function normalizeIdentity(value, path, issues, { required = true } = {}) {
  const result = value ?? null;
  if (required && !isNonEmptyText(result, 256)) {
    issue(
      issues,
      path,
      'MAKER_V8_TREASURY_IDENTITY_REQUIRED',
      `${path} must identify the proven Treasury object.`,
    );
  } else if (!required && result !== null && !isNonEmptyText(result, 256)) {
    issue(
      issues,
      path,
      'MAKER_V8_TREASURY_IDENTITY_INVALID',
      `${path} must be null or a non-empty Treasury identity.`,
    );
  }
  return result;
}

function quoteProtocol(input, issues, path = 'quote.protocol') {
  const protocol = input ?? DEFAULT_MAKER_V8_PROTOCOL_COMMERCE;
  collectProtocolIssues(protocol, path, issues);
  return protocol;
}

function quoteMakerV8AccessUnsafe(commerce, inputs = {}) {
  assertMakerV8Commerce(commerce);
  const input = normalizeQuoteInput(inputs, [
    'ownsMakerAccess',
    'lifecycle',
    'makerTreasuryIdentity',
    'protocol',
  ], 'quote');
  const issues = [];
  const ownsMakerAccess = normalizeBoolean(
    input.ownsMakerAccess,
    false,
    'quote.ownsMakerAccess',
    issues,
  );
  const lifecycle = normalizeLifecycle(
    input.lifecycle,
    MAKER_V8_LIFECYCLES.ACTIVE,
    'quote.lifecycle',
    issues,
  );
  const protocol = quoteProtocol(input.protocol, issues);
  const paid = commerce.makerAccess.mode === MAKER_V8_ACCESS_MODES.ONE_TIME_PAID;
  const treasuryIdentity = normalizeIdentity(
    input.makerTreasuryIdentity,
    'quote.makerTreasuryIdentity',
    issues,
    { required: paid && !ownsMakerAccess },
  );
  throwIfIssues(issues);

  const zero = zeroQuoteAmounts('makerTreasuryAtomic');
  if (lifecycle !== MAKER_V8_LIFECYCLES.ACTIVE) {
    return deepFreeze({ valid: false, reason: 'MAKER_NOT_ACTIVE', ...zero, allocations: [] });
  }
  if (commerce.makerAccess.mode === MAKER_V8_ACCESS_MODES.FREE) {
    return deepFreeze({ valid: true, reason: 'FREE_ACCESS', ...zero, allocations: [] });
  }
  if (ownsMakerAccess) {
    return deepFreeze({ valid: false, reason: 'ALREADY_OWNED', ...zero, allocations: [] });
  }

  const split = splitAtomic(commerce.makerAccess.purchasePriceAtomic, protocol.primaryContentFeeBps);
  if (!split.valid) {
    return deepFreeze({ valid: false, reason: split.reason, ...zero, allocations: [] });
  }
  return deepFreeze({
    valid: true,
    reason: 'PURCHASE_REQUIRED',
    ...quoteAmounts(split.gross, split.protocol, 'makerTreasuryAtomic', split.treasury),
    allocations: [
      { destination: 'Protocol', amountAtomic: decimal(split.protocol) },
      {
        destination: 'MakerTreasury',
        treasuryIdentity,
        amountAtomic: decimal(split.treasury),
      },
    ],
  });
}

export function quoteMakerV8Access(commerce, inputs = {}) {
  try {
    return quoteMakerV8AccessUnsafe(commerce, inputs);
  } catch (error) {
    if (error instanceof MakerV8CommerceValidationError || error instanceof RangeError) throw error;
    throw new MakerV8CommerceValidationError([Object.freeze({
      path: 'quote',
      code: 'MAKER_V8_QUOTE_RECORD_UNREADABLE',
      message: 'quote input could not be read as stable plain JSON data.',
    })]);
  }
}

function quoteMakerV8PackUnsafe(policy, inputs = {}) {
  assertMakerV8PackPolicy(policy);
  const input = normalizeQuoteInput(inputs, [
    'ownsPackAccess',
    'hasMakerAccess',
    'lifecycle',
    'packTreasuryIdentity',
    'protocol',
  ], 'quote');
  const issues = [];
  const ownsPackAccess = normalizeBoolean(
    input.ownsPackAccess,
    false,
    'quote.ownsPackAccess',
    issues,
  );
  const hasMakerAccess = normalizeBoolean(
    input.hasMakerAccess,
    false,
    'quote.hasMakerAccess',
    issues,
  );
  const lifecycle = normalizeLifecycle(
    input.lifecycle,
    MAKER_V8_LIFECYCLES.ACTIVE,
    'quote.lifecycle',
    issues,
  );
  const protocol = quoteProtocol(input.protocol, issues);
  const paid = policy.accessMode === MAKER_V8_PACK_ACCESS_MODES.ONE_TIME_PAID;
  const treasuryIdentity = normalizeIdentity(
    input.packTreasuryIdentity,
    'quote.packTreasuryIdentity',
    issues,
    { required: paid && !ownsPackAccess },
  );
  throwIfIssues(issues);

  const zero = zeroQuoteAmounts('packTreasuryAtomic');
  if (lifecycle !== MAKER_V8_LIFECYCLES.ACTIVE) {
    return deepFreeze({ valid: false, reason: 'PACK_NOT_ACTIVE', packId: policy.packId, ...zero, allocations: [] });
  }
  if (ownsPackAccess) {
    return deepFreeze({ valid: false, reason: 'ALREADY_OWNED', packId: policy.packId, ...zero, allocations: [] });
  }
  if (policy.accessMode === MAKER_V8_PACK_ACCESS_MODES.FREE) {
    return deepFreeze({ valid: true, reason: 'FREE_CLAIM', packId: policy.packId, ...zero, allocations: [] });
  }
  if (policy.accessMode === MAKER_V8_PACK_ACCESS_MODES.INCLUDED_WITH_MAKER) {
    return deepFreeze({
      valid: hasMakerAccess,
      reason: hasMakerAccess ? 'INCLUDED_WITH_MAKER' : 'MAKER_ACCESS_REQUIRED',
      packId: policy.packId,
      ...zero,
      allocations: [],
    });
  }

  const split = splitAtomic(policy.purchasePriceAtomic, protocol.primaryContentFeeBps);
  if (!split.valid) {
    return deepFreeze({ valid: false, reason: split.reason, packId: policy.packId, ...zero, allocations: [] });
  }
  return deepFreeze({
    valid: true,
    reason: 'PURCHASE_REQUIRED',
    packId: policy.packId,
    ...quoteAmounts(split.gross, split.protocol, 'packTreasuryAtomic', split.treasury),
    allocations: [
      { destination: 'Protocol', amountAtomic: decimal(split.protocol) },
      {
        destination: 'PackTreasury',
        packId: policy.packId,
        treasuryIdentity,
        amountAtomic: decimal(split.treasury),
      },
    ],
  });
}

export function quoteMakerV8Pack(policy, inputs = {}) {
  try {
    return quoteMakerV8PackUnsafe(policy, inputs);
  } catch (error) {
    if (error instanceof MakerV8CommerceValidationError || error instanceof RangeError) throw error;
    throw new MakerV8CommerceValidationError([Object.freeze({
      path: 'quote',
      code: 'MAKER_V8_QUOTE_RECORD_UNREADABLE',
      message: 'quote input could not be read as stable plain JSON data.',
    })]);
  }
}

function completionCharge(policy, walletCount, totalCount) {
  if (policy.totalCap !== null && totalCount >= policy.totalCap) {
    return { blocked: true, reason: 'TOTAL_CAP_REACHED', amount: 0n };
  }
  if (policy.mode === MAKER_V8_COMPLETE_MODES.UNLIMITED_FREE) {
    return { blocked: false, reason: 'FREE', amount: 0n };
  }
  if (policy.mode === MAKER_V8_COMPLETE_MODES.PAID_EVERY_TIME) {
    return { blocked: false, reason: 'PAID', amount: BigInt(policy.priceAtomic) };
  }
  if (walletCount < policy.freeQuotaPerWallet) {
    return { blocked: false, reason: 'FREE_QUOTA', amount: 0n };
  }
  if (policy.mode === MAKER_V8_COMPLETE_MODES.FREE_QUOTA_THEN_PAID) {
    return { blocked: false, reason: 'PAID_AFTER_QUOTA', amount: BigInt(policy.priceAtomic) };
  }
  return { blocked: true, reason: 'FREE_QUOTA_EXHAUSTED', amount: 0n };
}

function validateCompleteInputs(inputs) {
  const input = normalizeQuoteInput(inputs, COMPLETE_INPUT_FIELDS, 'quote');
  const issues = [];
  const ownsMakerAccess = normalizeBoolean(
    input.ownsMakerAccess,
    false,
    'quote.ownsMakerAccess',
    issues,
  );
  const makerLifecycle = normalizeLifecycle(
    input.makerLifecycle,
    MAKER_V8_LIFECYCLES.ACTIVE,
    'quote.makerLifecycle',
    issues,
  );
  const makerTreasuryIdentity = normalizeIdentity(
    input.makerTreasuryIdentity,
    'quote.makerTreasuryIdentity',
    issues,
  );
  const walletBaseCount = normalizeCount(
    input.walletBaseCount,
    0,
    'quote.walletBaseCount',
    issues,
  );
  const totalBaseCount = normalizeCount(
    input.totalBaseCount,
    0,
    'quote.totalBaseCount',
    issues,
  );
  const protocol = quoteProtocol(input.protocol, issues);
  const usedPackLines = input.usedPackLines ?? [];
  if (!Array.isArray(usedPackLines)) {
    issue(
      issues,
      'quote.usedPackLines',
      'MAKER_V8_COMPLETE_PACK_LINES_INVALID',
      'Used Pack lines must be an ordered array.',
    );
  }

  const normalizedLines = [];
  const seenPackIds = new Set();
  if (Array.isArray(usedPackLines)) {
    usedPackLines.forEach((line, index) => {
      const path = `quote.usedPackLines[${index}]`;
      const exact = exactRecord(
        line,
        COMPLETE_PACK_LINE_FIELDS,
        path,
        issues,
        'MAKER_V8_COMPLETE_PACK_LINE',
      );
      if (!exact) return;
      if (typeof line.packId !== 'string' || !SAFE_ID.test(line.packId)) {
        issue(issues, `${path}.packId`, 'MAKER_V8_PACK_ID_INVALID', 'Pack ID is invalid.');
      } else if (seenPackIds.has(line.packId)) {
        issue(
          issues,
          `${path}.packId`,
          'MAKER_V8_COMPLETE_PACK_DUPLICATE',
          'Used Pack lines cannot contain duplicate Pack IDs.',
        );
      }
      seenPackIds.add(line.packId);

      const policyIssues = collectMakerV8PackPolicyIssues(line.policy);
      for (const policyIssue of policyIssues) {
        const suffix = policyIssue.path === 'packPolicy'
          ? ''
          : policyIssue.path.slice('packPolicy'.length);
        issue(
          issues,
          `${path}.policy${suffix}`,
          policyIssue.code,
          policyIssue.message,
        );
      }
      if (isPlainJsonRecord(line.policy) && line.policy.packId !== line.packId) {
        issue(
          issues,
          `${path}.policy.packId`,
          'MAKER_V8_COMPLETE_PACK_ID_MISMATCH',
          'Used Pack line ID must match its independent policy ID.',
        );
      }
      if (exactRecord(
        line.entitlement,
        PACK_ENTITLEMENT_FIELDS,
        `${path}.entitlement`,
        issues,
        'MAKER_V8_PACK_ENTITLEMENT',
      )) {
        if (!Object.values(MAKER_V8_PACK_ENTITLEMENTS).includes(line.entitlement.kind)) {
          issue(
            issues,
            `${path}.entitlement.kind`,
            'MAKER_V8_PACK_ENTITLEMENT_INVALID',
            'Pack entitlement proof kind is invalid.',
          );
        }
        if (typeof line.entitlement.verified !== 'boolean') {
          issue(
            issues,
            `${path}.entitlement.verified`,
            'MAKER_V8_PACK_ENTITLEMENT_VERIFICATION_INVALID',
            'Pack entitlement readback verification must be a boolean.',
          );
        }
        if (line.entitlement.kind === MAKER_V8_PACK_ENTITLEMENTS.NONE
          && line.entitlement.verified !== false) {
          issue(
            issues,
            `${path}.entitlement`,
            'MAKER_V8_PACK_ENTITLEMENT_NONE_INVALID',
            'A NONE entitlement readback cannot be verified.',
          );
        }
      }
      const lifecycle = normalizeLifecycle(
        line.lifecycle,
        undefined,
        `${path}.lifecycle`,
        issues,
      );
      if (lifecycle !== undefined && lifecycle !== MAKER_V8_LIFECYCLES.ACTIVE) {
        issue(
          issues,
          `${path}.lifecycle`,
          'MAKER_V8_COMPLETE_PACK_NOT_ACTIVE',
          'Every used Pack line must prove the current ACTIVE lifecycle.',
        );
      }
      const packTreasuryIdentity = normalizeIdentity(
        line.packTreasuryIdentity,
        `${path}.packTreasuryIdentity`,
        issues,
      );
      const walletCompleteCount = normalizeCount(
        line.walletCompleteCount,
        undefined,
        `${path}.walletCompleteCount`,
        issues,
      );
      const totalCompleteCount = normalizeCount(
        line.totalCompleteCount,
        undefined,
        `${path}.totalCompleteCount`,
        issues,
      );
      normalizedLines.push({
        packId: line.packId,
        policy: line.policy,
        entitlement: line.entitlement,
        lifecycle,
        packTreasuryIdentity,
        walletCompleteCount,
        totalCompleteCount,
      });
    });
  }
  throwIfIssues(issues);
  return {
    ownsMakerAccess,
    makerLifecycle,
    makerTreasuryIdentity,
    walletBaseCount,
    totalBaseCount,
    protocol,
    usedPackLines: normalizedLines,
  };
}

function emptyCompleteQuote(reason, usedPackIds, missingEntitlements, lineItems) {
  return deepFreeze({
    valid: false,
    reason,
    usedPackIds,
    missingEntitlements,
    lineItems,
    contentAtomic: '0',
    fixedProtocolAtomic: '0',
    protocolContentAtomic: '0',
    protocolAtomic: '0',
    makerTreasuryAtomic: '0',
    packTreasuryAtomic: '0',
    grossAtomic: '0',
    allocations: [],
  });
}

function quoteMakerV8CompleteUnsafe(commerce, inputs = {}) {
  assertMakerV8Commerce(commerce);
  const input = validateCompleteInputs(inputs);
  const usedPackIds = input.usedPackLines.map((line) => line.packId);
  const missingEntitlements = [];
  const pendingLines = [];
  let blockedReason = '';

  if (input.makerLifecycle !== MAKER_V8_LIFECYCLES.ACTIVE) {
    blockedReason = 'MAKER_NOT_ACTIVE';
  } else if (commerce.makerAccess.mode === MAKER_V8_ACCESS_MODES.ONE_TIME_PAID
    && !input.ownsMakerAccess) {
    blockedReason = 'MAKER_ACCESS_REQUIRED';
  }

  const baseCharge = blockedReason
    ? { blocked: true, reason: blockedReason, amount: 0n }
    : completionCharge(
      commerce.baseCompletion,
      input.walletBaseCount,
      input.totalBaseCount,
    );
  if (baseCharge.blocked) blockedReason ||= baseCharge.reason;
  pendingLines.push({
    scope: 'base',
    reason: baseCharge.reason,
    amount: baseCharge.amount,
    treasuryIdentity: input.makerTreasuryIdentity,
    treasuryDestination: 'MakerTreasury',
  });

  for (const line of input.usedPackLines) {
    let charge;
    if (line.lifecycle !== MAKER_V8_LIFECYCLES.ACTIVE) {
      charge = { blocked: true, reason: 'PACK_NOT_ACTIVE', amount: 0n };
    } else {
      const includedByMaker = line.entitlement.verified === true
        && line.entitlement.kind === MAKER_V8_PACK_ENTITLEMENTS.MAKER_ACCESS
        && line.policy.accessMode === MAKER_V8_PACK_ACCESS_MODES.INCLUDED_WITH_MAKER
        && (commerce.makerAccess.mode === MAKER_V8_ACCESS_MODES.FREE || input.ownsMakerAccess);
      const hasPackAccess = line.entitlement.verified === true
        && line.entitlement.kind === MAKER_V8_PACK_ENTITLEMENTS.PACK_ACCESS;
      if (!includedByMaker && !hasPackAccess) {
        missingEntitlements.push(line.packId);
        charge = { blocked: true, reason: 'PACK_ACCESS_REQUIRED', amount: 0n };
      } else {
        charge = completionCharge(
          line.policy.completion,
          line.walletCompleteCount,
          line.totalCompleteCount,
        );
      }
    }
    if (charge.blocked) blockedReason ||= charge.reason;
    pendingLines.push({
      scope: 'pack',
      packId: line.packId,
      reason: charge.reason,
      amount: charge.amount,
      treasuryIdentity: line.packTreasuryIdentity,
      treasuryDestination: 'PackTreasury',
    });
  }

  if (blockedReason) {
    const lineItems = pendingLines.map((line) => deepFreeze({
      scope: line.scope,
      ...(line.packId ? { packId: line.packId } : {}),
      reason: line.reason,
      contentAtomic: '0',
      protocolAtomic: '0',
      treasuryAtomic: '0',
    }));
    return emptyCompleteQuote(blockedReason, usedPackIds, missingEntitlements, lineItems);
  }

  let content = 0n;
  let protocolContent = 0n;
  let makerTreasury = 0n;
  let packTreasury = 0n;
  const lineItems = [];
  const packAllocations = [];
  for (const line of pendingLines) {
    const split = splitAtomic(line.amount, input.protocol.primaryContentFeeBps);
    if (!split.valid) {
      const zeroLines = pendingLines.map((entry) => deepFreeze({
        scope: entry.scope,
        ...(entry.packId ? { packId: entry.packId } : {}),
        reason: entry === line ? split.reason : entry.reason,
        contentAtomic: '0',
        protocolAtomic: '0',
        treasuryAtomic: '0',
      }));
      return emptyCompleteQuote(
        split.reason,
        usedPackIds,
        missingEntitlements,
        zeroLines,
      );
    }
    content = checkedU128Add(content, split.gross, 'Complete content aggregate');
    protocolContent = checkedU128Add(
      protocolContent,
      split.protocol,
      'Complete protocol aggregate',
    );
    if (line.scope === 'base') {
      makerTreasury = checkedU128Add(
        makerTreasury,
        split.treasury,
        'Maker Treasury aggregate',
      );
    } else {
      packTreasury = checkedU128Add(
        packTreasury,
        split.treasury,
        'Pack Treasury aggregate',
      );
      packAllocations.push({
        destination: 'PackTreasury',
        packId: line.packId,
        treasuryIdentity: line.treasuryIdentity,
        amountAtomic: decimal(split.treasury),
      });
    }
    lineItems.push({
      scope: line.scope,
      ...(line.packId ? { packId: line.packId } : {}),
      reason: line.reason,
      contentAtomic: decimal(split.gross),
      protocolAtomic: decimal(split.protocol),
      treasuryAtomic: decimal(split.treasury),
      treasuryDestination: line.treasuryDestination,
      treasuryIdentity: line.treasuryIdentity,
    });
  }

  const fixedProtocol = BigInt(input.protocol.fixedCompleteFeeAtomic);
  const protocolTotal = checkedU128Add(
    protocolContent,
    fixedProtocol,
    'Complete protocol total',
  );
  const gross = checkedU128Add(content, fixedProtocol, 'Complete gross total');
  return deepFreeze({
    valid: true,
    reason: 'READY',
    usedPackIds,
    missingEntitlements,
    lineItems,
    contentAtomic: decimal(content),
    fixedProtocolAtomic: decimal(fixedProtocol),
    protocolContentAtomic: decimal(protocolContent),
    protocolAtomic: decimal(protocolTotal),
    makerTreasuryAtomic: decimal(makerTreasury),
    packTreasuryAtomic: decimal(packTreasury),
    grossAtomic: decimal(gross),
    allocations: [
      { destination: 'Protocol', amountAtomic: decimal(protocolTotal) },
      {
        destination: 'MakerTreasury',
        treasuryIdentity: input.makerTreasuryIdentity,
        amountAtomic: decimal(makerTreasury),
      },
      ...packAllocations,
    ],
  });
}

export function quoteMakerV8Complete(commerce, inputs = {}) {
  try {
    return quoteMakerV8CompleteUnsafe(commerce, inputs);
  } catch (error) {
    if (error instanceof MakerV8CommerceValidationError || error instanceof RangeError) throw error;
    throw new MakerV8CommerceValidationError([Object.freeze({
      path: 'quote',
      code: 'MAKER_V8_QUOTE_RECORD_UNREADABLE',
      message: 'quote input could not be read as stable plain JSON data.',
    })]);
  }
}

export function canTransitionMakerV8Lifecycle(from, to) {
  if (from === to && Object.values(MAKER_V8_LIFECYCLES).includes(from)) return true;
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
