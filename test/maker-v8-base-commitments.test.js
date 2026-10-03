import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { deriveMakerV8BaseAuthorCommitmentV2, deriveMakerV8BaseStorageCommitmentsV2 } from '../maker-v8-base-commitments.js';
import { compileMakerV8RuleRows } from '../maker-v8-compiler.js';

// Independent BCS encoder: do not import the implementation's BCS types.
const join = (...parts) => Buffer.concat(parts);
const uleb = value => { const out = []; do { out.push((value & 127) | (value > 127 ? 128 : 0)); value >>>= 7; } while (value); return Buffer.from(out); };
const vec = value => join(uleb(value.length), Buffer.from(value));
const str = value => vec(Buffer.from(value));
const u64 = value => { const out = Buffer.alloc(8); out.writeBigUInt64LE(BigInt(value)); return out; };
const u8 = value => Buffer.from([value]);
const sha = value => createHash('sha256').update(value).digest();
const tags = [0, 1, 2, 3, 4, 5, 6, 255];
const plurals = ['tracks', 'colors', 'parts', 'items', 'styles', 'rules', 'assets', 'aggregate'];
const kinds = ['track', 'color', 'part', 'item', 'style', 'rule', 'asset'];
const binding = { registryId: '0x11', rootId: '0x22', makerVersion: 3 };
const identity = join(Buffer.from('11'.padStart(64, '0'), 'hex'), Buffer.from('22'.padStart(64, '0'), 'hex'), u64(3));
const registry = identity.subarray(0, 32);
const prefix = name => join(str(`animacraft-fresh-v8/compiler/registry-${name}/v2`), u64(2));
const authorPrefix = name => join(str(`animacraft-fresh-v8/compiler/author-rows-${name}/v2`), u64(2));
const track = (key, sequence = 0n) => ({ kind: 'track', row: { sequence }, bytes: [...join(u64(sequence), str(key), str('Track'), u64(8), u8(1))] });

function storageOracle(entries) {
  const initial = tags.map(tag => sha(join(prefix('empty'), identity, u8(tag))));
  const rolling = [...initial];
  const counts = tags.map(() => 0n);
  for (const [index, entry] of entries.entries()) {
    const tag = kinds.indexOf(entry.kind);
    const rowHash = tag === 5 ? Buffer.from(entry.commitment, 'hex') : sha(join(prefix('row'), identity, u8(tag), u64(entry.row.sequence), vec(entry.bytes)));
    rolling[tag] = sha(join(prefix('advance'), registry, u8(tag), u64(entry.row.sequence), vec(rolling[tag]), vec(rowHash)));
    rolling[7] = sha(join(prefix('advance'), registry, u8(255), u64(index), vec(rolling[7]), vec(rowHash)));
    counts[tag]++;
    counts[7]++;
  }
  const seals = tags.map((tag, index) => sha(join(prefix('category-seal'), identity, u8(tag), u64(counts[index]), vec(initial[index]), vec(rolling[index]))));
  const aggregate = sha(join(prefix('seal'), identity, vec(tags), uleb(8), ...seals.map(vec), u64(entries.length)));
  const record = list => Object.fromEntries(plurals.map((key, index) => [key, list[index].toString('hex')]));
  return { initial: record(initial), rolling: record(rolling), seals: { ...record(seals), aggregate: aggregate.toString('hex') } };
}

test('storage initial, row, category-local and aggregate-global advance and final seals match independent BCS', async () => {
  const entries = [track('back'), track('front', 1n), { kind: 'asset', row: { sequence: 0n }, bytes: [...join(u64(0), str('asset'), str('image'), str('image/png'), u64(7), vec(Buffer.alloc(32, 8)))] }];
  const actual = await deriveMakerV8BaseStorageCommitmentsV2({ ...binding, entries });
  const expected = storageOracle(entries);
  assert.deepEqual(actual.initialCommitments, expected.initial);
  assert.deepEqual(actual.rollingCommitments, expected.rolling);
  assert.deepEqual(actual.sealedCommitments, expected.seals);
  assert.equal(actual.checkpoints[3].nextSequence, 3n);
  assert.equal(actual.checkpoints[3].observedCounts.assets, 1n);
  assert.equal(actual.checkpoints.length, 4);
  assert.notEqual(actual.rollingCommitments.aggregate, actual.sealedCommitments.aggregate);
});

