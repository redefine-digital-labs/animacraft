/// Upper-graph author fixture: actual public creation, sealing, companion and
/// activation calls. This is not a deployed artifact or proof of remote bytes.
#[test_only]
module native_soul_v8_graph::active_maker;

use native_soul_v8_graph::bootstrap::{Self as bootstrap, SetupIds};
use native_soul_v8_graph::sparse_base;
use animacraft_v8_core::core_v8::{Self as core, WalrusCertificationPolicyV1, LivingContentBindingV8};
use animacraft_v8_core::maker_v8::{Self as maker, MakerRootV8, MakerAdminCapV8};
use animacraft_v8_core::base_registry_v8::{Self as base, BaseDefinitionRegistryV8};
use animacraft_v8_core::protocol_config_v8::ProtocolConfigV8;
use animacraft_v8_core::companion_binding_v2 as companion;
use animacraft_v8_core::package_binding_v8::{ProductReleaseCatalogV8,
    FreshTupleReplacementBindingV2, FreshTupleBootstrapCertificateV2};
use animacraft_v8_runtime::runtime_v8::{Self as runtime,
    RuntimeDefinitionRegistryV8, PackRegistryV8, PackAdmissionAuthorityV8};
use animacraft_v8_seal::seal_v8::{Self as seal, SealPolicyConfigV8, SealRegistryV8};
use animacraft_v8_output::output_v8::{Self as output, OutputPackageConfigV8, OutputRegistryV8, SoulRegistryV8};
use animacraft_v8_physical::physical_v8::{Self as physical, PhysicalPackageConfigV8, PhysicalRegistryV8};
use animacraft_v8_market::market_v8::{Self as market, MarketPackageConfigV8, MarketRegistryV8, MarketTreasuryV8};
use animacraft_v8_release::release_v8::{Self as release, ReleasePackageConfigV8};
use sui::sui::SUI;
use sui::test_scenario::{Self as scenario, Scenario};
use walrus::system::{Self as walrus_system, System};
use walrus::blob::{Self as walrus_blob, Blob};

public struct MakerObjectIds has copy, drop, store {
    root: ID, base: ID, treasury: ID, admin: ID,
    definitions: ID, packs: ID, admission: ID, seal: ID,
    output: ID, souls: ID, physical: ID, market: ID, market_treasury: ID,
    blob: ID,
}

public struct ActiveMakerIds has copy, drop, store {
    objects: MakerObjectIds, certificate: ID,
}

/// Fixture inputs are committed and appended through the production policy API.
public struct PhysicalPolicyFixture has copy, drop {
    issuance: u8, proof: u8, price: u64, max_supply: u64, transferable: bool,
}

public fun maker_ids_for_testing(ids: ActiveMakerIds): (ID, ID, ID, ID) {
    draft_maker_ids_for_testing(ids.objects)
}

public fun draft_maker_ids_for_testing(ids: MakerObjectIds): (ID, ID, ID, ID) {
    (ids.root, ids.base, ids.treasury, ids.admin)
}

public fun companion_ids_for_testing(ids: ActiveMakerIds): (ID, ID, ID, ID, ID, ID, ID, ID, ID) {
    draft_companion_ids_for_testing(ids.objects)
}

public fun draft_companion_ids_for_testing(ids: MakerObjectIds): (ID, ID, ID, ID, ID, ID, ID, ID, ID) {
    (ids.definitions, ids.packs, ids.admission, ids.seal, ids.output,
        ids.souls, ids.physical, ids.market, ids.market_treasury)
}

public fun storage_ids_for_testing(ids: ActiveMakerIds): (ID, ID) {
    (ids.certificate, ids.objects.blob)
}

public fun draft_blob_id_for_testing(ids: MakerObjectIds): ID { ids.blob }

public fun maker_objects_for_testing(ids: ActiveMakerIds): MakerObjectIds { ids.objects }

/// IDs from a separately authored fixture; activation still validates every
/// actual object through the unchanged production companion/certificate path.
public fun maker_objects_from_ids_for_testing(
    root: ID, base: ID, treasury: ID, admin: ID,
    definitions: ID, packs: ID, admission: ID, seal: ID,
    output: ID, souls: ID, physical: ID, market: ID, market_treasury: ID, blob: ID,
): MakerObjectIds {
    MakerObjectIds { root, base, treasury, admin, definitions, packs, admission,
        seal, output, souls, physical, market, market_treasury, blob }
}

