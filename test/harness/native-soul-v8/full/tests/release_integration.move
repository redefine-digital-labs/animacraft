/// Release scenarios migrated one-for-one from the retired inline TestFixture.
/// Real setup/caller installation and real author activation come from the
/// acyclic upper graph. No permission cap, ACTIVE field or dummy registry is made here.
#[test_only]
module native_soul_v8_graph::release_integration;

use native_soul_v8_graph::bootstrap::{Self as bootstrap, SetupIds};
use native_soul_v8_graph::active_maker::{Self as active, MakerObjectIds};
use animacraft_v8_core::activation_v8 as activation;
use animacraft_v8_core::maker_v8::{Self as maker, MakerRootV8, MakerAdminCapV8};
use animacraft_v8_core::base_registry_v8::BaseDefinitionRegistryV8;
use animacraft_v8_core::protocol_config_v8::{Self as protocol, ProtocolConfigV8, ProtocolAdminCapV8, ProtocolTreasuryV8};
use animacraft_v8_core::treasury_v8::MakerTreasuryV8;
use animacraft_v8_core::package_binding_v8::{ProductReleaseCatalogV8, FreshTupleReplacementBindingV2};
use animacraft_v8_output::output_v8::OutputRegistryV8;
use animacraft_v8_seal::seal_v8::{Self as seal, SealPolicyConfigV8, SealRegistryV8};
use animacraft_v8_release::release_v8::{Self as release, ReleasePackageConfigV8};
use sui::test_scenario::{Self as scenario, Scenario};
use sui::sui::SUI;
use walrus::system::System;

/// An actual type with a wrong package origin, not a primitive whose lack of
/// package identity aborts inside std::type_name before the authority gate.
public struct WrongReleaseWitness has drop {}

public struct Fixture {
    config: ProtocolConfigV8, protocol_treasury: ProtocolTreasuryV8<SUI>,
    root: MakerRootV8<SUI>, admin: MakerAdminCapV8,
    catalog: ProductReleaseCatalogV8, replacement: FreshTupleReplacementBindingV2,
    release_config: ReleasePackageConfigV8, base_registry: BaseDefinitionRegistryV8,
    maker_treasury: MakerTreasuryV8<SUI>, seal_policy_config: SealPolicyConfigV8,
    seal_registry: SealRegistryV8, output_registry: OutputRegistryV8,
    bootstrap_id: ID, companion_ids: vector<ID>,
}

fun start(scenario: &mut Scenario, activate: bool): (ID, SetupIds, MakerObjectIds, System) {
    let (protocol_id, setup, mut system) = bootstrap::initialize_for_testing(scenario);
    let (objects, living) = active::new_draft_maker_for_testing(scenario, protocol_id, setup, &mut system);
    if (activate) {
        let _ = active::activate_maker_for_testing(scenario, protocol_id, setup, objects, &system, living);
    } else {
        std::unit_test::destroy(living);
    };
    let author = scenario.ctx().sender();
    scenario.next_tx(author);
    (protocol_id, setup, objects, system)
}

fun take_fixture(scenario: &Scenario, protocol_id: ID, setup: SetupIds, ids: MakerObjectIds): Fixture {
    let (catalog_id, seal_id, _, _, _, _, release_id) = bootstrap::configuration_ids_for_testing(setup);
    let (replacement_id, bootstrap_id, _) = bootstrap::authority_ids_for_testing(scenario, setup);
    let (root_id, base_id, treasury_id, admin_id) = active::draft_maker_ids_for_testing(ids);
    let (definitions, packs, admission, seal_registry_id, output_id, souls, physical, market, market_treasury) =
        active::draft_companion_ids_for_testing(ids);
    let config = scenario.take_shared_by_id<ProtocolConfigV8>(protocol_id);
    let protocol_treasury_id = *protocol::config_treasury_id_v8(&config).borrow();
    Fixture {
        config, protocol_treasury: scenario.take_shared_by_id<ProtocolTreasuryV8<SUI>>(protocol_treasury_id),
        root: scenario.take_shared_by_id<MakerRootV8<SUI>>(root_id),
        admin: scenario.take_from_sender_by_id<MakerAdminCapV8>(admin_id),
        catalog: scenario.take_shared_by_id<ProductReleaseCatalogV8>(catalog_id),
        replacement: scenario.take_immutable_by_id<FreshTupleReplacementBindingV2>(replacement_id),
        release_config: scenario.take_shared_by_id<ReleasePackageConfigV8>(release_id),
        base_registry: scenario.take_shared_by_id<BaseDefinitionRegistryV8>(base_id),
        maker_treasury: scenario.take_shared_by_id<MakerTreasuryV8<SUI>>(treasury_id),
        seal_policy_config: scenario.take_shared_by_id<SealPolicyConfigV8>(seal_id),
        seal_registry: scenario.take_shared_by_id<SealRegistryV8>(seal_registry_id),
        output_registry: scenario.take_shared_by_id<OutputRegistryV8>(output_id),
        bootstrap_id, companion_ids: vector[definitions, packs, admission, seal_registry_id,
            output_id, souls, physical, market, market_treasury],
    }
}

