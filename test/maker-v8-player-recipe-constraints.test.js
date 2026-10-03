import test from 'node:test';
import assert from 'node:assert/strict';
import { makerV8PlayerRecipeConstraintIssue as issue } from '../maker-v8-player-recipe-constraints.js';

const id = n => `0x${n.toString(16).padStart(64, '0')}`;
const hash = 'ab'.repeat(32);
const selector = (partKey, source = 'BASE', sourceKey = null) => ({ source, sourceKey, partKey, itemKey: null, styleKey: null });
const base = partKey => ({ source: 'BASE', partKey, itemKey: 'item', styleKey: 'style', trackKey: 'track',
  colorChannelKey: null, defaultSwatchKey: null, releaseId: null, semanticPackId: null,
  externalProductId: null, ownedExternalItemId: null });
function fixture() {
  const parts = ['body', 'target'].map(key => ({ key, capacity: 1, required: false, items: [] }));
  const player = { rootId: id(1), document: { parts, rules: [] },
    contextualChoices: { address: id(9), packStyles: [] },
    definitionContext: { rootId: id(1), address: id(9), packs: [], currentLoadout: null } };
  for (const n of [2, 3]) {
    const own = { key: 'plume', capacity: 1, required: false, items: [] };
    const pack = { releaseId: id(n), semanticPackId: `pack-${n}`, definitionCommitment: hash,
      document: { parts: [...parts, own] }, ownedParts: [own], rules: [], styleReferences: [] };
    for (const partKey of ['plume', 'target']) {
      const selection = { ...base(partKey), source: 'PACK', releaseId: id(n), semanticPackId: pack.semanticPackId };
      const owned = partKey === 'plume';
      player.contextualChoices.packStyles.push({ ...selection, definitionCommitment: hash,
        definitionScope: { part: { source: owned ? 'PACK' : 'BASE', sourceId: owned ? id(n) : id(1), key: partKey } } });
      pack.styleReferences.push({ part: { scope: owned ? 'PACK_SELF' : 'BASE', key: partKey }, itemKey: 'item', styleKey: 'style' });
    }
    player.definitionContext.packs.push(pack);
  }
  const pick = (n, partKey) => {
    const { definitionCommitment, definitionScope, ...selection } = player.contextualChoices.packStyles.find(row => row.releaseId === id(n) && row.partKey === partKey);
    return selection;
  };
  return { player, pick, pack: player.definitionContext.packs[0] };
}

test('same-name Pack Parts have independent capacity; duplicate selections in one scope exceed it', () => {
  const { player, pick } = fixture();
  assert.equal(issue(player, [base('body'), pick(2, 'plume'), pick(3, 'plume')]), null);
  assert.equal(issue(player, [pick(2, 'plume'), pick(2, 'plume')]).code, 'MAKER_V8_PLAYER_SELECTION_REFERENCE_INVALID');
});

test('local BASE, ANY and explicit PACK targets retain exact slot and Release semantics', () => {
  const { player, pick, pack } = fixture();
  pack.rules = [{ key: 'needs-target', kind: 'REQUIRE', targetMode: 'ALL', payload: {},
    trigger: selector('plume'), targets: [selector('target')] }];
  assert.equal(issue(player, [pick(3, 'plume')]), null, 'Foreign same-name Part cannot trigger local rule');
  assert.equal(issue(player, [pick(2, 'plume'), pick(2, 'target')]), null, 'Own addition may satisfy BASE in inherited Part');
  assert.equal(issue(player, [pick(2, 'plume'), pick(3, 'target')]).code, 'MAKER_V8_PLAYER_RULE_REQUIRE_FAILED');
  pack.rules[0].targets = [selector('target', 'ANY')];
  assert.equal(issue(player, [pick(2, 'plume'), pick(3, 'target')]), null);
  pack.rules[0].targets = [selector('target', 'PACK', 'pack-3')];
  assert.equal(issue(player, [pick(2, 'plume'), pick(3, 'target')]), null);
  assert.equal(issue(player, [pick(2, 'plume'), pick(2, 'target')]).code, 'MAKER_V8_PLAYER_RULE_REQUIRE_FAILED');
});

test('retained attachments keep rule validation and cannot silently lose their authored context', () => {
  const { player, pack } = fixture();
  player.definitionContext.currentLoadout = { layout: { bindings: [{ releaseId: pack.releaseId, definitionCommitment: hash }] } };
  // Runtime validates every retained bundle, including one with no Pack-sourced selection.
  pack.rules = [{ key: 'exclude', kind: 'EXCLUDE', targetMode: 'ANY', payload: {},
    trigger: selector('plume'), targets: [selector('target')] }];
  assert.equal(issue(player, [base('body'), base('target')]), null);
  pack.definitionCommitment = 'cd'.repeat(32);
  assert.equal(issue(player, [base('body')]).code, 'MAKER_V8_PLAYER_DEFINITION_CONTEXT_INVALID');
  player.definitionContext.packs = [];
  assert.equal(issue(player, [base('body')]).code, 'MAKER_V8_PLAYER_DEFINITION_CONTEXT_INVALID');
});
