module physical_adversarial_abilities::attack;

use animacraft_v8_core::activation_v8::PhysicalReadinessV8;

// Must fail: activation readiness is a transaction-local, one-use value.
public struct StoredReadiness has key {
    id: UID,
    readiness: PhysicalReadinessV8,
}
