/// Isolated role identities for Core's mark protocol tests only. These modules
/// cannot stand in for deployed Output/Market configs or consumer installation.
#[test_only]
module 0x85::market_v8 {
    public struct MarketRuntimeCallerCapInstallWitnessV2 has drop {}
    public fun witness_for_testing(): MarketRuntimeCallerCapInstallWitnessV2 {
        MarketRuntimeCallerCapInstallWitnessV2 {}
    }
}

#[test_only]
module animacraft_v8_core::bootstrap_install_tests {
use animacraft_v8_core::package_binding_v8::{
    ProductReleaseCatalogV8, FreshTupleReplacementBindingV2,
    FreshTupleBootstrapAdminV2, FreshTupleBootstrapCertificateV2,
    RuntimeCallerCapV1,
    product_release_catalog_at_addresses_for_testing, complete_catalog_setup_for_testing,
    new_fresh_tuple_replacement_binding_input_v2, seal_fresh_tuple_replacement_binding_v2,
    share_product_release_catalog_v8, begin_fresh_tuple_bootstrap_v2,
    mark_fresh_tuple_install_v2, mint_runtime_caller_caps_v1,
    destroy_runtime_caller_cap_for_testing, runtime_caller_cap_commitment_v2,
    finalize_fresh_tuple_bootstrap_v2, assert_bootstrap_certificate_v2,
    assert_runtime_caller_cap_v1, bootstrap_config_ids_for_testing,
    bootstrap_certificate_shape_for_testing,
};
use animacraft_v8_core::protocol_config_v8::{Self as protocol, ProtocolConfigV8, ProtocolAdminCapV8};
use std::option;
public struct WrongWitness has drop {}
fun test_hash(byte: u8): vector<u8> {
    let mut bytes = vector[];
    let mut i = 0u64;
    while (i < 32) { bytes.push_back(byte); i = i + 1; };
    bytes
}
/// Exercises Core's real replacement/bootstrap/cap/mark state machine with
/// isolated exact-role test modules. Catalog setup rows are the existing Core
/// fixture; this is not Output/Market consumer or native completion E2E.
#[test_only]
fun bootstrap_install_case_for_testing(mode: u8) {
    use sui::test_scenario;
    let sender = @0xA11;
    let mut scenario = test_scenario::begin(sender);
    let ctx = scenario.ctx();
    let (mut config, protocol_admin) =
        protocol::new_protocol_for_testing<sui::sui::SUI>(true, ctx);
    animacraft_v8_core::soulidity_binding_v8::install_soulidity_binding_v8<
        animacraft_v8_core::soul::Soul,
        animacraft_v8_core::animacraft_v8_binding::MintBindingWitnessV8,
        animacraft_v8_core::animacraft_v8_binding::SoulOwnerWitnessV8,
    >(&mut config, &protocol_admin);
    let core = protocol::config_core_original_package_id_v8(&config).to_address();
    let addresses = vector[core, @0x81, @0x82, @0x13, @0x84, @0x85, @0x86];
    let mut catalog = product_release_catalog_at_addresses_for_testing(
        &config, addresses, addresses, ctx);
    complete_catalog_setup_for_testing(&mut catalog, ctx);
    let (runtime_id, output_id, market_id, release_id) = bootstrap_config_ids_for_testing(&catalog);
    let input = new_fresh_tuple_replacement_binding_input_v2(
        &catalog, runtime_id, output_id, market_id, release_id);
    seal_fresh_tuple_replacement_binding_v2(
        &config, &protocol_admin, &mut catalog, input, ctx);
    protocol::share_protocol_for_testing(config, protocol_admin, ctx);
    share_product_release_catalog_v8(catalog);

    scenario.next_tx(sender);
    let config = scenario.take_shared<ProtocolConfigV8>();
    let protocol_admin = scenario.take_from_sender<ProtocolAdminCapV8>();
    let mut catalog = scenario.take_shared<ProductReleaseCatalogV8>();
    let replacement = scenario.take_immutable<FreshTupleReplacementBindingV2>();
    begin_fresh_tuple_bootstrap_v2(
        &config, &protocol_admin, &replacement, &mut catalog, scenario.ctx());
    test_scenario::return_shared(config);
    test_scenario::return_shared(catalog);
    test_scenario::return_immutable(replacement);
    scenario.return_to_sender(protocol_admin);

    scenario.next_tx(sender);
    let config = scenario.take_shared<ProtocolConfigV8>();
    let mut catalog = scenario.take_shared<ProductReleaseCatalogV8>();
    let replacement = scenario.take_immutable<FreshTupleReplacementBindingV2>();
    let mut bootstrap = scenario.take_from_sender<FreshTupleBootstrapAdminV2>();
    if (mode == 7) {
        mark_fresh_tuple_install_v2(&config, &mut bootstrap, &replacement,
            &catalog, WrongWitness {}, 4, output_id, option::none(), test_hash(1));
    };
    let (output_cap, market_cap) = mint_runtime_caller_caps_v1(
        &config, &mut bootstrap, &replacement, &catalog);
    if (mode == 1 || mode == 2 || mode == 6) {
        mark_fresh_tuple_install_v2(&config, &mut bootstrap, &replacement,
            &catalog, WrongWitness {}, if (mode == 6) 4 else mode,
            output_id, option::none(), *runtime_caller_cap_commitment_v2(&output_cap));
    };
    if (mode == 3) {
        mark_bootstrap_cap_for_testing(0x85::market_v8::witness_for_testing(),
            &config, &mut bootstrap, &replacement, &catalog, &market_cap, 1, market_id);
    };
    if (mode == 9) {
        mark_bootstrap_cap_for_testing(0x13::output_v8::bootstrap_witness_for_testing(),
            &config, &mut bootstrap, &replacement, &catalog, &market_cap, 0, output_id);
    };
    if (mode == 10) {
        let (second_output, second_market) = mint_runtime_caller_caps_v1(
            &config, &mut bootstrap, &replacement, &catalog);
        destroy_runtime_caller_cap_for_testing(second_output);
        destroy_runtime_caller_cap_for_testing(second_market);
    };
    mark_bootstrap_cap_for_testing(0x13::output_v8::bootstrap_witness_for_testing(),
        &config, &mut bootstrap, &replacement, &catalog, &output_cap, 0,
        if (mode == 5) market_id else output_id);
    if (mode == 4) {
        mark_bootstrap_cap_for_testing(0x13::output_v8::bootstrap_witness_for_testing(),
            &config, &mut bootstrap, &replacement, &catalog, &output_cap, 0, output_id);
    };
    if (mode != 8) {
        mark_bootstrap_cap_for_testing(0x85::market_v8::witness_for_testing(),
            &config, &mut bootstrap, &replacement, &catalog, &market_cap, 1, market_id);
    };
    destroy_runtime_caller_cap_for_testing(output_cap);
    destroy_runtime_caller_cap_for_testing(market_cap);
    finalize_fresh_tuple_bootstrap_v2(
        &config, bootstrap, &replacement, &mut catalog, scenario.ctx());
    test_scenario::return_shared(config);
    test_scenario::return_shared(catalog);
    test_scenario::return_immutable(replacement);

    scenario.next_tx(sender);
    let catalog = scenario.take_shared<ProductReleaseCatalogV8>();
    let replacement = scenario.take_immutable<FreshTupleReplacementBindingV2>();
    let certificate = scenario.take_immutable<FreshTupleBootstrapCertificateV2>();
    let (mask, marks) = bootstrap_certificate_shape_for_testing(&certificate);
    assert!(mode == 0 && mask == 12 && marks == 2, 99);
    assert_bootstrap_certificate_v2(&certificate, &replacement, &catalog);
    test_scenario::return_shared(catalog);
    test_scenario::return_immutable(replacement);
    test_scenario::return_immutable(certificate);
    scenario.end();
}

#[test_only]
fun mark_bootstrap_cap_for_testing<W: drop>(
    witness: W, config: &ProtocolConfigV8, admin: &mut FreshTupleBootstrapAdminV2,
    replacement: &FreshTupleReplacementBindingV2, catalog: &ProductReleaseCatalogV8,
    cap: &RuntimeCallerCapV1, caller_role: u8, config_id: ID,
) {
    assert_runtime_caller_cap_v1(cap, caller_role, replacement, catalog);
    mark_fresh_tuple_install_v2(config, admin, replacement, catalog, witness,
        if (caller_role == 0) 4 else 8, config_id,
        option::none(), *runtime_caller_cap_commitment_v2(cap));
}

#[test]
fun bootstrap_installs_only_output_then_market() { bootstrap_install_case_for_testing(0); }
#[test, expected_failure(abort_code = 13, location = animacraft_v8_core::package_binding_v8)]
fun bootstrap_rejects_obsolete_runtime_external_install() { bootstrap_install_case_for_testing(1); }
#[test, expected_failure(abort_code = 13, location = animacraft_v8_core::package_binding_v8)]
fun bootstrap_rejects_obsolete_runtime_soul_install() { bootstrap_install_case_for_testing(2); }
#[test, expected_failure(abort_code = 13, location = animacraft_v8_core::package_binding_v8)]
fun bootstrap_rejects_market_before_output() { bootstrap_install_case_for_testing(3); }
#[test, expected_failure(abort_code = 13, location = animacraft_v8_core::package_binding_v8)]
fun bootstrap_rejects_duplicate_output_install() { bootstrap_install_case_for_testing(4); }
#[test, expected_failure(abort_code = 13, location = animacraft_v8_core::package_binding_v8)]
fun bootstrap_rejects_wrong_config_id() { bootstrap_install_case_for_testing(5); }
#[test, expected_failure(abort_code = 8, location = animacraft_v8_core::package_binding_v8)]
fun bootstrap_rejects_wrong_install_witness() { bootstrap_install_case_for_testing(6); }
#[test, expected_failure(abort_code = 12, location = animacraft_v8_core::package_binding_v8)]
fun bootstrap_rejects_install_before_cap_mint() { bootstrap_install_case_for_testing(7); }
#[test, expected_failure(abort_code = 13, location = animacraft_v8_core::package_binding_v8)]
fun bootstrap_rejects_finalize_before_market_install() { bootstrap_install_case_for_testing(8); }
#[test, expected_failure(abort_code = 14, location = animacraft_v8_core::package_binding_v8)]
fun bootstrap_rejects_wrong_role_caller_cap() { bootstrap_install_case_for_testing(9); }
#[test, expected_failure(abort_code = 12, location = animacraft_v8_core::package_binding_v8)]
fun bootstrap_rejects_duplicate_caller_cap_mint() { bootstrap_install_case_for_testing(10); }

}
