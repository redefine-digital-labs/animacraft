module physical_companion_probe::probe;

use animacraft_v8_core::activation_v8::PhysicalReadinessV8;
use animacraft_v8_core::base_registry_v8::BaseDefinitionRegistryV8;
use animacraft_v8_core::maker_v8::{MakerAdminCapV8, MakerRootV8};
use animacraft_v8_core::package_binding_v8::{Self as binding, MarketRoleV8,
    PackageCallCapV8, PhysicalRoleV8, ProductReleaseCatalogV8};
use animacraft_v8_core::protocol_config_v8::{ProtocolConfigV8,
    ProtocolTreasuryV8};
use animacraft_v8_core::treasury_v8::MakerTreasuryV8;
use animacraft_v8_physical::physical_v8::{Self as physical,
    PhysicalAssetV8, PhysicalCallableMarkerV8, PhysicalMarketCustodyBindingV8,
    PhysicalMarketCustodyTicketV8, PhysicalOriginalMarkerV8,
    PhysicalPackageConfigV8, PhysicalRegistryV8};
use animacraft_v8_output::output_v8::{Self as output,
    PhysicalMaterializationWitnessV8, PhysicalSelectionBindingV8};
use animacraft_v8_runtime::runtime_v8::{MakerLoadoutV8, PackAdminCapV8,
    PackPassV8, PackRegistryV8, PackReleaseV8, PackTreasuryV8,
    RuntimePhysicalSelectionWitnessV8};
use std::string::String;
use sui::coin::Coin;
use sui::transfer::Receiving;

public struct MarketOriginalProbe has drop {}
public struct MarketCallableProbe has drop {}
public struct MarketRegistryProbe has key { id: UID }
public struct MarketTreasuryProbe has key { id: UID }
public struct PhysicalListingProbe has key { id: UID }

public fun new_config(
    catalog: &ProductReleaseCatalogV8,
    cap: PackageCallCapV8<PhysicalRoleV8>,
    ctx: &mut TxContext,
): PhysicalPackageConfigV8 {
    physical::new_physical_package_config_v8(catalog, cap, ctx)
}

public fun new_zero_registry<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    base_registry: &BaseDefinitionRegistryV8,
    catalog: &ProductReleaseCatalogV8,
    config: &PhysicalPackageConfigV8,
    ctx: &mut TxContext,
): PhysicalRegistryV8 {
    let empty = physical::empty_base_policy_commitment_v8(
        root, base_registry, config,
    );
    physical::new_physical_registry_v8(
        root, admin, base_registry, catalog, config, 0, empty, ctx,
    )
}

public fun append_and_seal<PaymentCoin>(
    registry: &mut PhysicalRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    base_registry: &BaseDefinitionRegistryV8,
    catalog: &ProductReleaseCatalogV8,
    config: &PhysicalPackageConfigV8,
    part_key: String,
    item_key: String,
    style_key: String,
    material_commitment: vector<u8>,
    max_supply: u64,
) {
    let empty = physical::empty_base_policy_commitment_v8(
        root, base_registry, config,
    );
    let row = physical::derive_base_policy_row_commitment_v8(
        root,
        base_registry,
        config,
        0,
        part_key,
        item_key,
        style_key,
        material_commitment,
        physical::issue_proof_materialize_v8(),
        physical::proof_canonical_soul_v8(),
        0,
        max_supply,
        true,
    );
    let _final_commitment = physical::advance_base_policy_commitment_v8(
        root, 0, empty, row,
    );
    physical::append_base_style_policy_v8(
        registry,
        root,
        admin,
        base_registry,
        catalog,
        config,
        0,
        part_key,
        item_key,
        style_key,
        material_commitment,
        physical::issue_proof_materialize_v8(),
        physical::proof_canonical_soul_v8(),
        0,
        max_supply,
        true,
        row,
    );
    physical::seal_physical_registry_v8(
        registry, root, admin, base_registry, catalog, config,
    );
}

public fun certify<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    base_registry: &BaseDefinitionRegistryV8,
    catalog: &ProductReleaseCatalogV8,
    config: &PhysicalPackageConfigV8,
    registry: &PhysicalRegistryV8,
): PhysicalReadinessV8 {
    physical::certify_physical_activation_readiness_v8(
        root, base_registry, catalog, config, registry,
    )
}

