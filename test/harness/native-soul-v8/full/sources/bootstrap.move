/// Upper-graph acceptance entry: real package types and production setup APIs.
/// This harness is not a deployed package or a release artifact. Test commitments
/// and key-server IDs below are VM inputs, not claims about stored/live content.
module native_soul_v8_graph::bootstrap;

use animacraft_v8_core::protocol_config_v8::{Self as protocol,
    ProtocolConfigV8, ProtocolAdminCapV8, CorePackageMarkerV8};
use animacraft_v8_core::package_binding_v8::{Self as binding,
    PackageCommitmentsV8, ProductReleaseCatalogV8,
    FreshTupleReplacementBindingV2, FreshTupleBootstrapAdminV2};
use animacraft_v8_core::soulidity_binding_v8 as native_binding;
use animacraft_v8_core::core_v8 as core;
use walrus::system::System;
use animacraft_v8_seal::seal_v8::{Self as seal, SealOriginalMarkerV8, SealCallableMarkerV8};
use animacraft_v8_runtime::runtime_v8::{RuntimeOriginalMarkerV8, RuntimeCallableMarkerV8};
use animacraft_v8_runtime::runtime_binding_v8 as runtime_binding;
use animacraft_v8_output::output_v8::{Self as output,
    OutputOriginalMarkerV8, OutputCallableMarkerV8, OutputPackageConfigV8};
use animacraft_v8_physical::physical_v8::{Self as physical,
    PhysicalOriginalMarkerV8, PhysicalCallableMarkerV8};
use animacraft_v8_market::market_v8::{Self as market,
    MarketOriginalMarkerV8, MarketCallableMarkerV8, MarketPackageConfigV8};
use animacraft_v8_release::release_v8::{Self as release,
    ReleaseOriginalMarkerV8, ReleaseCallableMarkerV8};
use soulidity::soul::Soul;
use soulidity::animacraft_v8_binding::{MintBindingWitnessV8, SoulOwnerWitnessV8};

public struct SetupIds has copy, drop, store {
    catalog: ID,
    seal: ID,
    runtime: ID,
    output: ID,
    physical: ID,
    market: ID,
    release: ID,
    // Test metadata is captured while the real catalog is already borrowed.
    // These IDs never create authority and avoid re-taking scenario inventory.
    replacement: Option<ID>, certificate: Option<ID>, policy: Option<ID>,
}

/// Kept outside #[test_only] so the production graph build checks the actual
/// cross-package calls too. No setup cap is fabricated, discarded, or retained.
public fun install_fresh_configuration(
    protocol_config: &mut ProtocolConfigV8,
    protocol_admin: &ProtocolAdminCapV8,
    commitments: vector<PackageCommitmentsV8>,
    key_server_ids: vector<ID>,
    weights: vector<u16>,
    threshold: u16,
    walrus_system: &System,
    ctx: &mut TxContext,
): SetupIds {
    assert!(commitments.length() == 7, 0);
    native_binding::install_soulidity_binding_v8<Soul, MintBindingWitnessV8, SoulOwnerWitnessV8>(
        protocol_config, protocol_admin);
    let mut catalog = binding::certify_product_release_catalog_v8<
        CorePackageMarkerV8, CorePackageMarkerV8,
        SealOriginalMarkerV8, SealCallableMarkerV8,
        RuntimeOriginalMarkerV8, RuntimeCallableMarkerV8,
        OutputOriginalMarkerV8, OutputCallableMarkerV8,
        PhysicalOriginalMarkerV8, PhysicalCallableMarkerV8,
        MarketOriginalMarkerV8, MarketCallableMarkerV8,
        ReleaseOriginalMarkerV8, ReleaseCallableMarkerV8,
    >(protocol_config, protocol_admin, commitments[0], commitments[1],
        commitments[2], commitments[3], commitments[4], commitments[5],
        commitments[6], ctx);
    let seal_cap = binding::take_seal_call_cap_v8(protocol_config, protocol_admin, &mut catalog);
    let seal_config = seal::new_seal_policy_config_v8(protocol_config,
        protocol_admin, &mut catalog, seal_cap, key_server_ids, weights, threshold,
        b"BonehFranklinBLS12381DemCCA/AesGcm256".to_string(),
        b"SHA3-256:SUI-SEAL-IBE-BLS12381-H2-00:SUI-SEAL-IBE-BLS12381-H3-00".to_string(),
        b"Seal/EncryptedObject/BCS/v0".to_string(), 3 * 1024 * 1024, ctx);
    let runtime_cap = binding::take_runtime_call_cap_v8(protocol_config, protocol_admin, &mut catalog);
    let runtime_config = runtime_binding::new_runtime_package_config_v8(&mut catalog, runtime_cap, ctx);
    let output_cap = binding::take_output_call_cap_v8(protocol_config, protocol_admin, &mut catalog);
    let output_config = output::new_output_package_config_v8(&mut catalog, output_cap, ctx);
    let physical_cap = binding::take_physical_call_cap_v8(protocol_config, protocol_admin, &mut catalog);
    let physical_config = physical::new_physical_package_config_v8(&mut catalog, physical_cap, ctx);
    let market_cap = binding::take_market_call_cap_v8(protocol_config, protocol_admin, &mut catalog);
    let market_config = market::new_market_package_config_v8(&mut catalog, market_cap, ctx);
    let release_cap = binding::take_release_call_cap_v8(protocol_config, protocol_admin, &mut catalog);
    let release_config = release::new_release_package_config_v8(&mut catalog, release_cap, ctx);
    binding::assert_catalog_setup_complete_v2(&catalog);
    // This policy pins the actual storage system. It creates no platform
    // approver cap; each Maker owner certifies their own typed Blob later.
    core::bootstrap_walrus_certification_policy_v1(protocol_config,
        protocol_admin, &mut catalog, walrus_system, ctx);
    let ids = SetupIds {
        catalog: object::id(&catalog), seal: object::id(&seal_config),
        runtime: object::id(&runtime_config), output: object::id(&output_config),
        physical: object::id(&physical_config), market: object::id(&market_config),
        release: object::id(&release_config),
        replacement: option::none(), certificate: option::none(), policy: option::none(),
    };
    let replacement_input = binding::new_fresh_tuple_replacement_binding_input_v2(
        &catalog, ids.runtime, ids.output, ids.market, ids.release);
    binding::seal_fresh_tuple_replacement_binding_v2(protocol_config, protocol_admin,
        &mut catalog, replacement_input, ctx);
    seal::share_seal_policy_config_v8(seal_config);
    runtime_binding::share_runtime_package_config_v8(runtime_config);
    output::share_output_package_config_v8(output_config);
    physical::share_physical_package_config_v8(physical_config);
    market::share_market_package_config_v8(market_config);
    release::share_release_package_config_v8(release_config);
    binding::share_product_release_catalog_v8(catalog);
    ids
}

