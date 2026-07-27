import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_RUNTIME_CONFIG,
  ANIMACRAFT_MAX_WALRUS_RELAY_TIP_MIST,
  SUI_MAINNET_USDC_TYPE,
  assertSupportedMakerMintEconomics,
  assertSupportedMakerPaymentCoin,
  normalizeRuntimeConfig,
  resolveCallablePackageId,
  resolveOriginalPackageId,
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
  const config = productionConfig();
  Object.assign(config, {
    canonicalSoulMintEnabled: true,
    protocolFeePackageId: '0x5678',
    protocolFeeConfigId: '0xfeed',
    protocolTreasuryId: '0xbeef',
    protocolFeeAdminCapId: '0xcafe',
    protocolFeeAdminCapOwner: '0xadea',
  });
  const result = validateRuntimeConfig(config, { strict: true, requireSoulidity: true });
  assert.equal(result.valid, true);
  assert.equal(result.packageReady, true);
  assert.equal(result.callablePackageReady, true);
  assert.equal(result.originalPackageReady, true);
  assert.equal(result.soulidityReady, true);
  assert.equal(config.canonicalSoulMintEnabled, true);
});

test('Soulidity integration preflight fails closed while canonical minting is gated off', () => {
  const result = validateRuntimeConfig(productionConfig(), { strict: true, requireSoulidity: true });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /canonicalSoulMintEnabled=true/);
});

test('keeps legacy packageId-only configurations upgrade compatible', () => {
  const config = productionConfig();
  assert.equal(config.packageId, '0x1234');
  assert.equal(config.callablePackageId, '0x1234');
  assert.equal(config.originalPackageId, '0x1234');
  assert.equal(resolveCallablePackageId({ packageId: '0x1234' }), '0x1234');
  assert.equal(resolveOriginalPackageId({ packageId: '0x1234' }), '0x1234');
});

test('separates the callable upgrade package from the original type identity', () => {
  const config = normalizeRuntimeConfig({
    packageId: '0x5678',
    callablePackageId: '0x5678',
    originalPackageId: '0x1234',
    appUrl: 'https://animacraft.soulidity.ai',
    soulidityPackageId: '0xabcd',
    canonicalSoulMintEnabled: true,
    protocolFeePackageId: '0x5678',
    protocolFeeConfigId: '0xfeed',
    protocolTreasuryId: '0xbeef',
    protocolFeeAdminCapId: '0xcafe',
    protocolFeeAdminCapOwner: '0xadea',
  });
  const result = validateRuntimeConfig(config, { strict: true, requireSoulidity: true });
  assert.equal(config.packageId, '0x5678');
  assert.equal(config.callablePackageId, '0x5678');
  assert.equal(config.originalPackageId, '0x1234');
  assert.equal(result.valid, true);
  assert.equal(result.packageReady, true);
});

test('rejects an upgraded callable package without a stable protocol-fee TypeOrigin', () => {
  const config = normalizeRuntimeConfig({
    packageId: '0x5678',
    callablePackageId: '0x5678',
    originalPackageId: '0x1234',
    appUrl: 'https://animacraft.soulidity.ai',
    soulidityPackageId: '0xabcd',
  });
  const result = validateRuntimeConfig(config, { strict: true });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /upgraded Animacraft callable package/);
});

