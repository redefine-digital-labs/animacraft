import assert from 'node:assert/strict';
import test from 'node:test';
import { bcs } from '@mysten/sui/bcs';
import { deriveDynamicFieldID, fromBase64, normalizeStructTag, toBase64 } from '@mysten/sui/utils';
import { MAKER_V8_CLOCK_OBJECT_ID, MAKER_V8_PAYMENT_COIN_TYPE, MAKER_V8_RUNTIME_SCHEMA } from '../maker-v8-runtime.js';
import { discoverMakerV8PackReleases, makerV8ChainTypes, MAKER_V8_MAINNET_CHAIN_IDENTIFIER } from '../maker-v8-chain.js';

const id = n => `0x${BigInt(n).toString(16).padStart(64, '0')}`;
const hash = n => Array(32).fill(n);
const bytes = bcs.vector(bcs.u8());
const table = bcs.struct('Table', { id: bcs.Address, size: bcs.u64() });
// Independent, exact layouts from runtime_v8.move; fixtures include every field
// so JSON-only substitutions cannot accidentally exercise the happy path.
const registryBcs = bcs.struct('PackRegistryV8', {
  id: bcs.Address, version: bcs.u64(), root_id: bcs.Address, root_version: bcs.u64(),
  root_content_commitment: bytes, definition_registry_id: bcs.Address, admission_authority_id: bcs.Address,
  admission_policy_commitment: bytes, revision: bcs.u64(), release_count: bcs.u64(),
  external_admission_count: bcs.u64(), wardrobe_revision: bcs.u64(), base_item_count: bcs.u64(),
  releases: table, semantic_releases: table, external_admissions: table, base_item_owners: table,
});
const releaseBcs = bcs.struct('PackReleaseV8', {
  id: bcs.Address, version: bcs.u64(), root_id: bcs.Address, root_version: bcs.u64(),
  root_content_commitment: bytes, creator: bcs.Address, owner: bcs.Address, control_epoch: bcs.u64(),
  admin_cap_id: bcs.Address, treasury_id: bcs.Address, semantic_pack_id: bcs.string(),
  manifest_blob_id: bcs.string(), manifest_sha256: bytes, content_commitment: bytes,
  lifecycle: bcs.u8(), access_kind: bcs.u8(), access_price_atomic: bcs.u64(),
  complete_mode: bcs.u8(), complete_price_atomic: bcs.u64(), complete_free_quota_per_wallet: bcs.u64(),
  complete_total_cap: bcs.u64(), expected_style_count: bcs.u64(), observed_style_count: bcs.u64(),
  expected_style_commitment: bytes, rolling_style_commitment: bytes, protected_style_count: bcs.u64(),
  pass_count: bcs.u64(), total_complete_count: bcs.u64(), styles: table, complete_by_wallet: table,
});
const admissionBcs = bcs.struct('PackAdmissionRecordV8', {
  release_id: bcs.Address, semantic_pack_id: bcs.string(), release_content_commitment: bytes,
  admitted_revision: bcs.u64(), admission_state: bcs.u8(),
});

