/// Real Market scenarios moved out of dependency packages into the acyclic
/// full graph. Original test names retain their assertion intent; retired
/// movable Soul-bundle tests explicitly exercise native Soul custody instead.
#[test_only]
module native_soul_v8_graph::market_integration;
use native_soul_v8_graph::bootstrap::{Self as bootstrap, SetupIds};
use native_soul_v8_graph::active_maker::{Self as active, MakerObjectIds};
use native_soul_v8_graph::native_completion as completion;
use native_soul_v8_graph::pack_player;
use animacraft_v8_core::core_v8::LivingContentBindingV8;
use animacraft_v8_core::maker_v8::{Self as maker, MakerRootV8, MakerAdminCapV8};
use animacraft_v8_core::protocol_config_v8::{Self as protocol, ProtocolConfigV8, ProtocolTreasuryV8, ProtocolAdminCapV8};
use animacraft_v8_core::treasury_v8::{Self as core_treasury, MakerTreasuryV8, MakerAccessPassV8};
use animacraft_v8_core::package_binding_v8::{ProductReleaseCatalogV8, FreshTupleReplacementBindingV2};
use animacraft_v8_core::base_registry_v8::BaseDefinitionRegistryV8;
use animacraft_v8_market::market_v8::{Self as market, MarketPackageConfigV8, MarketRegistryV8, MarketTreasuryV8, MakerListingV8, PhysicalListingV8};
use animacraft_v8_physical::physical_v8::{Self as physical, PhysicalRegistryV8, PhysicalPackageConfigV8, PhysicalAssetV8};
use animacraft_v8_runtime::runtime_v8::{Self as runtime, RuntimeDefinitionRegistryV8, PackRegistryV8, PackReleaseV8, PackTreasuryV8, PackPassV8, MakerLoadoutV8};
use animacraft_v8_release::release_v8::{Self as release, ReleasePackageConfigV8};
use animacraft_v8_output::output_v8::{Self as output, NativeSoulBindingV8};
use soulidity::market::{Self as soul_market, MarketConfigV2, MarketAdminCapV2, KioskRegistry, SoulListing};
use soulidity::soul::{Self as soul, Soul, SoulState};
use soulidity::grant;
use sui::test_scenario::{Self as ts, Scenario};
use sui::sui::SUI;
use sui::coin::{Self as coin, Coin};
use sui::kiosk::{Self as kiosk, Kiosk};
use sui::transfer_policy::TransferPolicy;
use kiosk::personal_kiosk::{Self as personal, PersonalKioskCap};
use usdc::usdc::USDC;
use walrus::system::System;


fun claim_base_for_market(scenario: &mut Scenario, ids: &Ids): ID {
    let holder = scenario.ctx().sender();
    let root = scenario.take_shared_by_id<MakerRootV8<SUI>>(ids.root_id);
    let mut treasury = scenario.take_shared_by_id<MakerTreasuryV8<SUI>>(ids.maker_treasury_id);
    let clock = sui::clock::create_for_testing(scenario.ctx());
    core_treasury::claim_free_maker_access_v8(&root, &mut treasury, &clock, scenario.ctx());
    clock.destroy_for_testing();
    ts::return_shared(root); ts::return_shared(treasury);
    scenario.next_tx(holder);
    let root = scenario.take_shared_by_id<MakerRootV8<SUI>>(ids.root_id);
    let base = scenario.take_shared_by_id<BaseDefinitionRegistryV8>(ids.base_registry_id);
    let definitions = scenario.take_shared_by_id<RuntimeDefinitionRegistryV8>(ids.runtime_registry_id);
    let mut packs = scenario.take_shared_by_id<PackRegistryV8>(ids.pack_registry_id);
    let access = scenario.take_from_sender<MakerAccessPassV8>();
    let mut item = runtime::claim_owned_base_item_v8(&mut packs, &definitions, &base, &root,
        &access, b"part".to_string(), b"item".to_string(), scenario.ctx());
    let mut loadout = runtime::create_maker_loadout_v8(&root, &definitions, &packs, &access, scenario.ctx());
    runtime::equip_owned_base_style_v8(&mut loadout, &mut item, &root, &definitions,
        &packs, &base, &access, 0, option::none(), b"style".to_string(), option::none(), scenario.ctx());
    let proof = runtime::prove_owned_base_selection_v8(&loadout, &item, &definitions,
        &packs, &base, &root, &access, 0, scenario.ctx());
    let witness = runtime::certify_physical_selection_v8(proof, &loadout, scenario.ctx());
    let protocol = scenario.take_shared_by_id<ProtocolConfigV8>(ids.protocol_config_id);
    let catalog = scenario.take_shared_by_id<ProductReleaseCatalogV8>(ids.catalog_id);
    let replacement = scenario.take_immutable_by_id<FreshTupleReplacementBindingV2>(ids.replacement_id);
    let config = scenario.take_shared_by_id<PhysicalPackageConfigV8>(ids.physical_config_id);
    let mut registry = scenario.take_shared_by_id<PhysicalRegistryV8>(ids.physical_registry_id);
    let asset = physical::claim_free_base_style_v8(&mut registry, &root, &protocol,
        &catalog, &replacement, &config, witness, &loadout, 0, scenario.ctx());
    let asset_id = object::id(&asset);
    physical::transfer_new_physical_asset_to_holder_v8(asset);
    runtime::transfer_new_owned_base_item_to_holder_v8(item);
    runtime::transfer_maker_loadout_to_holder_v8(loadout);
    scenario.return_to_sender(access);
    ts::return_shared(root); ts::return_shared(base); ts::return_shared(definitions);
    ts::return_shared(packs); ts::return_shared(protocol); ts::return_shared(catalog);
    ts::return_immutable(replacement); ts::return_shared(config); ts::return_shared(registry);
    scenario.next_tx(holder);
    asset_id
}

fun claim_pack_for_market(scenario: &mut Scenario, ids: &Ids, player: pack_player::PackPlayerIds): (ID, ID, ID, vector<u8>) {
    let (release_id, admin_id, treasury_id, pass_id, loadout_id, access_id) = pack_player::ids_for_testing(player);
    let root = scenario.take_shared_by_id<MakerRootV8<SUI>>(ids.root_id);
    let packs = scenario.take_shared_by_id<PackRegistryV8>(ids.pack_registry_id);
    let protocol = scenario.take_shared_by_id<ProtocolConfigV8>(ids.protocol_config_id);
    let catalog = scenario.take_shared_by_id<ProductReleaseCatalogV8>(ids.catalog_id);
    let replacement = scenario.take_immutable_by_id<FreshTupleReplacementBindingV2>(ids.replacement_id);
    let config = scenario.take_shared_by_id<PhysicalPackageConfigV8>(ids.physical_config_id);
    let mut registry = scenario.take_shared_by_id<PhysicalRegistryV8>(ids.physical_registry_id);
    let release = scenario.take_shared_by_id<PackReleaseV8<SUI>>(release_id);
    let treasury = scenario.take_shared_by_id<PackTreasuryV8<SUI>>(treasury_id);
    let admin = scenario.take_from_sender_by_id<runtime::PackAdminCapV8>(admin_id);
    let maker_admin = scenario.take_from_sender_by_id<MakerAdminCapV8>(ids.admin_id);
    let pass = scenario.take_from_sender_by_id<PackPassV8>(pass_id);
    let access = scenario.take_from_sender_by_id<MakerAccessPassV8>(access_id);
    let loadout = scenario.take_from_sender_by_id<MakerLoadoutV8>(loadout_id);
    let revision = physical::registry_revision_v8(&registry);
    physical::register_pack_style_policy_v8(&mut registry, &root, &maker_admin,
        &protocol, &catalog, &replacement, &config, &packs, &release, &admin, &treasury,
        revision, b"part".to_string(), b"pack-item".to_string(), b"pack-style".to_string(),
        fixture_hash(48), physical::issue_free_claim_v8(), physical::proof_none_v8(), 0, 100, true, scenario.ctx());
    let proof = runtime::prove_pack_selection_v8(&loadout, &packs, &release, &pass, &root, &access, 0, scenario.ctx());
    let witness = runtime::certify_physical_selection_v8(proof, &loadout, scenario.ctx());
    let asset = physical::claim_free_pack_style_v8(&mut registry, &root, &protocol,
        &catalog, &replacement, &config, &packs, &release, &treasury, &pass, witness, &loadout, 0, scenario.ctx());
    let asset_id = object::id(&asset);
    let provenance = *physical::asset_provenance_commitment_v8(&asset);
    physical::transfer_new_physical_asset_to_holder_v8(asset);
    scenario.return_to_sender(admin); scenario.return_to_sender(maker_admin);
    scenario.return_to_sender(pass); scenario.return_to_sender(access); scenario.return_to_sender(loadout);
    ts::return_shared(root); ts::return_shared(packs); ts::return_shared(protocol);
    ts::return_shared(catalog); ts::return_immutable(replacement); ts::return_shared(config);
    ts::return_shared(registry); ts::return_shared(release); ts::return_shared(treasury);
    (release_id, treasury_id, asset_id, provenance)
}

