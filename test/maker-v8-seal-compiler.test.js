import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { deriveMakerV8SealStorageV2 } from '../maker-v8-seal-compiler.js';

const id = n => `0x${n.toString(16).padStart(64, '0')}`;
const u64 = n => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const vec = b => { b = Buffer.from(b); assert.ok(b.length < 128); return Buffer.concat([Buffer.from([b.length]), b]); };
const digest = (...b) => createHash('sha256').update(Buffer.concat(b)).digest();
const rawId = n => Buffer.from(id(n).slice(2), 'hex');
const prefix = name => [vec(Buffer.from(name)), u64(2)];
const fixture = () => ({ registryId: id(17), rootId: id(34), makerVersion: '3', rootContentCommitment: 'ab'.repeat(32), policyId: id(51), rows: [] });

test('Seal empty and sealed commitments match independently encoded actual Move BCS', async () => {
  const actual = await deriveMakerV8SealStorageV2(fixture());
  const lanes = [0, 1, 2].map(tag => digest(...prefix('animacraft-fresh-v8/compiler/registry-empty/v2'), rawId(17), rawId(34), u64(3), Buffer.from([tag])));
  const expected = sealed => digest(...prefix('animacraft-fresh-v8/seal/registry/v2'), rawId(17), rawId(34), u64(3), vec(Buffer.from('ab'.repeat(32), 'hex')), rawId(51), u64(0), u64(0), u64(0), ...lanes.map(vec), u64(0), Buffer.from([Number(sealed)])).toString('hex');
  assert.equal(actual.checkpoints[0].commitment, expected(false));
  assert.equal(actual.sealed.commitment, expected(true));
  assert.notEqual(expected(false), expected(true));
  assert.notEqual((await deriveMakerV8SealStorageV2({ ...fixture(), registryId: id(18) })).sealed.commitment, actual.sealed.commitment);
});

test('Seal rows are serialized before awaiting and malformed hashes or sequences reject', async () => {
  const row = { sequence: 0, scope_kind: 0, scope_key: 'maker/base', scope_commitment: Array(32).fill(1), asset_key: 'a/b/c', asset_content_commitment: Array(32).fill(2), ciphertext_blob_id: 'blob', ciphertext_sha256: Array(32).fill(3), ciphertext_blob_commitment: Array(32).fill(4), certification_commitment: Array(32).fill(5), seal_id: Array(32).fill(6) };
  const input = { ...fixture(), rows: [row] };
  const baseline = await deriveMakerV8SealStorageV2(structuredClone(input));
  const pending = deriveMakerV8SealStorageV2(input);
  row.scope_commitment[0] = 99; row.asset_key = 'changed'; input.rows.length = 0;
  assert.deepEqual(await pending, baseline);
  assert.equal(baseline.checkpoints[1].baseCount, '1');
  await assert.rejects(deriveMakerV8SealStorageV2({ ...fixture(), rows: [{ ...row, sequence: 1 }] }), /sequence/);
  await assert.rejects(deriveMakerV8SealStorageV2({ ...fixture(), rows: [{ ...row, seal_id: [1] }] }), /32 bytes/);
});
