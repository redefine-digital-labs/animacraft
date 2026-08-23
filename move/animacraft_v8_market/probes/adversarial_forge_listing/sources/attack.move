module market_adversarial_forge_listing::attack;

use animacraft_v8_market::market_v8::SoulListingV8;
use animacraft_v8_output::output_v8::SoulMarketCustodyBindingV8;

// Must fail independently: private fields prevent external listing forgery,
// even when an attacker already has non-authoritative copyable binding data.
public fun forge<PaymentCoin>(
    id: UID,
    custody: SoulMarketCustodyBindingV8,
): SoulListingV8<PaymentCoin> {
    SoulListingV8<PaymentCoin> {
        id,
        version: 8,
        registry_id: @0x1.to_id(),
        treasury_id: @0x2.to_id(),
        package_config_id: @0x3.to_id(),
        custody,
        gross_atomic: 1,
        protocol_atomic: 0,
        creator_atomic: 0,
        source_atomic: 0,
        seller_atomic: 1,
        quote_commitment: vector[],
        status: 0,
        revision: 0,
        terminal_recipient: @0x0,
    }
}
