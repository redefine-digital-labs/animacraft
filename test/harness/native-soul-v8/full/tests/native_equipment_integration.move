/// Actual Complete authorization and native mint precede every equipment case.
/// This proves contract state/locks, not browser appearance or remote storage.
#[test_only]
module native_soul_v8_graph::native_equipment_integration;

use native_soul_v8_graph::{bootstrap, active_maker as active, native_completion as complete};
use animacraft_v8_core::maker_v8::MakerRootV8;
use animacraft_v8_core::base_registry_v8::BaseDefinitionRegistryV8;
use animacraft_v8_core::protocol_config_v8::ProtocolConfigV8;
use animacraft_v8_core::treasury_v8::MakerAccessPassV8;
use animacraft_v8_runtime::runtime_v8::{Self as runtime, RuntimeDefinitionRegistryV8,
    PackRegistryV8, MakerLoadoutV8, OwnedBaseItemV8};
use animacraft_v8_output::output_v8::{NativeSoulBindingV8, CompleteOutputV8, CompleteReceiptV8};
use soulidity::soul::{Self as soul, SoulState};
use soulidity::animacraft_equipment_adapter_v8 as equipment;
use sui::test_scenario as scenario;
use sui::sui::SUI;

fun run_native_equipment_case(case: u8) {
    let holder = @0xA11;
    let mut scenario = scenario::begin(holder);
    let (protocol_id, setup, mut system) = bootstrap::initialize_for_testing(&mut scenario);
    let maker = if (case >= 4) active::new_active_sparse_parts_for_testing(
        &mut scenario, protocol_id, setup, &mut system)
        else active::new_active_maker_for_testing(&mut scenario, protocol_id, setup, &mut system);
    let market = complete::initialize_market_for_testing(&mut scenario);
    let completed = complete::mint_for_testing(&mut scenario, protocol_id, setup,
        active::maker_objects_for_testing(maker), market, &mut system);
    let (soul_id, state_id, binding_id, output_id, receipt_id) = complete::native_ids(completed);
    let (_, _, player_id, item_id, access_id) = complete::holder_ids(completed);
    let (root_id, base_id, _, _) = active::maker_ids_for_testing(maker);
    let (definitions_id, packs_id, _, _, _, _, _, _, _) = active::companion_ids_for_testing(maker);

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
    let mut player = scenario.take_from_sender_by_id<MakerLoadoutV8>(player_id);
    let mut item = scenario.take_from_sender_by_id<OwnedBaseItemV8>(item_id);
    assert!(runtime::owned_base_item_locked_v8(&item), 99);
    // The finished Player's live instance lock is distinct from frozen output
    // provenance. Release it through the normal operation, never a field write.
    if (case != 1) {
        let revision = runtime::loadout_revision_v8(&player);
        runtime::unequip_owned_base_style_v8(&mut player, &mut item, revision, scenario.ctx());
        assert!(!runtime::owned_base_item_locked_v8(&item), 99);
        assert!(runtime::loadout_selection_count_v8(&player) == 0, 99);
    };
    let equipment_id = equipment::create_equipment_v8(&mut state, &binding,
        &root, &protocol, &definitions, &packs, &access, scenario.ctx());
    assert!(soul::animacraft_native_equipment_id_v8(&state) == equipment_id, 99);
    scenario.return_to_sender(player);
    scenario.return_to_sender(item);
    scenario.return_to_sender(access);
    scenario::return_shared(state);
    scenario::return_shared(root);
    scenario::return_shared(protocol);
    scenario::return_shared(definitions);
    scenario::return_shared(packs);
    scenario::return_immutable(binding);
    scenario::return_immutable(output);
    scenario::return_immutable(receipt);
    scenario.next_tx(if (case == 3) @0xB22 else holder);

    if (case == 3) {
        let state = scenario.take_shared_by_id<SoulState>(state_id);
        let equipped = scenario.take_shared_by_id<MakerLoadoutV8>(equipment_id);
        let protocol = scenario.take_shared_by_id<ProtocolConfigV8>(protocol_id);
        equipment::assert_equipment_read_v8(&state, &equipped, &protocol, scenario.ctx());
        abort 99
    };

    let state = scenario.take_shared_by_id<SoulState>(state_id);
    let mut equipped = scenario.take_shared_by_id<MakerLoadoutV8>(equipment_id);
    let mut item = scenario.take_from_sender_by_id<OwnedBaseItemV8>(item_id);
    let access = scenario.take_from_sender_by_id<MakerAccessPassV8>(access_id);
    let root = scenario.take_shared_by_id<MakerRootV8<SUI>>(root_id);
    let protocol = scenario.take_shared_by_id<ProtocolConfigV8>(protocol_id);
    let definitions = scenario.take_shared_by_id<RuntimeDefinitionRegistryV8>(definitions_id);
    let packs = scenario.take_shared_by_id<PackRegistryV8>(packs_id);
    let base = scenario.take_shared_by_id<BaseDefinitionRegistryV8>(base_id);
    let update = equipment::begin_update_v8(&state, &mut equipped, &protocol, 0, scenario.ctx());
    equipment::equip_base_v8(&update, &mut equipped, &mut item,
        &root, &definitions, &packs, &base, &access, 0,
        if (case >= 4) option::some(if (case == 5) 2 else 1) else option::none(), b"style".to_string(),
        option::none(), scenario.ctx());
    assert!(case != 1, 99);
    assert!(runtime::owned_base_item_locked_v8(&item)
        && runtime::loadout_revision_v8(&equipped) == 1
        && runtime::loadout_selection_count_v8(&equipped) == 1, 99);
    if (case == 4) {
        let before = *runtime::loadout_commitment_v8(&equipped);
        assert!(runtime::loadout_selections_v8(&equipped)[0].is_none()
            && runtime::loadout_selections_v8(&equipped)[1].is_some(), 99);
        let proof = runtime::prove_owned_base_selection_v8(&equipped, &item, &definitions,
            &packs, &base, &root, &access, 1, scenario.ctx());
        std::unit_test::destroy(proof);
        // One transaction removes the real instance lock then restores the
        // exact sparse slot; no intermediate wallet transaction is required.
        equipment::unequip_base_v8(&update, &mut equipped, &mut item, 1, scenario.ctx());
        equipment::equip_base_v8(&update, &mut equipped, &mut item,
            &root, &definitions, &packs, &base, &access, 2, option::some(1),
            b"style".to_string(), option::none(), scenario.ctx());
        assert!(*runtime::loadout_commitment_v8(&equipped) == before
            && runtime::loadout_revision_v8(&equipped) == 3, 99);
        let proof = runtime::prove_owned_base_selection_v8(&equipped, &item, &definitions,
            &packs, &base, &root, &access, 1, scenario.ctx());
        std::unit_test::destroy(proof);
    };
    equipment::finish_update_v8(&mut equipped, &definitions, &base, vector[], update);
    scenario::return_shared(state);
    scenario::return_shared(equipped);
    scenario.return_to_sender(item);
    scenario.return_to_sender(access);
    scenario::return_shared(root);
    scenario::return_shared(protocol);
    scenario::return_shared(definitions);
    scenario::return_shared(packs);
    scenario::return_shared(base);
    scenario.next_tx(holder);

    // Reload the exact state and object IDs, not the previous in-memory values.
    let mut state = scenario.take_shared_by_id<SoulState>(state_id);
    let mut equipped = scenario.take_shared_by_id<MakerLoadoutV8>(equipment_id);
    let mut item = scenario.take_from_sender_by_id<OwnedBaseItemV8>(item_id);
    let protocol = scenario.take_shared_by_id<ProtocolConfigV8>(protocol_id);
    equipment::assert_equipment_read_v8(&state, &equipped, &protocol, scenario.ctx());
    assert!(soul::soul_id(&state) == soul_id && soul::current_owner(&state) == holder
        && soul::ownership_epoch(&state) == 0
        && soul::animacraft_native_equipment_id_v8(&state) == equipment_id
        && runtime::soul_equipment_soul_id_v8(&equipped) == soul_id
        && runtime::soul_equipment_state_id_v8(&equipped) == state_id
        && runtime::loadout_selection_count_v8(&equipped) == 1
        && runtime::owned_base_item_locked_v8(&item), 99);
    if (case == 2) {
        equipment::close_empty_equipment_v8(&mut state, equipped, &protocol, 1, scenario.ctx());
        abort 99
    };
    let revision = if (case == 4) 3 else 1;
    if (case == 4) assert!(runtime::loadout_selections_v8(&equipped)[0].is_none()
        && runtime::loadout_selections_v8(&equipped)[1].is_some(), 99);
    let definitions = scenario.take_shared_by_id<RuntimeDefinitionRegistryV8>(definitions_id);
    let base = scenario.take_shared_by_id<BaseDefinitionRegistryV8>(base_id);
    let update = equipment::begin_update_v8(&state, &mut equipped, &protocol, revision, scenario.ctx());
    equipment::unequip_base_v8(&update, &mut equipped, &mut item, revision, scenario.ctx());
    equipment::finish_update_v8(&mut equipped, &definitions, &base, vector[], update);
    scenario::return_shared(definitions);
    scenario::return_shared(base);
    assert!(!runtime::owned_base_item_locked_v8(&item)
        && runtime::loadout_selection_count_v8(&equipped) == 0
        && runtime::loadout_revision_v8(&equipped) == revision + 1, 99);
    equipment::close_empty_equipment_v8(&mut state, equipped, &protocol, revision + 1, scenario.ctx());
    assert!(!soul::has_animacraft_native_equipment_v8(&state), 99);
    scenario.return_to_sender(item);
    scenario::return_shared(state);
    scenario::return_shared(protocol);
    scenario.next_tx(holder);

    let state = scenario.take_shared_by_id<SoulState>(state_id);
    let item = scenario.take_from_sender_by_id<OwnedBaseItemV8>(item_id);
    let binding = scenario.take_immutable_by_id<NativeSoulBindingV8>(binding_id);
    let output = scenario.take_immutable_by_id<CompleteOutputV8>(output_id);
    let receipt = scenario.take_immutable_by_id<CompleteReceiptV8>(receipt_id);
    assert!(!soul::has_animacraft_native_equipment_v8(&state)
        && !runtime::owned_base_item_locked_v8(&item)
        && runtime::owned_base_item_holder_v8(&item) == holder
        && soul::animacraft_native_v8_binding_id(&state) == binding_id
        && std::bcs::to_bytes(&binding) == original_binding
        && std::bcs::to_bytes(&output) == original_output
        && std::bcs::to_bytes(&receipt) == original_receipt, 99);
    scenario::return_shared(state);
    scenario.return_to_sender(item);
    scenario::return_immutable(binding);
    scenario::return_immutable(output);
    scenario::return_immutable(receipt);
    std::unit_test::destroy(system);
    scenario.end();
}

#[test]
fun actual_complete_native_soul_equips_reloads_removes_and_preserves_original() {
    run_native_equipment_case(0);
}

#[test, expected_failure(abort_code = 18, location = animacraft_v8_runtime::runtime_v8)]
fun actual_complete_native_soul_rejects_component_still_locked_in_player() {
    run_native_equipment_case(1);
}

#[test, expected_failure(abort_code = 18, location = animacraft_v8_runtime::runtime_v8)]
fun actual_complete_native_soul_cannot_close_nonempty_equipment() {
    run_native_equipment_case(2);
}

#[test, expected_failure(abort_code = 1, location = soulidity::soul)]
fun actual_complete_native_soul_equipment_rejects_another_wallet() {
    run_native_equipment_case(3);
}

#[test]
fun actual_native_owned_base_preserves_sparse_slot_and_lock_through_atomic_restore() {
    run_native_equipment_case(4);
}

#[test, expected_failure(abort_code = 13, location = animacraft_v8_runtime::runtime_v8)]
fun actual_native_owned_base_rejects_target_outside_part_capacity() {
    run_native_equipment_case(5);
}
