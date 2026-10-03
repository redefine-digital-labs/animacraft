/// Physical integration cases use actual upper-package bootstrap and author DRAFT.
/// All private-row assertions remain in Physical's narrow test-only helpers.
#[test_only]
module native_soul_v8_graph::physical_integration;

use native_soul_v8_graph::{bootstrap, active_maker};
use animacraft_v8_core::maker_v8::{MakerRootV8, MakerAdminCapV8};
use animacraft_v8_core::base_registry_v8::BaseDefinitionRegistryV8;
use animacraft_v8_core::package_binding_v8::ProductReleaseCatalogV8;
use animacraft_v8_core::package_binding_v8::FreshTupleReplacementBindingV2;
use animacraft_v8_core::protocol_config_v8::ProtocolConfigV8;
use animacraft_v8_core::treasury_v8::MakerTreasuryV8;
use animacraft_v8_physical::physical_v8::PhysicalRegistryV8;
use animacraft_v8_market::market_v8::{Self as market,
    MarketPackageConfigV8, MarketRegistryV8, MarketTreasuryV8};
use animacraft_v8_physical::physical_v8::{Self as physical, PhysicalPackageConfigV8};
use sui::sui::SUI;
use sui::test_scenario as scenario;

fun run_draft_registry_case(case: u8) {
    let mut scenario = scenario::begin(@0xA11);
    let (protocol_id, setup, mut system) = bootstrap::initialize_for_testing(&mut scenario);
    let (ids, _living) = active_maker::new_draft_maker_for_testing(
        &mut scenario, protocol_id, setup, &mut system);
    let (root_id, base_id, _treasury_id, admin_id) = active_maker::draft_maker_ids_for_testing(ids);
    let (catalog_id, _, _, _, config_id, _, _) = bootstrap::configuration_ids_for_testing(setup);
    let root = scenario.take_shared_by_id<MakerRootV8<SUI>>(root_id);
    let base = scenario.take_shared_by_id<BaseDefinitionRegistryV8>(base_id);
    let admin = scenario.take_from_sender_by_id<MakerAdminCapV8>(admin_id);
    let catalog = scenario.take_shared_by_id<ProductReleaseCatalogV8>(catalog_id);
    let config = scenario.take_shared_by_id<PhysicalPackageConfigV8>(config_id);
    if (case == 0) {
        physical::zero_policy_registry_seals_and_is_ready_for_testing(
            &root, &admin, &base, &catalog, &config, scenario.ctx());
    }
    else if (case == 1) {
        physical::zero_policy_registry_rejects_nonempty_commitment_for_testing(
            &root, &admin, &base, &catalog, &config, scenario.ctx());
    }
    else if (case == 2) {
        physical::readiness_rejects_unsealed_registry_for_testing(
            &root, &admin, &base, &catalog, &config, scenario.ctx());
    }
    else if (case == 3) {
        physical::base_policy_is_derived_from_exact_live_style_for_testing(
            &root, &admin, &base, &catalog, &config, scenario.ctx());
    }
    else if (case == 4) {
        physical::seal_rejects_missing_expected_row_for_testing(
            &root, &admin, &base, &catalog, &config, scenario.ctx());
    }
    else if (case == 5) {
        physical::append_rejects_wrong_row_commitment_for_testing(
            &root, &admin, &base, &catalog, &config, scenario.ctx());
    }
    else if (case == 6) {
        physical::append_rejects_out_of_order_sequence_for_testing(
            &root, &admin, &base, &catalog, &config, scenario.ctx());
    }
    else if (case == 7) {
        physical::duplicate_base_style_policy_is_rejected_for_testing(
            &root, &admin, &base, &catalog, &config, scenario.ctx());
    }
    else if (case == 8) {
        physical::readiness_rejects_nonzero_future_runtime_lane_for_testing(
            &root, &admin, &base, &catalog, &config, scenario.ctx());
    } else { abort 255 };
    scenario::return_shared(root);
    scenario::return_shared(base);
    scenario.return_to_sender(admin);
    scenario::return_shared(catalog);
    scenario::return_shared(config);
    std::unit_test::destroy(system);
    scenario.end();
}

#[test]
fun zero_policy_registry_seals_and_is_ready() { run_draft_registry_case(0); }

#[test, expected_failure(abort_code = 2, location = animacraft_v8_physical::physical_v8)]
fun zero_policy_registry_rejects_nonempty_commitment() { run_draft_registry_case(1); }

#[test, expected_failure(abort_code = 8, location = animacraft_v8_physical::physical_v8)]
fun readiness_rejects_unsealed_registry() { run_draft_registry_case(2); }

#[test]
fun base_policy_is_derived_from_exact_live_style() { run_draft_registry_case(3); }

#[test, expected_failure(abort_code = 3, location = animacraft_v8_physical::physical_v8)]
fun seal_rejects_missing_expected_row() { run_draft_registry_case(4); }

#[test, expected_failure(abort_code = 2, location = animacraft_v8_physical::physical_v8)]
fun append_rejects_wrong_row_commitment() { run_draft_registry_case(5); }

#[test, expected_failure(abort_code = 4, location = animacraft_v8_physical::physical_v8)]
fun append_rejects_out_of_order_sequence() { run_draft_registry_case(6); }

#[test, expected_failure(abort_code = 6, location = animacraft_v8_physical::physical_v8)]
fun duplicate_base_style_policy_is_rejected() { run_draft_registry_case(7); }

#[test, expected_failure(abort_code = 9, location = animacraft_v8_physical::physical_v8)]
fun readiness_rejects_nonzero_future_runtime_lane() { run_draft_registry_case(8); }

/// Real initialized authority and exact stored objects; issuance is the
/// explicitly internal asset fixture because this matrix tests custody only.
fun run_custody_matrix_case(case: u8) {
    let mut scenario = scenario::begin(@0xA11);
    let (protocol_id, setup, mut system) = bootstrap::initialize_for_testing(&mut scenario);
    let ids = active_maker::new_active_with_physical_for_testing(
        &mut scenario, protocol_id, setup, &mut system,
        physical::issue_free_claim_v8(), physical::proof_none_v8(), 0, 4, true);
    let (root_id, _, treasury_id, _) = active_maker::maker_ids_for_testing(ids);
    let (_, _, _, _, _, _, registry_id, market_registry_id, market_treasury_id) =
        active_maker::companion_ids_for_testing(ids);
    let (catalog_id, _, _, _, physical_config_id, market_config_id, _) =
        bootstrap::configuration_ids_for_testing(setup);
    let (replacement_id, _, _) = bootstrap::authority_ids_for_testing(&scenario, setup);
    let root = scenario.take_shared_by_id<MakerRootV8<SUI>>(root_id);
    let protocol = scenario.take_shared_by_id<ProtocolConfigV8>(protocol_id);
    let catalog = scenario.take_shared_by_id<ProductReleaseCatalogV8>(catalog_id);
    let replacement = scenario.take_immutable_by_id<FreshTupleReplacementBindingV2>(replacement_id);
    let config = scenario.take_shared_by_id<PhysicalPackageConfigV8>(physical_config_id);
    let mut registry = scenario.take_shared_by_id<PhysicalRegistryV8>(registry_id);
    let treasury = scenario.take_shared_by_id<MakerTreasuryV8<SUI>>(treasury_id);
    let market_config = scenario.take_shared_by_id<MarketPackageConfigV8>(market_config_id);
    let market_registry = scenario.take_shared_by_id<MarketRegistryV8<SUI>>(market_registry_id);
    let market_treasury = scenario.take_shared_by_id<MarketTreasuryV8<SUI>>(market_treasury_id);
    physical::market_custody_matrix_for_testing(case, &mut registry, &root,
        &protocol, &catalog, &replacement, &config,
        market::market_runtime_caller_for_testing(&market_config), &market_registry,
        &market_treasury, &treasury, scenario.ctx());
    scenario::return_shared(root);
    scenario::return_shared(protocol);
    scenario::return_shared(catalog);
    scenario::return_immutable(replacement);
    scenario::return_shared(config);
    scenario::return_shared(registry);
    scenario::return_shared(treasury);
    scenario::return_shared(market_config);
    scenario::return_shared(market_registry);
    scenario::return_shared(market_treasury);
    std::unit_test::destroy(system);
    scenario.end();
}

