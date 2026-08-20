module release_adversarial_api::attack;

use animacraft_v8_core::package_binding_v8::{PackageCallCapV8, ReleaseRoleV8};
use animacraft_v8_release::release_v8::{
    ReleasePackageConfigV8,
    ReleaseRenderWitnessV8,
};

// Must fail: no external package can borrow Release's private call cap.
public fun extract_release_cap(
    config: &ReleasePackageConfigV8,
): &PackageCallCapV8<ReleaseRoleV8> {
    &config.release_call_cap
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