public fun new_active_maker_for_testing(
    scenario: &mut Scenario, protocol_id: ID, setup: SetupIds, system: &mut System,
): ActiveMakerIds {
    let author = scenario.ctx().sender();
    let (ids, living) = new_draft_maker_for_testing(scenario, protocol_id, setup, system);
    let active = activate_maker_for_testing(scenario, protocol_id, setup, ids, system, living);
    scenario.next_tx(author);
    active
}

/// Two distinct single-item Parts, with an optional empty Part before `part`.
public fun new_active_sparse_parts_for_testing(
    scenario: &mut Scenario, protocol_id: ID, setup: SetupIds, system: &mut System,
): ActiveMakerIds {
    let author = scenario.ctx().sender();
    let (ids, living) = new_draft_with_policy(scenario, protocol_id, setup, system,
        option::none(), true, false, true);
    let active = activate_maker_for_testing(scenario, protocol_id, setup, ids, system, living);
    scenario.next_tx(author);
    active
}

/// Same author/bootstrap flow with a real protected Complete policy row.
public fun new_active_protected_maker_for_testing(
    scenario: &mut Scenario, protocol_id: ID, setup: SetupIds, system: &mut System,
): ActiveMakerIds {
    let author = scenario.ctx().sender();
    let (ids, living) = new_draft_with_policy(scenario, protocol_id, setup, system, option::none(), true, true, false);
    let active = activate_maker_for_testing(scenario, protocol_id, setup, ids, system, living);
    scenario.next_tx(author);
    active
}

/// The caller retains the exact System created by bootstrap. The fixture never
/// installs a second Walrus System, mutates lifecycle, or fabricates role caps.
/// The Base fixture helper appends five real public rows and seals their exact
/// author commitment; its part payload is the documented test hash 11.
public fun new_draft_maker_for_testing(
    scenario: &mut Scenario, protocol_id: ID, setup: SetupIds, system: &mut System,
): (MakerObjectIds, LivingContentBindingV8) {
    new_draft_with_policy(scenario, protocol_id, setup, system, option::none(), true, false, false)
}

/// Delays only the normal Market seal call so readiness tests can observe its
/// real pre-seal state. The caller must seal before normal Maker activation.
public fun new_draft_with_unsealed_market_for_testing(
    scenario: &mut Scenario, protocol_id: ID, setup: SetupIds, system: &mut System,
): (MakerObjectIds, LivingContentBindingV8) {
    new_draft_with_policy(scenario, protocol_id, setup, system, option::none(), false, false, false)
}

public fun new_draft_with_physical_for_testing(
    scenario: &mut Scenario, protocol_id: ID, setup: SetupIds, system: &mut System,
    issuance: u8, proof: u8, price: u64, max_supply: u64, transferable: bool,
): (MakerObjectIds, LivingContentBindingV8) {
    new_draft_with_policy(scenario, protocol_id, setup, system,
        option::some(PhysicalPolicyFixture { issuance, proof, price, max_supply, transferable }), true, false, false)
}

public fun new_active_with_physical_for_testing(
    scenario: &mut Scenario, protocol_id: ID, setup: SetupIds, system: &mut System,
    issuance: u8, proof: u8, price: u64, max_supply: u64, transferable: bool,
): ActiveMakerIds {
    let author = scenario.ctx().sender();
    let (ids, living) = new_draft_with_physical_for_testing(scenario, protocol_id,
        setup, system, issuance, proof, price, max_supply, transferable);
    let active = activate_maker_for_testing(scenario, protocol_id, setup, ids, system, living);
    scenario.next_tx(author);
    active
}