fun relist_base_physical_for_testing(
    scenario: &mut sui::test_scenario::Scenario,
    ids: &Ids,
    asset_id: ID,
    gross_atomic: u64,
): ID {
    let asset = scenario.take_from_sender_by_id<PhysicalAssetV8>(asset_id);
    let root = scenario.take_shared_by_id<MakerRootV8<SUI>>(ids.root_id);
    let physical_registry = scenario.take_shared_by_id<PhysicalRegistryV8>(
        ids.physical_registry_id,
    );
    let mut registry = scenario.take_shared_by_id<MarketRegistryV8<SUI>>(
        ids.market_registry_id,
    );
    let treasury = scenario.take_shared_by_id<MarketTreasuryV8<SUI>>(
        ids.market_treasury_id,
    );
    let maker_treasury = scenario.take_shared_by_id<MakerTreasuryV8<SUI>>(
        ids.maker_treasury_id,
    );
    let protocol_config = scenario.take_shared_by_id<ProtocolConfigV8>(
        ids.protocol_config_id,
    );
    let catalog = scenario.take_shared_by_id<ProductReleaseCatalogV8>(ids.catalog_id);
    let replacement = scenario.take_immutable_by_id<FreshTupleReplacementBindingV2>(ids.replacement_id);
    let physical_config = scenario.take_shared_by_id<PhysicalPackageConfigV8>(
        ids.physical_config_id,
    );
    let market_config = scenario.take_shared_by_id<MarketPackageConfigV8>(
        ids.market_config_id,
    );
    let listing_id = market::list_base_physical_v8(
        &mut registry,
        &treasury,
        &physical_registry,
        &root,
        &maker_treasury,
        &protocol_config,
        &catalog,
        &replacement,
        &physical_config,
        &market_config,
        asset,
        gross_atomic,
        scenario.ctx(),
    );
    sui::test_scenario::return_shared(root);
    sui::test_scenario::return_shared(physical_registry);
    sui::test_scenario::return_shared(registry);
    sui::test_scenario::return_shared(treasury);
    sui::test_scenario::return_shared(maker_treasury);
    sui::test_scenario::return_shared(protocol_config);
    sui::test_scenario::return_shared(catalog);
    ts::return_immutable(replacement);
    sui::test_scenario::return_shared(physical_config);
    sui::test_scenario::return_shared(market_config);
    listing_id
}

fun relist_pack_physical_for_testing(
    scenario: &mut sui::test_scenario::Scenario,
    ids: &Ids,
    asset_id: ID,
    pack_treasury_id: ID,
    gross_atomic: u64,
): ID {
    let asset = scenario.take_from_sender_by_id<PhysicalAssetV8>(asset_id);
    let root = scenario.take_shared_by_id<MakerRootV8<SUI>>(ids.root_id);
    let physical_registry = scenario.take_shared_by_id<PhysicalRegistryV8>(
        ids.physical_registry_id,
    );
    let mut registry = scenario.take_shared_by_id<MarketRegistryV8<SUI>>(
        ids.market_registry_id,
    );
    let treasury = scenario.take_shared_by_id<MarketTreasuryV8<SUI>>(
        ids.market_treasury_id,
    );
    let pack_treasury = scenario.take_shared_by_id<PackTreasuryV8<SUI>>(
        pack_treasury_id,
    );
    let protocol_config = scenario.take_shared_by_id<ProtocolConfigV8>(
        ids.protocol_config_id,
    );
    let catalog = scenario.take_shared_by_id<ProductReleaseCatalogV8>(ids.catalog_id);
    let replacement = scenario.take_immutable_by_id<FreshTupleReplacementBindingV2>(ids.replacement_id);
    let physical_config = scenario.take_shared_by_id<PhysicalPackageConfigV8>(
        ids.physical_config_id,
    );
    let market_config = scenario.take_shared_by_id<MarketPackageConfigV8>(
        ids.market_config_id,
    );
    let listing_id = market::list_pack_physical_v8(
        &mut registry,
        &treasury,
        &physical_registry,
        &root,
        &pack_treasury,
        &protocol_config,
        &catalog,
        &replacement,
        &physical_config,
        &market_config,
        asset,
        gross_atomic,
        scenario.ctx(),
    );
    sui::test_scenario::return_shared(root);
    sui::test_scenario::return_shared(physical_registry);
    sui::test_scenario::return_shared(registry);
    sui::test_scenario::return_shared(treasury);
    sui::test_scenario::return_shared(pack_treasury);
    sui::test_scenario::return_shared(protocol_config);
    sui::test_scenario::return_shared(catalog);
    ts::return_immutable(replacement);
    sui::test_scenario::return_shared(physical_config);
    sui::test_scenario::return_shared(market_config);
    listing_id
}

fun cancel_physical_for_testing(
    scenario: &mut sui::test_scenario::Scenario,
    ids: &Ids,
    listing_id: ID,
    asset_id: ID,
) {
    let mut listing = scenario.take_shared_by_id<PhysicalListingV8<SUI>>(listing_id);
    let root = scenario.take_shared_by_id<MakerRootV8<SUI>>(ids.root_id);
    let physical_registry = scenario.take_shared_by_id<PhysicalRegistryV8>(
        ids.physical_registry_id,
    );
    let mut registry = scenario.take_shared_by_id<MarketRegistryV8<SUI>>(
        ids.market_registry_id,
    );
    let treasury = scenario.take_shared_by_id<MarketTreasuryV8<SUI>>(
        ids.market_treasury_id,
    );
    let protocol_config = scenario.take_shared_by_id<ProtocolConfigV8>(ids.protocol_config_id);
    let catalog = scenario.take_shared_by_id<ProductReleaseCatalogV8>(ids.catalog_id);
    let replacement = scenario.take_immutable_by_id<FreshTupleReplacementBindingV2>(ids.replacement_id);
    let market_config = scenario.take_shared_by_id<MarketPackageConfigV8>(
        ids.market_config_id,
    );
    market::cancel_physical_listing_v8(
        &mut listing,
        &mut registry,
        &treasury,
        &physical_registry,
        &root,
        &protocol_config,
        &catalog,
        &replacement,
        &market_config,
        sui::test_scenario::receiving_ticket_by_id<PhysicalAssetV8>(asset_id),
        scenario.ctx(),
    );
    sui::test_scenario::return_shared(listing);
    sui::test_scenario::return_shared(root);
    sui::test_scenario::return_shared(physical_registry);
    sui::test_scenario::return_shared(registry);
    sui::test_scenario::return_shared(treasury);
    sui::test_scenario::return_shared(protocol_config);
    sui::test_scenario::return_shared(catalog);
    ts::return_immutable(replacement);
    sui::test_scenario::return_shared(market_config);
}

fun recover_physical_for_testing(
    scenario: &sui::test_scenario::Scenario,
    ids: &Ids,
    listing_id: ID,
    asset_id: ID,
) {
    let mut listing = scenario.take_shared_by_id<PhysicalListingV8<SUI>>(listing_id);
    let root = scenario.take_shared_by_id<MakerRootV8<SUI>>(ids.root_id);
    let physical_registry = scenario.take_shared_by_id<PhysicalRegistryV8>(
        ids.physical_registry_id,
    );
    let mut registry = scenario.take_shared_by_id<MarketRegistryV8<SUI>>(
        ids.market_registry_id,
    );
    let treasury = scenario.take_shared_by_id<MarketTreasuryV8<SUI>>(
        ids.market_treasury_id,
    );
    let protocol_config = scenario.take_shared_by_id<ProtocolConfigV8>(
        ids.protocol_config_id,
    );
    let catalog = scenario.take_shared_by_id<ProductReleaseCatalogV8>(ids.catalog_id);
    let replacement = scenario.take_immutable_by_id<FreshTupleReplacementBindingV2>(ids.replacement_id);
    let market_config = scenario.take_shared_by_id<MarketPackageConfigV8>(
        ids.market_config_id,
    );
    market::recover_physical_listing_v8(
        &mut listing,
        &mut registry,
        &treasury,
        &physical_registry,
        &root,
        &protocol_config,
        &catalog,
        &replacement,
        &market_config,
        sui::test_scenario::receiving_ticket_by_id<PhysicalAssetV8>(asset_id),
    );
    sui::test_scenario::return_shared(listing);
    sui::test_scenario::return_shared(root);
    sui::test_scenario::return_shared(physical_registry);
    sui::test_scenario::return_shared(registry);
    sui::test_scenario::return_shared(treasury);
    sui::test_scenario::return_shared(protocol_config);
    sui::test_scenario::return_shared(catalog);
    ts::return_immutable(replacement);
    sui::test_scenario::return_shared(market_config);
}

fun fixture_hash(value: u8): vector<u8> {
    let mut bytes = vector[];
    let mut i = 0u64;
    while (i < 32) { bytes.push_back(value); i = i + 1; };
    bytes
}


