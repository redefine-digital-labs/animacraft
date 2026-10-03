/// Partial equipment custody is not a Soul sale or paid Market settlement.
/// Every owner/binding/selection is produced by the real author and native mint APIs.
#[test_only]
module native_soul_v8_graph::equipment_market_partial_sale_integration;

use native_soul_v8_graph::{bootstrap, active_maker as active, native_completion as complete,
    partial_sale_fixture as fixture};
use animacraft_v8_core::maker_v8::MakerRootV8;
use animacraft_v8_core::base_registry_v8::BaseDefinitionRegistryV8;
use animacraft_v8_core::treasury_v8::MakerAccessPassV8;
use animacraft_v8_core::protocol_config_v8::ProtocolConfigV8;
use animacraft_v8_core::package_binding_v8::{ProductReleaseCatalogV8, FreshTupleReplacementBindingV2};
use animacraft_v8_market::market_v8::{Self as market, MarketPackageConfigV8, MarketRegistryV8, MarketTreasuryV8};
use animacraft_v8_runtime::runtime_v8::{Self as runtime, RuntimeDefinitionRegistryV8, PackRegistryV8,
    OwnedBaseItemV8, MakerLoadoutV8, PackReleaseV8, PackPassV8, EquipmentMarketCustodyBindingV8};
use animacraft_v8_output::output_v8::{NativeSoulBindingV8, CompleteOutputV8, CompleteReceiptV8};
use soulidity::soul::{Self as soul, SoulState};
use soulidity::animacraft_equipment_adapter_v8 as equipment;
use sui::test_scenario::{Self as ts, Scenario};
use sui::sui::SUI;

public struct Parent has key { id: UID, binding: EquipmentMarketCustodyBindingV8 }
public struct Ids has copy, drop {
    root: ID, base: ID, definitions: ID, packs: ID,
    protocol: ID, catalog: ID, replacement: ID, config: ID, registry: ID, treasury: ID,
}
public struct Context {
    root: MakerRootV8<SUI>, base: BaseDefinitionRegistryV8,
    definitions: RuntimeDefinitionRegistryV8, packs: PackRegistryV8,
    protocol: ProtocolConfigV8, catalog: ProductReleaseCatalogV8,
    replacement: FreshTupleReplacementBindingV2, config: MarketPackageConfigV8,
    registry: MarketRegistryV8<SUI>, treasury: MarketTreasuryV8<SUI>,
}
fun take(s: &Scenario, ids: Ids): Context {
    Context { root: s.take_shared_by_id(ids.root), base: s.take_shared_by_id(ids.base),
        definitions: s.take_shared_by_id(ids.definitions), packs: s.take_shared_by_id(ids.packs),
        protocol: s.take_shared_by_id(ids.protocol), catalog: s.take_shared_by_id(ids.catalog),
        replacement: s.take_immutable_by_id(ids.replacement), config: s.take_shared_by_id(ids.config),
        registry: s.take_shared_by_id(ids.registry), treasury: s.take_shared_by_id(ids.treasury) }
}
fun put(c: Context) {
    let Context { root, base, definitions, packs, protocol, catalog, replacement, config, registry, treasury } = c;
    ts::return_shared(root); ts::return_shared(base); ts::return_shared(definitions);
    ts::return_shared(packs); ts::return_shared(protocol); ts::return_shared(catalog);
    ts::return_immutable(replacement); ts::return_shared(config);
    ts::return_shared(registry); ts::return_shared(treasury);
}