fun new_draft_with_policy(
    scenario: &mut Scenario, protocol_id: ID, setup: SetupIds, system: &mut System,
    physical_policy: Option<PhysicalPolicyFixture>,
    seal_market: bool,
    protected_complete: bool,
    sparse_parts: bool,
): (MakerObjectIds, LivingContentBindingV8) {
    let author = scenario.ctx().sender();
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
    let profile_prefix = if (sparse_parts) runtime::advance_profile_commitment_v8(content, 0,
        runtime::empty_profile_commitment_v8(content), b"empty-part".to_string(),
        fixture_hash(15), false, wardrobe, behavior, 1, ceiling)
        else runtime::empty_profile_commitment_v8(content);
    let part_index = if (sparse_parts) 1 else 0;
    let part_count = part_index + 1;
    let profile_commitment = runtime::advance_profile_commitment_v8(content, part_index,
        profile_prefix, b"part".to_string(),
        fixture_hash(11), true, wardrobe, behavior, 1, ceiling);
    let pack_policy = runtime::runtime_policy_commitment_v8(
        content, part_count, profile_commitment, ceiling, true);
    let economics = maker::new_economics_snapshot_v8<SUI>(&protocol,
        0, 0, maker::complete_unlimited_free_v8(), 0, 0, 0);
    let rights = maker::new_onchain_native_rights_snapshot_v8(ctx, 250, 250, 500);
    let clock = sui::clock::create_for_testing(ctx);
    let (mut root, mut base_registry, treasury, admin) = core::new_initial_maker_draft_v8<SUI>(
        &protocol, b"native-graph-author".to_string(), fixture_hash(9), defaults,
        core::living_content_binding_commitment_v1(&living), fixture_hash(10),
        b"fixture-manifest".to_string(), fixture_hash(12), content,
        base::new_base_definition_counts_v8(1, 0, part_count, 1, 1, 0, 1),
        if (sparse_parts) sparse_base::author_commitment() else base::minimal_author_rows_commitment_for_testing(), pack_policy,
        economics, rights, &clock, ctx);
    clock.destroy_for_testing();
    release::finalize_product_release_binding_v8(&mut root, &admin, &protocol,
        &catalog, &release_config, ctx);
    if (sparse_parts) sparse_base::populate(&mut base_registry, &mut root, &admin)
    else base::populate_and_seal_minimal_for_testing(&mut base_registry, &mut root, &admin);

    let (mut definitions, packs, admission) = runtime::new_runtime_registries_v8(
        &root, &admin, &base_registry, part_count, profile_commitment, ceiling, true, ctx);
    if (sparse_parts) runtime::append_part_profile_v8(&mut definitions, &root, &admin, &base_registry,
        0, b"empty-part".to_string(), wardrobe, behavior, 1);
    runtime::append_part_profile_v8(&mut definitions, &root, &admin, &base_registry,
        part_index, b"part".to_string(), wardrobe, behavior, 1);
    runtime::seal_runtime_definitions_v8(&mut definitions, &root, &admin, &base_registry);
    let mut seal_registry = seal::new_seal_registry_v8(&root, &admin, &seal_policy, 0, 0, 0, ctx);
    seal::seal_registry_v8(&mut seal_registry, &root, &admin, &seal_policy);

    // Both variants commit the selected protection mode before normal activation.
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
    let mut physical_commitment = physical::empty_base_policy_commitment_v8(
        &root, &base_registry, &physical_config);
    let mut physical_count = 0;
    let mut physical_row = vector[];
    if (physical_policy.is_some()) {
        let policy = physical_policy.borrow();
        physical_row = physical::derive_base_policy_row_commitment_v8(&root,
            &base_registry, &physical_config, 0, b"part".to_string(),
            b"item".to_string(), b"style".to_string(), fixture_hash(94),
            policy.issuance, policy.proof, policy.price, policy.max_supply, policy.transferable);
        physical_commitment = physical::advance_base_policy_commitment_v8(
            &root, 0, physical_commitment, physical_row);
        physical_count = 1;
    };
    let mut physical_registry = physical::new_physical_registry_v8(&root, &admin,
        &base_registry, &catalog, &physical_config, physical_count, physical_commitment, ctx);
    if (physical_policy.is_some()) {
        let policy = physical_policy.borrow();
        physical::append_base_style_policy_v8(&mut physical_registry, &root, &admin,
            &base_registry, &catalog, &physical_config, 0, b"part".to_string(),
            b"item".to_string(), b"style".to_string(), fixture_hash(94),
            policy.issuance, policy.proof, policy.price, policy.max_supply,
            policy.transferable, physical_row);
    };
    physical::seal_physical_registry_v8(&mut physical_registry, &root, &admin,
        &base_registry, &catalog, &physical_config);
    let (mut market_registry, market_treasury) = market::new_market_objects_v8(
        &root, &admin, &protocol, &catalog, &replacement, &market_config, ctx);
    if (seal_market) {
        market::seal_market_registry_v8(&mut market_registry, &market_treasury, &root,
            &admin, &protocol, &catalog, &replacement, &market_config);
    };

    let ids = MakerObjectIds {
        root: object::id(&root), base: object::id(&base_registry),
        treasury: object::id(&treasury), admin: object::id(&admin),
        definitions: object::id(&definitions), packs: object::id(&packs),
        admission: object::id(&admission), seal: object::id(&seal_registry),
        output: object::id(&output_registry), souls: object::id(&souls),
        physical: object::id(&physical_registry), market: object::id(&market_registry),
        market_treasury: object::id(&market_treasury),
        blob: object::id(&blob),
    };
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
    (ids, living)
}

