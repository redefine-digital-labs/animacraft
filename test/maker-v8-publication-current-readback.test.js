import assert from 'node:assert/strict';
import test from 'node:test';
import { readMakerV8CompilerHistoricalObjectV8 } from '../maker-v8-browser.js';
const id = n => `0x${BigInt(n).toString(16).padStart(64, '0')}`;
const digest = '11111111111111111111111111111111';
const hash = n => Array(32).fill(n);
const some = value => ({ fields: { vec: [value] } });
const rootType = `${id(51)}::maker_v8::MakerRootV8<0x2::sui::SUI>`;
const baseType = `${id(51)}::base_registry_v8::BaseDefinitionRegistryV8`;
const marketTreasuryType = `${id(52)}::market_v8::MarketTreasuryV8<0x2::sui::SUI>`;
async function read(parsed, fields, type = rootType) {
  const ref = { objectId: id(1), version: '7', digest, owner: { kind: 'Shared', value: { initialSharedVersion: '3' } } };
  return readMakerV8CompilerHistoricalObjectV8({ async getHistoricalObject() { return {
    objectId: ref.objectId, version: ref.version, digest, type, owner: { Shared: { initial_shared_version: '3' } }, previousTransaction: digest,
    parsed, contentBcs: new Uint8Array([1]), objectBcs: new Uint8Array([2]),
  }; } }, ref, type, 'publication object', fields, digest);
}
function root() {
  return { version: '8', maker_document_commitment: hash(1), creator_defaults_commitment: hash(2), living_content_binding_commitment: hash(3),
    content: { fields: { renderer_commitment: hash(4), manifest_blob_id: 'actual-manifest', manifest_sha256: hash(5), content_commitment: hash(6) } },
    base_registry_id: some(id(2)), maker_treasury_id: some(id(3)),
    economics: { fields: { protocol_config_id: id(4), protocol_config_revision: '9', protocol_config_commitment: hash(7), commitment: hash(8) } },
    rights: { fields: { commitment: hash(9) } },
    publication: { fields: { catalog_id: some(id(5)), sealed_base_registry_commitment: null,
      release_commitments: some({ fields: { product_binding_commitment: hash(10), call_cap_set_commitment: hash(11) } }) } } };
}

test('Market Treasury projects its actual escrow Balance into the compiler balance DTO', async () => {
  const input = { escrow: '0', gross_escrowed_atomic: '0', gross_released_atomic: '0' };
  assert.deepEqual((await read(input, ['balanceAtomic', 'grossEscrowedAtomic', 'grossReleasedAtomic'], marketTreasuryType)).fields,
    { balanceAtomic: '0', grossEscrowedAtomic: '0', grossReleasedAtomic: '0' });
});