fun finish(scenario: &Scenario, fixture: Fixture) {
    let Fixture { config, protocol_treasury, root, admin, catalog, replacement,
        release_config, base_registry, maker_treasury, seal_policy_config,
        seal_registry, output_registry, bootstrap_id: _, companion_ids: _ } = fixture;
    scenario::return_shared(config);
    scenario::return_shared(protocol_treasury);
    scenario::return_shared(root);
    scenario.return_to_sender(admin);
    scenario::return_shared(catalog);
    scenario::return_immutable(replacement);
    scenario::return_shared(release_config);
    scenario::return_shared(base_registry);
    scenario::return_shared(maker_treasury);
    scenario::return_shared(seal_policy_config);
    scenario::return_shared(seal_registry);
    scenario::return_shared(output_registry);
}
fun pause(f: &mut Fixture, ctx: &TxContext) {
    release::pause_maker_v8(&mut f.root, &f.admin, &f.config, &f.catalog, &f.replacement, &f.release_config, ctx);
}
fun resume(f: &mut Fixture, ctx: &TxContext) {
    release::resume_maker_v8(&mut f.root, &f.admin, &f.config, &f.catalog, &f.replacement, &f.release_config, ctx);
}
fun archive(f: &mut Fixture, ctx: &TxContext) {
    release::archive_maker_v8(&mut f.root, &f.admin, &f.config, &f.catalog, &f.replacement, &f.release_config, ctx);
}
fun disable(scenario: &Scenario, f: &mut Fixture) {
    let admin = scenario.take_from_sender<ProtocolAdminCapV8>();
    protocol::set_protocol_enabled_v8(&mut f.config, &admin, false);
    scenario.return_to_sender(admin);
}
fun test_hash(byte: u8): vector<u8> { vector::tabulate!(32, |_| byte) }

#[test]
fun activation_emits_exact_live_tuple_once() {
    let mut scenario = scenario::begin(@0xA11);
    let (protocol_id, setup, mut system) = bootstrap::initialize_for_testing(&mut scenario);
    let (ids, living) = active::new_draft_maker_for_testing(&mut scenario, protocol_id, setup, &mut system);
    let _ = active::activate_maker_for_testing(&mut scenario, protocol_id, setup, ids, &system, living);
    // next_tx drains events. Capture the actual emitted typed value before
    // advancing, then compare every field against the committed object readback.
    let activated = release::capture_activation_event_for_testing();
    scenario.next_tx(@0xA11);
    let fixture = take_fixture(&scenario, protocol_id, setup, ids);
    release::assert_activation_for_testing(activated, &fixture.root, &fixture.admin, &fixture.catalog,
        &fixture.base_registry, &fixture.maker_treasury, &fixture.protocol_treasury,
        &fixture.seal_registry, &fixture.seal_policy_config, fixture.companion_ids,
        object::id(&fixture.replacement), fixture.bootstrap_id);
    finish(&scenario, fixture);
    std::unit_test::destroy(system);
    scenario.end();
}

