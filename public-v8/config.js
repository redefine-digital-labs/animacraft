(() => {
  // Certified target release 8dd402857b952c8a3e71ccb8ea56a032316109d92165265608c269625b2b60a7.
  // Runtime identity comes from completed chain readback, not a latest lookup.
  const freeze = (value) => {
    if (value && typeof value === 'object') {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
    return value;
  };

  window.ANIMACRAFT_CONFIG = Object.freeze({
    soulidityAppUrl: 'https://www.soulidity.ai',
  });

  window.SoulidityMakerV8 = freeze({
  "catalogId": "0x230dcd68e5215a995b7b7014540773739778eb6eba74bc43943b2af8ebc00609",
  "clockObjectId": "0x0000000000000000000000000000000000000000000000000000000000000006",
  "enabled": true,
  "makerBindings": [],
  "nativeSoulIntegration": {
    "expectedNativeBinding": {
      "mintWitnessDefiningType": "0x5e3e75de3e1f661ffcad9bd0d53f3ea97e2e48f0765d2b2d9532256806409bb9::animacraft_v8_binding::MintBindingWitnessV8",
      "mintWitnessOriginalType": "0x5e3e75de3e1f661ffcad9bd0d53f3ea97e2e48f0765d2b2d9532256806409bb9::animacraft_v8_binding::MintBindingWitnessV8",
      "ownerWitnessDefiningType": "0x5e3e75de3e1f661ffcad9bd0d53f3ea97e2e48f0765d2b2d9532256806409bb9::animacraft_v8_binding::SoulOwnerWitnessV8",
      "ownerWitnessOriginalType": "0x5e3e75de3e1f661ffcad9bd0d53f3ea97e2e48f0765d2b2d9532256806409bb9::animacraft_v8_binding::SoulOwnerWitnessV8",
      "soulDefiningType": "0x5e3e75de3e1f661ffcad9bd0d53f3ea97e2e48f0765d2b2d9532256806409bb9::soul::Soul",
      "soulOriginalType": "0x5e3e75de3e1f661ffcad9bd0d53f3ea97e2e48f0765d2b2d9532256806409bb9::soul::Soul"
    },
    "kindRegistryId": "0x1e28e87799374b8a24a6c5a9cffbb2a104fe76b5185f9aba224cf45d6059d9ad",
    "kioskPackageId": "0xdfb4f1d4e43e0c3ad834dcd369f0d39005c872e118c9dc1c5da9765bb93ee5f3",
    "kioskRegistryId": "0xebf7ec52fd0201a0b3dac3e6ef6b05a2d11493e1a67170c7262b02aa71a34952",
    "marketConfigV2Id": "0x2171d5268a6af1ca7efbc53eaa5bc4a80ab94733f0fadd8da4486bc9bec50f3c",
    "soulTransferPolicyId": "0x9966a75237e341ce6914c261e72a07ba811809f9583c56c0c9152483e0aa747a",
    "soulidityCallableDigest": "mk1CWsGozyihrJAraCQR8UU4QytchQH756TGePRZZWh",
    "soulidityCallablePackageId": "0x5e3e75de3e1f661ffcad9bd0d53f3ea97e2e48f0765d2b2d9532256806409bb9",
    "soulidityOriginalPackageId": "0x5e3e75de3e1f661ffcad9bd0d53f3ea97e2e48f0765d2b2d9532256806409bb9",
    "walrusPackageId": "0xfa65cb2d62f4d39e60346fb7d501c12538ca2bbc646eaa37ece2aec5f897814e"
  },
  "paymentCoinType": "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC",
  "protocolConfigId": "0x315cfb721a93e70a8f78732d6ebcae90ea3ba1fce829194a55cfbb46f3f465f2",
  "protocolTreasuryId": "0x6cc5fb46e1e8f0220679e746c8a59fec3e2c3d27a04c3a8e0f57e6d939d3780f",
  "protocolVersion": 8,
  "roleConfigIds": {
    "market": "0xf843e785a29510f6c7178a8dd29d3ed93176fbe20c090b826470ec5b828fab6f",
    "output": "0xd29bc74fc6f3bd9e80cfcfed5c9b6b45fdd1d05340f6c5546d18313dff564940",
    "physical": "0x21ae176d18cd81691462638885ebf818a61526287adfaa718fb54f578cc2f9c4",
    "release": "0xf009a5ffb468bc6b708e51f398c9fe3ce9e3d2c1b328031c7eba313865a835d5",
    "runtime": "0x0b76268cfd72ff32f4cc54454678328a0e9d5b6d1a8d99717d22ff0c497d656c",
    "seal": "0xb63a9a5d412d6749253731d1ec26d7cfb78142b09c1ffb8b76313fbfb16e97c2"
  },
  "roles": {
    "core": {
      "callablePackageId": "0xe1e6857ccabcfb36c2e4cd1cf2a6d8babad7fb457106e4b4108f310528645b5f",
      "typeOriginPackageId": "0xe1e6857ccabcfb36c2e4cd1cf2a6d8babad7fb457106e4b4108f310528645b5f"
    },
    "market": {
      "callablePackageId": "0x955041f6ba843a8f211b6d95497811e66cc41829335b28d2377c6a2d88cbbfdd",
      "typeOriginPackageId": "0x955041f6ba843a8f211b6d95497811e66cc41829335b28d2377c6a2d88cbbfdd"
    },
    "output": {
      "callablePackageId": "0x4a10df716f3c2c451e1a8130c40dce8231778d230e4513eecd2f3a1feb5b80d7",
      "typeOriginPackageId": "0x4a10df716f3c2c451e1a8130c40dce8231778d230e4513eecd2f3a1feb5b80d7"
    },
    "physical": {
      "callablePackageId": "0x7b6eadf98f43031c7e90b9096085334f785d50163d2c8c9f93e2f23877fe55bc",
      "typeOriginPackageId": "0x7b6eadf98f43031c7e90b9096085334f785d50163d2c8c9f93e2f23877fe55bc"
    },
    "release": {
      "callablePackageId": "0x9a20a0aad304d6e3e87830aa27ed3601cb8e48189a618f441aa5a1c5602bdc9d",
      "typeOriginPackageId": "0x9a20a0aad304d6e3e87830aa27ed3601cb8e48189a618f441aa5a1c5602bdc9d"
    },
    "runtime": {
      "callablePackageId": "0x3c2dede0657ddbfba3a7dc39db5782530e4ea9dab666ec4f7bbeb99c09a83710",
      "typeOriginPackageId": "0x3c2dede0657ddbfba3a7dc39db5782530e4ea9dab666ec4f7bbeb99c09a83710"
    },
    "seal": {
      "callablePackageId": "0xc744d735be1fd46d200ea946b3308728f3ccb238f0cb9c4c46d1a1f4b75a4a1f",
      "typeOriginPackageId": "0xc744d735be1fd46d200ea946b3308728f3ccb238f0cb9c4c46d1a1f4b75a4a1f"
    }
  },
  "schemaVersion": "animacraft.maker-v8-runtime.v8"
});

  // User-authorized release rollout; each user still confirms in their wallet.
  window.SoulidityV8Execution = Object.freeze({
    schemaVersion: 'animacraft.web-execution.v8',
    network: 'mainnet',
    chainIdentifier: '35834a8a',
    allowWalletSignature: true,
    allowBroadcast: true,
  });

  // Public two-of-two Seal path. Real authorized decryption is a separate test,
  // not a readiness claim made by this product-operation switch.
  window.AnimacraftV8Protection = Object.freeze({
    schemaVersion: 'animacraft.protected-execution.v1',
    allowProtectedContent: true,
  });
})();
