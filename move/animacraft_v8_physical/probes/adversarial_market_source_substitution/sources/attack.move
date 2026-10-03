module physical_adversarial_market_source_substitution::attack;

use animacraft_v8_core::maker_v8::MakerRootV8;
use animacraft_v8_core::package_binding_v8::{
    FreshTupleReplacementBindingV2,
    ProductReleaseCatalogV8,
};
use animacraft_v8_core::protocol_config_v8::ProtocolConfigV8;
use animacraft_v8_core::package_binding_v8::RuntimeCallerCapV1;
use animacraft_v8_physical::physical_v8::{
    Self as physical,
    PhysicalAssetV8,
    PhysicalMarketCustodyTicketV8,
    PhysicalPackageConfigV8,
    PhysicalRegistryV8,
};
use animacraft_v8_runtime::runtime_v8::PackTreasuryV8;

public struct MarketRegistry has key { id: UID }
public struct MarketTreasury has key { id: UID }
public struct Listing has key { id: UID }

// Must fail by type: a PackTreasury cannot be substituted into the Base hook,
// whose source treasury is statically MakerTreasuryV8.
public fun substitute_pack_treasury_into_base<PaymentCoin>(
    registry: &PhysicalRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    config: &PhysicalPackageConfigV8,
    market_cap: &RuntimeCallerCapV1,
    market_registry: &MarketRegistry,
    market_treasury: &MarketTreasury,
    listing: &mut Listing,
    pack_treasury: &PackTreasuryV8<PaymentCoin>,
    asset: PhysicalAssetV8,
    ctx: &TxContext,
): PhysicalMarketCustodyTicketV8 {
    physical::custody_base_physical_for_market_v8<
        PaymentCoin,
        MarketRegistry,
        MarketTreasury,
    >(
        registry,
        root,
        protocol_config,
        catalog,
        replacement,
        config,
        market_cap,
        market_registry,
        market_treasury,
        &mut listing.id,
        pack_treasury,
        asset,
        ctx,
    )
}
