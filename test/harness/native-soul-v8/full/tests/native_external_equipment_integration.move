/// Actual independently authored External product -> Maker admission -> owned
/// instance -> two native Souls. Content hashes are declared fixture inputs,
/// not a remote-byte or browser-composition acceptance claim.
#[test_only]
module native_soul_v8_graph::native_external_equipment_integration;

use native_soul_v8_graph::{bootstrap, active_maker as active, native_completion as complete};
use native_soul_v8_graph::active_maker::ActiveMakerIds;
use native_soul_v8_graph::native_completion::NativeCompletionIds;
use animacraft_v8_core::maker_v8::{MakerRootV8, MakerAdminCapV8};
use animacraft_v8_core::base_registry_v8::BaseDefinitionRegistryV8;
use animacraft_v8_core::protocol_config_v8::ProtocolConfigV8;
use animacraft_v8_core::treasury_v8::MakerAccessPassV8;
use animacraft_v8_runtime::runtime_v8::{Self as runtime, RuntimeDefinitionRegistryV8,
    PackRegistryV8, PackAdmissionAuthorityV8, MakerLoadoutV8,
    ExternalItemProductV8, OwnedExternalItemV8};
use animacraft_v8_output::output_v8::{NativeSoulBindingV8, CompleteOutputV8, CompleteReceiptV8};
use soulidity::soul::{Self as soul, SoulState};
use soulidity::animacraft_equipment_adapter_v8 as equipment;
use sui::test_scenario::{Self as scenario, Scenario};
use sui::sui::SUI;

public struct OriginalBytes has copy, drop {
    binding: vector<u8>, output: vector<u8>, receipt: vector<u8>,
}
public struct ExternalCaseIds has copy, drop {
    protocol: ID, maker: ActiveMakerIds, first: NativeCompletionIds,
    second: NativeCompletionIds, product: ID, item: ID,
    first_equipment: ID, second_equipment: ID, original_item: vector<u8>,
    target_selection_index: Option<u64>,
}
public struct ExternalContext {
    root: MakerRootV8<SUI>, protocol: ProtocolConfigV8,
    definitions: RuntimeDefinitionRegistryV8, base: BaseDefinitionRegistryV8, packs: PackRegistryV8,
    product: ExternalItemProductV8, access: MakerAccessPassV8,
    target_selection_index: Option<u64>,
}

fun original_bytes(scenario: &Scenario, ids: NativeCompletionIds): OriginalBytes {
    let (_, _, binding_id, output_id, receipt_id) = complete::native_ids(ids);
    let binding = scenario.take_immutable_by_id<NativeSoulBindingV8>(binding_id);
    let output = scenario.take_immutable_by_id<CompleteOutputV8>(output_id);
    let receipt = scenario.take_immutable_by_id<CompleteReceiptV8>(receipt_id);
    let bytes = OriginalBytes { binding: std::bcs::to_bytes(&binding),
        output: std::bcs::to_bytes(&output), receipt: std::bcs::to_bytes(&receipt) };
    scenario::return_immutable(binding);
    scenario::return_immutable(output);
    scenario::return_immutable(receipt);
    bytes
}

