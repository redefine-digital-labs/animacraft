import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveMakerV8PackProfiles } from '../maker-v8-profile-wire.js';

const fixture = () => ({ contentCommitment: '14'.repeat(32), rows: { parts: [{
  sequence: '0', key: 'plume', required: false, slot_mode: 1, capacity: '2', payload_commitment: Array(32).fill(32),
}] } });
test('Pack profile commitment matches Runtime Move golden and binds admission/content/order', () => {
  const value = deriveMakerV8PackProfiles(fixture(), 1);
  assert.equal(value[0].profileCommitment, '8d135d901e9ec1c72cc028bdef5b4601c6d36a5f60fc57daace0a477c734f6b5');
  assert.ok(Object.isFrozen(value[0]));
  for (const admission of [0, 2]) assert.notEqual(deriveMakerV8PackProfiles(fixture(), admission)[0].profileCommitment, value[0].profileCommitment);
  const different = fixture(); different.contentCommitment = '15'.repeat(32);
  assert.notEqual(deriveMakerV8PackProfiles(different, 1)[0].profileCommitment, value[0].profileCommitment);
  assert.deepEqual(deriveMakerV8PackProfiles({ ...fixture(), rows: { parts: [] } }, 1), []);
});
test('Pack profile derivation rejects invalid owned row policy', () => {
  for (const change of [row => { row.sequence = '1'; }, row => { row.required = true; },
    row => { row.slot_mode = 2; }, row => { row.capacity = '0'; }, row => { row.capacity = '65'; },
    row => { row.payload_commitment = []; }]) {
    const bundle = fixture(); change(bundle.rows.parts[0]);
    assert.throws(() => deriveMakerV8PackProfiles(bundle, 1), { code: 'MAKER_V8_PACK_PROFILE_INVALID' });
  }
  assert.throws(() => deriveMakerV8PackProfiles(fixture(), 3), { code: 'MAKER_V8_PACK_PROFILE_INVALID' });
});
