import { bcs } from '@mysten/sui/bcs';
import { sha256 } from '@noble/hashes/sha2.js';

// ProtocolConfigCommitmentInputV2 in Core protocol_config_v8.move.
// The V2 wire name does not change Core's VERSION: schema_revision is 8.
const ProtocolInput = bcs.struct('ProtocolConfigCommitmentInputV2', {
  domain: bcs.string(), schema_revision: bcs.u64(), config_id: bcs.Address,
  config_revision: bcs.u64(), enabled: bcs.bool(), core_original_package_id: bcs.Address,
  core_callable_package_id: bcs.Address, treasury_id: bcs.option(bcs.Address),
  payment_coin_type: bcs.string(), primary_content_fee_bps: bcs.u16(),
  fixed_complete_fee_atomic: bcs.u64(), maker_market_fee_bps: bcs.u16(),
  soul_market_fee_bps: bcs.u16(),
});
const fields = ['configId', 'coreOriginalPackageId', 'coreCallablePackageId', 'revision',
  'treasuryId', 'enabled', 'paymentCoinType', 'primaryContentFeeBps',
  'fixedCompleteFeeAtomic', 'makerMarketFeeBps', 'soulMarketFeeBps'];
function invalid(field) {
  const error = new Error(`Invalid protocol commitment input: ${field}`);
  error.code = 'MAKER_V8_PROTOCOL_COMMITMENT_INVALID';
  throw error;
}
function id(value, field) {
  if (typeof value !== 'string' || !/^0x[0-9a-f]{64}$/.test(value) || /^0x0+$/.test(value)) invalid(field);
  return value;
}
function uint(value, bits, field) {
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0))) invalid(field);
  if (!['string', 'number', 'bigint'].includes(typeof value) || !/^(0|[1-9][0-9]*)$/.test(String(value))) invalid(field);
  const number = BigInt(value);
  if (number >= (1n << BigInt(bits))) invalid(field);
  return number;
}

/** Deterministic V2 commitment only. Does not authorize a deployment, caller or
 * payment asset; consumers must separately verify their exact protocol policy. */
export function deriveMakerV8ProtocolConfigCommitment(input) {
  if (!input || Object.getPrototypeOf(input) !== Object.prototype
    || Object.keys(input).length !== fields.length
    || fields.some(field => !Object.hasOwn(input, field))) invalid('fields');
  if (typeof input.enabled !== 'boolean') invalid('enabled');
  if (typeof input.paymentCoinType !== 'string' || input.paymentCoinType.length === 0
    || input.paymentCoinType.length > 4096
    || new TextDecoder().decode(new TextEncoder().encode(input.paymentCoinType)) !== input.paymentCoinType) invalid('paymentCoinType');
  const bytes = ProtocolInput.serialize({
    domain: 'animacraft-fresh-v8/core/protocol-config/v2', schema_revision: 8,
    config_id: id(input.configId, 'configId'), config_revision: uint(input.revision, 64, 'revision'),
    enabled: input.enabled, core_original_package_id: id(input.coreOriginalPackageId, 'coreOriginalPackageId'),
    core_callable_package_id: id(input.coreCallablePackageId, 'coreCallablePackageId'),
    treasury_id: input.treasuryId === null ? null : id(input.treasuryId, 'treasuryId'),
    payment_coin_type: input.paymentCoinType,
    primary_content_fee_bps: uint(input.primaryContentFeeBps, 16, 'primaryContentFeeBps'),
    fixed_complete_fee_atomic: uint(input.fixedCompleteFeeAtomic, 64, 'fixedCompleteFeeAtomic'),
    maker_market_fee_bps: uint(input.makerMarketFeeBps, 16, 'makerMarketFeeBps'),
    soul_market_fee_bps: uint(input.soulMarketFeeBps, 16, 'soulMarketFeeBps'),
  }).toBytes();
  return Array.from(sha256(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
