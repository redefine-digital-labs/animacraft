import { sha256 } from '@noble/hashes/sha2.js';
import { bcs } from '@mysten/sui/bcs';
import { TransactionDataBuilder } from '@mysten/sui/transactions';
import { fromBase64, normalizeStructTag, toBase64 } from '@mysten/sui/utils';

import { makerV8ActionV8 } from './maker-v8-actions.js';

export const WEB_V8_READBACK_SCHEMA = 'animacraft.web-market-finalized-readback.v8';

const EXACT_ID = /^0x[0-9a-f]{64}$/;
const EXACT_HASH = /^0x[0-9a-f]{64}$/;
const EXACT_DECIMAL = /^(?:0|[1-9][0-9]*)$/;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{20,64}$/;
const ZERO = `0x${'0'.repeat(64)}`;
const REGISTRY_FIELDS = Object.freeze([
  'revision', 'listing_count', 'escrow_count', 'completed_sale_count',
  'canceled_sale_count', 'recovered_sale_count', 'gross_volume_atomic',
  'protocol_paid_atomic', 'creator_paid_atomic', 'source_paid_atomic',
  'seller_paid_atomic',
]);
const SOUL_COMMITMENT_INPUT_BCS = bcs.struct('SoulCommitmentInputV8', {
  domain: bcs.vector(bcs.u8()),
  version: bcs.u64(),
  soul_registry_id: bcs.Address,
  root_id: bcs.Address,
  maker_version: bcs.u64(),
  root_content_commitment: bcs.vector(bcs.u8()),
  output_key: bcs.string(),
  output_policy_commitment: bcs.vector(bcs.u8()),
  holder: bcs.Address,
  ownership_epoch: bcs.u64(),
  output_id: bcs.Address,
  receipt_id: bcs.Address,
  recipe_commitment: bcs.vector(bcs.u8()),
  render_commitment: bcs.vector(bcs.u8()),
  output_commitment: bcs.vector(bcs.u8()),
  receipt_commitment: bcs.vector(bcs.u8()),
  soul_creator_royalty_bps: bcs.u16(),
  maker_source_royalty_bps: bcs.u16(),
});
const SOUL_COMMITMENT_DOMAIN = new TextEncoder().encode('animacraft-v8/output/canonical-soul');
const ARGUMENT_ROLES = Object.freeze({
  registry: 'REGISTRY', treasury: 'TREASURY', listing: 'LISTING', root: 'ROOT',
  outputRegistry: 'OUTPUT_REGISTRY', soulRegistry: 'SOUL_REGISTRY',
  physicalRegistry: 'PHYSICAL_REGISTRY', admin: 'ADMIN', adminReceiving: 'ADMIN',
  outputAsset: 'OUTPUT', outputReceiving: 'OUTPUT', receipt: 'RECEIPT',
  receiptReceiving: 'RECEIPT', soul: 'SOUL', soulReceiving: 'SOUL',
  asset: 'ASSET', receiving: 'ASSET', protocolTreasury: 'PROTOCOL_TREASURY',
  makerTreasury: 'MAKER_TREASURY', packTreasury: 'PACK_TREASURY',
});

function error(code, message, details) {
  const result = new Error(message);
  result.name = 'FreshV8WebError';
  result.code = code;
  result.layer = 'READBACK';
  if (details !== undefined) result.details = details;
  return result;
}

function fail(code, message, details) { throw error(code, message, details); }

function plain(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function exactKeys(value, expected, label) {
  if (!plain(value)) fail('WEB_V8_FINALIZED_RECORD_INVALID', `${label} must be a plain record.`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((field, index) => field !== wanted[index])) {
    fail('WEB_V8_FINALIZED_FIELDS_INVALID', `${label} fields are not the exact Core V2 schema.`, { actual, expected: wanted });
  }
}

function stableJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) fail('WEB_V8_FINALIZED_VALUE_INVALID', 'Canonical evidence contains a non-integer number.');
    return JSON.stringify(value);
  }
  if (typeof value === 'bigint') return JSON.stringify(value.toString());
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (plain(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  fail('WEB_V8_FINALIZED_VALUE_INVALID', 'Canonical evidence contains an unsupported value.');
}

function same(actual, expected, code, message) {
  if (stableJson(actual) !== stableJson(expected)) fail(code, message, { actual, expected });
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(
    value,
    (_key, entry) => typeof entry === 'bigint' ? entry.toString() : entry,
  ));
}

function id(value, label, allowZero = false) {
  if (typeof value !== 'string' || !EXACT_ID.test(value) || (!allowZero && value === ZERO)) {
    fail('WEB_V8_FINALIZED_ID_INVALID', `${label} must be an exact lowercase Sui ID.`);
  }
  return value;
}

function decimal(value, label) {
  const normalized = typeof value === 'bigint' ? value.toString() : value;
  if (typeof normalized !== 'string' || !EXACT_DECIMAL.test(normalized)) {
    fail('WEB_V8_FINALIZED_DECIMAL_INVALID', `${label} must be a canonical unsigned decimal string.`);
  }
  return normalized;
}

function digest(value, label) {
  if (typeof value !== 'string' || !BASE58.test(value)) {
    fail('WEB_V8_FINALIZED_DIGEST_INVALID', `${label} must be an exact Sui digest.`);
  }
  return value;
}

function hash(value, label) {
  if (typeof value !== 'string' || !EXACT_HASH.test(value)) {
    fail('WEB_V8_FINALIZED_HASH_INVALID', `${label} must be an exact lowercase 32-byte hash.`);
  }
  return value;
}

function plus(value, delta) { return (BigInt(value) + BigInt(delta)).toString(); }

function minus(value, delta, label) {
  if (BigInt(value) < BigInt(delta)) fail('WEB_V8_FINALIZED_COUNTER_INVALID', `${label} underflows.`);
  return (BigInt(value) - BigInt(delta)).toString();
}

function bytes(value, label) {
  if (typeof value !== 'string' || !value) fail('WEB_V8_FINALIZED_BCS_INVALID', `${label} BCS is required.`);
  try {
    const result = fromBase64(value);
    if (!result.length || toBase64(result) !== value) throw new TypeError('non-canonical base64');
    return result;
  } catch {
    fail('WEB_V8_FINALIZED_BCS_INVALID', `${label} must be non-empty canonical base64.`);
  }
}

function hex(bytesValue) {
  return `0x${[...bytesValue].map((entry) => entry.toString(16).padStart(2, '0')).join('')}`;
}

function fingerprint(value) {
  return hex(sha256(new TextEncoder().encode(stableJson(value))));
}

function scalar(fields, ...names) {
  for (const name of names) {
    if (fields?.[name] === undefined) continue;
    let value = fields[name];
    while (plain(value) && (Object.hasOwn(value, 'value') || Object.hasOwn(value, 'fields'))
      && Object.keys(value).every((key) => ['value', 'fields'].includes(key))) {
      value = value.value ?? value.fields;
    }
    return value;
  }
  return undefined;
}

function struct(value) { return plain(value?.fields) ? value.fields : value; }

function option(value, label) {
  if (typeof value === 'string') return id(value, label);
  const vec = Array.isArray(value) ? value : value?.vec ?? value?.fields?.vec;
  if (!Array.isArray(vec) || vec.length > 1) fail('WEB_V8_FINALIZED_OPTION_INVALID', `${label} is not a canonical Move option.`);
  return vec.length ? id(vec[0], label) : null;
}

function commitment(value, label) {
  if (typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value)) return value.toLowerCase();
  if (Array.isArray(value) && value.length === 32
    && value.every((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 255)) {
    return hex(value);
  }
  fail('WEB_V8_FINALIZED_COMMITMENT_INVALID', `${label} must be an exact 32-byte commitment.`);
}

function commitmentBytes(value, label) {
  const normalized = commitment(value, label);
  return Uint8Array.from(normalized.slice(2).match(/.{2}/g).map((pair) => Number.parseInt(pair, 16)));
}

function u16(value, label) {
  const normalized = decimal(value, label);
  if (BigInt(normalized) > 65_535n) {
    fail('WEB_V8_FINALIZED_DECIMAL_INVALID', `${label} exceeds u16.`);
  }
  return Number(normalized);
}

function text(value, label) {
  if (typeof value !== 'string') fail('WEB_V8_FINALIZED_VALUE_INVALID', `${label} must be an exact UTF-8 string.`);
  return value;
}