test('Rule storage uses the actual semantic row digest, not the ordinary identity-bound row formula', async () => {
  const selector = { source: 'BASE', sourceKey: null, partKey: 'body', itemKey: null, styleKey: null };
  const [rule] = await compileMakerV8RuleRows([{ key: 'rule', kind: 'REQUIRE', trigger: selector, targetMode: 'ANY', targets: [{ ...selector }], payload: {} }]);
  const entries = [track('base'), { kind: 'rule', ...rule }];
  const actual = await deriveMakerV8BaseStorageCommitmentsV2({ ...binding, entries });
  assert.deepEqual(actual.sealedCommitments, storageOracle(entries).seals);
  await assert.rejects(deriveMakerV8BaseStorageCommitmentsV2({ ...binding, entries: [entries[0], { ...entries[1], commitment: 'aa'.repeat(32) }] }), /Rule commitment differs/);
  const withoutCallerHash = { ...entries[1] }; delete withoutCallerHash.commitment;
  const recomputed = await deriveMakerV8BaseStorageCommitmentsV2({ ...binding, entries: [entries[0], withoutCallerHash] });
  assert.equal(recomputed.sealedCommitments.rules, actual.sealedCommitments.rules);
});

test('author intent is exact row BCS, category and order with a final seven-count seal, without new object IDs', async () => {
  const entries = [track('back'), track('front', 1n)];
  const actual = await deriveMakerV8BaseAuthorCommitmentV2(entries);
  let rolling = sha(authorPrefix('empty'));
  assert.equal(actual.initialCommitment, rolling.toString('hex'));
  for (const [index, entry] of entries.entries()) rolling = sha(join(authorPrefix('advance'), u8(0), u64(index), u64(index), vec(rolling), vec(entry.bytes)));
  const final = sha(join(authorPrefix('seal'), uleb(7), u64(2), ...Array.from({ length: 6 }, () => u64(0)), vec(rolling)));
  assert.equal(actual.rollingCommitment, rolling.toString('hex'));
  assert.equal(actual.commitment, final.toString('hex'));
  assert.equal(actual.total, 2n);
  const changed = await deriveMakerV8BaseAuthorCommitmentV2([track('changed'), entries[1]]);
  assert.notEqual(changed.commitment, actual.commitment);
  assert.deepEqual(changed.counts, actual.counts);
  const storage = await deriveMakerV8BaseStorageCommitmentsV2({ ...binding, entries });
  const other = await deriveMakerV8BaseStorageCommitmentsV2({ ...binding, registryId: '0x33', entries });
  assert.notEqual(storage.sealedCommitments.aggregate, other.sealedCommitments.aggregate);
  assert.equal((await deriveMakerV8BaseAuthorCommitmentV2(entries)).commitment, actual.commitment);
});

test('different identity components bind every empty category and the final seal', async () => {
  const base = await deriveMakerV8BaseStorageCommitmentsV2({ ...binding, entries: [] });
  for (const change of [{ registryId: '0x33' }, { rootId: '0x33' }, { makerVersion: 4 }]) {
    const value = await deriveMakerV8BaseStorageCommitmentsV2({ ...binding, ...change, entries: [] });
    for (const key of plurals) assert.notEqual(base.initialCommitments[key], value.initialCommitments[key]);
    assert.notEqual(base.sealedCommitments.aggregate, value.sealedCommitments.aggregate);
  }
});

test('both lanes reject missing, malformed, reordered or noncontiguous input instead of guessing', async () => {
  const invalid = [[track('bad', 1n)], [track('a'), track('b')], [{ kind: 'unknown', row: { sequence: 0n }, bytes: [1] }], [{ ...track('a'), bytes: [] }], [{ ...track('a'), bytes: [-1] }], [{ ...track('a'), bytes: [256] }], [{ ...track('a'), bytes: [1.5] }], [{ kind: 'asset', row: { sequence: 0n }, bytes: [1] }, track('a')]];
  for (const entries of invalid) {
    await assert.rejects(deriveMakerV8BaseAuthorCommitmentV2(entries));
    await assert.rejects(deriveMakerV8BaseStorageCommitmentsV2({ ...binding, entries }));
  }
  for (const change of [{ rootId: '0x11' }, { registryId: '0x0' }, { rootId: '' }, { makerVersion: 0 }, { makerVersion: Number.MAX_SAFE_INTEGER + 1 }]) await assert.rejects(deriveMakerV8BaseStorageCommitmentsV2({ ...binding, ...change, entries: [] }));
});

test('async hashing snapshots rows and bytes before yielding to callers', async () => {
  const entries = [track('stable')];
  const expected = await deriveMakerV8BaseStorageCommitmentsV2({ ...binding, entries });
  const pending = deriveMakerV8BaseStorageCommitmentsV2({ ...binding, entries });
  entries[0].row.sequence = 9n;
  entries[0].bytes.fill(0);
  entries[0].kind = 'asset';
  entries.push(track('injected'));
  assert.deepEqual(await pending, expected);
});
