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
  resolveSealV5CallablePackageId,
  resolveSealV5TypeOriginPackageId,
  resolveSoulidityCallablePackageId,
  resolveSouliditySealNamespacePackageId,
  validateRuntimeConfig,
} from '../runtime-config.js';

function productionConfig() {
  return normalizeRuntimeConfig({
    packageId: '0x1234',
    appUrl: 'https://animacraft.soulidity.ai',
    soulidityPackageId: '0xabcd',
  });
}

function productionV6Config() {
  const config = productionConfig();
  Object.assign(config, {
    packageId: '0x6666',
    callablePackageId: '0x6666',
    originalPackageId: '0x1234',
    soulidityPackageId: '0xdddd',
    soulidityCallablePackageId: '0xdddd',
    souliditySealNamespacePackageId: '0xabcd',
    canonicalSoulMintEnabled: true,
    protocolFeePackageId: '0x5678',
    protocolFeeConfigId: '0xfeed',
    protocolTreasuryId: '0xbeef',
    protocolFeeAdminCapId: '0xcafe',
    protocolFeeAdminCapOwner: '0xadea',
    soulidityTypeOriginPackageId: '0xabcd',
    commerceV5TypeOriginPackageId: '0x5555',
    commerceProtocolConfigV5Id: '0xc055',
    commerceProtocolTreasuryV5Id: '0x7ea5',
    commerceV5LogicalAuxiliaryBlobId:
      '35uepW2PoPAgFnv8xTvAjHdc2JBCVMdcHxmxojH85x4e',
    commerceV5SoulBindingProofType:
      '0xabcd::animacraft_soul_binding_v5::AnimacraftSoulBindingProofV5',
    commerceV5ReleaseEnabled: true,
    sealV5CallablePackageId: '0x5555',
    sealV5TypeOriginPackageId: '0x5555',
    sealKeyServers: [{
      objectId: '0x6860',
      aggregatorUrl: 'https://seal.example.com',
      weight: 1,
    }],
    sealThreshold: 1,
    compositionV6TypeOriginPackageId: '0x6666',
    compositionProtocolConfigV6Id: '0xc066',
    compositionProtocolTreasuryV6Id: '0x7ea6',
    compositionRegistryV6Id: '0xae66',
    compositionAdminCapV6Id: '0xca66',
    compositionAdminCapV6Owner: '0xadea',
    compositionValidatorCapV6Id: '0xca67',
    compositionValidatorCapV6Owner: '0xbeea',
    compositionValidatorEpochV6: 0,
    compositionValidatorPolicyCommitmentV6: `0x${'ab'.repeat(32)}`,
    compositionV6SoulOwnerProofTypeOriginPackageId: '0xdcba',
    compositionV6SoulOwnerProofType:
      '0xdcba::animacraft_soul_owner_proof_v6::AnimacraftSoulOwnerProofV6',
  });
  return config;
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

test('keeps the Soulidity Seal namespace frozen while approval calls advance', () => {
  const config = normalizeRuntimeConfig({
    packageId: '0x1234',
    soulidityPackageId: '0x2222',
    soulidityCallablePackageId: '0x2222',
    souliditySealNamespacePackageId: '0x1111',
  });
  const result = validateRuntimeConfig(config, {
    strict: true,
    requireSoulidity: true,
  });
  assert.equal(config.soulidityPackageId, '0x2222');
  assert.equal(resolveSoulidityCallablePackageId(config), '0x2222');
  assert.equal(resolveSouliditySealNamespacePackageId(config), '0x1111');
  assert.equal(result.soulidityReady, true);
  assert.equal(result.souliditySealNamespaceReady, true);
  assert.match(result.errors.join(' '), /canonicalSoulMintEnabled=true/);
  assert.doesNotMatch(result.errors.join(' '), /Seal namespace/);
});

test('keeps a legacy Seal package alias compatible before package upgrades', () => {
  const config = normalizeRuntimeConfig({
    packageId: '0x1234',
    sealV5PackageId: '0x5555',
  });
  assert.equal(config.sealV5PackageId, '0x5555');
  assert.equal(config.sealV5CallablePackageId, '0x5555');
  assert.equal(config.sealV5TypeOriginPackageId, '0x5555');
  assert.equal(resolveSealV5CallablePackageId(config), '0x5555');
  assert.equal(resolveSealV5TypeOriginPackageId(config), '0x5555');
});

test('freezes Seal v5 callable and TypeOrigin while Animacraft advances to v6', () => {
  const config = productionV6Config();
  const result = validateRuntimeConfig(config, { strict: true });
  assert.equal(config.callablePackageId, '0x6666');
  assert.equal(config.sealV5CallablePackageId, '0x5555');
  assert.equal(config.sealV5TypeOriginPackageId, '0x5555');
  assert.equal(result.sealV5CallablePackageReady, true);
  assert.equal(result.sealV5TypeOriginPackageReady, true);
  assert.equal(result.valid, true);
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

test('accepts initialized disabled v5 and v6 cores before bind-once Soul dependencies exist', () => {
  const config = productionConfig();
  Object.assign(config, {
    packageId: '0x2221610b5513ef3f926433229b7f0b565e850d56020e344266737cdca078af3b',
    callablePackageId: '0x2221610b5513ef3f926433229b7f0b565e850d56020e344266737cdca078af3b',
    originalPackageId: '0x9678afa6b008ddd0637b7723e30beac1c2a1d096b39c76b103f1a1841dc1ffea',
    protocolFeePackageId: '0xc1bbfe03cc93e27903e1ffd1a712745384cd537d6edadfb0e759bf6e090e53cc',
    commerceV5TypeOriginPackageId: '0xcf369b8b02ac1e997146fc3be3f03870db14eaccf3d2cb7a9b93724be463108e',
    commerceProtocolConfigV5Id: '0xf63dc43bb3787fff47fec7f8c3ff2e777dd0966500570fa7deab2bef9b6da0d5',
    commerceProtocolTreasuryV5Id: '0x97ba8042011d6c2d4857a33789a8250c16f6effeda622cb312fe481e0b907d44',
    commerceV5LogicalAuxiliaryBlobId: '',
    commerceV5SoulBindingProofType: '',
    commerceV5ReleaseEnabled: false,
    compositionV6TypeOriginPackageId: '0x2221610b5513ef3f926433229b7f0b565e850d56020e344266737cdca078af3b',
    compositionProtocolConfigV6Id: '0x23cc495061f62a9b6a4e1048e154cd1fdc41f3b251783887db5948644eaca26d',
    compositionProtocolTreasuryV6Id: '0xa60448ef8c32690efdbfb07aff0c13b40c7c948b9819448181ae70257be9dc1c',
    compositionRegistryV6Id: '0x2ffed9aadcdb3a5dc670bf75c1ce8ee671afe93d0f4770cf5a0604dbaec4e5ab',
    compositionAdminCapV6Id: '0x3feb45f8ed2062fb3fb32ca92bb3c1fa4002d521fc73022a3265db6bbba27cdd',
    compositionAdminCapV6Owner: '0xadea1910ac0e738dc020247bc5408b57b15f3701026a96098b716a35c3a6c52f',
    compositionValidatorCapV6Id: '0x0ce2ec07a69e0f8e0281df12e25e63709077880b6e0ba3060ab5362f46d88111',
    compositionValidatorCapV6Owner: '0xadea1910ac0e738dc020247bc5408b57b15f3701026a96098b716a35c3a6c52f',
    compositionValidatorEpochV6: 0,
    compositionValidatorPolicyCommitmentV6: '0x9afe83e5c22d9782c3b4f8cb1020816ed869c0ae71186b034043593527926682',
    compositionV6SoulOwnerProofTypeOriginPackageId: '',
    compositionV6SoulOwnerProofType: '',
    compositionV6ReleaseEnabled: false,
  });

  const result = validateRuntimeConfig(config, { strict: true });
  assert.equal(result.valid, true, result.errors.join('\n'));
  assert.equal(result.commerceV5TypeOriginPackageReady, true);
  assert.equal(result.commerceV5LogicalAuxiliaryBlobReady, false);
  assert.equal(result.commerceV5SoulBindingProofReady, false);
  assert.equal(result.compositionV6TypeOriginPackageReady, true);
  assert.equal(result.compositionV6SoulOwnerProofTypeOriginPackageReady, false);
  assert.equal(result.compositionV6SoulOwnerProofReady, false);
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
    sealV5CallablePackageId: '0x1234',
    sealV5TypeOriginPackageId: '0x5555',
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
    sealV5CallablePackageId: '0x1234',
    sealV5TypeOriginPackageId: '0x5555',
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

test('keeps Composable Assets v6 disabled and proof-unbound by default', () => {
  const config = productionConfig();
  const result = validateRuntimeConfig(config, { strict: true });
  assert.equal(result.valid, true);
  assert.equal(config.compositionV6ReleaseEnabled, false);
  assert.equal(result.compositionV6TypeOriginPackageReady, false);
  assert.equal(result.compositionProtocolConfigV6Ready, false);
  assert.equal(result.compositionProtocolTreasuryV6Ready, false);
  assert.equal(result.compositionRegistryV6Ready, false);
  assert.equal(result.compositionV6SoulOwnerProofTypeOriginPackageReady, true);
  assert.equal(result.compositionV6SoulOwnerProofReady, false);
});

test('Composable Assets v6 release gate requires its complete tuple and active v5', () => {
  const missing = productionConfig();
  missing.compositionV6ReleaseEnabled = true;
  let result = validateRuntimeConfig(missing, { strict: true });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /Composable Assets v6 cannot be released/);

  const partial = productionConfig();
  partial.compositionV6TypeOriginPackageId = '0x6666';
  result = validateRuntimeConfig(partial, { strict: true });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /complete object tuple|must include its stable TypeOrigin/);

  const ready = productionV6Config();
  ready.compositionV6ReleaseEnabled = true;
  result = validateRuntimeConfig(ready, { strict: true });
  assert.equal(result.valid, true);
  assert.equal(result.compositionV6TypeOriginPackageReady, true);
  assert.equal(result.compositionProtocolConfigV6Ready, true);
  assert.equal(result.compositionProtocolTreasuryV6Ready, true);
  assert.equal(result.compositionRegistryV6Ready, true);
  assert.equal(result.compositionAdminCapV6Ready, true);
  assert.equal(result.compositionAdminCapV6OwnerReady, true);
  assert.equal(result.compositionValidatorCapV6Ready, true);
  assert.equal(result.compositionValidatorCapV6OwnerReady, true);
  assert.equal(result.compositionValidatorEpochV6Ready, true);
  assert.equal(result.compositionValidatorPolicyCommitmentV6Ready, true);
  assert.equal(result.compositionV6SoulOwnerProofTypeOriginPackageReady, true);
  assert.equal(result.compositionV6SoulOwnerProofReady, true);
});

test('Physical v7 requires an independently callable companion package', () => {
  const missing = productionV6Config();
  Object.assign(missing, {
    compositionV6ReleaseEnabled: true,
    physicalV7TypeOriginPackageId: '0x7777',
    physicalProtocolConfigV7Id: '0xc077',
    physicalRegistryV7Id: '0xae77',
    physicalAdminCapV7Id: '0xca77',
    physicalAdminCapV7Owner: '0xadea',
    physicalV7SoulOwnerProofTypeOriginPackageId: '0xdcba',
    physicalV7SoulOwnerProofType:
      '0xdcba::animacraft_soul_owner_proof_v6::AnimacraftSoulOwnerProofV6',
  });
  let result = validateRuntimeConfig(missing, { strict: true });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /companion callable package/);

  missing.physicalV7CallablePackageId = '0x7788';
  missing.physicalStyleV7ReleaseEnabled = true;
  result = validateRuntimeConfig(missing, { strict: true });
  assert.equal(result.valid, true, result.errors.join('\n'));
  assert.equal(result.physicalV7CoreReady, true);
});

test('Composable Assets v6 rejects incomplete cap custody and validator policy evidence', () => {
  const config = productionV6Config();
  config.compositionValidatorPolicyCommitmentV6 = '0x1234';
  config.compositionAdminCapV6Owner = '';
  const result = validateRuntimeConfig(config, { strict: true });
  assert.equal(result.valid, false);
  assert.equal(result.compositionAdminCapV6OwnerReady, false);
  assert.equal(result.compositionValidatorPolicyCommitmentV6Ready, false);
  assert.match(result.errors.join(' '), /32-byte|full object\/cap custody tuple/);
});

test('Composable Assets v6 owner proof uses its own TypeOrigin without advancing v5', () => {
  const config = productionV6Config();
  assert.equal(config.soulidityTypeOriginPackageId, '0xabcd');
  assert.equal(config.compositionV6SoulOwnerProofTypeOriginPackageId, '0xdcba');
  assert.equal(config.commerceV5SoulBindingProofType,
    '0xabcd::animacraft_soul_binding_v5::AnimacraftSoulBindingProofV5');
  assert.equal(config.compositionV6SoulOwnerProofType,
    '0xdcba::animacraft_soul_owner_proof_v6::AnimacraftSoulOwnerProofV6');

  config.compositionV6SoulOwnerProofType =
    '0x9999::animacraft_soul_owner_proof_v6::AnimacraftSoulOwnerProofV6';
  const result = validateRuntimeConfig(config, { strict: true });
  assert.equal(result.valid, false);
  assert.equal(result.compositionV6SoulOwnerProofReady, false);
  assert.match(result.errors.join(' '), /exact AnimacraftSoulOwnerProofV6/);
});

test('reviewed v6 TypeOrigin may be recorded before the bind-once proof ceremony', () => {
  const config = productionV6Config();
  config.compositionV6SoulOwnerProofType = '';
  config.compositionV6ReleaseEnabled = false;

  const result = validateRuntimeConfig(config, { strict: true });
  assert.equal(result.compositionV6SoulOwnerProofTypeOriginPackageReady, true);
  assert.equal(result.compositionV6SoulOwnerProofReady, false);
  assert.doesNotMatch(result.errors.join(' '), /AnimacraftSoulOwnerProofV6/);
});

test('Composable Assets v6 rejects a malformed independent owner-proof TypeOrigin', () => {
  const config = productionV6Config();
  config.compositionV6SoulOwnerProofTypeOriginPackageId = 'not-a-package';
  const result = validateRuntimeConfig(config, { strict: true });
  assert.equal(result.valid, false);
  assert.equal(result.compositionV6SoulOwnerProofTypeOriginPackageReady, false);
  assert.match(
    result.errors.join(' '),
    /compositionV6SoulOwnerProofTypeOriginPackageId/,
  );
});

test('Seal v5 fails closed on partial credentials and invalid outer thresholds', () => {
  const config = productionConfig();
  Object.assign(config, {
    sealV5CallablePackageId: '0x1234',
    sealV5TypeOriginPackageId: '0x1234',
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
