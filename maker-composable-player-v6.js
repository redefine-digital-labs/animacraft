import { bcs } from '@mysten/sui/bcs';
import { normalizeStructTag, normalizeSuiAddress } from '@mysten/sui/utils';
import {
  ITEM_ACCESS_MODES,
  ITEM_BINDING_MODES,
} from './maker-composable-v6.js';

export const MAKER_COMPOSABLE_PLAYER_V6_PLAN_SCHEMA =
  'animacraft.maker-composable-player-plan.v6';
export const MAKER_COMPOSABLE_PLAYER_V6_CHECKPOINT_SCHEMA =
  'animacraft.maker-composable-player-checkpoint.v6';

export const MAKER_COMPOSABLE_PLAYER_V6_OPERATIONS = Object.freeze({
  CLAIM_ACCOUNT_ITEM: 'CLAIM_ACCOUNT_ITEM',
  CLAIM_SOUL_ITEM: 'CLAIM_SOUL_ITEM',
  CLAIM_OWNED_ITEM: 'CLAIM_OWNED_ITEM',
  PURCHASE_ACCOUNT_ITEM: 'PURCHASE_ACCOUNT_ITEM',
  PURCHASE_SOUL_ITEM: 'PURCHASE_SOUL_ITEM',
  PURCHASE_OWNED_ITEM: 'PURCHASE_OWNED_ITEM',
  LOCK_OWNED_ITEM: 'LOCK_OWNED_ITEM',
  UNLOCK_OWNED_ITEM: 'UNLOCK_OWNED_ITEM',
  AUTHORIZE_INITIAL_APPEARANCE: 'AUTHORIZE_INITIAL_APPEARANCE',
  AUTHORIZE_APPEARANCE_UPDATE: 'AUTHORIZE_APPEARANCE_UPDATE',
});

export const MAKER_COMPOSABLE_PLAYER_V6_ACTION_STATUS = Object.freeze({
  PENDING: 'PENDING',
  INTENT: 'INTENT',
  SUBMITTED: 'SUBMITTED',
  CONFIRMED: 'CONFIRMED',
});

/**
 * Audited against Animacraft composition_v6 and Soulidity's
 * animacraft_appearance_adapter_v6. These names are intentionally explicit:
 * a package upgrade must update this list and its ABI contract tests.
 */
export const MAKER_COMPOSABLE_PLAYER_V6_MOVE_FUNCTIONS = Object.freeze({
  CLAIM_FREE_WALLET_ITEM: 'claim_free_wallet_item_v6',
  PURCHASE_WALLET_ITEM: 'purchase_wallet_item_v6',
  NEW_LOADOUT_SELECTION: 'new_loadout_selection_v6',
  CLAIM_FREE_SOUL_ITEM: 'claim_free_soul_item_v6',
  PURCHASE_SOUL_ITEM: 'purchase_soul_item_v6',
  LOCK_OWNED_ITEM: 'lock_owned_item_to_soul_v6',
  UNLOCK_OWNED_ITEM: 'unlock_owned_item_from_soul_v6',
  AUTHORIZE_INITIAL_APPEARANCE: 'authorize_initial_appearance_v6',
  BIND_INITIAL_APPEARANCE: 'bind_initial_appearance_v6',
  AUTHORIZE_APPEARANCE_UPDATE: 'authorize_appearance_update_v6',
  APPLY_APPEARANCE_UPDATE: 'apply_authorized_appearance_update_v6',
});

const ANIMACRAFT_MODULE = 'composition_v6';
const SOULIDITY_ADAPTER_MODULE = 'animacraft_appearance_adapter_v6';
const CLOCK_OBJECT_ID = '0x6';
const SUI_ID = /^0x[0-9a-f]+$/i;
const HEX_32 = /^(?:0x)?[0-9a-f]{64}$/i;
const CHECKPOINT_NONCE = /^[a-zA-Z0-9._:-]{16,256}$/;
const U64_MAX = (1n << 64n) - 1n;

const SUBJECT_KIND = Object.freeze({
  [ITEM_BINDING_MODES.ACCOUNT]: 0,
  [ITEM_BINDING_MODES.SOUL_BOUND]: 1,
  [ITEM_BINDING_MODES.EMBEDDED]: 2,
  [ITEM_BINDING_MODES.OWNED]: 0,
});

const SuiIdV6Bcs = bcs.struct('ID', { bytes: bcs.Address });
const LoadoutSelectionV6Bcs = bcs.struct('LoadoutSelectionV6', {
  product_id: SuiIdV6Bcs,
  slot_key: bcs.string(),
  subject_kind: bcs.u8(),
  owned_instance_id: bcs.option(SuiIdV6Bcs),
});
const LoadoutHashInputV6Bcs = bcs.struct('LoadoutHashInputV6', {
  selections: bcs.vector(LoadoutSelectionV6Bcs),
});

export class MakerComposablePlayerV6Error extends Error {
  constructor(message, code = 'COMPOSABLE_PLAYER_V6_ERROR', details = {}) {
    super(message);
    this.name = 'MakerComposablePlayerV6Error';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new MakerComposablePlayerV6Error(message, code, details);
}

function string(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
}

function clone(value) {
  return structuredClone(value);
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
}

function stableValue(value) {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [
    key,
    stableValue(value[key]),
  ]));
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function bytesHex(bytes) {
  return [...new Uint8Array(bytes)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256(value) {
  const bytes = typeof value === 'string'
    ? new TextEncoder().encode(value)
    : value;
  return bytesHex(await crypto.subtle.digest('SHA-256', bytes));
}

function timestamp(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  if (!Number.isFinite(date.getTime())) {
    fail('COMPOSABLE_PLAYER_V6_INVALID_TIME', 'Player action time is invalid.');
  }
  return date.toISOString();
}

function safeSequence(value) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) {
    fail(
      'COMPOSABLE_PLAYER_V6_INVALID_SEQUENCE',
      'Player action sequence must be a non-negative safe integer.',
    );
  }
  return result;
}

function suiId(value, label) {
  const result = string(value).toLowerCase();
  if (!SUI_ID.test(result)) {
    fail(
      'COMPOSABLE_PLAYER_V6_INVALID_OBJECT_ID',
      `${label} must be an explicit Sui object ID or address.`,
      { label },
    );
  }
  return result;
}

function sameSuiId(value, expected) {
  const result = string(value).toLowerCase();
  return SUI_ID.test(result) && result === expected;
}

