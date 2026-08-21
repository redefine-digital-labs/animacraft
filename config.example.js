(() => {
  const exactId = (byte) => `0x${byte.repeat(32)}`;

  // Copy to public/config.js, replace every value with live readback evidence,
  // keep the gate disabled through preflight, then enable in one reviewed edit.
  window.SoulidityMakerV8 = Object.freeze({
    schemaVersion: 'animacraft.maker-v8-runtime.v8',
    protocolVersion: 8,
    enabled: false,
    catalogId: exactId('80'),
    protocolConfigId: exactId('81'),
    protocolTreasuryId: exactId('82'),
    paymentCoinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
    clockObjectId: `0x${'0'.repeat(63)}6`,
    roles: Object.freeze({
      core: Object.freeze({ typeOriginPackageId: exactId('10'), callablePackageId: exactId('10') }),
      seal: Object.freeze({ typeOriginPackageId: exactId('11'), callablePackageId: exactId('11') }),
      runtime: Object.freeze({ typeOriginPackageId: exactId('12'), callablePackageId: exactId('12') }),
      output: Object.freeze({ typeOriginPackageId: exactId('13'), callablePackageId: exactId('13') }),
      physical: Object.freeze({ typeOriginPackageId: exactId('14'), callablePackageId: exactId('14') }),
      market: Object.freeze({ typeOriginPackageId: exactId('15'), callablePackageId: exactId('15') }),
      release: Object.freeze({ typeOriginPackageId: exactId('16'), callablePackageId: exactId('16') }),
    }),
    roleConfigIds: Object.freeze({
      seal: exactId('83'),
      runtime: exactId('84'),
      output: exactId('85'),
      physical: exactId('86'),
      market: exactId('87'),
      release: exactId('88'),
    }),
    makerBindings: Object.freeze([]),
  });

  window.SoulidityV8Execution = Object.freeze({
    schemaVersion: 'animacraft.web-execution.v8',
    network: 'mainnet',
    chainIdentifier: 'mainnet',
    allowWalletSignature: false,
    allowBroadcast: false,
  });
})();
