/// This package is deliberately external to Core. A warnings-as-errors build
/// proves companion packages can compile against every frozen enforcement
/// surface without package-private access.
module animacraft_v8_core_companion_probe::probe;

use animacraft_v8_core::maker_v8::{
    Self as maker,
    MakerAdminCapV8,
    MakerRootV8,
};
use animacraft_v8_core::package_binding_v8::{
    Self as binding,
    PackageCommitmentsV8,
    ProductReleaseCatalogV8,
};
use animacraft_v8_core::protocol_config_v8::{
    CorePackageMarkerV8,
    ProtocolAdminCapV8,
    ProtocolConfigV8,
};

public struct SealMarkerV8 has drop {}
public struct RuntimeMarkerV8 has drop {}
public struct OutputMarkerV8 has drop {}
public struct PhysicalMarkerV8 has drop {}
public struct MarketMarkerV8 has drop {}
public struct ReleaseMarkerV8 has drop {}

/// Companion-owned witnesses intentionally have neither copy nor store.
public struct ReleaseReadinessWitnessV8 has drop {}
public struct RuntimePackReadinessWitnessV8 has drop {}

public fun compile_protocol_catalog_certification(
    config: &ProtocolConfigV8,
    protocol_admin: &ProtocolAdminCapV8,
    core: PackageCommitmentsV8,
    seal: PackageCommitmentsV8,
    runtime: PackageCommitmentsV8,
    output: PackageCommitmentsV8,
    physical: PackageCommitmentsV8,
    market: PackageCommitmentsV8,
    release: PackageCommitmentsV8,
    ctx: &mut TxContext,
): ProductReleaseCatalogV8 {
    binding::certify_product_release_catalog_v8<
        CorePackageMarkerV8,
        CorePackageMarkerV8,
        SealMarkerV8,
        SealMarkerV8,
        RuntimeMarkerV8,
        RuntimeMarkerV8,
        OutputMarkerV8,
        OutputMarkerV8,
        PhysicalMarkerV8,
        PhysicalMarkerV8,
        MarketMarkerV8,
        MarketMarkerV8,
        ReleaseMarkerV8,
        ReleaseMarkerV8,
        ReleaseReadinessWitnessV8,
        RuntimePackReadinessWitnessV8,
    >(
        config,
        protocol_admin,
        core,
        seal,
        runtime,
        output,
        physical,
        market,
        release,
        ctx,
    )
}

public fun compile_release_enforcement<PaymentCoin>(
    root: &mut MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    witness: ReleaseReadinessWitnessV8,
    ctx: &TxContext,
) {
    maker::assert_creator_v8(root, maker::root_creator_v8(root));
    maker::assert_current_protocol_config_v8(root, config);
    let economics = maker::root_economics_v8(root);
    let rights = maker::root_rights_v8(root);
    let _ = maker::economics_payment_coin_type_v8(&economics);
    let _ = maker::economics_maker_access_v8(&economics);
    let _ = maker::economics_maker_price_atomic_v8(&economics);
    let _ = maker::economics_complete_mode_v8(&economics);
    let _ = maker::economics_complete_price_atomic_v8(&economics);
    let _ = maker::economics_complete_free_quota_per_wallet_v8(&economics);
    let _ = maker::economics_complete_total_cap_v8(&economics);
    let _ = maker::economics_primary_content_fee_bps_v8(&economics);
    let _ = maker::economics_fixed_complete_fee_atomic_v8(&economics);
    let _ = maker::economics_maker_market_fee_bps_v8(&economics);
    let _ = maker::economics_soul_market_fee_bps_v8(&economics);
    let _ = maker::rights_origin_v8(&rights);
    let _ = maker::rights_creator_confirmed_v8(&rights);
    let _ = maker::rights_evidence_certified_v8(&rights);
    let _ = maker::rights_evidence_locator_v8(&rights);
    let _ = maker::rights_evidence_blob_id_v8(&rights);
    let _ = maker::rights_evidence_sha256_v8(&rights);
    let _ = maker::rights_terms_commitment_v8(&rights);
    let _ = maker::rights_soul_creator_royalty_bps_v8(&rights);
    let _ = maker::rights_maker_source_royalty_bps_v8(&rights);
    let _ = maker::rights_maker_resale_royalty_bps_v8(&rights);
    let certified = binding::certify_release_catalog_witness_v8(
        config,
        catalog,
        witness,
    );
    maker::finalize_product_release_binding_v8(root, admin, config, certified, ctx);
    let _ = maker::root_product_release_catalog_id_v8(root);
    assert!(maker::root_native_capability_mask_v8(root) == 127, 0);
}

public fun compile_runtime_pack_readiness<PaymentCoin>(
    root: &mut MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    witness: RuntimePackReadinessWitnessV8,
    pack_registry_id: ID,
    admission_authority_id: ID,
    ctx: &TxContext,
) {
    let readiness = binding::certify_runtime_pack_readiness_v8(
        catalog,
        witness,
        maker::root_id_v8(root),
        maker::root_maker_version_v8(root),
        *maker::root_content_commitment_v8(root),
        pack_registry_id,
        admission_authority_id,
        *maker::root_expected_pack_admission_policy_commitment_v8(root),
    );
    maker::finalize_pack_admission_binding_v8(root, admin, config, readiness, ctx);
}
