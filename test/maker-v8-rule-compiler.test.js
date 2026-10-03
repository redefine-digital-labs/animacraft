import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Transaction } from '@mysten/sui/transactions';
import { appendMakerV8RuleRowCommands, buildMakerV8RuleRowCommands, compileMakerV8RuleRows, MAKER_V8_RULE_ROW_BCS_V2, MAKER_V8_PUBLICATION_COMPILER_ABI } from '../maker-v8-compiler.js';

const selector = (overrides = {}) => ({ source: 'BASE', sourceKey: null, partKey: 'body', itemKey: 'shirt', styleKey: null, ...overrides });
const rule = (overrides = {}) => ({ key: 'requires-shoes', kind: 'REQUIRE', trigger: selector(), targetMode: 'ALL', targets: [selector({ source: 'PACK', sourceKey: 'shoe-pack', partKey: 'feet', itemKey: null }), selector({ source: 'EXTERNAL', sourceKey: `0x${'ab'.repeat(32)}`, partKey: 'head', itemKey: 'hat', styleKey: 'red' })], payload: {}, ...overrides });
const uleb = value => { const bytes = []; do { bytes.push((value & 127) | (value > 127 ? 128 : 0)); value >>>= 7; } while (value); return Buffer.from(bytes); };
const join = (...values) => Buffer.concat(values);
const vector = value => join(uleb(value.length), Buffer.from(value));
const string = value => vector(Buffer.from(value));
const option = value => value === null ? Buffer.from([0]) : join(Buffer.from([1]), string(value));
const u64 = value => { const bytes = Buffer.alloc(8); bytes.writeBigUInt64LE(BigInt(value)); return bytes; };
const sha = value => createHash('sha256').update(value).digest();
const selectorBytes = s => join(Buffer.from([{ ANY: 0, BASE: 1, PACK: 2, EXTERNAL: 3 }[s.source]]), option(s.sourceKey), string(s.partKey), option(s.itemKey), option(s.styleKey));
const selectorDigest = s => sha(join(string('animacraft-fresh-v8/core/semantic-selector/v2'), u64(8), selectorBytes(s)));

test('RuleRowV2 BCS and nested Core commitment match independently encoded exact fields', async () => {
  const input = rule();
  const [compiled] = await compileMakerV8RuleRows([input]);
  const payload = sha(Buffer.from('{"payload":{},"schemaVersion":"animacraft.maker-v8-rule-payload.v2"}'));
  const expectedBytes = join(u64(0), string(input.key), Buffer.from([0]), selectorBytes(input.trigger), Buffer.from([0]), uleb(2), ...input.targets.map(selectorBytes), vector(payload));
  assert.deepEqual(Buffer.from(compiled.bytes), expectedBytes);
  assert.deepEqual(Buffer.from(MAKER_V8_RULE_ROW_BCS_V2.serialize(compiled.row).toBytes()), expectedBytes);
  const expectedCommitment = sha(join(string('animacraft-fresh-v8/core/rule-row/v2'), u64(8), Buffer.from([1, 0]), u64(0), string(input.key), Buffer.from([0]), vector(selectorDigest(input.trigger)), Buffer.from([0]), uleb(2), ...input.targets.map(s => vector(selectorDigest(s))), vector(payload))).toString('hex');
  assert.equal(compiled.commitment, expectedCommitment);
  assert.deepEqual(compiled.row.targets.map(s => s.source), [2, 3]);
});

test('rule commitment covers trigger, source scope, optional style, target mode, order and payload', async () => {
  const input = rule();
  const [base] = await compileMakerV8RuleRows([input]);
  const variants = [
    { trigger: selector({ source: 'ANY', itemKey: null }) },
    { targets: [selector({ ...input.targets[0], sourceKey: 'other-pack' }), input.targets[1]] },
    { targets: [input.targets[0], selector({ ...input.targets[1], styleKey: 'blue' })] },
    { targetMode: 'ANY' }, { targets: [...input.targets].reverse() }, { payload: { label: 'changed' } },
  ];
  for (const variant of variants) {
    const [changed] = await compileMakerV8RuleRows([{ ...input, ...variant }]);
    assert.notEqual(changed.commitment, base.commitment);
    assert.notDeepEqual(changed.bytes, base.bytes);
  }
  const ordered = await compileMakerV8RuleRows([rule({ key: 'z' }), rule({ key: 'a' })]);
  assert.deepEqual(ordered.map(entry => [entry.row.key, entry.row.sequence]), [['a', 0n], ['z', 1n]]);
});