public fun read_policy(
    registry: &PhysicalRegistryV8,
    selection: &PhysicalSelectionBindingV8,
): (u64, u8, u8, u64, u64, bool, vector<u8>) {
    let row = physical::borrow_base_policy_v8(registry, selection);
    assert!(physical::policy_part_key_v8(row)
        == output::physical_selection_part_key_v8(selection), 0);
    assert!(physical::policy_item_key_v8(row)
        == output::physical_selection_item_key_v8(selection), 0);
    assert!(physical::policy_style_key_v8(row)
        == output::physical_selection_style_key_v8(selection), 0);
    assert!(physical::policy_layer_track_key_v8(row)
        == output::physical_selection_layer_track_key_v8(selection), 0);
    (
        physical::policy_sequence_v8(row),
        physical::policy_issuance_kind_v8(row),
        physical::policy_proof_kind_v8(row),
        physical::policy_price_atomic_v8(row),
        physical::policy_max_supply_v8(row),
        physical::policy_transferable_v8(row),
        *physical::policy_row_commitment_v8(row),
    )
}

public fun assert_exact_physical_type_origin(catalog: &ProductReleaseCatalogV8) {
    binding::assert_type_origins_v8<
        PhysicalOriginalMarkerV8,
        PhysicalCallableMarkerV8,
    >(binding::physical_binding_v8(binding::catalog_binding_v8(catalog)))
}

public fun register_pack_policy<PaymentCoin>(
    registry: &mut PhysicalRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    maker_admin: &MakerAdminCapV8,
    catalog: &ProductReleaseCatalogV8,
    config: &PhysicalPackageConfigV8,
    packs: &PackRegistryV8,
    release: &PackReleaseV8<PaymentCoin>,
    pack_admin: &PackAdminCapV8,
    pack_treasury: &PackTreasuryV8<PaymentCoin>,
    expected_revision: u64,
    part_key: String,
    item_key: String,
    style_key: String,
    material_commitment: vector<u8>,
    ctx: &TxContext,
) {
    physical::register_pack_style_policy_v8(
        registry,
        root,
        maker_admin,
        catalog,
        config,
        packs,
        release,
        pack_admin,
        pack_treasury,
        expected_revision,
        part_key,
        item_key,
        style_key,
        material_commitment,
        physical::issue_free_claim_v8(),
        physical::proof_none_v8(),
        0,
        1,
        true,
        ctx,
    )
}

public fun free_base<PaymentCoin>(
    registry: &mut PhysicalRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
    config: &PhysicalPackageConfigV8,
    witness: RuntimePhysicalSelectionWitnessV8,
    loadout: &MakerLoadoutV8,
    expected_issued_count: u64,
    ctx: &mut TxContext,
): PhysicalAssetV8 {
    physical::claim_free_base_style_v8(
        registry, root, catalog, config, witness, loadout,
        expected_issued_count, ctx,
    )
}

public fun free_pack<PaymentCoin>(
    registry: &mut PhysicalRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
    config: &PhysicalPackageConfigV8,
    packs: &PackRegistryV8,
    release: &PackReleaseV8<PaymentCoin>,
    pack_treasury: &PackTreasuryV8<PaymentCoin>,
    pass: &PackPassV8,
    witness: RuntimePhysicalSelectionWitnessV8,
    loadout: &MakerLoadoutV8,
    expected_issued_count: u64,
    ctx: &mut TxContext,
): PhysicalAssetV8 {
    physical::claim_free_pack_style_v8(
        registry, root, catalog, config, packs, release, pack_treasury, pass,
        witness, loadout, expected_issued_count, ctx,
    )
}