/// Execute only after begin_fresh_tuple_bootstrap_v2's owned admin is available.
/// The two real recipient configs install their own private role witnesses.
public fun install_callers_and_finalize(
    protocol_config: &ProtocolConfigV8,
    catalog: &mut ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    mut admin: FreshTupleBootstrapAdminV2,
    output_config: &mut OutputPackageConfigV8,
    market_config: &mut MarketPackageConfigV8,
    ctx: &mut TxContext,
) {
    let (output_caller, market_caller) = binding::mint_runtime_caller_caps_v1(
        protocol_config, &mut admin, replacement, catalog);
    output::install_output_runtime_caller_cap_v2(protocol_config, catalog,
        replacement, &mut admin, output_config, output_caller);
    market::install_market_runtime_caller_cap_v2(market_config, protocol_config,
        catalog, replacement, &mut admin, market_caller);
    binding::finalize_fresh_tuple_bootstrap_v2(protocol_config, admin, replacement, catalog, ctx);
}

#[test_only]
use sui::test_scenario::{Self as scenario, Scenario};
#[test_only]
use animacraft_v8_core::package_binding_v8::FreshTupleBootstrapCertificateV2;
#[test_only]
use animacraft_v8_core::core_v8::WalrusCertificationPolicyV1;

#[test_only]
fun begin_bootstrap(scenario: &mut Scenario, protocol_id: ID, ids: SetupIds) {
    let config = scenario.take_shared_by_id<ProtocolConfigV8>(protocol_id);
    let admin = scenario.take_from_sender<ProtocolAdminCapV8>();
    let mut catalog = scenario.take_shared_by_id<ProductReleaseCatalogV8>(ids.catalog);
    let (replacement_id, _) = binding::bootstrap_authority_ids_for_testing(&catalog);
    let replacement = scenario.take_immutable_by_id<FreshTupleReplacementBindingV2>(replacement_id);
    binding::begin_fresh_tuple_bootstrap_v2(&config, &admin, &replacement,
        &mut catalog, scenario.ctx());
    scenario::return_shared(config);
    scenario::return_shared(catalog);
    scenario::return_immutable(replacement);
    scenario.return_to_sender(admin);
}

/// Shared upper-graph fixture. Every caller receives actual initialized object
/// IDs, never fabricated role caps. The caller owns the Scenario and its sender.
#[test_only]
public fun initialize_for_testing(scenario: &mut Scenario): (ID, SetupIds, System) {
    let author = scenario.ctx().sender();
    // Official Walrus fixture initializes its own dummy context. Restore the
    // scenario sender before creating any author/protocol-owned resources.
    let walrus_system = walrus::system::new_for_testing(scenario.ctx());
    scenario.next_tx(author);
    let (protocol_id, ids) = initialize_with_system_for_testing(scenario, &walrus_system);
    (protocol_id, ids, walrus_system)
}

