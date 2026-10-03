import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { bcs } from '@mysten/sui/bcs';
import { deriveDynamicFieldID, fromBase64, toBase64, normalizeStructTag } from '@mysten/sui/utils';
import { NativeSoulBootstrapBcs as B, decodeNativeSoulBootstrapObject as decode,
  NATIVE_SOUL_BOOTSTRAP_PACKAGE_ROLES as roles,
  NATIVE_SOUL_BOOTSTRAP_USDC_TYPE as USDC } from '../scripts/native-soul-bootstrap-readback.mjs';

const id = n => `0x${n.toString(16).padStart(64, '0')}`;
const hash = n => Array(32).fill(n);
const packages = Object.fromEntries(roles.map((role, i) => [role, id(i + 11)]));
const invalid = { code: 'NATIVE_SOUL_BOOTSTRAP_OBJECT_INVALID' };
const type = (role, module, name) => `${packages[role]}::${module}::${name}`;
const types = {
  protocol: type('core', 'protocol_config_v8', 'ProtocolConfigV8'),
  protocolAdmin: type('core', 'protocol_config_v8', 'ProtocolAdminCapV8'),
  protocolTreasury: type('core', 'protocol_config_v8', `ProtocolTreasuryV8<${USDC}>`),
  catalog: type('core', 'package_binding_v8', 'ProductReleaseCatalogV8'),
  sealConfig: type('seal', 'seal_v8', 'SealPolicyConfigV8'),
  runtimeConfig: type('runtime', 'runtime_binding_v8', 'RuntimePackageConfigV8'),
  outputConfig: type('output', 'output_v8', 'OutputPackageConfigV8'),
  physicalConfig: type('physical', 'physical_v8', 'PhysicalPackageConfigV8'),
  marketConfig: type('market', 'market_v8', 'MarketPackageConfigV8'),
  releaseConfig: type('release', 'release_v8', 'ReleasePackageConfigV8'),
  replacement: type('core', 'package_binding_v8', 'FreshTupleReplacementBindingV2'),
  bootstrapAdmin: type('core', 'package_binding_v8', 'FreshTupleBootstrapAdminV2'),
  bootstrapCertificate: type('core', 'package_binding_v8', 'FreshTupleBootstrapCertificateV2'),
  walrusPolicy: type('core', 'core_v8', 'WalrusCertificationPolicyV1'),
};
const dynamic = {
  bootstrapSlot: ['package_binding_v8', 'FreshTupleBootstrapSlotKeyV2', 'FreshTupleBootstrapSlotV2'],
  walrusPolicySlot: ['core_v8', 'WalrusCertificationBootstrapKeyV1', 'WalrusCertificationBootstrapSlotV1'],
  nativeSoulBinding: ['protocol_config_v8', 'SoulidityBindingSlotKeyV8', 'SoulidityBindingV8'],
  protocolCatalogSlot: ['protocol_config_v8', 'ProductReleaseCatalogSlotKeyV2', 'ProductReleaseCatalogSlotV2'],
};
const callers = role => ({ schema_revision: '1', role, catalog_id: id(102),
  replacement_binding_id: id(120), package_tuple_commitment: hash(1),
  caller_original_package_id: packages[roles[role]], caller_callable_package_id: packages[roles[role]],
  call_cap_set_commitment: hash(2), cap_commitment: hash(3) });
