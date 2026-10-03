(() => {
  // Certified release 841ef068a4be52cd3b1dfc2ff2a04d65adb30f302ba141dd044dad889630c01b.
  // Runtime identity comes from the completed chain release, not a latest lookup.
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
  "catalogId": "0x633c79e2885145c118d6f5d0fc55e2d0dc42a7669b49b54720c59080b32d3a9e",
  "clockObjectId": "0x0000000000000000000000000000000000000000000000000000000000000006",
  "enabled": true,
  "makerBindings": [],
  "nativeSoulIntegration": {
    "expectedNativeBinding": {
      "mintWitnessDefiningType": "0xe870d11e9922fa2f047bd5c1710401b5421a97c4b2100090bb1c762636c2fc41::animacraft_v8_binding::MintBindingWitnessV8",
      "mintWitnessOriginalType": "0xe870d11e9922fa2f047bd5c1710401b5421a97c4b2100090bb1c762636c2fc41::animacraft_v8_binding::MintBindingWitnessV8",
      "ownerWitnessDefiningType": "0xe870d11e9922fa2f047bd5c1710401b5421a97c4b2100090bb1c762636c2fc41::animacraft_v8_binding::SoulOwnerWitnessV8",
      "ownerWitnessOriginalType": "0xe870d11e9922fa2f047bd5c1710401b5421a97c4b2100090bb1c762636c2fc41::animacraft_v8_binding::SoulOwnerWitnessV8",
      "soulDefiningType": "0xe870d11e9922fa2f047bd5c1710401b5421a97c4b2100090bb1c762636c2fc41::soul::Soul",
      "soulOriginalType": "0xe870d11e9922fa2f047bd5c1710401b5421a97c4b2100090bb1c762636c2fc41::soul::Soul"
    },
    "kindRegistryId": "0xd439d16b69f7ccf215cc0eaeccf0b15ab0516291e2a2b658ee8a30164dc0c757",
    "kioskPackageId": "0xdfb4f1d4e43e0c3ad834dcd369f0d39005c872e118c9dc1c5da9765bb93ee5f3",
    "kioskRegistryId": "0x8d1824f776f559364d28349a64e47a40281ccf47c3e7806f6827607621592d7e",
    "marketConfigV2Id": "0x5dee51db7db7ac34a20d97108296b00f0a06800c904d439bd72e6e62fe6ef117",
    "soulTransferPolicyId": "0x90ccf7778737306a3c27f13bd4d52f5e910d906ff25c9abd7f42f6846795f27a",
    "soulidityCallableDigest": "2anrfAx5byCFio61gQPToTd9cey389kQYzvoL4UwrEbx",
    "soulidityCallablePackageId": "0xe870d11e9922fa2f047bd5c1710401b5421a97c4b2100090bb1c762636c2fc41",
    "soulidityOriginalPackageId": "0xe870d11e9922fa2f047bd5c1710401b5421a97c4b2100090bb1c762636c2fc41",
    "walrusPackageId": "0xfa65cb2d62f4d39e60346fb7d501c12538ca2bbc646eaa37ece2aec5f897814e"
  },
  "paymentCoinType": "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC",
  "protocolConfigId": "0x07e44857d9e88108d25aefe2bc15421cf1086846be370f6afa8f79d481368aa7",
  "protocolTreasuryId": "0x2ee02c442e42f8f55515b02f194e8b645c94a4214bf2710eef9b14753cdc74fd",
  "protocolVersion": 8,
  "roleConfigIds": {
    "market": "0x948a6e52770e0424c6f15d30f0ee9964662babcbc886b5bda832238a968a3476",
    "output": "0x52a55f9f49911e0160ed809b42ace478ee35dfe58b7eb3bd71b62e4802c4b6c1",
    "physical": "0x4d097348bd030b1344c5a745659d07fed23d97be7235fa5243d7dcb279924bf9",
    "release": "0x60ada183eb73f3e97b809a1e87d7081e3e2f0bd5b36f98d1703347f6bb91e3b1",
    "runtime": "0x581c205bbc9659790432899ab0d63f4b7db4040d0b5a5b695933308dc1ad906a",
    "seal": "0x59baab9432aa5c6831683316316675c9f7f8ba3a53fa0811d100af79ca1249e1"
  },
  "roles": {
    "core": {
      "callablePackageId": "0xce6a5fa79a4583951a381484ba2b6c4f82746d6570183e3540a108d988d98902",
      "typeOriginPackageId": "0xce6a5fa79a4583951a381484ba2b6c4f82746d6570183e3540a108d988d98902"
    },
    "market": {
      "callablePackageId": "0x3f4148b6c75e2db1daebbbadeb37666ec32bb8b38ebc0f93a2cbde07f9acae7e",
      "typeOriginPackageId": "0x3f4148b6c75e2db1daebbbadeb37666ec32bb8b38ebc0f93a2cbde07f9acae7e"
    },
    "output": {
      "callablePackageId": "0xe3a54b021cba35c1221cc0fb5cf347ea8805da61f000fa5bfa5f5e4812fe5f0b",
      "typeOriginPackageId": "0xe3a54b021cba35c1221cc0fb5cf347ea8805da61f000fa5bfa5f5e4812fe5f0b"
    },
    "physical": {
      "callablePackageId": "0x0a07de1e7e9b2e4b089e78cd6eeefccc47c5a3257c88109520cfafadc7b171ed",
      "typeOriginPackageId": "0x0a07de1e7e9b2e4b089e78cd6eeefccc47c5a3257c88109520cfafadc7b171ed"
    },
    "release": {
      "callablePackageId": "0x9f6078e49e87d885c91bdba99e90ecf93c1d85682be34e390667832f143e85bb",
      "typeOriginPackageId": "0x9f6078e49e87d885c91bdba99e90ecf93c1d85682be34e390667832f143e85bb"
    },
    "runtime": {
      "callablePackageId": "0x9c88bca9969c4d7cadfb5ad491c0828acc2781efaff93b724e91104b15720b00",
      "typeOriginPackageId": "0x9c88bca9969c4d7cadfb5ad491c0828acc2781efaff93b724e91104b15720b00"
    },
    "seal": {
      "callablePackageId": "0x12504100e9b3315562d84b874034b805ad1be2fd7472ccf40506f489e45855f2",
      "typeOriginPackageId": "0x12504100e9b3315562d84b874034b805ad1be2fd7472ccf40506f489e45855f2"
    }
  },
  "schemaVersion": "animacraft.maker-v8-runtime.v8"
});

  // User-authorized current deployment. Wallet confirmation remains mandatory.
  window.SoulidityV8Execution = Object.freeze({
    schemaVersion: 'animacraft.web-execution.v8',
    network: 'mainnet',
    chainIdentifier: '35834a8a',
    allowWalletSignature: true,
    allowBroadcast: true,
  });

  // Protected-content acceptance still requires the production Seal API key.
  window.AnimacraftV8Protection = Object.freeze({
    schemaVersion: 'animacraft.protected-execution.v1',
    allowProtectedContent: false,
  });
})();
