import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FRESH_V8_ERROR_LAYER,
  classifyFreshV8Error,
} from '../chain-error-ui.js';

test('fresh v8 errors retain exactly one user-visible layer', () => {
  const cases = [
    ['MAKER_V8_SCHEMA_INVALID', FRESH_V8_ERROR_LAYER.LOCAL_SCHEMA_CONFIG],
    ['MARKET_V8_STALE_QUOTE_COMMITMENT', FRESH_V8_ERROR_LAYER.STALE_CONTEXT],
    ['MARKET_V8_LISTING_STATUS_INVALID', FRESH_V8_ERROR_LAYER.ELIGIBILITY],
    ['MARKET_V8_OBJECT_REF_MISMATCH', FRESH_V8_ERROR_LAYER.CUSTODY_AUTHORITY],
    ['MARKET_V8_PAYMENT_AMOUNT_MISMATCH', FRESH_V8_ERROR_LAYER.QUOTE_PAYMENT],
    ['WEB_V8_MOVE_ABORT', FRESH_V8_ERROR_LAYER.DRY_RUN_MOVE_ABORT],
    ['WEB_V8_WALLET_NETWORK_MISMATCH', FRESH_V8_ERROR_LAYER.WALLET],
    ['MAKER_V8_RECOVERY_STORAGE_FAILED', FRESH_V8_ERROR_LAYER.DURABLE_STORAGE],
    ['MAKER_V8_RECOVERY_BROADCAST_FAILED', FRESH_V8_ERROR_LAYER.SUBMISSION_AMBIGUITY],
    ['MAKER_V8_RECOVERY_FINALIZED_FAILURE_REPLAY', FRESH_V8_ERROR_LAYER.FINALIZED_EXECUTION],
    ['MAKER_V8_RECOVERY_READBACK_PENDING', FRESH_V8_ERROR_LAYER.READBACK_INDEXING],
  ];
  for (const [code, layer] of cases) {
    const issue = classifyFreshV8Error(Object.assign(new Error(code), { code }), {
      action: 'purchaseMakerControl',
      occurredAt: '2026-08-21T00:00:00.000Z',
    });
    assert.equal(issue.layer, layer, code);
    assert.equal(Object.values(FRESH_V8_ERROR_LAYER).filter((entry) => entry === issue.layer).length, 1);
    assert.match(issue.diagnostic, new RegExp(`Layer: ${layer}`));
    assert.match(issue.diagnostic, /Action: purchaseMakerControl/);
  }
});

test('recovery-supplied layers take precedence over ambiguous text', () => {
  const issue = classifyFreshV8Error(Object.assign(new Error('wallet and broadcast words'), {
    code: 'MAKER_V8_RECOVERY_CONTEXT_DRIFT',
    layer: 'CONTEXT',
    retryable: false,
  }));
  assert.equal(issue.layer, FRESH_V8_ERROR_LAYER.STALE_CONTEXT);
  assert.equal(issue.retryable, true);
});

test('diagnostics are bounded and do not serialize arbitrary object fields', () => {
  const issue = classifyFreshV8Error({
    code: 'WEB_V8_BAD_INPUT',
    message: 'x'.repeat(20_000),
    secret: 'must-not-appear',
  });
  assert.ok(issue.details.length <= 8_000);
  assert.doesNotMatch(issue.diagnostic, /must-not-appear/);
});
