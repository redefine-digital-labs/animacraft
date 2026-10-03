import test from 'node:test';
import assert from 'node:assert/strict';
import { validateNativeSoulBootstrapStageRelations as validate } from '../scripts/native-soul-bootstrap-relations.mjs';
import { nativeSoulBootstrapFixture as fixture, bootstrapStages as stages,
  bootstrapId as id, bootstrapHash as hash } from './fixtures/native-soul-bootstrap-fixture.mjs';

const relation = { code: 'NATIVE_SOUL_BOOTSTRAP_RELATION_INVALID' };
const objectError = { code: 'NATIVE_SOUL_BOOTSTRAP_OBJECT_INVALID' };
for (const stage of stages) {
  test(`${stage}: accepts actual typed BCS relationships and returns an isolated frozen tree`, () => {
    const f = fixture(stage), before = structuredClone(f.args()), out = validate(f.args());
    assert.deepEqual(f.args(), before);
    assert.deepEqual(Object.keys(out), Object.keys(f.objects));
    const frozen = value => { if (value && typeof value === 'object') {
      assert.ok(Object.isFrozen(value)); Object.values(value).forEach(frozen);
    } };
    frozen(out);
    f.mutate('protocol', p => { p.enabled = false; });
    assert.equal(out.protocol.enabled, true);
  });
  for (const [name, change] of Object.entries({
    'missing inventory': f => { delete f.objects.protocolAdmin; },
    'extra inventory': f => { f.objects.unexpected = f.objects.protocol; },
    'wrong sender': f => { f.sender = id(999); },
    'wrong protocol input': f => { f.input.protocolConfig.objectId = id(998); },
    'wrong initial shared version': f => { f.input.protocolConfig.initialSharedVersion = '8'; },
    'wrong admin input': f => { f.input.protocolAdminCap.objectId = id(997); },
  })) test(`${stage}: rejects ${name}`, () => {
    const f = fixture(stage); change(f); assert.throws(() => validate(f.args()), relation);
  });
  for (const [key, value] of Object.entries({ version: '7', revision: '1', core_original_package_id: id(998),
    core_callable_package_id: id(999), treasury_id: null, payment_coin_type: '0x2::sui::SUI',
    primary_content_fee_bps: 999, fixed_complete_fee_atomic: '1', maker_market_fee_bps: 249,
    soul_market_fee_bps: 251, enabled: false, commitment: hash(0) })) {
    test(`${stage}: rejects protocol ${key}`, () => {
      const f = fixture(stage).mutate('protocol', p => { p[key] = value; });
      assert.throws(() => validate(f.args()), relation);
    });
  }
}

function reject(stage, kind, name, mutate, code = relation) {
  test(`${stage}/${kind}: ${name}`, () => {
    const f = fixture(stage).mutate(kind, mutate); assert.throws(() => validate(f.args()), code);
  });
}
for (const [key, value] of Object.entries({ version: '7', config_id: id(999), total_collected: '1', total_withdrawn: '1' }))
  reject('INITIALIZE_PROTOCOL', 'protocolTreasury', key, t => { t[key] = value; });