#[test]
fun base_physical_listing_purchase_preserves_provenance_and_exact_split() {
    let seller = @0xA11;
    let buyer = @0xB0B;
    let recoverer = @0xC0C;
    let mut scenario = sui::test_scenario::begin(seller);
    let (ids, system) = start(&mut scenario, true);
    let claimed_asset_id = claim_base_for_market(&mut scenario, &ids);

    let listing_id;
    let asset_id;
    let provenance;
    scenario.next_tx(seller);
    {
        let root = scenario.take_shared_by_id<MakerRootV8<SUI>>(ids.root_id);
        let physical_registry = scenario.take_shared_by_id<PhysicalRegistryV8>(
            ids.physical_registry_id,
        );
        let mut registry = scenario.take_shared_by_id<MarketRegistryV8<SUI>>(
            ids.market_registry_id,
        );
        let treasury = scenario.take_shared_by_id<MarketTreasuryV8<SUI>>(
            ids.market_treasury_id,
        );
        let maker_treasury = scenario.take_shared_by_id<MakerTreasuryV8<SUI>>(
            ids.maker_treasury_id,
        );
        let protocol_config = scenario.take_shared_by_id<ProtocolConfigV8>(
            ids.protocol_config_id,
        );
        let catalog = scenario.take_shared_by_id<ProductReleaseCatalogV8>(ids.catalog_id);
        let replacement = scenario.take_immutable_by_id<FreshTupleReplacementBindingV2>(ids.replacement_id);
        let physical_config = scenario.take_shared_by_id<PhysicalPackageConfigV8>(
            ids.physical_config_id,
        );
        let market_config = scenario.take_shared_by_id<MarketPackageConfigV8>(
            ids.market_config_id,
        );
        let asset = scenario.take_from_sender_by_id<PhysicalAssetV8>(claimed_asset_id);
        asset_id = physical::asset_id_v8(&asset);
        provenance = *physical::asset_provenance_commitment_v8(&asset);
        listing_id = market::list_base_physical_v8(
            &mut registry,
            &treasury,
            &physical_registry,
            &root,
            &maker_treasury,
            &protocol_config,
            &catalog,
            &replacement,
            &physical_config,
            &market_config,
            asset,
            10_000,
            scenario.ctx(),
        );
        sui::test_scenario::return_shared(root);
        sui::test_scenario::return_shared(physical_registry);
        sui::test_scenario::return_shared(registry);
        sui::test_scenario::return_shared(treasury);
        sui::test_scenario::return_shared(maker_treasury);
        sui::test_scenario::return_shared(protocol_config);
        sui::test_scenario::return_shared(catalog);
        ts::return_immutable(replacement);
        sui::test_scenario::return_shared(physical_config);
        sui::test_scenario::return_shared(market_config);
    };

    scenario.next_tx(buyer);
    {
        let mut listing = scenario.take_shared_by_id<PhysicalListingV8<SUI>>(listing_id);
        let root = scenario.take_shared_by_id<MakerRootV8<SUI>>(ids.root_id);
        let physical_registry = scenario.take_shared_by_id<PhysicalRegistryV8>(
            ids.physical_registry_id,
        );
        let mut registry = scenario.take_shared_by_id<MarketRegistryV8<SUI>>(
            ids.market_registry_id,
        );
        let mut treasury = scenario.take_shared_by_id<MarketTreasuryV8<SUI>>(
            ids.market_treasury_id,
        );
        let mut maker_treasury = scenario.take_shared_by_id<MakerTreasuryV8<SUI>>(
            ids.maker_treasury_id,
        );
        let protocol_config = scenario.take_shared_by_id<ProtocolConfigV8>(
            ids.protocol_config_id,
        );
        let mut protocol_treasury = scenario.take_shared_by_id<ProtocolTreasuryV8<SUI>>(
            ids.protocol_treasury_id,
        );
        let catalog = scenario.take_shared_by_id<ProductReleaseCatalogV8>(ids.catalog_id);
        let replacement = scenario.take_immutable_by_id<FreshTupleReplacementBindingV2>(ids.replacement_id);
        let physical_config = scenario.take_shared_by_id<PhysicalPackageConfigV8>(
            ids.physical_config_id,
        );
        let market_config = scenario.take_shared_by_id<MarketPackageConfigV8>(
            ids.market_config_id,
        );
        market::purchase_base_physical_v8(
            &mut listing,
            &mut registry,
            &mut treasury,
            &physical_registry,
            &root,
            &mut maker_treasury,
            &protocol_config,
            &mut protocol_treasury,
            &catalog,
            &replacement,
            &physical_config,
            &market_config,
            sui::test_scenario::receiving_ticket_by_id<PhysicalAssetV8>(asset_id),
            coin::mint_for_testing<SUI>(10_000, scenario.ctx()),
            scenario.ctx(),
        );
        assert!(market::physical_listing_status_v8(&listing) == 1
            && market::physical_listing_terminal_recipient_v8(&listing) == buyer
            && market::physical_listing_source_treasury_id_v8(&listing)
                == ids.maker_treasury_id, 99);
        assert!(market::registry_listing_count_v8(&registry) == 1
            && market::registry_escrow_count_v8(&registry) == 0
            && market::registry_completed_sale_count_v8(&registry) == 1
            && market::registry_protocol_paid_atomic_v8(&registry) == 250
            && market::registry_creator_paid_atomic_v8(&registry) == 250
            && market::registry_source_paid_atomic_v8(&registry) == 250
            && market::registry_seller_paid_atomic_v8(&registry) == 9_250, 99);
        assert!(protocol::protocol_treasury_balance_for_testing(&protocol_treasury) == 250, 99);
        assert!(core_treasury::maker_treasury_balance_v2(&maker_treasury) == 250, 99);
        assert!(market::treasury_balance_v8(&treasury) == 0, 99);
        sui::test_scenario::return_shared(listing);
        sui::test_scenario::return_shared(root);
        sui::test_scenario::return_shared(physical_registry);
        sui::test_scenario::return_shared(registry);
        sui::test_scenario::return_shared(treasury);
        sui::test_scenario::return_shared(maker_treasury);
        sui::test_scenario::return_shared(protocol_config);
        sui::test_scenario::return_shared(protocol_treasury);
        sui::test_scenario::return_shared(catalog);
        ts::return_immutable(replacement);
        sui::test_scenario::return_shared(physical_config);
        sui::test_scenario::return_shared(market_config);
    };

    scenario.next_tx(buyer);
    {
        let asset = scenario.take_from_sender_by_id<PhysicalAssetV8>(asset_id);
        assert!(physical::asset_holder_v8(&asset) == buyer
            && physical::asset_ownership_epoch_v8(&asset) == 1
            && physical::asset_source_kind_v8(&asset) == physical::source_base_style_v8()
            && physical::asset_provenance_commitment_v8(&asset) == &provenance, 99);
        scenario.return_to_sender(asset);
    };

    scenario.next_tx(buyer);
    let cancel_listing_id = relist_base_physical_for_testing(
        &mut scenario,
        &ids,
        asset_id,
        20_000,
    );
    scenario.next_tx(buyer);
    cancel_physical_for_testing(&mut scenario, &ids, cancel_listing_id, asset_id);

    scenario.next_tx(buyer);
    let recover_listing_id = relist_base_physical_for_testing(
        &mut scenario,
        &ids,
        asset_id,
        30_000,
    );
    scenario.next_tx(seller);
    {
        let mut root = scenario.take_shared_by_id<MakerRootV8<SUI>>(ids.root_id);
        let protocol_config = scenario.take_shared_by_id<ProtocolConfigV8>(ids.protocol_config_id);
        let catalog = scenario.take_shared_by_id<ProductReleaseCatalogV8>(ids.catalog_id);
        let replacement = scenario.take_immutable_by_id<FreshTupleReplacementBindingV2>(ids.replacement_id);
        let release_config = scenario.take_shared_by_id<ReleasePackageConfigV8>(
            ids.release_config_id,
        );
        let admin = scenario.take_from_sender_by_id<MakerAdminCapV8>(ids.admin_id);
        release::pause_maker_v8(
            &mut root,
            &admin,
            &protocol_config,
            &catalog,
            &replacement,
            &release_config,
            scenario.ctx(),
        );
        scenario.return_to_sender(admin);
        sui::test_scenario::return_shared(root);
        sui::test_scenario::return_shared(protocol_config);
        sui::test_scenario::return_shared(catalog);
        ts::return_immutable(replacement);
        sui::test_scenario::return_shared(release_config);
    };
    scenario.next_tx(recoverer);
    recover_physical_for_testing(&scenario, &ids, recover_listing_id, asset_id);
    scenario.next_tx(buyer);
    {
        let asset = scenario.take_from_sender_by_id<PhysicalAssetV8>(asset_id);
        let registry = scenario.take_shared_by_id<MarketRegistryV8<SUI>>(
            ids.market_registry_id,
        );
        assert!(physical::asset_holder_v8(&asset) == buyer
            && physical::asset_ownership_epoch_v8(&asset) == 1
            && physical::asset_provenance_commitment_v8(&asset) == &provenance, 99);
        assert!(market::registry_listing_count_v8(&registry) == 3
            && market::registry_escrow_count_v8(&registry) == 0
            && market::registry_completed_sale_count_v8(&registry) == 1
            && market::registry_canceled_sale_count_v8(&registry) == 1
            && market::registry_recovered_sale_count_v8(&registry) == 1, 99);
        scenario.return_to_sender(asset);
        sui::test_scenario::return_shared(registry);
    };
    std::unit_test::destroy(system);
    scenario.end();
}

