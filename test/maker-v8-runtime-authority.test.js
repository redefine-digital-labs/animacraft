import test from 'node:test';
import assert from 'node:assert/strict';
import { bcs } from '@mysten/sui/bcs';
import { sha256 } from '@noble/hashes/sha2.js';
import { toBase64, deriveDynamicFieldID } from '@mysten/sui/utils';
import { attestMakerV8Runtime, makerV8AttestedReplacement, isMakerV8RuntimeAttested } from '../maker-v8-chain.js';
import { MAKER_V8_RUNTIME_SCHEMA, MAKER_V8_PAYMENT_COIN_TYPE, MAKER_V8_CLOCK_OBJECT_ID } from '../maker-v8-runtime.js';
import { CORE_BASE_REGISTRY_MODULE_BASE64 } from './fixtures/maker-v8-runtime-attestation.js';

// Independent fixtures serialize the current Core Move layouts, not legacy caps.
const roles = ['core', 'seal', 'runtime', 'output', 'physical', 'market', 'release'];
const sid = n => `0x${BigInt(n).toString(16).padStart(64, '0')}`;
const h = n => Array(32).fill(n);
const V = bcs.vector(bcs.u8());
const header = { domain: bcs.string(), schema_revision: bcs.u64() };
const hash = (shape, values, domain) => [...sha256(bcs.struct('Commitment', { ...header, ...shape }).serialize({ domain, schema_revision: 2, ...values }).toBytes())];
const roleHashes = Object.fromEntries(roles.map(r => [`${r}_binding_commitment`, V]));
const authorities = Object.fromEntries(roles.slice(1).map(r => [`${r}_authority_id`, bcs.Address]));
const bindingShape = { original_package_id: bcs.Address, callable_package_id: bcs.Address, source_commitment: V, package_commitment: V, abi_commitment: V, commitment: V };
const callerShape = { schema_revision: bcs.u64(), role: bcs.u8(), catalog_id: bcs.Address, replacement_binding_id: bcs.Address, package_tuple_commitment: V, caller_original_package_id: bcs.Address, caller_callable_package_id: bcs.Address, call_cap_set_commitment: V, cap_commitment: V };
const replacementInput = { ...roleHashes, package_tuple_commitment: V, call_cap_set_commitment: V, runtime_config_id: bcs.Address, output_config_id: bcs.Address, market_config_id: bcs.Address, release_config_id: bcs.Address };
const certificateShape = { id: bcs.Address, version: bcs.u64(), replacement_binding_id: bcs.Address, catalog_id: bcs.Address, package_tuple_commitment: V, call_cap_set_commitment: V, install_mask: bcs.u8(), install_mark_commitments: bcs.vector(V), certificate_commitment: V };
const slotShape = { state: bcs.u8(), replacement_binding_id: bcs.Address, admin_id: bcs.option(bcs.Address), certificate_id: bcs.option(bcs.Address), certificate_commitment: bcs.option(V) };

