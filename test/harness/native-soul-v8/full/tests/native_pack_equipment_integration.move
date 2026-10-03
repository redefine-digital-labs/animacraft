/// Different author/player wallets; actual Pack acquisition and native Soul.
/// Verifies persistent entitlement selection, not final appearance or remote bytes.
#[test_only]
module native_soul_v8_graph::native_pack_equipment_integration;

use native_soul_v8_graph::{bootstrap, active_maker as active,
    native_completion as complete, pack_player};
use animacraft_v8_core::maker_v8::MakerRootV8;
use animacraft_v8_core::base_registry_v8::BaseDefinitionRegistryV8;
use animacraft_v8_core::protocol_config_v8::ProtocolConfigV8;
use animacraft_v8_core::treasury_v8::MakerAccessPassV8;
use animacraft_v8_runtime::runtime_v8::{Self as runtime, RuntimeDefinitionRegistryV8,
    PackRegistryV8, MakerLoadoutV8, PackReleaseV8, PackPassV8, PackAdminCapV8};
use animacraft_v8_output::output_v8::{NativeSoulBindingV8, CompleteOutputV8, CompleteReceiptV8};
use soulidity::soul::{Self as soul, SoulState};
use soulidity::animacraft_equipment_adapter_v8 as equipment;
use sui::test_scenario as scenario;
use sui::sui::SUI;

