module market_companion_probe::probe;

// Positive external-package compile coverage for every formerly exercised API.
// Current signatures require the live replacement/bootstrap authority where applicable.

public fun new_market_package_config_v8(
    catalog: &mut animacraft_v8_core::package_binding_v8::ProductReleaseCatalogV8,
    market_call_cap: animacraft_v8_core::package_binding_v8::PackageCallCapV8<animacraft_v8_core::package_binding_v8::MarketRoleV8>,
    ctx: &mut TxContext,
): animacraft_v8_market::market_v8::MarketPackageConfigV8 {
    animacraft_v8_market::market_v8::new_market_package_config_v8(
        catalog, market_call_cap, ctx
    )
}

public fun new_market_objects_v8<PaymentCoin>(
    root: &animacraft_v8_core::maker_v8::MakerRootV8<PaymentCoin>,
    admin: &animacraft_v8_core::maker_v8::MakerAdminCapV8,
    protocol_config: &animacraft_v8_core::protocol_config_v8::ProtocolConfigV8,
    catalog: &animacraft_v8_core::package_binding_v8::ProductReleaseCatalogV8,
    replacement: &animacraft_v8_core::package_binding_v8::FreshTupleReplacementBindingV2,
    config: &animacraft_v8_market::market_v8::MarketPackageConfigV8,
    ctx: &mut TxContext,
): (animacraft_v8_market::market_v8::MarketRegistryV8<PaymentCoin>, animacraft_v8_market::market_v8::MarketTreasuryV8<PaymentCoin>) {
    animacraft_v8_market::market_v8::new_market_objects_v8<PaymentCoin>(
        root, admin, protocol_config, catalog, replacement, config, ctx
    )
}

public fun seal_market_registry_v8<PaymentCoin>(
    registry: &mut animacraft_v8_market::market_v8::MarketRegistryV8<PaymentCoin>,
    treasury: &animacraft_v8_market::market_v8::MarketTreasuryV8<PaymentCoin>,
    root: &animacraft_v8_core::maker_v8::MakerRootV8<PaymentCoin>,
    admin: &animacraft_v8_core::maker_v8::MakerAdminCapV8,
    protocol_config: &animacraft_v8_core::protocol_config_v8::ProtocolConfigV8,
    catalog: &animacraft_v8_core::package_binding_v8::ProductReleaseCatalogV8,
    replacement: &animacraft_v8_core::package_binding_v8::FreshTupleReplacementBindingV2,
    config: &animacraft_v8_market::market_v8::MarketPackageConfigV8,
) {
    animacraft_v8_market::market_v8::seal_market_registry_v8<PaymentCoin>(
        registry, treasury, root, admin, protocol_config, catalog, replacement, config
    )
}

public fun validate_market_activation_readiness_v2<PaymentCoin>(
    registry: &animacraft_v8_market::market_v8::MarketRegistryV8<PaymentCoin>,
    treasury: &animacraft_v8_market::market_v8::MarketTreasuryV8<PaymentCoin>,
    root: &animacraft_v8_core::maker_v8::MakerRootV8<PaymentCoin>,
    protocol_config: &animacraft_v8_core::protocol_config_v8::ProtocolConfigV8,
    catalog: &animacraft_v8_core::package_binding_v8::ProductReleaseCatalogV8,
    replacement: &animacraft_v8_core::package_binding_v8::FreshTupleReplacementBindingV2,
    config: &animacraft_v8_market::market_v8::MarketPackageConfigV8,
): vector<u8> {
    animacraft_v8_market::market_v8::validate_market_activation_readiness_v2<PaymentCoin>(
        registry, treasury, root, protocol_config, catalog, replacement, config
    )
}

public fun quote_kind_v8(quote: &animacraft_v8_market::market_v8::MarketQuoteV8): u8 {
    animacraft_v8_market::market_v8::quote_kind_v8(
        quote
    )
}

