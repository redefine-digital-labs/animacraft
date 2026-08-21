module output_adversarial_market_ticket_forge::attack;

use animacraft_v8_output::output_v8::{SoulMarketCustodyBindingV8,
    SoulMarketCustodyTicketV8};

// Must fail: pure IDs, hashes, addresses, and booleans cannot manufacture
// either the persisted data binding or its no-ability custody ticket.
public fun forge_ticket(
    listing_id: ID,
    registry_id: ID,
    treasury_id: ID,
    seller: address,
    commitment: vector<u8>,
): SoulMarketCustodyTicketV8 {
    let binding = SoulMarketCustodyBindingV8 {
        listing_id,
        output_registry_id: registry_id,
        soul_registry_id: registry_id,
        market_registry_id: registry_id,
        market_treasury_id: treasury_id,
        root_id: registry_id,
        maker_version: 8,
        root_content_commitment: commitment,
        output_id: registry_id,
        receipt_id: registry_id,
        soul_id: registry_id,
        output_commitment: commitment,
        receipt_commitment: commitment,
        soul_commitment: commitment,
        seller,
        expected_soul_ownership_epoch: 0,
    };
    SoulMarketCustodyTicketV8 { binding }
}
