/// External compile probe for the compressed Core catalog foundation.
/// Operational callers borrow the live catalog; setup caps are consumed once
/// and are never retained as a parallel production authority.
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

public fun compile_protocol_catalog_certification(
    config: &mut ProtocolConfigV8,
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
        CorePackageMarkerV8, CorePackageMarkerV8,
        SealMarkerV8, SealMarkerV8,
        RuntimeMarkerV8, RuntimeMarkerV8,
        OutputMarkerV8, OutputMarkerV8,
        PhysicalMarkerV8, PhysicalMarkerV8,
        MarketMarkerV8, MarketMarkerV8,
        ReleaseMarkerV8, ReleaseMarkerV8,
    >(
        config, protocol_admin, core, seal, runtime, output, physical, market,
        release, ctx,
    )
}

/// The six setup gates compile only in the fixed role order. Each value is
/// consumed immediately against the same live catalog. Generic witnesses here
/// only check the ABI; Core validates their exact installed type at runtime.
public fun compile_consume_setup_chain<
    SealInstall: drop, RuntimeInstall: drop, OutputInstall: drop,
    PhysicalInstall: drop, MarketInstall: drop, ReleaseInstall: drop,
>(
    config: &ProtocolConfigV8,
    protocol_admin: &ProtocolAdminCapV8,
    catalog: &mut ProductReleaseCatalogV8,
    seal_witness: SealInstall, runtime_witness: RuntimeInstall,
    output_witness: OutputInstall, physical_witness: PhysicalInstall,
    market_witness: MarketInstall, release_witness: ReleaseInstall,
    seal_id: ID, runtime_id: ID, output_id: ID, physical_id: ID, market_id: ID,
    release_id: ID,
    seal_policy: vector<u8>, key_servers: vector<u8>, encryption: vector<u8>,
) {
    let seal = binding::take_seal_call_cap_v8(config, protocol_admin, catalog);
    let _seal_installation = binding::consume_seal_call_cap_v8(
        catalog, seal, seal_witness, seal_id, seal_policy, key_servers, encryption);
    let runtime = binding::take_runtime_call_cap_v8(config, protocol_admin, catalog);
    let _runtime_installation = binding::consume_runtime_call_cap_v8(
        catalog, runtime, runtime_witness, runtime_id);
    let output = binding::take_output_call_cap_v8(config, protocol_admin, catalog);
    let _output_installation = binding::consume_output_call_cap_v8(
        catalog, output, output_witness, output_id);
    let physical = binding::take_physical_call_cap_v8(config, protocol_admin, catalog);
    let _physical_installation = binding::consume_physical_call_cap_v8(
        catalog, physical, physical_witness, physical_id);
    let market = binding::take_market_call_cap_v8(config, protocol_admin, catalog);
    let _market_installation = binding::consume_market_call_cap_v8(
        catalog, market, market_witness, market_id);
    let release = binding::take_release_call_cap_v8(config, protocol_admin, catalog);
    let _release_installation = binding::consume_release_call_cap_v8(
        catalog, release, release_witness, release_id);
}

public fun compile_live_catalog_root_binding<PaymentCoin>(
    root: &mut MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    ctx: &TxContext,
) {
    maker::finalize_product_release_binding_v8(root, admin, config, catalog, ctx);
    maker::assert_product_release_catalog_v8(root, catalog);
    let _ = maker::root_product_release_catalog_id_v8(root);
    let _ = maker::root_product_release_binding_commitment_v8(root);
    let _ = maker::root_product_release_call_cap_set_commitment_v8(root);
    // The current catalog assertion validates the committed package tuple;
    // the retired per-Root capability mask has no independent public getter.
}

