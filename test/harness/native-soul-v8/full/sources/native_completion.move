/// Actual upper-graph Complete -> native Soul bridge used by Market/equipment
/// tests. Author content hashes are fixture declarations, not remote byte proof.
/// Every entitlement, Output authorization and native binding below is issued
/// through the real production path; no synthetic Soul/provenance issuer is used.
#[test_only]
module native_soul_v8_graph::native_completion;

use native_soul_v8_graph::bootstrap::{Self as bootstrap, SetupIds};
use native_soul_v8_graph::active_maker::{Self as active, MakerObjectIds};
use animacraft_v8_core::maker_v8::MakerRootV8;
use animacraft_v8_core::core_v8 as core;
use animacraft_v8_core::base_registry_v8::BaseDefinitionRegistryV8;
use animacraft_v8_core::protocol_config_v8::{Self as protocol, ProtocolConfigV8, ProtocolTreasuryV8};
use animacraft_v8_core::treasury_v8::{Self as treasury, MakerTreasuryV8, MakerAccessPassV8};
use animacraft_v8_core::package_binding_v8::{ProductReleaseCatalogV8, FreshTupleReplacementBindingV2};
use animacraft_v8_runtime::runtime_v8::{Self as runtime, RuntimeDefinitionRegistryV8,
    PackRegistryV8, MakerLoadoutV8, OwnedBaseItemV8};
use animacraft_v8_output::output_v8::{Self as output, OutputRegistryV8, SoulRegistryV8,
    NativeSoulBindingV8, CompleteOutputV8, CompleteReceiptV8};
use animacraft_v8_release::release_v8::{Self as release, ReleasePackageConfigV8};
use animacraft_v8_seal::seal_v8::{Self as seal, SealRegistryV8, SealPolicyConfigV8};
use soulidity::market::{Self as market, MarketConfigV2, MarketAdminCapV2, KioskRegistry};
use soulidity::kind_registry::{Self as kinds, KindRegistry};
use soulidity::content;
use soulidity::soul::{Self as soul, Soul, SoulState};
use sui::kiosk::{Self as kiosk, Kiosk};
use kiosk::personal_kiosk::{Self as personal, PersonalKioskCap};
use sui::transfer_policy::TransferPolicy;
use sui::test_scenario::{Self as scenario, Scenario};
use sui::sui::SUI;
use walrus::system::{Self as walrus_system, System};
use walrus::blob::{Self as blob, Blob};

public struct MarketIds has copy, drop, store {
    config: ID, admin: ID, registry: ID, kinds: ID, policy: ID,
}
public struct NativeCompletionIds has copy, drop, store {
    soul: ID, state: ID, binding: ID, output: ID, receipt: ID,
    kiosk: ID, personal_cap: ID, loadout: ID, owned_base: ID, access: ID,
}
public fun market_ids(ids: MarketIds): (ID, ID, ID, ID, ID) {
    (ids.config, ids.admin, ids.registry, ids.kinds, ids.policy)
}
public fun native_ids(ids: NativeCompletionIds): (ID, ID, ID, ID, ID) {
    (ids.soul, ids.state, ids.binding, ids.output, ids.receipt)
}
public fun holder_ids(ids: NativeCompletionIds): (ID, ID, ID, ID, ID) {
    (ids.kiosk, ids.personal_cap, ids.loadout, ids.owned_base, ids.access)
}

public fun initialize_market_for_testing(scenario: &mut Scenario): MarketIds {
    let author = scenario.ctx().sender();
    market::init_fresh_for_testing(author, scenario.ctx());
    kinds::init_for_testing(scenario.ctx());
    scenario.next_tx(author);
    let mut config = scenario.take_shared<MarketConfigV2>();
    let admin = scenario.take_from_sender<MarketAdminCapV2>();
    market::update_config_v2_primary_enabled(&mut config, &admin, true);
    market::update_config_v2_secondary_enabled(&mut config, &admin, true);
    let registry = scenario.take_shared<KioskRegistry>();
    let kinds = scenario.take_shared<KindRegistry>();
    let policy = scenario.take_shared<TransferPolicy<Soul>>();
    let ids = MarketIds { config: object::id(&config), admin: object::id(&admin),
        registry: object::id(&registry), kinds: object::id(&kinds), policy: object::id(&policy) };
    scenario::return_shared(config);
    scenario.return_to_sender(admin);
    scenario::return_shared(registry);
    scenario::return_shared(kinds);
    scenario::return_shared(policy);
    scenario.next_tx(author);
    ids
}

public fun mint_for_testing(
    scenario: &mut Scenario, protocol_id: ID, setup: SetupIds,
    maker_ids: MakerObjectIds, market_ids: MarketIds, system: &mut System,
): NativeCompletionIds {
    mint_using_player(scenario, protocol_id, setup, maker_ids, market_ids, system, option::none(), false)
}

