import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_RUNTIME_CONFIG,
  SUI_MAINNET_USDC_TYPE,
  normalizeRuntimeConfig,
  validateRuntimeConfig,
} from '../runtime-config.js';

function productionConfig() {
  return normalizeRuntimeConfig({
    packageId: '0x1234',
    appUrl: 'https://animacraft.soulidity.ai',
    soulidityPackageId: '0xabcd',
  });
}

test('accepts a complete Mainnet production configuration', () => {
  const result = validateRuntimeConfig(productionConfig(), { strict: true, requireSoulidity: true });
  assert.equal(result.valid, true);
  assert.equal(result.packageReady, true);
  assert.equal(result.soulidityReady, true);
  assert.equal(productionConfig().canonicalSoulMintEnabled, false);
});

test('keeps source placeholders as warnings outside strict activation', () => {
  const config = normalizeRuntimeConfig(DEFAULT_RUNTIME_CONFIG, 'http://127.0.0.1:3200');
  const result = validateRuntimeConfig(config);
  assert.equal(result.valid, true);
  assert.equal(result.packageReady, false);
  assert.ok(result.warnings.length >= 1);
});

test('blocks an alternate token from impersonating native USDC', () => {
  const config = productionConfig();
  config.paymentCoinType = '0x2::sui::SUI';
  const result = validateRuntimeConfig(config, { strict: true });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /Circle native Sui USDC/);
  assert.equal(SUI_MAINNET_USDC_TYPE.includes('::usdc::USDC'), true);
});

test('rejects unsafe Walrus retention and malformed featured ids', () => {
  const config = productionConfig();
  config.walrusEpochs = 54;
  config.featuredMakers = { launch: 'not-an-object' };
  const result = validateRuntimeConfig(config, { strict: true });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /walrusEpochs/);
  assert.match(result.errors.join(' '), /featuredMakers/);
});

test('requires an explicit boolean canonical Soul mint gate', () => {
  const config = productionConfig();
  config.canonicalSoulMintEnabled = 'yes';
  const result = validateRuntimeConfig(config, { strict: true });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /canonicalSoulMintEnabled/);
});
