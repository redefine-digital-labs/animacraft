import { bcs } from '@mysten/sui/bcs';
import { Transaction } from '@mysten/sui/transactions';
import { normalizeStructTag, normalizeSuiAddress } from '@mysten/sui/utils';
import { recipeSlotBcs, recipeValue } from './recipe-hash.js';

export const COMMERCE_V5_VERSION = 5;
export const COMMERCE_V5_CLOCK_OBJECT_ID = '0x6';

export const COMMERCE_V5_RIGHTS = Object.freeze({
  ONCHAIN_NATIVE: 0,
  LICENSE_WRAPPED: 1,
});

export const COMMERCE_V5_LIFECYCLE = Object.freeze({
  ACTIVE: 0,
  PAUSED: 1,
  ARCHIVED: 2,
  SALE_PENDING: 3,
});

export const COMMERCE_V5_COMPLETE_POLICY = Object.freeze({
  UNLIMITED_FREE: 0,
  FREE_QUOTA_THEN_PAID: 1,
  PAID_EVERY_TIME: 2,
  FREE_QUOTA_THEN_BLOCK: 3,
});

export const COMMERCE_V5_ACCESS = Object.freeze({
  FREE: 0,
  PAID_ONCE: 1,
});

export const COMMERCE_V5_STYLE_ROW = Object.freeze({
  VISUAL: 0,
  LOGICAL_NONE: 1,
  LOGICAL_COLOR: 2,
});

const U64_MAX = (1n << 64n) - 1n;
const U16_MAX = (1 << 16) - 1;
const MAKER_RESALE_ROYALTY_MAX_BPS = 500;
const MAKER_MARKET_FEE_MAX_BPS = 1_000;
const PRIMARY_PROTOCOL_FEE_BPS = 1_000;

const CompletionPolicyV5Bcs = bcs.struct('CompletionPolicyV5', {
  mode: bcs.u8(),
  free_quota_per_wallet: bcs.u64(),
  price_atomic: bcs.u64(),
  total_cap: bcs.u64(),
});

export const styleSelectionV5Bcs = bcs.struct('StyleSelectionV5', {
  part_key: bcs.string(),
  item_key: bcs.string(),
  style_key: bcs.string(),
});

const CompleteSelectionHashInputV5Bcs = bcs.struct('CompleteSelectionHashInputV5', {
  recipe: bcs.vector(recipeSlotBcs),
  style_selections: bcs.vector(styleSelectionV5Bcs),
});

const CompleteQuoteV5Bcs = bcs.struct('CompleteQuoteV5', {
  creator_charge_atomic: bcs.u64(),
  protocol_percentage_atomic: bcs.u64(),
  fixed_protocol_fee_atomic: bcs.u64(),
  maker_receives_atomic: bcs.u64(),
  total_due_atomic: bcs.u64(),
  used_pack_count: bcs.u64(),
});

const PackRecordV5Bcs = bcs.struct('PackRecordV5', {
  key: bcs.string(),
  label: bcs.string(),
  access_kind: bcs.u8(),
  purchase_price_atomic: bcs.u64(),
  complete_policy: CompletionPolicyV5Bcs,
  active: bcs.bool(),
  entitlement_count: bcs.u64(),
  complete_count: bcs.u64(),
  style_count: bcs.u64(),
  protected_style_count: bcs.u64(),
});

const StyleBindingKeyV5Bcs = bcs.struct('StyleBindingKeyV5', {
  part_key: bcs.string(),
  item_key: bcs.string(),
  style_key: bcs.string(),
});

const StyleProductRecordV5Bcs = bcs.struct('StyleProductRecordV5', {
  pack_key: bcs.option(bcs.string()),
  asset_blob_id: bcs.string(),
  row_kind: bcs.u8(),
  seal_protected: bcs.bool(),
});

const CompleteOutputRecordV5Bcs = bcs.struct('CompleteOutputRecordV5', {
  seal_id: bcs.byteVector(),
  payer: bcs.Address,
  recipe_hash: bcs.byteVector(),
  output_nonce: bcs.byteVector(),
  output_digest: bcs.byteVector(),
  ciphertext_blob_id: bcs.string(),
  bound_soul_id: bcs.option(bcs.Address),
});

const STYLE_SELECTION_VECTOR_BCS = bcs.vector(styleSelectionV5Bcs);
const RECIPE_VECTOR_BCS = bcs.vector(recipeSlotBcs);

function commerceError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function required(value, label) {
  if (value === undefined || value === null || value === '') {
    throw commerceError('COMMERCE_V5_CONFIG_MISSING', `${label} is required for Animacraft commerce v5.`);
  }
  return value;
}

function normalizedSuiId(value, label) {
  const candidate = String(required(value, label)).trim();
  if (!/^0x[0-9a-f]{1,64}$/i.test(candidate)) {
    throw commerceError('COMMERCE_V5_INVALID_OBJECT_ID', `${label} must be a valid Sui object ID.`);
  }
  return normalizeSuiAddress(candidate);
}

function normalizedMoveType(value, label) {
  const candidate = String(required(value, label)).trim();
  if (!/^0x[0-9a-f]{1,64}::[A-Za-z_][A-Za-z0-9_]*::[A-Za-z_][A-Za-z0-9_]*$/i.test(candidate)) {
    throw commerceError('COMMERCE_V5_INVALID_MOVE_TYPE', `${label} must be a valid concrete Move type.`);
  }
  return normalizeStructTag(candidate);
}

function u64(value, label, { positive = false } = {}) {
  let amount;
  try {
    if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error('unsafe');
    amount = BigInt(String(required(value, label)));
  } catch {
    throw commerceError('COMMERCE_V5_INVALID_U64', `${label} must be an exact unsigned 64-bit integer.`);
  }
  if (amount < 0n || amount > U64_MAX || (positive && amount === 0n)) {
    throw commerceError(
      'COMMERCE_V5_INVALID_U64',
      `${label} must be ${positive ? 'a positive' : 'an'} unsigned 64-bit integer.`,
    );
  }
  return amount;
}

function u16(value, label, max = U16_MAX) {
  const parsed = Number(required(value, label));
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > Math.min(max, U16_MAX)) {
    throw commerceError('COMMERCE_V5_INVALID_U16', `${label} must be an integer from 0 to ${Math.min(max, U16_MAX)}.`);
  }
  return parsed;
}

function makerRoyaltyBps(value, label) {
  const parsed = u16(value, label, MAKER_RESALE_ROYALTY_MAX_BPS);
  if (parsed % 50 !== 0) {
    throw commerceError(
      'COMMERCE_V5_INVALID_ROYALTY',
      `${label} must use a 50 BPS (0.5%) step.`,
    );
  }
  return parsed;
}

function nonEmptyString(value, label) {
  const string = String(required(value, label)).trim();
  if (!string) throw commerceError('COMMERCE_V5_INVALID_STRING', `${label} cannot be empty.`);
  return string;
}

function sameId(left, right) {
  try {
    return normalizedSuiId(left, 'Object ID') === normalizedSuiId(right, 'Object ID');
  } catch {
    return false;
  }
}

function runtimeV5(runtime, { requireTypeOrigin = false } = {}) {
  const callablePackageId = normalizedSuiId(
    runtime?.callablePackageId || runtime?.packageId,
    'commerce v5 callablePackageId',
  );
  const paymentCoinType = normalizedMoveType(runtime?.paymentCoinType, 'commerce v5 paymentCoinType');
  const commerceTypePackageId = requireTypeOrigin
    ? normalizedSuiId(
        runtime?.commerceV5TypeOriginPackageId
          || runtime?.commerceTypePackageId
          || runtime?.typeOriginPackageId
          || runtime?.callablePackageId,
        'commerce v5 commerceTypePackageId',
      )
    : '';
  return { callablePackageId, paymentCoinType, commerceTypePackageId };
}

function target(runtime, functionName) {
  return `${runtimeV5(runtime).callablePackageId}::commerce_v5::${functionName}`;
}

function newTransaction(sender) {
  const transaction = new Transaction();
  if (sender) transaction.setSender(normalizedSuiId(sender, 'Transaction sender'));
  return transaction;
}

function objectArg(transaction, value, label) {
  return transaction.object(normalizedSuiId(value, label));
}

function pureString(transaction, value, label) {
  return transaction.pure.string(nonEmptyString(value, label));
}

function completionPolicy(policy, label = 'Complete policy') {
  const mode = Number(required(policy?.mode, `${label} mode`));
  const quota = u64(policy?.freeQuotaPerWallet ?? policy?.free_quota_per_wallet ?? 0, `${label} free quota`);
  const price = u64(policy?.priceAtomic ?? policy?.price_atomic ?? 0, `${label} price`);
  const totalCap = u64(
    policy?.totalCap ?? policy?.total_cap ?? 0,
    `${label} global Complete cap`,
  );
  if (!Object.values(COMMERCE_V5_COMPLETE_POLICY).includes(mode)) {
    throw commerceError('COMMERCE_V5_INVALID_POLICY', `${label} has an unsupported mode.`);
  }
  if (mode === COMMERCE_V5_COMPLETE_POLICY.UNLIMITED_FREE && (quota !== 0n || price !== 0n)) {
    throw commerceError('COMMERCE_V5_INVALID_POLICY', `${label} unlimited-free mode requires zero quota and zero price.`);
  }
  if (mode === COMMERCE_V5_COMPLETE_POLICY.FREE_QUOTA_THEN_PAID && (quota === 0n || price === 0n)) {
    throw commerceError('COMMERCE_V5_INVALID_POLICY', `${label} quota-then-paid mode requires a positive quota and price.`);
  }
  if (mode === COMMERCE_V5_COMPLETE_POLICY.PAID_EVERY_TIME && (quota !== 0n || price === 0n)) {
    throw commerceError('COMMERCE_V5_INVALID_POLICY', `${label} paid-every-time mode requires zero quota and a positive price.`);
  }
  if (mode === COMMERCE_V5_COMPLETE_POLICY.FREE_QUOTA_THEN_BLOCK && (quota === 0n || price !== 0n)) {
    throw commerceError('COMMERCE_V5_INVALID_POLICY', `${label} quota-then-block mode requires a positive quota and zero price.`);
  }
  return {
    mode,
    freeQuotaPerWallet: quota,
    priceAtomic: price,
    totalCap,
  };
}

function completionPolicyArgument(transaction, runtime, policy, label) {
  const normalized = completionPolicy(policy, label);
  return transaction.moveCall({
    target: target(runtime, 'new_completion_policy_with_cap'),
    arguments: [
      transaction.pure.u8(normalized.mode),
      transaction.pure.u64(normalized.freeQuotaPerWallet),
      transaction.pure.u64(normalized.priceAtomic),
      transaction.pure.u64(normalized.totalCap),
    ],
  });
}

function accessPolicy(access, label = 'Access policy') {
  const kind = Number(required(access?.kind ?? access?.accessKind, `${label} kind`));
  const price = u64(
    access?.purchasePriceAtomic ?? access?.purchase_price_atomic ?? 0,
    `${label} purchase price`,
  );
  if (!Object.values(COMMERCE_V5_ACCESS).includes(kind)) {
    throw commerceError('COMMERCE_V5_INVALID_ACCESS', `${label} has an unsupported access kind.`);
  }
  if (kind === COMMERCE_V5_ACCESS.FREE && price !== 0n) {
    throw commerceError('COMMERCE_V5_INVALID_ACCESS', `${label} FREE mode requires a zero purchase price.`);
  }
  if (kind === COMMERCE_V5_ACCESS.PAID_ONCE && price === 0n) {
    throw commerceError('COMMERCE_V5_INVALID_ACCESS', `${label} PAID_ONCE mode requires a positive purchase price.`);
  }
  return { kind, purchasePriceAtomic: price };
}

function normalizedRecipe(recipe) {
  if (!Array.isArray(recipe) || recipe.length === 0) {
    throw commerceError('COMMERCE_V5_INVALID_RECIPE', 'Complete requires at least one Recipe slot.');
  }
  return recipe.map((slot, index) => ({
    partKey: nonEmptyString(slot?.partKey ?? slot?.part_key, `Recipe slot ${index + 1} Part key`),
    itemKey: nonEmptyString(slot?.itemKey ?? slot?.item_key, `Recipe slot ${index + 1} Item key`),
    colorHex: String(slot?.colorHex ?? slot?.color_hex ?? ''),
    renderOrder: u64(slot?.renderOrder ?? slot?.render_order ?? 0, `Recipe slot ${index + 1} render order`),
  }));
}

