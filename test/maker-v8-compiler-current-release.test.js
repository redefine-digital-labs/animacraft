import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bcs } from '@mysten/sui/bcs';
import { sha256 } from '@noble/hashes/sha2.js';
import { deriveMakerV8ReleaseCommitments as derive } from '../maker-v8-compiler.js';
import { currentRuntimeAuthorityFixture } from './fixtures/maker-v8-current-runtime-authority.js';
import { compilerSealPolicyFixture } from './fixtures/maker-v8-compiler-seal-policy.js';

const roles = ['core', 'seal', 'runtime', 'output', 'physical', 'market', 'release'];
const hex = bytes => Buffer.from(bytes).toString('hex');
const id = n => '0x' + n.toString(16).padStart(64, '0');
function fixture(config) {
  const authority = currentRuntimeAuthorityFixture(config);
  const catalog = authority.objects.get(authority.config.catalogId).data.content.fields;
  const input = { catalogId: catalog.id,
    roles: Object.fromEntries(roles.map((role, i) => {
      const row = catalog.binding.bindings[i];
      const module = role === 'core' ? 'protocol_config_v8' : role + '_v8';
      const prefix = role[0].toUpperCase() + role.slice(1);
      return [role, { originalPackageId: row.original_package_id, callablePackageId: row.callable_package_id,
        sourceCommitment: hex(row.source_commitment), packageCommitment: hex(row.package_commitment),
        abiCommitment: hex(row.abi_commitment), bindingCommitment: hex(row.commitment),
        originalMarkerType: `${row.original_package_id}::${module}::${prefix}${role === 'core' ? 'Package' : 'Original'}MarkerV8`,
        callableMarkerType: `${row.callable_package_id}::${module}::${prefix}${role === 'core' ? 'Package' : 'Callable'}MarkerV8` }];
    })), authorities: Object.fromEntries(roles.slice(1).map((role, i) => [role, catalog.authority_ids[i]])) };
  return { authority, catalog, input };
}

// Independent current Move declarations determine field order and primitive widths.
const move = readFileSync(new URL('../move/animacraft_v8_core/sources/package_binding_v8.move', import.meta.url), 'utf8');
function schema(name) {
  const text = new RegExp(`public struct ${name} has drop \\{([^}]+)\\}`).exec(move)?.[1];
  assert.ok(text, `current public Move ${name}`);
  const primitives = { String: bcs.String, u64: bcs.U64, u8: bcs.U8, ID: bcs.Address, 'vector<u8>': bcs.vector(bcs.U8) };
  return bcs.struct(name, Object.fromEntries(text.split(',').map(s => s.trim()).filter(Boolean).map(s => {
    const [key, type] = s.split(':').map(s => s.trim()); assert.ok(primitives[type], type); return [key, primitives[type]];
  })));
}
const sourceHash = (name, domain, values) => hex(sha256(schema(name).serialize({ domain, schema_revision: '2', ...values }).toBytes()));
function sourceExpected(input) {
  const bindings = Object.fromEntries(roles.map(role => [role, [...Buffer.from(input.roles[role].bindingCommitment, 'hex')]]));
  const callCapSetCommitment = sourceHash('PackageCallCapSetCommitmentInputV2', 'animacraft-fresh-v8/package/call-cap-set/v2', {
    catalog_id: input.catalogId, ...Object.fromEntries(roles.map(r => [r + '_binding_commitment', bindings[r]])),
    ...Object.fromEntries(roles.slice(1).map(r => [r + '_authority_id', input.authorities[r]])) });
  const productBindingCommitment = sourceHash('PackageTupleInputV2', 'animacraft-fresh-v8/package/product-tuple/v2', {
    catalog_id: input.catalogId, native_capability_mask: '127', call_cap_set_commitment: [...Buffer.from(callCapSetCommitment, 'hex')],
    ...Object.fromEntries(roles.map(r => [r + '_binding', bindings[r]])) });
  return { callCapSetCommitment, productBindingCommitment };
}
test('current chain fixture matches compiler seven role hashes, tuple and cap-set without legacy conversion', async () => {
  const f = fixture(), before = structuredClone(f.input), result = await derive(f.input);
  assert.deepEqual(f.input, before);
  assert.equal(result.productBindingCommitment, hex(f.catalog.binding.commitment));
  assert.equal(result.callCapSetCommitment, hex(f.catalog.call_cap_set_commitment));
  roles.forEach((role, i) => assert.equal(result.roles[role].bindingCommitment, hex(f.catalog.binding.bindings[i].commitment)));
  assert.deepEqual(result.authorities, f.input.authorities);
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.roles) && Object.isFrozen(result.roles.core));
  assert.deepEqual(sourceExpected(f.input), { callCapSetCommitment: result.callCapSetCommitment, productBindingCommitment: result.productBindingCommitment });
});
for (const role of roles) for (const key of ['sourceCommitment', 'packageCommitment', 'abiCommitment', 'bindingCommitment'])
  test(`${role}: changed ${key} with unchanged actual evidence rejects`, async () => {
    const f = fixture(); f.input.roles[role][key] = 'ab'.repeat(32);
    await assert.rejects(derive(f.input), { code: 'MAKER_V8_PACKAGE_BINDING_COMMITMENT_MISMATCH' });
  });
