module market_companion_probe::probe;

use animacraft_v8_core::activation_v8::MarketReadinessV8;
use animacraft_v8_core::maker_v8::{MakerAdminCapV8, MakerRootV8};
use animacraft_v8_core::protocol_config_v8::{
    ProtocolConfigV8,
    ProtocolTreasuryV8,
};
use animacraft_v8_core::treasury_v8::MakerTreasuryV8;
use animacraft_v8_core::package_binding_v8::{
    MarketRoleV8,
    PackageCallCapV8,
    ProductReleaseCatalogV8,
};
use animacraft_v8_market::market_v8::{Self as market, MarketPackageConfigV8,
    MakerListingV8, MarketQuoteV8, MarketRegistryV8, MarketTreasuryV8,
    PhysicalListingV8, SoulListingV8};
use animacraft_v8_output::output_v8::{
    CanonicalSoulV8,
    CompleteOutputV8,
    CompleteReceiptV8,
    OutputRegistryV8,
    SoulRegistryV8,
};
use animacraft_v8_physical::physical_v8::{
    PhysicalAssetV8,
    PhysicalPackageConfigV8,
    PhysicalRegistryV8,
};
use animacraft_v8_runtime::runtime_v8::{PackReleaseV8, PackTreasuryV8};
use sui::coin::Coin;
use sui::transfer::Receiving;

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

public fun list_maker<PaymentCoin>(
    registry: &mut MarketRegistryV8<PaymentCoin>,
    treasury: &MarketTreasuryV8<PaymentCoin>,
    root: &MakerRootV8<PaymentCoin>,
    admin: MakerAdminCapV8,
    maker_treasury: &MakerTreasuryV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    config: &MarketPackageConfigV8,
    gross_atomic: u64,
    ctx: &mut TxContext,
): ID {
    market::list_maker_control_v8(
        registry, treasury, root, admin, maker_treasury, protocol_config,
        catalog, config, gross_atomic, ctx,
    )
}

public fun purchase_maker<PaymentCoin>(
    listing: &mut MakerListingV8<PaymentCoin>,
    registry: &mut MarketRegistryV8<PaymentCoin>,
    treasury: &mut MarketTreasuryV8<PaymentCoin>,
    root: &mut MakerRootV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    protocol_treasury: &mut ProtocolTreasuryV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
    config: &MarketPackageConfigV8,
    receiving: Receiving<MakerAdminCapV8>,
    payment: Coin<PaymentCoin>,
    ctx: &mut TxContext,
) {
    market::purchase_maker_control_v8(
        listing, registry, treasury, root, protocol_config,
        protocol_treasury, catalog, config, receiving, payment, ctx,
    )
}

public fun list_soul<PaymentCoin>(
    registry: &mut MarketRegistryV8<PaymentCoin>,
    treasury: &MarketTreasuryV8<PaymentCoin>,
    output_registry: &OutputRegistryV8,
    soul_registry: &SoulRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    config: &MarketPackageConfigV8,
    output: CompleteOutputV8,
    receipt: CompleteReceiptV8,
    soul: CanonicalSoulV8,
    gross_atomic: u64,
    ctx: &mut TxContext,
): ID {
    market::list_soul_bundle_v8(
        registry, treasury, output_registry, soul_registry, root,
        protocol_config, catalog, config, output, receipt, soul,
        gross_atomic, ctx,
    )
}

public fun purchase_soul<PaymentCoin>(
    listing: &mut SoulListingV8<PaymentCoin>,
    registry: &mut MarketRegistryV8<PaymentCoin>,
    treasury: &mut MarketTreasuryV8<PaymentCoin>,
    output_registry: &mut OutputRegistryV8,
    soul_registry: &mut SoulRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    maker_treasury: &mut MakerTreasuryV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    protocol_treasury: &mut ProtocolTreasuryV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
    config: &MarketPackageConfigV8,
    output_receiving: Receiving<CompleteOutputV8>,
    receipt_receiving: Receiving<CompleteReceiptV8>,
    soul_receiving: Receiving<CanonicalSoulV8>,
    payment: Coin<PaymentCoin>,
    ctx: &mut TxContext,
) {
    market::purchase_soul_bundle_v8(
        listing, registry, treasury, output_registry, soul_registry, root,
        maker_treasury, protocol_config, protocol_treasury, catalog, config,
        output_receiving, receipt_receiving, soul_receiving, payment, ctx,
    )
}

public fun cancel_soul<PaymentCoin>(
    listing: &mut SoulListingV8<PaymentCoin>,
    registry: &mut MarketRegistryV8<PaymentCoin>,
    treasury: &MarketTreasuryV8<PaymentCoin>,
    output_registry: &OutputRegistryV8,
    soul_registry: &SoulRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
    config: &MarketPackageConfigV8,
    output_receiving: Receiving<CompleteOutputV8>,
    receipt_receiving: Receiving<CompleteReceiptV8>,
    soul_receiving: Receiving<CanonicalSoulV8>,
    ctx: &mut TxContext,
) {
    market::cancel_soul_listing_v8(
        listing, registry, treasury, output_registry, soul_registry, root,
        catalog, config, output_receiving, receipt_receiving, soul_receiving,
        ctx,
    )
}