function deriveSoulCommitment(fields) {
  let encoded;
  try {
    encoded = SOUL_COMMITMENT_INPUT_BCS.serialize({
      domain: SOUL_COMMITMENT_DOMAIN,
      version: decimal(scalar(fields, 'version'), 'SOUL.version'),
      soul_registry_id: id(scalar(fields, 'soul_registry_id', 'soulRegistryId'), 'SOUL.soulRegistryId'),
      root_id: id(scalar(fields, 'root_id', 'rootId'), 'SOUL.rootId'),
      maker_version: decimal(scalar(fields, 'maker_version', 'makerVersion'), 'SOUL.makerVersion'),
      root_content_commitment: commitmentBytes(
        scalar(fields, 'root_content_commitment', 'rootContentCommitment'),
        'SOUL.rootContentCommitment',
      ),
      output_key: text(scalar(fields, 'output_key', 'outputKey'), 'SOUL.outputKey'),
      output_policy_commitment: commitmentBytes(
        scalar(fields, 'output_policy_commitment', 'outputPolicyCommitment'),
        'SOUL.outputPolicyCommitment',
      ),
      holder: id(scalar(fields, 'holder'), 'SOUL.holder'),
      ownership_epoch: decimal(scalar(fields, 'ownership_epoch', 'ownershipEpoch'), 'SOUL.ownershipEpoch'),
      output_id: id(scalar(fields, 'output_id', 'outputId'), 'SOUL.outputId'),
      receipt_id: id(scalar(fields, 'receipt_id', 'receiptId'), 'SOUL.receiptId'),
      recipe_commitment: commitmentBytes(
        scalar(fields, 'recipe_commitment', 'recipeCommitment'),
        'SOUL.recipeCommitment',
      ),
      render_commitment: commitmentBytes(
        scalar(fields, 'render_commitment', 'renderCommitment'),
        'SOUL.renderCommitment',
      ),
      output_commitment: commitmentBytes(
        scalar(fields, 'output_commitment', 'outputCommitment'),
        'SOUL.outputCommitment',
      ),
      receipt_commitment: commitmentBytes(
        scalar(fields, 'receipt_commitment', 'receiptCommitment'),
        'SOUL.receiptCommitment',
      ),
      soul_creator_royalty_bps: u16(
        scalar(fields, 'soul_creator_royalty_bps', 'soulCreatorRoyaltyBps'),
        'SOUL.soulCreatorRoyaltyBps',
      ),
      maker_source_royalty_bps: u16(
        scalar(fields, 'maker_source_royalty_bps', 'makerSourceRoyaltyBps'),
        'SOUL.makerSourceRoyaltyBps',
      ),
    }).toBytes();
  } catch (cause) {
    if (cause?.code?.startsWith?.('WEB_V8_')) throw cause;
    fail('WEB_V8_FINALIZED_SOUL_COMMITMENT_MISMATCH', 'Canonical Soul commitment input cannot be encoded.', {
      cause: String(cause?.message || cause),
    });
  }
  return hex(sha256(encoded));
}

function withoutFields(value, fields) {
  const result = clone(struct(value));
  for (const field of fields) {
    delete result[field];
    delete result[camel(field)];
  }
  return result;
}

function ownerId(owner, kind, label) {
  if (owner?.kind !== kind) fail('WEB_V8_FINALIZED_OWNER_INVALID', `${label} must have ${kind} ownership.`);
  const value = owner.value;
  return id(typeof value === 'string' ? value : value?.owner ?? value?.objectId ?? value?.address, label);
}

function custodyOwnerId(owner, expected, label, allowObjectOwner = false) {
  const allowed = allowObjectOwner ? ['AddressOwner', 'ObjectOwner'] : ['AddressOwner'];
  if (!allowed.includes(owner?.kind)) {
    fail('WEB_V8_FINALIZED_OWNER_INVALID', `${label} has the wrong ownership kind.`);
  }
  const value = typeof owner.value === 'string'
    ? owner.value : owner.value?.owner ?? owner.value?.objectId ?? owner.value?.address;
  if (id(value, label) !== expected) fail('WEB_V8_FINALIZED_OWNER_INVALID', `${label} has the wrong owner.`);
  return value;
}

function normalizeType(value, label) {
  try { return normalizeStructTag(value); } catch { fail('WEB_V8_FINALIZED_TYPE_INVALID', `${label} must be an exact Move type.`); }
}

function canonicalPlanHash(request) {
  const plan = request?.plan;
  exactKeys(plan, [
    'transactionBytes', 'transactionDigest', 'stage', 'sequence', 'signer',
    'epochWindow', 'gas', 'expiration', 'sourceSnapshot', 'market', 'fingerprint',
  ], 'request.plan');
  const supplied = hash(request.planHash, 'request.planHash');
  if (hash(plan.fingerprint, 'request.plan.fingerprint') !== supplied) {
    fail('WEB_V8_FINALIZED_PLAN_HASH_MISMATCH', 'Durable plan fingerprint and requested planHash differ.');
  }
  const { fingerprint: ignored, ...covered } = plan;
  const derived = fingerprint(covered);
  if (derived !== supplied) {
    fail('WEB_V8_FINALIZED_PLAN_HASH_MISMATCH', 'planHash does not cover the complete canonical durable plan.', { supplied, derived });
  }
  return supplied;
}

function assertTransactionBytes(value, request, descriptor) {
  if (value.effects.transactionBcs !== request.plan.transactionBytes) {
    fail('WEB_V8_FINALIZED_TRANSACTION_BYTES_MISMATCH', 'Core V2 TransactionData BCS differs from the durable plan bytes.');
  }
  const raw = bytes(value.effects.transactionBcs, 'effects.transactionBcs');
  const observedDigest = TransactionDataBuilder.getDigestFromBytes(raw);
  if (observedDigest !== request.digest || observedDigest !== request.plan.transactionDigest) {
    fail('WEB_V8_FINALIZED_TRANSACTION_DIGEST_MISMATCH', 'TransactionData BCS does not derive the durable digest.');
  }
  let snapshot;
  try { snapshot = TransactionDataBuilder.fromBytes(raw).snapshot(); } catch {
    fail('WEB_V8_FINALIZED_TRANSACTION_BYTES_MISMATCH', 'TransactionData BCS cannot be decoded by the pinned Sui SDK.');
  }
  const expectedTarget = descriptor.target.split('::');
  const calls = snapshot.commands.map((command) => command?.MoveCall).filter(Boolean)
    .filter((call) => call.module === 'market_v8');
  if (calls.length !== 1 || calls[0].package !== expectedTarget[0]
    || calls[0].module !== expectedTarget[1] || calls[0].function !== expectedTarget[2]
    || stableJson(calls[0].typeArguments) !== stableJson(descriptor.typeArguments)
    || snapshot.sender !== descriptor.sender) {
    fail('WEB_V8_FINALIZED_TRANSACTION_INPUT_MISMATCH', 'Decoded sender, Market target, or type arguments differ from the durable descriptor.');
  }
  return snapshot;
}

function ref(value, label, withOwner = true) {
  if (value === null) return null;
  const hasKind = withOwner && Object.hasOwn(value, 'kind');
  exactKeys(value, withOwner
    ? ['objectId', 'version', 'digest', 'owner', ...(hasKind ? ['kind'] : [])]
    : ['objectId', 'version', 'digest'], label);
  const result = {
    objectId: id(value.objectId, `${label}.objectId`),
    version: decimal(value.version, `${label}.version`),
    digest: digest(value.digest, `${label}.digest`),
  };
  if (withOwner) {
    exactKeys(value.owner, ['kind', 'value'], `${label}.owner`);
    result.owner = value.owner;
    if (hasKind) result.kind = value.kind;
  }
  return result;
}

function snapshot(value, role, side, expectedRef, transactionDigest) {
  if (value === null) {
    if (expectedRef !== null) fail('WEB_V8_FINALIZED_HISTORY_MISSING', `${role}.${side} historical snapshot is missing.`);
    return null;
  }
  exactKeys(value, ['objectId', 'type', 'ownerKind', 'ref', 'owner', 'previousTransaction', 'parsed'], `${role}.${side}`);
  if (!plain(value.parsed)) fail('WEB_V8_FINALIZED_HISTORY_INVALID', `${role}.${side}.parsed must be authoritative parsed Move content.`);
  const observedRef = ref(value.ref, `${role}.${side}.ref`);
  same(observedRef, expectedRef, 'WEB_V8_FINALIZED_HISTORY_REF_MISMATCH', `${role}.${side} does not match its exact effects ref.`);
  if (id(value.objectId, `${role}.${side}.objectId`) !== expectedRef.objectId
    || value.ownerKind !== value.owner?.kind || stableJson(value.owner) !== stableJson(expectedRef.owner)) {
    fail('WEB_V8_FINALIZED_HISTORY_OWNER_MISMATCH', `${role}.${side} owner or identity differs from exact effects.`);
  }
  normalizeType(value.type, `${role}.${side}.type`);
  if (side === 'after' && transactionDigest !== null && value.previousTransaction !== transactionDigest) {
    fail('WEB_V8_FINALIZED_HISTORY_TRANSACTION_MISMATCH', `${role}.after was not written by the finalized transaction.`);
  }
  return value;
}

