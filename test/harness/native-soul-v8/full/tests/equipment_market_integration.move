/// Real Market entries, installed capability, owned instances and payment coins.
/// Source asset commitments are controlled fixture inputs, not live storage proof.
#[test_only]
module native_soul_v8_graph::equipment_market_integration;

use native_soul_v8_graph::bootstrap;
use native_soul_v8_graph::active_maker as active;
use animacraft_v8_core::maker_v8::{MakerRootV8, MakerAdminCapV8};
use animacraft_v8_core::base_registry_v8::BaseDefinitionRegistryV8;
use animacraft_v8_core::treasury_v8::{Self as core_treasury, MakerTreasuryV8, MakerAccessPassV8};
use animacraft_v8_core::protocol_config_v8::{Self as protocol, ProtocolConfigV8, ProtocolAdminCapV8, ProtocolTreasuryV8};
use animacraft_v8_release::release_v8::{Self as release, ReleasePackageConfigV8};
use animacraft_v8_core::package_binding_v8::{ProductReleaseCatalogV8, FreshTupleReplacementBindingV2};
use animacraft_v8_market::market_v8::{Self as market, MarketPackageConfigV8, MarketRegistryV8, MarketTreasuryV8, EquipmentListingV8};
use animacraft_v8_runtime::runtime_v8::{Self as runtime, RuntimeDefinitionRegistryV8, PackRegistryV8,
    OwnedBaseItemV8, OwnedExternalItemV8, ExternalItemProductV8};
use sui::test_scenario::{Self as ts, Scenario};
use sui::coin::{Self as coin, Coin};
use sui::sui::SUI;

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

fun buy(s: &mut Scenario, c: &mut Context, listing: &mut EquipmentListingV8<SUI>,
    external: bool, item_id: ID, payment: u64, revision: u64, protocol_treasury: &mut ProtocolTreasuryV8<SUI>) {
    let Context { registry, treasury, root, protocol, catalog, replacement, config, packs, definitions, .. } = c;
    let payment = coin::mint_for_testing<SUI>(payment, s.ctx());
    if (external) market::purchase_external_equipment_v8(listing, registry, treasury, root,
        protocol, protocol_treasury, catalog, replacement, config,
        ts::receiving_ticket_by_id<OwnedExternalItemV8>(item_id), payment, revision, s.ctx())
    else market::purchase_base_equipment_v8(listing, registry, treasury, root,
        protocol, protocol_treasury, catalog, replacement, config, packs, definitions,
        ts::receiving_ticket_by_id<OwnedBaseItemV8>(item_id), payment, revision, s.ctx());
}