#[test]
fun pack_physical_listing_purchase_uses_exact_pack_treasury() {
    let seller = @0xA11;
    let buyer = @0xB0B;
    let mut scenario = sui::test_scenario::begin(seller);
    let (protocol_id, setup, mut system) = bootstrap::initialize_for_testing(&mut scenario);
    let active_ids = active::new_active_with_physical_for_testing(&mut scenario, protocol_id, setup,
        &mut system, physical::issue_free_claim_v8(), physical::proof_none_v8(), 0, 100, true);
    let ids = collect_ids(&mut scenario, protocol_id, setup, active::maker_objects_for_testing(active_ids));
    let player = pack_player::new_pack_player_for_testing(&mut scenario, active_ids);
    let (pack_release_id, pack_treasury_id, asset_id, provenance) = claim_pack_for_market(&mut scenario, &ids, player);

    let listing_id;
    scenario.next_tx(seller);
    {
        let asset = scenario.take_from_sender_by_id<PhysicalAssetV8>(asset_id);
        let root = scenario.take_shared_by_id<MakerRootV8<SUI>>(ids.root_id);
        let physical_registry = scenario.take_shared_by_id<PhysicalRegistryV8>(
            ids.physical_registry_id,
        );
        let mut registry = scenario.take_shared_by_id<MarketRegistryV8<SUI>>(
            ids.market_registry_id,
        );
        let treasury = scenario.take_shared_by_id<MarketTreasuryV8<SUI>>(
            ids.market_treasury_id,
        );
        let pack_treasury = scenario.take_shared_by_id<PackTreasuryV8<SUI>>(
            pack_treasury_id,
        );
        let protocol_config = scenario.take_shared_by_id<ProtocolConfigV8>(
            ids.protocol_config_id,
        );
        let catalog = scenario.take_shared_by_id<ProductReleaseCatalogV8>(ids.catalog_id);
        let replacement = scenario.take_immutable_by_id<FreshTupleReplacementBindingV2>(ids.replacement_id);
        let physical_config = scenario.take_shared_by_id<PhysicalPackageConfigV8>(
            ids.physical_config_id,
        );
        let market_config = scenario.take_shared_by_id<MarketPackageConfigV8>(
            ids.market_config_id,
        );
        listing_id = market::list_pack_physical_v8(
            &mut registry,
            &treasury,
            &physical_registry,
            &root,
            &pack_treasury,
            &protocol_config,
            &catalog,
            &replacement,
            &physical_config,
            &market_config,
            asset,
            10_000,
            scenario.ctx(),
        );
        sui::test_scenario::return_shared(root);
        sui::test_scenario::return_shared(physical_registry);
        sui::test_scenario::return_shared(registry);
        sui::test_scenario::return_shared(treasury);
        sui::test_scenario::return_shared(pack_treasury);
        sui::test_scenario::return_shared(protocol_config);
        sui::test_scenario::return_shared(catalog);
        ts::return_immutable(replacement);
        sui::test_scenario::return_shared(physical_config);
        sui::test_scenario::return_shared(market_config);
    };

    scenario.next_tx(buyer);
    {
        let mut listing = scenario.take_shared_by_id<PhysicalListingV8<SUI>>(listing_id);
        let root = scenario.take_shared_by_id<MakerRootV8<SUI>>(ids.root_id);
        let physical_registry = scenario.take_shared_by_id<PhysicalRegistryV8>(
            ids.physical_registry_id,
        );
        let mut registry = scenario.take_shared_by_id<MarketRegistryV8<SUI>>(
            ids.market_registry_id,
        );
        let mut treasury = scenario.take_shared_by_id<MarketTreasuryV8<SUI>>(
            ids.market_treasury_id,
        );
        let pack_release = scenario.take_shared_by_id<PackReleaseV8<SUI>>(
            pack_release_id,
        );
        let mut pack_treasury = scenario.take_shared_by_id<PackTreasuryV8<SUI>>(
            pack_treasury_id,
        );
        let protocol_config = scenario.take_shared_by_id<ProtocolConfigV8>(
            ids.protocol_config_id,
        );
        let mut protocol_treasury = scenario.take_shared_by_id<ProtocolTreasuryV8<SUI>>(
            ids.protocol_treasury_id,
        );
        let catalog = scenario.take_shared_by_id<ProductReleaseCatalogV8>(ids.catalog_id);
        let replacement = scenario.take_immutable_by_id<FreshTupleReplacementBindingV2>(ids.replacement_id);
        let physical_config = scenario.take_shared_by_id<PhysicalPackageConfigV8>(
            ids.physical_config_id,
        );
        let market_config = scenario.take_shared_by_id<MarketPackageConfigV8>(
            ids.market_config_id,
        );
        market::purchase_pack_physical_v8(
            &mut listing,
            &mut registry,
            &mut treasury,
            &physical_registry,
            &root,
            &pack_release,
            &mut pack_treasury,
            &protocol_config,
            &mut protocol_treasury,
            &catalog,
            &replacement,
            &physical_config,
            &market_config,
            sui::test_scenario::receiving_ticket_by_id<PhysicalAssetV8>(asset_id),
            coin::mint_for_testing<SUI>(10_000, scenario.ctx()),
            scenario.ctx(),
        );
        assert!(market::physical_listing_status_v8(&listing) == 1
            && market::physical_listing_terminal_recipient_v8(&listing) == buyer
            && market::physical_listing_source_treasury_id_v8(&listing)
                == pack_treasury_id, 99);
        assert!(market::registry_listing_count_v8(&registry) == 1
            && market::registry_escrow_count_v8(&registry) == 0
            && market::registry_completed_sale_count_v8(&registry) == 1
            && market::registry_protocol_paid_atomic_v8(&registry) == 250
            && market::registry_creator_paid_atomic_v8(&registry) == 250
            && market::registry_source_paid_atomic_v8(&registry) == 250
            && market::registry_seller_paid_atomic_v8(&registry) == 9_250, 99);
        assert!(runtime::pack_treasury_balance_v8(&pack_treasury) == 250, 99);
        assert!(protocol::protocol_treasury_balance_for_testing(&protocol_treasury) == 250, 99);
        assert!(market::treasury_balance_v8(&treasury) == 0, 99);
        sui::test_scenario::return_shared(listing);
        sui::test_scenario::return_shared(root);
        sui::test_scenario::return_shared(physical_registry);
        sui::test_scenario::return_shared(registry);
        sui::test_scenario::return_shared(treasury);
        sui::test_scenario::return_shared(pack_release);
        sui::test_scenario::return_shared(pack_treasury);
        sui::test_scenario::return_shared(protocol_config);
        sui::test_scenario::return_shared(protocol_treasury);
        sui::test_scenario::return_shared(catalog);
        ts::return_immutable(replacement);
        sui::test_scenario::return_shared(physical_config);
        sui::test_scenario::return_shared(market_config);
    };

    scenario.next_tx(buyer);
    {
        let asset = scenario.take_from_sender_by_id<PhysicalAssetV8>(asset_id);
        assert!(physical::asset_holder_v8(&asset) == buyer
            && physical::asset_ownership_epoch_v8(&asset) == 1
            && physical::asset_source_kind_v8(&asset) == physical::source_pack_style_v8()
            && *physical::asset_source_treasury_id_v8(&asset).borrow()
                == pack_treasury_id
            && physical::asset_provenance_commitment_v8(&asset) == &provenance, 99);
        scenario.return_to_sender(asset);
    };

    scenario.next_tx(buyer);
    let cancel_listing_id = relist_pack_physical_for_testing(
        &mut scenario,
        &ids,
        asset_id,
        pack_treasury_id,
        20_000,
    );
    scenario.next_tx(buyer);
    cancel_physical_for_testing(&mut scenario, &ids, cancel_listing_id, asset_id);
    scenario.next_tx(buyer);
    {
        let asset = scenario.take_from_sender_by_id<PhysicalAssetV8>(asset_id);
        let registry = scenario.take_shared_by_id<MarketRegistryV8<SUI>>(
            ids.market_registry_id,
        );
        assert!(physical::asset_holder_v8(&asset) == buyer
            && physical::asset_ownership_epoch_v8(&asset) == 1
            && physical::asset_provenance_commitment_v8(&asset) == &provenance, 99);
        assert!(market::registry_listing_count_v8(&registry) == 2
            && market::registry_escrow_count_v8(&registry) == 0
            && market::registry_completed_sale_count_v8(&registry) == 1
            && market::registry_canceled_sale_count_v8(&registry) == 1
            && market::registry_recovered_sale_count_v8(&registry) == 0, 99);
        scenario.return_to_sender(asset);
        sui::test_scenario::return_shared(registry);
    };
    std::unit_test::destroy(system);
    scenario.end();
}


public struct Ids has copy, drop {
    root_id: ID, base_registry_id: ID, maker_treasury_id: ID, admin_id: ID,
    protocol_config_id: ID, protocol_treasury_id: ID, protocol_admin_id: ID,
    catalog_id: ID, replacement_id: ID, release_config_id: ID,
    physical_config_id: ID, physical_registry_id: ID,
    runtime_registry_id: ID, pack_registry_id: ID,
    market_config_id: ID, market_registry_id: ID, market_treasury_id: ID,
    setup: SetupIds, objects: MakerObjectIds,
}
fun collect_ids(scenario: &mut Scenario, protocol_id: ID, setup: SetupIds, objects: MakerObjectIds): Ids {
    let (root_id, base_registry_id, maker_treasury_id, admin_id) = active::draft_maker_ids_for_testing(objects);
    let (runtime_registry_id, pack_registry_id, _, _, _, _, physical_registry_id, market_registry_id, market_treasury_id) = active::draft_companion_ids_for_testing(objects);
    let (catalog_id, _, _, _, physical_config_id, market_config_id, release_config_id) = bootstrap::configuration_ids_for_testing(setup);
    let (replacement_id, _, _) = bootstrap::authority_ids_for_testing(scenario, setup);
    let protocol = scenario.take_shared_by_id<ProtocolConfigV8>(protocol_id);
    let protocol_treasury_id = *protocol::config_treasury_id_v8(&protocol).borrow();
    let protocol_admin = scenario.take_from_sender<ProtocolAdminCapV8>();
    let protocol_admin_id = object::id(&protocol_admin);
    scenario.return_to_sender(protocol_admin);
    ts::return_shared(protocol);
    // Returned inventory is available again only in the next test transaction.
    let sender = scenario.ctx().sender();
    scenario.next_tx(sender);
    Ids {root_id, base_registry_id, maker_treasury_id, admin_id, protocol_config_id: protocol_id,
        protocol_treasury_id, protocol_admin_id, catalog_id, replacement_id, release_config_id,
        physical_config_id, physical_registry_id, runtime_registry_id, pack_registry_id,
        market_config_id, market_registry_id, market_treasury_id, setup, objects}
}
fun start(scenario: &mut Scenario, physical_policy: bool): (Ids, System) {
    let (protocol_id, setup, mut system) = bootstrap::initialize_for_testing(scenario);
    let active = if (physical_policy)
        active::new_active_with_physical_for_testing(scenario, protocol_id, setup, &mut system,
            physical::issue_free_claim_v8(), physical::proof_none_v8(), 0, 100, true)
    else active::new_active_maker_for_testing(scenario, protocol_id, setup, &mut system);
    let ids = collect_ids(scenario, protocol_id, setup, active::maker_objects_for_testing(active));
    (ids, system)
}
fun draft(scenario: &mut Scenario): (Ids, System, LivingContentBindingV8) {
    let (protocol_id, setup, mut system) = bootstrap::initialize_for_testing(scenario);
    let (objects, living) = active::new_draft_with_unsealed_market_for_testing(scenario, protocol_id, setup, &mut system);
    (collect_ids(scenario, protocol_id, setup, objects), system, living)
}

