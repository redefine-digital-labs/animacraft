/// Current counterparts of retired issuer/protected-read/market guards. These
/// execute actual protected Complete and native mint, not fixture provenance.
/// Ciphertext hashes/storage use declared test bytes, not a remote Seal service.
#[test_only]
module native_soul_v8_graph::native_cutover_integration;

use native_soul_v8_graph::{bootstrap, active_maker as active, native_completion as complete};
use animacraft_v8_core::maker_v8::MakerRootV8;
use animacraft_v8_core::protocol_config_v8::ProtocolConfigV8;
use animacraft_v8_core::package_binding_v8::ProductReleaseCatalogV8;
use animacraft_v8_seal::seal_v8::{SealPolicyConfigV8, SealRegistryV8};
use animacraft_v8_output::output_v8::{Self as output, NativeSoulBindingV8, CompleteOutputV8, CompleteReceiptV8};
use animacraft_v8_release::release_v8::{Self as release, ReleasePackageConfigV8};
use soulidity::animacraft_v8_binding as binding;
use soulidity::market::{Self as market, MarketConfigV2, KioskRegistry, SoulListing};
use soulidity::collection::{Self as collection, SoulCollectionRight};
use soulidity::soul::{Self as soul, Soul, SoulState};
use kiosk::personal_kiosk::PersonalKioskCap;
use sui::kiosk::Kiosk;
use sui::transfer_policy::TransferPolicy;
use sui::test_scenario::{Self as ts, Scenario};
use sui::sui::SUI;
use usdc::usdc::USDC;

const HOLDER: address = @0xA11;
const BUYER: address = @0xB22;
const PRICE: u64 = 1_000_000;

fun read_complete(scenario: &mut Scenario, protocol_id: ID, setup: bootstrap::SetupIds,
    maker: active::ActiveMakerIds, completed: complete::NativeCompletionIds,
    known_seal_id: Option<vector<u8>>,
): (vector<u8>, vector<u8>, vector<u8>, vector<u8>) {
    let (_, state_id, binding_id, output_id, receipt_id) = complete::native_ids(completed);
    let (root_id, _, _, _) = active::maker_ids_for_testing(maker);
    let (_, _, _, seal_registry_id, _, _, _, _, _) = active::companion_ids_for_testing(maker);
    let (catalog_id, seal_policy_id, _, _, _, _, release_id) = bootstrap::configuration_ids_for_testing(setup);
    let state = scenario.take_shared_by_id<SoulState>(state_id);
    let provenance = scenario.take_immutable_by_id<NativeSoulBindingV8>(binding_id);
    let image = scenario.take_immutable_by_id<CompleteOutputV8>(output_id);
    let receipt = scenario.take_immutable_by_id<CompleteReceiptV8>(receipt_id);
    let root = scenario.take_shared_by_id<MakerRootV8<SUI>>(root_id);
    let protocol = scenario.take_shared_by_id<ProtocolConfigV8>(protocol_id);
    let catalog = scenario.take_shared_by_id<ProductReleaseCatalogV8>(catalog_id);
    let config = scenario.take_shared_by_id<ReleasePackageConfigV8>(release_id);
    let registry = scenario.take_shared_by_id<SealRegistryV8>(seal_registry_id);
    let policy = scenario.take_shared_by_id<SealPolicyConfigV8>(seal_policy_id);
    let seal_id = if (known_seal_id.is_some()) *known_seal_id.borrow() else {
        let proof = binding::certify_native_complete_read_v8(&state, &provenance,
            &image, &receipt, &root, &protocol, scenario.ctx());
        let (holder, proven_receipt, proven_output, _, _, _, _, _, _, id) =
            output::consume_native_complete_decrypt_proof_v8(proof);
        assert!(holder == soul::current_owner(&state) && proven_receipt == receipt_id
            && proven_output == output_id && !id.is_empty(), 99);
        id
    };
    // This test-only delegate invokes the unchanged private entry itself.
    release::seal_approve_complete_for_testing_v8(seal_id, &state, &provenance,
        &image, &receipt, &root, &protocol, &catalog, &config, &registry, &policy, scenario.ctx());
    let binding_bytes = std::bcs::to_bytes(&provenance);
    let image_bytes = std::bcs::to_bytes(&image);
    let receipt_bytes = std::bcs::to_bytes(&receipt);
    ts::return_shared(state); ts::return_immutable(provenance);
    ts::return_immutable(image); ts::return_immutable(receipt);
    ts::return_shared(root); ts::return_shared(protocol); ts::return_shared(catalog);
    ts::return_shared(config); ts::return_shared(registry); ts::return_shared(policy);
    (binding_bytes, image_bytes, receipt_bytes, seal_id)
}