function u64(value, label, { positive = false } = {}) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) {
    fail(
      'COMPOSABLE_PLAYER_V6_UNSAFE_INTEGER',
      `${label} must be supplied as an exact integer or decimal string.`,
      { label },
    );
  }
  let parsed;
  try {
    parsed = BigInt(value ?? 0);
  } catch {
    fail(
      'COMPOSABLE_PLAYER_V6_UNSAFE_INTEGER',
      `${label} must be an unsigned u64 integer.`,
      { label },
    );
  }
  if (parsed < 0n || parsed > U64_MAX || (positive && parsed === 0n)) {
    fail(
      'COMPOSABLE_PLAYER_V6_UNSAFE_INTEGER',
      `${label} is outside the accepted Sui u64 range.`,
      { label },
    );
  }
  return parsed.toString();
}

function hash32(value, label) {
  const result = string(value).replace(/^0x/i, '').toLowerCase();
  if (!HEX_32.test(result)) {
    fail(
      'COMPOSABLE_PLAYER_V6_INVALID_HASH',
      `${label} must be an exact 32-byte hexadecimal value.`,
      { label },
    );
  }
  return result;
}

function hashBytes(value, label) {
  return hash32(value, label).match(/.{2}/g).map((byte) => Number.parseInt(byte, 16));
}

function moveType(value, label) {
  try {
    return normalizeStructTag(string(value));
  } catch {
    fail(
      'COMPOSABLE_PLAYER_V6_INVALID_MOVE_TYPE',
      `${label} must be an exact Move struct type.`,
      { label },
    );
  }
}

function animacraftTarget(packageId, functionName) {
  return `${suiId(packageId, 'Animacraft callable package')}::${ANIMACRAFT_MODULE}::${functionName}`;
}

function soulidityTarget(packageId, functionName) {
  return `${suiId(packageId, 'Soulidity callable package')}::${SOULIDITY_ADAPTER_MODULE}::${functionName}`;
}

function objectInput(objectId, mutability = 'IMMUTABLE') {
  return {
    kind: 'OBJECT',
    objectId: suiId(objectId, 'Move object input'),
    mutability,
  };
}

function resultRef(callId, output = 0) {
  return { kind: 'RESULT', callId, output };
}

function normalizeTuple(runtime, { paid = false, soul = false } = {}) {
  const soulidityCallablePackageId = soul
    ? suiId(
      runtime?.soulidityCallablePackageId || runtime?.soulidityPackageId,
      'Soulidity callable package',
    )
    : '';
  const tuple = {
    callablePackageId: suiId(runtime?.callablePackageId || runtime?.packageId, 'Animacraft callable package'),
    compositionV6TypeOriginPackageId: suiId(
      runtime?.compositionV6TypeOriginPackageId,
      'Composition v6 TypeOrigin package',
    ),
    compositionProtocolConfigV6Id: suiId(
      runtime?.compositionProtocolConfigV6Id,
      'CompositionProtocolConfigV6',
    ),
    compositionRegistryV6Id: suiId(runtime?.compositionRegistryV6Id, 'CompositionRegistryV6'),
    commerceProtocolConfigV5Id: suiId(
      runtime?.commerceProtocolConfigV5Id,
      'CommerceProtocolConfigV5',
    ),
    // Unused runtime fields stay out of the byte-locked scope. A free action
    // cannot accidentally start depending on a Treasury or payment type.
    compositionProtocolTreasuryV6Id: paid
      ? suiId(runtime?.compositionProtocolTreasuryV6Id, 'CompositionProtocolTreasuryV6')
      : '',
    paymentCoinType: paid ? moveType(runtime?.paymentCoinType, 'Payment coin type') : '',
    soulidityCallablePackageId,
    compositionV6SoulOwnerProofTypeOriginPackageId: soul
      ? suiId(
        runtime?.compositionV6SoulOwnerProofTypeOriginPackageId,
        'Soulidity v6 owner-proof TypeOrigin package',
      )
      : '',
    compositionV6SoulOwnerProofType: soul
      ? moveType(runtime?.compositionV6SoulOwnerProofType, 'Soul owner proof type')
      : '',
  };
  if (soul) {
    const expected = moveType(
      `${tuple.compositionV6SoulOwnerProofTypeOriginPackageId}::animacraft_soul_owner_proof_v6::AnimacraftSoulOwnerProofV6`,
      'Expected Soul owner proof type',
    );
    if (tuple.compositionV6SoulOwnerProofType !== expected) {
      fail(
        'COMPOSABLE_PLAYER_V6_PROOF_TYPE_MISMATCH',
        'Soul-bound v6 actions require Soulidity\'s exact AnimacraftSoulOwnerProofV6 TypeOrigin.',
      );
    }
  }
  return tuple;
}

function commonContext(context, tuple) {
  return {
    wallet: suiId(context?.wallet, 'Player wallet'),
    makerRootId: suiId(context?.makerRootId, 'MakerRootV5'),
    profileId: suiId(context?.profileId, 'MakerProfileV6'),
    clockObjectId: suiId(context?.clockObjectId || CLOCK_OBJECT_ID, 'Sui Clock'),
    ...tuple,
  };
}

function call({ id, target, typeArguments = [], inputOrder, inputs, outputs = [] }) {
  const actual = Object.keys(object(inputs));
  if (!Array.isArray(inputOrder)
      || inputOrder.length !== actual.length
      || new Set(inputOrder).size !== inputOrder.length
      || inputOrder.some((name) => !actual.includes(name))) {
    fail(
      'COMPOSABLE_PLAYER_V6_ABI_INPUT_ORDER_INVALID',
      `The audited Move input order is incomplete for ${id}.`,
      { id, inputOrder, inputs: actual },
    );
  }
  return { id, target, typeArguments, inputOrder, inputs, outputs };
}

function action(operation, context, calls, expectedReadback, policy = {}) {
  return {
    id: `player.${operation.toLowerCase().replaceAll('_', '-')}`,
    transport: 'SUI',
    atomic: true,
    authority: {
      role: 'PLAYER',
      signer: context.wallet,
      capability: null,
    },
    calls,
    expectedReadback,
    policy,
  };
}

function operationForItem(accessMode, bindingMode) {
  const paid = accessMode === ITEM_ACCESS_MODES.PAID_ONCE;
  const prefix = paid ? 'PURCHASE' : 'CLAIM';
  if (bindingMode === ITEM_BINDING_MODES.ACCOUNT) return `${prefix}_ACCOUNT_ITEM`;
  if (bindingMode === ITEM_BINDING_MODES.SOUL_BOUND) return `${prefix}_SOUL_ITEM`;
  if (bindingMode === ITEM_BINDING_MODES.OWNED) return `${prefix}_OWNED_ITEM`;
  fail(
    'COMPOSABLE_PLAYER_V6_EMBEDDED_NOT_ACQUIRABLE',
    'Embedded Items are selected from the Maker and are never claimed or purchased.',
  );
}

