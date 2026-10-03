import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { WalrusClient } from '@mysten/walrus';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { MAKER_V8_WALRUS_MAX_RELAY_TIP_MIST } from '../maker-v8-walrus.js';

function client(kind, max = MAKER_V8_WALRUS_MAX_RELAY_TIP_MIST) {
  const requests = [];
  const walrus = new WalrusClient({
    network: 'mainnet',
    suiClient: new SuiGrpcClient({ network: 'mainnet', baseUrl: 'https://unused.invalid' }),
    uploadRelay: {
      host: 'https://relay.invalid', sendTip: { max },
      fetch: async (url, options) => {
        requests.push({ url, method: options.method });
        assert.equal(url, 'https://relay.invalid/v1/tip-config');
        assert.equal(options.method, 'GET');
        return Response.json({ send_tip: { address: `0x${'11'.repeat(32)}`, kind } });
      },
    },
  });
  walrus.systemState = async () => ({ committee: { n_shards: 1000 } });
  return { walrus, requests };
}

test('production relay uses a finite 0.01 SUI per-blob ceiling, not a fixed fee', () => {
  assert.equal(MAKER_V8_WALRUS_MAX_RELAY_TIP_MIST, 10_000_000);
  const source = readFileSync(new URL('../maker-v8-walrus.js', import.meta.url), 'utf8');
  assert.match(source, /sendTip: \{ max: MAKER_V8_WALRUS_MAX_RELAY_TIP_MIST \}/);
  assert.doesNotMatch(source, /sendTip: \{ max: 1_000_000 \}/);
});

test('real SDK reproduces old live quote rejection and accepts the same quote within the new cap', async () => {
  const old = client({ const: 2_579_480 }, 1_000_000);
  await assert.rejects(old.walrus.calculateUploadRelayTip({ size: 1 }), /2579480.*1000000/);
  const current = client({ const: 2_579_480 });
  assert.equal(BigInt(await current.walrus.calculateUploadRelayTip({ size: 1 })), 2_579_480n);
  assert.equal(current.requests.length, 1);
});

test('real SDK accepts the exact ceiling and rejects even one MIST above it', async () => {
  const exact = client({ const: MAKER_V8_WALRUS_MAX_RELAY_TIP_MIST });
  assert.equal(BigInt(await exact.walrus.calculateUploadRelayTip({ size: 1 })), 10_000_000n);
  const over = client({ const: MAKER_V8_WALRUS_MAX_RELAY_TIP_MIST + 1 });
  await assert.rejects(over.walrus.calculateUploadRelayTip({ size: 1 }), /10000001.*10000000/);
});

test('real SDK applies the relay linear quote to encoded size and retains the cap', async () => {
  const quoted = client({ linear: { base: 0, encoded_size_mul_per_kib: 40 } });
  const small = await quoted.walrus.calculateUploadRelayTip({ size: 1 });
  const larger = await quoted.walrus.calculateUploadRelayTip({ size: 1_000_000 });
  assert.equal(typeof small, 'bigint');
  assert.ok(small > 0n);
  assert.ok(larger >= small);
  assert.ok(larger <= BigInt(MAKER_V8_WALRUS_MAX_RELAY_TIP_MIST));
  const capped = client({ linear: { base: 0, encoded_size_mul_per_kib: 40 } }, Number(small - 1n));
  await assert.rejects(capped.walrus.calculateUploadRelayTip({ size: 1 }), /exceeds the maximum allowed tip/);
});