fun run_cutover(mode: u8) {
    let mut scenario = ts::begin(HOLDER);
    let (protocol_id, setup, mut system) = bootstrap::initialize_for_testing(&mut scenario);
    let maker = active::new_active_protected_maker_for_testing(&mut scenario, protocol_id, setup, &mut system);
    let market_ids = complete::initialize_market_for_testing(&mut scenario);
    let completed = complete::mint_protected_for_testing(&mut scenario, protocol_id, setup,
        active::maker_objects_for_testing(maker), market_ids, &mut system);
    let (soul_id, state_id, binding_id, _, _) = complete::native_ids(completed);
    let (seller_kiosk_id, seller_cap_id, _, _, _) = complete::holder_ids(completed);
    let (market_config_id, _, registry_id, _, policy_id) = complete::market_ids(market_ids);
    let (before_binding, before_output, before_receipt, seal_id) = read_complete(&mut scenario, protocol_id, setup, maker, completed, option::none());
    scenario.next_tx(HOLDER);

    let config = scenario.take_shared_by_id<MarketConfigV2>(market_config_id);
    let mut registry = scenario.take_shared_by_id<KioskRegistry>(registry_id);
    let mut seller_kiosk = scenario.take_shared_by_id<Kiosk>(seller_kiosk_id);
    let seller_cap = scenario.take_from_sender_by_id<PersonalKioskCap>(seller_cap_id);
    let mut state = scenario.take_shared_by_id<SoulState>(state_id);
    let provenance = scenario.take_immutable_by_id<NativeSoulBindingV8>(binding_id);
    assert!(soul::has_animacraft_provenance(&state) && soul::soul_id(&state) == soul_id, 99);
    if (mode == 2) {
        let _listing = market::list_soul_fixed_price_v2(&config, &registry,
            &mut seller_kiosk, &seller_cap, &mut state, PRICE, scenario.ctx());
        abort 99
    };
    if (mode == 3) {
        let collection_policy = scenario.take_shared<TransferPolicy<SoulCollectionRight>>();
        let mut collection = market::create_collection_in_personal_kiosk_v2(&config, &registry,
            &collection_policy, &mut seller_kiosk, &seller_cap, b"Native collection gap".to_string(),
            b"Current restriction, not accepted product behavior".to_string(), b"walrus://fixture".to_string(),
            9_500, true, option::some(2), option::none(), scenario.ctx());
        collection::add_soul(&mut collection, &mut state, scenario.ctx());
        assert!(soul::collection_id(&state).is_some(), 99);
        let _listing = market::list_animacraft_v8_soul_fixed_price(&config, &registry, &provenance,
            &mut seller_kiosk, &seller_cap, &mut state, PRICE, scenario.ctx());
        abort 99
    };
    let listing = market::list_animacraft_v8_soul_fixed_price(&config, &registry, &provenance,
        &mut seller_kiosk, &seller_cap, &mut state, PRICE, scenario.ctx());
    let listing_id = object::id(&listing);
    market::finalize_soul_listing(listing);
    ts::return_shared(seller_kiosk); scenario.return_to_sender(seller_cap);
    ts::return_shared(state); ts::return_immutable(provenance);
    scenario.next_tx(BUYER);
    let buyer_kiosk_id = market::init_personal_kiosk_v2(&config, &mut registry, scenario.ctx());
    ts::return_shared(registry); ts::return_shared(config);
    scenario.next_tx(BUYER);
    let config = scenario.take_shared_by_id<MarketConfigV2>(market_config_id);
    let registry = scenario.take_shared_by_id<KioskRegistry>(registry_id);
    let policy = scenario.take_shared_by_id<TransferPolicy<Soul>>(policy_id);
    let mut seller_kiosk = scenario.take_shared_by_id<Kiosk>(seller_kiosk_id);
    let mut buyer_kiosk = scenario.take_shared_by_id<Kiosk>(buyer_kiosk_id);
    let buyer_cap = scenario.take_from_sender<PersonalKioskCap>();
    let mut state = scenario.take_shared_by_id<SoulState>(state_id);
    let provenance = scenario.take_immutable_by_id<NativeSoulBindingV8>(binding_id);
    let mut listing = scenario.take_shared_by_id<SoulListing>(listing_id);
    let payment = sui::coin::mint_for_testing<USDC>(PRICE, scenario.ctx());
    market::buy_animacraft_v8_soul_fixed_price(&config, &registry, &policy, &provenance,
        &mut seller_kiosk, &mut buyer_kiosk, &buyer_cap, &mut state, &mut listing,
        payment, scenario.ctx());
    assert!(soul::current_owner(&state) == BUYER && soul::ownership_epoch(&state) == 1
        && !soul::is_listed(&state), 99);
    ts::return_shared(config); ts::return_shared(registry); ts::return_shared(policy);
    ts::return_shared(seller_kiosk); ts::return_shared(buyer_kiosk); scenario.return_to_sender(buyer_cap);
    ts::return_shared(state); ts::return_immutable(provenance); ts::return_shared(listing);
    scenario.next_tx(if (mode == 1) HOLDER else BUYER);
    // Saved id from the actual original proof lets the old-owner negative reach
    // the entry itself, rather than aborting in a separate preliminary proof.
    let (after_binding, after_output, after_receipt, after_id) = read_complete(&mut scenario, protocol_id, setup, maker, completed, option::some(seal_id));
    assert!(mode != 1 && before_binding == after_binding && before_output == after_output
        && before_receipt == after_receipt && after_id == seal_id, 99);
    std::unit_test::destroy(system);
    scenario.end();
}

#[test] fun protected_complete_single_entry_read_follows_actual_native_resale() { run_cutover(0); }
#[test, expected_failure(abort_code = 1, location = soulidity::soul)]
fun protected_complete_single_entry_rejects_original_payer_after_native_resale() { run_cutover(1); }
#[test, expected_failure(abort_code = 58, location = soulidity::market)]
fun actual_native_df9_cannot_bypass_royalties_through_ordinary_v2_listing() { run_cutover(2); }
/// OPEN product gap: add_soul accepts native, but current native market rejects
/// every Collection-associated Soul. Not equivalent to the old fee-stack rule.
#[test, expected_failure(abort_code = 15, location = soulidity::market)]
fun native_collection_association_currently_blocks_native_listing() { run_cutover(3); }
