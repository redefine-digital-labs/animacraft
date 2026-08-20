module market_companion_probe::probe;

use animacraft_v8_core::activation_v8::MarketReadinessV8;
use animacraft_v8_core::maker_v8::{MakerAdminCapV8, MakerRootV8};
use animacraft_v8_core::package_binding_v8::{
    MarketRoleV8,
    PackageCallCapV8,
    ProductReleaseCatalogV8,
};
use animacraft_v8_market::market_v8::{Self as market, MarketPackageConfigV8,
    MarketQuoteV8, MarketRegistryV8, MarketTreasuryV8};

public fun new_config(
    catalog: &ProductReleaseCatalogV8,
    cap: PackageCallCapV8<MarketRoleV8>,
    ctx: &mut TxContext,
): MarketPackageConfigV8 {
    market::new_market_package_config_v8(catalog, cap, ctx)
}

public fun new_and_seal<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    catalog: &ProductReleaseCatalogV8,
    config: &MarketPackageConfigV8,
    ctx: &mut TxContext,
): (MarketRegistryV8<PaymentCoin>, MarketTreasuryV8<PaymentCoin>) {
    let (mut registry, treasury) = market::new_market_objects_v8(
        root, admin, catalog, config, ctx,
    );
    market::seal_market_registry_v8(
        &mut registry, &treasury, root, admin, catalog, config,
    );
    (registry, treasury)
}

public fun certify<PaymentCoin>(
    registry: &MarketRegistryV8<PaymentCoin>,
    treasury: &MarketTreasuryV8<PaymentCoin>,
    root: &MakerRootV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
    config: &MarketPackageConfigV8,
): MarketReadinessV8 {
    market::certify_market_activation_readiness_v8(
        registry, treasury, root, catalog, config,
    )
}

public fun read_quote(quote: &MarketQuoteV8): (u8, u64, u64, u64, u64, u64) {
    (
        market::quote_kind_v8(quote),
        market::quote_gross_atomic_v8(quote),
        market::quote_protocol_atomic_v8(quote),
        market::quote_creator_atomic_v8(quote),
        market::quote_source_atomic_v8(quote),
        market::quote_seller_atomic_v8(quote),
    )
}