test('duplicate actual authority IDs reject, not silently hash an invalid setup', async () => {
  const f = fixture(); f.input.authorities.release = f.input.authorities.seal;
  await assert.rejects(derive(f.input), { code: 'MAKER_V8_CONFIG_AUTHORITY_MISMATCH' });
});
test('zero catalog cannot become an otherwise self-consistent release', async () => {
  const f = fixture(); f.input.catalogId = id(0);
  await assert.rejects(derive(f.input), { code: 'MAKER_V8_SUI_ID_INVALID' });
});
for (const role of roles.slice(1)) test(`${role}: zero authority rejects`, async () => {
  const f = fixture(); f.input.authorities[role] = id(0);
  await assert.rejects(derive(f.input), { code: 'MAKER_V8_CONFIG_AUTHORITY_MISMATCH' });
});
for (const [i, role] of roles.entries()) for (const key of ['originalPackageId', 'callablePackageId', 'sourceCommitment', 'packageCommitment', 'abiCommitment'])
  test(`${role}: zero ${key} rejects even with recomputed matching hash/marker`, async () => {
    const f = fixture(), row = f.input.roles[role]; row[key] = key.endsWith('Id') ? id(0) : '00'.repeat(32);
    if (key === 'originalPackageId') row.originalMarkerType = row.originalMarkerType.replace(f.catalog.binding.bindings[i].original_package_id, id(0));
    if (key === 'callablePackageId') row.callableMarkerType = row.callableMarkerType.replace(f.catalog.binding.bindings[i].callable_package_id, id(0));
    row.bindingCommitment = sourceHash('ExactPackageBindingInputV2', 'animacraft-fresh-v8/package/exact-binding/v2', {
      role: i, original_package_id: row.originalPackageId, callable_package_id: row.callablePackageId,
      source_commitment: Buffer.from(row.sourceCommitment, 'hex'), package_commitment: Buffer.from(row.packageCommitment, 'hex'),
      abi_commitment: Buffer.from(row.abiCommitment, 'hex'),
    });
    await assert.rejects(derive(f.input), { code: 'MAKER_V8_PACKAGE_BINDING_COMMITMENT_MISMATCH' });
  });
