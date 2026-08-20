/// Activation-safe native Market foundation for the fresh unified Maker v8.
/// Custody and settlement are added only through future concrete typed tickets;
/// this module never treats a pure object ID as authority.
module animacraft_v8_market::market_v8;

use animacraft_v8_core::activation_v8::{Self as activation, MarketReadinessV8};
use animacraft_v8_core::maker_v8::{Self as maker, MakerAdminCapV8, MakerRootV8};
use animacraft_v8_core::package_binding_v8::{
    Self as binding,
    MarketRoleV8,
    PackageCallCapV8,
    ProductReleaseCatalogV8,
};
use std::bcs;
use std::hash;
use sui::balance::{Self as balance, Balance};
use sui::event;

#[test_only]
use animacraft_v8_core::base_registry_v8::{Self as base, BaseDefinitionRegistryV8};
#[test_only]
use animacraft_v8_core::core_v8 as core;
#[test_only]
use animacraft_v8_core::protocol_config_v8::{
    Self as protocol,
    ProtocolAdminCapV8,
    ProtocolConfigV8,
};
#[test_only]
use animacraft_v8_core::treasury_v8::MakerTreasuryV8;

const VERSION: u64 = 8;
#[test_only]
const HASH_LENGTH: u64 = 32;
const BPS_DENOMINATOR: u128 = 10_000;
const QUOTE_MAKER_RESALE: u8 = 0;
const QUOTE_SOUL_RESALE: u8 = 1;

const EInvalidConfig: u64 = 0;
const EInvalidBinding: u64 = 1;
const EInvalidCommitment: u64 = 2;
const EInvalidState: u64 = 3;
const EInvalidAmount: u64 = 4;
const EShareRoundsToZero: u64 = 5;

public struct MarketOriginalMarkerV8 has drop {}
public struct MarketCallableMarkerV8 has drop {}

/// Catalog-installed configuration. The call cap has no abilities and is
/// permanently nested here; callers can never borrow it through an accessor.
public struct MarketPackageConfigV8 has key {
    id: UID,
    version: u64,
    catalog_id: ID,
    product_binding_commitment: vector<u8>,
    call_cap_set_commitment: vector<u8>,
    market_call_cap: PackageCallCapV8<MarketRoleV8>,
}

/// Market custody balance starts at zero. It cannot be mistaken for protocol,
/// Maker, Pack, or seller revenue and is not a settlement authority by itself.
public struct MarketTreasuryV8<phantom PaymentCoin> has key {
    id: UID,
    version: u64,
    catalog_id: ID,
    package_config_id: ID,
    root_id: ID,
    maker_version: u64,
    root_content_commitment: vector<u8>,
    escrow: Balance<PaymentCoin>,
    gross_escrowed_atomic: u128,
    gross_released_atomic: u128,
}

/// Per-Maker market state. Every mutable lane is present at genesis so
/// activation can prove a concrete zero state rather than relying on absence.
public struct MarketRegistryV8<phantom PaymentCoin> has key {
    id: UID,
    version: u64,
    catalog_id: ID,
    package_config_id: ID,
    product_binding_commitment: vector<u8>,
    call_cap_set_commitment: vector<u8>,
    root_id: ID,
    maker_version: u64,
    root_content_commitment: vector<u8>,
    protocol_config_id: ID,
    protocol_config_revision: u64,
    protocol_config_commitment: vector<u8>,
    economics_commitment: vector<u8>,
    rights_commitment: vector<u8>,
    maker_market_fee_bps: u16,
    soul_market_fee_bps: u16,
    soul_creator_royalty_bps: u16,
    maker_source_royalty_bps: u16,
    maker_resale_royalty_bps: u16,
    treasury_id: ID,
    sealed: bool,
    revision: u64,
    listing_count: u64,
    escrow_count: u64,
    completed_sale_count: u64,
    canceled_sale_count: u64,
    recovered_sale_count: u64,
    gross_volume_atomic: u128,
    protocol_paid_atomic: u128,
    creator_paid_atomic: u128,
    source_paid_atomic: u128,
    seller_paid_atomic: u128,
    zero_state_commitment: vector<u8>,
}

public struct MarketZeroStateCommitmentInputV8 has drop {
    domain: vector<u8>,
    version: u64,
    catalog_id: ID,
    package_config_id: ID,
    product_binding_commitment: vector<u8>,
    call_cap_set_commitment: vector<u8>,
    root_id: ID,
    maker_version: u64,
    root_content_commitment: vector<u8>,
    protocol_config_id: ID,
    protocol_config_revision: u64,
    protocol_config_commitment: vector<u8>,
    economics_commitment: vector<u8>,
    rights_commitment: vector<u8>,
    maker_market_fee_bps: u16,
    soul_market_fee_bps: u16,
    soul_creator_royalty_bps: u16,
    maker_source_royalty_bps: u16,
    maker_resale_royalty_bps: u16,
    treasury_id: ID,
}

