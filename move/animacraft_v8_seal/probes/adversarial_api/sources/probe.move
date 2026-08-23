/// Must not compile: external packages cannot construct proofs, transport
/// certifications, or the private readiness witness from caller-supplied data.
module animacraft_v8_seal_adversarial_api::probe;

use animacraft_v8_seal::seal_v8::{
    BaseDecryptProofV8,
    CiphertextCertificationV8,
    PrivateSealReadinessWitnessV8,
    SealReadinessV8,
};

public fun forge_base(): BaseDecryptProofV8 {
    BaseDecryptProofV8 {
        root_id: object::id_from_address(@0x1), maker_version: 1,
        root_content_commitment: vector[], holder: @0xA11,
        entitlement_id: object::id_from_address(@0x2),
        entitlement_commitment: vector[], scope_key: b"base".to_string(),
        asset_key: b"asset".to_string(), seal_id: vector[],
    }
}

public fun forge_ciphertext(): CiphertextCertificationV8 {
    CiphertextCertificationV8 {
        catalog_id: object::id_from_address(@0x1),
        product_binding_commitment: vector[],
        policy_config_id: object::id_from_address(@0x2),
        policy_commitment: vector[], root_id: object::id_from_address(@0x3),
        maker_version: 1, root_content_commitment: vector[], scope_kind: 0,
        scope_key: b"base".to_string(), scope_commitment: vector[],
        asset_key: b"asset".to_string(), asset_content_commitment: vector[],
        ciphertext_blob_id: b"blob".to_string(), ciphertext_sha256: vector[],
        ciphertext_blob_commitment: vector[], certification_commitment: vector[],
        seal_id: vector[],
    }
}

public fun forge_private_readiness(): PrivateSealReadinessWitnessV8 {
    PrivateSealReadinessWitnessV8 {
        registry_id: object::id_from_address(@0x1),
        policy_config_id: object::id_from_address(@0x2), key_server_ids: vector[],
        key_server_set_commitment: vector[], encryption_policy_commitment: vector[],
        root_id: object::id_from_address(@0x3), maker_version: 1,
        root_content_commitment: vector[], catalog_id: object::id_from_address(@0x4),
        product_binding_commitment: vector[], registry_commitment: vector[],
        base_count: 0, pack_count: 0, complete_count: 0, total_count: 0,
    }
}

public fun forge_readiness(): SealReadinessV8 {
    SealReadinessV8 {
        registry_id: object::id_from_address(@0x1),
        policy_config_id: object::id_from_address(@0x2), key_server_ids: vector[],
        key_server_set_commitment: vector[], encryption_policy_commitment: vector[],
        root_id: object::id_from_address(@0x3), maker_version: 1,
        root_content_commitment: vector[], catalog_id: object::id_from_address(@0x4),
        product_binding_commitment: vector[], registry_commitment: vector[],
        base_count: 0, pack_count: 0, complete_count: 0, total_count: 0,
    }
}