const roleHashes = Object.fromEntries(roles.slice(0, 7).map((r, i) => [`${r}_binding_commitment`, hash(i + 1)]));
const common = { id: id(110), version: '8', catalog_id: id(102), product_binding_commitment: hash(1) };
const name = suffix => ({ name: `${packages.soulidity.slice(2)}::${suffix}` });
const values = {
  protocol: { id: id(100), version: '8', core_original_package_id: packages.core,
    core_callable_package_id: packages.core, revision: '1', treasury_id: id(103), payment_coin_type: USDC,
    primary_content_fee_bps: 1000, fixed_complete_fee_atomic: '0', maker_market_fee_bps: 250,
    soul_market_fee_bps: 250, enabled: true, commitment: hash(1) },
  protocolAdmin: { id: id(101), version: '8', config_id: id(100) },
  protocolTreasury: { id: id(103), version: '8', config_id: id(100), revenue: { value: '0' },
    total_collected: '0', total_withdrawn: '0' },
  catalog: { id: id(102), schema_revision: '2', protocol_config_id: id(100),
    protocol_config_revision: '1', protocol_config_commitment: hash(1),
    binding: { bindings: roles.slice(0, 7).map((r, i) => ({ original_package_id: packages[r],
      callable_package_id: packages[r], source_commitment: hash(i + 1), package_commitment: hash(i + 2),
      abi_commitment: hash(i + 3), commitment: hash(i + 4) })), commitment: hash(2) },
    authority_ids: roles.slice(1, 7).map((_, i) => id(200 + i)), call_cap_set_commitment: hash(3),
    catalog_commitment: hash(4), next_setup_role: 6,
    role_config_ids: roles.slice(1, 7).map((_, i) => id(210 + i)),
    role_config_commitments: roles.slice(1, 7).map((_, i) => hash(i + 5)) },
  sealConfig: { id: id(111), version: '8', protocol_config_id: id(100), protocol_config_revision: '1',
    catalog_id: id(102), product_binding_commitment: hash(1), seal_original_package_id: packages.seal,
    seal_callable_package_id: packages.seal, seal_binding_commitment: hash(2), seal_authority_id: id(200),
    call_cap_set_commitment: hash(3), role: 1, finalized: true,
    key_servers: [{ key_server_id: id(901), weight: 1 }], threshold: 1,
    cipher_suite: 'BonehFranklinBLS12381DemCCA/AesGcm256',
    key_derivation: 'SHA3-256:SUI-SEAL-IBE-BLS12381-H2-00:SUI-SEAL-IBE-BLS12381-H3-00',
    ciphertext_format: 'Seal/EncryptedObject/BCS/v0', max_plaintext_bytes: '3145728',
    key_server_set_commitment: hash(4), encryption_policy_commitment: hash(5), commitment: hash(6), config_commitment: hash(7) },
  runtimeConfig: { ...common, installation_commitment: hash(2) },
  outputConfig: { ...common, installation_commitment: hash(2), runtime_caller_cap: callers(3) },
  physicalConfig: { ...common, call_cap_set_commitment: hash(2), installation_commitment: hash(3) },
  marketConfig: { ...common, call_cap_set_commitment: hash(2), installation_commitment: hash(3), runtime_caller_cap: callers(5) },
  releaseConfig: { ...common, call_cap_set_commitment: hash(2), installation_commitment: hash(3) },
  replacement: { id: id(120), version: '2', catalog_id: id(102), ...roleHashes,
    package_tuple_commitment: hash(8), call_cap_set_commitment: hash(9), runtime_config_id: id(211),
    output_config_id: id(212), market_config_id: id(214), release_config_id: id(215), binding_commitment: hash(10) },
  bootstrapAdmin: { id: id(121), version: '2', protocol_admin_id: id(101), replacement_binding_id: id(120),
    catalog_id: id(102), package_tuple_commitment: hash(8), call_cap_set_commitment: hash(9),
    caps_minted: false, install_mask: 0, install_mark_commitments: [], bootstrap_commitment: hash(10) },
  bootstrapCertificate: { id: id(122), version: '2', replacement_binding_id: id(120), catalog_id: id(102),
    package_tuple_commitment: hash(8), call_cap_set_commitment: hash(9), install_mask: 12,
    install_mark_commitments: [hash(10), hash(11)], certificate_commitment: hash(12) },
  walrusPolicy: { id: id(123), version: '1', catalog_id: id(102), package_tuple_commitment: hash(1),
    system_id: '0x2134d52768ea07e8c43570ef975eb3e4c27a39fa6396bef985b5abc58d03ddd2', commitment: hash(2) },
  bootstrapSlot: { state: 2, replacement_binding_id: id(120), admin_id: null,
    certificate_id: id(122), certificate_commitment: hash(12) },
  walrusPolicySlot: { policy_id: id(123), system_id: '0x2134d52768ea07e8c43570ef975eb3e4c27a39fa6396bef985b5abc58d03ddd2' },
  nativeSoulBinding: { config_id: id(100), soul_original: name('soul::Soul'), soul_defining: name('soul::Soul'),
    mint_original: name('animacraft_v8_binding::MintBindingWitnessV8'), mint_defining: name('animacraft_v8_binding::MintBindingWitnessV8'),
    owner_original: name('animacraft_v8_binding::SoulOwnerWitnessV8'), owner_defining: name('animacraft_v8_binding::SoulOwnerWitnessV8') },
  protocolCatalogSlot: { catalog_id: id(102) },
};

