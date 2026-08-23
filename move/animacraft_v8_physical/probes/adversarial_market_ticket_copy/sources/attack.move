module physical_adversarial_market_ticket_copy::attack;

use animacraft_v8_physical::physical_v8::PhysicalMarketCustodyTicketV8;

// Must fail: a custody acknowledgement is one-use and cannot be copied.
public fun copy_ticket(
    ticket: PhysicalMarketCustodyTicketV8,
): (PhysicalMarketCustodyTicketV8, PhysicalMarketCustodyTicketV8) {
    (copy ticket, ticket)
}