test('catalog change affects both cap-set and tuple but not exact package binding', async () => {
  const f = fixture(), original = await derive(f.input);
  const config = structuredClone(f.authority.config); config.catalogId = id(300);
  const next = fixture(config), result = await derive(next.input);
  assert.equal(result.productBindingCommitment, hex(next.catalog.binding.commitment));
  assert.equal(result.callCapSetCommitment, hex(next.catalog.call_cap_set_commitment));
  assert.notEqual(result.productBindingCommitment, original.productBindingCommitment);
  assert.notEqual(result.callCapSetCommitment, original.callCapSetCommitment);
  assert.deepEqual(result.roles, original.roles);
});
for (const role of roles.slice(1)) test(`${role}: actual authority change propagates through cap-set into tuple`, async () => {
  const f = fixture(), original = await derive(f.input); f.input.authorities[role] = id(300);
  const result = await derive(f.input), expected = sourceExpected(f.input);
  assert.equal(result.callCapSetCommitment, expected.callCapSetCommitment);
  assert.equal(result.productBindingCommitment, expected.productBindingCommitment);
  assert.notEqual(result.callCapSetCommitment, original.callCapSetCommitment);
  assert.notEqual(result.productBindingCommitment, original.productBindingCommitment);
});
test('retired V8 exact-binding domain/version/field layout does not pass current role verification', async () => {
  const f = fixture(), row = f.catalog.binding.bindings[0], vector = bcs.vector(bcs.U8);
  const legacy = bcs.struct('RetiredExactBinding', { domain: vector, version: bcs.U64,
    original_package_id: bcs.Address, callable_package_id: bcs.Address,
    source_commitment: vector, package_commitment: vector, abi_commitment: vector });
  f.input.roles.core.bindingCommitment = hex(sha256(legacy.serialize({ ...row,
    domain: new TextEncoder().encode('animacraft-v8/exact-package-binding'), version: '8' }).toBytes()));
  await assert.rejects(derive(f.input), { code: 'MAKER_V8_PACKAGE_BINDING_COMMITMENT_MISMATCH' });
});
test('current Move V2 exact binding includes ordered numeric role and schema revision', async () => {
  const f = fixture();
  for (const [i, role] of roles.entries()) {
    const row = f.catalog.binding.bindings[i];
    const expected = sourceHash('ExactPackageBindingInputV2', 'animacraft-fresh-v8/package/exact-binding/v2', { role: i, ...row });
    assert.equal(expected, f.input.roles[role].bindingCommitment);
    const wrongRole = sourceHash('ExactPackageBindingInputV2', 'animacraft-fresh-v8/package/exact-binding/v2', { role: (i + 1) % 7, ...row });
    const altered = structuredClone(f.input); altered.roles[role].bindingCommitment = wrongRole;
    await assert.rejects(derive(altered), { code: 'MAKER_V8_PACKAGE_BINDING_COMMITMENT_MISMATCH' });
  }
  for (const name of ['exact-binding', 'call-cap-set', 'product-tuple'])
    assert.ok(move.includes(`domain: b"animacraft-fresh-v8/package/${name}/v2".to_string()`));
});
for (const keyServerRows of [null, [{ key_server_id: id(401), weight: 2 }, { key_server_id: id(402), weight: 3 }]])
  test(`independent compiler Seal preimages match current authority BCS policy (${keyServerRows ? 'weighted servers' : 'single server'})`, () => {
    const f = currentRuntimeAuthorityFixture(null, { keyServerRows });
    const fields = f.objects.get(f.config.roleConfigIds.seal).data.content.fields;
    const context = { catalog: { reference: { objectId: f.config.catalogId } }, configs: { seal: {
      reference: { objectId: fields.id }, fields: {
        keyServerIds: fields.key_servers.map(r => r.key_server_id), weights: fields.key_servers.map(r => r.weight),
        threshold: fields.threshold, productBindingCommitment: hex(fields.product_binding_commitment),
        callCapSetCommitment: hex(fields.call_cap_set_commitment), encryptionPolicyCommitment: hex(fields.encryption_policy_commitment),
      },
    } } };
    const expected = compilerSealPolicyFixture(context);
    assert.equal(expected.keyServerSetCommitment, hex(fields.key_server_set_commitment));
    assert.equal(expected.commitment, hex(fields.commitment));
    const changed = structuredClone(context); changed.configs.seal.fields.weights[0]++;
    const different = compilerSealPolicyFixture(changed);
    assert.notEqual(different.keyServerSetCommitment, expected.keyServerSetCommitment);
    assert.notEqual(different.commitment, expected.commitment);
  });
