import { normalizeSuiAddress } from '@mysten/sui/utils';
import {
  COMMERCE_V5_ACCESS,
  COMMERCE_V5_LIFECYCLE,
  COMMERCE_V5_STYLE_ROW,
  buildActivateMakerV5,
  buildConfigureMakerV5,
  buildMigrateLegacyMakerV5,
} from './chain-commerce-v5.js';
import { appendPublishMakerSealPolicyV5 } from './maker-seal-v5.js';

export const MAKER_COMMERCE_PUBLICATION_V5_SCHEMA =
  'animacraft.maker-commerce-publication.v5';

export const MAKER_COMMERCE_PUBLICATION_V5_STAGES = Object.freeze({
  READY: 'ready',
  MIGRATION_INTENT: 'migration-intent',
  MIGRATION_SUBMITTED: 'migration-submitted',
  MIGRATED: 'migrated',
  POLICY_INTENT: 'policy-intent',
  POLICY_SUBMITTED: 'policy-submitted',
  POLICY_CONFIGURED: 'policy-configured',
  STYLES_INTENT: 'styles-intent',
  STYLES_SUBMITTED: 'styles-submitted',
  STYLES_CONFIGURING: 'styles-configuring',
  CONFIGURED: 'configured',
  SEAL_INTENT: 'seal-intent',
  SEAL_SUBMITTED: 'seal-submitted',
  SEALED: 'sealed',
  ACTIVATE_INTENT: 'activate-intent',
  ACTIVATE_SUBMITTED: 'activate-submitted',
  ACTIVE: 'active',
});

export const MAKER_COMMERCE_PUBLICATION_V5_ACTIONS = Object.freeze({
  MIGRATE: 'migrate',
  CONFIGURE_POLICY: 'configure-policy',
  CONFIGURE_STYLES: 'configure-styles',
  SEAL: 'seal',
  ACTIVATE: 'activate',
});

const ACTION_STAGE = Object.freeze({
  [MAKER_COMMERCE_PUBLICATION_V5_ACTIONS.MIGRATE]: Object.freeze({
    intent: MAKER_COMMERCE_PUBLICATION_V5_STAGES.MIGRATION_INTENT,
    submitted: MAKER_COMMERCE_PUBLICATION_V5_STAGES.MIGRATION_SUBMITTED,
  }),
  [MAKER_COMMERCE_PUBLICATION_V5_ACTIONS.CONFIGURE_POLICY]: Object.freeze({
    intent: MAKER_COMMERCE_PUBLICATION_V5_STAGES.POLICY_INTENT,
    submitted: MAKER_COMMERCE_PUBLICATION_V5_STAGES.POLICY_SUBMITTED,
  }),
  [MAKER_COMMERCE_PUBLICATION_V5_ACTIONS.CONFIGURE_STYLES]: Object.freeze({
    intent: MAKER_COMMERCE_PUBLICATION_V5_STAGES.STYLES_INTENT,
    submitted: MAKER_COMMERCE_PUBLICATION_V5_STAGES.STYLES_SUBMITTED,
  }),
  [MAKER_COMMERCE_PUBLICATION_V5_ACTIONS.SEAL]: Object.freeze({
    intent: MAKER_COMMERCE_PUBLICATION_V5_STAGES.SEAL_INTENT,
    submitted: MAKER_COMMERCE_PUBLICATION_V5_STAGES.SEAL_SUBMITTED,
  }),
  [MAKER_COMMERCE_PUBLICATION_V5_ACTIONS.ACTIVATE]: Object.freeze({
    intent: MAKER_COMMERCE_PUBLICATION_V5_STAGES.ACTIVATE_INTENT,
    submitted: MAKER_COMMERCE_PUBLICATION_V5_STAGES.ACTIVATE_SUBMITTED,
  }),
});

const PENDING_STAGES = new Map(
  Object.entries(ACTION_STAGE).flatMap(([action, stages]) => ([
    [stages.intent, Object.freeze({ action, submitted: false })],
    [stages.submitted, Object.freeze({ action, submitted: true })],
  ])),
);

const STABLE_STAGE_RANK = Object.freeze({
  [MAKER_COMMERCE_PUBLICATION_V5_STAGES.READY]: 0,
  [MAKER_COMMERCE_PUBLICATION_V5_STAGES.MIGRATED]: 1,
  [MAKER_COMMERCE_PUBLICATION_V5_STAGES.POLICY_CONFIGURED]: 2,
  [MAKER_COMMERCE_PUBLICATION_V5_STAGES.STYLES_CONFIGURING]: 3,
  [MAKER_COMMERCE_PUBLICATION_V5_STAGES.CONFIGURED]: 4,
  [MAKER_COMMERCE_PUBLICATION_V5_STAGES.SEALED]: 5,
  [MAKER_COMMERCE_PUBLICATION_V5_STAGES.ACTIVE]: 6,
});

const U64_MAX = (1n << 64n) - 1n;
const DEFAULT_STYLE_BATCH_SIZE = 100;

function publicationError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function exactU64String(value, label) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) {
    throw publicationError(
      'COMMERCE_V5_PUBLICATION_UNSAFE_INTEGER',
      `${label} must be an exact unsigned integer.`,
    );
  }
  let result;
  try {
    result = BigInt(value ?? 0);
  } catch {
    throw publicationError(
      'COMMERCE_V5_PUBLICATION_UNSAFE_INTEGER',
      `${label} must be an exact unsigned integer.`,
    );
  }
  if (result < 0n || result > U64_MAX) {
    throw publicationError(
      'COMMERCE_V5_PUBLICATION_UNSAFE_INTEGER',
      `${label} is outside the Sui u64 range.`,
    );
  }
  return result.toString();
}

function safeSequence(value, label = 'Commerce publication sequence') {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw publicationError(
      'COMMERCE_V5_PUBLICATION_INVALID_SEQUENCE',
      `${label} must be a non-negative safe integer.`,
    );
  }
  return result;
}

function requiredString(value, label) {
  const result = String(value || '').trim();
  if (!result) {
    throw publicationError(
      'COMMERCE_V5_PUBLICATION_CONTEXT_MISSING',
      `${label} is required for Commerce v5 publication recovery.`,
    );
  }
  return result;
}

function normalizedId(value, label) {
  const candidate = requiredString(value, label);
  try {
    return normalizeSuiAddress(candidate);
  } catch {
    throw publicationError(
      'COMMERCE_V5_PUBLICATION_INVALID_ID',
      `${label} must be a valid Sui object ID or address.`,
    );
  }
}

