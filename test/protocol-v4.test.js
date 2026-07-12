import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const ROOT = new URL('../', import.meta.url);

test('web and Move use the non-bypassable v4 paid authorization path', async () => {
  const [move, runtime, chain] = await Promise.all([
    readFile(new URL('move/animacraft/sources/animacraft.move', ROOT), 'utf8'),
    readFile(new URL('runtime-config.js', ROOT), 'utf8'),
    readFile(new URL('chain-runtime.js', ROOT), 'utf8'),
  ]);

  assert.match(move, /const VERSION: u64 = 4;/);
  assert.match(move, /public fun authorize_soul_mint_paid[\s\S]*?abort EDeprecatedPaidMint/);
  assert.match(move, /public fun authorize_soul_mint_paid_with_protocol_fee<PaymentCoin>/);
  assert.match(move, /const DEFAULT_PRIMARY_PROTOCOL_FEE_BPS: u16 = 5_000;/);
  assert.match(runtime, /protocolFeeConfigId:\s*''/);
  assert.match(runtime, /protocolTreasuryId:\s*''/);
  assert.match(chain, /authorize_soul_mint_paid_with_protocol_fee/);
  assert.doesNotMatch(chain, /moveTarget\(paid \? 'authorize_soul_mint_paid'/);
});