#[test]
fun market_custody_binding_exact_matrix_accepts_live_asset() { run_custody_matrix_case(0); }

#[test, expected_failure(abort_code = 21, location = animacraft_v8_physical::physical_v8)]
fun market_custody_rejects_wrong_binding_version() { run_custody_matrix_case(1); }

#[test, expected_failure(abort_code = 21, location = animacraft_v8_physical::physical_v8)]
fun market_custody_rejects_wrong_asset_id() { run_custody_matrix_case(2); }

#[test, expected_failure(abort_code = 21, location = animacraft_v8_physical::physical_v8)]
fun market_custody_rejects_wrong_physical_registry() { run_custody_matrix_case(3); }

#[test, expected_failure(abort_code = 21, location = animacraft_v8_physical::physical_v8)]
fun market_custody_rejects_wrong_root_id() { run_custody_matrix_case(4); }

#[test, expected_failure(abort_code = 21, location = animacraft_v8_physical::physical_v8)]
fun market_custody_rejects_wrong_maker_version() { run_custody_matrix_case(5); }

#[test, expected_failure(abort_code = 21, location = animacraft_v8_physical::physical_v8)]
fun market_custody_rejects_wrong_root_content() { run_custody_matrix_case(6); }

#[test, expected_failure(abort_code = 21, location = animacraft_v8_physical::physical_v8)]
fun market_custody_rejects_wrong_source_kind() { run_custody_matrix_case(7); }

#[test, expected_failure(abort_code = 21, location = animacraft_v8_physical::physical_v8)]
fun market_custody_rejects_wrong_source_identity() { run_custody_matrix_case(8); }

#[test, expected_failure(abort_code = 21, location = animacraft_v8_physical::physical_v8)]
fun market_custody_rejects_wrong_source_content() { run_custody_matrix_case(9); }

// Base custody validates its exact treasury through Core's immutable Maker
// treasury binding; the unchanged wrong-ID mutation aborts in that guard.
#[test, expected_failure(abort_code = 25, location = animacraft_v8_core::maker_v8)]
fun market_custody_rejects_wrong_source_treasury() { run_custody_matrix_case(10); }

#[test, expected_failure(abort_code = 12, location = animacraft_v8_physical::physical_v8)]
fun market_custody_rejects_wrong_stored_holder() { run_custody_matrix_case(11); }

#[test, expected_failure(abort_code = 10, location = animacraft_v8_physical::physical_v8)]
fun market_custody_rejects_wrong_ownership_epoch() { run_custody_matrix_case(12); }

#[test, expected_failure(abort_code = 16, location = animacraft_v8_physical::physical_v8)]
fun market_custody_rejects_wrong_transferable_readback() { run_custody_matrix_case(13); }

#[test, expected_failure(abort_code = 2, location = animacraft_v8_physical::physical_v8)]
fun market_custody_rejects_wrong_provenance() { run_custody_matrix_case(14); }

use native_soul_v8_graph::pack_player::{Self as pack_player, PackPlayerIds};
use native_soul_v8_graph::active_maker::ActiveMakerIds;
use native_soul_v8_graph::bootstrap::SetupIds;
use animacraft_v8_core::maker_v8 as maker;
use animacraft_v8_core::protocol_config_v8::{Self as protocol, ProtocolAdminCapV8, ProtocolTreasuryV8};
use animacraft_v8_core::treasury_v8::{Self as core_treasury, MakerAccessPassV8};
use animacraft_v8_core::package_binding_v8 as binding;
use animacraft_v8_release::release_v8::{Self as release, ReleasePackageConfigV8};
use animacraft_v8_runtime::runtime_v8::{Self as runtime, RuntimeDefinitionRegistryV8,
    PackRegistryV8, PackAdmissionAuthorityV8, PackReleaseV8, PackAdminCapV8,
    PackTreasuryV8, PackPassV8, MakerLoadoutV8, OwnedBaseItemV8, RuntimePhysicalSelectionWitnessV8};
use animacraft_v8_physical::physical_v8::PhysicalAssetV8;
use sui::coin::{Self as coin, Coin};
use sui::test_scenario::Scenario;
use walrus::system::System;

/// Only IDs of actually created objects; no authority or witness is fabricated.
public struct CaseIds has copy, drop {
    protocol: ID, setup: SetupIds, maker: ActiveMakerIds, player: PackPlayerIds,
    base_item: ID, base_loadout: ID,
}
/// Transaction inventory borrowed by the upper test, then returned unchanged
/// except for the operation explicitly under test.
public struct CaseObjects {
    ids: CaseIds,
    protocol_config: ProtocolConfigV8, protocol_admin: ProtocolAdminCapV8,
    protocol_treasury: ProtocolTreasuryV8<SUI>,
    root: MakerRootV8<SUI>, base_registry: BaseDefinitionRegistryV8,
    maker_admin: MakerAdminCapV8, maker_treasury: MakerTreasuryV8<SUI>,
    catalog: ProductReleaseCatalogV8, replacement: FreshTupleReplacementBindingV2,
    release_config: ReleasePackageConfigV8, physical_config: PhysicalPackageConfigV8,
    physical_registry: PhysicalRegistryV8,
    runtime_definitions: RuntimeDefinitionRegistryV8, pack_registry: PackRegistryV8,
    admission_authority: PackAdmissionAuthorityV8,
    pack_release: PackReleaseV8<SUI>, pack_admin: PackAdminCapV8,
    pack_treasury: PackTreasuryV8<SUI>, pack_pass: PackPassV8,
    pack_loadout: MakerLoadoutV8, maker_access: MakerAccessPassV8,
    base_item: OwnedBaseItemV8, loadout: MakerLoadoutV8,
}

fun prepare_case(
    scenario: &mut Scenario, issuance: u8, proof: u8, price: u64,
    max_supply: u64, transferable: bool,
): (CaseIds, System) {
    let (protocol_id, setup, mut system) = bootstrap::initialize_for_testing(scenario);
    let active = active_maker::new_active_with_physical_for_testing(scenario,
        protocol_id, setup, &mut system, issuance, proof, price, max_supply, transferable);
    let player = pack_player::new_pack_player_for_testing(scenario, active);
    let (root_id, base_id, _, _) = active_maker::maker_ids_for_testing(active);
    let (definitions_id, packs_id, _, _, _, _, _, _, _) = active_maker::companion_ids_for_testing(active);
    let (_, _, _, _, _, access_id) = pack_player::ids_for_testing(player);
    let root = scenario.take_shared_by_id<MakerRootV8<SUI>>(root_id);
    let base = scenario.take_shared_by_id<BaseDefinitionRegistryV8>(base_id);
    let definitions = scenario.take_shared_by_id<RuntimeDefinitionRegistryV8>(definitions_id);
    let mut packs = scenario.take_shared_by_id<PackRegistryV8>(packs_id);
    let access = scenario.take_from_sender_by_id<MakerAccessPassV8>(access_id);
    let mut item = runtime::claim_owned_base_item_v8(&mut packs, &definitions, &base,
        &root, &access, b"part".to_string(), b"item".to_string(), scenario.ctx());
    let mut loadout = runtime::create_maker_loadout_v8(&root, &definitions, &packs, &access, scenario.ctx());
    runtime::equip_owned_base_style_v8(&mut loadout, &mut item, &root, &definitions,
        &packs, &base, &access, 0, option::none(), b"style".to_string(), option::none(), scenario.ctx());
    let ids = CaseIds { protocol: protocol_id, setup, maker: active, player,
        base_item: object::id(&item), base_loadout: object::id(&loadout) };
    runtime::transfer_new_owned_base_item_to_holder_v8(item);
    runtime::transfer_maker_loadout_to_holder_v8(loadout);
    scenario::return_shared(root);
    scenario::return_shared(base);
    scenario::return_shared(definitions);
    scenario::return_shared(packs);
    scenario.return_to_sender(access);
    let sender = scenario.ctx().sender();
    scenario.next_tx(sender);
    (ids, system)
}