export function normalizeStyleSelectionsV5(recipe, styleSelections) {
  const slots = normalizedRecipe(recipe);
  if (!Array.isArray(styleSelections) || styleSelections.length !== slots.length) {
    throw commerceError(
      'COMMERCE_V5_STYLE_SELECTION_MISMATCH',
      'Every Recipe slot must have exactly one StyleSelectionV5.',
    );
  }
  const selections = styleSelections.map((selection, index) => {
    const result = {
      partKey: nonEmptyString(
        selection?.partKey ?? selection?.part_key,
        `Style selection ${index + 1} Part key`,
      ),
      itemKey: nonEmptyString(
        selection?.itemKey ?? selection?.item_key,
        `Style selection ${index + 1} Item key`,
      ),
      styleKey: nonEmptyString(
        selection?.styleKey ?? selection?.style_key,
        `Style selection ${index + 1} Style key`,
      ),
    };
    if (result.partKey !== slots[index].partKey || result.itemKey !== slots[index].itemKey) {
      throw commerceError(
        'COMMERCE_V5_STYLE_SELECTION_MISMATCH',
        `Style selection ${index + 1} does not match its Recipe Part and Item.`,
      );
    }
    return result;
  });
  return { recipe: slots, styleSelections: selections };
}

function recipeBcsValue(recipe) {
  return recipeValue(recipe.map((slot) => ({
    ...slot,
    renderOrder: slot.renderOrder,
  })));
}

function styleSelectionBcsValue(styleSelections) {
  return styleSelections.map((selection) => ({
    part_key: selection.partKey,
    item_key: selection.itemKey,
    style_key: selection.styleKey,
  }));
}

function pureRecipe(transaction, recipe) {
  return transaction.pure(RECIPE_VECTOR_BCS.serialize(recipeBcsValue(recipe)));
}

function pureStyleSelections(transaction, styleSelections) {
  return transaction.pure(STYLE_SELECTION_VECTOR_BCS.serialize(styleSelectionBcsValue(styleSelections)));
}

export function completeSelectionBytesV5(recipe, styleSelections) {
  const normalized = normalizeStyleSelectionsV5(recipe, styleSelections);
  return CompleteSelectionHashInputV5Bcs.serialize({
    recipe: recipeBcsValue(normalized.recipe),
    style_selections: styleSelectionBcsValue(normalized.styleSelections),
  }).toBytes();
}

export async function hashCompleteSelectionV5(recipe, styleSelections) {
  return new Uint8Array(
    await crypto.subtle.digest('SHA-256', completeSelectionBytesV5(recipe, styleSelections)),
  );
}