function fixture({ weights = [1], threshold = 1 } = {}) {
  const config = { schemaVersion: MAKER_V8_RUNTIME_SCHEMA, protocolVersion: 8, enabled: true,
    catalogId: sid(20), protocolConfigId: sid(21), protocolTreasuryId: sid(22), paymentCoinType: MAKER_V8_PAYMENT_COIN_TYPE,
    clockObjectId: MAKER_V8_CLOCK_OBJECT_ID, makerBindings: [],
    roles: Object.fromEntries(roles.map((r, i) => [r, { typeOriginPackageId: sid(i * 2 + 1), callablePackageId: sid(i * 2 + 1) }])),
    roleConfigIds: Object.fromEntries(roles.slice(1).map((r, i) => [r, sid(23 + i)])) };
  const bindings = roles.map((r, i) => {
    const row = { original_package_id: config.roles[r].typeOriginPackageId, callable_package_id: config.roles[r].callablePackageId,
      source_commitment: h(i + 1), package_commitment: h(i + 11), abi_commitment: h(i + 21) };
    return { ...row, commitment: hash({ role: bcs.u8(), ...Object.fromEntries(Object.entries(bindingShape).filter(([k]) => k !== 'commitment')) },
      { role: i, ...row }, 'animacraft-fresh-v8/package/exact-binding/v2') };
  });
  const hashes = Object.fromEntries(roles.map((r, i) => [`${r}_binding_commitment`, bindings[i].commitment]));
  const auth = Object.fromEntries(roles.slice(1).map((r, i) => [`${r}_authority_id`, sid(40 + i)]));
  const caps = hash({ catalog_id: bcs.Address, ...roleHashes, ...authorities }, { catalog_id: config.catalogId, ...hashes, ...auth }, 'animacraft-fresh-v8/package/call-cap-set/v2');
  const tuple = hash({ catalog_id: bcs.Address, native_capability_mask: bcs.u64(), call_cap_set_commitment: V, ...Object.fromEntries(roles.map(r => [`${r}_binding`, V])) },
    { catalog_id: config.catalogId, native_capability_mask: 127, call_cap_set_commitment: caps, ...Object.fromEntries(roles.map((r, i) => [`${r}_binding`, bindings[i].commitment])) }, 'animacraft-fresh-v8/package/product-tuple/v2');
  const objects = new Map();
  const schemas = new Map();
  const type = (r, module, name) => `${config.roles[r].typeOriginPackageId}::${module}::${name}`;
  function put(id, typeName, shape, fields, immutable = false) {
    const data = { objectId: id, version: '1', digest: '2'.repeat(44), type: typeName,
      owner: immutable ? { Immutable: true } : { Shared: { initial_shared_version: '1' } },
      content: { dataType: 'moveObject', type: typeName, fields }, bcs: { dataType: 'moveObject', type: typeName, bcsBytes: toBase64(bcs.struct('Object', shape).serialize(fields).toBytes()) } };
    objects.set(id, { data }); schemas.set(id, shape);
  }
  const replacement = { id: sid(60), version: '2', catalog_id: config.catalogId, ...hashes,
    package_tuple_commitment: tuple, call_cap_set_commitment: caps,
    ...Object.fromEntries(['runtime', 'output', 'market', 'release'].map(r => [`${r}_config_id`, config.roleConfigIds[r]])) };
  replacement.binding_commitment = hash({ binding_id: bcs.Address, catalog_id: bcs.Address, ...replacementInput }, { ...replacement, binding_id: replacement.id }, 'animacraft-fresh-v8/core/fresh-tuple-replacement-binding/v2');
  put(replacement.id, type('core', 'package_binding_v8', 'FreshTupleReplacementBindingV2'), { id: bcs.Address, version: bcs.u64(), catalog_id: bcs.Address, ...replacementInput, binding_commitment: V }, replacement, true);
  const marks = [];
  const keyServers = weights.map((weight, index) => ({ key_server_id: sid(90 + index), weight }));
  const keysHash = hash({ ordered_key_servers: bcs.vector(bcs.struct('KeyServer', { key_server_id: bcs.Address, weight: bcs.u16() })), threshold: bcs.u16() },
    { ordered_key_servers: keyServers, threshold }, 'animacraft-fresh-v8/seal/key-server-set/v2');
  const encryptionHash = hash({ cipher_suite: bcs.string(), key_derivation: bcs.string(), ciphertext_format: bcs.string(), max_plaintext_bytes: bcs.u64() },
    { cipher_suite: 'BonehFranklinBLS12381DemCCA/AesGcm256', key_derivation: 'SHA3-256:SUI-SEAL-IBE-BLS12381-H2-00:SUI-SEAL-IBE-BLS12381-H3-00', ciphertext_format: 'Seal/EncryptedObject/BCS/v0', max_plaintext_bytes: '10' }, 'animacraft-fresh-v8/seal/encryption-policy/v2');
  const policyHash = hash({ policy_id: bcs.Address, catalog_id: bcs.Address, package_tuple_commitment: V, call_cap_set_commitment: V, key_server_set_commitment: V, encryption_policy_commitment: V },
    { policy_id: config.roleConfigIds.seal, catalog_id: config.catalogId, package_tuple_commitment: tuple, call_cap_set_commitment: caps, key_server_set_commitment: keysHash, encryption_policy_commitment: encryptionHash }, 'animacraft-fresh-v8/seal/policy/v2');
  const installHashes = [];
  for (const [index, r] of roles.slice(1).entries()) {
    const common = { id: config.roleConfigIds[r], version: '8', catalog_id: config.catalogId, product_binding_commitment: tuple };
    let shape = { id: bcs.Address, version: bcs.u64(), catalog_id: bcs.Address, product_binding_commitment: V };
    let fields = { ...common };
    if (['physical', 'market', 'release'].includes(r)) { shape.call_cap_set_commitment = V; fields.call_cap_set_commitment = caps; }
    const opts = { seal_policy_commitment: r === 'seal' ? policyHash : null, key_server_set_commitment: r === 'seal' ? keysHash : null,
      encryption_policy_commitment: r === 'seal' ? encryptionHash : null, external_validator_policy_id: null, external_validator_registry_id: null,
      soul_binding_registry_id: null, runtime_caller_cap_commitment: null, bootstrap_certificate_id: null, bootstrap_certificate_commitment: null };
    const installation = hash({ role: bcs.u8(), config_id: bcs.Address, catalog_id: bcs.Address, package_tuple_commitment: V,
      call_cap_set_commitment: V, authority_id: bcs.Address, finalized: bcs.bool(), ...Object.fromEntries(Object.keys(opts).map(k => [k, bcs.option(k.endsWith('_id') ? bcs.Address : V)])) },
    { role: index + 1, config_id: common.id, catalog_id: config.catalogId, package_tuple_commitment: tuple, call_cap_set_commitment: caps,
      authority_id: auth[`${r}_authority_id`], finalized: ['seal', 'physical'].includes(r), ...opts }, 'animacraft-fresh-v8/package/role-config/v2');
    installHashes.push(installation);
    if (r === 'seal') {
      shape = { id: bcs.Address, version: bcs.u64(), protocol_config_id: bcs.Address, protocol_config_revision: bcs.u64(), catalog_id: bcs.Address,
        product_binding_commitment: V, seal_original_package_id: bcs.Address, seal_callable_package_id: bcs.Address, seal_binding_commitment: V,
        seal_authority_id: bcs.Address, call_cap_set_commitment: V, role: bcs.u8(), finalized: bcs.bool(),
        key_servers: bcs.vector(bcs.struct('KeyServer', { key_server_id: bcs.Address, weight: bcs.u16() })), threshold: bcs.u16(),
        cipher_suite: bcs.string(), key_derivation: bcs.string(), ciphertext_format: bcs.string(), max_plaintext_bytes: bcs.u64(),
        key_server_set_commitment: V, encryption_policy_commitment: V, commitment: V, config_commitment: V };
      fields = { ...common, protocol_config_id: config.protocolConfigId, protocol_config_revision: '1', seal_original_package_id: config.roles.seal.typeOriginPackageId,
        seal_callable_package_id: config.roles.seal.callablePackageId, seal_binding_commitment: hashes.seal_binding_commitment, seal_authority_id: auth.seal_authority_id,
        call_cap_set_commitment: caps, role: 1, finalized: true, key_servers: keyServers, threshold,
        cipher_suite: 'BonehFranklinBLS12381DemCCA/AesGcm256', key_derivation: 'SHA3-256:SUI-SEAL-IBE-BLS12381-H2-00:SUI-SEAL-IBE-BLS12381-H3-00', ciphertext_format: 'Seal/EncryptedObject/BCS/v0', max_plaintext_bytes: '10',
        key_server_set_commitment: keysHash, encryption_policy_commitment: encryptionHash, commitment: policyHash, config_commitment: installation };
    } else { shape.installation_commitment = V; fields.installation_commitment = installation; }
    if (['output', 'market'].includes(r)) {
      const cap = { schema_revision: '2', role: r === 'output' ? 0 : 1, catalog_id: config.catalogId, replacement_binding_id: replacement.id,
        package_tuple_commitment: tuple, caller_original_package_id: config.roles[r].typeOriginPackageId,
        caller_callable_package_id: config.roles[r].callablePackageId, call_cap_set_commitment: caps };
      cap.cap_commitment = hash(Object.fromEntries(Object.entries(callerShape).filter(([k]) => !['schema_revision', 'cap_commitment'].includes(k))), cap, 'animacraft-fresh-v8/core/runtime-caller-cap/v1');
      shape.runtime_caller_cap = bcs.option(bcs.struct('Caller', callerShape)); fields.runtime_caller_cap = cap;
      marks.push(hash({ replacement_binding_id: bcs.Address, role: bcs.u8(), install_kind: bcs.u8(), config_id: bcs.Address,
        installed_object_id: bcs.option(bcs.Address), installed_commitment: V, role_witness_type_name: bcs.string() },
      { replacement_binding_id: replacement.id, role: index + 1, install_kind: r === 'output' ? 4 : 8, config_id: common.id,
        installed_object_id: null, installed_commitment: cap.cap_commitment,
        role_witness_type_name: `${config.roles[r].typeOriginPackageId.slice(2)}::${r}_v8::${r === 'output' ? 'Output' : 'Market'}RuntimeCallerCapInstallWitnessV2` }, 'animacraft-fresh-v8/core/fresh-tuple-bootstrap-install-mark/v2'));
    }
    put(common.id, type(r, r === 'runtime' ? 'runtime_binding_v8' : `${r}_v8`, r === 'seal' ? 'SealPolicyConfigV8' : `${r[0].toUpperCase()}${r.slice(1)}PackageConfigV8`), shape, fields);
  }
  const catalog = { id: config.catalogId, schema_revision: '2', protocol_config_id: config.protocolConfigId, protocol_config_revision: '1', protocol_config_commitment: h(92),
    binding: { bindings, commitment: tuple }, authority_ids: Object.values(auth), call_cap_set_commitment: caps, next_setup_role: 6,
    role_config_ids: Object.values(config.roleConfigIds), role_config_commitments: installHashes };
  catalog.catalog_commitment = hash({ catalog_id: bcs.Address, protocol_config_id: bcs.Address, protocol_config_revision: bcs.u64(), protocol_config_commitment: V,
    package_tuple_commitment: V, call_cap_set_commitment: V, native_capability_mask: bcs.u64(), ...authorities },
  { ...catalog, catalog_id: catalog.id, package_tuple_commitment: tuple, native_capability_mask: 127, ...auth }, 'animacraft-fresh-v8/core/catalog/v2');
  put(catalog.id, type('core', 'package_binding_v8', 'ProductReleaseCatalogV8'), {
    id: bcs.Address, schema_revision: bcs.u64(), protocol_config_id: bcs.Address, protocol_config_revision: bcs.u64(), protocol_config_commitment: V,
    binding: bcs.struct('Product', { bindings: bcs.vector(bcs.struct('Binding', bindingShape)), commitment: V }), authority_ids: bcs.vector(bcs.Address),
    call_cap_set_commitment: V, catalog_commitment: V, next_setup_role: bcs.u8(), role_config_ids: bcs.vector(bcs.Address), role_config_commitments: bcs.vector(V),
  }, catalog);
  const cert = { id: sid(61), version: '2', replacement_binding_id: replacement.id, catalog_id: catalog.id,
    package_tuple_commitment: tuple, call_cap_set_commitment: caps, install_mask: 12, install_mark_commitments: marks };
  cert.certificate_commitment = hash({ certificate_id: bcs.Address, replacement_binding_id: bcs.Address, catalog_id: bcs.Address,
    package_tuple_commitment: V, call_cap_set_commitment: V, install_mask: bcs.u8(), ordered_install_mark_commitments: bcs.vector(V) },
  { ...cert, certificate_id: cert.id, ordered_install_mark_commitments: marks }, 'animacraft-fresh-v8/core/fresh-tuple-bootstrap-certificate/v2');
  put(cert.id, type('core', 'package_binding_v8', 'FreshTupleBootstrapCertificateV2'), certificateShape, cert, true);
  const slot = { state: 2, replacement_binding_id: replacement.id, admin_id: null, certificate_id: cert.id, certificate_commitment: cert.certificate_commitment };
  const keyType = type('core', 'package_binding_v8', 'FreshTupleBootstrapSlotKeyV2');
  const valueType = type('core', 'package_binding_v8', 'FreshTupleBootstrapSlotV2');
  const field = { kind: 'DynamicField', childId: null, type: `0x2::dynamic_field::Field<${keyType},${valueType}>`, name: { type: keyType, bcsBase64: 'AA==' },
    fieldId: deriveDynamicFieldID(catalog.id, keyType, new Uint8Array([0])),
    value: { type: valueType, bcsBase64: toBase64(bcs.struct('Slot', slotShape).serialize(slot).toBytes()) } };
  const rpc = { async getChainIdentifier() { return '35834a8a'; }, async getObject({ id }) {
    if (objects.has(id)) return objects.get(id);
    const role = roles.find(r => config.roles[r].callablePackageId === id);
    return { data: { objectId: id, version: '1', digest: '3'.repeat(44), owner: { Immutable: true }, bcs: { dataType: 'package', moduleMap: role === 'core' ? { base_registry_v8: CORE_BASE_REGISTRY_MODULE_BASE64 } : {} } } };
  }, async getDynamicField(input) { assert.equal(input.parentId, catalog.id); assert.deepEqual(input.name, field.name); return field; } };
  const sync = id => { const data = objects.get(id).data; data.bcs.bcsBytes = toBase64(bcs.struct('Object', schemas.get(id)).serialize(data.content.fields).toBytes()); };
  const resealCertificate = () => {
    cert.certificate_commitment = hash({ certificate_id: bcs.Address, replacement_binding_id: bcs.Address, catalog_id: bcs.Address,
      package_tuple_commitment: V, call_cap_set_commitment: V, install_mask: bcs.u8(), ordered_install_mark_commitments: bcs.vector(V) },
    { ...cert, certificate_id: cert.id, ordered_install_mark_commitments: cert.install_mark_commitments }, 'animacraft-fresh-v8/core/fresh-tuple-bootstrap-certificate/v2');
    slot.certificate_commitment = cert.certificate_commitment;
    field.value.bcsBase64 = toBase64(bcs.struct('Slot', slotShape).serialize(slot).toBytes());
    sync(cert.id);
  };
  return { rpc, config, objects, field, slot, sync, replacement, cert, resealCertificate };
}