function itemPolicy(product, priceAtomic) {
  return {
    accessMode: product.access.mode,
    bindingMode: product.access.binding,
    priceAtomic,
    oneTime: true,
    createsOwnedInstance: product.access.binding === ITEM_BINDING_MODES.OWNED,
    proofPath: product.access.binding === ITEM_BINDING_MODES.SOUL_BOUND
      ? 'SOULIDITY_OWNER_PROOF_WRAPPER'
      : 'WALLET_SENDER',
  };
}

async function finalizePlan(operation, context, actionValue, binding) {
  const draft = {
    schema: MAKER_COMPOSABLE_PLAYER_V6_PLAN_SCHEMA,
    version: 1,
    operation,
    binding,
    context,
    action: actionValue,
  };
  return freeze({ ...draft, planIdentity: await sha256(stableJson(draft)) });
}

/**
 * Builds a single-transaction free-claim or paid-once entitlement plan.
 * It performs no Sui write and is available while the v6 release gate is off.
 */
export async function buildMakerComposableV6ItemEntitlementPlan({
  runtime = {},
  context = {},
  product = {},
} = {}) {
  const access = object(product.access);
  if (![ITEM_ACCESS_MODES.FREE_CLAIM, ITEM_ACCESS_MODES.PAID_ONCE].includes(access.mode)) {
    fail(
      'COMPOSABLE_PLAYER_V6_INVALID_ACCESS_MODE',
      'Player entitlement supports only free claim and paid once.',
    );
  }
  if (![ITEM_BINDING_MODES.ACCOUNT,
    ITEM_BINDING_MODES.SOUL_BOUND,
    ITEM_BINDING_MODES.OWNED].includes(access.binding)) {
    fail(
      'COMPOSABLE_PLAYER_V6_INVALID_BINDING_MODE',
      'Player entitlement supports Account, Soul-bound or Owned binding only.',
    );
  }
  const paid = access.mode === ITEM_ACCESS_MODES.PAID_ONCE;
  const soul = access.binding === ITEM_BINDING_MODES.SOUL_BOUND;
  const tuple = normalizeTuple(runtime, { paid, soul });
  const planContext = {
    ...commonContext(context, tuple),
    productId: suiId(context.productId || product.onchainProductId, 'ItemProductV6'),
    soulStateId: soul ? suiId(context.soulStateId, 'SoulState') : '',
    soulId: soul ? suiId(context.soulId, 'Soul') : '',
    paymentCoinId: paid ? suiId(context.paymentCoinId, 'Exact payment Coin') : '',
  };
  const priceAtomic = u64(access.priceAtomic, 'Item price', { positive: paid });
  if (!paid && priceAtomic !== '0') {
    fail(
      'COMPOSABLE_PLAYER_V6_FREE_PRICE_MISMATCH',
      'A free-claim Item must have an exact zero price.',
    );
  }
  const operation = operationForItem(access.mode, access.binding);
  const shared = {
    registry: objectInput(tuple.compositionRegistryV6Id, 'MUTABLE_SHARED'),
    compositionConfig: objectInput(tuple.compositionProtocolConfigV6Id, 'IMMUTABLE_SHARED'),
    profile: objectInput(planContext.profileId, 'IMMUTABLE_SHARED'),
    product: objectInput(planContext.productId, 'IMMUTABLE'),
    root: objectInput(planContext.makerRootId, 'IMMUTABLE_SHARED'),
    commerceConfig: objectInput(tuple.commerceProtocolConfigV5Id, 'IMMUTABLE_SHARED'),
  };
  let target;
  let typeArguments = [];
  let inputs;
  if (!soul) {
    target = animacraftTarget(
      tuple.callablePackageId,
      paid
        ? MAKER_COMPOSABLE_PLAYER_V6_MOVE_FUNCTIONS.PURCHASE_WALLET_ITEM
        : MAKER_COMPOSABLE_PLAYER_V6_MOVE_FUNCTIONS.CLAIM_FREE_WALLET_ITEM,
    );
    typeArguments = paid ? [tuple.paymentCoinType] : [];
    inputs = {
      ...shared,
      ...(paid ? {
        treasury: objectInput(tuple.compositionProtocolTreasuryV6Id, 'MUTABLE_SHARED'),
        payment: objectInput(planContext.paymentCoinId, 'OWNED'),
      } : {}),
      clock: objectInput(planContext.clockObjectId, 'IMMUTABLE_SHARED'),
    };
  } else {
    target = soulidityTarget(
      tuple.soulidityCallablePackageId,
      paid
        ? MAKER_COMPOSABLE_PLAYER_V6_MOVE_FUNCTIONS.PURCHASE_SOUL_ITEM
        : MAKER_COMPOSABLE_PLAYER_V6_MOVE_FUNCTIONS.CLAIM_FREE_SOUL_ITEM,
    );
    typeArguments = paid ? [tuple.paymentCoinType] : [];
    inputs = {
      ...shared,
      ...(paid ? {
        treasury: objectInput(tuple.compositionProtocolTreasuryV6Id, 'MUTABLE_SHARED'),
      } : {}),
      state: objectInput(planContext.soulStateId, 'IMMUTABLE_SHARED'),
      ...(paid ? { payment: objectInput(planContext.paymentCoinId, 'OWNED') } : {}),
      clock: objectInput(planContext.clockObjectId, 'IMMUTABLE_SHARED'),
    };
  }
  const calls = [call({
    id: 'entitlement.acquire',
    target,
    typeArguments,
    inputOrder: paid
      ? (soul
        ? ['registry', 'compositionConfig', 'treasury', 'profile', 'product', 'root',
          'commerceConfig', 'state', 'payment', 'clock']
        : ['registry', 'compositionConfig', 'treasury', 'profile', 'product', 'root',
          'commerceConfig', 'payment', 'clock'])
      : (soul
        ? ['registry', 'compositionConfig', 'profile', 'product', 'root',
          'commerceConfig', 'state', 'clock']
        : ['registry', 'compositionConfig', 'profile', 'product', 'root',
          'commerceConfig', 'clock']),
    inputs,
    // The Move function transfers an OwnedItemV6 instead of returning it.
    // Its ID therefore comes only from effects/event readback, never a PTB result.
    outputs: [],
  })];
  const expectedReadback = {
    event: 'animacraft::composition_v6::EntitlementGrantedV6',
    entitlementExists: true,
    subject: soul ? 'SOUL' : 'WALLET',
    subjectId: soul ? planContext.soulId : planContext.wallet,
    paidAtomic: priceAtomic,
    ownedInstanceRequired: access.binding === ITEM_BINDING_MODES.OWNED,
  };
  return finalizePlan(
    operation,
    planContext,
    action(operation, planContext, calls, expectedReadback, itemPolicy(product, priceAtomic)),
    {
      wallet: planContext.wallet,
      makerRootId: planContext.makerRootId,
      profileId: planContext.profileId,
      productId: planContext.productId,
      accessMode: access.mode,
      bindingMode: access.binding,
      soulStateId: planContext.soulStateId,
      soulId: planContext.soulId,
      priceAtomic,
    },
  );
}

