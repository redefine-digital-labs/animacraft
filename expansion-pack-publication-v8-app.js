import { bcs } from '@mysten/sui/bcs';
import { Transaction } from '@mysten/sui/transactions';
import { normalizeStructTag, normalizeSuiAddress } from '@mysten/sui/utils';
import { deriveExpansionPackSealReleaseCommitmentV8 } from './maker-seal-v5.js';

export const EXPANSION_PACK_V8_VERSION = 8;
export const EXPANSION_PACK_V8_CLOCK_OBJECT_ID = '0x6';
export const EXPANSION_PACK_V8_MODULE = 'expansion_pack_v8';
export const EXPANSION_PACK_V8_SEAL_APPROVE_FUNCTION = 'seal_approve_style_v8';
export const MAKER_RELEASE_EVIDENCE_V5_FIELD_KEY =
  'animacraft.maker-release-evidence.v5';

export const EXPANSION_PACK_V8_ACCESS = Object.freeze({
  FREE: 0,
  PAID_ONCE: 1,
});

export const EXPANSION_PACK_V8_LIFECYCLE = Object.freeze({
  DRAFT: 0,
  SEALED: 1,
  ADMITTED: 2,
  ACTIVE: 3,
  PAUSED: 4,
  ARCHIVED: 5,
});

const LIFECYCLE_NAME = Object.freeze(Object.fromEntries(
  Object.entries(EXPANSION_PACK_V8_LIFECYCLE).map(([name, value]) => [value, name]),
));
const SUI_ID = /^0x[0-9a-f]{1,64}$/i;
const HASH = /^(?:0x)?[0-9a-f]{64}$/i;
const U64_MAX = (1n << 64n) - 1n;
const MOVE_STRING = '0x1::string::String';

const STYLE_ASSET_KEY_V8_BCS = bcs.struct('StyleAssetKeyV8', {
  part_key: bcs.string(),
  item_key: bcs.string(),
  style_key: bcs.string(),
});
const STYLE_ASSET_RECORD_V8_BCS = bcs.struct('StyleAssetRecordV8', {
  asset_blob_id: bcs.string(),
  asset_sha256: bcs.byteVector(),
  asset_seal_id: bcs.byteVector(),
});
const MAKER_RELEASE_EVIDENCE_V5_BCS = bcs.struct('MakerReleaseEvidenceV5', {
  parent_version: bcs.string(),
  manifest_blob_id: bcs.string(),
  manifest_sha256: bcs.byteVector(),
});

