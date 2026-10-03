/// Real installed Market authority and cross-transaction Receiving. These tests
/// exercise Runtime custody only; no fee policy or settled-sale claim is implied.
#[test_only]
module native_soul_v8_graph::equipment_market_custody_integration;

use native_soul_v8_graph::bootstrap;
use native_soul_v8_graph::active_maker as active;
use animacraft_v8_core::maker_v8::{MakerRootV8, MakerAdminCapV8};
use animacraft_v8_core::base_registry_v8::BaseDefinitionRegistryV8;
use animacraft_v8_core::treasury_v8::{Self as treasury, MakerTreasuryV8, MakerAccessPassV8};
use animacraft_v8_core::protocol_config_v8::{Self as protocol, ProtocolConfigV8, ProtocolAdminCapV8};
use animacraft_v8_release::release_v8::{Self as release, ReleasePackageConfigV8};
use animacraft_v8_core::package_binding_v8::{ProductReleaseCatalogV8, FreshTupleReplacementBindingV2};
use animacraft_v8_market::market_v8::{Self as market, MarketPackageConfigV8, MarketRegistryV8, MarketTreasuryV8};
use animacraft_v8_runtime::runtime_v8::{Self as runtime, RuntimeDefinitionRegistryV8, PackRegistryV8,
    OwnedBaseItemV8, OwnedExternalItemV8, ExternalItemProductV8, PackAdmissionAuthorityV8, EquipmentMarketCustodyBindingV8};
use sui::test_scenario::{Self as ts, Scenario};
use sui::sui::SUI;

public struct Parent has key { id: UID, binding: EquipmentMarketCustodyBindingV8 }
public struct Ids has copy, drop {
    root: ID, base: ID, maker_treasury: ID, definitions: ID, packs: ID,
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
    Context {
        root: s.take_shared_by_id(ids.root), base: s.take_shared_by_id(ids.base),
        definitions: s.take_shared_by_id(ids.definitions), packs: s.take_shared_by_id(ids.packs),
        protocol: s.take_shared_by_id(ids.protocol), catalog: s.take_shared_by_id(ids.catalog),
        replacement: s.take_immutable_by_id(ids.replacement), config: s.take_shared_by_id(ids.config),
        registry: s.take_shared_by_id(ids.registry), treasury: s.take_shared_by_id(ids.treasury),
    }
}
fun put(c: Context) {
    let Context { root, base, definitions, packs, protocol, catalog, replacement, config, registry, treasury } = c;
    ts::return_shared(root); ts::return_shared(base); ts::return_shared(definitions);
    ts::return_shared(packs); ts::return_shared(protocol); ts::return_shared(catalog);
    ts::return_immutable(replacement); ts::return_shared(config);
    ts::return_shared(registry); ts::return_shared(treasury);
}
fun hash(byte: u8): vector<u8> { let mut v = vector[]; let mut i = 0u64; while (i < 32) { v.push_back(byte); i = i + 1 }; v }

