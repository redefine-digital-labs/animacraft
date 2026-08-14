module output_adversarial_abilities::attack;

use animacraft_v8_output::output_v8::{CanonicalSoulV8, CompleteOutputV8,
    CompleteReceiptV8, CompleteSessionV8, PhysicalMaterializationWitnessV8,
    ProtectedCompletePendingV8, SoulMintAuthorizationV8};

public struct StoredSession has key { id: UID, value: CompleteSessionV8 }
public struct StoredPending has key { id: UID, value: ProtectedCompletePendingV8 }
public struct StoredSoulAuth has key { id: UID, value: SoulMintAuthorizationV8 }
public struct StoredPhysical has key { id: UID, value: PhysicalMaterializationWitnessV8 }

public fun generic_transfer_output(value: CompleteOutputV8, recipient: address) {
    transfer::public_transfer(value, recipient)
}
public fun generic_transfer_receipt(value: CompleteReceiptV8, recipient: address) {
    transfer::public_transfer(value, recipient)
}
public fun generic_transfer_soul(value: CanonicalSoulV8, recipient: address) {
    transfer::public_transfer(value, recipient)
}