fun take_case(scenario: &Scenario, ids: CaseIds): CaseObjects {
    let (root_id, base_id, treasury_id, admin_id) = active_maker::maker_ids_for_testing(ids.maker);
    let (definitions_id, packs_id, admission_id, _, _, _, physical_id, _, _) =
        active_maker::companion_ids_for_testing(ids.maker);
    let (catalog_id, _, _, _, physical_config_id, _, release_config_id) =
        bootstrap::configuration_ids_for_testing(ids.setup);
    let (replacement_id, _, _) = bootstrap::authority_ids_for_testing(scenario, ids.setup);
    let (pack_id, pack_admin_id, pack_treasury_id, pass_id, loadout_id, access_id) =
        pack_player::ids_for_testing(ids.player);
    CaseObjects {
        ids,
        protocol_config: scenario.take_shared_by_id<ProtocolConfigV8>(ids.protocol),
        // One protocol is initialized per case; production settlement checks
        // its exact parent identity, not just these inventory types.
        protocol_admin: scenario.take_from_sender<ProtocolAdminCapV8>(),
        protocol_treasury: scenario.take_shared<ProtocolTreasuryV8<SUI>>(),
        root: scenario.take_shared_by_id<MakerRootV8<SUI>>(root_id),
        base_registry: scenario.take_shared_by_id<BaseDefinitionRegistryV8>(base_id),
        maker_admin: scenario.take_from_sender_by_id<MakerAdminCapV8>(admin_id),
        maker_treasury: scenario.take_shared_by_id<MakerTreasuryV8<SUI>>(treasury_id),
        catalog: scenario.take_shared_by_id<ProductReleaseCatalogV8>(catalog_id),
        replacement: scenario.take_immutable_by_id<FreshTupleReplacementBindingV2>(replacement_id),
        release_config: scenario.take_shared_by_id<ReleasePackageConfigV8>(release_config_id),
        physical_config: scenario.take_shared_by_id<PhysicalPackageConfigV8>(physical_config_id),
        physical_registry: scenario.take_shared_by_id<PhysicalRegistryV8>(physical_id),
        runtime_definitions: scenario.take_shared_by_id<RuntimeDefinitionRegistryV8>(definitions_id),
        pack_registry: scenario.take_shared_by_id<PackRegistryV8>(packs_id),
        admission_authority: scenario.take_from_sender_by_id<PackAdmissionAuthorityV8>(admission_id),
        pack_release: scenario.take_shared_by_id<PackReleaseV8<SUI>>(pack_id),
        pack_admin: scenario.take_from_sender_by_id<PackAdminCapV8>(pack_admin_id),
        pack_treasury: scenario.take_shared_by_id<PackTreasuryV8<SUI>>(pack_treasury_id),
        pack_pass: scenario.take_from_sender_by_id<PackPassV8>(pass_id),
        pack_loadout: scenario.take_from_sender_by_id<MakerLoadoutV8>(loadout_id),
        maker_access: scenario.take_from_sender_by_id<MakerAccessPassV8>(access_id),
        base_item: scenario.take_from_sender_by_id<OwnedBaseItemV8>(ids.base_item),
        loadout: scenario.take_from_sender_by_id<MakerLoadoutV8>(ids.base_loadout),
    }
}

fun return_case(scenario: &Scenario, fixture: CaseObjects): CaseIds {
    let CaseObjects { ids, protocol_config, protocol_admin, protocol_treasury,
        root, base_registry, maker_admin, maker_treasury, catalog, replacement,
        release_config, physical_config, physical_registry, runtime_definitions,
        pack_registry, admission_authority, pack_release, pack_admin, pack_treasury,
        pack_pass, pack_loadout, maker_access, base_item, loadout } = fixture;
    scenario::return_shared(protocol_config);
    scenario.return_to_sender(protocol_admin);
    scenario::return_shared(protocol_treasury);
    scenario::return_shared(root);
    scenario::return_shared(base_registry);
    scenario.return_to_sender(maker_admin);
    scenario::return_shared(maker_treasury);
    scenario::return_shared(catalog);
    scenario::return_immutable(replacement);
    scenario::return_shared(release_config);
    scenario::return_shared(physical_config);
    scenario::return_shared(physical_registry);
    scenario::return_shared(runtime_definitions);
    scenario::return_shared(pack_registry);
    scenario.return_to_sender(admission_authority);
    scenario::return_shared(pack_release);
    scenario.return_to_sender(pack_admin);
    scenario::return_shared(pack_treasury);
    scenario.return_to_sender(pack_pass);
    scenario.return_to_sender(pack_loadout);
    scenario.return_to_sender(maker_access);
    scenario.return_to_sender(base_item);
    scenario.return_to_sender(loadout);
    ids
}

fun advance_base_selection(fixture: &mut CaseObjects, ctx: &TxContext) {
    let revision = runtime::loadout_revision_v8(&fixture.loadout);
    runtime::unequip_owned_base_style_v8(&mut fixture.loadout, &mut fixture.base_item, revision, ctx);
    let revision = runtime::loadout_revision_v8(&fixture.loadout);
    runtime::equip_owned_base_style_v8(&mut fixture.loadout, &mut fixture.base_item,
        &fixture.root, &fixture.runtime_definitions, &fixture.pack_registry,
        &fixture.base_registry, &fixture.maker_access, revision, option::none(),
        b"style".to_string(), option::none(), ctx);
}
fun base_selection_witness(fixture: &mut CaseObjects, ctx: &TxContext): RuntimePhysicalSelectionWitnessV8 {
    advance_base_selection(fixture, ctx);
    let proof = runtime::prove_owned_base_selection_v8(&fixture.loadout, &fixture.base_item,
        &fixture.runtime_definitions, &fixture.pack_registry, &fixture.base_registry,
        &fixture.root, &fixture.maker_access, 0, ctx);
    runtime::certify_physical_selection_v8(proof, &fixture.loadout, ctx)
}
fun pack_selection_witness(fixture: &CaseObjects, ctx: &TxContext): RuntimePhysicalSelectionWitnessV8 {
    let proof = runtime::prove_pack_selection_v8(&fixture.pack_loadout, &fixture.pack_registry,
        &fixture.pack_release, &fixture.pack_pass, &fixture.root, &fixture.maker_access, 0, ctx);
    runtime::certify_physical_selection_v8(proof, &fixture.pack_loadout, ctx)
}
fun register_test_pack_policy(fixture: &mut CaseObjects, revision: u64, issuance: u8,
    proof: u8, price: u64, max_supply: u64, transferable: bool, ctx: &TxContext) {
    physical::register_pack_style_policy_v8(&mut fixture.physical_registry,
        &fixture.root, &fixture.maker_admin, &fixture.protocol_config, &fixture.catalog,
        &fixture.replacement, &fixture.physical_config, &fixture.pack_registry,
        &fixture.pack_release, &fixture.pack_admin, &fixture.pack_treasury, revision,
        b"part".to_string(), b"pack-item".to_string(), b"pack-style".to_string(),
        test_hash(95), issuance, proof, price, max_supply, transferable, ctx);
}
fun claim_fixture_base_free(fixture: &mut CaseObjects, witness: RuntimePhysicalSelectionWitnessV8,
    issued: u64, ctx: &mut TxContext): PhysicalAssetV8 {
    physical::claim_free_base_style_v8(&mut fixture.physical_registry, &fixture.root,
        &fixture.protocol_config, &fixture.catalog, &fixture.replacement,
        &fixture.physical_config, witness, &fixture.loadout, issued, ctx)
}
fun claim_fixture_pack_free(fixture: &mut CaseObjects, witness: RuntimePhysicalSelectionWitnessV8,
    issued: u64, ctx: &mut TxContext): PhysicalAssetV8 {
    physical::claim_free_pack_style_v8(&mut fixture.physical_registry, &fixture.root,
        &fixture.protocol_config, &fixture.catalog, &fixture.replacement,
        &fixture.physical_config, &fixture.pack_registry, &fixture.pack_release,
        &fixture.pack_treasury, &fixture.pack_pass, witness, &fixture.pack_loadout, issued, ctx)
}
fun purchase_fixture_base(fixture: &mut CaseObjects, payment: Coin<SUI>,
    witness: RuntimePhysicalSelectionWitnessV8, issued: u64, ctx: &mut TxContext): PhysicalAssetV8 {
    physical::purchase_base_style_v8(&mut fixture.physical_registry, &fixture.root,
        &fixture.catalog, &fixture.replacement, &fixture.physical_config,
        &fixture.protocol_config, &mut fixture.protocol_treasury, &mut fixture.maker_treasury,
        payment, witness, &fixture.loadout, issued, ctx)
}
fun purchase_fixture_pack(fixture: &mut CaseObjects, payment: Coin<SUI>,
    witness: RuntimePhysicalSelectionWitnessV8, issued: u64, ctx: &mut TxContext): PhysicalAssetV8 {
    physical::purchase_pack_style_v8(&mut fixture.physical_registry, &fixture.root,
        &fixture.catalog, &fixture.replacement, &fixture.physical_config,
        &fixture.pack_registry, &fixture.pack_release, &mut fixture.pack_treasury,
        &fixture.pack_pass, &fixture.protocol_config, &mut fixture.protocol_treasury,
        payment, witness, &fixture.pack_loadout, issued, ctx)
}
fun pause_root(fixture: &mut CaseObjects, ctx: &TxContext) {
    release::pause_maker_v8(&mut fixture.root, &fixture.maker_admin,
        &fixture.protocol_config, &fixture.catalog, &fixture.replacement, &fixture.release_config, ctx);
}
fun archive_root(fixture: &mut CaseObjects, ctx: &TxContext) {
    release::archive_maker_v8(&mut fixture.root, &fixture.maker_admin,
        &fixture.protocol_config, &fixture.catalog, &fixture.replacement, &fixture.release_config, ctx);
}
fun test_hash(byte: u8): vector<u8> { vector::tabulate!(32, |_| byte) }

