window.ANIMACRAFT_CONFIG = {
  network: 'mainnet',
  grpcUrl: 'https://fullnode.mainnet.sui.io:443',
  graphqlUrl: 'https://graphql.mainnet.sui.io/graphql',
  packageId: '0xc1bbfe03cc93e27903e1ffd1a712745384cd537d6edadfb0e759bf6e090e53cc',
  callablePackageId: '0xc1bbfe03cc93e27903e1ffd1a712745384cd537d6edadfb0e759bf6e090e53cc',
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
  soulidityPackageId: '0x6680f74155dd9f1c2ae0109556e459b1259f80b7597679292a70572887cfb1c0',
  soulidityCallablePackageId: '0x6680f74155dd9f1c2ae0109556e459b1259f80b7597679292a70572887cfb1c0',
  souliditySealNamespacePackageId: '0x6680f74155dd9f1c2ae0109556e459b1259f80b7597679292a70572887cfb1c0',
  soulidityTypeOriginPackageId: '0x6680f74155dd9f1c2ae0109556e459b1259f80b7597679292a70572887cfb1c0',
  protocolFeePackageId: '0xc1bbfe03cc93e27903e1ffd1a712745384cd537d6edadfb0e759bf6e090e53cc',
  protocolFeeConfigId: '0x60d141c7b9c5726a85a3b53dd08879d86af313cf3fe96d5e6440a8d5cb60ee32',
  protocolTreasuryId: '0xf859174faa620adcdae10d2554eb356cb8a499dcbe47f15327a1347fe752af54',
  protocolFeeAdminCapId: '0x28a99dfbfc37b474b4bdb3330eeb1a2ef3bb1139e0268112d91bd11a4e3fdcbd',
  protocolFeeAdminCapOwner: '0xadea1910ac0e738dc020247bc5408b57b15f3701026a96098b716a35c3a6c52f',
  primaryProtocolFeeBps: 5000,
  canonicalSoulMintEnabled: false,
  // Populated only after the reviewed v5 upgrade and disabled-object
  // initialization have been confirmed on Mainnet.
  commerceV5TypeOriginPackageId: '',
  commerceProtocolConfigV5Id: '',
  commerceProtocolTreasuryV5Id: '',
  commerceV5LogicalAuxiliaryBlobId: '',
  commerceV5SoulBindingProofType: '',
  commerceV5ReleaseEnabled: false,
  // v6 stays fail-closed until both package upgrades and disabled protocol
  // objects have been deployed, bound, read back, and audited on Mainnet.
  compositionV6TypeOriginPackageId: '',
  compositionProtocolConfigV6Id: '',
  compositionProtocolTreasuryV6Id: '',
  compositionRegistryV6Id: '',
  compositionAdminCapV6Id: '',
  compositionAdminCapV6Owner: '',
  compositionValidatorCapV6Id: '',
  compositionValidatorCapV6Owner: '',
  compositionValidatorEpochV6: '',
  compositionValidatorPolicyCommitmentV6: '',
  compositionV6SoulOwnerProofType: '',
  compositionV6ReleaseEnabled: false,
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
