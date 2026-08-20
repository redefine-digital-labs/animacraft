module market_adversarial_mutate_registry::attack;

use animacraft_v8_market::market_v8::MarketRegistryV8;

// Must fail independently: another package cannot advance Market state.
public fun mutate_registry<PaymentCoin>(registry: &mut MarketRegistryV8<PaymentCoin>) {
    registry.listing_count = 1;
}