/** Builds an Owned Item lock/unlock plan through Soulidity's proof wrapper. */
export async function buildMakerComposableV6OwnedLockPlan({
  runtime = {},
  context = {},
  locked,
} = {}) {
  if (typeof locked !== 'boolean') {
    fail(
      'COMPOSABLE_PLAYER_V6_LOCK_DIRECTION_REQUIRED',
      'Owned Item lock planning requires locked=true or locked=false.',
    );
  }
  const tuple = normalizeTuple(runtime, { soul: true });
  const planContext = {
    ...commonContext(context, tuple),
    ownedItemId: suiId(context.ownedItemId, 'OwnedItemV6'),
    soulStateId: suiId(context.soulStateId, 'SoulState'),
    soulId: suiId(context.soulId, 'Soul'),
  };
  const operation = locked
    ? MAKER_COMPOSABLE_PLAYER_V6_OPERATIONS.LOCK_OWNED_ITEM
    : MAKER_COMPOSABLE_PLAYER_V6_OPERATIONS.UNLOCK_OWNED_ITEM;
  const functionName = locked
    ? MAKER_COMPOSABLE_PLAYER_V6_MOVE_FUNCTIONS.LOCK_OWNED_ITEM
    : MAKER_COMPOSABLE_PLAYER_V6_MOVE_FUNCTIONS.UNLOCK_OWNED_ITEM;
  const calls = [call({
    id: locked ? 'owned.lock' : 'owned.unlock',
    target: soulidityTarget(tuple.soulidityCallablePackageId, functionName),
    inputOrder: ['registry', 'compositionConfig', 'profile', 'root',
      'commerceConfig', 'item', 'state'],
    inputs: {
      registry: objectInput(tuple.compositionRegistryV6Id, 'MUTABLE_SHARED'),
      compositionConfig: objectInput(tuple.compositionProtocolConfigV6Id, 'IMMUTABLE_SHARED'),
      profile: objectInput(planContext.profileId, 'IMMUTABLE_SHARED'),
      root: objectInput(planContext.makerRootId, 'IMMUTABLE_SHARED'),
      commerceConfig: objectInput(tuple.commerceProtocolConfigV5Id, 'IMMUTABLE_SHARED'),
      item: objectInput(planContext.ownedItemId, 'MUTABLE_OWNED'),
      state: objectInput(planContext.soulStateId, 'IMMUTABLE_SHARED'),
    },
  })];
  return finalizePlan(
    operation,
    planContext,
    action(operation, planContext, calls, {
      event: 'animacraft::composition_v6::OwnedItemLockChangedV6',
      locked,
      ownedItemId: planContext.ownedItemId,
      soulStateId: planContext.soulStateId,
      soulId: planContext.soulId,
    }, {
      proofPath: 'SOULIDITY_OWNER_PROOF_WRAPPER',
      ownedCustodyPreserved: true,
    }),
    {
      wallet: planContext.wallet,
      makerRootId: planContext.makerRootId,
      profileId: planContext.profileId,
      ownedItemId: planContext.ownedItemId,
      soulStateId: planContext.soulStateId,
      soulId: planContext.soulId,
      locked,
    },
  );
}

function normalizeSelection(selection, index) {
  const bindingMode = string(selection?.bindingMode || selection?.binding);
  if (!Object.hasOwn(SUBJECT_KIND, bindingMode)) {
    fail(
      'COMPOSABLE_PLAYER_V6_SELECTION_BINDING_INVALID',
      `Loadout selection ${index + 1} has an unsupported binding.`,
      { index, bindingMode },
    );
  }
  const slotKey = string(selection?.slotKey);
  if (!slotKey || new TextEncoder().encode(slotKey).byteLength > 256) {
    fail(
      'COMPOSABLE_PLAYER_V6_SELECTION_SLOT_INVALID',
      `Loadout selection ${index + 1} requires a non-empty slot key of at most 256 bytes.`,
      { index },
    );
  }
  const owned = bindingMode === ITEM_BINDING_MODES.OWNED;
  const ownedInstanceId = owned
    ? suiId(selection?.ownedInstanceId, `Loadout selection ${index + 1} OwnedItemV6`)
    : '';
  if (!owned && string(selection?.ownedInstanceId)) {
    fail(
      'COMPOSABLE_PLAYER_V6_SELECTION_OWNED_INSTANCE_FORBIDDEN',
      'Only an Owned binding may include an owned instance ID.',
      { index },
    );
  }
  return {
    productId: suiId(selection?.productId, `Loadout selection ${index + 1} ItemProductV6`),
    slotKey,
    bindingMode,
    subjectKind: SUBJECT_KIND[bindingMode],
    ownedInstanceId,
  };
}

function selectionCalls(tuple, selections) {
  return selections.map((selection, index) => call({
    id: `selection.${index}`,
    target: animacraftTarget(
      tuple.callablePackageId,
      MAKER_COMPOSABLE_PLAYER_V6_MOVE_FUNCTIONS.NEW_LOADOUT_SELECTION,
    ),
    inputOrder: ['productId', 'slotKey', 'subjectKind', 'ownedInstanceId'],
    inputs: {
      productId: selection.productId,
      slotKey: selection.slotKey,
      subjectKind: selection.subjectKind,
      ownedInstanceId: selection.ownedInstanceId
        ? { kind: 'OPTION', value: selection.ownedInstanceId }
        : { kind: 'OPTION', value: null },
    },
    outputs: ['selection'],
  }));
}

