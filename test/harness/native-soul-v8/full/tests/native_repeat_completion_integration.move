/// Multiple explicit completions reuse one real player entitlement and Kiosk.
/// This is not retrying an already consumed authorization or inventing a second
/// component. Remote bytes and browser transaction recovery are separate gates.
#[test_only]
module native_soul_v8_graph::native_repeat_completion_integration;

use native_soul_v8_graph::{bootstrap, active_maker as active, native_completion as complete};
use native_soul_v8_graph::native_completion::NativeCompletionIds;
use animacraft_v8_output::output_v8::{Self as output, NativeSoulBindingV8,
    CompleteOutputV8, CompleteReceiptV8, OutputRegistryV8, SoulRegistryV8};
use animacraft_v8_runtime::runtime_v8::{Self as runtime, MakerLoadoutV8, OwnedBaseItemV8};
use animacraft_v8_core::treasury_v8::MakerAccessPassV8;
use soulidity::soul::{Self as soul, Soul, SoulState};
use sui::test_scenario::{Self as scenario, Scenario};
use sui::kiosk::{Self as kiosk, Kiosk};
use kiosk::personal_kiosk::{Self as personal, PersonalKioskCap};

fun read_exact_original_and_player(scenario: &mut Scenario, ids: NativeCompletionIds): vector<vector<u8>> {
    let holder = scenario.ctx().sender();
    let (soul_id, state_id, binding_id, output_id, receipt_id) = complete::native_ids(ids);
    let (kiosk_id, cap_id, player_id, item_id, access_id) = complete::holder_ids(ids);
    let state = scenario.take_shared_by_id<SoulState>(state_id);
    let binding = scenario.take_immutable_by_id<NativeSoulBindingV8>(binding_id);
    let completed = scenario.take_immutable_by_id<CompleteOutputV8>(output_id);
    let receipt = scenario.take_immutable_by_id<CompleteReceiptV8>(receipt_id);
    let held = scenario.take_shared_by_id<Kiosk>(kiosk_id);
    let cap = scenario.take_from_sender_by_id<PersonalKioskCap>(cap_id);
    let item = scenario.take_from_sender_by_id<OwnedBaseItemV8>(item_id);
    let player = scenario.take_from_sender_by_id<MakerLoadoutV8>(player_id);
    let access = scenario.take_from_sender_by_id<MakerAccessPassV8>(access_id);
    assert!(soul::soul_id(&state) == soul_id && soul::current_owner(&state) == holder
        && soul::current_kiosk_id(&state) == kiosk_id && soul::ownership_epoch(&state) == 0
        && soul::animacraft_native_v8_binding_id(&state) == binding_id
        && !soul::is_listed(&state) && !soul::has_animacraft_native_equipment_v8(&state), 99);
    assert!(output::native_soul_binding_soul_id_v8(&binding) == soul_id
        && output::native_soul_binding_state_id_v8(&binding) == state_id
        && output::native_soul_binding_output_id_v8(&binding) == output_id
        && output::native_soul_binding_receipt_id_v8(&binding) == receipt_id
        && output::native_soul_binding_original_holder_v8(&binding) == holder, 99);
    assert!(runtime::owned_base_item_locked_v8(&item)
        && runtime::owned_base_item_holder_v8(&item) == holder
        && runtime::loadout_selection_count_v8(&player) == 1, 99);
    let held_soul = kiosk::borrow<Soul>(&held, personal::borrow(&cap), soul_id);
    let evidence = vector[std::bcs::to_bytes(&state), std::bcs::to_bytes(&binding),
        std::bcs::to_bytes(&completed), std::bcs::to_bytes(&receipt),
        std::bcs::to_bytes(held_soul), std::bcs::to_bytes(&item),
        std::bcs::to_bytes(&player), std::bcs::to_bytes(&access), std::bcs::to_bytes(&cap)];
    scenario::return_shared(state); scenario::return_shared(held);
    scenario::return_immutable(binding); scenario::return_immutable(completed);
    scenario::return_immutable(receipt);
    scenario.return_to_sender(cap); scenario.return_to_sender(item);
    scenario.return_to_sender(player); scenario.return_to_sender(access);
    scenario.next_tx(holder);
    evidence
}