#[test]
fun maker_child_custody_purchase_cancel_and_disabled_recovery_are_exact() {

    let seller = @0xA11;
    let buyer = @0xB0B;
    let recoverer = @0xC0C;
    let mut scenario = sui::test_scenario::begin(seller);
    let (ids, system) = start(&mut scenario, false);


    scenario.next_tx(seller);
    {
        let root = scenario.take_shared_by_id<MakerRootV8<SUI>>(ids.root_id);
        let registry = scenario.take_shared_by_id<MarketRegistryV8<SUI>>(
            ids.market_registry_id,
        );
        let treasury = scenario.take_shared_by_id<MarketTreasuryV8<SUI>>(
            ids.market_treasury_id,
        );
        let maker_quote = market::quote_maker_resale_v8(&registry, &treasury, &root, 10_000);
        let soul_quote = market::quote_soul_resale_v8(&registry, &treasury, &root, 10_000);
        assert!(market::quote_protocol_atomic_v8(&maker_quote) == 250
            && market::quote_creator_atomic_v8(&maker_quote) == 500
            && market::quote_seller_atomic_v8(&maker_quote) == 9_250, 99);
        assert!(market::quote_protocol_atomic_v8(&soul_quote) == 250
            && market::quote_creator_atomic_v8(&soul_quote) == 250
            && market::quote_source_atomic_v8(&soul_quote) == 250
            && market::quote_seller_atomic_v8(&soul_quote) == 9_250, 99);
        sui::test_scenario::return_shared(root);
        sui::test_scenario::return_shared(registry);
        sui::test_scenario::return_shared(treasury);
    };

    scenario.next_tx(seller);
    {
        let mut root = scenario.take_shared_by_id<MakerRootV8<SUI>>(ids.root_id);
        let catalog = scenario.take_shared_by_id<ProductReleaseCatalogV8>(ids.catalog_id);
        let replacement = scenario.take_immutable_by_id<FreshTupleReplacementBindingV2>(ids.replacement_id);
        let protocol_config = scenario.take_shared_by_id<ProtocolConfigV8>(ids.protocol_config_id);
        let release_config = scenario.take_shared_by_id<ReleasePackageConfigV8>(
            ids.release_config_id,
        );
        let admin = scenario.take_from_sender_by_id<MakerAdminCapV8>(ids.admin_id);
        release::pause_maker_v8(
            &mut root,
            &admin,
            &protocol_config,
            &catalog,
            &replacement,
            &release_config,
            scenario.ctx(),
        );
        assert!(maker::root_lifecycle_v8(&root) == maker::lifecycle_paused_v8(), 99);
        scenario.return_to_sender(admin);
        sui::test_scenario::return_shared(root);
        sui::test_scenario::return_shared(catalog);
        sui::test_scenario::return_immutable(replacement);
        sui::test_scenario::return_shared(protocol_config);
        sui::test_scenario::return_shared(release_config);
    };

    let first_listing_id;
    scenario.next_tx(seller);
    {
        let root = scenario.take_shared_by_id<MakerRootV8<SUI>>(ids.root_id);
        let mut registry = scenario.take_shared_by_id<MarketRegistryV8<SUI>>(
            ids.market_registry_id,
        );
        let treasury = scenario.take_shared_by_id<MarketTreasuryV8<SUI>>(
            ids.market_treasury_id,
        );
        let maker_treasury = scenario.take_shared_by_id<MakerTreasuryV8<SUI>>(
            ids.maker_treasury_id,
        );
        let protocol_config = scenario.take_shared_by_id<ProtocolConfigV8>(
            ids.protocol_config_id,
        );
        let catalog = scenario.take_shared_by_id<ProductReleaseCatalogV8>(ids.catalog_id);
        let replacement = scenario.take_immutable_by_id<FreshTupleReplacementBindingV2>(ids.replacement_id);
        let market_config = scenario.take_shared_by_id<MarketPackageConfigV8>(
            ids.market_config_id,
        );
        let admin = scenario.take_from_sender_by_id<MakerAdminCapV8>(ids.admin_id);
        let paused_quote = market::quote_maker_resale_v8(
            &registry,
            &treasury,
            &root,
            10_000,
        );
        assert!(market::quote_protocol_atomic_v8(&paused_quote) == 250
            && market::quote_creator_atomic_v8(&paused_quote) == 500
            && market::quote_seller_atomic_v8(&paused_quote) == 9_250, 99);
        first_listing_id = market::list_maker_control_v8(
            &mut registry,
            &treasury,
            &root,
            admin,
            &maker_treasury,
            &protocol_config,
            &catalog,
            &replacement,
            &market_config,
            10_000,
            scenario.ctx(),
        );
        assert!(market::registry_listing_count_v8(&registry) == 1 && market::registry_escrow_count_v8(&registry) == 1, 99);
        sui::test_scenario::return_shared(root);
        sui::test_scenario::return_shared(registry);
        sui::test_scenario::return_shared(treasury);
        sui::test_scenario::return_shared(maker_treasury);
        sui::test_scenario::return_shared(protocol_config);
        sui::test_scenario::return_shared(catalog);
        sui::test_scenario::return_immutable(replacement);
        sui::test_scenario::return_shared(market_config);
    };

    scenario.next_tx(buyer);
    {
        let mut listing = scenario.take_shared_by_id<MakerListingV8<SUI>>(
            first_listing_id,
        );
        let mut root = scenario.take_shared_by_id<MakerRootV8<SUI>>(ids.root_id);
        let mut registry = scenario.take_shared_by_id<MarketRegistryV8<SUI>>(
            ids.market_registry_id,
        );
        let mut treasury = scenario.take_shared_by_id<MarketTreasuryV8<SUI>>(
            ids.market_treasury_id,
        );
        let protocol_config = scenario.take_shared_by_id<ProtocolConfigV8>(
            ids.protocol_config_id,
        );
        let mut protocol_treasury = scenario.take_shared_by_id<ProtocolTreasuryV8<SUI>>(
            ids.protocol_treasury_id,
        );
        let catalog = scenario.take_shared_by_id<ProductReleaseCatalogV8>(ids.catalog_id);
        let replacement = scenario.take_immutable_by_id<FreshTupleReplacementBindingV2>(ids.replacement_id);
        let market_config = scenario.take_shared_by_id<MarketPackageConfigV8>(
            ids.market_config_id,
        );
        let receiving = sui::test_scenario::receiving_ticket_by_id<MakerAdminCapV8>(
            ids.admin_id,
        );
        let payment = coin::mint_for_testing<SUI>(10_000, scenario.ctx());
        market::purchase_maker_control_v8(
            &mut listing,
            &mut registry,
            &mut treasury,
            &mut root,
            &protocol_config,
            &mut protocol_treasury,
            &catalog,
            &replacement,
            &market_config,
            receiving,
            payment,
            scenario.ctx(),
        );
        assert!(market::maker_listing_status_v8(&listing) == 1 && market::maker_listing_terminal_recipient_v8(&listing) == buyer, 99);
        assert!(maker::root_owner_v8(&root) == buyer
            && maker::root_control_epoch_v2(&root) == 1, 99);
        assert!(market::registry_listing_count_v8(&registry) == 1
            && market::registry_escrow_count_v8(&registry) == 0
            && market::registry_completed_sale_count_v8(&registry) == 1, 99);
        assert!(market::registry_gross_volume_atomic_v8(&registry) == 10_000
            && market::registry_protocol_paid_atomic_v8(&registry) == 250
            && market::registry_creator_paid_atomic_v8(&registry) == 500
            && market::registry_source_paid_atomic_v8(&registry) == 0
            && market::registry_seller_paid_atomic_v8(&registry) == 9_250, 99);
        assert!(market::treasury_balance_v8(&treasury) == 0
            && market::treasury_gross_escrowed_atomic_v8(&treasury) == 10_000
            && market::treasury_gross_released_atomic_v8(&treasury) == 10_000, 99);
        assert!(protocol::protocol_treasury_balance_for_testing(&protocol_treasury) == 250, 99);
        sui::test_scenario::return_shared(listing);
        sui::test_scenario::return_shared(root);
        sui::test_scenario::return_shared(registry);
        sui::test_scenario::return_shared(treasury);
        sui::test_scenario::return_shared(protocol_config);
        sui::test_scenario::return_shared(protocol_treasury);
        sui::test_scenario::return_shared(catalog);
        sui::test_scenario::return_immutable(replacement);
        sui::test_scenario::return_shared(market_config);
    };

    let next_admin_id;
    let cancel_listing_id;
    scenario.next_tx(buyer);
    {
        let root = scenario.take_shared_by_id<MakerRootV8<SUI>>(ids.root_id);
        let mut registry = scenario.take_shared_by_id<MarketRegistryV8<SUI>>(
            ids.market_registry_id,
        );
        let treasury = scenario.take_shared_by_id<MarketTreasuryV8<SUI>>(
            ids.market_treasury_id,
        );
        let maker_treasury = scenario.take_shared_by_id<MakerTreasuryV8<SUI>>(
            ids.maker_treasury_id,
        );
        let protocol_config = scenario.take_shared_by_id<ProtocolConfigV8>(
            ids.protocol_config_id,
        );
        let catalog = scenario.take_shared_by_id<ProductReleaseCatalogV8>(ids.catalog_id);
        let replacement = scenario.take_immutable_by_id<FreshTupleReplacementBindingV2>(ids.replacement_id);
        let market_config = scenario.take_shared_by_id<MarketPackageConfigV8>(
            ids.market_config_id,
        );
        let admin = scenario.take_from_sender<MakerAdminCapV8>();
        next_admin_id = object::id(&admin);
        cancel_listing_id = market::list_maker_control_v8(
            &mut registry,
            &treasury,
            &root,
            admin,
            &maker_treasury,
            &protocol_config,
            &catalog,
            &replacement,
            &market_config,
            20_000,
            scenario.ctx(),
        );
        sui::test_scenario::return_shared(root);
        sui::test_scenario::return_shared(registry);
        sui::test_scenario::return_shared(treasury);
        sui::test_scenario::return_shared(maker_treasury);
        sui::test_scenario::return_shared(protocol_config);
        sui::test_scenario::return_shared(catalog);
        sui::test_scenario::return_immutable(replacement);
        sui::test_scenario::return_shared(market_config);
    };

    scenario.next_tx(buyer);
    {
        let mut listing = scenario.take_shared_by_id<MakerListingV8<SUI>>(
            cancel_listing_id,
        );
        let mut root = scenario.take_shared_by_id<MakerRootV8<SUI>>(ids.root_id);
        let mut registry = scenario.take_shared_by_id<MarketRegistryV8<SUI>>(
            ids.market_registry_id,
        );
        let treasury = scenario.take_shared_by_id<MarketTreasuryV8<SUI>>(
            ids.market_treasury_id,
        );
        let catalog = scenario.take_shared_by_id<ProductReleaseCatalogV8>(ids.catalog_id);
        let replacement = scenario.take_immutable_by_id<FreshTupleReplacementBindingV2>(ids.replacement_id);
        let protocol_config = scenario.take_shared_by_id<ProtocolConfigV8>(ids.protocol_config_id);
        let market_config = scenario.take_shared_by_id<MarketPackageConfigV8>(
            ids.market_config_id,
        );
        let receiving = sui::test_scenario::receiving_ticket_by_id<MakerAdminCapV8>(
            next_admin_id,
        );
        market::cancel_maker_control_listing_v8(
            &mut listing,
            &mut registry,
            &treasury,
            &mut root,
            &protocol_config,
            &catalog,
            &replacement,
            &market_config,
            receiving,
            scenario.ctx(),
        );
        assert!(market::maker_listing_status_v8(&listing) == 2
            && maker::root_control_epoch_v2(&root) == 1, 99);
        assert!(market::registry_canceled_sale_count_v8(&registry) == 1 && market::registry_escrow_count_v8(&registry) == 0, 99);
        sui::test_scenario::return_shared(listing);
        sui::test_scenario::return_shared(root);
        sui::test_scenario::return_shared(registry);
        sui::test_scenario::return_shared(treasury);
        sui::test_scenario::return_shared(catalog);
        sui::test_scenario::return_immutable(replacement);
        sui::test_scenario::return_shared(protocol_config);
        sui::test_scenario::return_shared(market_config);
    };

    let recover_listing_id;
    scenario.next_tx(buyer);
    {
        let root = scenario.take_shared_by_id<MakerRootV8<SUI>>(ids.root_id);
        let mut registry = scenario.take_shared_by_id<MarketRegistryV8<SUI>>(
            ids.market_registry_id,
        );
        let treasury = scenario.take_shared_by_id<MarketTreasuryV8<SUI>>(
            ids.market_treasury_id,
        );
        let maker_treasury = scenario.take_shared_by_id<MakerTreasuryV8<SUI>>(
            ids.maker_treasury_id,
        );
        let protocol_config = scenario.take_shared_by_id<ProtocolConfigV8>(
            ids.protocol_config_id,
        );
        let catalog = scenario.take_shared_by_id<ProductReleaseCatalogV8>(ids.catalog_id);
        let replacement = scenario.take_immutable_by_id<FreshTupleReplacementBindingV2>(ids.replacement_id);
        let market_config = scenario.take_shared_by_id<MarketPackageConfigV8>(
            ids.market_config_id,
        );
        let admin = scenario.take_from_sender_by_id<MakerAdminCapV8>(next_admin_id);
        recover_listing_id = market::list_maker_control_v8(
            &mut registry,
            &treasury,
            &root,
            admin,
            &maker_treasury,
            &protocol_config,
            &catalog,
            &replacement,
            &market_config,
            30_000,
            scenario.ctx(),
        );
        sui::test_scenario::return_shared(root);
        sui::test_scenario::return_shared(registry);
        sui::test_scenario::return_shared(treasury);
        sui::test_scenario::return_shared(maker_treasury);
        sui::test_scenario::return_shared(protocol_config);
        sui::test_scenario::return_shared(catalog);
        sui::test_scenario::return_immutable(replacement);
        sui::test_scenario::return_shared(market_config);
    };

    scenario.next_tx(seller);
    {
        let mut protocol_config = scenario.take_shared_by_id<ProtocolConfigV8>(
            ids.protocol_config_id,
        );
        let protocol_admin = scenario.take_from_sender_by_id<ProtocolAdminCapV8>(
            ids.protocol_admin_id,
        );
        protocol::set_protocol_enabled_v8(&mut protocol_config, &protocol_admin, false);
        scenario.return_to_sender(protocol_admin);
        sui::test_scenario::return_shared(protocol_config);
    };

    scenario.next_tx(recoverer);
    {
        let mut listing = scenario.take_shared_by_id<MakerListingV8<SUI>>(
            recover_listing_id,
        );
        let mut root = scenario.take_shared_by_id<MakerRootV8<SUI>>(ids.root_id);
        let mut registry = scenario.take_shared_by_id<MarketRegistryV8<SUI>>(
            ids.market_registry_id,
        );
        let treasury = scenario.take_shared_by_id<MarketTreasuryV8<SUI>>(
            ids.market_treasury_id,
        );
        let protocol_config = scenario.take_shared_by_id<ProtocolConfigV8>(
            ids.protocol_config_id,
        );
        let catalog = scenario.take_shared_by_id<ProductReleaseCatalogV8>(ids.catalog_id);
        let replacement = scenario.take_immutable_by_id<FreshTupleReplacementBindingV2>(ids.replacement_id);
        let market_config = scenario.take_shared_by_id<MarketPackageConfigV8>(
            ids.market_config_id,
        );
        let receiving = sui::test_scenario::receiving_ticket_by_id<MakerAdminCapV8>(
            next_admin_id,
        );
        market::recover_maker_control_listing_v8(
            &mut listing,
            &mut registry,
            &treasury,
            &mut root,
            &protocol_config,
            &catalog,
            &replacement,
            &market_config,
            receiving,
            scenario.ctx(),
        );
        assert!(market::maker_listing_status_v8(&listing) == 3
            && market::maker_listing_terminal_recipient_v8(&listing) == buyer, 99);
        assert!(maker::root_control_epoch_v2(&root) == 1
            && maker::root_owner_v8(&root) == buyer, 99);
        assert!(market::registry_listing_count_v8(&registry) == 3
            && market::registry_escrow_count_v8(&registry) == 0
            && market::registry_completed_sale_count_v8(&registry) == 1
            && market::registry_canceled_sale_count_v8(&registry) == 1
            && market::registry_recovered_sale_count_v8(&registry) == 1, 99);
        sui::test_scenario::return_shared(listing);
        sui::test_scenario::return_shared(root);
        sui::test_scenario::return_shared(registry);
        sui::test_scenario::return_shared(treasury);
        sui::test_scenario::return_shared(protocol_config);
        sui::test_scenario::return_shared(catalog);
        sui::test_scenario::return_immutable(replacement);
        sui::test_scenario::return_shared(market_config);
    };

    scenario.next_tx(buyer);
    {
        let admin = scenario.take_from_sender_by_id<MakerAdminCapV8>(next_admin_id);
        let root = scenario.take_shared_by_id<MakerRootV8<SUI>>(ids.root_id);
        maker::assert_admin_v8(&root, &admin);
        assert!(maker::root_owner_v8(&root) == buyer
            && maker::root_control_epoch_v2(&root) == 1, 99);
        sui::test_scenario::return_shared(root);
        scenario.return_to_sender(admin);
    };
    std::unit_test::destroy(system);
    scenario.end();
}

