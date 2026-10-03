/// Isolated test-only package identities. These wrappers exercise production
/// type checks, setup-cap consumption and companion assembly, not Market E2E.
#[test_only]
module 0x15::market_v8 {
    use animacraft_v8_core::package_binding_v8::{Self as binding, ProductReleaseCatalogV8, PackageCallCapV8, MarketRoleV8};
    public struct MarketRegistryV8<phantom PaymentCoin> has key { id: UID }
    public struct MarketTreasuryV8<phantom PaymentCoin> has key { id: UID }
    public struct MarketSetupInstallWitnessV2 has drop {}
    public struct MakerCompanionBindingWitnessV2 has drop {}
    public fun new_for_testing<PaymentCoin>(ctx: &mut TxContext): (MarketRegistryV8<PaymentCoin>, MarketTreasuryV8<PaymentCoin>) {
        (MarketRegistryV8 { id: object::new(ctx) }, MarketTreasuryV8 { id: object::new(ctx) })
    }
    public fun share_for_testing<PaymentCoin>(registry: MarketRegistryV8<PaymentCoin>, treasury: MarketTreasuryV8<PaymentCoin>) {
        sui::transfer::share_object(registry);
        sui::transfer::share_object(treasury);
    }
    public fun setup_for_testing(catalog: &mut ProductReleaseCatalogV8, cap: PackageCallCapV8<MarketRoleV8>, config_id: ID) {
        binding::consume_market_call_cap_v8(catalog, cap, MarketSetupInstallWitnessV2 {}, config_id);
    }
    public fun companion_witness_for_testing(): MakerCompanionBindingWitnessV2 { MakerCompanionBindingWitnessV2 {} }
}

#[test_only]
module 0x11::seal_v8 {
    use animacraft_v8_core::package_binding_v8::{Self as binding, ProductReleaseCatalogV8, PackageCallCapV8, SealRoleV8};
    public struct SealSetupInstallWitnessV2 has drop {}
    public struct MakerCompanionBindingWitnessV2 has drop {}
    public fun setup_for_testing(catalog: &mut ProductReleaseCatalogV8, cap: PackageCallCapV8<SealRoleV8>, config_id: ID, hash: vector<u8>) {
        binding::consume_seal_call_cap_v8(catalog, cap, SealSetupInstallWitnessV2 {}, config_id, hash, hash, hash);
    }
    public fun companion_witness_for_testing(): MakerCompanionBindingWitnessV2 { MakerCompanionBindingWitnessV2 {} }
}

#[test_only]
module 0x12::runtime_v8 {
    use animacraft_v8_core::package_binding_v8::{Self as binding, ProductReleaseCatalogV8, PackageCallCapV8, RuntimeRoleV8};
    public struct RuntimeSetupInstallWitnessV2 has drop {}
    public struct MakerCompanionBindingWitnessV2 has drop {}
    public fun setup_for_testing(catalog: &mut ProductReleaseCatalogV8, cap: PackageCallCapV8<RuntimeRoleV8>, config_id: ID) {
        binding::consume_runtime_call_cap_v8(catalog, cap, RuntimeSetupInstallWitnessV2 {}, config_id);
    }
    public fun companion_witness_for_testing(): MakerCompanionBindingWitnessV2 { MakerCompanionBindingWitnessV2 {} }
}


#[test_only]
module 0x14::physical_v8 {
    use animacraft_v8_core::package_binding_v8::{Self as binding, ProductReleaseCatalogV8, PackageCallCapV8, PhysicalRoleV8};
    public struct PhysicalSetupInstallWitnessV2 has drop {}
    public struct MakerCompanionBindingWitnessV2 has drop {}
    public fun setup_for_testing(catalog: &mut ProductReleaseCatalogV8, cap: PackageCallCapV8<PhysicalRoleV8>, config_id: ID) {
        binding::consume_physical_call_cap_v8(catalog, cap, PhysicalSetupInstallWitnessV2 {}, config_id);
    }
    public fun companion_witness_for_testing(): MakerCompanionBindingWitnessV2 { MakerCompanionBindingWitnessV2 {} }
}

#[test_only]
module 0x16::release_v8 {
    use animacraft_v8_core::package_binding_v8::{Self as binding, ProductReleaseCatalogV8, PackageCallCapV8, ReleaseRoleV8};
    public struct ReleaseSetupInstallWitnessV2 has drop {}
    public struct MakerCompanionBindingWitnessV2 has drop {}
    public fun setup_for_testing(catalog: &mut ProductReleaseCatalogV8, cap: PackageCallCapV8<ReleaseRoleV8>, config_id: ID) {
        binding::consume_release_call_cap_v8(catalog, cap, ReleaseSetupInstallWitnessV2 {}, config_id);
    }
    public fun companion_witness_for_testing(): MakerCompanionBindingWitnessV2 { MakerCompanionBindingWitnessV2 {} }
}