reject('INITIALIZE_PROTOCOL', 'protocolTreasury', 'nonempty revenue', t => { t.revenue.value = '1'; });
for (const stage of stages.slice(1)) {
  for (const [key, value] of Object.entries({ schema_revision: '1', protocol_config_id: id(999), protocol_config_revision: '3',
    protocol_config_commitment: hash(99), next_setup_role: 5, authority_ids: [], role_config_ids: [], role_config_commitments: [] }))
    reject(stage, 'catalog', key, c => { c[key] = value; });
  reject(stage, 'catalog', 'duplicate authority', c => { c.authority_ids[1] = c.authority_ids[0]; });
  reject(stage, 'catalog', 'duplicate configuration', c => { c.role_config_ids[1] = c.role_config_ids[0]; });
  reject(stage, 'catalog', 'missing role', c => { c.binding.bindings.pop(); });
  reject(stage, 'catalog', 'wrong ordered original', c => { c.binding.bindings[2].original_package_id = c.binding.bindings[1].original_package_id; });
  reject(stage, 'catalog', 'wrong callable', c => { c.binding.bindings[6].callable_package_id = id(999); });
  reject(stage, 'catalog', 'zero package hash', c => { c.binding.bindings[3].package_commitment = hash(0); });
  for (const [key, value] of Object.entries({ version: '1', catalog_id: id(999), runtime_config_id: id(999),
    output_config_id: id(999), market_config_id: id(999), release_config_id: id(999),
    package_tuple_commitment: hash(99), call_cap_set_commitment: hash(99), binding_commitment: hash(0),
    core_binding_commitment: hash(99), release_binding_commitment: hash(99) }))
    reject(stage, 'replacement', key, r => { r[key] = value; });
  reject(stage, 'bootstrapSlot', 'wrong replacement', s => { s.value.replacement_binding_id = id(999); });
  reject(stage, 'bootstrapSlot', 'wrong phase state', s => { s.value.state = 9; });
}
for (const role of ['seal', 'runtime', 'output', 'physical', 'market', 'release']) {
  for (const [key, value] of Object.entries({ version: '7', catalog_id: id(999), product_binding_commitment: hash(99),
    [role === 'seal' ? 'config_commitment' : 'installation_commitment']: hash(99) }))
    reject('SETUP_RELEASE', role + 'Config', key, c => { c[key] = value; });
  test(`SETUP ${role}: well-formed but different config UID cannot replace installed ID`, () => {
    const f = fixture('SETUP_RELEASE'), kind = role + 'Config';
    f.mutate(kind, c => { c.id = id(999); }); f.objects[kind].objectId = id(999);
    assert.throws(() => validate(f.args()), relation);
  });
}
for (const role of ['output', 'market']) reject('SETUP_RELEASE', role + 'Config', 'caller must not be installed before begin/finalize', c => {
  c.runtime_caller_cap = fixture('FINALIZE_BOOTSTRAP').fields[role + 'Config'].runtime_caller_cap;
});
for (const key of ['source', 'package', 'abi']) reject('SETUP_RELEASE', 'catalog', `prepared ${key} artifact differs`, c => {
  c.binding.bindings[0][key + '_commitment'] = hash(99);
});
for (const [key, value] of Object.entries({ protocol_config_id: id(999), protocol_config_revision: '1',
  seal_original_package_id: id(999), seal_callable_package_id: id(999), seal_authority_id: id(999), role: 0,
  finalized: false, threshold: 2, cipher_suite: 'other', key_derivation: 'other', ciphertext_format: 'other',
  max_plaintext_bytes: '3145729', seal_binding_commitment: hash(99), call_cap_set_commitment: hash(99),
  key_server_set_commitment: hash(0), encryption_policy_commitment: hash(0), commitment: hash(0) }))
  reject('SETUP_RELEASE', 'sealConfig', key, s => { s[key] = value; });
reject('SETUP_RELEASE', 'sealConfig', 'wrong server ID', s => { s.key_servers[0].key_server_id = id(999); });
reject('SETUP_RELEASE', 'sealConfig', 'wrong server weight', s => { s.key_servers[0].weight = 2; });
reject('SETUP_RELEASE', 'sealConfig', 'extra server', s => { s.key_servers.push({ key_server_id: id(999), weight: 1 }); });
for (const [key, value] of Object.entries({ version: '2', catalog_id: id(999), system_id: id(999), package_tuple_commitment: hash(99), commitment: hash(0) }))
  reject('SETUP_RELEASE', 'walrusPolicy', key, p => { p[key] = value; });
for (const key of ['policy_id', 'system_id']) reject('SETUP_RELEASE', 'walrusPolicySlot', key, p => { p.value[key] = id(999); });
reject('SETUP_RELEASE', 'protocolCatalogSlot', 'claimed wrong catalog', p => { p.value.catalog_id = id(999); });
for (const prefix of ['soul', 'mint', 'owner']) for (const origin of ['original', 'defining'])
  reject('SETUP_RELEASE', 'nativeSoulBinding', `${prefix} ${origin} wrong exact witness`, n => { n.value[`${prefix}_${origin}`].name = `${id(999).slice(2)}::soul::Soul`; });