public fun quote_gross_atomic_v8(quote: &animacraft_v8_market::market_v8::MarketQuoteV8): u64 {
    animacraft_v8_market::market_v8::quote_gross_atomic_v8(
        quote
    )
}

public fun quote_protocol_atomic_v8(quote: &animacraft_v8_market::market_v8::MarketQuoteV8): u64 {
    animacraft_v8_market::market_v8::quote_protocol_atomic_v8(
        quote
    )
}

public fun quote_creator_atomic_v8(quote: &animacraft_v8_market::market_v8::MarketQuoteV8): u64 {
    animacraft_v8_market::market_v8::quote_creator_atomic_v8(
        quote
    )
}

public fun quote_source_atomic_v8(quote: &animacraft_v8_market::market_v8::MarketQuoteV8): u64 {
    animacraft_v8_market::market_v8::quote_source_atomic_v8(
        quote
    )
}

public fun quote_seller_atomic_v8(quote: &animacraft_v8_market::market_v8::MarketQuoteV8): u64 {
    animacraft_v8_market::market_v8::quote_seller_atomic_v8(
        quote
    )
}

public fun list_maker_control_v8<PaymentCoin>(
    registry: &mut animacraft_v8_market::market_v8::MarketRegistryV8<PaymentCoin>,
    treasury: &animacraft_v8_market::market_v8::MarketTreasuryV8<PaymentCoin>,
    root: &animacraft_v8_core::maker_v8::MakerRootV8<PaymentCoin>,
    admin: animacraft_v8_core::maker_v8::MakerAdminCapV8,
    maker_treasury: &animacraft_v8_core::treasury_v8::MakerTreasuryV8<PaymentCoin>,
    protocol_config: &animacraft_v8_core::protocol_config_v8::ProtocolConfigV8,
    catalog: &animacraft_v8_core::package_binding_v8::ProductReleaseCatalogV8,
    replacement: &animacraft_v8_core::package_binding_v8::FreshTupleReplacementBindingV2,
    config: &animacraft_v8_market::market_v8::MarketPackageConfigV8,
    gross_atomic: u64,
    ctx: &mut TxContext,
): ID {
    animacraft_v8_market::market_v8::list_maker_control_v8<PaymentCoin>(
        registry, treasury, root, admin, maker_treasury, protocol_config, catalog, replacement, config, gross_atomic, ctx
    )
}

public fun purchase_maker_control_v8<PaymentCoin>(
    listing: &mut animacraft_v8_market::market_v8::MakerListingV8<PaymentCoin>,
    registry: &mut animacraft_v8_market::market_v8::MarketRegistryV8<PaymentCoin>,
    treasury: &mut animacraft_v8_market::market_v8::MarketTreasuryV8<PaymentCoin>,
    root: &mut animacraft_v8_core::maker_v8::MakerRootV8<PaymentCoin>,
    protocol_config: &animacraft_v8_core::protocol_config_v8::ProtocolConfigV8,
    protocol_treasury: &mut animacraft_v8_core::protocol_config_v8::ProtocolTreasuryV8<PaymentCoin>,
    catalog: &animacraft_v8_core::package_binding_v8::ProductReleaseCatalogV8,
    replacement: &animacraft_v8_core::package_binding_v8::FreshTupleReplacementBindingV2,
    config: &animacraft_v8_market::market_v8::MarketPackageConfigV8,
    receiving: sui::transfer::Receiving<animacraft_v8_core::maker_v8::MakerAdminCapV8>,
    payment: sui::coin::Coin<PaymentCoin>,
    ctx: &mut TxContext,
) {
    animacraft_v8_market::market_v8::purchase_maker_control_v8<PaymentCoin>(
        listing, registry, treasury, root, protocol_config, protocol_treasury, catalog, replacement, config, receiving, payment, ctx
    )
}