function fixture(count = 3) {
  const runtime = {
    schemaVersion: MAKER_V8_RUNTIME_SCHEMA, protocolVersion: 8, enabled: true,
    catalogId: id(20), protocolConfigId: id(21), protocolTreasuryId: id(22),
    paymentCoinType: MAKER_V8_PAYMENT_COIN_TYPE, clockObjectId: MAKER_V8_CLOCK_OBJECT_ID,
    roles: Object.fromEntries(['core', 'seal', 'runtime', 'output', 'physical', 'market', 'release']
      .map((role, i) => [role, { typeOriginPackageId: id(i * 2 + 1), callablePackageId: id(i * 2 + 1) }])),
    roleConfigIds: Object.fromEntries(['seal', 'runtime', 'output', 'physical', 'market', 'release'].map((role, i) => [role, id(23 + i)])),
    makerBindings: [],
  };
  const types = makerV8ChainTypes(runtime);
  const root = { objectId: id(100), makerVersion: 1n, lifecycle: 'ACTIVE', contentCommitment: 'ab'.repeat(32),
    binding: { runtimeDefinitionRegistryId: id(104), packRegistryId: id(105), packAdmissionAuthorityId: id(106) },
    fields: { expected_pack_admission_policy_commitment: hash(0xcd) } };
  const rootFields = { root_id: root.objectId, root_version: '1', root_content_commitment: hash(0xab) };
  const objects = new Map();
  const object = (type, schema, fields) => ({ data: {
    objectId: fields.id, version: '7', digest: '5'.repeat(44), type,
    owner: { Shared: { initial_shared_version: '1' } },
    content: { dataType: 'moveObject', type, fields },
    bcs: { dataType: 'moveObject', type, bcsBytes: toBase64(schema.serialize(fields).toBytes()) },
  } });
  const registry = object(types.packRegistry, registryBcs, {
    id: id(105), version: '8', ...rootFields, definition_registry_id: id(104), admission_authority_id: id(106),
    admission_policy_commitment: hash(0xcd), revision: '9', release_count: String(count),
    external_admission_count: '0', wardrobe_revision: '0', base_item_count: '0',
    releases: { id: id(200), size: String(count) }, semantic_releases: { id: id(201), size: String(count) },
    external_admissions: { id: id(202), size: '0' }, base_item_owners: { id: id(203), size: '0' },
  });
  objects.set(id(105), registry);
  const valueType = `${id(5)}::runtime_v8::PackAdmissionRecordV8`;
  const keyType = normalizeStructTag('0x2::object::ID');
  const rowFor = value => {
    const key = bcs.Address.serialize(value.release_id).toBytes();
    return { kind: 'DynamicField', childId: null, fieldId: deriveDynamicFieldID(id(200), keyType, key),
      type: normalizeStructTag(`0x2::dynamic_field::Field<${keyType},${valueType}>`),
      name: { type: keyType, bcsBase64: toBase64(key) },
      value: { type: valueType, bcsBase64: toBase64(admissionBcs.serialize(value).toBytes()) } };
  };
  const rows = [];
  const releases = [];
  for (let i = 0; i < count; i++) {
    const release = object(types.packRelease, releaseBcs, {
      id: id(300 + i), version: '8', ...rootFields, creator: id(400), owner: id(400),
      control_epoch: '0', admin_cap_id: id(410 + i), treasury_id: id(420 + i), semantic_pack_id: `pack_${i}`,
      manifest_blob_id: `pack-manifest-${i}`, manifest_sha256: hash(0xef), content_commitment: hash(i + 1),
      lifecycle: 2, access_kind: i % 3, access_price_atomic: i % 3 === 1 ? '1250000' : '0',
      complete_mode: 0, complete_price_atomic: '0', complete_free_quota_per_wallet: '0', complete_total_cap: '0',
      expected_style_count: '1', observed_style_count: '1', expected_style_commitment: hash(1), rolling_style_commitment: hash(1),
      protected_style_count: '0', pass_count: '0', total_complete_count: '0',
      styles: { id: id(430 + i), size: '1' }, complete_by_wallet: { id: id(440 + i), size: '0' },
    });
    releases.push(release); objects.set(release.data.objectId, release);
    rows.push(rowFor({ release_id: release.data.objectId, semantic_pack_id: `pack_${i}`,
      release_content_commitment: hash(i + 1), admitted_revision: String(i + 1), admission_state: 0 }));
  }
  const calls = { registry: 0, release: 0, list: 0, point: 0 };
  const rpc = {
    async getChainIdentifier() { return MAKER_V8_MAINNET_CHAIN_IDENTIFIER; },
    async getObject(input) {
      assert.equal(input.options.showBcs, true);
      calls[input.id === id(105) ? 'registry' : 'release'] += 1;
      return structuredClone(objects.get(input.id));
    },
    async listDynamicFields(input) {
      assert.equal(input.parentId, id(200)); calls.list += 1;
      const offset = input.cursor === null ? 0 : Number(input.cursor);
      return { data: structuredClone(rows.slice(offset, offset + 2)), hasNextPage: offset + 2 < rows.length, nextCursor: String(offset + 2) };
    },
    async getDynamicField(input) {
      assert.equal(input.parentId, id(200)); calls.point += 1;
      return structuredClone(rows.find(row => row.name.bcsBase64 === input.name.bcsBase64));
    },
  };
  const reencode = obj => { obj.data.bcs.bcsBytes = toBase64((obj === registry ? registryBcs : releaseBcs).serialize(obj.data.content.fields).toBytes()); };
  const mutateAdmission = (i, changes) => { rows[i] = rowFor({ ...admissionBcs.parse(fromBase64(rows[i].value.bcsBase64)), ...changes }); };
  return { runtime, root, objects, registry, releases, rows, rpc, calls, reencode, mutateAdmission,
    run: () => discoverMakerV8PackReleases(rpc, runtime, root) };
}