#[test]
fun lifecycle_transitions_emit_exact_readbacks() {
    let mut scenario = scenario::begin(@0xA11);
    let (protocol_id, setup, ids, system) = start(&mut scenario, true);
    let mut fixture = take_fixture(&scenario, protocol_id, setup, ids);
    pause(&mut fixture, scenario.ctx()); resume(&mut fixture, scenario.ctx());
    pause(&mut fixture, scenario.ctx()); archive(&mut fixture, scenario.ctx());
    assert!(maker::root_lifecycle_v8(&fixture.root) == maker::lifecycle_archived_v8(), 99);
    release::assert_lifecycle_events_for_testing(&fixture.root, &fixture.catalog, vector[1, 2, 1, 2], vector[2, 1, 2, 3]);
    finish(&scenario, fixture);
    std::unit_test::destroy(system);
    scenario.end();
}

#[test]
fun disabled_protocol_still_allows_pause_and_archive() {
    let mut scenario = scenario::begin(@0xA11);
    let (protocol_id, setup, ids, system) = start(&mut scenario, true);
    let mut fixture = take_fixture(&scenario, protocol_id, setup, ids);
    disable(&scenario, &mut fixture);
    pause(&mut fixture, scenario.ctx()); archive(&mut fixture, scenario.ctx());
    assert!(maker::root_lifecycle_v8(&fixture.root) == maker::lifecycle_archived_v8(), 99);
    release::assert_lifecycle_events_for_testing(&fixture.root, &fixture.catalog, vector[1, 2], vector[2, 3]);
    finish(&scenario, fixture);
    std::unit_test::destroy(system);
    scenario.end();
}

#[test]
fun active_can_archive_directly_with_exact_event() {
    let mut scenario = scenario::begin(@0xA11);
    let (protocol_id, setup, ids, system) = start(&mut scenario, true);
    let mut fixture = take_fixture(&scenario, protocol_id, setup, ids);
    archive(&mut fixture, scenario.ctx());
    assert!(maker::root_lifecycle_v8(&fixture.root) == maker::lifecycle_archived_v8(), 99);
    release::assert_lifecycle_events_for_testing(&fixture.root, &fixture.catalog, vector[1], vector[3]);
    finish(&scenario, fixture);
    std::unit_test::destroy(system);
    scenario.end();
}

#[test, expected_failure(abort_code = 0, location = animacraft_v8_core::maker_v8)]
fun active_cannot_pause_twice() {
    let mut scenario = scenario::begin(@0xA11);
    let (protocol_id, setup, ids, system) = start(&mut scenario, true);
    std::unit_test::destroy(system);
    let mut fixture = take_fixture(&scenario, protocol_id, setup, ids);
    pause(&mut fixture, scenario.ctx()); pause(&mut fixture, scenario.ctx());
    abort 99 // Reaching here is a failed rejection, never the expected abort.
}

#[test, expected_failure(abort_code = 0, location = animacraft_v8_core::maker_v8)]
fun active_cannot_resume() {
    let mut scenario = scenario::begin(@0xA11);
    let (protocol_id, setup, ids, system) = start(&mut scenario, true);
    std::unit_test::destroy(system);
    let mut fixture = take_fixture(&scenario, protocol_id, setup, ids);
    resume(&mut fixture, scenario.ctx());
    abort 99 // Reaching here is a failed rejection, never the expected abort.
}

#[test, expected_failure(abort_code = 0, location = animacraft_v8_core::maker_v8)]
fun archived_is_terminal() {
    let mut scenario = scenario::begin(@0xA11);
    let (protocol_id, setup, ids, system) = start(&mut scenario, true);
    std::unit_test::destroy(system);
    let mut fixture = take_fixture(&scenario, protocol_id, setup, ids);
    archive(&mut fixture, scenario.ctx()); pause(&mut fixture, scenario.ctx());
    abort 99 // Reaching here is a failed rejection, never the expected abort.
}

#[test, expected_failure(abort_code = 2, location = animacraft_v8_core::maker_v8)]
fun wrong_owner_cannot_pause() {
    let mut scenario = scenario::begin(@0xA11);
    let (protocol_id, setup, ids, system) = start(&mut scenario, true);
    std::unit_test::destroy(system);
    let mut fixture = take_fixture(&scenario, protocol_id, setup, ids);
    let attacker = sui::tx_context::new_from_hint(@0xB0B, 908, 0, 0, 0);
    pause(&mut fixture, &attacker);
    abort 99 // Reaching here is a failed rejection, never the expected abort.
}

