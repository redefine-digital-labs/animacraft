/// Existing authority cannot be forged through raw IDs, flags or private fields.
module animacraft_v8_core_adversarial_api::probe;

use animacraft_v8_core::maker_v8 as maker;
use animacraft_v8_core::companion_binding_v2 as companion;
use animacraft_v8_core::protocol_config_v8::ProtocolConfigV8;
use animacraft_v8_core::package_binding_v8::{
    ProductReleaseCatalogV8, FreshTupleReplacementBindingV2, PackageCallCapV8,
    SealRoleV8, RuntimeCallerCapV1,
};
use std::string::String;

public fun forge_setup_cap(): PackageCallCapV8<SealRoleV8> {
    PackageCallCapV8 {
        role: 1, schema_revision: 2, catalog_id: object::id_from_address(@0x1),
        package_tuple_commitment: vector[], call_cap_set_commitment: vector[],
        role_authority_id: object::id_from_address(@0x2), role_binding_commitment: vector[],
    }
}

public fun forge_output_caller(): RuntimeCallerCapV1 {
    RuntimeCallerCapV1 {
        schema_revision: 1, role: 0, catalog_id: object::id_from_address(@0x1),
        replacement_binding_id: object::id_from_address(@0x2),
        package_tuple_commitment: vector[], caller_original_package_id: object::id_from_address(@0x3),
        caller_callable_package_id: object::id_from_address(@0x4),
        call_cap_set_commitment: vector[], cap_commitment: vector[],
    }
}

public fun forge_wrapped_certification(): maker::WrappedRightsCertificationV8 {
    maker::WrappedRightsCertificationV8 {
        creator: @0xA11, catalog_id: object::id_from_address(@0xCA),
        product_binding_commitment: vector[],
        evidence_locator: b"https://license.example/forged".to_string(),
        evidence_blob_id: b"forged".to_string(), evidence_sha256: vector[], terms_commitment: vector[],
    }
}

public fun forge_rights(locator: String, blob_id: String, evidence_sha256: vector<u8>, terms_commitment: vector<u8>) {
    maker::new_rights_snapshot_internal_v8(
        1, @0xA11, // Current RIGHTS_LICENSE_WRAPPED; private constructor remains forbidden.
        option::some(object::id_from_address(@0xCA)), option::some(vector[]),
        locator, blob_id, evidence_sha256, terms_commitment, 250, 250, 500,
    );
}

public fun substitute_runtime_tuple(
    protocol_config: &ProtocolConfigV8, catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    root_id: ID, root_version: u64, root_content_commitment: vector<u8>,
    admin_id: ID, base_registry_id: ID, base_definition_commitment: vector<u8>,
    treasury_id: ID, ctx: &TxContext,
): companion::MakerRuntimeCompanionBindingBuilderV2<sui::sui::SUI> {
    companion::new_builder_v2(
        protocol_config, catalog, replacement, root_id, root_version, 0,
        root_content_commitment, admin_id, base_registry_id,
        base_definition_commitment, treasury_id, ctx,
    )
}