public fun list_soul_bundle_v8<PaymentCoin>(
    registry: &mut animacraft_v8_market::market_v8::MarketRegistryV8<PaymentCoin>,
    treasury: &animacraft_v8_market::market_v8::MarketTreasuryV8<PaymentCoin>,
    output_registry: &animacraft_v8_output::output_v8::OutputRegistryV8,
    soul_registry: &animacraft_v8_output::output_v8::SoulRegistryV8,
    root: &animacraft_v8_core::maker_v8::MakerRootV8<PaymentCoin>,
    protocol_config: &animacraft_v8_core::protocol_config_v8::ProtocolConfigV8,
    catalog: &animacraft_v8_core::package_binding_v8::ProductReleaseCatalogV8,
    replacement: &animacraft_v8_core::package_binding_v8::FreshTupleReplacementBindingV2,
    config: &animacraft_v8_market::market_v8::MarketPackageConfigV8,
    output_asset: animacraft_v8_output::output_v8::CompleteOutputV8,
    receipt: animacraft_v8_output::output_v8::CompleteReceiptV8,
    soul: animacraft_v8_output::output_v8::CanonicalSoulV8,
    gross_atomic: u64,
    ctx: &mut TxContext,
): ID {
    animacraft_v8_market::market_v8::list_soul_bundle_v8<PaymentCoin>(
        registry, treasury, output_registry, soul_registry, root, protocol_config, catalog, replacement, config, output_asset, receipt, soul, gross_atomic, ctx
    )
}

public fun purchase_soul_bundle_v8<PaymentCoin>(
    listing: &mut animacraft_v8_market::market_v8::SoulListingV8<PaymentCoin>,
    registry: &mut animacraft_v8_market::market_v8::MarketRegistryV8<PaymentCoin>,
    treasury: &mut animacraft_v8_market::market_v8::MarketTreasuryV8<PaymentCoin>,
    output_registry: &mut animacraft_v8_output::output_v8::OutputRegistryV8,
    soul_registry: &mut animacraft_v8_output::output_v8::SoulRegistryV8,
    root: &animacraft_v8_core::maker_v8::MakerRootV8<PaymentCoin>,
    maker_treasury: &mut animacraft_v8_core::treasury_v8::MakerTreasuryV8<PaymentCoin>,
    protocol_config: &animacraft_v8_core::protocol_config_v8::ProtocolConfigV8,
    protocol_treasury: &mut animacraft_v8_core::protocol_config_v8::ProtocolTreasuryV8<PaymentCoin>,
    catalog: &animacraft_v8_core::package_binding_v8::ProductReleaseCatalogV8,
    replacement: &animacraft_v8_core::package_binding_v8::FreshTupleReplacementBindingV2,
    config: &animacraft_v8_market::market_v8::MarketPackageConfigV8,
    output_receiving: sui::transfer::Receiving<animacraft_v8_output::output_v8::CompleteOutputV8>,
    receipt_receiving: sui::transfer::Receiving<animacraft_v8_output::output_v8::CompleteReceiptV8>,
    soul_receiving: sui::transfer::Receiving<animacraft_v8_output::output_v8::CanonicalSoulV8>,
    payment: sui::coin::Coin<PaymentCoin>,
    ctx: &mut TxContext,
) {
    animacraft_v8_market::market_v8::purchase_soul_bundle_v8<PaymentCoin>(
        listing, registry, treasury, output_registry, soul_registry, root, maker_treasury, protocol_config, protocol_treasury, catalog, replacement, config, output_receiving, receipt_receiving, soul_receiving, payment, ctx
    )
}

