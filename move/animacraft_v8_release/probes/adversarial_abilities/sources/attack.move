module release_adversarial_abilities::attack;

use animacraft_v8_release::release_v8::{
    ReleasePackageConfigV8,
    ReleaseRenderWitnessV8,
    ReleaseTransportWitnessV8,
};

// Must fail: Release's one-call render witness has no abilities.
#[allow(unused_field)]
public struct StoredWitness has key {
    id: UID,
    value: ReleaseRenderWitnessV8,
}

public fun copy_witness(witness: &ReleaseRenderWitnessV8): ReleaseRenderWitnessV8 {
    *witness
}

#[allow(unused_field)]
public struct StoredTransportWitness has key {
    id: UID,
    value: ReleaseTransportWitnessV8,
}

public fun copy_transport_witness(
    witness: &ReleaseTransportWitnessV8,
): ReleaseTransportWitnessV8 {
    *witness
}

// Must fail: the capability-bearing config is not publicly transferable.
public fun transfer_config(config: ReleasePackageConfigV8, recipient: address) {
    transfer::public_transfer(config, recipient)
}
