/// Exercise the three Wardrobe QA entry policies with fixture SUI as payment.
/// Pack entry and the zero-price Complete settle in separate transactions.
#[test_only]
module native_soul_v8_graph::native_pack_entitlements;

use native_soul_v8_graph::{active_maker as active, bootstrap, native_completion as complete, pack_player};
use animacraft_v8_core::maker_v8::MakerRootV8;
use animacraft_v8_core::protocol_config_v8::{Self as protocol, ProtocolConfigV8, ProtocolTreasuryV8};
use animacraft_v8_core::treasury_v8::{Self as treasury, MakerAccessPassV8, MakerTreasuryV8};
use animacraft_v8_output::output_v8::{Self as output, CompleteReceiptV8, OutputRegistryV8};
use animacraft_v8_runtime::runtime_v8::{Self as runtime, MakerLoadoutV8, PackPassV8,
    PackRegistryV8, PackReleaseV8, PackTreasuryV8};
use sui::{clock, coin, sui::SUI, test_scenario::{Self as scenario, Scenario}};

const PRICE: u64 = 1_000;
const EWrongInventory: u64 = 1;
const EWrongAccounting: u64 = 2;
const EWrongCompletion: u64 = 3;

#[test]
fun free_entry_and_complete_reuse_exact_pass() {
    run_policy(runtime::access_free_v8(), false);
}

#[test]
fun paid_entry_splits_revenue_once_and_complete_reuses_pass() {
    run_policy(runtime::access_paid_v8(), false);
}

#[test]
fun included_entry_uses_existing_maker_access_and_complete_reuses_pass() {
    run_policy(runtime::access_included_with_maker_v8(), false);
}

#[test, expected_failure(abort_code = 34, location = animacraft_v8_runtime::runtime_v8)]
fun second_paid_entry_is_rejected() {
    run_policy(runtime::access_paid_v8(), true);
}

fun claim_maker_access(scenario: &mut Scenario, root_id: ID, treasury_id: ID) {
    let root = scenario.take_shared_by_id<MakerRootV8<SUI>>(root_id);
    let mut treasury = scenario.take_shared_by_id<MakerTreasuryV8<SUI>>(treasury_id);
    let clock = clock::create_for_testing(scenario.ctx());
    treasury::claim_free_maker_access_v8(&root, &mut treasury, &clock, scenario.ctx());
    clock.destroy_for_testing();
    scenario::return_shared(root);
    scenario::return_shared(treasury);
    let holder = scenario.ctx().sender();
    scenario.next_tx(holder);
}

