module market_adversarial_abilities::attack;

use animacraft_v8_release::release_v8::ReleaseActivationWitnessV2;

// V2 activation checks live certificates and Release's private witness.
// Must fail independently: activation authority is transaction-local and
// cannot be written into persistent dynamic-field storage.
public fun store_readiness(parent: &mut UID, readiness: ReleaseActivationWitnessV2) {
    sui::dynamic_field::add(parent, b"market-readiness", readiness)
}
