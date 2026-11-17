#[test_only]
module native_soul_v8_graph::native_soul_pack_v1;

use native_soul_v8_graph::{bootstrap, active_maker as active,
    native_completion as complete, pack_player};
use animacraft_v8_core::maker_v8::MakerRootV8;
use animacraft_v8_core::protocol_config_v8::{Self as protocol, ProtocolConfigV8, ProtocolTreasuryV8};
use animacraft_v8_core::treasury_v8::MakerAccessPassV8;
use animacraft_v8_core::base_registry_v8::BaseDefinitionRegistryV8;
use animacraft_v8_output::output_v8::NativeSoulBindingV8;
use animacraft_v8_runtime::runtime_v8::{Self as runtime, MakerLoadoutV8,
    RuntimeDefinitionRegistryV8, PackRegistryV8, PackReleaseV8, PackTreasuryV8, SoulPackPassV1};
use soulidity::soul::{Self as soul, SoulState};
use soulidity::animacraft_equipment_adapter_v8 as equipment;
use soulidity::animacraft_pack_adapter_v1 as packs;
use sui::{clock, coin, sui::SUI, test_scenario as scenario};

const PRICE: u64 = 1_000;

fun run_case(case: u8) {
    let author = @0xA11;
    let holder = @0xB22;
    let mut sc = scenario::begin(author);
    let (protocol_id, setup, mut system) = bootstrap::initialize_for_testing(&mut sc);
    let maker = active::new_active_maker_for_testing(&mut sc, protocol_id, setup, &mut system);
    let market = complete::initialize_market_for_testing(&mut sc);
    let published = pack_player::publish_pack_with_policy_for_testing(
        &mut sc, maker, runtime::access_paid_v8(), PRICE);
    let (release_id, _, treasury_id) = pack_player::published_ids_for_testing(published);
    let (root_id, base_id, _, _) = active::maker_ids_for_testing(maker);
    let (definitions_id, registry_id, _, _, _, _, _, _, _) = active::companion_ids_for_testing(maker);
    sc.next_tx(holder);
    let completed = complete::mint_for_testing(&mut sc, protocol_id, setup,
        active::maker_objects_for_testing(maker), market, &mut system);
    let (soul_id, state_id, binding_id, _, _) = complete::native_ids(completed);
    let (_, _, _, _, access_id) = complete::holder_ids(completed);
    let mut state = sc.take_shared_by_id<SoulState>(state_id);
    let binding = sc.take_immutable_by_id<NativeSoulBindingV8>(binding_id);
    let root = sc.take_shared_by_id<MakerRootV8<SUI>>(root_id);
    let config = sc.take_shared_by_id<ProtocolConfigV8>(protocol_id);
    let definitions = sc.take_shared_by_id<RuntimeDefinitionRegistryV8>(definitions_id);
    let registry = sc.take_shared_by_id<PackRegistryV8>(registry_id);
    let access = sc.take_from_sender_by_id<MakerAccessPassV8>(access_id);
    let equipment_id = equipment::create_equipment_v8(&mut state, &binding,
        &root, &config, &definitions, &registry, &access, sc.ctx());
    let protocol_treasury_id = *protocol::config_treasury_id_v8(&config).borrow();
    scenario::return_shared(state);
    scenario::return_immutable(binding);
    scenario::return_shared(root);
    scenario::return_shared(config);
    scenario::return_shared(definitions);
    scenario::return_shared(registry);
    sc.return_to_sender(access);
    sc.next_tx(if (case == 2) @0xC33 else holder);

    let state = sc.take_shared_by_id<SoulState>(state_id);
    let mut equipped = sc.take_shared_by_id<MakerLoadoutV8>(equipment_id);
    let mut release = sc.take_shared_by_id<PackReleaseV8<SUI>>(release_id);
    let registry = sc.take_shared_by_id<PackRegistryV8>(registry_id);
    let root = sc.take_shared_by_id<MakerRootV8<SUI>>(root_id);
    let config = sc.take_shared_by_id<ProtocolConfigV8>(protocol_id);
    let mut treasury = sc.take_shared_by_id<PackTreasuryV8<SUI>>(treasury_id);
    let mut protocol_treasury = sc.take_shared_by_id<ProtocolTreasuryV8<SUI>>(protocol_treasury_id);
    let mut clock = clock::create_for_testing(sc.ctx());
    clock::increment_for_testing(&mut clock, 1);
    assert!(runtime::pack_registry_schema_v1(&registry) == 9
        && runtime::pack_requires_soul_v1(&release)
        && runtime::pack_release_lifecycle_v8(&release) == 5, 99);
    let payment = coin::mint_for_testing<SUI>(PRICE, sc.ctx());
    if (case == 5) {
        let legacy = runtime::purchase_pack_pass_v8(&mut release, &registry, &mut treasury,
            &root, &config, &mut protocol_treasury, payment, &clock, sc.ctx());
        runtime::transfer_pack_pass_to_holder_v8(legacy);
        abort 99
    };
    let pass_id = if (case == 6) {
        runtime::legacy_pack_schema_for_testing(&mut release);
        let legacy = runtime::purchase_pack_pass_v8(&mut release, &registry, &mut treasury,
            &root, &config, &mut protocol_treasury, payment, &clock, sc.ctx());
        packs::migrate_soul_pack_v1(&state, &mut equipped, legacy, &mut release, &registry,
            &root, &config, sc.ctx())
    } else packs::purchase_soul_pack_v1(&state, &mut equipped, &mut release, &registry,
        &mut treasury, &root, &config, &mut protocol_treasury, payment,
        if (case == 3) PRICE + 1 else PRICE, if (case == 4) 0 else 10_000, &clock, sc.ctx());
    assert!(runtime::soul_pack_entitlements_v1(&equipped).length() == 1, 100);
    let row = runtime::soul_pack_entitlements_v1(&equipped)[0];
    assert!(runtime::soul_pack_entitlement_release_v1(&row) == release_id
        && runtime::soul_pack_entitlement_pass_v1(&row) == pass_id, 101);
    if (case == 1) {
        let payment = coin::mint_for_testing<SUI>(PRICE, sc.ctx());
        packs::purchase_soul_pack_v1(&state, &mut equipped, &mut release, &registry,
            &mut treasury, &root, &config, &mut protocol_treasury, payment, PRICE, 10_000, &clock, sc.ctx());
    };
    clock.destroy_for_testing();
    scenario::return_shared(state);
    scenario::return_shared(equipped);
    scenario::return_shared(release);
    scenario::return_shared(registry);
    scenario::return_shared(root);
    scenario::return_shared(config);
    scenario::return_shared(treasury);
    scenario::return_shared(protocol_treasury);
    sc.next_tx(holder);

    let state = sc.take_shared_by_id<SoulState>(state_id);
    let mut equipped = sc.take_shared_by_id<MakerLoadoutV8>(equipment_id);
    let pass = sc.take_shared_by_id<SoulPackPassV1>(pass_id);
    let release = sc.take_shared_by_id<PackReleaseV8<SUI>>(release_id);
    let root = sc.take_shared_by_id<MakerRootV8<SUI>>(root_id);
    let config = sc.take_shared_by_id<ProtocolConfigV8>(protocol_id);
    let definitions = sc.take_shared_by_id<RuntimeDefinitionRegistryV8>(definitions_id);
    let base = sc.take_shared_by_id<BaseDefinitionRegistryV8>(base_id);
    let registry = sc.take_shared_by_id<PackRegistryV8>(registry_id);
    let access = sc.take_from_sender_by_id<MakerAccessPassV8>(access_id);
    packs::assert_soul_pack_read_v1(&state, &equipped, &release, &pass, &config, sc.ctx());
    assert!(runtime::soul_pack_pass_paid_atomic_v1(&pass) == PRICE
        && runtime::soul_pack_pass_legacy_id_v1(&pass).is_some() == (case == 6), 104);
    assert!(runtime::soul_pack_pass_soul_id_v1(&pass) == soul_id
        && runtime::soul_pack_pass_state_id_v1(&pass) == state_id, 102);
    let update = equipment::begin_update_v8(&state, &mut equipped, &config, 0, sc.ctx());
    runtime::select_soul_pack_style_v1(&update, &mut equipped, &root, &definitions,
        &base, &registry, &release, &pass, &access, 0, option::none(),
        b"part".to_string(), b"pack-item".to_string(), b"pack-style".to_string(), option::none(), sc.ctx());
    equipment::finish_update_v8(&mut equipped, &definitions, &base, vector[], update);
    assert!(runtime::loadout_revision_v8(&equipped) == 1
        && runtime::loadout_selection_count_v8(&equipped) == 1, 103);
    scenario::return_shared(state);
    scenario::return_shared(equipped);
    scenario::return_shared(pass);
    scenario::return_shared(release);
    scenario::return_shared(root);
    scenario::return_shared(config);
    scenario::return_shared(definitions);
    scenario::return_shared(base);
    scenario::return_shared(registry);
    sc.return_to_sender(access);
    std::unit_test::destroy(system);
    sc.end();
}

#[test]
fun paid_pack_is_bought_after_complete_for_one_exact_soul() { run_case(0); }
#[test, expected_failure(abort_code = 34, location = runtime)]
fun duplicate_soul_purchase_rejects_before_payment() { run_case(1); }
#[test, expected_failure(abort_code = 1, location = soul)]
fun another_wallet_cannot_pay_for_the_soul() { run_case(2); }
#[test, expected_failure(abort_code = 17, location = runtime)]
fun changed_quote_price_is_rejected() { run_case(3); }
#[test, expected_failure(abort_code = 21, location = runtime)]
fun expired_quote_is_rejected() { run_case(4); }
#[test, expected_failure(abort_code = 10, location = runtime)]
fun new_paid_release_rejects_wallet_only_purchase() { run_case(5); }

#[test]
fun explicit_legacy_pass_migration_preserves_payment_without_a_second_coin() { run_case(6); }
