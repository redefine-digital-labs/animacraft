/// Two real author Parts, each with capacity one; no state mutation shortcuts.
#[test_only]
module native_soul_v8_graph::partial_sale_fixture;

use native_soul_v8_graph::active_maker as active;
use native_soul_v8_graph::bootstrap::{Self as bootstrap, SetupIds};
use animacraft_v8_core::core_v8 as core;
use animacraft_v8_core::maker_v8::{Self as maker, MakerRootV8, MakerAdminCapV8};
use animacraft_v8_core::base_registry_v8::{Self as base, BaseDefinitionRegistryV8};
use animacraft_v8_core::protocol_config_v8::ProtocolConfigV8;
use animacraft_v8_core::package_binding_v8::{ProductReleaseCatalogV8,
    FreshTupleReplacementBindingV2};
use animacraft_v8_runtime::runtime_v8::{Self as runtime,
    RuntimeDefinitionRegistryV8, PackRegistryV8, PackAdmissionAuthorityV8};
use animacraft_v8_seal::seal_v8::{Self as seal, SealPolicyConfigV8};
use animacraft_v8_output::output_v8::{Self as output, OutputPackageConfigV8};
use animacraft_v8_physical::physical_v8::{Self as physical, PhysicalPackageConfigV8};
use animacraft_v8_market::market_v8::{Self as market, MarketPackageConfigV8};
use animacraft_v8_release::release_v8::{Self as release, ReleasePackageConfigV8};
use sui::sui::SUI;
use sui::test_scenario::{Self as scenario, Scenario};
use walrus::system::{Self as walrus_system, System};
use walrus::blob::{Self as walrus_blob, Blob};