public fun cancel_soul_listing_v8<PaymentCoin>(
    listing: &mut animacraft_v8_market::market_v8::SoulListingV8<PaymentCoin>,
    registry: &mut animacraft_v8_market::market_v8::MarketRegistryV8<PaymentCoin>,
    treasury: &animacraft_v8_market::market_v8::MarketTreasuryV8<PaymentCoin>,
    output_registry: &animacraft_v8_output::output_v8::OutputRegistryV8,
    soul_registry: &animacraft_v8_output::output_v8::SoulRegistryV8,
    root: &animacraft_v8_core::maker_v8::MakerRootV8<PaymentCoin>,
    protocol_config: &animacraft_v8_core::protocol_config_v8::ProtocolConfigV8,
    catalog: &animacraft_v8_core::package_binding_v8::ProductReleaseCatalogV8,
    replacement: &animacraft_v8_core::package_binding_v8::FreshTupleReplacementBindingV2,
    config: &animacraft_v8_market::market_v8::MarketPackageConfigV8,
    output_receiving: sui::transfer::Receiving<animacraft_v8_output::output_v8::CompleteOutputV8>,
    receipt_receiving: sui::transfer::Receiving<animacraft_v8_output::output_v8::CompleteReceiptV8>,
    soul_receiving: sui::transfer::Receiving<animacraft_v8_output::output_v8::CanonicalSoulV8>,
    ctx: &mut TxContext,
) {
    animacraft_v8_market::market_v8::cancel_soul_listing_v8<PaymentCoin>(
        listing, registry, treasury, output_registry, soul_registry, root, protocol_config, catalog, replacement, config, output_receiving, receipt_receiving, soul_receiving, ctx
    )
}

public fun recover_soul_listing_v8<PaymentCoin>(
    listing: &mut animacraft_v8_market::market_v8::SoulListingV8<PaymentCoin>,
    registry: &mut animacraft_v8_market::market_v8::MarketRegistryV8<PaymentCoin>,
    treasury: &animacraft_v8_market::market_v8::MarketTreasuryV8<PaymentCoin>,
    output_registry: &animacraft_v8_output::output_v8::OutputRegistryV8,
    soul_registry: &animacraft_v8_output::output_v8::SoulRegistryV8,
    root: &animacraft_v8_core::maker_v8::MakerRootV8<PaymentCoin>,
    protocol_config: &animacraft_v8_core::protocol_config_v8::ProtocolConfigV8,
    catalog: &animacraft_v8_core::package_binding_v8::ProductReleaseCatalogV8,
    replacement: &animacraft_v8_core::package_binding_v8::FreshTupleReplacementBindingV2,
    config: &animacraft_v8_market::market_v8::MarketPackageConfigV8,
    output_receiving: sui::transfer::Receiving<animacraft_v8_output::output_v8::CompleteOutputV8>,
    receipt_receiving: sui::transfer::Receiving<animacraft_v8_output::output_v8::CompleteReceiptV8>,
    soul_receiving: sui::transfer::Receiving<animacraft_v8_output::output_v8::CanonicalSoulV8>,
) {
    animacraft_v8_market::market_v8::recover_soul_listing_v8<PaymentCoin>(
        listing, registry, treasury, output_registry, soul_registry, root, protocol_config, catalog, replacement, config, output_receiving, receipt_receiving, soul_receiving
    )
}

public fun list_base_physical_v8<PaymentCoin>(
    registry: &mut animacraft_v8_market::market_v8::MarketRegistryV8<PaymentCoin>,
    treasury: &animacraft_v8_market::market_v8::MarketTreasuryV8<PaymentCoin>,
    physical_registry: &animacraft_v8_physical::physical_v8::PhysicalRegistryV8,
    root: &animacraft_v8_core::maker_v8::MakerRootV8<PaymentCoin>,
    maker_treasury: &animacraft_v8_core::treasury_v8::MakerTreasuryV8<PaymentCoin>,
    protocol_config: &animacraft_v8_core::protocol_config_v8::ProtocolConfigV8,
    catalog: &animacraft_v8_core::package_binding_v8::ProductReleaseCatalogV8,
    replacement: &animacraft_v8_core::package_binding_v8::FreshTupleReplacementBindingV2,
    physical_config: &animacraft_v8_physical::physical_v8::PhysicalPackageConfigV8,
    config: &animacraft_v8_market::market_v8::MarketPackageConfigV8,
    asset: animacraft_v8_physical::physical_v8::PhysicalAssetV8,
    gross_atomic: u64,
    ctx: &mut TxContext,
): ID {
    animacraft_v8_market::market_v8::list_base_physical_v8<PaymentCoin>(
        registry, treasury, physical_registry, root, maker_treasury, protocol_config, catalog, replacement, physical_config, config, asset, gross_atomic, ctx
    )
}