export class ExpansionPackV8AppError extends Error {
  constructor(message, code = 'EXPANSION_PACK_V8_APP_ERROR', details = {}) {
    super(message);
    this.name = 'ExpansionPackV8AppError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new ExpansionPackV8AppError(message, code, details);
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function required(value, label) {
  const result = String(value ?? '').trim();
  if (!result) fail('EXPANSION_PACK_V8_INPUT_MISSING', `${label} is required.`, { label });
  return result;
}

function exactId(value, label) {
  const result = required(value, label).toLowerCase();
  if (!SUI_ID.test(result)) {
    fail('EXPANSION_PACK_V8_OBJECT_ID_INVALID', `${label} must be a Sui object ID.`, {
      label,
      value,
    });
  }
  return result;
}

function comparableId(value) {
  try {
    return normalizeSuiAddress(exactId(value, 'Sui object ID'));
  } catch {
    return '';
  }
}

function sameId(left, right) {
  return Boolean(comparableId(left)) && comparableId(left) === comparableId(right);
}

function exactMoveType(value, label) {
  try {
    return normalizeStructTag(required(value, label));
  } catch {
    fail('EXPANSION_PACK_V8_MOVE_TYPE_INVALID', `${label} must be a concrete Move type.`, {
      label,
      value,
    });
  }
}

function u8(value, label) {
  const result = Number(value);
  if (!Number.isInteger(result) || result < 0 || result > 255) {
    fail('EXPANSION_PACK_V8_U8_INVALID', `${label} must be an unsigned 8-bit integer.`, {
      label,
      value,
    });
  }
  return result;
}

function u64(value, label, { positive = false } = {}) {
  let result;
  try {
    if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error('unsafe');
    result = BigInt(required(value, label));
  } catch {
    fail('EXPANSION_PACK_V8_U64_INVALID', `${label} must be an exact unsigned integer.`, {
      label,
      value,
    });
  }
  if (result < 0n || result > U64_MAX || (positive && result === 0n)) {
    fail(
      'EXPANSION_PACK_V8_U64_INVALID',
      `${label} must be ${positive ? 'a positive' : 'an'} unsigned 64-bit integer.`,
      { label, value },
    );
  }
  return result;
}

function hex(value, label, { allowEmpty = false } = {}) {
  if ((value === '' || value == null) && allowEmpty) return '';
  if (typeof value === 'string') {
    const result = value.replace(/^0x/i, '').toLowerCase();
    if (HASH.test(result)) return result;
  }
  const rawBytes = value?.bytes || value?.vec || value;
  const bytes = ArrayBuffer.isView(rawBytes) ? Array.from(rawBytes) : array(rawBytes);
  if (allowEmpty && bytes.length === 0) return '';
  if (bytes.length === 32 && bytes.every((entry) => Number.isInteger(Number(entry))
    && Number(entry) >= 0 && Number(entry) <= 255)) {
    return bytes.map((entry) => Number(entry).toString(16).padStart(2, '0')).join('');
  }
  fail('EXPANSION_PACK_V8_HASH_INVALID', `${label} must be an exact 32-byte commitment.`, {
    label,
    value,
  });
}

function hexBytes(value, label, options) {
  const normalized = hex(value, label, options);
  return Array.from(
    { length: normalized.length / 2 },
    (_, index) => Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16),
  );
}

function stringValue(value, label, { allowEmpty = false } = {}) {
  let result = '';
  if (typeof value === 'string') result = value;
  else if (value && typeof value === 'object') {
    if (typeof value.bytes === 'string') result = value.bytes;
    else if (value.fields !== undefined) return stringValue(value.fields, label, { allowEmpty });
    else if (value.value !== undefined) return stringValue(value.value, label, { allowEmpty });
  }
  if (!allowEmpty && !result) {
    fail('EXPANSION_PACK_V8_OBJECT_FIELD_INVALID', `${label} is missing or empty.`);
  }
  return result;
}

function field(value, ...names) {
  const source = object(value?.fields || value);
  for (const name of names) if (source[name] !== undefined) return source[name];
  return undefined;
}

function jsonId(value) {
  if (typeof value === 'string' && SUI_ID.test(value.trim())) return value.trim().toLowerCase();
  if (Array.isArray(value)) return value.map(jsonId).find(Boolean) || '';
  if (!value || typeof value !== 'object') return '';
  for (const key of ['bytes', 'objectId', 'object_id', 'id', 'address', 'some', 'vec', 'fields']) {
    const result = jsonId(value[key]);
    if (result) return result;
  }
  return '';
}

function optionId(value, label) {
  if (value == null) return '';
  const vec = value?.vec;
  if (Array.isArray(vec)) {
    if (vec.length === 0) return '';
    if (vec.length !== 1) fail('EXPANSION_PACK_V8_OBJECT_FIELD_INVALID', `${label} is invalid.`);
    return exactId(jsonId(vec[0]), label);
  }
  const result = jsonId(value);
  return result ? exactId(result, label) : '';
}

function objectId(value) {
  return jsonId(value?.objectId || value?.id || value?.data?.objectId || value);
}

function objectType(value) {
  return String(value?.type || value?.data?.type || value?.content?.type || value?.data?.content?.type || '');
}

function objectFields(value) {
  return value?.json?.fields
    || value?.json
    || value?.data?.json?.fields
    || value?.data?.json
    || value?.data?.content?.fields
    || value?.content?.fields
    || null;
}

function addressOwner(value) {
  const owner = value?.owner || value?.data?.owner;
  return jsonId(owner?.AddressOwner || owner?.addressOwner || owner?.address_owner || '');
}

function isShared(value) {
  const owner = value?.owner || value?.data?.owner;
  return Boolean(owner?.Shared || owner?.shared || owner === 'Shared');
}

function typeOrigin(runtime) {
  return exactId(
    runtime?.expansionPackV8TypeOriginPackageId,
    'Expansion Pack v8 stable TypeOrigin package',
  );
}

function callablePackage(runtime) {
  return exactId(
    runtime?.expansionPackV8CallablePackageId || runtime?.expansionPackV8PackageId,
    'Expansion Pack v8 callable package',
  );
}

function commerceCallablePackage(runtime) {
  return exactId(
    runtime?.commerceV5CallablePackageId || runtime?.callablePackageId,
    'Commerce v5 callable package',
  );
}

function expectedType(runtime, structName, typeArgument = '') {
  const base = `${typeOrigin(runtime)}::${EXPANSION_PACK_V8_MODULE}::${structName}`;
  return normalizeStructTag(typeArgument ? `${base}<${exactMoveType(typeArgument, 'Payment coin type')}>` : base);
}

function envelope(value, runtime, structName, typeArgument = '') {
  const id = exactId(objectId(value), `${structName} object ID`);
  let type;
  try {
    type = normalizeStructTag(required(objectType(value), `${structName} object type`));
  } catch {
    fail('EXPANSION_PACK_V8_TYPE_ORIGIN_MISMATCH', `${structName} has an invalid Move type.`);
  }
  const expected = expectedType(runtime, structName, typeArgument);
  if (type !== expected) {
    fail(
      'EXPANSION_PACK_V8_TYPE_ORIGIN_MISMATCH',
      `${structName} is not defined by the configured stable Expansion Pack v8 TypeOrigin.`,
      { expected, actual: type },
    );
  }
  const fields = objectFields(value);
  if (!fields || typeof fields !== 'object') {
    fail('EXPANSION_PACK_V8_OBJECT_JSON_MISSING', `${structName} JSON fields were not returned by Sui.`);
  }
  const version = u64(field(fields, 'version'), `${structName} version`);
  if (version !== BigInt(EXPANSION_PACK_V8_VERSION)) {
    fail('EXPANSION_PACK_V8_VERSION_MISMATCH', `${structName} is not a v8 object.`);
  }
  return { id, type, fields, raw: value };
}

export function parseExpansionPackReleaseV8(value, { runtime } = {}) {
  const parsed = envelope(value, runtime, 'ExpansionPackReleaseV8');
  const { fields } = parsed;
  const lifecycle = u8(field(fields, 'lifecycle'), 'Expansion Pack lifecycle');
  const accessKind = u8(field(fields, 'access_kind', 'accessKind'), 'Expansion Pack access kind');
  if (!Object.values(EXPANSION_PACK_V8_LIFECYCLE).includes(lifecycle)) {
    fail('EXPANSION_PACK_V8_LIFECYCLE_INVALID', 'ExpansionPackReleaseV8 has an unknown lifecycle.');
  }
  if (!Object.values(EXPANSION_PACK_V8_ACCESS).includes(accessKind)) {
    fail('EXPANSION_PACK_V8_ACCESS_INVALID', 'ExpansionPackReleaseV8 has an unknown access kind.');
  }
  const manifestBound = field(fields, 'manifest_bound', 'manifestBound') === true;
  const result = {
    objectId: parsed.id,
    type: parsed.type,
    version: EXPANSION_PACK_V8_VERSION,
    parentRootId: exactId(jsonId(field(fields, 'parent_root_id', 'parentRootId')), 'Parent MakerRootV5 ID'),
    parentLegacyMakerId: exactId(
      jsonId(field(fields, 'parent_legacy_maker_id', 'parentLegacyMakerId')),
      'Parent OCMaker ID',
    ),
    parentVersion: stringValue(field(fields, 'parent_version', 'parentVersion'), 'Parent version'),
    parentManifestBlobId: stringValue(
      field(fields, 'parent_manifest_blob_id', 'parentManifestBlobId'),
      'Parent manifest Blob ID',
    ),
    parentManifestSha256: hex(
      field(fields, 'parent_manifest_sha256', 'parentManifestSha256'),
      'Parent manifest SHA-256',
    ),
    packId: stringValue(field(fields, 'pack_id', 'packId'), 'Pack ID'),
    namespace: stringValue(field(fields, 'namespace'), 'Pack namespace'),
    packVersion: stringValue(field(fields, 'pack_version', 'packVersion'), 'Pack version'),
    creator: exactId(field(fields, 'creator'), 'Pack creator'),
    manifestBound,
    manifestBlobId: stringValue(
      field(fields, 'manifest_blob_id', 'manifestBlobId'),
      'Pack manifest Blob ID',
      { allowEmpty: !manifestBound },
    ),
    manifestSha256: hex(
      field(fields, 'manifest_sha256', 'manifestSha256'),
      'Pack manifest SHA-256',
      { allowEmpty: !manifestBound },
    ),
    contentCommitment: hex(field(fields, 'content_commitment', 'contentCommitment'), 'Pack content commitment'),
    styleRegistryCommitment: hex(
      field(fields, 'style_registry_commitment', 'styleRegistryCommitment'),
      'Pack Style registry commitment',
      { allowEmpty: lifecycle === EXPANSION_PACK_V8_LIFECYCLE.DRAFT },
    ),
    sealPolicyId: optionId(field(fields, 'seal_policy_id', 'sealPolicyId'), 'Pack Seal policy ID'),
    sealPackageId: optionId(
      field(fields, 'seal_package_id', 'sealPackageId'),
      'Pack Seal package ID',
    ),
    sealReleaseCommitment: hex(
      field(fields, 'seal_release_commitment', 'sealReleaseCommitment'),
      'Pack Seal release commitment',
      { allowEmpty: true },
    ),
    accessKind,
    purchasePriceAtomic: u64(field(fields, 'purchase_price_atomic', 'purchasePriceAtomic'), 'Pack price'),
    lifecycle,
    lifecycleState: LIFECYCLE_NAME[lifecycle],
    adminCapId: exactId(jsonId(field(fields, 'admin_cap_id', 'adminCapId')), 'Pack AdminCap ID'),
    treasuryId: exactId(jsonId(field(fields, 'treasury_id', 'treasuryId')), 'Pack Treasury ID'),
    admittedBy: exactId(field(fields, 'admitted_by', 'admittedBy'), 'Pack admitting wallet'),
    admittedParentOwnershipEpoch: u64(
      field(fields, 'admitted_parent_ownership_epoch', 'admittedParentOwnershipEpoch'),
      'Admitted parent ownership epoch',
    ),
    styleCount: u64(field(fields, 'style_count', 'styleCount'), 'Pack Style count'),
    entitlementCount: u64(field(fields, 'entitlement_count', 'entitlementCount'), 'Pack entitlement count'),
    stylesTableId: exactId(jsonId(field(fields, 'styles')), 'Pack Styles table ID'),
    sealAssetsTableId: exactId(jsonId(field(fields, 'seal_assets', 'sealAssets')), 'Pack Seal assets table ID'),
    entitlementsTableId: exactId(jsonId(field(fields, 'entitlements')), 'Pack entitlements table ID'),
  };
  if ((accessKind === EXPANSION_PACK_V8_ACCESS.FREE && result.purchasePriceAtomic !== 0n)
    || (accessKind === EXPANSION_PACK_V8_ACCESS.PAID_ONCE && result.purchasePriceAtomic === 0n)) {
    fail('EXPANSION_PACK_V8_ACCESS_INVALID', 'Expansion Pack access kind and price do not match.');
  }
  if (result.sealPolicyId && !sameId(result.sealPolicyId, result.objectId)) {
    fail('EXPANSION_PACK_V8_SEAL_BINDING_INVALID', 'Expansion Pack Seal policy must be the release object itself.');
  }
  const hasSealPolicy = Boolean(result.sealPolicyId);
  const hasSealPackage = Boolean(result.sealPackageId);
  const hasSealCommitment = Boolean(result.sealReleaseCommitment);
  if (hasSealPolicy !== hasSealPackage || hasSealPolicy !== hasSealCommitment) {
    fail(
      'EXPANSION_PACK_V8_SEAL_BINDING_INVALID',
      'Expansion Pack Seal policy, package and release commitment must be bound together.',
    );
  }
  if (result.sealPackageId && !sameId(result.sealPackageId, typeOrigin(runtime))) {
    fail(
      'EXPANSION_PACK_V8_SEAL_PACKAGE_MISMATCH',
      'Expansion Pack Seal access must remain pinned to the immutable v8 TypeOrigin package.',
    );
  }
  if ((!manifestBound && (result.manifestBlobId || result.manifestSha256))
    || (manifestBound && (!result.manifestBlobId || !result.manifestSha256))) {
    fail(
      'EXPANSION_PACK_V8_MANIFEST_BINDING_INVALID',
      'Expansion Pack manifest fields do not match its one-time binding state.',
    );
  }
  if (lifecycle !== EXPANSION_PACK_V8_LIFECYCLE.DRAFT && !manifestBound) {
    fail(
      'EXPANSION_PACK_V8_MANIFEST_BINDING_INVALID',
      'A sealed or published Expansion Pack must bind its certified manifest.',
    );
  }
  return Object.freeze(result);
}

export function parseExpansionPackPassV8(value, { runtime } = {}) {
  const parsed = envelope(value, runtime, 'ExpansionPackPassV8');
  const { fields } = parsed;
  const result = {
    objectId: parsed.id,
    type: parsed.type,
    version: EXPANSION_PACK_V8_VERSION,
    releaseId: exactId(jsonId(field(fields, 'release_id', 'releaseId')), 'Pack release ID'),
    parentRootId: exactId(jsonId(field(fields, 'parent_root_id', 'parentRootId')), 'Parent MakerRootV5 ID'),
    holder: exactId(field(fields, 'holder'), 'Pack Pass holder'),
    paidAtomic: u64(field(fields, 'paid_atomic', 'paidAtomic'), 'Pack Pass paid amount'),
    issuedAtMs: u64(field(fields, 'issued_at_ms', 'issuedAtMs'), 'Pack Pass issue time'),
    admittedParentOwnershipEpoch: u64(
      field(fields, 'admitted_parent_ownership_epoch', 'admittedParentOwnershipEpoch'),
      'Pack Pass parent epoch',
    ),
    contentCommitment: hex(field(fields, 'content_commitment', 'contentCommitment'), 'Pack Pass commitment'),
  };
  const owner = addressOwner(value);
  if (!owner || !sameId(owner, result.holder)) {
    fail('EXPANSION_PACK_V8_OWNER_MISMATCH', 'ExpansionPackPassV8 is not owned by its embedded holder.');
  }
  return Object.freeze(result);
}

function parseAdminCap(value, { runtime } = {}) {
  const parsed = envelope(value, runtime, 'ExpansionPackAdminCapV8');
  return Object.freeze({
    objectId: parsed.id,
    type: parsed.type,
    version: EXPANSION_PACK_V8_VERSION,
    releaseId: exactId(jsonId(field(parsed.fields, 'release_id', 'releaseId')), 'Pack release ID'),
    creator: exactId(field(parsed.fields, 'creator'), 'Pack creator'),
    owner: exactId(addressOwner(value), 'Pack AdminCap owner'),
  });
}

function parseTreasury(value, { runtime, paymentCoinType } = {}) {
  const parsed = envelope(value, runtime, 'ExpansionPackTreasuryV8', paymentCoinType);
  return Object.freeze({
    objectId: parsed.id,
    type: parsed.type,
    version: EXPANSION_PACK_V8_VERSION,
    releaseId: exactId(jsonId(field(parsed.fields, 'release_id', 'releaseId')), 'Pack release ID'),
    balanceAtomic: u64(field(field(parsed.fields, 'revenue'), 'value'), 'Pack Treasury balance'),
    totalCollectedAtomic: u64(
      field(parsed.fields, 'total_collected', 'totalCollected'),
      'Pack Treasury total collected',
    ),
    totalWithdrawnAtomic: u64(
      field(parsed.fields, 'total_withdrawn', 'totalWithdrawn'),
      'Pack Treasury total withdrawn',
    ),
  });
}

const INPUT_ORDER = Object.freeze({
  bind_maker_release_evidence_v5: [
    'baseMakerRootId', 'makerControlCapId', 'parentLegacyMakerId',
    'parentVersion', 'parentManifestBlobId', 'parentManifestSha256',
  ],
  create_expansion_pack_v8: [
    'baseMakerRootId', 'parentLegacyMakerId', 'commerceProtocolConfigV5Id',
    'parentVersion', 'parentManifestBlobId',
    'parentManifestSha256', 'packId', 'packNamespace', 'packVersion',
    'contentCommitment', 'accessKind', 'purchasePriceAtomic',
  ],
  bind_expansion_pack_manifest_v8: [
    'packReleaseId', 'packAdminCapId', 'manifestBlobId', 'manifestSha256',
  ],
  register_style_asset_v8: [
    'packReleaseId', 'packAdminCapId', 'partKey', 'itemKey', 'styleKey',
    'assetBlobId', 'assetSha256', 'assetSealId',
  ],
  seal_expansion_pack_v8: ['packReleaseId', 'packAdminCapId', 'styleRegistryCommitment'],
  bind_expansion_pack_seal_policy_v8: ['packReleaseId', 'packAdminCapId'],
  admit_expansion_pack_v8: [
    'packReleaseId', 'baseMakerRootId', 'parentLegacyMakerId', 'makerControlCapId',
  ],
  activate_expansion_pack_v8: [
    'packReleaseId', 'packAdminCapId', 'baseMakerRootId', 'commerceProtocolConfigV5Id',
  ],
  pause_expansion_pack_v8: ['packReleaseId', 'packAdminCapId'],
  resume_expansion_pack_v8: [
    'packReleaseId', 'packAdminCapId', 'baseMakerRootId', 'commerceProtocolConfigV5Id',
  ],
  archive_expansion_pack_v8: ['packReleaseId', 'packAdminCapId'],
  claim_free_expansion_pack_v8: [
    'packReleaseId', 'baseMakerRootId', 'commerceProtocolConfigV5Id', 'clockObjectId',
  ],
  purchase_expansion_pack_v8: [
    'packReleaseId', 'packTreasuryId', 'baseMakerRootId', 'commerceProtocolConfigV5Id',
    'commerceProtocolTreasuryV5Id', 'payment', 'clockObjectId',
  ],
  withdraw_expansion_pack_revenue_v8: [
    'packReleaseId', 'packTreasuryId', 'packAdminCapId', 'amountAtomic', 'recipient',
  ],
  seal_approve_style_v8: ['assetSealId', 'packReleaseId', 'baseMakerRootId'],
});

const OBJECT_INPUTS = new Set([
  'baseMakerRootId',
  'parentLegacyMakerId',
  'makerControlCapId',
  'commerceProtocolConfigV5Id',
  'commerceProtocolTreasuryV5Id',
  'packReleaseId',
  'packAdminCapId',
  'packTreasuryId',
  'clockObjectId',
]);

const STRING_INPUTS = new Set([
  'parentVersion',
  'parentManifestBlobId',
  'packId',
  'packNamespace',
  'packVersion',
  'manifestBlobId',
  'partKey',
  'itemKey',
  'styleKey',
  'assetBlobId',
]);

const HASH_INPUTS = new Set([
  'parentManifestSha256',
  'manifestSha256',
  'contentCommitment',
  'assetSha256',
  'assetSealId',
  'styleRegistryCommitment',
  'sealReleaseCommitment',
]);

function moveFunction(target) {
  return String(target || '').split('::').at(-1);
}

function transactionArgument(transaction, name, value, action) {
  if (OBJECT_INPUTS.has(name)) return transaction.object(exactId(value, name));
  if (STRING_INPUTS.has(name)) return transaction.pure.string(required(value, name));
  if (HASH_INPUTS.has(name)) {
    return transaction.pure.vector('u8', hexBytes(value, name, {
      allowEmpty: name === 'assetSealId',
    }));
  }
  if (name === 'sealPolicyId') return transaction.pure.id(exactId(value, name));
  if (name === 'accessKind') return transaction.pure.u8(u8(value, name));
  if (['purchasePriceAtomic', 'amountAtomic'].includes(name)) {
    return transaction.pure.u64(u64(value, name, { positive: name === 'amountAtomic' }));
  }
  if (name === 'recipient') return transaction.pure.address(exactId(value, name));
  if (name === 'payment') {
    const paymentCoinType = exactMoveType(
      action.typeArguments?.[0] || action.paymentCoinType,
      'Payment coin type',
    );
    return transaction.coin({
      type: paymentCoinType,
      balance: u64(action.inputs.purchasePriceAtomic || action.priceAtomic, 'Pack purchase price', {
        positive: true,
      }),
    });
  }
  fail('EXPANSION_PACK_V8_CHAIN_INPUT_UNSUPPORTED', `Unsupported Expansion Pack v8 input ${name}.`);
}

/** Build exactly one resolved v8 publication or lifecycle Move call. */
export function transactionFromExpansionPackV8Action(action, { sender = '' } = {}) {
  if (action?.transport && action.transport !== 'SUI') {
    fail('EXPANSION_PACK_V8_CHAIN_ACTION_REQUIRED', 'A resolved Sui Expansion Pack v8 action is required.');
  }
  const functionName = moveFunction(action?.target);
  const order = INPUT_ORDER[functionName];
  if (!order) {
    fail(
      'EXPANSION_PACK_V8_CHAIN_TARGET_UNSUPPORTED',
      `Unsupported Expansion Pack v8 target ${action?.target || ''}.`,
    );
  }
  const transaction = new Transaction();
  const signer = sender || action?.authority?.signer;
  if (signer) transaction.setSender(exactId(signer, 'Transaction sender'));
  const typeArguments = array(action?.typeArguments).map((entry) => exactMoveType(entry, 'Move type argument'));
  transaction.moveCall({
    target: required(action.target, 'Expansion Pack v8 Move target'),
    typeArguments,
    arguments: order.map((name) => transactionArgument(transaction, name, action.inputs?.[name], action)),
  });
  return transaction;
}

export const transactionFromExpansionPackV8PublicationAction =
  transactionFromExpansionPackV8Action;

function managementAction(runtime, functionName, inputs, { sender, payment = false } = {}) {
  if (runtime?.expansionPackV8ReleaseEnabled !== true) {
    fail(
      'EXPANSION_PACK_V8_RELEASE_DISABLED',
      'Expansion Pack v8 lifecycle and acquisition actions are behind the reviewed release gate.',
    );
  }
  return {
    id: `chain.pack.${functionName}`,
    transport: 'SUI',
    target: `${callablePackage(runtime)}::${EXPANSION_PACK_V8_MODULE}::${functionName}`,
    authority: { signer: exactId(sender, 'Transaction sender') },
    typeArguments: payment ? [exactMoveType(runtime?.paymentCoinType, 'Payment coin type')] : [],
    inputs,
  };
}

export function buildPauseExpansionPackV8({ runtime, releaseId, adminCapId, sender }) {
  return transactionFromExpansionPackV8Action(managementAction(runtime, 'pause_expansion_pack_v8', {
    packReleaseId: releaseId,
    packAdminCapId: adminCapId,
  }, { sender }));
}

export function buildResumeExpansionPackV8({
  runtime, releaseId, adminCapId, parentRootId, protocolConfigId, sender,
}) {
  return transactionFromExpansionPackV8Action(managementAction(runtime, 'resume_expansion_pack_v8', {
    packReleaseId: releaseId,
    packAdminCapId: adminCapId,
    baseMakerRootId: parentRootId,
    commerceProtocolConfigV5Id: protocolConfigId || runtime?.commerceProtocolConfigV5Id,
  }, { sender }));
}

export function buildArchiveExpansionPackV8({ runtime, releaseId, adminCapId, sender }) {
  return transactionFromExpansionPackV8Action(managementAction(runtime, 'archive_expansion_pack_v8', {
    packReleaseId: releaseId,
    packAdminCapId: adminCapId,
  }, { sender }));
}

export function buildClaimFreeExpansionPackV8({
  runtime, releaseId, parentRootId, protocolConfigId, clockObjectId, sender,
}) {
  return transactionFromExpansionPackV8Action(managementAction(runtime, 'claim_free_expansion_pack_v8', {
    packReleaseId: releaseId,
    baseMakerRootId: parentRootId,
    commerceProtocolConfigV5Id: protocolConfigId || runtime?.commerceProtocolConfigV5Id,
    clockObjectId: clockObjectId || EXPANSION_PACK_V8_CLOCK_OBJECT_ID,
  }, { sender }));
}

export function buildPurchaseExpansionPackV8({
  runtime,
  releaseId,
  treasuryId,
  parentRootId,
  protocolConfigId,
  protocolTreasuryId,
  priceAtomic,
  clockObjectId,
  sender,
}) {
  return transactionFromExpansionPackV8Action(managementAction(runtime, 'purchase_expansion_pack_v8', {
    packReleaseId: releaseId,
    packTreasuryId: treasuryId,
    baseMakerRootId: parentRootId,
    commerceProtocolConfigV5Id: protocolConfigId || runtime?.commerceProtocolConfigV5Id,
    commerceProtocolTreasuryV5Id:
      protocolTreasuryId || runtime?.commerceProtocolTreasuryV5Id,
    payment: true,
    purchasePriceAtomic: u64(priceAtomic, 'Pack purchase price', { positive: true }).toString(),
    clockObjectId: clockObjectId || EXPANSION_PACK_V8_CLOCK_OBJECT_ID,
  }, { sender, payment: true }));
}

export function buildWithdrawExpansionPackRevenueV8({
  runtime, releaseId, treasuryId, adminCapId, amountAtomic, recipient, sender,
}) {
  return transactionFromExpansionPackV8Action(managementAction(
    runtime,
    'withdraw_expansion_pack_revenue_v8',
    {
      packReleaseId: releaseId,
      packTreasuryId: treasuryId,
      packAdminCapId: adminCapId,
      amountAtomic: u64(amountAtomic, 'Pack withdrawal amount', { positive: true }).toString(),
      recipient,
    },
    { sender, payment: true },
  ));
}

/**
 * Build the exact dry-run transaction used by Sui Seal key servers for one
 * paid Expansion Pack Style. This deliberately does not consult the release
 * publication gate: disabling new sales must never revoke an existing
 * holder's decryption right. The Move policy still verifies the exact release,
 * parent Base entitlement, Pack entitlement and registered Style Seal ID.
 */
export async function buildExpansionPackStyleSealApprovalV8({
  runtime,
  releaseId,
  parentRootId,
  sealId,
  sealPackageId,
  contentCommitment,
  protection,
  sender,
} = {}) {
  const descriptor = object(protection);
  if (
    descriptor.schemaVersion !== 'animacraft.sealed-asset.v5'
    || descriptor.mode !== 'SEAL_PAID_PACK'
  ) {
    fail(
      'EXPANSION_PACK_V8_SEAL_PROTECTION_INVALID',
      'A verified paid Expansion Pack Seal descriptor is required.',
    );
  }
  const packageId = exactId(sealPackageId, 'Pinned Pack Seal package ID');
  const expectedPackageId = typeOrigin(runtime);
  const descriptorPackageId = exactId(
    descriptor.sealPackageId,
    'Protected Seal package ID',
  );
  const exactSealId = hex(sealId, 'Style Seal ID');
  const descriptorSealId = hex(descriptor.sealId, 'Protected Style Seal ID');
  const exactReleaseId = exactId(releaseId, 'Expansion Pack release ID');
  const exactCommitment = hex(contentCommitment, 'Pack content commitment');
  const expectedReleaseCommitment = (
    await deriveExpansionPackSealReleaseCommitmentV8({
      releaseId: exactReleaseId,
      contentCommitment: exactCommitment,
    })
  ).id.replace(/^0x/i, '').toLowerCase();
  const descriptorCommitment = hex(
    descriptor.releaseCommitment,
    'Protected Pack content commitment',
  );
  if (
    !sameId(packageId, expectedPackageId)
    || !sameId(descriptorPackageId, packageId)
    || descriptorSealId !== exactSealId
    || descriptorCommitment !== expectedReleaseCommitment
  ) {
    fail(
      'EXPANSION_PACK_V8_SEAL_PROTECTION_MISMATCH',
      'The paid Style Seal descriptor does not match the reviewed v8 package and release.',
      {
        expectedPackageId,
        actualPackageId: descriptorPackageId,
        expectedSealId: exactSealId,
        actualSealId: descriptorSealId,
      },
    );
  }
  const transaction = new Transaction();
  transaction.setSender(exactId(sender, 'Transaction sender'));
  transaction.moveCall({
    // Ciphertext/session identities remain pinned to the immutable TypeOrigin,
    // while policy execution must use the currently reviewed callable upgrade.
    target: `${callablePackage(runtime)}::${EXPANSION_PACK_V8_MODULE}::${EXPANSION_PACK_V8_SEAL_APPROVE_FUNCTION}`,
    arguments: [
      transaction.pure.vector('u8', hexBytes(exactSealId, 'Style Seal ID')),
      transaction.object(exactReleaseId),
      transaction.object(exactId(parentRootId, 'Parent MakerRootV5 ID')),
    ],
  });
  return transaction;
}

function resultObjects(response) {
  return array(response?.objects || response?.data || response).filter((entry) => entry && !entry.error);
}

async function getExactObjects(suiClient, ids, label) {
  if (!suiClient?.getObjects) {
    fail('EXPANSION_PACK_V8_CLIENT_MISSING', 'A Sui client with getObjects is required.');
  }
  const requested = ids.map((entry) => exactId(entry, `${label} ID`));
  const response = await suiClient.getObjects({
    objectIds: requested,
    include: { json: true, type: true, owner: true },
  });
  const byId = new Map(resultObjects(response).map((entry) => [comparableId(objectId(entry)), entry]));
  return requested.map((entry) => {
    const result = byId.get(comparableId(entry));
    if (!result) {
      fail('EXPANSION_PACK_V8_CHAIN_READBACK_MISMATCH', `${label} ${entry} is not visible after finalized execution.`);
    }
    return result;
  });
}

function assertExactType(value, expected, label) {
  let actual;
  try {
    actual = normalizeStructTag(objectType(value));
  } catch {
    actual = '';
  }
  if (actual !== normalizeStructTag(expected)) {
    fail('EXPANSION_PACK_V8_TYPE_ORIGIN_MISMATCH', `${label} has the wrong stable TypeOrigin.`, {
      expected: normalizeStructTag(expected),
      actual,
    });
  }
}

/** Read the bind-once semantic parent tuple stored below one MakerRootV5. */
export async function queryMakerReleaseEvidenceV5(client, {
  rootId,
  allowMissing = false,
} = {}) {
  if (!client?.getDynamicField) {
    fail(
      'EXPANSION_PACK_V8_CLIENT_MISSING',
      'Exact parent release evidence requires a Sui client with getDynamicField.',
    );
  }
  const parentId = exactId(rootId, 'Parent MakerRootV5 ID');
  let response;
  try {
    response = await client.getDynamicField({
      parentId,
      name: {
        type: MOVE_STRING,
        bcs: bcs.string().serialize(MAKER_RELEASE_EVIDENCE_V5_FIELD_KEY).toBytes(),
      },
    });
  } catch (cause) {
    if (allowMissing) return null;
    fail(
      'EXPANSION_PACK_V8_PARENT_EVIDENCE_MISSING',
      'MakerRootV5 has no exact chain-attested release evidence.',
      { cause, parentId },
    );
  }
  const bytes = response?.dynamicField?.value?.bcs;
  if (!(bytes instanceof Uint8Array)) {
    if (allowMissing) return null;
    fail(
      'EXPANSION_PACK_V8_PARENT_EVIDENCE_MISSING',
      'Sui did not return exact MakerReleaseEvidenceV5 BCS bytes.',
      { parentId },
    );
  }
  let parsed;
  try {
    parsed = MAKER_RELEASE_EVIDENCE_V5_BCS.parse(bytes);
  } catch (cause) {
    fail(
      'EXPANSION_PACK_V8_PARENT_EVIDENCE_INVALID',
      'MakerReleaseEvidenceV5 has invalid BCS bytes.',
      { cause, parentId },
    );
  }
  return Object.freeze({
    rootId: parentId,
    parentVersion: stringValue(parsed.parent_version, 'Attested parent version'),
    parentManifestBlobId: stringValue(
      parsed.manifest_blob_id,
      'Attested parent manifest Blob ID',
    ),
    parentManifestSha256: hex(
      parsed.manifest_sha256,
      'Attested parent manifest SHA-256',
    ),
  });
}

function minimalParentRoot(value, runtime) {
  const expected = `${exactId(runtime?.commerceV5TypeOriginPackageId, 'Commerce v5 TypeOrigin')}::commerce_v5::MakerRootV5`;
  assertExactType(value, expected, 'Parent MakerRootV5');
  const fields = objectFields(value);
  const release = field(fields, 'release', 'release_state', 'releaseState')?.fields
    || field(fields, 'release', 'release_state', 'releaseState')
    || fields;
  return {
    objectId: exactId(objectId(value), 'Parent MakerRootV5 ID'),
    legacyMakerId: exactId(jsonId(field(fields, 'legacy_maker_id', 'legacyMakerId')), 'Parent OCMaker ID'),
    currentOwner: exactId(field(fields, 'current_owner', 'currentOwner'), 'Parent Maker owner'),
    currentControlCapId: exactId(
      jsonId(field(fields, 'current_control_cap_id', 'currentControlCapId')),
      'Current MakerControlCapV5 ID',
    ),
    ownershipEpoch: u64(field(fields, 'ownership_epoch', 'ownershipEpoch'), 'Parent ownership epoch'),
    lifecycle: u8(field(fields, 'lifecycle'), 'Parent Maker lifecycle'),
    styleRegistrySealed: field(release, 'style_registry_sealed', 'styleRegistrySealed') === true,
    protocolConfigId: exactId(
      jsonId(field(fields, 'protocol_config_id', 'protocolConfigId')),
      'CommerceProtocolConfigV5 ID',
    ),
  };
}

function minimalLegacyMaker(value, runtime) {
  const expected = `${exactId(
    runtime?.originalPackageId || runtime?.protocolFeePackageId,
    'Original Animacraft TypeOrigin',
  )}::animacraft::OCMaker`;
  assertExactType(value, expected, 'Parent OCMaker');
  const fields = objectFields(value);
  return {
    objectId: exactId(objectId(value), 'Parent OCMaker ID'),
    manifestBlobId: stringValue(field(fields, 'manifest_blob_id', 'manifestBlobId'), 'Parent manifest Blob ID'),
  };
}

function minimalControlCap(value, runtime) {
  const expected = `${exactId(runtime?.commerceV5TypeOriginPackageId, 'Commerce v5 TypeOrigin')}::commerce_v5::MakerControlCapV5`;
  assertExactType(value, expected, 'Parent MakerControlCapV5');
  const fields = objectFields(value);
  return {
    objectId: exactId(objectId(value), 'MakerControlCapV5 ID'),
    rootId: exactId(jsonId(field(fields, 'root_id', 'rootId')), 'MakerControlCapV5 root ID'),
    ownershipEpoch: u64(field(fields, 'ownership_epoch', 'ownershipEpoch'), 'MakerControlCapV5 ownership epoch'),
    owner: exactId(addressOwner(value), 'MakerControlCapV5 owner'),
  };
}

async function verifyParentObjects({
  suiClient,
  runtime,
  inputs,
  signer,
  requireManifestEvidence = false,
  requireReleaseEvidence = false,
  manifestReadback,
}) {
  const rootId = exactId(inputs.baseMakerRootId, 'Parent MakerRootV5 ID');
  const legacyMakerId = exactId(inputs.parentLegacyMakerId, 'Parent OCMaker ID');
  const capId = exactId(inputs.makerControlCapId, 'MakerControlCapV5 ID');
  const [rootObject, legacyObject, capObject] = await getExactObjects(
    suiClient,
    [rootId, legacyMakerId, capId],
    'Parent authority object',
  );
  const root = minimalParentRoot(rootObject, runtime);
  const legacy = minimalLegacyMaker(legacyObject, runtime);
  const cap = minimalControlCap(capObject, runtime);
  if (!sameId(root.legacyMakerId, legacy.objectId)
    || !sameId(root.currentControlCapId, cap.objectId)
    || !sameId(cap.rootId, root.objectId)
    || root.ownershipEpoch !== cap.ownershipEpoch
    || !sameId(root.currentOwner, signer)
    || !sameId(cap.owner, signer)
    || root.lifecycle !== 0
    || root.styleRegistrySealed !== true
    || legacy.manifestBlobId !== String(inputs.parentManifestBlobId || '')) {
    fail(
      'EXPANSION_PACK_V8_PARENT_READBACK_MISMATCH',
      'The parent MakerRoot, OCMaker and current control capability do not form the exact active sealed parent tuple.',
    );
  }
  const evidence = await queryMakerReleaseEvidenceV5(suiClient, {
    rootId,
    allowMissing: !requireReleaseEvidence,
  });
  if (evidence && (
    String(evidence.parentVersion) !== String(inputs.parentVersion)
      || evidence.parentManifestBlobId !== String(inputs.parentManifestBlobId || '')
      || evidence.parentManifestSha256
        !== hex(inputs.parentManifestSha256, 'Expected parent manifest SHA-256')
  )) {
    fail(
      'EXPANSION_PACK_V8_PARENT_EVIDENCE_MISMATCH',
      'MakerRootV5 is already attested to another parent version or manifest.',
      { evidence },
    );
  }
  let manifest = null;
  if (requireManifestEvidence) {
    if (typeof manifestReadback !== 'function') {
      fail(
        'EXPANSION_PACK_V8_PARENT_MANIFEST_EVIDENCE_REQUIRED',
        'Exact parent manifest SHA, version and release identity evidence is required.',
      );
    }
    manifest = await manifestReadback({
      blobId: legacy.manifestBlobId,
      expectedSha256: inputs.parentManifestSha256,
      expectedVersion: inputs.parentVersion,
      expectedVersionId: inputs.parentVersionId,
      expectedIdentity: inputs.parentIdentity,
    });
    if (!manifest
      || hex(manifest.sha256, 'Parent manifest readback SHA-256')
        !== hex(inputs.parentManifestSha256, 'Expected parent manifest SHA-256')
      || String(manifest.version) !== String(inputs.parentVersion)
      || String(manifest.versionId || '') !== String(inputs.parentVersionId || '')
      || String(manifest.identity || '') !== String(inputs.parentIdentity || '')) {
      fail('EXPANSION_PACK_V8_PARENT_MANIFEST_MISMATCH', 'Parent Walrus manifest evidence changed.');
    }
  }
  return { root, legacy, cap, evidence, manifest };
}

/** Verify the recovery plan's read-only parent action without submitting a transaction. */
export async function verifyExpansionPackV8ParentAction({
  action, suiClient, runtime, manifestReadback,
} = {}) {
  if (action?.id !== 'parent.release.verify') {
    fail('EXPANSION_PACK_V8_PARENT_ACTION_REQUIRED', 'The parent.release.verify action is required.');
  }
  const parent = await verifyParentObjects({
    suiClient,
    runtime,
    inputs: action.inputs,
    signer: action.authority?.signer,
    requireManifestEvidence: true,
    manifestReadback,
  });
  return Object.freeze({
    parentVerified: true,
    makerControlCapVerified: true,
    parentReleaseEvidenceBound: Boolean(parent.evidence),
    parentLifecycleState: 'ACTIVE',
    baseMakerRootId: action.inputs.baseMakerRootId,
    parentLegacyMakerId: action.inputs.parentLegacyMakerId,
    parentVersion: String(action.inputs.parentVersion),
    parentManifestBlobId: action.inputs.parentManifestBlobId,
    parentManifestSha256: hex(action.inputs.parentManifestSha256, 'Parent manifest SHA-256'),
  });
}

function indexedTransaction(value) {
  return value?.Transaction || value?.transaction || value || {};
}

function eventJson(value) {
  const json = value?.parsedJson || value?.parsed_json || value?.json || value?.contents?.json;
  return object(json?.fields || json);
}

function eventType(value) {
  return String(value?.type || value?.contents?.type?.repr || '');
}

function eventNameType(runtime, name) {
  return normalizeStructTag(`${typeOrigin(runtime)}::${EXPANSION_PACK_V8_MODULE}::${name}`);
}

function exactEvent(events, runtime, name, predicate = () => true) {
  const expected = eventNameType(runtime, name);
  const matches = events.filter((entry) => {
    try {
      return normalizeStructTag(eventType(entry)) === expected && predicate(eventJson(entry));
    } catch {
      return false;
    }
  });
  if (matches.length !== 1) {
    fail(
      'EXPANSION_PACK_V8_CHAIN_READBACK_MISMATCH',
      `Expected exactly one ${name} event from the stable v8 TypeOrigin.`,
      { count: matches.length },
    );
  }
  return eventJson(matches[0]);
}

function eventHash(value, label, options) {
  return hex(value, label, options);
}

function eventId(value, label) {
  return exactId(jsonId(value) || value, label);
}

function equalsText(actual, expected) {
  return String(actual ?? '').toLowerCase() === String(expected ?? '').toLowerCase();
}

function assertEqual(actual, expected, label, { id = false } = {}) {
  const matches = id ? sameId(actual, expected) : equalsText(actual, expected);
  if (!matches) {
    fail('EXPANSION_PACK_V8_CHAIN_READBACK_MISMATCH', `${label} does not match the submitted action.`, {
      expected,
      actual,
    });
  }
}

function transactionStatus(indexed) {
  const status = indexed?.effects?.status?.status || indexed?.effects?.status;
  return typeof status === 'string' ? status.toLowerCase() : '';
}

function createdObjectIds(indexed, runtime, structName, typeArgument = '') {
  const expected = expectedType(runtime, structName, typeArgument);
  return Object.entries(object(indexed?.objectTypes || indexed?.object_types))
    .filter(([, value]) => {
      try {
        return normalizeStructTag(String(value)) === expected;
      } catch {
        return false;
      }
    })
    .map(([id]) => exactId(id, `${structName} created object ID`));
}

async function getReleaseAndAdmin({ action, suiClient, runtime }) {
  const [releaseObject, capObject] = await getExactObjects(
    suiClient,
    [action.inputs.packReleaseId, action.inputs.packAdminCapId],
    'Expansion Pack administration object',
  );
  const release = parseExpansionPackReleaseV8(releaseObject, { runtime });
  const cap = parseAdminCap(capObject, { runtime });
  if (!sameId(cap.releaseId, release.objectId)
    || !sameId(cap.objectId, release.adminCapId)
    || !sameId(cap.creator, release.creator)
    || !sameId(cap.owner, release.creator)
    || !sameId(release.creator, action.authority?.signer)) {
    fail('EXPANSION_PACK_V8_OWNER_MISMATCH', 'Pack AdminCap, release creator and signer do not match.');
  }
  return { release, cap };
}

async function readExactStyleRecord({ suiClient, runtime, release, inputs }) {
  if (!suiClient?.getDynamicField) {
    fail(
      'EXPANSION_PACK_V8_CLIENT_MISSING',
      'Exact Style readback requires a Sui client with getDynamicField.',
    );
  }
  let response;
  try {
    response = await suiClient.getDynamicField({
      parentId: release.stylesTableId,
      name: {
        type: expectedType(runtime, 'StyleAssetKeyV8'),
        bcs: STYLE_ASSET_KEY_V8_BCS.serialize({
          part_key: required(inputs.partKey, 'Style Part key'),
          item_key: required(inputs.itemKey, 'Style Item key'),
          style_key: required(inputs.styleKey, 'Style key'),
        }).toBytes(),
      },
    });
  } catch (cause) {
    fail(
      'EXPANSION_PACK_V8_CHAIN_READBACK_MISMATCH',
      'The exact registered Style row is not visible in the Pack registry.',
      { cause },
    );
  }
  const bytes = response?.dynamicField?.value?.bcs;
  if (!(bytes instanceof Uint8Array)) {
    fail(
      'EXPANSION_PACK_V8_CHAIN_READBACK_MISMATCH',
      'Sui did not return exact StyleAssetRecordV8 BCS bytes.',
    );
  }
  let parsed;
  try {
    parsed = STYLE_ASSET_RECORD_V8_BCS.parse(bytes);
  } catch (cause) {
    fail(
      'EXPANSION_PACK_V8_CHAIN_READBACK_MISMATCH',
      'The registered StyleAssetRecordV8 BCS bytes are invalid.',
      { cause },
    );
  }
  return Object.freeze({
    assetBlobId: stringValue(parsed.asset_blob_id, 'Registered Style asset Blob ID'),
    assetSha256: hex(parsed.asset_sha256, 'Registered Style asset SHA-256'),
    assetSealId: hex(parsed.asset_seal_id, 'Registered Style Seal ID', { allowEmpty: true }),
  });
}

/**
 * Read every exact Style row needed by a published Pack manifest. The caller
 * supplies the manifest-derived keys; returning fewer, extra or duplicated
 * rows is never accepted as a usable Player catalog.
 */
export async function queryExpansionPackStyleRecordsV8(client, {
  runtime,
  release,
  styles = [],
} = {}) {
  const parsedRelease = release?.stylesTableId
    ? release
    : parseExpansionPackReleaseV8(release, { runtime });
  const requested = array(styles).map((style) => ({
    partKey: required(style?.partKey, 'Style Part key'),
    itemKey: required(style?.itemKey, 'Style Item key'),
    styleKey: required(style?.styleKey, 'Style key'),
  }));
  const unique = new Set(requested.map((style) => (
    `${style.partKey}\u0000${style.itemKey}\u0000${style.styleKey}`
  )));
  if (unique.size !== requested.length
    || BigInt(requested.length) !== BigInt(parsedRelease.styleCount || 0)) {
    fail(
      'EXPANSION_PACK_V8_STYLE_QUERY_MISMATCH',
      'The Pack manifest Style keys do not match the sealed on-chain Style count.',
      { requested: requested.length, onchain: String(parsedRelease.styleCount || 0) },
    );
  }
  const records = [];
  for (const style of requested) {
    records.push(Object.freeze({
      ...style,
      ...await readExactStyleRecord({
        suiClient: client,
        runtime,
        release: parsedRelease,
        inputs: style,
      }),
    }));
  }
  return Object.freeze(records);
}

/** Convert one finalized Sui transaction into the exact recovery confirmation. */
export async function readExpansionPackV8Submission({
  action, submission, suiClient, runtime,
} = {}) {
  const transactionDigest = required(
    submission?.transactionDigest || submission?.digest,
    'Expansion Pack transaction digest',
  );
  const fetched = submission?.indexed || await suiClient?.getTransaction?.({
    digest: transactionDigest,
    include: { effects: true, objectTypes: true, events: true },
  });
  const indexed = indexedTransaction(fetched);
  if (!indexed || typeof indexed !== 'object') {
    fail('EXPANSION_PACK_V8_CHAIN_SUBMISSION_INVALID', 'Finalized Sui transaction evidence is unavailable.');
  }
  const status = transactionStatus(indexed);
  if (status && status !== 'success') {
    fail('EXPANSION_PACK_V8_CHAIN_EXECUTION_FAILED', 'The Expansion Pack transaction did not finalize successfully.');
  }
  const events = array(indexed.events);
  const result = { transactionDigest };

  if (action.id === 'chain.parent.evidence.bind') {
    const expectedTarget = `${commerceCallablePackage(runtime)}::commerce_v5::bind_maker_release_evidence_v5`;
    if (String(action.target || '').toLowerCase() !== expectedTarget.toLowerCase()) {
      fail(
        'EXPANSION_PACK_V8_CHAIN_TARGET_UNSUPPORTED',
        'Parent evidence binding must call the reviewed Commerce v5 function.',
      );
    }
    const parent = await verifyParentObjects({
      suiClient,
      runtime,
      inputs: action.inputs,
      signer: action.authority?.signer,
      requireReleaseEvidence: true,
    });
    return Object.freeze({
      ...result,
      parentReleaseEvidenceBound: true,
      parentEvidenceReadbackVerified: true,
      baseMakerRootId: parent.root.objectId,
      parentLegacyMakerId: parent.legacy.objectId,
      parentVersion: parent.evidence.parentVersion,
      parentManifestBlobId: parent.evidence.parentManifestBlobId,
      parentManifestSha256: parent.evidence.parentManifestSha256,
    });
  }

  if (action.id === 'chain.pack.create') {
    const paymentCoinType = action.typeArguments?.[0];
    const releaseIds = createdObjectIds(indexed, runtime, 'ExpansionPackReleaseV8');
    const capIds = createdObjectIds(indexed, runtime, 'ExpansionPackAdminCapV8');
    const treasuryIds = createdObjectIds(indexed, runtime, 'ExpansionPackTreasuryV8', paymentCoinType);
    if (releaseIds.length !== 1 || capIds.length !== 1 || treasuryIds.length !== 1) {
      fail(
        'EXPANSION_PACK_V8_CHAIN_READBACK_MISMATCH',
        'Pack creation must create exactly one Release, AdminCap and Treasury from the stable TypeOrigin.',
        { releaseCount: releaseIds.length, capCount: capIds.length, treasuryCount: treasuryIds.length },
      );
    }
    const [releaseObject, capObject, treasuryObject] = await getExactObjects(
      suiClient,
      [releaseIds[0], capIds[0], treasuryIds[0]],
      'Created Expansion Pack object',
    );
    const release = parseExpansionPackReleaseV8(releaseObject, { runtime });
    const cap = parseAdminCap(capObject, { runtime });
    const treasury = parseTreasury(treasuryObject, { runtime, paymentCoinType });
    const creator = exactId(action.authority?.signer, 'Pack creator');
    if (!isShared(releaseObject) || !isShared(treasuryObject)
      || !sameId(cap.owner, creator)
      || !sameId(release.adminCapId, cap.objectId)
      || !sameId(release.treasuryId, treasury.objectId)
      || !sameId(cap.releaseId, release.objectId)
      || !sameId(treasury.releaseId, release.objectId)
      || !sameId(release.creator, creator)) {
      fail('EXPANSION_PACK_V8_OWNER_MISMATCH', 'Created Pack object ownership and linkage are invalid.');
    }
    const created = exactEvent(events, runtime, 'ExpansionPackCreatedV8', (entry) => (
      sameId(eventId(entry.release_id || entry.releaseId, 'Created release ID'), release.objectId)
      && sameId(eventId(entry.admin_cap_id || entry.adminCapId, 'Created AdminCap ID'), cap.objectId)
      && sameId(eventId(entry.treasury_id || entry.treasuryId, 'Created Treasury ID'), treasury.objectId)
    ));
    const checks = [
      [release.parentRootId, action.inputs.baseMakerRootId, 'Parent MakerRootV5', true],
      [release.parentLegacyMakerId, action.inputs.parentLegacyMakerId, 'Parent OCMaker', true],
      [release.parentVersion, action.inputs.parentVersion, 'Parent version'],
      [release.parentManifestBlobId, action.inputs.parentManifestBlobId, 'Parent manifest Blob ID'],
      [release.parentManifestSha256, hex(action.inputs.parentManifestSha256, 'Parent hash'), 'Parent manifest hash'],
      [release.packId, action.inputs.packId, 'Pack ID'],
      [release.namespace, action.inputs.packNamespace, 'Pack namespace'],
      [release.packVersion, action.inputs.packVersion, 'Pack version'],
      [release.contentCommitment, hex(action.inputs.contentCommitment, 'Pack commitment'), 'Pack content commitment'],
      [release.accessKind, action.inputs.accessKind, 'Pack access kind'],
      [release.purchasePriceAtomic, action.inputs.purchasePriceAtomic, 'Pack price'],
    ];
    checks.forEach(([actual, expected, label, isId]) => assertEqual(actual, expected, label, { id: Boolean(isId) }));
    if (release.lifecycle !== EXPANSION_PACK_V8_LIFECYCLE.DRAFT
      || release.manifestBound !== false
      || release.manifestBlobId
      || release.manifestSha256
      || release.styleRegistryCommitment
      || release.sealPolicyId
      || release.sealPackageId
      || release.sealReleaseCommitment
      || release.styleCount !== 0n
      || release.entitlementCount !== 0n) {
      fail('EXPANSION_PACK_V8_CHAIN_READBACK_MISMATCH', 'A new Pack must be an empty Draft.');
    }
    [
      [created.parent_root_id || created.parentRootId, action.inputs.baseMakerRootId, 'Created event parent root', true],
      [created.parent_legacy_maker_id || created.parentLegacyMakerId, action.inputs.parentLegacyMakerId, 'Created event parent Maker', true],
      [created.pack_id || created.packId, action.inputs.packId, 'Created event Pack ID'],
      [created.pack_version || created.packVersion, action.inputs.packVersion, 'Created event Pack version'],
      [created.creator, creator, 'Created event creator', true],
      [created.access_kind ?? created.accessKind, action.inputs.accessKind, 'Created event access kind'],
      [created.purchase_price_atomic ?? created.purchasePriceAtomic, action.inputs.purchasePriceAtomic, 'Created event price'],
      [eventHash(created.content_commitment || created.contentCommitment, 'Created event commitment'), release.contentCommitment, 'Created event commitment'],
    ].forEach(([actual, expected, label, isId]) => assertEqual(actual, expected, label, { id: Boolean(isId) }));
    if (action.authority?.capability) {
      await verifyParentObjects({
        suiClient,
        runtime,
        inputs: {
          ...action.inputs,
          makerControlCapId: action.authority.capability,
        },
        signer: creator,
        requireReleaseEvidence: true,
      });
    }
    return Object.freeze({
      ...result,
      packReleaseId: release.objectId,
      packAdminCapId: cap.objectId,
      packTreasuryId: treasury.objectId,
      readbackVerified: true,
      manifestBound: false,
      lifecycleState: 'DRAFT',
      creator,
      baseMakerRootId: action.inputs.baseMakerRootId,
      parentLegacyMakerId: action.inputs.parentLegacyMakerId,
      parentVersion: String(action.inputs.parentVersion),
      parentManifestBlobId: action.inputs.parentManifestBlobId,
      parentManifestSha256: hex(action.inputs.parentManifestSha256, 'Parent manifest SHA-256'),
      packId: action.inputs.packId,
      packVersion: action.inputs.packVersion,
      contentCommitment: hex(action.inputs.contentCommitment, 'Pack commitment'),
      accessKind: Number(action.inputs.accessKind),
      purchasePriceAtomic: String(action.inputs.purchasePriceAtomic),
    });
  }

  if (action.id === 'chain.pack.manifest.bind') {
    const { release } = await getReleaseAndAdmin({ action, suiClient, runtime });
    const bound = exactEvent(events, runtime, 'ExpansionPackManifestBoundV8', (entry) => (
      sameId(eventId(entry.release_id || entry.releaseId, 'Manifest event release'), release.objectId)
    ));
    const manifestBlobId = stringValue(
      bound.manifest_blob_id || bound.manifestBlobId,
      'Bound manifest Blob ID',
    );
    const manifestSha256 = eventHash(
      bound.manifest_sha256 || bound.manifestSha256,
      'Bound manifest SHA-256',
    );
    if (release.lifecycle !== EXPANSION_PACK_V8_LIFECYCLE.DRAFT
      || release.manifestBound !== true
      || release.styleCount !== 0n
      || release.manifestBlobId !== manifestBlobId
      || release.manifestSha256 !== manifestSha256) {
      fail(
        'EXPANSION_PACK_V8_CHAIN_READBACK_MISMATCH',
        'The Pack manifest binding is not visible on the exact empty Draft release.',
      );
    }
    assertEqual(manifestBlobId, action.inputs.manifestBlobId, 'Bound manifest Blob ID');
    assertEqual(
      manifestSha256,
      hex(action.inputs.manifestSha256, 'Pack manifest SHA-256'),
      'Bound manifest SHA-256',
    );
    return Object.freeze({
      ...result,
      manifestBound: true,
      readbackVerified: true,
      manifestBlobId,
      manifestSha256,
    });
  }

  if (action.id.startsWith('chain.pack.style.register.')) {
    const { release } = await getReleaseAndAdmin({ action, suiClient, runtime });
    const registered = exactEvent(events, runtime, 'ExpansionPackStyleRegisteredV8', (entry) => (
      sameId(eventId(entry.release_id || entry.releaseId, 'Style event release'), release.objectId)
      && String(entry.part_key || entry.partKey) === String(action.inputs.partKey)
      && String(entry.item_key || entry.itemKey) === String(action.inputs.itemKey)
      && String(entry.style_key || entry.styleKey) === String(action.inputs.styleKey)
    ));
    if (release.lifecycle !== EXPANSION_PACK_V8_LIFECYCLE.DRAFT || release.styleCount < 1n) {
      fail('EXPANSION_PACK_V8_CHAIN_READBACK_MISMATCH', 'Registered Style is not visible on a Draft Pack.');
    }
    const style = {
      partKey: String(registered.part_key || registered.partKey),
      itemKey: String(registered.item_key || registered.itemKey),
      styleKey: String(registered.style_key || registered.styleKey),
      assetBlobId: String(registered.asset_blob_id || registered.assetBlobId),
      assetSha256: eventHash(registered.asset_sha256 || registered.assetSha256, 'Style asset hash'),
      assetSealId: eventHash(
        registered.asset_seal_id || registered.assetSealId,
        'Style Seal ID',
        { allowEmpty: true },
      ),
    };
    const record = await readExactStyleRecord({
      suiClient,
      runtime,
      release,
      inputs: action.inputs,
    });
    ['assetBlobId', 'assetSha256', 'assetSealId'].forEach((key) => assertEqual(
      record[key],
      style[key],
      `Style registry ${key}`,
    ));
    Object.keys(style).forEach((key) => assertEqual(
      style[key],
      HASH_INPUTS.has(key) ? hex(action.inputs[key], key, { allowEmpty: key === 'assetSealId' }) : action.inputs[key],
      `Registered Style ${key}`,
    ));
    return Object.freeze({ ...result, styleRegistered: true, readbackVerified: true, ...style });
  }

  if (action.id === 'chain.pack.seal') {
    const { release } = await getReleaseAndAdmin({ action, suiClient, runtime });
    const sealed = exactEvent(events, runtime, 'ExpansionPackSealedV8', (entry) => (
      sameId(eventId(entry.release_id || entry.releaseId, 'Seal event release'), release.objectId)
    ));
    const commitment = eventHash(
      sealed.style_registry_commitment || sealed.styleRegistryCommitment,
      'Sealed Style registry commitment',
    );
    assertEqual(commitment, hex(action.inputs.styleRegistryCommitment, 'Style registry commitment'), 'Sealed commitment');
    if (release.lifecycle !== EXPANSION_PACK_V8_LIFECYCLE.SEALED
      || release.styleRegistryCommitment !== commitment
      || release.styleCount !== u64(sealed.style_count ?? sealed.styleCount, 'Sealed Style count')) {
      fail('EXPANSION_PACK_V8_CHAIN_READBACK_MISMATCH', 'Sealed Pack object does not match its event.');
    }
    return Object.freeze({ ...result, sealed: true, readbackVerified: true, styleRegistryCommitment: commitment });
  }

  if (action.id === 'chain.pack.seal-policy.bind') {
    const { release } = await getReleaseAndAdmin({ action, suiClient, runtime });
    const bound = exactEvent(events, runtime, 'ExpansionPackSealPolicyBoundV8', (entry) => (
      sameId(eventId(entry.release_id || entry.releaseId, 'Seal policy release'), release.objectId)
    ));
    const policyId = eventId(bound.seal_policy_id || bound.sealPolicyId, 'Seal policy ID');
    const sealPackageId = eventId(
      bound.seal_package_id || bound.sealPackageId,
      'Seal package ID',
    );
    const expectedSealPackageId = exactId(
      action.inputs.sealPackageId,
      'Expected Seal package ID',
    );
    const commitment = eventHash(
      bound.seal_release_commitment || bound.sealReleaseCommitment,
      'Seal release commitment',
    );
    const expectedCommitment = (
      await deriveExpansionPackSealReleaseCommitmentV8({
        releaseId: release.objectId,
        contentCommitment: release.contentCommitment,
      })
    ).id.replace(/^0x/i, '').toLowerCase();
    if (!sameId(policyId, release.objectId)
      || !sameId(release.sealPolicyId, release.objectId)
      || !sameId(expectedSealPackageId, typeOrigin(runtime))
      || !sameId(sealPackageId, expectedSealPackageId)
      || !sameId(release.sealPackageId, sealPackageId)
      || commitment !== expectedCommitment
      || release.sealReleaseCommitment !== commitment) {
      fail('EXPANSION_PACK_V8_CHAIN_READBACK_MISMATCH', 'Pack Seal policy binding does not match the action.');
    }
    return Object.freeze({
      ...result,
      sealPolicyBound: true,
      readbackVerified: true,
      sealPolicyId: release.objectId,
      sealPackageId,
      sealReleaseCommitment: commitment,
    });
  }

  if (action.id === 'chain.pack.admit') {
    const [releaseObject] = await getExactObjects(suiClient, [action.inputs.packReleaseId], 'Admitted Pack');
    const release = parseExpansionPackReleaseV8(releaseObject, { runtime });
    const admitted = exactEvent(events, runtime, 'ExpansionPackAdmittedV8', (entry) => (
      sameId(eventId(entry.release_id || entry.releaseId, 'Admission release'), release.objectId)
    ));
    const signer = exactId(action.authority?.signer, 'Parent Maker owner');
    const parent = await verifyParentObjects({
      suiClient,
      runtime,
      inputs: action.inputs,
      signer,
      requireReleaseEvidence: true,
    });
    if (release.lifecycle !== EXPANSION_PACK_V8_LIFECYCLE.ADMITTED
      || !sameId(release.parentRootId, action.inputs.baseMakerRootId)
      || !sameId(release.parentLegacyMakerId, action.inputs.parentLegacyMakerId)
      || !sameId(release.admittedBy, signer)
      || release.admittedParentOwnershipEpoch !== parent.root.ownershipEpoch
      || !sameId(admitted.parent_root_id || admitted.parentRootId, release.parentRootId)
      || !sameId(admitted.parent_legacy_maker_id || admitted.parentLegacyMakerId, release.parentLegacyMakerId)
      || !sameId(admitted.admitted_by || admitted.admittedBy, signer)
      || u64(admitted.parent_ownership_epoch ?? admitted.parentOwnershipEpoch, 'Admission epoch')
        !== parent.root.ownershipEpoch
      || String(admitted.parent_version || admitted.parentVersion) !== release.parentVersion
      || String(admitted.parent_manifest_blob_id || admitted.parentManifestBlobId)
        !== release.parentManifestBlobId
      || eventHash(admitted.parent_manifest_sha256 || admitted.parentManifestSha256, 'Admission parent hash')
        !== release.parentManifestSha256) {
      fail('EXPANSION_PACK_V8_CHAIN_READBACK_MISMATCH', 'Pack admission does not bind the exact current parent tuple.');
    }
    return Object.freeze({
      ...result,
      admitted: true,
      parentBindingVerified: true,
      readbackVerified: true,
      baseMakerRootId: action.inputs.baseMakerRootId,
      parentLegacyMakerId: action.inputs.parentLegacyMakerId,
      parentVersion: action.inputs.parentVersion,
      parentManifestBlobId: action.inputs.parentManifestBlobId,
      parentManifestSha256: action.inputs.parentManifestSha256,
    });
  }

  const functionName = moveFunction(action.target);
  const lifecycleCalls = {
    activate_expansion_pack_v8: ['chain.pack.activate', 'ExpansionPackLifecycleChangedV8', 3, 'ACTIVE'],
    pause_expansion_pack_v8: [null, 'ExpansionPackLifecycleChangedV8', 4, 'PAUSED'],
    resume_expansion_pack_v8: [null, 'ExpansionPackLifecycleChangedV8', 3, 'ACTIVE'],
    archive_expansion_pack_v8: [null, 'ExpansionPackLifecycleChangedV8', 5, 'ARCHIVED'],
  };
  if (lifecycleCalls[functionName]) {
    const [, eventName, expectedLifecycle, lifecycleState] = lifecycleCalls[functionName];
    const { release } = await getReleaseAndAdmin({ action, suiClient, runtime });
    exactEvent(events, runtime, eventName, (entry) => (
      sameId(eventId(entry.release_id || entry.releaseId, 'Lifecycle release'), release.objectId)
      && Number(entry.lifecycle) === expectedLifecycle
    ));
    if (release.lifecycle !== expectedLifecycle) {
      fail('EXPANSION_PACK_V8_CHAIN_READBACK_MISMATCH', `Pack lifecycle is not ${lifecycleState}.`);
    }
    if (['activate_expansion_pack_v8', 'resume_expansion_pack_v8'].includes(functionName)) {
      const [rootObject] = await getExactObjects(suiClient, [action.inputs.baseMakerRootId], 'Parent MakerRootV5');
      const root = minimalParentRoot(rootObject, runtime);
      if (release.admittedParentOwnershipEpoch !== root.ownershipEpoch
        || !sameId(release.parentRootId, root.objectId)
        || !sameId(root.protocolConfigId, action.inputs.commerceProtocolConfigV5Id)) {
        fail('EXPANSION_PACK_V8_PARENT_READBACK_MISMATCH', 'Pack activation uses a stale parent epoch or Config.');
      }
    }
    return Object.freeze({ ...result, readbackVerified: true, lifecycleState });
  }

  if (['claim_free_expansion_pack_v8', 'purchase_expansion_pack_v8'].includes(functionName)) {
    const paymentCoinType = functionName === 'purchase_expansion_pack_v8'
      ? action.typeArguments?.[0]
      : '';
    const passIds = createdObjectIds(indexed, runtime, 'ExpansionPackPassV8');
    if (passIds.length !== 1) {
      fail('EXPANSION_PACK_V8_CHAIN_READBACK_MISMATCH', 'Pack claim or purchase must create exactly one wallet-bound Pass.');
    }
    const [releaseObject, passObject] = await getExactObjects(
      suiClient,
      [action.inputs.packReleaseId, passIds[0]],
      'Pack entitlement object',
    );
    const release = parseExpansionPackReleaseV8(releaseObject, { runtime });
    const pass = parseExpansionPackPassV8(passObject, { runtime });
    const granted = exactEvent(events, runtime, 'ExpansionPackEntitlementGrantedV8', (entry) => (
      sameId(eventId(entry.release_id || entry.releaseId, 'Entitlement release'), release.objectId)
      && sameId(eventId(entry.pass_id || entry.passId, 'Entitlement Pass'), pass.objectId)
    ));
    const holder = exactId(action.authority?.signer, 'Pack buyer');
    const expectedPaid = functionName === 'purchase_expansion_pack_v8'
      ? u64(action.inputs.purchasePriceAtomic, 'Pack purchase price')
      : 0n;
    if (!sameId(pass.releaseId, release.objectId)
      || !sameId(pass.parentRootId, release.parentRootId)
      || !sameId(pass.holder, holder)
      || pass.paidAtomic !== expectedPaid
      || pass.contentCommitment !== release.contentCommitment
      || !sameId(granted.holder, holder)
      || u64(granted.paid_atomic ?? granted.paidAtomic, 'Entitlement paid amount') !== expectedPaid) {
      fail('EXPANSION_PACK_V8_CHAIN_READBACK_MISMATCH', 'Pack Pass does not match the exact release, holder and payment.');
    }
    if (functionName === 'purchase_expansion_pack_v8') {
      const [treasuryObject] = await getExactObjects(suiClient, [action.inputs.packTreasuryId], 'Pack Treasury');
      const treasury = parseTreasury(treasuryObject, { runtime, paymentCoinType });
      if (!sameId(treasury.releaseId, release.objectId)) {
        fail('EXPANSION_PACK_V8_CHAIN_READBACK_MISMATCH', 'Pack Treasury belongs to another release.');
      }
    }
    return Object.freeze({ ...result, readbackVerified: true, entitlementGranted: true, passId: pass.objectId });
  }

  if (functionName === 'withdraw_expansion_pack_revenue_v8') {
    const paymentCoinType = action.typeArguments?.[0];
    const [releaseObject, treasuryObject, capObject] = await getExactObjects(
      suiClient,
      [action.inputs.packReleaseId, action.inputs.packTreasuryId, action.inputs.packAdminCapId],
      'Pack withdrawal object',
    );
    const release = parseExpansionPackReleaseV8(releaseObject, { runtime });
    const treasury = parseTreasury(treasuryObject, { runtime, paymentCoinType });
    const cap = parseAdminCap(capObject, { runtime });
    const withdrawn = exactEvent(events, runtime, 'ExpansionPackRevenueWithdrawnV8', (entry) => (
      sameId(eventId(entry.release_id || entry.releaseId, 'Withdrawal release'), release.objectId)
    ));
    if (!sameId(treasury.releaseId, release.objectId)
      || !sameId(cap.releaseId, release.objectId)
      || !sameId(cap.owner, action.authority?.signer)
      || u64(withdrawn.amount, 'Withdrawal amount') !== u64(action.inputs.amountAtomic, 'Expected withdrawal amount')
      || !sameId(withdrawn.recipient, action.inputs.recipient)
      || !sameId(withdrawn.treasury_id || withdrawn.treasuryId, treasury.objectId)) {
      fail('EXPANSION_PACK_V8_CHAIN_READBACK_MISMATCH', 'Pack withdrawal event and objects do not match.');
    }
    return Object.freeze({ ...result, readbackVerified: true, revenueWithdrawn: true });
  }

  fail('EXPANSION_PACK_V8_CHAIN_TARGET_UNSUPPORTED', `Unsupported v8 readback action ${action.id || functionName}.`);
}

export const readExpansionPackV8PublicationSubmission = readExpansionPackV8Submission;

async function listOwnedByType(client, owner, type) {
  if (!client?.listOwnedObjects) {
    fail('EXPANSION_PACK_V8_CLIENT_MISSING', 'A Sui client with listOwnedObjects is required.');
  }
  const results = [];
  let cursor = null;
  do {
    const page = await client.listOwnedObjects({
      owner: exactId(owner, 'Wallet address'),
      type,
      cursor,
      limit: 50,
      include: { json: true, type: true, owner: true },
    });
    results.push(...array(page?.objects || page?.data));
    cursor = page?.hasNextPage ? (page.cursor || page.nextCursor) : null;
  } while (cursor && results.length < 10_000);
  return results;
}

export async function queryOwnedExpansionPackPassesV8(client, {
  runtime, owner, releaseId = '', parentRootId = '',
} = {}) {
  const wallet = exactId(owner, 'Wallet address');
  const type = expectedType(runtime, 'ExpansionPackPassV8');
  const passes = (await listOwnedByType(client, wallet, type))
    .map((entry) => parseExpansionPackPassV8(entry, { runtime }))
    .filter((entry) => sameId(entry.holder, wallet))
    .filter((entry) => !releaseId || sameId(entry.releaseId, releaseId))
    .filter((entry) => !parentRootId || sameId(entry.parentRootId, parentRootId));
  return Object.freeze(passes);
}

function parseAdmittedEvent(value, runtime) {
  if (normalizeStructTag(eventType(value)) !== eventNameType(runtime, 'ExpansionPackAdmittedV8')) {
    fail('EXPANSION_PACK_V8_TYPE_ORIGIN_MISMATCH', 'Expansion Pack discovery event has the wrong TypeOrigin.');
  }
  const event = eventJson(value);
  return Object.freeze({
    releaseId: eventId(event.release_id || event.releaseId, 'Discovered Pack release ID'),
    parentRootId: eventId(event.parent_root_id || event.parentRootId, 'Discovered parent root ID'),
    parentLegacyMakerId: eventId(
      event.parent_legacy_maker_id || event.parentLegacyMakerId,
      'Discovered parent OCMaker ID',
    ),
    admittedBy: exactId(event.admitted_by || event.admittedBy, 'Discovered admitting wallet'),
    parentOwnershipEpoch: u64(
      event.parent_ownership_epoch ?? event.parentOwnershipEpoch,
      'Discovered parent ownership epoch',
    ),
    parentVersion: stringValue(
      event.parent_version || event.parentVersion,
      'Discovered parent version',
    ),
    parentManifestBlobId: stringValue(
      event.parent_manifest_blob_id || event.parentManifestBlobId,
      'Discovered parent manifest Blob ID',
    ),
    parentManifestSha256: eventHash(
      event.parent_manifest_sha256 || event.parentManifestSha256,
      'Discovered parent manifest SHA-256',
    ),
  });
}

export async function queryExpansionPackReleasesV8(client, {
  runtime,
  parentRootId = '',
  creator = '',
  limit = 1_000,
  scanLimit = 5_000,
} = {}) {
  if (!client?.queryEvents || !client?.getObjects) {
    fail('EXPANSION_PACK_V8_CLIENT_MISSING', 'A Sui client with queryEvents and getObjects is required.');
  }
  const expectedParent = parentRootId ? exactId(parentRootId, 'Parent MakerRootV5 ID') : '';
  const expectedCreator = creator ? exactId(creator, 'Pack creator') : '';
  const discovered = new Map();
  const resultLimit = Math.max(1, Number(limit) || 1_000);
  const eventScanLimit = Math.max(1, Math.min(50_000, Number(scanLimit) || 5_000));
  const pageScanLimit = Math.max(1, Math.ceil(eventScanLimit / 50));
  let scannedEvents = 0;
  let scannedPages = 0;
  let cursor = null;
  do {
    const page = await client.queryEvents({
      query: { MoveEventType: eventNameType(runtime, 'ExpansionPackAdmittedV8') },
      cursor,
      limit: Math.min(50, eventScanLimit - scannedEvents),
      // Admission is the parent-owner authorization boundary. Creation is
      // permissionless and can never be used as a trusted Player catalog.
      order: 'descending',
    });
    const pageEvents = array(page?.data || page?.events);
    scannedPages += 1;
    scannedEvents += pageEvents.length;
    const matches = pageEvents
      .map((entry) => parseAdmittedEvent(entry, runtime))
      .filter((entry) => !expectedParent || sameId(entry.parentRootId, expectedParent));
    matches.forEach((entry) => {
      const key = comparableId(entry.releaseId);
      // Results are newest-first. First-write-wins preserves the current
      // re-admission epoch rather than an older owner authorization.
      if (!discovered.has(key)) discovered.set(key, entry);
    });
    if (
      page?.hasNextPage
      && (scannedEvents >= eventScanLimit || scannedPages >= pageScanLimit)
    ) {
      fail(
        'EXPANSION_PACK_V8_DISCOVERY_SCAN_LIMIT',
        'Expansion Pack discovery reached its bounded admission-event scan limit. No partial catalog was accepted.',
        {
          scannedEvents,
          scannedPages,
          scanLimit: eventScanLimit,
          pageLimit: pageScanLimit,
          parentRootId: expectedParent,
        },
      );
    }
    cursor = page?.hasNextPage ? (page.nextCursor || page.cursor) : null;
    if (page?.hasNextPage && !cursor) {
      fail(
        'EXPANSION_PACK_V8_DISCOVERY_CURSOR_INVALID',
        'Expansion Pack admission discovery returned an incomplete pagination cursor.',
      );
    }
  } while (cursor);
  const unique = [...discovered.values()];
  const objects = [];
  for (let offset = 0; offset < unique.length; offset += 50) {
    objects.push(...await getExactObjects(
      client,
      unique.slice(offset, offset + 50).map((entry) => entry.releaseId),
      'Discovered Expansion Pack release',
    ));
  }
  const releasesById = new Map(objects.map((entry) => {
    const release = parseExpansionPackReleaseV8(entry, { runtime });
    return [comparableId(release.objectId), release];
  }));
  const releases = unique.map((event) => releasesById.get(comparableId(event.releaseId)));
  releases.forEach((release) => {
    const event = unique.find((entry) => sameId(entry.releaseId, release.objectId));
    if (!event
      || !sameId(event.parentRootId, release.parentRootId)
      || !sameId(event.parentLegacyMakerId, release.parentLegacyMakerId)
      || !sameId(event.admittedBy, release.admittedBy)
      || event.parentOwnershipEpoch !== release.admittedParentOwnershipEpoch
      || event.parentVersion !== release.parentVersion
      || event.parentManifestBlobId !== release.parentManifestBlobId
      || event.parentManifestSha256 !== release.parentManifestSha256) {
      fail('EXPANSION_PACK_V8_DISCOVERY_MISMATCH', 'Discovered Pack event and release object do not match.');
    }
  });
  return Object.freeze(releases
    .filter((release) => !expectedCreator || sameId(release.creator, expectedCreator))
    .slice(0, resultLimit));
}
