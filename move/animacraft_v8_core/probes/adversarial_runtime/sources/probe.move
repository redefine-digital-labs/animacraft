/// Runtime attack against the one-use setup boundary.
module animacraft_v8_core_adversarial_runtime::probe;

use animacraft_v8_core::package_binding_v8 as binding;
use animacraft_v8_core::protocol_config_v8 as protocol;
use animacraft_v8_seal::seal_v8::{Self as seal, SealOriginalMarkerV8, SealCallableMarkerV8};
use std::type_name;

#[test, expected_failure(abort_code = 8, location = animacraft_v8_core::package_binding_v8)]
fun setup_cap_cannot_cross_catalogs() {
    install_policy(true);
}

#[test]
fun setup_cap_installs_its_own_catalog() {
    install_policy(false);
}

#[test_only]
fun install_policy(cross_catalog: bool) {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 1, 0, 0, 0);
    let (config, protocol_cap) =
        protocol::new_protocol_for_testing<sui::sui::SUI>(true, &mut ctx);
    let mut catalog_a = binding::product_release_catalog_for_testing(
        &config,
        protocol::config_core_original_package_id_v8(&config).to_address(),
        protocol::config_core_callable_package_id_v8(&config).to_address(),
        type_name::original_id<SealOriginalMarkerV8>(),
        type_name::defining_id<SealCallableMarkerV8>(), &mut ctx,
    );
    let mut catalog_b = binding::product_release_catalog_for_testing(
        &config,
        protocol::config_core_original_package_id_v8(&config).to_address(),
        protocol::config_core_callable_package_id_v8(&config).to_address(),
        type_name::original_id<SealOriginalMarkerV8>(),
        type_name::defining_id<SealCallableMarkerV8>(), &mut ctx,
    );
    let seal_cap = binding::take_seal_call_cap_v8(
        &config, &protocol_cap, &mut catalog_a,
    );
    // Advance both through the real public setup step. The negative case must
    // reach the catalog/cap mismatch, not fail on the earlier setup-order guard.
    let target_cap = binding::take_seal_call_cap_v8(
        &config, &protocol_cap, &mut catalog_b,
    );
    binding::destroy_call_cap_for_testing(target_cap);
    let target = if (cross_catalog) &mut catalog_b else &mut catalog_a;
    let policy = seal::new_seal_policy_config_v8(
        &config, &protocol_cap, target, seal_cap,
        vector[object::id_from_address(@0x200)], vector[1], 1,
        b"BonehFranklinBLS12381DemCCA/AesGcm256".to_string(),
        b"SHA3-256:SUI-SEAL-IBE-BLS12381-H2-00:SUI-SEAL-IBE-BLS12381-H3-00".to_string(),
        b"Seal/EncryptedObject/BCS/v0".to_string(), 3 * 1024 * 1024, &mut ctx,
    );
    assert!(seal::policy_catalog_id_v8(&policy) == binding::catalog_id_v8(target));
    seal::destroy_policy_for_testing(policy);
    binding::destroy_catalog_for_testing(catalog_a);
    binding::destroy_catalog_for_testing(catalog_b);
    protocol::destroy_protocol_for_testing(config, protocol_cap);
}