use animacraft_v8_physical::physical_v8::PhysicalMarketTestListingV8;
public struct MarketCaseObjects {
    config: MarketPackageConfigV8, registry: MarketRegistryV8<SUI>, treasury: MarketTreasuryV8<SUI>,
}
fun take_market_case(scenario: &Scenario, ids: CaseIds): MarketCaseObjects {
    let (_, _, _, _, _, config_id, _) = bootstrap::configuration_ids_for_testing(ids.setup);
    let (_, _, _, _, _, _, _, registry_id, treasury_id) = active_maker::companion_ids_for_testing(ids.maker);
    MarketCaseObjects {
        config: scenario.take_shared_by_id<MarketPackageConfigV8>(config_id),
        registry: scenario.take_shared_by_id<MarketRegistryV8<SUI>>(registry_id),
        treasury: scenario.take_shared_by_id<MarketTreasuryV8<SUI>>(treasury_id),
    }
}
fun return_market_case(value: MarketCaseObjects) {
    let MarketCaseObjects { config, registry, treasury } = value;
    scenario::return_shared(config);
    scenario::return_shared(registry);
    scenario::return_shared(treasury);
}
fun run_cross_transaction_custody(case: u8) {
    let mut scenario = scenario::begin(@0xA11);
    // Wrong Receiving uses two paid issues from the same exact Base policy.
    // Free-claim replay protection is not bypassed to manufacture a second asset.
    let paid = case == 3;
    let (ids, system) = prepare_case(&mut scenario,
        if (paid) { physical::issue_paid_purchase_v8() } else { physical::issue_free_claim_v8() },
        physical::proof_none_v8(), if (paid) { 100 } else { 0 }, 3, true);
    let mut fixture = take_case(&scenario, ids);
    let market = take_market_case(&scenario, ids);
    let pack = case == 1;
    let asset = if (pack) {
        register_test_pack_policy(&mut fixture, 0, physical::issue_free_claim_v8(),
            physical::proof_none_v8(), 0, 2, true, scenario.ctx());
        let witness = pack_selection_witness(&fixture, scenario.ctx());
        claim_fixture_pack_free(&mut fixture, witness, 0, scenario.ctx())
    } else {
        let witness = base_selection_witness(&mut fixture, scenario.ctx());
        if (paid) {
            let payment = coin::mint_for_testing<SUI>(100, scenario.ctx());
            purchase_fixture_base(&mut fixture, payment, witness, 0, scenario.ctx())
        } else {
            claim_fixture_base_free(&mut fixture, witness, 0, scenario.ctx())
        }
    };
    let wrong_asset = if (paid) {
        let witness = base_selection_witness(&mut fixture, scenario.ctx());
        let payment = coin::mint_for_testing<SUI>(100, scenario.ctx());
        option::some(purchase_fixture_base(&mut fixture, payment, witness, 1, scenario.ctx()))
    } else { option::none() };
    let (listing_id, receiving_id, snapshot) = physical::custody_asset_for_testing(
        pack, if (case == 2) { 1 } else if (case == 3) { 2 } else { 0 },
        &fixture.physical_registry, &fixture.root, &fixture.protocol_config,
        &fixture.catalog, &fixture.replacement, &fixture.physical_config,
        market::market_runtime_caller_for_testing(&market.config), &market.registry,
        &market.treasury, &fixture.maker_treasury, &fixture.pack_treasury,
        asset, wrong_asset, scenario.ctx());
    return_market_case(market);
    let _ = return_case(&scenario, fixture);
    let actor = if (case == 0) { @0xC33 } else if (case == 1) { @0xB22 } else { @0xA11 };
    scenario.next_tx(actor);
    let listing = scenario.take_shared_by_id<PhysicalMarketTestListingV8>(listing_id);
    let receiving = sui::test_scenario::receiving_ticket_by_id<PhysicalAssetV8>(receiving_id);
    if (case == 1 || case == 4) {
        physical::purchase_test_market_asset(listing, receiving, scenario.ctx());
    } else {
        physical::return_test_market_asset(listing, receiving);
    };
    // A negative case must abort at its target operation, not at a later
    // readback assertion that might share the expected Physical abort code.
    if (case >= 2) { abort 99 };
    let holder = if (case == 1) { @0xB22 } else { @0xA11 };
    scenario.next_tx(holder);
    let asset = scenario.take_from_sender_by_id<PhysicalAssetV8>(receiving_id);
    physical::assert_asset_readback_for_testing(&asset, snapshot, holder, if (case == 1) { 1 } else { 0 });
    physical::destroy_physical_market_asset_for_testing(asset);
    std::unit_test::destroy(system);
    scenario.end();
}
#[test]
fun cross_transaction_base_market_return_preserves_exact_state() { run_cross_transaction_custody(0); }
#[test]
fun cross_transaction_pack_market_purchase_changes_only_owner_state() { run_cross_transaction_custody(1); }
#[test, expected_failure(abort_code = 3, location = sui::transfer)]
fun cross_transaction_wrong_listing_parent_cannot_receive_custodied_asset() { run_cross_transaction_custody(2); }
#[test, expected_failure(abort_code = 21, location = animacraft_v8_physical::physical_v8)]
fun cross_transaction_wrong_receiving_asset_is_rejected() { run_cross_transaction_custody(3); }
#[test, expected_failure(abort_code = 19, location = animacraft_v8_physical::physical_v8)]
fun cross_transaction_seller_cannot_purchase_own_custodied_asset() { run_cross_transaction_custody(4); }

