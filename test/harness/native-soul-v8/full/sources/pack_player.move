/// Real author Pack release -> admission -> player entitlement -> selection.
/// Hash/locator values are fixture inputs; no remote byte availability is claimed.
#[test_only]
module native_soul_v8_graph::pack_player;

use native_soul_v8_graph::active_maker::{Self as active, ActiveMakerIds};
use animacraft_v8_core::maker_v8::{Self as maker, MakerRootV8, MakerAdminCapV8};
use animacraft_v8_core::base_registry_v8::BaseDefinitionRegistryV8;
use animacraft_v8_core::treasury_v8::{Self as treasury, MakerTreasuryV8, MakerAccessPassV8};
use animacraft_v8_runtime::runtime_v8::{Self as runtime, RuntimeDefinitionRegistryV8,
    PackRegistryV8, PackAdmissionAuthorityV8, PackReleaseV8, PackPassV8};
use sui::sui::SUI;
use sui::test_scenario::{Self as scenario, Scenario};

public struct PackPlayerIds has copy, drop, store {
    release: ID, admin: ID, treasury: ID, pass: ID, loadout: ID, access: ID,
}

public struct PublishedPackIds has copy, drop, store {
    release: ID, admin: ID, treasury: ID,
}

public fun published_ids_for_testing(ids: PublishedPackIds): (ID, ID, ID) {
    (ids.release, ids.admin, ids.treasury)
}

public fun ids_for_testing(ids: PackPlayerIds): (ID, ID, ID, ID, ID, ID) {
    (ids.release, ids.admin, ids.treasury, ids.pass, ids.loadout, ids.access)
}

/// Author publication alone grants no player entitlement.
public fun publish_pack_for_testing(
    scenario: &mut Scenario, active_ids: ActiveMakerIds,
): PublishedPackIds {
    let holder = scenario.ctx().sender();
    let (root_id, base_id, _, admin_id) = active::maker_ids_for_testing(active_ids);
    let (definitions_id, packs_id, admission_id, _, _, _, _, _, _) =
        active::companion_ids_for_testing(active_ids);
    let root = scenario.take_shared_by_id<MakerRootV8<SUI>>(root_id);
    let base = scenario.take_shared_by_id<BaseDefinitionRegistryV8>(base_id);
    let definitions = scenario.take_shared_by_id<RuntimeDefinitionRegistryV8>(definitions_id);
    let mut packs = scenario.take_shared_by_id<PackRegistryV8>(packs_id);
    let admission = scenario.take_from_sender_by_id<PackAdmissionAuthorityV8>(admission_id);
    let admin = scenario.take_from_sender_by_id<MakerAdminCapV8>(admin_id);
    let expected_styles = runtime::physical_pack_style_commitment_for_testing(&root);
    let (mut release, pack_admin, pack_treasury) = runtime::new_pack_release_v8(
        &root, &definitions, b"physical-pack".to_string(),
        b"physical-pack-manifest".to_string(), fixture_hash(75), fixture_hash(71),
        runtime::access_free_v8(), 0, maker::complete_unlimited_free_v8(), 0, 0, 0,
        1, expected_styles, scenario.ctx());
    runtime::append_unprotected_pack_style_v8(&mut release, &pack_admin,
        &definitions, &base, 0, runtime::new_pack_style_definition_sources_v8(1, 1, option::none()),
        b"part".to_string(), b"pack-item".to_string(),
        b"pack-style".to_string(), b"track".to_string(), option::none(), option::none(),
        b"pack-style-blob".to_string(), fixture_hash(72), fixture_hash(73),
        fixture_hash(74), scenario.ctx());
    runtime::seal_pack_release_v8(&mut release, &pack_admin, scenario.ctx());
    let revision = runtime::pack_registry_revision_v8(&packs);
    runtime::admit_pack_release_v8(&mut packs, &admission, &definitions, &root,
        &admin, &mut release, revision, scenario.ctx());
    let release_id = object::id(&release);
    let pack_admin_id = object::id(&pack_admin);
    let pack_treasury_id = object::id(&pack_treasury);
    runtime::share_pack_release_v8(release);
    runtime::share_pack_treasury_v8(pack_treasury);
    runtime::transfer_pack_admin_cap_v8(pack_admin, holder);
    scenario::return_shared(root);
    scenario::return_shared(base);
    scenario::return_shared(definitions);
    scenario::return_shared(packs);
    scenario.return_to_sender(admission);
    scenario.return_to_sender(admin);
    scenario.next_tx(holder);
    PublishedPackIds { release: release_id, admin: pack_admin_id, treasury: pack_treasury_id }
}