public fun buy_base<PaymentCoin>(
    registry: &mut PhysicalRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
    config: &PhysicalPackageConfigV8,
    protocol_config: &ProtocolConfigV8,
    protocol_treasury: &mut ProtocolTreasuryV8<PaymentCoin>,
    maker_treasury: &mut MakerTreasuryV8<PaymentCoin>,
    payment: Coin<PaymentCoin>,
    witness: RuntimePhysicalSelectionWitnessV8,
    loadout: &MakerLoadoutV8,
    expected_issued_count: u64,
    ctx: &mut TxContext,
): PhysicalAssetV8 {
    physical::purchase_base_style_v8(
        registry, root, catalog, config, protocol_config, protocol_treasury,
        maker_treasury, payment, witness, loadout, expected_issued_count, ctx,
    )
}

public fun buy_pack<PaymentCoin>(
    registry: &mut PhysicalRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
    config: &PhysicalPackageConfigV8,
    packs: &PackRegistryV8,
    release: &PackReleaseV8<PaymentCoin>,
    pack_treasury: &mut PackTreasuryV8<PaymentCoin>,
    pass: &PackPassV8,
    protocol_config: &ProtocolConfigV8,
    protocol_treasury: &mut ProtocolTreasuryV8<PaymentCoin>,
    payment: Coin<PaymentCoin>,
    witness: RuntimePhysicalSelectionWitnessV8,
    loadout: &MakerLoadoutV8,
    expected_issued_count: u64,
    ctx: &mut TxContext,
): PhysicalAssetV8 {
    physical::purchase_pack_style_v8(
        registry, root, catalog, config, packs, release, pack_treasury, pass,
        protocol_config, protocol_treasury, payment, witness, loadout,
        expected_issued_count, ctx,
    )
}

public fun materialize_base<PaymentCoin>(
    registry: &mut PhysicalRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
    config: &PhysicalPackageConfigV8,
    witness: PhysicalMaterializationWitnessV8,
    loadout: &MakerLoadoutV8,
    expected_issued_count: u64,
    ctx: &mut TxContext,
): PhysicalAssetV8 {
    physical::materialize_base_style_v8(
        registry, root, catalog, config, witness, loadout,
        expected_issued_count, ctx,
    )
}

public fun materialize_pack<PaymentCoin>(
    registry: &mut PhysicalRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
    config: &PhysicalPackageConfigV8,
    packs: &PackRegistryV8,
    release: &PackReleaseV8<PaymentCoin>,
    pack_treasury: &PackTreasuryV8<PaymentCoin>,
    pass: &PackPassV8,
    witness: PhysicalMaterializationWitnessV8,
    loadout: &MakerLoadoutV8,
    expected_issued_count: u64,
    ctx: &mut TxContext,
): PhysicalAssetV8 {
    physical::materialize_pack_style_v8(
        registry, root, catalog, config, packs, release, pack_treasury, pass,
        witness, loadout, expected_issued_count, ctx,
    )
}

public fun transfer_asset(
    asset: PhysicalAssetV8,
    recipient: address,
    expected_ownership_epoch: u64,
    ctx: &TxContext,
) {
    physical::transfer_physical_asset_v8(
        asset, recipient, expected_ownership_epoch, ctx,
    )
}

public fun consume_asset(
    registry: &mut PhysicalRegistryV8,
    asset: PhysicalAssetV8,
    expected_ownership_epoch: u64,
    ctx: &TxContext,
) {
    physical::consume_physical_asset_v8(
        registry, asset, expected_ownership_epoch, ctx,
    )
}

public fun custody_base_for_market<PaymentCoin>(
    registry: &PhysicalRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    config: &PhysicalPackageConfigV8,
    market_cap: &PackageCallCapV8<MarketRoleV8>,
    market_registry: &MarketRegistryProbe,
    market_treasury: &MarketTreasuryProbe,
    listing: &mut PhysicalListingProbe,
    maker_treasury: &MakerTreasuryV8<PaymentCoin>,
    asset: PhysicalAssetV8,
    ctx: &TxContext,
): PhysicalMarketCustodyTicketV8 {
    physical::custody_base_physical_for_market_v8<
        PaymentCoin,
        MarketOriginalProbe,
        MarketCallableProbe,
        MarketRegistryProbe,
        MarketTreasuryProbe,
    >(
        registry,
        root,
        protocol_config,
        catalog,
        config,
        market_cap,
        market_registry,
        market_treasury,
        &mut listing.id,
        maker_treasury,
        asset,
        ctx,
    )
}

