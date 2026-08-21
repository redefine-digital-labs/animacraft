module physical_adversarial_market_ticket_store::attack;

use animacraft_v8_physical::physical_v8::PhysicalMarketCustodyTicketV8;

// Must fail: the ephemeral ticket cannot cross a transaction in storage.
public struct StoredTicket has key {
    id: UID,
    ticket: PhysicalMarketCustodyTicketV8,
}