/** Hashes the exact BCS shape used by composition_v6::hash_loadout_selections_v6. */
export async function hashMakerComposableV6LoadoutSelections(selections = []) {
  const normalized = selections.map(normalizeSelection);
  const bytes = LoadoutHashInputV6Bcs.serialize({
    selections: normalized.map((selection) => ({
      product_id: { bytes: normalizeSuiAddress(selection.productId) },
      slot_key: selection.slotKey,
      subject_kind: selection.subjectKind,
      owned_instance_id: selection.ownedInstanceId
        ? { bytes: normalizeSuiAddress(selection.ownedInstanceId) }
        : null,
    })),
  }).toBytes();
  return sha256(bytes);
}

/**
 * Builds an atomic Soulidity appearance plan. The no-ability authorization is
 * created and consumed in the same PTB; this module never exposes a plan that
 * attempts to persist or transport it across transactions.
 */
export async function buildMakerComposableV6AppearancePlan({
  runtime = {},
  context = {},
  kind,
  selections = [],
  clientNonce,
  loadoutHash,
} = {}) {
  if (!['INITIAL', 'UPDATE'].includes(kind)) {
    fail(
      'COMPOSABLE_PLAYER_V6_APPEARANCE_KIND_INVALID',
      'Appearance planning requires kind INITIAL or UPDATE.',
    );
  }
  if (!Array.isArray(selections) || selections.length === 0) {
    fail(
      'COMPOSABLE_PLAYER_V6_EMPTY_LOADOUT',
      'Appearance authorization requires at least one exact loadout selection.',
    );
  }
  const normalizedSelections = selections.map(normalizeSelection);
  const duplicateSlots = normalizedSelections
    .map((selection) => selection.slotKey)
    .filter((slot, index, all) => all.indexOf(slot) !== index);
  if (duplicateSlots.length) {
    fail(
      'COMPOSABLE_PLAYER_V6_DUPLICATE_SLOT',
      'Appearance authorization permits at most one Item per slot.',
      { slotKeys: [...new Set(duplicateSlots)] },
    );
  }
  const computedLoadoutHash = await hashMakerComposableV6LoadoutSelections(
    normalizedSelections,
  );
  if (string(loadoutHash)
      && hash32(loadoutHash, 'Loadout hash') !== computedLoadoutHash) {
    fail(
      'COMPOSABLE_PLAYER_V6_LOADOUT_HASH_MISMATCH',
      'The supplied loadout hash does not match the exact ordered BCS selections.',
    );
  }
  const tuple = normalizeTuple(runtime, { soul: true });
  const initial = kind === 'INITIAL';
  const expectedRevision = initial ? '' : u64(context.expectedRevision, 'Expected appearance revision');
  const planContext = {
    ...commonContext(context, tuple),
    soulStateId: suiId(context.soulStateId, 'SoulState'),
    soulId: suiId(context.soulId, 'Soul'),
    appearanceStateId: initial
      ? ''
      : suiId(context.appearanceStateId, 'SoulAppearanceStateV6'),
    expectedRevision,
    clientNonce: hash32(clientNonce, 'Client nonce'),
    loadoutHash: computedLoadoutHash,
  };
  const calls = selectionCalls(tuple, normalizedSelections);
  const authorizationId = initial ? 'appearance.authorize-initial' : 'appearance.authorize-update';
  const authorizationInputs = {
    registry: objectInput(tuple.compositionRegistryV6Id, 'MUTABLE_SHARED'),
    compositionConfig: objectInput(tuple.compositionProtocolConfigV6Id, 'IMMUTABLE_SHARED'),
    profile: objectInput(planContext.profileId, 'IMMUTABLE_SHARED'),
    root: objectInput(planContext.makerRootId, 'IMMUTABLE_SHARED'),
    commerceConfig: objectInput(tuple.commerceProtocolConfigV5Id, 'IMMUTABLE_SHARED'),
    state: objectInput(planContext.soulStateId, initial ? 'MUTABLE_SHARED' : 'IMMUTABLE_SHARED'),
    ...(initial ? {} : {
      appearance: objectInput(planContext.appearanceStateId, 'MUTABLE_SHARED'),
      expectedRevision,
    }),
    clientNonce: hashBytes(planContext.clientNonce, 'Client nonce'),
    loadoutHash: hashBytes(planContext.loadoutHash, 'Loadout hash'),
    selections: normalizedSelections.map((_, index) => resultRef(`selection.${index}`)),
  };
  calls.push(call({
    id: authorizationId,
    target: soulidityTarget(
      tuple.soulidityCallablePackageId,
      initial
        ? MAKER_COMPOSABLE_PLAYER_V6_MOVE_FUNCTIONS.AUTHORIZE_INITIAL_APPEARANCE
        : MAKER_COMPOSABLE_PLAYER_V6_MOVE_FUNCTIONS.AUTHORIZE_APPEARANCE_UPDATE,
    ),
    inputOrder: initial
      ? ['registry', 'compositionConfig', 'profile', 'root', 'commerceConfig',
        'state', 'clientNonce', 'loadoutHash', 'selections']
      : ['registry', 'compositionConfig', 'profile', 'root', 'commerceConfig',
        'state', 'appearance', 'expectedRevision', 'clientNonce', 'loadoutHash',
        'selections'],
    inputs: authorizationInputs,
    outputs: ['authorization'],
  }));
  calls.push(call({
    id: initial ? 'appearance.bind-initial' : 'appearance.apply-update',
    target: soulidityTarget(
      tuple.soulidityCallablePackageId,
      initial
        ? MAKER_COMPOSABLE_PLAYER_V6_MOVE_FUNCTIONS.BIND_INITIAL_APPEARANCE
        : MAKER_COMPOSABLE_PLAYER_V6_MOVE_FUNCTIONS.APPLY_APPEARANCE_UPDATE,
    ),
    inputOrder: initial
      ? ['state', 'profile', 'root', 'authorization']
      : ['state', 'appearance', 'expectedRevision', 'profile', 'root', 'authorization'],
    inputs: initial
      ? {
          state: objectInput(planContext.soulStateId, 'MUTABLE_SHARED'),
          profile: objectInput(planContext.profileId, 'IMMUTABLE_SHARED'),
          root: objectInput(planContext.makerRootId, 'IMMUTABLE_SHARED'),
          authorization: resultRef(authorizationId),
        }
      : {
          state: objectInput(planContext.soulStateId, 'IMMUTABLE_SHARED'),
          appearance: objectInput(planContext.appearanceStateId, 'MUTABLE_SHARED'),
          expectedRevision,
          profile: objectInput(planContext.profileId, 'IMMUTABLE_SHARED'),
          root: objectInput(planContext.makerRootId, 'IMMUTABLE_SHARED'),
          authorization: resultRef(authorizationId),
        },
  }));
  const operation = initial
    ? MAKER_COMPOSABLE_PLAYER_V6_OPERATIONS.AUTHORIZE_INITIAL_APPEARANCE
    : MAKER_COMPOSABLE_PLAYER_V6_OPERATIONS.AUTHORIZE_APPEARANCE_UPDATE;
  const expectedReadback = initial
    ? {
        event: 'soulidity::appearance_v6::GenesisAppearanceV6Created',
        appearanceBound: true,
        soulId: planContext.soulId,
        profileId: planContext.profileId,
        makerRootId: planContext.makerRootId,
        revision: '0',
      }
    : {
        event: 'soulidity::appearance_v6::SoulAppearanceV6Updated',
        soulId: planContext.soulId,
        appearanceStateId: planContext.appearanceStateId,
        previousRevision: expectedRevision,
        revision: (BigInt(expectedRevision) + 1n).toString(),
      };
  return finalizePlan(
    operation,
    planContext,
    action(operation, planContext, calls, expectedReadback, {
      proofPath: 'SOULIDITY_OWNER_PROOF_WRAPPER',
      authorizationLifetime: 'SAME_PTB_ONLY',
      selectionOrderCommitted: true,
      walletBoundCount: normalizedSelections.filter(
        (selection) => selection.subjectKind === SUBJECT_KIND[ITEM_BINDING_MODES.ACCOUNT],
      ).length,
    }),
    {
      wallet: planContext.wallet,
      makerRootId: planContext.makerRootId,
      profileId: planContext.profileId,
      soulStateId: planContext.soulStateId,
      soulId: planContext.soulId,
      appearanceStateId: planContext.appearanceStateId,
      expectedRevision,
      clientNonce: planContext.clientNonce,
      loadoutHash: planContext.loadoutHash,
      selections: normalizedSelections,
    },
  );
}