// 0 buy, 1 cancel, 2 reprice then buy, 3 underpay, 4 stale buy revision,
// 5 self-buy, 6 non-seller cancel, 7 paused cancel, 8 paused recovery,
// 9 active recovery rejection, 10 disabled cancel, 11 disabled recovery,
// 12 second buy, 13 overpay, 14 tiny quote, 15 maximum u64 purchase,
// 16 tiny reprice, 17 paused buy, 18 disabled buy, 20 stale reprice,
// 21 buy after cancel, 22 non-seller reprice, 23 minimum valid price.
fun run(external: bool, case: u8) {
    let seller = @0xA11;
    let buyer = @0xB22;
    let mut s = ts::begin(seller);
    let (protocol_id, setup, mut system) = bootstrap::initialize_for_testing(&mut s);
    let maker = active::new_active_maker_for_testing(&mut s, protocol_id, setup, &mut system);
    let (root, base, maker_treasury, admin_id) = active::maker_ids_for_testing(maker);
    let (definitions, packs, _, _, _, _, _, registry, treasury) = active::companion_ids_for_testing(maker);
    let (catalog, _, _, _, _, config, release_id) = bootstrap::configuration_ids_for_testing(setup);
    let (replacement, _, _) = bootstrap::authority_ids_for_testing(&s, setup);
    let ids = Ids { root, base, maker_treasury, definitions, packs, protocol: protocol_id,
        catalog, replacement, config, registry, treasury };
    s.next_tx(seller);
    let c = take(&s, ids);
    let protocol_treasury_id = *protocol::config_treasury_id_v8(&c.protocol).borrow();
    let mut maker_treasury = s.take_shared_by_id<MakerTreasuryV8<SUI>>(ids.maker_treasury);
    let clock = sui::clock::create_for_testing(s.ctx());
    core_treasury::claim_free_maker_access_v8(&c.root, &mut maker_treasury, &clock, s.ctx());
    clock.destroy_for_testing(); ts::return_shared(maker_treasury); put(c);
    s.next_tx(seller);
    let mut c = take(&s, ids);
    let access = s.take_from_sender<MakerAccessPassV8>();
    let (item_id, original, product_id) = if (external) {
        let (mut product, admin) = runtime::new_external_item_product_v8(&c.root, &c.definitions,
            &c.base, b"part".to_string(), b"external-item".to_string(), b"external-style".to_string(),
            b"track".to_string(), option::none(), option::none(), b"external-public-fixture-blob".to_string(),
            hash(81), b"image/png".to_string(), 69, hash(82), true, s.ctx());
        let item = runtime::mint_owned_external_item_v8(&mut product, &admin, seller, s.ctx());
        let (id, bytes, product_id) = (object::id(&item), std::bcs::to_bytes(&item), object::id(&product));
        runtime::transfer_new_owned_item_to_holder_v8(item);
        runtime::share_external_item_product_v8(product);
        runtime::transfer_external_item_admin_cap_v8(admin, seller);
        (id, bytes, option::some(product_id))
    } else {
        let Context { packs, definitions, base, root, .. } = &mut c;
        let item = runtime::claim_owned_base_item_v8(packs, definitions, base, root, &access,
            b"part".to_string(), b"item".to_string(), s.ctx());
        let (id, bytes) = (object::id(&item), std::bcs::to_bytes(&item));
        runtime::transfer_new_owned_base_item_to_holder_v8(item);
        (id, bytes, option::none())
    };
    s.return_to_sender(access); put(c);
    s.next_tx(seller);
    let mut c = take(&s, ids);
    let original_price = if (case == 14) 39 else if (case == 15) 18446744073709551615
        else if (case == 23) 40 else 10_000u64;
    let quote = market::quote_equipment_resale_v8(&c.registry, &c.treasury, &c.root, original_price);
    assert!(market::quote_kind_v8(&quote) == market::quote_equipment_resale_kind_v8()
        && market::quote_creator_atomic_v8(&quote) == 0 && market::quote_source_atomic_v8(&quote) == 0, 99);
    let Context { registry, treasury, root, protocol, catalog, replacement, config, packs, definitions, base } = &mut c;
    let listing_id = if (external) {
        let product = s.take_shared_by_id<ExternalItemProductV8>(*product_id.borrow());
        let item = s.take_from_sender_by_id<OwnedExternalItemV8>(item_id);
        let id = market::list_external_equipment_v8(registry, treasury, root, protocol,
            catalog, replacement, config, &product, item, original_price, s.ctx());
        ts::return_shared(product); id
    } else {
        let item = s.take_from_sender_by_id<OwnedBaseItemV8>(item_id);
        market::list_base_equipment_v8(registry, treasury, root, protocol, catalog,
            replacement, config, packs, definitions, base, item, original_price, s.ctx())
    };
    assert!(market::registry_listing_count_v8(&c.registry) == 1
        && market::registry_escrow_count_v8(&c.registry) == 1 && market::treasury_balance_v8(&c.treasury) == 0, 99);
    put(c);
    s.next_tx(if (case == 22) buyer else seller);
    let mut c = take(&s, ids);
    let mut listing = s.take_shared_by_id<EquipmentListingV8<SUI>>(listing_id);
    assert!(market::equipment_listing_id_v8(&listing) == listing_id
        && market::equipment_listing_asset_id_v8(&listing) == item_id
        && market::equipment_listing_seller_v8(&listing) == seller
        && market::equipment_listing_ownership_epoch_v8(&listing) == 0
        && market::equipment_listing_status_v8(&listing) == market::listing_open_v8(), 99);
    let custody = std::bcs::to_bytes(market::equipment_listing_custody_v8(&listing));
    let repriced = case == 2 || case == 16 || case == 20 || case == 22;
    if (repriced) {
        let Context { registry, treasury, root, protocol, catalog, replacement, config, .. } = &mut c;
        market::reprice_equipment_listing_v8(&mut listing, registry, treasury, root, protocol,
            catalog, replacement, config, if (case == 20) 1 else 0,
            if (case == 16) 39 else 20_000, s.ctx());
        assert!(std::bcs::to_bytes(market::equipment_listing_custody_v8(&listing)) == custody
            && market::equipment_listing_revision_v8(&listing) == 1, 99);
    };
    let price = if (repriced) 20_000 else original_price;
    let revision = if (repriced) 1 else 0u64;
    let expected_fee = (((price as u128) * 250) / 10_000) as u64;
    assert!(market::equipment_listing_protocol_atomic_v8(&listing) == expected_fee
        && market::equipment_listing_seller_atomic_v8(&listing) == price - expected_fee
        && market::equipment_listing_creator_atomic_v8(&listing) == 0
        && market::equipment_listing_source_atomic_v8(&listing) == 0, 99);
    if (case == 7 || case == 8 || case == 17) {
        let config = s.take_shared_by_id<ReleasePackageConfigV8>(release_id);
        let admin = s.take_from_sender_by_id<MakerAdminCapV8>(admin_id);
        let Context { root, protocol, catalog, replacement, .. } = &mut c;
        release::pause_maker_v8(root, &admin, protocol, catalog, replacement, &config, s.ctx());
        ts::return_shared(config); s.return_to_sender(admin);
    };
    if (case == 10 || case == 11 || case == 18) {
        let admin = s.take_from_sender<ProtocolAdminCapV8>();
        protocol::set_protocol_enabled_v8(&mut c.protocol, &admin, false);
        s.return_to_sender(admin);
    };
    ts::return_shared(listing); put(c);
    let cancel = case == 1 || case == 6 || case == 7 || case == 10 || case == 21;
    let recover = case == 8 || case == 9 || case == 11;
    s.next_tx(if ((cancel && case != 6) || case == 5) seller else buyer);
    let mut c = take(&s, ids);
    let mut listing = s.take_shared_by_id<EquipmentListingV8<SUI>>(listing_id);
    let mut protocol_treasury = s.take_shared_by_id<ProtocolTreasuryV8<SUI>>(protocol_treasury_id);
    if (cancel || recover) {
        let Context { registry, treasury, root, protocol, catalog, replacement, config, packs, definitions, .. } = &mut c;
        if (external) {
            let receiving = ts::receiving_ticket_by_id<OwnedExternalItemV8>(item_id);
            if (recover) market::recover_external_equipment_listing_v8(&mut listing, registry, treasury, root,
                protocol, catalog, replacement, config, receiving, revision)
            else market::cancel_external_equipment_listing_v8(&mut listing, registry, treasury, root,
                catalog, replacement, config, receiving, revision, s.ctx());
        } else {
            let receiving = ts::receiving_ticket_by_id<OwnedBaseItemV8>(item_id);
            if (recover) market::recover_base_equipment_listing_v8(&mut listing, registry, treasury, root,
                protocol, catalog, replacement, config, packs, definitions, receiving, revision)
            else market::cancel_base_equipment_listing_v8(&mut listing, registry, treasury, root,
                catalog, replacement, config, packs, definitions, receiving, revision, s.ctx());
        };
        assert!(market::equipment_listing_status_v8(&listing) == (if (recover)
            market::listing_recovered_v8() else market::listing_canceled_v8()), 99);
        assert!(market::equipment_listing_terminal_recipient_v8(&listing) == seller
            && protocol::protocol_treasury_balance_for_testing(&protocol_treasury) == 0
            && market::registry_gross_volume_atomic_v8(&c.registry) == 0
            && market::registry_completed_sale_count_v8(&c.registry) == 0, 99);
        assert!(market::registry_canceled_sale_count_v8(&c.registry) == (if (recover) 0 else 1)
            && market::registry_recovered_sale_count_v8(&c.registry) == (if (recover) 1 else 0), 99);
    } else {
        buy(&mut s, &mut c, &mut listing, external, item_id,
            if (case == 3) price - 1 else if (case == 13) price + 1 else price,
            if (case == 4) revision + 1 else revision, &mut protocol_treasury);
        assert!(market::equipment_listing_status_v8(&listing) == market::listing_settled_v8()
            && market::equipment_listing_terminal_recipient_v8(&listing) == buyer
            && market::registry_completed_sale_count_v8(&c.registry) == 1
            && market::registry_gross_volume_atomic_v8(&c.registry) == (price as u128)
            && market::registry_protocol_paid_atomic_v8(&c.registry) == (expected_fee as u128)
            && market::registry_seller_paid_atomic_v8(&c.registry) == ((price - expected_fee) as u128)
            && protocol::protocol_treasury_balance_for_testing(&protocol_treasury) == expected_fee, 99);
    };
    assert!(market::registry_creator_paid_atomic_v8(&c.registry) == 0
        && market::registry_source_paid_atomic_v8(&c.registry) == 0
        && market::registry_escrow_count_v8(&c.registry) == 0
        && market::treasury_balance_v8(&c.treasury) == 0
        && market::equipment_listing_revision_v8(&listing) == revision + 1
        && std::bcs::to_bytes(market::equipment_listing_custody_v8(&listing)) == custody, 99);
    if (!cancel && !recover) assert!(market::treasury_gross_escrowed_atomic_v8(&c.treasury) == (price as u128)
        && market::treasury_gross_released_atomic_v8(&c.treasury) == (price as u128), 99);
    ts::return_shared(protocol_treasury); ts::return_shared(listing); put(c);
    if (case == 12 || case == 21) {
        s.next_tx(buyer);
        let mut c = take(&s, ids);
        let mut listing = s.take_shared_by_id<EquipmentListingV8<SUI>>(listing_id);
        let mut pt = s.take_shared_by_id<ProtocolTreasuryV8<SUI>>(protocol_treasury_id);
        buy(&mut s, &mut c, &mut listing, external, item_id, price, revision + 1, &mut pt);
        ts::return_shared(pt); ts::return_shared(listing); put(c);
    };
    s.next_tx(if (cancel || recover) seller else buyer);
    if (external) {
        let item = s.take_from_sender_by_id<OwnedExternalItemV8>(item_id);
        if (cancel || recover) assert!(std::bcs::to_bytes(&item) == original, 99)
        else assert!(runtime::owned_item_holder_v8(&item) == buyer && runtime::owned_item_ownership_epoch_v8(&item) == 1, 99);
        s.return_to_sender(item);
    } else {
        let item = s.take_from_sender_by_id<OwnedBaseItemV8>(item_id);
        if (cancel || recover) assert!(std::bcs::to_bytes(&item) == original, 99)
        else {
            assert!(runtime::owned_base_item_holder_v8(&item) == buyer && runtime::owned_base_item_ownership_epoch_v8(&item) == 1, 99);
            let c = take(&s, ids);
            let record = runtime::pack_registry_base_item_owner_v8(&c.packs, b"part".to_string(), b"item".to_string(), buyer);
            assert!(record.is_some() && runtime::base_item_ownership_id_v8(record.borrow()) == item_id
                && runtime::base_item_ownership_epoch_v8(record.borrow()) == 1
                && runtime::pack_registry_base_item_owner_v8(&c.packs, b"part".to_string(), b"item".to_string(), seller).is_none(), 99);
            put(c);
        };
        s.return_to_sender(item);
    };
    if (!cancel && !recover) {
        s.next_tx(seller);
        let payment = s.take_from_sender<Coin<SUI>>();
        assert!(coin::value(&payment) == price - expected_fee, 99);
        coin::burn_for_testing(payment);
    };
    std::unit_test::destroy(system); s.end();
}