fun run_custody_gate_negative(pack_source: bool) {
    let mut scenario = scenario::begin(@0xA11);
    let (ids, system) = prepare_case(&mut scenario, physical::issue_free_claim_v8(),
        physical::proof_none_v8(), 0, 2, pack_source);
    let mut fixture = take_case(&scenario, ids);
    let market = take_market_case(&scenario, ids);
    let asset = if (pack_source) {
        register_test_pack_policy(&mut fixture, 0, physical::issue_free_claim_v8(),
            physical::proof_none_v8(), 0, 2, true, scenario.ctx());
        let witness = pack_selection_witness(&fixture, scenario.ctx());
        claim_fixture_pack_free(&mut fixture, witness, 0, scenario.ctx())
    } else {
        let witness = base_selection_witness(&mut fixture, scenario.ctx());
        claim_fixture_base_free(&mut fixture, witness, 0, scenario.ctx())
    };
    let (_, _, _) = physical::custody_asset_for_testing(false, 3,
        &fixture.physical_registry, &fixture.root, &fixture.protocol_config,
        &fixture.catalog, &fixture.replacement, &fixture.physical_config,
        market::market_runtime_caller_for_testing(&market.config), &market.registry,
        &market.treasury, &fixture.maker_treasury, &fixture.pack_treasury,
        asset, option::none(), scenario.ctx());
    return_market_case(market);
    let _ = return_case(&scenario, fixture);
    std::unit_test::destroy(system);
    scenario.end();
}
#[test, expected_failure(abort_code = 16, location = animacraft_v8_physical::physical_v8)]
fun market_custody_rejects_nontransferable_asset() { run_custody_gate_negative(false); }
#[test, expected_failure(abort_code = 21, location = animacraft_v8_physical::physical_v8)]
fun typed_base_custody_rejects_pack_source_substitution() { run_custody_gate_negative(true); }

#[test]
fun market_return_authority_survives_pause_archive_and_protocol_drift() {
    let mut scenario = scenario::begin(@0xA11);
    let (ids, system) = prepare_case(&mut scenario, physical::issue_free_claim_v8(),
        physical::proof_none_v8(), 0, 4, true);
    let mut fixture = take_case(&scenario, ids);
    let market = take_market_case(&scenario, ids);
    let witness = base_selection_witness(&mut fixture, scenario.ctx());
    let asset = claim_fixture_base_free(&mut fixture, witness, 0, scenario.ctx());
    let (listing, custody) = physical::return_binding_for_testing(
        &fixture.physical_registry, &fixture.root, &fixture.protocol_config,
        &fixture.catalog, &fixture.replacement, &fixture.physical_config,
        market::market_runtime_caller_for_testing(&market.config),
        &market.registry, &market.treasury, &fixture.maker_treasury, &asset, scenario.ctx());
    pause_root(&mut fixture, scenario.ctx());
    {
        let fixture = &mut fixture;
        protocol::set_protocol_enabled_v8(&mut fixture.protocol_config, &fixture.protocol_admin, false);
    };
    physical::assert_return_authority_for_testing(&fixture.physical_registry, &fixture.root,
        &fixture.protocol_config, &fixture.catalog, &fixture.replacement,
        market::market_runtime_caller_for_testing(&market.config), &market.registry,
        &market.treasury, &listing, &custody, &asset);
    // Re-enable only for the real lifecycle write, then prove return authority
    // still works with an archived Root and disabled, drifted protocol.
    {
        let fixture = &mut fixture;
        protocol::set_protocol_enabled_v8(&mut fixture.protocol_config, &fixture.protocol_admin, true);
    };
    archive_root(&mut fixture, scenario.ctx());
    {
        let fixture = &mut fixture;
        protocol::set_protocol_enabled_v8(&mut fixture.protocol_config, &fixture.protocol_admin, false);
    };
    physical::assert_return_authority_for_testing(&fixture.physical_registry, &fixture.root,
        &fixture.protocol_config, &fixture.catalog, &fixture.replacement,
        market::market_runtime_caller_for_testing(&market.config), &market.registry,
        &market.treasury, &listing, &custody, &asset);
    physical::destroy_physical_market_asset_for_testing(asset);
    physical::destroy_empty_test_market_listing(listing);
    return_market_case(market);
    let _ = return_case(&scenario, fixture);
    std::unit_test::destroy(system);
    scenario.end();
}

#[test]
fun pack_policy_registers_from_live_witness_and_free_issues_exact_asset() {
    let mut scenario = scenario::begin(@0xA11);
    let (ids, system) = prepare_case(&mut scenario, physical::issue_free_claim_v8(),
        physical::proof_none_v8(), 0, 2, true);
    let mut fixture = take_case(&scenario, ids);
    register_test_pack_policy(&mut fixture, 0, physical::issue_free_claim_v8(),
        physical::proof_none_v8(), 0, 2, true, scenario.ctx());
    assert!(physical::registry_revision_v8(&fixture.physical_registry) == 1, 10);
    assert!(physical::registry_pack_policy_count_v8(&fixture.physical_registry) == 1, 3);
    let witness = pack_selection_witness(&fixture, scenario.ctx());
    let asset = claim_fixture_pack_free(&mut fixture, witness, 0, scenario.ctx());
    physical::assert_exact_pack_asset_for_testing(&asset, &fixture.pack_release,
        &fixture.pack_treasury, &fixture.pack_registry, &fixture.pack_admin);
    physical::consume_physical_asset_v8(&mut fixture.physical_registry, asset, 0, scenario.ctx());
    assert!(physical::registry_total_issued_v8(&fixture.physical_registry) == 1, 3);
    assert!(physical::registry_total_consumed_v8(&fixture.physical_registry) == 1, 3);
    let _ = return_case(&scenario, fixture);
    std::unit_test::destroy(system);
    scenario.end();
}

fun pack_control_round_trip(scenario: &mut Scenario, player: PackPlayerIds) {
    let (release_id, admin_id, _, _, _, _) = pack_player::ids_for_testing(player);
    let mut pack = scenario.take_shared_by_id<PackReleaseV8<SUI>>(release_id);
    let admin = scenario.take_from_sender_by_id<PackAdminCapV8>(admin_id);
    runtime::transfer_pack_control_v8(&mut pack, admin, @0xB22, scenario.ctx());
    scenario::return_shared(pack);
    scenario.next_tx(@0xB22);
    let mut pack = scenario.take_shared_by_id<PackReleaseV8<SUI>>(release_id);
    let admin = scenario.take_from_sender_by_id<PackAdminCapV8>(admin_id);
    runtime::transfer_pack_control_v8(&mut pack, admin, @0xA11, scenario.ctx());
    scenario::return_shared(pack);
    scenario.next_tx(@0xA11);
}

#[test]
fun pack_control_epoch_change_does_not_invalidate_registered_content() {
    let mut scenario = scenario::begin(@0xA11);
    let (ids, system) = prepare_case(&mut scenario, physical::issue_free_claim_v8(),
        physical::proof_none_v8(), 0, 2, true);
    // Real transfer away and back advances two epochs; the old synthetic
    // helper incremented one epoch without the required owner/cap transaction.
    pack_control_round_trip(&mut scenario, ids.player);
    let mut fixture = take_case(&scenario, ids);
    register_test_pack_policy(&mut fixture, 0, physical::issue_free_claim_v8(),
        physical::proof_none_v8(), 0, 2, true, scenario.ctx());
    physical::assert_registered_pack_control_for_testing(&fixture.physical_registry,
        &fixture.pack_release, &fixture.pack_admin, 2);
    let _ = return_case(&scenario, fixture);
    // Returned inventory becomes available in the next transaction.
    scenario.next_tx(@0xA11);
    pack_control_round_trip(&mut scenario, ids.player);
    let mut fixture = take_case(&scenario, ids);
    physical::assert_registered_pack_control_for_testing(&fixture.physical_registry,
        &fixture.pack_release, &fixture.pack_admin, 2);
    let witness = pack_selection_witness(&fixture, scenario.ctx());
    let asset = claim_fixture_pack_free(&mut fixture, witness, 0, scenario.ctx());
    physical::consume_physical_asset_v8(&mut fixture.physical_registry, asset, 0, scenario.ctx());
    let _ = return_case(&scenario, fixture);
    std::unit_test::destroy(system);
    scenario.end();
}