public fun compile_catalog_readback(catalog: &ProductReleaseCatalogV8) {
    let tuple = binding::catalog_binding_v8(catalog);
    let _id = binding::catalog_id_v8(catalog);
    let (_protocol_id, _protocol_revision, _protocol_commitment, _binding,
        _call_cap_set, _catalog_commitment) = binding::catalog_terms_v2(catalog);
    let _tuple_commitment = binding::product_binding_commitment_v8(tuple);
    let (_core_original, _core_callable, _core_source,
        _core_package, _core_abi, _core_commitment) =
        binding::exact_binding_terms_v2(binding::binding_at_v2(tuple, 0));
    let (_seal_original, _seal_callable, _seal_source,
        _seal_package, _seal_abi, _seal_commitment) =
        binding::exact_binding_terms_v2(binding::binding_at_v2(tuple, 1));
    let _seal_authority = binding::catalog_authority_id_v2(catalog, 0);
    let (_runtime_original, _runtime_callable, _runtime_source,
        _runtime_package, _runtime_abi, _runtime_commitment) =
        binding::exact_binding_terms_v2(binding::binding_at_v2(tuple, 2));
    let _runtime_authority = binding::catalog_authority_id_v2(catalog, 1);
    let (_output_original, _output_callable, _output_source,
        _output_package, _output_abi, _output_commitment) =
        binding::exact_binding_terms_v2(binding::binding_at_v2(tuple, 3));
    let _output_authority = binding::catalog_authority_id_v2(catalog, 2);
    let (_physical_original, _physical_callable, _physical_source,
        _physical_package, _physical_abi, _physical_commitment) =
        binding::exact_binding_terms_v2(binding::binding_at_v2(tuple, 4));
    let _physical_authority = binding::catalog_authority_id_v2(catalog, 3);
    let (_market_original, _market_callable, _market_source,
        _market_package, _market_abi, _market_commitment) =
        binding::exact_binding_terms_v2(binding::binding_at_v2(tuple, 5));
    let _market_authority = binding::catalog_authority_id_v2(catalog, 4);
    let (_release_original, _release_callable, _release_source,
        _release_package, _release_abi, _release_commitment) =
        binding::exact_binding_terms_v2(binding::binding_at_v2(tuple, 6));
    let _release_authority = binding::catalog_authority_id_v2(catalog, 5);
}

/// A real companion binds immutable runtime rows to exact sealed base rows
/// without package-private field access.
public fun compile_base_definition_readback(
    registry: &BaseDefinitionRegistryV8,
    track_key: String,
    part_key: String,
    item_key: String,
    style_key: String,
    channel_key: String,
    swatch_key: String,
) {
    let _ = base::registry_track_count_v2(registry);
    let _ = base::registry_part_count_v2(registry);
    let track = base::borrow_track_v2(registry, track_key);

    // Track order/key/payload remain readable through the canonical row bytes.
    let _track_bytes = std::bcs::to_bytes(track);

    let part = base::borrow_part_v2(registry, part_key);

    let (part_identity, _sequence, _required, _part_payload) =
        base::part_identity_terms_v2(part);
    let (_slot_mode, _capacity) = base::part_slot_terms_v2(part);
    let _part_bytes = std::bcs::to_bytes(part);
    let item = base::borrow_item_v2(registry, *part_identity, item_key);
    let _ = base::item_payload_commitment_v2(item);

    let _item_bytes = std::bcs::to_bytes(item);
    base::assert_public_item_v2(item);
    let style = base::borrow_style_v2(
        registry, *part_identity, item_key, style_key,
    );
    let _ = base::style_part_key_v2(style);
    let _ = base::style_item_key_v2(style);
    let _ = base::style_key_v2(style);
    let _ = base::style_layer_track_key_v2(style);
    let _ = base::style_color_channel_key_v2(style);
    let _ = base::style_default_swatch_key_v2(style);
    let _ = base::style_asset_blob_id_v2(style);
    let _ = base::style_asset_sha256_v2(style);
    let _ = base::style_protected_v2(style);
    let _ = base::style_payload_commitment_v2(style);

    let color = base::borrow_color_v2(registry, channel_key, swatch_key);
    // Current color rows expose canonical bytes, including key and color stops.
    let _color_bytes = std::bcs::to_bytes(color);
}

public fun compile_root_and_rights_readback<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
): &vector<u8> {
    let economics = maker::root_economics_v8(root);
    let rights = maker::root_rights_v2(root);
    let _economics_bytes = std::bcs::to_bytes(&economics);
    let _ = maker::economics_maker_access_v8(&economics);
    let _ = maker::economics_maker_price_atomic_v8(&economics);
    let _ = maker::economics_complete_mode_v2(&economics);
    let _ = maker::economics_complete_price_atomic_v2(&economics);
    let _ = maker::economics_primary_content_fee_bps_v8(&economics);
    // Origin/creator/evidence are committed in the current private rights row.
    let _rights_bytes = std::bcs::to_bytes(&rights);
    let _rights_commitment = maker::rights_commitment_v2(&rights);
    let _creator = maker::root_creator_v2(root);
    maker::root_renderer_commitment_v2(root)
}

public fun compile_maker_access_readback<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    pass: &MakerAccessPassV8,
    holder: address,
) {
    treasury::assert_maker_access_pass_v8(root, pass, holder);
    let _ = treasury::maker_access_pass_root_id_v2(pass);
    let _ = treasury::maker_access_pass_maker_version_v2(pass);
    let _ = treasury::maker_access_pass_root_content_commitment_v2(pass);
    let _ = treasury::maker_access_pass_holder_v2(pass);
    let _ = treasury::maker_access_pass_paid_atomic_v2(pass);
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
        root, maker_treasury, config, protocol_treasury, payment, clock, ctx,
    );
}