public struct MarketReadinessCommitmentInputV8 has drop {
    domain: vector<u8>,
    version: u64,
    registry_id: ID,
    treasury_id: ID,
    zero_state_commitment: vector<u8>,
    sealed: bool,
    revision: u64,
    listing_count: u64,
    escrow_count: u64,
    completed_sale_count: u64,
    canceled_sale_count: u64,
    recovered_sale_count: u64,
    gross_volume_atomic: u128,
    protocol_paid_atomic: u128,
    creator_paid_atomic: u128,
    source_paid_atomic: u128,
    seller_paid_atomic: u128,
    treasury_balance_atomic: u64,
    treasury_gross_escrowed_atomic: u128,
    treasury_gross_released_atomic: u128,
}

public struct MarketQuoteCommitmentInputV8 has drop {
    domain: vector<u8>,
    version: u64,
    quote_kind: u8,
    root_id: ID,
    maker_version: u64,
    root_content_commitment: vector<u8>,
    economics_commitment: vector<u8>,
    rights_commitment: vector<u8>,
    gross_atomic: u64,
    protocol_atomic: u64,
    creator_atomic: u64,
    source_atomic: u64,
    seller_atomic: u64,
}

public struct MarketRegistrySealedV8 has copy, drop {
    root_id: ID,
    registry_id: ID,
    treasury_id: ID,
    zero_state_commitment: vector<u8>,
}

/// Quote is read-only data, never authorization. Settlement must recompute it
/// from the same live Root in the eventual typed escrow transaction.
public struct MarketQuoteV8 has copy, drop {
    quote_kind: u8,
    root_id: ID,
    maker_version: u64,
    root_content_commitment: vector<u8>,
    economics_commitment: vector<u8>,
    rights_commitment: vector<u8>,
    gross_atomic: u64,
    protocol_atomic: u64,
    creator_atomic: u64,
    source_atomic: u64,
    seller_atomic: u64,
    commitment: vector<u8>,
}

public fun version_v8(): u64 { VERSION }
public fun quote_maker_resale_kind_v8(): u8 { QUOTE_MAKER_RESALE }
public fun quote_soul_resale_kind_v8(): u8 { QUOTE_SOUL_RESALE }

public fun new_market_package_config_v8(
    catalog: &ProductReleaseCatalogV8,
    market_call_cap: PackageCallCapV8<MarketRoleV8>,
    ctx: &mut TxContext,
): MarketPackageConfigV8 {
    binding::assert_market_call_cap_v8(catalog, &market_call_cap);
    let product = binding::catalog_binding_v8(catalog);
    binding::assert_type_origins_v8<MarketOriginalMarkerV8, MarketCallableMarkerV8>(
        binding::market_binding_v8(product),
    );
    MarketPackageConfigV8 {
        id: object::new(ctx),
        version: VERSION,
        catalog_id: binding::catalog_id_v8(catalog),
        product_binding_commitment: *binding::product_binding_commitment_v8(product),
        call_cap_set_commitment: *binding::call_cap_set_commitment_v8(
            binding::catalog_call_cap_set_v8(catalog),
        ),
        market_call_cap,
    }
}

public fun share_market_package_config_v8(config: MarketPackageConfigV8) {
    transfer::share_object(config)
}

public fun new_market_objects_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    catalog: &ProductReleaseCatalogV8,
    config: &MarketPackageConfigV8,
    ctx: &mut TxContext,
): (MarketRegistryV8<PaymentCoin>, MarketTreasuryV8<PaymentCoin>) {
    maker::assert_draft_admin_v8(root, admin);
    assert_config(root, catalog, config);
    new_market_objects(root, config, ctx)
}

fun new_market_objects<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    config: &MarketPackageConfigV8,
    ctx: &mut TxContext,
): (MarketRegistryV8<PaymentCoin>, MarketTreasuryV8<PaymentCoin>) {
    let economics = maker::root_economics_v8(root);
    let rights = maker::root_rights_v8(root);
    let treasury = MarketTreasuryV8<PaymentCoin> {
        id: object::new(ctx),
        version: VERSION,
        catalog_id: config.catalog_id,
        package_config_id: object::id(config),
        root_id: maker::root_id_v8(root),
        maker_version: maker::root_maker_version_v8(root),
        root_content_commitment: *maker::root_content_commitment_v8(root),
        escrow: balance::zero(),
        gross_escrowed_atomic: 0,
        gross_released_atomic: 0,
    };
    let treasury_id = object::id(&treasury);
    let zero_state_commitment = derive_zero_state_commitment(
        root, config, treasury_id, &economics, &rights,
    );
    let registry = MarketRegistryV8<PaymentCoin> {
        id: object::new(ctx),
        version: VERSION,
        catalog_id: config.catalog_id,
        package_config_id: object::id(config),
        product_binding_commitment: config.product_binding_commitment,
        call_cap_set_commitment: config.call_cap_set_commitment,
        root_id: maker::root_id_v8(root),
        maker_version: maker::root_maker_version_v8(root),
        root_content_commitment: *maker::root_content_commitment_v8(root),
        protocol_config_id: maker::economics_protocol_config_id_v8(&economics),
        protocol_config_revision: maker::economics_protocol_config_revision_v8(&economics),
        protocol_config_commitment: *maker::economics_protocol_config_commitment_v8(&economics),
        economics_commitment: *maker::economics_commitment_v8(&economics),
        rights_commitment: *maker::rights_commitment_v8(&rights),
        maker_market_fee_bps: maker::economics_maker_market_fee_bps_v8(&economics),
        soul_market_fee_bps: maker::economics_soul_market_fee_bps_v8(&economics),
        soul_creator_royalty_bps: maker::rights_soul_creator_royalty_bps_v8(&rights),
        maker_source_royalty_bps: maker::rights_maker_source_royalty_bps_v8(&rights),
        maker_resale_royalty_bps: maker::rights_maker_resale_royalty_bps_v8(&rights),
        treasury_id,
        sealed: false,
        revision: 0,
        listing_count: 0,
        escrow_count: 0,
        completed_sale_count: 0,
        canceled_sale_count: 0,
        recovered_sale_count: 0,
        gross_volume_atomic: 0,
        protocol_paid_atomic: 0,
        creator_paid_atomic: 0,
        source_paid_atomic: 0,
        seller_paid_atomic: 0,
        zero_state_commitment,
    };
    (registry, treasury)
}