#[test]
fun soul_proof_issuance_records_exact_provenance_and_counter() {
    let mut scenario = scenario::begin(@0xA11);
    let (ids, system) = prepare_case(&mut scenario, physical::issue_proof_materialize_v8(),
        physical::proof_canonical_soul_v8(), 0, 2, true);
    let (_, _, _, seal_id, output_id, souls_id, _, _, _) =
        active_maker::companion_ids_for_testing(ids.maker);
    let (_, policy_id, _, _, _, _, _) = bootstrap::configuration_ids_for_testing(ids.setup);
    let mut fixture = take_case(&scenario, ids);
    let witness = base_selection_witness(&mut fixture, scenario.ctx());
    {
        let fixture = &mut fixture;
        physical::assert_proof_accounting_for_testing(&mut fixture.physical_registry,
            &fixture.loadout, witness, output_id, souls_id, seal_id, policy_id, scenario.ctx());
    };
    let _ = return_case(&scenario, fixture);
    std::unit_test::destroy(system);
    scenario.end();
}

#[test, expected_failure(abort_code = 25, location = animacraft_v8_core::maker_v8)]
fun paid_purchase_rejects_another_roots_maker_treasury() {
    let mut scenario = scenario::begin(@0xA11);
    let (ids, mut system) = prepare_case(&mut scenario, physical::issue_paid_purchase_v8(),
        physical::proof_none_v8(), 100, 1, true);
    let (other, _) = active_maker::new_draft_maker_for_testing(
        &mut scenario, ids.protocol, ids.setup, &mut system);
    let (_, _, other_treasury_id, _) = active_maker::draft_maker_ids_for_testing(other);
    let mut other_treasury = scenario.take_shared_by_id<MakerTreasuryV8<SUI>>(other_treasury_id);
    let mut fixture = take_case(&scenario, ids);
    let witness = base_selection_witness(&mut fixture, scenario.ctx());
    let payment = coin::mint_for_testing<SUI>(100, scenario.ctx());
    let asset = {
        let fixture = &mut fixture;
        physical::purchase_base_style_v8(&mut fixture.physical_registry,
            &fixture.root, &fixture.catalog, &fixture.replacement, &fixture.physical_config,
            &fixture.protocol_config, &mut fixture.protocol_treasury, &mut other_treasury,
            payment, witness, &fixture.loadout, 0, scenario.ctx())
    };
    physical::destroy_physical_market_asset_for_testing(asset);
    scenario::return_shared(other_treasury);
    let _ = return_case(&scenario, fixture);
    std::unit_test::destroy(system);
    scenario.end();
}

#[test, expected_failure(abort_code = 0, location = animacraft_v8_runtime::runtime_v8)]
fun paid_pack_purchase_rejects_another_releases_pack_treasury() {
    let mut scenario = scenario::begin(@0xA11);
    let (ids, system) = prepare_case(&mut scenario, physical::issue_free_claim_v8(),
        physical::proof_none_v8(), 0, 1, true);
    let mut fixture = take_case(&scenario, ids);
    // A real distinct Release constructor creates its own exact treasury; it
    // need not be admitted to demonstrate that it cannot settle another Pack.
    let (other_release, other_admin, mut other_treasury) = runtime::new_pack_release_v8(
        &fixture.root, &fixture.runtime_definitions, b"other-pack".to_string(),
        b"other-pack-manifest".to_string(), test_hash(75), test_hash(71),
        runtime::access_free_v8(), 0, maker::complete_unlimited_free_v8(), 0, 0, 0,
        1, runtime::physical_pack_style_commitment_for_testing(&fixture.root), scenario.ctx());
    runtime::share_pack_release_v8(other_release);
    runtime::transfer_pack_admin_cap_v8(other_admin, @0xA11);
    register_test_pack_policy(&mut fixture, 0, physical::issue_paid_purchase_v8(),
        physical::proof_none_v8(), 100, 1, true, scenario.ctx());
    let witness = pack_selection_witness(&fixture, scenario.ctx());
    let payment = coin::mint_for_testing<SUI>(100, scenario.ctx());
    let asset = {
        let fixture = &mut fixture;
        physical::purchase_pack_style_v8(&mut fixture.physical_registry,
            &fixture.root, &fixture.catalog, &fixture.replacement, &fixture.physical_config,
            &fixture.pack_registry, &fixture.pack_release, &mut other_treasury,
            &fixture.pack_pass, &fixture.protocol_config, &mut fixture.protocol_treasury,
            payment, witness, &fixture.pack_loadout, 0, scenario.ctx())
    };
    physical::destroy_physical_market_asset_for_testing(asset);
    runtime::share_pack_treasury_v8(other_treasury);
    let _ = return_case(&scenario, fixture);
    std::unit_test::destroy(system);
    scenario.end();
}
#[test, expected_failure(abort_code = 6, location = animacraft_v8_physical::physical_v8)]
fun duplicate_pack_policy_registration_is_rejected() {
    let mut scenario = scenario::begin(@0xA11);
    let (ids, system) = prepare_case(&mut scenario, physical::issue_free_claim_v8(), physical::proof_none_v8(), 0, 2, true);
    let mut fixture = take_case(&scenario, ids);
    register_test_pack_policy(
        &mut fixture, 0, physical::issue_free_claim_v8(), physical::proof_none_v8(), 0, 2, true, scenario.ctx(),
    );
    register_test_pack_policy(
        &mut fixture, 1, physical::issue_free_claim_v8(), physical::proof_none_v8(), 0, 2, true, scenario.ctx(),
    );
    let _ids = return_case(&scenario, fixture);
    std::unit_test::destroy(system);
    scenario.end();
}

#[test, expected_failure(abort_code = 10, location = animacraft_v8_physical::physical_v8)]
fun pack_policy_registration_requires_exact_registry_revision() {
    let mut scenario = scenario::begin(@0xA11);
    let (ids, system) = prepare_case(&mut scenario, physical::issue_free_claim_v8(), physical::proof_none_v8(), 0, 2, true);
    let mut fixture = take_case(&scenario, ids);
    register_test_pack_policy(
        &mut fixture, 1, physical::issue_free_claim_v8(), physical::proof_none_v8(), 0, 2, true, scenario.ctx(),
    );
    let _ids = return_case(&scenario, fixture);
    std::unit_test::destroy(system);
    scenario.end();
}

#[test, expected_failure(abort_code = 15, location = animacraft_v8_runtime::runtime_v8)]
fun revoked_pack_admission_blocks_new_issuance() {
    let mut scenario = scenario::begin(@0xA11);
    let (ids, system) = prepare_case(&mut scenario, physical::issue_free_claim_v8(), physical::proof_none_v8(), 0, 2, true);
    let mut fixture = take_case(&scenario, ids);
    register_test_pack_policy(
        &mut fixture, 0, physical::issue_free_claim_v8(), physical::proof_none_v8(), 0, 2, true, scenario.ctx(),
    );
    let witness = pack_selection_witness(&fixture, scenario.ctx());
    let pack_id = object::id(&fixture.pack_release);
    let pack_revision = runtime::pack_registry_revision_v8(&fixture.pack_registry);
    {
        let fixture = &mut fixture;
        runtime::revoke_pack_admission_v8(&mut fixture.pack_registry, &fixture.admission_authority,
            &fixture.runtime_definitions, &fixture.root, &fixture.maker_admin,
            pack_id, pack_revision, scenario.ctx());
    };
    let asset = claim_fixture_pack_free(&mut fixture, witness, 0, scenario.ctx());
    physical::destroy_physical_market_asset_for_testing(asset);
    let _ids = return_case(&scenario, fixture);
    std::unit_test::destroy(system);
    scenario.end();
}