#[test] fun base_purchase_pays_only_250_protocol_and_9750_seller() { run(false, 0) }
#[test] fun external_purchase_pays_only_250_protocol_and_9750_seller() { run(true, 0) }
#[test] fun base_cancel_returns_exact_asset() { run(false, 1) }
#[test] fun external_cancel_returns_exact_asset() { run(true, 1) }
#[test] fun base_reprice_changes_quote_not_custody() { run(false, 2) }
#[test] fun external_reprice_changes_quote_not_custody() { run(true, 2) }
#[test] fun base_paused_cancel_returns_exact_asset() { run(false, 7) }
#[test] fun external_paused_cancel_returns_exact_asset() { run(true, 7) }
#[test] fun base_paused_permissionless_recovery_returns_seller() { run(false, 8) }
#[test] fun external_paused_permissionless_recovery_returns_seller() { run(true, 8) }
#[test] fun base_disabled_cancel_returns_exact_asset() { run(false, 10) }
#[test] fun external_disabled_cancel_returns_exact_asset() { run(true, 10) }
#[test] fun base_disabled_permissionless_recovery_returns_seller() { run(false, 11) }
#[test] fun external_disabled_permissionless_recovery_returns_seller() { run(true, 11) }
#[test] fun base_u64_max_settlement_does_not_overflow() { run(false, 15) }
#[test] fun external_u64_max_settlement_does_not_overflow() { run(true, 15) }
#[test] fun minimum_40_atomic_price_has_1_atomic_protocol_fee() { run(false, 23) }
#[test, expected_failure(abort_code = 7, location = animacraft_v8_market::market_v8)]
fun base_underpayment_rejected() { run(false, 3) }
#[test, expected_failure(abort_code = 7, location = animacraft_v8_market::market_v8)]
fun external_overpayment_rejected() { run(true, 13) }
#[test, expected_failure(abort_code = 10, location = animacraft_v8_market::market_v8)]
fun base_stale_buy_revision_rejected() { run(false, 4) }
#[test, expected_failure(abort_code = 10, location = animacraft_v8_market::market_v8)]
fun external_stale_reprice_rejected() { run(true, 20) }
#[test, expected_failure(abort_code = 11, location = animacraft_v8_market::market_v8)]
fun base_self_purchase_rejected() { run(false, 5) }
#[test, expected_failure(abort_code = 11, location = animacraft_v8_market::market_v8)]
fun external_self_purchase_rejected() { run(true, 5) }
#[test, expected_failure(abort_code = 8, location = animacraft_v8_market::market_v8)]
fun base_non_seller_cancel_rejected() { run(false, 6) }
#[test, expected_failure(abort_code = 8, location = animacraft_v8_market::market_v8)]
fun external_non_seller_reprice_rejected() { run(true, 22) }
#[test, expected_failure(abort_code = 9, location = animacraft_v8_market::market_v8)]
fun base_active_permissionless_recovery_rejected() { run(false, 9) }
#[test, expected_failure(abort_code = 9, location = animacraft_v8_market::market_v8)]
fun external_active_permissionless_recovery_rejected() { run(true, 9) }
#[test, expected_failure(abort_code = 6, location = animacraft_v8_market::market_v8)]
fun base_double_purchase_rejected() { run(false, 12) }
#[test, expected_failure(abort_code = 6, location = animacraft_v8_market::market_v8)]
fun external_purchase_after_cancel_rejected() { run(true, 21) }
#[test, expected_failure(abort_code = 5, location = animacraft_v8_market::market_v8)]
fun price_39_cannot_erase_protocol_fee() { run(false, 14) }
#[test, expected_failure(abort_code = 5, location = animacraft_v8_market::market_v8)]
fun reprice_39_cannot_erase_protocol_fee() { run(true, 16) }
#[test, expected_failure(abort_code = 3, location = animacraft_v8_market::market_v8)]
fun base_paused_purchase_rejected() { run(false, 17) }
#[test, expected_failure(abort_code = 3, location = animacraft_v8_market::market_v8)]
fun external_paused_purchase_rejected() { run(true, 17) }
#[test, expected_failure(abort_code = 1, location = animacraft_v8_core::protocol_config_v8)]
fun base_disabled_purchase_rejected() { run(false, 18) }
#[test, expected_failure(abort_code = 1, location = animacraft_v8_core::protocol_config_v8)]
fun external_disabled_purchase_rejected() { run(true, 18) }