/// Existing first-player convenience path; native Soul holders can instead use
/// publish_pack_for_testing and acquire with their already-issued Maker access.
public fun new_pack_player_for_testing(
    scenario: &mut Scenario, active_ids: ActiveMakerIds,
): PackPlayerIds {
    let published = publish_pack_for_testing(scenario, active_ids);
    let (release_id, pack_admin_id, pack_treasury_id) = published_ids_for_testing(published);
    let holder = scenario.ctx().sender();
    let (root_id, base_id, treasury_id, _) = active::maker_ids_for_testing(active_ids);
    let (definitions_id, packs_id, _, _, _, _, _, _, _) =
        active::companion_ids_for_testing(active_ids);
    let root = scenario.take_shared_by_id<MakerRootV8<SUI>>(root_id);
    let mut maker_treasury = scenario.take_shared_by_id<MakerTreasuryV8<SUI>>(treasury_id);
    let clock = sui::clock::create_for_testing(scenario.ctx());
    treasury::claim_free_maker_access_v8(&root, &mut maker_treasury, &clock, scenario.ctx());
    clock.destroy_for_testing();
    scenario::return_shared(root);
    scenario::return_shared(maker_treasury);
    scenario.next_tx(holder);

    let root = scenario.take_shared_by_id<MakerRootV8<SUI>>(root_id);
    let base = scenario.take_shared_by_id<BaseDefinitionRegistryV8>(base_id);
    let definitions = scenario.take_shared_by_id<RuntimeDefinitionRegistryV8>(definitions_id);
    let packs = scenario.take_shared_by_id<PackRegistryV8>(packs_id);
    let mut release = scenario.take_shared_by_id<PackReleaseV8<SUI>>(release_id);
    let access = scenario.take_from_sender<MakerAccessPassV8>();
    let clock = sui::clock::create_for_testing(scenario.ctx());
    let pass = runtime::issue_free_pack_pass_v8(&mut release, &packs, &clock, scenario.ctx());
    clock.destroy_for_testing();
    let mut loadout = runtime::create_maker_loadout_v8(&root, &definitions, &packs,
        &access, scenario.ctx());
    runtime::select_pack_style_v8(&mut loadout, &root, &definitions, &base, &packs,
        &release, &pass, &access, 0, option::none(), b"part".to_string(), b"pack-item".to_string(),
        b"pack-style".to_string(), option::none(), scenario.ctx());
    assert!(runtime::loadout_selection_count_v8(&loadout) == 1, 99);
    assert!(runtime::loadout_revision_v8(&loadout) == 1, 99);
    let ids = PackPlayerIds { release: release_id, admin: pack_admin_id,
        treasury: pack_treasury_id, pass: object::id(&pass), loadout: object::id(&loadout),
        access: object::id(&access) };
    runtime::transfer_pack_pass_to_holder_v8(pass);
    runtime::transfer_maker_loadout_to_holder_v8(loadout);
    scenario.return_to_sender(access);
    scenario::return_shared(root);
    scenario::return_shared(base);
    scenario::return_shared(definitions);
    scenario::return_shared(packs);
    scenario::return_shared(release);
    scenario.next_tx(holder);
    // Read the exact issued pass back from actual transaction inventory.
    let pass = scenario.take_from_sender_by_id<PackPassV8>(ids.pass);
    scenario.return_to_sender(pass);
    // Returned inventory becomes available to the caller in the next tx.
    scenario.next_tx(holder);
    ids
}

fun fixture_hash(value: u8): vector<u8> {
    let mut bytes = vector[];
    let mut i = 0u64;
    while (i < 32) { bytes.push_back(value); i = i + 1; };
    bytes
}
