import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { bcs } from '@mysten/sui/bcs';
import { toBase58, fromBase64 } from '@mysten/sui/utils';
import { MAINNET_WALRUS_PACKAGE_CONFIG } from '@mysten/walrus';
import { buildNativeSoulBootstrapTransaction as build } from '../scripts/native-soul-bootstrap-transactions.mjs';
import { buildMainnetV8SealPolicyTemplate, buildMainnetV8FinalSealPolicy, MAINNET_V8_PAYMENT_COIN_TYPE, MAINNET_V8_DEFAULT_COMMITTEE } from '../scripts/mainnet-v8-release-lib.mjs';
import { MAKER_V8_SEAL_ENCRYPTION_PROFILE } from '../maker-v8-seal-profile.js';
import { makerV8WalrusExecutionFixture } from './fixtures/walrus-execution-fixture.js';

const roles = ['core', 'seal', 'runtime', 'output', 'physical', 'market', 'release', 'soulidity'];
const oid = n => '0x' + n.toString(16).padStart(64, '0');
const digest = toBase58(new Uint8Array(32).fill(9));
const sh = n => ({ objectId: oid(n), initialSharedVersion: '1' });
const own = n => ({ objectId: oid(n), version: '2', digest });
const hx = n => n.toString(16).padStart(2, '0').repeat(32);
function input(stage) {
  const base = { packageIds: Object.fromEntries(roles.map((role, i) => [role, oid(0x100 + i)])),
    protocolConfig: sh(0x200), protocolAdminCap: own(0x201) };
  if (stage === 'SETUP_RELEASE') {
    base.commitments = Object.fromEntries(roles.slice(0, 7).map((role, i) => [role,
      { source: hx(i * 3 + 1), package: hx(i * 3 + 2), abi: hx(i * 3 + 3) }]));
    base.sealPolicy = buildMainnetV8FinalSealPolicy({
      template: buildMainnetV8SealPolicyTemplate({ keyServers: [{ objectId: MAINNET_V8_DEFAULT_COMMITTEE, weight: '1' }], threshold: '1' }),
      sealPackageCommitment: base.commitments.seal.package, sealAbiCommitment: base.commitments.seal.abi });
    base.walrusSystem = { objectId: MAINNET_WALRUS_PACKAGE_CONFIG.systemObjectId, initialSharedVersion: '1' };
    base.walrusExecution = makerV8WalrusExecutionFixture();
  }
  if (['BEGIN_BOOTSTRAP', 'FINALIZE_BOOTSTRAP'].includes(stage)) {
    base.catalog = sh(0x202); base.replacement = own(0x203);
  }
  if (stage === 'FINALIZE_BOOTSTRAP') Object.assign(base, {
    bootstrapAdmin: own(0x204), outputConfig: sh(0x205), marketConfig: sh(0x206) });
  return structuredClone(base);
}
async function decoded(stage, value = input(stage)) {
  const tx = build(stage, value);
  const bytes = await tx.build({ onlyTransactionKind: true });
  const parsed = bcs.TransactionKind.parse(bytes);
  assert.equal(parsed.$kind, 'ProgrammableTransaction');
  assert.deepEqual(bcs.TransactionKind.serialize(parsed).toBytes(), bytes);
  assert.ok(parsed.ProgrammableTransaction.commands.every(c => c.$kind === 'MoveCall'));
  assert.equal(tx.getData().sender, null);
  assert.equal(tx.getData().gasData.payment, null);
  return parsed.ProgrammableTransaction;
}
const calls = graph => graph.commands.map(c => c.MoveCall);
const arg = (graph, ref) => graph.inputs[ref.Input];
const pure = (graph, ref, schema) => schema.parse(fromBase64(arg(graph, ref).Pure.bytes));
const reference = (graph, ref) => arg(graph, ref).Object;
const result = index => ({ Result: index, $kind: 'Result' });
const nested = (command, index) => ({ NestedResult: [command, index], $kind: 'NestedResult' });