test('certified slot yields only the verified immutable replacement reference', async () => {
  const f = fixture();
  assert.throws(() => makerV8AttestedReplacement(f.config));
  const result = await attestMakerV8Runtime(f.rpc, f.config);
  assert.equal(isMakerV8RuntimeAttested(result.runtime), true);
  assert.equal(makerV8AttestedReplacement(result.runtime).objectId, f.replacement.id);
  assert.equal(result.bootstrapCertificate.objectId, f.cert.id);
  assert.equal(result.replacement.owner.kind, 'immutable');
});

test('runtime authority rejects stale, forged and incompletely installed evidence', async t => {
  const cases = {
    'missing BCS': f => { delete f.objects.get(f.config.catalogId).data.bcs; },
    'catalog tuple hash': f => { f.objects.get(f.config.catalogId).data.content.fields.binding.commitment = h(99); f.sync(f.config.catalogId); },
    'setup not complete': f => { f.objects.get(f.config.catalogId).data.content.fields.next_setup_role = 5; f.sync(f.config.catalogId); },
    'JSON BCS disagreement': f => { f.objects.get(f.config.roleConfigIds.output).data.content.fields.installation_commitment = h(99); },
    'installation commitment': f => { f.objects.get(f.config.roleConfigIds.output).data.content.fields.installation_commitment = h(99); f.sync(f.config.roleConfigIds.output); },
    'missing caller cap': f => { f.objects.get(f.config.roleConfigIds.output).data.content.fields.runtime_caller_cap = null; f.sync(f.config.roleConfigIds.output); },
    'wrong caller role': f => { f.objects.get(f.config.roleConfigIds.market).data.content.fields.runtime_caller_cap.role = 0; f.sync(f.config.roleConfigIds.market); },
    'slot not certified': f => { f.slot.state = 1; f.field.value.bcsBase64 = toBase64(bcs.struct('Slot', slotShape).serialize(f.slot).toBytes()); },
    'wrong slot key': f => { f.field.name.type = f.field.value.type; },
    'wrong slot parent identity': f => { f.field.fieldId = sid(99); },
    'mutable replacement': f => { f.objects.get(f.replacement.id).data.owner = { Shared: { initial_shared_version: '1' } }; },
    'replacement config mismatch': f => { f.replacement.output_config_id = sid(99); f.sync(f.replacement.id); },
    'certificate incomplete': f => { f.cert.install_mask = 7; f.sync(f.cert.id); },
    'certificate install hash': f => { f.cert.install_mark_commitments[0] = h(99); f.sync(f.cert.id); },
    'rehashing certificate cannot fake caller installation': f => { f.cert.install_mark_commitments[0] = h(99); f.resealCertificate(); },
    'rehashing certificate cannot fake market installation': f => { f.cert.install_mark_commitments[1] = h(99); f.resealCertificate(); },
    'obsolete four-install bootstrap is rejected': f => { f.cert.install_mask = 15; f.cert.install_mark_commitments.unshift(h(71), h(72)); f.resealCertificate(); },
    'two installs cannot be reordered': f => { f.cert.install_mark_commitments.reverse(); f.resealCertificate(); },
    'two installs cannot be duplicated': f => { f.cert.install_mark_commitments[1] = f.cert.install_mark_commitments[0]; f.resealCertificate(); },
    'mask 12 cannot retain obsolete marks': f => { f.cert.install_mark_commitments.unshift(h(71), h(72)); f.resealCertificate(); },
    'trailing BCS bytes': f => { const data = f.objects.get(f.config.roleConfigIds.runtime).data; data.bcs.bcsBytes = toBase64(new Uint8Array([...Buffer.from(data.bcs.bcsBytes, 'base64'), 0])); },
    'wrong BCS datatype': f => { f.objects.get(f.replacement.id).data.bcs.type = f.objects.get(f.cert.id).data.type; },
    'seal key-server evidence drift': f => { f.objects.get(f.config.roleConfigIds.seal).data.content.fields.key_servers[0].weight = 2; f.sync(f.config.roleConfigIds.seal); },
  };
  for (const [name, mutate] of Object.entries(cases)) await t.test(name, async () => {
    const f = fixture(); mutate(f); await assert.rejects(attestMakerV8Runtime(f.rpc, f.config));
    assert.throws(() => makerV8AttestedReplacement(f.config));
  });
});

