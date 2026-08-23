module output_adversarial_market_ticket_abilities::attack;

use animacraft_v8_output::output_v8::SoulMarketCustodyTicketV8;

// Must fail: the same-PTB ticket cannot be stored in any object.
public struct StoredTicket has key {
    id: UID,
    ticket: SoulMarketCustodyTicketV8,
}

public fun stored_ticket(value: &StoredTicket): &SoulMarketCustodyTicketV8 {
    &value.ticket
}

// Must fail: it cannot be copied or returned twice.
public fun copy_ticket(
    ticket: SoulMarketCustodyTicketV8,
): (SoulMarketCustodyTicketV8, SoulMarketCustodyTicketV8) {
    let duplicate = copy ticket;
    (ticket, duplicate)
}

// Must fail: every path must consume it through Output's exact Market gate.
public fun drop_ticket(ticket: SoulMarketCustodyTicketV8) {
    let _ = ticket;
}