export async function buildMakerComposableV6PlayerActionPlan(input = {}) {
  if (input.operation === MAKER_COMPOSABLE_PLAYER_V6_OPERATIONS.LOCK_OWNED_ITEM) {
    return buildMakerComposableV6OwnedLockPlan({ ...input, locked: true });
  }
  if (input.operation === MAKER_COMPOSABLE_PLAYER_V6_OPERATIONS.UNLOCK_OWNED_ITEM) {
    return buildMakerComposableV6OwnedLockPlan({ ...input, locked: false });
  }
  if (input.operation === MAKER_COMPOSABLE_PLAYER_V6_OPERATIONS.AUTHORIZE_INITIAL_APPEARANCE) {
    return buildMakerComposableV6AppearancePlan({ ...input, kind: 'INITIAL' });
  }
  if (input.operation === MAKER_COMPOSABLE_PLAYER_V6_OPERATIONS.AUTHORIZE_APPEARANCE_UPDATE) {
    return buildMakerComposableV6AppearancePlan({ ...input, kind: 'UPDATE' });
  }
  const plan = await buildMakerComposableV6ItemEntitlementPlan(input);
  if (input.operation && input.operation !== plan.operation) {
    fail(
      'COMPOSABLE_PLAYER_V6_OPERATION_MISMATCH',
      'The requested Player operation does not match the Product access and binding policy.',
      { requested: input.operation, derived: plan.operation },
    );
  }
  return plan;
}

function checkpointIdentity(plan) {
  if (plan?.schema !== MAKER_COMPOSABLE_PLAYER_V6_PLAN_SCHEMA || plan?.version !== 1) {
    fail(
      'COMPOSABLE_PLAYER_V6_PLAN_INVALID',
      'A supported byte-locked v6 Player action plan is required.',
    );
  }
  return {
    operation: plan.operation,
    binding: clone(plan.binding),
    planIdentity: string(plan.planIdentity),
  };
}

async function assertPlanIdentity(plan) {
  const identity = checkpointIdentity(plan);
  const draft = clone(plan);
  delete draft.planIdentity;
  const expected = await sha256(stableJson(draft));
  if (!identity.planIdentity || identity.planIdentity !== expected) {
    fail(
      'COMPOSABLE_PLAYER_V6_PLAN_IDENTITY_MISMATCH',
      'The Player action plan changed after it was byte-locked.',
    );
  }
  return identity;
}

export async function createMakerComposableV6PlayerCheckpoint({
  plan,
  nonce,
  createdAt,
} = {}) {
  const identity = await assertPlanIdentity(plan);
  const normalizedNonce = string(nonce);
  if (!CHECKPOINT_NONCE.test(normalizedNonce)) {
    fail(
      'COMPOSABLE_PLAYER_V6_CHECKPOINT_NONCE_INVALID',
      'Player action nonce must contain 16-256 safe, non-whitespace characters.',
    );
  }
  const recoveryIdentity = await sha256(stableJson({
    nonce: normalizedNonce,
    planIdentity: identity.planIdentity,
    operation: identity.operation,
    binding: identity.binding,
  }));
  const now = timestamp(createdAt);
  return freeze({
    schema: MAKER_COMPOSABLE_PLAYER_V6_CHECKPOINT_SCHEMA,
    version: 1,
    sequence: 0,
    ...identity,
    nonce: normalizedNonce,
    recoveryIdentity,
    status: MAKER_COMPOSABLE_PLAYER_V6_ACTION_STATUS.PENDING,
    intentKey: '',
    submission: null,
    confirmation: null,
    outputs: null,
    completed: false,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  });
}