#[test, expected_failure(abort_code = 9, location = animacraft_v8_runtime::runtime_v8)]
fun paused_pack_blocks_new_issuance() {
    let mut scenario = scenario::begin(@0xA11);
    let (ids, system) = prepare_case(&mut scenario, physical::issue_free_claim_v8(), physical::proof_none_v8(), 0, 2, true);
    let mut fixture = take_case(&scenario, ids);
    register_test_pack_policy(
        &mut fixture, 0, physical::issue_free_claim_v8(), physical::proof_none_v8(), 0, 2, true, scenario.ctx(),
    );
    let witness = pack_selection_witness(&fixture, scenario.ctx());
    {
        let fixture = &mut fixture;
        runtime::pause_pack_release_v8(&mut fixture.pack_release, &fixture.pack_admin, scenario.ctx());
    };
    let asset = claim_fixture_pack_free(&mut fixture, witness, 0, scenario.ctx());
    physical::destroy_physical_market_asset_for_testing(asset);
    let _ids = return_case(&scenario, fixture);
    std::unit_test::destroy(system);
    scenario.end();
}

#[test, expected_failure(abort_code = 9, location = animacraft_v8_runtime::runtime_v8)]
fun archived_pack_blocks_new_issuance() {
    let mut scenario = scenario::begin(@0xA11);
    let (ids, system) = prepare_case(&mut scenario, physical::issue_free_claim_v8(), physical::proof_none_v8(), 0, 2, true);
    let mut fixture = take_case(&scenario, ids);
    register_test_pack_policy(
        &mut fixture, 0, physical::issue_free_claim_v8(), physical::proof_none_v8(), 0, 2, true, scenario.ctx(),
    );
    let witness = pack_selection_witness(&fixture, scenario.ctx());
    {
        let fixture = &mut fixture;
        runtime::archive_pack_release_v8(&mut fixture.pack_release, &fixture.pack_admin, scenario.ctx());
    };
    let asset = claim_fixture_pack_free(&mut fixture, witness, 0, scenario.ctx());
    physical::destroy_physical_market_asset_for_testing(asset);
    let _ids = return_case(&scenario, fixture);
    std::unit_test::destroy(system);
    scenario.end();
}

#[test, expected_failure(
    abort_code = 0,
    location = animacraft_v8_core::maker_v8,
)]
fun paused_root_blocks_new_issuance() {
    let mut scenario = scenario::begin(@0xA11);
    let (ids, system) = prepare_case(&mut scenario, physical::issue_free_claim_v8(), physical::proof_none_v8(), 0, 2, true);
    let mut fixture = take_case(&scenario, ids);
    let witness = base_selection_witness(&mut fixture, scenario.ctx());
    pause_root(&mut fixture, scenario.ctx());
    let asset = claim_fixture_base_free(&mut fixture, witness, 0, scenario.ctx());
    physical::destroy_physical_market_asset_for_testing(asset);
    let _ids = return_case(&scenario, fixture);
    std::unit_test::destroy(system);
    scenario.end();
}

#[test, expected_failure(abort_code = 14, location = animacraft_v8_physical::physical_v8)]
fun free_claim_replay_is_stable_across_loadout_revisions() {
    let mut scenario = scenario::begin(@0xA11);
    let (ids, system) = prepare_case(&mut scenario, physical::issue_free_claim_v8(), physical::proof_none_v8(), 0, 2, true);
    let mut fixture = take_case(&scenario, ids);
    let witness = base_selection_witness(&mut fixture, scenario.ctx());
    let asset = claim_fixture_base_free(&mut fixture, witness, 0, scenario.ctx());
    physical::consume_physical_asset_v8(&mut fixture.physical_registry, asset, 0, scenario.ctx());
    let replay = base_selection_witness(&mut fixture, scenario.ctx());
    let asset = claim_fixture_base_free(&mut fixture, replay, 1, scenario.ctx());
    physical::destroy_physical_market_asset_for_testing(asset);
    let _ids = return_case(&scenario, fixture);
    std::unit_test::destroy(system);
    scenario.end();
}

#[test, expected_failure(abort_code = 21, location = animacraft_v8_runtime::runtime_v8)]
fun stale_runtime_selection_witness_is_rejected() {
    let mut scenario = scenario::begin(@0xA11);
    let (ids, system) = prepare_case(&mut scenario, physical::issue_free_claim_v8(), physical::proof_none_v8(), 0, 2, true);
    let mut fixture = take_case(&scenario, ids);
    let witness = base_selection_witness(&mut fixture, scenario.ctx());
    advance_base_selection(&mut fixture, scenario.ctx());
    let asset = claim_fixture_base_free(&mut fixture, witness, 0, scenario.ctx());
    physical::destroy_physical_market_asset_for_testing(asset);
    let _ids = return_case(&scenario, fixture);
    std::unit_test::destroy(system);
    scenario.end();
}

#[test]
fun paid_base_purchase_splits_exact_protocol_and_maker_residual() {
    let mut scenario = scenario::begin(@0xA11);
    let (ids, system) = prepare_case(&mut scenario, physical::issue_paid_purchase_v8(), physical::proof_none_v8(), 100, 2, true);
    let mut fixture = take_case(&scenario, ids);
    let witness = base_selection_witness(&mut fixture, scenario.ctx());
    let payment = coin::from_balance(
        sui::balance::create_for_testing<sui::sui::SUI>(100),
        scenario.ctx(),
    );
    let asset = purchase_fixture_base(&mut fixture, payment, witness, 0, scenario.ctx());
    assert!(protocol::protocol_treasury_balance_for_testing(&fixture.protocol_treasury) == 10,
        13);
    assert!(core_treasury::maker_treasury_balance_v2(&fixture.maker_treasury) == 90,
        13);
    assert!(physical::registry_gross_paid_atomic_v8(&fixture.physical_registry) == 100, 13);
    assert!(physical::registry_protocol_paid_atomic_v8(&fixture.physical_registry) == 10, 13);
    assert!(physical::registry_maker_paid_atomic_v8(&fixture.physical_registry) == 90, 13);
    assert!(physical::registry_pack_paid_atomic_v8(&fixture.physical_registry) == 0, 13);
    physical::consume_physical_asset_v8(&mut fixture.physical_registry, asset, 0, scenario.ctx());
    let _ids = return_case(&scenario, fixture);
    std::unit_test::destroy(system);
    scenario.end();
}

#[test]
fun paid_pack_purchase_splits_exact_protocol_and_pack_residual() {
    let mut scenario = scenario::begin(@0xA11);
    let (ids, system) = prepare_case(&mut scenario, physical::issue_free_claim_v8(), physical::proof_none_v8(), 0, 2, true);
    let mut fixture = take_case(&scenario, ids);
    register_test_pack_policy(
        &mut fixture, 0, physical::issue_paid_purchase_v8(), physical::proof_none_v8(), 100, 2, true, scenario.ctx(),
    );
    let witness = pack_selection_witness(&fixture, scenario.ctx());
    let payment = coin::from_balance(
        sui::balance::create_for_testing<sui::sui::SUI>(100),
        scenario.ctx(),
    );
    let asset = purchase_fixture_pack(&mut fixture, payment, witness, 0, scenario.ctx());
    assert!(protocol::protocol_treasury_balance_for_testing(&fixture.protocol_treasury) == 10,
        13);
    assert!(runtime::pack_treasury_balance_v8(&fixture.pack_treasury) == 90,
        13);
    assert!(physical::registry_maker_paid_atomic_v8(&fixture.physical_registry) == 0, 13);
    assert!(physical::registry_pack_paid_atomic_v8(&fixture.physical_registry) == 90, 13);
    physical::consume_physical_asset_v8(&mut fixture.physical_registry, asset, 0, scenario.ctx());
    let _ids = return_case(&scenario, fixture);
    std::unit_test::destroy(system);
    scenario.end();
}

