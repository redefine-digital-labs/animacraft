module physical_adversarial_market_ticket_forge::attack;

use animacraft_v8_physical::physical_v8::{
    PhysicalMarketCustodyBindingV8,
    PhysicalMarketCustodyTicketV8,
};

// Must fail: only Physical can construct the no-ability acknowledgement.
public fun forge_ticket(
    binding: PhysicalMarketCustodyBindingV8,
): PhysicalMarketCustodyTicketV8 {
    PhysicalMarketCustodyTicketV8 { binding }
}