public fun custody_pack_for_market<PaymentCoin>(
    registry: &PhysicalRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    config: &PhysicalPackageConfigV8,
    market_cap: &PackageCallCapV8<MarketRoleV8>,
    market_registry: &MarketRegistryProbe,
    market_treasury: &MarketTreasuryProbe,
    listing: &mut PhysicalListingProbe,
    pack_treasury: &PackTreasuryV8<PaymentCoin>,
    asset: PhysicalAssetV8,
    ctx: &TxContext,
): PhysicalMarketCustodyTicketV8 {
    physical::custody_pack_physical_for_market_v8<
        PaymentCoin,
        MarketOriginalProbe,
        MarketCallableProbe,
        MarketRegistryProbe,
        MarketTreasuryProbe,
    >(
        registry,
        root,
        protocol_config,
        catalog,
        config,
        market_cap,
        market_registry,
        market_treasury,
        &mut listing.id,
        pack_treasury,
        asset,
        ctx,
    )
}

public fun consume_custody_ticket(
    ticket: PhysicalMarketCustodyTicketV8,
): PhysicalMarketCustodyBindingV8 {
    physical::consume_physical_market_custody_ticket_v8(ticket)
}

public fun return_from_market<PaymentCoin>(
    registry: &PhysicalRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
    market_cap: &PackageCallCapV8<MarketRoleV8>,
    market_registry: &MarketRegistryProbe,
    market_treasury: &MarketTreasuryProbe,
    listing: &mut PhysicalListingProbe,
    receiving: Receiving<PhysicalAssetV8>,
    custody: &PhysicalMarketCustodyBindingV8,
) {
    physical::return_physical_from_market_v8<
        PaymentCoin,
        MarketOriginalProbe,
        MarketCallableProbe,
        MarketRegistryProbe,
        MarketTreasuryProbe,
    >(
        registry,
        root,
        catalog,
        market_cap,
        market_registry,
        market_treasury,
        &mut listing.id,
        receiving,
        custody,
    )
}

public fun purchase_base_from_market<PaymentCoin>(
    registry: &PhysicalRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    config: &PhysicalPackageConfigV8,
    market_cap: &PackageCallCapV8<MarketRoleV8>,
    market_registry: &MarketRegistryProbe,
    market_treasury: &MarketTreasuryProbe,
    listing: &mut PhysicalListingProbe,
    maker_treasury: &MakerTreasuryV8<PaymentCoin>,
    receiving: Receiving<PhysicalAssetV8>,
    custody: &PhysicalMarketCustodyBindingV8,
    ctx: &TxContext,
) {
    physical::purchase_base_physical_from_market_v8<
        PaymentCoin,
        MarketOriginalProbe,
        MarketCallableProbe,
        MarketRegistryProbe,
        MarketTreasuryProbe,
    >(
        registry,
        root,
        protocol_config,
        catalog,
        config,
        market_cap,
        market_registry,
        market_treasury,
        &mut listing.id,
        maker_treasury,
        receiving,
        custody,
        ctx,
    )
}

public fun purchase_pack_from_market<PaymentCoin>(
    registry: &PhysicalRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    config: &PhysicalPackageConfigV8,
    market_cap: &PackageCallCapV8<MarketRoleV8>,
    market_registry: &MarketRegistryProbe,
    market_treasury: &MarketTreasuryProbe,
    listing: &mut PhysicalListingProbe,
    pack_treasury: &PackTreasuryV8<PaymentCoin>,
    receiving: Receiving<PhysicalAssetV8>,
    custody: &PhysicalMarketCustodyBindingV8,
    ctx: &TxContext,
) {
    physical::purchase_pack_physical_from_market_v8<
        PaymentCoin,
        MarketOriginalProbe,
        MarketCallableProbe,
        MarketRegistryProbe,
        MarketTreasuryProbe,
    >(
        registry,
        root,
        protocol_config,
        catalog,
        config,
        market_cap,
        market_registry,
        market_treasury,
        &mut listing.id,
        pack_treasury,
        receiving,
        custody,
        ctx,
    )
}
