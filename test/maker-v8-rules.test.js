import test from 'node:test';
import assert from 'node:assert/strict';
import { validateMakerV8Rule, makerV8RuleIssue, makerV8RuleSelectorMatches, makerV8RuleFromBuilder, upgradeAuthorMakerV8RulesV8 } from '../maker-v8-rules.js';
const selector = (source = 'BASE', sourceKey = null, itemKey = 'hat', styleKey = null) => ({ source, sourceKey, partKey: 'head', itemKey, styleKey });
const selection = { source: 'BASE', partKey: 'head', itemKey: 'hat', styleKey: 'red' };
const productA = `0x${'a'.repeat(64)}`;
const productB = `0x${'b'.repeat(64)}`;
const rule = () => ({ key: 'r', kind: 'REQUIRE', trigger: selector(), targetMode: 'ALL', targets: [selector('BASE', null, 'hat', 'red'), selector('BASE', null, 'hat', 'blue')], payload: {} });
test('source and style matching cannot confuse names across scopes', () => {
  assert.equal(makerV8RuleSelectorMatches(selector('PACK', 'pack-a'), selection), false);
  assert.equal(makerV8RuleSelectorMatches(selector('PACK', 'pack-a'), { ...selection, source: 'PACK', semanticPackId: 'pack-b' }), false);
  assert.equal(makerV8RuleSelectorMatches(selector('PACK', 'pack-a'), { ...selection, source: 'PACK', semanticPackId: 'pack-a' }), true);
  assert.equal(makerV8RuleSelectorMatches(selector('EXTERNAL', productA), { ...selection, source: 'EXTERNAL', externalProductId: productB }), false);
  assert.equal(makerV8RuleSelectorMatches(selector('EXTERNAL', productA), { ...selection, source: 'EXTERNAL', externalProductId: productA }), true);
  assert.equal(makerV8RuleSelectorMatches(selector('BASE', null, 'hat', 'blue'), selection), false);
  assert.equal(makerV8RuleSelectorMatches(selector('ANY', null, null), { ...selection, source: 'EXTERNAL', externalProductId: productA }), true);
});
test('REQUIRE ALL/ANY and EXCLUDE any target are distinct', () => {
  const r = rule();
  assert.equal(makerV8RuleIssue([r], [selection]).code, 'MAKER_V8_PLAYER_RULE_REQUIRE_FAILED');
  r.targetMode = 'ANY';
  assert.equal(makerV8RuleIssue([r], [selection]), null);
  r.kind = 'EXCLUDE';
  assert.equal(makerV8RuleIssue([r], [selection]).code, 'MAKER_V8_PLAYER_RULE_EXCLUDE_FAILED');
  assert.equal(makerV8RuleIssue([r], []), null);
  r.targetMode = 'ALL';
  assert.ok(validateMakerV8Rule(r).length);
});
test('validation rejects unknown scope and invalid BASE eligibility without inventing external availability', () => {
  const r = rule();
  const parts = [{ key: 'head', items: [{ key: 'hat', status: 'PRIVATE', styles: [{ key: 'red' }] }] }];
  assert.ok(validateMakerV8Rule(r, { parts }).length);
  r.trigger = selector('PACK', 'pack-a'); r.targets = [selector('EXTERNAL', productA)];
  assert.deepEqual(validateMakerV8Rule(r, { parts }), []);
  r.trigger.source = 'UNKNOWN';
  assert.ok(validateMakerV8Rule(r).length);
  assert.ok(makerV8RuleIssue([r], []));
  r.trigger = selector('BASE', 'forged');
  assert.ok(validateMakerV8Rule(r).length);
});
test('builder preserves Part/Item/Style granularity and legacy upgrade is explicit', () => {
  const built = makerV8RuleFromBuilder({ key: 'rule', type: 'requires', ownerDefinition: 'body', definitions: ['head::hat::red'], matchMode: 'any' });
  assert.equal(built.trigger.source, 'ANY'); assert.equal(built.targets[0].styleKey, 'red');
  const legacy = { key: 'old', kind: 'REQUIRE', left: { partKey: 'head', itemKey: 'hat' }, right: { partKey: 'head', itemKey: 'hat' }, payload: { note: 'kept' } };
  assert.ok(makerV8RuleIssue([legacy], []));
  const [upgraded] = upgradeAuthorMakerV8RulesV8([legacy]);
  assert.deepEqual(upgraded.payload, legacy.payload);
  assert.equal(upgraded.trigger.source, 'BASE');
  assert.equal(makerV8RuleIssue([upgraded], [selection]), null);
});

test('external scope requires a canonical nonzero object ID and target bound is 32', () => {
  for (const bad of ['product-a', '0x1', `0x${'A'.repeat(64)}`, `0x${'0'.repeat(64)}`]) {
    const r = rule(); r.trigger = selector('EXTERNAL', bad);
    assert.ok(validateMakerV8Rule(r).length);
  }
  const r = rule(); r.trigger = selector('EXTERNAL', productA);
  r.targets = Array.from({ length: 32 }, () => selector());
  assert.deepEqual(validateMakerV8Rule(r), []);
  r.targets.push(selector()); assert.ok(validateMakerV8Rule(r).length);
});

test('builder enforces original target combinations without changing EXCLUDE semantics', () => {
  const input = { key: 'r', type: 'requires', ownerDefinition: 'body', definitions: ['head::hat::red', 'head::hat::blue'], matchMode: 'any' };
  assert.equal(makerV8RuleFromBuilder(input).targets.length, 2);
  assert.equal(makerV8RuleFromBuilder({ ...input, definitions: ['head::hat', 'head::hat'] }).targets.length, 1);
  for (const definitions of [['head::hat', 'feet::shoe'], ['head::hat', 'head::hat::red'], ['head::hat::red', 'head::cap::blue'], ['body::shirt']]) {
    assert.throws(() => makerV8RuleFromBuilder({ ...input, definitions }), TypeError);
  }
  assert.throws(() => makerV8RuleFromBuilder({ ...input, matchMode: 'unknown' }), TypeError);
  const excluded = makerV8RuleFromBuilder({ ...input, type: 'excludes', matchMode: 'all', definitions: ['head::hat', 'feet::shoe'] });
  assert.equal(excluded.targetMode, 'ANY');
  assert.equal(makerV8RuleIssue([excluded], [{ partKey: 'body', itemKey: 'shirt' }, selection]).code, 'MAKER_V8_PLAYER_RULE_EXCLUDE_FAILED');
});
