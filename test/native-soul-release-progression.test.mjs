import test from 'node:test';
import assert from 'node:assert/strict';
import { nextMainnetV8FinalizedAction, parseMainnetV8ReleaseArgs } from '../scripts/mainnet-v8-release.mjs';

// Actual runner dispatch, offline only: not a signed WAL or deployment proof.
const expected = [
  ...Array.from({ length: 7 }, (_, i) => ({ kind: 'PREPARE_PUBLISH', ordinal: i + 1 })),
  { kind: 'SEAL_MANIFEST' },
  { kind: 'PREPARE_BOOTSTRAP', stage: 'SETUP_RELEASE' },
  { kind: 'PREPARE_BOOTSTRAP', stage: 'BEGIN_BOOTSTRAP' },
  { kind: 'PREPARE_BOOTSTRAP', stage: 'FINALIZE_BOOTSTRAP' },
  { kind: 'PREPARE_MARKET_ACTIVATION' },
  { kind: 'PREPARE_VERIFY' },
  { kind: 'COMPLETE' },
];
for (const [ordinal, action] of expected.entries()) {
  test(`finalized stage ${ordinal} selects the actual next action`, () => {
    const result = nextMainnetV8FinalizedAction({ ordinal: String(ordinal), status: 'FINALIZED_SUCCESS' });
    assert.deepEqual(result, action);
    assert.ok(Object.isFrozen(result));
  });
}
test('only sealed publication 7 enters protocol initialization', () => {
  assert.deepEqual(nextMainnetV8FinalizedAction({ ordinal: '7', status: 'FINAL_MANIFEST_SEALED' }),
    { kind: 'PREPARE_BOOTSTRAP', stage: 'INITIALIZE_PROTOCOL' });
  for (const ordinal of ['0', '6', '8', '9', '11', '12', '13']) {
    assert.throws(() => nextMainnetV8FinalizedAction({ ordinal, status: 'FINAL_MANIFEST_SEALED' }),
      { code: 'MAINNET_V8_WAL_STATE_UNHANDLED' });
  }
});
test('non-final and invalid cursors never advance', () => {
  for (const event of [undefined, {}, { ordinal: '14', status: 'FINALIZED_SUCCESS' },
    { ordinal: 13, status: 'FINALIZED_SUCCESS' }, { ordinal: '13', status: 'READY' },
    { ordinal: '13', status: 'FINALIZED_FAILURE' }]) {
    assert.throws(() => nextMainnetV8FinalizedAction(event), { code: 'MAINNET_V8_WAL_STATE_UNHANDLED' });
  }
});
test('runner command constants remain available after historical incident cleanup', () => {
  assert.deepEqual(parseMainnetV8ReleaseArgs([]), { command: 'status', options: {} });
  assert.deepEqual(parseMainnetV8ReleaseArgs(['verify', '--state-dir', '/tmp/release']),
    { command: 'verify', options: { 'state-dir': '/tmp/release' } });
});
