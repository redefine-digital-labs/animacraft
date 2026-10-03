import test from 'node:test';
import assert from 'node:assert/strict';
import { makerV8PlayerSlotLayout } from '../maker-v8-player-slot-layout.js';

const id = n => `0x${n.toString(16).padStart(64, '0')}`;
const hash = 'ab'.repeat(32);
const fixture = () => ({ rootId: id(1), parts: [
  { key: 'body', menuOrder: 2, capacity: 2 }, { key: 'background', menuOrder: 0, capacity: 1 },
], packDefinitionLayout: {
  bindings: [9, 3, 2].map(n => ({ releaseId: id(n), definitionCommitment: hash })),
  profiles: [
    { releaseId: id(9), partKey: 'body', capacity: '2', profileCommitment: hash },
    { releaseId: id(2), partKey: 'body', capacity: '1', profileCommitment: hash },
  ],
} });

test('scoped slots retain canonical Base order and immutable attachment order including unused Packs', () => {
  const input = fixture(), before = structuredClone(input);
  const rows = makerV8PlayerSlotLayout(input);
  assert.deepEqual(rows, [
    { sourceId: id(1), partKey: 'background', capacity: 1, start: 0 },
    { sourceId: id(1), partKey: 'body', capacity: 2, start: 1 },
    { sourceId: id(9), partKey: 'body', capacity: 2, start: 3 },
    { sourceId: id(2), partKey: 'body', capacity: 1, start: 5 },
  ]);
  assert.deepEqual(input, before);
  assert.ok(Object.isFrozen(rows) && rows.every(Object.isFrozen));
  // No selections enter this projection. Clearing a Pack's artwork cannot
  // shrink the persistent layout or shift a later Pack's indices.
  assert.deepEqual(makerV8PlayerSlotLayout(JSON.parse(JSON.stringify(input))), rows);
});

test('same-named Parts within one scope reject; foreign, reordered or malformed attachment profiles reject', () => {
  for (const mutate of [
    input => input.parts.push({ ...input.parts[0] }),
    input => { input.parts[0].key = 123; },
    input => { input.parts[0].capacity = 65; },
    input => { input.parts[0].menuOrder = NaN; },
    input => input.packDefinitionLayout.bindings.push({ ...input.packDefinitionLayout.bindings[0] }),
    input => { input.packDefinitionLayout.bindings[0].releaseId = input.rootId; },
    input => { input.packDefinitionLayout.bindings[0].definitionCommitment = 'bad'; },
    input => { input.packDefinitionLayout.profiles[0].releaseId = id(8); },
    input => input.packDefinitionLayout.profiles.reverse(),
    input => input.packDefinitionLayout.profiles.splice(1, 0, { ...input.packDefinitionLayout.profiles[0] }),
    input => { input.packDefinitionLayout.profiles[0].capacity = '02'; },
    input => { input.packDefinitionLayout.profiles[0].capacity = '65'; },
    input => { input.packDefinitionLayout.profiles[0].profileCommitment = null; },
  ]) {
    const input = fixture(); mutate(input);
    assert.throws(() => makerV8PlayerSlotLayout(input), { code: 'MAKER_V8_PLAYER_SLOT_LAYOUT_INVALID' });
  }
});

test('Base equal-menu-order tie break remains protocol text order', () => {
  const rows = makerV8PlayerSlotLayout({ rootId: id(1), parts: [
    { key: 'b', menuOrder: 0, capacity: 1 }, { key: 'A', menuOrder: 0, capacity: 2 },
  ] });
  assert.deepEqual(rows.map(row => [row.partKey, row.start]), [['A', 0], ['b', 2]]);
});
