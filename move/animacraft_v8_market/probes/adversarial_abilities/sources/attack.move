module market_adversarial_abilities::attack;

use animacraft_v8_core::activation_v8::MarketReadinessV8;

// Must fail independently: activation readiness is transaction-local and
// cannot be written into persistent dynamic-field storage.
public fun store_readiness(parent: &mut UID, readiness: MarketReadinessV8) {
    sui::dynamic_field::add(parent, b"market-readiness", readiness)
}