test('public discovery enumerates exact root admission pages without any owned Pass and returns canonical free/paid/included entry', async () => {
  const f = fixture(); const result = await f.run();
  assert.equal(result.length, 3);
  assert.deepEqual(result.map(release => release.entry), [
    { kind: 0, priceAtomic: '0', paymentCoinType: MAKER_V8_PAYMENT_COIN_TYPE },
    { kind: 1, priceAtomic: '1250000', paymentCoinType: MAKER_V8_PAYMENT_COIN_TYPE },
    { kind: 2, priceAtomic: '0', paymentCoinType: MAKER_V8_PAYMENT_COIN_TYPE },
  ]);
  assert.deepEqual(f.calls, { registry: 2, release: 3, list: 2, point: 3 });
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result[0].entry));
  assert.equal(result[0].registryRevision, '9');
});

test('paused, archived and revoked admissions are excluded; zero registry is valid', async () => {
  const f = fixture(4);
  f.releases[1].data.content.fields.lifecycle = 3; f.reencode(f.releases[1]);
  f.releases[2].data.content.fields.lifecycle = 4; f.reencode(f.releases[2]);
  f.mutateAdmission(3, { admission_state: 1 });
  assert.deepEqual((await f.run()).map(row => row.objectId), [id(300)]);
  assert.equal(f.calls.release, 3, 'revoked row does not trigger a public manifest/Release read');
  assert.deepEqual(await fixture(0).run(), []);
});

test('public discovery rejects exact-key, table identity, canonical BCS and admission drift', async t => {
  for (const [label, mutate] of Object.entries({
    fieldId: f => { f.rows[0].fieldId = id(999); },
    fieldType: f => { f.rows[0].type = '0x2::object::ID'; },
    keyType: f => { f.rows[0].name.type = 'address'; },
    valueType: f => { f.rows[0].value.type = `${id(999)}::runtime_v8::PackAdmissionRecordV8`; },
    childId: f => { f.rows[0].childId = id(999); },
    kind: f => { f.rows[0].kind = 'DynamicObject'; },
    trailingKey: f => { f.rows[0].name.bcsBase64 = toBase64(new Uint8Array(33)); },
    trailingValue: f => { f.rows[0].value.bcsBase64 = toBase64(Uint8Array.from([...fromBase64(f.rows[0].value.bcsBase64), 0])); },
    state: f => f.mutateAdmission(0, { admission_state: 2 }),
    futureRevision: f => f.mutateAdmission(0, { admitted_revision: '10' }),
    zeroRevision: f => f.mutateAdmission(0, { admitted_revision: '0' }),
    commitment: f => f.mutateAdmission(0, { release_content_commitment: hash(9) }),
    semantic: f => f.mutateAdmission(0, { semantic_pack_id: 'other' }),
    duplicateId: f => { f.rows[1] = structuredClone(f.rows[0]); },
    duplicateSemantic: f => f.mutateAdmission(1, { semantic_pack_id: 'pack_0' }),
    missingRow: f => { f.rows.pop(); },
    pointRead: f => { const read = f.rpc.getDynamicField; f.rpc.getDynamicField = async input => { const row = await read(input); const value = admissionBcs.parse(fromBase64(row.value.bcsBase64)); value.admitted_revision = '8'; row.value.bcsBase64 = toBase64(admissionBcs.serialize(value).toBytes()); return row; }; },
  })) await t.test(label, async () => { const f = fixture(); mutate(f); await assert.rejects(f.run()); });
});