fun run_policy(policy: u8, duplicate_purchase: bool) {
    let author = @0xA11;
    let holder = @0xB22;
    let mut scenario = scenario::begin(author);
    let (protocol_id, setup, mut system) = bootstrap::initialize_for_testing(&mut scenario);
    let maker = active::new_active_maker_for_testing(&mut scenario, protocol_id, setup, &mut system);
    let market = complete::initialize_market_for_testing(&mut scenario);
    let paid = policy == runtime::access_paid_v8();
    let included = policy == runtime::access_included_with_maker_v8();
    let pack = pack_player::publish_pack_with_policy_for_testing(
        &mut scenario, maker, policy, if (paid) PRICE else 0);
    let (release_id, _, pack_treasury_id) = pack_player::published_ids_for_testing(pack);
    let (root_id, _, maker_treasury_id, _) = active::maker_ids_for_testing(maker);
    let (_, packs_id, _, _, output_id, _, _, _, _) = active::companion_ids_for_testing(maker);
    let config = scenario.take_shared_by_id<ProtocolConfigV8>(protocol_id);
    let protocol_treasury_id = *protocol::config_treasury_id_v8(&config).borrow();
    scenario::return_shared(config);
    scenario.next_tx(holder);
    if (included) claim_maker_access(&mut scenario, root_id, maker_treasury_id);
    assert!(scenario.ids_for_sender<MakerAccessPassV8>().length() == if (included) 1 else 0,
        EWrongInventory);

    let mut release = scenario.take_shared_by_id<PackReleaseV8<SUI>>(release_id);
    let packs = scenario.take_shared_by_id<PackRegistryV8>(packs_id);
    let clock = clock::create_for_testing(scenario.ctx());
    let pass = if (paid) {
        let root = scenario.take_shared_by_id<MakerRootV8<SUI>>(root_id);
        let config = scenario.take_shared_by_id<ProtocolConfigV8>(protocol_id);
        let mut pack_treasury = scenario.take_shared_by_id<PackTreasuryV8<SUI>>(pack_treasury_id);
        let mut protocol_treasury = scenario.take_shared_by_id<ProtocolTreasuryV8<SUI>>(protocol_treasury_id);
        let payment = coin::mint_for_testing<SUI>(PRICE, scenario.ctx());
        let pass = runtime::purchase_pack_pass_v8(&mut release, &packs, &mut pack_treasury, &root,
            &config, &mut protocol_treasury, payment, &clock, scenario.ctx());
        scenario::return_shared(root);
        scenario::return_shared(config);
        scenario::return_shared(pack_treasury);
        scenario::return_shared(protocol_treasury);
        pass
    } else if (included) {
        let root = scenario.take_shared_by_id<MakerRootV8<SUI>>(root_id);
        let access = scenario.take_from_sender<MakerAccessPassV8>();
        let pass = runtime::issue_included_pack_pass_v8(
            &mut release, &packs, &root, &access, &clock, scenario.ctx());
        scenario.return_to_sender(access);
        scenario::return_shared(root);
        pass
    } else runtime::issue_free_pack_pass_v8(&mut release, &packs, &clock, scenario.ctx());
    let pass_id = object::id(&pass);
    let original_pass = std::bcs::to_bytes(&pass);
    runtime::transfer_pack_pass_to_holder_v8(pass);
    clock.destroy_for_testing();
    scenario::return_shared(release);
    scenario::return_shared(packs);
    scenario.next_tx(holder);

    if (!included) claim_maker_access(&mut scenario, root_id, maker_treasury_id);
    let completed = complete::mint_with_pack_for_testing(&mut scenario, protocol_id, setup,
        active::maker_objects_for_testing(maker), market, &mut system, release_id, pass_id);
    let (_, _, _, _, receipt_id) = complete::native_ids(completed);
    let (_, _, loadout_id, _, access_id) = complete::holder_ids(completed);

    // Read original entitlements and the frozen Complete receipt after reopening.
    assert!(scenario.ids_for_sender<PackPassV8>() == vector[pass_id], EWrongInventory);
    assert!(scenario.ids_for_sender<MakerAccessPassV8>() == vector[access_id], EWrongInventory);
    let pass = scenario.take_from_sender_by_id<PackPassV8>(pass_id);
    assert!(std::bcs::to_bytes(&pass) == original_pass, EWrongInventory);
    let loadout = scenario.take_from_sender_by_id<MakerLoadoutV8>(loadout_id);
    let receipt = scenario.take_immutable_by_id<CompleteReceiptV8>(receipt_id);
    let outputs = scenario.take_shared_by_id<OutputRegistryV8>(output_id);
    assert!(output::receipt_loadout_id_v8(&receipt) == loadout_id
        && output::receipt_loadout_revision_v8(&receipt) == runtime::loadout_revision_v8(&loadout)
        && output::output_registry_total_complete_count_v8(&outputs) == 1, EWrongCompletion);

    let pack_treasury = scenario.take_shared_by_id<PackTreasuryV8<SUI>>(pack_treasury_id);
    let protocol_treasury = scenario.take_shared_by_id<ProtocolTreasuryV8<SUI>>(protocol_treasury_id);
    let maker_treasury = scenario.take_shared_by_id<MakerTreasuryV8<SUI>>(maker_treasury_id);
    // The fixture's protocol fee is 10%. Complete and Maker access cost zero.
    assert!(runtime::pack_treasury_balance_v8(&pack_treasury) == if (paid) 900 else 0,
        EWrongAccounting);
    assert!(protocol::protocol_treasury_balance_for_testing(&protocol_treasury) == if (paid) 100 else 0,
        EWrongAccounting);
    assert!(treasury::maker_treasury_balance_v2(&maker_treasury) == 0, EWrongAccounting);
    scenario::return_shared(pack_treasury);
    scenario::return_shared(protocol_treasury);
    scenario::return_shared(maker_treasury);
    scenario::return_shared(outputs);
    scenario::return_immutable(receipt);
    scenario.return_to_sender(loadout);
    scenario.return_to_sender(pass);

    if (duplicate_purchase) {
        scenario.next_tx(holder);
        let mut release = scenario.take_shared_by_id<PackReleaseV8<SUI>>(release_id);
        let packs = scenario.take_shared_by_id<PackRegistryV8>(packs_id);
        let root = scenario.take_shared_by_id<MakerRootV8<SUI>>(root_id);
        let config = scenario.take_shared_by_id<ProtocolConfigV8>(protocol_id);
        let mut pack_treasury = scenario.take_shared_by_id<PackTreasuryV8<SUI>>(pack_treasury_id);
        let mut protocol_treasury = scenario.take_shared_by_id<ProtocolTreasuryV8<SUI>>(protocol_treasury_id);
        let clock = clock::create_for_testing(scenario.ctx());
        let payment = coin::mint_for_testing<SUI>(PRICE, scenario.ctx());
        let duplicate = runtime::purchase_pack_pass_v8(&mut release, &packs, &mut pack_treasury, &root,
            &config, &mut protocol_treasury, payment, &clock, scenario.ctx());
        runtime::transfer_pack_pass_to_holder_v8(duplicate);
        abort EWrongInventory
    };
    std::unit_test::destroy(system);
    scenario.end();
}
