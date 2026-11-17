#[test_only]
module native_soul_v8_graph::native_wardrobe_integration;

use native_soul_v8_graph::{bootstrap, active_maker as active, native_completion as complete};
use animacraft_v8_core::maker_v8::MakerRootV8;
use animacraft_v8_core::base_registry_v8::BaseDefinitionRegistryV8;
use animacraft_v8_core::protocol_config_v8::ProtocolConfigV8;
use animacraft_v8_core::treasury_v8::MakerAccessPassV8;
use animacraft_v8_runtime::runtime_v8::{Self as runtime, MakerLoadoutV8,
    RuntimeDefinitionRegistryV8, PackRegistryV8, OwnedBaseItemV8};
use animacraft_v8_output::output_v8::NativeSoulBindingV8;
use soulidity::soul::{Self as soul, Soul, SoulState};
use soulidity::animacraft_equipment_adapter_v8 as equipment;
use soulidity::market::{Self as market, MarketConfigV2, KioskRegistry, SoulListing};
use kiosk::personal_kiosk::PersonalKioskCap;
use sui::kiosk::Kiosk;
use sui::transfer_policy::TransferPolicy;
use sui::test_scenario::{Self as ts, Scenario};
use sui::sui::SUI;
use usdc::usdc::USDC;

const HOLDER: address = @0xA11;
const BUYER: address = @0xB22;

public struct Ids has copy, drop {
    soul: ID, state: ID, binding: ID, equipment: ID, item: ID, access: ID, player: ID,
    root: ID, protocol: ID, definitions: ID, packs: ID, base: ID,
    config: ID, registry: ID, policy: ID, kiosk: ID, cap: ID,
}

public struct Context {
    state: SoulState, equipment: MakerLoadoutV8, root: MakerRootV8<SUI>,
    protocol: ProtocolConfigV8, definitions: RuntimeDefinitionRegistryV8,
    packs: PackRegistryV8, base: BaseDefinitionRegistryV8, access: MakerAccessPassV8,
}

fun take(s: &Scenario, ids: Ids): Context {
    Context { state: s.take_shared_by_id(ids.state), equipment: s.take_shared_by_id(ids.equipment),
        root: s.take_shared_by_id(ids.root), protocol: s.take_shared_by_id(ids.protocol),
        definitions: s.take_shared_by_id(ids.definitions), packs: s.take_shared_by_id(ids.packs),
        base: s.take_shared_by_id(ids.base), access: s.take_from_sender_by_id(ids.access) }
}

fun put(s: &Scenario, c: Context) {
    let Context { state, equipment, root, protocol, definitions, packs, base, access } = c;
    ts::return_shared(state); ts::return_shared(equipment); ts::return_shared(root);
    ts::return_shared(protocol); ts::return_shared(definitions); ts::return_shared(packs);
    ts::return_shared(base); s.return_to_sender(access);
}

fun prepare(s: &mut Scenario): (Ids, walrus::system::System) {
    let (protocol_id, setup, mut system) = bootstrap::initialize_for_testing(s);
    let maker = active::new_active_maker_for_testing(s, protocol_id, setup, &mut system);
    let market = complete::initialize_market_for_testing(s);
    let completed = complete::mint_for_testing(s, protocol_id, setup,
        active::maker_objects_for_testing(maker), market, &mut system);
    let (soul_id, state_id, binding_id, _, _) = complete::native_ids(completed);
    let (kiosk, cap, player_id, item_id, access_id) = complete::holder_ids(completed);
    let (root_id, base_id, _, _) = active::maker_ids_for_testing(maker);
    let (definitions_id, packs_id, _, _, _, _, _, _, _) = active::companion_ids_for_testing(maker);
    let (config, _, registry, _, policy) = complete::market_ids(market);
    let mut state = s.take_shared_by_id<SoulState>(state_id);
    let binding = s.take_immutable_by_id<NativeSoulBindingV8>(binding_id);
    let root = s.take_shared_by_id<MakerRootV8<SUI>>(root_id);
    let protocol = s.take_shared_by_id<ProtocolConfigV8>(protocol_id);
    let definitions = s.take_shared_by_id<RuntimeDefinitionRegistryV8>(definitions_id);
    let packs = s.take_shared_by_id<PackRegistryV8>(packs_id);
    let access = s.take_from_sender_by_id<MakerAccessPassV8>(access_id);
    let mut player = s.take_from_sender_by_id<MakerLoadoutV8>(player_id);
    let mut item = s.take_from_sender_by_id<OwnedBaseItemV8>(item_id);
    let revision = runtime::loadout_revision_v8(&player);
    runtime::unequip_owned_base_style_v8(&mut player, &mut item, revision, s.ctx());
    let equipment_id = equipment::create_equipment_v8(&mut state, &binding,
        &root, &protocol, &definitions, &packs, &access, s.ctx());
    s.return_to_sender(player); s.return_to_sender(item); s.return_to_sender(access);
    ts::return_shared(state); ts::return_shared(root); ts::return_shared(protocol);
    ts::return_shared(definitions); ts::return_shared(packs); ts::return_immutable(binding);
    s.next_tx(HOLDER);
    (Ids { soul: soul_id, state: state_id, binding: binding_id, equipment: equipment_id,
        item: item_id, access: access_id, player: player_id, root: root_id, protocol: protocol_id,
        definitions: definitions_id, packs: packs_id, base: base_id,
        config, registry, policy, kiosk, cap }, system)
}