public fun new_active_for_testing(
    scenario: &mut Scenario, protocol_id: ID, setup: SetupIds, system: &mut System,
): active::ActiveMakerIds {
    let author = scenario.ctx().sender();
    let capacity = 1;
    let protected_complete = false;
    let (catalog_id, seal_id, _runtime_id, output_id, physical_id, market_id, release_id) =
        bootstrap::configuration_ids_for_testing(setup);
    let (replacement_id, _bootstrap_id, _policy_id) = bootstrap::authority_ids_for_testing(scenario, setup);
    let protocol = scenario.take_shared_by_id<ProtocolConfigV8>(protocol_id);
    let catalog = scenario.take_shared_by_id<ProductReleaseCatalogV8>(catalog_id);
    let replacement = scenario.take_immutable_by_id<FreshTupleReplacementBindingV2>(replacement_id);
    let seal_policy = scenario.take_shared_by_id<SealPolicyConfigV8>(seal_id);
    let output_config = scenario.take_shared_by_id<OutputPackageConfigV8>(output_id);
    let physical_config = scenario.take_shared_by_id<PhysicalPackageConfigV8>(physical_id);
    let market_config = scenario.take_shared_by_id<MarketPackageConfigV8>(market_id);
    let release_config = scenario.take_shared_by_id<ReleasePackageConfigV8>(release_id);
    let ctx = scenario.ctx();

    let blob = certified_storage_fixture(system, ctx);
    let content = fixture_hash(5);
    let defaults = fixture_hash(6);
    let living = core::new_living_content_binding_v8(defaults,
        core::walrus_blob_id_string_v1(walrus_blob::blob_id(&blob)),
        fixture_hash(7), walrus_blob::size(&blob), fixture_hash(8));
    // Required Base part permits hybrid, not open-only, Runtime behavior.
    let wardrobe = runtime::wardrobe_slot_v8();
    let behavior = runtime::behavior_hybrid_v8();
    let ceiling = runtime::admission_open_v8();
    let first_profile = runtime::advance_profile_commitment_v8(content, 0,
        runtime::empty_profile_commitment_v8(content), b"part".to_string(),
        fixture_hash(11), true, wardrobe, behavior, capacity, ceiling);
    let profile_commitment = runtime::advance_profile_commitment_v8(content, 1,
        first_profile, b"sale".to_string(), fixture_hash(11), false,
        wardrobe, behavior, capacity, ceiling);
    let pack_policy = runtime::runtime_policy_commitment_v8(
        content, 2, profile_commitment, ceiling, true);
    let economics = maker::new_economics_snapshot_v8<SUI>(&protocol,
        0, 0, maker::complete_unlimited_free_v8(), 0, 0, 0);
    let rights = maker::new_onchain_native_rights_snapshot_v8(ctx, 250, 250, 500);
    let clock = sui::clock::create_for_testing(ctx);
    let (mut root, mut base_registry, treasury, admin) = core::new_initial_maker_draft_v8<SUI>(
        &protocol, b"native-graph-author".to_string(), fixture_hash(9), defaults,
        core::living_content_binding_commitment_v1(&living), fixture_hash(10),
        b"fixture-manifest".to_string(), fixture_hash(12), content,
        base::new_base_definition_counts_v8(1, 0, 2, 2, 2, 0, 1),
        rows_commitment(), pack_policy,
        economics, rights, &clock, ctx);
    clock.destroy_for_testing();
    release::finalize_product_release_binding_v8(&mut root, &admin, &protocol,
        &catalog, &release_config, ctx);
    base::append_track_v2(&mut base_registry, &mut root, &admin, track());
    base::append_part_v2(&mut base_registry, &mut root, &admin, part(0));
    base::append_part_v2(&mut base_registry, &mut root, &admin, part(1));
    base::append_item_v2(&mut base_registry, &mut root, &admin, item(0));
    base::append_item_v2(&mut base_registry, &mut root, &admin, item(1));
    base::append_style_v2(&mut base_registry, &mut root, &admin, style(0));
    base::append_style_v2(&mut base_registry, &mut root, &admin, style(1));
    base::append_asset_v2(&mut base_registry, &mut root, &admin, asset());
    base::seal_base_definition_registry_v8(&mut base_registry, &mut root, &admin);

    let (mut definitions, packs, admission) = runtime::new_runtime_registries_v8(
        &root, &admin, &base_registry, 2, profile_commitment, ceiling, true, ctx);
    runtime::append_part_profile_v8(&mut definitions, &root, &admin, &base_registry,
        0, b"part".to_string(), wardrobe, behavior, capacity);
    runtime::append_part_profile_v8(&mut definitions, &root, &admin, &base_registry,
        1, b"sale".to_string(), wardrobe, behavior, capacity);
    runtime::seal_runtime_definitions_v8(&mut definitions, &root, &admin, &base_registry);
    let mut seal_registry = seal::new_seal_registry_v8(&root, &admin, &seal_policy, 0, 0, 0, ctx);
    seal::seal_registry_v8(&mut seal_registry, &root, &admin, &seal_policy);

    // Commit the normal public Complete policy before activation.
    let complete_scope = if (protected_complete) b"complete/protected".to_string() else b"".to_string();
    let output_row = output::derive_output_policy_row_commitment_v8(&root, 0,
        b"complete".to_string(), protected_complete, complete_scope, fixture_hash(20),
        output::allowed_all_admitted_v8(), vector[]);
    let output_commitment = output::advance_output_registry_commitment_v8(&root, 0,
        output::empty_output_registry_commitment_v8(&root), output_row);
    let (mut output_registry, souls) = output::new_output_registries_v8(
        &root, &admin, 1, output_commitment, ctx);
    output::append_output_policy_v8(&mut output_registry, &root, &admin, 0,
        b"complete".to_string(), protected_complete, complete_scope, fixture_hash(20),
        output::allowed_all_admitted_v8(), vector[], output_row);
    output::seal_output_registry_v8(&mut output_registry, &root, &admin);
    let physical_commitment = physical::empty_base_policy_commitment_v8(&root, &base_registry, &physical_config);
    let mut physical_registry = physical::new_physical_registry_v8(&root, &admin,
        &base_registry, &catalog, &physical_config, 0, physical_commitment, ctx);
    physical::seal_physical_registry_v8(&mut physical_registry, &root, &admin,
        &base_registry, &catalog, &physical_config);
    let (mut market_registry, market_treasury) = market::new_market_objects_v8(
        &root, &admin, &protocol, &catalog, &replacement, &market_config, ctx);
    market::seal_market_registry_v8(&mut market_registry, &market_treasury, &root,
        &admin, &protocol, &catalog, &replacement, &market_config);

    let ids = active::maker_objects_from_ids_for_testing(object::id(&root), object::id(&base_registry),
        object::id(&treasury), object::id(&admin), object::id(&definitions), object::id(&packs),
        object::id(&admission), object::id(&seal_registry), object::id(&output_registry), object::id(&souls),
        object::id(&physical_registry), object::id(&market_registry), object::id(&market_treasury), object::id(&blob));
    transfer::public_transfer(blob, author);
    runtime::share_runtime_definition_registry_v8(definitions);
    runtime::share_pack_registry_v8(packs);
    runtime::transfer_pack_admission_authority_v8(admission, author);
    seal::share_seal_registry_v8(seal_registry);
    output::share_output_registries_v8(output_registry, souls);
    physical::share_physical_registry_v8(physical_registry);
    market::share_market_registry_v8(market_registry);
    market::share_market_treasury_v8(market_treasury);
    core::share_maker_draft_v8(root, base_registry, treasury, admin, ctx);
    scenario::return_shared(protocol);
    scenario::return_shared(catalog);
    scenario::return_shared(seal_policy);
    scenario::return_shared(output_config);
    scenario::return_shared(physical_config);
    scenario::return_shared(market_config);
    scenario::return_shared(release_config);
    scenario::return_immutable(replacement);
    scenario.next_tx(author);
    let active = active::activate_maker_for_testing(scenario, protocol_id, setup, ids, system, living);
    scenario.next_tx(author);
    active
}