#[test, expected_failure(abort_code = 1, location = animacraft_v8_core::protocol_config_v8)]
fun disabled_protocol_rejects_resume() {
    let mut scenario = scenario::begin(@0xA11);
    let (protocol_id, setup, ids, system) = start(&mut scenario, true);
    std::unit_test::destroy(system);
    let mut fixture = take_fixture(&scenario, protocol_id, setup, ids);
    pause(&mut fixture, scenario.ctx()); disable(&scenario, &mut fixture); resume(&mut fixture, scenario.ctx());
    abort 99 // Reaching here is a failed rejection, never the expected abort.
}

#[test, expected_failure(abort_code = 10, location = animacraft_v8_core::maker_v8)]
fun product_release_binding_cannot_be_finalized_twice() {
    let mut scenario = scenario::begin(@0xA11);
    let (protocol_id, setup, ids, system) = start(&mut scenario, false);
    std::unit_test::destroy(system);
    let mut fixture = take_fixture(&scenario, protocol_id, setup, ids);
    let f = &mut fixture;
    release::finalize_product_release_binding_v8(&mut f.root, &f.admin, &f.config,
        &f.catalog, &f.release_config, scenario.ctx());
    abort 99 // Reaching here is a failed rejection, never the expected abort.
}

#[test, expected_failure(abort_code = 8, location = animacraft_v8_core::package_binding_v8)]
fun wrong_release_type_origin_is_rejected() {
    let mut scenario = scenario::begin(@0xA11);
    let (protocol_id, setup, ids, system) = start(&mut scenario, true);
    std::unit_test::destroy(system);
    let mut fixture = take_fixture(&scenario, protocol_id, setup, ids);
    // Retired original/callable marker arguments are replaced by the actual
    // complete fixed lifecycle-witness type check. This upper-package type
    // cannot impersonate the installed Release package's private witness.
    let f = &mut fixture;
    activation::pause_maker_v8(WrongReleaseWitness {}, &f.config, &f.catalog, &f.replacement,
        &mut f.root, &f.admin, scenario.ctx());
    abort 99 // Reaching here is a failed rejection, never the expected abort.
}

#[test, expected_failure(abort_code = 1, location = animacraft_v8_core::maker_v8)]
fun wrong_admin_cannot_pause() {
    let mut scenario = scenario::begin(@0xA11);
    let (protocol_id, setup, ids, mut system) = start(&mut scenario, true);
    let (other_ids, living) = active::new_draft_maker_for_testing(&mut scenario, protocol_id, setup, &mut system);
    std::unit_test::destroy(living);
    std::unit_test::destroy(system);
    let (_, _, _, other_admin_id) = active::draft_maker_ids_for_testing(other_ids);
    let other_admin = scenario.take_from_sender_by_id<MakerAdminCapV8>(other_admin_id);
    let mut fixture = take_fixture(&scenario, protocol_id, setup, ids);
    let f = &mut fixture;
    release::pause_maker_v8(&mut f.root, &other_admin, &f.config,
        &f.catalog, &f.replacement, &f.release_config, scenario.ctx());
    abort 99
}

#[test, expected_failure(abort_code = 0, location = animacraft_v8_release::release_v8)]
fun cross_catalog_is_rejected() {
    let mut scenario = scenario::begin(@0xA11);
    let (protocol_id, setup, ids, system) = start(&mut scenario, true);
    let (_, other_setup) = bootstrap::initialize_with_system_for_testing(&mut scenario, &system);
    std::unit_test::destroy(system);
    let (other_catalog_id, _, _, _, _, _, _) = bootstrap::configuration_ids_for_testing(other_setup);
    let other_catalog = scenario.take_shared_by_id<ProductReleaseCatalogV8>(other_catalog_id);
    let mut fixture = take_fixture(&scenario, protocol_id, setup, ids);
    let f = &mut fixture;
    release::pause_maker_v8(&mut f.root, &f.admin, &f.config,
        &other_catalog, &f.replacement, &f.release_config, scenario.ctx());
    abort 99
}

