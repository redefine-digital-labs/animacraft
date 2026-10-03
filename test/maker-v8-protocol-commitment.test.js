import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { deriveMakerV8ProtocolConfigCommitment as derive } from '../maker-v8-protocol-commitment.js';

const id = n => `0x${n.toString(16).padStart(64, '0')}`;
const initial = () => ({ configId: id(100), coreOriginalPackageId: id(11), coreCallablePackageId: id(11),
  revision: '0', treasuryId: null, enabled: false,
  paymentCoinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
  primaryContentFeeBps: 1000, fixedCompleteFeeAtomic: '0', makerMarketFeeBps: 250, soulMarketFeeBps: 250 });

// Independent manual BCS encoder: no production schema, SDK BCS or hash helper.
const le = (value, length) => { let n = BigInt(value); const bytes = Buffer.alloc(length);
  for (let i = 0; i < length; i++, n >>= 8n) bytes[i] = Number(n & 255n); return bytes; };
const uleb = value => { const bytes = []; do { const next = value & 127; value >>>= 7; bytes.push(next | (value ? 128 : 0)); } while (value); return Buffer.from(bytes); };
const string = value => { const bytes = Buffer.from(value); return Buffer.concat([uleb(bytes.length), bytes]); };
const address = value => Buffer.from(value.slice(2), 'hex');
function expected(input) {
  return createHash('sha256').update(Buffer.concat([
    string('animacraft-fresh-v8/core/protocol-config/v2'), le(8, 8), address(input.configId),
    le(input.revision, 8), Buffer.from([Number(input.enabled)]), address(input.coreOriginalPackageId),
    address(input.coreCallablePackageId), input.treasuryId === null ? Buffer.from([0]) : Buffer.concat([Buffer.from([1]), address(input.treasuryId)]),
    string(input.paymentCoinType), le(input.primaryContentFeeBps, 2), le(input.fixedCompleteFeeAtomic, 8),
    le(input.makerMarketFeeBps, 2), le(input.soulMarketFeeBps, 2),
  ])).digest('hex');
}

test('protocol preimage follows the actual Move V2 field order, domain and VERSION8', () => {
  const source = readFileSync(new URL('../move/animacraft_v8_core/sources/protocol_config_v8.move', import.meta.url), 'utf8');
  const body = source.match(/public struct ProtocolConfigCommitmentInputV2 has drop \{([^}]+)\}/)[1];
  assert.deepEqual([...body.matchAll(/([a-z_]+):\s*([^,]+),/g)].map(m => [m[1], m[2].trim()]), [
    ['domain', 'String'], ['schema_revision', 'u64'], ['config_id', 'ID'], ['config_revision', 'u64'],
    ['enabled', 'bool'], ['core_original_package_id', 'ID'], ['core_callable_package_id', 'ID'],
    ['treasury_id', 'Option<ID>'], ['payment_coin_type', 'String'], ['primary_content_fee_bps', 'u16'],
    ['fixed_complete_fee_atomic', 'u64'], ['maker_market_fee_bps', 'u16'], ['soul_market_fee_bps', 'u16'],
  ]);
  assert.match(source, /const VERSION: u64 = 8;/);
  assert.match(source, /domain: b"animacraft-fresh-v8\/core\/protocol-config\/v2"\.to_string\(\),\s*schema_revision: VERSION,/);
});
for (const [revision, treasuryId, enabled, golden] of [
  ['0', null, false, 'e72817157ebd2dc800ea8d9c5dce47a899ee0769b44731e132282eb2c7964570'],
  ['1', id(3), false, '0d0937cfe467884f560174ba6a9076650ce87757d89d8481efa5e898f626a060'],
  ['2', id(3), true, 'e66148c189afa41a54548bb0cc90e15664be6fded53485859a247f57fa8fbbea'],
]) test(`protocol commitment matches independently reviewed fixed vector revision ${revision}`, () => {
  const input = { ...initial(), configId: id(1), coreOriginalPackageId: id(2), coreCallablePackageId: id(2),
    revision, treasuryId, enabled };
  assert.equal(expected(input), golden); assert.equal(derive(input), golden);
});
for (const [name, patch] of Object.entries({
  'fresh publication': {}, 'treasury initialized': { revision: '1', treasuryId: id(103) },
  'enabled protocol': { revision: '2', treasuryId: id(103), enabled: true },
  'u64 precision boundary': { revision: '18446744073709551615', fixedCompleteFeeAtomic: '9007199254740993' },
})) test(`protocol commitment matches independent manual BCS for ${name}`, () => {
  const input = { ...initial(), ...patch }, before = structuredClone(input);
  assert.equal(derive(input), expected(input)); assert.deepEqual(input, before);
});
for (const [field, value] of Object.entries({ configId: id(99), coreOriginalPackageId: id(12), coreCallablePackageId: id(13),
  revision: '1', treasuryId: id(103), enabled: true, paymentCoinType: '0x2::sui::SUI', primaryContentFeeBps: 1001,
  fixedCompleteFeeAtomic: '1', makerMarketFeeBps: 251, soulMarketFeeBps: 252 })) {
  test(`protocol commitment binds ${field}`, () => {
    const input = initial(), modified = { ...input, [field]: value };
    assert.notEqual(derive(input), derive(modified)); assert.equal(derive(modified), expected(modified));
  });
}
for (const [name, mutate] of Object.entries({
  'missing field': x => { delete x.treasuryId; }, 'extra field': x => { x.legacy = true; },
  'zero identity': x => { x.configId = id(0); }, 'short identity': x => { x.configId = '0x1'; },
  'uppercase identity': x => { x.configId = `0x${'AB'.repeat(32)}`; },
  'undefined treasury': x => { x.treasuryId = undefined; }, 'string enabled': x => { x.enabled = 'false'; },
  'number enabled': x => { x.enabled = 1; }, 'rounded number': x => { x.revision = 9007199254740993; },
  'negative zero': x => { x.revision = -0; }, 'leading zero': x => { x.revision = '01'; },
  'u64 overflow': x => { x.revision = '18446744073709551616'; }, 'u16 overflow': x => { x.primaryContentFeeBps = 65536; },
  'negative bigint': x => { x.revision = -1n; }, 'null amount': x => { x.revision = null; },
  'empty payment': x => { x.paymentCoinType = ''; }, 'unpaired surrogate': x => { x.paymentCoinType = '\ud800'; },
})) test(`protocol commitment refuses ${name}`, () => {
  const input = initial(); mutate(input);
  assert.throws(() => derive(input), { code: 'MAKER_V8_PROTOCOL_COMMITMENT_INVALID' });
});