function fixture(kind) {
  let fields = structuredClone(values[kind]);
  let wireType = types[kind];
  let owner = ['protocolAdmin', 'bootstrapAdmin'].includes(kind) ? { kind: 'address', address: id(900) }
    : ['replacement', 'bootstrapCertificate'].includes(kind) ? { kind: 'immutable' }
      : { kind: 'shared', initialSharedVersion: '7' };
  if (dynamic[kind]) {
    const [module, key, value] = dynamic[kind];
    const parent = ['nativeSoulBinding', 'protocolCatalogSlot'].includes(kind) ? id(100) : id(102);
    const keyType = type('core', module, key);
    wireType = `0x2::dynamic_field::Field<${keyType},${type('core', module, value)}>`;
    fields = { id: deriveDynamicFieldID(parent, keyType, new Uint8Array([0])), name: { dummy_field: false }, value: fields };
    owner = { kind: 'object', objectId: parent };
  }
  const object = { type: normalizeStructTag(wireType), objectId: fields.id,
    bcsBase64: toBase64(B[kind].serialize(fields).toBytes()), owner };
  return { fields, object };
}
function encoded(kind, fields, object = fixture(kind).object) {
  return { ...object, bcsBase64: toBase64(B[kind].serialize(fields).toBytes()) };
}