test('public discovery binds shared objects to Root, exact layouts, access policy and stable reread', async t => {
  for (const [label, mutate] of Object.entries({
    inactiveRoot: f => { f.root.lifecycle = 'PAUSED'; },
    wrongRoot: f => { f.registry.data.content.fields.root_id = id(999); f.reencode(f.registry); },
    wrongVersion: f => { f.registry.data.content.fields.root_version = '2'; f.reencode(f.registry); },
    wrongCommitment: f => { f.registry.data.content.fields.root_content_commitment = hash(9); f.reencode(f.registry); },
    definitions: f => { f.registry.data.content.fields.definition_registry_id = id(999); f.reencode(f.registry); },
    authority: f => { f.registry.data.content.fields.admission_authority_id = id(999); f.reencode(f.registry); },
    policy: f => { f.registry.data.content.fields.admission_policy_commitment = hash(9); f.reencode(f.registry); },
    registryOwner: f => { f.registry.data.owner = { AddressOwner: id(400) }; },
    registryType: f => { f.registry.data.type = `${id(999)}::runtime_v8::PackRegistryV8`; },
    registryJson: f => { f.registry.data.content.fields.revision = '10'; },
    registryBcs: f => { delete f.registry.data.bcs; },
    tableSize: f => { f.registry.data.content.fields.releases.size = '2'; f.reencode(f.registry); },
    releaseOwner: f => { f.releases[0].data.owner = { AddressOwner: id(400) }; },
    releaseRoot: f => { f.releases[0].data.content.fields.root_id = id(999); f.reencode(f.releases[0]); },
    releaseJson: f => { f.releases[0].data.content.fields.pass_count = '10'; },
    releaseBcs: f => { delete f.releases[0].data.bcs; },
    releaseTrailing: f => { const b = f.releases[0].data.bcs; b.bcsBytes = toBase64(Uint8Array.from([...fromBase64(b.bcsBytes), 0])); },
    releaseBcsType: f => { f.releases[0].data.bcs.type = f.registry.data.type; },
    releaseLifecycle: f => { f.releases[0].data.content.fields.lifecycle = 1; f.reencode(f.releases[0]); },
    invalidKind: f => { f.releases[0].data.content.fields.access_kind = 3; f.reencode(f.releases[0]); },
    freePrice: f => { f.releases[0].data.content.fields.access_price_atomic = '1'; f.reencode(f.releases[0]); },
    paidZero: f => { f.releases[1].data.content.fields.access_price_atomic = '0'; f.reencode(f.releases[1]); },
    paidOverflow: f => { f.releases[1].data.content.fields.access_price_atomic = '1000000000001'; f.reencode(f.releases[1]); },
    includedPrice: f => { f.releases[2].data.content.fields.access_price_atomic = '1'; f.reencode(f.releases[2]); },
    registryChanged: f => { const read = f.rpc.getObject; f.rpc.getObject = async input => { const result = await read(input); if (f.calls.registry === 2) result.data.version = '8'; return result; }; },
    repeatedCursor: f => { f.rpc.listDynamicFields = async () => ({ data: [f.rows[0]], hasNextPage: true, nextCursor: 'repeat' }); },
    emptyAdvancingPage: f => { f.rpc.listDynamicFields = async () => ({ data: [], hasNextPage: true, nextCursor: 'next' }); },
    invalidPage: f => { f.rpc.listDynamicFields = async () => ({ data: f.rows, hasNextPage: 'false' }); },
  })) await t.test(label, async () => { const f = fixture(); mutate(f); await assert.rejects(f.run()); });
});