function bytesEqual(left, right) {
  if (!(left instanceof Uint8Array) || !(right instanceof Uint8Array) || left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function hexBytes(bytes) {
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function byteVector(value, label) {
  const candidate = value?.fields ?? value?.bytes ?? value;
  let bytes;
  if (candidate instanceof Uint8Array) {
    bytes = candidate;
  } else if (Array.isArray(candidate)) {
    if (candidate.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) {
      throw commerceError('COMMERCE_V5_OBJECT_FIELD_INVALID', `${label} contains an invalid byte.`);
    }
    bytes = new Uint8Array(candidate);
  } else if (typeof candidate === 'string' && /^0x[0-9a-f]*$/i.test(candidate)) {
    const hex = candidate.slice(2);
    if (hex.length % 2 !== 0) {
      throw commerceError('COMMERCE_V5_OBJECT_FIELD_INVALID', `${label} is not valid hex.`);
    }
    bytes = new Uint8Array(
      Array.from({ length: hex.length / 2 }, (_, index) => (
        Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
      )),
    );
  } else {
    throw commerceError('COMMERCE_V5_OBJECT_FIELD_INVALID', `${label} is missing or invalid.`);
  }
  return bytes;
}

function exactByteVector(value, length, label) {
  const bytes = byteVector(value, label);
  if (bytes.length !== length) {
    throw commerceError(
      'COMMERCE_V5_OBJECT_FIELD_INVALID',
      `${label} must contain exactly ${length} bytes.`,
      { expectedLength: length, actualLength: bytes.length },
    );
  }
  return bytes;
}

function parseObjectEnvelope(object, structName) {
  if (!object || typeof object !== 'object' || object.error || object.$kind === 'Error') {
    throw commerceError('COMMERCE_V5_OBJECT_UNAVAILABLE', `${structName} is not available from Sui.`);
  }
  const type = String(object.type || object.data?.type || '');
  if (!new RegExp(`::commerce_v5::${structName}(?:<.+>)?$`).test(type)) {
    throw commerceError('COMMERCE_V5_OBJECT_TYPE_MISMATCH', `Expected a commerce_v5::${structName} object.`);
  }
  const objectId = normalizedSuiId(
    object.objectId || object.id || object.data?.objectId,
    `${structName} object ID`,
  );
  const json = object.json ?? object.data?.json ?? object.data?.content?.fields ?? object.content?.fields;
  if (!json || typeof json !== 'object') {
    throw commerceError('COMMERCE_V5_OBJECT_JSON_MISSING', `${structName} JSON fields were not returned by Sui.`);
  }
  const fields = json.fields && typeof json.fields === 'object' ? json.fields : json;
  return { objectId, type: normalizeStructTag(type), fields, raw: object };
}

function field(fields, ...names) {
  for (const name of names) {
    if (fields?.[name] !== undefined) return fields[name];
  }
  return undefined;
}

function jsonId(value) {
  if (typeof value === 'string' && /^0x[0-9a-f]{1,64}$/i.test(value.trim())) {
    return normalizeSuiAddress(value.trim());
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = jsonId(entry);
      if (found) return found;
    }
    return '';
  }
  if (!value || typeof value !== 'object') return '';
  for (const key of ['bytes', 'objectId', 'object_id', 'id', 'address', 'some', 'vec', 'fields']) {
    const found = jsonId(value[key]);
    if (found) return found;
  }
  return '';
}

function optionalJsonId(value) {
  if (value === null || value === undefined) return '';
  if (value?.vec && Array.isArray(value.vec) && value.vec.length === 0) return '';
  return jsonId(value);
}

function optionalStringValue(value, label) {
  if (value === null || value === undefined) return '';
  const option = value?.vec ?? value;
  if (Array.isArray(option)) {
    if (option.length === 0) return '';
    if (option.length !== 1) {
      throw commerceError('COMMERCE_V5_OBJECT_FIELD_INVALID', `${label} has an invalid Option value.`);
    }
    return stringValue(option[0], label);
  }
  return stringValue(option, label);
}

function stringValue(value, label) {
  if (typeof value === 'string') return value;
  if (value?.fields !== undefined) return stringValue(value.fields, label);
  if (value?.bytes !== undefined && typeof value.bytes === 'string') return value.bytes;
  throw commerceError('COMMERCE_V5_OBJECT_FIELD_INVALID', `${label} is missing or invalid.`);
}

function boolValue(value, label) {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 'false') return value === 'true';
  throw commerceError('COMMERCE_V5_OBJECT_FIELD_INVALID', `${label} is missing or invalid.`);
}

function balanceValue(value, label) {
  if (value && typeof value === 'object') {
    const direct = field(value.fields || value, 'value');
    if (direct !== undefined) return u64(direct, label);
  }
  return u64(value, label);
}

function parsePolicyFields(value, label) {
  const fields = value?.fields || value;
  return completionPolicy({
    mode: field(fields, 'mode'),
    freeQuotaPerWallet: field(fields, 'free_quota_per_wallet', 'freeQuotaPerWallet'),
    priceAtomic: field(fields, 'price_atomic', 'priceAtomic'),
    totalCap: field(fields, 'total_cap', 'totalCap'),
  }, label);
}

function parseVersion(fields, label) {
  const version = u64(field(fields, 'version'), `${label} version`);
  if (version !== BigInt(COMMERCE_V5_VERSION)) {
    throw commerceError('COMMERCE_V5_VERSION_MISMATCH', `${label} is not an Animacraft commerce v5 object.`);
  }
  return Number(version);
}

export function parseCommerceProtocolConfigV5(object) {
  const envelope = parseObjectEnvelope(object, 'CommerceProtocolConfigV5');
  const { fields } = envelope;
  return Object.freeze({
    objectId: envelope.objectId,
    type: envelope.type,
    version: parseVersion(fields, 'CommerceProtocolConfigV5'),
    legacyConfigId: normalizedSuiId(
      jsonId(field(fields, 'legacy_config_id', 'legacyConfigId')),
      'Legacy ProtocolFeeConfig ID',
    ),
    legacyAdminCapId: normalizedSuiId(
      jsonId(field(fields, 'legacy_admin_cap_id', 'legacyAdminCapId')),
      'Legacy ProtocolFeeAdminCap ID',
    ),
    treasuryId: normalizedSuiId(
      jsonId(field(fields, 'treasury_id', 'treasuryId')),
      'CommerceProtocolTreasuryV5 ID',
    ),
    paymentCoinType: normalizedMoveType(
      stringValue(field(fields, 'payment_coin_type', 'paymentCoinType'), 'Protocol payment coin type'),
      'Protocol payment coin type',
    ),
    primaryProtocolFeeBps: u16(
      field(fields, 'primary_protocol_fee_bps', 'primaryProtocolFeeBps'),
      'Primary protocol fee BPS',
      PRIMARY_PROTOCOL_FEE_BPS,
    ),
    fixedCompleteFeeAtomic: u64(
      field(fields, 'fixed_complete_fee_atomic', 'fixedCompleteFeeAtomic'),
      'Fixed Complete fee',
    ),
    makerMarketFeeBps: u16(
      field(fields, 'maker_market_fee_bps', 'makerMarketFeeBps'),
      'Maker market fee BPS',
      MAKER_MARKET_FEE_MAX_BPS,
    ),
    logicalAuxiliaryBlobId: optionalStringValue(
      field(fields, 'logical_auxiliary_blob_id', 'logicalAuxiliaryBlobId'),
      'Protocol logical auxiliary Walrus Blob ID',
    ),
    soulBindingProofType: (() => {
      const value = optionalStringValue(
        field(fields, 'soul_binding_proof_type', 'soulBindingProofType'),
        'Protocol Soul binding proof type',
      );
      return value
        ? normalizedMoveType(value, 'Protocol Soul binding proof type')
        : '';
    })(),
    enabled: boolValue(field(fields, 'enabled'), 'Protocol enabled flag'),
  });
}

export function parseCommerceProtocolTreasuryV5(object) {
  const envelope = parseObjectEnvelope(object, 'CommerceProtocolTreasuryV5');
  const { fields } = envelope;
  return Object.freeze({
    objectId: envelope.objectId,
    type: envelope.type,
    version: parseVersion(fields, 'CommerceProtocolTreasuryV5'),
    configId: normalizedSuiId(jsonId(field(fields, 'config_id', 'configId')), 'Protocol config ID'),
    balanceAtomic: balanceValue(field(fields, 'revenue'), 'Protocol treasury balance'),
    totalPrimaryCollectedAtomic: u64(
      field(fields, 'total_primary_collected', 'totalPrimaryCollected'),
      'Protocol primary revenue total',
    ),
    totalFixedCollectedAtomic: u64(
      field(fields, 'total_fixed_collected', 'totalFixedCollected'),
      'Protocol fixed revenue total',
    ),
    totalMarketCollectedAtomic: u64(
      field(fields, 'total_market_collected', 'totalMarketCollected'),
      'Protocol market revenue total',
    ),
    totalWithdrawnAtomic: u64(
      field(fields, 'total_withdrawn', 'totalWithdrawn'),
      'Protocol withdrawn total',
    ),
  });
}

export function parseMakerRootV5(object) {
  const envelope = parseObjectEnvelope(object, 'MakerRootV5');
  const { fields } = envelope;
  // Protocol-130 limits every Move struct to 32 fields. Current v5 roots keep
  // release counters and Seal state in one nested store struct. Falling back
  // to the flat shape keeps local pre-compat fixtures and diagnostic exports
  // readable without changing the public parsed result.
  const releaseValue = field(fields, 'release', 'release_state', 'releaseState');
  const releaseFields = releaseValue?.fields || releaseValue || fields;
  const lifecycle = Number(u64(field(fields, 'lifecycle'), 'Maker lifecycle'));
  if (!Object.values(COMMERCE_V5_LIFECYCLE).includes(lifecycle)) {
    throw commerceError('COMMERCE_V5_INVALID_LIFECYCLE', 'MakerRootV5 contains an unsupported lifecycle value.');
  }
  const rightsOrigin = Number(u64(field(fields, 'rights_origin', 'rightsOrigin'), 'Maker rights origin'));
  if (!Object.values(COMMERCE_V5_RIGHTS).includes(rightsOrigin)) {
    throw commerceError('COMMERCE_V5_INVALID_RIGHTS', 'MakerRootV5 contains an unsupported rights origin.');
  }
  const baseAccess = accessPolicy({
    kind: field(fields, 'base_access_kind', 'baseAccessKind'),
    purchasePriceAtomic: field(fields, 'base_purchase_price_atomic', 'basePurchasePriceAtomic'),
  }, 'Maker Base access');
  const packKeysValue = field(fields, 'pack_keys', 'packKeys');
  const packKeys = Array.isArray(packKeysValue)
    ? packKeysValue.map((value, index) => nonEmptyString(value, `Pack key ${index + 1}`))
    : [];
  const paidPackCount = u64(
    field(releaseFields, 'paid_pack_count', 'paidPackCount'),
    'Maker paid Pack count',
  );
  const protectedStyleCount = u64(
    field(releaseFields, 'protected_style_count', 'protectedStyleCount'),
    'Maker Seal-protected Style count',
  );
  const sealPolicyId = optionalJsonId(
    field(releaseFields, 'seal_policy_id', 'sealPolicyId'),
  );
  const sealReleaseCommitmentBytes = byteVector(
    field(releaseFields, 'seal_release_commitment', 'sealReleaseCommitment'),
    'Maker Seal release commitment',
  );
  const sealPolicyBound = Boolean(sealPolicyId);
  if (
    (sealPolicyBound && sealReleaseCommitmentBytes.length !== 32)
    || (!sealPolicyBound && sealReleaseCommitmentBytes.length !== 0)
  ) {
    throw commerceError(
      'COMMERCE_V5_SEAL_BINDING_INVALID',
      'MakerRootV5 contains an incomplete Seal policy binding.',
    );
  }
  return Object.freeze({
    objectId: envelope.objectId,
    type: envelope.type,
    version: parseVersion(fields, 'MakerRootV5'),
    legacyMakerId: normalizedSuiId(
      jsonId(field(fields, 'legacy_maker_id', 'legacyMakerId')),
      'Legacy OCMaker ID',
    ),
    legacyTreasuryId: normalizedSuiId(
      jsonId(field(fields, 'legacy_treasury_id', 'legacyTreasuryId')),
      'Legacy MakerTreasury ID',
    ),
    controlVaultId: normalizedSuiId(
      jsonId(field(fields, 'control_vault_id', 'controlVaultId')),
      'MakerControlVaultV5 ID',
    ),
    treasuryId: normalizedSuiId(
      jsonId(field(fields, 'treasury_id', 'treasuryId')),
      'MakerTreasuryV5 ID',
    ),
    protocolConfigId: normalizedSuiId(
      jsonId(field(fields, 'protocol_config_id', 'protocolConfigId')),
      'CommerceProtocolConfigV5 ID',
    ),
    paymentCoinType: normalizedMoveType(
      stringValue(field(fields, 'payment_coin_type', 'paymentCoinType'), 'Maker payment coin type'),
      'Maker payment coin type',
    ),
    originalCreator: normalizedSuiId(
      field(fields, 'original_creator', 'originalCreator'),
      'Maker original creator',
    ),
    currentOwner: normalizedSuiId(field(fields, 'current_owner', 'currentOwner'), 'Maker current owner'),
    rightsOrigin,
    lifecycle,
    ownershipEpoch: u64(field(fields, 'ownership_epoch', 'ownershipEpoch'), 'Maker ownership epoch'),
    currentControlCapId: optionalJsonId(
      field(fields, 'current_control_cap_id', 'currentControlCapId'),
    ),
    activeListingId: optionalJsonId(field(fields, 'active_listing_id', 'activeListingId')),
    soulCreatorRoyaltyBps: makerRoyaltyBps(
      field(fields, 'soul_creator_royalty_bps', 'soulCreatorRoyaltyBps'),
      'Soul creator royalty BPS',
    ),
    makerResaleRoyaltyBps: makerRoyaltyBps(
      field(fields, 'maker_resale_royalty_bps', 'makerResaleRoyaltyBps'),
      'Maker resale royalty BPS',
    ),
    baseAccess,
    basePolicy: parsePolicyFields(field(fields, 'base_policy', 'basePolicy'), 'Maker Base Complete policy'),
    packsTableId: normalizedSuiId(jsonId(field(fields, 'packs')), 'Maker Pack table ID'),
    styleRegistryTableId: normalizedSuiId(
      jsonId(field(fields, 'style_registry', 'styleRegistry')),
      'Maker Style registry table ID',
    ),
    logicalAuxiliaryBlobId: nonEmptyString(
      stringValue(
        field(fields, 'logical_auxiliary_blob_id', 'logicalAuxiliaryBlobId'),
        'Maker logical auxiliary Walrus Blob ID',
      ),
      'Maker logical auxiliary Walrus Blob ID',
    ),
    styleRegistrySealed: boolValue(
      field(releaseFields, 'style_registry_sealed', 'styleRegistrySealed'),
      'Style registry sealed flag',
    ),
    completeOutputsTableId: normalizedSuiId(
      jsonId(field(fields, 'complete_outputs', 'completeOutputs')),
      'Maker Complete output table ID',
    ),
    completeOutputCount: u64(
      field(releaseFields, 'complete_output_count', 'completeOutputCount'),
      'Maker Complete output count',
    ),
    packKeys,
    paidPackCount,
    protectedStyleCount,
    requiresSealPolicy:
      baseAccess.kind === COMMERCE_V5_ACCESS.PAID_ONCE || paidPackCount > 0n,
    sealPolicyId,
    sealPolicyBound,
    sealReleaseCommitment: sealPolicyBound
      ? `0x${hexBytes(sealReleaseCommitmentBytes)}`
      : '',
    packCount: u64(field(releaseFields, 'pack_count', 'packCount'), 'Maker Pack count'),
    styleCount: u64(field(releaseFields, 'style_count', 'styleCount'), 'Maker Style count'),
    totalCompletes: u64(field(releaseFields, 'total_completes', 'totalCompletes'), 'Maker Complete count'),
  });
}

export function parseMakerTreasuryV5(object) {
  const envelope = parseObjectEnvelope(object, 'MakerTreasuryV5');
  const { fields } = envelope;
  return Object.freeze({
    objectId: envelope.objectId,
    type: envelope.type,
    version: parseVersion(fields, 'MakerTreasuryV5'),
    rootId: normalizedSuiId(jsonId(field(fields, 'root_id', 'rootId')), 'MakerRootV5 ID'),
    balanceAtomic: balanceValue(field(fields, 'revenue'), 'Maker treasury balance'),
    totalPackCollectedAtomic: u64(
      field(fields, 'total_pack_collected', 'totalPackCollected'),
      'Maker Pack revenue total',
    ),
    totalCompleteCollectedAtomic: u64(
      field(fields, 'total_complete_collected', 'totalCompleteCollected'),
      'Maker Complete revenue total',
    ),
    totalWithdrawnAtomic: u64(
      field(fields, 'total_withdrawn', 'totalWithdrawn'),
      'Maker withdrawn total',
    ),
  });
}

export function parseMakerControlCapV5(object) {
  const envelope = parseObjectEnvelope(object, 'MakerControlCapV5');
  const { fields } = envelope;
  return Object.freeze({
    objectId: envelope.objectId,
    type: envelope.type,
    version: parseVersion(fields, 'MakerControlCapV5'),
    rootId: normalizedSuiId(jsonId(field(fields, 'root_id', 'rootId')), 'MakerRootV5 ID'),
    ownershipEpoch: u64(field(fields, 'ownership_epoch', 'ownershipEpoch'), 'ControlCap ownership epoch'),
  });
}

export function parseMakerListingV5(object) {
  const envelope = parseObjectEnvelope(object, 'MakerListingV5');
  const { fields } = envelope;
  return Object.freeze({
    objectId: envelope.objectId,
    type: envelope.type,
    version: parseVersion(fields, 'MakerListingV5'),
    rootId: normalizedSuiId(jsonId(field(fields, 'root_id', 'rootId')), 'MakerRootV5 ID'),
    seller: normalizedSuiId(field(fields, 'seller'), 'Maker listing seller'),
    priceAtomic: u64(field(fields, 'price_atomic', 'priceAtomic'), 'Maker listing price', { positive: true }),
    ownershipEpoch: u64(field(fields, 'ownership_epoch', 'ownershipEpoch'), 'Listing ownership epoch'),
    protocolFeeBps: u16(
      field(fields, 'protocol_fee_bps', 'protocolFeeBps'),
      'Listing protocol fee BPS',
      MAKER_MARKET_FEE_MAX_BPS,
    ),
    makerResaleRoyaltyBps: makerRoyaltyBps(
      field(fields, 'maker_resale_royalty_bps', 'makerResaleRoyaltyBps'),
      'Listing Maker royalty BPS',
    ),
    active: boolValue(field(fields, 'active'), 'Maker listing active flag'),
  });
}

function parsePass(object, structName, { pack = false } = {}) {
  const envelope = parseObjectEnvelope(object, structName);
  const { fields } = envelope;
  return Object.freeze({
    objectId: envelope.objectId,
    type: envelope.type,
    version: parseVersion(fields, structName),
    rootId: normalizedSuiId(jsonId(field(fields, 'root_id', 'rootId')), 'MakerRootV5 ID'),
    ...(pack
      ? { packKey: nonEmptyString(field(fields, 'pack_key', 'packKey'), 'PackPassV5 Pack key') }
      : {}),
    holder: normalizedSuiId(field(fields, 'holder'), `${structName} holder`),
    issuedAtMs: u64(field(fields, 'issued_at_ms', 'issuedAtMs'), `${structName} issued time`),
    ownershipEpoch: u64(field(fields, 'ownership_epoch', 'ownershipEpoch'), `${structName} ownership epoch`),
  });
}

export function parseMakerAccessPassV5(object) {
  return parsePass(object, 'MakerAccessPassV5');
}

export function parsePackPassV5(object) {
  return parsePass(object, 'PackPassV5', { pack: true });
}

function parsedBcsU64(value, label) {
  return u64(value, label);
}

export function parsePackRecordV5Bcs(bytes) {
  const parsed = PackRecordV5Bcs.parse(bytes);
  const access = accessPolicy({
    kind: parsed.access_kind,
    purchasePriceAtomic: parsed.purchase_price_atomic,
  }, `Pack ${parsed.key} access`);
  const policy = completionPolicy({
    mode: parsed.complete_policy.mode,
    freeQuotaPerWallet: parsed.complete_policy.free_quota_per_wallet,
    priceAtomic: parsed.complete_policy.price_atomic,
    totalCap: parsed.complete_policy.total_cap,
  }, `Pack ${parsed.key} Complete policy`);
  return Object.freeze({
    key: nonEmptyString(parsed.key, 'Pack key'),
    label: nonEmptyString(parsed.label, `Pack ${parsed.key} label`),
    accessKind: access.kind,
    purchasePriceAtomic: access.purchasePriceAtomic,
    completePolicy: Object.freeze(policy),
    active: parsed.active,
    entitlementCount: parsedBcsU64(parsed.entitlement_count, 'Pack entitlement count'),
    completeCount: parsedBcsU64(parsed.complete_count, 'Pack Complete count'),
    styleCount: parsedBcsU64(parsed.style_count, 'Pack Style count'),
    protectedStyleCount: parsedBcsU64(
      parsed.protected_style_count,
      'Pack Seal-protected Style count',
    ),
  });
}

export function parseCompleteQuoteV5Bcs(bytes) {
  const parsed = CompleteQuoteV5Bcs.parse(bytes);
  return Object.freeze({
    creatorChargeAtomic: parsedBcsU64(parsed.creator_charge_atomic, 'Complete creator charge'),
    protocolPercentageAtomic: parsedBcsU64(
      parsed.protocol_percentage_atomic,
      'Complete protocol percentage',
    ),
    fixedProtocolFeeAtomic: parsedBcsU64(
      parsed.fixed_protocol_fee_atomic,
      'Complete fixed protocol fee',
    ),
    makerReceivesAtomic: parsedBcsU64(parsed.maker_receives_atomic, 'Complete Maker receipt'),
    totalDueAtomic: parsedBcsU64(parsed.total_due_atomic, 'Complete total due'),
    usedPackCount: parsedBcsU64(parsed.used_pack_count, 'Complete used Pack count'),
  });
}

export function parseStyleBindingV5Bcs(nameBytes, valueBytes) {
  const key = StyleBindingKeyV5Bcs.parse(nameBytes);
  const value = StyleProductRecordV5Bcs.parse(valueBytes);
  const rowKind = Number(value.row_kind);
  if (!Object.values(COMMERCE_V5_STYLE_ROW).includes(rowKind)) {
    throw commerceError(
      'COMMERCE_V5_INVALID_STYLE_ROW_KIND',
      'Style binding contains an unsupported on-chain row kind.',
    );
  }
  return Object.freeze({
    partKey: nonEmptyString(key.part_key, 'Style binding Part key'),
    itemKey: nonEmptyString(key.item_key, 'Style binding Item key'),
    styleKey: nonEmptyString(key.style_key, 'Style binding Style key'),
    packKey: value.pack_key == null
      ? ''
      : nonEmptyString(value.pack_key, 'Style binding Pack key'),
    assetBlobId: nonEmptyString(value.asset_blob_id, 'Style binding Walrus asset blob ID'),
    rowKind,
    sealProtected: value.seal_protected === true,
  });
}

export function parseCompleteOutputRecordV5Bcs(bytes) {
  const parsed = CompleteOutputRecordV5Bcs.parse(bytes);
  return Object.freeze({
    sealId: `0x${hexBytes(exactByteVector(
      parsed.seal_id,
      32,
      'Complete output Seal ID',
    ))}`,
    payer: normalizedSuiId(parsed.payer, 'Complete output payer'),
    recipeHash: `0x${hexBytes(exactByteVector(
      parsed.recipe_hash,
      32,
      'Complete output recipe hash',
    ))}`,
    outputNonce: `0x${hexBytes(exactByteVector(
      parsed.output_nonce,
      32,
      'Complete output nonce',
    ))}`,
    outputDigest: `0x${hexBytes(exactByteVector(
      parsed.output_digest,
      32,
      'Complete output plaintext digest',
    ))}`,
    ciphertextBlobId: nonEmptyString(
      parsed.ciphertext_blob_id,
      'Complete output ciphertext Walrus Blob ID',
    ),
    boundSoulId: parsed.bound_soul_id == null
      ? ''
      : normalizedSuiId(parsed.bound_soul_id, 'Complete output bound Soul ID'),
    soulBound: parsed.bound_soul_id != null,
  });
}

function assertProtocolState(protocol, runtime, { enabled } = {}) {
  required(protocol, 'CommerceProtocolConfigV5 state');
  if (protocol.version !== COMMERCE_V5_VERSION) {
    throw commerceError('COMMERCE_V5_VERSION_MISMATCH', 'CommerceProtocolConfigV5 state is not version 5.');
  }
  if (protocol.primaryProtocolFeeBps !== PRIMARY_PROTOCOL_FEE_BPS) {
    throw commerceError(
      'COMMERCE_V5_PROTOCOL_POLICY_MISMATCH',
      `Commerce v5 requires a ${PRIMARY_PROTOCOL_FEE_BPS} BPS primary protocol fee.`,
    );
  }
  const expectedCoin = runtimeV5(runtime).paymentCoinType;
  if (normalizeStructTag(protocol.paymentCoinType) !== expectedCoin) {
    throw commerceError('COMMERCE_V5_PAYMENT_COIN_MISMATCH', 'Protocol payment coin does not match runtime config.');
  }
  if (enabled !== undefined && protocol.enabled !== enabled) {
    throw commerceError(
      enabled ? 'COMMERCE_V5_PROTOCOL_DISABLED' : 'COMMERCE_V5_PROTOCOL_ALREADY_ENABLED',
      enabled
        ? 'Animacraft commerce v5 remains disabled on chain.'
        : 'This operation requires the commerce v5 protocol to remain disabled.',
    );
  }
  if (
    enabled === true
    && (!String(protocol.logicalAuxiliaryBlobId || '').trim()
      || !String(protocol.soulBindingProofType || '').trim())
  ) {
    throw commerceError(
      'COMMERCE_V5_PROTOCOL_DEPENDENCY_MISSING',
      'Commerce v5 is not operational until the canonical logical Blob and trusted Soulidity binding proof TypeOrigin are anchored on chain.',
    );
  }
  normalizedSuiId(protocol.objectId, 'CommerceProtocolConfigV5 ID');
  normalizedSuiId(protocol.treasuryId, 'CommerceProtocolTreasuryV5 ID');
  normalizedSuiId(protocol.legacyAdminCapId, 'ProtocolFeeAdminCap ID');
  return protocol;
}

function assertRootState(root, runtime, { lifecycle, operational = false } = {}) {
  required(root, 'MakerRootV5 state');
  if (root.version !== COMMERCE_V5_VERSION) {
    throw commerceError('COMMERCE_V5_VERSION_MISMATCH', 'MakerRootV5 state is not version 5.');
  }
  const expectedCoin = runtimeV5(runtime).paymentCoinType;
  if (normalizeStructTag(root.paymentCoinType) !== expectedCoin) {
    throw commerceError('COMMERCE_V5_PAYMENT_COIN_MISMATCH', 'Maker payment coin does not match runtime config.');
  }
  if (lifecycle !== undefined && root.lifecycle !== lifecycle) {
    throw commerceError('COMMERCE_V5_INVALID_LIFECYCLE', `Maker lifecycle must be ${lifecycle} for this operation.`);
  }
  if (operational && root.lifecycle !== COMMERCE_V5_LIFECYCLE.ACTIVE) {
    throw commerceError('COMMERCE_V5_MAKER_NOT_ACTIVE', 'Maker commerce is not Active.');
  }
  normalizedSuiId(root.objectId, 'MakerRootV5 ID');
  normalizedSuiId(root.treasuryId, 'MakerTreasuryV5 ID');
  normalizedSuiId(root.protocolConfigId, 'CommerceProtocolConfigV5 ID');
  return root;
}

function assertLinkage(root, protocol, runtime) {
  assertRootState(root, runtime);
  assertProtocolState(protocol, runtime);
  if (!sameId(root.protocolConfigId, protocol.objectId)) {
    throw commerceError('COMMERCE_V5_PROTOCOL_MISMATCH', 'MakerRootV5 is linked to a different protocol config.');
  }
  if (normalizeStructTag(root.paymentCoinType) !== normalizeStructTag(protocol.paymentCoinType)) {
    throw commerceError('COMMERCE_V5_PAYMENT_COIN_MISMATCH', 'Maker and protocol payment coin types differ.');
  }
}

function assertTreasury(root, treasury, { requireZero = false } = {}) {
  required(treasury, 'MakerTreasuryV5 state');
  if (!sameId(root.treasuryId, treasury.objectId) || !sameId(root.objectId, treasury.rootId)) {
    throw commerceError('COMMERCE_V5_TREASURY_MISMATCH', 'MakerTreasuryV5 is not linked to this MakerRootV5.');
  }
  if (requireZero && treasury.balanceAtomic !== 0n) {
    throw commerceError(
      'COMMERCE_V5_TREASURY_NOT_EMPTY',
      'Withdraw all Maker revenue before opening or completing a Maker sale.',
    );
  }
}

function assertProtocolTreasury(protocol, treasury) {
  required(treasury, 'CommerceProtocolTreasuryV5 state');
  if (!sameId(protocol.treasuryId, treasury.objectId) || !sameId(protocol.objectId, treasury.configId)) {
    throw commerceError(
      'COMMERCE_V5_PROTOCOL_TREASURY_MISMATCH',
      'CommerceProtocolTreasuryV5 is not linked to the supplied protocol config.',
    );
  }
}

function assertControl(root, controlCap, sender) {
  required(controlCap, 'MakerControlCapV5');
  if (!sameId(root.objectId, controlCap.rootId)
    || !sameId(root.currentControlCapId, controlCap.objectId)
    || root.ownershipEpoch !== controlCap.ownershipEpoch) {
    throw commerceError('COMMERCE_V5_CONTROL_CAP_MISMATCH', 'MakerControlCapV5 is stale or belongs to another Maker.');
  }
  const owner = normalizedSuiId(sender, 'Maker owner');
  if (!sameId(root.currentOwner, owner)) {
    throw commerceError('COMMERCE_V5_NOT_CURRENT_OWNER', 'Only the current Maker owner can perform this action.');
  }
}

function assertOperational(root, protocol, runtime) {
  if (runtime?.commerceV5ReleaseEnabled !== true) {
    throw commerceError(
      'COMMERCE_V5_RELEASE_DISABLED',
      'Animacraft commerce v5 is still behind its reviewed production release gate.',
    );
  }
  assertLinkage(root, protocol, runtime);
  assertRootState(root, runtime, { operational: true });
  assertProtocolState(protocol, runtime, { enabled: true });
}

function assertConfigurable(root) {
  if (![COMMERCE_V5_LIFECYCLE.PAUSED, COMMERCE_V5_LIFECYCLE.ARCHIVED].includes(root.lifecycle)
    || root.activeListingId) {
    throw commerceError(
      'COMMERCE_V5_MAKER_NOT_CONFIGURABLE',
      'Pause or archive the Maker and cancel any active listing before changing commerce configuration.',
    );
  }
}

export function buildInitializeCommerceProtocolV5({
  runtime,
  legacyProtocolConfigId,
  legacyProtocolAdminCapId,
  sender,
}) {
  runtimeV5(runtime);
  const transaction = newTransaction(sender);
  transaction.moveCall({
    target: target(runtime, 'initialize_commerce_protocol_v5'),
    typeArguments: [runtimeV5(runtime).paymentCoinType],
    arguments: [
      objectArg(transaction, legacyProtocolConfigId, 'Legacy ProtocolFeeConfig ID'),
      objectArg(transaction, legacyProtocolAdminCapId, 'Legacy ProtocolFeeAdminCap ID'),
    ],
  });
  return transaction;
}

export function buildConfigureDisabledCommerceProtocolV5({
  runtime,
  protocol,
  legacyProtocolAdminCapId,
  fixedCompleteFeeAtomic,
  makerMarketFeeBps,
  sender,
}) {
  assertProtocolState(protocol, runtime);
  const adminCapId = normalizedSuiId(legacyProtocolAdminCapId, 'Legacy ProtocolFeeAdminCap ID');
  if (!sameId(adminCapId, protocol.legacyAdminCapId)) {
    throw commerceError('COMMERCE_V5_PROTOCOL_ADMIN_MISMATCH', 'ProtocolFeeAdminCap does not control this v5 config.');
  }
  const fixedFee = u64(fixedCompleteFeeAtomic, 'Fixed Complete protocol fee');
  const marketFee = u16(makerMarketFeeBps, 'Maker market fee BPS', MAKER_MARKET_FEE_MAX_BPS);
  const transaction = newTransaction(sender);
  const configArg = objectArg(transaction, protocol.objectId, 'CommerceProtocolConfigV5 ID');
  const capArg = objectArg(transaction, adminCapId, 'ProtocolFeeAdminCap ID');
  transaction.moveCall({
    target: target(runtime, 'update_protocol_enabled_v5'),
    arguments: [configArg, capArg, transaction.pure.bool(false)],
  });
  transaction.moveCall({
    target: target(runtime, 'update_fixed_complete_fee_v5'),
    arguments: [configArg, capArg, transaction.pure.u64(fixedFee)],
  });
  transaction.moveCall({
    target: target(runtime, 'update_maker_market_fee_bps_v5'),
    arguments: [configArg, capArg, transaction.pure.u16(marketFee)],
  });
  return transaction;
}

export function buildBindCommerceProtocolDependenciesV5({
  runtime,
  protocol,
  legacyProtocolAdminCapId,
  logicalAuxiliaryBlobId,
  soulBindingProofType,
  sender,
}) {
  assertProtocolState(protocol, runtime, { enabled: false });
  const adminCapId = normalizedSuiId(
    legacyProtocolAdminCapId,
    'Legacy ProtocolFeeAdminCap ID',
  );
  if (!sameId(adminCapId, protocol.legacyAdminCapId)) {
    throw commerceError(
      'COMMERCE_V5_PROTOCOL_ADMIN_MISMATCH',
      'ProtocolFeeAdminCap does not control this v5 config.',
    );
  }
  if (protocol.logicalAuxiliaryBlobId || protocol.soulBindingProofType) {
    throw commerceError(
      'COMMERCE_V5_PROTOCOL_DEPENDENCY_ALREADY_BOUND',
      'Commerce v5 protocol dependencies are bind-once and this config already contains one.',
    );
  }
  const auxiliaryBlobId = nonEmptyString(
    logicalAuxiliaryBlobId,
    'Canonical logical auxiliary Walrus Blob ID',
  );
  const proofType = normalizedMoveType(
    soulBindingProofType,
    'Soulidity Animacraft Soul binding proof type',
  );
  const transaction = newTransaction(sender);
  const configArg = objectArg(
    transaction,
    protocol.objectId,
    'CommerceProtocolConfigV5 ID',
  );
  const capArg = objectArg(
    transaction,
    adminCapId,
    'ProtocolFeeAdminCap ID',
  );
  transaction.moveCall({
    target: target(runtime, 'bind_logical_auxiliary_blob_v5'),
    arguments: [
      configArg,
      capArg,
      transaction.pure.string(auxiliaryBlobId),
    ],
  });
  transaction.moveCall({
    target: target(runtime, 'bind_soul_binding_proof_type_v5'),
    typeArguments: [proofType],
    arguments: [configArg, capArg],
  });
  return transaction;
}

export function buildMigrateLegacyMakerV5({
  runtime,
  protocol,
  legacyMakerId,
  legacyMakerTreasuryId,
  legacyMakerTreasuryBalanceAtomic,
  legacyMakerAdminCapId,
  rightsOrigin,
  baseCompletePolicy,
  soulCreatorRoyaltyBps,
  makerResaleRoyaltyBps,
  sender,
}) {
  assertProtocolState(protocol, runtime);
  const legacyBalance = u64(legacyMakerTreasuryBalanceAtomic, 'Legacy Maker treasury balance');
  if (legacyBalance !== 0n) {
    throw commerceError(
      'COMMERCE_V5_LEGACY_TREASURY_NOT_EMPTY',
      'Withdraw all v4 Maker revenue before migration.',
    );
  }
  const rights = Number(required(rightsOrigin, 'Rights origin'));
  if (!Object.values(COMMERCE_V5_RIGHTS).includes(rights)) {
    throw commerceError('COMMERCE_V5_INVALID_RIGHTS', 'Rights origin must be ONCHAIN_NATIVE or LICENSE_WRAPPED.');
  }
  const royalty = makerRoyaltyBps(
    makerResaleRoyaltyBps,
    'Maker resale royalty BPS',
  );
  const soulRoyalty = makerRoyaltyBps(
    soulCreatorRoyaltyBps,
    'Soul creator royalty BPS',
  );
  const transaction = newTransaction(sender);
  const basePolicyArg = completionPolicyArgument(
    transaction,
    runtime,
    baseCompletePolicy,
    'Maker Base Complete policy',
  );
  transaction.moveCall({
    target: target(runtime, 'migrate_legacy_maker_v5'),
    typeArguments: [runtimeV5(runtime).paymentCoinType],
    arguments: [
      objectArg(transaction, legacyMakerId, 'Legacy OCMaker ID'),
      objectArg(transaction, legacyMakerTreasuryId, 'Legacy MakerTreasury ID'),
      objectArg(transaction, legacyMakerAdminCapId, 'Legacy MakerAdminCap ID'),
      objectArg(transaction, protocol.objectId, 'CommerceProtocolConfigV5 ID'),
      transaction.pure.u8(rights),
      basePolicyArg,
      transaction.pure.u16(soulRoyalty),
      transaction.pure.u16(royalty),
      transaction.object(COMMERCE_V5_CLOCK_OBJECT_ID),
    ],
  });
  return transaction;
}

export function buildConfigureMakerV5({
  runtime,
  root,
  controlCap,
  sender,
  baseAccess,
  baseCompletePolicy,
  makerResaleRoyaltyBps,
  packs = [],
  styleBindings = [],
  sealStyleRegistry = false,
  activate = false,
  configurePolicy = true,
}) {
  assertRootState(root, runtime);
  assertControl(root, controlCap, sender);
  assertConfigurable(root);
  if (root.styleRegistrySealed && (styleBindings.length || sealStyleRegistry)) {
    throw commerceError('COMMERCE_V5_STYLE_REGISTRY_SEALED', 'The Style registry is already sealed and immutable.');
  }
  if (activate && !root.styleRegistrySealed && !sealStyleRegistry) {
    throw commerceError('COMMERCE_V5_STYLE_REGISTRY_NOT_SEALED', 'Seal the exact Style registry before activation.');
  }
  const transaction = newTransaction(sender);
  const rootArg = objectArg(transaction, root.objectId, 'MakerRootV5 ID');
  const capArg = objectArg(transaction, controlCap.objectId, 'MakerControlCapV5 ID');
  if (configurePolicy) {
    const access = accessPolicy(baseAccess, 'Maker Base access');
    const royalty = makerRoyaltyBps(
      makerResaleRoyaltyBps,
      'Maker resale royalty BPS',
    );
    if (
      root.styleRegistrySealed
      && Number(root.makerResaleRoyaltyBps) !== royalty
    ) {
      throw commerceError(
        'COMMERCE_V5_MAKER_ROYALTY_IMMUTABLE',
        'The original-creator Maker resale royalty is frozen for this sealed release.',
      );
    }
    transaction.moveCall({
      target: target(runtime, 'update_base_access_v5'),
      arguments: [
        rootArg,
        capArg,
        transaction.pure.u8(access.kind),
        transaction.pure.u64(access.purchasePriceAtomic),
      ],
    });
    transaction.moveCall({
      target: target(runtime, 'update_base_policy_v5'),
      arguments: [
        rootArg,
        capArg,
        completionPolicyArgument(
          transaction,
          runtime,
          baseCompletePolicy,
          'Maker Base Complete policy',
        ),
      ],
    });
    if (!root.styleRegistrySealed) {
      transaction.moveCall({
        target: target(runtime, 'update_maker_resale_royalty_v5'),
        arguments: [rootArg, capArg, transaction.pure.u16(royalty)],
      });
    }
  } else if (packs.length) {
    throw commerceError(
      'COMMERCE_V5_POLICY_CONFIGURATION_DISABLED',
      'Pack policy changes are not allowed while registering immutable Styles.',
    );
  }

  const configuredKeys = new Set(root.packKeys || []);
  for (const [index, pack] of packs.entries()) {
    const key = nonEmptyString(pack?.key ?? pack?.packKey, `Pack ${index + 1} key`);
    const label = nonEmptyString(pack?.label, `Pack ${index + 1} label`);
    const packAccess = accessPolicy(pack?.access, `Pack ${key} access`);
    const policyArg = completionPolicyArgument(
      transaction,
      runtime,
      pack?.completePolicy,
      `Pack ${key} Complete policy`,
    );
    const exists = configuredKeys.has(key);
    transaction.moveCall({
      target: target(runtime, exists ? 'update_pack_v5' : 'add_pack_v5'),
      arguments: [
        rootArg,
        capArg,
        transaction.pure.string(key),
        transaction.pure.string(label),
        transaction.pure.u8(packAccess.kind),
        transaction.pure.u64(packAccess.purchasePriceAtomic),
        policyArg,
        ...(exists ? [transaction.pure.bool(pack?.active !== false)] : []),
      ],
    });
    configuredKeys.add(key);
  }

  const bindingKeys = new Set();
  for (const [index, binding] of styleBindings.entries()) {
    const partKey = nonEmptyString(binding?.partKey, `Style binding ${index + 1} Part key`);
    const itemKey = nonEmptyString(binding?.itemKey, `Style binding ${index + 1} Item key`);
    const styleKey = nonEmptyString(binding?.styleKey, `Style binding ${index + 1} Style key`);
    const identity = `${partKey}\u0000${itemKey}\u0000${styleKey}`;
    if (bindingKeys.has(identity)) {
      throw commerceError('COMMERCE_V5_DUPLICATE_STYLE', `Style ${partKey}/${itemKey}/${styleKey} is registered twice.`);
    }
    bindingKeys.add(identity);
    const packKey = String(binding?.packKey || '').trim();
    if (packKey && !configuredKeys.has(packKey)) {
      throw commerceError(
        'COMMERCE_V5_PACK_MISSING',
        `Style ${partKey}/${itemKey}/${styleKey} references unknown Pack ${packKey}.`,
      );
    }
    const rowKind = Number(binding?.rowKind);
    if (!Object.values(COMMERCE_V5_STYLE_ROW).includes(rowKind)) {
      throw commerceError(
        'COMMERCE_V5_INVALID_STYLE_ROW_KIND',
        `Style ${partKey}/${itemKey}/${styleKey} must declare a supported Move-verified row kind.`,
      );
    }
    if (packKey && rowKind !== COMMERCE_V5_STYLE_ROW.VISUAL) {
      throw commerceError(
        'COMMERCE_V5_INVALID_STYLE_ROW_KIND',
        `Pack Style ${partKey}/${itemKey}/${styleKey} must be a visual row.`,
      );
    }
    const functionName = packKey
      ? 'register_pack_style_v5'
      : rowKind === COMMERCE_V5_STYLE_ROW.VISUAL
        ? 'register_base_style_v5'
        : 'register_base_logical_style_v5';
    transaction.moveCall({
      target: target(runtime, functionName),
      arguments: [
        rootArg,
        capArg,
        objectArg(transaction, root.legacyMakerId, 'Legacy OCMaker ID'),
        transaction.pure.string(partKey),
        transaction.pure.string(itemKey),
        transaction.pure.string(styleKey),
        ...(packKey ? [transaction.pure.string(packKey)] : []),
        ...(!packKey && rowKind !== COMMERCE_V5_STYLE_ROW.VISUAL
          ? [transaction.pure.u8(rowKind)]
          : []),
      ],
    });
  }
  if (sealStyleRegistry) {
    if (!styleBindings.length && root.styleCount === 0n) {
      throw commerceError('COMMERCE_V5_STYLE_REGISTRY_EMPTY', 'Register at least one exact Style before sealing.');
    }
    transaction.moveCall({
      target: target(runtime, 'seal_style_registry_v5'),
      arguments: [rootArg, capArg],
    });
  }
  if (activate) {
    transaction.moveCall({
      target: target(runtime, 'activate_maker_v5'),
      arguments: [rootArg, capArg],
    });
  }
  return transaction;
}

function buildLifecycleTransaction({
  runtime,
  root,
  controlCap,
  sender,
  functionName,
  allowedLifecycle,
}) {
  assertRootState(root, runtime);
  assertControl(root, controlCap, sender);
  if (!allowedLifecycle.includes(root.lifecycle)) {
    throw commerceError('COMMERCE_V5_INVALID_LIFECYCLE', `Maker cannot run ${functionName} from its current lifecycle.`);
  }
  const transaction = newTransaction(sender);
  transaction.moveCall({
    target: target(runtime, functionName),
    arguments: [
      objectArg(transaction, root.objectId, 'MakerRootV5 ID'),
      objectArg(transaction, controlCap.objectId, 'MakerControlCapV5 ID'),
    ],
  });
  return transaction;
}

export function buildActivateMakerV5(options) {
  if (!options?.root?.styleRegistrySealed) {
    throw commerceError('COMMERCE_V5_STYLE_REGISTRY_NOT_SEALED', 'Seal the exact Style registry before activation.');
  }
  return buildLifecycleTransaction({
    ...options,
    functionName: 'activate_maker_v5',
    allowedLifecycle: [COMMERCE_V5_LIFECYCLE.PAUSED, COMMERCE_V5_LIFECYCLE.ARCHIVED],
  });
}

export function buildPauseMakerV5(options) {
  return buildLifecycleTransaction({
    ...options,
    functionName: 'pause_maker_v5',
    allowedLifecycle: [COMMERCE_V5_LIFECYCLE.ACTIVE],
  });
}

export function buildArchiveMakerV5(options) {
  return buildLifecycleTransaction({
    ...options,
    functionName: 'archive_maker_v5',
    allowedLifecycle: [COMMERCE_V5_LIFECYCLE.ACTIVE, COMMERCE_V5_LIFECYCLE.PAUSED],
  });
}

export function buildRestoreMakerV5(options) {
  if (options?.root?.lifecycle !== COMMERCE_V5_LIFECYCLE.ARCHIVED) {
    throw commerceError('COMMERCE_V5_INVALID_LIFECYCLE', 'Only an Archived Maker can be restored.');
  }
  return buildActivateMakerV5(options);
}

export function buildPurchaseMakerAccessV5({
  runtime,
  root,
  makerTreasury,
  protocol,
  protocolTreasury,
  walletState,
  sender,
}) {
  assertOperational(root, protocol, runtime);
  assertTreasury(root, makerTreasury);
  assertProtocolTreasury(protocol, protocolTreasury);
  const access = accessPolicy(root.baseAccess, 'Maker Base access');
  if (access.kind !== COMMERCE_V5_ACCESS.PAID_ONCE) {
    throw commerceError('COMMERCE_V5_ACCESS_ALREADY_FREE', 'This Maker does not require a paid access purchase.');
  }
  required(walletState, 'Wallet commerce state');
  if (walletState.ownsMakerAccess) {
    throw commerceError('COMMERCE_V5_ENTITLEMENT_EXISTS', 'This wallet already owns permanent Maker access.');
  }
  const transaction = newTransaction(sender);
  transaction.moveCall({
    target: target(runtime, 'purchase_base_access_v5'),
    typeArguments: [runtimeV5(runtime).paymentCoinType],
    arguments: [
      objectArg(transaction, root.objectId, 'MakerRootV5 ID'),
      objectArg(transaction, makerTreasury.objectId, 'MakerTreasuryV5 ID'),
      objectArg(transaction, protocol.objectId, 'CommerceProtocolConfigV5 ID'),
      objectArg(transaction, protocolTreasury.objectId, 'CommerceProtocolTreasuryV5 ID'),
      transaction.coin({
        type: runtimeV5(runtime).paymentCoinType,
        balance: access.purchasePriceAtomic,
      }),
      transaction.object(COMMERCE_V5_CLOCK_OBJECT_ID),
    ],
  });
  return transaction;
}

function assertPackAcquisition({
  runtime,
  root,
  protocol,
  pack,
  walletState,
}) {
  assertOperational(root, protocol, runtime);
  required(pack, 'PackRecordV5 state');
  required(walletState, 'Wallet commerce state');
  if (!pack.active) throw commerceError('COMMERCE_V5_PACK_INACTIVE', 'This Expansion Pack is not active.');
  if (root.baseAccess.kind === COMMERCE_V5_ACCESS.PAID_ONCE && !walletState.ownsMakerAccess) {
    throw commerceError('COMMERCE_V5_BASE_ENTITLEMENT_MISSING', 'Unlock the Maker before acquiring a Pack.');
  }
  const owned = new Set(walletState.ownedPackKeys || []);
  if (owned.has(pack.key)) {
    throw commerceError('COMMERCE_V5_ENTITLEMENT_EXISTS', 'This wallet already owns the Expansion Pack.');
  }
}

export function buildClaimFreePackV5({
  runtime,
  root,
  protocol,
  pack,
  walletState,
  sender,
}) {
  assertPackAcquisition({ runtime, root, protocol, pack, walletState });
  if (pack.accessKind !== COMMERCE_V5_ACCESS.FREE) {
    throw commerceError('COMMERCE_V5_PACK_REQUIRES_PAYMENT', 'This Expansion Pack requires a one-time payment.');
  }
  const transaction = newTransaction(sender);
  transaction.moveCall({
    target: target(runtime, 'claim_free_pack_v5'),
    arguments: [
      objectArg(transaction, root.objectId, 'MakerRootV5 ID'),
      objectArg(transaction, protocol.objectId, 'CommerceProtocolConfigV5 ID'),
      transaction.pure.string(pack.key),
      transaction.object(COMMERCE_V5_CLOCK_OBJECT_ID),
    ],
  });
  return transaction;
}

export function buildPurchasePackV5({
  runtime,
  root,
  makerTreasury,
  protocol,
  protocolTreasury,
  pack,
  walletState,
  sender,
}) {
  assertPackAcquisition({ runtime, root, protocol, pack, walletState });
  assertTreasury(root, makerTreasury);
  assertProtocolTreasury(protocol, protocolTreasury);
  if (pack.accessKind !== COMMERCE_V5_ACCESS.PAID_ONCE) {
    throw commerceError('COMMERCE_V5_PACK_IS_FREE', 'This Expansion Pack should be claimed without payment.');
  }
  const price = u64(pack.purchasePriceAtomic, 'Pack purchase price', { positive: true });
  const transaction = newTransaction(sender);
  transaction.moveCall({
    target: target(runtime, 'purchase_pack_v5'),
    typeArguments: [runtimeV5(runtime).paymentCoinType],
    arguments: [
      objectArg(transaction, root.objectId, 'MakerRootV5 ID'),
      objectArg(transaction, makerTreasury.objectId, 'MakerTreasuryV5 ID'),
      objectArg(transaction, protocol.objectId, 'CommerceProtocolConfigV5 ID'),
      objectArg(transaction, protocolTreasury.objectId, 'CommerceProtocolTreasuryV5 ID'),
      transaction.pure.string(pack.key),
      transaction.coin({
        type: runtimeV5(runtime).paymentCoinType,
        balance: price,
      }),
      transaction.object(COMMERCE_V5_CLOCK_OBJECT_ID),
    ],
  });
  return transaction;
}

export async function buildQuoteCompleteV5({
  runtime,
  root,
  protocol,
  recipe,
  styleSelections,
  wallet,
}) {
  assertOperational(root, protocol, runtime);
  const normalized = normalizeStyleSelectionsV5(recipe, styleSelections);
  const sender = normalizedSuiId(wallet, 'Complete wallet');
  const recipeHash = await hashCompleteSelectionV5(
    normalized.recipe,
    normalized.styleSelections,
  );
  const transaction = newTransaction(sender);
  transaction.moveCall({
    target: target(runtime, 'quote_complete_v5'),
    arguments: [
      objectArg(transaction, root.objectId, 'MakerRootV5 ID'),
      objectArg(transaction, root.legacyMakerId, 'Legacy OCMaker ID'),
      objectArg(transaction, protocol.objectId, 'CommerceProtocolConfigV5 ID'),
      pureRecipe(transaction, normalized.recipe),
      pureStyleSelections(transaction, normalized.styleSelections),
      transaction.pure.address(sender),
    ],
  });
  return {
    transaction,
    commandIndex: 0,
    context: Object.freeze({
      rootId: normalizedSuiId(root.objectId, 'MakerRootV5 ID'),
      rootOwnershipEpoch: root.ownershipEpoch,
      protocolConfigId: normalizedSuiId(protocol.objectId, 'CommerceProtocolConfigV5 ID'),
      protocolFixedCompleteFeeAtomic: protocol.fixedCompleteFeeAtomic,
      wallet: sender,
      recipeHash,
      recipeHashHex: hexBytes(recipeHash),
    }),
  };
}

export async function simulateCompleteQuoteV5(client, options) {
  if (!client?.simulateTransaction && !client?.core?.simulateTransaction) {
    throw commerceError('COMMERCE_V5_CLIENT_MISSING', 'A Sui client with simulateTransaction is required.');
  }
  const built = await buildQuoteCompleteV5(options);
  const simulate = client.simulateTransaction?.bind(client)
    || client.core.simulateTransaction.bind(client.core);
  const result = await simulate({
    transaction: built.transaction,
    include: { commandResults: true },
  });
  if (result?.FailedTransaction || result?.$kind === 'FailedTransaction') {
    throw commerceError(
      'COMMERCE_V5_QUOTE_FAILED',
      result.FailedTransaction?.status?.error?.message || 'The on-chain Complete quote failed.',
    );
  }
  const output = result?.commandResults?.[built.commandIndex]?.returnValues?.[0]?.bcs;
  if (!(output instanceof Uint8Array)) {
    throw commerceError('COMMERCE_V5_QUOTE_MISSING', 'Sui did not return a readable CompleteQuoteV5.');
  }
  return Object.freeze({
    ...parseCompleteQuoteV5Bcs(output),
    ...built.context,
  });
}

function assertQuoteContext(quote, root, protocol, wallet, recipeHash) {
  required(quote, 'Verified on-chain Complete quote');
  if (!sameId(quote.rootId, root.objectId)
    || quote.rootOwnershipEpoch !== root.ownershipEpoch
    || !sameId(quote.protocolConfigId, protocol.objectId)
    || quote.protocolFixedCompleteFeeAtomic !== protocol.fixedCompleteFeeAtomic
    || !sameId(quote.wallet, wallet)
    || !bytesEqual(quote.recipeHash, recipeHash)) {
    throw commerceError(
      'COMMERCE_V5_STALE_QUOTE',
      'The Complete quote belongs to another Maker, wallet, or exact Style selection.',
    );
  }
  const totalDue = u64(quote.totalDueAtomic, 'Complete quote total');
  const creatorCharge = u64(quote.creatorChargeAtomic, 'Complete quote creator charge');
  const protocolPercentage = u64(
    quote.protocolPercentageAtomic,
    'Complete quote protocol percentage',
  );
  const fixedFee = u64(quote.fixedProtocolFeeAtomic, 'Complete quote fixed fee');
  const makerReceives = u64(quote.makerReceivesAtomic, 'Complete quote Maker receipt');
  const expectedPercentage = (creatorCharge * BigInt(PRIMARY_PROTOCOL_FEE_BPS)) / 10_000n;
  if (creatorCharge + fixedFee !== totalDue) {
    throw commerceError('COMMERCE_V5_INVALID_QUOTE', 'Complete quote totals are internally inconsistent.');
  }
  if (fixedFee !== protocol.fixedCompleteFeeAtomic
    || protocolPercentage !== expectedPercentage
    || makerReceives !== creatorCharge - protocolPercentage) {
    throw commerceError(
      'COMMERCE_V5_INVALID_QUOTE',
      'Complete quote fee split does not match the verified v5 protocol policy.',
    );
  }
  return totalDue;
}

/**
 * Appends the non-drop v5 authorization to the caller's Soulidity mint PTB.
 * The returned value must be consumed in that same transaction.
 *
 * `imageBlobId` is the Walrus ID of the Seal ciphertext. `imageUrl` is a
 * separate public low-resolution preview URL that Soulidity may render
 * without requesting Seal shares.
 */
export async function appendCompleteAuthorizationV5(transaction, {
  runtime,
  root,
  makerTreasury,
  protocol,
  protocolTreasury,
  quote,
  wallet,
  name,
  profileBlobId,
  imageBlobId,
  imageUrl,
  outputSealId,
  outputNonce,
  outputDigest,
  recipe,
  styleSelections,
}) {
  if (!(transaction instanceof Transaction)) {
    throw commerceError('COMMERCE_V5_TRANSACTION_MISSING', 'A Sui Transaction is required.');
  }
  assertOperational(root, protocol, runtime);
  const sender = normalizedSuiId(wallet, 'Complete wallet');
  const transactionSender = transaction.getData().sender;
  if (transactionSender && !sameId(transactionSender, sender)) {
    throw commerceError(
      'COMMERCE_V5_SENDER_MISMATCH',
      'The Complete quote wallet does not match the transaction sender.',
    );
  }
  if (!transactionSender) transaction.setSender(sender);
  const exactOutputSealId = exactByteVector(
    outputSealId,
    32,
    'Complete output Seal ID',
  );
  const exactOutputNonce = exactByteVector(
    outputNonce,
    32,
    'Complete output nonce',
  );
  const exactOutputDigest = exactByteVector(
    outputDigest,
    32,
    'Complete output plaintext digest',
  );
  const normalized = normalizeStyleSelectionsV5(recipe, styleSelections);
  const recipeHash = await hashCompleteSelectionV5(
    normalized.recipe,
    normalized.styleSelections,
  );
  const totalDue = assertQuoteContext(quote, root, protocol, sender, recipeHash);
  const commonArguments = [
    objectArg(transaction, root.objectId, 'MakerRootV5 ID'),
    objectArg(transaction, root.legacyMakerId, 'Legacy OCMaker ID'),
  ];
  const paid = totalDue > 0n;
  if (paid) {
    assertTreasury(root, makerTreasury);
    assertProtocolTreasury(protocol, protocolTreasury);
    commonArguments.push(
      objectArg(transaction, makerTreasury.objectId, 'MakerTreasuryV5 ID'),
      objectArg(transaction, protocol.objectId, 'CommerceProtocolConfigV5 ID'),
      objectArg(transaction, protocolTreasury.objectId, 'CommerceProtocolTreasuryV5 ID'),
      transaction.coin({
        type: runtimeV5(runtime).paymentCoinType,
        balance: totalDue,
      }),
    );
  } else {
    commonArguments.push(
      objectArg(transaction, protocol.objectId, 'CommerceProtocolConfigV5 ID'),
    );
  }
  const authorization = transaction.moveCall({
    target: target(
      runtime,
      paid ? 'authorize_complete_paid_v5' : 'authorize_complete_free_v5',
    ),
    ...(paid ? { typeArguments: [runtimeV5(runtime).paymentCoinType] } : {}),
    arguments: [
      ...commonArguments,
      pureString(transaction, name, 'OC name'),
      pureString(transaction, profileBlobId, 'OC profile Walrus Blob ID'),
      pureString(transaction, imageBlobId, 'OC final-image ciphertext Walrus Blob ID'),
      pureString(transaction, imageUrl, 'OC public preview URL'),
      transaction.pure.vector('u8', [...exactOutputSealId]),
      transaction.pure.vector('u8', [...exactOutputNonce]),
      transaction.pure.vector('u8', [...exactOutputDigest]),
      transaction.pure.vector('u8', [...recipeHash]),
      pureRecipe(transaction, normalized.recipe),
      pureStyleSelections(transaction, normalized.styleSelections),
      transaction.object(COMMERCE_V5_CLOCK_OBJECT_ID),
    ],
  });
  return Object.freeze({
    authorization,
    paid,
    totalDueAtomic: totalDue,
    recipeHash,
    recipeHashHex: hexBytes(recipeHash),
    completeOutput: Object.freeze({
      sealId: `0x${hexBytes(exactOutputSealId)}`,
      outputNonce: `0x${hexBytes(exactOutputNonce)}`,
      outputDigest: `0x${hexBytes(exactOutputDigest)}`,
      ciphertextBlobId: nonEmptyString(
        imageBlobId,
        'OC final-image ciphertext Walrus Blob ID',
      ),
      publicPreviewUrl: nonEmptyString(imageUrl, 'OC public preview URL'),
      soulBindingRequired: true,
      soulBound: false,
    }),
  });
}

export function buildWithdrawMakerRevenueV5({
  runtime,
  root,
  makerTreasury,
  controlCap,
  amountAtomic,
  recipient,
  sender,
}) {
  assertRootState(root, runtime);
  assertControl(root, controlCap, sender);
  assertTreasury(root, makerTreasury);
  const amount = u64(amountAtomic, 'Maker withdrawal amount', { positive: true });
  if (amount > makerTreasury.balanceAtomic) {
    throw commerceError('COMMERCE_V5_INSUFFICIENT_REVENUE', 'Maker treasury does not contain that amount.');
  }
  const transaction = newTransaction(sender);
  transaction.moveCall({
    target: target(runtime, 'withdraw_maker_revenue_v5'),
    typeArguments: [runtimeV5(runtime).paymentCoinType],
    arguments: [
      objectArg(transaction, root.objectId, 'MakerRootV5 ID'),
      objectArg(transaction, makerTreasury.objectId, 'MakerTreasuryV5 ID'),
      objectArg(transaction, controlCap.objectId, 'MakerControlCapV5 ID'),
      transaction.pure.u64(amount),
      transaction.pure.address(normalizedSuiId(recipient, 'Maker revenue recipient')),
    ],
  });
  return transaction;
}

export function buildListMakerForSaleV5({
  runtime,
  root,
  makerTreasury,
  controlCap,
  protocol,
  priceAtomic,
  sender,
}) {
  assertRootState(root, runtime, { lifecycle: COMMERCE_V5_LIFECYCLE.PAUSED });
  assertLinkage(root, protocol, runtime);
  assertProtocolState(protocol, runtime, { enabled: true });
  if (runtime?.commerceV5ReleaseEnabled !== true) {
    throw commerceError(
      'COMMERCE_V5_RELEASE_DISABLED',
      'Animacraft commerce v5 is still behind its reviewed production release gate.',
    );
  }
  assertControl(root, controlCap, sender);
  assertTreasury(root, makerTreasury, { requireZero: true });
  const price = u64(priceAtomic, 'Maker sale price', { positive: true });
  const transaction = newTransaction(sender);
  transaction.moveCall({
    target: target(runtime, 'list_maker_for_sale_v5'),
    typeArguments: [runtimeV5(runtime).paymentCoinType],
    arguments: [
      objectArg(transaction, root.objectId, 'MakerRootV5 ID'),
      objectArg(transaction, makerTreasury.objectId, 'MakerTreasuryV5 ID'),
      objectArg(transaction, controlCap.objectId, 'MakerControlCapV5 ID'),
      objectArg(transaction, protocol.objectId, 'CommerceProtocolConfigV5 ID'),
      transaction.pure.u64(price),
    ],
  });
  return transaction;
}

export function buildCancelMakerListingV5({
  runtime,
  root,
  listing,
  sender,
}) {
  assertRootState(root, runtime, { lifecycle: COMMERCE_V5_LIFECYCLE.SALE_PENDING });
  required(listing, 'MakerListingV5 state');
  const wallet = normalizedSuiId(sender, 'Listing seller');
  if (!listing.active
    || !sameId(listing.rootId, root.objectId)
    || !sameId(root.activeListingId, listing.objectId)
    || listing.ownershipEpoch !== root.ownershipEpoch
    || !sameId(listing.seller, wallet)
    || !sameId(root.currentOwner, wallet)) {
    throw commerceError('COMMERCE_V5_LISTING_MISMATCH', 'The active Maker listing does not belong to this seller and epoch.');
  }
  const transaction = newTransaction(wallet);
  transaction.moveCall({
    target: target(runtime, 'cancel_maker_listing_v5'),
    arguments: [
      objectArg(transaction, root.objectId, 'MakerRootV5 ID'),
      objectArg(transaction, listing.objectId, 'MakerListingV5 ID'),
    ],
  });
  return transaction;
}

export function buildBuyMakerV5({
  runtime,
  root,
  makerTreasury,
  listing,
  protocol,
  protocolTreasury,
  sender,
}) {
  assertLinkage(root, protocol, runtime);
  if (runtime?.commerceV5ReleaseEnabled !== true) {
    throw commerceError(
      'COMMERCE_V5_RELEASE_DISABLED',
      'Animacraft commerce v5 is still behind its reviewed production release gate.',
    );
  }
  assertProtocolState(protocol, runtime, { enabled: true });
  if (root.lifecycle !== COMMERCE_V5_LIFECYCLE.SALE_PENDING) {
    throw commerceError('COMMERCE_V5_INVALID_LIFECYCLE', 'Only a SALE_PENDING Maker can be purchased.');
  }
  assertTreasury(root, makerTreasury, { requireZero: true });
  assertProtocolTreasury(protocol, protocolTreasury);
  required(listing, 'MakerListingV5 state');
  const buyer = normalizedSuiId(sender, 'Maker buyer');
  if (!listing.active
    || !sameId(listing.rootId, root.objectId)
    || !sameId(root.activeListingId, listing.objectId)
    || listing.ownershipEpoch !== root.ownershipEpoch) {
    throw commerceError('COMMERCE_V5_LISTING_MISMATCH', 'MakerListingV5 is stale or belongs to another Maker.');
  }
  if (sameId(listing.seller, buyer)) {
    throw commerceError('COMMERCE_V5_BUYER_IS_SELLER', 'The listing seller cannot buy their own Maker.');
  }
  const transaction = newTransaction(buyer);
  transaction.moveCall({
    target: target(runtime, 'buy_maker_v5'),
    typeArguments: [runtimeV5(runtime).paymentCoinType],
    arguments: [
      objectArg(transaction, root.objectId, 'MakerRootV5 ID'),
      objectArg(transaction, makerTreasury.objectId, 'MakerTreasuryV5 ID'),
      objectArg(transaction, listing.objectId, 'MakerListingV5 ID'),
      objectArg(transaction, protocol.objectId, 'CommerceProtocolConfigV5 ID'),
      objectArg(transaction, protocolTreasury.objectId, 'CommerceProtocolTreasuryV5 ID'),
      transaction.coin({
        type: runtimeV5(runtime).paymentCoinType,
        balance: u64(listing.priceAtomic, 'Maker listing price', { positive: true }),
      }),
    ],
  });
  return transaction;
}

function commerceObjectType(runtime, structName, generic = false) {
  const { commerceTypePackageId } = runtimeV5(runtime, { requireTypeOrigin: true });
  return `${commerceTypePackageId}::commerce_v5::${structName}${generic ? `<${runtimeV5(runtime).paymentCoinType}>` : ''}`;
}

async function listOwnedByType(client, owner, type) {
  const objects = [];
  let cursor = null;
  do {
    const page = await client.listOwnedObjects({
      owner,
      type,
      cursor,
      limit: 50,
      include: { json: true },
    });
    objects.push(...(page?.objects || []));
    cursor = page?.hasNextPage ? page.cursor : null;
  } while (cursor && objects.length < 1_000);
  return objects;
}

export async function queryOwnedCommerceV5State(client, {
  runtime,
  owner,
  rootId,
  root = null,
}) {
  if (!client?.listOwnedObjects) {
    throw commerceError('COMMERCE_V5_CLIENT_MISSING', 'A Sui client with listOwnedObjects is required.');
  }
  const wallet = normalizedSuiId(owner, 'Wallet address');
  const makerRootId = normalizedSuiId(root?.objectId || rootId, 'MakerRootV5 ID');
  const [accessObjects, packObjects, capObjects] = await Promise.all([
    listOwnedByType(client, wallet, commerceObjectType(runtime, 'MakerAccessPassV5')),
    listOwnedByType(client, wallet, commerceObjectType(runtime, 'PackPassV5')),
    listOwnedByType(client, wallet, commerceObjectType(runtime, 'MakerControlCapV5')),
  ]);
  const accessPasses = accessObjects.map(parseMakerAccessPassV5)
    .filter((pass) => sameId(pass.rootId, makerRootId) && sameId(pass.holder, wallet));
  const packPasses = packObjects.map(parsePackPassV5)
    .filter((pass) => sameId(pass.rootId, makerRootId) && sameId(pass.holder, wallet));
  const controlCaps = capObjects.map(parseMakerControlCapV5)
    .filter((cap) => sameId(cap.rootId, makerRootId));
  const currentControlCap = root
    ? controlCaps.find((cap) => (
        sameId(cap.objectId, root.currentControlCapId)
        && cap.ownershipEpoch === root.ownershipEpoch
      )) || null
    : null;
  return Object.freeze({
    wallet,
    rootId: makerRootId,
    ownsMakerAccess: accessPasses.length > 0,
    ownedPackKeys: Object.freeze([...new Set(packPasses.map((pass) => pass.packKey))]),
    accessPasses: Object.freeze(accessPasses),
    packPasses: Object.freeze(packPasses),
    controlCaps: Object.freeze(controlCaps),
    currentControlCap,
  });
}

export function walletHasMakerAccessV5(root, walletState) {
  required(root, 'MakerRootV5 state');
  required(walletState, 'Wallet commerce state');
  return root.baseAccess?.kind === COMMERCE_V5_ACCESS.FREE
    || Boolean(walletState.ownsMakerAccess);
}

export function walletHasPackAccessV5(root, pack, walletState) {
  required(pack, 'PackRecordV5 state');
  if (!pack.active || !walletHasMakerAccessV5(root, walletState)) return false;
  return pack.accessKind === COMMERCE_V5_ACCESS.FREE
    || new Set(walletState.ownedPackKeys || []).has(pack.key);
}

export async function queryPackRecordsV5(client, root) {
  if (!client?.listDynamicFields) {
    throw commerceError('COMMERCE_V5_CLIENT_MISSING', 'A Sui client with listDynamicFields is required.');
  }
  required(root?.packsTableId, 'MakerRootV5 Pack table ID');
  const records = [];
  let cursor = null;
  do {
    const page = await client.listDynamicFields({
      parentId: root.packsTableId,
      cursor,
      limit: 50,
      include: { value: true },
    });
    for (const dynamicField of page?.dynamicFields || []) {
      const bytes = dynamicField?.value?.bcs;
      if (!(bytes instanceof Uint8Array)) {
        throw commerceError('COMMERCE_V5_PACK_RECORD_MISSING', 'Sui did not return PackRecordV5 BCS bytes.');
      }
      records.push(parsePackRecordV5Bcs(bytes));
    }
    cursor = page?.hasNextPage ? page.cursor : null;
  } while (cursor && records.length < 10_000);
  if (BigInt(records.length) !== root.packCount) {
    throw commerceError(
      'COMMERCE_V5_PACK_COUNT_MISMATCH',
      'The on-chain Pack table does not match MakerRootV5.pack_count.',
    );
  }
  const expectedKeys = new Set(root.packKeys || []);
  let packKeysMismatch = false;
  for (const record of records) {
    if (!expectedKeys.delete(record.key)) packKeysMismatch = true;
  }
  if (packKeysMismatch || expectedKeys.size) {
    throw commerceError(
      'COMMERCE_V5_PACK_KEYS_MISMATCH',
      'The on-chain Pack table keys do not match MakerRootV5.pack_keys.',
    );
  }
  return Object.freeze(records);
}

export async function queryStyleBindingsV5(client, root) {
  if (!client?.listDynamicFields) {
    throw commerceError('COMMERCE_V5_CLIENT_MISSING', 'A Sui client with listDynamicFields is required.');
  }
  required(root?.styleRegistryTableId, 'MakerRootV5 Style registry table ID');
  const bindings = [];
  let cursor = null;
  do {
    const page = await client.listDynamicFields({
      parentId: root.styleRegistryTableId,
      cursor,
      limit: 50,
      include: { value: true },
    });
    for (const dynamicField of page?.dynamicFields || []) {
      const nameBytes = dynamicField?.name?.bcs;
      const valueBytes = dynamicField?.value?.bcs;
      if (!(nameBytes instanceof Uint8Array) || !(valueBytes instanceof Uint8Array)) {
        throw commerceError(
          'COMMERCE_V5_STYLE_RECORD_MISSING',
          'Sui did not return exact StyleBindingKeyV5 and StyleProductRecordV5 BCS bytes.',
        );
      }
      bindings.push(parseStyleBindingV5Bcs(nameBytes, valueBytes));
    }
    cursor = page?.hasNextPage ? page.cursor : null;
  } while (cursor && bindings.length < 100_000);

  if (BigInt(bindings.length) !== root.styleCount) {
    throw commerceError(
      'COMMERCE_V5_STYLE_COUNT_MISMATCH',
      'The on-chain exact Style registry does not match MakerRootV5.style_count.',
    );
  }
  const identities = new Set();
  for (const binding of bindings) {
    const identity = `${binding.partKey}\u0000${binding.itemKey}\u0000${binding.styleKey}`;
    if (identities.has(identity)) {
      throw commerceError(
        'COMMERCE_V5_DUPLICATE_STYLE',
        'The on-chain exact Style registry contains a duplicate identity.',
      );
    }
    identities.add(identity);
  }
  return Object.freeze(bindings);
}

export async function queryCompleteOutputRecordsV5(client, root) {
  if (!client?.listDynamicFields) {
    throw commerceError(
      'COMMERCE_V5_CLIENT_MISSING',
      'A Sui client with listDynamicFields is required.',
    );
  }
  required(
    root?.completeOutputsTableId,
    'MakerRootV5 Complete output table ID',
  );
  const records = [];
  let cursor = null;
  do {
    const page = await client.listDynamicFields({
      parentId: root.completeOutputsTableId,
      cursor,
      limit: 50,
      include: { value: true },
    });
    for (const dynamicField of page?.dynamicFields || []) {
      const bytes = dynamicField?.value?.bcs;
      if (!(bytes instanceof Uint8Array)) {
        throw commerceError(
          'COMMERCE_V5_COMPLETE_OUTPUT_MISSING',
          'Sui did not return CompleteOutputRecordV5 BCS bytes.',
        );
      }
      records.push(Object.freeze({
        ...parseCompleteOutputRecordV5Bcs(bytes),
        rootId: normalizedSuiId(
          root.objectId,
          'Complete output MakerRootV5 ID',
        ),
      }));
    }
    cursor = page?.hasNextPage ? page.cursor : null;
  } while (cursor && records.length < 100_000);

  if (BigInt(records.length) !== root.completeOutputCount) {
    throw commerceError(
      'COMMERCE_V5_COMPLETE_OUTPUT_COUNT_MISMATCH',
      'The on-chain Complete output table does not match MakerRootV5.complete_output_count.',
      {
        expected: root.completeOutputCount,
        actual: records.length,
      },
    );
  }
  const identities = new Set();
  for (const record of records) {
    if (identities.has(record.sealId)) {
      throw commerceError(
        'COMMERCE_V5_COMPLETE_OUTPUT_DUPLICATE',
        'The Complete output table contains a duplicate Seal ID.',
      );
    }
    identities.add(record.sealId);
  }
  return Object.freeze(records);
}

export async function queryCompleteOutputRecordV5(client, root, sealId) {
  const exactSealId = exactByteVector(
    sealId,
    32,
    'Complete output Seal ID',
  );
  const expected = `0x${hexBytes(exactSealId)}`;
  if (client?.getDynamicField) {
    let response;
    try {
      response = await client.getDynamicField({
        parentId: required(
          root?.completeOutputsTableId,
          'MakerRootV5 Complete output table ID',
        ),
        name: {
          type: 'vector<u8>',
          bcs: bcs.byteVector().serialize(exactSealId).toBytes(),
        },
      });
    } catch (cause) {
      throw commerceError(
        'COMMERCE_V5_COMPLETE_OUTPUT_NOT_FOUND',
        'The exact Complete output entitlement is not recorded on this MakerRootV5.',
        { sealId: expected, cause },
      );
    }
    const valueBytes = response?.dynamicField?.value?.bcs;
    if (!(valueBytes instanceof Uint8Array)) {
      throw commerceError(
        'COMMERCE_V5_COMPLETE_OUTPUT_MISSING',
        'Sui did not return the exact CompleteOutputRecordV5 BCS bytes.',
      );
    }
    const record = Object.freeze({
      ...parseCompleteOutputRecordV5Bcs(valueBytes),
      rootId: normalizedSuiId(
        root.objectId,
        'Complete output MakerRootV5 ID',
      ),
    });
    if (record.sealId !== expected) {
      throw commerceError(
        'COMMERCE_V5_COMPLETE_OUTPUT_MISMATCH',
        'The returned Complete output record does not match the requested Seal ID.',
        { expected, actual: record.sealId },
      );
    }
    return record;
  }
  const records = await queryCompleteOutputRecordsV5(client, root);
  const record = records.find((candidate) => candidate.sealId === expected);
  if (!record) {
    throw commerceError(
      'COMMERCE_V5_COMPLETE_OUTPUT_NOT_FOUND',
      'The exact Complete output entitlement is not recorded on this MakerRootV5.',
      { sealId: expected },
    );
  }
  return record;
}

export async function queryCommerceV5Objects(client, {
  protocolConfigId,
  protocolTreasuryId,
  makerRootId,
  makerTreasuryId,
  listingId = '',
}) {
  if (!client?.getObjects) {
    throw commerceError('COMMERCE_V5_CLIENT_MISSING', 'A Sui client with getObjects is required.');
  }
  const requested = [
    ['protocol', normalizedSuiId(protocolConfigId, 'CommerceProtocolConfigV5 ID')],
    ['protocolTreasury', normalizedSuiId(protocolTreasuryId, 'CommerceProtocolTreasuryV5 ID')],
    ['root', normalizedSuiId(makerRootId, 'MakerRootV5 ID')],
    ['makerTreasury', normalizedSuiId(makerTreasuryId, 'MakerTreasuryV5 ID')],
    ...(listingId ? [['listing', normalizedSuiId(listingId, 'MakerListingV5 ID')]] : []),
  ];
  const response = await client.getObjects({
    objectIds: requested.map(([, id]) => id),
    include: { json: true },
  });
  const byId = new Map(
    (response?.objects || [])
      .filter((object) => !object?.error)
      .map((object) => [normalizedSuiId(object.objectId || object.id, 'Sui object ID'), object]),
  );
  const object = (name, id) => {
    const found = byId.get(id);
    if (!found) throw commerceError('COMMERCE_V5_OBJECT_UNAVAILABLE', `${name} was not returned by Sui.`);
    return found;
  };
  const state = {
    protocol: parseCommerceProtocolConfigV5(object('CommerceProtocolConfigV5', requested[0][1])),
    protocolTreasury: parseCommerceProtocolTreasuryV5(
      object('CommerceProtocolTreasuryV5', requested[1][1]),
    ),
    root: parseMakerRootV5(object('MakerRootV5', requested[2][1])),
    makerTreasury: parseMakerTreasuryV5(object('MakerTreasuryV5', requested[3][1])),
  };
  if (listingId) {
    state.listing = parseMakerListingV5(object('MakerListingV5', requested[4][1]));
  }
  if (!sameId(state.root.protocolConfigId, state.protocol.objectId)
    || !sameId(state.protocol.treasuryId, state.protocolTreasury.objectId)
    || !sameId(state.protocol.objectId, state.protocolTreasury.configId)
    || !sameId(state.root.treasuryId, state.makerTreasury.objectId)
    || !sameId(state.root.objectId, state.makerTreasury.rootId)
    || normalizeStructTag(state.root.paymentCoinType) !== normalizeStructTag(state.protocol.paymentCoinType)) {
    throw commerceError(
      'COMMERCE_V5_STATE_LINKAGE_MISMATCH',
      'The returned protocol, MakerRootV5, and treasury objects are not linked to one another.',
    );
  }
  if (state.listing && (!sameId(state.listing.rootId, state.root.objectId)
    || !sameId(state.root.activeListingId, state.listing.objectId)
    || state.listing.ownershipEpoch !== state.root.ownershipEpoch)) {
    throw commerceError(
      'COMMERCE_V5_LISTING_MISMATCH',
      'The returned MakerListingV5 is stale or belongs to another Maker.',
    );
  }
  return Object.freeze(state);
}

function eventJson(event) {
  const json = event?.contents?.json ?? event?.parsedJson ?? event?.json;
  return json?.fields && typeof json.fields === 'object' ? json.fields : json;
}

function eventAmount(json, snake, camel) {
  const value = field(json, snake, camel);
  return value === undefined ? undefined : u64(value, snake);
}

export function parseCommerceV5Event(event) {
  const type = String(event?.type || event?.contents?.type?.repr || '');
  const match = type.match(/::commerce_v5::([A-Za-z0-9_]+)$/);
  if (!match) return null;
  const name = match[1];
  const json = eventJson(event);
  if (!json || typeof json !== 'object') {
    throw commerceError('COMMERCE_V5_EVENT_INVALID', `${name} event JSON is missing.`);
  }
  const id = (snake, camel = snake) => {
    const value = field(json, snake, camel);
    return value === undefined ? undefined : normalizedSuiId(jsonId(value) || value, snake);
  };
  const address = (snake, camel = snake) => {
    const value = field(json, snake, camel);
    return value === undefined ? undefined : normalizedSuiId(value, snake);
  };
  const bytes32 = (snake, camel = snake) => {
    const value = field(json, snake, camel);
    return value === undefined
      ? undefined
      : `0x${hexBytes(exactByteVector(value, 32, snake))}`;
  };
  const common = Object.freeze({
    type,
    name,
    transactionDigest: event?.transaction?.digest || event?.transactionDigest || '',
    configId: id('config_id', 'configId'),
    legacyConfigId: id('legacy_config_id', 'legacyConfigId'),
    rootId: id('root_id', 'rootId'),
    legacyMakerId: id('legacy_maker_id', 'legacyMakerId'),
    legacyTreasuryId: id('legacy_treasury_id', 'legacyTreasuryId'),
    treasuryId: id('treasury_id', 'treasuryId'),
    vaultId: id('vault_id', 'vaultId'),
    controlCapId: id('control_cap_id', 'controlCapId'),
    listingId: id('listing_id', 'listingId'),
    accessPassId: id('access_pass_id', 'accessPassId'),
    packPassId: id('pack_pass_id', 'packPassId'),
    soulId: id('soul_id', 'soulId'),
    owner: address('owner'),
    holder: address('holder'),
    seller: address('seller'),
    buyer: address('buyer'),
    payer: address('payer'),
    packKey: field(json, 'pack_key', 'packKey'),
    sealId: bytes32('seal_id', 'sealId'),
    outputSealId: bytes32('output_seal_id', 'outputSealId'),
    outputNonce: bytes32('output_nonce', 'outputNonce'),
    outputDigest: bytes32('output_digest', 'outputDigest'),
    ciphertextBlobId: field(
      json,
      'ciphertext_blob_id',
      'ciphertextBlobId',
    ),
    logicalAuxiliaryBlobId: field(
      json,
      'blob_id',
      'logicalAuxiliaryBlobId',
    ),
    soulBindingProofType: field(json, 'proof_type', 'soulBindingProofType'),
    paymentCoinType: field(json, 'payment_coin_type', 'paymentCoinType'),
    accessKind: field(json, 'access_kind', 'accessKind'),
    enabled: field(json, 'enabled'),
    active: field(json, 'active'),
    rightsOrigin: field(json, 'rights_origin', 'rightsOrigin'),
    previousLifecycle: field(json, 'previous', 'previousLifecycle'),
    currentLifecycle: field(json, 'current', 'currentLifecycle'),
    ownershipEpoch: eventAmount(json, 'ownership_epoch', 'ownershipEpoch'),
    paidAtomic: eventAmount(json, 'paid_atomic', 'paidAtomic'),
    priceAtomic: eventAmount(json, 'price_atomic', 'priceAtomic'),
    creatorChargeAtomic: eventAmount(json, 'creator_charge_atomic', 'creatorChargeAtomic'),
    protocolPercentageAtomic: eventAmount(
      json,
      'protocol_percentage_atomic',
      'protocolPercentageAtomic',
    ),
    fixedProtocolFeeAtomic: eventAmount(
      json,
      'fixed_protocol_fee_atomic',
      'fixedProtocolFeeAtomic',
    ),
    totalPaidAtomic: eventAmount(json, 'total_paid_atomic', 'totalPaidAtomic'),
    protocolFeeAtomic: eventAmount(json, 'protocol_fee_atomic', 'protocolFeeAtomic'),
    originalCreatorRoyaltyAtomic: eventAmount(
      json,
      'original_creator_royalty_atomic',
      'originalCreatorRoyaltyAtomic',
    ),
  });
  return common;
}
