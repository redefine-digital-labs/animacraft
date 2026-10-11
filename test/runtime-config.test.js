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
  assert.equal(result.soulidityTypeOriginReady, true);
  assert.equal(config.canonicalSoulMintEnabled, true);
});

test('rejects a malformed stable Soulidity TypeOrigin before receipt verification is enabled', () => {
  const config = productionConfig();
  config.soulidityTypeOriginPackageId = 'not-a-package';
  const result = validateRuntimeConfig(config, {
    strict: true,
    requireSoulidity: true,
  });
  assert.equal(result.valid, false);
  assert.equal(result.soulidityTypeOriginReady, false);
  assert.match(result.errors.join(' '), /soulidityTypeOriginPackageId/);
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

test('keeps Commerce v5 disabled and unconfigured until its reviewed Mainnet initialization', () => {
  const config = productionConfig();
  const result = validateRuntimeConfig(config, { strict: true });
  assert.equal(result.valid, true);
  assert.equal(config.commerceV5ReleaseEnabled, false);
  assert.equal(result.commerceV5TypeOriginPackageReady, false);
  assert.equal(result.commerceProtocolConfigV5Ready, false);
  assert.equal(result.commerceProtocolTreasuryV5Ready, false);
  assert.equal(result.commerceV5LogicalAuxiliaryBlobReady, false);
  assert.equal(result.commerceV5SoulBindingProofReady, false);
});

test('Commerce v5 release gate requires one complete stable object tuple', () => {
  const missing = productionConfig();
  missing.commerceV5ReleaseEnabled = true;
  let result = validateRuntimeConfig(missing, { strict: true });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /Commerce v5 cannot be released/);

  const partial = productionConfig();
  partial.commerceV5TypeOriginPackageId = '0x5555';
  result = validateRuntimeConfig(partial, { strict: true });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /must include its stable TypeOrigin/);

  const ready = productionConfig();
  Object.assign(ready, {
    commerceV5TypeOriginPackageId: '0x5555',
    commerceProtocolConfigV5Id: '0xc055',
    commerceProtocolTreasuryV5Id: '0x7ea5',
    commerceV5LogicalAuxiliaryBlobId:
      '35uepW2PoPAgFnv8xTvAjHdc2JBCVMdcHxmxojH85x4e',
    commerceV5SoulBindingProofType:
      '0xabcd::animacraft_soul_binding_v5::AnimacraftSoulBindingProofV5',
    commerceV5ReleaseEnabled: true,
    canonicalSoulMintEnabled: true,
    soulidityTypeOriginPackageId: '0xabcd',
    protocolFeePackageId: '0x5678',
    protocolFeeConfigId: '0xfeed',
    protocolTreasuryId: '0xbeef',
    protocolFeeAdminCapId: '0xcafe',
    protocolFeeAdminCapOwner: '0xadea',
    sealV5PackageId: '0x5555',
    sealKeyServers: [{
      objectId: '0x6860',
      aggregatorUrl: 'https://seal.example.com',
      weight: 1,
    }],
    sealThreshold: 1,
  });
  result = validateRuntimeConfig(ready, { strict: true });
  assert.equal(result.valid, true);
  assert.equal(result.commerceV5TypeOriginPackageReady, true);
  assert.equal(result.commerceProtocolConfigV5Ready, true);
  assert.equal(result.commerceProtocolTreasuryV5Ready, true);
  assert.equal(result.commerceV5LogicalAuxiliaryBlobReady, true);
  assert.equal(result.commerceV5SoulBindingProofReady, true);
  assert.equal(result.sealV5PackageReady, true);
  assert.equal(result.sealServersReady, true);
  assert.equal(result.sealThresholdReady, true);
});

test('Commerce v5 cannot open before the atomic Soulidity completion gate', () => {
  const config = productionConfig();
  Object.assign(config, {
    commerceV5TypeOriginPackageId: '0x5555',
    commerceProtocolConfigV5Id: '0xc055',
    commerceProtocolTreasuryV5Id: '0x7ea5',
    commerceV5LogicalAuxiliaryBlobId:
      '35uepW2PoPAgFnv8xTvAjHdc2JBCVMdcHxmxojH85x4e',
    commerceV5SoulBindingProofType:
      '0xabcd::animacraft_soul_binding_v5::AnimacraftSoulBindingProofV5',
    commerceV5ReleaseEnabled: true,
    sealV5PackageId: '0x5555',
    sealKeyServers: [{
      objectId: '0x6860',
      aggregatorUrl: 'https://seal.example.com',
      weight: 1,
    }],
    sealThreshold: 1,
  });
  const result = validateRuntimeConfig(config, { strict: true });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /canonical Soulidity mint gate/);
});

test('Commerce v5 proof type must come from the stable Soulidity TypeOrigin', () => {
  const config = productionConfig();
  Object.assign(config, {
    commerceV5TypeOriginPackageId: '0x5555',
    commerceProtocolConfigV5Id: '0xc055',
    commerceProtocolTreasuryV5Id: '0x7ea5',
    commerceV5LogicalAuxiliaryBlobId:
      '35uepW2PoPAgFnv8xTvAjHdc2JBCVMdcHxmxojH85x4e',
    commerceV5SoulBindingProofType:
      '0x9999::animacraft_soul_binding_v5::AnimacraftSoulBindingProofV5',
  });
  const result = validateRuntimeConfig(config, { strict: true });
  assert.equal(result.valid, false);
  assert.equal(result.commerceV5SoulBindingProofReady, false);
  assert.match(result.errors.join(' '), /exact AnimacraftSoulBindingProofV5/);
});

test('Seal v5 fails closed on partial credentials and invalid outer thresholds', () => {
  const config = productionConfig();
  Object.assign(config, {
    sealV5PackageId: '0x5555',
    sealKeyServers: [{
      objectId: '0x6860',
      aggregatorUrl: 'https://seal.example.com',
      weight: 1,
      apiKeyName: 'X-API-Key',
    }],
    sealThreshold: 5,
  });
  const result = validateRuntimeConfig(config, { strict: true });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /apiKeyName and apiKey together/);
  assert.match(result.errors.join(' '), /outer weight threshold/);
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
