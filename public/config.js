window.ANIMACRAFT_CONFIG = {
  network: 'mainnet',
  grpcUrl: 'https://fullnode.mainnet.sui.io:443',
  graphqlUrl: 'https://graphql.mainnet.sui.io/graphql',
  packageId: '0x2221610b5513ef3f926433229b7f0b565e850d56020e344266737cdca078af3b',
  callablePackageId: '0x2221610b5513ef3f926433229b7f0b565e850d56020e344266737cdca078af3b',
  originalPackageId: '0x9678afa6b008ddd0637b7723e30beac1c2a1d096b39c76b103f1a1841dc1ffea',
  paymentCoinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
  paymentCoinSymbol: 'USDC',
  paymentCoinDecimals: 6,
  walrusAggregatorUrl: 'https://aggregator.walrus-mainnet.walrus.space',
  walrusUploadRelayUrl: 'https://upload-relay.mainnet.walrus.space',
  // Client-side ceiling. The relay charges its exact live quote, not this cap.
  walrusRelayMaxTipMist: 100000000,
  walrusEpochs: 53,
  featuredMakers: {},
  appUrl: 'https://animacraft.soulidity.ai',
  soulidityAppUrl: 'https://www.soulidity.ai',
  soulidityIntegrationPath: '/integrations/animacraft',
  soulidityPackageId: '0x60bf39455f90e2af94381f2434d2c013c4e38a12fd16873ac296a26660f92ecd',
  soulidityCallablePackageId: '0x60bf39455f90e2af94381f2434d2c013c4e38a12fd16873ac296a26660f92ecd',
  souliditySealNamespacePackageId: '0xa43cc9a94caa904a97316d97c08804369ee8fbe3335d2ddae154022d7d6e5d5d',
  soulidityTypeOriginPackageId: '0xa43cc9a94caa904a97316d97c08804369ee8fbe3335d2ddae154022d7d6e5d5d',
  protocolFeePackageId: '0xc1bbfe03cc93e27903e1ffd1a712745384cd537d6edadfb0e759bf6e090e53cc',
  protocolFeeConfigId: '0x60d141c7b9c5726a85a3b53dd08879d86af313cf3fe96d5e6440a8d5cb60ee32',
  protocolTreasuryId: '0xf859174faa620adcdae10d2554eb356cb8a499dcbe47f15327a1347fe752af54',
  protocolFeeAdminCapId: '0x28a99dfbfc37b474b4bdb3330eeb1a2ef3bb1139e0268112d91bd11a4e3fdcbd',
  protocolFeeAdminCapOwner: '0xadea1910ac0e738dc020247bc5408b57b15f3701026a96098b716a35c3a6c52f',
  primaryProtocolFeeBps: 5000,
  canonicalSoulMintEnabled: false,
  // The reviewed v5 core is initialized on Mainnet with its release gate off.
  // Bind-once Walrus/Soul fields remain empty until Soulidity activation.
  commerceV5TypeOriginPackageId: '0xcf369b8b02ac1e997146fc3be3f03870db14eaccf3d2cb7a9b93724be463108e',
  commerceProtocolConfigV5Id: '0xf63dc43bb3787fff47fec7f8c3ff2e777dd0966500570fa7deab2bef9b6da0d5',
  commerceProtocolTreasuryV5Id: '0x97ba8042011d6c2d4857a33789a8250c16f6effeda622cb312fe481e0b907d44',
  commerceV5LogicalAuxiliaryBlobId: '',
  commerceV5SoulBindingProofType: '',
  commerceV5ReleaseEnabled: false,
  // The reviewed v6 composition core is initialized disabled. The Soul owner
  // proof remains deliberately unbound, so player release stays fail-closed.
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
  // Soulidity v6 is deployed and its owner-proof TypeOrigin is recorded. The
  // exact proof type stays empty until Animacraft's bind-once ceremony.
  compositionV6SoulOwnerProofTypeOriginPackageId: '0x60bf39455f90e2af94381f2434d2c013c4e38a12fd16873ac296a26660f92ecd',
  compositionV6SoulOwnerProofType: '',
  compositionV6ReleaseEnabled: false,
  // v7 remains fail-closed until the package upgrade, disabled protocol
  // initialization and Soulidity wardrobe adapter have all been verified.
  physicalV7TypeOriginPackageId: '',
  physicalProtocolConfigV7Id: '',
  physicalRegistryV7Id: '',
  physicalAdminCapV7Id: '',
  physicalAdminCapV7Owner: '',
  physicalV7SoulOwnerProofTypeOriginPackageId: '',
  physicalV7SoulOwnerProofType: '',
  physicalStyleV7ReleaseEnabled: false,
  // Intentionally empty while the reviewed Commerce/Seal release gate is off.
  // Mainnet activation requires the official committee endpoint plus an Enoki
  // X-API-Key; never claim paid assets are protected without it.
  sealV5CallablePackageId: '',
  sealV5TypeOriginPackageId: '',
  // Deprecated compatibility alias. New deployments set the two identities
  // above explicitly so later upgrades do not rewrite the stable TypeOrigin.
  sealV5PackageId: '',
  sealKeyServers: [],
  sealThreshold: 0,
  sealTimeoutMs: 10000,
  sealVerifyKeyServers: true
};