/// Real second author transaction. No owned Root is forced ACTIVE just to
/// bypass the draft-only sharing entry point.
/// Leaves the activation transaction open so callers may inspect its exact
/// events; the convenience new_active wrapper advances to the readback tx.
public fun activate_maker_for_testing(
    scenario: &mut Scenario, protocol_id: ID, setup: SetupIds,
    ids: MakerObjectIds, system: &System, living: LivingContentBindingV8,
): ActiveMakerIds {
    let author = scenario.ctx().sender();
    let (catalog_id, seal_id, _runtime_id, output_id, physical_id, market_id, release_id) =
        bootstrap::configuration_ids_for_testing(setup);
    let (replacement_id, bootstrap_id, policy_id) = bootstrap::authority_ids_for_testing(scenario, setup);
    let protocol = scenario.take_shared_by_id<ProtocolConfigV8>(protocol_id);
    let catalog = scenario.take_shared_by_id<ProductReleaseCatalogV8>(catalog_id);
    let replacement = scenario.take_immutable_by_id<FreshTupleReplacementBindingV2>(replacement_id);
    let bootstrap_certificate = scenario.take_immutable_by_id<FreshTupleBootstrapCertificateV2>(bootstrap_id);
    let mut walrus_policy = scenario.take_shared_by_id<WalrusCertificationPolicyV1>(policy_id);
    let seal_policy = scenario.take_shared_by_id<SealPolicyConfigV8>(seal_id);
    let output_config = scenario.take_shared_by_id<OutputPackageConfigV8>(output_id);
    let physical_config = scenario.take_shared_by_id<PhysicalPackageConfigV8>(physical_id);
    let market_config = scenario.take_shared_by_id<MarketPackageConfigV8>(market_id);
    let release_config = scenario.take_shared_by_id<ReleasePackageConfigV8>(release_id);
    let mut root = scenario.take_shared_by_id<MakerRootV8<SUI>>(ids.root);
    let base_registry = scenario.take_shared_by_id<BaseDefinitionRegistryV8>(ids.base);
    let admin = scenario.take_from_sender_by_id<MakerAdminCapV8>(ids.admin);
    let definitions = scenario.take_shared_by_id<RuntimeDefinitionRegistryV8>(ids.definitions);
    let packs = scenario.take_shared_by_id<PackRegistryV8>(ids.packs);
    let admission = scenario.take_from_sender_by_id<PackAdmissionAuthorityV8>(ids.admission);
    let seal_registry = scenario.take_shared_by_id<SealRegistryV8>(ids.seal);
    let output_registry = scenario.take_shared_by_id<OutputRegistryV8>(ids.output);
    let souls = scenario.take_shared_by_id<SoulRegistryV8>(ids.souls);
    let physical_registry = scenario.take_shared_by_id<PhysicalRegistryV8>(ids.physical);
    let market_registry = scenario.take_shared_by_id<MarketRegistryV8<SUI>>(ids.market);
    let market_treasury = scenario.take_shared_by_id<MarketTreasuryV8<SUI>>(ids.market_treasury);
    let blob = scenario.take_from_sender_by_id<Blob>(ids.blob);
    let ctx = scenario.ctx();
    let certificate = core::certify_walrus_living_content_v1(&protocol, &catalog,
        &mut walrus_policy, &root, &admin, living, &blob, system, ctx);
    let builder = release::prepare_maker_companion_binding_v2(&root, &admin,
        &protocol, &catalog, &replacement, &base_registry, &walrus_policy,
        &certificate, system, &definitions, &packs, &admission, &seal_policy,
        &seal_registry, &output_config, &output_registry, &souls,
        &physical_config, &physical_registry, ctx);
    let builder = market::bind_maker_market_companion_v2(builder, &root, &admin,
        &protocol, &catalog, &replacement, &market_config, &market_registry,
        &market_treasury, ctx);
    core::finish_maker_companion_binding_v2(builder, &mut root, &admin,
        &protocol, &catalog, &replacement, &base_registry, &walrus_policy,
        &certificate, system, ctx);
    release::seal_and_activate_maker_v8(&mut root, &admin, &protocol, &catalog,
        &replacement, &bootstrap_certificate, &walrus_policy, &certificate,
        system, &base_registry, &release_config, ctx);
    assert!(maker::root_lifecycle_v8(&root) == maker::lifecycle_active_v8(), 1);
    assert!(maker::root_owner_v8(&root) == author, 2);
    let certificate_id = object::id(&certificate);
    core::freeze_certified_living_content_v1(certificate);
    scenario::return_shared(root);
    scenario::return_shared(base_registry);
    scenario.return_to_sender(admin);
    scenario::return_shared(definitions);
    scenario::return_shared(packs);
    scenario.return_to_sender(admission);
    scenario::return_shared(seal_registry);
    scenario::return_shared(output_registry);
    scenario::return_shared(souls);
    scenario::return_shared(physical_registry);
    scenario::return_shared(market_registry);
    scenario::return_shared(market_treasury);
    scenario::return_shared(protocol);
    scenario::return_shared(catalog);
    scenario::return_shared(walrus_policy);
    scenario::return_shared(seal_policy);
    scenario::return_shared(output_config);
    scenario::return_shared(physical_config);
    scenario::return_shared(market_config);
    scenario::return_shared(release_config);
    scenario::return_immutable(replacement);
    scenario::return_immutable(bootstrap_certificate);
    scenario.return_to_sender(blob);
    ActiveMakerIds { objects: ids, certificate: certificate_id }
}