// Cases: 0 cancel, 1 buy, 2 duplicate claim during custody, 3 wrong parent,
// 4 nontransferable External, 5 paused cancel, 6 self-buy, 7 paused buy,
// 8 disabled cancel, 9 disabled buy, 10 buyer already owns Base,
// 11 wrong registry type, 12 still equipped.
fun run(external: bool, case: u8) {
    let seller = @0xA11;
    let buyer = @0xB22;
    let mut s = ts::begin(seller);
    let (protocol, setup, mut system) = bootstrap::initialize_for_testing(&mut s);
    let maker = active::new_active_maker_for_testing(&mut s, protocol, setup, &mut system);
    let (root, base, maker_treasury, admin_id) = active::maker_ids_for_testing(maker);
    let (definitions, packs, admission_id, _, _, _, _, registry, treasury) = active::companion_ids_for_testing(maker);
    let (catalog, _, _, _, _, config, release_id) = bootstrap::configuration_ids_for_testing(setup);
    let (replacement, _, _) = bootstrap::authority_ids_for_testing(&s, setup);
    let ids = Ids { root, base, maker_treasury, definitions, packs, protocol, catalog, replacement, config, registry, treasury };
    s.next_tx(seller);
    let c = take(&s, ids);
    let mut maker_treasury = s.take_shared_by_id<MakerTreasuryV8<SUI>>(ids.maker_treasury);
    let clock = sui::clock::create_for_testing(s.ctx());
    treasury::claim_free_maker_access_v8(&c.root, &mut maker_treasury, &clock, s.ctx());
    clock.destroy_for_testing();
    ts::return_shared(maker_treasury); put(c);
    s.next_tx(seller);
    let mut c = take(&s, ids);
    let access = s.take_from_sender<MakerAccessPassV8>();
    let (item_id, original, product_id) = if (external) {
        let (mut product, admin) = runtime::new_external_item_product_v8(&c.root, &c.definitions,
            &c.base, b"part".to_string(), b"external-item".to_string(), b"external-style".to_string(),
            b"track".to_string(), option::none(), option::none(), b"external-public-fixture-blob".to_string(),
            hash(81), b"image/png".to_string(), 69, hash(82), case != 4, s.ctx());
        let item = runtime::mint_owned_external_item_v8(&mut product, &admin, seller, s.ctx());
        let (id, bytes, product_id) = (object::id(&item), std::bcs::to_bytes(&item), object::id(&product));
        runtime::transfer_new_owned_item_to_holder_v8(item);
        runtime::share_external_item_product_v8(product);
        runtime::transfer_external_item_admin_cap_v8(admin, seller);
        (id, bytes, option::some(product_id))
    } else {
        let Context { packs, definitions, base, root, .. } = &mut c;
        let item = runtime::claim_owned_base_item_v8(packs, definitions, base,
            root, &access, b"part".to_string(), b"item".to_string(), s.ctx());
        let (id, bytes) = (object::id(&item), std::bcs::to_bytes(&item));
        runtime::transfer_new_owned_base_item_to_holder_v8(item);
        (id, bytes, option::none())
    };
    s.return_to_sender(access); put(c);
    s.next_tx(seller);
    let mut c = take(&s, ids);
    let mut parent_uid = object::new(s.ctx());
    let ticket = if (external) {
        let product = s.take_shared_by_id<ExternalItemProductV8>(*product_id.borrow());
        let mut item = s.take_from_sender_by_id<OwnedExternalItemV8>(item_id);
        if (case == 12) {
            let access = s.take_from_sender<MakerAccessPassV8>();
            let admin = s.take_from_sender_by_id<MakerAdminCapV8>(admin_id);
            let admission = s.take_from_sender_by_id<PackAdmissionAuthorityV8>(admission_id);
            let Context { packs, definitions, root, .. } = &mut c;
            let revision = runtime::pack_registry_revision_v8(packs);
            runtime::admit_open_external_product_v8(packs, &admission, definitions, root,
                &admin, &product, revision, s.ctx());
            let mut loadout = runtime::create_maker_loadout_v8(root, definitions, packs, &access, s.ctx());
            runtime::equip_external_style_v8(&mut loadout, &mut item, root, definitions, packs,
                &product, &access, 0, option::none(), s.ctx());
            runtime::transfer_maker_loadout_to_holder_v8(loadout);
            s.return_to_sender(access); s.return_to_sender(admin); s.return_to_sender(admission);
        };
        let ticket = if (case == 11) runtime::custody_owned_external_item_for_market_v8(&c.root, &c.protocol,
            &c.catalog, &c.replacement, market::market_runtime_caller_for_testing(&c.config),
            &c.treasury, &c.treasury, &mut parent_uid, &product, item, s.ctx())
        else runtime::custody_owned_external_item_for_market_v8(&c.root, &c.protocol,
            &c.catalog, &c.replacement, market::market_runtime_caller_for_testing(&c.config),
            &c.registry, &c.treasury, &mut parent_uid, &product, item, s.ctx());
        ts::return_shared(product); ticket
    } else {
        let mut item = s.take_from_sender_by_id<OwnedBaseItemV8>(item_id);
        if (case == 12) {
            let access = s.take_from_sender<MakerAccessPassV8>();
            let mut loadout = runtime::create_maker_loadout_v8(&c.root, &c.definitions, &c.packs, &access, s.ctx());
            runtime::equip_owned_base_style_v8(&mut loadout, &mut item, &c.root, &c.definitions,
                &c.packs, &c.base, &access, 0, option::none(), b"style".to_string(), option::none(), s.ctx());
            runtime::transfer_maker_loadout_to_holder_v8(loadout); s.return_to_sender(access);
        };
        if (case == 11) runtime::custody_owned_base_item_for_market_v8(&c.root, &c.protocol, &c.catalog,
            &c.replacement, market::market_runtime_caller_for_testing(&c.config), &c.treasury,
            &c.treasury, &mut parent_uid, &c.packs, &c.definitions, &c.base, item, s.ctx())
        else runtime::custody_owned_base_item_for_market_v8(&c.root, &c.protocol, &c.catalog,
            &c.replacement, market::market_runtime_caller_for_testing(&c.config), &c.registry,
            &c.treasury, &mut parent_uid, &c.packs, &c.definitions, &c.base, item, s.ctx())
    };
    let parent = Parent { id: parent_uid, binding: runtime::consume_equipment_market_custody_ticket_v8(ticket) };
    let parent_id = object::id(&parent);
    sui::transfer::share_object(parent); put(c);
    if (case == 5 || case == 7 || case == 8 || case == 9) {
        s.next_tx(seller);
        let mut c = take(&s, ids);
        if (case == 5 || case == 7) {
            let config = s.take_shared_by_id<ReleasePackageConfigV8>(release_id);
            let admin = s.take_from_sender_by_id<MakerAdminCapV8>(admin_id);
            let Context { root, protocol, catalog, replacement, .. } = &mut c;
            release::pause_maker_v8(root, &admin, protocol, catalog, replacement, &config, s.ctx());
            ts::return_shared(config); s.return_to_sender(admin);
        } else {
            let admin = s.take_from_sender<ProtocolAdminCapV8>();
            protocol::set_protocol_enabled_v8(&mut c.protocol, &admin, false);
            s.return_to_sender(admin);
        };
        put(c);
    };
    if (case == 10) {
        s.next_tx(buyer);
        let c = take(&s, ids);
        let mut treasury = s.take_shared_by_id<MakerTreasuryV8<SUI>>(ids.maker_treasury);
        let clock = sui::clock::create_for_testing(s.ctx());
        treasury::claim_free_maker_access_v8(&c.root, &mut treasury, &clock, s.ctx());
        clock.destroy_for_testing(); ts::return_shared(treasury); put(c);
        s.next_tx(buyer);
        let mut c = take(&s, ids);
        let access = s.take_from_sender<MakerAccessPassV8>();
        let Context { root, packs, definitions, base, .. } = &mut c;
        let item = runtime::claim_owned_base_item_v8(packs, definitions, base, root, &access,
            b"part".to_string(), b"item".to_string(), s.ctx());
        runtime::transfer_new_owned_base_item_to_holder_v8(item);
        s.return_to_sender(access); put(c);
    };
    let buy = case == 1 || case == 6 || case == 7 || case == 9 || case == 10;
    s.next_tx(if (buy && case != 6) buyer else seller);
    let mut c = take(&s, ids);
    if (!external) {
        let owner = runtime::pack_registry_base_item_owner_v8(&c.packs,
            b"part".to_string(), b"item".to_string(), seller);
        assert!(owner.is_some() && runtime::base_item_ownership_id_v8(owner.borrow()) == item_id
            && runtime::base_item_ownership_epoch_v8(owner.borrow()) == 0, 99);
    };
    if (case == 2) {
        let access = s.take_from_sender<MakerAccessPassV8>();
        let Context { packs, definitions, base, root, .. } = &mut c;
        let duplicate = runtime::claim_owned_base_item_v8(packs, definitions,
            base, root, &access, b"part".to_string(), b"item".to_string(), s.ctx());
        runtime::transfer_new_owned_base_item_to_holder_v8(duplicate);
        s.return_to_sender(access);
    };
    let mut parent = s.take_shared_by_id<Parent>(parent_id);
    let binding = parent.binding;
    let mut other_parent = object::new(s.ctx());
    let target = if (case == 3) &mut other_parent else &mut parent.id;
    if (external) {
        let receiving = ts::receiving_ticket_by_id<OwnedExternalItemV8>(item_id);
        if (buy) runtime::purchase_owned_external_item_from_market_v8(&c.root, &c.protocol,
            &c.catalog, &c.replacement, market::market_runtime_caller_for_testing(&c.config),
            &c.registry, &c.treasury, target, receiving, &binding, s.ctx())
        else runtime::return_owned_external_item_from_market_v8(&c.root, &c.catalog, &c.replacement,
            market::market_runtime_caller_for_testing(&c.config), &c.registry, &c.treasury,
            target, receiving, &binding);
    } else {
        let receiving = ts::receiving_ticket_by_id<OwnedBaseItemV8>(item_id);
        let Context { root, protocol, catalog, replacement, config, registry, treasury, packs, definitions, .. } = &mut c;
        if (buy) runtime::purchase_owned_base_item_from_market_v8(root, protocol,
            catalog, replacement, market::market_runtime_caller_for_testing(config),
            registry, treasury, target, packs, definitions, receiving, &binding, s.ctx())
        else runtime::return_owned_base_item_from_market_v8(root, catalog, replacement,
            market::market_runtime_caller_for_testing(config), registry, treasury,
            target, packs, definitions, receiving, &binding);
    };
    other_parent.delete(); ts::return_shared(parent); put(c);
    s.next_tx(if (case == 1) buyer else seller);
    if (external) {
        let item = s.take_from_sender_by_id<OwnedExternalItemV8>(item_id);
        assert!(!runtime::owned_item_locked_v8(&item), 99);
        assert!(runtime::owned_item_holder_v8(&item) == (if (case == 1) buyer else seller), 99);
        assert!(runtime::owned_item_ownership_epoch_v8(&item) == (if (case == 1) 1 else 0), 99);
        if (case == 1) {
            assert!(std::bcs::to_bytes(&item) != original, 99);
            runtime::transfer_owned_external_item_v8(item, seller, s.ctx());
        } else { assert!(std::bcs::to_bytes(&item) == original, 99); s.return_to_sender(item) };
    } else {
        let item = s.take_from_sender_by_id<OwnedBaseItemV8>(item_id);
        assert!(!runtime::owned_base_item_locked_v8(&item), 99);
        assert!(runtime::owned_base_item_holder_v8(&item) == (if (case == 1) buyer else seller), 99);
        assert!(runtime::owned_base_item_ownership_epoch_v8(&item) == (if (case == 1) 1 else 0), 99);
        if (case == 1) {
            // The production transfer rechecks buyer's exact registry row and
            // absence of seller's row, proving settlement rotated the index.
            let mut c = take(&s, ids);
            let owner = runtime::pack_registry_base_item_owner_v8(&c.packs,
                b"part".to_string(), b"item".to_string(), buyer);
            assert!(owner.is_some() && runtime::base_item_ownership_id_v8(owner.borrow()) == item_id
                && runtime::base_item_ownership_epoch_v8(owner.borrow()) == 1, 99);
            assert!(runtime::pack_registry_base_item_owner_v8(&c.packs,
                b"part".to_string(), b"item".to_string(), seller).is_none(), 99);
            let Context { packs, definitions, .. } = &mut c;
            runtime::transfer_owned_base_item_v8(packs, definitions, item, seller, s.ctx());
            put(c);
        } else { assert!(std::bcs::to_bytes(&item) == original, 99); s.return_to_sender(item) };
    };
    std::unit_test::destroy(system); s.end();
}

