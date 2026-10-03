import { bcs } from '@mysten/sui/bcs';
import { ObjectError } from '@mysten/sui/client';
import { deriveDynamicFieldID, fromBase64, toBase64, normalizeStructTag } from '@mysten/sui/utils';
import { makerV8StableType } from './maker-v8-runtime.js';

const fail = message => { const error = new Error(message); error.code = 'MAKER_V8_PLAYER_PROTOCOL_NOT_CURRENT'; throw error; };
const check = (value, message) => { if (!value) fail(message); };
const id = value => {
  if (value && typeof value === 'object') return id(value.id ?? value.fields ?? value.bytes);
  check(typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && !/^0x0{64}$/.test(value), 'Protocol authority requires an exact nonzero ID.');
  return value;
};
const integer = value => {
  check(['string', 'bigint', 'number'].includes(typeof value) && /^(0|[1-9][0-9]*)$/.test(String(value))
    && (typeof value !== 'number' || Number.isSafeInteger(value)), 'Protocol revision is invalid.');
  const result = BigInt(value); check(result <= 18446744073709551615n, 'Protocol integer exceeds u64.'); return result;
};
const hash = value => {
  if (Array.isArray(value) || value instanceof Uint8Array) {
    check(value.length === 32 && [...value].every(n => Number.isInteger(n) && n >= 0 && n <= 255), 'Protocol commitment is invalid.');
    return [...value].map(n => n.toString(16).padStart(2, '0')).join('');
  }
  if (typeof value === 'string' && /^(0x)?[a-fA-F0-9]{64}$/.test(value)) return value.replace(/^0x/, '').toLowerCase();
  if (typeof value === 'string' && value.length === 44) {
    try {
      const bytes = fromBase64(value);
      if (bytes.length === 32 && toBase64(bytes) === value) return hash(bytes);
    } catch { /* Reject noncanonical encodings below. */ }
  }
  fail('Protocol commitment is invalid.');
};
const treasuryOption = value => {
  if (value === null || typeof value === 'string') return value;
  if (Array.isArray(value)) {
    check(value.length <= 1, 'Protocol treasury Option cardinality is invalid.');
    return value.length === 1 ? value[0] : null;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 1 && ['id', 'bytes'].includes(keys[0])) return value;
    if (keys.length === 1 && keys[0] === 'fields') return treasuryOption(value.fields);
    if (keys.length === 1 && keys[0] === 'vec' && Array.isArray(value.vec)) return treasuryOption(value.vec);
  }
  fail('Protocol treasury Option is invalid.');
};
const slotSchema = bcs.struct('ProductReleaseCatalogSlotV2', { catalog_id: bcs.Address });

/** New-write eligibility only. Structural attestation and recovery do not use this gate. */
export async function assertMakerV8PlayerProtocolCurrentV8({ client, runtime, objects }) {
  const protocol = objects?.protocolConfig;
  const catalog = objects?.catalog;
  for (const [object, expectedId, module, datatype] of [
    [protocol, runtime.protocolConfigId, 'protocol_config_v8', 'ProtocolConfigV8'],
    [catalog, runtime.catalogId, 'package_binding_v8', 'ProductReleaseCatalogV8'],
  ]) {
    check(object?.owner?.kind === 'SHARED' && id(object.objectId) === expectedId
      && object.type === makerV8StableType(runtime, 'core', module, datatype), 'Protocol or catalog identity is not the exact shared authority.');
    check(object.fields && id(object.fields.id) === expectedId, 'Protocol or catalog UID disagrees.');
  }
  const p = protocol.fields;
  const c = catalog.fields;
  check(integer(p.version) === 8n && integer(c.schema_revision) === 2n && p.enabled === true, 'Protocol is disabled or has an unsupported schema.');
  check(id(p.core_original_package_id) === runtime.roles.core.typeOriginPackageId
    && id(p.core_callable_package_id) === runtime.roles.core.callablePackageId, 'Protocol Core package differs.');
  check(id(c.protocol_config_id) === runtime.protocolConfigId && integer(c.protocol_config_revision) === integer(p.revision)
    && hash(c.protocol_config_commitment) === hash(p.commitment), 'Catalog protocol snapshot is stale.');
  check(id(treasuryOption(p.treasury_id)) === runtime.protocolTreasuryId && p.payment_coin_type === runtime.paymentCoinType, 'Protocol payment coin or treasury differs.');
  check(typeof client?.getDynamicField === 'function', 'Protocol catalog claim reader is unavailable.');
  const keyType = makerV8StableType(runtime, 'core', 'protocol_config_v8', 'ProductReleaseCatalogSlotKeyV2');
  const valueType = makerV8StableType(runtime, 'core', 'protocol_config_v8', 'ProductReleaseCatalogSlotV2');
  // Compiled Core represents this empty Move struct as dummy_field: bool=false.
  const keyBytes = bcs.struct('ProductReleaseCatalogSlotKeyV2', { dummy_field: bcs.bool() })
    .serialize({ dummy_field: false }).toBytes();
  const keyBase64 = toBase64(keyBytes);
  const fieldId = deriveDynamicFieldID(runtime.protocolConfigId, keyType, keyBytes);
  let slot;
  try {
    slot = await client.getDynamicField({ parentId: runtime.protocolConfigId, name: { type: keyType, bcsBase64: keyBase64 } });
  } catch (error) {
    // The official Core point reader throws this exact per-object notFound.
    // A network failure, deleted field or missing/incorrect object ID is not absence.
    if (error instanceof ObjectError && error.reason === 'notFound' && error.objectId === fieldId) return;
    throw error;
  }
  check(slot?.kind === 'DynamicField' && slot.childId == null && slot.fieldId === fieldId
    && slot.name?.type === keyType && slot.name?.bcsBase64 === keyBase64
    && slot.value?.type === valueType
    && normalizeStructTag(slot.type) === normalizeStructTag(`0x2::dynamic_field::Field<${keyType},${valueType}>`), 'Protocol catalog claim field differs.');
  let decoded;
  try {
    const bytes = fromBase64(slot.value.bcsBase64);
    decoded = slotSchema.parse(bytes);
    check(toBase64(bytes) === slot.value.bcsBase64 && toBase64(slotSchema.serialize(decoded).toBytes()) === slot.value.bcsBase64, 'Protocol catalog claim BCS is not canonical.');
  } catch { fail('Protocol catalog claim BCS is invalid.'); }
  check(id(decoded.catalog_id) === runtime.catalogId, 'Protocol has claimed another catalog.');
}