#[test]
fun maker_and_soul_quotes_use_frozen_fee_and_rights_terms() {
    let mut scenario = ts::begin(@0xA11);
    let (ids, system, living) = draft(&mut scenario);
    std::unit_test::destroy(living);
    let root = scenario.take_shared_by_id<MakerRootV8<SUI>>(ids.root_id);
    let registry = scenario.take_shared_by_id<MarketRegistryV8<SUI>>(ids.market_registry_id);
    let treasury = scenario.take_shared_by_id<MarketTreasuryV8<SUI>>(ids.market_treasury_id);
    market::assert_quotes_for_testing(&root);
    ts::return_shared(root); ts::return_shared(registry); ts::return_shared(treasury);
    std::unit_test::destroy(system);
    scenario.end();
    
}

#[test, expected_failure(abort_code = 3, location = animacraft_v8_market::market_v8)]
fun any_pre_activation_listing_state_is_rejected() {
    let mut scenario = ts::begin(@0xA11);
    let (ids, system, living) = draft(&mut scenario);
    std::unit_test::destroy(living);
    let root = scenario.take_shared_by_id<MakerRootV8<SUI>>(ids.root_id);
    let mut registry = scenario.take_shared_by_id<MarketRegistryV8<SUI>>(ids.market_registry_id);
    let treasury = scenario.take_shared_by_id<MarketTreasuryV8<SUI>>(ids.market_treasury_id);
    market::assert_nonzero_listing_rejected_for_testing(&mut registry, &treasury);
    ts::return_shared(root); ts::return_shared(registry); ts::return_shared(treasury);
    std::unit_test::destroy(system);
    scenario.end();
    abort 99 // A missing contract rejection must fail this negative test.
}

#[test, expected_failure(abort_code = 4, location = animacraft_v8_market::market_v8)]
fun zero_price_quote_is_rejected() {
    let mut scenario = ts::begin(@0xA11);
    let (ids, system, living) = draft(&mut scenario);
    std::unit_test::destroy(living);
    let root = scenario.take_shared_by_id<MakerRootV8<SUI>>(ids.root_id);
    let registry = scenario.take_shared_by_id<MarketRegistryV8<SUI>>(ids.market_registry_id);
    let treasury = scenario.take_shared_by_id<MarketTreasuryV8<SUI>>(ids.market_treasury_id);
    market::assert_zero_price_rejected_for_testing(&root);
    ts::return_shared(root); ts::return_shared(registry); ts::return_shared(treasury);
    std::unit_test::destroy(system);
    scenario.end();
    abort 99 // A missing contract rejection must fail this negative test.
}

#[test, expected_failure(abort_code = 5, location = animacraft_v8_market::market_v8)]
fun nonzero_fee_cannot_round_to_zero() {
    let mut scenario = ts::begin(@0xA11);
    let (ids, system, living) = draft(&mut scenario);
    std::unit_test::destroy(living);
    let root = scenario.take_shared_by_id<MakerRootV8<SUI>>(ids.root_id);
    let registry = scenario.take_shared_by_id<MarketRegistryV8<SUI>>(ids.market_registry_id);
    let treasury = scenario.take_shared_by_id<MarketTreasuryV8<SUI>>(ids.market_treasury_id);
    market::assert_round_to_zero_rejected_for_testing(&root);
    ts::return_shared(root); ts::return_shared(registry); ts::return_shared(treasury);
    std::unit_test::destroy(system);
    scenario.end();
    abort 99 // A missing contract rejection must fail this negative test.
}

#[test, expected_failure(abort_code = 7, location = animacraft_v8_market::market_v8)]
fun zero_purchase_payment_is_rejected() {
    let mut scenario = ts::begin(@0xA11);
    let (ids, system, living) = draft(&mut scenario);
    std::unit_test::destroy(living);
    let root = scenario.take_shared_by_id<MakerRootV8<SUI>>(ids.root_id);
    let registry = scenario.take_shared_by_id<MarketRegistryV8<SUI>>(ids.market_registry_id);
    let mut treasury = scenario.take_shared_by_id<MarketTreasuryV8<SUI>>(ids.market_treasury_id);
    market::escrow_payment_for_testing(&mut treasury, coin::mint_for_testing<SUI>(0, scenario.ctx()));
    ts::return_shared(root); ts::return_shared(registry); ts::return_shared(treasury);
    std::unit_test::destroy(system);
    scenario.end();
    abort 99 // A missing contract rejection must fail this negative test.
}

