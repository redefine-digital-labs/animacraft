/// External runtime attacks against the production wrapped-rights boundary.
module animacraft_v8_core_adversarial_runtime::probe;

use animacraft_v8_core::maker_v8 as maker;
use animacraft_v8_core::package_binding_v8 as binding;
use animacraft_v8_core::protocol_config_v8 as protocol;

#[test, expected_failure(abort_code = 9)]
fun release_call_cap_cannot_cross_catalogs() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 1, 0, 0, 0);
    let (config, protocol_cap) =
        protocol::new_protocol_for_testing<sui::sui::SUI>(true, &mut ctx);
    let mut catalog_a = binding::product_release_catalog_for_testing(
        &config,
        @0x10,
        @0x20,
        &mut ctx,
    );
    let catalog_b = binding::product_release_catalog_for_testing(
        &config,
        @0x10,
        @0x20,
        &mut ctx,
    );
    let release_cap = binding::take_release_call_cap_v8(
        &config,
        &protocol_cap,
        &mut catalog_a,
    );
    let certification = maker::certify_wrapped_rights_v8(
        &config,
        &catalog_b,
        &release_cap,
        b"https://license.example/forged".to_string(),
        b"forged-blob".to_string(),
        vector[1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
               1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
        vector[2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
               2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
        &ctx,
    );
    let rights = maker::new_license_wrapped_rights_snapshot_v8(
        certification,
        250,
        250,
        500,
    );
    let _ = rights;
    binding::destroy_call_cap_for_testing(release_cap);
    binding::destroy_catalog_for_testing(catalog_a);
    binding::destroy_catalog_for_testing(catalog_b);
    protocol::destroy_protocol_for_testing(config, protocol_cap);
}
