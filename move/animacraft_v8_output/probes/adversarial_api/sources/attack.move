module output_adversarial_api::attack;

use animacraft_v8_core::package_binding_v8::{OutputRoleV8, PackageCallCapV8};
use animacraft_v8_output::output_v8::{OutputPackageConfigV8,
    PhysicalMaterializationWitnessV8};

// Must fail: the Core Output call cap remains private inside Output config.
public fun extract_output_cap(
    config: &OutputPackageConfigV8,
): &PackageCallCapV8<OutputRoleV8> {
    &config.output_call_cap
}

// Must fail: pure identities and hashes cannot forge Physical authority.
public fun forge_physical(
    registry_id: ID,
    root_id: ID,
    holder: address,
    output_id: ID,
    receipt_id: ID,
    soul_id: ID,
): PhysicalMaterializationWitnessV8 {
    PhysicalMaterializationWitnessV8 {
        output_registry_id: registry_id, root_id, maker_version: 8,
        root_content_commitment: vector[], holder,
        output_key: b"png".to_string(), output_policy_commitment: vector[],
        output_id, receipt_id, soul_id, soul_ownership_epoch: 0,
        recipe_commitment: vector[], render_commitment: vector[],
        output_commitment: vector[], receipt_commitment: vector[],
        soul_commitment: vector[], loadout_id: root_id, loadout_revision: 0,
        loadout_commitment: vector[], selection_index: 0,
        selection_commitment: vector[],
        part_key: b"part".to_string(), item_key: b"item".to_string(),
        style_key: b"style".to_string(), layer_track_key: b"track".to_string(),
        source_class: 0,
        source_definition_id: root_id, source_semantic_id: b"".to_string(),
        source_content_commitment: vector[], source_epoch: 0,
        pricing_commitment: vector[], asset_content_commitment: vector[],
        materialization_key: b"fake".to_string(), witness_commitment: vector[],
    }
}
