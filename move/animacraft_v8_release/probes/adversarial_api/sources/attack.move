module release_adversarial_api::attack;

use animacraft_v8_release::release_v8::{
    ReleasePackageConfigV8,
    ReleaseRenderWitnessV8,
    ReleaseTransportWitnessV8,
};

// Setup consumes Release's cap. External packages still cannot access the
// config's private installation state to impersonate its authority.
public fun extract_release_cap(
    config: &ReleasePackageConfigV8,
): &vector<u8> {
    &config.installation_commitment
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
