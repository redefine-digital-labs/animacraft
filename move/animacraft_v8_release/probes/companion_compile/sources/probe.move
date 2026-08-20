module release_companion_compile::probe;

use animacraft_v8_core::activation_v8::{
    MarketReadinessV8,
    OutputReadinessV8,
    PhysicalReadinessV8,
    RuntimeActivationReadinessV8,
    SealReadinessV8,
};
use animacraft_v8_core::base_registry_v8::BaseDefinitionRegistryV8;
use animacraft_v8_core::maker_v8::{MakerAdminCapV8, MakerRootV8};
use animacraft_v8_core::package_binding_v8::{
    PackageCallCapV8,
    ProductReleaseCatalogV8,
    ReleaseRoleV8,
};
use animacraft_v8_core::protocol_config_v8::{ProtocolConfigV8, ProtocolTreasuryV8};
use animacraft_v8_core::treasury_v8::MakerTreasuryV8;
use animacraft_v8_output::output_v8::{
    CompleteSessionV8,
    OutputRegistryV8,
    SoulMintAuthorizationV8,
};
use animacraft_v8_release::release_v8::{Self as release, ReleasePackageConfigV8};
use animacraft_v8_runtime::runtime_v8::MakerLoadoutV8;
use std::string::String;

public fun new_config(
    catalog: &ProductReleaseCatalogV8,
    cap: PackageCallCapV8<ReleaseRoleV8>,
    ctx: &mut TxContext,
): ReleasePackageConfigV8 {
    release::new_release_package_config_v8(catalog, cap, ctx)
}

public fun activate<PaymentCoin>(
    root: &mut MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    base_registry: &BaseDefinitionRegistryV8,
    maker_treasury: &MakerTreasuryV8<PaymentCoin>,
    protocol_treasury: &ProtocolTreasuryV8<PaymentCoin>,
    release_config: &ReleasePackageConfigV8,
    seal: SealReadinessV8,
    runtime: RuntimeActivationReadinessV8,
    output: OutputReadinessV8,
    physical: PhysicalReadinessV8,
    market: MarketReadinessV8,
    ctx: &TxContext,
) {
    release::seal_and_activate_maker_v8(
        root,
        admin,
        protocol_config,
        catalog,
        base_registry,
        maker_treasury,
        protocol_treasury,
        release_config,
        seal,
        runtime,
        output,
        physical,
        market,
        ctx,
    )
}

public fun lifecycle<PaymentCoin>(
    root: &mut MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    release_config: &ReleasePackageConfigV8,
    ctx: &TxContext,
) {
    release::pause_maker_v8(root, admin, catalog, release_config, ctx);
    release::resume_maker_v8(
        root,
        admin,
        protocol_config,
        catalog,
        release_config,
        ctx,
    );
    release::archive_maker_v8(root, admin, catalog, release_config, ctx);
}

public fun render_unprotected<PaymentCoin>(
    session: CompleteSessionV8,
    output_registry: &OutputRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
    release_config: &ReleasePackageConfigV8,
    loadout: &MakerLoadoutV8,
    render_blob_id: String,
    render_sha256: vector<u8>,
    render_blob_commitment: vector<u8>,
    ctx: &mut TxContext,
): SoulMintAuthorizationV8 {
    release::finish_unprotected_complete_v8(
        session,
        output_registry,
        root,
        catalog,
        release_config,
        loadout,
        render_blob_id,
        render_sha256,
        render_blob_commitment,
        ctx,
    )
}

public fun read_config(config: &ReleasePackageConfigV8) {
    let _id = release::config_id_v8(config);
    let _catalog = release::config_catalog_id_v8(config);
    let _product = release::config_product_binding_commitment_v8(config);
    let _caps = release::config_call_cap_set_commitment_v8(config);
    let _version = release::version_v8();
}
