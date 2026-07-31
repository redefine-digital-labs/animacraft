import {
  COMMERCE_V5_ACCESS,
  COMMERCE_V5_COMPLETE_POLICY,
  COMMERCE_V5_RIGHTS,
  COMMERCE_V5_STYLE_ROW,
} from './chain-commerce-v5.js';
import {
  MAKER_V4_COLOR_STYLE_KEY_PREFIX_V5,
  MAKER_V4_COMMERCE_STYLE_ROW_V5,
  MAKER_V4_NONE_STYLE_KEY_V5,
} from './maker-publication-v4.js';
import {
  COMPLETION_MODES,
  MAKER_ACCESS_MODES,
  PACK_ACCESS_MODES,
  RIGHTS_ORIGINS,
} from './maker-commerce-v5.js';

const RIGHTS = Object.freeze({
  [RIGHTS_ORIGINS.ONCHAIN_NATIVE]: COMMERCE_V5_RIGHTS.ONCHAIN_NATIVE,
  [RIGHTS_ORIGINS.LICENSE_WRAPPED]: COMMERCE_V5_RIGHTS.LICENSE_WRAPPED,
});

const COMPLETE_MODES = Object.freeze({
  [COMPLETION_MODES.UNLIMITED_FREE]: COMMERCE_V5_COMPLETE_POLICY.UNLIMITED_FREE,
  [COMPLETION_MODES.FREE_QUOTA_THEN_PAID]:
    COMMERCE_V5_COMPLETE_POLICY.FREE_QUOTA_THEN_PAID,
  [COMPLETION_MODES.PAID_EVERY_TIME]: COMMERCE_V5_COMPLETE_POLICY.PAID_EVERY_TIME,
  [COMPLETION_MODES.FREE_QUOTA_THEN_BLOCK]:
    COMMERCE_V5_COMPLETE_POLICY.FREE_QUOTA_THEN_BLOCK,
});

const ACCESS = Object.freeze({
  [MAKER_ACCESS_MODES.FREE]: COMMERCE_V5_ACCESS.FREE,
  [MAKER_ACCESS_MODES.ONE_TIME_PAID]: COMMERCE_V5_ACCESS.PAID_ONCE,
  [PACK_ACCESS_MODES.FREE]: COMMERCE_V5_ACCESS.FREE,
  [PACK_ACCESS_MODES.REQUIRED_CORE]: COMMERCE_V5_ACCESS.FREE,
  [PACK_ACCESS_MODES.ONE_TIME_PAID]: COMMERCE_V5_ACCESS.PAID_ONCE,
});

const STYLE_ROWS = Object.freeze({
  [MAKER_V4_COMMERCE_STYLE_ROW_V5.VISUAL]:
    COMMERCE_V5_STYLE_ROW.VISUAL,
  [MAKER_V4_COMMERCE_STYLE_ROW_V5.LOGICAL_NONE]:
    COMMERCE_V5_STYLE_ROW.LOGICAL_NONE,
  [MAKER_V4_COMMERCE_STYLE_ROW_V5.LOGICAL_COLOR]:
    COMMERCE_V5_STYLE_ROW.LOGICAL_COLOR,
});

function publicationError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function exactU64(value, label) {
  if (value === null || value === undefined) return 0n;
  if (typeof value === 'number' && !Number.isSafeInteger(value)) {
    throw publicationError(
      'COMMERCE_V5_UNSAFE_INTEGER',
      `${label} must be an exact unsigned integer.`,
    );
  }
  let result;
  try {
    result = BigInt(value);
  } catch {
    throw publicationError(
      'COMMERCE_V5_UNSAFE_INTEGER',
      `${label} must be an exact unsigned integer.`,
    );
  }
  if (result < 0n || result > ((1n << 64n) - 1n)) {
    throw publicationError(
      'COMMERCE_V5_UNSAFE_INTEGER',
      `${label} is outside the Sui u64 range.`,
    );
  }
  return result;
}