/// Uses a protected output policy installed before activation; no sealed flag
/// or provenance is manufactured. Hashes stand for ciphertext fixture bytes.
public fun mint_protected_for_testing(
    scenario: &mut Scenario, protocol_id: ID, setup: SetupIds,
    maker_ids: MakerObjectIds, market_ids: MarketIds, system: &mut System,
): NativeCompletionIds {
    mint_using_player(scenario, protocol_id, setup, maker_ids, market_ids, system, option::none(), true)
}

/// A new explicit completion, not replay of a previously consumed authorization.
/// Reuses the exact existing owned player assets; it cannot issue another access
/// pass, owned component or Kiosk. Production proof checks remain the authority.
public fun repeat_mint_for_testing(
    scenario: &mut Scenario, protocol_id: ID, setup: SetupIds,
    maker_ids: MakerObjectIds, market_ids: MarketIds, system: &mut System,
    previous: NativeCompletionIds,
): NativeCompletionIds {
    mint_using_player(scenario, protocol_id, setup, maker_ids, market_ids, system, option::some(previous), false)
}

fun mint_using_player(
    scenario: &mut Scenario, protocol_id: ID, setup: SetupIds,
    maker_ids: MakerObjectIds, market_ids: MarketIds, system: &mut System,
    existing: std::option::Option<NativeCompletionIds>,
    protected_complete: bool,
): NativeCompletionIds {
    let holder = scenario.ctx().sender();
    let (root_id, base_id, treasury_id, _) = active::draft_maker_ids_for_testing(maker_ids);
    let (definitions_id, packs_id, _, seal_registry_id, output_id, souls_id, _, _, _) =
        active::draft_companion_ids_for_testing(maker_ids);
    let (catalog_id, seal_policy_id, _, _, _, _, release_id) = bootstrap::configuration_ids_for_testing(setup);
    let (replacement_id, _, _) = bootstrap::authority_ids_for_testing(scenario, setup);
    let kiosk_id = if (existing.is_some()) existing.borrow().kiosk else {
        // First completion alone acquires access and creates the holder Kiosk.
        let root = scenario.take_shared_by_id<MakerRootV8<SUI>>(root_id);
        let mut maker_treasury = scenario.take_shared_by_id<MakerTreasuryV8<SUI>>(treasury_id);
        let clock = sui::clock::create_for_testing(scenario.ctx());
        treasury::claim_free_maker_access_v8(&root, &mut maker_treasury, &clock, scenario.ctx());
        clock.destroy_for_testing();
        let market_config = scenario.take_shared_by_id<MarketConfigV2>(market_ids.config);
        let mut registry = scenario.take_shared_by_id<KioskRegistry>(market_ids.registry);
        let kiosk_id = market::init_personal_kiosk_v2(&market_config, &mut registry, scenario.ctx());
        scenario::return_shared(root);
        scenario::return_shared(maker_treasury);
        scenario::return_shared(market_config);
        scenario::return_shared(registry);
        scenario.next_tx(holder);
        kiosk_id
    };

    let root = scenario.take_shared_by_id<MakerRootV8<SUI>>(root_id);
    let base = scenario.take_shared_by_id<BaseDefinitionRegistryV8>(base_id);
    let definitions = scenario.take_shared_by_id<RuntimeDefinitionRegistryV8>(definitions_id);
    let mut packs = scenario.take_shared_by_id<PackRegistryV8>(packs_id);
    let access = if (existing.is_some())
        scenario.take_from_sender_by_id<MakerAccessPassV8>(existing.borrow().access)
    else scenario.take_from_sender<MakerAccessPassV8>();
    let (owned, loadout) = if (existing.is_some()) {
        (scenario.take_from_sender_by_id<OwnedBaseItemV8>(existing.borrow().owned_base),
            scenario.take_from_sender_by_id<MakerLoadoutV8>(existing.borrow().loadout))
    } else {
        let mut owned = runtime::claim_owned_base_item_v8(&mut packs, &definitions,
            &base, &root, &access, b"part".to_string(), b"item".to_string(), scenario.ctx());
        let mut loadout = runtime::create_maker_loadout_v8(&root, &definitions, &packs, &access, scenario.ctx());
        runtime::equip_owned_base_style_v8(&mut loadout, &mut owned, &root, &definitions,
            &packs, &base, &access, 0, option::none(), b"style".to_string(), option::none(), scenario.ctx());
        (owned, loadout)
    };
    // The sparse fixture has a preceding empty Part; prove the actual selected
    // row instead of assuming every Maker's first occupied slot is zero.
    let selections = runtime::loadout_selections_v8(&loadout);
    let mut selected_index = 0;
    while (selections[selected_index].is_none()) selected_index = selected_index + 1;
    assert!(runtime::loadout_selection_count_v8(&loadout) == 1, 99);
    let proof = runtime::prove_owned_base_selection_v8(&loadout, &owned, &definitions,
        &packs, &base, &root, &access, selected_index, scenario.ctx());
    let authorization = runtime::seal_ordered_selection_proofs_v8(&loadout,
        &definitions, &base, vector[], vector[proof], scenario.ctx());
    let config = scenario.take_shared_by_id<ProtocolConfigV8>(protocol_id);
    let protocol_treasury_id = *protocol::config_treasury_id_v8(&config).borrow();
    let mut protocol_treasury = scenario.take_shared_by_id<ProtocolTreasuryV8<SUI>>(protocol_treasury_id);
    let mut maker_treasury = scenario.take_shared_by_id<MakerTreasuryV8<SUI>>(treasury_id);
    let catalog = scenario.take_shared_by_id<ProductReleaseCatalogV8>(catalog_id);
    let replacement = scenario.take_immutable_by_id<FreshTupleReplacementBindingV2>(replacement_id);
    let release_config = scenario.take_shared_by_id<ReleasePackageConfigV8>(release_id);
    let mut output_registry = scenario.take_shared_by_id<OutputRegistryV8>(output_id);
    let mut souls = scenario.take_shared_by_id<SoulRegistryV8>(souls_id);
    let session = output::begin_complete_v8(&mut output_registry, b"complete".to_string(),
        &root, &config, &mut maker_treasury, &mut protocol_treasury,
        sui::coin::zero<SUI>(scenario.ctx()), authorization, &loadout, scenario.ctx());
    let render = content_blob(system, 0xD0E, scenario.ctx());
    let authorization = if (protected_complete) {
        let mut seal_registry = scenario.take_shared_by_id<SealRegistryV8>(seal_registry_id);
        let seal_policy = scenario.take_shared_by_id<SealPolicyConfigV8>(seal_policy_id);
        let revision = seal::registry_runtime_revision_v8(&seal_registry);
        let authorization = release::finish_protected_complete_v8(session, &output_registry,
            &root, &config, &catalog, &release_config, &mut seal_registry, &seal_policy,
            revision, &loadout, core::walrus_blob_id_string_v1(blob::blob_id(&render)),
            fixture_hash(70), fixture_hash(71), b"complete/protected".to_string(),
            b"render".to_string(), scenario.ctx());
        scenario::return_shared(seal_registry);
        scenario::return_shared(seal_policy);
        authorization
    } else {
        release::finish_unprotected_complete_v8(session, &output_registry,
            &root, &config, &catalog, &replacement, &release_config, &loadout,
            core::walrus_blob_id_string_v1(blob::blob_id(&render)),
            fixture_hash(70), fixture_hash(71), scenario.ctx())
    };
    transfer::public_transfer(render, holder);

    let market_config = scenario.take_shared_by_id<MarketConfigV2>(market_ids.config);
    let mut registry = scenario.take_shared_by_id<KioskRegistry>(market_ids.registry);
    let kinds = scenario.take_shared_by_id<KindRegistry>(market_ids.kinds);
    let policy = scenario.take_shared_by_id<TransferPolicy<Soul>>(market_ids.policy);
    let mut holder_kiosk = scenario.take_shared_by_id<Kiosk>(kiosk_id);
    let personal_cap = if (existing.is_some())
        scenario.take_from_sender_by_id<PersonalKioskCap>(existing.borrow().personal_cap)
    else scenario.take_from_sender<PersonalKioskCap>();
    let read_mask = kinds::read_owner() | kinds::read_grant();
    let initial = vector[
        market::new_initial_content_entry(kinds::kind_soul_doc(), b"soul".to_string(),
            read_mask, content::download_policy_public(), false, content_blob(system, 0xD0C, scenario.ctx()),
            0, b"fixture-doc-envelope"),
        market::new_initial_content_entry(kinds::kind_memory(), b"default".to_string(),
            read_mask, content::download_policy_public(), false, content_blob(system, 0xD0D, scenario.ctx()),
            0, b"fixture-memory-envelope"),
    ];
    let clock = sui::clock::create_for_testing(scenario.ctx());
    // Each explicit completion reserves a distinct content identity. Envelope
    // bytes above are declared VM fixtures, not remote encryption evidence.
    let nonce_uid = object::new(scenario.ctx());
    let nonce_bytes = std::bcs::to_bytes(&nonce_uid.to_inner());
    nonce_uid.delete();
    let nonce = vector::tabulate!(16, |index| nonce_bytes[index]);
    let content_id = market::derive_mint_content_id(&registry, holder, nonce);
    let state = market::mint_animacraft_v8_in_personal_kiosk(&market_config,
        &kinds, &mut registry, &policy, &mut holder_kiosk, &personal_cap,
        &root, &config, &mut output_registry, &mut souls, authorization,
        b"Actual Complete".to_string(), b"Native Market integration".to_string(),
        initial, vector[], nonce, content_id, &clock, scenario.ctx());
    clock.destroy_for_testing();
    let soul_id = soul::soul_id(&state);
    let state_id = object::id(&state);
    let binding_id = soul::animacraft_native_v8_binding_id(&state);
    assert!(soul::current_owner(&state) == holder && soul::ownership_epoch(&state) == 0
        && !soul::is_listed(&state) && !soul::has_animacraft_native_equipment_v8(&state), 99);
    let _soul = kiosk::borrow<Soul>(&holder_kiosk, personal::borrow(&personal_cap), soul_id);
    let cap_id = object::id(&personal_cap);
    let loadout_id = object::id(&loadout);
    let owned_id = object::id(&owned);
    let access_id = object::id(&access);
    market::finalize_soul_state(state);
    runtime::transfer_maker_loadout_to_holder_v8(loadout);
    runtime::transfer_new_owned_base_item_to_holder_v8(owned);
    scenario.return_to_sender(access);
    scenario.return_to_sender(personal_cap);
    scenario::return_shared(root);
    scenario::return_shared(base);
    scenario::return_shared(definitions);
    scenario::return_shared(packs);
    scenario::return_shared(config);
    scenario::return_shared(protocol_treasury);
    scenario::return_shared(maker_treasury);
    scenario::return_shared(catalog);
    scenario::return_immutable(replacement);
    scenario::return_shared(release_config);
    scenario::return_shared(output_registry);
    scenario::return_shared(souls);
    scenario::return_shared(market_config);
    scenario::return_shared(registry);
    scenario::return_shared(kinds);
    scenario::return_shared(policy);
    scenario::return_shared(holder_kiosk);
    scenario.next_tx(holder);

    // Exact typed immutable readback proves mint froze the one original pair.
    let binding = scenario.take_immutable_by_id<NativeSoulBindingV8>(binding_id);
    let complete_id = output::native_soul_binding_output_id_v8(&binding);
    let receipt_id = output::native_soul_binding_receipt_id_v8(&binding);
    let complete = scenario.take_immutable_by_id<CompleteOutputV8>(complete_id);
    let receipt = scenario.take_immutable_by_id<CompleteReceiptV8>(receipt_id);
    let state = scenario.take_shared_by_id<SoulState>(state_id);
    assert!(output::native_soul_binding_soul_id_v8(&binding) == soul_id
        && output::native_soul_binding_state_id_v8(&binding) == state_id
        && output::native_soul_binding_root_id_v8(&binding) == root_id
        && output::native_soul_binding_original_holder_v8(&binding) == holder
        && soul::animacraft_native_v8_binding_id(&state) == binding_id, 99);
    assert!(output::complete_output_holder_v8(&complete) == holder
        && output::receipt_holder_v8(&receipt) == holder, 99);
    scenario::return_immutable(binding);
    scenario::return_immutable(complete);
    scenario::return_immutable(receipt);
    scenario::return_shared(state);
    // Preserve the real immutable readback above and give callers a fresh
    // transaction inventory for their own State/provenance assertions.
    scenario.next_tx(holder);
    NativeCompletionIds { soul: soul_id, state: state_id, binding: binding_id,
        output: complete_id, receipt: receipt_id, kiosk: kiosk_id, personal_cap: cap_id,
        loadout: loadout_id, owned_base: owned_id, access: access_id }
}

fun content_blob(system: &mut System, root_hash: u256, ctx: &mut TxContext): Blob {
    let size = 1_000;
    let blob_id = blob::derive_blob_id(root_hash, 1, size);
    let encoded = walrus::encoding::encoded_blob_length(size, 1, walrus_system::n_shards(system));
    let mut payment = walrus::test_utils::mint_frost(1_000_000_000_000, ctx);
    let storage = walrus_system::reserve_space(system, encoded, 3, &mut payment, ctx);
    let mut result = walrus_system::register_blob(system, storage, blob_id, root_hash,
        size, 1, false, &mut payment, ctx);
    sui::coin::burn_for_testing(payment);
    let message = walrus::messages::certified_permanent_blob_message_for_testing(blob_id);
    blob::certify_with_certified_msg_for_testing(&mut result, walrus_system::epoch(system), message);
    result
}
fun fixture_hash(byte: u8): vector<u8> { vector::tabulate!(32, |_| byte) }