public fun share_market_registry_v8<PaymentCoin>(registry: MarketRegistryV8<PaymentCoin>) {
    transfer::share_object(registry)
}

public fun share_market_treasury_v8<PaymentCoin>(treasury: MarketTreasuryV8<PaymentCoin>) {
    transfer::share_object(treasury)
}

public fun seal_market_registry_v8<PaymentCoin>(
    registry: &mut MarketRegistryV8<PaymentCoin>,
    treasury: &MarketTreasuryV8<PaymentCoin>,
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    catalog: &ProductReleaseCatalogV8,
    config: &MarketPackageConfigV8,
) {
    maker::assert_draft_admin_v8(root, admin);
    assert_config(root, catalog, config);
    assert_market_identity(registry, treasury, root, config);
    assert_zero_state(registry, treasury);
    assert!(!registry.sealed, EInvalidState);
    registry.sealed = true;
    event::emit(MarketRegistrySealedV8 {
        root_id: registry.root_id,
        registry_id: object::id(registry),
        treasury_id: object::id(treasury),
        zero_state_commitment: registry.zero_state_commitment,
    });
}

public fun certify_market_activation_readiness_v8<PaymentCoin>(
    registry: &MarketRegistryV8<PaymentCoin>,
    treasury: &MarketTreasuryV8<PaymentCoin>,
    root: &MakerRootV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
    config: &MarketPackageConfigV8,
): MarketReadinessV8 {
    maker::assert_draft_v8(root);
    assert_config(root, catalog, config);
    assert_market_identity(registry, treasury, root, config);
    assert!(registry.sealed, EInvalidState);
    assert_zero_state(registry, treasury);
    let companion_commitment = readiness_commitment(registry, treasury);
    activation::certify_market_readiness_v8<
        PaymentCoin,
        MarketOriginalMarkerV8,
        MarketCallableMarkerV8,
        MarketRegistryV8<PaymentCoin>,
        MarketTreasuryV8<PaymentCoin>,
    >(
        root,
        catalog,
        &config.market_call_cap,
        registry,
        treasury,
        companion_commitment,
    )
}

public fun quote_maker_resale_v8<PaymentCoin>(
    registry: &MarketRegistryV8<PaymentCoin>,
    treasury: &MarketTreasuryV8<PaymentCoin>,
    root: &MakerRootV8<PaymentCoin>,
    gross_atomic: u64,
): MarketQuoteV8 {
    assert_active_market(registry, treasury, root);
    derive_quote(root, QUOTE_MAKER_RESALE, gross_atomic)
}

public fun quote_soul_resale_v8<PaymentCoin>(
    registry: &MarketRegistryV8<PaymentCoin>,
    treasury: &MarketTreasuryV8<PaymentCoin>,
    root: &MakerRootV8<PaymentCoin>,
    gross_atomic: u64,
): MarketQuoteV8 {
    assert_active_market(registry, treasury, root);
    derive_quote(root, QUOTE_SOUL_RESALE, gross_atomic)
}