function completionPolicy(policy, label) {
  const mode = COMPLETE_MODES[policy?.mode];
  if (mode === undefined) {
    throw publicationError(
      'COMMERCE_V5_INVALID_COMPLETE_MODE',
      `${label} has an unsupported Complete mode.`,
    );
  }
  const result = {
    mode,
    freeQuotaPerWallet: exactU64(
      policy.freeQuotaPerWallet,
      `${label} free quota`,
    ),
    priceAtomic: exactU64(policy.priceAtomic, `${label} price`),
    totalCap: exactU64(policy.totalCap, `${label} global cap`),
  };
  const unlimitedFree = mode === COMMERCE_V5_COMPLETE_POLICY.UNLIMITED_FREE;
  const quotaThenPaid =
    mode === COMMERCE_V5_COMPLETE_POLICY.FREE_QUOTA_THEN_PAID;
  const paidEveryTime =
    mode === COMMERCE_V5_COMPLETE_POLICY.PAID_EVERY_TIME;
  const quotaThenBlock =
    mode === COMMERCE_V5_COMPLETE_POLICY.FREE_QUOTA_THEN_BLOCK;
  const valid = (unlimitedFree
      && result.freeQuotaPerWallet === 0n
      && result.priceAtomic === 0n)
    || (quotaThenPaid
      && result.freeQuotaPerWallet > 0n
      && result.priceAtomic > 0n)
    || (paidEveryTime
      && result.freeQuotaPerWallet === 0n
      && result.priceAtomic > 0n)
    || (quotaThenBlock
      && result.freeQuotaPerWallet > 0n
      && result.priceAtomic === 0n);
  if (!valid) {
    throw publicationError(
      'COMMERCE_V5_INVALID_COMPLETE_POLICY',
      `${label} has quota or price values that do not match its Complete mode.`,
    );
  }
  return Object.freeze(result);
}

function accessPolicy(mode, priceAtomic, label) {
  const kind = ACCESS[mode];
  if (kind === undefined) {
    throw publicationError(
      'COMMERCE_V5_INVALID_ACCESS_MODE',
      `${label} has an unsupported access mode.`,
    );
  }
  const purchasePriceAtomic = exactU64(
    priceAtomic,
    `${label} purchase price`,
  );
  if (
    (kind === COMMERCE_V5_ACCESS.FREE && purchasePriceAtomic !== 0n)
    || (kind === COMMERCE_V5_ACCESS.PAID_ONCE && purchasePriceAtomic === 0n)
  ) {
    throw publicationError(
      'COMMERCE_V5_INVALID_ACCESS_POLICY',
      `${label} has a purchase price that does not match its access mode.`,
    );
  }
  return Object.freeze({
    kind,
    purchasePriceAtomic,
  });
}

/**
 * Converts the immutable Maker projection into the exact arguments consumed
 * by the commerce_v5 migration/configuration builders. This is deliberately a
 * pure boundary: Creator labels and local UI state never reach a transaction.
 */