function assertEffects(value, transactionDigest, transactionSnapshot) {
  exactKeys(value.effects, [
    'transactionDigest', 'epoch', 'eventsDigest', 'transactionBcs', 'eventsBcs', 'bcs',
    'changedObjects', 'unchangedConsensusObjects', 'objects',
  ], 'effects');
  if (!Array.isArray(value.effects.changedObjects) || !Array.isArray(value.effects.unchangedConsensusObjects)
    || !Array.isArray(value.effects.objects)) {
    fail('WEB_V8_FINALIZED_EFFECTS_INVALID', 'Core V2 effects arrays are required.');
  }
  bytes(value.effects.eventsBcs, 'effects.eventsBcs');
  const changed = new Map();
  for (const [index, entry] of value.effects.changedObjects.entries()) {
    exactKeys(entry, ['objectId', 'inputState', 'input', 'outputState', 'output', 'idOperation'], `effects.changedObjects[${index}]`);
    const objectId = id(entry.objectId, `effects.changedObjects[${index}].objectId`);
    if (changed.has(objectId)) fail('WEB_V8_FINALIZED_EFFECTS_DUPLICATE', 'Changed object refs must be unique.');
    const input = ref(entry.input, `effects.changedObjects[${index}].input`);
    const output = ref(entry.output, `effects.changedObjects[${index}].output`);
    if ((entry.idOperation === 'Created') !== (input === null)
      || ((entry.idOperation === 'Deleted' || entry.outputState === 'DoesNotExist') !== (output === null))) {
      fail('WEB_V8_FINALIZED_ID_OPERATION_MISMATCH', `${objectId} has inconsistent V2 states and idOperation.`);
    }
    changed.set(objectId, { ...entry, input, output });
  }
  const sharedInputs = new Map();
  for (const input of transactionSnapshot.inputs) {
    const shared = input?.Object?.SharedObject;
    if (!shared) continue;
    const objectId = id(shared.objectId, 'transaction.sharedInput.objectId');
    if (sharedInputs.has(objectId)) {
      fail('WEB_V8_FINALIZED_TRANSACTION_INPUT_MISMATCH', 'TransactionData repeats a shared object input.');
    }
    sharedInputs.set(objectId, {
      initialSharedVersion: decimal(
        shared.initialSharedVersion,
        `transaction.sharedInput.${objectId}.initialSharedVersion`,
      ),
      mutable: shared.mutable === true,
    });
  }
  const unchanged = new Map();
  for (const [index, entry] of value.effects.unchangedConsensusObjects.entries()) {
    exactKeys(entry, ['objectId', 'version', 'digest', 'owner', 'kind'], `effects.unchangedConsensusObjects[${index}]`);
    const objectId = id(entry.objectId, `effects.unchangedConsensusObjects[${index}].objectId`);
    const shared = sharedInputs.get(objectId);
    const derivedOwner = shared
      ? { kind: 'Shared', value: { initialSharedVersion: shared.initialSharedVersion } }
      : null;
    if (!shared || entry.owner?.kind !== 'Shared'
      || (entry.owner.value !== null && stableJson(entry.owner) !== stableJson(derivedOwner))) {
      fail(
        'WEB_V8_FINALIZED_HISTORY_OWNER_MISMATCH',
        'Unchanged consensus evidence must derive Shared ownership from the exact TransactionData input.',
      );
    }
    const normalized = ref({
      objectId,
      version: entry.version,
      digest: entry.digest,
      owner: derivedOwner,
    }, `effects.unchangedConsensusObjects[${index}]`);
    if (changed.has(normalized.objectId) || unchanged.has(normalized.objectId)) {
      fail('WEB_V8_FINALIZED_EFFECTS_DUPLICATE', 'Changed and unchanged Core V2 refs must be disjoint and unique.');
    }
    unchanged.set(normalized.objectId, { ...entry, ...normalized });
  }
  const roles = new Map();
  const objectIds = new Set();
  for (const [index, object] of value.effects.objects.entries()) {
    exactKeys(object, ['role', 'objectId', 'type', 'ownerKind', 'change', 'idOperation', 'before', 'after', 'revenue'], `effects.objects[${index}]`);
    const role = String(object.role || '');
    const objectId = id(object.objectId, `effects.objects[${index}].objectId`);
    if (!/^[A-Z][A-Z0-9_]*$/.test(role) || roles.has(role) || objectIds.has(objectId)) {
      fail('WEB_V8_FINALIZED_ROLE_SET_INVALID', 'Evidence roles and object identities must be unique.');
    }
    exactKeys(object.revenue, ['before', 'after'], `${role}.revenue`);
    const change = changed.get(objectId);
    const readonly = unchanged.get(objectId);
    if (!change && !readonly) fail('WEB_V8_FINALIZED_OBJECT_REF_MISSING', `${role} is absent from Core V2 refs.`);
    const beforeRef = change ? change.input : readonly;
    const afterRef = change ? change.output : readonly;
    const before = snapshot(object.before, role, 'before', beforeRef, null);
    const after = snapshot(object.after, role, 'after', afterRef, change ? transactionDigest : null);
    const expectedChange = change
      ? (change.idOperation === 'Created' ? 'CREATED' : change.idOperation === 'Deleted' || !afterRef ? 'DELETED' : 'CHANGED')
      : 'READBACK';
    if (object.change !== expectedChange || object.idOperation !== (change?.idOperation ?? 'None')
      || object.ownerKind !== (after ?? before)?.ownerKind
      || (before && normalizeType(object.type, `${role}.type`) !== normalizeType(before.type, `${role}.before.type`))
      || (after && normalizeType(object.type, `${role}.type`) !== normalizeType(after.type, `${role}.after.type`))) {
      fail('WEB_V8_FINALIZED_OBJECT_HISTORY_MISMATCH', `${role} change, type, owner, or idOperation is inconsistent with Core V2 effects.`);
    }
    roles.set(role, { ...object, before, after, ref: change ?? readonly });
    objectIds.add(objectId);
  }
  return { changed, unchanged, roles };
}

function expectedRoles(descriptor, action, quote) {
  const roles = new Set(['ROOT', 'REGISTRY', 'TREASURY', 'LISTING']);
  for (const argument of descriptor.arguments) {
    const role = ARGUMENT_ROLES[argument.name];
    if (role && argument.objectId) roles.add(role);
  }
  if (action.id === 'purchaseMakerControl') roles.add('ADMIN_NEW');
  if (action.id === 'purchaseSoulBundle') {
    roles.add('OUTPUT_RECORD');
    roles.add('SOUL_RECORD');
  }
  if (action.kind === 'PURCHASE') {
    if (quote.creatorAtomic !== '0') roles.add('CREATOR_COIN');
    if (quote.sellerAtomic !== '0') roles.add('SELLER_COIN');
  }
  return roles;
}

function assertRoleSet(roles, descriptor, action, quote) {
  const expected = [...expectedRoles(descriptor, action, quote)].sort();
  const actual = [...roles.keys()].sort();
  same(actual, expected, 'WEB_V8_FINALIZED_ROLE_SET_INVALID', `Core V2 role set is not exact for ${action.id}.`);
}

function parsed(roles, role, side = 'after') {
  const object = roles.get(role);
  const result = object?.[side]?.parsed;
  if (!result) fail('WEB_V8_FINALIZED_OBJECT_STATE_MISSING', `${role}.${side} parsed state is required.`);
  return result;
}

