/// External runtime attacks against the production wrapped-rights boundary.
module animacraft_v8_core_adversarial_runtime::probe;

use animacraft_v8_core::maker_v8 as maker;
use animacraft_v8_core::package_binding_v8 as binding;
use animacraft_v8_core::protocol_config_v8 as protocol;

public struct FakeReleaseAuthorityV8 has key { id: UID }

#[test, expected_failure(abort_code = 7)]
fun author_authority_cannot_certify_wrapped_rights() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 1, 0, 0, 0);
    let (config, protocol_cap) =
        protocol::new_protocol_for_testing<sui::sui::SUI>(true, &mut ctx);
    let catalog = binding::authority_catalog_for_testing(&config, &mut ctx);
    let fake = FakeReleaseAuthorityV8 { id: object::new(&mut ctx) };
    let certification = maker::certify_wrapped_rights_v8(
        &config,
        &catalog,
        &fake,
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
    let FakeReleaseAuthorityV8 { id } = fake;
    id.delete();
    binding::destroy_catalog_for_testing(catalog);
    protocol::destroy_protocol_for_testing(config, protocol_cap);
}
