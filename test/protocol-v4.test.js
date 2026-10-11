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
  assert.match(move, /const EDeprecatedFreeMint: u64 = 48;/);
  assert.match(move, /public fun authorize_soul_mint\([\s\S]*?abort EDeprecatedFreeMint/);
  assert.match(move, /public fun authorize_soul_mint_with_protocol_gate\(\s*maker: &OCMaker,\s*protocol_config: &ProtocolFeeConfig,/);
  assert.match(move, /public fun authorize_soul_mint_paid[\s\S]*?abort EDeprecatedPaidMint/);
  assert.match(move, /public fun authorize_soul_mint_paid_with_protocol_fee<PaymentCoin>/);
  assert.match(move, /public fun initialize_protocol_fees<PaymentCoin>\(\s*publisher: package::Publisher,/);
  assert.match(move, /new_protocol_fee_objects<PaymentCoin>\(option::some\(publisher\), false, ctx\)/);
  assert.match(move, /publisher: Option<package::Publisher>/);
  assert.match(move, /const DEFAULT_PRIMARY_PROTOCOL_FEE_BPS: u16 = 5_000;/);
  assert.match(runtime, /protocolFeeConfigId:\s*''/);
  assert.match(runtime, /protocolTreasuryId:\s*''/);
  assert.match(chain, /authorize_soul_mint_with_protocol_gate/);
  assert.match(chain, /authorize_soul_mint_paid_with_protocol_fee/);
  assert.match(chain, /paid \? \[[\s\S]*?tx\.object\(protocolFeeConfigId\)[\s\S]*?\] : \[\s*tx\.object\(protocolFeeConfigId\)/);
  assert.doesNotMatch(chain, /moveTarget\(paid \? 'authorize_soul_mint_paid'/);
});