test('Market Treasury rejects missing, shadowed and noncanonical escrow without changing other types', async () => {
  for (const escrow of [undefined, null, 0, '00', '-1', '1.0', '1e0', ' 0', '+0', '9'.repeat(100), '18446744073709551616', { value: '0' }, { fields: { value: '0' } }, []]) {
    await assert.rejects(read({ escrow }, ['balanceAtomic'], marketTreasuryType));
  }
  for (const shadow of ['balanceAtomic', 'balance_atomic']) {
    await assert.rejects(read({ [shadow]: '0' }, ['balanceAtomic'], marketTreasuryType));
    await assert.rejects(read({ escrow: '0', [shadow]: '0' }, ['balanceAtomic'], marketTreasuryType));
  }
  for (const value of ['1', '18446744073709551615']) {
    assert.equal((await read({ escrow: value }, ['balanceAtomic'], marketTreasuryType)).fields.balanceAtomic, value);
  }
  await assert.rejects(read({ escrow: '0' }, ['balanceAtomic'], baseType));
});
const fields = ['version', 'makerDocumentCommitment', 'creatorDefaultsCommitment', 'livingContentBindingCommitment', 'rendererCommitment', 'manifestBlobId', 'manifestSha256', 'contentCommitment', 'baseRegistryId', 'makerTreasuryId', 'protocolConfigId', 'protocolConfigRevision', 'protocolConfigCommitment', 'economicsCommitment', 'rightsCommitment', 'catalogId', 'productBindingCommitment', 'callCapSetCommitment', 'sealedBaseRegistryCommitment'];
test('historical publication Root projects actual nested content/economics/rights/slots without old flat sources', async () => {
  const value = await read(root(), fields);
  assert.deepEqual(value.fields, { version: 8, makerDocumentCommitment: '01'.repeat(32), creatorDefaultsCommitment: '02'.repeat(32), livingContentBindingCommitment: '03'.repeat(32), rendererCommitment: '04'.repeat(32), manifestBlobId: 'actual-manifest', manifestSha256: '05'.repeat(32), contentCommitment: '06'.repeat(32), baseRegistryId: id(2), makerTreasuryId: id(3), protocolConfigId: id(4), protocolConfigRevision: '9', protocolConfigCommitment: '07'.repeat(32), economicsCommitment: '08'.repeat(32), rightsCommitment: '09'.repeat(32), catalogId: id(5), productBindingCommitment: '0a'.repeat(32), callCapSetCommitment: '0b'.repeat(32), sealedBaseRegistryCommitment: null });
  assert.deepEqual(value.reference, { kind: 'shared', objectId: id(1), initialSharedVersion: '3' });
});
test('one-time storage seal supports native bytes and explicit singleton Option, but missing/ambiguous data rejects', async () => {
  for (const value of [some(hash(12)), '0c'.repeat(32), Buffer.from(hash(12)).toString('base64'), hash(12)]) {
    const input = root(); input.publication.fields.sealed_base_registry_commitment = value;
    assert.equal((await read(input, fields)).fields.sealedBaseRegistryCommitment, '0c'.repeat(32));
  }
  for (const value of [undefined, { vec: [hash(1), hash(2)] }, { vec: [hash(1)], extra: true }, [], [hash(1)], 'not-a-hash']) {
    const input = root(); input.publication.fields.sealed_base_registry_commitment = value;
    await assert.rejects(read(input, fields));
  }
});
test('removed Root nesting cannot be replaced by top-level shadow fields', async () => {
  for (const [nested, shadow, name] of [['content', 'renderer_commitment', 'rendererCommitment'], ['economics', 'protocol_config_id', 'protocolConfigId'], ['publication', 'product_binding_commitment', 'productBindingCommitment']]) {
    const input = root(); delete input[nested]; input[shadow] = name === 'protocolConfigId' ? id(4) : hash(4);
    await assert.rejects(read(input, [name]));
  }
});
test('Base history preserves all seven category counts and separates initial/rolling/sealed commitments', async () => {
  const categories = ['tracks', 'colors', 'parts', 'items', 'styles', 'rules', 'assets'];
  const commitments = seed => ({ fields: Object.fromEntries([...categories, 'aggregate'].map((key, index) => [key, hash(seed + index)])) });
  const input = { expected_counts: { fields: Object.fromEntries(categories.map((key, index) => [key, String(index)])) }, observed_counts: Object.fromEntries(categories.map((key, index) => [key, String(index)])), initial_commitments: commitments(1), rolling_commitments: commitments(9), sealed_commitments: some(commitments(17)), author_rows_rolling_commitment: hash(25) };
  const names = ['expectedCounts', 'observedCounts', 'initialCommitments', 'rollingCommitments', 'sealedCommitments', 'authorRowsRollingCommitment'];
  const result = (await read(input, names, baseType)).fields;
  assert.deepEqual(Object.keys(result.expectedCounts), categories);
  assert.equal(result.expectedCounts.assets, '6');
  assert.equal(result.initialCommitments.aggregate, '08'.repeat(32));
  assert.equal(result.rollingCommitments.aggregate, '10'.repeat(32));
  assert.equal(result.sealedCommitments.aggregate, '18'.repeat(32));
  const unsealed = structuredClone(input); unsealed.sealed_commitments = { vec: [] };
  assert.equal((await read(unsealed, names, baseType)).fields.sealedCommitments, null);
  const missing = structuredClone(input); delete missing.expected_counts.fields.assets;
  await assert.rejects(read(missing, names, baseType));
});

test('Seal history uses actual independent scope lanes and sealed commitment without legacy shadow fields', async () => {
  const type = `${id(52)}::seal_v8::SealRegistryV8`;
  const names = ['expectedBaseCount', 'expectedPackCount', 'expectedCompleteCount', 'baseCount', 'packCount', 'completeCount',
    'baseCommitment', 'packCommitment', 'completeCommitment', 'revision', 'commitment', 'sealed', 'runtimeRevision'];
  const input = { expected_base_count: '2', expected_pack_count: '0', expected_complete_count: '0',
    base_count: '1', pack_count: '0', complete_count: '0', base_commitment: hash(1), pack_commitment: hash(2),
    complete_commitment: hash(3), revision: '1', commitment: hash(4), sealed: false, runtime_revision: '0' };
  const result = (await read(input, names, type)).fields;
  assert.equal(result.baseCount, '1'); assert.equal(result.expectedBaseCount, '2');
  assert.equal(result.baseCommitment, '01'.repeat(32)); assert.equal(result.packCommitment, '02'.repeat(32));
  assert.equal(result.completeCommitment, '03'.repeat(32)); assert.equal(result.commitment, '04'.repeat(32));
  assert.equal(result.sealed, false); assert.equal(result.runtimeRevision, '0');
  const old = structuredClone(input); delete old.base_count; old.observed_base_count = '1';
  await assert.rejects(read(old, names, type));
  const malformed = structuredClone(input); malformed.complete_commitment = [3];
  await assert.rejects(read(malformed, names, type));
});
