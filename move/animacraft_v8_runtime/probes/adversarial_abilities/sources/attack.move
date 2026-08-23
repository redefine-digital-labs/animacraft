module runtime_adversarial_abilities::attack;

use animacraft_v8_runtime::runtime_v8::{PackCompleteLineV8,
    RuntimeBaseEntitlementWitnessV8, RuntimeLoadoutAuthorizationV8,
    RuntimePackEntitlementWitnessV8, RuntimePhysicalSelectionWitnessV8,
    SelectionAccessProofV8};

// Must fail: Runtime authorization has no store ability.
public struct StoredAuthorization has key {
    id: UID,
    authorization: RuntimeLoadoutAuthorizationV8,
}

public struct StoredSelectionProof has key {
    id: UID,
    proof: SelectionAccessProofV8,
}

public struct StoredCompleteLine has key {
    id: UID,
    line: PackCompleteLineV8,
}

public struct StoredBaseEntitlement has key {
    id: UID,
    witness: RuntimeBaseEntitlementWitnessV8,
}

public struct StoredPackEntitlement has key {
    id: UID,
    witness: RuntimePackEntitlementWitnessV8,
}


public struct StoredPhysicalSelection has key {
    id: UID,
    witness: RuntimePhysicalSelectionWitnessV8,
}