fun run(case: u8) {
    let mut s = ts::begin(HOLDER);
    let (ids, system) = prepare(&mut s);
    let mut c = take(&s, ids);
    let item = s.take_from_sender_by_id<OwnedBaseItemV8>(ids.item);
    let Context { state, equipment: e, protocol, packs, definitions, base, .. } = &mut c;
    let update = equipment::begin_update_v8(state, e, protocol, 0, s.ctx());
    runtime::migrate_soul_wardrobe_v1(e, &update, s.ctx());
    runtime::deposit_soul_wardrobe_base_v1(e, &update, packs, definitions, item, 0, s.ctx());
    equipment::finish_update_v8(e, definitions, base, vector[], update);
    assert!(runtime::soul_wardrobe_revision_v1(e) == 1
        && runtime::soul_wardrobe_assets_v1(e).length() == 1, 99);
    put(&s, c);
    s.next_tx(if (case == 3) BUYER else HOLDER);
    if (case == 3) {
        let state = s.take_shared_by_id<SoulState>(ids.state);
        let mut e = s.take_shared_by_id<MakerLoadoutV8>(ids.equipment);
        let protocol = s.take_shared_by_id<ProtocolConfigV8>(ids.protocol);
        let _unexpected = equipment::begin_update_v8(&state, &mut e, &protocol, 1, s.ctx());
        abort 99
    };
    let mut c = take(&s, ids);
    let Context { state, equipment: e, protocol, root, packs, definitions, base, access } = &mut c;
    let update = equipment::begin_update_v8(state, e, protocol, 1, s.ctx());
    let receiving = ts::receiving_ticket_by_id<OwnedBaseItemV8>(ids.item);
    let (mut item, obligation) = runtime::receive_soul_wardrobe_base_v1(e, &update, receiving,
        if (case == 1) 0 else 1, s.ctx());
    assert!(object::id(&item) == ids.item && runtime::owned_base_item_holder_v8(&item) == ids.item.to_address(), 99);
    if (case == 9) {
        let mut other = s.take_from_sender_by_id<MakerLoadoutV8>(ids.player);
        let revision = runtime::loadout_revision_v8(&other);
        runtime::equip_owned_base_style_v8(&mut other, &mut item, root, definitions, packs,
            base, access, revision, option::none(), b"style".to_string(), option::none(), s.ctx());
        runtime::return_soul_wardrobe_base_v1(e, &update, item, obligation, s.ctx());
        abort 99
    };
    equipment::equip_base_v8(&update, e, &mut item, root, definitions, packs, base, access, 1,
        option::none(), b"style".to_string(), option::none(), s.ctx());
    let proof = runtime::prove_owned_base_selection_v8(e, &item, definitions, packs, base, root, access, 0, s.ctx());
    std::unit_test::destroy(proof);
    if (case == 2) {
        runtime::withdraw_soul_wardrobe_base_v1(e, &update, packs, definitions, item, obligation, s.ctx());
        abort 99
    };
    runtime::return_soul_wardrobe_base_v1(e, &update, item, obligation, s.ctx());
    runtime::set_soul_wardrobe_showcase_v1(e, &update, true, s.ctx());
    equipment::finish_update_v8(e, definitions, base, vector[], update);
    assert!(runtime::soul_wardrobe_asset_equipped_v1(&runtime::soul_wardrobe_assets_v1(e)[0])
        && !runtime::soul_wardrobe_showcase_enabled_v1(e), 99);
    let before_selections = std::bcs::to_bytes(runtime::loadout_selections_v8(e));
    let delivery = runtime::soul_wardrobe_delivery_commitment_v1(e);
    put(&s, c);
    s.next_tx(HOLDER);

    if (case < 4) {
        let mut c = take(&s, ids);
        let Context { state, equipment: e, protocol, definitions, base, .. } = &mut c;
        let update = equipment::begin_update_v8(state, e, protocol, 2, s.ctx());
        let (mut item, obligation) = runtime::receive_soul_wardrobe_base_v1(e, &update,
            ts::receiving_ticket_by_id(ids.item), 2, s.ctx());
        equipment::unequip_base_v8(&update, e, &mut item, 2, s.ctx());
        runtime::return_soul_wardrobe_base_v1(e, &update, item, obligation, s.ctx());
        equipment::finish_update_v8(e, definitions, base, vector[], update);
        assert!(runtime::soul_wardrobe_assets_v1(e).length() == 1
            && !runtime::soul_wardrobe_asset_equipped_v1(&runtime::soul_wardrobe_assets_v1(e)[0]), 99);
        put(&s, c);
        s.next_tx(HOLDER);
        let mut c = take(&s, ids);
        let Context { state, equipment: e, protocol, packs, definitions, base, .. } = &mut c;
        let update = equipment::begin_update_v8(state, e, protocol, 3, s.ctx());
        let (item, obligation) = runtime::receive_soul_wardrobe_base_v1(e, &update,
            ts::receiving_ticket_by_id(ids.item), 3, s.ctx());
        runtime::withdraw_soul_wardrobe_base_v1(e, &update, packs, definitions, item, obligation, s.ctx());
        equipment::finish_update_v8(e, definitions, base, vector[], update);
        assert!(runtime::soul_wardrobe_assets_v1(e).is_empty(), 99);
        put(&s, c);
        s.next_tx(HOLDER);
        let item = s.take_from_sender_by_id<OwnedBaseItemV8>(ids.item);
        assert!(object::id(&item) == ids.item && runtime::owned_base_item_holder_v8(&item) == HOLDER
            && !runtime::owned_base_item_locked_v8(&item), 99);
        s.return_to_sender(item);
    } else {
        let config = s.take_shared_by_id<MarketConfigV2>(ids.config);
        let mut registry = s.take_shared_by_id<KioskRegistry>(ids.registry);
        let provenance = s.take_immutable_by_id<NativeSoulBindingV8>(ids.binding);
        let protocol = s.take_shared_by_id<ProtocolConfigV8>(ids.protocol);
        let definitions = s.take_shared_by_id<RuntimeDefinitionRegistryV8>(ids.definitions);
        let mut e = s.take_shared_by_id<MakerLoadoutV8>(ids.equipment);
        let mut state = s.take_shared_by_id<SoulState>(ids.state);
        let mut kiosk = s.take_shared_by_id<Kiosk>(ids.kiosk);
        let cap = s.take_from_sender_by_id<PersonalKioskCap>(ids.cap);
        let mut listing = market::list_animacraft_wardrobe_fixed_price_v1(&config, &registry,
            &provenance, &protocol, &definitions, &mut e, &mut kiosk, &cap, &mut state,
            1_000_000, delivery, s.ctx());
        assert!(market::soul_wardrobe_sale_delivery_v1(&listing) == delivery, 99);
        assert!(runtime::soul_wardrobe_showcase_enabled_v1(&e), 99);
        if (case == 10) {
            let root = s.take_shared_by_id<MakerRootV8<SUI>>(ids.root);
            let packs = s.take_shared_by_id<PackRegistryV8>(ids.packs);
            let base = s.take_shared_by_id<BaseDefinitionRegistryV8>(ids.base);
            let access = s.take_from_sender_by_id<MakerAccessPassV8>(ids.access);
            let (item, obligation) = equipment::receive_wardrobe_base_read_v1(&state, &mut e, &protocol,
                ts::receiving_ticket_by_id(ids.item), s.ctx());
            let proof = runtime::prove_owned_base_selection_v8(&e, &item, &definitions,
                &packs, &base, &root, &access, 0, s.ctx());
            std::unit_test::destroy(proof);
            runtime::return_soul_wardrobe_base_read_v1(&mut e, item, obligation, s.ctx());
            assert!(runtime::soul_wardrobe_delivery_commitment_v1(&e) == delivery
                && runtime::soul_wardrobe_revision_v1(&e) == 2, 99);
            ts::return_shared(root); ts::return_shared(packs); ts::return_shared(base); s.return_to_sender(access);
        };
        if (case == 4) {
            let _unexpected = equipment::begin_update_v8(&state, &mut e, &protocol, 2, s.ctx());
            abort 99
        };
        if (case == 5) {
            market::cancel_soul_listing(&mut kiosk, &cap, &mut state, &mut listing);
            abort 99
        };
        if (case == 6) {
            market::cancel_animacraft_wardrobe_listing_v1(&mut kiosk, &cap, &mut state,
                &mut listing, &mut e, &protocol, s.ctx());
            assert!(!soul::is_listed(&state) && runtime::soul_wardrobe_delivery_commitment_v1(&e) == delivery, 99);
            market::delete_soul_listing(listing, s.ctx());
            ts::return_shared(config); ts::return_shared(registry);
            ts::return_immutable(provenance); ts::return_shared(protocol); ts::return_shared(definitions);
            ts::return_shared(e); ts::return_shared(state); ts::return_shared(kiosk); s.return_to_sender(cap);
        } else {
            let listing_id = object::id(&listing);
            market::finalize_soul_listing(listing);
            ts::return_shared(e); ts::return_shared(state); ts::return_shared(kiosk); s.return_to_sender(cap);
            ts::return_immutable(provenance); ts::return_shared(protocol); ts::return_shared(definitions);
            s.next_tx(BUYER);
            let buyer_kiosk_id = market::init_personal_kiosk_v2(&config, &mut registry, s.ctx());
            ts::return_shared(config); ts::return_shared(registry);
            s.next_tx(BUYER);
            let config = s.take_shared_by_id<MarketConfigV2>(ids.config);
            let registry = s.take_shared_by_id<KioskRegistry>(ids.registry);
            let policy = s.take_shared_by_id<TransferPolicy<Soul>>(ids.policy);
            let provenance = s.take_immutable_by_id<NativeSoulBindingV8>(ids.binding);
            let protocol = s.take_shared_by_id<ProtocolConfigV8>(ids.protocol);
            let mut e = s.take_shared_by_id<MakerLoadoutV8>(ids.equipment);
            let mut state = s.take_shared_by_id<SoulState>(ids.state);
            let mut seller_kiosk = s.take_shared_by_id<Kiosk>(ids.kiosk);
            let mut buyer_kiosk = s.take_shared_by_id<Kiosk>(buyer_kiosk_id);
            let buyer_cap = s.take_from_sender<PersonalKioskCap>();
            let mut listing = s.take_shared_by_id<SoulListing>(listing_id);
            let payment = sui::coin::mint_for_testing<USDC>(1_000_000, s.ctx());
            market::buy_animacraft_wardrobe_fixed_price_v1(&config, &registry, &policy, &provenance, &protocol,
                &mut e, &mut seller_kiosk, &mut buyer_kiosk, &buyer_cap, &mut state, &mut listing,
                if (case == 7) vector[0] else delivery, payment, s.ctx());
            assert!(soul::soul_id(&state) == ids.soul && soul::current_owner(&state) == BUYER
                && soul::ownership_epoch(&state) == 1 && !soul::is_listed(&state), 99);
            equipment::assert_equipment_read_v8(&state, &e, &protocol, s.ctx());
            assert!(std::bcs::to_bytes(runtime::loadout_selections_v8(&e)) == before_selections
                && runtime::soul_wardrobe_delivery_commitment_v1(&e) == delivery
                && !runtime::soul_wardrobe_showcase_enabled_v1(&e), 99);
            ts::return_shared(config); ts::return_shared(registry); ts::return_shared(policy);
            ts::return_immutable(provenance); ts::return_shared(protocol); ts::return_shared(e);
            ts::return_shared(state); ts::return_shared(seller_kiosk); ts::return_shared(buyer_kiosk);
            s.return_to_sender(buyer_cap); ts::return_shared(listing);
        };
    };
    std::unit_test::destroy(system);
    s.end();
}