fun take_context(scenario: &Scenario, ids: ExternalCaseIds): ExternalContext {
    let (root_id, base_id, _, _) = active::maker_ids_for_testing(ids.maker);
    let (definitions_id, packs_id, _, _, _, _, _, _, _) = active::companion_ids_for_testing(ids.maker);
    let (_, _, _, _, access_id) = complete::holder_ids(ids.first);
    ExternalContext {
        root: scenario.take_shared_by_id<MakerRootV8<SUI>>(root_id),
        protocol: scenario.take_shared_by_id<ProtocolConfigV8>(ids.protocol),
        definitions: scenario.take_shared_by_id<RuntimeDefinitionRegistryV8>(definitions_id),
        base: scenario.take_shared_by_id<BaseDefinitionRegistryV8>(base_id),
        packs: scenario.take_shared_by_id<PackRegistryV8>(packs_id),
        product: scenario.take_shared_by_id<ExternalItemProductV8>(ids.product),
        access: scenario.take_from_sender_by_id<MakerAccessPassV8>(access_id),
        target_selection_index: ids.target_selection_index,
    }
}
fun return_context(scenario: &Scenario, context: ExternalContext) {
    let ExternalContext { root, protocol, definitions, base, packs, product, access, target_selection_index: _ } = context;
    scenario::return_shared(root);
    scenario::return_shared(protocol);
    scenario::return_shared(definitions);
    scenario::return_shared(base);
    scenario::return_shared(packs);
    scenario::return_shared(product);
    scenario.return_to_sender(access);
}
fun equip(state: &SoulState, loadout: &mut MakerLoadoutV8, item: &mut OwnedExternalItemV8,
    context: &ExternalContext, revision: u64, ctx: &TxContext) {
    let update = equipment::begin_update_v8(state, loadout, &context.protocol, revision, ctx);
    equipment::equip_external_v8(&update, loadout, item,
        &context.root, &context.definitions, &context.packs, &context.product,
        &context.access, revision, context.target_selection_index, ctx);
    equipment::finish_update_v8(loadout, &context.definitions, &context.base, vector[], update);
}
fun unequip(state: &SoulState, loadout: &mut MakerLoadoutV8, item: &mut OwnedExternalItemV8,
    context: &ExternalContext, revision: u64, ctx: &TxContext) {
    let update = equipment::begin_update_v8(state, loadout, &context.protocol, revision, ctx);
    equipment::unequip_external_v8(&update, loadout, item, revision, ctx);
    equipment::finish_update_v8(loadout, &context.definitions, &context.base, vector[], update);
}
fun selected_index(context: &ExternalContext): u64 {
    if (context.target_selection_index.is_some()) *context.target_selection_index.borrow() else 0
}
fun assert_equipped(state: &SoulState, loadout: &MakerLoadoutV8,
    item: &OwnedExternalItemV8, context: &ExternalContext,
    completed: NativeCompletionIds, equipment_id: ID, ctx: &TxContext) {
    let (soul_id, state_id, binding_id, _, _) = complete::native_ids(completed);
    equipment::assert_equipment_read_v8(state, loadout, &context.protocol, ctx);
    assert!(soul::soul_id(state) == soul_id && object::id(state) == state_id
        && soul::current_owner(state) == ctx.sender() && soul::ownership_epoch(state) == 0
        && soul::animacraft_native_v8_binding_id(state) == binding_id
        && soul::animacraft_native_equipment_id_v8(state) == equipment_id
        && runtime::soul_equipment_soul_id_v8(loadout) == soul_id
        && runtime::soul_equipment_state_id_v8(loadout) == state_id
        && runtime::loadout_selection_count_v8(loadout) == 1
        && runtime::loadout_revision_v8(loadout) == 1
        && runtime::owned_item_locked_v8(item), 99);
    // This real proof validates product/instance IDs, source epoch/content,
    // current entitlement and the exact instance lock pointing at this Soul.
    let proof = runtime::prove_external_selection_v8(loadout, &context.packs,
        &context.product, item, &context.root, &context.access, selected_index(context), ctx);
    std::unit_test::destroy(proof);
    if (selected_index(context) == 1) assert!(runtime::loadout_selections_v8(loadout)[0].is_none()
        && runtime::loadout_selections_v8(loadout)[1].is_some(), 99);
}

