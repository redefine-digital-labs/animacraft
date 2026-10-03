import assert from 'node:assert/strict';
import test from 'node:test';
import { assertMakerV8EnabledPackReleaseIds } from '../maker-v8-player-pack-preferences.js';
const a = `0x${'11'.repeat(32)}`;
const b = `0x${'22'.repeat(32)}`;

test('catalog preferences preserve exact canonical IDs and contain every actually selected Pack', () => {
  const recipe = { selections: [{ source: 'BASE' }, { source: 'PACK', releaseId: a }] };
  const enabled = Object.freeze([a, b]);
  assert.equal(assertMakerV8EnabledPackReleaseIds(enabled, recipe), enabled);
  assert.throws(() => assertMakerV8EnabledPackReleaseIds([b], recipe), /selected Pack/);
  assert.deepEqual(recipe, { selections: [{ source: 'BASE' }, { source: 'PACK', releaseId: a }] });
});

test('malformed, duplicate, unsorted and sparse catalog preferences are rejected', () => {
  for (const value of [null, undefined, {}, [a, a], [b, a], ['0x11'], [a.toUpperCase()], [null], Array(1), Object.assign([a], { extra: true })]) {
    assert.throws(() => assertMakerV8EnabledPackReleaseIds(value), TypeError);
  }
  assert.deepEqual(assertMakerV8EnabledPackReleaseIds([]), []);
});