#[test, expected_failure(abort_code = 7, location = animacraft_v8_market::market_v8)]
fun underpayment_is_rejected() {
    let mut scenario = ts::begin(@0xA11);
    let (ids, system, living) = draft(&mut scenario);
    std::unit_test::destroy(living);
    let root = scenario.take_shared_by_id<MakerRootV8<SUI>>(ids.root_id);
    let registry = scenario.take_shared_by_id<MarketRegistryV8<SUI>>(ids.market_registry_id);
    let mut treasury = scenario.take_shared_by_id<MarketTreasuryV8<SUI>>(ids.market_treasury_id);
    market::escrow_payment_for_testing(&mut treasury, coin::mint_for_testing<SUI>(9999, scenario.ctx()));
    ts::return_shared(root); ts::return_shared(registry); ts::return_shared(treasury);
    std::unit_test::destroy(system);
    scenario.end();
    abort 99 // A missing contract rejection must fail this negative test.
}

#[test, expected_failure(abort_code = 7, location = animacraft_v8_market::market_v8)]
fun overpayment_is_rejected() {
    let mut scenario = ts::begin(@0xA11);
    let (ids, system, living) = draft(&mut scenario);
    std::unit_test::destroy(living);
    let root = scenario.take_shared_by_id<MakerRootV8<SUI>>(ids.root_id);
    let registry = scenario.take_shared_by_id<MarketRegistryV8<SUI>>(ids.market_registry_id);
    let mut treasury = scenario.take_shared_by_id<MarketTreasuryV8<SUI>>(ids.market_treasury_id);
    market::escrow_payment_for_testing(&mut treasury, coin::mint_for_testing<SUI>(10001, scenario.ctx()));
    ts::return_shared(root); ts::return_shared(registry); ts::return_shared(treasury);
    std::unit_test::destroy(system);
    scenario.end();
    abort 99 // A missing contract rejection must fail this negative test.
}

// A real second Maker treasury has valid internal fields, so the earlier Core
// root-identity assertion rejects it before Market's local companion checks.
#[test, expected_failure(abort_code = 15, location = animacraft_v8_core::maker_v8)]
fun cross_root_market_treasury_is_rejected() {
    let mut scenario = ts::begin(@0xA11);
    let (ids, mut system, living) = draft(&mut scenario);
    std::unit_test::destroy(living);
    let (other, other_living) = active::new_draft_maker_for_testing(&mut scenario,
        ids.protocol_config_id, ids.setup, &mut system);
    std::unit_test::destroy(other_living);
    let (_, _, _, _, _, _, _, _, other_treasury_id) = active::draft_companion_ids_for_testing(other);
    let root = scenario.take_shared_by_id<MakerRootV8<SUI>>(ids.root_id);
    let registry = scenario.take_shared_by_id<MarketRegistryV8<SUI>>(ids.market_registry_id);
    let treasury = scenario.take_shared_by_id<MarketTreasuryV8<SUI>>(other_treasury_id);
    let config = scenario.take_shared_by_id<MarketPackageConfigV8>(ids.market_config_id);
    market::assert_market_identity_for_testing(&registry, &treasury, &root, &config);
    abort 99
}


#[test]
fun zero_market_state_seals_and_certifies_readiness() {
    let mut scenario = ts::begin(@0xA11);
    let (ids, system, living) = draft(&mut scenario);
    let root = scenario.take_shared_by_id<MakerRootV8<SUI>>(ids.root_id);
    let admin = scenario.take_from_sender_by_id<MakerAdminCapV8>(ids.admin_id);
    let protocol = scenario.take_shared_by_id<ProtocolConfigV8>(ids.protocol_config_id);
    let catalog = scenario.take_shared_by_id<ProductReleaseCatalogV8>(ids.catalog_id);
    let replacement = scenario.take_immutable_by_id<FreshTupleReplacementBindingV2>(ids.replacement_id);
    let config = scenario.take_shared_by_id<MarketPackageConfigV8>(ids.market_config_id);
    let mut registry = scenario.take_shared_by_id<MarketRegistryV8<SUI>>(ids.market_registry_id);
    let treasury = scenario.take_shared_by_id<MarketTreasuryV8<SUI>>(ids.market_treasury_id);
    assert!(!market::registry_sealed_v8(&registry), 99);
    market::assert_market_identity_for_testing(&registry, &treasury, &root, &config);
    market::seal_market_registry_v8(&mut registry, &treasury, &root, &admin,
        &protocol, &catalog, &replacement, &config);
    let commitment = market::validate_market_activation_readiness_v2(&registry,
        &treasury, &root, &protocol, &catalog, &replacement, &config);
    assert!(commitment.length() == 32 && market::registry_listing_count_v8(&registry) == 0
        && market::registry_escrow_count_v8(&registry) == 0 && market::treasury_balance_v8(&treasury) == 0, 99);
    ts::return_shared(root); scenario.return_to_sender(admin);
    ts::return_shared(protocol); ts::return_shared(catalog); ts::return_immutable(replacement);
    ts::return_shared(config); ts::return_shared(registry); ts::return_shared(treasury);
    scenario.next_tx(@0xA11);
    let _ = active::activate_maker_for_testing(&mut scenario, ids.protocol_config_id,
        ids.setup, ids.objects, &system, living);
    std::unit_test::destroy(system);
    scenario.end();
}

// This rejects the actual new companion validator, not a retired readiness ticket.
#[test, expected_failure(abort_code = 3, location = animacraft_v8_market::market_v8)]
fun readiness_rejects_unsealed_registry() {
    let mut scenario = ts::begin(@0xA11);
    let (ids, system, living) = draft(&mut scenario);
    let root = scenario.take_shared_by_id<MakerRootV8<SUI>>(ids.root_id);
    let admin = scenario.take_from_sender_by_id<MakerAdminCapV8>(ids.admin_id);
    let protocol = scenario.take_shared_by_id<ProtocolConfigV8>(ids.protocol_config_id);
    let catalog = scenario.take_shared_by_id<ProductReleaseCatalogV8>(ids.catalog_id);
    let replacement = scenario.take_immutable_by_id<FreshTupleReplacementBindingV2>(ids.replacement_id);
    let config = scenario.take_shared_by_id<MarketPackageConfigV8>(ids.market_config_id);
    let registry = scenario.take_shared_by_id<MarketRegistryV8<SUI>>(ids.market_registry_id);
    let treasury = scenario.take_shared_by_id<MarketTreasuryV8<SUI>>(ids.market_treasury_id);
    assert!(!market::registry_sealed_v8(&registry), 99);
    market::assert_market_identity_for_testing(&registry, &treasury, &root, &config);
    
    let commitment = market::validate_market_activation_readiness_v2(&registry,
        &treasury, &root, &protocol, &catalog, &replacement, &config);
    assert!(commitment.length() == 32 && market::registry_listing_count_v8(&registry) == 0
        && market::registry_escrow_count_v8(&registry) == 0 && market::treasury_balance_v8(&treasury) == 0, 99);
    ts::return_shared(root); scenario.return_to_sender(admin);
    ts::return_shared(protocol); ts::return_shared(catalog); ts::return_immutable(replacement);
    ts::return_shared(config); ts::return_shared(registry); ts::return_shared(treasury);
    std::unit_test::destroy(living);
    std::unit_test::destroy(system);
    scenario.end();
    abort 99
}

// These replace the two retired movable Output/Receipt/Soul bundle scenarios.
// Complete, Receipt and native Binding stay immutable throughout Soul trading.
#[test]
fun soul_bundle_listing_purchase_is_indivisible_and_exact() { native_settlement(false); }

#[test]
fun soul_cancel_and_disabled_recovery_never_mutate_ownership() { native_settlement(true); }

// Exact current SoulListing BCS: no private-field constructor or authority.
// Inactive means both the real PurchaseCap consumed and is_active false.
fun assert_inactive_native_listing(listing: &SoulListing, soul_id: ID, state_id: ID,
    seller: address, kiosk_id: ID, price: u64) {
    let mut expected = std::bcs::to_bytes(&object::id(listing));
    expected.append(std::bcs::to_bytes(&8u64));
    expected.append(std::bcs::to_bytes(&soul_id));
    expected.append(std::bcs::to_bytes(&state_id));
    expected.append(std::bcs::to_bytes(&seller));
    expected.append(std::bcs::to_bytes(&kiosk_id));
    expected.append(std::bcs::to_bytes(&price));
    expected.append(std::bcs::to_bytes(&seller));
    expected.append(std::bcs::to_bytes(&250u16));
    expected.append(vector[0, 0, 0]); // collection None, purchase_cap None, inactive
    assert!(std::bcs::to_bytes(listing) == expected, 99);
}