function assertRegistryAndTreasury(roles, action, quote) {
  const before = parsed(roles, 'REGISTRY', 'before');
  const after = parsed(roles, 'REGISTRY', 'after');
  const expected = {};
  for (const field of REGISTRY_FIELDS) expected[field] = decimal(scalar(before, field, camel(field)), `REGISTRY.before.${field}`);
  expected.revision = plus(expected.revision, '1');
  if (action.kind === 'LIST') {
    expected.listing_count = plus(expected.listing_count, '1');
    expected.escrow_count = plus(expected.escrow_count, '1');
  } else if (action.kind === 'PURCHASE') {
    expected.escrow_count = minus(expected.escrow_count, '1', 'registry.escrowCount');
    expected.completed_sale_count = plus(expected.completed_sale_count, '1');
    for (const [field, amount] of [
      ['gross_volume_atomic', quote.grossAtomic], ['protocol_paid_atomic', quote.protocolAtomic],
      ['creator_paid_atomic', quote.creatorAtomic], ['source_paid_atomic', quote.sourceAtomic],
      ['seller_paid_atomic', quote.sellerAtomic],
    ]) expected[field] = plus(expected[field], amount);
  } else {
    expected.escrow_count = minus(expected.escrow_count, '1', 'registry.escrowCount');
    const field = action.kind === 'CANCEL' ? 'canceled_sale_count' : 'recovered_sale_count';
    expected[field] = plus(expected[field], '1');
  }
  const observed = {};
  for (const field of REGISTRY_FIELDS) observed[field] = decimal(scalar(after, field, camel(field)), `REGISTRY.after.${field}`);
  same(observed, expected, 'WEB_V8_FINALIZED_REGISTRY_DELTA_MISMATCH', 'Actual MarketRegistry before/after delta is invalid.');

  const treasuryBefore = parsed(roles, 'TREASURY', 'before');
  const treasuryAfter = parsed(roles, 'TREASURY', 'after');
  const balanceValue = (fields, field) => {
    const raw = fields?.[field];
    return scalar(struct(raw), 'value') ?? scalar(fields, field);
  };
  const escrowBefore = decimal(balanceValue(treasuryBefore, 'escrow'), 'TREASURY.before.escrow');
  const escrowAfter = decimal(balanceValue(treasuryAfter, 'escrow'), 'TREASURY.after.escrow');
  if (escrowBefore !== '0' || escrowAfter !== '0') fail('WEB_V8_FINALIZED_ESCROW_MISMATCH', 'Market escrow must be zero before and after the atomic action.');
  for (const field of ['gross_escrowed_atomic', 'gross_released_atomic']) {
    const prior = decimal(scalar(treasuryBefore, field, camel(field)), `TREASURY.before.${field}`);
    const next = decimal(scalar(treasuryAfter, field, camel(field)), `TREASURY.after.${field}`);
    const expectedNext = action.kind === 'PURCHASE' ? plus(prior, quote.grossAtomic) : prior;
    if (next !== expectedNext) fail('WEB_V8_FINALIZED_TREASURY_DELTA_MISMATCH', `Actual MarketTreasury ${field} delta is invalid.`);
  }
}

function camel(value) { return value.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()); }

function listingCustody(fields) { return struct(scalar(fields, 'custody')); }

function assertListing(roles, action, descriptor, terminal, marketClient) {
  const object = roles.get('LISTING');
  const after = parsed(roles, 'LISTING', 'after');
  const before = action.kind === 'LIST' ? null : parsed(roles, 'LISTING', 'before');
  const pre = descriptor.preState;
  const quote = pre.quote;
  const expectedStatus = String(action.kind === 'LIST' ? 0 : action.kind === 'PURCHASE' ? 1 : action.kind === 'CANCEL' ? 2 : 3);
  const expectedType = action.lane === 'MAKER' ? marketClient.types.makerListing
    : action.lane === 'SOUL' ? marketClient.types.soulListing : marketClient.types.physicalListing;
  if (normalizeType(object.type, 'LISTING.type') !== normalizeType(expectedType, 'expected listing type')
    || object.change !== (action.kind === 'LIST' ? 'CREATED' : 'CHANGED')
    || decimal(scalar(after, 'status'), 'LISTING.status') !== expectedStatus
    || decimal(scalar(after, 'revision'), 'LISTING.revision') !== (action.kind === 'LIST' ? '0' : plus(decimal(scalar(before, 'revision'), 'LISTING.before.revision'), '1'))
    || id(scalar(after, 'registry_id', 'registryId'), 'LISTING.registryId') !== descriptor.registryId
    || id(scalar(after, 'treasury_id', 'treasuryId'), 'LISTING.treasuryId') !== descriptor.treasuryId
    || id(scalar(after, 'terminal_recipient', 'terminalRecipient'), 'LISTING.terminalRecipient', true)
      !== (action.kind === 'LIST' ? ZERO : action.kind === 'PURCHASE' ? descriptor.sender : pre.seller)
    || decimal(scalar(after, 'gross_atomic', 'grossAtomic'), 'LISTING.grossAtomic') !== quote.grossAtomic
    || commitment(scalar(after, 'quote_commitment', 'quoteCommitment'), 'LISTING.quoteCommitment') !== quote.commitment
    || object.objectId !== terminal.fields.listingId) {
    fail('WEB_V8_FINALIZED_LISTING_TRANSITION_MISMATCH', 'Listing history is not the exact action transition.');
  }
  if (before && (decimal(scalar(before, 'status'), 'LISTING.before.status') !== '0'
    || id(scalar(before, 'terminal_recipient', 'terminalRecipient'), 'LISTING.before.terminalRecipient', true) !== ZERO
    || id(scalar(before, 'registry_id', 'registryId'), 'LISTING.before.registryId') !== descriptor.registryId
    || id(scalar(before, 'treasury_id', 'treasuryId'), 'LISTING.before.treasuryId') !== descriptor.treasuryId
    || decimal(scalar(before, 'gross_atomic', 'grossAtomic'), 'LISTING.before.grossAtomic') !== quote.grossAtomic
    || commitment(scalar(before, 'quote_commitment', 'quoteCommitment'), 'LISTING.before.quoteCommitment') !== quote.commitment)) {
    fail('WEB_V8_FINALIZED_LISTING_TRANSITION_MISMATCH', 'Listing input history is not the exact open state.');
  }
  const custody = action.lane === 'MAKER' ? after : listingCustody(after);
  const seller = action.lane === 'MAKER' ? scalar(after, 'seller') : scalar(custody, 'seller', 'holder');
  const epoch = action.lane === 'MAKER' ? scalar(after, 'expected_control_epoch', 'expectedControlEpoch')
    : scalar(custody, action.lane === 'SOUL' ? 'expected_soul_ownership_epoch' : 'ownership_epoch', action.lane === 'SOUL' ? 'expectedSoulOwnershipEpoch' : 'ownershipEpoch');
  if (id(seller, 'LISTING.seller') !== pre.seller || decimal(epoch, 'LISTING.ownershipEpoch') !== pre.ownershipEpoch) {
    fail('WEB_V8_FINALIZED_LISTING_CUSTODY_MISMATCH', 'Listing seller or custody epoch differs from the durable asset state.');
  }
  return custody;
}