/// Actual registered nondeletable Blob and paid Storage; only the external
/// committee certification is supplied by Walrus's official test hook. The
/// author hashes above are declared fixture bytes, not verified remote content.
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

#[test]
fun native_graph_active_maker_uses_real_author_publication() {
    let mut scenario = scenario::begin(@0xA11);
    let (protocol_id, setup, mut system) = bootstrap::initialize_for_testing(&mut scenario);
    let ids = new_active_maker_for_testing(&mut scenario, protocol_id, setup, &mut system);
    let root = scenario.take_shared_by_id<MakerRootV8<SUI>>(ids.objects.root);
    assert!(maker::root_lifecycle_v8(&root) == maker::lifecycle_active_v8(), 1);
    assert!(maker::root_owner_v8(&root) == @0xA11, 2);
    assert!(maker::root_base_registry_id_v2(&root) == ids.objects.base, 3);
    let bound = maker::root_companion_registry_ids_v2(&root);
    assert!(companion::runtime_definition_registry_id_v2(bound) == ids.objects.definitions, 4);
    assert!(companion::pack_registry_id_v2(bound) == ids.objects.packs, 4);
    assert!(companion::admission_authority_id_v2(bound) == ids.objects.admission, 4);
    assert!(companion::seal_registry_id_v2(bound) == ids.objects.seal, 4);
    assert!(companion::output_registry_id_v2(bound) == ids.objects.output, 4);
    assert!(companion::soul_registry_id_v2(bound) == ids.objects.souls, 4);
    assert!(companion::physical_registry_id_v2(bound) == ids.objects.physical, 4);
    assert!(companion::market_registry_id_v2(bound) == ids.objects.market, 4);
    scenario::return_shared(root);
    std::unit_test::destroy(system);
    scenario.end();
}