#[test] fun base_cancel_restores_exact_object() { run(false, 0) }
#[test] fun base_purchase_rotates_holder_and_registry() { run(false, 1) }
#[test, expected_failure(abort_code = 11, location = animacraft_v8_runtime::runtime_v8)]
fun base_custody_prevents_duplicate_claim() { run(false, 2) }
#[test, expected_failure(abort_code = 36, location = animacraft_v8_runtime::runtime_v8)]
fun base_wrong_parent_rejected() { run(false, 3) }
#[test] fun external_cancel_restores_exact_object() { run(true, 0) }
#[test] fun external_purchase_rotates_holder() { run(true, 1) }
#[test, expected_failure(abort_code = 36, location = animacraft_v8_runtime::runtime_v8)]
fun external_wrong_parent_rejected() { run(true, 3) }
#[test, expected_failure(abort_code = 32, location = animacraft_v8_runtime::runtime_v8)]
fun external_nontransferable_rejected() { run(true, 4) }
#[test] fun base_paused_cancel_restores_exact_object() { run(false, 5) }
#[test] fun external_paused_cancel_restores_exact_object() { run(true, 5) }
#[test] fun base_disabled_cancel_restores_exact_object() { run(false, 8) }
#[test] fun external_disabled_cancel_restores_exact_object() { run(true, 8) }
#[test, expected_failure(abort_code = 0, location = animacraft_v8_core::maker_v8)]
fun base_paused_purchase_rejected() { run(false, 7) }
#[test, expected_failure(abort_code = 0, location = animacraft_v8_core::maker_v8)]
fun external_paused_purchase_rejected() { run(true, 7) }
#[test, expected_failure(abort_code = 1, location = animacraft_v8_core::protocol_config_v8)]
fun base_disabled_purchase_rejected() { run(false, 9) }
#[test, expected_failure(abort_code = 1, location = animacraft_v8_core::protocol_config_v8)]
fun external_disabled_purchase_rejected() { run(true, 9) }
#[test, expected_failure(abort_code = 33, location = animacraft_v8_runtime::runtime_v8)]
fun base_buyer_duplicate_entitlement_rejected() { run(false, 10) }
#[test, expected_failure(abort_code = 8, location = animacraft_v8_core::package_binding_v8)]
fun base_wrong_registry_type_rejected() { run(false, 11) }
#[test, expected_failure(abort_code = 8, location = animacraft_v8_core::package_binding_v8)]
fun external_wrong_registry_type_rejected() { run(true, 11) }
#[test, expected_failure(abort_code = 18, location = animacraft_v8_runtime::runtime_v8)]
fun base_equipped_custody_rejected() { run(false, 12) }
#[test, expected_failure(abort_code = 18, location = animacraft_v8_runtime::runtime_v8)]
fun external_equipped_custody_rejected() { run(true, 12) }
#[test, expected_failure(abort_code = 26, location = animacraft_v8_runtime::runtime_v8)]
fun base_seller_cannot_purchase() { run(false, 6) }
#[test, expected_failure(abort_code = 26, location = animacraft_v8_runtime::runtime_v8)]
fun external_seller_cannot_purchase() { run(true, 6) }