function assertRootAndAdmin(roles, action, descriptor) {
  const rootBefore = parsed(roles, 'ROOT', 'before');
  const rootAfter = parsed(roles, 'ROOT', 'after');
  const beforeOwner = id(scalar(rootBefore, 'owner'), 'ROOT.before.owner');
  const beforeAdmin = id(scalar(rootBefore, 'admin_cap_id', 'adminCapId'), 'ROOT.before.adminCapId');
  const beforeEpoch = decimal(scalar(rootBefore, 'control_epoch', 'controlEpoch'), 'ROOT.before.controlEpoch');
  const beforeContentCommitment = commitment(
    scalar(rootBefore, 'content_commitment', 'contentCommitment'),
    'ROOT.before.contentCommitment',
  );
  const purchase = action.id === 'purchaseMakerControl';
  const makerLane = action.lane === 'MAKER';
  const expectedOwner = purchase ? descriptor.sender : beforeOwner;
  const afterOwner = id(scalar(rootAfter, 'owner'), 'ROOT.after.owner');
  const afterAdmin = id(scalar(rootAfter, 'admin_cap_id', 'adminCapId'), 'ROOT.after.adminCapId');
  const afterEpoch = decimal(scalar(rootAfter, 'control_epoch', 'controlEpoch'), 'ROOT.after.controlEpoch');
  const afterContentCommitment = commitment(
    scalar(rootAfter, 'content_commitment', 'contentCommitment'),
    'ROOT.after.contentCommitment',
  );
  if ((makerLane && (beforeOwner !== descriptor.preState.root.owner
      || beforeAdmin !== descriptor.preState.root.adminCapId
      || beforeEpoch !== descriptor.preState.root.controlEpoch))
    || (!makerLane && stableJson(rootBefore) !== stableJson(rootAfter))
    || beforeContentCommitment !== descriptor.rootContentCommitment
    || afterContentCommitment !== descriptor.rootContentCommitment
    || afterOwner !== expectedOwner
    || afterEpoch !== (purchase ? plus(beforeEpoch, '1') : beforeEpoch)
    || (purchase ? afterAdmin === beforeAdmin : afterAdmin !== beforeAdmin)) {
    fail('WEB_V8_FINALIZED_ROOT_ROTATION_MISMATCH', 'Root owner/AdminCap/control epoch transition is invalid.');
  }
  const admin = roles.get('ADMIN');
  if (action.lane === 'MAKER') {
    if (!admin || admin.objectId !== beforeAdmin) fail('WEB_V8_FINALIZED_ADMIN_ROTATION_MISMATCH', 'Maker action lacks the exact prior AdminCap.');
    if (purchase) {
      const next = roles.get('ADMIN_NEW');
      const oldFields = parsed(roles, 'ADMIN', 'before');
      const newFields = parsed(roles, 'ADMIN_NEW', 'after');
      if (admin.change !== 'DELETED' || next?.change !== 'CREATED' || next.objectId !== afterAdmin
        || id(scalar(oldFields, 'root_id', 'rootId'), 'ADMIN.rootId') !== descriptor.rootId
        || id(scalar(oldFields, 'owner'), 'ADMIN.owner') !== descriptor.preState.seller
        || decimal(scalar(oldFields, 'control_epoch', 'controlEpoch'), 'ADMIN.controlEpoch') !== beforeEpoch
        || custodyOwnerId(admin.before.owner, roles.get('LISTING').objectId, 'ADMIN.before.effectsOwner', true) !== roles.get('LISTING').objectId
        || id(scalar(newFields, 'root_id', 'rootId'), 'ADMIN_NEW.rootId') !== descriptor.rootId
        || id(scalar(newFields, 'owner'), 'ADMIN_NEW.owner') !== descriptor.sender
        || decimal(scalar(newFields, 'control_epoch', 'controlEpoch'), 'ADMIN_NEW.controlEpoch') !== afterEpoch
        || ownerId(next.after.owner, 'AddressOwner', 'ADMIN_NEW.effectsOwner') !== descriptor.sender) {
        fail('WEB_V8_FINALIZED_ADMIN_ROTATION_MISMATCH', 'Maker purchase did not delete and recreate the exact AdminCap at N+1.');
      }
    } else {
      const beforeFields = parsed(roles, 'ADMIN', 'before');
      const fields = parsed(roles, 'ADMIN', 'after');
      const expectedOwner = action.kind === 'LIST' ? roles.get('LISTING').objectId : descriptor.preState.seller;
      const priorOwner = action.kind === 'LIST' ? descriptor.preState.seller : roles.get('LISTING').objectId;
      const observedOwner = custodyOwnerId(
        admin.after.owner,
        expectedOwner,
        'ADMIN.effectsOwner',
        action.kind === 'LIST',
      );
      if (observedOwner !== expectedOwner
        || custodyOwnerId(admin.before.owner, priorOwner, 'ADMIN.before.effectsOwner', action.kind !== 'LIST') !== priorOwner
        || id(scalar(beforeFields, 'root_id', 'rootId'), 'ADMIN.before.rootId') !== descriptor.rootId
        || id(scalar(beforeFields, 'owner'), 'ADMIN.before.owner') !== descriptor.preState.seller
        || decimal(scalar(beforeFields, 'control_epoch', 'controlEpoch'), 'ADMIN.before.controlEpoch') !== beforeEpoch
        || id(scalar(fields, 'owner'), 'ADMIN.owner') !== descriptor.preState.seller
        || decimal(scalar(fields, 'control_epoch', 'controlEpoch'), 'ADMIN.controlEpoch') !== beforeEpoch) {
        fail('WEB_V8_FINALIZED_ADMIN_CUSTODY_MISMATCH', 'Maker AdminCap custody transition is invalid.');
      }
    }
  }
  return { beforeOwner, beforeAdmin, beforeEpoch, afterOwner, afterAdmin, afterEpoch };
}

function assertSoul(roles, action, descriptor, custody) {
  if (action.lane !== 'SOUL') return;
  const listingId = roles.get('LISTING').objectId;
  const terminalOwner = action.kind === 'LIST' ? listingId : action.kind === 'PURCHASE' ? descriptor.sender : descriptor.preState.seller;
  const terminalEpoch = action.kind === 'PURCHASE' ? plus(descriptor.preState.ownershipEpoch, '1') : descriptor.preState.ownershipEpoch;
  const expected = [
    ['OUTPUT', descriptor.preState.assetIds[0]], ['RECEIPT', descriptor.preState.assetIds[1]], ['SOUL', descriptor.preState.assetIds[2]],
  ];
  for (const [role, objectId] of expected) {
    const object = roles.get(role);
    const before = parsed(roles, role, 'before');
    const after = parsed(roles, role, 'after');
    const priorOwner = action.kind === 'LIST' ? descriptor.preState.seller : listingId;
    if (object.objectId !== objectId
      || custodyOwnerId(object.after.owner, terminalOwner, `${role}.effectsOwner`, action.kind === 'LIST') !== terminalOwner
      || custodyOwnerId(object.before.owner, priorOwner, `${role}.before.effectsOwner`, action.kind !== 'LIST') !== priorOwner
      || id(scalar(before, 'holder'), `${role}.before.holder`) !== descriptor.preState.seller
      || id(scalar(after, 'holder'), `${role}.holder`) !== (action.kind === 'LIST' ? descriptor.preState.seller : terminalOwner)) {
      fail('WEB_V8_FINALIZED_SOUL_BUNDLE_MISMATCH', `${role} custody/holder transition is invalid.`);
    }
    const mutableFields = role === 'SOUL'
      ? ['holder', 'ownership_epoch', 'soul_commitment']
      : ['holder'];
    same(
      withoutFields(before, mutableFields),
      withoutFields(after, mutableFields),
      'WEB_V8_FINALIZED_SOUL_BUNDLE_MISMATCH',
      `${role} immutable content changed during Market custody.`,
    );
  }
  const outputBefore = parsed(roles, 'OUTPUT', 'before');
  const output = parsed(roles, 'OUTPUT', 'after');
  const receiptBefore = parsed(roles, 'RECEIPT', 'before');
  const receipt = parsed(roles, 'RECEIPT', 'after');
  const soul = parsed(roles, 'SOUL', 'after');
  const soulBefore = parsed(roles, 'SOUL', 'before');
  const oldSoulCommitment = descriptor.preState.soul.soulCommitment;
  const observedSoulBefore = commitment(
    scalar(soulBefore, 'soul_commitment', 'soulCommitment'),
    'SOUL.before.commitment',
  );
  const observedSoulAfter = commitment(
    scalar(soul, 'soul_commitment', 'soulCommitment'),
    'SOUL.commitment',
  );
  const expectedSoulAfter = action.kind === 'PURCHASE'
    ? deriveSoulCommitment(soul)
    : oldSoulCommitment;
  if (id(scalar(receipt, 'output_id', 'outputId'), 'RECEIPT.outputId') !== descriptor.preState.assetIds[0]
    || id(scalar(soul, 'output_id', 'outputId'), 'SOUL.outputId') !== descriptor.preState.assetIds[0]
    || id(scalar(soul, 'receipt_id', 'receiptId'), 'SOUL.receiptId') !== descriptor.preState.assetIds[1]
    || decimal(scalar(soulBefore, 'ownership_epoch', 'ownershipEpoch'), 'SOUL.before.ownershipEpoch') !== descriptor.preState.ownershipEpoch
    || decimal(scalar(soul, 'ownership_epoch', 'ownershipEpoch'), 'SOUL.ownershipEpoch') !== terminalEpoch
    || observedSoulBefore !== oldSoulCommitment
    || observedSoulAfter !== expectedSoulAfter
    || (action.kind === 'PURCHASE' && observedSoulAfter === oldSoulCommitment)
    || commitment(scalar(outputBefore, 'output_commitment', 'outputCommitment'), 'OUTPUT.before.commitment') !== descriptor.preState.soul.outputCommitment
    || commitment(scalar(output, 'output_commitment', 'outputCommitment'), 'OUTPUT.commitment') !== descriptor.preState.soul.outputCommitment
    || commitment(scalar(receiptBefore, 'receipt_commitment', 'receiptCommitment'), 'RECEIPT.before.commitment') !== descriptor.preState.soul.receiptCommitment
    || commitment(scalar(receipt, 'receipt_commitment', 'receiptCommitment'), 'RECEIPT.commitment') !== descriptor.preState.soul.receiptCommitment
  ) {
    fail('WEB_V8_FINALIZED_SOUL_BUNDLE_MISMATCH', 'Output/Receipt/Soul IDs, commitments, or epoch are inconsistent.');
  }
  const custodyFields = struct(custody);
  for (const [field, expectedValue] of [
    ['output_id', descriptor.preState.assetIds[0]], ['receipt_id', descriptor.preState.assetIds[1]], ['soul_id', descriptor.preState.assetIds[2]],
  ]) if (id(scalar(custodyFields, field, camel(field)), `LISTING.custody.${field}`) !== expectedValue) {
    fail('WEB_V8_FINALIZED_SOUL_BUNDLE_MISMATCH', 'Soul listing custody IDs are inconsistent.');
  }
  for (const [field, expectedValue] of [
    ['output_commitment', descriptor.preState.soul.outputCommitment],
    ['receipt_commitment', descriptor.preState.soul.receiptCommitment],
    ['soul_commitment', oldSoulCommitment],
  ]) if (commitment(scalar(custodyFields, field, camel(field)), `LISTING.custody.${field}`) !== expectedValue) {
    fail('WEB_V8_FINALIZED_SOUL_BUNDLE_MISMATCH', 'Soul listing custody commitment snapshot changed after listing.');
  }
  if (action.id === 'purchaseSoulBundle') {
    for (const [role, keyId] of [
      ['OUTPUT_RECORD', descriptor.preState.assetIds[0]],
      ['SOUL_RECORD', descriptor.preState.assetIds[2]],
    ]) {
      const beforeField = parsed(roles, role, 'before');
      const afterField = parsed(roles, role, 'after');
      const beforeRecord = struct(scalar(beforeField, 'value'));
      const record = struct(scalar(afterField, 'value'));
      if (id(scalar(beforeField, 'name'), `${role}.before.name`) !== keyId
        || id(scalar(afterField, 'name'), `${role}.after.name`) !== keyId
        || id(scalar(beforeRecord, 'holder'), `${role}.before.holder`) !== descriptor.preState.seller
        || id(scalar(record, 'holder'), `${role}.after.holder`) !== descriptor.sender
        || id(scalar(beforeRecord, 'output_id', 'outputId'), `${role}.before.outputId`) !== descriptor.preState.assetIds[0]
        || id(scalar(record, 'output_id', 'outputId'), `${role}.after.outputId`) !== descriptor.preState.assetIds[0]
        || id(scalar(beforeRecord, 'receipt_id', 'receiptId'), `${role}.before.receiptId`) !== descriptor.preState.assetIds[1]
        || id(scalar(record, 'receipt_id', 'receiptId'), `${role}.after.receiptId`) !== descriptor.preState.assetIds[1]
        || id(scalar(beforeRecord, 'soul_id', 'soulId'), `${role}.before.soulId`) !== descriptor.preState.assetIds[2]
        || id(scalar(record, 'soul_id', 'soulId'), `${role}.after.soulId`) !== descriptor.preState.assetIds[2]) {
        fail('WEB_V8_FINALIZED_SOUL_RECORD_MISMATCH', `${role} key, bundle IDs, or holder transition is invalid.`);
      }
      const mutableFields = role === 'OUTPUT_RECORD'
        ? ['holder']
        : ['holder', 'ownership_epoch', 'soul_commitment'];
      same(
        withoutFields(beforeRecord, mutableFields),
        withoutFields(record, mutableFields),
        'WEB_V8_FINALIZED_SOUL_RECORD_MISMATCH',
        `${role} immutable record content changed.`,
      );
      if (role === 'OUTPUT_RECORD') {
        if (commitment(scalar(beforeRecord, 'output_commitment', 'outputCommitment'), `${role}.before.outputCommitment`) !== descriptor.preState.soul.outputCommitment
          || commitment(scalar(record, 'output_commitment', 'outputCommitment'), `${role}.after.outputCommitment`) !== descriptor.preState.soul.outputCommitment
          || commitment(scalar(beforeRecord, 'receipt_commitment', 'receiptCommitment'), `${role}.before.receiptCommitment`) !== descriptor.preState.soul.receiptCommitment
          || commitment(scalar(record, 'receipt_commitment', 'receiptCommitment'), `${role}.after.receiptCommitment`) !== descriptor.preState.soul.receiptCommitment) {
          fail('WEB_V8_FINALIZED_SOUL_RECORD_MISMATCH', 'OutputRecord commitments changed during Soul purchase.');
        }
      } else if (decimal(scalar(beforeRecord, 'ownership_epoch', 'ownershipEpoch'), `${role}.before.ownershipEpoch`) !== descriptor.preState.ownershipEpoch
        || decimal(scalar(record, 'ownership_epoch', 'ownershipEpoch'), `${role}.after.ownershipEpoch`) !== terminalEpoch
        || commitment(scalar(beforeRecord, 'soul_commitment', 'soulCommitment'), `${role}.before.soulCommitment`) !== oldSoulCommitment
        || commitment(scalar(record, 'soul_commitment', 'soulCommitment'), `${role}.after.soulCommitment`) !== observedSoulAfter) {
        fail('WEB_V8_FINALIZED_SOUL_RECORD_MISMATCH', 'SoulRecord does not match the exact recomputed Soul transition.');
      }
    }
  }
}