// Build an independent schema directly from current Move struct declarations.
// This checks field order AND primitive widths/nested vector/Option layouts,
// rather than merely round-tripping the same handwritten JS schema twice.
const sourceFiles = [
  'move/animacraft_v8_core/sources/protocol_config_v8.move',
  'move/animacraft_v8_core/sources/package_binding_v8.move',
  'move/animacraft_v8_core/sources/core_v8.move',
  ...['seal', 'output', 'physical', 'market', 'release'].map(role => `move/animacraft_v8_${role}/sources/${role}_v8.move`),
  'move/animacraft_v8_runtime/sources/runtime_binding_v8.move',
];
const move = sourceFiles.map(path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'))
  .join('\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
function moveFields(name) {
  const match = new RegExp(`public\\s+struct\\s+${name}(?:<[^>]+>)?[^{}]*\\{([^}]*)\\}`).exec(move);
  assert.ok(match, `actual Move struct ${name}`);
  let depth = 0; let part = ''; const parts = [];
  for (const character of match[1]) {
    if (character === '<') depth++;
    if (character === '>') depth--;
    if (character === ',' && depth === 0) { if (part.trim()) parts.push(part.trim()); part = ''; }
    else part += character;
  }
  if (part.trim()) parts.push(part.trim());
  return parts.map(value => { const offset = value.indexOf(':'); return [value.slice(0, offset).trim(), value.slice(offset + 1).trim()]; });
}
function sourceType(raw) {
  const value = raw.replace(/\s/g, '');
  if (['ID', 'UID', 'address'].includes(value)) return bcs.Address;
  if (value === 'String') return bcs.string();
  if (/^u(8|16|32|64|128|256)$/.test(value)) return bcs[value]();
  if (value === 'bool') return bcs.bool();
  if (value.startsWith('vector<')) return bcs.vector(sourceType(value.slice(7, -1)));
  if (value.startsWith('Option<')) return bcs.option(sourceType(value.slice(7, -1)));
  if (value.startsWith('Balance<')) return bcs.struct('Balance', { value: bcs.u64() });
  if (value === 'type_name::TypeName') return bcs.struct('TypeName', { name: bcs.string() });
  const fields = moveFields(value);
  return bcs.struct(value, Object.fromEntries(fields.length ? fields.map(([key, fieldType]) => [key, sourceType(fieldType)]) : [['dummy_field', bcs.bool()]]));
}
function sourceSchema(kind) {
  if (dynamic[kind]) {
    const [, key, value] = dynamic[kind];
    return bcs.struct('Field', { id: bcs.Address, name: sourceType(key), value: sourceType(value) });
  }
  return sourceType(types[kind].split('::').at(2).split('<')[0]);
}

test('the bootstrap codec imports only small Sui schemas/utilities, never WASM or a runner', () => {
  const source = readFileSync(new URL('../scripts/native-soul-bootstrap-readback.mjs', import.meta.url), 'utf8');
  assert.deepEqual([...source.matchAll(/^import .*? from ['"]([^'"]+)['"]/gm)].map(match => match[1]),
    ['@mysten/sui/bcs', '@mysten/sui/utils']);
  assert.equal(Object.keys(B).length, 18);
});

for (const kind of Object.keys(B)) {
  test(`${kind}: exact current Move schema bytes and identity round-trip`, () => {
    const { fields, object } = fixture(kind);
    assert.deepEqual(sourceSchema(kind).serialize(fields).toBytes(), B[kind].serialize(fields).toBytes());
    assert.deepEqual(decode(kind, object, packages), fields);
    assert.deepEqual(object, fixture(kind).object, 'pure input remains unchanged');
  });
  for (const issue of ['type', 'uid', 'owner', 'trailing', 'truncated']) {
    test(`${kind}: rejects ${issue}`, () => {
      const { object } = fixture(kind);
      if (issue === 'type') object.type = object.type.replace(packages[dynamic[kind] ? 'core' : kind === 'catalog' || kind.startsWith('protocol') || kind.startsWith('bootstrap') || kind === 'replacement' || kind === 'walrusPolicy' ? 'core' : kind.replace('Config', '')], id(999));
      if (issue === 'uid') object.objectId = id(999);
      if (issue === 'owner') object.owner = object.owner.kind === 'immutable' ? { kind: 'shared', initialSharedVersion: '1' } : { kind: 'immutable' };
      const bytes = fromBase64(object.bcsBase64);
      if (issue === 'trailing') object.bcsBase64 = toBase64(new Uint8Array([...bytes, 0]));
      if (issue === 'truncated') object.bcsBase64 = toBase64(bytes.slice(0, -1));
      assert.throws(() => decode(kind, object, packages), invalid);
    });
  }
}

test('partial setup and missing caller slots decode without being called ready', () => {
  const { fields, object } = fixture('catalog');
  fields.next_setup_role = 0; fields.role_config_ids = []; fields.role_config_commitments = [];
  assert.deepEqual(decode('catalog', encoded('catalog', fields, object), packages), fields);
  for (const kind of ['outputConfig', 'marketConfig']) {
    const value = fixture(kind); value.fields.runtime_caller_cap = null;
    assert.equal(decode(kind, encoded(kind, value.fields), packages).runtime_caller_cap, null);
  }
  const protocol = fixture('protocol'); protocol.fields.enabled = false; protocol.fields.commitment = hash(99);
  assert.equal(decode('protocol', encoded('protocol', protocol.fields), packages).enabled, false);
});
test('bootstrap slot retains the exact SEALED, IN_PROGRESS and CERTIFIED Option shapes', () => {
  for (const [state, admin, certificate, commitment] of [[0, null, null, null], [1, id(121), null, null], [2, null, id(122), hash(12)]]) {
    const { fields } = fixture('bootstrapSlot');
    Object.assign(fields.value, { state, admin_id: admin, certificate_id: certificate, certificate_commitment: commitment });
    assert.deepEqual(decode('bootstrapSlot', encoded('bootstrapSlot', fields), packages), fields);
  }
});
test('all u64/u128 values retain decimal precision', () => {
  const { fields } = fixture('protocolTreasury');
  fields.revenue.value = (2n ** 64n - 1n).toString();
  fields.total_collected = (2n ** 128n - 1n).toString(); fields.total_withdrawn = fields.total_collected;
  assert.deepEqual(decode('protocolTreasury', encoded('protocolTreasury', fields), packages), fields);
});
for (const issue of ['missing', 'extra', 'duplicate', 'zero', 'short', 'uppercase']) test(`package map rejects ${issue}`, () => {
  const value = structuredClone(packages);
  if (issue === 'missing') delete value.soulidity;
  if (issue === 'extra') value.walrus = id(99);
  if (issue === 'duplicate') value.release = value.core;
  if (issue === 'zero') value.core = id(0);
  if (issue === 'short') value.core = '0xb';
  if (issue === 'uppercase') value.core = value.core.toUpperCase();
  assert.throws(() => decode('protocol', fixture('protocol').object, value), invalid);
});
for (const version of ['0', '01', '-1', '18446744073709551616', 7, null, '9'.repeat(100)]) test(`shared owner rejects invalid version ${String(version).slice(0, 24)}`, () => {
  const { object } = fixture('protocol'); object.owner.initialSharedVersion = version;
  assert.throws(() => decode('protocol', object, packages), invalid);
});
for (const kind of Object.keys(dynamic)) test(`${kind}: rejects swapped parent, nonempty key and mismatched generic`, () => {
  const { object, fields } = fixture(kind);
  assert.throws(() => decode(kind, { ...object, owner: { kind: 'object', objectId: id(999) } }, packages), invalid);
  fields.name.dummy_field = true;
  assert.throws(() => decode(kind, encoded(kind, fields), packages), invalid);
  assert.throws(() => decode(kind, { ...object, type: object.type.replace(dynamic[kind][2], 'WrongValue') }, packages), invalid);
});
test('native binding cannot claim a different parent even with the correct DF UID', () => {
  const { fields } = fixture('nativeSoulBinding'); fields.value.config_id = id(999);
  assert.throws(() => decode('nativeSoulBinding', encoded('nativeSoulBinding', fields), packages), invalid);
});
test('treasury rejects SUI, wrong USDC origin and generic substitution', () => {
  const { object } = fixture('protocolTreasury');
  for (const payment of ['0x2::sui::SUI', `${id(99)}::usdc::USDC`, `vector<${USDC}>`]) {
    assert.throws(() => decode('protocolTreasury', { ...object, type: object.type.replace(USDC, payment) }, packages), invalid);
  }
});
test('canonical BCS rejects non-minimal ULEB, malformed bool and Option encodings', () => {
  const catalog = fixture('catalog').object; const wire = fromBase64(catalog.bcsBase64);
  const hashLengthOffset = 32 + 8 + 32 + 8;
  assert.equal(wire[hashLengthOffset], 32);
  const badVector = new Uint8Array([...wire.slice(0, hashLengthOffset), 0xa0, 0, ...wire.slice(hashLengthOffset + 1)]);
  assert.throws(() => decode('catalog', { ...catalog, bcsBase64: toBase64(badVector) }, packages), invalid);
  const admin = fixture('bootstrapAdmin').object; const badBool = fromBase64(admin.bcsBase64);
  badBool[32 + 8 + 32 * 3 + 33 * 2] = 2;
  assert.throws(() => decode('bootstrapAdmin', { ...admin, bcsBase64: toBase64(badBool) }, packages), invalid);
  const output = fixture('outputConfig'); output.fields.runtime_caller_cap = null;
  const none = encoded('outputConfig', output.fields); const badOption = fromBase64(none.bcsBase64); badOption[badOption.length - 1] = 2;
  assert.throws(() => decode('outputConfig', { ...none, bcsBase64: toBase64(badOption) }, packages), invalid);
});
test('catalog requires the actual bindings vector prefix, not flattened historical rows', () => {
  const { object } = fixture('catalog'); const wire = fromBase64(object.bcsBase64);
  const bindingsOffset = 32 + 8 + 32 + 8 + 33;
  assert.equal(wire[bindingsOffset], 7);
  const flattened = new Uint8Array([...wire.slice(0, bindingsOffset), ...wire.slice(bindingsOffset + 1)]);
  assert.throws(() => decode('catalog', { ...object, bcsBase64: toBase64(flattened) }, packages), invalid);
});
for (const issue of ['spaces', 'padding', 'junk', 'oversized', 'empty']) test(`base64 rejects ${issue}`, () => {
  const { object } = fixture('protocol');
  if (issue === 'spaces') object.bcsBase64 += '\n';
  if (issue === 'padding') object.bcsBase64 += '=';
  if (issue === 'junk') object.bcsBase64 = '!!!!';
  if (issue === 'oversized') object.bcsBase64 = 'A'.repeat(1398105);
  if (issue === 'empty') object.bcsBase64 = '';
  assert.throws(() => decode('protocol', object, packages), invalid);
});
test('unknown kinds, envelope extras, owner extras and zero identity reject safely', () => {
  const { object } = fixture('protocol');
  for (const kind of ['__proto__', 'toString', 'legacyCatalog', null]) assert.throws(() => decode(kind, object, packages), invalid);
  assert.throws(() => decode('protocol', { ...object, ready: true }, packages), invalid);
  assert.throws(() => decode('protocol', { ...object, objectId: id(0) }, packages), invalid);
  assert.throws(() => decode('protocol', { ...object, owner: { ...object.owner, address: id(901) } }, packages), invalid);
  for (const kind of ['protocolAdmin', 'bootstrapAdmin']) {
    const { object } = fixture(kind); object.owner.address = id(0);
    assert.throws(() => decode(kind, object, packages), invalid);
  }
});