fun run_pack_case(case: u8) {
    let author = @0xA11;
    let holder = @0xB22;
    let mut scenario = scenario::begin(author);
    let (protocol_id, setup, mut system) = bootstrap::initialize_for_testing(&mut scenario);
    let maker = if (case >= 4) active::new_active_sparse_parts_for_testing(
        &mut scenario, protocol_id, setup, &mut system)
        else active::new_active_maker_for_testing(&mut scenario, protocol_id, setup, &mut system);
    let selection_index = if (case >= 4) 1 else 0;
    let market = complete::initialize_market_for_testing(&mut scenario);
    let pack = pack_player::publish_pack_for_testing(&mut scenario, maker);
    let (release_id, pack_admin_id, _) = pack_player::published_ids_for_testing(pack);
    scenario.next_tx(holder);
    let completed = complete::mint_for_testing(&mut scenario, protocol_id, setup,
        active::maker_objects_for_testing(maker), market, &mut system);
    let second = if (case == 3) option::some(complete::repeat_mint_for_testing(
        &mut scenario, protocol_id, setup, active::maker_objects_for_testing(maker),
        market, &mut system, completed)) else option::none();
    let (soul_id, state_id, binding_id, output_id, receipt_id) = complete::native_ids(completed);
    let (_, _, _, _, access_id) = complete::holder_ids(completed);
    let (root_id, base_id, _, _) = active::maker_ids_for_testing(maker);
    let (definitions_id, packs_id, _, _, _, _, _, _, _) = active::companion_ids_for_testing(maker);

    let mut release = scenario.take_shared_by_id<PackReleaseV8<SUI>>(release_id);
    let packs = scenario.take_shared_by_id<PackRegistryV8>(packs_id);
    let clock = sui::clock::create_for_testing(scenario.ctx());
    let pass = runtime::issue_free_pack_pass_v8(&mut release, &packs, &clock, scenario.ctx());
    let pass_id = object::id(&pass);
    let original_pass = std::bcs::to_bytes(&pass);
    runtime::transfer_pack_pass_to_holder_v8(pass);
    clock.destroy_for_testing();
    scenario::return_shared(release);
    scenario::return_shared(packs);
    scenario.next_tx(holder);

    if (case == 2) {
        let mut release = scenario.take_shared_by_id<PackReleaseV8<SUI>>(release_id);
        let packs = scenario.take_shared_by_id<PackRegistryV8>(packs_id);
        let clock = sui::clock::create_for_testing(scenario.ctx());
        let duplicate = runtime::issue_free_pack_pass_v8(&mut release, &packs, &clock, scenario.ctx());
        runtime::transfer_pack_pass_to_holder_v8(duplicate);
        abort 99
    };

    let mut state = scenario.take_shared_by_id<SoulState>(state_id);
    let binding = scenario.take_immutable_by_id<NativeSoulBindingV8>(binding_id);
    let output = scenario.take_immutable_by_id<CompleteOutputV8>(output_id);
    let receipt = scenario.take_immutable_by_id<CompleteReceiptV8>(receipt_id);
    let original_binding = std::bcs::to_bytes(&binding);
    let original_output = std::bcs::to_bytes(&output);
    let original_receipt = std::bcs::to_bytes(&receipt);
    let root = scenario.take_shared_by_id<MakerRootV8<SUI>>(root_id);
    let protocol = scenario.take_shared_by_id<ProtocolConfigV8>(protocol_id);
    let definitions = scenario.take_shared_by_id<RuntimeDefinitionRegistryV8>(definitions_id);
    let packs = scenario.take_shared_by_id<PackRegistryV8>(packs_id);
    let access = scenario.take_from_sender_by_id<MakerAccessPassV8>(access_id);
    let equipment_id = equipment::create_equipment_v8(&mut state, &binding,
        &root, &protocol, &definitions, &packs, &access, scenario.ctx());
    let second_equipment = if (second.is_some()) {
        let (_, second_state_id, second_binding_id, _, _) = complete::native_ids(*second.borrow());
        let mut second_state = scenario.take_shared_by_id<SoulState>(second_state_id);
        let second_binding = scenario.take_immutable_by_id<NativeSoulBindingV8>(second_binding_id);
        let id = equipment::create_equipment_v8(&mut second_state, &second_binding,
            &root, &protocol, &definitions, &packs, &access, scenario.ctx());
        scenario::return_shared(second_state);
        scenario::return_immutable(second_binding);
        option::some(id)
    } else option::none();
    scenario.return_to_sender(access);
    scenario::return_shared(state);
    scenario::return_shared(root);
    scenario::return_shared(protocol);
    scenario::return_shared(definitions);
    scenario::return_shared(packs);
    scenario::return_immutable(binding);
    scenario::return_immutable(output);
    scenario::return_immutable(receipt);
    scenario.next_tx(holder);

    let state = scenario.take_shared_by_id<SoulState>(state_id);
    let mut equipped = scenario.take_shared_by_id<MakerLoadoutV8>(equipment_id);
    let access = scenario.take_from_sender_by_id<MakerAccessPassV8>(access_id);
    let pass = scenario.take_from_sender_by_id<PackPassV8>(pass_id);
    let release = scenario.take_shared_by_id<PackReleaseV8<SUI>>(release_id);
    let root = scenario.take_shared_by_id<MakerRootV8<SUI>>(root_id);
    let protocol = scenario.take_shared_by_id<ProtocolConfigV8>(protocol_id);
    let definitions = scenario.take_shared_by_id<RuntimeDefinitionRegistryV8>(definitions_id);
    let packs = scenario.take_shared_by_id<PackRegistryV8>(packs_id);
    let base = scenario.take_shared_by_id<BaseDefinitionRegistryV8>(base_id);
    let update = equipment::begin_update_v8(&state, &mut equipped, &protocol, 0, scenario.ctx());
    equipment::select_pack_v8(&update, &mut equipped, &root, &definitions,
        &packs, &base, &release, &pass, &access, 0,
        if (case >= 4) option::some(if (case == 5) 2 else selection_index) else option::none(), b"part".to_string(),
        b"pack-item".to_string(), b"pack-style".to_string(), option::none(), scenario.ctx());
    if (case == 6) {
        equipment::select_pack_v8(&update, &mut equipped, &root, &definitions,
            &packs, &base, &release, &pass, &access, 1, option::some(selection_index), b"part".to_string(),
            b"pack-item".to_string(), b"pack-style".to_string(), option::none(), scenario.ctx());
        abort 99
    };
    if (case == 4) assert!(runtime::loadout_selections_v8(&equipped)[0].is_none()
        && runtime::loadout_selections_v8(&equipped)[1].is_some(), 99);
    assert!(runtime::loadout_selection_count_v8(&equipped) == 1
        && runtime::loadout_revision_v8(&equipped) == 1, 99);
    // The real proof checks exact release, pass, source class/epoch, pricing and
    // style commitment, not just a nonempty selection vector.
    let proof = runtime::prove_pack_selection_v8(&equipped, &packs, &release,
        &pass, &root, &access, selection_index, scenario.ctx());
    std::unit_test::destroy(proof);
    let selected = std::bcs::to_bytes(runtime::loadout_selection_v8(&equipped, selection_index));
    equipment::finish_update_v8(&mut equipped, &definitions, &base, vector[], update);
    if (second.is_some()) {
        let (second_soul_id, second_state_id, _, _, _) = complete::native_ids(*second.borrow());
        let second_state = scenario.take_shared_by_id<SoulState>(second_state_id);
        let mut other = scenario.take_shared_by_id<MakerLoadoutV8>(*second_equipment.borrow());
        let update = equipment::begin_update_v8(&second_state, &mut other, &protocol, 0, scenario.ctx());
        equipment::select_pack_v8(&update, &mut other, &root, &definitions,
            &packs, &base, &release, &pass, &access, 0, option::none(), b"part".to_string(),
            b"pack-item".to_string(), b"pack-style".to_string(), option::none(), scenario.ctx());
        equipment::finish_update_v8(&mut other, &definitions, &base, vector[], update);
        assert!(soul_id != second_soul_id && object::id(&other) != equipment_id
            && runtime::soul_equipment_soul_id_v8(&other) == second_soul_id
            && runtime::loadout_selection_count_v8(&other) == 1
            && runtime::loadout_selection_count_v8(&equipped) == 1, 99);
        let proof = runtime::prove_pack_selection_v8(&other, &packs, &release,
            &pass, &root, &access, 0, scenario.ctx());
        std::unit_test::destroy(proof);
        assert!(std::bcs::to_bytes(runtime::loadout_selection_v8(&equipped, 0)) == selected, 99);
        scenario::return_shared(second_state);
        scenario::return_shared(other);
    };
    scenario::return_shared(state);
    scenario::return_shared(equipped);
    scenario.return_to_sender(access);
    scenario.return_to_sender(pass);
    scenario::return_shared(release);
    scenario::return_shared(root);
    scenario::return_shared(protocol);
    scenario::return_shared(definitions);
    scenario::return_shared(packs);
    scenario::return_shared(base);
    scenario.next_tx(author);
    if (case == 1) {
        let mut release = scenario.take_shared_by_id<PackReleaseV8<SUI>>(release_id);
        let admin = scenario.take_from_sender_by_id<PackAdminCapV8>(pack_admin_id);
        runtime::pause_pack_release_v8(&mut release, &admin, scenario.ctx());
        scenario::return_shared(release);
        scenario.return_to_sender(admin);
    };
    scenario.next_tx(holder);

    // Removal remains available even when the author has paused the source.
    let mut state = scenario.take_shared_by_id<SoulState>(state_id);
    let mut equipped = scenario.take_shared_by_id<MakerLoadoutV8>(equipment_id);
    let protocol = scenario.take_shared_by_id<ProtocolConfigV8>(protocol_id);
    let pass = scenario.take_from_sender_by_id<PackPassV8>(pass_id);
    equipment::assert_equipment_read_v8(&state, &equipped, &protocol, scenario.ctx());
    assert!(soul::soul_id(&state) == soul_id && soul::current_owner(&state) == holder
        && runtime::soul_equipment_soul_id_v8(&equipped) == soul_id
        && runtime::soul_equipment_state_id_v8(&equipped) == state_id
        && runtime::loadout_revision_v8(&equipped) == 1
        && runtime::loadout_selection_count_v8(&equipped) == 1
        && std::bcs::to_bytes(runtime::loadout_selection_v8(&equipped, selection_index)) == selected
        && std::bcs::to_bytes(&pass) == original_pass, 99);
    let definitions = scenario.take_shared_by_id<RuntimeDefinitionRegistryV8>(definitions_id);
    let base = scenario.take_shared_by_id<BaseDefinitionRegistryV8>(base_id);
    if (second.is_some()) {
        let (second_soul_id, second_state_id, _, _, _) = complete::native_ids(*second.borrow());
        let mut second_state = scenario.take_shared_by_id<SoulState>(second_state_id);
        let mut other = scenario.take_shared_by_id<MakerLoadoutV8>(*second_equipment.borrow());
        let root = scenario.take_shared_by_id<MakerRootV8<SUI>>(root_id);
        let packs = scenario.take_shared_by_id<PackRegistryV8>(packs_id);
        let release = scenario.take_shared_by_id<PackReleaseV8<SUI>>(release_id);
        let access = scenario.take_from_sender_by_id<MakerAccessPassV8>(access_id);
        equipment::assert_equipment_read_v8(&second_state, &other, &protocol, scenario.ctx());
        assert!(soul::soul_id(&second_state) == second_soul_id
            && soul::animacraft_native_equipment_id_v8(&second_state) == object::id(&other)
            && runtime::soul_equipment_soul_id_v8(&other) == second_soul_id
            && runtime::loadout_selection_count_v8(&other) == 1
            && runtime::loadout_revision_v8(&other) == 1
            && std::bcs::to_bytes(runtime::loadout_selection_v8(&other, 0)) == selected, 99);
        let first_proof = runtime::prove_pack_selection_v8(&equipped, &packs, &release,
            &pass, &root, &access, 0, scenario.ctx());
        let second_proof = runtime::prove_pack_selection_v8(&other, &packs, &release,
            &pass, &root, &access, 0, scenario.ctx());
        std::unit_test::destroy(first_proof);
        std::unit_test::destroy(second_proof);
        let update = equipment::begin_update_v8(&second_state, &mut other, &protocol, 1, scenario.ctx());
        equipment::clear_selection_v8(&update, &mut other, 1, 0, scenario.ctx());
        equipment::finish_update_v8(&mut other, &definitions, &base, vector[], update);
        equipment::close_empty_equipment_v8(&mut second_state, other, &protocol, 2, scenario.ctx());
        assert!(runtime::loadout_selection_count_v8(&equipped) == 1
            && runtime::loadout_revision_v8(&equipped) == 1
            && std::bcs::to_bytes(runtime::loadout_selection_v8(&equipped, 0)) == selected, 99);
        scenario::return_shared(second_state);
        scenario::return_shared(root);
        scenario::return_shared(packs);
        scenario::return_shared(release);
        scenario.return_to_sender(access);
    };
    let update = equipment::begin_update_v8(&state, &mut equipped, &protocol, 1, scenario.ctx());
    equipment::clear_selection_v8(&update, &mut equipped, 1, selection_index, scenario.ctx());
    equipment::finish_update_v8(&mut equipped, &definitions, &base, vector[], update);
    scenario::return_shared(definitions);
    scenario::return_shared(base);
    assert!(runtime::loadout_selection_count_v8(&equipped) == 0
        && runtime::loadout_revision_v8(&equipped) == 2, 99);
    equipment::close_empty_equipment_v8(&mut state, equipped, &protocol, 2, scenario.ctx());
    scenario::return_shared(state);
    scenario::return_shared(protocol);
    scenario.return_to_sender(pass);
    scenario.next_tx(holder);

    let state = scenario.take_shared_by_id<SoulState>(state_id);
    let pass = scenario.take_from_sender_by_id<PackPassV8>(pass_id);
    let binding = scenario.take_immutable_by_id<NativeSoulBindingV8>(binding_id);
    let output = scenario.take_immutable_by_id<CompleteOutputV8>(output_id);
    let receipt = scenario.take_immutable_by_id<CompleteReceiptV8>(receipt_id);
    if (second.is_some()) {
        let (_, second_state_id, _, _, _) = complete::native_ids(*second.borrow());
        let second_state = scenario.take_shared_by_id<SoulState>(second_state_id);
        assert!(!soul::has_animacraft_native_equipment_v8(&second_state), 99);
        scenario::return_shared(second_state);
    };
    assert!(!soul::has_animacraft_native_equipment_v8(&state)
        && soul::animacraft_native_v8_binding_id(&state) == binding_id
        && std::bcs::to_bytes(&pass) == original_pass
        && std::bcs::to_bytes(&binding) == original_binding
        && std::bcs::to_bytes(&output) == original_output
        && std::bcs::to_bytes(&receipt) == original_receipt, 99);
    scenario::return_shared(state);
    scenario.return_to_sender(pass);
    scenario::return_immutable(binding);
    scenario::return_immutable(output);
    scenario::return_immutable(receipt);
    std::unit_test::destroy(system);
    scenario.end();
}

#[test]
fun actual_player_acquires_pack_equips_native_soul_reloads_and_clears() { run_pack_case(0); }

#[test]
fun actual_player_clears_native_pack_equipment_after_author_pauses_pack() { run_pack_case(1); }

#[test, expected_failure(abort_code = 34, location = animacraft_v8_runtime::runtime_v8)]
fun actual_native_holder_cannot_claim_duplicate_pack_access() { run_pack_case(2); }

#[test]
fun actual_pack_access_can_support_two_souls_without_an_instance_lock() { run_pack_case(3); }

#[test]
fun actual_native_pack_selection_preserves_sparse_slot_through_reload_and_clear() { run_pack_case(4); }

#[test, expected_failure(abort_code = 13, location = animacraft_v8_runtime::runtime_v8)]
fun actual_native_pack_selection_rejects_target_outside_part() { run_pack_case(5); }

#[test, expected_failure(abort_code = 11, location = animacraft_v8_runtime::runtime_v8)]
fun actual_native_pack_selection_rejects_occupied_target() { run_pack_case(6); }
