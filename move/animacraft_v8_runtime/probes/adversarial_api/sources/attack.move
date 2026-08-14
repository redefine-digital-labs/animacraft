module runtime_adversarial_api::attack;

use animacraft_v8_runtime::runtime_v8::RuntimeActivationReadinessReceiptV8;

// Must fail: fields are private to the exact Runtime module.
public fun forge(
    root_id: ID,
    root_version: u64,
    root_content_commitment: vector<u8>,
    definition_registry_id: ID,
    pack_registry_id: ID,
    admission_authority_id: ID,
    policy_commitment: vector<u8>,
    companion_commitment: vector<u8>,
): RuntimeActivationReadinessReceiptV8 {
    RuntimeActivationReadinessReceiptV8 {
        root_id,
        root_version,
        root_content_commitment,
        definition_registry_id,
        pack_registry_id,
        admission_authority_id,
        policy_commitment,
        companion_commitment,
    }
}
