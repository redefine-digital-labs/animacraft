module release_adversarial_api::attack;

use animacraft_v8_core::package_binding_v8::{PackageCallCapV8, ReleaseRoleV8};
use animacraft_v8_release::release_v8::{
    ReleasePackageConfigV8,
    ReleaseRenderWitnessV8,
    ReleaseTransportWitnessV8,
};

// Must fail: no external package can borrow Release's private call cap.
public fun extract_release_cap(
    config: &ReleasePackageConfigV8,
): &PackageCallCapV8<ReleaseRoleV8> {
    &config.release_call_cap
}

// Must fail independently: ciphertext transport authority is also
// private-constructor and cannot be rebuilt from a pure identity tuple.
public fun forge_transport_witness(
    root_id: ID,
    catalog_id: ID,
    policy_config_id: ID,
    caller: address,
): ReleaseTransportWitnessV8 {
    ReleaseTransportWitnessV8 {
        root_id,
        catalog_id,
        policy_config_id,
        caller,
    }
}

// Must fail: pure caller-supplied identities cannot construct render authority.
public fun forge_render_witness(
    root_id: ID,
    catalog_id: ID,
    output_registry_id: ID,
    control_epoch: u64,
    caller: address,
): ReleaseRenderWitnessV8 {
    ReleaseRenderWitnessV8 {
        root_id,
        catalog_id,
        output_registry_id,
        control_epoch,
        caller,
    }
}