function stableValue(value) {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  if (value === undefined) return null;
  return value;
}

function stableIdentity(value) {
  return JSON.stringify(stableValue(value));
}

function nowIso(dependencies) {
  const value = dependencies?.now?.() ?? new Date().toISOString();
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw publicationError(
      'COMMERCE_V5_PUBLICATION_INVALID_TIME',
      'The injected Commerce publication clock returned an invalid time.',
    );
  }
  return date.toISOString();
}

function plainClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizedRuntimeIdentity(runtime) {
  return Object.freeze({
    network: String(runtime?.network || '').trim(),
    callablePackageId: normalizedId(
      runtime?.callablePackageId || runtime?.packageId,
      'Commerce v5 callable package ID',
    ),
    commerceV5TypeOriginPackageId: normalizedId(
      runtime?.commerceV5TypeOriginPackageId
        || runtime?.commerceTypePackageId
        || runtime?.typeOriginPackageId
        || runtime?.callablePackageId
        || runtime?.packageId,
      'Commerce v5 type-origin package ID',
    ),
    paymentCoinType: requiredString(
      runtime?.paymentCoinType,
      'Commerce v5 payment coin type',
    ),
  });
}

export function normalizeMakerCommerceV5PublicationContext(context, runtime) {
  const normalizedRuntime = normalizedRuntimeIdentity(runtime);
  return Object.freeze({
    makerKey: requiredString(context?.makerKey, 'Maker recovery key'),
    owner: normalizedId(context?.owner, 'Maker owner'),
    legacyMakerId: normalizedId(context?.legacyMakerId, 'Legacy OCMaker ID'),
    legacyMakerTreasuryId: normalizedId(
      context?.legacyMakerTreasuryId,
      'Legacy MakerTreasury ID',
    ),
    legacyMakerAdminCapId: normalizedId(
      context?.legacyMakerAdminCapId,
      'Legacy MakerAdminCap ID',
    ),
    legacyMakerTreasuryBalanceAtomic: exactU64String(
      context?.legacyMakerTreasuryBalanceAtomic ?? 0,
      'Legacy Maker treasury balance',
    ),
    protocolConfigId: normalizedId(
      context?.protocolConfigId,
      'CommerceProtocolConfigV5 ID',
    ),
    protocolTreasuryId: normalizedId(
      context?.protocolTreasuryId,
      'CommerceProtocolTreasuryV5 ID',
    ),
    v4PublicationDigest: requiredString(
      context?.v4PublicationDigest,
      'Legacy Maker publication digest',
    ),
    manifestBlobId: requiredString(
      context?.manifestBlobId,
      'Published Maker Manifest Blob ID',
    ),
    ...normalizedRuntime,
  });
}

function planIdentity(plan) {
  if (!plan?.migration || !plan?.configuration) {
    throw publicationError(
      'COMMERCE_V5_PUBLICATION_PLAN_MISSING',
      'A validated Maker Commerce v5 deployment plan is required.',
    );
  }
  return stableIdentity(plan);
}