export async function hydrateMakerComposableV6PlayerCheckpoint(value, { plan } = {}) {
  const identity = await assertPlanIdentity(plan);
  if (value?.schema !== MAKER_COMPOSABLE_PLAYER_V6_CHECKPOINT_SCHEMA || value?.version !== 1) {
    fail(
      'COMPOSABLE_PLAYER_V6_CHECKPOINT_INVALID',
      'The saved v6 Player checkpoint is unsupported.',
    );
  }
  if (value.operation !== identity.operation
      || value.planIdentity !== identity.planIdentity
      || stableJson(value.binding) !== stableJson(identity.binding)) {
    fail(
      'COMPOSABLE_PLAYER_V6_CHECKPOINT_SCOPE_MISMATCH',
      'The checkpoint belongs to another wallet, Maker, Product, Soul or loadout.',
    );
  }
  const expectedRecoveryIdentity = await sha256(stableJson({
    nonce: value.nonce,
    planIdentity: identity.planIdentity,
    operation: identity.operation,
    binding: identity.binding,
  }));
  if (!CHECKPOINT_NONCE.test(string(value.nonce))
      || value.recoveryIdentity !== expectedRecoveryIdentity) {
    fail(
      'COMPOSABLE_PLAYER_V6_CHECKPOINT_NONCE_MISMATCH',
      'The Player checkpoint recovery nonce does not match this exact action.',
    );
  }
  if (!Object.values(MAKER_COMPOSABLE_PLAYER_V6_ACTION_STATUS).includes(value.status)) {
    fail('COMPOSABLE_PLAYER_V6_CHECKPOINT_INVALID', 'Player checkpoint status is invalid.');
  }
  const completed = value.status === MAKER_COMPOSABLE_PLAYER_V6_ACTION_STATUS.CONFIRMED;
  if (Boolean(value.completed) !== completed) {
    fail(
      'COMPOSABLE_PLAYER_V6_CHECKPOINT_INVALID',
      'Player checkpoint completion does not match its confirmation status.',
    );
  }
  return freeze({ ...clone(value), sequence: safeSequence(value.sequence), completed });
}

export function serializeMakerComposableV6PlayerCheckpoint(checkpoint) {
  return JSON.stringify(checkpoint);
}

function assertRuntimeGate(runtime, plan) {
  if (runtime?.compositionV6ReleaseEnabled !== true) {
    fail(
      'COMPOSABLE_PLAYER_V6_RELEASE_DISABLED',
      'Composable Assets v6 Player writes are disabled. The action plan and checkpoint remain previewable.',
    );
  }
  if (runtime?.network !== 'mainnet') {
    fail(
      'COMPOSABLE_PLAYER_V6_NETWORK_MISMATCH',
      'Production Composable Assets v6 Player writes are restricted to Sui Mainnet.',
    );
  }
  if (runtime?.commerceV5ReleaseEnabled !== true) {
    fail(
      'COMPOSABLE_PLAYER_V6_DEPENDENCY_DISABLED',
      'Composable Assets v6 Player writes require active Commerce v5.',
    );
  }
  const soulAction = Boolean(plan.context.soulidityCallablePackageId);
  if (soulAction && runtime?.canonicalSoulMintEnabled !== true) {
    fail(
      'COMPOSABLE_PLAYER_V6_SOUL_DEPENDENCY_DISABLED',
      'Soul-bound and appearance actions require the canonical Soul protocol gate.',
    );
  }
}

function assertRuntimeMatchesPlan(runtime, plan) {
  const context = plan.context;
  const fields = [
    ['callablePackageId', runtime?.callablePackageId || runtime?.packageId],
    ['compositionV6TypeOriginPackageId', runtime?.compositionV6TypeOriginPackageId],
    ['compositionProtocolConfigV6Id', runtime?.compositionProtocolConfigV6Id],
    ['compositionRegistryV6Id', runtime?.compositionRegistryV6Id],
    ['commerceProtocolConfigV5Id', runtime?.commerceProtocolConfigV5Id],
  ];
  if (context.compositionProtocolTreasuryV6Id) {
    fields.push(
      ['compositionProtocolTreasuryV6Id', runtime?.compositionProtocolTreasuryV6Id],
      ['paymentCoinType', (() => {
        try { return normalizeStructTag(string(runtime?.paymentCoinType)); } catch { return ''; }
      })()],
    );
  }
  if (context.soulidityCallablePackageId) {
    fields.push(
      ['soulidityCallablePackageId', runtime?.soulidityCallablePackageId || runtime?.soulidityPackageId],
      [
        'compositionV6SoulOwnerProofTypeOriginPackageId',
        runtime?.compositionV6SoulOwnerProofTypeOriginPackageId,
      ],
      ['compositionV6SoulOwnerProofType', (() => {
        try { return normalizeStructTag(string(runtime?.compositionV6SoulOwnerProofType)); } catch { return ''; }
      })()],
    );
  }
  const mismatches = fields.filter(([field, value]) => (
    string(context[field]).toLowerCase() !== string(value).toLowerCase()
  )).map(([field]) => field);
  if (mismatches.length) {
    fail(
      'COMPOSABLE_PLAYER_V6_RUNTIME_SCOPE_MISMATCH',
      'The active runtime differs from the package, config, registry, treasury, proof or coin tuple locked by the Player plan.',
      { fields: mismatches },
    );
  }
}

/** Resolve the one Sui transaction action. This is the write boundary. */
export async function nextMakerComposableV6PlayerAction({
  checkpoint,
  plan,
  runtime = {},
} = {}) {
  const hydrated = await hydrateMakerComposableV6PlayerCheckpoint(checkpoint, { plan });
  if (hydrated.completed) return null;
  assertRuntimeGate(runtime, plan);
  assertRuntimeMatchesPlan(runtime, plan);
  if (plan.action.authority.signer !== plan.context.wallet) {
    fail(
      'COMPOSABLE_PLAYER_V6_AUTHORITY_MISMATCH',
      'The Player action signer differs from the byte-locked wallet.',
    );
  }
  return freeze({
    ...clone(plan.action),
    status: hydrated.status,
    intentKey: hydrated.intentKey,
  });
}

function updateCheckpoint(checkpoint, now, patch = {}) {
  return freeze({
    ...clone(checkpoint),
    ...patch,
    sequence: checkpoint.sequence + 1,
    updatedAt: timestamp(now),
  });
}

export async function beginMakerComposableV6PlayerAction({
  checkpoint,
  plan,
  runtime = {},
  now,
} = {}) {
  const hydrated = await hydrateMakerComposableV6PlayerCheckpoint(checkpoint, { plan });
  await nextMakerComposableV6PlayerAction({ checkpoint: hydrated, plan, runtime });
  if (hydrated.status !== MAKER_COMPOSABLE_PLAYER_V6_ACTION_STATUS.PENDING) return hydrated;
  const intentKey = await sha256(stableJson({
    recoveryIdentity: hydrated.recoveryIdentity,
    planIdentity: hydrated.planIdentity,
  }));
  return updateCheckpoint(hydrated, now, {
    status: MAKER_COMPOSABLE_PLAYER_V6_ACTION_STATUS.INTENT,
    intentKey,
    lastError: null,
  });
}