test('rejects an ambiguous legacy alias that differs from the callable package', () => {
  const config = productionConfig();
  config.packageId = '0x9999';
  const result = validateRuntimeConfig(config, { strict: true });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /compatibility alias/);
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

test('accepts only the configured on-chain Maker payment coin', () => {
  assert.equal(
    assertSupportedMakerPaymentCoin(SUI_MAINNET_USDC_TYPE, SUI_MAINNET_USDC_TYPE),
    SUI_MAINNET_USDC_TYPE,
  );
  assert.throws(
    () => assertSupportedMakerPaymentCoin('0x2::sui::SUI', SUI_MAINNET_USDC_TYPE),
    /does not match configured native Sui USDC/,
  );
  assert.throws(
    () => assertSupportedMakerPaymentCoin('', SUI_MAINNET_USDC_TYPE),
    /invalid payment coin type/,
  );
});

test('accepts only browser-safe on-chain Maker economics', () => {
  assert.deepEqual(
    assertSupportedMakerMintEconomics({ mintingEnabled: true, mintFeeEnabled: true, mintPriceAtomic: '1500000' }),
    { mintingEnabled: true, mintFeeEnabled: true, mintPriceAtomic: 1_500_000 },
  );
  assert.deepEqual(
    assertSupportedMakerMintEconomics({ mintingEnabled: false, mintFeeEnabled: false, mintPriceAtomic: 0 }),
    { mintingEnabled: false, mintFeeEnabled: false, mintPriceAtomic: 0 },
  );
  assert.throws(
    () => assertSupportedMakerMintEconomics({ mintingEnabled: true, mintFeeEnabled: true, mintPriceAtomic: '9007199254740992' }),
    /cannot be represented safely/,
  );
  assert.throws(
    () => assertSupportedMakerMintEconomics({ mintingEnabled: false, mintFeeEnabled: true, mintPriceAtomic: 1 }),
    /invalid mint economics/,
  );
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

test('keeps the Walrus relay tip ceiling bounded while allowing production quilts', () => {
  const config = productionConfig();
  assert.equal(
    config.walrusRelayMaxTipMist,
    ANIMACRAFT_MAX_WALRUS_RELAY_TIP_MIST,
  );
  config.walrusRelayMaxTipMist = ANIMACRAFT_MAX_WALRUS_RELAY_TIP_MIST + 1;
  const result = validateRuntimeConfig(config, { strict: true });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /walrusRelayMaxTipMist/);
});

test('requires an explicit boolean canonical Soul mint gate', () => {
  const config = productionConfig();
  config.canonicalSoulMintEnabled = 'yes';
  const result = validateRuntimeConfig(config, { strict: true });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /canonicalSoulMintEnabled/);
});

test('requires canonical v4 protocol fee objects before enabling Soul mint', () => {
  const missing = productionConfig();
  missing.canonicalSoulMintEnabled = true;
  let result = validateRuntimeConfig(missing, { strict: true, requireSoulidity: true });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /ProtocolFeeConfig, ProtocolTreasury, AdminCap/);

  const ready = productionConfig();
  Object.assign(ready, {
    canonicalSoulMintEnabled: true,
    protocolFeePackageId: '0x5678',
    protocolFeeConfigId: '0xfeed',
    protocolTreasuryId: '0xbeef',
    protocolFeeAdminCapId: '0xcafe',
    protocolFeeAdminCapOwner: '0xadea',
    primaryProtocolFeeBps: 5_000,
  });
  result = validateRuntimeConfig(ready, { strict: true, requireSoulidity: true });
  assert.equal(result.valid, true);
  assert.equal(result.protocolFeePackageReady, true);
  assert.equal(result.protocolFeeConfigReady, true);
  assert.equal(result.protocolTreasuryReady, true);
  assert.equal(result.protocolFeeAdminCapReady, true);
  assert.equal(result.protocolFeeAdminCapOwnerReady, true);
});

test('keeps the v4 protocol-fee TypeOrigin stable across a later callable upgrade', () => {
  const config = normalizeRuntimeConfig({
    packageId: '0x9999',
    callablePackageId: '0x9999',
    originalPackageId: '0x1234',
    protocolFeePackageId: '0x5678',
    appUrl: 'https://animacraft.soulidity.ai',
    soulidityPackageId: '0xabcd',
    canonicalSoulMintEnabled: true,
    protocolFeeConfigId: '0xfeed',
    protocolTreasuryId: '0xbeef',
    protocolFeeAdminCapId: '0xcafe',
    protocolFeeAdminCapOwner: '0xadea',
  });
  const result = validateRuntimeConfig(config, { strict: true, requireSoulidity: true });
  assert.equal(result.valid, true);
  assert.equal(config.callablePackageId, '0x9999');
  assert.equal(config.originalPackageId, '0x1234');
  assert.equal(config.protocolFeePackageId, '0x5678');
});

test('rejects protocol objects without their defining package TypeOrigin', () => {
  const config = productionConfig();
  config.protocolFeeConfigId = '0xfeed';
  const result = validateRuntimeConfig(config, { strict: true });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /protocolFeePackageId TypeOrigin/);
});

test('caps the configured primary protocol share at fifty percent', () => {
  const config = productionConfig();
  config.primaryProtocolFeeBps = 5_001;
  const result = validateRuntimeConfig(config, { strict: true });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /0 to 5000/);
});