fun derive_quote<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    quote_kind: u8,
    gross_atomic: u64,
): MarketQuoteV8 {
    assert!(gross_atomic > 0, EInvalidAmount);
    let economics = maker::root_economics_v8(root);
    let rights = maker::root_rights_v8(root);
    let (protocol_bps, creator_bps, source_bps) = if (quote_kind == QUOTE_MAKER_RESALE) {
        (
            maker::economics_maker_market_fee_bps_v8(&economics),
            maker::rights_maker_resale_royalty_bps_v8(&rights),
            0,
        )
    } else {
        assert!(quote_kind == QUOTE_SOUL_RESALE, EInvalidState);
        (
            maker::economics_soul_market_fee_bps_v8(&economics),
            maker::rights_soul_creator_royalty_bps_v8(&rights),
            maker::rights_maker_source_royalty_bps_v8(&rights),
        )
    };
    let protocol_atomic = share(gross_atomic, protocol_bps);
    let creator_atomic = share(gross_atomic, creator_bps);
    let source_atomic = share(gross_atomic, source_bps);
    let distributed = (protocol_atomic as u128)
        + (creator_atomic as u128)
        + (source_atomic as u128);
    assert!(distributed < (gross_atomic as u128), EInvalidAmount);
    let seller_atomic = gross_atomic
        - protocol_atomic
        - creator_atomic
        - source_atomic;
    assert!(seller_atomic > 0, EInvalidAmount);
    let root_id = maker::root_id_v8(root);
    let maker_version = maker::root_maker_version_v8(root);
    let root_content_commitment = *maker::root_content_commitment_v8(root);
    let economics_commitment = *maker::economics_commitment_v8(&economics);
    let rights_commitment = *maker::rights_commitment_v8(&rights);
    let commitment = hash::sha2_256(bcs::to_bytes(&MarketQuoteCommitmentInputV8 {
        domain: b"animacraft-v8/market/quote",
        version: VERSION,
        quote_kind,
        root_id,
        maker_version,
        root_content_commitment,
        economics_commitment,
        rights_commitment,
        gross_atomic,
        protocol_atomic,
        creator_atomic,
        source_atomic,
        seller_atomic,
    }));
    MarketQuoteV8 {
        quote_kind,
        root_id,
        maker_version,
        root_content_commitment,
        economics_commitment,
        rights_commitment,
        gross_atomic,
        protocol_atomic,
        creator_atomic,
        source_atomic,
        seller_atomic,
        commitment,
    }
}

fun share(gross_atomic: u64, bps: u16): u64 {
    let value = ((gross_atomic as u128) * (bps as u128)) / BPS_DENOMINATOR;
    assert!(bps == 0 || value > 0, EShareRoundsToZero);
    value as u64
}

fun derive_zero_state_commitment<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    config: &MarketPackageConfigV8,
    treasury_id: ID,
    economics: &maker::EconomicsSnapshotV8,
    rights: &maker::RightsSnapshotV8,
): vector<u8> {
    hash::sha2_256(bcs::to_bytes(&MarketZeroStateCommitmentInputV8 {
        domain: b"animacraft-v8/market/zero-state",
        version: VERSION,
        catalog_id: config.catalog_id,
        package_config_id: object::id(config),
        product_binding_commitment: config.product_binding_commitment,
        call_cap_set_commitment: config.call_cap_set_commitment,
        root_id: maker::root_id_v8(root),
        maker_version: maker::root_maker_version_v8(root),
        root_content_commitment: *maker::root_content_commitment_v8(root),
        protocol_config_id: maker::economics_protocol_config_id_v8(economics),
        protocol_config_revision: maker::economics_protocol_config_revision_v8(economics),
        protocol_config_commitment: *maker::economics_protocol_config_commitment_v8(economics),
        economics_commitment: *maker::economics_commitment_v8(economics),
        rights_commitment: *maker::rights_commitment_v8(rights),
        maker_market_fee_bps: maker::economics_maker_market_fee_bps_v8(economics),
        soul_market_fee_bps: maker::economics_soul_market_fee_bps_v8(economics),
        soul_creator_royalty_bps: maker::rights_soul_creator_royalty_bps_v8(rights),
        maker_source_royalty_bps: maker::rights_maker_source_royalty_bps_v8(rights),
        maker_resale_royalty_bps: maker::rights_maker_resale_royalty_bps_v8(rights),
        treasury_id,
    }))
}

fun readiness_commitment<PaymentCoin>(
    registry: &MarketRegistryV8<PaymentCoin>,
    treasury: &MarketTreasuryV8<PaymentCoin>,
): vector<u8> {
    hash::sha2_256(bcs::to_bytes(&MarketReadinessCommitmentInputV8 {
        domain: b"animacraft-v8/market/readiness",
        version: VERSION,
        registry_id: object::id(registry),
        treasury_id: object::id(treasury),
        zero_state_commitment: registry.zero_state_commitment,
        sealed: registry.sealed,
        revision: registry.revision,
        listing_count: registry.listing_count,
        escrow_count: registry.escrow_count,
        completed_sale_count: registry.completed_sale_count,
        canceled_sale_count: registry.canceled_sale_count,
        recovered_sale_count: registry.recovered_sale_count,
        gross_volume_atomic: registry.gross_volume_atomic,
        protocol_paid_atomic: registry.protocol_paid_atomic,
        creator_paid_atomic: registry.creator_paid_atomic,
        source_paid_atomic: registry.source_paid_atomic,
        seller_paid_atomic: registry.seller_paid_atomic,
        treasury_balance_atomic: treasury.escrow.value(),
        treasury_gross_escrowed_atomic: treasury.gross_escrowed_atomic,
        treasury_gross_released_atomic: treasury.gross_released_atomic,
    }))
}

fun assert_config<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
    config: &MarketPackageConfigV8,
) {
    assert!(config.version == VERSION, EInvalidConfig);
    assert!(config.catalog_id == binding::catalog_id_v8(catalog), EInvalidConfig);
    assert!(maker::root_product_release_catalog_id_v8(root) == config.catalog_id, EInvalidBinding);
    let product = binding::catalog_binding_v8(catalog);
    assert!(config.product_binding_commitment
        == *binding::product_binding_commitment_v8(product), EInvalidConfig);
    assert!(config.call_cap_set_commitment
        == *binding::call_cap_set_commitment_v8(
            binding::catalog_call_cap_set_v8(catalog)), EInvalidConfig);
    binding::assert_market_call_cap_v8(catalog, &config.market_call_cap);
    binding::assert_type_origins_v8<MarketOriginalMarkerV8, MarketCallableMarkerV8>(
        binding::market_binding_v8(product),
    );
}

