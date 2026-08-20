module physical_adversarial_witness_abilities::attack;

use animacraft_v8_runtime::runtime_v8::{
    RuntimePhysicalPackAccessWitnessV8,
    RuntimePhysicalPackPolicyWitnessV8,
};

// Must fail: both Runtime-to-Physical witnesses are transaction-local and
// cannot be persisted for stale replay or converted into ID-only authority.
public struct StoredPackPolicyWitness has key {
    id: UID,
    witness: RuntimePhysicalPackPolicyWitnessV8,
}

public struct StoredPackAccessWitness has key {
    id: UID,
    witness: RuntimePhysicalPackAccessWitnessV8,
}
