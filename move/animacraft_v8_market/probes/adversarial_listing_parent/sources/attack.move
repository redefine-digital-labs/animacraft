module market_adversarial_listing_parent::attack;

use animacraft_v8_market::market_v8::PhysicalListingV8;

// Must fail independently: an external module cannot borrow the private UID
// and invoke asset-defining receive hooks with a selected parent.
public fun borrow_parent<PaymentCoin>(
    listing: &mut PhysicalListingV8<PaymentCoin>,
): &mut UID {
    &mut listing.id
}
