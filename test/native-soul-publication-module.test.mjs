import test from 'node:test';
import assert from 'node:assert/strict';
import { assertMainnetV8PublishedModuleBytes as check } from '../scripts/mainnet-v8-release.mjs';

function fixture(address, start = 24, length = 96) {
  const source = Buffer.alloc(length, 7);
  source.fill(0, start, start + 32);
  const published = Buffer.from(source);
  address.copy(published, start);
  return { source, published, input: {
    role: 'soulidity', moduleName: 'soul', packageId: `0x${address.toString('hex')}`,
    sourceBase64: source.toString('base64'), publishedBase64: published.toString('base64'),
  } };
}
for (let zeroAt = 0; zeroAt < 32; zeroAt++) {
  test(`publication substitution accepts zero address byte at ${zeroAt}`, () => {
    const address = Buffer.alloc(32, 17); address[zeroAt] = 0;
    assert.equal(check(fixture(address).input).selfAddressOffset, '24');
  });
}
test('leading/trailing zeros, one nonzero byte and boundary-aligned replacement remain exact', () => {
  for (const nonzeroAt of [0, 1, 15, 30, 31]) {
    const address = Buffer.alloc(32); address[nonzeroAt] = 17;
    for (const start of [0, 24, 64]) {
      assert.equal(check(fixture(address, start).input).selfAddressOffset, String(start));
    }
  }
});
test('zero address, unchanged bytes and mutations outside or inside the full address span reject', () => {
  assert.throws(() => check(fixture(Buffer.alloc(32)).input));
  const address = Buffer.alloc(32, 17); address[0] = 0; address[10] = 0; address[31] = 0;
  const { input, source, published } = fixture(address);
  assert.throws(() => check({ ...input, publishedBase64: source.toString('base64') }));
  for (const offset of [0, 23, 24, 25, 34, 54, 55, 56, 95]) {
    const corrupt = Buffer.from(published); corrupt[offset] ^= 1;
    assert.throws(() => check({ ...input, publishedBase64: corrupt.toString('base64') }));
  }
  const nonzeroSource = Buffer.from(source); nonzeroSource[34] = 1;
  const nonzeroOutput = Buffer.from(published); nonzeroOutput[34] = 1;
  assert.throws(() => check({ ...input, sourceBase64: nonzeroSource.toString('base64'), publishedBase64: nonzeroOutput.toString('base64') }));
  assert.throws(() => check({ ...input, publishedBase64: published.subarray(1).toString('base64') }));
});