fun native_settlement(cancel: bool) {
    let author = @0xA11;
    let seller = @0xB0B;
    let buyer = @0xC0C;
    let grantee = @0xD0D;
    let mut scenario = ts::begin(author);
    let (ids, mut system) = start(&mut scenario, false);
    let market_ids = completion::initialize_market_for_testing(&mut scenario);
    let (config_id, admin_id, registry_id, _, policy_id) = completion::market_ids(market_ids);
    scenario.next_tx(seller);
    let completed = completion::mint_for_testing(&mut scenario, ids.protocol_config_id,
        ids.setup, ids.objects, market_ids, &mut system);
    let (soul_id, state_id, binding_id, output_id, receipt_id) = completion::native_ids(completed);
    let (seller_kiosk_id, seller_cap_id, _, _, _) = completion::holder_ids(completed);

    let binding = scenario.take_immutable_by_id<NativeSoulBindingV8>(binding_id);
    let complete = scenario.take_immutable_by_id<output::CompleteOutputV8>(output_id);
    let receipt = scenario.take_immutable_by_id<output::CompleteReceiptV8>(receipt_id);
    let binding_before = std::bcs::to_bytes(&binding);
    let output_before = std::bcs::to_bytes(&complete);
    let receipt_before = std::bcs::to_bytes(&receipt);
    assert!(output::native_soul_binding_maker_creator_v8(&binding) == author
        && output::native_soul_binding_original_holder_v8(&binding) == seller, 99);
    ts::return_immutable(binding); ts::return_immutable(complete); ts::return_immutable(receipt);
    // Real grant collateral must be invalidated by sale, but not cancellation.
    let mut state = scenario.take_shared_by_id<SoulState>(state_id);
    let clock = sui::clock::create_for_testing(scenario.ctx());
    let issued_grant = grant::issue(&mut state, grantee, grant::scope_seal(), option::none(), &clock, scenario.ctx());
    transfer::public_transfer(issued_grant, grantee);
    clock.destroy_for_testing();
    ts::return_shared(state);

    scenario.next_tx(buyer);
    let config = scenario.take_shared_by_id<MarketConfigV2>(config_id);
    let mut registry = scenario.take_shared_by_id<KioskRegistry>(registry_id);
    let buyer_kiosk_id = soul_market::init_personal_kiosk_v2(&config, &mut registry, scenario.ctx());
    ts::return_shared(config); ts::return_shared(registry);

    scenario.next_tx(seller);
    let config = scenario.take_shared_by_id<MarketConfigV2>(config_id);
    let registry = scenario.take_shared_by_id<KioskRegistry>(registry_id);
    let binding = scenario.take_immutable_by_id<NativeSoulBindingV8>(binding_id);
    let mut state = scenario.take_shared_by_id<SoulState>(state_id);
    let mut seller_kiosk = scenario.take_shared_by_id<Kiosk>(seller_kiosk_id);
    let seller_cap = scenario.take_from_sender_by_id<PersonalKioskCap>(seller_cap_id);
    let listing = soul_market::list_animacraft_v8_soul_fixed_price(&config, &registry,
        &binding, &mut seller_kiosk, &seller_cap, &mut state, 10_000, scenario.ctx());
    let mut listing_id = object::id(&listing);
    assert!(soul_market::soul_listing_version(&listing) == 8 && soul::is_listed(&state)
        && soul::ownership_epoch(&state) == 0 && soul::active_grant_count(&state) == 1, 99);
    let (seller_amount, protocol_amount, creator_amount, source_amount) =
        soul_market::quote_animacraft_v8_soul_sale(&state, &binding, 10_000);
    assert!(seller_amount == 9_250 && protocol_amount == 250
        && creator_amount == 250 && source_amount == 250, 99);
    soul_market::finalize_soul_listing(listing);
    ts::return_shared(config); ts::return_shared(registry); ts::return_immutable(binding);
    ts::return_shared(state); ts::return_shared(seller_kiosk); scenario.return_to_sender(seller_cap);

    if (cancel) {
        // Normal cancel consumes the first real capability. The same Soul is
        // then relisted with a different listing/cap before the stop boundary.
        scenario.next_tx(seller);
        let mut state = scenario.take_shared_by_id<SoulState>(state_id);
        let mut first = scenario.take_shared_by_id<SoulListing>(listing_id);
        let mut held = scenario.take_shared_by_id<Kiosk>(seller_kiosk_id);
        let cap = scenario.take_from_sender_by_id<PersonalKioskCap>(seller_cap_id);
        soul_market::cancel_animacraft_v8_soul_listing(&mut held, &cap, &mut state, &mut first);
        assert_inactive_native_listing(&first, soul_id, state_id, seller, seller_kiosk_id, 10_000);
        assert!(!soul::is_listed(&state) && soul::current_owner(&state) == seller
            && soul::current_kiosk_id(&state) == seller_kiosk_id
            && soul::ownership_epoch(&state) == 0 && soul::active_grant_count(&state) == 1, 99);
        ts::return_shared(first); ts::return_shared(state); ts::return_shared(held);
        scenario.return_to_sender(cap);
        scenario.next_tx(seller);
        let config = scenario.take_shared_by_id<MarketConfigV2>(config_id);
        let registry = scenario.take_shared_by_id<KioskRegistry>(registry_id);
        let binding = scenario.take_immutable_by_id<NativeSoulBindingV8>(binding_id);
        let complete = scenario.take_immutable_by_id<output::CompleteOutputV8>(output_id);
        let receipt = scenario.take_immutable_by_id<output::CompleteReceiptV8>(receipt_id);
        assert!(std::bcs::to_bytes(&binding) == binding_before
            && std::bcs::to_bytes(&complete) == output_before
            && std::bcs::to_bytes(&receipt) == receipt_before, 99);
        let mut state = scenario.take_shared_by_id<SoulState>(state_id);
        let mut held = scenario.take_shared_by_id<Kiosk>(seller_kiosk_id);
        let cap = scenario.take_from_sender_by_id<PersonalKioskCap>(seller_cap_id);
        let second = soul_market::list_animacraft_v8_soul_fixed_price(&config, &registry,
            &binding, &mut held, &cap, &mut state, 20_000, scenario.ctx());
        assert!(object::id(&second) != listing_id && soul::is_listed(&state)
            && soul::current_owner(&state) == seller && soul::ownership_epoch(&state) == 0
            && soul::active_grant_count(&state) == 1, 99);
        listing_id = object::id(&second);
        soul_market::finalize_soul_listing(second);
        ts::return_shared(config); ts::return_shared(registry); ts::return_immutable(binding);
        ts::return_immutable(complete); ts::return_immutable(receipt);
        ts::return_shared(state); ts::return_shared(held); scenario.return_to_sender(cap);
        // No legacy third-party recovery authority is recreated. The actual
        // seller cancels with their existing cap despite both markets stopping.
        scenario.next_tx(author);
        let mut config = scenario.take_shared_by_id<MarketConfigV2>(config_id);
        let admin = scenario.take_from_sender_by_id<MarketAdminCapV2>(admin_id);
        soul_market::update_config_v2_secondary_enabled(&mut config, &admin, false);
        ts::return_shared(config); scenario.return_to_sender(admin);
        let mut protocol = scenario.take_shared_by_id<ProtocolConfigV8>(ids.protocol_config_id);
        let admin = scenario.take_from_sender_by_id<ProtocolAdminCapV8>(ids.protocol_admin_id);
        protocol::set_protocol_enabled_v8(&mut protocol, &admin, false);
        ts::return_shared(protocol); scenario.return_to_sender(admin);
    };
    scenario.next_tx(if (cancel) seller else buyer);
    let mut state = scenario.take_shared_by_id<SoulState>(state_id);
    let mut listing = scenario.take_shared_by_id<SoulListing>(listing_id);
    let mut seller_kiosk = scenario.take_shared_by_id<Kiosk>(seller_kiosk_id);
    if (cancel) {
        let seller_cap = scenario.take_from_sender_by_id<PersonalKioskCap>(seller_cap_id);
        soul_market::cancel_animacraft_v8_soul_listing(&mut seller_kiosk, &seller_cap, &mut state, &mut listing);
        assert_inactive_native_listing(&listing, soul_id, state_id, seller, seller_kiosk_id, 20_000);
        assert!(!soul::is_listed(&state) && soul::current_owner(&state) == seller
            && soul::current_kiosk_id(&state) == seller_kiosk_id
            && soul::ownership_epoch(&state) == 0 && soul::active_grant_count(&state) == 1, 99);
        let _held = kiosk::borrow<Soul>(&seller_kiosk, personal::borrow(&seller_cap), soul_id);
        scenario.return_to_sender(seller_cap);
    } else {
        let config = scenario.take_shared_by_id<MarketConfigV2>(config_id);
        let registry = scenario.take_shared_by_id<KioskRegistry>(registry_id);
        let policy = scenario.take_shared_by_id<TransferPolicy<Soul>>(policy_id);
        let binding = scenario.take_immutable_by_id<NativeSoulBindingV8>(binding_id);
        let mut buyer_kiosk = scenario.take_shared_by_id<Kiosk>(buyer_kiosk_id);
        let buyer_cap = scenario.take_from_sender<PersonalKioskCap>();
        soul_market::buy_animacraft_v8_soul_fixed_price(&config, &registry, &policy, &binding,
            &mut seller_kiosk, &mut buyer_kiosk, &buyer_cap, &mut state, &mut listing,
            coin::mint_for_testing<USDC>(10_000, scenario.ctx()), scenario.ctx());
        assert!(!soul::is_listed(&state) && soul::current_owner(&state) == buyer
            && soul::current_kiosk_id(&state) == buyer_kiosk_id
            && soul::ownership_epoch(&state) == 1 && soul::active_grant_count(&state) == 0
            && !soul::active_grant_contains_grantee_for_testing(&state, grantee), 99);
        let _held = kiosk::borrow<Soul>(&buyer_kiosk, personal::borrow(&buyer_cap), soul_id);
        ts::return_shared(config); ts::return_shared(registry); ts::return_shared(policy);
        ts::return_immutable(binding); ts::return_shared(buyer_kiosk); scenario.return_to_sender(buyer_cap);
    };
    assert!(soul::animacraft_native_v8_binding_id(&state) == binding_id
        && !soul::has_animacraft_native_equipment_v8(&state), 99);
    ts::return_shared(state); ts::return_shared(listing); ts::return_shared(seller_kiosk);
    scenario.next_tx(author);
    if (!cancel) {
        let protocol_coin = scenario.take_from_sender<Coin<USDC>>();
        let source_coin = scenario.take_from_sender<Coin<USDC>>();
        assert!(protocol_coin.value() == 250 && source_coin.value() == 250, 99);
        protocol_coin.burn_for_testing(); source_coin.burn_for_testing();
        let seller_coin = scenario.take_from_address<Coin<USDC>>(seller);
        let creator_coin = scenario.take_from_address<Coin<USDC>>(seller);
        assert!(seller_coin.value() + creator_coin.value() == 9_500
            && (seller_coin.value() == 250 || creator_coin.value() == 250), 99);
        seller_coin.burn_for_testing(); creator_coin.burn_for_testing();
    };
    let binding = scenario.take_immutable_by_id<NativeSoulBindingV8>(binding_id);
    let complete = scenario.take_immutable_by_id<output::CompleteOutputV8>(output_id);
    let receipt = scenario.take_immutable_by_id<output::CompleteReceiptV8>(receipt_id);
    assert!(std::bcs::to_bytes(&binding) == binding_before
        && std::bcs::to_bytes(&complete) == output_before
        && std::bcs::to_bytes(&receipt) == receipt_before, 99);
    ts::return_immutable(binding); ts::return_immutable(complete); ts::return_immutable(receipt);
    std::unit_test::destroy(system);
    scenario.end();
}
