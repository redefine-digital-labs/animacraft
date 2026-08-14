/// This package is deliberately external to Core. A warnings-as-errors build
/// proves companion packages can compile against every frozen enforcement
/// surface without package-private access.
module animacraft_v8_core_companion_probe::probe;

use std::string::String;

use animacraft_v8_core::base_registry_v8::{
    Self as base,
    BaseDefinitionRegistryV8,
};
use animacraft_v8_core::maker_v8::{
    Self as maker,
    MakerAdminCapV8,
    MakerRootV8,
    RightsSnapshotV8,
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
    ProtocolTreasuryV8,
};
use animacraft_v8_core::treasury_v8::{
    Self as treasury,
    MakerAccessPassV8,
    MakerTreasuryV8,
};
use sui::clock::Clock;
use sui::coin::Coin;

public struct SealMarkerV8 has drop {}
public struct RuntimeMarkerV8 has drop {}
public struct OutputMarkerV8 has drop {}
public struct PhysicalMarkerV8 has drop {}
public struct MarketMarkerV8 has drop {}
public struct ReleaseMarkerV8 has drop {}

/// Companion-owned witnesses intentionally have no abilities. Their private
/// fields are consumed inside the exact companion orchestration functions.
public struct ReleaseReadinessWitnessV8 { ready: bool }
public struct RuntimePackReadinessWitnessV8 {
    root_id: ID,
    root_version: u64,
    root_content_commitment: vector<u8>,
    pack_registry_id: ID,
    admission_authority_id: ID,
    policy_commitment: vector<u8>,
}
public struct WrappedRightsEvidenceWitnessV8 {
    evidence_locator: String,
    evidence_blob_id: String,
    evidence_sha256: vector<u8>,
    terms_commitment: vector<u8>,
}

/// Persistent authorities are distinct from ephemeral no-ability witnesses.
/// Only the defining companion package can create or transfer these objects.
public struct ReleaseCertificationAuthorityV8 has key { id: UID }
public struct RuntimePackCertificationAuthorityV8 has key { id: UID }

/// A real companion must be able to bind its immutable runtime rows to the
/// exact sealed Base definitions without package-private field access.
public fun compile_base_definition_readback(
    registry: &BaseDefinitionRegistryV8,
    track_key: String,
    part_key: String,
    item_key: String,
    style_key: String,
    channel_key: String,
    swatch_key: String,
) {
    let _ = base::registry_track_count_v8(registry);
    let _ = base::registry_part_count_v8(registry);
    let track = base::borrow_track_v8(registry, track_key);
    let _ = base::track_key_v8(track);
    let _ = base::track_render_order_v8(track);
    let _ = base::track_payload_commitment_v8(track);

    let part = base::borrow_part_v8(registry, part_key);
    let _ = base::part_key_v8(part);
    let _ = base::part_sequence_v8(part);
    let _ = base::part_kind_v8(part);
    let _ = base::part_render_order_v8(part);
    let _ = base::part_required_v8(part);
    let _ = base::part_visible_v8(part);
    let _ = base::part_payload_commitment_v8(part);

    let item = base::borrow_item_v8(registry, *base::part_key_v8(part), item_key);
    let _ = base::item_part_key_v8(item);
    let _ = base::item_key_v8(item);
    let _ = base::item_gate_kind_v8(item);
    let _ = base::item_payload_commitment_v8(item);

    let style = base::borrow_style_v8(
        registry,
        *base::part_key_v8(part),
        *base::item_key_v8(item),
        style_key,
    );
    let _ = base::style_part_key_v8(style);
    let _ = base::style_item_key_v8(style);
    let _ = base::style_key_v8(style);
    let _ = base::style_layer_track_key_v8(style);
    let _ = base::style_color_channel_key_v8(style);
    let _ = base::style_default_swatch_key_v8(style);
    let _ = base::style_asset_blob_id_v8(style);
    let _ = base::style_asset_sha256_v8(style);
    let _ = base::style_protected_v8(style);
    let _ = base::style_payload_commitment_v8(style);

    let color = base::borrow_color_v8(registry, channel_key, swatch_key);
    let _ = base::color_channel_key_v8(color);
    let _ = base::color_swatch_key_v8(color);
    let _ = base::color_rgba_v8(color);
    let _ = base::color_payload_commitment_v8(color);
}

public fun compile_maker_access_readback<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    pass: &MakerAccessPassV8,
    holder: address,
) {
    treasury::assert_maker_access_pass_v8(root, pass, holder);
    let _ = treasury::maker_access_pass_root_id_v8(pass);
    let _ = treasury::maker_access_pass_maker_version_v8(pass);
    let _ = treasury::maker_access_pass_root_content_commitment_v8(pass);
    let _ = treasury::maker_access_pass_holder_v8(pass);
    let _ = treasury::maker_access_pass_paid_atomic_v8(pass);
}

public fun compile_maker_access_purchase<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    maker_treasury: &mut MakerTreasuryV8<PaymentCoin>,
    config: &ProtocolConfigV8,
    protocol_treasury: &mut ProtocolTreasuryV8<PaymentCoin>,
    payment: Coin<PaymentCoin>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    treasury::purchase_maker_access_v8(
        root,
        maker_treasury,
        config,
        protocol_treasury,
        payment,
        clock,
        ctx,
    );
}

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
        ReleaseCertificationAuthorityV8,
        RuntimePackReadinessWitnessV8,
        RuntimePackCertificationAuthorityV8,
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
    authority: &ReleaseCertificationAuthorityV8,
    ctx: &TxContext,
) {
    let ReleaseReadinessWitnessV8 { ready } = witness;
    assert!(ready, 0);
    let product = binding::catalog_binding_v8(catalog);
    let _ = binding::release_witness_type_v8(product);
    let _ = binding::release_authority_type_v8(product);
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
    let certified = binding::certify_release_catalog_witness_v8<
        ReleaseReadinessWitnessV8,
        ReleaseCertificationAuthorityV8,
    >(
        config,
        catalog,
        authority,
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
    authority: &RuntimePackCertificationAuthorityV8,
    ctx: &TxContext,
) {
    let RuntimePackReadinessWitnessV8 {
        root_id,
        root_version,
        root_content_commitment,
        pack_registry_id,
        admission_authority_id,
        policy_commitment,
    } = witness;
    let product = binding::catalog_binding_v8(catalog);
    let _ = binding::runtime_pack_readiness_witness_type_v8(product);
    let _ = binding::runtime_pack_authority_type_v8(product);
    let readiness = binding::certify_runtime_pack_readiness_v8<
        RuntimePackReadinessWitnessV8,
        RuntimePackCertificationAuthorityV8,
    >(
        catalog,
        authority,
        root_id,
        root_version,
        root_content_commitment,
        pack_registry_id,
        admission_authority_id,
        policy_commitment,
    );
    maker::finalize_pack_admission_binding_v8(root, admin, config, readiness, ctx);
}

public fun compile_wrapped_rights_certification(
    config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    authority: &ReleaseCertificationAuthorityV8,
    witness: WrappedRightsEvidenceWitnessV8,
    ctx: &TxContext,
): RightsSnapshotV8 {
    let WrappedRightsEvidenceWitnessV8 {
        evidence_locator,
        evidence_blob_id,
        evidence_sha256,
        terms_commitment,
    } = witness;
    let certification = maker::certify_wrapped_rights_v8(
        config,
        catalog,
        authority,
        evidence_locator,
        evidence_blob_id,
        evidence_sha256,
        terms_commitment,
        ctx,
    );
    maker::new_license_wrapped_rights_snapshot_v8(
        certification,
        250,
        250,
        500,
    )
}
