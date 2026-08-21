module output_companion_compile::probe;

use animacraft_v8_core::maker_v8::{MakerAdminCapV8, MakerRootV8};
use animacraft_v8_core::activation_v8::OutputReadinessV8;
use animacraft_v8_core::package_binding_v8::{PackageCallCapV8,
    MarketRoleV8, OutputRoleV8, PhysicalRoleV8, ProductReleaseCatalogV8};
use animacraft_v8_core::protocol_config_v8::ProtocolConfigV8;
use animacraft_v8_runtime::runtime_v8::{MakerLoadoutV8,
    RuntimePhysicalSelectionWitnessV8};
use animacraft_v8_output::output_v8::{Self as output,
    CanonicalSoulV8, CompleteOutputV8, CompleteReceiptV8, OutputPackageConfigV8,
    OutputPolicyRowV8, OutputRegistryV8,
    PhysicalCompleteBindingV8, PhysicalMaterializationWitnessV8,
    PhysicalSelectionBindingV8, SoulMarketCustodyBindingV8,
    SoulMarketCustodyTicketV8, SoulRegistryV8};
use sui::transfer::Receiving;

public struct PhysicalOriginalMarker has drop {}
public struct PhysicalCallableMarker has drop {}
public struct MarketOriginalMarker has drop {}
public struct MarketCallableMarker has drop {}
public struct MarketRegistry has key { id: UID }
public struct MarketTreasury has key { id: UID }
public struct MarketListing has key { id: UID }

public fun market_registry_id(registry: &MarketRegistry): ID {
    registry.id.to_inner()
}

public fun market_treasury_id(treasury: &MarketTreasury): ID {
    treasury.id.to_inner()
}

public fun new_output_config(
    catalog: &ProductReleaseCatalogV8,
    cap: PackageCallCapV8<OutputRoleV8>,
    ctx: &mut TxContext,
): OutputPackageConfigV8 {
    output::new_output_package_config_v8(catalog, cap, ctx)
}

public fun new_registries<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    expected_count: u64,
    expected_commitment: vector<u8>,
    ctx: &mut TxContext,
): (OutputRegistryV8, SoulRegistryV8) {
    output::new_output_registries_v8(
        root, admin, expected_count, expected_commitment, ctx)
}

public fun append_policy<PaymentCoin>(
    registry: &mut OutputRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    sequence: u64,
    output_key: std::string::String,
    protected: bool,
    scope_key: std::string::String,
    renderer_schema_commitment: vector<u8>,
    pack_policy: u8,
    allowlist: vector<std::string::String>,
    row_commitment: vector<u8>,
) {
    output::append_output_policy_v8(
        registry, root, admin, sequence, output_key, protected, scope_key,
        renderer_schema_commitment, pack_policy, allowlist, row_commitment)
}

public fun seal_policy<PaymentCoin>(
    registry: &mut OutputRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
) {
    output::seal_output_registry_v8(registry, root, admin)
}

public fun inspect_policy(
    registry: &OutputRegistryV8,
    output_key: std::string::String,
): &OutputPolicyRowV8 {
    output::output_policy_row_v8(registry, output_key)
}

public fun certify_readiness<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
    config: &OutputPackageConfigV8,
    registry: &OutputRegistryV8,
    souls: &SoulRegistryV8,
): OutputReadinessV8 {
    output::certify_output_activation_readiness_v8(
        root, catalog, config, registry, souls)
}

public fun inspect_receipt(receipt: &CompleteReceiptV8) {
    let _holder = output::receipt_holder_v8(receipt);
    let _key = output::receipt_output_key_v8(receipt);
    let _policy = output::receipt_output_policy_commitment_v8(receipt);
    let _loadout = output::receipt_loadout_id_v8(receipt);
    let _revision = output::receipt_loadout_revision_v8(receipt);
    let _commitment = output::receipt_loadout_commitment_v8(receipt);
}

public fun inspect_market_custody(binding: &SoulMarketCustodyBindingV8) {
    let _listing = output::soul_market_listing_id_v8(binding);
    let _output_registry = output::soul_market_output_registry_id_v8(binding);
    let _soul_registry = output::soul_market_soul_registry_id_v8(binding);
    let _market_registry = output::soul_market_market_registry_id_v8(binding);
    let _market_treasury = output::soul_market_market_treasury_id_v8(binding);
    let _root = output::soul_market_root_id_v8(binding);
    let _maker_version = output::soul_market_maker_version_v8(binding);
    let _root_content = output::soul_market_root_content_commitment_v8(binding);
    let _output = output::soul_market_output_id_v8(binding);
    let _receipt = output::soul_market_receipt_id_v8(binding);
    let _soul = output::soul_market_soul_id_v8(binding);
    let _output_commitment = output::soul_market_output_commitment_v8(binding);
    let _receipt_commitment = output::soul_market_receipt_commitment_v8(binding);
    let _soul_commitment = output::soul_market_soul_commitment_v8(binding);
    let _seller = output::soul_market_seller_v8(binding);
    let _epoch = output::soul_market_expected_epoch_v8(binding);
}