// Explicit replacement of the retired retained-call-cap test: setup caps are
// consumed by installation. A different genuinely bootstrapped tuple's immutable
// replacement must never authorize this Root through the installed Release.
#[test, expected_failure(abort_code = 10, location = animacraft_v8_core::package_binding_v8)]
fun wrong_release_call_cap_is_rejected() {
    let mut scenario = scenario::begin(@0xA11);
    let (protocol_id, setup, ids, system) = start(&mut scenario, true);
    let (_, other_setup) = bootstrap::initialize_with_system_for_testing(&mut scenario, &system);
    std::unit_test::destroy(system);
    let (other_replacement_id, _, _) = bootstrap::authority_ids_for_testing(&scenario, other_setup);
    let other_replacement = scenario.take_immutable_by_id<FreshTupleReplacementBindingV2>(other_replacement_id);
    let mut fixture = take_fixture(&scenario, protocol_id, setup, ids);
    let f = &mut fixture;
    release::pause_maker_v8(&mut f.root, &f.admin, &f.config,
        &f.catalog, &other_replacement, &f.release_config, scenario.ctx());
    abort 99
}

#[test]
fun wrapped_rights_and_base_transport_use_private_release_authority() {
    let mut scenario = scenario::begin(@0xA11);
    let (protocol_id, setup, ids, system) = start(&mut scenario, false);
    let fixture = take_fixture(&scenario, protocol_id, setup, ids);
    let rights = release::new_license_wrapped_rights_snapshot_v8(
        &fixture.config,
        &fixture.catalog,
        &fixture.replacement,
        &fixture.release_config,
        b"walrus://rights-evidence".to_string(),
        b"rights-blob".to_string(),
        test_hash(31),
        test_hash(32),
        250,
        250,
        500,
        scenario.ctx(),
    );
    maker::assert_wrapped_rights_for_testing(&rights, scenario.ctx().sender(),
        object::id(&fixture.catalog));

    let certification = release::certify_base_ciphertext_v8(
        &fixture.config,
        &fixture.catalog,
        &fixture.release_config,
        &fixture.seal_policy_config,
        &fixture.root,
        b"style/body".to_string(),
        test_hash(33),
        b"asset/body".to_string(),
        test_hash(34),
        b"ciphertext-blob".to_string(),
        test_hash(35),
        test_hash(36),
        scenario.ctx(),
    );
    seal::destroy_ciphertext_certification_for_testing(certification);
    let pack_certification = release::certify_pack_ciphertext_v8(
        &fixture.config,
        &fixture.catalog,
        &fixture.release_config,
        &fixture.seal_policy_config,
        &fixture.root,
        b"pack/creator-pack".to_string(),
        test_hash(37),
        b"body/default/default".to_string(),
        test_hash(38),
        b"pack-ciphertext-blob".to_string(),
        test_hash(39),
        test_hash(40),
        scenario.ctx(),
    );
    seal::destroy_ciphertext_certification_for_testing(pack_certification);
    finish(&scenario, fixture);
    std::unit_test::destroy(system);
    scenario.end();
}

#[test]
fun protected_complete_registers_seal_and_returns_one_use_authorization() {
    let mut scenario = scenario::begin(@0xA11);
    let (protocol_id, setup, ids, system) = start(&mut scenario, true);
    let mut fixture = take_fixture(&scenario, protocol_id, setup, ids);
    release::assert_protected_complete_preparation_for_testing(&fixture.config,
        &fixture.catalog, &fixture.seal_policy_config, &fixture.root,
        &mut fixture.seal_registry, scenario.ctx());
    finish(&scenario, fixture);
    std::unit_test::destroy(system);
    scenario.end();
}

#[test]
fun release_render_witness_roundtrip_is_internal_and_exact() {
    let mut scenario = scenario::begin(@0xA11);
    let (protocol_id, setup, ids, system) = start(&mut scenario, false);
    let fixture = take_fixture(&scenario, protocol_id, setup, ids);
    release::assert_render_witness_roundtrip_for_testing(&fixture.root, &fixture.catalog,
        &fixture.output_registry, scenario.ctx());
    finish(&scenario, fixture);
    std::unit_test::destroy(system);
    scenario.end();
}