public fun list_pack_physical_v8<PaymentCoin>(
    registry: &mut animacraft_v8_market::market_v8::MarketRegistryV8<PaymentCoin>,
    treasury: &animacraft_v8_market::market_v8::MarketTreasuryV8<PaymentCoin>,
    physical_registry: &animacraft_v8_physical::physical_v8::PhysicalRegistryV8,
    root: &animacraft_v8_core::maker_v8::MakerRootV8<PaymentCoin>,
    pack_treasury: &animacraft_v8_runtime::runtime_v8::PackTreasuryV8<PaymentCoin>,
    protocol_config: &animacraft_v8_core::protocol_config_v8::ProtocolConfigV8,
    catalog: &animacraft_v8_core::package_binding_v8::ProductReleaseCatalogV8,
    replacement: &animacraft_v8_core::package_binding_v8::FreshTupleReplacementBindingV2,
    physical_config: &animacraft_v8_physical::physical_v8::PhysicalPackageConfigV8,
    config: &animacraft_v8_market::market_v8::MarketPackageConfigV8,
    asset: animacraft_v8_physical::physical_v8::PhysicalAssetV8,
    gross_atomic: u64,
    ctx: &mut TxContext,
): ID {
    animacraft_v8_market::market_v8::list_pack_physical_v8<PaymentCoin>(
        registry, treasury, physical_registry, root, pack_treasury, protocol_config, catalog, replacement, physical_config, config, asset, gross_atomic, ctx
    )
}

public fun purchase_base_physical_v8<PaymentCoin>(
    listing: &mut animacraft_v8_market::market_v8::PhysicalListingV8<PaymentCoin>,
    registry: &mut animacraft_v8_market::market_v8::MarketRegistryV8<PaymentCoin>,
    treasury: &mut animacraft_v8_market::market_v8::MarketTreasuryV8<PaymentCoin>,
    physical_registry: &animacraft_v8_physical::physical_v8::PhysicalRegistryV8,
    root: &animacraft_v8_core::maker_v8::MakerRootV8<PaymentCoin>,
    maker_treasury: &mut animacraft_v8_core::treasury_v8::MakerTreasuryV8<PaymentCoin>,
    protocol_config: &animacraft_v8_core::protocol_config_v8::ProtocolConfigV8,
    protocol_treasury: &mut animacraft_v8_core::protocol_config_v8::ProtocolTreasuryV8<PaymentCoin>,
    catalog: &animacraft_v8_core::package_binding_v8::ProductReleaseCatalogV8,
    replacement: &animacraft_v8_core::package_binding_v8::FreshTupleReplacementBindingV2,
    physical_config: &animacraft_v8_physical::physical_v8::PhysicalPackageConfigV8,
    config: &animacraft_v8_market::market_v8::MarketPackageConfigV8,
    receiving: sui::transfer::Receiving<animacraft_v8_physical::physical_v8::PhysicalAssetV8>,
    payment: sui::coin::Coin<PaymentCoin>,
    ctx: &mut TxContext,
) {
    animacraft_v8_market::market_v8::purchase_base_physical_v8<PaymentCoin>(
        listing, registry, treasury, physical_registry, root, maker_treasury, protocol_config, protocol_treasury, catalog, replacement, physical_config, config, receiving, payment, ctx
    )
}

