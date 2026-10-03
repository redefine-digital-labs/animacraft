module output_adversarial_market_ticket_replay::attack;

use animacraft_v8_core::maker_v8::MakerRootV8;
use animacraft_v8_core::protocol_config_v8::ProtocolConfigV8;
use animacraft_v8_core::package_binding_v8::{ProductReleaseCatalogV8, FreshTupleReplacementBindingV2, RuntimeCallerCapV1};
use animacraft_v8_output::output_v8::{Self as output, OutputRegistryV8,
    SoulMarketCustodyTicketV8, SoulRegistryV8};

public struct MarketRegistry has key { id: UID }
public struct MarketTreasury has key { id: UID }

// Must fail statically: a no-copy ticket cannot be consumed twice, even in
// one PTB with every other exact typed argument present.
public fun replay_ticket<PaymentCoin>(
    ticket: SoulMarketCustodyTicketV8,
    listing: &UID,
    output_registry: &OutputRegistryV8,
    soul_registry: &SoulRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    market_registry: &MarketRegistry,
    market_treasury: &MarketTreasury,
    cap: &RuntimeCallerCapV1,
) {
    let _first = output::consume_soul_market_custody_ticket_v8<
        PaymentCoin,
        MarketRegistry,
        MarketTreasury,
    >(ticket, listing, output_registry, soul_registry, root, protocol_config, catalog, replacement,
        market_registry, market_treasury, cap);
    let _second = output::consume_soul_market_custody_ticket_v8<
        PaymentCoin,
        MarketRegistry,
        MarketTreasury,
    >(ticket, listing, output_registry, soul_registry, root, protocol_config, catalog, replacement,
        market_registry, market_treasury, cap);
}