fun assert_market_identity<PaymentCoin>(
    registry: &MarketRegistryV8<PaymentCoin>,
    treasury: &MarketTreasuryV8<PaymentCoin>,
    root: &MakerRootV8<PaymentCoin>,
    config: &MarketPackageConfigV8,
) {
    assert!(registry.version == VERSION && treasury.version == VERSION, EInvalidBinding);
    maker::assert_root_identity_v8(
        root,
        registry.root_id,
        registry.maker_version,
        &registry.root_content_commitment,
    );
    maker::assert_root_identity_v8(
        root,
        treasury.root_id,
        treasury.maker_version,
        &treasury.root_content_commitment,
    );
    assert!(registry.catalog_id == config.catalog_id
        && treasury.catalog_id == config.catalog_id, EInvalidBinding);
    assert!(registry.package_config_id == object::id(config)
        && treasury.package_config_id == object::id(config), EInvalidBinding);
    assert!(registry.treasury_id == object::id(treasury), EInvalidBinding);
    assert!(registry.product_binding_commitment
        == config.product_binding_commitment, EInvalidBinding);
    assert!(registry.call_cap_set_commitment
        == config.call_cap_set_commitment, EInvalidBinding);
    let economics = maker::root_economics_v8(root);
    let rights = maker::root_rights_v8(root);
    assert!(registry.protocol_config_id
        == maker::economics_protocol_config_id_v8(&economics), EInvalidBinding);
    assert!(registry.protocol_config_revision
        == maker::economics_protocol_config_revision_v8(&economics), EInvalidBinding);
    assert!(&registry.protocol_config_commitment
        == maker::economics_protocol_config_commitment_v8(&economics), EInvalidBinding);
    assert!(&registry.economics_commitment
        == maker::economics_commitment_v8(&economics), EInvalidBinding);
    assert!(&registry.rights_commitment
        == maker::rights_commitment_v8(&rights), EInvalidBinding);
    assert!(registry.maker_market_fee_bps
        == maker::economics_maker_market_fee_bps_v8(&economics), EInvalidBinding);
    assert!(registry.soul_market_fee_bps
        == maker::economics_soul_market_fee_bps_v8(&economics), EInvalidBinding);
    assert!(registry.soul_creator_royalty_bps
        == maker::rights_soul_creator_royalty_bps_v8(&rights), EInvalidBinding);
    assert!(registry.maker_source_royalty_bps
        == maker::rights_maker_source_royalty_bps_v8(&rights), EInvalidBinding);
    assert!(registry.maker_resale_royalty_bps
        == maker::rights_maker_resale_royalty_bps_v8(&rights), EInvalidBinding);
    assert!(registry.zero_state_commitment == derive_zero_state_commitment(
        root, config, object::id(treasury), &economics, &rights), EInvalidCommitment);
}

fun assert_zero_state<PaymentCoin>(
    registry: &MarketRegistryV8<PaymentCoin>,
    treasury: &MarketTreasuryV8<PaymentCoin>,
) {
    assert!(registry.revision == 0, EInvalidState);
    assert!(registry.listing_count == 0 && registry.escrow_count == 0, EInvalidState);
    assert!(registry.completed_sale_count == 0
        && registry.canceled_sale_count == 0
        && registry.recovered_sale_count == 0, EInvalidState);
    assert!(registry.gross_volume_atomic == 0
        && registry.protocol_paid_atomic == 0
        && registry.creator_paid_atomic == 0
        && registry.source_paid_atomic == 0
        && registry.seller_paid_atomic == 0, EInvalidState);
    assert!(treasury.escrow.value() == 0
        && treasury.gross_escrowed_atomic == 0
        && treasury.gross_released_atomic == 0, EInvalidState);
}

fun assert_active_market<PaymentCoin>(
    registry: &MarketRegistryV8<PaymentCoin>,
    treasury: &MarketTreasuryV8<PaymentCoin>,
    root: &MakerRootV8<PaymentCoin>,
) {
    maker::assert_active_capability_registry_v8(root);
    maker::assert_root_identity_v8(root, registry.root_id, registry.maker_version,
        &registry.root_content_commitment);
    maker::assert_root_identity_v8(root, treasury.root_id, treasury.maker_version,
        &treasury.root_content_commitment);
    let capability = maker::root_capability_registry_binding_v8(root);
    assert!(maker::capability_market_registry_id_v8(capability)
        == object::id(registry), EInvalidBinding);
    assert!(maker::capability_market_treasury_id_v8(capability)
        == object::id(treasury), EInvalidBinding);
    assert!(registry.sealed, EInvalidState);
}