test('Seal authority permits 254 shares and rejects SDK-unencryptable committed policies', async () => {
  for (const weights of [[254], [127, 127]]) {
    const f = fixture({ weights, threshold: 254 });
    assert.equal((await attestMakerV8Runtime(f.rpc, f.config)).replacement.objectId, f.replacement.id);
  }
  for (const settings of [
    { weights: [127, 128], threshold: 1 },
    { weights: [255], threshold: 255 },
    { weights: [254], threshold: 255 },
    { weights: [65535], threshold: 1 },
  ]) {
    // Build every dependent commitment from these values: rejection must be
    // the wire-profile bound, not a stale hash from an unrelated mutation.
    const f = fixture(settings);
    await assert.rejects(attestMakerV8Runtime(f.rpc, f.config), /Seal key servers/);
    assert.throws(() => makerV8AttestedReplacement(f.config));
  }
});

test('authority JSON accepts canonical Base64 only for schema byte vectors', async () => {
  const f = fixture();
  const catalog = f.objects.get(f.config.catalogId).data.content;
  // Clone JSON separately: its projection must not change the raw BCS object.
  catalog.fields = structuredClone(catalog.fields);
  catalog.fields.protocol_config_commitment = toBase64(new Uint8Array(catalog.fields.protocol_config_commitment));
  catalog.fields.binding.bindings[0].source_commitment = toBase64(new Uint8Array(catalog.fields.binding.bindings[0].source_commitment));
  catalog.fields.role_config_commitments = catalog.fields.role_config_commitments.map(bytes => toBase64(new Uint8Array(bytes)));
  const output = f.objects.get(f.config.roleConfigIds.output).data.content;
  output.fields = structuredClone(output.fields);
  output.fields.runtime_caller_cap.cap_commitment = toBase64(new Uint8Array(output.fields.runtime_caller_cap.cap_commitment));
  assert.equal((await attestMakerV8Runtime(f.rpc, f.config)).replacement.objectId, f.replacement.id);
  catalog.fields = structuredClone(catalog.fields);
  catalog.fields.protocol_config_commitment = catalog.fields.protocol_config_commitment.replace(/=+$/, '');
  await assert.rejects(attestMakerV8Runtime(f.rpc, f.config));
  const other = fixture();
  other.objects.get(other.config.catalogId).data.content.fields.authority_ids = '';
  await assert.rejects(attestMakerV8Runtime(other.rpc, other.config));
  const structs = fixture();
  structs.objects.get(structs.config.roleConfigIds.seal).data.content.fields.key_servers = '';
  await assert.rejects(attestMakerV8Runtime(structs.rpc, structs.config));
});