/// Additional independent tuples in the same scenario must reuse the first
/// actual Walrus System, not allocate a colliding official dummy System again.
#[test_only]
public fun initialize_with_system_for_testing(
    scenario: &mut Scenario, walrus_system: &System,
): (ID, SetupIds) {
    let author = scenario.ctx().sender();
    let (mut config, treasury, admin) =
        protocol::new_protocol_with_treasury_for_testing<sui::sui::SUI>(true, scenario.ctx());
    let protocol_id = object::id(&config);
    let mut ids = install_fresh_configuration(&mut config, &admin,
        vector[binding::test_commitments_v8(1), binding::test_commitments_v8(4),
            binding::test_commitments_v8(7), binding::test_commitments_v8(10),
            binding::test_commitments_v8(13), binding::test_commitments_v8(16),
            binding::test_commitments_v8(19)],
        vector[object::id_from_address(@0x901)], vector[1], 1, walrus_system, scenario.ctx());
    protocol::share_protocol_with_treasury_for_testing(config, treasury, admin, scenario.ctx());

    scenario.next_tx(author);
    begin_bootstrap(scenario, protocol_id, ids);

    scenario.next_tx(author);
    {
        let config = scenario.take_shared_by_id<ProtocolConfigV8>(protocol_id);
        let mut catalog = scenario.take_shared_by_id<ProductReleaseCatalogV8>(ids.catalog);
        let (replacement_id, _) = binding::bootstrap_authority_ids_for_testing(&catalog);
        let replacement = scenario.take_immutable_by_id<FreshTupleReplacementBindingV2>(replacement_id);
        let bootstrap = scenario.take_from_sender<FreshTupleBootstrapAdminV2>();
        let mut output_config = scenario.take_shared_by_id<OutputPackageConfigV8>(ids.output);
        let mut market_config = scenario.take_shared_by_id<MarketPackageConfigV8>(ids.market);
        install_callers_and_finalize(&config, &mut catalog, &replacement, bootstrap,
            &mut output_config, &mut market_config, scenario.ctx());
        let (replacement_id, certificate_id) = binding::bootstrap_authority_ids_for_testing(&catalog);
        ids.replacement = option::some(replacement_id);
        ids.certificate = certificate_id;
        ids.policy = option::some(core::walrus_policy_id_for_testing(&catalog));
        scenario::return_shared(config);
        scenario::return_shared(catalog);
        scenario::return_shared(output_config);
        scenario::return_shared(market_config);
        scenario::return_immutable(replacement);
    };

    scenario.next_tx(author);
    (protocol_id, ids)
}

#[test_only]
public fun configuration_ids_for_testing(ids: SetupIds): (ID, ID, ID, ID, ID, ID, ID) {
    (ids.catalog, ids.seal, ids.runtime, ids.output, ids.physical, ids.market, ids.release)
}

#[test_only]
public fun authority_ids_for_testing(_scenario: &Scenario, ids: SetupIds): (ID, ID, ID) {
    (ids.replacement.destroy_some(), ids.certificate.destroy_some(), ids.policy.destroy_some())
}

#[test]
fun native_graph_bootstrap_installs_actual_roles_and_native_binding() {
    let mut scenario = scenario::begin(@0xA11);
    let (protocol_id, ids, walrus_system) = initialize_for_testing(&mut scenario);
    let (replacement_id, certificate_id, policy_id) = authority_ids_for_testing(&scenario, ids);
    {
        let config = scenario.take_shared_by_id<ProtocolConfigV8>(protocol_id);
        let catalog = scenario.take_shared_by_id<ProductReleaseCatalogV8>(ids.catalog);
        let replacement = scenario.take_immutable_by_id<FreshTupleReplacementBindingV2>(replacement_id);
        let certificate = scenario.take_immutable_by_id<FreshTupleBootstrapCertificateV2>(certificate_id);
        let walrus_policy = scenario.take_shared_by_id<WalrusCertificationPolicyV1>(policy_id);
        core::assert_walrus_policy_current_v1(&config, &catalog, &walrus_policy);
        binding::assert_catalog_current_v8(&config, &catalog);
        binding::assert_bootstrap_certificate_v2(&certificate, &replacement, &catalog);
        let (mask, marks) = binding::bootstrap_certificate_shape_for_testing(&certificate);
        assert!(mask == 12 && marks == 2, 1);
        let (runtime_id, output_id, market_id, release_id) =
            binding::bootstrap_config_ids_for_testing(&catalog);
        assert!(runtime_id == ids.runtime && output_id == ids.output
            && market_id == ids.market && release_id == ids.release, 2);
        native_binding::assert_native_soul_v8<Soul>(&config);
        native_binding::assert_mint_witness_v8<MintBindingWitnessV8>(&config);
        native_binding::assert_owner_witness_v8<SoulOwnerWitnessV8>(&config);
        assert!(native_binding::native_soul_original_v8(&config)
            == std::type_name::with_original_ids<Soul>(), 3);
        scenario::return_shared(config);
        scenario::return_shared(catalog);
        scenario::return_immutable(replacement);
        scenario::return_immutable(certificate);
        scenario::return_shared(walrus_policy);
    };
    std::unit_test::destroy(walrus_system);
    scenario.end();
}
