module physical_adversarial_market_ticket_drop::attack;

use animacraft_v8_physical::physical_v8::PhysicalMarketCustodyTicketV8;

// Must fail: Market cannot ignore a ticket instead of consuming its readback.
public fun drop_ticket(ticket: PhysicalMarketCustodyTicketV8) {}