public fun custody_for_market<PaymentCoin>(
    complete: CompleteOutputV8,
    receipt: CompleteReceiptV8,
    soul: CanonicalSoulV8,
    listing: &mut MarketListing,
    output_registry: &OutputRegistryV8,
    soul_registry: &SoulRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    market_registry: &MarketRegistry,
    market_treasury: &MarketTreasury,
    cap: &PackageCallCapV8<MarketRoleV8>,
    ctx: &TxContext,
): SoulMarketCustodyTicketV8 {
    output::custody_soul_bundle_for_market_v8<
        PaymentCoin,
        MarketOriginalMarker,
        MarketCallableMarker,
        MarketRegistry,
        MarketTreasury,
    >(complete, receipt, soul, &mut listing.id, output_registry, soul_registry,
        root, protocol_config, catalog, market_registry, market_treasury, cap,
        ctx)
}

public fun consume_market_ticket<PaymentCoin>(
    ticket: SoulMarketCustodyTicketV8,
    listing: &MarketListing,
    output_registry: &OutputRegistryV8,
    soul_registry: &SoulRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
    market_registry: &MarketRegistry,
    market_treasury: &MarketTreasury,
    cap: &PackageCallCapV8<MarketRoleV8>,
): SoulMarketCustodyBindingV8 {
    output::consume_soul_market_custody_ticket_v8<
        PaymentCoin,
        MarketOriginalMarker,
        MarketCallableMarker,
        MarketRegistry,
        MarketTreasury,
    >(ticket, &listing.id, output_registry, soul_registry, root, catalog,
        market_registry, market_treasury, cap)
}

public fun return_market_custody<PaymentCoin>(
    output_receiving: Receiving<CompleteOutputV8>,
    receipt_receiving: Receiving<CompleteReceiptV8>,
    soul_receiving: Receiving<CanonicalSoulV8>,
    listing: &mut MarketListing,
    custody: &SoulMarketCustodyBindingV8,
    output_registry: &OutputRegistryV8,
    soul_registry: &SoulRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
    market_registry: &MarketRegistry,
    market_treasury: &MarketTreasury,
    cap: &PackageCallCapV8<MarketRoleV8>,
) {
    output::return_soul_bundle_from_market_v8<
        PaymentCoin,
        MarketOriginalMarker,
        MarketCallableMarker,
        MarketRegistry,
        MarketTreasury,
    >(output_receiving, receipt_receiving, soul_receiving, &mut listing.id,
        custody, output_registry, soul_registry, root, catalog, market_registry,
        market_treasury, cap)
}

public fun purchase_market_custody<PaymentCoin>(
    output_receiving: Receiving<CompleteOutputV8>,
    receipt_receiving: Receiving<CompleteReceiptV8>,
    soul_receiving: Receiving<CanonicalSoulV8>,
    listing: &mut MarketListing,
    custody: &SoulMarketCustodyBindingV8,
    output_registry: &mut OutputRegistryV8,
    soul_registry: &mut SoulRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    market_registry: &MarketRegistry,
    market_treasury: &MarketTreasury,
    cap: &PackageCallCapV8<MarketRoleV8>,
    buyer: address,
) {
    output::purchase_soul_bundle_from_market_v8<
        PaymentCoin,
        MarketOriginalMarker,
        MarketCallableMarker,
        MarketRegistry,
        MarketTreasury,
    >(output_receiving, receipt_receiving, soul_receiving, &mut listing.id,
        custody, output_registry, soul_registry, root, protocol_config, catalog,
        market_registry, market_treasury, cap, buyer)
}

public fun consume_for_physical(
    witness: PhysicalMaterializationWitnessV8,
    catalog: &ProductReleaseCatalogV8,
    cap: &PackageCallCapV8<PhysicalRoleV8>,
): (PhysicalCompleteBindingV8, PhysicalSelectionBindingV8,
    std::string::String, vector<u8>) {
    output::consume_physical_materialization_witness_v8<
        PhysicalOriginalMarker,
        PhysicalCallableMarker,
    >(witness, catalog, cap)
}

public fun new_physical_witness<PaymentCoin>(
    registry: &mut OutputRegistryV8,
    souls: &SoulRegistryV8,
    receipt: &CompleteReceiptV8,
    soul: &CanonicalSoulV8,
    root: &MakerRootV8<PaymentCoin>,
    loadout: &MakerLoadoutV8,
    selection: RuntimePhysicalSelectionWitnessV8,
    materialization_key: std::string::String,
    ctx: &TxContext,
): PhysicalMaterializationWitnessV8 {
    output::new_physical_materialization_witness_v8(
        registry, souls, receipt, soul, root, loadout, selection,
        materialization_key, ctx)
}

public fun inspect_physical(
    complete: &PhysicalCompleteBindingV8,
    selection: &PhysicalSelectionBindingV8,
) {
    let _output_registry = output::physical_complete_output_registry_id_v8(complete);
    let _output_key = output::physical_complete_output_key_v8(complete);
    let _policy = output::physical_complete_policy_commitment_v8(complete);
    let _receipt = output::physical_complete_receipt_id_v8(complete);
    let _soul = output::physical_complete_soul_id_v8(complete);
    let _recipe = output::physical_complete_recipe_commitment_v8(complete);
    let _render = output::physical_complete_render_commitment_v8(complete);
    let _loadout = output::physical_selection_loadout_id_v8(selection);
    let _index = output::physical_selection_index_v8(selection);
    let _selection = output::physical_selection_commitment_v8(selection);
    let _part = output::physical_selection_part_key_v8(selection);
    let _item = output::physical_selection_item_key_v8(selection);
    let _style = output::physical_selection_style_key_v8(selection);
    let _track = output::physical_selection_layer_track_key_v8(selection);
    let _source = output::physical_selection_source_definition_id_v8(selection);
    let _asset = output::physical_selection_asset_content_commitment_v8(selection);
}