export function createMakerCommerceV5PublicationCheckpoint({
  context,
  runtime,
  plan,
  createdAt,
} = {}) {
  const normalizedContext = normalizeMakerCommerceV5PublicationContext(context, runtime);
  const timestamp = createdAt
    ? new Date(createdAt).toISOString()
    : new Date().toISOString();
  return Object.freeze({
    schema: MAKER_COMMERCE_PUBLICATION_V5_SCHEMA,
    version: 1,
    sequence: 0,
    context: plainClone(normalizedContext),
    contextIdentity: stableIdentity(normalizedContext),
    planIdentity: planIdentity(plan),
    stage: MAKER_COMMERCE_PUBLICATION_V5_STAGES.READY,
    action: '',
    intent: null,
    digests: {
      migration: '',
      policy: '',
      styleBatches: [],
      seal: '',
      activate: '',
    },
    objects: {
      rootId: '',
      makerTreasuryId: '',
      controlCapId: '',
      vaultId: '',
    },
    confirmedStyleCount: 0,
    readbackVerified: false,
    completed: false,
    lastError: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export function hydrateMakerCommerceV5PublicationCheckpoint(
  value,
  { context, runtime, plan } = {},
) {
  if (!value || value.schema !== MAKER_COMMERCE_PUBLICATION_V5_SCHEMA || value.version !== 1) {
    throw publicationError(
      'COMMERCE_V5_PUBLICATION_CHECKPOINT_INVALID',
      'The saved Commerce publication checkpoint is not a supported v5 record.',
    );
  }
  const sequence = safeSequence(value.sequence);
  if (!Object.values(MAKER_COMMERCE_PUBLICATION_V5_STAGES).includes(value.stage)) {
    throw publicationError(
      'COMMERCE_V5_PUBLICATION_CHECKPOINT_INVALID',
      'The saved Commerce publication checkpoint has an unknown stage.',
    );
  }
  const hydrated = {
    ...plainClone(value),
    sequence,
    digests: {
      migration: String(value.digests?.migration || ''),
      policy: String(value.digests?.policy || ''),
      styleBatches: Array.isArray(value.digests?.styleBatches)
        ? value.digests.styleBatches.map(String)
        : [],
      seal: String(value.digests?.seal || ''),
      activate: String(value.digests?.activate || ''),
    },
    objects: {
      rootId: String(value.objects?.rootId || ''),
      makerTreasuryId: String(value.objects?.makerTreasuryId || ''),
      controlCapId: String(value.objects?.controlCapId || ''),
      vaultId: String(value.objects?.vaultId || ''),
    },
    confirmedStyleCount: safeSequence(
      value.confirmedStyleCount || 0,
      'Confirmed Style count',
    ),
    readbackVerified: value.readbackVerified === true,
    completed: value.completed === true,
  };
  if (context || runtime || plan) {
    const expectedContext = normalizeMakerCommerceV5PublicationContext(context, runtime);
    if (
      hydrated.contextIdentity !== stableIdentity(expectedContext)
      || hydrated.planIdentity !== planIdentity(plan)
    ) {
      throw publicationError(
        'COMMERCE_V5_PUBLICATION_CONTEXT_CHANGED',
        'The Maker, wallet, package, payment coin, Manifest, or Commerce plan changed after this publication checkpoint was created.',
      );
    }
  }
  return Object.freeze(hydrated);
}

export function serializeMakerCommerceV5PublicationCheckpoint(checkpoint) {
  return JSON.stringify(
    hydrateMakerCommerceV5PublicationCheckpoint(checkpoint),
  );
}

function sameId(left, right) {
  try {
    return normalizeSuiAddress(String(left || '')) === normalizeSuiAddress(String(right || ''));
  } catch {
    return false;
  }
}

function policyMatches(actual, expected) {
  if (!actual || !expected) return false;
  return Number(actual.mode) === Number(expected.mode)
    && BigInt(actual.freeQuotaPerWallet ?? actual.free_quota_per_wallet ?? 0)
      === BigInt(expected.freeQuotaPerWallet)
    && BigInt(actual.priceAtomic ?? actual.price_atomic ?? 0)
      === BigInt(expected.priceAtomic)
    && BigInt(actual.totalCap ?? actual.total_cap ?? 0)
      === BigInt(expected.totalCap);
}

function accessMatches(actual, expected) {
  if (!actual || !expected) return false;
  return Number(actual.kind ?? actual.accessKind) === Number(expected.kind)
    && BigInt(actual.purchasePriceAtomic ?? actual.purchase_price_atomic ?? 0)
      === BigInt(expected.purchasePriceAtomic);
}

function bindingIdentity(binding) {
  return [
    requiredString(binding?.partKey ?? binding?.part_key, 'Style Part key'),
    requiredString(binding?.itemKey ?? binding?.item_key, 'Style Item key'),
    requiredString(binding?.styleKey ?? binding?.style_key, 'Style key'),
  ].join('\u0000');
}

function normalizedBinding(binding) {
  const rowKind = Number(binding?.rowKind ?? binding?.row_kind);
  if (!Object.values(COMMERCE_V5_STYLE_ROW).includes(rowKind)) {
    throw publicationError(
      'COMMERCE_V5_PUBLICATION_STYLE_DRIFT',
      'Every exact Style registry row must preserve a supported Move-verified row kind.',
    );
  }
  return Object.freeze({
    partKey: requiredString(binding?.partKey ?? binding?.part_key, 'Style Part key'),
    itemKey: requiredString(binding?.itemKey ?? binding?.item_key, 'Style Item key'),
    styleKey: requiredString(binding?.styleKey ?? binding?.style_key, 'Style key'),
    packKey: String(binding?.packKey ?? binding?.pack_key ?? '').trim(),
    assetBlobId: String(binding?.assetBlobId ?? binding?.asset_blob_id ?? '').trim(),
    rowKind,
    sealProtected:
      binding?.sealProtected === true || binding?.seal_protected === true,
  });
}

function expectedBindingProtection(binding, plan) {
  if (binding.rowKind !== COMMERCE_V5_STYLE_ROW.VISUAL) return false;
  if (!binding.packKey) {
    return Number(plan.configuration.baseAccess?.kind)
      === COMMERCE_V5_ACCESS.PAID_ONCE;
  }
  const pack = (plan.configuration.packs || [])
    .find((candidate) => String(candidate?.key || '') === binding.packKey);
  return Number(pack?.access?.kind) === COMMERCE_V5_ACCESS.PAID_ONCE;
}

function packMatches(actual, expected) {
  return String(actual?.key || '') === String(expected?.key || '')
    && String(actual?.label || '') === String(expected?.label || '')
    && Number(actual?.accessKind ?? actual?.access?.kind) === Number(expected?.access?.kind)
    && BigInt(actual?.purchasePriceAtomic ?? actual?.access?.purchasePriceAtomic ?? 0)
      === BigInt(expected?.access?.purchasePriceAtomic ?? 0)
    && policyMatches(actual?.completePolicy, expected?.completePolicy)
    && actual?.active !== false;
}

function rootBaseMatches(root, plan) {
  return accessMatches(root?.baseAccess, plan.configuration.baseAccess)
    && policyMatches(root?.basePolicy, plan.configuration.baseCompletePolicy)
    && Number(root?.soulCreatorRoyaltyBps)
      === Number(plan.configuration.soulCreatorRoyaltyBps)
    && Number(root?.makerResaleRoyaltyBps)
      === Number(plan.configuration.makerResaleRoyaltyBps);
}

function assertReadbackLinkage(readback, context, plan) {
  const root = readback?.root;
  if (!root) return;
  if (
    !sameId(root.legacyMakerId, context.legacyMakerId)
    || !sameId(root.legacyTreasuryId, context.legacyMakerTreasuryId)
    || !sameId(root.protocolConfigId, context.protocolConfigId)
    || !sameId(root.currentOwner, context.owner)
    || Number(root.rightsOrigin) !== Number(plan.rightsOrigin)
  ) {
    throw publicationError(
      'COMMERCE_V5_PUBLICATION_READBACK_MISMATCH',
      'The discovered MakerRootV5 does not belong to this wallet, legacy Maker, treasury, and protocol publication context.',
    );
  }
  if (
    String(root.logicalAuxiliaryBlobId || '').trim()
      !== requiredString(
        plan.logicalAuxiliaryBlobId,
        'Commerce v5 canonical logical auxiliary Blob ID',
      )
  ) {
    throw publicationError(
      'COMMERCE_V5_PUBLICATION_LOGICAL_AUXILIARY_DRIFT',
      'MakerRootV5 is not bound to the canonical logical auxiliary Blob in this immutable publication plan.',
    );
  }
  if (
    !readback.protocol
    || !sameId(readback.protocol.objectId, context.protocolConfigId)
    || String(readback.protocol.logicalAuxiliaryBlobId || '').trim()
      !== requiredString(
        plan.logicalAuxiliaryBlobId,
        'Commerce v5 canonical logical auxiliary Blob ID',
      )
  ) {
    throw publicationError(
      'COMMERCE_V5_PUBLICATION_PROTOCOL_LOGICAL_AUXILIARY_DRIFT',
      'CommerceProtocolConfigV5 readback is not the exact protocol object bound to this publication logical auxiliary Blob.',
    );
  }
  if (
    !readback.controlCap
    || !sameId(readback.controlCap.rootId, root.objectId)
    || !sameId(readback.controlCap.objectId, root.currentControlCapId)
    || BigInt(readback.controlCap.ownershipEpoch) !== BigInt(root.ownershipEpoch)
  ) {
    throw publicationError(
      'COMMERCE_V5_PUBLICATION_CONTROL_MISMATCH',
      'The current wallet did not return the current MakerControlCapV5 for the discovered MakerRootV5.',
    );
  }
  if (
    !readback.makerTreasury
    || !sameId(readback.makerTreasury.objectId, root.treasuryId)
    || !sameId(readback.makerTreasury.rootId, root.objectId)
  ) {
    throw publicationError(
      'COMMERCE_V5_PUBLICATION_TREASURY_MISMATCH',
      'The discovered MakerTreasuryV5 is not linked to the discovered MakerRootV5.',
    );
  }
}

function exactPlanBindings(plan) {
  const byIdentity = new Map();
  for (const binding of plan.configuration.styleBindings || []) {
    const normalized = normalizedBinding(binding);
    byIdentity.set(bindingIdentity(normalized), normalized);
  }
  return byIdentity;
}

function verifiedReadbackStage(readback, context, plan) {
  const root = readback?.root || null;
  if (!root) {
    return Object.freeze({
      stage: MAKER_COMMERCE_PUBLICATION_V5_STAGES.READY,
      root: null,
      confirmedStyleCount: 0,
      missingStyleBindings: Object.freeze([...plan.configuration.styleBindings]),
    });
  }
  assertReadbackLinkage(readback, context, plan);
  if (root.lifecycle === COMMERCE_V5_LIFECYCLE.ARCHIVED) {
    throw publicationError(
      'COMMERCE_V5_PUBLICATION_LIFECYCLE_DRIFT',
      'The migrated Maker was archived while its Commerce publication was incomplete.',
    );
  }
  if (![COMMERCE_V5_LIFECYCLE.PAUSED, COMMERCE_V5_LIFECYCLE.ACTIVE].includes(root.lifecycle)) {
    throw publicationError(
      'COMMERCE_V5_PUBLICATION_LIFECYCLE_DRIFT',
      'The migrated Maker entered an incompatible lifecycle while publication was incomplete.',
    );
  }

  const expectedPacks = plan.configuration.packs || [];
  const actualPacks = Array.isArray(readback.packs) ? readback.packs : null;
  const baseMatches = rootBaseMatches(root, plan);
  let packsMatch = expectedPacks.length === 0 && BigInt(root.packCount || 0) === 0n;
  if (actualPacks) {
    const byKey = new Map(actualPacks.map((pack) => [String(pack.key || ''), pack]));
    packsMatch = byKey.size === expectedPacks.length
      && expectedPacks.every((pack) => packMatches(byKey.get(pack.key), pack));
  } else if (BigInt(root.packCount || 0) > 0n) {
    packsMatch = false;
  }

  const policyConfigured = baseMatches && packsMatch;
  if (!policyConfigured) {
    const pristineMigration = BigInt(root.packCount || 0) === 0n
      && BigInt(root.styleCount || 0) === 0n
      && root.styleRegistrySealed !== true
      && root.lifecycle === COMMERCE_V5_LIFECYCLE.PAUSED;
    if (!pristineMigration) {
      const incompletePackReadback = !actualPacks
        && BigInt(root.packCount || 0) === BigInt(expectedPacks.length);
      if (incompletePackReadback) {
        return Object.freeze({
          stage: MAKER_COMMERCE_PUBLICATION_V5_STAGES.MIGRATED,
          root,
          readbackIncomplete: true,
          confirmedStyleCount: 0,
          missingStyleBindings: Object.freeze([...plan.configuration.styleBindings]),
        });
      }
      throw publicationError(
        'COMMERCE_V5_PUBLICATION_POLICY_DRIFT',
        'The on-chain Base or Pack policy is neither pristine nor an exact match for this immutable publication plan.',
      );
    }
    return Object.freeze({
      stage: MAKER_COMMERCE_PUBLICATION_V5_STAGES.MIGRATED,
      root,
      confirmedStyleCount: 0,
      missingStyleBindings: Object.freeze([...plan.configuration.styleBindings]),
    });
  }

  const expectedBindings = exactPlanBindings(plan);
  const actualBindings = Array.isArray(readback.styleBindings)
    ? readback.styleBindings.map(normalizedBinding)
    : null;
  const onchainStyleCount = BigInt(root.styleCount || 0);
  if (!actualBindings && onchainStyleCount > 0n) {
    return Object.freeze({
      stage: MAKER_COMMERCE_PUBLICATION_V5_STAGES.POLICY_CONFIGURED,
      root,
      readbackIncomplete: true,
      confirmedStyleCount: 0,
      missingStyleBindings: Object.freeze([...plan.configuration.styleBindings]),
    });
  }
  const actualByIdentity = new Map();
  for (const binding of actualBindings || []) {
    const identity = bindingIdentity(binding);
    const expected = expectedBindings.get(identity);
    if (
      !expected
      || expected.packKey !== binding.packKey
      || expected.rowKind !== binding.rowKind
      || binding.sealProtected !== expectedBindingProtection(expected, plan)
      || !binding.assetBlobId
      || actualByIdentity.has(identity)
    ) {
      throw publicationError(
        'COMMERCE_V5_PUBLICATION_STYLE_DRIFT',
        'The on-chain exact Style registry contains a duplicated, unknown, differently Pack-gated, differently typed, or differently protected Style.',
      );
    }
    actualByIdentity.set(identity, binding);
  }
  if (BigInt(actualByIdentity.size) !== onchainStyleCount) {
    throw publicationError(
      'COMMERCE_V5_PUBLICATION_STYLE_COUNT_MISMATCH',
      'The exact Style registry readback does not match MakerRootV5.style_count.',
    );
  }
  const missingStyleBindings = [...expectedBindings.entries()]
    .filter(([identity]) => !actualByIdentity.has(identity))
    .map(([, binding]) => binding);
  const allStylesConfigured = missingStyleBindings.length === 0;
  const sealPolicyRequired = plan.seal?.required === true;
  const sealPolicyVerified = readback?.sealPolicyVerified === true;
  if (root.styleRegistrySealed && !allStylesConfigured) {
    throw publicationError(
      'COMMERCE_V5_PUBLICATION_SEALED_INCOMPLETE',
      'The on-chain Style registry was sealed before every immutable Style binding was registered.',
    );
  }
  if (root.lifecycle === COMMERCE_V5_LIFECYCLE.ACTIVE) {
    if (
      !root.styleRegistrySealed
      || !allStylesConfigured
      || (sealPolicyRequired && !sealPolicyVerified)
    ) {
      throw publicationError(
        'COMMERCE_V5_PUBLICATION_ACTIVE_DRIFT',
        'MakerRootV5 is Active without an exact, complete Style registry and paid-asset Seal policy.',
      );
    }
    return Object.freeze({
      stage: MAKER_COMMERCE_PUBLICATION_V5_STAGES.ACTIVE,
      root,
      confirmedStyleCount: actualByIdentity.size,
      missingStyleBindings: Object.freeze([]),
    });
  }
  if (root.styleRegistrySealed) {
    if (sealPolicyRequired && !sealPolicyVerified) {
      return Object.freeze({
        stage: MAKER_COMMERCE_PUBLICATION_V5_STAGES.CONFIGURED,
        root,
        readbackIncomplete: true,
        sealPolicyPending: true,
        confirmedStyleCount: actualByIdentity.size,
        missingStyleBindings: Object.freeze([]),
      });
    }
    return Object.freeze({
      stage: MAKER_COMMERCE_PUBLICATION_V5_STAGES.SEALED,
      root,
      confirmedStyleCount: actualByIdentity.size,
      missingStyleBindings: Object.freeze([]),
    });
  }
  if (allStylesConfigured) {
    return Object.freeze({
      stage: MAKER_COMMERCE_PUBLICATION_V5_STAGES.CONFIGURED,
      root,
      confirmedStyleCount: actualByIdentity.size,
      missingStyleBindings: Object.freeze([]),
    });
  }
  return Object.freeze({
    stage: actualByIdentity.size
      ? MAKER_COMMERCE_PUBLICATION_V5_STAGES.STYLES_CONFIGURING
      : MAKER_COMMERCE_PUBLICATION_V5_STAGES.POLICY_CONFIGURED,
    root,
    confirmedStyleCount: actualByIdentity.size,
    missingStyleBindings: Object.freeze(missingStyleBindings),
  });
}

function nextAction(classification) {
  if (classification.readbackIncomplete) return '';
  switch (classification.stage) {
    case MAKER_COMMERCE_PUBLICATION_V5_STAGES.READY:
      return MAKER_COMMERCE_PUBLICATION_V5_ACTIONS.MIGRATE;
    case MAKER_COMMERCE_PUBLICATION_V5_STAGES.MIGRATED:
      return MAKER_COMMERCE_PUBLICATION_V5_ACTIONS.CONFIGURE_POLICY;
    case MAKER_COMMERCE_PUBLICATION_V5_STAGES.POLICY_CONFIGURED:
    case MAKER_COMMERCE_PUBLICATION_V5_STAGES.STYLES_CONFIGURING:
      return MAKER_COMMERCE_PUBLICATION_V5_ACTIONS.CONFIGURE_STYLES;
    case MAKER_COMMERCE_PUBLICATION_V5_STAGES.CONFIGURED:
      return MAKER_COMMERCE_PUBLICATION_V5_ACTIONS.SEAL;
    case MAKER_COMMERCE_PUBLICATION_V5_STAGES.SEALED:
      return MAKER_COMMERCE_PUBLICATION_V5_ACTIONS.ACTIVATE;
    default:
      return '';
  }
}

function readbackObjects(readback) {
  return {
    rootId: String(readback?.root?.objectId || ''),
    makerTreasuryId: String(readback?.makerTreasury?.objectId || ''),
    controlCapId: String(readback?.controlCap?.objectId || ''),
    vaultId: String(readback?.root?.controlVaultId || ''),
  };
}

function pendingAction(checkpoint) {
  return PENDING_STAGES.get(checkpoint.stage) || null;
}

function errorRecord(error, action, dependencies) {
  return {
    code: String(error?.code || error?.name || 'COMMERCE_V5_PUBLICATION_FAILED'),
    message: String(error?.message || error || 'Commerce v5 publication failed.'),
    action,
    at: nowIso(dependencies),
  };
}

function safeToRetry(error) {
  return error?.safeToRetry === true
    || error?.submitted === false
    || [
      'WALLET_REJECTED',
      'TRANSACTION_FAILED',
      'TRANSACTION_EXECUTION_FAILED',
      'USER_REJECTED',
    ].includes(String(error?.code || ''));
}

function transactionDigest(result, error = null) {
  return String(
    result?.digest
      || result?.transaction?.digest
      || result?.indexed?.transaction?.digest
      || error?.digest
      || '',
  );
}

function jsonId(value) {
  if (typeof value === 'string') {
    const candidate = value.trim();
    if (/^0x[0-9a-f]+$/i.test(candidate)) return candidate;
    return '';
  }
  if (!value || typeof value !== 'object') return '';
  return jsonId(value.bytes || value.id || value.address || value.fields);
}

export function migrationObjectHintsFromTransaction(result) {
  const events = result?.indexed?.events || result?.events || [];
  for (const event of events) {
    const json = event?.contents?.json
      || event?.parsedJson
      || event?.json
      || {};
    const rootId = jsonId(json.root_id || json.rootId);
    const legacyMakerId = jsonId(json.legacy_maker_id || json.legacyMakerId);
    if (!rootId || !legacyMakerId) continue;
    return Object.freeze({
      rootId,
      legacyMakerId,
      makerTreasuryId: jsonId(json.treasury_id || json.treasuryId),
      controlCapId: jsonId(json.control_cap_id || json.controlCapId),
      vaultId: jsonId(json.vault_id || json.vaultId),
      owner: String(json.owner || ''),
    });
  }
  return null;
}

async function assertCurrentContext(checkpoint, context, runtime, plan, dependencies) {
  hydrateMakerCommerceV5PublicationCheckpoint(checkpoint, {
    context,
    runtime,
    plan,
  });
  if (!dependencies?.getContext) return;
  const current = await dependencies.getContext();
  const currentNormalized = normalizeMakerCommerceV5PublicationContext(current, runtime);
  if (stableIdentity(currentNormalized) !== checkpoint.contextIdentity) {
    throw publicationError(
      'COMMERCE_V5_PUBLICATION_CONTEXT_CHANGED',
      'The active Maker or wallet changed while Commerce v5 publication was running.',
    );
  }
}

async function persistCheckpoint(previous, patch, dependencies) {
  if (typeof dependencies?.persist !== 'function') {
    throw publicationError(
      'COMMERCE_V5_PUBLICATION_PERSIST_MISSING',
      'A durable Commerce publication checkpoint writer is required.',
    );
  }
  const next = {
    ...plainClone(previous),
    ...plainClone(patch),
    sequence: safeSequence(previous.sequence) + 1,
    updatedAt: nowIso(dependencies),
  };
  const stored = await dependencies.persist(Object.freeze(next), {
    expectedSequence: previous.sequence,
    makerKey: previous.context.makerKey,
    contextIdentity: previous.contextIdentity,
  });
  const verified = hydrateMakerCommerceV5PublicationCheckpoint(stored || next);
  if (
    verified.sequence !== next.sequence
    || verified.contextIdentity !== previous.contextIdentity
    || verified.planIdentity !== previous.planIdentity
    || verified.stage !== next.stage
  ) {
    throw publicationError(
      'COMMERCE_V5_PUBLICATION_PERSIST_UNVERIFIED',
      'The Commerce publication checkpoint was not durably read back at the expected sequence and stage.',
    );
  }
  return verified;
}

async function queryReadback(checkpoint, context, runtime, plan, dependencies) {
  if (typeof dependencies?.query !== 'function') {
    throw publicationError(
      'COMMERCE_V5_PUBLICATION_QUERY_MISSING',
      'A Commerce v5 chain readback query is required.',
    );
  }
  return dependencies.query({
    client: dependencies.client,
    checkpoint,
    context: normalizeMakerCommerceV5PublicationContext(context, runtime),
    runtime,
    plan,
  });
}

function transactionStatus(readback, checkpoint) {
  const action = pendingAction(checkpoint)?.action || checkpoint.action;
  const statuses = readback?.transactionStatuses || {};
  return String(statuses[action] || readback?.transactionStatus || '').toLowerCase();
}

function classificationAdvancedPending(checkpoint, classification) {
  const pending = pendingAction(checkpoint);
  if (!pending) return true;
  switch (pending.action) {
    case MAKER_COMMERCE_PUBLICATION_V5_ACTIONS.MIGRATE:
      return classification.stage !== MAKER_COMMERCE_PUBLICATION_V5_STAGES.READY;
    case MAKER_COMMERCE_PUBLICATION_V5_ACTIONS.CONFIGURE_POLICY:
      return ![
        MAKER_COMMERCE_PUBLICATION_V5_STAGES.READY,
        MAKER_COMMERCE_PUBLICATION_V5_STAGES.MIGRATED,
      ].includes(classification.stage);
    case MAKER_COMMERCE_PUBLICATION_V5_ACTIONS.CONFIGURE_STYLES:
      return classification.confirmedStyleCount > Number(checkpoint.confirmedStyleCount || 0)
        || [
          MAKER_COMMERCE_PUBLICATION_V5_STAGES.CONFIGURED,
          MAKER_COMMERCE_PUBLICATION_V5_STAGES.SEALED,
          MAKER_COMMERCE_PUBLICATION_V5_STAGES.ACTIVE,
        ].includes(classification.stage);
    case MAKER_COMMERCE_PUBLICATION_V5_ACTIONS.SEAL:
      return [
        MAKER_COMMERCE_PUBLICATION_V5_STAGES.SEALED,
        MAKER_COMMERCE_PUBLICATION_V5_STAGES.ACTIVE,
      ].includes(classification.stage);
    case MAKER_COMMERCE_PUBLICATION_V5_ACTIONS.ACTIVATE:
      return classification.stage === MAKER_COMMERCE_PUBLICATION_V5_STAGES.ACTIVE;
    default:
      return false;
  }
}

function stableStageBeforeAction(action, checkpoint) {
  switch (action) {
    case MAKER_COMMERCE_PUBLICATION_V5_ACTIONS.MIGRATE:
      return MAKER_COMMERCE_PUBLICATION_V5_STAGES.READY;
    case MAKER_COMMERCE_PUBLICATION_V5_ACTIONS.CONFIGURE_POLICY:
      return MAKER_COMMERCE_PUBLICATION_V5_STAGES.MIGRATED;
    case MAKER_COMMERCE_PUBLICATION_V5_ACTIONS.CONFIGURE_STYLES:
      return Number(checkpoint.confirmedStyleCount || 0) > 0
        ? MAKER_COMMERCE_PUBLICATION_V5_STAGES.STYLES_CONFIGURING
        : MAKER_COMMERCE_PUBLICATION_V5_STAGES.POLICY_CONFIGURED;
    case MAKER_COMMERCE_PUBLICATION_V5_ACTIONS.SEAL:
      return MAKER_COMMERCE_PUBLICATION_V5_STAGES.CONFIGURED;
    case MAKER_COMMERCE_PUBLICATION_V5_ACTIONS.ACTIVATE:
      return MAKER_COMMERCE_PUBLICATION_V5_STAGES.SEALED;
    default:
      return checkpoint.stage;
  }
}

function confirmedStageRank(checkpoint) {
  if (STABLE_STAGE_RANK[checkpoint.stage] !== undefined) {
    return STABLE_STAGE_RANK[checkpoint.stage];
  }
  const pending = pendingAction(checkpoint);
  return pending
    ? STABLE_STAGE_RANK[stableStageBeforeAction(pending.action, checkpoint)] ?? 0
    : 0;
}

async function persistClassification(
  checkpoint,
  readback,
  classification,
  dependencies,
) {
  const nextObjects = readback?.root
    ? readbackObjects(readback)
    : checkpoint.objects;
  const completed = classification.stage === MAKER_COMMERCE_PUBLICATION_V5_STAGES.ACTIVE;
  const unchanged = checkpoint.stage === classification.stage
    && checkpoint.confirmedStyleCount === classification.confirmedStyleCount
    && stableIdentity(checkpoint.objects) === stableIdentity(nextObjects)
    && checkpoint.readbackVerified === !classification.readbackIncomplete
    && checkpoint.completed === completed
    && !checkpoint.intent;
  if (unchanged) return checkpoint;
  return persistCheckpoint(checkpoint, {
    stage: classification.stage,
    action: '',
    intent: null,
    objects: nextObjects,
    confirmedStyleCount: classification.confirmedStyleCount,
    readbackVerified: !classification.readbackIncomplete,
    completed,
    lastError: null,
  }, dependencies);
}

/**
 * Read-only recovery pass.
 *
 * dependencies.query receives { client, checkpoint, context, runtime, plan }
 * and returns:
 *   {
 *     protocol,
 *     root, makerTreasury, controlCap,
 *     packs: PackRecordV5[],
 *     styleBindings: {
 *       partKey, itemKey, styleKey, packKey?, assetBlobId,
 *       rowKind, sealProtected
 *     }[],
 *     transactionStatuses?: { [action]: 'failed' | 'success' | 'pending' }
 *   }
 *
 * `styleBindings` must be the decoded keys and values from the Root's Style
 * registry table. Counts alone are deliberately insufficient before sealing.
 */
export async function reconcileMakerCommerceV5Publication({
  checkpoint,
  context,
  runtime,
  plan,
  dependencies,
} = {}) {
  let current = checkpoint
    ? hydrateMakerCommerceV5PublicationCheckpoint(checkpoint, { context, runtime, plan })
    : createMakerCommerceV5PublicationCheckpoint({ context, runtime, plan });
  await assertCurrentContext(current, context, runtime, plan, dependencies);
  const readback = await queryReadback(current, context, runtime, plan, dependencies);
  const classification = verifiedReadbackStage(
    readback,
    normalizeMakerCommerceV5PublicationContext(context, runtime),
    plan,
  );
  const pending = pendingAction(current);
  if (pending && !classificationAdvancedPending(current, classification)) {
    const status = transactionStatus(readback, current);
    if (status === 'failed' || status === 'not-submitted' || status === 'rejected') {
      current = await persistCheckpoint(current, {
        stage: stableStageBeforeAction(pending.action, current),
        action: '',
        intent: null,
        readbackVerified: true,
        lastError: {
          code: 'COMMERCE_V5_PUBLICATION_TRANSACTION_FAILED',
          message: `The ${pending.action} transaction did not change on-chain state and may be retried.`,
          action: pending.action,
          at: nowIso(dependencies),
        },
      }, dependencies);
      return Object.freeze({
        checkpoint: current,
        classification,
        nextAction: nextAction(classification),
        pending: false,
      });
    }
    return Object.freeze({
      checkpoint: current,
      classification,
      nextAction: '',
      pending: true,
      pendingAction: pending.action,
    });
  }
  if (
    (STABLE_STAGE_RANK[classification.stage] ?? 0) < confirmedStageRank(current)
    || (
      classification.stage === MAKER_COMMERCE_PUBLICATION_V5_STAGES.STYLES_CONFIGURING
      && classification.confirmedStyleCount < Number(current.confirmedStyleCount || 0)
    )
  ) {
    return Object.freeze({
      checkpoint: current,
      classification,
      nextAction: '',
      pending: false,
      readbackPending: true,
    });
  }
  current = await persistClassification(current, readback, classification, dependencies);
  return Object.freeze({
    checkpoint: current,
    classification,
    nextAction: nextAction(classification),
    pending: false,
  });
}

function buildActionTransaction({
  action,
  runtime,
  context,
  plan,
  protocol,
  readback,
  styleBindings,
}) {
  switch (action) {
    case MAKER_COMMERCE_PUBLICATION_V5_ACTIONS.MIGRATE:
      return buildMigrateLegacyMakerV5({
        runtime,
        protocol,
        legacyMakerId: context.legacyMakerId,
        legacyMakerTreasuryId: context.legacyMakerTreasuryId,
        legacyMakerTreasuryBalanceAtomic: context.legacyMakerTreasuryBalanceAtomic,
        legacyMakerAdminCapId: context.legacyMakerAdminCapId,
        ...plan.migration,
        sender: context.owner,
      });
    case MAKER_COMMERCE_PUBLICATION_V5_ACTIONS.CONFIGURE_POLICY:
      return buildConfigureMakerV5({
        runtime,
        root: readback.root,
        controlCap: readback.controlCap,
        sender: context.owner,
        ...plan.configuration,
        packs: plan.configuration.packs,
        styleBindings: [],
        sealStyleRegistry: false,
        activate: false,
      });
    case MAKER_COMMERCE_PUBLICATION_V5_ACTIONS.CONFIGURE_STYLES:
      return buildConfigureMakerV5({
        runtime,
        root: readback.root,
        controlCap: readback.controlCap,
        sender: context.owner,
        ...plan.configuration,
        packs: [],
        styleBindings,
        sealStyleRegistry: false,
        activate: false,
        configurePolicy: false,
      });
    case MAKER_COMMERCE_PUBLICATION_V5_ACTIONS.SEAL: {
      const transaction = buildConfigureMakerV5({
        runtime,
        root: readback.root,
        controlCap: readback.controlCap,
        sender: context.owner,
        ...plan.configuration,
        packs: [],
        styleBindings: [],
        sealStyleRegistry: true,
        activate: false,
        configurePolicy: false,
      });
      if (plan.seal?.required === true) {
        appendPublishMakerSealPolicyV5(transaction, {
          callablePackageId: runtime.callablePackageId || runtime.packageId,
          makerRootId: readback.root.objectId,
          releaseCommitment: plan.seal.releaseCommitment,
          registrations: plan.seal.registrations,
        });
      }
      return transaction;
    }
    case MAKER_COMMERCE_PUBLICATION_V5_ACTIONS.ACTIVATE:
      return buildActivateMakerV5({
        runtime,
        root: readback.root,
        controlCap: readback.controlCap,
        sender: context.owner,
      });
    default:
      throw publicationError(
        'COMMERCE_V5_PUBLICATION_ACTION_INVALID',
        'The Commerce publication state does not have a valid next transaction.',
      );
  }
}

function digestPatch(checkpoint, action, digest) {
  const digests = plainClone(checkpoint.digests);
  switch (action) {
    case MAKER_COMMERCE_PUBLICATION_V5_ACTIONS.MIGRATE:
      digests.migration = digest;
      break;
    case MAKER_COMMERCE_PUBLICATION_V5_ACTIONS.CONFIGURE_POLICY:
      digests.policy = digest;
      break;
    case MAKER_COMMERCE_PUBLICATION_V5_ACTIONS.CONFIGURE_STYLES:
      digests.styleBatches.push(digest);
      break;
    case MAKER_COMMERCE_PUBLICATION_V5_ACTIONS.SEAL:
      digests.seal = digest;
      break;
    case MAKER_COMMERCE_PUBLICATION_V5_ACTIONS.ACTIVATE:
      digests.activate = digest;
      break;
    default:
      break;
  }
  return digests;
}

/**
 * Runs at most one wallet transaction. persist(checkpoint, meta) must perform
 * compare-and-swap with meta.expectedSequence and return its durable readback.
 * The caller can store this object under the existing Maker upload recovery's
 * `commerceV5Publication` field; no BigInt is stored in the checkpoint.
 */
export async function advanceMakerCommerceV5Publication({
  checkpoint,
  context,
  runtime,
  plan,
  protocol,
  dependencies,
  styleBatchSize = DEFAULT_STYLE_BATCH_SIZE,
} = {}) {
  const normalizedContext = normalizeMakerCommerceV5PublicationContext(context, runtime);
  const batchSize = Number(styleBatchSize);
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 500) {
    throw publicationError(
      'COMMERCE_V5_PUBLICATION_BATCH_INVALID',
      'Commerce Style registration batch size must be an integer from 1 to 500.',
    );
  }
  let reconciled = await reconcileMakerCommerceV5Publication({
    checkpoint,
    context,
    runtime,
    plan,
    dependencies,
  });
  let current = reconciled.checkpoint;
  if (reconciled.pending || current.completed) return reconciled;
  const action = reconciled.nextAction;
  if (!action) {
    return Object.freeze({
      ...reconciled,
      readbackPending: reconciled.readbackPending === true
        || reconciled.classification.readbackIncomplete === true,
    });
  }
  await assertCurrentContext(current, context, runtime, plan, dependencies);
  const readback = await queryReadback(current, context, runtime, plan, dependencies);
  const classification = verifiedReadbackStage(readback, normalizedContext, plan);
  if (classification.readbackIncomplete) {
    return Object.freeze({
      checkpoint: current,
      classification,
      nextAction: '',
      pending: false,
      readbackPending: true,
    });
  }
  const verifiedAction = nextAction(classification);
  if (verifiedAction !== action) {
    throw publicationError(
      'COMMERCE_V5_PUBLICATION_STATE_CHANGED',
      'Commerce v5 chain state changed between reconciliation and transaction preparation.',
    );
  }
  const styleBindings = action === MAKER_COMMERCE_PUBLICATION_V5_ACTIONS.CONFIGURE_STYLES
    ? classification.missingStyleBindings.slice(0, batchSize)
    : [];
  if (action === MAKER_COMMERCE_PUBLICATION_V5_ACTIONS.CONFIGURE_STYLES && !styleBindings.length) {
    throw publicationError(
      'COMMERCE_V5_PUBLICATION_STYLE_BATCH_EMPTY',
      'No unregistered exact Style remains for the next configuration batch.',
    );
  }
  const transaction = buildActionTransaction({
    action,
    runtime,
    context: normalizedContext,
    plan,
    protocol: readback?.protocol || protocol,
    readback,
    styleBindings,
  });
  if (typeof dependencies?.signAndExecute !== 'function') {
    throw publicationError(
      'COMMERCE_V5_PUBLICATION_SIGNER_MISSING',
      'A wallet sign-and-execute adapter is required.',
    );
  }

  const stage = ACTION_STAGE[action];
  current = await persistCheckpoint(current, {
    stage: stage.intent,
    action,
    intent: {
      action,
      createdAt: nowIso(dependencies),
      styleBindingIdentities: styleBindings.map(bindingIdentity),
    },
    readbackVerified: true,
    lastError: null,
  }, dependencies);
  try {
    await assertCurrentContext(current, context, runtime, plan, dependencies);
  } catch (error) {
    error.checkpoint = current;
    throw error;
  }

  let result;
  try {
    result = await dependencies.signAndExecute(transaction, {
      expectedWallet: normalizedContext.owner,
      action,
      checkpoint: current,
    });
  } catch (error) {
    const digest = transactionDigest(result, error);
    const retryable = safeToRetry(error);
    current = await persistCheckpoint(current, {
      stage: retryable
        ? stableStageBeforeAction(action, current)
        : (digest ? stage.submitted : stage.intent),
      action: retryable ? '' : action,
      intent: retryable
        ? null
        : {
            ...current.intent,
            ...(digest ? { digest, submittedAt: nowIso(dependencies) } : {}),
          },
      ...(digest ? { digests: digestPatch(current, action, digest) } : {}),
      lastError: errorRecord(error, action, dependencies),
    }, dependencies);
    error.checkpoint = current;
    throw error;
  }
  const digest = transactionDigest(result);
  if (!digest) {
    const error = publicationError(
      'COMMERCE_V5_PUBLICATION_DIGEST_MISSING',
      `The wallet did not return a digest for the ${action} transaction.`,
    );
    error.submitted = true;
    current = await persistCheckpoint(current, {
      stage: stage.intent,
      action,
      intent: current.intent,
      lastError: errorRecord(error, action, dependencies),
    }, dependencies);
    error.checkpoint = current;
    throw error;
  }
  const migrationHints = action === MAKER_COMMERCE_PUBLICATION_V5_ACTIONS.MIGRATE
    ? migrationObjectHintsFromTransaction(result)
    : null;
  const migrationHintsMatch = !migrationHints || (
    sameId(migrationHints.legacyMakerId, normalizedContext.legacyMakerId)
    && (!migrationHints.owner || sameId(migrationHints.owner, normalizedContext.owner))
  );
  try {
    current = await persistCheckpoint(current, {
      stage: stage.submitted,
      action,
      intent: {
        ...current.intent,
        digest,
        submittedAt: nowIso(dependencies),
      },
      digests: digestPatch(current, action, digest),
      objects: migrationHints && migrationHintsMatch
        ? {
            rootId: migrationHints.rootId,
            makerTreasuryId: migrationHints.makerTreasuryId,
            controlCapId: migrationHints.controlCapId,
            vaultId: migrationHints.vaultId,
          }
        : current.objects,
      lastError: migrationHintsMatch
        ? null
        : {
            code: 'COMMERCE_V5_PUBLICATION_EVENT_MISMATCH',
            message: 'The migration digest was saved, but its event hints did not match this Maker. Chain readback must resolve it before any retry.',
            action,
            at: nowIso(dependencies),
          },
    }, dependencies);
  } catch (error) {
    error.digest = digest;
    error.submitted = true;
    error.checkpoint = current;
    throw error;
  }
  if (!migrationHintsMatch) {
    const error = publicationError(
      'COMMERCE_V5_PUBLICATION_EVENT_MISMATCH',
      'The migration transaction returned event hints for another Maker or wallet. Its digest is retained and duplicate submission is blocked.',
      { digest, submitted: true, checkpoint: current },
    );
    throw error;
  }

  const refreshed = await queryReadback(current, context, runtime, plan, dependencies);
  const refreshedClassification = verifiedReadbackStage(refreshed, normalizedContext, plan);
  if (!classificationAdvancedPending(current, refreshedClassification)) {
    return Object.freeze({
      checkpoint: current,
      classification: refreshedClassification,
      nextAction: '',
      pending: true,
      pendingAction: action,
    });
  }
  current = await persistClassification(
    current,
    refreshed,
    refreshedClassification,
    dependencies,
  );
  await assertCurrentContext(current, context, runtime, plan, dependencies);
  return Object.freeze({
    checkpoint: current,
    classification: refreshedClassification,
    nextAction: nextAction(refreshedClassification),
    pending: false,
  });
}