test('compiler rejects legacy, noncanonical EXCLUDE, invalid options, duplicate keys and Core target overflow', async () => {
  const invalid = [
    { key: 'old', kind: 'REQUIRE', left: { partKey: 'a', itemKey: 'b' }, right: { partKey: 'c', itemKey: 'd' }, payload: {} },
    rule({ kind: 'EXCLUDE', targetMode: 'ALL' }), rule({ targets: [] }),
    rule({ trigger: selector({ sourceKey: 'unexpected' }) }),
    rule({ trigger: selector({ itemKey: null, styleKey: 'red' }) }),
    ...['hat-product', '0x01', `0x${'00'.repeat(32)}`, `0x${'AB'.repeat(32)}`].map(sourceKey => rule({ trigger: selector({ source: 'EXTERNAL', sourceKey }) })),
    rule({ targets: Array.from({ length: 33 }, () => selector()) }),
  ];
  for (const input of invalid) await assert.rejects(compileMakerV8RuleRows([input]), { code: 'MAKER_V8_RULE_REFERENCE_INVALID' });
  await assert.rejects(compileMakerV8RuleRows([rule(), rule()]), { code: 'MAKER_V8_RULE_REFERENCE_INVALID' });
  assert.equal((await compileMakerV8RuleRows([rule({ kind: 'EXCLUDE', targetMode: 'ANY' })]))[0].row.kind, 1);
});

test('actual Sui SDK constructs selector vector, RuleRowV2 and append_rule_v2 transaction arguments', async () => {
  const [compiled] = await compileMakerV8RuleRows([rule()]);
  const tx = new Transaction();
  const objects = ['0x11', '0x12', '0x13'].map(objectId => tx.objectRef({ objectId, version: '1', digest: '11111111111111111111111111111111' }));
  appendMakerV8RuleRowCommands(tx, { corePackageId: '0xc0', coreOriginalPackageId: '0xc1', paymentCoinType: '0x2::sui::SUI', registry: objects[0], root: objects[1], admin: objects[2], row: compiled.row });
  const data = tx.getData();
  assert.deepEqual(data.commands.filter(c => c.MoveCall).map(c => c.MoveCall.function), ['new_semantic_selector_v2', 'new_semantic_selector_v2', 'new_semantic_selector_v2', 'new_rule_row_v2', 'append_rule_v2']);
  const vec = data.commands[3].MakeMoveVec;
  assert.equal(vec.type, `0x${'c1'.padStart(64, '0')}::base_registry_v8::SemanticSelectorV2`);
  assert.ok(data.commands.filter(c => c.MoveCall).every(c => c.MoveCall.package.endsWith('c0')));
  assert.deepEqual(vec.elements.map(value => value.Result), [1, 2]);
  assert.equal(data.commands[4].MoveCall.arguments[3].Result, 0);
  assert.equal(data.commands[4].MoveCall.arguments[5].Result, 3);
  const append = data.commands[5].MoveCall;
  assert.equal(append.arguments.length, 4);
  assert.equal(append.arguments[3].Result, 4);
  assert.deepEqual(append.typeArguments, ['0x2::sui::SUI']);
  assert.ok((await tx.build({ onlyTransactionKind: true })).length > 0);
});

test('Rule constructor returns the reusable Move row without appending it', async () => {
  const [compiled] = await compileMakerV8RuleRows([rule()]);
  const tx = new Transaction();
  const result = buildMakerV8RuleRowCommands(tx, { corePackageId: '0xc0', coreOriginalPackageId: '0xc1', row: compiled.row });
  const commands = tx.getData().commands;
  assert.equal(result.Result, commands.length - 1);
  assert.equal(commands.at(-1).MoveCall.function, 'new_rule_row_v2');
  assert.ok(!commands.some(command => command.MoveCall?.function.startsWith('append_')));
  assert.ok((await tx.build({ onlyTransactionKind: true })).length > 0);
});

test('rule ABI allowlist matches reachable Core constructors and retires append_rule_v8', async () => {
  const source = await readFile(new URL('../move/animacraft_v8_core/sources/base_registry_v8.move', import.meta.url), 'utf8');
  for (const name of ['new_semantic_selector_v2', 'new_rule_row_v2', 'append_rule_v2']) {
    assert.ok(MAKER_V8_PUBLICATION_COMPILER_ABI.core.includes(`base_registry_v8::${name}`));
    assert.match(source, new RegExp(`public fun ${name}(?:<PaymentCoin>)?\\(`));
  }
  assert.ok(!MAKER_V8_PUBLICATION_COMPILER_ABI.core.includes('base_registry_v8::append_rule_v8'));
  assert.match(source, /const MAX_RULE_TARGETS: u64 = 32;/);
});