test('INITIALIZE initializes actual USDC treasury then enables the same published config', async () => {
  const g = await decoded('INITIALIZE_PROTOCOL'); const c = calls(g);
  assert.deepEqual(c.map(c => c.function), ['initialize_protocol_treasury_v8', 'set_protocol_enabled_v8']);
  assert.equal(c[0].package, oid(0x100));
  assert.deepEqual(c[0].typeArguments, [MAINNET_V8_PAYMENT_COIN_TYPE]);
  assert.deepEqual(reference(g, c[0].arguments[0]).SharedObject, { ...sh(0x200), mutable: true });
  assert.deepEqual(reference(g, c[0].arguments[1]).ImmOrOwnedObject, own(0x201));
  assert.deepEqual(c[1].arguments.slice(0, 2), c[0].arguments);
  assert.equal(pure(g, c[1].arguments[2], bcs.Bool), true);
});
test('SETUP follows actual seven-role constructors with 14 exact marker types and delayed sharing', async () => {
  const value = input('SETUP_RELEASE'); const g = await decoded('SETUP_RELEASE', value); const c = calls(g);
  assert.equal(c.length, 37);
  assert.deepEqual(c.slice(0, 9).map(c => c.function), ['install_soulidity_binding_v8',
    ...Array(7).fill('new_package_commitments_v8'), 'certify_product_release_catalog_v8']);
  assert.deepEqual(c[0].typeArguments.map(t => t.split('::')),
    [['soul', 'Soul'], ['animacraft_v8_binding', 'MintBindingWitnessV8'], ['animacraft_v8_binding', 'SoulOwnerWitnessV8']]
      .map(([module, name]) => [value.packageIds.soulidity, module, name]));
  assert.equal(c[8].typeArguments.length, 14);
  assert.deepEqual(c[8].typeArguments, [
    ...Array(2).fill(value.packageIds.core + '::protocol_config_v8::CorePackageMarkerV8'),
    ...['seal', 'runtime', 'output', 'physical', 'market', 'release'].flatMap(role =>
      ['Original', 'Callable'].map(kind => value.packageIds[role] + '::' + role + '_v8::'
        + role[0].toUpperCase() + role.slice(1) + kind + 'MarkerV8')),
  ]);
  for (let i = 0; i < 7; i++) {
    assert.deepEqual(c[i + 1].arguments.map(ref => Buffer.from(pure(g, ref, bcs.vector(bcs.U8))).toString('hex')),
      Object.values(value.commitments[roles[i]]));
    for (let k = 0; k < 2; k++) assert.equal(c[8].typeArguments[i * 2 + k].split('::')[0], value.packageIds[roles[i]]);
    assert.deepEqual(c[8].arguments[i + 2], result(i + 1));
  }
  const roleModules = ['seal_v8', 'runtime_binding_v8', 'output_v8', 'physical_v8', 'market_v8', 'release_v8'];
  for (let i = 0; i < 6; i++) {
    const role = roles[i + 1], cap = 9 + i * 2, config = cap + 1;
    assert.equal(c[cap].function, 'take_' + role + '_call_cap_v8');
    assert.deepEqual(c[cap].arguments[2], result(8));
    assert.equal(c[config].package, value.packageIds[role]);
    assert.equal(c[config].module, roleModules[i]);
    assert.deepEqual(c[config].arguments[role === 'seal' ? 3 : 1], result(cap));
    assert.deepEqual(c[29 + i].arguments, [result(config)]);
    assert.match(c[29 + i].function, /^share_/);
  }
  assert.equal(c[21].function, 'assert_catalog_setup_complete_v2');
  assert.equal(c[22].function, 'bootstrap_walrus_certification_policy_v1');
  assert.equal(reference(g, c[22].arguments[3]).SharedObject.mutable, false);
  for (let i = 0; i < 4; i++) {
    assert.equal(c[23 + i].package, oid(2)); assert.equal(c[23 + i].module, 'object');
    assert.equal(c[23 + i].function, 'id');
    const getterRole = ['runtime', 'output', 'market', 'release'][i];
    assert.deepEqual(c[23 + i].typeArguments, [value.packageIds[getterRole] + '::'
      + (getterRole === 'runtime' ? 'runtime_binding_v8' : getterRole + '_v8') + '::'
      + getterRole[0].toUpperCase() + getterRole.slice(1) + 'PackageConfigV8']);
    assert.deepEqual(c[23 + i].arguments, [result([12, 14, 18, 20][i])]);
  }
  assert.deepEqual(c[27].arguments, [result(8), result(23), result(24), result(25), result(26)]);
  assert.deepEqual(c[28].arguments[3], result(27));
  assert.deepEqual(c[35].arguments, [result(8)]);
  assert.equal(c[35].function, 'share_product_release_catalog_v8');
  assert.equal(c[36].package, value.walrusExecution.package.reference.objectId);
  assert.equal(c[36].module, 'system');
  assert.equal(c[36].function, 'epoch');
  assert.deepEqual(c[36].typeArguments, []);
  assert.deepEqual(c[36].arguments, [c[22].arguments[3]]);
});
test('Seal constructor serializes eleven explicit inputs, real strings, bounds and weighted servers', async () => {
  const g = await decoded('SETUP_RELEASE'); const seal = calls(g)[10];
  assert.equal(seal.arguments.length, 11);
  assert.deepEqual(pure(g, seal.arguments[4], bcs.vector(bcs.Address)), [MAINNET_V8_DEFAULT_COMMITTEE]);
  assert.deepEqual(pure(g, seal.arguments[5], bcs.vector(bcs.U16)), [1]);
  assert.equal(pure(g, seal.arguments[6], bcs.U16), 1);
  assert.deepEqual(seal.arguments.slice(7, 10).map(a => pure(g, a, bcs.String)),
    Object.values(MAKER_V8_SEAL_ENCRYPTION_PROFILE));
  assert.equal(pure(g, seal.arguments[10], bcs.U64), '3145728');
});
test('BEGIN shares mutable catalog but only reads protocol and exact immutable replacement', async () => {
  const g = await decoded('BEGIN_BOOTSTRAP'), c = calls(g);
  assert.equal(c.length, 1); assert.equal(c[0].function, 'begin_fresh_tuple_bootstrap_v2');
  assert.deepEqual(c[0].arguments.map(a => reference(g, a).$kind),
    ['SharedObject', 'ImmOrOwnedObject', 'ImmOrOwnedObject', 'SharedObject']);
  assert.equal(reference(g, c[0].arguments[0]).SharedObject.mutable, false);
  assert.deepEqual(reference(g, c[0].arguments[2]).ImmOrOwnedObject, own(0x203));
  assert.equal(reference(g, c[0].arguments[3]).SharedObject.mutable, true);
});
test('FINALIZE consumes the real two minted caller Results once in correct order then consumes admin', async () => {
  const g = await decoded('FINALIZE_BOOTSTRAP'), c = calls(g);
  assert.deepEqual(c.map(c => c.function), ['mint_runtime_caller_caps_v1',
    'install_output_runtime_caller_cap_v2', 'install_market_runtime_caller_cap_v2', 'finalize_fresh_tuple_bootstrap_v2']);
  assert.deepEqual(c[1].arguments[5], nested(0, 0)); assert.deepEqual(c[2].arguments[5], nested(0, 1));
  assert.deepEqual(c[3].arguments, c[0].arguments);
  assert.deepEqual(c[1].arguments.slice(0, 4), [c[0].arguments[0], c[0].arguments[3], c[0].arguments[2], c[0].arguments[1]]);
  assert.deepEqual(c[2].arguments.slice(1, 5), c[1].arguments.slice(0, 4));
  assert.equal(reference(g, c[1].arguments[4]).SharedObject.objectId, oid(0x205));
  assert.equal(reference(g, c[2].arguments[0]).SharedObject.objectId, oid(0x206));
  assert.ok(!g.inputs.some(i => i.Object?.ImmOrOwnedObject?.objectId === oid(0x201)), 'unused protocol admin is not serialized');
});