#[test, expected_failure(abort_code = 13, location = animacraft_v8_physical::physical_v8)]
fun paid_purchase_rejects_wrong_exact_payment() {
    let mut scenario = scenario::begin(@0xA11);
    let (ids, system) = prepare_case(&mut scenario, physical::issue_paid_purchase_v8(), physical::proof_none_v8(), 100, 2, true);
    let mut fixture = take_case(&scenario, ids);
    let witness = base_selection_witness(&mut fixture, scenario.ctx());
    let payment = coin::from_balance(
        sui::balance::create_for_testing<sui::sui::SUI>(99),
        scenario.ctx(),
    );
    let asset = purchase_fixture_base(&mut fixture, payment, witness, 0, scenario.ctx());
    physical::destroy_physical_market_asset_for_testing(asset);
    let _ids = return_case(&scenario, fixture);
    std::unit_test::destroy(system);
    scenario.end();
}

#[test, expected_failure(
    abort_code = 8,
    location = animacraft_v8_core::package_binding_v8,
)]
fun physical_role_rejects_a_core_package_type_origin() {
    let mut scenario = scenario::begin(@0xA11);
    let (ids, system) = prepare_case(&mut scenario, physical::issue_free_claim_v8(), physical::proof_none_v8(), 0, 1, true);
    let fixture = take_case(&scenario, ids);
    binding::assert_exact_witness_type_v2<ProtocolConfigV8>(
        binding::binding_at_v2(binding::catalog_binding_v8(&fixture.catalog), 4),
        &b"physical_v8",
        &b"PhysicalSetupInstallWitnessV2",
    );
    let _ids = return_case(&scenario, fixture);
    std::unit_test::destroy(system);
    scenario.end();
}

#[test, expected_failure(abort_code = 15, location = animacraft_v8_physical::physical_v8)]
fun supply_cas_blocks_after_exact_max_without_reopening_consumed_supply() {
    let mut scenario = scenario::begin(@0xA11);
    let (ids, system) = prepare_case(&mut scenario, physical::issue_paid_purchase_v8(), physical::proof_none_v8(), 100, 1, true);
    let mut fixture = take_case(&scenario, ids);
    let first_witness = base_selection_witness(&mut fixture, scenario.ctx());
    let first_payment = coin::from_balance(
        sui::balance::create_for_testing<sui::sui::SUI>(100), scenario.ctx());
    let asset = purchase_fixture_base(
        &mut fixture, first_payment, first_witness, 0, scenario.ctx(),
    );
    physical::consume_physical_asset_v8(&mut fixture.physical_registry, asset, 0, scenario.ctx());
    let second_witness = base_selection_witness(&mut fixture, scenario.ctx());
    let second_payment = coin::from_balance(
        sui::balance::create_for_testing<sui::sui::SUI>(100), scenario.ctx());
    let asset = purchase_fixture_base(
        &mut fixture, second_payment, second_witness, 1, scenario.ctx(),
    );
    physical::destroy_physical_market_asset_for_testing(asset);
    let _ids = return_case(&scenario, fixture);
    std::unit_test::destroy(system);
    scenario.end();
}

#[test]
fun direct_transfer_remains_available_after_root_pause() {
    let mut scenario = scenario::begin(@0xA11);
    let (ids, system) = prepare_case(&mut scenario, physical::issue_free_claim_v8(), physical::proof_none_v8(), 0, 1, true);
    let mut fixture = take_case(&scenario, ids);
    let witness = base_selection_witness(&mut fixture, scenario.ctx());
    let asset = claim_fixture_base_free(&mut fixture, witness, 0, scenario.ctx());
    pause_root(&mut fixture, scenario.ctx());
    physical::transfer_physical_asset_v8(asset, @0xB11, 0, scenario.ctx());
    let _ids = return_case(&scenario, fixture);
    std::unit_test::destroy(system);
    scenario.end();
}

#[test]
fun consume_remains_available_after_root_and_pack_archive() {
    let mut scenario = scenario::begin(@0xA11);
    let (ids, system) = prepare_case(&mut scenario, physical::issue_free_claim_v8(), physical::proof_none_v8(), 0, 1, true);
    let mut fixture = take_case(&scenario, ids);
    register_test_pack_policy(
        &mut fixture, 0, physical::issue_free_claim_v8(), physical::proof_none_v8(), 0, 1, true, scenario.ctx(),
    );
    let witness = pack_selection_witness(&fixture, scenario.ctx());
    let asset = claim_fixture_pack_free(&mut fixture, witness, 0, scenario.ctx());
    archive_root(&mut fixture, scenario.ctx());
    {
        let fixture = &mut fixture;
        runtime::archive_pack_release_v8(&mut fixture.pack_release, &fixture.pack_admin, scenario.ctx());
    };
    physical::consume_physical_asset_v8(&mut fixture.physical_registry, asset, 0, scenario.ctx());
    let _ids = return_case(&scenario, fixture);
    std::unit_test::destroy(system);
    scenario.end();
}

#[test, expected_failure(abort_code = 16, location = animacraft_v8_physical::physical_v8)]
fun nontransferable_asset_rejects_direct_transfer() {
    let mut scenario = scenario::begin(@0xA11);
    let (ids, system) = prepare_case(&mut scenario, physical::issue_free_claim_v8(), physical::proof_none_v8(), 0, 1, false);
    let mut fixture = take_case(&scenario, ids);
    let witness = base_selection_witness(&mut fixture, scenario.ctx());
    let asset = claim_fixture_base_free(&mut fixture, witness, 0, scenario.ctx());
    physical::transfer_physical_asset_v8(asset, @0xB11, 0, scenario.ctx());
    let _ids = return_case(&scenario, fixture);
    std::unit_test::destroy(system);
    scenario.end();
}

#[test, expected_failure(abort_code = 12, location = animacraft_v8_physical::physical_v8)]
fun wrong_holder_cannot_direct_transfer() {
    let mut scenario = scenario::begin(@0xA11);
    let (ids, system) = prepare_case(&mut scenario, physical::issue_free_claim_v8(), physical::proof_none_v8(), 0, 1, true);
    let mut fixture = take_case(&scenario, ids);
    let witness = base_selection_witness(&mut fixture, scenario.ctx());
    let asset = claim_fixture_base_free(&mut fixture, witness, 0, scenario.ctx());
    // `TxContext::new_from_hint` replaces the native test context globally, so
    // construct the adversarial sender only after the asset has been issued.
    let wrong_ctx = sui::tx_context::new_from_hint(@0xB0B, 124, 0, 0, 0);
    physical::transfer_physical_asset_v8(asset, @0xB11, 0, &wrong_ctx);
    let _ids = return_case(&scenario, fixture);
    std::unit_test::destroy(system);
    scenario.end();
}

#[test, expected_failure(abort_code = 10, location = animacraft_v8_physical::physical_v8)]
fun direct_transfer_requires_exact_asset_ownership_epoch() {
    let mut scenario = scenario::begin(@0xA11);
    let (ids, system) = prepare_case(&mut scenario, physical::issue_free_claim_v8(), physical::proof_none_v8(), 0, 1, true);
    let mut fixture = take_case(&scenario, ids);
    let witness = base_selection_witness(&mut fixture, scenario.ctx());
    let asset = claim_fixture_base_free(&mut fixture, witness, 0, scenario.ctx());
    physical::transfer_physical_asset_v8(asset, @0xB11, 1, scenario.ctx());
    let _ids = return_case(&scenario, fixture);
    std::unit_test::destroy(system);
    scenario.end();
}