public fun config_id_v8(config: &MarketPackageConfigV8): ID { object::id(config) }
public fun registry_id_v8<PaymentCoin>(registry: &MarketRegistryV8<PaymentCoin>): ID {
    object::id(registry)
}
public fun treasury_id_v8<PaymentCoin>(treasury: &MarketTreasuryV8<PaymentCoin>): ID {
    object::id(treasury)
}
public fun registry_root_id_v8<PaymentCoin>(registry: &MarketRegistryV8<PaymentCoin>): ID {
    registry.root_id
}
public fun registry_maker_version_v8<PaymentCoin>(
    registry: &MarketRegistryV8<PaymentCoin>,
): u64 { registry.maker_version }
public fun registry_root_content_commitment_v8<PaymentCoin>(
    registry: &MarketRegistryV8<PaymentCoin>,
): &vector<u8> { &registry.root_content_commitment }
public fun registry_catalog_id_v8<PaymentCoin>(
    registry: &MarketRegistryV8<PaymentCoin>,
): ID { registry.catalog_id }
public fun registry_package_config_id_v8<PaymentCoin>(
    registry: &MarketRegistryV8<PaymentCoin>,
): ID { registry.package_config_id }
public fun registry_treasury_id_v8<PaymentCoin>(
    registry: &MarketRegistryV8<PaymentCoin>,
): ID { registry.treasury_id }
public fun registry_sealed_v8<PaymentCoin>(registry: &MarketRegistryV8<PaymentCoin>): bool {
    registry.sealed
}
public fun registry_zero_state_commitment_v8<PaymentCoin>(
    registry: &MarketRegistryV8<PaymentCoin>,
): &vector<u8> { &registry.zero_state_commitment }
public fun registry_maker_market_fee_bps_v8<PaymentCoin>(
    registry: &MarketRegistryV8<PaymentCoin>,
): u16 { registry.maker_market_fee_bps }
public fun registry_soul_market_fee_bps_v8<PaymentCoin>(
    registry: &MarketRegistryV8<PaymentCoin>,
): u16 { registry.soul_market_fee_bps }
public fun registry_soul_creator_royalty_bps_v8<PaymentCoin>(
    registry: &MarketRegistryV8<PaymentCoin>,
): u16 { registry.soul_creator_royalty_bps }
public fun registry_maker_source_royalty_bps_v8<PaymentCoin>(
    registry: &MarketRegistryV8<PaymentCoin>,
): u16 { registry.maker_source_royalty_bps }
public fun registry_maker_resale_royalty_bps_v8<PaymentCoin>(
    registry: &MarketRegistryV8<PaymentCoin>,
): u16 { registry.maker_resale_royalty_bps }
public fun registry_revision_v8<PaymentCoin>(registry: &MarketRegistryV8<PaymentCoin>): u64 {
    registry.revision
}
public fun registry_listing_count_v8<PaymentCoin>(
    registry: &MarketRegistryV8<PaymentCoin>,
): u64 { registry.listing_count }
public fun registry_escrow_count_v8<PaymentCoin>(
    registry: &MarketRegistryV8<PaymentCoin>,
): u64 { registry.escrow_count }
public fun treasury_balance_v8<PaymentCoin>(treasury: &MarketTreasuryV8<PaymentCoin>): u64 {
    treasury.escrow.value()
}
public fun treasury_root_id_v8<PaymentCoin>(treasury: &MarketTreasuryV8<PaymentCoin>): ID {
    treasury.root_id
}
public fun treasury_maker_version_v8<PaymentCoin>(
    treasury: &MarketTreasuryV8<PaymentCoin>,
): u64 { treasury.maker_version }
public fun treasury_root_content_commitment_v8<PaymentCoin>(
    treasury: &MarketTreasuryV8<PaymentCoin>,
): &vector<u8> { &treasury.root_content_commitment }
public fun quote_kind_v8(quote: &MarketQuoteV8): u8 { quote.quote_kind }
public fun quote_gross_atomic_v8(quote: &MarketQuoteV8): u64 { quote.gross_atomic }
public fun quote_protocol_atomic_v8(quote: &MarketQuoteV8): u64 { quote.protocol_atomic }
public fun quote_creator_atomic_v8(quote: &MarketQuoteV8): u64 { quote.creator_atomic }
public fun quote_source_atomic_v8(quote: &MarketQuoteV8): u64 { quote.source_atomic }
public fun quote_seller_atomic_v8(quote: &MarketQuoteV8): u64 { quote.seller_atomic }
public fun quote_commitment_v8(quote: &MarketQuoteV8): &vector<u8> { &quote.commitment }

#[test_only]
fun test_hash(byte: u8): vector<u8> {
    let mut value = vector[];
    let mut index = 0;
    while (index < HASH_LENGTH) {
        value.push_back(byte);
        index = index + 1;
    };
    value
}

#[test_only]
fun destroy_config_for_testing(config: MarketPackageConfigV8) {
    let MarketPackageConfigV8 { id, version: _, catalog_id: _,
        product_binding_commitment: _, call_cap_set_commitment: _, market_call_cap } = config;
    id.delete();
    binding::destroy_call_cap_for_testing(market_call_cap);
}