fun certified_storage_fixture(system: &mut System, ctx: &mut TxContext): Blob {
    let size = 1_000;
    let blob_id = walrus_blob::derive_blob_id(0xABC, 1, size);
    let encoded_size = walrus::encoding::encoded_blob_length(
        size, 1, walrus_system::n_shards(system));
    let mut payment = walrus::test_utils::mint_frost(1_000_000_000_000, ctx);
    let storage = walrus_system::reserve_space(system, encoded_size, 3, &mut payment, ctx);
    let mut blob = walrus_system::register_blob(system, storage, blob_id,
        0xABC, size, 1, false, &mut payment, ctx);
    sui::coin::burn_for_testing(payment);
    let message = walrus::messages::certified_permanent_blob_message_for_testing(blob_id);
    walrus_blob::certify_with_certified_msg_for_testing(&mut blob,
        walrus_system::epoch(system), message);
    blob
}

fun fixture_hash(byte: u8): vector<u8> { vector::tabulate!(32, |_| byte) }

fun key(n: u64): std::string::String { if (n == 0) b"part".to_string() else b"sale".to_string() }
public fun publish_pack_for_testing(
    scenario: &mut Scenario, active_ids: active::ActiveMakerIds,
): (ID, ID, ID) {
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
    // Real additive Item/Style metadata, with zero new Parts. Even this
    // attachment requires its own final PackDefinitionProofV8.
    let semantic = b"physical-pack".to_string();
    let part = b"part".to_string();
    let item = b"pack-item".to_string();
    let style = b"pack-style".to_string();
    let item_visibility = base::new_pack_visibility_row_v2(1, 2, part, item, option::none(), vector[],
        base::visibility_program_commitment_v1(2, option::some(semantic), 1, part, option::some(item), option::none(), &vector[]));
    let style_visibility = base::new_pack_visibility_row_v2(2, 2, part, item, option::some(style), vector[],
        base::visibility_program_commitment_v1(2, option::some(semantic), 2, part, option::some(item), option::some(style), &vector[]));
    let rows = base::new_pack_definition_rows_v2(semantic, vector[], vector[], vector[], vector[], vector[item_visibility, style_visibility]);
    let commitment = runtime::pack_definitions_commitment_v8(object::id(&release), fixture_hash(71), &rows);
    runtime::register_pack_definitions_v8(&mut release, &pack_admin, &base, rows, commitment, scenario.ctx());
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
    (release_id, pack_admin_id, pack_treasury_id)
}


fun track(): base::TrackRowV2 { base::new_track_row_v2(0, b"track".to_string(), b"Track".to_string(), 0, false) }
fun part(n: u64): base::PartRowV2 {
    let tokens = vector[];
    base::new_part_row_v2(n, key(n), key(n), 0, n, 0, true, n == 0, 0, 1, vector[b"track".to_string()],
        tokens, base::visibility_program_commitment_v1(1, option::none(), 0, key(n), option::none(), option::none(), &tokens), fixture_hash(11))
}
fun item(n: u64): base::ItemRowV2 {
    let tokens = vector[];
    base::new_item_row_v2(n, key(n), b"item".to_string(), b"Item".to_string(), 0, 0, b"style".to_string(), tokens,
        base::visibility_program_commitment_v1(1, option::none(), 1, key(n), option::some(b"item".to_string()), option::none(), &tokens), fixture_hash(12))
}
fun style(n: u64): base::StyleRowV2 {
    let tokens = vector[];
    base::new_style_row_v2(n, key(n), b"item".to_string(), b"style".to_string(), b"Style".to_string(), 0,
        b"track".to_string(), option::none(), option::none(), b"style-asset".to_string(), b"style-blob".to_string(), fixture_hash(13), false,
        base::new_transform_fixed_v1(base::new_signed_milli_v1(false, 0), base::new_signed_milli_v1(false, 0), 1_000_000, base::new_signed_milli_v1(false, 0)),
        1_000_000, 0, option::none(), tokens,
        base::visibility_program_commitment_v1(1, option::none(), 2, key(n), option::some(b"item".to_string()), option::some(b"style".to_string()), &tokens), fixture_hash(14))
}
fun asset(): base::AssetRowV2 { base::new_asset_row_v2(0, b"style-asset".to_string(), b"image".to_string(), b"image/png".to_string(), 32, fixture_hash(13)) }
fun rows_commitment(): vector<u8> {
    let rows = vector[std::bcs::to_bytes(&track()), std::bcs::to_bytes(&part(0)), std::bcs::to_bytes(&part(1)),
        std::bcs::to_bytes(&item(0)), std::bcs::to_bytes(&item(1)), std::bcs::to_bytes(&style(0)), std::bcs::to_bytes(&style(1)), std::bcs::to_bytes(&asset())];
    let categories = vector[0, 2, 2, 3, 3, 4, 4, 6];
    let sequences = vector[0, 0, 1, 0, 1, 0, 1, 0];
    let mut rolling = base::author_rows_empty_commitment_v2();
    let mut i = 0;
    while (i < rows.length()) { rolling = base::author_rows_advance_commitment_v2(categories[i], sequences[i], i, rolling, rows[i]); i = i + 1; };
    base::author_rows_seal_commitment_v2(vector[1, 0, 2, 2, 2, 0, 1], rolling)
}
