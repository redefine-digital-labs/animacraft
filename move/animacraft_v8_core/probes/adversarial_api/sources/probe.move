/// This package must not compile. The former author-controlled rights flags
/// and witness-plus-free-Runtime-tuple paths are intentionally absent.
module animacraft_v8_core_adversarial_api::probe;

use animacraft_v8_core::activation_v8::{
    OutputRuntimeRequestV8,
    SealReadinessV8,
};

use animacraft_v8_core::maker_v8 as maker;
use animacraft_v8_core::package_binding_v8::{Self as binding, ProductReleaseCatalogV8};
use std::string::String;

public struct FakeRuntimeWitnessV8 {}

public fun forge_seal_readiness(): SealReadinessV8 {
    SealReadinessV8 {
        root_id: object::id_from_address(@0x1),
        catalog_id: object::id_from_address(@0x2),
        call_cap_set_commitment: vector[],
        registry_id: object::id_from_address(@0x3),
        companion_commitment: vector[],
        commitment: vector[],
    }
}

public fun forge_output_request(): OutputRuntimeRequestV8 {
    OutputRuntimeRequestV8 {
        request_id: object::id_from_address(@0x1),
        root_id: object::id_from_address(@0x2),
        catalog_id: object::id_from_address(@0x3),
        call_cap_set_commitment: vector[],
        output_registry_id: object::id_from_address(@0x4),
        requester: @0xA11,
        commitment: vector[],
    }
}

public fun forge_wrapped_certification(): maker::WrappedRightsCertificationV8 {
    maker::WrappedRightsCertificationV8 {
        creator: @0xA11,
        catalog_id: object::id_from_address(@0xCA),
        product_binding_commitment: vector[],
        evidence_locator: b"https://license.example/forged".to_string(),
        evidence_blob_id: b"forged".to_string(),
        evidence_sha256: vector[],
        terms_commitment: vector[],
    }
}

public fun forge_rights(
    locator: String,
    blob_id: String,
    evidence_sha256: vector<u8>,
    terms_commitment: vector<u8>,
) {
    maker::new_rights_snapshot_v8(
        maker::rights_license_wrapped_v8(),
        true,
        true,
        locator,
        blob_id,
        evidence_sha256,
        terms_commitment,
        250,
        250,
        500,
    );
}

public fun substitute_runtime_tuple(
    catalog: &ProductReleaseCatalogV8,
    witness: FakeRuntimeWitnessV8,
    root_id: ID,
    root_version: u64,
    root_content_commitment: vector<u8>,
    pack_registry_id: ID,
    admission_authority_id: ID,
    policy_commitment: vector<u8>,
) {
    binding::certify_runtime_pack_readiness_v8(
        catalog,
        witness,
        root_id,
        root_version,
        root_content_commitment,
        pack_registry_id,
        admission_authority_id,
        policy_commitment,
    );
}
