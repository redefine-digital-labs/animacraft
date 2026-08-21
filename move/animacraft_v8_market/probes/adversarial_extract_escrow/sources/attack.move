module market_adversarial_extract_escrow::attack;

use animacraft_v8_market::market_v8::MarketTreasuryV8;
use sui::balance::Balance;

// Must fail independently: no external package may borrow the escrow Balance
// and bypass exact in-transaction settlement accounting.
public fun extract<PaymentCoin>(
    treasury: &mut MarketTreasuryV8<PaymentCoin>,
): &mut Balance<PaymentCoin> {
    &mut treasury.escrow
}
