import assert from 'node:assert/strict';
import test from 'node:test';
import { validateMakerV8Visibility, evaluateMakerV8Visibility, makerV8VisibilityTokens,
  makerV8VisibilityFromBuilder, makerV8VisibilityEditorModel } from '../maker-v8-visibility.js';
import { createCreatorCharacterStarter } from '../maker-v8-creator-structure.js';
import { makerV8PlayerSelectorMatcher } from '../maker-v8-player-definition-resolution.js';

const selected = (overrides = {}) => ({ op: 'selected', source: 'BASE', sourceKey: null,
  partKey: 'background', itemKey: 'background-default', styleKey: 'default-style', ...overrides });
const options = () => ({ document: createCreatorCharacterStarter(), partKey: 'eyes', itemKey: 'eyes-default',
  styleKey: 'default-style', logic: 'all', polarity: 'selected', definitions: ['background::background-default::default-style'] });

test('authored Pack visibility remaps only exact local BASE references and retains explicit sources', () => {
  const local = `0x${'1'.repeat(64)}`, foreign = `0x${'2'.repeat(64)}`;
  const row = { source: 'PACK', releaseId: local, semanticPackId: 'local',
    partKey: 'background', itemKey: 'background-default', styleKey: 'default-style' };
  const matcher = makerV8PlayerSelectorMatcher({ rootId: `0x${'3'.repeat(64)}`,
    document: { parts: [{ key: 'background' }] },
    contextualChoices: { packStyles: [row, { ...row, releaseId: foreign }] },
    definitionContext: { packs: [{ releaseId: local, ownedParts: [] }] },
  }, local);
  const packVisible = (condition, selections) => evaluateMakerV8Visibility(condition, selections, matcher);
  assert.equal(packVisible(selected(), [row]), true);
  assert.equal(evaluateMakerV8Visibility(selected(), [row]), false, 'Base evaluator is unchanged');
  assert.equal(packVisible(selected(), [{ ...row, releaseId: foreign }]), false);
  assert.equal(packVisible(selected({ source: 'PACK', sourceKey: 'local' }), [row]), true);
  assert.equal(packVisible(selected({ source: 'PACK', sourceKey: 'foreign' }), [row]), false);
  assert.equal(packVisible(selected({ source: 'ANY' }), [{ ...row, releaseId: foreign }]), true);
  assert.equal(packVisible({ op: 'not', condition: selected() }, [row]), false);
  assert.equal(packVisible({ op: 'all', conditions: [selected(), selected({ source: 'PACK', sourceKey: 'local' })] }, [row]), true);
});

test('visibility has one exact AST and rejects obsolete, malformed and unbounded graphs', () => {
  for (const value of [true, false, [], {}, { op: 'selected', partId: 'background' },
    { ...selected(), extra: null }, { op: 'not', condition: null }, { op: 'all', conditions: [] },
    selected({ source: 'PACK' }), selected({ source: 'EXTERNAL', sourceKey: `0x${'0'.repeat(64)}` }),
    selected({ itemKey: null }), selected({ source: 'BASE', sourceKey: 'pack' })]) {
    assert.ok(validateMakerV8Visibility(value).length, JSON.stringify(value));
    assert.throws(() => makerV8VisibilityTokens(value));
    assert.throws(() => evaluateMakerV8Visibility(value, []));
  }
  for (const value of [undefined, null, selected()]) assert.deepEqual(validateMakerV8Visibility(value), []);
  let condition = selected();
  for (let index = 1; index < 8; index++) condition = { op: 'not', condition };
  assert.equal(makerV8VisibilityTokens(condition).length, 8);
  assert.ok(validateMakerV8Visibility({ op: 'not', condition }).some(row => row.code.endsWith('LIMIT')));
  const thirtyTwo = { op: 'all', conditions: Array.from({ length: 32 }, () => selected()) };
  assert.equal(makerV8VisibilityTokens(thirtyTwo).length, 33);
  assert.ok(validateMakerV8Visibility({ op: 'all', conditions: [thirtyTwo, selected()] }).some(row => row.code.endsWith('LIMIT')));
  const cyclic = { op: 'not' }; cyclic.condition = cyclic;
  assert.ok(validateMakerV8Visibility(cyclic).length);
  const shared = selected();
  assert.ok(validateMakerV8Visibility({ op: 'all', conditions: [shared, shared] }).length);
  let reads = 0;
  const accessor = [selected()];
  Object.defineProperty(accessor, '0', { enumerable: true, get() { reads++; return selected(); } });
  assert.ok(validateMakerV8Visibility({ op: 'all', conditions: accessor }).length);
  assert.equal(reads, 0);
  assert.ok(validateMakerV8Visibility({ op: 'all', conditions: new Array(1) }).length);
  const symbol = [selected()]; symbol[Symbol('extra')] = 1;
  assert.ok(validateMakerV8Visibility({ op: 'all', conditions: symbol }).length);
});