fun run_external_equipment_case(case: u8) {
    let holder = @0xA11;
    let external_author = @0xB22;
    let mut scenario = scenario::begin(holder);
    let (protocol_id, setup, mut system) = bootstrap::initialize_for_testing(&mut scenario);
    let maker = if (case >= 4) active::new_active_sparse_parts_for_testing(
        &mut scenario, protocol_id, setup, &mut system)
        else active::new_active_maker_for_testing(&mut scenario, protocol_id, setup, &mut system);
    let market = complete::initialize_market_for_testing(&mut scenario);
    let first = complete::mint_for_testing(&mut scenario, protocol_id, setup,
        active::maker_objects_for_testing(maker), market, &mut system);
    let second = complete::repeat_mint_for_testing(&mut scenario, protocol_id, setup,
        active::maker_objects_for_testing(maker), market, &mut system, first);
    let (first_soul, first_state_id, first_binding_id, _, _) = complete::native_ids(first);
    let (second_soul, second_state_id, second_binding_id, _, _) = complete::native_ids(second);
    assert!(first_soul != second_soul && first_state_id != second_state_id
        && first_binding_id != second_binding_id, 99);
    let first_original = original_bytes(&scenario, first);
    let second_original = original_bytes(&scenario, second);
    scenario.next_tx(external_author);

    // External authors use the public constructor, not the Maker's admin cap.
    let (root_id, base_id, _, admin_id) = active::maker_ids_for_testing(maker);
    let (definitions_id, packs_id, admission_id, _, _, _, _, _, _) = active::companion_ids_for_testing(maker);
    let root = scenario.take_shared_by_id<MakerRootV8<SUI>>(root_id);
    let base = scenario.take_shared_by_id<BaseDefinitionRegistryV8>(base_id);
    let definitions = scenario.take_shared_by_id<RuntimeDefinitionRegistryV8>(definitions_id);
    let (mut product, product_admin) = runtime::new_external_item_product_v8(
        &root, &definitions, &base, b"part".to_string(), b"external-item".to_string(),
        b"external-style".to_string(), b"track".to_string(), option::none(), option::none(),
        b"external-public-fixture-blob".to_string(), fixture_hash(81),
        b"image/png".to_string(), 69, fixture_hash(82), true, scenario.ctx());
    let item = runtime::mint_owned_external_item_v8(&mut product, &product_admin, holder, scenario.ctx());
    let product_id = object::id(&product);
    let item_id = object::id(&item);
    let original_item = std::bcs::to_bytes(&item);
    assert!(!runtime::owned_item_locked_v8(&item), 99);
    runtime::share_external_item_product_v8(product);
    runtime::transfer_external_item_admin_cap_v8(product_admin, external_author);
    runtime::transfer_new_owned_item_to_holder_v8(item);
    scenario::return_shared(root);
    scenario::return_shared(base);
    scenario::return_shared(definitions);
    scenario.next_tx(holder);

    // Actual Maker policy admission is distinct from External authoring.
    let root = scenario.take_shared_by_id<MakerRootV8<SUI>>(root_id);
    let definitions = scenario.take_shared_by_id<RuntimeDefinitionRegistryV8>(definitions_id);
    let mut packs = scenario.take_shared_by_id<PackRegistryV8>(packs_id);
    let admission = scenario.take_from_sender_by_id<PackAdmissionAuthorityV8>(admission_id);
    let admin = scenario.take_from_sender_by_id<MakerAdminCapV8>(admin_id);
    let product = scenario.take_shared_by_id<ExternalItemProductV8>(product_id);
    let revision = runtime::pack_registry_revision_v8(&packs);
    runtime::admit_open_external_product_v8(&mut packs, &admission, &definitions,
        &root, &admin, &product, revision, scenario.ctx());
    assert!(runtime::pack_registry_external_count_v8(&packs) == 1
        && runtime::pack_registry_revision_v8(&packs) == revision + 1, 99);
    let (_, _, _, _, access_id) = complete::holder_ids(first);
    let access = scenario.take_from_sender_by_id<MakerAccessPassV8>(access_id);
    let protocol = scenario.take_shared_by_id<ProtocolConfigV8>(protocol_id);
    let mut first_state = scenario.take_shared_by_id<SoulState>(first_state_id);
    let mut second_state = scenario.take_shared_by_id<SoulState>(second_state_id);
    let first_binding = scenario.take_immutable_by_id<NativeSoulBindingV8>(first_binding_id);
    let second_binding = scenario.take_immutable_by_id<NativeSoulBindingV8>(second_binding_id);
    let first_equipment = equipment::create_equipment_v8(&mut first_state, &first_binding,
        &root, &protocol, &definitions, &packs, &access, scenario.ctx());
    let second_equipment = equipment::create_equipment_v8(&mut second_state, &second_binding,
        &root, &protocol, &definitions, &packs, &access, scenario.ctx());
    assert!(first_equipment != second_equipment, 99);
    let ids = ExternalCaseIds { protocol: protocol_id, maker, first, second,
        product: product_id, item: item_id, first_equipment, second_equipment, original_item,
        target_selection_index: if (case >= 4) option::some(if (case == 5) 2 else 1) else option::none() };
    scenario::return_shared(root);
    scenario::return_shared(definitions);
    scenario::return_shared(packs);
    scenario::return_shared(product);
    scenario::return_shared(protocol);
    scenario::return_shared(first_state);
    scenario::return_shared(second_state);
    scenario::return_immutable(first_binding);
    scenario::return_immutable(second_binding);
    scenario.return_to_sender(admission);
    scenario.return_to_sender(admin);
    scenario.return_to_sender(access);
    scenario.next_tx(holder);

    let context = take_context(&scenario, ids);
    let first_state = scenario.take_shared_by_id<SoulState>(first_state_id);
    let mut first_equipped = scenario.take_shared_by_id<MakerLoadoutV8>(first_equipment);
    let mut item = scenario.take_from_sender_by_id<OwnedExternalItemV8>(item_id);
    assert!(std::bcs::to_bytes(&item) == ids.original_item, 99);
    equip(&first_state, &mut first_equipped, &mut item, &context, 0, scenario.ctx());
    assert_equipped(&first_state, &first_equipped, &item, &context, first, first_equipment, scenario.ctx());
    let selection = std::bcs::to_bytes(runtime::loadout_selection_v8(&first_equipped, selected_index(&context)));
    scenario::return_shared(first_state);
    scenario::return_shared(first_equipped);
    scenario.return_to_sender(item);
    return_context(&scenario, context);
    scenario.next_tx(holder);

    // Reload the first Soul's actual lock, then attempt independent operations.
    let context = take_context(&scenario, ids);
    let mut first_state = scenario.take_shared_by_id<SoulState>(first_state_id);
    let mut second_state = scenario.take_shared_by_id<SoulState>(second_state_id);
    let mut first_equipped = scenario.take_shared_by_id<MakerLoadoutV8>(first_equipment);
    let mut second_equipped = scenario.take_shared_by_id<MakerLoadoutV8>(second_equipment);
    let mut item = scenario.take_from_sender_by_id<OwnedExternalItemV8>(item_id);
    assert_equipped(&first_state, &first_equipped, &item, &context, first, first_equipment, scenario.ctx());
    assert!(runtime::loadout_selection_count_v8(&second_equipped) == 0
        && runtime::loadout_revision_v8(&second_equipped) == 0, 99);
    if (case == 1) {
        equip(&second_state, &mut second_equipped, &mut item, &context, 0, scenario.ctx());
        abort 99
    };
    if (case == 2) {
        runtime::transfer_owned_external_item_v8(item, external_author, scenario.ctx());
        abort 99
    };
    if (case == 3) {
        unequip(&second_state, &mut second_equipped, &mut item, &context, 0, scenario.ctx());
        abort 99
    };
    unequip(&first_state, &mut first_equipped, &mut item, &context, 1, scenario.ctx());
    assert!(!runtime::owned_item_locked_v8(&item)
        && std::bcs::to_bytes(&item) == ids.original_item
        && runtime::loadout_selection_count_v8(&first_equipped) == 0
        && runtime::loadout_revision_v8(&first_equipped) == 2, 99);
    equipment::close_empty_equipment_v8(&mut first_state, first_equipped, &context.protocol, 2, scenario.ctx());
    equip(&second_state, &mut second_equipped, &mut item, &context, 0, scenario.ctx());
    assert_equipped(&second_state, &second_equipped, &item, &context, second, second_equipment, scenario.ctx());
    assert!(std::bcs::to_bytes(runtime::loadout_selection_v8(&second_equipped, selected_index(&context))) == selection, 99);
    scenario::return_shared(first_state);
    scenario::return_shared(second_state);
    scenario::return_shared(second_equipped);
    scenario.return_to_sender(item);
    return_context(&scenario, context);
    scenario.next_tx(holder);

    let context = take_context(&scenario, ids);
    let first_state = scenario.take_shared_by_id<SoulState>(first_state_id);
    let mut second_state = scenario.take_shared_by_id<SoulState>(second_state_id);
    let mut second_equipped = scenario.take_shared_by_id<MakerLoadoutV8>(second_equipment);
    let mut item = scenario.take_from_sender_by_id<OwnedExternalItemV8>(item_id);
    assert!(!soul::has_animacraft_native_equipment_v8(&first_state), 99);
    assert_equipped(&second_state, &second_equipped, &item, &context, second, second_equipment, scenario.ctx());
    unequip(&second_state, &mut second_equipped, &mut item, &context, 1, scenario.ctx());
    assert!(!runtime::owned_item_locked_v8(&item) && std::bcs::to_bytes(&item) == ids.original_item, 99);
    equipment::close_empty_equipment_v8(&mut second_state, second_equipped, &context.protocol, 2, scenario.ctx());
    scenario::return_shared(first_state);
    scenario::return_shared(second_state);
    scenario.return_to_sender(item);
    return_context(&scenario, context);
    scenario.next_tx(holder);

    let first_state = scenario.take_shared_by_id<SoulState>(first_state_id);
    let second_state = scenario.take_shared_by_id<SoulState>(second_state_id);
    let item = scenario.take_from_sender_by_id<OwnedExternalItemV8>(item_id);
    assert!(!soul::has_animacraft_native_equipment_v8(&first_state)
        && !soul::has_animacraft_native_equipment_v8(&second_state)
        && soul::current_owner(&first_state) == holder && soul::current_owner(&second_state) == holder
        && soul::ownership_epoch(&first_state) == 0 && soul::ownership_epoch(&second_state) == 0
        && !runtime::owned_item_locked_v8(&item) && std::bcs::to_bytes(&item) == ids.original_item, 99);
    assert!(original_bytes(&scenario, first) == first_original
        && original_bytes(&scenario, second) == second_original, 99);
    scenario::return_shared(first_state);
    scenario::return_shared(second_state);
    scenario.return_to_sender(item);
    std::unit_test::destroy(system);
    scenario.end();
}

fun fixture_hash(byte: u8): vector<u8> { vector::tabulate!(32, |_| byte) }

#[test]
fun actual_external_instance_moves_between_two_native_souls_after_unlock() { run_external_equipment_case(0); }

#[test, expected_failure(abort_code = 18, location = animacraft_v8_runtime::runtime_v8)]
fun actual_external_instance_cannot_equip_two_native_souls_at_once() { run_external_equipment_case(1); }

#[test, expected_failure(abort_code = 18, location = animacraft_v8_runtime::runtime_v8)]
fun actual_external_instance_cannot_transfer_while_native_soul_equipped() { run_external_equipment_case(2); }

#[test, expected_failure(abort_code = 19, location = animacraft_v8_runtime::runtime_v8)]
fun actual_external_instance_cannot_be_unlocked_by_another_native_soul() { run_external_equipment_case(3); }

#[test]
fun actual_external_instance_sparse_slot_lock_survives_reload_and_soul_transfer_after_unlock() { run_external_equipment_case(4); }

#[test, expected_failure(abort_code = 13, location = animacraft_v8_runtime::runtime_v8)]
fun actual_external_instance_rejects_target_outside_part_capacity() { run_external_equipment_case(5); }
