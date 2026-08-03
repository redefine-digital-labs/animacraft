window.ANIMACRAFT_CONFIG = {
  network: 'mainnet',
  grpcUrl: 'https://fullnode.mainnet.sui.io:443',
  graphqlUrl: 'https://graphql.mainnet.sui.io/graphql',
  packageId: '0xTODO_ANIMACRAFT_PACKAGE',
  callablePackageId: '0xTODO_ANIMACRAFT_PACKAGE',
  originalPackageId: '0xTODO_ANIMACRAFT_PACKAGE',
  paymentCoinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
  paymentCoinSymbol: 'USDC',
  paymentCoinDecimals: 6,
  walrusAggregatorUrl: 'https://aggregator.walrus-mainnet.walrus.space',
  walrusUploadRelayUrl: 'https://upload-relay.mainnet.walrus.space',
  // Client-side ceiling. The relay charges its exact live quote, not this cap.
  walrusRelayMaxTipMist: 100000000,
  walrusEpochs: 53,
  featuredMakers: {
    'daily-starlit': '0xYOUR_PUBLISHED_OC_MAKER_OBJECT'
  },
  appUrl: 'https://animacraft.soulidity.ai',
  soulidityAppUrl: 'https://www.soulidity.ai',
  soulidityIntegrationPath: '/integrations/animacraft',
  // Legacy callable alias. Keep equal to soulidityCallablePackageId.
  soulidityPackageId: '0xCURRENT_SOULIDITY_CALLABLE_PACKAGE',
  soulidityCallablePackageId: '0xCURRENT_SOULIDITY_CALLABLE_PACKAGE',
  // Permanent original/v1 Seal namespace. Never advance this after upgrade.
  souliditySealNamespacePackageId: '0xORIGINAL_SOULIDITY_SEAL_NAMESPACE',
  soulidityTypeOriginPackageId: '0xSOULIDITY_ANIMACRAFT_PROVENANCE_TYPE_ORIGIN',
  protocolFeePackageId: '0xV4_PROTOCOL_FEE_TYPE_ORIGIN_PACKAGE',
  protocolFeeConfigId: '0xYOUR_V4_PROTOCOL_FEE_CONFIG',
  protocolTreasuryId: '0xYOUR_V4_PROTOCOL_TREASURY',
  protocolFeeAdminCapId: '0xYOUR_V4_PROTOCOL_FEE_ADMIN_CAP',
  protocolFeeAdminCapOwner: '0xEXPECTED_ADMIN_WALLET',
  primaryProtocolFeeBps: 5000,
  canonicalSoulMintEnabled: false,
  commerceV5TypeOriginPackageId: '0xV5_COMMERCE_TYPE_ORIGIN_PACKAGE',
  commerceProtocolConfigV5Id: '0xYOUR_DISABLED_V5_COMMERCE_PROTOCOL_CONFIG',
  commerceProtocolTreasuryV5Id: '0xYOUR_V5_COMMERCE_PROTOCOL_TREASURY',
  // Bind-once values may remain empty after disabled core initialization.
  // Fill both only after the exact Blob and Soulidity TypeOrigin are final.
  commerceV5LogicalAuxiliaryBlobId: '',
  commerceV5SoulBindingProofType: '',
  commerceV5ReleaseEnabled: false,
  compositionV6TypeOriginPackageId: '0xV6_COMPOSITION_TYPE_ORIGIN_PACKAGE',
  compositionProtocolConfigV6Id: '0xYOUR_DISABLED_V6_COMPOSITION_PROTOCOL_CONFIG',
  compositionProtocolTreasuryV6Id: '0xYOUR_V6_COMPOSITION_PROTOCOL_TREASURY',
  compositionRegistryV6Id: '0xYOUR_V6_COMPOSITION_REGISTRY',
  compositionAdminCapV6Id: '0xYOUR_V6_COMPOSITION_ADMIN_CAP',
  compositionAdminCapV6Owner: '0xEXPECTED_V6_COMPOSITION_ADMIN',
  compositionValidatorCapV6Id: '0xYOUR_V6_VALIDATOR_CAP',
  compositionValidatorCapV6Owner: '0xEXPECTED_V6_VALIDATOR',
  compositionValidatorEpochV6: 0,
  compositionValidatorPolicyCommitmentV6: '0xYOUR_EXACT_32_BYTE_VALIDATOR_POLICY_COMMITMENT',
  // Package that first defines Soulidity's AnimacraftSoulOwnerProofV6. This is
  // independent from the v5 soulidityTypeOriginPackageId above.
  compositionV6SoulOwnerProofTypeOriginPackageId: '0xV6_SOUL_OWNER_PROOF_TYPE_ORIGIN',
  // Empty is valid only while compositionV6ReleaseEnabled remains false.
  compositionV6SoulOwnerProofType: '',
  compositionV6ReleaseEnabled: false,
  // Authoring may be previewed while false. Never enable before the v7
  // wardrobe custody package and Soulidity adapter are deployed and audited.
  physicalV7TypeOriginPackageId: '0xV7_PHYSICAL_TYPE_ORIGIN_PACKAGE',
  physicalProtocolConfigV7Id: '0xYOUR_DISABLED_V7_PHYSICAL_PROTOCOL_CONFIG',
  physicalRegistryV7Id: '0xYOUR_V7_PHYSICAL_REGISTRY',
  physicalAdminCapV7Id: '0xYOUR_V7_PHYSICAL_ADMIN_CAP',
  physicalAdminCapV7Owner: '0xEXPECTED_V7_PHYSICAL_ADMIN',
  physicalV7SoulOwnerProofTypeOriginPackageId: '0xV7_SOUL_OWNER_PROOF_TYPE_ORIGIN',
  physicalV7SoulOwnerProofType: '',
  physicalStyleV7ReleaseEnabled: false,
  // Frozen v5 package used for every Seal approval call. Never advance this
  // to the latest Animacraft callable package after a later upgrade.
  sealV5CallablePackageId: '0xV5_SEAL_CALLABLE_PACKAGE',
  sealV5TypeOriginPackageId: '0xV5_COMMERCE_AND_SEAL_TYPE_ORIGIN',
  // Legacy alias only. Leave empty in new deployments.
  sealV5PackageId: '',
  // Official Mainnet committee. The SDK sees one outer server (1-of-1);
  // Mysten's committee internally performs 5-of-8 key-share recovery.
  sealKeyServers: [{
    objectId: '0x686098f1439237fff9f36b99c7329683c22979d2005c2465cb891acb012a7595',
    aggregatorUrl: 'https://seal-aggregator-mainnet.mystenlabs.com',
    weight: 1,
    apiKeyName: 'X-API-Key',
    apiKey: 'YOUR_ENOKI_API_KEY'
  }],
  sealThreshold: 1,
  sealTimeoutMs: 10000,
  sealVerifyKeyServers: true
};