for (const [key, value] of Object.entries({ version: '1', protocol_admin_id: id(999), replacement_binding_id: id(999), catalog_id: id(999),
  package_tuple_commitment: hash(99), call_cap_set_commitment: hash(99), caps_minted: true, install_mask: 4,
  install_mark_commitments: [hash(1)], bootstrap_commitment: hash(0) }))
  reject('BEGIN_BOOTSTRAP', 'bootstrapAdmin', key, a => { a[key] = value; });
reject('BEGIN_BOOTSTRAP', 'bootstrapSlot', 'wrong admin', s => { s.value.admin_id = id(999); });
reject('BEGIN_BOOTSTRAP', 'bootstrapSlot', 'premature certificate', s => { s.value.certificate_id = id(122); });
reject('SETUP_RELEASE', 'bootstrapSlot', 'premature admin', s => { s.value.admin_id = id(121); });
for (const [key, value] of Object.entries({ version: '1', replacement_binding_id: id(999), catalog_id: id(999),
  package_tuple_commitment: hash(99), call_cap_set_commitment: hash(99), install_mask: 15,
  install_mark_commitments: [hash(1)], certificate_commitment: hash(99) }))
  reject('FINALIZE_BOOTSTRAP', 'bootstrapCertificate', key, c => { c[key] = value; });
reject('FINALIZE_BOOTSTRAP', 'bootstrapCertificate', 'zero install mark', c => { c.install_mark_commitments[0] = hash(0); });
reject('FINALIZE_BOOTSTRAP', 'bootstrapSlot', 'retained admin', s => { s.value.admin_id = id(121); });
reject('FINALIZE_BOOTSTRAP', 'bootstrapSlot', 'wrong certificate', s => { s.value.certificate_id = id(999); });
for (const role of ['output', 'market']) {
  reject('FINALIZE_BOOTSTRAP', role + 'Config', 'missing caller', c => { c.runtime_caller_cap = null; });
  for (const [key, value] of Object.entries({ schema_revision: '1', role: 9, catalog_id: id(999), replacement_binding_id: id(999),
    package_tuple_commitment: hash(99), caller_original_package_id: id(999), caller_callable_package_id: id(999),
    call_cap_set_commitment: hash(99), cap_commitment: hash(0) }))
    reject('FINALIZE_BOOTSTRAP', role + 'Config', `caller ${key}`, c => { c.runtime_caller_cap[key] = value; });
  test(`FINALIZE ${role}: rejects exact prior config version/identity substitution`, () => {
    for (const [key, value] of [['objectId', id(999)], ['initialSharedVersion', '8']]) {
      const f = fixture('FINALIZE_BOOTSTRAP'); f.input[role + 'Config'][key] = value;
      assert.throws(() => validate(f.args()), relation);
    }
  });
}
for (const kind of ['bootstrapSlot', 'nativeSoulBinding', 'protocolCatalogSlot', 'walrusPolicySlot']) {
  test(`${kind}: wrong parent and true dummy key fail typed decoding before relationships`, () => {
    const f = fixture('SETUP_RELEASE'); f.objects[kind].owner.objectId = id(999);
    assert.throws(() => validate(f.args()), objectError);
    const g = fixture('SETUP_RELEASE').mutate(kind, f => { f.name.dummy_field = true; });
    assert.throws(() => validate(g.args()), objectError);
  });
}
test('object inventory from another stage cannot be reused as readiness', () => {
  const setup = fixture('SETUP_RELEASE'), final = fixture('FINALIZE_BOOTSTRAP');
  assert.throws(() => validate({ ...final.args(), objects: setup.objects }), relation);
});
for (const stage of stages) test(`${stage}: malformed object evidence cannot become a relationship success`, () => {
  for (const mutate of [
    o => { o.type = o.type.replace('ProtocolConfigV8', 'OtherConfig'); },
    o => { o.owner = { kind: 'immutable' }; },
    o => { o.bcsBase64 = Buffer.concat([Buffer.from(o.bcsBase64, 'base64'), Buffer.from([0])]).toString('base64'); },
  ]) {
    const f = fixture(stage); mutate(f.objects.protocol);
    assert.throws(() => validate(f.args()), objectError);
  }
});
test('relationship validation is explicitly not a cryptographic hash/finality attestation', () => {
  const f = fixture('INITIALIZE_PROTOCOL').mutate('protocol', p => { p.commitment = hash(199); });
  assert.deepEqual(validate(f.args()).protocol.commitment, hash(199));
});