#[test] fun wardrobe_receiving_store_and_withdraw_preserve_exact_item() { run(0); }
#[test, expected_failure(abort_code=240, location=animacraft_v8_runtime::runtime_v8)]
fun wardrobe_stale_inventory_revision_rejected() { run(1); }
#[test, expected_failure(abort_code=18, location=animacraft_v8_runtime::runtime_v8)]
fun wardrobe_equipped_item_withdrawal_rejected() { run(2); }
#[test, expected_failure(abort_code=1, location=soulidity::soul)]
fun wardrobe_wrong_wallet_rejected() { run(3); }
#[test, expected_failure(abort_code=1, location=soulidity::animacraft_v8_binding)]
fun wardrobe_listing_freezes_mutations() { run(4); }
#[test, expected_failure(abort_code=7, location=soulidity::market)]
fun wardrobe_legacy_cancel_cannot_strand_frozen_inventory() { run(5); }
#[test] fun wardrobe_cancel_preserves_actual_custody_and_wear() { run(6); }
#[test, expected_failure(abort_code=240, location=soulidity::market)]
fun wardrobe_buyer_rejects_changed_delivery() { run(7); }
#[test] fun wardrobe_sale_keeps_same_soul_items_and_wear_and_clears_showcase() { run(8); }
#[test, expected_failure(abort_code=241, location=animacraft_v8_runtime::runtime_v8)]
fun wardrobe_base_received_item_cannot_return_locked_to_another_player() { run(9); }
#[test] fun wardrobe_listed_owner_read_receives_proves_and_returns_same_item() { run(10); }