fun distinct_complete_ids(left: NativeCompletionIds, right: NativeCompletionIds) {
    let (a, b, c, d, e) = complete::native_ids(left);
    let (f, g, h, i, j) = complete::native_ids(right);
    let originals = vector[a, b, c, d, e];
    let newer = vector[f, g, h, i, j];
    let mut n = 0u64;
    while (n < newer.length()) {
        assert!(!originals.contains(newer.borrow(n)), 99);
        let mut k = n + 1;
        while (k < newer.length()) {
            assert!(newer.borrow(n) != newer.borrow(k), 99);
            k = k + 1;
        };
        n = n + 1;
    };
    let (kiosk_a, cap_a, player_a, item_a, access_a) = complete::holder_ids(left);
    let (kiosk_b, cap_b, player_b, item_b, access_b) = complete::holder_ids(right);
    assert!(kiosk_a == kiosk_b && cap_a == cap_b && player_a == player_b
        && item_a == item_b && access_a == access_b, 99);
}

fun run_repeated_complete(count: u64) {
    let holder = @0xA11;
    let mut scenario = scenario::begin(holder);
    let (protocol_id, setup, mut system) = bootstrap::initialize_for_testing(&mut scenario);
    let maker = active::new_active_maker_for_testing(&mut scenario, protocol_id, setup, &mut system);
    let maker_objects = active::maker_objects_for_testing(maker);
    let market = complete::initialize_market_for_testing(&mut scenario);
    let first = complete::mint_for_testing(&mut scenario, protocol_id, setup, maker_objects, market, &mut system);
    let original = read_exact_original_and_player(&mut scenario, first);
    let mut results = vector[first];
    let mut snapshots = vector[original];
    let mut n = 1u64;
    while (n < count) {
        // Use the previous result only as exact existing player/Kiosk IDs.
        // Every iteration produces fresh actual Runtime and Release proofs.
        let next = complete::repeat_mint_for_testing(&mut scenario, protocol_id,
            setup, maker_objects, market, &mut system, *results.borrow(n - 1));
        let mut previous = 0u64;
        while (previous < results.length()) {
            distinct_complete_ids(*results.borrow(previous), next);
            previous = previous + 1;
        };
        let current = read_exact_original_and_player(&mut scenario, next);
        // Soul/state/receipt IDs differ, while the exact existing item, player,
        // access and cap bytes remain the original held resources.
        let mut player_field = 5u64;
        while (player_field < original.length()) {
            assert!(current.borrow(player_field) == original.borrow(player_field), 99);
            player_field = player_field + 1;
        };
        let mut old_index = 0u64;
        while (old_index < results.length()) {
            let actual = read_exact_original_and_player(&mut scenario, *results.borrow(old_index));
            assert!(&actual == snapshots.borrow(old_index), 99);
            old_index = old_index + 1;
        };
        results.push_back(next);
        snapshots.push_back(current);
        n = n + 1;
    };
    let (_, _, _, _, output_id, souls_id, _, _, _) = active::companion_ids_for_testing(maker);
    let output = scenario.take_shared_by_id<OutputRegistryV8>(output_id);
    let souls = scenario.take_shared_by_id<SoulRegistryV8>(souls_id);
    let (kiosk_id, _, _, _, _) = complete::holder_ids(first);
    let held = scenario.take_shared_by_id<Kiosk>(kiosk_id);
    assert!(output::output_registry_total_complete_count_v8(&output) == count
        && output::output_registry_output_count_v8(&output) == count
        && output::soul_registry_soul_count_v8(&souls) == count
        && kiosk::item_count(&held) == (count as u32), 99);
    scenario::return_shared(output); scenario::return_shared(souls); scenario::return_shared(held);
    std::unit_test::destroy(system);
    scenario.end();
}

#[test]
fun two_explicit_completions_reuse_existing_player_and_preserve_first_soul() {
    run_repeated_complete(2);
}

#[test]
fun third_explicit_completion_reuses_same_access_component_and_kiosk() {
    run_repeated_complete(3);
}