public fun recover_soul<PaymentCoin>(
    listing: &mut SoulListingV8<PaymentCoin>,
    registry: &mut MarketRegistryV8<PaymentCoin>,
    treasury: &MarketTreasuryV8<PaymentCoin>,
    output_registry: &OutputRegistryV8,
    soul_registry: &SoulRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    config: &MarketPackageConfigV8,
    output_receiving: Receiving<CompleteOutputV8>,
    receipt_receiving: Receiving<CompleteReceiptV8>,
    soul_receiving: Receiving<CanonicalSoulV8>,
) {
    market::recover_soul_listing_v8(
        listing, registry, treasury, output_registry, soul_registry, root,
        protocol_config, catalog, config, output_receiving, receipt_receiving,
        soul_receiving,
    )
}

public fun list_base_physical<PaymentCoin>(
    registry: &mut MarketRegistryV8<PaymentCoin>,
    treasury: &MarketTreasuryV8<PaymentCoin>,
    physical_registry: &PhysicalRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    maker_treasury: &MakerTreasuryV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    physical_config: &PhysicalPackageConfigV8,
    config: &MarketPackageConfigV8,
    asset: PhysicalAssetV8,
    gross_atomic: u64,
    ctx: &mut TxContext,
): ID {
    market::list_base_physical_v8(
        registry, treasury, physical_registry, root, maker_treasury,
        protocol_config, catalog, physical_config, config, asset,
        gross_atomic, ctx,
    )
}

public fun list_pack_physical<PaymentCoin>(
    registry: &mut MarketRegistryV8<PaymentCoin>,
    treasury: &MarketTreasuryV8<PaymentCoin>,
    physical_registry: &PhysicalRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    pack_treasury: &PackTreasuryV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    physical_config: &PhysicalPackageConfigV8,
    config: &MarketPackageConfigV8,
    asset: PhysicalAssetV8,
    gross_atomic: u64,
    ctx: &mut TxContext,
): ID {
    market::list_pack_physical_v8(
        registry, treasury, physical_registry, root, pack_treasury,
        protocol_config, catalog, physical_config, config, asset,
        gross_atomic, ctx,
    )
}

public fun purchase_base_physical<PaymentCoin>(
    listing: &mut PhysicalListingV8<PaymentCoin>,
    registry: &mut MarketRegistryV8<PaymentCoin>,
    treasury: &mut MarketTreasuryV8<PaymentCoin>,
    physical_registry: &PhysicalRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    maker_treasury: &mut MakerTreasuryV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    protocol_treasury: &mut ProtocolTreasuryV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
    physical_config: &PhysicalPackageConfigV8,
    config: &MarketPackageConfigV8,
    receiving: Receiving<PhysicalAssetV8>,
    payment: Coin<PaymentCoin>,
    ctx: &mut TxContext,
) {
    market::purchase_base_physical_v8(
        listing, registry, treasury, physical_registry, root, maker_treasury,
        protocol_config, protocol_treasury, catalog, physical_config, config,
        receiving, payment, ctx,
    )
}

public fun purchase_pack_physical<PaymentCoin>(
    listing: &mut PhysicalListingV8<PaymentCoin>,
    registry: &mut MarketRegistryV8<PaymentCoin>,
    treasury: &mut MarketTreasuryV8<PaymentCoin>,
    physical_registry: &PhysicalRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    pack_release: &PackReleaseV8<PaymentCoin>,
    pack_treasury: &mut PackTreasuryV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    protocol_treasury: &mut ProtocolTreasuryV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
    physical_config: &PhysicalPackageConfigV8,
    config: &MarketPackageConfigV8,
    receiving: Receiving<PhysicalAssetV8>,
    payment: Coin<PaymentCoin>,
    ctx: &mut TxContext,
) {
    market::purchase_pack_physical_v8(
        listing, registry, treasury, physical_registry, root, pack_release,
        pack_treasury, protocol_config, protocol_treasury, catalog,
        physical_config, config, receiving, payment, ctx,
    )
}

public fun cancel_physical<PaymentCoin>(
    listing: &mut PhysicalListingV8<PaymentCoin>,
    registry: &mut MarketRegistryV8<PaymentCoin>,
    treasury: &MarketTreasuryV8<PaymentCoin>,
    physical_registry: &PhysicalRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
    config: &MarketPackageConfigV8,
    receiving: Receiving<PhysicalAssetV8>,
    ctx: &TxContext,
) {
    market::cancel_physical_listing_v8(
        listing, registry, treasury, physical_registry, root, catalog,
        config, receiving, ctx,
    )
}

public fun recover_physical<PaymentCoin>(
    listing: &mut PhysicalListingV8<PaymentCoin>,
    registry: &mut MarketRegistryV8<PaymentCoin>,
    treasury: &MarketTreasuryV8<PaymentCoin>,
    physical_registry: &PhysicalRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    config: &MarketPackageConfigV8,
    receiving: Receiving<PhysicalAssetV8>,
) {
    market::recover_physical_listing_v8(
        listing, registry, treasury, physical_registry, root,
        protocol_config, catalog, config, receiving,
    )
}