// 0 success, 1 omit mandatory retained Pack proof, 2 close nonempty equipment,
// 3 try to remove the unrelated real item still locked in the temporary Player.
fun run(case: u8) {
    let holder = @0xA11;
    let mut s = ts::begin(holder);
    let (protocol, setup, mut system) = bootstrap::initialize_for_testing(&mut s);
    let maker = fixture::new_active_for_testing(&mut s, protocol, setup, &mut system);
    let (release_id, _, _) = fixture::publish_pack_for_testing(&mut s, maker);
    let native_market = complete::initialize_market_for_testing(&mut s);
    let completed = complete::mint_for_testing(&mut s, protocol, setup,
        active::maker_objects_for_testing(maker), native_market, &mut system);
    let (soul_id, state_id, binding_id, output_id, receipt_id) = complete::native_ids(completed);
    let (_, _, player_id, player_item_id, access_id) = complete::holder_ids(completed);
    let (root, base, _, _) = active::maker_ids_for_testing(maker);
    let (definitions, packs, _, _, _, _, _, registry, treasury) = active::companion_ids_for_testing(maker);
    let (catalog, _, _, _, _, config, _) = bootstrap::configuration_ids_for_testing(setup);
    let (replacement, _, _) = bootstrap::authority_ids_for_testing(&s, setup);
    let ids = Ids { root, base, definitions, packs, protocol, catalog, replacement, config, registry, treasury };
    let mut c = take(&s, ids);
    let mut state = s.take_shared_by_id<SoulState>(state_id);
    let binding = s.take_immutable_by_id<NativeSoulBindingV8>(binding_id);
    let output = s.take_immutable_by_id<CompleteOutputV8>(output_id);
    let receipt = s.take_immutable_by_id<CompleteReceiptV8>(receipt_id);
    let original_binding = std::bcs::to_bytes(&binding);
    let original_output = std::bcs::to_bytes(&output);
    let original_receipt = std::bcs::to_bytes(&receipt);
    let access = s.take_from_sender_by_id<MakerAccessPassV8>(access_id);
    let original_access = std::bcs::to_bytes(&access);
    let equipment_id = equipment::create_equipment_v8(&mut state, &binding, &c.root,
        &c.protocol, &c.definitions, &c.packs, &access, s.ctx());
    let original_state = std::bcs::to_bytes(&state);
    let Context { packs, definitions, base, root, .. } = &mut c;
    let item = runtime::claim_owned_base_item_v8(packs, definitions, base, root, &access,
        b"sale".to_string(), b"item".to_string(), s.ctx());
    let item_id = object::id(&item);
    let original_item = std::bcs::to_bytes(&item);
    runtime::transfer_new_owned_base_item_to_holder_v8(item);
    let mut release = s.take_shared_by_id<PackReleaseV8<SUI>>(release_id);
    let clock = sui::clock::create_for_testing(s.ctx());
    let pass = runtime::issue_free_pack_pass_v8(&mut release, &c.packs, &clock, s.ctx());
    clock.destroy_for_testing();
    let pass_id = object::id(&pass);
    let original_pass = std::bcs::to_bytes(&pass);
    runtime::transfer_pack_pass_to_holder_v8(pass);
    ts::return_shared(release); ts::return_shared(state);
    ts::return_immutable(binding); ts::return_immutable(output); ts::return_immutable(receipt);
    s.return_to_sender(access); put(c);
    s.next_tx(holder);

    // Persist two distinct Parts, each occupying its sole equipment slot.
    let c = take(&s, ids);
    let state = s.take_shared_by_id<SoulState>(state_id);
    let mut equipped = s.take_shared_by_id<MakerLoadoutV8>(equipment_id);
    let mut item = s.take_from_sender_by_id<OwnedBaseItemV8>(item_id);
    let access = s.take_from_sender_by_id<MakerAccessPassV8>(access_id);
    let pass = s.take_from_sender_by_id<PackPassV8>(pass_id);
    let release = s.take_shared_by_id<PackReleaseV8<SUI>>(release_id);
    let update = equipment::begin_update_v8(&state, &mut equipped, &c.protocol, 0, s.ctx());
    equipment::attach_pack_definitions_v8(&update, &mut equipped, &c.root, &c.definitions,
        &c.packs, &release, &pass, &access, 0, s.ctx());
    equipment::select_pack_v8(&update, &mut equipped, &c.root, &c.definitions, &c.packs,
        &c.base, &release, &pass, &access, 1, option::some(0), b"part".to_string(),
        b"pack-item".to_string(), b"pack-style".to_string(), option::none(), s.ctx());
    equipment::equip_base_v8(&update, &mut equipped, &mut item, &c.root, &c.definitions,
        &c.packs, &c.base, &access, 2, option::some(1), b"style".to_string(), option::none(), s.ctx());
    let proof = runtime::prove_equipment_pack_definitions_v8(&equipped, &c.definitions,
        &c.base, &release, 0, s.ctx());
    equipment::finish_update_v8(&mut equipped, &c.definitions, &c.base, vector[proof], update);
    assert!(runtime::loadout_selection_count_v8(&equipped) == 2
        && runtime::loadout_revision_v8(&equipped) == 3
        && runtime::owned_base_item_locked_v8(&item), 99);
    let retained_selection = std::bcs::to_bytes(runtime::loadout_selection_v8(&equipped, 0));
    ts::return_shared(state); ts::return_shared(equipped); ts::return_shared(release);
    s.return_to_sender(item); s.return_to_sender(access); s.return_to_sender(pass); put(c);
    s.next_tx(holder);

    // The SDK's intended atomic sequence: begin -> exact-instance unequip ->
    // prove surviving attachments -> finish -> custody, without closing Soul equipment.
    let c = take(&s, ids);
    let state = s.take_shared_by_id<SoulState>(state_id);
    let mut equipped = s.take_shared_by_id<MakerLoadoutV8>(equipment_id);
    let mut item = s.take_from_sender_by_id<OwnedBaseItemV8>(item_id);
    let release = s.take_shared_by_id<PackReleaseV8<SUI>>(release_id);
    let update = equipment::begin_update_v8(&state, &mut equipped, &c.protocol, 3, s.ctx());
    if (case == 3) {
        let mut other = s.take_from_sender_by_id<OwnedBaseItemV8>(player_item_id);
        equipment::unequip_base_v8(&update, &mut equipped, &mut other, 3, s.ctx());
        abort 99
    };
    equipment::unequip_base_v8(&update, &mut equipped, &mut item, 3, s.ctx());
    let proofs = if (case == 1) vector[] else vector[
        runtime::prove_equipment_pack_definitions_v8(&equipped, &c.definitions, &c.base, &release, 0, s.ctx())];
    equipment::finish_update_v8(&mut equipped, &c.definitions, &c.base, proofs, update);
    assert!(std::bcs::to_bytes(&item) == original_item
        && std::bcs::to_bytes(runtime::loadout_selection_v8(&equipped, 0)) == retained_selection
        && runtime::loadout_selections_v8(&equipped)[1].is_none()
        && runtime::loadout_selection_count_v8(&equipped) == 1, 99);
    let mut parent_id = object::new(s.ctx());
    let ticket = runtime::custody_owned_base_item_for_market_v8(&c.root, &c.protocol,
        &c.catalog, &c.replacement, market::market_runtime_caller_for_testing(&c.config),
        &c.registry, &c.treasury, &mut parent_id, &c.packs, &c.definitions, &c.base, item, s.ctx());
    let listing_id = parent_id.to_inner();
    let binding = runtime::consume_equipment_market_custody_ticket_v8(ticket);
    sui::transfer::share_object(Parent { id: parent_id, binding });
    let retained_equipment = std::bcs::to_bytes(&equipped);
    ts::return_shared(state); ts::return_shared(equipped); ts::return_shared(release); put(c);
    s.next_tx(holder);

    // Real cross-transaction inventory and reads: Soul never entered escrow.
    let c = take(&s, ids);
    let mut state = s.take_shared_by_id<SoulState>(state_id);
    let equipped = s.take_shared_by_id<MakerLoadoutV8>(equipment_id);
    equipment::assert_equipment_read_v8(&state, &equipped, &c.protocol, s.ctx());
    assert!(std::bcs::to_bytes(&state) == original_state
        && soul::soul_id(&state) == soul_id && soul::current_owner(&state) == holder
        && soul::ownership_epoch(&state) == 0
        && soul::animacraft_native_v8_binding_id(&state) == binding_id
        && soul::animacraft_native_equipment_id_v8(&state) == equipment_id
        && std::bcs::to_bytes(&equipped) == retained_equipment, 99);
    if (case == 2) {
        equipment::close_empty_equipment_v8(&mut state, equipped, &c.protocol, 4, s.ctx());
        abort 99
    };
    let player = s.take_from_sender_by_id<MakerLoadoutV8>(player_id);
    let player_item = s.take_from_sender_by_id<OwnedBaseItemV8>(player_item_id);
    assert!(runtime::owned_base_item_locked_v8(&player_item)
        && runtime::loadout_selection_count_v8(&player) == 1, 99);
    s.return_to_sender(player); s.return_to_sender(player_item);
    let access = s.take_from_sender_by_id<MakerAccessPassV8>(access_id);
    let pass = s.take_from_sender_by_id<PackPassV8>(pass_id);
    let release = s.take_shared_by_id<PackReleaseV8<SUI>>(release_id);
    assert!(std::bcs::to_bytes(&access) == original_access && std::bcs::to_bytes(&pass) == original_pass, 99);
    let proof = runtime::prove_pack_selection_v8(&equipped, &c.packs, &release, &pass, &c.root, &access, 0, s.ctx());
    std::unit_test::destroy(proof);
    let owner = runtime::pack_registry_base_item_owner_v8(&c.packs, b"sale".to_string(), b"item".to_string(), holder);
    assert!(owner.is_some() && runtime::base_item_ownership_id_v8(owner.borrow()) == item_id
        && runtime::base_item_ownership_epoch_v8(owner.borrow()) == 0, 99);
    let mut parent = s.take_shared_by_id<Parent>(listing_id);
    assert!(runtime::equipment_market_custody_asset_id_v8(&parent.binding) == item_id, 99);
    let custody = parent.binding;
    runtime::return_owned_base_item_from_market_v8(&c.root, &c.catalog, &c.replacement,
        market::market_runtime_caller_for_testing(&c.config), &c.registry, &c.treasury,
        &mut parent.id, &c.packs, &c.definitions, ts::receiving_ticket_by_id<OwnedBaseItemV8>(item_id), &custody);
    ts::return_shared(parent); ts::return_shared(state); ts::return_shared(equipped); ts::return_shared(release);
    s.return_to_sender(access); s.return_to_sender(pass); put(c);
    s.next_tx(holder);

    let state = s.take_shared_by_id<SoulState>(state_id);
    let equipped = s.take_shared_by_id<MakerLoadoutV8>(equipment_id);
    let item = s.take_from_sender_by_id<OwnedBaseItemV8>(item_id);
    let binding = s.take_immutable_by_id<NativeSoulBindingV8>(binding_id);
    let output = s.take_immutable_by_id<CompleteOutputV8>(output_id);
    let receipt = s.take_immutable_by_id<CompleteReceiptV8>(receipt_id);
    assert!(std::bcs::to_bytes(&state) == original_state
        && std::bcs::to_bytes(&equipped) == retained_equipment
        && std::bcs::to_bytes(&item) == original_item
        && !runtime::owned_base_item_locked_v8(&item)
        && std::bcs::to_bytes(&binding) == original_binding
        && std::bcs::to_bytes(&output) == original_output
        && std::bcs::to_bytes(&receipt) == original_receipt, 99);
    ts::return_shared(state); ts::return_shared(equipped); s.return_to_sender(item);
    ts::return_immutable(binding); ts::return_immutable(output); ts::return_immutable(receipt);
    std::unit_test::destroy(system); s.end();
}

#[test]
fun selected_base_partial_custody_and_cancel_preserve_soul_and_pack() { run(0) }
#[test, expected_failure(abort_code = 22, location = animacraft_v8_runtime::runtime_v8)]
fun selected_base_partial_remove_requires_retained_pack_proof() { run(1) }
#[test, expected_failure(abort_code = 18, location = animacraft_v8_runtime::runtime_v8)]
fun selected_base_partial_remove_cannot_close_retained_equipment() { run(2) }
#[test, expected_failure(abort_code = 19, location = animacraft_v8_runtime::runtime_v8)]
fun selected_base_partial_remove_rejects_other_player_instance() { run(3) }
