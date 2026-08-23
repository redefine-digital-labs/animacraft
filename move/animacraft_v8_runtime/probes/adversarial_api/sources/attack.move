module runtime_adversarial_api::attack;

use animacraft_v8_runtime::runtime_v8::{RuntimeActivationReadinessReceiptV8,
    RuntimePhysicalSelectionWitnessV8};

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


// Must fail: identities and hashes cannot forge the one-use current-selection witness.
public fun forge_physical_selection(
    loadout_id: ID,
    root_id: ID,
    root_content_commitment: vector<u8>,
    holder: address,
    loadout_commitment: vector<u8>,
    selection_commitment: vector<u8>,
): RuntimePhysicalSelectionWitnessV8 {
    RuntimePhysicalSelectionWitnessV8 {
        loadout_id,
        root_id,
        root_version: 1,
        root_content_commitment,
        holder,
        loadout_revision: 0,
        loadout_commitment,
        selection_index: 0,
        selection_commitment,
        part_key: b"part".to_string(),
        item_key: b"item".to_string(),
        style_key: b"style".to_string(),
        layer_track_key: b"track".to_string(),
        source_class: 0,
        source_definition_id: root_id,
        source_semantic_id: b"".to_string(),
        source_content_commitment: vector[],
        source_epoch: 0,
        pricing_commitment: vector[],
        asset_content_commitment: vector[],
    }
}
