import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyChainUiError } from '../chain-error-ui.js';

test('classifies a nested Walrus relay maximum-tip rejection without exposing a stack', () => {
  const error = new Error('Walrus relay transaction could not be prepared');
  error.cause = {
    code: 'RPC_ERROR',
    error: {
      message: 'Tip amount 1200000 exceeds maximum allowed tip 1000000',
    },
  };
  const result = classifyChainUiError(error, {
    action: 'publish',
    occurredAt: '2026-07-27T12:00:00.000Z',
  });

  assert.equal(result.code, 'TIP_TOO_HIGH');
  assert.equal(result.action, 'publish');
  assert.match(result.details, /Tip amount 1200000 exceeds maximum allowed tip 1000000/);
  assert.match(result.diagnostic, /Code: TIP_TOO_HIGH/);
  assert.match(result.diagnostic, /Action: publish/);
  assert.doesNotMatch(result.diagnostic, /\n\s+at /);
});

test('classifies common retry and wallet outcomes with a safe generic fallback', () => {
  assert.equal(classifyChainUiError({ code: 'UPLOAD_QUOTE_CHANGED' }).code, 'UPLOAD_QUOTE_CHANGED');
  assert.equal(
    classifyChainUiError({ code: 'WALRUS_CERTIFICATION_NOT_VISIBLE' }).code,
    'WALRUS_CERTIFICATION_NOT_VISIBLE',
  );
  assert.equal(classifyChainUiError({ code: 'TRANSACTION_OUTCOME_PENDING' }).code, 'TRANSACTION_OUTCOME_PENDING');
  assert.equal(classifyChainUiError({ code: 'INSUFFICIENT_WAL_BALANCE' }).code, 'INSUFFICIENT_WAL_BALANCE');
  assert.equal(classifyChainUiError({ code: 'INSUFFICIENT_SUI_BALANCE' }).code, 'INSUFFICIENT_SUI_BALANCE');
  assert.equal(classifyChainUiError({ code: 'UPLOAD_RECOVERY_MISMATCH' }).code, 'UPLOAD_RECOVERY_MISMATCH');
  assert.equal(classifyChainUiError(new Error('User rejected the request')).code, 'WALLET_REJECTED');
  assert.equal(classifyChainUiError(new Error('Insufficient gas balance')).code, 'INSUFFICIENT_GAS');
  assert.equal(classifyChainUiError(new Error('Network error: failed to fetch')).code, 'NETWORK_UNAVAILABLE');
  assert.equal(classifyChainUiError(new Error('Move abort 42')).code, 'CHAIN_ACTION_FAILED');
});

test('classifies a confirmed Walrus certification as a state-sync wait rather than a failed action', () => {
  const result = classifyChainUiError(new Error(
    'Walrus certification 0xdigest is confirmed but the certified Blob object is not visible yet.',
  ), {
    action: 'certify',
    occurredAt: '2026-07-27T06:21:08.240Z',
  });

  assert.equal(result.code, 'WALRUS_CERTIFICATION_NOT_VISIBLE');
  assert.equal(result.action, 'certify');
  assert.match(result.diagnostic, /^Animacraft chain state is still syncing/m);
  assert.doesNotMatch(result.diagnostic, /^Animacraft chain action failed/m);
});