test('source-scoped selection evaluation is exact and never substitutes another source', () => {
  const base = { partKey: 'background', itemKey: 'background-default', styleKey: 'default-style' };
  const pack = { ...base, source: 'PACK', semanticPackId: 'pack-one' };
  const external = { ...base, source: 'EXTERNAL', externalProductId: `0x${'1'.repeat(64)}` };
  assert.equal(evaluateMakerV8Visibility(selected(), [base]), true);
  assert.equal(evaluateMakerV8Visibility(selected(), [pack, external]), false);
  assert.equal(evaluateMakerV8Visibility(selected({ source: 'ANY' }), [pack]), true);
  const packCondition = selected({ source: 'PACK', sourceKey: 'pack-one' });
  assert.equal(evaluateMakerV8Visibility(packCondition, [pack]), true);
  assert.equal(evaluateMakerV8Visibility(packCondition, [{ ...pack, semanticPackId: 'pack-two' }]), false);
  assert.equal(evaluateMakerV8Visibility(selected({ source: 'EXTERNAL', sourceKey: external.externalProductId }), [external]), true);
  assert.equal(evaluateMakerV8Visibility(selected({ source: 'ANY', itemKey: null, styleKey: null }), [{ ...base, itemKey: 'other', styleKey: 'other' }]), true);
  assert.equal(evaluateMakerV8Visibility(null, []), true);
});

test('postfix programs preserve tree order, arity and independent selector snapshots', () => {
  const condition = { op: 'any', conditions: [selected(), { op: 'not', condition: { op: 'all', conditions: [selected(), selected({ styleKey: null })] } }] };
  const before = structuredClone(condition);
  const tokens = makerV8VisibilityTokens(condition);
  assert.deepEqual(tokens.map(row => [row.opcode, row.arity]), [[0, 0], [0, 0], [0, 0], [2, 2], [1, 1], [3, 2]]);
  assert.deepEqual(tokens.filter(row => row.opcode !== 0).map(row => row.selector), [null, null, null]);
  tokens[0].selector.partKey = 'changed';
  assert.deepEqual(condition, before);
  assert.equal(evaluateMakerV8Visibility(condition, []), true);
  assert.deepEqual(makerV8VisibilityTokens(null), []);
});

test('document-aware references distinguish owner privacy, slot scope and required Parts', () => {
  const { document, partKey, itemKey, styleKey } = options();
  const context = { parts: document.parts, subject: { partKey, itemKey, styleKey } };
  assert.deepEqual(validateMakerV8Visibility(selected(), context), []);
  assert.ok(validateMakerV8Visibility(selected({ partKey: 'missing' }), context).some(row => row.code.endsWith('TARGET_UNKNOWN')));
  assert.ok(validateMakerV8Visibility(selected({ itemKey: 'missing' }), context).some(row => row.code.endsWith('TARGET_UNKNOWN')));
  assert.ok(validateMakerV8Visibility(selected({ styleKey: 'missing' }), context).some(row => row.code.endsWith('TARGET_UNKNOWN')));
  assert.deepEqual(validateMakerV8Visibility(selected({ source: 'PACK', sourceKey: 'pack-one', itemKey: 'remote' }), context), []);
  assert.ok(validateMakerV8Visibility(selected({ source: 'ANY', partKey: 'skin-base', itemKey: null, styleKey: null }), context).some(row => row.code.endsWith('REQUIRED_PART')));
  assert.ok(validateMakerV8Visibility(selected({ partKey, itemKey, styleKey }), context).some(row => row.code.endsWith('SAME_PART')));
  document.parts[0].items[0].status = 'PRIVATE';
  assert.ok(validateMakerV8Visibility(selected(), context).some(row => row.code.endsWith('TARGET_PRIVATE')));
  document.parts.find(part => part.key === partKey).items[0].status = 'PRIVATE';
  assert.deepEqual(validateMakerV8Visibility(selected(), context), []);
});

test('builder restores original constraints, respects Style locks and preserves source document', () => {
  const input = options();
  const before = structuredClone(input.document);
  const condition = makerV8VisibilityFromBuilder(input);
  assert.deepEqual(condition, selected());
  assert.deepEqual(makerV8VisibilityEditorModel(condition), { advanced: false, logic: 'all', polarity: 'selected', definitions: input.definitions });
  assert.deepEqual(input.document, before);
  for (const patch of [{ definitions: [] }, { definitions: ['background::missing'] },
    { definitions: ['eyes'] }, { definitions: ['skin-base'] }, { logic: 'or' }, { polarity: 'false' },
    { definitions: ['background', 'outfit'], logic: 'any' },
    { definitions: ['background', 'background::background-default'], logic: 'any', polarity: 'not-selected' }]) {
    assert.throws(() => makerV8VisibilityFromBuilder({ ...input, ...patch }));
  }
  input.document.parts.find(part => part.key === 'eyes').items[0].styles[0].payload.animacraftEditor.styleLocked = true;
  assert.throws(() => makerV8VisibilityFromBuilder(input), error => error.code.endsWith('STYLE_LOCKED'));
});

test('builder ALL respects slot capacity and advanced trees are never flattened lossily', () => {
  const input = options();
  const target = input.document.parts[0].items[0];
  target.styles.push({ ...structuredClone(target.styles[0]), key: 'second' });
  input.definitions.push('background::background-default::second');
  assert.throws(() => makerV8VisibilityFromBuilder(input), error => error.code.endsWith('IMPOSSIBLE_ALL'));
  input.document.parts[0].capacity = 2;
  const condition = makerV8VisibilityFromBuilder(input);
  assert.equal(makerV8VisibilityEditorModel(condition, { parts: input.document.parts }).advanced, false);
  for (const condition of [selected({ source: 'PACK', sourceKey: 'pack-one' }),
    { op: 'not', condition: { op: 'not', condition: selected() } },
    { op: 'all', conditions: [selected(), { op: 'not', condition: selected() }] }]) {
    assert.equal(makerV8VisibilityEditorModel(condition).advanced, true);
  }
});