// Actual Move sources, not a second handwritten ABI fixture.
function splitTop(text) {
  let depth = 0, begin = 0; const parts = [];
  for (let i = 0; i < text.length; i++) {
    if ('<('.includes(text[i])) depth++;
    if ('>)'.includes(text[i])) depth--;
    if (text[i] === ',' && depth === 0) { parts.push(text.slice(begin, i).trim()); begin = i + 1; }
  }
  if (text.slice(begin).trim()) parts.push(text.slice(begin).trim());
  return parts;
}
async function abi(role, module, name) {
  const path = new URL('../move/animacraft_v8_' + role + '/sources/' + module + '.move', import.meta.url);
  const source = (await readFile(path, 'utf8')).replace(/\/\/[^\n]*/g, '');
  const start = source.indexOf('public fun ' + name);
  assert.notEqual(start, -1, module + '::' + name + ' must be genuinely public');
  const tail = source.slice(start + ('public fun ' + name).length);
  const open = tail.indexOf('('), close = tail.indexOf(')', open);
  const generics = tail.slice(0, open).trim();
  const typeCount = generics.startsWith('<') ? splitTop(generics.slice(1, -1)).length : 0;
  const parameters = splitTop(tail.slice(open + 1, close));
  return { typeCount, parameters: parameters.filter(p => !/^ctx\s*:/.test(p)) };
}
for (const stage of ['INITIALIZE_PROTOCOL', 'SETUP_RELEASE', 'BEGIN_BOOTSTRAP', 'FINALIZE_BOOTSTRAP']) {
  test(stage + ' command arity/typeargs/shared-mutability match current public production Move ABI', async () => {
    const value = input(stage), g = await decoded(stage);
    const requiresMutable = new Set();
    for (const c of calls(g)) {
      if (c.package === oid(2)) {
        assert.equal(c.function, 'id'); assert.equal(c.arguments.length, 1); assert.equal(c.typeArguments.length, 1);
        continue;
      }
      const role = roles.find(r => value.packageIds[r] === c.package);
      if (!role && c.package === value.walrusExecution?.package.reference.objectId) {
        // External public ABI: epoch(&System): u32. Full execution is covered
        // by checks-enabled current-package simulation, not synthetic modules.
        assert.equal(c.module, 'system'); assert.equal(c.function, 'epoch');
        assert.equal(c.arguments.length, 1); assert.equal(c.typeArguments.length, 0);
        assert.deepEqual(reference(g, c.arguments[0]).SharedObject,
          { ...value.walrusSystem, mutable: false });
        continue;
      }
      const actual = await abi(role, c.module, c.function);
      assert.equal(c.arguments.length, actual.parameters.length, c.function);
      assert.equal(c.typeArguments.length, actual.typeCount, c.function);
      actual.parameters.forEach((p, index) => {
        if (p.includes('&mut ') && c.arguments[index].$kind === 'Input') requiresMutable.add(c.arguments[index].Input);
      });
    }
    g.inputs.forEach((i, index) => {
      if (i.Object?.SharedObject) assert.equal(i.Object.SharedObject.mutable, requiresMutable.has(index), 'input ' + index);
    });
  });
}
test('input order does not change bytes and later input mutation does not change the built transaction', async () => {
  const original = input('SETUP_RELEASE'), clone = structuredClone(original);
  const a = build('SETUP_RELEASE', original);
  original.commitments.core.source = hx(222); original.packageIds.core = oid(888);
  const b = build('SETUP_RELEASE', Object.fromEntries(Object.entries(clone).reverse()));
  assert.deepEqual(await a.build({ onlyTransactionKind: true }), await b.build({ onlyTransactionKind: true }));
});
const badCases = {
  'unknown stage': value => build('OTHER', value),
  'ctx rejected': value => build('INITIALIZE_PROTOCOL', { ...value, ctx: {} }),
  'zero package': value => { value.packageIds.core = oid(0); return build('INITIALIZE_PROTOCOL', value); },
  'duplicate roles': value => { value.packageIds.runtime = value.packageIds.core; return build('INITIALIZE_PROTOCOL', value); },
  'short package': value => { value.packageIds.core = '0x100'; return build('INITIALIZE_PROTOCOL', value); },
  'wrong version type': value => { value.protocolConfig.initialSharedVersion = 1; return build('INITIALIZE_PROTOCOL', value); },
  'zero version': value => { value.protocolConfig.initialSharedVersion = '0'; return build('INITIALIZE_PROTOCOL', value); },
  'overflow version': value => { value.protocolAdminCap.version = (1n << 64n).toString(); return build('INITIALIZE_PROTOCOL', value); },
  'malformed digest': value => { value.protocolAdminCap.digest = 'wrong'; return build('INITIALIZE_PROTOCOL', value); },
  'object aliases': value => { value.protocolAdminCap.objectId = value.protocolConfig.objectId; return build('INITIALIZE_PROTOCOL', value); },
  'wrong object shape': value => { value.protocolConfig.mutable = true; return build('INITIALIZE_PROTOCOL', value); },
  'missing package': value => { delete value.packageIds.soulidity; return build('INITIALIZE_PROTOCOL', value); },
};
for (const [name, attempt] of Object.entries(badCases)) test(name, () => assert.throws(() => attempt(input('INITIALIZE_PROTOCOL')), /NATIVE_SOUL_BOOTSTRAP/));
for (const [name, mutate] of Object.entries({
  'missing role commitment': v => { delete v.commitments.output; },
  'zero commitment': v => { v.commitments.core.source = hx(0); },
  'nonhex commitment': v => { v.commitments.core.abi = 'z'.repeat(64); },
  'different policy package commitment': v => { v.commitments.seal.package = hx(211); },
  'wrong Walrus System': v => { v.walrusSystem.objectId = oid(0xABC); },
  'missing Walrus execution': v => { delete v.walrusExecution; },
  'wrong execution digest': v => { v.walrusExecution.package.reference.digest = digest; },
  'wrong execution shared birth': v => { v.walrusSystem.initialSharedVersion = '2'; },
  'unknown policy field': v => { v.sealPolicy.secret = 'never accepted'; },
})) test(name, () => { const value = input('SETUP_RELEASE'); mutate(value); assert.throws(() => build('SETUP_RELEASE', value)); });
test('non-reviewed committee/share changes fail closed through the final policy assertion', () => {
  const value = input('SETUP_RELEASE');
  value.sealPolicy.keyServers[0].weight = '255';
  assert.throws(() => build('SETUP_RELEASE', value), /Seal/);
});