public fun purchase_pack_physical_v8<PaymentCoin>(
    listing: &mut animacraft_v8_market::market_v8::PhysicalListingV8<PaymentCoin>,
    registry: &mut animacraft_v8_market::market_v8::MarketRegistryV8<PaymentCoin>,
    treasury: &mut animacraft_v8_market::market_v8::MarketTreasuryV8<PaymentCoin>,
    physical_registry: &animacraft_v8_physical::physical_v8::PhysicalRegistryV8,
    root: &animacraft_v8_core::maker_v8::MakerRootV8<PaymentCoin>,
    pack_release: &animacraft_v8_runtime::runtime_v8::PackReleaseV8<PaymentCoin>,
    pack_treasury: &mut animacraft_v8_runtime::runtime_v8::PackTreasuryV8<PaymentCoin>,
    protocol_config: &animacraft_v8_core::protocol_config_v8::ProtocolConfigV8,
    protocol_treasury: &mut animacraft_v8_core::protocol_config_v8::ProtocolTreasuryV8<PaymentCoin>,
    catalog: &animacraft_v8_core::package_binding_v8::ProductReleaseCatalogV8,
    replacement: &animacraft_v8_core::package_binding_v8::FreshTupleReplacementBindingV2,
    physical_config: &animacraft_v8_physical::physical_v8::PhysicalPackageConfigV8,
    config: &animacraft_v8_market::market_v8::MarketPackageConfigV8,
    receiving: sui::transfer::Receiving<animacraft_v8_physical::physical_v8::PhysicalAssetV8>,
    payment: sui::coin::Coin<PaymentCoin>,
    ctx: &mut TxContext,
) {
    animacraft_v8_market::market_v8::purchase_pack_physical_v8<PaymentCoin>(
        listing, registry, treasury, physical_registry, root, pack_release, pack_treasury, protocol_config, protocol_treasury, catalog, replacement, physical_config, config, receiving, payment, ctx
    )
}

public fun cancel_physical_listing_v8<PaymentCoin>(
    listing: &mut animacraft_v8_market::market_v8::PhysicalListingV8<PaymentCoin>,
    registry: &mut animacraft_v8_market::market_v8::MarketRegistryV8<PaymentCoin>,
    treasury: &animacraft_v8_market::market_v8::MarketTreasuryV8<PaymentCoin>,
    physical_registry: &animacraft_v8_physical::physical_v8::PhysicalRegistryV8,
    root: &animacraft_v8_core::maker_v8::MakerRootV8<PaymentCoin>,
    protocol_config: &animacraft_v8_core::protocol_config_v8::ProtocolConfigV8,
    catalog: &animacraft_v8_core::package_binding_v8::ProductReleaseCatalogV8,
    replacement: &animacraft_v8_core::package_binding_v8::FreshTupleReplacementBindingV2,
    config: &animacraft_v8_market::market_v8::MarketPackageConfigV8,
    receiving: sui::transfer::Receiving<animacraft_v8_physical::physical_v8::PhysicalAssetV8>,
    ctx: &TxContext,
) {
    animacraft_v8_market::market_v8::cancel_physical_listing_v8<PaymentCoin>(
        listing, registry, treasury, physical_registry, root, protocol_config, catalog, replacement, config, receiving, ctx
    )
}

public fun recover_physical_listing_v8<PaymentCoin>(
    listing: &mut animacraft_v8_market::market_v8::PhysicalListingV8<PaymentCoin>,
    registry: &mut animacraft_v8_market::market_v8::MarketRegistryV8<PaymentCoin>,
    treasury: &animacraft_v8_market::market_v8::MarketTreasuryV8<PaymentCoin>,
    physical_registry: &animacraft_v8_physical::physical_v8::PhysicalRegistryV8,
    root: &animacraft_v8_core::maker_v8::MakerRootV8<PaymentCoin>,
    protocol_config: &animacraft_v8_core::protocol_config_v8::ProtocolConfigV8,
    catalog: &animacraft_v8_core::package_binding_v8::ProductReleaseCatalogV8,
    replacement: &animacraft_v8_core::package_binding_v8::FreshTupleReplacementBindingV2,
    config: &animacraft_v8_market::market_v8::MarketPackageConfigV8,
    receiving: sui::transfer::Receiving<animacraft_v8_physical::physical_v8::PhysicalAssetV8>,
) {
    animacraft_v8_market::market_v8::recover_physical_listing_v8<PaymentCoin>(
        listing, registry, treasury, physical_registry, root, protocol_config, catalog, replacement, config, receiving
    )
}
