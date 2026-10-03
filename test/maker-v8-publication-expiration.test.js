import assert from 'node:assert/strict';
import test from 'node:test';
import { Transaction } from '@mysten/sui/transactions';
import { makerV8PublicationExpiration } from '../maker-v8-publication-expiration.js';
import { MAKER_V8_SUI_MAINNET_GENESIS_DIGEST } from '../maker-v8-sui-grpc.js';

test('publication expiration round trips BCS with address-balance gas and no owned inputs', async () => {
  const transaction = new Transaction();
  transaction.setSender(`0x${'11'.repeat(32)}`);
  transaction.setGasBudget(1000000);
  transaction.setGasPrice(1000);
  transaction.setGasPayment([]);
  const expiration = makerV8PublicationExpiration('19', {
    getRandomValues(values) { assert.ok(values instanceof Uint32Array); values[0] = 0xffff_ffff; return values; },
  });
  transaction.setExpiration(expiration);
  const bytes = await transaction.build();
  const actual = Transaction.from(bytes).getData();
  assert.deepEqual(actual.gasData.payment, []);
  assert.deepEqual(actual.inputs, []);
  assert.deepEqual(actual.expiration.ValidDuring, {
    minEpoch: '19', maxEpoch: '20', minTimestamp: null, maxTimestamp: null,
    chain: MAKER_V8_SUI_MAINNET_GENESIS_DIGEST, nonce: 0xffff_ffff,
  });
  assert.deepEqual(await Transaction.from(bytes).build(), bytes);
});

test('publication expiration rejects unsafe epochs and unavailable secure randomness', () => {
  for (const epoch of ['-1', '01', '', '1.1', '18446744073709551615', '18446744073709551616', 19]) {
    assert.throws(() => makerV8PublicationExpiration(epoch), /epoch/);
  }
  assert.throws(() => makerV8PublicationExpiration('19', {}), /Secure randomness/);
  assert.equal(makerV8PublicationExpiration('18446744073709551614').ValidDuring.maxEpoch, '18446744073709551615');
});

test('each new envelope requests a fresh secure nonce', () => {
  let calls = 0;
  const crypto = { getRandomValues(values) { values[0] = ++calls; return values; } };
  assert.equal(makerV8PublicationExpiration('19', crypto).ValidDuring.nonce, 1);
  assert.equal(makerV8PublicationExpiration('19', crypto).ValidDuring.nonce, 2);
  assert.equal(calls, 2);
});