export async function markMakerComposableV6PlayerSubmitted({
  checkpoint,
  plan,
  submission,
  now,
} = {}) {
  const hydrated = await hydrateMakerComposableV6PlayerCheckpoint(checkpoint, { plan });
  if (hydrated.status !== MAKER_COMPOSABLE_PLAYER_V6_ACTION_STATUS.INTENT) {
    fail(
      'COMPOSABLE_PLAYER_V6_INTENT_MISSING',
      'Persist the exact Player action intent before recording a Sui submission.',
    );
  }
  if (!string(submission?.transactionDigest)) {
    fail(
      'COMPOSABLE_PLAYER_V6_SUBMISSION_INVALID',
      'A submitted Player action requires its Sui transaction digest.',
    );
  }
  return updateCheckpoint(hydrated, now, {
    status: MAKER_COMPOSABLE_PLAYER_V6_ACTION_STATUS.SUBMITTED,
    submission: clone(submission),
  });
}

function confirmationOutputs(plan, confirmation) {
  const evidence = object(confirmation);
  if (!string(evidence.transactionDigest) || evidence.readbackVerified !== true) {
    fail(
      'COMPOSABLE_PLAYER_V6_READBACK_REQUIRED',
      'A Player action is confirmed only after its Sui digest and exact state/event readback are verified.',
    );
  }
  if (plan.operation.includes('CLAIM_') || plan.operation.includes('PURCHASE_')) {
    const expectedSubjectId = plan.action.expectedReadback.subjectId;
    if (evidence.entitlementExists !== true
        || !sameSuiId(evidence.profileId, plan.context.profileId)
        || !sameSuiId(evidence.productId, plan.context.productId)
        || !sameSuiId(evidence.subjectId, expectedSubjectId)
        || u64(evidence.paidAtomic, 'Entitlement paid amount')
          !== plan.action.expectedReadback.paidAtomic) {
      fail(
        'COMPOSABLE_PLAYER_V6_ENTITLEMENT_READBACK_REQUIRED',
        'Item acquisition requires the exact entitlement key readback.',
      );
    }
    if (plan.action.expectedReadback.ownedInstanceRequired
        && !SUI_ID.test(string(evidence.ownedInstanceId))) {
      fail(
        'COMPOSABLE_PLAYER_V6_OWNED_INSTANCE_REQUIRED',
        'Owned Item acquisition requires the transferred OwnedItemV6 ID readback.',
      );
    }
  } else if ([MAKER_COMPOSABLE_PLAYER_V6_OPERATIONS.LOCK_OWNED_ITEM,
    MAKER_COMPOSABLE_PLAYER_V6_OPERATIONS.UNLOCK_OWNED_ITEM].includes(plan.operation)) {
    if (evidence.locked !== plan.action.expectedReadback.locked
        || evidence.lockReadbackVerified !== true
        || !sameSuiId(evidence.ownedItemId, plan.context.ownedItemId)
        || !sameSuiId(evidence.soulId, plan.context.soulId)) {
      fail(
        'COMPOSABLE_PLAYER_V6_LOCK_READBACK_REQUIRED',
        'Owned Item lock confirmation must match the exact on-chain lock record.',
      );
    }
  } else if (plan.operation === MAKER_COMPOSABLE_PLAYER_V6_OPERATIONS.AUTHORIZE_INITIAL_APPEARANCE) {
    if (evidence.appearanceBound !== true
        || !SUI_ID.test(string(evidence.genesisAppearanceId))
        || !SUI_ID.test(string(evidence.appearanceStateId))
        || !sameSuiId(evidence.soulId, plan.context.soulId)
        || !sameSuiId(evidence.profileId, plan.context.profileId)
        || !sameSuiId(evidence.makerRootId, plan.context.makerRootId)
        || u64(evidence.revision, 'Initial appearance revision') !== '0') {
      fail(
        'COMPOSABLE_PLAYER_V6_INITIAL_APPEARANCE_READBACK_REQUIRED',
        'Initial appearance confirmation requires Genesis, current state and revision 0 readback.',
      );
    }
  } else if (plan.operation === MAKER_COMPOSABLE_PLAYER_V6_OPERATIONS.AUTHORIZE_APPEARANCE_UPDATE) {
    if (evidence.appearanceRevisionReadback !== true
        || !sameSuiId(evidence.appearanceStateId, plan.context.appearanceStateId)
        || !sameSuiId(evidence.soulId, plan.context.soulId)
        || u64(evidence.previousRevision, 'Previous appearance revision')
          !== plan.context.expectedRevision
        || u64(evidence.revision, 'Appearance revision')
          !== plan.action.expectedReadback.revision) {
      fail(
        'COMPOSABLE_PLAYER_V6_APPEARANCE_UPDATE_READBACK_REQUIRED',
        'Appearance update confirmation requires the exact state and +1 revision readback.',
      );
    }
  }
  return clone(evidence);
}

export async function confirmMakerComposableV6PlayerAction({
  checkpoint,
  plan,
  confirmation,
  now,
} = {}) {
  const hydrated = await hydrateMakerComposableV6PlayerCheckpoint(checkpoint, { plan });
  if (![MAKER_COMPOSABLE_PLAYER_V6_ACTION_STATUS.INTENT,
    MAKER_COMPOSABLE_PLAYER_V6_ACTION_STATUS.SUBMITTED].includes(hydrated.status)) {
    fail(
      'COMPOSABLE_PLAYER_V6_INTENT_MISSING',
      'Recover or submit the persisted Player action intent before confirmation.',
    );
  }
  if (hydrated.status === MAKER_COMPOSABLE_PLAYER_V6_ACTION_STATUS.SUBMITTED
      && string(hydrated.submission?.transactionDigest)
        !== string(confirmation?.transactionDigest)) {
    fail(
      'COMPOSABLE_PLAYER_V6_TRANSACTION_DIGEST_MISMATCH',
      'Confirmation must read back the exact transaction recorded by the checkpoint.',
    );
  }
  const outputs = confirmationOutputs(plan, confirmation);
  return updateCheckpoint(hydrated, now, {
    status: MAKER_COMPOSABLE_PLAYER_V6_ACTION_STATUS.CONFIRMED,
    confirmation: clone(confirmation),
    outputs,
    completed: true,
    lastError: null,
  });
}

export async function recordMakerComposableV6PlayerError({
  checkpoint,
  plan,
  error,
  now,
} = {}) {
  const hydrated = await hydrateMakerComposableV6PlayerCheckpoint(checkpoint, { plan });
  return updateCheckpoint(hydrated, now, {
    lastError: {
      code: string(error?.code) || 'COMPOSABLE_PLAYER_V6_ACTION_FAILED',
      message: string(error?.message) || 'Composable v6 Player action failed.',
      at: timestamp(now),
    },
  });
}
