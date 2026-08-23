module market_adversarial_listing_copy::attack;

use animacraft_v8_market::market_v8::SoulListingV8;

fun requires_copy<T: copy>(_: &T) {}

// Must fail independently: a listing cannot be duplicated into a second
// replayable custody/status authority.
public fun copy_listing<PaymentCoin>(listing: &SoulListingV8<PaymentCoin>) {
    requires_copy(listing)
}