export function buildMakerCommerceV5DeploymentPlan(moveProjection) {
  const commerce = moveProjection?.commerce;
  if (!commerce || typeof commerce !== 'object') {
    throw publicationError(
      'COMMERCE_V5_PROJECTION_MISSING',
      'The publishable Maker projection does not contain Commerce v5.',
    );
  }
  if (commerce.rightsOriginConfirmed !== true) {
    throw publicationError(
      'COMMERCE_V5_RIGHTS_CONFIRMATION_REQUIRED',
      'Confirm whether this Maker is on-chain native or wraps a traditional license before its first Commerce v5 publication.',
    );
  }
  const logicalAuxiliaryBlobId = String(
    commerce.logicalAuxiliaryBlobId || '',
  ).trim();
  if (!logicalAuxiliaryBlobId) {
    throw publicationError(
      'COMMERCE_V5_LOGICAL_AUXILIARY_MISSING',
      'Commerce v5 requires the protocol-bound canonical logical auxiliary Walrus Blob ID.',
    );
  }
  const rightsOrigin = RIGHTS[commerce.rightsOrigin];
  if (rightsOrigin === undefined) {
    throw publicationError(
      'COMMERCE_V5_INVALID_RIGHTS',
      'The projected Maker rights origin is unsupported.',
    );
  }
  const packPolicies = Array.isArray(commerce.packPolicies)
    ? commerce.packPolicies
    : [];
  const baseAccess = accessPolicy(
    commerce.makerAccess?.mode,
    commerce.makerAccess?.purchasePriceAtomic,
    'Maker Base',
  );
  const packKeys = new Set();
  const packs = packPolicies.map((pack, index) => {
    const key = String(pack?.packId || '').trim();
    if (!key || packKeys.has(key)) {
      throw publicationError(
        'COMMERCE_V5_INVALID_PACK_PROJECTION',
        `Projected Pack ${index + 1} has a missing or duplicate key.`,
      );
    }
    packKeys.add(key);
    return Object.freeze({
      key,
      label: String(pack.label || key),
      access: accessPolicy(
        pack.accessMode,
        pack.purchasePriceAtomic,
        `Pack ${key}`,
      ),
      completePolicy: completionPolicy(
        pack.completion,
        `Pack ${key}`,
      ),
      active: true,
    });
  });

  const styleProducts = Array.isArray(commerce.styleProducts)
    ? commerce.styleProducts
    : [];
  const identities = new Set();
  const styleBindings = styleProducts.map((style, index) => {
    const partKey = String(style?.partKey || '').trim();
    const itemKey = String(style?.itemKey || '').trim();
    const styleKey = String(style?.styleKey || '').trim();
    const packKey = String(style?.packId || '').trim();
    const rowKind = STYLE_ROWS[String(style?.rowKind || '')];
    if (rowKind === undefined) {
      throw publicationError(
        'COMMERCE_V5_INVALID_STYLE_ROW_KIND',
        `Projected Style ${index + 1} does not declare a Move-verifiable row kind.`,
      );
    }
    const identity = `${partKey}\u0000${itemKey}\u0000${styleKey}`;
    if (!partKey || !itemKey || !styleKey || identities.has(identity)) {
      throw publicationError(
        'COMMERCE_V5_INVALID_STYLE_PROJECTION',
        `Projected Style ${index + 1} is missing an exact identity or is duplicated.`,
      );
    }
    if (packKey && !packKeys.has(packKey)) {
      throw publicationError(
        'COMMERCE_V5_UNKNOWN_STYLE_PACK',
        `Projected Style ${partKey}/${itemKey}/${styleKey} references unknown Pack ${packKey}.`,
      );
    }
    const logicalNone = rowKind === COMMERCE_V5_STYLE_ROW.LOGICAL_NONE;
    const logicalColor = rowKind === COMMERCE_V5_STYLE_ROW.LOGICAL_COLOR;
    const reservedNone = styleKey === MAKER_V4_NONE_STYLE_KEY_V5;
    const reservedColor = styleKey.startsWith(
      MAKER_V4_COLOR_STYLE_KEY_PREFIX_V5,
    ) && styleKey.length > MAKER_V4_COLOR_STYLE_KEY_PREFIX_V5.length;
    const validIdentity = (
      rowKind === COMMERCE_V5_STYLE_ROW.VISUAL
        && !reservedNone
        && !styleKey.startsWith(MAKER_V4_COLOR_STYLE_KEY_PREFIX_V5)
    ) || (
      logicalNone
        && reservedNone
        && !packKey
    ) || (
      logicalColor
        && reservedColor
        && !packKey
    );
    if (!validIdentity) {
      throw publicationError(
        'COMMERCE_V5_INVALID_STYLE_ROW_IDENTITY',
        `Projected Style ${partKey}/${itemKey}/${styleKey} does not match its declared row kind.`,
      );
    }
    identities.add(identity);
    return Object.freeze({
      partKey,
      itemKey,
      styleKey,
      rowKind,
      ...(packKey ? { packKey } : {}),
    });
  });
  if (!styleBindings.length
    || Number(commerce.counts?.styles) !== styleBindings.length
    || Number(commerce.counts?.packs) !== packs.length) {
    throw publicationError(
      'COMMERCE_V5_PROJECTION_COUNT_MISMATCH',
      'The projected Commerce counts do not match the sealed Pack and Style records.',
    );
  }

  const makerResaleRoyaltyBps = Number(commerce.royalties?.makerResaleBps);
  if (!Number.isInteger(makerResaleRoyaltyBps)
    || makerResaleRoyaltyBps < 0
    || makerResaleRoyaltyBps > 500
    || makerResaleRoyaltyBps % 50 !== 0) {
    throw publicationError(
      'COMMERCE_V5_INVALID_MAKER_ROYALTY',
      'The Maker resale royalty must be between 0 and 500 BPS in 50 BPS steps.',
    );
  }
  const soulCreatorRoyaltyBps = Number(commerce.royalties?.soulCreatorBps);
  if (!Number.isInteger(soulCreatorRoyaltyBps)
    || soulCreatorRoyaltyBps < 0
    || soulCreatorRoyaltyBps > 500
    || soulCreatorRoyaltyBps % 50 !== 0) {
    throw publicationError(
      'COMMERCE_V5_INVALID_SOUL_CREATOR_ROYALTY',
      'The Soul creator royalty must be between 0 and 500 BPS in 50 BPS steps.',
    );
  }
  const baseCompletePolicy = completionPolicy(
    commerce.baseCompletion,
    'Maker Base',
  );
  return Object.freeze({
    rightsOrigin,
    logicalAuxiliaryBlobId,
    migration: Object.freeze({
      rightsOrigin,
      baseCompletePolicy,
      soulCreatorRoyaltyBps,
      makerResaleRoyaltyBps,
    }),
    configuration: Object.freeze({
      baseAccess,
      baseCompletePolicy,
      soulCreatorRoyaltyBps,
      makerResaleRoyaltyBps,
      packs: Object.freeze(packs),
      styleBindings: Object.freeze(styleBindings),
      sealStyleRegistry: true,
      activate: true,
    }),
  });
}
