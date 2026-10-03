import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveDynamicFieldID, toBase64, fromBase64 } from '@mysten/sui/utils';
import { readMakerV8PackDefinitions, findMakerV8PackDefinitions } from '../maker-v8-pack-definition-reader.js';
import { ObjectError } from '@mysten/sui/client';
import { MAKER_V8_PACK_DEFINITIONS_BCS, packDefinitionCommitmentV8 } from '../maker-v8-pack-definition-wire.js';
import { createMakerV8ChainClient } from '../maker-v8-chain.js';
import { currentRuntimeAuthorityFixture } from './fixtures/maker-v8-current-runtime-authority.js';

const id = n => `0x${n.toString(16).padStart(64, '0')}`;
const hex = bytes => Buffer.from(bytes).toString('hex');
test('optional discovery accepts only official notFound for the exact derived field', async () => {
  const f = fixture();
  const absent = new ObjectError('NOT_FOUND', 'missing', { reason: 'notFound', objectId: f.field.fieldId });
  const client = { getDynamicField: async () => { throw absent; } };
  const { definitionCommitment, ...unbound } = f.expected;
  assert.equal(await findMakerV8PackDefinitions(client, unbound), null);
  await assert.rejects(readMakerV8PackDefinitions(client, unbound), error => error === absent);
  await assert.rejects(findMakerV8PackDefinitions(client, f.expected), error => error === absent);
  for (const error of [new Error('NOT_FOUND'),
    new ObjectError('NOT_FOUND', 'missing', { reason: 'notFound', objectId: id(999) }),
    new ObjectError('NOT_FOUND', 'missing', { reason: 'notFound' }),
    new ObjectError('DELETED', 'deleted', { reason: 'deleted', objectId: f.field.fieldId })]) {
    await assert.rejects(findMakerV8PackDefinitions({ getDynamicField: async () => { throw error; } }, unbound), result => result === error);
  }
  assert.equal((await findMakerV8PackDefinitions(f.client, f.expected)).definitionCommitment, definitionCommitment);
});
function fixture(empty = false, origin = id(1)) {
  const expected = { runtimeOriginalPackageId: origin, releaseId: id(34), contentCommitment: '01'.repeat(32), semanticPackId: 'extras' };
  const rows = { semantic_pack_id: 'extras', tracks: empty ? [] : [{ sequence: '0', key: 'overlay', label: 'Overlay', render_order: '9', locked: false }],
    colors: [], parts: [], rules: [], visibility: [] };
  const stored = { version: '8', release_id: expected.releaseId, release_content_commitment: Array(32).fill(1), rows,
    commitment: [...packDefinitionCommitmentV8(expected.releaseId, Array(32).fill(1), rows)] };
  expected.definitionCommitment = hex(stored.commitment);
  const keyType = `${origin}::runtime_v8::PackDefinitionsKeyV8`, valueType = `${origin}::runtime_v8::PackDefinitionsV8`;
  const request = { parentId: expected.releaseId, name: { type: keyType, bcsBase64: 'AA==' } };
  const field = { kind: 'DynamicField', fieldId: deriveDynamicFieldID(expected.releaseId, keyType, new Uint8Array([0])),
    type: `0x2::dynamic_field::Field<${keyType},${valueType}>`, name: request.name,
    value: { type: valueType, bcsBase64: toBase64(MAKER_V8_PACK_DEFINITIONS_BCS.serialize(stored).toBytes()) } };
  const client = { async getDynamicField(input) { assert.deepEqual(input, request); return field; } };
  return { expected, stored, field, client };
}

test('exact official point read verifies immutable Pack rows and optional attachment commitment', async () => {
  const { client, expected } = fixture();
  const result = await readMakerV8PackDefinitions(client, expected);
  assert.equal(result.rows.tracks[0].key, 'overlay');
  assert.equal(result.definitionCommitment, expected.definitionCommitment);
  assert.throws(() => { result.rows.tracks[0].label = 'changed'; });
  const { definitionCommitment: _, ...releaseOnly } = expected;
  assert.deepEqual(await readMakerV8PackDefinitions(client, releaseOnly), result);
  const empty = fixture(true);
  assert.equal((await readMakerV8PackDefinitions(empty.client, empty.expected)).definitionCommitment,
    'f1adc4b85ba61f64a2061b721acaa691b3b20d01772b76d85860e6a7b65d82d4');
});

test('chain client uses configured type origin, never a caller-supplied package', async () => {
  const { config } = currentRuntimeAuthorityFixture();
  const f = fixture(false, config.roles.runtime.typeOriginPackageId);
  const client = createMakerV8ChainClient(config, { rpc: f.client });
  const result = await client.loadPackDefinitions({ ...f.expected, runtimeOriginalPackageId: id(99) });
  assert.equal(result.definitionCommitment, f.expected.definitionCommitment);
});

test('foreign field identity, key, type origin and object-field substitution reject', async () => {
  const mutations = [f => { f.fieldId = id(99); }, f => { f.childId = id(99); },
    f => { f.name = { ...f.name, bcsBase64: '' }; }, f => { f.name = { ...f.name, type: `${id(2)}::runtime_v8::PackDefinitionsKeyV8` }; },
    f => { f.type = f.type.replace(id(1), id(2)); }, f => { f.value.type = `${id(2)}::runtime_v8::PackDefinitionsV8`; },
    f => { f.kind = 'DynamicObject'; }];
  for (const mutate of mutations) {
    const f = fixture(); mutate(f.field);
    await assert.rejects(readMakerV8PackDefinitions(f.client, f.expected), { code: 'MAKER_V8_PACK_DEFINITIONS_READBACK_INVALID' });
  }
});

test('altered payload, stale release content, semantic ID and attachment hash reject', async () => {
  const mutations = [s => { s.version = '7'; }, s => { s.release_id = id(99); },
    s => { s.release_content_commitment[0] = 2; }, s => { s.rows.semantic_pack_id = 'other'; },
    s => { s.rows.tracks[0].render_order = '10'; }, s => { s.commitment[0] ^= 1; }];
  for (const mutate of mutations) {
    const f = fixture(); mutate(f.stored);
    f.field.value.bcsBase64 = toBase64(MAKER_V8_PACK_DEFINITIONS_BCS.serialize(f.stored).toBytes());
    await assert.rejects(readMakerV8PackDefinitions(f.client, f.expected), { code: 'MAKER_V8_PACK_DEFINITIONS_READBACK_INVALID' });
  }
  const f = fixture(); f.expected.definitionCommitment = '99'.repeat(32);
  await assert.rejects(readMakerV8PackDefinitions(f.client, f.expected), { code: 'MAKER_V8_PACK_DEFINITIONS_READBACK_INVALID' });
});

test('missing, oversized, malformed and noncanonical bytes never fall back to Base', async () => {
  for (const encoded of ['', '!!', 'A'.repeat(3_000_000), 'AA==']) {
    const f = fixture(); f.field.value.bcsBase64 = encoded;
    await assert.rejects(readMakerV8PackDefinitions(f.client, f.expected));
  }
  const f = fixture();
  f.field.value.bcsBase64 = toBase64(new Uint8Array([...fromBase64(f.field.value.bcsBase64), 0]));
  await assert.rejects(readMakerV8PackDefinitions(f.client, f.expected));
  await assert.rejects(readMakerV8PackDefinitions({ getDynamicField: async () => null }, f.expected));
  const unavailable = new Error('transport unavailable');
  await assert.rejects(readMakerV8PackDefinitions({ getDynamicField: async () => { throw unavailable; } }, f.expected),
    error => error === unavailable);
});
