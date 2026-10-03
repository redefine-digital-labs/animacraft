module physical_adversarial_abilities::attack;

use animacraft_v8_release::release_v8::ReleaseActivationWitnessV2;

// V2 replaces per-package readiness tokens with live certificate checks and
// Release's private activation witness. This actual activation authority cannot
// be persisted for stale replay (it has drop, but no store or copy).
public struct StoredReadiness has key {
    id: UID,
    readiness: ReleaseActivationWitnessV2,
}