function assertPhysical(roles, action, descriptor, custody) {
  if (!action.lanes.some((lane) => lane.startsWith('PHYSICAL_'))) return;
  const expected = descriptor.preState.physical;
  const asset = roles.get('ASSET');
  const beforeFields = parsed(roles, 'ASSET', 'before');
  const fields = parsed(roles, 'ASSET', 'after');
  const listingId = roles.get('LISTING').objectId;
  const expectedOwner = action.kind === 'LIST' ? listingId : action.kind === 'PURCHASE' ? descriptor.sender : descriptor.preState.seller;
  const expectedHolder = action.kind === 'LIST' ? descriptor.preState.seller : expectedOwner;
  const expectedEpoch = action.kind === 'PURCHASE' ? plus(descriptor.preState.ownershipEpoch, '1') : descriptor.preState.ownershipEpoch;
  const expectedSourceKind = descriptor.lane === 2 ? '0' : '1';
  const assetTreasury = option(scalar(fields, 'source_treasury_id', 'sourceTreasuryId'), 'ASSET.sourceTreasuryId');
  const beforeTreasury = option(scalar(beforeFields, 'source_treasury_id', 'sourceTreasuryId'), 'ASSET.before.sourceTreasuryId');
  const priorOwner = action.kind === 'LIST' ? descriptor.preState.seller : listingId;
  if (asset.objectId !== descriptor.preState.assetIds[0]
    || custodyOwnerId(asset.after.owner, expectedOwner, 'ASSET.effectsOwner', action.kind === 'LIST') !== expectedOwner
    || custodyOwnerId(asset.before.owner, priorOwner, 'ASSET.before.effectsOwner', action.kind !== 'LIST') !== priorOwner
    || id(scalar(beforeFields, 'holder'), 'ASSET.before.holder') !== descriptor.preState.seller
    || decimal(scalar(beforeFields, 'ownership_epoch', 'ownershipEpoch'), 'ASSET.before.ownershipEpoch') !== descriptor.preState.ownershipEpoch
    || id(scalar(fields, 'holder'), 'ASSET.holder') !== expectedHolder
    || decimal(scalar(fields, 'ownership_epoch', 'ownershipEpoch'), 'ASSET.ownershipEpoch') !== expectedEpoch
    || decimal(scalar(fields, 'source_kind', 'sourceKind'), 'ASSET.sourceKind') !== expectedSourceKind
    || decimal(scalar(beforeFields, 'source_kind', 'sourceKind'), 'ASSET.before.sourceKind') !== expectedSourceKind
    || assetTreasury !== (expectedSourceKind === '0' ? null : expected.sourceTreasuryId)
    || beforeTreasury !== (expectedSourceKind === '0' ? null : expected.sourceTreasuryId)
    || id(scalar(beforeFields, 'source_id', 'sourceId'), 'ASSET.before.sourceId') !== expected.sourceId
    || String(scalar(beforeFields, 'source_semantic_id', 'sourceSemanticId')) !== expected.sourceSemanticId
    || commitment(scalar(beforeFields, 'asset_content_commitment', 'assetContentCommitment'), 'ASSET.before.assetContent') !== expected.assetContentCommitment
    || commitment(scalar(beforeFields, 'source_content_commitment', 'sourceContentCommitment'), 'ASSET.before.sourceContent') !== expected.sourceContentCommitment
    || commitment(scalar(beforeFields, 'provenance_commitment', 'provenanceCommitment'), 'ASSET.before.provenance') !== expected.provenanceCommitment
    || scalar(beforeFields, 'transferable') !== expected.transferable
    || id(scalar(fields, 'source_id', 'sourceId'), 'ASSET.sourceId') !== expected.sourceId
    || String(scalar(fields, 'source_semantic_id', 'sourceSemanticId')) !== expected.sourceSemanticId
    || commitment(scalar(fields, 'asset_content_commitment', 'assetContentCommitment'), 'ASSET.assetContent') !== expected.assetContentCommitment
    || commitment(scalar(fields, 'source_content_commitment', 'sourceContentCommitment'), 'ASSET.sourceContent') !== expected.sourceContentCommitment
    || commitment(scalar(fields, 'provenance_commitment', 'provenanceCommitment'), 'ASSET.provenance') !== expected.provenanceCommitment
    || scalar(fields, 'transferable') !== expected.transferable) {
    fail('WEB_V8_FINALIZED_PHYSICAL_MISMATCH', 'Physical source, provenance, content, transferability, holder, or epoch is invalid.');
  }
  const binding = struct(custody);
  if (decimal(scalar(binding, 'source_kind', 'sourceKind'), 'LISTING.custody.sourceKind') !== expectedSourceKind
    || id(scalar(binding, 'source_treasury_id', 'sourceTreasuryId'), 'LISTING.custody.sourceTreasuryId') !== expected.sourceTreasuryId
    || id(scalar(binding, 'source_id', 'sourceId'), 'LISTING.custody.sourceId') !== expected.sourceId
    || String(scalar(binding, 'source_semantic_id', 'sourceSemanticId')) !== expected.sourceSemanticId
    || commitment(scalar(binding, 'asset_content_commitment', 'assetContentCommitment'), 'LISTING.custody.assetContent') !== expected.assetContentCommitment
    || commitment(scalar(binding, 'source_content_commitment', 'sourceContentCommitment'), 'LISTING.custody.sourceContent') !== expected.sourceContentCommitment
    || commitment(scalar(binding, 'provenance_commitment', 'provenanceCommitment'), 'LISTING.custody.provenance') !== expected.provenanceCommitment
    || scalar(binding, 'transferable') !== expected.transferable) {
    fail('WEB_V8_FINALIZED_PHYSICAL_MISMATCH', 'Physical listing custody differs from the actual asset evidence.');
  }
}

