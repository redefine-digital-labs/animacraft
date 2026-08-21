(() => {
  const placeholderId = (byte) => `0x${byte.repeat(32)}`;

  // Safe deployment lock. Replace every placeholder with read-back chain
  // evidence before changing enabled, signature, or broadcast policy.
  window.SoulidityMakerV8 = Object.freeze({
    schemaVersion: 'animacraft.maker-v8-runtime.v8',
    protocolVersion: 8,
    enabled: false,
    catalogId: placeholderId('80'),
    protocolConfigId: placeholderId('81'),
    protocolTreasuryId: placeholderId('82'),
    paymentCoinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
    clockObjectId: `0x${'0'.repeat(63)}6`,
    roles: Object.freeze({
      core: Object.freeze({ typeOriginPackageId: placeholderId('10'), callablePackageId: placeholderId('10') }),
      seal: Object.freeze({ typeOriginPackageId: placeholderId('11'), callablePackageId: placeholderId('11') }),
      runtime: Object.freeze({ typeOriginPackageId: placeholderId('12'), callablePackageId: placeholderId('12') }),
      output: Object.freeze({ typeOriginPackageId: placeholderId('13'), callablePackageId: placeholderId('13') }),
      physical: Object.freeze({ typeOriginPackageId: placeholderId('14'), callablePackageId: placeholderId('14') }),
      market: Object.freeze({ typeOriginPackageId: placeholderId('15'), callablePackageId: placeholderId('15') }),
      release: Object.freeze({ typeOriginPackageId: placeholderId('16'), callablePackageId: placeholderId('16') }),
    }),
    roleConfigIds: Object.freeze({
      seal: placeholderId('83'),
      runtime: placeholderId('84'),
      output: placeholderId('85'),
      physical: placeholderId('86'),
      market: placeholderId('87'),
      release: placeholderId('88'),
    }),
    makerBindings: Object.freeze([]),
  });

  window.SoulidityV8Execution = Object.freeze({
    schemaVersion: 'animacraft.web-execution.v8',
    network: 'mainnet',
    chainIdentifier: '35834a8a',
    allowWalletSignature: false,
    allowBroadcast: false,
  });
})();