#[test_only]
fun destroy_market_objects_for_testing<PaymentCoin>(
    registry: MarketRegistryV8<PaymentCoin>,
    treasury: MarketTreasuryV8<PaymentCoin>,
) {
    let MarketRegistryV8 { id: registry_id, version: _, catalog_id: _, package_config_id: _,
        product_binding_commitment: _, call_cap_set_commitment: _, root_id: _, maker_version: _,
        root_content_commitment: _, protocol_config_id: _, protocol_config_revision: _,
        protocol_config_commitment: _, economics_commitment: _, rights_commitment: _,
        maker_market_fee_bps: _, soul_market_fee_bps: _, soul_creator_royalty_bps: _,
        maker_source_royalty_bps: _, maker_resale_royalty_bps: _, treasury_id: _, sealed: _,
        revision: _, listing_count: _, escrow_count: _, completed_sale_count: _,
        canceled_sale_count: _, recovered_sale_count: _, gross_volume_atomic: _,
        protocol_paid_atomic: _, creator_paid_atomic: _, source_paid_atomic: _,
        seller_paid_atomic: _, zero_state_commitment: _ } = registry;
    let MarketTreasuryV8 { id: treasury_id, version: _, catalog_id: _, package_config_id: _,
        root_id: _, maker_version: _, root_content_commitment: _, escrow,
        gross_escrowed_atomic: _, gross_released_atomic: _ } = treasury;
    balance::destroy_zero(escrow);
    registry_id.delete();
    treasury_id.delete();
}

#[test_only]
fun new_test_fixture(ctx: &mut TxContext): (
    ProtocolConfigV8,
    ProtocolAdminCapV8,
    MakerRootV8<sui::sui::SUI>,
    BaseDefinitionRegistryV8,
    MakerTreasuryV8<sui::sui::SUI>,
    MakerAdminCapV8,
    ProductReleaseCatalogV8,
    MarketPackageConfigV8,
) {
    let (protocol_config, protocol_admin) =
        protocol::new_protocol_for_testing<sui::sui::SUI>(true, ctx);
    let root_content = test_hash(10);
    let counts = base::new_base_definition_counts_v8(1, 1, 1, 1, 0, 0);
    let commitments = base::minimal_expected_commitments_for_testing(root_content);
    let economics = maker::new_economics_snapshot_v8<sui::sui::SUI>(
        &protocol_config, maker::access_free_v8(), 0,
        maker::complete_unlimited_free_v8(), 0, 0, 0,
    );
    let rights = maker::new_onchain_native_rights_snapshot_v8(ctx, 250, 250, 500);
    let clock = sui::clock::create_for_testing(ctx);
    let (mut root, base_registry, maker_treasury, admin) =
        core::new_initial_maker_draft_v8<sui::sui::SUI>(
            &protocol_config,
            b"maker-market-test".to_string(),
            test_hash(11),
            b"walrus-manifest".to_string(),
            test_hash(12),
            root_content,
            counts,
            commitments,
            test_hash(13),
            economics,
            rights,
            &clock,
            ctx,
        );
    clock.destroy_for_testing();
    let mut catalog = binding::product_release_catalog_with_market_for_testing(
        &protocol_config,
        maker::root_core_original_package_id_v8(&root).to_address(),
        maker::root_core_callable_package_id_v8(&root).to_address(),
        std::type_name::original_id<MarketOriginalMarkerV8>(),
        std::type_name::defining_id<MarketCallableMarkerV8>(),
        ctx,
    );
    let release_witness = binding::release_catalog_witness_for_testing(&catalog);
    maker::finalize_product_release_binding_v8(
        &mut root, &admin, &protocol_config, release_witness, ctx,
    );
    let market_call_cap = binding::take_market_call_cap_v8(
        &protocol_config, &protocol_admin, &mut catalog,
    );
    let market_config = new_market_package_config_v8(&catalog, market_call_cap, ctx);
    (protocol_config, protocol_admin, root, base_registry, maker_treasury,
        admin, catalog, market_config)
}

#[test_only]
fun finish_test_fixture(
    protocol_config: ProtocolConfigV8,
    protocol_admin: ProtocolAdminCapV8,
    root: MakerRootV8<sui::sui::SUI>,
    base_registry: BaseDefinitionRegistryV8,
    maker_treasury: MakerTreasuryV8<sui::sui::SUI>,
    admin: MakerAdminCapV8,
    catalog: ProductReleaseCatalogV8,
    market_config: MarketPackageConfigV8,
    ctx: &TxContext,
) {
    destroy_config_for_testing(market_config);
    binding::destroy_catalog_for_testing(catalog);
    protocol::destroy_protocol_for_testing(protocol_config, protocol_admin);
    core::share_maker_draft_v8(root, base_registry, maker_treasury, admin, ctx);
}