function revenueState(object, side, role) {
  const fields = parsed(new Map([[role, object]]), role, side);
  const revenue = struct(fields.revenue ?? fields.balance);
  return {
    balance: decimal(scalar(revenue, 'value') ?? scalar(fields, 'revenue', 'balance'), `${role}.${side}.balance`),
    totalCollected: decimal(scalar(fields, 'total_collected', 'totalCollected'), `${role}.${side}.totalCollected`),
    totalWithdrawn: decimal(scalar(fields, 'total_withdrawn', 'totalWithdrawn'), `${role}.${side}.totalWithdrawn`),
  };
}

function assertRevenueAndPayouts(roles, action, descriptor, marketClient) {
  const quote = descriptor.preState.quote;
  for (const [role, delta] of [
    ['PROTOCOL_TREASURY', quote.protocolAtomic],
    ['MAKER_TREASURY', quote.sourceAtomic],
    ['PACK_TREASURY', quote.sourceAtomic],
  ]) {
    const object = roles.get(role);
    if (!object) continue;
    const before = revenueState(object, 'before', role);
    const after = revenueState(object, 'after', role);
    const expectedDelta = action.kind === 'PURCHASE' ? delta : '0';
    if (after.balance !== plus(before.balance, expectedDelta)
      || after.totalCollected !== plus(before.totalCollected, expectedDelta)
      || after.totalWithdrawn !== before.totalWithdrawn) {
      fail('WEB_V8_FINALIZED_REVENUE_DELTA_MISMATCH', `${role} actual balance/collected/withdrawn delta is invalid.`);
    }
    same(object.revenue.before, { ...before, integerWidth: role === 'PACK_TREASURY' ? 64 : 128 }, 'WEB_V8_FINALIZED_REVENUE_SUMMARY_MISMATCH', `${role} before revenue summary differs from historical content.`);
    same(object.revenue.after, { ...after, integerWidth: role === 'PACK_TREASURY' ? 64 : 128 }, 'WEB_V8_FINALIZED_REVENUE_SUMMARY_MISMATCH', `${role} after revenue summary differs from historical content.`);
  }
  if (action.kind !== 'PURCHASE') return;
  for (const [role, owner, amount] of [
    ['CREATOR_COIN', descriptor.preState.root.creator, quote.creatorAtomic],
    ['SELLER_COIN', descriptor.preState.seller, quote.sellerAtomic],
  ]) {
    const object = roles.get(role);
    if (amount === '0') {
      if (object) fail('WEB_V8_FINALIZED_PAYOUT_MISMATCH', `${role} must not survive for a zero payout.`);
      continue;
    }
    if (!object) fail('WEB_V8_FINALIZED_PAYOUT_MISMATCH', `${role} exact Coin output is missing.`);
    const fields = parsed(roles, role, 'after');
    const balance = decimal(scalar(fields, 'balance'), `${role}.balance`);
    if (object.change !== 'CREATED'
      || normalizeType(object.type, `${role}.type`) !== normalizeType(marketClient.types.paymentCoin, 'payment coin type')
      || ownerId(object.after.owner, 'AddressOwner', `${role}.owner`) !== owner || balance !== amount) {
      fail('WEB_V8_FINALIZED_PAYOUT_MISMATCH', `${role} exact Coin output is invalid.`);
    }
  }
}

function assertEvents(value, action, descriptor, marketClient, marketModule, roles, rootState) {
  if (!Array.isArray(value.events) || !value.events.length) fail('WEB_V8_FINALIZED_EVENT_MISSING', 'Complete Core V2 events are required.');
  const marketEmitterPackageId = id(descriptor.target.split('::')[0], 'descriptor.target.packageId');
  const normalized = value.events.map((event, index) => {
    exactKeys(event, ['id', 'packageId', 'transactionModule', 'sender', 'type', 'parsedJson', 'bcs', 'eventsDigest'], `events[${index}]`);
    exactKeys(event.id, ['txDigest', 'eventSeq'], `events[${index}].id`);
    if (event.id.txDigest !== value.digest || decimal(event.id.eventSeq, `events[${index}].eventSeq`) !== String(index)
      || event.eventsDigest !== value.eventsDigest
      || id(event.packageId, `events[${index}].packageId`) !== marketEmitterPackageId
      || event.transactionModule !== 'market_v8'
      || !plain(event.parsedJson)) {
      fail('WEB_V8_FINALIZED_EVENT_EVIDENCE_MISMATCH', `events[${index}] is not exact contiguous Core V2 evidence.`);
    }
    bytes(event.bcs, `events[${index}].bcs`);
    return { event, parsed: (() => { try { return marketClient.parseEvent(event); } catch { return null; } })() };
  });
  const expectedKind = action.kind === 'LIST' ? 'MarketListingOpenedV8'
    : action.kind === 'PURCHASE' ? 'MarketListingSettledV8' : 'MarketListingClosedV8';
  const terminal = normalized.filter(({ parsed }) => parsed?.kind === expectedKind);
  if (terminal.length !== 1 || stableJson(terminal[0].event) !== stableJson(value.event)) {
    fail('WEB_V8_FINALIZED_EVENT_MISMATCH', 'The exact terminal Market event is not unique or selected exactly.');
  }
  const fields = terminal[0].parsed.fields;
  const expectedCount = action.id === 'purchaseMakerControl' || action.lanes.some((lane) => lane.startsWith('PHYSICAL_')) ? 2 : 1;
  if (value.events.length !== expectedCount || terminal[0].event.sender !== descriptor.sender
    || fields.registryId !== descriptor.registryId
    || fields.lane !== descriptor.lane || fields.assetId !== descriptor.preState.assetIds.at(-1)
    || fields.seller !== descriptor.preState.seller) {
    fail('WEB_V8_FINALIZED_EVENT_MISMATCH', 'Terminal event fields or complete event count differ from the action.');
  }
  if (action.kind === 'LIST') {
    if (fields.rootId !== descriptor.rootId || fields.ownershipEpoch.toString() !== descriptor.preState.ownershipEpoch
      || fields.grossAtomic.toString() !== descriptor.preState.quote.grossAtomic
      || fields.quoteCommitment !== descriptor.preState.quote.commitment) fail('WEB_V8_FINALIZED_EVENT_MISMATCH', 'Opened event fields are invalid.');
  } else if (action.kind === 'PURCHASE') {
    if (fields.buyer !== descriptor.sender) fail('WEB_V8_FINALIZED_EVENT_MISMATCH', 'Settled buyer differs from the transaction sender.');
    for (const field of ['grossAtomic', 'protocolAtomic', 'creatorAtomic', 'sourceAtomic', 'sellerAtomic']) {
      if (fields[field].toString() !== descriptor.preState.quote[field]) fail('WEB_V8_FINALIZED_EVENT_MISMATCH', `Settled ${field} is invalid.`);
    }
  } else if (fields.recovered !== (action.kind === 'RECOVER')) {
    fail('WEB_V8_FINALIZED_EVENT_MISMATCH', 'Closed recovered flag differs from the exact action.');
  }
  const makerTransferType = normalizeType(`${marketClient.runtime.typeOrigins.corePackageId}::maker_v8::MakerControlTransferredV8`, 'Maker transfer type');
  const makerTransfers = normalized.filter(({ event }) => normalizeType(event.type, 'event.type') === makerTransferType);
  if (action.id === 'purchaseMakerControl') {
    if (makerTransfers.length !== 1) fail('WEB_V8_FINALIZED_COMPANION_EVENT_MISMATCH', 'Maker purchase requires one control-transfer event.');
    const event = makerTransfers[0].event;
    const f = event.parsedJson;
    if (event.sender !== descriptor.sender || id(scalar(f, 'root_id', 'rootId'), 'MakerTransfer.rootId') !== descriptor.rootId
      || id(scalar(f, 'previous_owner', 'previousOwner'), 'MakerTransfer.previousOwner') !== rootState.beforeOwner
      || id(scalar(f, 'new_owner', 'newOwner'), 'MakerTransfer.newOwner') !== rootState.afterOwner
      || decimal(scalar(f, 'previous_control_epoch', 'previousControlEpoch'), 'MakerTransfer.previousEpoch') !== rootState.beforeEpoch
      || decimal(scalar(f, 'new_control_epoch', 'newControlEpoch'), 'MakerTransfer.newEpoch') !== rootState.afterEpoch
      || id(scalar(f, 'new_admin_cap_id', 'newAdminCapId'), 'MakerTransfer.adminCapId') !== rootState.afterAdmin) {
      fail('WEB_V8_FINALIZED_COMPANION_EVENT_MISMATCH', 'Maker control-transfer event differs from Root/Admin effects.');
    }
  } else if (makerTransfers.length) fail('WEB_V8_FINALIZED_COMPANION_EVENT_MISMATCH', 'Unexpected Maker control-transfer event.');

  const physicalType = normalizeType(`${marketClient.runtime.typeOrigins.physicalPackageId}::physical_v8::PhysicalMarketCustodyTransitionV8`, 'Physical transition type');
  const physicalEvents = normalized.filter(({ event }) => normalizeType(event.type, 'event.type') === physicalType);
  const physical = action.lanes.some((lane) => lane.startsWith('PHYSICAL_'));
  if (physical !== (physicalEvents.length === 1)) fail('WEB_V8_FINALIZED_COMPANION_EVENT_MISMATCH', 'Physical companion event cardinality is invalid.');
  if (physical) {
    const f = physicalEvents[0].event.parsedJson;
    const expectedEpoch = action.kind === 'PURCHASE' ? plus(descriptor.preState.ownershipEpoch, '1') : descriptor.preState.ownershipEpoch;
    const expectedHolder = action.kind === 'PURCHASE' ? descriptor.sender : descriptor.preState.seller;
    if (physicalEvents[0].event.sender !== descriptor.sender
      || decimal(scalar(f, 'action'), 'PhysicalEvent.action') !== (action.kind === 'LIST' ? '0' : action.kind === 'PURCHASE' ? '2' : '1')
      || id(scalar(f, 'listing_id', 'listingId'), 'PhysicalEvent.listingId') !== fields.listingId
      || id(scalar(f, 'asset_id', 'assetId'), 'PhysicalEvent.assetId') !== descriptor.preState.assetIds[0]
      || decimal(scalar(f, 'source_kind', 'sourceKind'), 'PhysicalEvent.sourceKind') !== descriptor.preState.physical.sourceKind
      || id(scalar(f, 'source_treasury_id', 'sourceTreasuryId'), 'PhysicalEvent.sourceTreasuryId') !== descriptor.preState.physical.sourceTreasuryId
      || id(scalar(f, 'previous_holder', 'previousHolder'), 'PhysicalEvent.previousHolder') !== descriptor.preState.seller
      || id(scalar(f, 'holder'), 'PhysicalEvent.holder') !== expectedHolder
      || decimal(scalar(f, 'previous_ownership_epoch', 'previousOwnershipEpoch'), 'PhysicalEvent.previousEpoch') !== descriptor.preState.ownershipEpoch
      || decimal(scalar(f, 'ownership_epoch', 'ownershipEpoch'), 'PhysicalEvent.epoch') !== expectedEpoch
      || commitment(scalar(f, 'provenance_commitment', 'provenanceCommitment'), 'PhysicalEvent.provenance') !== descriptor.preState.physical.provenanceCommitment) {
      fail('WEB_V8_FINALIZED_COMPANION_EVENT_MISMATCH', 'Physical companion event differs from custody effects.');
    }
  }
  return terminal[0].parsed;
}

/** Verify the exact browser-normalized Core V2 finalized Market envelope. */
export function assertFinalizedMarketReadbackV8(value, request, marketClient, marketModule) {
  exactKeys(value, [
    'schemaVersion', 'source', 'digest', 'epoch', 'effectsFingerprint',
    'eventsDigest', 'planHash', 'identity', 'transaction', 'event', 'events', 'effects',
  ], 'Finalized Market readback');
  const planHash = canonicalPlanHash(request);
  if (value.schemaVersion !== WEB_V8_READBACK_SCHEMA || value.source !== 'FINALIZED_CORE_V2'
    || digest(value.digest, 'readback.digest') !== request.digest
    || hash(value.planHash, 'readback.planHash') !== planHash
    || stableJson(value.identity) !== stableJson(request.identity)) {
    fail('WEB_V8_FINALIZED_ENVELOPE_MISMATCH', 'Finalized envelope schema, source, digest, planHash, or identity is invalid.');
  }
  const epoch = decimal(value.epoch, 'readback.epoch');
  const effectsFingerprint = hash(value.effectsFingerprint, 'readback.effectsFingerprint');
  const eventsDigest = digest(value.eventsDigest, 'readback.eventsDigest');
  if (epoch !== decimal(request.outcome?.epoch, 'outcome.epoch')
    || effectsFingerprint !== hash(request.outcome?.effectsFingerprint, 'outcome.effectsFingerprint')
    || eventsDigest !== digest(request.outcome?.eventsDigest, 'outcome.eventsDigest')) {
    fail('WEB_V8_FINALIZED_FINALITY_MISMATCH', 'Epoch/effects/events finality differs from the successful query outcome.');
  }
  if (value.effects.transactionDigest !== value.digest || value.effects.epoch !== epoch
    || value.effects.eventsDigest !== eventsDigest || hex(sha256(bytes(value.effects.bcs, 'effects.bcs'))) !== effectsFingerprint) {
    fail('WEB_V8_FINALIZED_EFFECTS_MISMATCH', 'Core V2 effects BCS or finality fields do not bind the envelope.');
  }
  const action = makerV8ActionV8(request.identity?.action);
  if (!action) fail('WEB_V8_FINALIZED_ACTION_INVALID', 'Recovery identity action is not one of the fourteen exact Market actions.');
  const descriptor = request.plan.sourceSnapshot?.descriptor;
  if (!plain(descriptor) || descriptor.action !== action.id || descriptor.preState?.action !== action.id
    || descriptor.sender !== request.identity.wallet || descriptor.rootId !== request.identity.root?.id
    || descriptor.registryId !== request.identity.registry?.id || descriptor.treasuryId !== request.identity.treasury?.id
    || !action.lanes.map((lane) => marketModule.MARKET_V8_LANES[lane]).includes(descriptor.lane)) {
    fail('WEB_V8_FINALIZED_DESCRIPTOR_MISMATCH', 'Durable Market descriptor differs from the exact recovery identity/action.');
  }
  exactKeys(value.transaction, ['sender', 'status', 'target', 'typeArguments'], 'transaction');
  if (value.transaction.sender !== descriptor.sender || value.transaction.status !== 'SUCCESS'
    || value.transaction.target !== descriptor.target
    || stableJson(value.transaction.typeArguments) !== stableJson(descriptor.typeArguments)) {
    fail('WEB_V8_FINALIZED_TRANSACTION_INPUT_MISMATCH', 'Normalized transaction sender/target/type arguments are invalid.');
  }
  const transactionSnapshot = assertTransactionBytes(value, request, descriptor);
  const evidence = assertEffects(value, value.digest, transactionSnapshot);
  const quote = descriptor.preState.quote;
  assertRoleSet(evidence.roles, descriptor, action, quote);
  const rootState = assertRootAndAdmin(evidence.roles, action, descriptor);
  const terminal = assertEvents(value, action, descriptor, marketClient, marketModule, evidence.roles, rootState);
  if (action.kind !== 'LIST' && terminal.fields.listingId !== request.identity.listing.id) {
    fail('WEB_V8_FINALIZED_EVENT_MISMATCH', 'Terminal event listing differs from the durable recovery identity.');
  }
  const custody = assertListing(evidence.roles, action, descriptor, terminal, marketClient);
  assertRegistryAndTreasury(evidence.roles, action, quote);
  assertSoul(evidence.roles, action, descriptor, custody);
  assertPhysical(evidence.roles, action, descriptor, custody);
  assertRevenueAndPayouts(evidence.roles, action, descriptor, marketClient);
  return Object.freeze({
    verified: true,
    digest: value.digest,
    epoch,
    effectsFingerprint,
    eventsDigest,
    identity: clone(request.identity),
    planHash,
    evidence: Object.freeze(clone({
      schemaVersion: WEB_V8_READBACK_SCHEMA,
      source: value.source,
      transaction: value.transaction,
      event: terminal,
      events: value.events,
      effects: value.effects,
    })),
  });
}