#[test]
fun zero_market_state_seals_and_certifies_readiness() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 1, 0, 0, 0);
    let (protocol_config, protocol_admin, root, base_registry, maker_treasury,
        admin, catalog, market_config) = new_test_fixture(&mut ctx);
    let (mut registry, treasury) = new_market_objects_v8(
        &root, &admin, &catalog, &market_config, &mut ctx,
    );
    assert!(!registry.sealed, 99);
    assert_market_identity(&registry, &treasury, &root, &market_config);
    assert_zero_state(&registry, &treasury);
    seal_market_registry_v8(
        &mut registry,
        &treasury,
        &root,
        &admin,
        &catalog,
        &market_config,
    );
    let readiness = certify_market_activation_readiness_v8(
        &registry,
        &treasury,
        &root,
        &catalog,
        &market_config,
    );
    activation::destroy_market_readiness_for_testing(readiness);
    destroy_market_objects_for_testing(registry, treasury);
    finish_test_fixture(protocol_config, protocol_admin, root, base_registry,
        maker_treasury, admin, catalog, market_config, &ctx);
}

#[test]
fun maker_and_soul_quotes_use_frozen_fee_and_rights_terms() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 2, 0, 0, 0);
    let (protocol_config, protocol_admin, root, base_registry, maker_treasury,
        admin, catalog, market_config) = new_test_fixture(&mut ctx);
    let maker_quote = derive_quote(&root, QUOTE_MAKER_RESALE, 10_000);
    assert!(maker_quote.protocol_atomic == 250, 99);
    assert!(maker_quote.creator_atomic == 500, 99);
    assert!(maker_quote.source_atomic == 0, 99);
    assert!(maker_quote.seller_atomic == 9_250, 99);
    let soul_quote = derive_quote(&root, QUOTE_SOUL_RESALE, 10_000);
    assert!(soul_quote.protocol_atomic == 250, 99);
    assert!(soul_quote.creator_atomic == 250, 99);
    assert!(soul_quote.source_atomic == 250, 99);
    assert!(soul_quote.seller_atomic == 9_250, 99);
    assert!(maker_quote.commitment != soul_quote.commitment, 99);
    finish_test_fixture(protocol_config, protocol_admin, root, base_registry,
        maker_treasury, admin, catalog, market_config, &ctx);
}

#[test, expected_failure(abort_code = EInvalidState)]
fun any_pre_activation_listing_state_is_rejected() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 5, 0, 0, 0);
    let (protocol_config, protocol_admin, root, base_registry, maker_treasury,
        admin, catalog, market_config) = new_test_fixture(&mut ctx);
    let (mut registry, treasury) = new_market_objects(&root, &market_config, &mut ctx);
    registry.listing_count = 1;
    assert_zero_state(&registry, &treasury);
    destroy_market_objects_for_testing(registry, treasury);
    finish_test_fixture(protocol_config, protocol_admin, root, base_registry,
        maker_treasury, admin, catalog, market_config, &ctx);
}

#[test, expected_failure(abort_code = EInvalidBinding)]
fun cross_root_market_treasury_is_rejected() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 6, 0, 0, 0);
    let (protocol_config, protocol_admin, root, base_registry, maker_treasury,
        admin, catalog, market_config) = new_test_fixture(&mut ctx);
    let (registry_a, treasury_a) = new_market_objects(&root, &market_config, &mut ctx);
    let (registry_b, treasury_b) = new_market_objects(&root, &market_config, &mut ctx);
    assert_market_identity(&registry_a, &treasury_b, &root, &market_config);
    destroy_market_objects_for_testing(registry_a, treasury_a);
    destroy_market_objects_for_testing(registry_b, treasury_b);
    finish_test_fixture(protocol_config, protocol_admin, root, base_registry,
        maker_treasury, admin, catalog, market_config, &ctx);
}

#[test, expected_failure(abort_code = EInvalidAmount)]
fun zero_price_quote_is_rejected() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 7, 0, 0, 0);
    let (protocol_config, protocol_admin, root, base_registry, maker_treasury,
        admin, catalog, market_config) = new_test_fixture(&mut ctx);
    let _ = derive_quote(&root, QUOTE_SOUL_RESALE, 0);
    finish_test_fixture(protocol_config, protocol_admin, root, base_registry,
        maker_treasury, admin, catalog, market_config, &ctx);
}

#[test, expected_failure(abort_code = EShareRoundsToZero)]
fun nonzero_fee_cannot_round_to_zero() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 3, 0, 0, 0);
    let (protocol_config, protocol_admin, root, base_registry, maker_treasury,
        admin, catalog, market_config) = new_test_fixture(&mut ctx);
    let _ = derive_quote(&root, QUOTE_MAKER_RESALE, 1);
    finish_test_fixture(protocol_config, protocol_admin, root, base_registry,
        maker_treasury, admin, catalog, market_config, &ctx);
}

#[test, expected_failure(abort_code = EInvalidState)]
fun readiness_rejects_unsealed_registry() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 4, 0, 0, 0);
    let (protocol_config, protocol_admin, root, base_registry, maker_treasury,
        admin, catalog, market_config) = new_test_fixture(&mut ctx);
    let (registry, treasury) = new_market_objects(&root, &market_config, &mut ctx);
    let readiness = certify_market_activation_readiness_v8(
        &registry,
        &treasury,
        &root,
        &catalog,
        &market_config,
    );
    activation::destroy_market_readiness_for_testing(readiness);
    destroy_market_objects_for_testing(registry, treasury);
    finish_test_fixture(protocol_config, protocol_admin, root, base_registry,
        maker_treasury, admin, catalog, market_config, &ctx);
}
