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
use sui::coin::{Self as coin, Coin};
use sui::event;
use sui::transfer::Receiving;
use animacraft_v8_core::protocol_config_v8::{
    Self as protocol,
    ProtocolConfigV8,
    ProtocolTreasuryV8,
};
use animacraft_v8_core::treasury_v8::{Self as core_treasury, MakerTreasuryV8};

#[test_only]
use animacraft_v8_core::base_registry_v8::{Self as base, BaseDefinitionRegistryV8};
#[test_only]
use animacraft_v8_core::core_v8 as core;
#[test_only]
use animacraft_v8_core::protocol_config_v8::ProtocolAdminCapV8;
use animacraft_v8_output::output_v8::{
    Self as output,
    CanonicalSoulV8,
    CompleteOutputV8,
    CompleteReceiptV8,
    OutputCallableMarkerV8,
    OutputOriginalMarkerV8,
    OutputPackageConfigV8,
    OutputRegistryV8,
    SoulMarketCustodyBindingV8,
    SoulRegistryV8,
};
use animacraft_v8_physical::physical_v8::{
    Self as physical,
    PhysicalAssetV8,
    PhysicalCallableMarkerV8,
    PhysicalMarketCustodyBindingV8,
    PhysicalOriginalMarkerV8,
    PhysicalPackageConfigV8,
    PhysicalRegistryV8,
};
use animacraft_v8_runtime::runtime_v8::{
    Self as runtime,
    PackReleaseV8,
    PackTreasuryV8,
};
#[test_only]
use animacraft_v8_runtime::runtime_v8::{
    PackAdminCapV8,
    PackAdmissionAuthorityV8,
    PackRegistryV8,
    RuntimeDefinitionRegistryV8,
};
#[test_only]
use animacraft_v8_release::release_v8::{
    Self as release,
    ReleaseCallableMarkerV8,
    ReleaseOriginalMarkerV8,
    ReleasePackageConfigV8,
};
#[test_only]
use sui::sui::SUI;

const VERSION: u64 = 8;
#[test_only]
const HASH_LENGTH: u64 = 32;
const BPS_DENOMINATOR: u128 = 10_000;
const QUOTE_MAKER_RESALE: u8 = 0;
const QUOTE_SOUL_RESALE: u8 = 1;
const QUOTE_PHYSICAL_RESALE: u8 = 2;
const LISTING_OPEN: u8 = 0;
const LISTING_SETTLED: u8 = 1;
const LISTING_CANCELED: u8 = 2;
const LISTING_RECOVERED: u8 = 3;
const LANE_MAKER: u8 = 0;
const LANE_SOUL: u8 = 1;
const LANE_PHYSICAL_BASE: u8 = 2;
const LANE_PHYSICAL_PACK: u8 = 3;

const EInvalidConfig: u64 = 0;
const EInvalidBinding: u64 = 1;
const EInvalidCommitment: u64 = 2;
const EInvalidState: u64 = 3;
const EInvalidAmount: u64 = 4;
const EShareRoundsToZero: u64 = 5;
const EInvalidListing: u64 = 6;
const EInvalidPayment: u64 = 7;
const ENotSeller: u64 = 8;
const ENotRecoverable: u64 = 9;

public struct MarketOriginalMarkerV8 has drop {}
public struct MarketCallableMarkerV8 has drop {}

#[test_only]
public struct MarketIntegrationObjectV8 has key { id: UID }

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

/// One exact Maker control sale. The real key-only AdminCap is a child of
/// this object's UID while `status == LISTING_OPEN`.
public struct MakerListingV8<phantom PaymentCoin> has key {
    id: UID,
    version: u64,
    registry_id: ID,
    treasury_id: ID,
    package_config_id: ID,
    root_id: ID,
    maker_version: u64,
    root_content_commitment: vector<u8>,
    admin_cap_id: ID,
    seller: address,
    expected_control_epoch: u64,
    gross_atomic: u64,
    protocol_atomic: u64,
    creator_atomic: u64,
    seller_atomic: u64,
    quote_commitment: vector<u8>,
    status: u8,
    revision: u64,
    terminal_recipient: address,
}

/// One indivisible CompleteOutput + CompleteReceipt + CanonicalSoul listing.
/// The three real key-only children are owned by this object's UID while open.
public struct SoulListingV8<phantom PaymentCoin> has key {
    id: UID,
    version: u64,
    registry_id: ID,
    treasury_id: ID,
    package_config_id: ID,
    custody: SoulMarketCustodyBindingV8,
    gross_atomic: u64,
    protocol_atomic: u64,
    creator_atomic: u64,
    source_atomic: u64,
    seller_atomic: u64,
    quote_commitment: vector<u8>,
    status: u8,
    revision: u64,
    terminal_recipient: address,
}

/// One transferable Physical asset listing. Base and Pack settlement remain
/// statically separate public entry points and are rechecked against custody.
public struct PhysicalListingV8<phantom PaymentCoin> has key {
    id: UID,
    version: u64,
    registry_id: ID,
    treasury_id: ID,
    package_config_id: ID,
    custody: PhysicalMarketCustodyBindingV8,
    gross_atomic: u64,
    protocol_atomic: u64,
    creator_atomic: u64,
    source_atomic: u64,
    seller_atomic: u64,
    quote_commitment: vector<u8>,
    status: u8,
    revision: u64,
    terminal_recipient: address,
}

public struct MarketListingOpenedV8 has copy, drop {
    listing_id: ID,
    registry_id: ID,
    lane: u8,
    root_id: ID,
    asset_id: ID,
    seller: address,
    ownership_epoch: u64,
    gross_atomic: u64,
    quote_commitment: vector<u8>,
}

public struct MarketListingSettledV8 has copy, drop {
    listing_id: ID,
    registry_id: ID,
    lane: u8,
    asset_id: ID,
    seller: address,
    buyer: address,
    gross_atomic: u64,
    protocol_atomic: u64,
    creator_atomic: u64,
    source_atomic: u64,
    seller_atomic: u64,
}

public struct MarketListingClosedV8 has copy, drop {
    listing_id: ID,
    registry_id: ID,
    lane: u8,
    asset_id: ID,
    seller: address,
    recovered: bool,
}

public fun version_v8(): u64 { VERSION }
public fun quote_maker_resale_kind_v8(): u8 { QUOTE_MAKER_RESALE }
public fun quote_soul_resale_kind_v8(): u8 { QUOTE_SOUL_RESALE }
public fun quote_physical_resale_kind_v8(): u8 { QUOTE_PHYSICAL_RESALE }
public fun listing_open_v8(): u8 { LISTING_OPEN }
public fun listing_settled_v8(): u8 { LISTING_SETTLED }
public fun listing_canceled_v8(): u8 { LISTING_CANCELED }
public fun listing_recovered_v8(): u8 { LISTING_RECOVERED }

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

public fun quote_physical_resale_v8<PaymentCoin>(
    registry: &MarketRegistryV8<PaymentCoin>,
    treasury: &MarketTreasuryV8<PaymentCoin>,
    root: &MakerRootV8<PaymentCoin>,
    gross_atomic: u64,
): MarketQuoteV8 {
    assert_active_market(registry, treasury, root);
    derive_quote(root, QUOTE_PHYSICAL_RESALE, gross_atomic)
}

/// Lists the exact current MakerAdminCap. The Root must be PAUSED and its
/// MakerTreasury empty, so control custody cannot strand accrued revenue.
public fun list_maker_control_v8<PaymentCoin>(
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
    assert_config(root, catalog, config);
    assert_bound_market(registry, treasury, root, config);
    assert!(maker::root_lifecycle_v8(root) == maker::lifecycle_paused_v8(),
        EInvalidState);
    maker::assert_current_protocol_config_v8(root, protocol_config);
    core_treasury::assert_maker_treasury_v8(root, maker_treasury);
    assert!(core_treasury::maker_treasury_balance_v8(maker_treasury) == 0,
        EInvalidState);
    maker::assert_admin_v8(root, &admin);
    let seller = maker::root_owner_v8(root);
    assert!(seller == ctx.sender(), ENotSeller);
    let admin_cap_id = maker::admin_id_v8(&admin);
    let expected_control_epoch = maker::root_control_epoch_v8(root);
    let quote = derive_quote(root, QUOTE_MAKER_RESALE, gross_atomic);
    let mut listing = MakerListingV8<PaymentCoin> {
        id: object::new(ctx),
        version: VERSION,
        registry_id: object::id(registry),
        treasury_id: object::id(treasury),
        package_config_id: object::id(config),
        root_id: maker::root_id_v8(root),
        maker_version: maker::root_maker_version_v8(root),
        root_content_commitment: *maker::root_content_commitment_v8(root),
        admin_cap_id,
        seller,
        expected_control_epoch,
        gross_atomic,
        protocol_atomic: quote.protocol_atomic,
        creator_atomic: quote.creator_atomic,
        seller_atomic: quote.seller_atomic,
        quote_commitment: quote.commitment,
        status: LISTING_OPEN,
        revision: 0,
        terminal_recipient: @0x0,
    };
    maker::custody_maker_admin_for_market_v8(
        root,
        admin,
        catalog,
        &config.market_call_cap,
        &mut listing.id,
    );
    open_listing(registry);
    let listing_id = object::id(&listing);
    event::emit(MarketListingOpenedV8 {
        listing_id,
        registry_id: object::id(registry),
        lane: LANE_MAKER,
        root_id: maker::root_id_v8(root),
        asset_id: admin_cap_id,
        seller,
        ownership_epoch: expected_control_epoch,
        gross_atomic,
        quote_commitment: quote.commitment,
    });
    transfer::share_object(listing);
    listing_id
}

/// Exact-payment Maker control purchase. Payment enters MarketTreasury before
/// splitting and the escrow balance returns to zero in this same transaction.
public fun purchase_maker_control_v8<PaymentCoin>(
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
    assert_config(root, catalog, config);
    assert_bound_market(registry, treasury, root, config);
    assert_maker_listing(listing, registry, treasury, root, config);
    assert!(maker::root_lifecycle_v8(root) == maker::lifecycle_paused_v8(),
        EInvalidState);
    maker::assert_current_protocol_config_v8(root, protocol_config);
    assert!(maker::root_owner_v8(root) == listing.seller, EInvalidListing);
    assert!(maker::root_control_epoch_v8(root) == listing.expected_control_epoch,
        EInvalidListing);
    assert!(transfer::receiving_object_id(&receiving) == listing.admin_cap_id,
        EInvalidListing);
    let buyer = ctx.sender();
    assert!(buyer != listing.seller, ENotSeller);
    let quote = derive_quote(root, QUOTE_MAKER_RESALE, listing.gross_atomic);
    assert_maker_quote(listing, &quote);
    escrow_payment(treasury, payment, listing.gross_atomic);
    maker::resolve_maker_admin_from_market_v8(
        root,
        catalog,
        &config.market_call_cap,
        &mut listing.id,
        receiving,
        buyer,
        ctx,
    );
    release_maker_payment(
        treasury,
        protocol_config,
        protocol_treasury,
        maker::root_creator_v8(root),
        listing.seller,
        &quote,
        ctx,
    );
    settle_listing(registry, listing.gross_atomic, &quote);
    listing.status = LISTING_SETTLED;
    listing.revision = listing.revision + 1;
    listing.terminal_recipient = buyer;
    event::emit(MarketListingSettledV8 {
        listing_id: object::id(listing),
        registry_id: object::id(registry),
        lane: LANE_MAKER,
        asset_id: listing.admin_cap_id,
        seller: listing.seller,
        buyer,
        gross_atomic: quote.gross_atomic,
        protocol_atomic: quote.protocol_atomic,
        creator_atomic: quote.creator_atomic,
        source_atomic: 0,
        seller_atomic: quote.seller_atomic,
    })
}

/// Seller cancellation never consults protocol enabled/current state.
public fun cancel_maker_control_listing_v8<PaymentCoin>(
    listing: &mut MakerListingV8<PaymentCoin>,
    registry: &mut MarketRegistryV8<PaymentCoin>,
    treasury: &MarketTreasuryV8<PaymentCoin>,
    root: &mut MakerRootV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
    config: &MarketPackageConfigV8,
    receiving: Receiving<MakerAdminCapV8>,
    ctx: &mut TxContext,
) {
    assert_config(root, catalog, config);
    assert_bound_market(registry, treasury, root, config);
    assert_maker_listing(listing, registry, treasury, root, config);
    assert!(ctx.sender() == listing.seller, ENotSeller);
    assert!(transfer::receiving_object_id(&receiving) == listing.admin_cap_id,
        EInvalidListing);
    maker::resolve_maker_admin_from_market_v8(
        root,
        catalog,
        &config.market_call_cap,
        &mut listing.id,
        receiving,
        listing.seller,
        ctx,
    );
    close_listing(registry, listing, false)
}

/// Anyone may recover an archived Maker listing, or one whose exact protocol
/// config is disabled/drifted. The AdminCap always returns to stored seller.
public fun recover_maker_control_listing_v8<PaymentCoin>(
    listing: &mut MakerListingV8<PaymentCoin>,
    registry: &mut MarketRegistryV8<PaymentCoin>,
    treasury: &MarketTreasuryV8<PaymentCoin>,
    root: &mut MakerRootV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    config: &MarketPackageConfigV8,
    receiving: Receiving<MakerAdminCapV8>,
    ctx: &mut TxContext,
) {
    assert_config(root, catalog, config);
    assert_bound_market(registry, treasury, root, config);
    assert_maker_listing(listing, registry, treasury, root, config);
    assert!(protocol::config_id_v8(protocol_config) == registry.protocol_config_id,
        EInvalidBinding);
    assert!(maker::root_lifecycle_v8(root) == maker::lifecycle_archived_v8()
        || protocol_degraded(registry, protocol_config), ENotRecoverable);
    assert!(transfer::receiving_object_id(&receiving) == listing.admin_cap_id,
        EInvalidListing);
    maker::resolve_maker_admin_from_market_v8(
        root,
        catalog,
        &config.market_call_cap,
        &mut listing.id,
        receiving,
        listing.seller,
        ctx,
    );
    close_listing(registry, listing, true)
}

/// Lists one exact Soul bundle. Output derives the no-ability ticket from the
/// three live objects and atomically moves all of them below this listing UID.
public fun list_soul_bundle_v8<PaymentCoin>(
    registry: &mut MarketRegistryV8<PaymentCoin>,
    treasury: &MarketTreasuryV8<PaymentCoin>,
    output_registry: &OutputRegistryV8,
    soul_registry: &SoulRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    config: &MarketPackageConfigV8,
    output_asset: CompleteOutputV8,
    receipt: CompleteReceiptV8,
    soul: CanonicalSoulV8,
    gross_atomic: u64,
    ctx: &mut TxContext,
): ID {
    assert_config(root, catalog, config);
    assert_bound_market(registry, treasury, root, config);
    assert_active_market(registry, treasury, root);
    maker::assert_current_protocol_config_v8(root, protocol_config);
    let quote = derive_quote(root, QUOTE_SOUL_RESALE, gross_atomic);
    let mut listing_uid = object::new(ctx);
    let ticket = output::custody_soul_bundle_for_market_v8<
        PaymentCoin,
        MarketOriginalMarkerV8,
        MarketCallableMarkerV8,
        MarketRegistryV8<PaymentCoin>,
        MarketTreasuryV8<PaymentCoin>,
    >(
        output_asset,
        receipt,
        soul,
        &mut listing_uid,
        output_registry,
        soul_registry,
        root,
        protocol_config,
        catalog,
        registry,
        treasury,
        &config.market_call_cap,
        ctx,
    );
    let custody = output::consume_soul_market_custody_ticket_v8<
        PaymentCoin,
        MarketOriginalMarkerV8,
        MarketCallableMarkerV8,
        MarketRegistryV8<PaymentCoin>,
        MarketTreasuryV8<PaymentCoin>,
    >(
        ticket,
        &listing_uid,
        output_registry,
        soul_registry,
        root,
        catalog,
        registry,
        treasury,
        &config.market_call_cap,
    );
    assert_soul_open_binding(&listing_uid, registry, treasury, root, ctx, &custody);
    let seller = output::soul_market_seller_v8(&custody);
    let soul_id = output::soul_market_soul_id_v8(&custody);
    let ownership_epoch = output::soul_market_expected_epoch_v8(&custody);
    let listing = SoulListingV8<PaymentCoin> {
        id: listing_uid,
        version: VERSION,
        registry_id: object::id(registry),
        treasury_id: object::id(treasury),
        package_config_id: object::id(config),
        custody,
        gross_atomic,
        protocol_atomic: quote.protocol_atomic,
        creator_atomic: quote.creator_atomic,
        source_atomic: quote.source_atomic,
        seller_atomic: quote.seller_atomic,
        quote_commitment: quote.commitment,
        status: LISTING_OPEN,
        revision: 0,
        terminal_recipient: @0x0,
    };
    open_listing(registry);
    let listing_id = object::id(&listing);
    event::emit(MarketListingOpenedV8 {
        listing_id,
        registry_id: object::id(registry),
        lane: LANE_SOUL,
        root_id: maker::root_id_v8(root),
        asset_id: soul_id,
        seller,
        ownership_epoch,
        gross_atomic,
        quote_commitment: quote.commitment,
    });
    transfer::share_object(listing);
    listing_id
}

/// Exact-payment Soul sale. Output receives and validates all three children
/// before changing their holders and advancing the Soul epoch exactly once.
public fun purchase_soul_bundle_v8<PaymentCoin>(
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
    assert_config(root, catalog, config);
    assert_bound_market(registry, treasury, root, config);
    assert_active_market(registry, treasury, root);
    assert_soul_listing(listing, registry, treasury, root, config);
    maker::assert_current_protocol_config_v8(root, protocol_config);
    core_treasury::assert_maker_treasury_v8(root, maker_treasury);
    let buyer = ctx.sender();
    assert!(buyer != output::soul_market_seller_v8(&listing.custody), ENotSeller);
    let quote = derive_quote(root, QUOTE_SOUL_RESALE, listing.gross_atomic);
    assert_asset_quote(
        listing.gross_atomic,
        listing.protocol_atomic,
        listing.creator_atomic,
        listing.source_atomic,
        listing.seller_atomic,
        &listing.quote_commitment,
        QUOTE_SOUL_RESALE,
        &quote,
    );
    escrow_payment(treasury, payment, listing.gross_atomic);
    output::purchase_soul_bundle_from_market_v8<
        PaymentCoin,
        MarketOriginalMarkerV8,
        MarketCallableMarkerV8,
        MarketRegistryV8<PaymentCoin>,
        MarketTreasuryV8<PaymentCoin>,
    >(
        output_receiving,
        receipt_receiving,
        soul_receiving,
        &mut listing.id,
        &listing.custody,
        output_registry,
        soul_registry,
        root,
        protocol_config,
        catalog,
        registry,
        treasury,
        &config.market_call_cap,
        buyer,
    );
    release_maker_source_payment(
        treasury,
        root,
        maker_treasury,
        protocol_config,
        protocol_treasury,
        output::soul_market_seller_v8(&listing.custody),
        &quote,
        ctx,
    );
    settle_listing(registry, listing.gross_atomic, &quote);
    listing.status = LISTING_SETTLED;
    listing.revision = listing.revision + 1;
    listing.terminal_recipient = buyer;
    event::emit(MarketListingSettledV8 {
        listing_id: object::id(listing),
        registry_id: object::id(registry),
        lane: LANE_SOUL,
        asset_id: output::soul_market_soul_id_v8(&listing.custody),
        seller: output::soul_market_seller_v8(&listing.custody),
        buyer,
        gross_atomic: quote.gross_atomic,
        protocol_atomic: quote.protocol_atomic,
        creator_atomic: quote.creator_atomic,
        source_atomic: quote.source_atomic,
        seller_atomic: quote.seller_atomic,
    })
}

/// Seller escape hatch. No ACTIVE/current-protocol assertion is performed.
public fun cancel_soul_listing_v8<PaymentCoin>(
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
    assert_config(root, catalog, config);
    assert_bound_market(registry, treasury, root, config);
    assert_soul_listing(listing, registry, treasury, root, config);
    assert!(ctx.sender() == output::soul_market_seller_v8(&listing.custody), ENotSeller);
    output::return_soul_bundle_from_market_v8<
        PaymentCoin,
        MarketOriginalMarkerV8,
        MarketCallableMarkerV8,
        MarketRegistryV8<PaymentCoin>,
        MarketTreasuryV8<PaymentCoin>,
    >(
        output_receiving,
        receipt_receiving,
        soul_receiving,
        &mut listing.id,
        &listing.custody,
        output_registry,
        soul_registry,
        root,
        catalog,
        registry,
        treasury,
        &config.market_call_cap,
    );
    close_soul_listing(registry, listing, false)
}

/// Permissionless recovery for PAUSED/ARCHIVED or disabled/drifted protocol.
public fun recover_soul_listing_v8<PaymentCoin>(
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
    assert_config(root, catalog, config);
    assert_bound_market(registry, treasury, root, config);
    assert_soul_listing(listing, registry, treasury, root, config);
    assert_protocol_object(registry, protocol_config);
    assert!(asset_recoverable(registry, root, protocol_config), ENotRecoverable);
    output::return_soul_bundle_from_market_v8<
        PaymentCoin,
        MarketOriginalMarkerV8,
        MarketCallableMarkerV8,
        MarketRegistryV8<PaymentCoin>,
        MarketTreasuryV8<PaymentCoin>,
    >(
        output_receiving,
        receipt_receiving,
        soul_receiving,
        &mut listing.id,
        &listing.custody,
        output_registry,
        soul_registry,
        root,
        catalog,
        registry,
        treasury,
        &config.market_call_cap,
    );
    close_soul_listing(registry, listing, true)
}

/// Lists one exact transferable Base-sourced Physical asset.
public fun list_base_physical_v8<PaymentCoin>(
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
    assert_config(root, catalog, config);
    assert_bound_market(registry, treasury, root, config);
    assert_active_market(registry, treasury, root);
    maker::assert_current_protocol_config_v8(root, protocol_config);
    let quote = derive_quote(root, QUOTE_PHYSICAL_RESALE, gross_atomic);
    let mut listing_uid = object::new(ctx);
    let ticket = physical::custody_base_physical_for_market_v8<
        PaymentCoin,
        MarketOriginalMarkerV8,
        MarketCallableMarkerV8,
        MarketRegistryV8<PaymentCoin>,
        MarketTreasuryV8<PaymentCoin>,
    >(
        physical_registry,
        root,
        protocol_config,
        catalog,
        physical_config,
        &config.market_call_cap,
        registry,
        treasury,
        &mut listing_uid,
        maker_treasury,
        asset,
        ctx,
    );
    let custody = physical::consume_physical_market_custody_ticket_v8(ticket);
    assert_physical_open_binding(
        &listing_uid,
        registry,
        treasury,
        root,
        ctx,
        physical::source_base_style_v8(),
        &custody,
    );
    let listing = PhysicalListingV8<PaymentCoin> {
        id: listing_uid,
        version: VERSION,
        registry_id: object::id(registry),
        treasury_id: object::id(treasury),
        package_config_id: object::id(config),
        custody,
        gross_atomic: quote.gross_atomic,
        protocol_atomic: quote.protocol_atomic,
        creator_atomic: quote.creator_atomic,
        source_atomic: quote.source_atomic,
        seller_atomic: quote.seller_atomic,
        quote_commitment: quote.commitment,
        status: LISTING_OPEN,
        revision: 0,
        terminal_recipient: @0x0,
    };
    share_physical_listing(listing, registry, root, LANE_PHYSICAL_BASE)
}

/// Statically separate Pack listing path; source treasury identity comes only
/// from the exact live PackTreasury and immutable Physical provenance.
public fun list_pack_physical_v8<PaymentCoin>(
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
    assert_config(root, catalog, config);
    assert_bound_market(registry, treasury, root, config);
    assert_active_market(registry, treasury, root);
    maker::assert_current_protocol_config_v8(root, protocol_config);
    let quote = derive_quote(root, QUOTE_PHYSICAL_RESALE, gross_atomic);
    let mut listing_uid = object::new(ctx);
    let ticket = physical::custody_pack_physical_for_market_v8<
        PaymentCoin,
        MarketOriginalMarkerV8,
        MarketCallableMarkerV8,
        MarketRegistryV8<PaymentCoin>,
        MarketTreasuryV8<PaymentCoin>,
    >(
        physical_registry,
        root,
        protocol_config,
        catalog,
        physical_config,
        &config.market_call_cap,
        registry,
        treasury,
        &mut listing_uid,
        pack_treasury,
        asset,
        ctx,
    );
    let custody = physical::consume_physical_market_custody_ticket_v8(ticket);
    assert_physical_open_binding(
        &listing_uid,
        registry,
        treasury,
        root,
        ctx,
        physical::source_pack_style_v8(),
        &custody,
    );
    let listing = PhysicalListingV8<PaymentCoin> {
        id: listing_uid,
        version: VERSION,
        registry_id: object::id(registry),
        treasury_id: object::id(treasury),
        package_config_id: object::id(config),
        custody,
        gross_atomic: quote.gross_atomic,
        protocol_atomic: quote.protocol_atomic,
        creator_atomic: quote.creator_atomic,
        source_atomic: quote.source_atomic,
        seller_atomic: quote.seller_atomic,
        quote_commitment: quote.commitment,
        status: LISTING_OPEN,
        revision: 0,
        terminal_recipient: @0x0,
    };
    share_physical_listing(listing, registry, root, LANE_PHYSICAL_PACK)
}

public fun purchase_base_physical_v8<PaymentCoin>(
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
    assert_physical_purchase_boundary(
        listing,
        registry,
        treasury,
        root,
        protocol_config,
        catalog,
        config,
        physical::source_base_style_v8(),
    );
    core_treasury::assert_maker_treasury_v8(root, maker_treasury);
    let quote = derive_quote(root, QUOTE_PHYSICAL_RESALE, listing.gross_atomic);
    assert_physical_quote(listing, &quote);
    escrow_payment(treasury, payment, listing.gross_atomic);
    physical::purchase_base_physical_from_market_v8<
        PaymentCoin,
        MarketOriginalMarkerV8,
        MarketCallableMarkerV8,
        MarketRegistryV8<PaymentCoin>,
        MarketTreasuryV8<PaymentCoin>,
    >(
        physical_registry,
        root,
        protocol_config,
        catalog,
        physical_config,
        &config.market_call_cap,
        registry,
        treasury,
        &mut listing.id,
        maker_treasury,
        receiving,
        &listing.custody,
        ctx,
    );
    let buyer = ctx.sender();
    release_maker_source_payment(
        treasury,
        root,
        maker_treasury,
        protocol_config,
        protocol_treasury,
        physical::physical_market_custody_holder_v8(&listing.custody),
        &quote,
        ctx,
    );
    settle_physical_sale(listing, registry, &quote, buyer, LANE_PHYSICAL_BASE)
}

public fun purchase_pack_physical_v8<PaymentCoin>(
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
    assert_physical_purchase_boundary(
        listing,
        registry,
        treasury,
        root,
        protocol_config,
        catalog,
        config,
        physical::source_pack_style_v8(),
    );
    let quote = derive_quote(root, QUOTE_PHYSICAL_RESALE, listing.gross_atomic);
    assert_physical_quote(listing, &quote);
    escrow_payment(treasury, payment, listing.gross_atomic);
    physical::purchase_pack_physical_from_market_v8<
        PaymentCoin,
        MarketOriginalMarkerV8,
        MarketCallableMarkerV8,
        MarketRegistryV8<PaymentCoin>,
        MarketTreasuryV8<PaymentCoin>,
    >(
        physical_registry,
        root,
        protocol_config,
        catalog,
        physical_config,
        &config.market_call_cap,
        registry,
        treasury,
        &mut listing.id,
        pack_treasury,
        receiving,
        &listing.custody,
        ctx,
    );
    let buyer = ctx.sender();
    release_pack_source_payment(
        treasury,
        pack_release,
        pack_treasury,
        protocol_config,
        protocol_treasury,
        maker::root_creator_v8(root),
        physical::physical_market_custody_holder_v8(&listing.custody),
        &quote,
        ctx,
    );
    settle_physical_sale(listing, registry, &quote, buyer, LANE_PHYSICAL_PACK)
}

/// Seller cancellation is source-agnostic and remains available in every
/// lifecycle/protocol state because Physical's return hook does not gate it.
public fun cancel_physical_listing_v8<PaymentCoin>(
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
    assert_config(root, catalog, config);
    assert_bound_market(registry, treasury, root, config);
    assert_physical_listing(listing, registry, treasury, root, config);
    assert!(ctx.sender()
        == physical::physical_market_custody_holder_v8(&listing.custody), ENotSeller);
    physical::return_physical_from_market_v8<
        PaymentCoin,
        MarketOriginalMarkerV8,
        MarketCallableMarkerV8,
        MarketRegistryV8<PaymentCoin>,
        MarketTreasuryV8<PaymentCoin>,
    >(
        physical_registry,
        root,
        catalog,
        &config.market_call_cap,
        registry,
        treasury,
        &mut listing.id,
        receiving,
        &listing.custody,
    );
    close_physical_listing(registry, listing, false)
}

public fun recover_physical_listing_v8<PaymentCoin>(
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
    assert_config(root, catalog, config);
    assert_bound_market(registry, treasury, root, config);
    assert_physical_listing(listing, registry, treasury, root, config);
    assert_protocol_object(registry, protocol_config);
    assert!(asset_recoverable(registry, root, protocol_config), ENotRecoverable);
    physical::return_physical_from_market_v8<
        PaymentCoin,
        MarketOriginalMarkerV8,
        MarketCallableMarkerV8,
        MarketRegistryV8<PaymentCoin>,
        MarketTreasuryV8<PaymentCoin>,
    >(
        physical_registry,
        root,
        catalog,
        &config.market_call_cap,
        registry,
        treasury,
        &mut listing.id,
        receiving,
        &listing.custody,
    );
    close_physical_listing(registry, listing, true)
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
        assert!(quote_kind == QUOTE_SOUL_RESALE
            || quote_kind == QUOTE_PHYSICAL_RESALE, EInvalidState);
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

fun assert_bound_market<PaymentCoin>(
    registry: &MarketRegistryV8<PaymentCoin>,
    treasury: &MarketTreasuryV8<PaymentCoin>,
    root: &MakerRootV8<PaymentCoin>,
    config: &MarketPackageConfigV8,
) {
    assert_market_identity(registry, treasury, root, config);
    assert!(registry.sealed, EInvalidState);
    let capability = maker::root_capability_registry_binding_v8(root);
    assert!(maker::capability_market_registry_id_v8(capability)
        == object::id(registry), EInvalidBinding);
    assert!(maker::capability_market_treasury_id_v8(capability)
        == object::id(treasury), EInvalidBinding);
}

fun assert_maker_listing<PaymentCoin>(
    listing: &MakerListingV8<PaymentCoin>,
    registry: &MarketRegistryV8<PaymentCoin>,
    treasury: &MarketTreasuryV8<PaymentCoin>,
    root: &MakerRootV8<PaymentCoin>,
    config: &MarketPackageConfigV8,
) {
    assert!(listing.version == VERSION && listing.status == LISTING_OPEN,
        EInvalidListing);
    assert!(listing.registry_id == object::id(registry)
        && listing.treasury_id == object::id(treasury)
        && listing.package_config_id == object::id(config), EInvalidListing);
    maker::assert_root_identity_v8(
        root,
        listing.root_id,
        listing.maker_version,
        &listing.root_content_commitment,
    );
    assert!(listing.seller != @0x0 && listing.gross_atomic > 0,
        EInvalidListing);
}

fun assert_maker_quote<PaymentCoin>(
    listing: &MakerListingV8<PaymentCoin>,
    quote: &MarketQuoteV8,
) {
    assert!(quote.quote_kind == QUOTE_MAKER_RESALE
        && quote.gross_atomic == listing.gross_atomic
        && quote.protocol_atomic == listing.protocol_atomic
        && quote.creator_atomic == listing.creator_atomic
        && quote.source_atomic == 0
        && quote.seller_atomic == listing.seller_atomic
        && quote.commitment == listing.quote_commitment, EInvalidCommitment);
}

fun assert_asset_quote(
    gross_atomic: u64,
    protocol_atomic: u64,
    creator_atomic: u64,
    source_atomic: u64,
    seller_atomic: u64,
    quote_commitment: &vector<u8>,
    quote_kind: u8,
    quote: &MarketQuoteV8,
) {
    assert!(quote.quote_kind == quote_kind
        && quote.gross_atomic == gross_atomic
        && quote.protocol_atomic == protocol_atomic
        && quote.creator_atomic == creator_atomic
        && quote.source_atomic == source_atomic
        && quote.seller_atomic == seller_atomic
        && &quote.commitment == quote_commitment, EInvalidCommitment);
}

fun assert_soul_open_binding<PaymentCoin>(
    listing_uid: &UID,
    registry: &MarketRegistryV8<PaymentCoin>,
    treasury: &MarketTreasuryV8<PaymentCoin>,
    root: &MakerRootV8<PaymentCoin>,
    ctx: &TxContext,
    custody: &SoulMarketCustodyBindingV8,
) {
    assert!(output::soul_market_listing_id_v8(custody) == listing_uid.to_inner()
        && output::soul_market_market_registry_id_v8(custody) == object::id(registry)
        && output::soul_market_market_treasury_id_v8(custody) == object::id(treasury),
        EInvalidListing);
    maker::assert_root_identity_v8(
        root,
        output::soul_market_root_id_v8(custody),
        output::soul_market_maker_version_v8(custody),
        output::soul_market_root_content_commitment_v8(custody),
    );
    assert!(output::soul_market_seller_v8(custody) == ctx.sender()
        && ctx.sender() != @0x0, ENotSeller);
}

fun assert_soul_listing<PaymentCoin>(
    listing: &SoulListingV8<PaymentCoin>,
    registry: &MarketRegistryV8<PaymentCoin>,
    treasury: &MarketTreasuryV8<PaymentCoin>,
    root: &MakerRootV8<PaymentCoin>,
    config: &MarketPackageConfigV8,
) {
    assert!(listing.version == VERSION && listing.status == LISTING_OPEN,
        EInvalidListing);
    assert!(listing.registry_id == object::id(registry)
        && listing.treasury_id == object::id(treasury)
        && listing.package_config_id == object::id(config), EInvalidListing);
    assert!(output::soul_market_listing_id_v8(&listing.custody)
        == object::id(listing), EInvalidListing);
    maker::assert_root_identity_v8(
        root,
        output::soul_market_root_id_v8(&listing.custody),
        output::soul_market_maker_version_v8(&listing.custody),
        output::soul_market_root_content_commitment_v8(&listing.custody),
    );
    assert!(output::soul_market_seller_v8(&listing.custody) != @0x0
        && listing.gross_atomic > 0, EInvalidListing);
}

fun assert_physical_open_binding<PaymentCoin>(
    listing_uid: &UID,
    registry: &MarketRegistryV8<PaymentCoin>,
    treasury: &MarketTreasuryV8<PaymentCoin>,
    root: &MakerRootV8<PaymentCoin>,
    ctx: &TxContext,
    expected_source_kind: u8,
    custody: &PhysicalMarketCustodyBindingV8,
) {
    assert!(physical::physical_market_custody_listing_id_v8(custody)
        == listing_uid.to_inner()
        && physical::physical_market_custody_market_registry_id_v8(custody)
        == object::id(registry)
        && physical::physical_market_custody_market_treasury_id_v8(custody)
        == object::id(treasury), EInvalidListing);
    maker::assert_root_identity_v8(
        root,
        physical::physical_market_custody_root_id_v8(custody),
        physical::physical_market_custody_maker_version_v8(custody),
        physical::physical_market_custody_root_content_commitment_v8(custody),
    );
    assert!(physical::physical_market_custody_source_kind_v8(custody)
        == expected_source_kind, EInvalidListing);
    assert!(physical::physical_market_custody_holder_v8(custody) == ctx.sender()
        && ctx.sender() != @0x0, ENotSeller);
    assert!(physical::physical_market_custody_transferable_v8(custody),
        EInvalidListing);
}

fun share_physical_listing<PaymentCoin>(
    listing: PhysicalListingV8<PaymentCoin>,
    registry: &mut MarketRegistryV8<PaymentCoin>,
    root: &MakerRootV8<PaymentCoin>,
    lane: u8,
): ID {
    let asset_id = physical::physical_market_custody_asset_id_v8(&listing.custody);
    let seller = physical::physical_market_custody_holder_v8(&listing.custody);
    let ownership_epoch =
        physical::physical_market_custody_ownership_epoch_v8(&listing.custody);
    open_listing(registry);
    let listing_id = object::id(&listing);
    event::emit(MarketListingOpenedV8 {
        listing_id,
        registry_id: object::id(registry),
        lane,
        root_id: maker::root_id_v8(root),
        asset_id,
        seller,
        ownership_epoch,
        gross_atomic: listing.gross_atomic,
        quote_commitment: listing.quote_commitment,
    });
    transfer::share_object(listing);
    listing_id
}

fun assert_physical_listing<PaymentCoin>(
    listing: &PhysicalListingV8<PaymentCoin>,
    registry: &MarketRegistryV8<PaymentCoin>,
    treasury: &MarketTreasuryV8<PaymentCoin>,
    root: &MakerRootV8<PaymentCoin>,
    config: &MarketPackageConfigV8,
) {
    assert!(listing.version == VERSION && listing.status == LISTING_OPEN,
        EInvalidListing);
    assert!(listing.registry_id == object::id(registry)
        && listing.treasury_id == object::id(treasury)
        && listing.package_config_id == object::id(config), EInvalidListing);
    assert!(physical::physical_market_custody_listing_id_v8(&listing.custody)
        == object::id(listing), EInvalidListing);
    maker::assert_root_identity_v8(
        root,
        physical::physical_market_custody_root_id_v8(&listing.custody),
        physical::physical_market_custody_maker_version_v8(&listing.custody),
        physical::physical_market_custody_root_content_commitment_v8(&listing.custody),
    );
    assert!(physical::physical_market_custody_holder_v8(&listing.custody) != @0x0
        && listing.gross_atomic > 0, EInvalidListing);
}

fun assert_physical_purchase_boundary<PaymentCoin>(
    listing: &PhysicalListingV8<PaymentCoin>,
    registry: &MarketRegistryV8<PaymentCoin>,
    treasury: &MarketTreasuryV8<PaymentCoin>,
    root: &MakerRootV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    config: &MarketPackageConfigV8,
    expected_source_kind: u8,
) {
    assert_config(root, catalog, config);
    assert_bound_market(registry, treasury, root, config);
    assert_active_market(registry, treasury, root);
    assert_physical_listing(listing, registry, treasury, root, config);
    maker::assert_current_protocol_config_v8(root, protocol_config);
    assert!(physical::physical_market_custody_source_kind_v8(&listing.custody)
        == expected_source_kind, EInvalidListing);
}

fun assert_physical_quote<PaymentCoin>(
    listing: &PhysicalListingV8<PaymentCoin>,
    quote: &MarketQuoteV8,
) {
    assert_asset_quote(
        listing.gross_atomic,
        listing.protocol_atomic,
        listing.creator_atomic,
        listing.source_atomic,
        listing.seller_atomic,
        &listing.quote_commitment,
        QUOTE_PHYSICAL_RESALE,
        quote,
    )
}

fun assert_protocol_object<PaymentCoin>(
    registry: &MarketRegistryV8<PaymentCoin>,
    config: &ProtocolConfigV8,
) {
    assert!(protocol::config_id_v8(config) == registry.protocol_config_id,
        EInvalidBinding)
}

fun asset_recoverable<PaymentCoin>(
    registry: &MarketRegistryV8<PaymentCoin>,
    root: &MakerRootV8<PaymentCoin>,
    config: &ProtocolConfigV8,
): bool {
    let lifecycle = maker::root_lifecycle_v8(root);
    lifecycle == maker::lifecycle_paused_v8()
        || lifecycle == maker::lifecycle_archived_v8()
        || protocol_degraded(registry, config)
}

fun protocol_degraded<PaymentCoin>(
    registry: &MarketRegistryV8<PaymentCoin>,
    config: &ProtocolConfigV8,
): bool {
    !protocol::config_enabled_v8(config)
        || protocol::config_revision_v8(config) != registry.protocol_config_revision
        || protocol::config_commitment_v8(config) != &registry.protocol_config_commitment
}

fun open_listing<PaymentCoin>(registry: &mut MarketRegistryV8<PaymentCoin>) {
    registry.revision = registry.revision + 1;
    registry.listing_count = registry.listing_count + 1;
    registry.escrow_count = registry.escrow_count + 1;
}

fun settle_listing<PaymentCoin>(
    registry: &mut MarketRegistryV8<PaymentCoin>,
    gross_atomic: u64,
    quote: &MarketQuoteV8,
) {
    assert!(registry.escrow_count > 0, EInvalidState);
    registry.revision = registry.revision + 1;
    registry.escrow_count = registry.escrow_count - 1;
    registry.completed_sale_count = registry.completed_sale_count + 1;
    registry.gross_volume_atomic = registry.gross_volume_atomic + (gross_atomic as u128);
    registry.protocol_paid_atomic = registry.protocol_paid_atomic
        + (quote.protocol_atomic as u128);
    registry.creator_paid_atomic = registry.creator_paid_atomic
        + (quote.creator_atomic as u128);
    registry.source_paid_atomic = registry.source_paid_atomic
        + (quote.source_atomic as u128);
    registry.seller_paid_atomic = registry.seller_paid_atomic
        + (quote.seller_atomic as u128);
}

fun close_listing<PaymentCoin>(
    registry: &mut MarketRegistryV8<PaymentCoin>,
    listing: &mut MakerListingV8<PaymentCoin>,
    recovered: bool,
) {
    assert!(registry.escrow_count > 0, EInvalidState);
    registry.revision = registry.revision + 1;
    registry.escrow_count = registry.escrow_count - 1;
    if (recovered) {
        registry.recovered_sale_count = registry.recovered_sale_count + 1;
        listing.status = LISTING_RECOVERED;
    } else {
        registry.canceled_sale_count = registry.canceled_sale_count + 1;
        listing.status = LISTING_CANCELED;
    };
    listing.revision = listing.revision + 1;
    listing.terminal_recipient = listing.seller;
    event::emit(MarketListingClosedV8 {
        listing_id: object::id(listing),
        registry_id: object::id(registry),
        lane: LANE_MAKER,
        asset_id: listing.admin_cap_id,
        seller: listing.seller,
        recovered,
    })
}

fun close_soul_listing<PaymentCoin>(
    registry: &mut MarketRegistryV8<PaymentCoin>,
    listing: &mut SoulListingV8<PaymentCoin>,
    recovered: bool,
) {
    assert!(registry.escrow_count > 0, EInvalidState);
    registry.revision = registry.revision + 1;
    registry.escrow_count = registry.escrow_count - 1;
    if (recovered) {
        registry.recovered_sale_count = registry.recovered_sale_count + 1;
        listing.status = LISTING_RECOVERED;
    } else {
        registry.canceled_sale_count = registry.canceled_sale_count + 1;
        listing.status = LISTING_CANCELED;
    };
    listing.revision = listing.revision + 1;
    listing.terminal_recipient = output::soul_market_seller_v8(&listing.custody);
    event::emit(MarketListingClosedV8 {
        listing_id: object::id(listing),
        registry_id: object::id(registry),
        lane: LANE_SOUL,
        asset_id: output::soul_market_soul_id_v8(&listing.custody),
        seller: output::soul_market_seller_v8(&listing.custody),
        recovered,
    })
}

fun settle_physical_sale<PaymentCoin>(
    listing: &mut PhysicalListingV8<PaymentCoin>,
    registry: &mut MarketRegistryV8<PaymentCoin>,
    quote: &MarketQuoteV8,
    buyer: address,
    lane: u8,
) {
    settle_listing(registry, listing.gross_atomic, quote);
    listing.status = LISTING_SETTLED;
    listing.revision = listing.revision + 1;
    listing.terminal_recipient = buyer;
    event::emit(MarketListingSettledV8 {
        listing_id: object::id(listing),
        registry_id: object::id(registry),
        lane,
        asset_id: physical::physical_market_custody_asset_id_v8(&listing.custody),
        seller: physical::physical_market_custody_holder_v8(&listing.custody),
        buyer,
        gross_atomic: quote.gross_atomic,
        protocol_atomic: quote.protocol_atomic,
        creator_atomic: quote.creator_atomic,
        source_atomic: quote.source_atomic,
        seller_atomic: quote.seller_atomic,
    })
}

fun close_physical_listing<PaymentCoin>(
    registry: &mut MarketRegistryV8<PaymentCoin>,
    listing: &mut PhysicalListingV8<PaymentCoin>,
    recovered: bool,
) {
    assert!(registry.escrow_count > 0, EInvalidState);
    registry.revision = registry.revision + 1;
    registry.escrow_count = registry.escrow_count - 1;
    if (recovered) {
        registry.recovered_sale_count = registry.recovered_sale_count + 1;
        listing.status = LISTING_RECOVERED;
    } else {
        registry.canceled_sale_count = registry.canceled_sale_count + 1;
        listing.status = LISTING_CANCELED;
    };
    listing.revision = listing.revision + 1;
    listing.terminal_recipient =
        physical::physical_market_custody_holder_v8(&listing.custody);
    let source_kind = physical::physical_market_custody_source_kind_v8(
        &listing.custody,
    );
    let lane = if (source_kind == physical::source_base_style_v8()) {
        LANE_PHYSICAL_BASE
    } else {
        assert!(source_kind == physical::source_pack_style_v8(), EInvalidListing);
        LANE_PHYSICAL_PACK
    };
    event::emit(MarketListingClosedV8 {
        listing_id: object::id(listing),
        registry_id: object::id(registry),
        lane,
        asset_id: physical::physical_market_custody_asset_id_v8(&listing.custody),
        seller: physical::physical_market_custody_holder_v8(&listing.custody),
        recovered,
    })
}

fun escrow_payment<PaymentCoin>(
    treasury: &mut MarketTreasuryV8<PaymentCoin>,
    payment: Coin<PaymentCoin>,
    expected_atomic: u64,
) {
    assert!(coin::value(&payment) == expected_atomic, EInvalidPayment);
    coin::put(&mut treasury.escrow, payment);
    treasury.gross_escrowed_atomic = treasury.gross_escrowed_atomic
        + (expected_atomic as u128);
}

fun release_maker_payment<PaymentCoin>(
    treasury: &mut MarketTreasuryV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    protocol_treasury: &mut ProtocolTreasuryV8<PaymentCoin>,
    creator: address,
    seller: address,
    quote: &MarketQuoteV8,
    ctx: &mut TxContext,
) {
    if (quote.protocol_atomic > 0) {
        let protocol_payment = coin::take(
            &mut treasury.escrow,
            quote.protocol_atomic,
            ctx,
        );
        protocol::deposit_protocol_revenue_v8(
            protocol_config,
            protocol_treasury,
            protocol_payment,
        );
    };
    if (quote.creator_atomic > 0) {
        let creator_payment = coin::take(
            &mut treasury.escrow,
            quote.creator_atomic,
            ctx,
        );
        transfer::public_transfer(creator_payment, creator);
    };
    let seller_payment = coin::take(
        &mut treasury.escrow,
        quote.seller_atomic,
        ctx,
    );
    transfer::public_transfer(seller_payment, seller);
    treasury.gross_released_atomic = treasury.gross_released_atomic
        + (quote.gross_atomic as u128);
    assert!(treasury.escrow.value() == 0, EInvalidState);
}

fun release_maker_source_payment<PaymentCoin>(
    treasury: &mut MarketTreasuryV8<PaymentCoin>,
    root: &MakerRootV8<PaymentCoin>,
    maker_treasury: &mut MakerTreasuryV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    protocol_treasury: &mut ProtocolTreasuryV8<PaymentCoin>,
    seller: address,
    quote: &MarketQuoteV8,
    ctx: &mut TxContext,
) {
    if (quote.protocol_atomic > 0) {
        let protocol_payment = coin::take(
            &mut treasury.escrow,
            quote.protocol_atomic,
            ctx,
        );
        protocol::deposit_protocol_revenue_v8(
            protocol_config,
            protocol_treasury,
            protocol_payment,
        );
    };
    if (quote.creator_atomic > 0) {
        let creator_payment = coin::take(
            &mut treasury.escrow,
            quote.creator_atomic,
            ctx,
        );
        transfer::public_transfer(creator_payment, maker::root_creator_v8(root));
    };
    if (quote.source_atomic > 0) {
        let source_payment = coin::take(
            &mut treasury.escrow,
            quote.source_atomic,
            ctx,
        );
        core_treasury::deposit_maker_revenue_v8(
            root,
            maker_treasury,
            protocol_config,
            source_payment,
        );
    };
    let seller_payment = coin::take(
        &mut treasury.escrow,
        quote.seller_atomic,
        ctx,
    );
    transfer::public_transfer(seller_payment, seller);
    treasury.gross_released_atomic = treasury.gross_released_atomic
        + (quote.gross_atomic as u128);
    assert!(treasury.escrow.value() == 0, EInvalidState);
}

fun release_pack_source_payment<PaymentCoin>(
    treasury: &mut MarketTreasuryV8<PaymentCoin>,
    pack_release: &PackReleaseV8<PaymentCoin>,
    pack_treasury: &mut PackTreasuryV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    protocol_treasury: &mut ProtocolTreasuryV8<PaymentCoin>,
    creator: address,
    seller: address,
    quote: &MarketQuoteV8,
    ctx: &mut TxContext,
) {
    if (quote.protocol_atomic > 0) {
        let protocol_payment = coin::take(
            &mut treasury.escrow,
            quote.protocol_atomic,
            ctx,
        );
        protocol::deposit_protocol_revenue_v8(
            protocol_config,
            protocol_treasury,
            protocol_payment,
        );
    };
    if (quote.creator_atomic > 0) {
        let creator_payment = coin::take(
            &mut treasury.escrow,
            quote.creator_atomic,
            ctx,
        );
        transfer::public_transfer(creator_payment, creator);
    };
    if (quote.source_atomic > 0) {
        let source_payment = coin::take(
            &mut treasury.escrow,
            quote.source_atomic,
            ctx,
        );
        runtime::deposit_pack_revenue_v8(
            pack_release,
            pack_treasury,
            source_payment,
        );
    };
    let seller_payment = coin::take(
        &mut treasury.escrow,
        quote.seller_atomic,
        ctx,
    );
    transfer::public_transfer(seller_payment, seller);
    treasury.gross_released_atomic = treasury.gross_released_atomic
        + (quote.gross_atomic as u128);
    assert!(treasury.escrow.value() == 0, EInvalidState);
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
public fun registry_completed_sale_count_v8<PaymentCoin>(
    registry: &MarketRegistryV8<PaymentCoin>,
): u64 { registry.completed_sale_count }
public fun registry_canceled_sale_count_v8<PaymentCoin>(
    registry: &MarketRegistryV8<PaymentCoin>,
): u64 { registry.canceled_sale_count }
public fun registry_recovered_sale_count_v8<PaymentCoin>(
    registry: &MarketRegistryV8<PaymentCoin>,
): u64 { registry.recovered_sale_count }
public fun registry_gross_volume_atomic_v8<PaymentCoin>(
    registry: &MarketRegistryV8<PaymentCoin>,
): u128 { registry.gross_volume_atomic }
public fun registry_protocol_paid_atomic_v8<PaymentCoin>(
    registry: &MarketRegistryV8<PaymentCoin>,
): u128 { registry.protocol_paid_atomic }
public fun registry_creator_paid_atomic_v8<PaymentCoin>(
    registry: &MarketRegistryV8<PaymentCoin>,
): u128 { registry.creator_paid_atomic }
public fun registry_source_paid_atomic_v8<PaymentCoin>(
    registry: &MarketRegistryV8<PaymentCoin>,
): u128 { registry.source_paid_atomic }
public fun registry_seller_paid_atomic_v8<PaymentCoin>(
    registry: &MarketRegistryV8<PaymentCoin>,
): u128 { registry.seller_paid_atomic }
public fun treasury_balance_v8<PaymentCoin>(treasury: &MarketTreasuryV8<PaymentCoin>): u64 {
    treasury.escrow.value()
}
public fun treasury_gross_escrowed_atomic_v8<PaymentCoin>(
    treasury: &MarketTreasuryV8<PaymentCoin>,
): u128 { treasury.gross_escrowed_atomic }
public fun treasury_gross_released_atomic_v8<PaymentCoin>(
    treasury: &MarketTreasuryV8<PaymentCoin>,
): u128 { treasury.gross_released_atomic }
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
public fun maker_listing_id_v8<PaymentCoin>(listing: &MakerListingV8<PaymentCoin>): ID {
    object::id(listing)
}
public fun maker_listing_status_v8<PaymentCoin>(
    listing: &MakerListingV8<PaymentCoin>,
): u8 { listing.status }
public fun maker_listing_registry_id_v8<PaymentCoin>(
    listing: &MakerListingV8<PaymentCoin>,
): ID { listing.registry_id }
public fun maker_listing_treasury_id_v8<PaymentCoin>(
    listing: &MakerListingV8<PaymentCoin>,
): ID { listing.treasury_id }
public fun maker_listing_root_id_v8<PaymentCoin>(
    listing: &MakerListingV8<PaymentCoin>,
): ID { listing.root_id }
public fun maker_listing_admin_cap_id_v8<PaymentCoin>(
    listing: &MakerListingV8<PaymentCoin>,
): ID { listing.admin_cap_id }
public fun maker_listing_seller_v8<PaymentCoin>(
    listing: &MakerListingV8<PaymentCoin>,
): address { listing.seller }
public fun maker_listing_control_epoch_v8<PaymentCoin>(
    listing: &MakerListingV8<PaymentCoin>,
): u64 { listing.expected_control_epoch }
public fun maker_listing_gross_atomic_v8<PaymentCoin>(
    listing: &MakerListingV8<PaymentCoin>,
): u64 { listing.gross_atomic }
public fun maker_listing_quote_commitment_v8<PaymentCoin>(
    listing: &MakerListingV8<PaymentCoin>,
): &vector<u8> { &listing.quote_commitment }
public fun maker_listing_terminal_recipient_v8<PaymentCoin>(
    listing: &MakerListingV8<PaymentCoin>,
): address { listing.terminal_recipient }

public fun soul_listing_id_v8<PaymentCoin>(listing: &SoulListingV8<PaymentCoin>): ID {
    object::id(listing)
}
public fun soul_listing_status_v8<PaymentCoin>(
    listing: &SoulListingV8<PaymentCoin>,
): u8 { listing.status }
public fun soul_listing_registry_id_v8<PaymentCoin>(
    listing: &SoulListingV8<PaymentCoin>,
): ID { listing.registry_id }
public fun soul_listing_treasury_id_v8<PaymentCoin>(
    listing: &SoulListingV8<PaymentCoin>,
): ID { listing.treasury_id }
public fun soul_listing_output_id_v8<PaymentCoin>(
    listing: &SoulListingV8<PaymentCoin>,
): ID { output::soul_market_output_id_v8(&listing.custody) }
public fun soul_listing_receipt_id_v8<PaymentCoin>(
    listing: &SoulListingV8<PaymentCoin>,
): ID { output::soul_market_receipt_id_v8(&listing.custody) }
public fun soul_listing_soul_id_v8<PaymentCoin>(
    listing: &SoulListingV8<PaymentCoin>,
): ID { output::soul_market_soul_id_v8(&listing.custody) }
public fun soul_listing_seller_v8<PaymentCoin>(
    listing: &SoulListingV8<PaymentCoin>,
): address { output::soul_market_seller_v8(&listing.custody) }
public fun soul_listing_ownership_epoch_v8<PaymentCoin>(
    listing: &SoulListingV8<PaymentCoin>,
): u64 { output::soul_market_expected_epoch_v8(&listing.custody) }
public fun soul_listing_gross_atomic_v8<PaymentCoin>(
    listing: &SoulListingV8<PaymentCoin>,
): u64 { listing.gross_atomic }
public fun soul_listing_quote_commitment_v8<PaymentCoin>(
    listing: &SoulListingV8<PaymentCoin>,
): &vector<u8> { &listing.quote_commitment }
public fun soul_listing_terminal_recipient_v8<PaymentCoin>(
    listing: &SoulListingV8<PaymentCoin>,
): address { listing.terminal_recipient }

public fun physical_listing_id_v8<PaymentCoin>(
    listing: &PhysicalListingV8<PaymentCoin>,
): ID { object::id(listing) }
public fun physical_listing_status_v8<PaymentCoin>(
    listing: &PhysicalListingV8<PaymentCoin>,
): u8 { listing.status }
public fun physical_listing_registry_id_v8<PaymentCoin>(
    listing: &PhysicalListingV8<PaymentCoin>,
): ID { listing.registry_id }
public fun physical_listing_treasury_id_v8<PaymentCoin>(
    listing: &PhysicalListingV8<PaymentCoin>,
): ID { listing.treasury_id }
public fun physical_listing_asset_id_v8<PaymentCoin>(
    listing: &PhysicalListingV8<PaymentCoin>,
): ID { physical::physical_market_custody_asset_id_v8(&listing.custody) }
public fun physical_listing_source_kind_v8<PaymentCoin>(
    listing: &PhysicalListingV8<PaymentCoin>,
): u8 { physical::physical_market_custody_source_kind_v8(&listing.custody) }
public fun physical_listing_source_id_v8<PaymentCoin>(
    listing: &PhysicalListingV8<PaymentCoin>,
): ID { physical::physical_market_custody_source_id_v8(&listing.custody) }
public fun physical_listing_source_treasury_id_v8<PaymentCoin>(
    listing: &PhysicalListingV8<PaymentCoin>,
): ID { physical::physical_market_custody_source_treasury_id_v8(&listing.custody) }
public fun physical_listing_seller_v8<PaymentCoin>(
    listing: &PhysicalListingV8<PaymentCoin>,
): address { physical::physical_market_custody_holder_v8(&listing.custody) }
public fun physical_listing_ownership_epoch_v8<PaymentCoin>(
    listing: &PhysicalListingV8<PaymentCoin>,
): u64 { physical::physical_market_custody_ownership_epoch_v8(&listing.custody) }
public fun physical_listing_gross_atomic_v8<PaymentCoin>(
    listing: &PhysicalListingV8<PaymentCoin>,
): u64 { listing.gross_atomic }
public fun physical_listing_quote_commitment_v8<PaymentCoin>(
    listing: &PhysicalListingV8<PaymentCoin>,
): &vector<u8> { &listing.quote_commitment }
public fun physical_listing_terminal_recipient_v8<PaymentCoin>(
    listing: &PhysicalListingV8<PaymentCoin>,
): address { listing.terminal_recipient }

#[test_only]
fun test_hash(byte: u8): vector<u8> {
    let mut value = vector[];
    let mut index = 0u64;
    while (index < HASH_LENGTH) {
        value.push_back(byte);
        index = index + 1;
    };
    value
}

#[test_only]
public struct MarketIntegrationIdsV8 has drop {
    root_id: ID,
    base_registry_id: ID,
    maker_treasury_id: ID,
    admin_id: ID,
    protocol_config_id: ID,
    protocol_treasury_id: ID,
    protocol_admin_id: ID,
    catalog_id: ID,
    release_config_id: ID,
    output_config_id: ID,
    output_registry_id: ID,
    soul_registry_id: ID,
    physical_config_id: ID,
    physical_registry_id: ID,
    runtime_registry_id: ID,
    pack_registry_id: ID,
    admission_authority_id: ID,
    market_config_id: ID,
    market_registry_id: ID,
    market_treasury_id: ID,
    dummy_ids: vector<ID>,
}

#[test_only]
fun share_market_integration_fixture(ctx: &mut TxContext): MarketIntegrationIdsV8 {
    let (protocol_config, protocol_treasury, protocol_admin) =
        protocol::new_protocol_with_treasury_for_testing<SUI>(true, ctx);
    let protocol_config_id = protocol::config_id_v8(&protocol_config);
    let protocol_treasury_id = protocol::protocol_treasury_id_v8(&protocol_treasury);
    let protocol_admin_id = object::id(&protocol_admin);
    let economics = maker::new_economics_snapshot_v8<SUI>(
        &protocol_config,
        maker::access_free_v8(),
        0,
        maker::complete_unlimited_free_v8(),
        0,
        0,
        0,
    );
    let rights = maker::new_onchain_native_rights_snapshot_v8(ctx, 250, 250, 500);
    let root_content = test_hash(40);
    let counts = base::new_base_definition_counts_v8(1, 1, 1, 1, 0, 0);
    let commitments = base::minimal_expected_commitments_for_testing(root_content);
    let clock = sui::clock::create_for_testing(ctx);
    let (mut root, mut base_registry, maker_treasury, admin) =
        core::new_initial_maker_draft_v8<SUI>(
            &protocol_config,
            b"market-integration".to_string(),
            test_hash(41),
            b"market-integration-blob".to_string(),
            test_hash(42),
            root_content,
            counts,
            commitments,
            test_hash(43),
            economics,
            rights,
            &clock,
            ctx,
        );
    clock.destroy_for_testing();
    base::populate_and_seal_minimal_for_testing(&mut base_registry, &root, &admin);
    let mut catalog = binding::product_release_catalog_for_market_integration_testing<
        OutputOriginalMarkerV8,
        OutputCallableMarkerV8,
        PhysicalOriginalMarkerV8,
        PhysicalCallableMarkerV8,
        MarketOriginalMarkerV8,
        MarketCallableMarkerV8,
        ReleaseOriginalMarkerV8,
        ReleaseCallableMarkerV8,
    >(
        &protocol_config,
        maker::root_core_original_package_id_v8(&root).to_address(),
        maker::root_core_callable_package_id_v8(&root).to_address(),
        ctx,
    );
    let seal_cap = binding::take_seal_call_cap_v8(
        &protocol_config, &protocol_admin, &mut catalog,
    );
    let runtime_cap = binding::take_runtime_call_cap_v8(
        &protocol_config, &protocol_admin, &mut catalog,
    );
    let output_cap = binding::take_output_call_cap_v8(
        &protocol_config, &protocol_admin, &mut catalog,
    );
    let physical_cap = binding::take_physical_call_cap_v8(
        &protocol_config, &protocol_admin, &mut catalog,
    );
    let market_cap = binding::take_market_call_cap_v8(
        &protocol_config, &protocol_admin, &mut catalog,
    );
    let release_cap = binding::take_release_call_cap_v8(
        &protocol_config, &protocol_admin, &mut catalog,
    );
    let catalog_witness = binding::certify_release_catalog_witness_v8(
        &protocol_config,
        &catalog,
        &release_cap,
    );
    maker::finalize_product_release_binding_v8(
        &mut root,
        &admin,
        &protocol_config,
        catalog_witness,
        ctx,
    );
    binding::destroy_call_cap_for_testing(seal_cap);
    binding::destroy_call_cap_for_testing(runtime_cap);
    let output_config = output::new_output_package_config_v8(
        &catalog,
        output_cap,
        ctx,
    );
    let output_empty = output::empty_output_registry_commitment_v8(&root);
    let output_row = output::derive_output_policy_row_commitment_v8(
        &root,
        0,
        b"market-output".to_string(),
        false,
        b"".to_string(),
        test_hash(46),
        output::allowed_all_admitted_v8(),
        vector[],
    );
    let output_final = output::advance_output_registry_commitment_v8(
        &root,
        0,
        output_empty,
        output_row,
    );
    let (mut output_registry, soul_registry) = output::new_output_registries_v8(
        &root,
        &admin,
        1,
        output_final,
        ctx,
    );
    output::append_output_policy_v8(
        &mut output_registry,
        &root,
        &admin,
        0,
        b"market-output".to_string(),
        false,
        b"".to_string(),
        test_hash(46),
        output::allowed_all_admitted_v8(),
        vector[],
        output_row,
    );
    output::seal_output_registry_v8(&mut output_registry, &root, &admin);
    let physical_config = physical::new_physical_package_config_v8(
        &catalog,
        physical_cap,
        ctx,
    );
    let physical_empty = physical::empty_base_policy_commitment_v8(
        &root,
        &base_registry,
        &physical_config,
    );
    let physical_material = test_hash(47);
    let physical_row = physical::derive_base_policy_row_commitment_v8(
        &root,
        &base_registry,
        &physical_config,
        0,
        b"part".to_string(),
        b"item".to_string(),
        b"style".to_string(),
        physical_material,
        physical::issue_free_claim_v8(),
        physical::proof_none_v8(),
        0,
        100,
        true,
    );
    let physical_final = physical::advance_base_policy_commitment_v8(
        &root,
        0,
        physical_empty,
        physical_row,
    );
    let mut physical_registry = physical::new_physical_registry_v8(
        &root,
        &admin,
        &base_registry,
        &catalog,
        &physical_config,
        1,
        physical_final,
        ctx,
    );
    physical::append_base_style_policy_v8(
        &mut physical_registry,
        &root,
        &admin,
        &base_registry,
        &catalog,
        &physical_config,
        0,
        b"part".to_string(),
        b"item".to_string(),
        b"style".to_string(),
        physical_material,
        physical::issue_free_claim_v8(),
        physical::proof_none_v8(),
        0,
        100,
        true,
        physical_row,
    );
    physical::seal_physical_registry_v8(
        &mut physical_registry,
        &root,
        &admin,
        &base_registry,
        &catalog,
        &physical_config,
    );
    let (runtime_registry, pack_registry, admission_authority) =
        runtime::new_physical_runtime_fixture_for_testing(&root, ctx);
    let market_config = new_market_package_config_v8(&catalog, market_cap, ctx);
    let (mut market_registry, market_treasury) = new_market_objects_v8(
        &root,
        &admin,
        &catalog,
        &market_config,
        ctx,
    );
    seal_market_registry_v8(
        &mut market_registry,
        &market_treasury,
        &root,
        &admin,
        &catalog,
        &market_config,
    );
    let release_config = release::new_release_package_config_v8(
        &catalog,
        release_cap,
        ctx,
    );
    let mut dummy_ids = vector[];
    let mut index = 0u64;
    while (index < 2) {
        let dummy = MarketIntegrationObjectV8 { id: object::new(ctx) };
        dummy_ids.push_back(object::id(&dummy));
        transfer::share_object(dummy);
        index = index + 1;
    };
    let ids = MarketIntegrationIdsV8 {
        root_id: maker::root_id_v8(&root),
        base_registry_id: base::registry_id_v8(&base_registry),
        maker_treasury_id: core_treasury::maker_treasury_id_v8(&maker_treasury),
        admin_id: maker::admin_id_v8(&admin),
        protocol_config_id,
        protocol_treasury_id,
        protocol_admin_id,
        catalog_id: binding::catalog_id_v8(&catalog),
        release_config_id: release::config_id_v8(&release_config),
        output_config_id: object::id(&output_config),
        output_registry_id: output::output_registry_id_v8(&output_registry),
        soul_registry_id: output::soul_registry_id_v8(&soul_registry),
        physical_config_id: object::id(&physical_config),
        physical_registry_id: physical::registry_id_v8(&physical_registry),
        runtime_registry_id: runtime::definition_registry_id_v8(&runtime_registry),
        pack_registry_id: runtime::pack_registry_id_v8(&pack_registry),
        admission_authority_id: object::id(&admission_authority),
        market_config_id: object::id(&market_config),
        market_registry_id: object::id(&market_registry),
        market_treasury_id: object::id(&market_treasury),
        dummy_ids,
    };
    protocol::share_protocol_with_treasury_for_testing(
        protocol_config,
        protocol_treasury,
        protocol_admin,
        ctx,
    );
    binding::share_product_release_catalog_v8(catalog);
    release::share_release_package_config_v8(release_config);
    output::share_output_package_config_v8(output_config);
    output::share_output_registries_v8(output_registry, soul_registry);
    physical::share_physical_package_config_v8(physical_config);
    physical::share_physical_registry_v8(physical_registry);
    runtime::share_runtime_definition_registry_v8(runtime_registry);
    runtime::share_pack_registry_v8(pack_registry);
    runtime::transfer_pack_admission_authority_v8(
        admission_authority,
        ctx.sender(),
    );
    share_market_package_config_v8(market_config);
    share_market_registry_v8(market_registry);
    share_market_treasury_v8(market_treasury);
    core::share_maker_draft_v8(root, base_registry, maker_treasury, admin, ctx);
    ids
}

#[test_only]
fun activate_market_integration_fixture(
    scenario: &mut sui::test_scenario::Scenario,
    ids: &MarketIntegrationIdsV8,
) {
    let mut root = scenario.take_shared_by_id<MakerRootV8<SUI>>(ids.root_id);
    let base_registry = scenario.take_shared_by_id<BaseDefinitionRegistryV8>(
        ids.base_registry_id,
    );
    let maker_treasury = scenario.take_shared_by_id<MakerTreasuryV8<SUI>>(
        ids.maker_treasury_id,
    );
    let protocol_config = scenario.take_shared_by_id<ProtocolConfigV8>(
        ids.protocol_config_id,
    );
    let protocol_treasury = scenario.take_shared_by_id<ProtocolTreasuryV8<SUI>>(
        ids.protocol_treasury_id,
    );
    let catalog = scenario.take_shared_by_id<ProductReleaseCatalogV8>(ids.catalog_id);
    let release_config = scenario.take_shared_by_id<ReleasePackageConfigV8>(
        ids.release_config_id,
    );
    let output_config = scenario.take_shared_by_id<OutputPackageConfigV8>(
        ids.output_config_id,
    );
    let output_registry = scenario.take_shared_by_id<OutputRegistryV8>(
        ids.output_registry_id,
    );
    let soul_registry = scenario.take_shared_by_id<SoulRegistryV8>(
        ids.soul_registry_id,
    );
    let physical_config = scenario.take_shared_by_id<PhysicalPackageConfigV8>(
        ids.physical_config_id,
    );
    let physical_registry = scenario.take_shared_by_id<PhysicalRegistryV8>(
        ids.physical_registry_id,
    );
    let market_config = scenario.take_shared_by_id<MarketPackageConfigV8>(
        ids.market_config_id,
    );
    let market_registry = scenario.take_shared_by_id<MarketRegistryV8<SUI>>(
        ids.market_registry_id,
    );
    let market_treasury = scenario.take_shared_by_id<MarketTreasuryV8<SUI>>(
        ids.market_treasury_id,
    );
    let seal_policy = scenario.take_shared_by_id<MarketIntegrationObjectV8>(ids.dummy_ids[0]);
    let seal_registry = scenario.take_shared_by_id<MarketIntegrationObjectV8>(ids.dummy_ids[1]);
    let runtime_registry = scenario.take_shared_by_id<RuntimeDefinitionRegistryV8>(
        ids.runtime_registry_id,
    );
    let pack_registry = scenario.take_shared_by_id<PackRegistryV8>(
        ids.pack_registry_id,
    );
    let admission = scenario.take_from_sender_by_id<PackAdmissionAuthorityV8>(
        ids.admission_authority_id,
    );
    let admin = scenario.take_from_sender_by_id<MakerAdminCapV8>(ids.admin_id);
    let (seal_ready, runtime_ready, output_dummy, physical_dummy, market_dummy) =
        activation::readiness_set_for_testing(
            &root,
            &catalog,
            &seal_policy,
            &seal_registry,
            &runtime_registry,
            &pack_registry,
            &admission,
            &output_registry,
            &soul_registry,
            &physical_registry,
            &market_registry,
            &market_treasury,
        );
    activation::destroy_output_readiness_for_testing(output_dummy);
    activation::destroy_physical_readiness_for_testing(physical_dummy);
    activation::destroy_market_readiness_for_testing(market_dummy);
    let output_ready = output::certify_output_activation_readiness_v8(
        &root,
        &catalog,
        &output_config,
        &output_registry,
        &soul_registry,
    );
    let physical_ready = physical::certify_physical_activation_readiness_v8(
        &root,
        &base_registry,
        &catalog,
        &physical_config,
        &physical_registry,
    );
    let market_ready = certify_market_activation_readiness_v8(
        &market_registry,
        &market_treasury,
        &root,
        &catalog,
        &market_config,
    );
    release::seal_and_activate_maker_v8(
        &mut root,
        &admin,
        &protocol_config,
        &catalog,
        &base_registry,
        &maker_treasury,
        &protocol_treasury,
        &release_config,
        seal_ready,
        runtime_ready,
        output_ready,
        physical_ready,
        market_ready,
        scenario.ctx(),
    );
    scenario.return_to_sender(admin);
    sui::test_scenario::return_shared(root);
    sui::test_scenario::return_shared(base_registry);
    sui::test_scenario::return_shared(maker_treasury);
    sui::test_scenario::return_shared(protocol_config);
    sui::test_scenario::return_shared(protocol_treasury);
    sui::test_scenario::return_shared(catalog);
    sui::test_scenario::return_shared(release_config);
    sui::test_scenario::return_shared(output_config);
    sui::test_scenario::return_shared(output_registry);
    sui::test_scenario::return_shared(soul_registry);
    sui::test_scenario::return_shared(physical_config);
    sui::test_scenario::return_shared(physical_registry);
    sui::test_scenario::return_shared(market_config);
    sui::test_scenario::return_shared(market_registry);
    sui::test_scenario::return_shared(market_treasury);
    sui::test_scenario::return_shared(seal_policy);
    sui::test_scenario::return_shared(seal_registry);
    sui::test_scenario::return_shared(runtime_registry);
    sui::test_scenario::return_shared(pack_registry);
    scenario.return_to_sender(admission);
}

#[test_only]
fun list_new_soul_for_testing(
    scenario: &mut sui::test_scenario::Scenario,
    ids: &MarketIntegrationIdsV8,
    gross_atomic: u64,
): (ID, ID, ID, ID) {
    let root = scenario.take_shared_by_id<MakerRootV8<SUI>>(ids.root_id);
    let mut output_registry = scenario.take_shared_by_id<OutputRegistryV8>(
        ids.output_registry_id,
    );
    let mut soul_registry = scenario.take_shared_by_id<SoulRegistryV8>(
        ids.soul_registry_id,
    );
    let mut registry = scenario.take_shared_by_id<MarketRegistryV8<SUI>>(
        ids.market_registry_id,
    );
    let treasury = scenario.take_shared_by_id<MarketTreasuryV8<SUI>>(
        ids.market_treasury_id,
    );
    let protocol_config = scenario.take_shared_by_id<ProtocolConfigV8>(
        ids.protocol_config_id,
    );
    let catalog = scenario.take_shared_by_id<ProductReleaseCatalogV8>(ids.catalog_id);
    let market_config = scenario.take_shared_by_id<MarketPackageConfigV8>(
        ids.market_config_id,
    );
    let sender = scenario.ctx().sender();
    let (output_asset, receipt, soul) =
        output::new_soul_market_bundle_for_testing_v8(
            &mut output_registry,
            &mut soul_registry,
            &root,
            sender,
            scenario.ctx(),
        );
    let output_id = output::complete_output_id_v8(&output_asset);
    let receipt_id = output::receipt_id_v8(&receipt);
    let soul_id = object::id(&soul);
    let listing_id = list_soul_bundle_v8(
        &mut registry,
        &treasury,
        &output_registry,
        &soul_registry,
        &root,
        &protocol_config,
        &catalog,
        &market_config,
        output_asset,
        receipt,
        soul,
        gross_atomic,
        scenario.ctx(),
    );
    sui::test_scenario::return_shared(root);
    sui::test_scenario::return_shared(output_registry);
    sui::test_scenario::return_shared(soul_registry);
    sui::test_scenario::return_shared(registry);
    sui::test_scenario::return_shared(treasury);
    sui::test_scenario::return_shared(protocol_config);
    sui::test_scenario::return_shared(catalog);
    sui::test_scenario::return_shared(market_config);
    (listing_id, output_id, receipt_id, soul_id)
}

#[test_only]
fun relist_soul_for_testing(
    scenario: &mut sui::test_scenario::Scenario,
    ids: &MarketIntegrationIdsV8,
    output_id: ID,
    receipt_id: ID,
    soul_id: ID,
    gross_atomic: u64,
): ID {
    let output_asset = scenario.take_from_sender_by_id<CompleteOutputV8>(output_id);
    let receipt = scenario.take_from_sender_by_id<CompleteReceiptV8>(receipt_id);
    let soul = scenario.take_from_sender_by_id<CanonicalSoulV8>(soul_id);
    let root = scenario.take_shared_by_id<MakerRootV8<SUI>>(ids.root_id);
    let output_registry = scenario.take_shared_by_id<OutputRegistryV8>(
        ids.output_registry_id,
    );
    let soul_registry = scenario.take_shared_by_id<SoulRegistryV8>(
        ids.soul_registry_id,
    );
    let mut registry = scenario.take_shared_by_id<MarketRegistryV8<SUI>>(
        ids.market_registry_id,
    );
    let treasury = scenario.take_shared_by_id<MarketTreasuryV8<SUI>>(
        ids.market_treasury_id,
    );
    let protocol_config = scenario.take_shared_by_id<ProtocolConfigV8>(
        ids.protocol_config_id,
    );
    let catalog = scenario.take_shared_by_id<ProductReleaseCatalogV8>(ids.catalog_id);
    let market_config = scenario.take_shared_by_id<MarketPackageConfigV8>(
        ids.market_config_id,
    );
    let listing_id = list_soul_bundle_v8(
        &mut registry,
        &treasury,
        &output_registry,
        &soul_registry,
        &root,
        &protocol_config,
        &catalog,
        &market_config,
        output_asset,
        receipt,
        soul,
        gross_atomic,
        scenario.ctx(),
    );
    sui::test_scenario::return_shared(root);
    sui::test_scenario::return_shared(output_registry);
    sui::test_scenario::return_shared(soul_registry);
    sui::test_scenario::return_shared(registry);
    sui::test_scenario::return_shared(treasury);
    sui::test_scenario::return_shared(protocol_config);
    sui::test_scenario::return_shared(catalog);
    sui::test_scenario::return_shared(market_config);
    listing_id
}

#[test_only]
fun cancel_soul_for_testing(
    scenario: &mut sui::test_scenario::Scenario,
    ids: &MarketIntegrationIdsV8,
    listing_id: ID,
    output_id: ID,
    receipt_id: ID,
    soul_id: ID,
) {
    let mut listing = scenario.take_shared_by_id<SoulListingV8<SUI>>(listing_id);
    let root = scenario.take_shared_by_id<MakerRootV8<SUI>>(ids.root_id);
    let output_registry = scenario.take_shared_by_id<OutputRegistryV8>(
        ids.output_registry_id,
    );
    let soul_registry = scenario.take_shared_by_id<SoulRegistryV8>(
        ids.soul_registry_id,
    );
    let mut registry = scenario.take_shared_by_id<MarketRegistryV8<SUI>>(
        ids.market_registry_id,
    );
    let treasury = scenario.take_shared_by_id<MarketTreasuryV8<SUI>>(
        ids.market_treasury_id,
    );
    let catalog = scenario.take_shared_by_id<ProductReleaseCatalogV8>(ids.catalog_id);
    let market_config = scenario.take_shared_by_id<MarketPackageConfigV8>(
        ids.market_config_id,
    );
    cancel_soul_listing_v8(
        &mut listing,
        &mut registry,
        &treasury,
        &output_registry,
        &soul_registry,
        &root,
        &catalog,
        &market_config,
        sui::test_scenario::receiving_ticket_by_id<CompleteOutputV8>(output_id),
        sui::test_scenario::receiving_ticket_by_id<CompleteReceiptV8>(receipt_id),
        sui::test_scenario::receiving_ticket_by_id<CanonicalSoulV8>(soul_id),
        scenario.ctx(),
    );
    sui::test_scenario::return_shared(listing);
    sui::test_scenario::return_shared(root);
    sui::test_scenario::return_shared(output_registry);
    sui::test_scenario::return_shared(soul_registry);
    sui::test_scenario::return_shared(registry);
    sui::test_scenario::return_shared(treasury);
    sui::test_scenario::return_shared(catalog);
    sui::test_scenario::return_shared(market_config);
}

#[test_only]
fun recover_soul_for_testing(
    scenario: &sui::test_scenario::Scenario,
    ids: &MarketIntegrationIdsV8,
    listing_id: ID,
    output_id: ID,
    receipt_id: ID,
    soul_id: ID,
) {
    let mut listing = scenario.take_shared_by_id<SoulListingV8<SUI>>(listing_id);
    let root = scenario.take_shared_by_id<MakerRootV8<SUI>>(ids.root_id);
    let output_registry = scenario.take_shared_by_id<OutputRegistryV8>(
        ids.output_registry_id,
    );
    let soul_registry = scenario.take_shared_by_id<SoulRegistryV8>(
        ids.soul_registry_id,
    );
    let mut registry = scenario.take_shared_by_id<MarketRegistryV8<SUI>>(
        ids.market_registry_id,
    );
    let treasury = scenario.take_shared_by_id<MarketTreasuryV8<SUI>>(
        ids.market_treasury_id,
    );
    let protocol_config = scenario.take_shared_by_id<ProtocolConfigV8>(
        ids.protocol_config_id,
    );
    let catalog = scenario.take_shared_by_id<ProductReleaseCatalogV8>(ids.catalog_id);
    let market_config = scenario.take_shared_by_id<MarketPackageConfigV8>(
        ids.market_config_id,
    );
    recover_soul_listing_v8(
        &mut listing,
        &mut registry,
        &treasury,
        &output_registry,
        &soul_registry,
        &root,
        &protocol_config,
        &catalog,
        &market_config,
        sui::test_scenario::receiving_ticket_by_id<CompleteOutputV8>(output_id),
        sui::test_scenario::receiving_ticket_by_id<CompleteReceiptV8>(receipt_id),
        sui::test_scenario::receiving_ticket_by_id<CanonicalSoulV8>(soul_id),
    );
    sui::test_scenario::return_shared(listing);
    sui::test_scenario::return_shared(root);
    sui::test_scenario::return_shared(output_registry);
    sui::test_scenario::return_shared(soul_registry);
    sui::test_scenario::return_shared(registry);
    sui::test_scenario::return_shared(treasury);
    sui::test_scenario::return_shared(protocol_config);
    sui::test_scenario::return_shared(catalog);
    sui::test_scenario::return_shared(market_config);
}

#[test_only]
fun relist_base_physical_for_testing(
    scenario: &mut sui::test_scenario::Scenario,
    ids: &MarketIntegrationIdsV8,
    asset_id: ID,
    gross_atomic: u64,
): ID {
    let asset = scenario.take_from_sender_by_id<PhysicalAssetV8>(asset_id);
    let root = scenario.take_shared_by_id<MakerRootV8<SUI>>(ids.root_id);
    let physical_registry = scenario.take_shared_by_id<PhysicalRegistryV8>(
        ids.physical_registry_id,
    );
    let mut registry = scenario.take_shared_by_id<MarketRegistryV8<SUI>>(
        ids.market_registry_id,
    );
    let treasury = scenario.take_shared_by_id<MarketTreasuryV8<SUI>>(
        ids.market_treasury_id,
    );
    let maker_treasury = scenario.take_shared_by_id<MakerTreasuryV8<SUI>>(
        ids.maker_treasury_id,
    );
    let protocol_config = scenario.take_shared_by_id<ProtocolConfigV8>(
        ids.protocol_config_id,
    );
    let catalog = scenario.take_shared_by_id<ProductReleaseCatalogV8>(ids.catalog_id);
    let physical_config = scenario.take_shared_by_id<PhysicalPackageConfigV8>(
        ids.physical_config_id,
    );
    let market_config = scenario.take_shared_by_id<MarketPackageConfigV8>(
        ids.market_config_id,
    );
    let listing_id = list_base_physical_v8(
        &mut registry,
        &treasury,
        &physical_registry,
        &root,
        &maker_treasury,
        &protocol_config,
        &catalog,
        &physical_config,
        &market_config,
        asset,
        gross_atomic,
        scenario.ctx(),
    );
    sui::test_scenario::return_shared(root);
    sui::test_scenario::return_shared(physical_registry);
    sui::test_scenario::return_shared(registry);
    sui::test_scenario::return_shared(treasury);
    sui::test_scenario::return_shared(maker_treasury);
    sui::test_scenario::return_shared(protocol_config);
    sui::test_scenario::return_shared(catalog);
    sui::test_scenario::return_shared(physical_config);
    sui::test_scenario::return_shared(market_config);
    listing_id
}

#[test_only]
fun relist_pack_physical_for_testing(
    scenario: &mut sui::test_scenario::Scenario,
    ids: &MarketIntegrationIdsV8,
    asset_id: ID,
    pack_treasury_id: ID,
    gross_atomic: u64,
): ID {
    let asset = scenario.take_from_sender_by_id<PhysicalAssetV8>(asset_id);
    let root = scenario.take_shared_by_id<MakerRootV8<SUI>>(ids.root_id);
    let physical_registry = scenario.take_shared_by_id<PhysicalRegistryV8>(
        ids.physical_registry_id,
    );
    let mut registry = scenario.take_shared_by_id<MarketRegistryV8<SUI>>(
        ids.market_registry_id,
    );
    let treasury = scenario.take_shared_by_id<MarketTreasuryV8<SUI>>(
        ids.market_treasury_id,
    );
    let pack_treasury = scenario.take_shared_by_id<PackTreasuryV8<SUI>>(
        pack_treasury_id,
    );
    let protocol_config = scenario.take_shared_by_id<ProtocolConfigV8>(
        ids.protocol_config_id,
    );
    let catalog = scenario.take_shared_by_id<ProductReleaseCatalogV8>(ids.catalog_id);
    let physical_config = scenario.take_shared_by_id<PhysicalPackageConfigV8>(
        ids.physical_config_id,
    );
    let market_config = scenario.take_shared_by_id<MarketPackageConfigV8>(
        ids.market_config_id,
    );
    let listing_id = list_pack_physical_v8(
        &mut registry,
        &treasury,
        &physical_registry,
        &root,
        &pack_treasury,
        &protocol_config,
        &catalog,
        &physical_config,
        &market_config,
        asset,
        gross_atomic,
        scenario.ctx(),
    );
    sui::test_scenario::return_shared(root);
    sui::test_scenario::return_shared(physical_registry);
    sui::test_scenario::return_shared(registry);
    sui::test_scenario::return_shared(treasury);
    sui::test_scenario::return_shared(pack_treasury);
    sui::test_scenario::return_shared(protocol_config);
    sui::test_scenario::return_shared(catalog);
    sui::test_scenario::return_shared(physical_config);
    sui::test_scenario::return_shared(market_config);
    listing_id
}

#[test_only]
fun cancel_physical_for_testing(
    scenario: &mut sui::test_scenario::Scenario,
    ids: &MarketIntegrationIdsV8,
    listing_id: ID,
    asset_id: ID,
) {
    let mut listing = scenario.take_shared_by_id<PhysicalListingV8<SUI>>(listing_id);
    let root = scenario.take_shared_by_id<MakerRootV8<SUI>>(ids.root_id);
    let physical_registry = scenario.take_shared_by_id<PhysicalRegistryV8>(
        ids.physical_registry_id,
    );
    let mut registry = scenario.take_shared_by_id<MarketRegistryV8<SUI>>(
        ids.market_registry_id,
    );
    let treasury = scenario.take_shared_by_id<MarketTreasuryV8<SUI>>(
        ids.market_treasury_id,
    );
    let catalog = scenario.take_shared_by_id<ProductReleaseCatalogV8>(ids.catalog_id);
    let market_config = scenario.take_shared_by_id<MarketPackageConfigV8>(
        ids.market_config_id,
    );
    cancel_physical_listing_v8(
        &mut listing,
        &mut registry,
        &treasury,
        &physical_registry,
        &root,
        &catalog,
        &market_config,
        sui::test_scenario::receiving_ticket_by_id<PhysicalAssetV8>(asset_id),
        scenario.ctx(),
    );
    sui::test_scenario::return_shared(listing);
    sui::test_scenario::return_shared(root);
    sui::test_scenario::return_shared(physical_registry);
    sui::test_scenario::return_shared(registry);
    sui::test_scenario::return_shared(treasury);
    sui::test_scenario::return_shared(catalog);
    sui::test_scenario::return_shared(market_config);
}

#[test_only]
fun recover_physical_for_testing(
    scenario: &sui::test_scenario::Scenario,
    ids: &MarketIntegrationIdsV8,
    listing_id: ID,
    asset_id: ID,
) {
    let mut listing = scenario.take_shared_by_id<PhysicalListingV8<SUI>>(listing_id);
    let root = scenario.take_shared_by_id<MakerRootV8<SUI>>(ids.root_id);
    let physical_registry = scenario.take_shared_by_id<PhysicalRegistryV8>(
        ids.physical_registry_id,
    );
    let mut registry = scenario.take_shared_by_id<MarketRegistryV8<SUI>>(
        ids.market_registry_id,
    );
    let treasury = scenario.take_shared_by_id<MarketTreasuryV8<SUI>>(
        ids.market_treasury_id,
    );
    let protocol_config = scenario.take_shared_by_id<ProtocolConfigV8>(
        ids.protocol_config_id,
    );
    let catalog = scenario.take_shared_by_id<ProductReleaseCatalogV8>(ids.catalog_id);
    let market_config = scenario.take_shared_by_id<MarketPackageConfigV8>(
        ids.market_config_id,
    );
    recover_physical_listing_v8(
        &mut listing,
        &mut registry,
        &treasury,
        &physical_registry,
        &root,
        &protocol_config,
        &catalog,
        &market_config,
        sui::test_scenario::receiving_ticket_by_id<PhysicalAssetV8>(asset_id),
    );
    sui::test_scenario::return_shared(listing);
    sui::test_scenario::return_shared(root);
    sui::test_scenario::return_shared(physical_registry);
    sui::test_scenario::return_shared(registry);
    sui::test_scenario::return_shared(treasury);
    sui::test_scenario::return_shared(protocol_config);
    sui::test_scenario::return_shared(catalog);
    sui::test_scenario::return_shared(market_config);
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
fun maker_child_custody_purchase_cancel_and_disabled_recovery_are_exact() {
    let seller = @0xA11;
    let buyer = @0xB0B;
    let recoverer = @0xC0C;
    let mut scenario = sui::test_scenario::begin(seller);
    let ids = share_market_integration_fixture(scenario.ctx());

    scenario.next_tx(seller);
    activate_market_integration_fixture(&mut scenario, &ids);

    scenario.next_tx(seller);
    {
        let root = scenario.take_shared_by_id<MakerRootV8<SUI>>(ids.root_id);
        let registry = scenario.take_shared_by_id<MarketRegistryV8<SUI>>(
            ids.market_registry_id,
        );
        let treasury = scenario.take_shared_by_id<MarketTreasuryV8<SUI>>(
            ids.market_treasury_id,
        );
        let maker_quote = quote_maker_resale_v8(&registry, &treasury, &root, 10_000);
        let soul_quote = quote_soul_resale_v8(&registry, &treasury, &root, 10_000);
        assert!(maker_quote.protocol_atomic == 250
            && maker_quote.creator_atomic == 500
            && maker_quote.seller_atomic == 9_250, 99);
        assert!(soul_quote.protocol_atomic == 250
            && soul_quote.creator_atomic == 250
            && soul_quote.source_atomic == 250
            && soul_quote.seller_atomic == 9_250, 99);
        sui::test_scenario::return_shared(root);
        sui::test_scenario::return_shared(registry);
        sui::test_scenario::return_shared(treasury);
    };

    scenario.next_tx(seller);
    {
        let mut root = scenario.take_shared_by_id<MakerRootV8<SUI>>(ids.root_id);
        let catalog = scenario.take_shared_by_id<ProductReleaseCatalogV8>(ids.catalog_id);
        let release_config = scenario.take_shared_by_id<ReleasePackageConfigV8>(
            ids.release_config_id,
        );
        let admin = scenario.take_from_sender_by_id<MakerAdminCapV8>(ids.admin_id);
        release::pause_maker_v8(
            &mut root,
            &admin,
            &catalog,
            &release_config,
            scenario.ctx(),
        );
        assert!(maker::root_lifecycle_v8(&root) == maker::lifecycle_paused_v8(), 99);
        scenario.return_to_sender(admin);
        sui::test_scenario::return_shared(root);
        sui::test_scenario::return_shared(catalog);
        sui::test_scenario::return_shared(release_config);
    };

    let first_listing_id;
    scenario.next_tx(seller);
    {
        let root = scenario.take_shared_by_id<MakerRootV8<SUI>>(ids.root_id);
        let mut registry = scenario.take_shared_by_id<MarketRegistryV8<SUI>>(
            ids.market_registry_id,
        );
        let treasury = scenario.take_shared_by_id<MarketTreasuryV8<SUI>>(
            ids.market_treasury_id,
        );
        let maker_treasury = scenario.take_shared_by_id<MakerTreasuryV8<SUI>>(
            ids.maker_treasury_id,
        );
        let protocol_config = scenario.take_shared_by_id<ProtocolConfigV8>(
            ids.protocol_config_id,
        );
        let catalog = scenario.take_shared_by_id<ProductReleaseCatalogV8>(ids.catalog_id);
        let market_config = scenario.take_shared_by_id<MarketPackageConfigV8>(
            ids.market_config_id,
        );
        let admin = scenario.take_from_sender_by_id<MakerAdminCapV8>(ids.admin_id);
        first_listing_id = list_maker_control_v8(
            &mut registry,
            &treasury,
            &root,
            admin,
            &maker_treasury,
            &protocol_config,
            &catalog,
            &market_config,
            10_000,
            scenario.ctx(),
        );
        assert!(registry.listing_count == 1 && registry.escrow_count == 1, 99);
        sui::test_scenario::return_shared(root);
        sui::test_scenario::return_shared(registry);
        sui::test_scenario::return_shared(treasury);
        sui::test_scenario::return_shared(maker_treasury);
        sui::test_scenario::return_shared(protocol_config);
        sui::test_scenario::return_shared(catalog);
        sui::test_scenario::return_shared(market_config);
    };

    scenario.next_tx(buyer);
    {
        let mut listing = scenario.take_shared_by_id<MakerListingV8<SUI>>(
            first_listing_id,
        );
        let mut root = scenario.take_shared_by_id<MakerRootV8<SUI>>(ids.root_id);
        let mut registry = scenario.take_shared_by_id<MarketRegistryV8<SUI>>(
            ids.market_registry_id,
        );
        let mut treasury = scenario.take_shared_by_id<MarketTreasuryV8<SUI>>(
            ids.market_treasury_id,
        );
        let protocol_config = scenario.take_shared_by_id<ProtocolConfigV8>(
            ids.protocol_config_id,
        );
        let mut protocol_treasury = scenario.take_shared_by_id<ProtocolTreasuryV8<SUI>>(
            ids.protocol_treasury_id,
        );
        let catalog = scenario.take_shared_by_id<ProductReleaseCatalogV8>(ids.catalog_id);
        let market_config = scenario.take_shared_by_id<MarketPackageConfigV8>(
            ids.market_config_id,
        );
        let receiving = sui::test_scenario::receiving_ticket_by_id<MakerAdminCapV8>(
            ids.admin_id,
        );
        let payment = coin::mint_for_testing<SUI>(10_000, scenario.ctx());
        purchase_maker_control_v8(
            &mut listing,
            &mut registry,
            &mut treasury,
            &mut root,
            &protocol_config,
            &mut protocol_treasury,
            &catalog,
            &market_config,
            receiving,
            payment,
            scenario.ctx(),
        );
        assert!(listing.status == LISTING_SETTLED && listing.terminal_recipient == buyer, 99);
        assert!(maker::root_owner_v8(&root) == buyer
            && maker::root_control_epoch_v8(&root) == 1, 99);
        assert!(registry.listing_count == 1
            && registry.escrow_count == 0
            && registry.completed_sale_count == 1, 99);
        assert!(registry.gross_volume_atomic == 10_000
            && registry.protocol_paid_atomic == 250
            && registry.creator_paid_atomic == 500
            && registry.source_paid_atomic == 0
            && registry.seller_paid_atomic == 9_250, 99);
        assert!(treasury.escrow.value() == 0
            && treasury.gross_escrowed_atomic == 10_000
            && treasury.gross_released_atomic == 10_000, 99);
        assert!(protocol::protocol_treasury_balance_v8(&protocol_treasury) == 250, 99);
        sui::test_scenario::return_shared(listing);
        sui::test_scenario::return_shared(root);
        sui::test_scenario::return_shared(registry);
        sui::test_scenario::return_shared(treasury);
        sui::test_scenario::return_shared(protocol_config);
        sui::test_scenario::return_shared(protocol_treasury);
        sui::test_scenario::return_shared(catalog);
        sui::test_scenario::return_shared(market_config);
    };

    let next_admin_id;
    let cancel_listing_id;
    scenario.next_tx(buyer);
    {
        let root = scenario.take_shared_by_id<MakerRootV8<SUI>>(ids.root_id);
        let mut registry = scenario.take_shared_by_id<MarketRegistryV8<SUI>>(
            ids.market_registry_id,
        );
        let treasury = scenario.take_shared_by_id<MarketTreasuryV8<SUI>>(
            ids.market_treasury_id,
        );
        let maker_treasury = scenario.take_shared_by_id<MakerTreasuryV8<SUI>>(
            ids.maker_treasury_id,
        );
        let protocol_config = scenario.take_shared_by_id<ProtocolConfigV8>(
            ids.protocol_config_id,
        );
        let catalog = scenario.take_shared_by_id<ProductReleaseCatalogV8>(ids.catalog_id);
        let market_config = scenario.take_shared_by_id<MarketPackageConfigV8>(
            ids.market_config_id,
        );
        let admin = scenario.take_from_sender<MakerAdminCapV8>();
        next_admin_id = maker::admin_id_v8(&admin);
        cancel_listing_id = list_maker_control_v8(
            &mut registry,
            &treasury,
            &root,
            admin,
            &maker_treasury,
            &protocol_config,
            &catalog,
            &market_config,
            20_000,
            scenario.ctx(),
        );
        sui::test_scenario::return_shared(root);
        sui::test_scenario::return_shared(registry);
        sui::test_scenario::return_shared(treasury);
        sui::test_scenario::return_shared(maker_treasury);
        sui::test_scenario::return_shared(protocol_config);
        sui::test_scenario::return_shared(catalog);
        sui::test_scenario::return_shared(market_config);
    };

    scenario.next_tx(buyer);
    {
        let mut listing = scenario.take_shared_by_id<MakerListingV8<SUI>>(
            cancel_listing_id,
        );
        let mut root = scenario.take_shared_by_id<MakerRootV8<SUI>>(ids.root_id);
        let mut registry = scenario.take_shared_by_id<MarketRegistryV8<SUI>>(
            ids.market_registry_id,
        );
        let treasury = scenario.take_shared_by_id<MarketTreasuryV8<SUI>>(
            ids.market_treasury_id,
        );
        let catalog = scenario.take_shared_by_id<ProductReleaseCatalogV8>(ids.catalog_id);
        let market_config = scenario.take_shared_by_id<MarketPackageConfigV8>(
            ids.market_config_id,
        );
        let receiving = sui::test_scenario::receiving_ticket_by_id<MakerAdminCapV8>(
            next_admin_id,
        );
        cancel_maker_control_listing_v8(
            &mut listing,
            &mut registry,
            &treasury,
            &mut root,
            &catalog,
            &market_config,
            receiving,
            scenario.ctx(),
        );
        assert!(listing.status == LISTING_CANCELED
            && maker::root_control_epoch_v8(&root) == 1, 99);
        assert!(registry.canceled_sale_count == 1 && registry.escrow_count == 0, 99);
        sui::test_scenario::return_shared(listing);
        sui::test_scenario::return_shared(root);
        sui::test_scenario::return_shared(registry);
        sui::test_scenario::return_shared(treasury);
        sui::test_scenario::return_shared(catalog);
        sui::test_scenario::return_shared(market_config);
    };

    let recover_listing_id;
    scenario.next_tx(buyer);
    {
        let root = scenario.take_shared_by_id<MakerRootV8<SUI>>(ids.root_id);
        let mut registry = scenario.take_shared_by_id<MarketRegistryV8<SUI>>(
            ids.market_registry_id,
        );
        let treasury = scenario.take_shared_by_id<MarketTreasuryV8<SUI>>(
            ids.market_treasury_id,
        );
        let maker_treasury = scenario.take_shared_by_id<MakerTreasuryV8<SUI>>(
            ids.maker_treasury_id,
        );
        let protocol_config = scenario.take_shared_by_id<ProtocolConfigV8>(
            ids.protocol_config_id,
        );
        let catalog = scenario.take_shared_by_id<ProductReleaseCatalogV8>(ids.catalog_id);
        let market_config = scenario.take_shared_by_id<MarketPackageConfigV8>(
            ids.market_config_id,
        );
        let admin = scenario.take_from_sender_by_id<MakerAdminCapV8>(next_admin_id);
        recover_listing_id = list_maker_control_v8(
            &mut registry,
            &treasury,
            &root,
            admin,
            &maker_treasury,
            &protocol_config,
            &catalog,
            &market_config,
            30_000,
            scenario.ctx(),
        );
        sui::test_scenario::return_shared(root);
        sui::test_scenario::return_shared(registry);
        sui::test_scenario::return_shared(treasury);
        sui::test_scenario::return_shared(maker_treasury);
        sui::test_scenario::return_shared(protocol_config);
        sui::test_scenario::return_shared(catalog);
        sui::test_scenario::return_shared(market_config);
    };

    scenario.next_tx(seller);
    {
        let mut protocol_config = scenario.take_shared_by_id<ProtocolConfigV8>(
            ids.protocol_config_id,
        );
        let protocol_admin = scenario.take_from_sender_by_id<ProtocolAdminCapV8>(
            ids.protocol_admin_id,
        );
        protocol::set_protocol_enabled_v8(&mut protocol_config, &protocol_admin, false);
        scenario.return_to_sender(protocol_admin);
        sui::test_scenario::return_shared(protocol_config);
    };

    scenario.next_tx(recoverer);
    {
        let mut listing = scenario.take_shared_by_id<MakerListingV8<SUI>>(
            recover_listing_id,
        );
        let mut root = scenario.take_shared_by_id<MakerRootV8<SUI>>(ids.root_id);
        let mut registry = scenario.take_shared_by_id<MarketRegistryV8<SUI>>(
            ids.market_registry_id,
        );
        let treasury = scenario.take_shared_by_id<MarketTreasuryV8<SUI>>(
            ids.market_treasury_id,
        );
        let protocol_config = scenario.take_shared_by_id<ProtocolConfigV8>(
            ids.protocol_config_id,
        );
        let catalog = scenario.take_shared_by_id<ProductReleaseCatalogV8>(ids.catalog_id);
        let market_config = scenario.take_shared_by_id<MarketPackageConfigV8>(
            ids.market_config_id,
        );
        let receiving = sui::test_scenario::receiving_ticket_by_id<MakerAdminCapV8>(
            next_admin_id,
        );
        recover_maker_control_listing_v8(
            &mut listing,
            &mut registry,
            &treasury,
            &mut root,
            &protocol_config,
            &catalog,
            &market_config,
            receiving,
            scenario.ctx(),
        );
        assert!(listing.status == LISTING_RECOVERED
            && listing.terminal_recipient == buyer, 99);
        assert!(maker::root_control_epoch_v8(&root) == 1
            && maker::root_owner_v8(&root) == buyer, 99);
        assert!(registry.listing_count == 3
            && registry.escrow_count == 0
            && registry.completed_sale_count == 1
            && registry.canceled_sale_count == 1
            && registry.recovered_sale_count == 1, 99);
        sui::test_scenario::return_shared(listing);
        sui::test_scenario::return_shared(root);
        sui::test_scenario::return_shared(registry);
        sui::test_scenario::return_shared(treasury);
        sui::test_scenario::return_shared(protocol_config);
        sui::test_scenario::return_shared(catalog);
        sui::test_scenario::return_shared(market_config);
    };

    scenario.next_tx(buyer);
    {
        let admin = scenario.take_from_sender_by_id<MakerAdminCapV8>(next_admin_id);
        assert!(maker::admin_owner_v8(&admin) == buyer
            && maker::admin_control_epoch_v8(&admin) == 1, 99);
        scenario.return_to_sender(admin);
    };
    scenario.end();
}

#[test]
fun soul_bundle_listing_purchase_is_indivisible_and_exact() {
    let seller = @0xA11;
    let buyer = @0xB0B;
    let mut scenario = sui::test_scenario::begin(seller);
    let ids = share_market_integration_fixture(scenario.ctx());
    scenario.next_tx(seller);
    activate_market_integration_fixture(&mut scenario, &ids);

    let listing_id;
    let output_id;
    let receipt_id;
    let soul_id;
    let output_commitment;
    let receipt_commitment;
    scenario.next_tx(seller);
    {
        let root = scenario.take_shared_by_id<MakerRootV8<SUI>>(ids.root_id);
        let mut output_registry = scenario.take_shared_by_id<OutputRegistryV8>(
            ids.output_registry_id,
        );
        let mut soul_registry = scenario.take_shared_by_id<SoulRegistryV8>(
            ids.soul_registry_id,
        );
        let mut registry = scenario.take_shared_by_id<MarketRegistryV8<SUI>>(
            ids.market_registry_id,
        );
        let treasury = scenario.take_shared_by_id<MarketTreasuryV8<SUI>>(
            ids.market_treasury_id,
        );
        let protocol_config = scenario.take_shared_by_id<ProtocolConfigV8>(
            ids.protocol_config_id,
        );
        let catalog = scenario.take_shared_by_id<ProductReleaseCatalogV8>(ids.catalog_id);
        let market_config = scenario.take_shared_by_id<MarketPackageConfigV8>(
            ids.market_config_id,
        );
        let (output_asset, receipt, soul) =
            output::new_soul_market_bundle_for_testing_v8(
                &mut output_registry,
                &mut soul_registry,
                &root,
                seller,
                scenario.ctx(),
            );
        output_id = output::complete_output_id_v8(&output_asset);
        receipt_id = output::receipt_id_v8(&receipt);
        soul_id = object::id(&soul);
        output_commitment = *output::complete_output_commitment_v8(&output_asset);
        receipt_commitment = *output::receipt_commitment_v8(&receipt);
        listing_id = list_soul_bundle_v8(
            &mut registry,
            &treasury,
            &output_registry,
            &soul_registry,
            &root,
            &protocol_config,
            &catalog,
            &market_config,
            output_asset,
            receipt,
            soul,
            10_000,
            scenario.ctx(),
        );
        assert!(registry.listing_count == 1 && registry.escrow_count == 1, 99);
        sui::test_scenario::return_shared(root);
        sui::test_scenario::return_shared(output_registry);
        sui::test_scenario::return_shared(soul_registry);
        sui::test_scenario::return_shared(registry);
        sui::test_scenario::return_shared(treasury);
        sui::test_scenario::return_shared(protocol_config);
        sui::test_scenario::return_shared(catalog);
        sui::test_scenario::return_shared(market_config);
    };

    scenario.next_tx(buyer);
    {
        let mut listing = scenario.take_shared_by_id<SoulListingV8<SUI>>(listing_id);
        let root = scenario.take_shared_by_id<MakerRootV8<SUI>>(ids.root_id);
        let mut output_registry = scenario.take_shared_by_id<OutputRegistryV8>(
            ids.output_registry_id,
        );
        let mut soul_registry = scenario.take_shared_by_id<SoulRegistryV8>(
            ids.soul_registry_id,
        );
        let mut registry = scenario.take_shared_by_id<MarketRegistryV8<SUI>>(
            ids.market_registry_id,
        );
        let mut treasury = scenario.take_shared_by_id<MarketTreasuryV8<SUI>>(
            ids.market_treasury_id,
        );
        let mut maker_treasury = scenario.take_shared_by_id<MakerTreasuryV8<SUI>>(
            ids.maker_treasury_id,
        );
        let protocol_config = scenario.take_shared_by_id<ProtocolConfigV8>(
            ids.protocol_config_id,
        );
        let mut protocol_treasury = scenario.take_shared_by_id<ProtocolTreasuryV8<SUI>>(
            ids.protocol_treasury_id,
        );
        let catalog = scenario.take_shared_by_id<ProductReleaseCatalogV8>(ids.catalog_id);
        let market_config = scenario.take_shared_by_id<MarketPackageConfigV8>(
            ids.market_config_id,
        );
        purchase_soul_bundle_v8(
            &mut listing,
            &mut registry,
            &mut treasury,
            &mut output_registry,
            &mut soul_registry,
            &root,
            &mut maker_treasury,
            &protocol_config,
            &mut protocol_treasury,
            &catalog,
            &market_config,
            sui::test_scenario::receiving_ticket_by_id<CompleteOutputV8>(output_id),
            sui::test_scenario::receiving_ticket_by_id<CompleteReceiptV8>(receipt_id),
            sui::test_scenario::receiving_ticket_by_id<CanonicalSoulV8>(soul_id),
            coin::mint_for_testing<SUI>(10_000, scenario.ctx()),
            scenario.ctx(),
        );
        assert!(listing.status == LISTING_SETTLED
            && listing.terminal_recipient == buyer, 99);
        assert!(registry.listing_count == 1
            && registry.escrow_count == 0
            && registry.completed_sale_count == 1
            && registry.gross_volume_atomic == 10_000
            && registry.protocol_paid_atomic == 250
            && registry.creator_paid_atomic == 250
            && registry.source_paid_atomic == 250
            && registry.seller_paid_atomic == 9_250, 99);
        assert!(treasury.escrow.value() == 0
            && treasury.gross_escrowed_atomic == 10_000
            && treasury.gross_released_atomic == 10_000, 99);
        assert!(protocol::protocol_treasury_balance_v8(&protocol_treasury) == 250, 99);
        assert!(core_treasury::maker_treasury_balance_v8(&maker_treasury) == 250, 99);
        let output_record = output::output_record_v8(&output_registry, output_id);
        let soul_record = output::soul_record_v8(&soul_registry, soul_id);
        assert!(output::output_record_holder_v8(output_record) == buyer, 99);
        assert!(output::soul_record_holder_v8(soul_record) == buyer
            && output::soul_record_ownership_epoch_v8(soul_record) == 1, 99);
        sui::test_scenario::return_shared(listing);
        sui::test_scenario::return_shared(root);
        sui::test_scenario::return_shared(output_registry);
        sui::test_scenario::return_shared(soul_registry);
        sui::test_scenario::return_shared(registry);
        sui::test_scenario::return_shared(treasury);
        sui::test_scenario::return_shared(maker_treasury);
        sui::test_scenario::return_shared(protocol_config);
        sui::test_scenario::return_shared(protocol_treasury);
        sui::test_scenario::return_shared(catalog);
        sui::test_scenario::return_shared(market_config);
    };

    scenario.next_tx(buyer);
    {
        let output_asset = scenario.take_from_sender_by_id<CompleteOutputV8>(output_id);
        let receipt = scenario.take_from_sender_by_id<CompleteReceiptV8>(receipt_id);
        let soul = scenario.take_from_sender_by_id<CanonicalSoulV8>(soul_id);
        assert!(output::complete_output_original_holder_v8(&output_asset) == seller
            && output::complete_output_holder_v8(&output_asset) == buyer
            && output::complete_output_commitment_v8(&output_asset)
                == &output_commitment, 99);
        assert!(output::receipt_original_holder_v8(&receipt) == seller
            && output::receipt_holder_v8(&receipt) == buyer
            && output::receipt_commitment_v8(&receipt) == &receipt_commitment, 99);
        assert!(output::soul_holder_v8(&soul) == buyer
            && output::soul_ownership_epoch_v8(&soul) == 1, 99);
        scenario.return_to_sender(output_asset);
        scenario.return_to_sender(receipt);
        scenario.return_to_sender(soul);
    };
    scenario.end();
}

#[test]
fun soul_cancel_and_disabled_recovery_never_mutate_ownership() {
    let seller = @0xA11;
    let recoverer = @0xC0C;
    let mut scenario = sui::test_scenario::begin(seller);
    let ids = share_market_integration_fixture(scenario.ctx());
    scenario.next_tx(seller);
    activate_market_integration_fixture(&mut scenario, &ids);

    scenario.next_tx(seller);
    let (cancel_listing_id, output_id, receipt_id, soul_id) =
        list_new_soul_for_testing(&mut scenario, &ids, 10_000);
    scenario.next_tx(seller);
    cancel_soul_for_testing(
        &mut scenario,
        &ids,
        cancel_listing_id,
        output_id,
        receipt_id,
        soul_id,
    );

    scenario.next_tx(seller);
    let recover_listing_id = relist_soul_for_testing(
        &mut scenario,
        &ids,
        output_id,
        receipt_id,
        soul_id,
        20_000,
    );
    scenario.next_tx(seller);
    {
        let mut protocol_config = scenario.take_shared_by_id<ProtocolConfigV8>(
            ids.protocol_config_id,
        );
        let protocol_admin = scenario.take_from_sender_by_id<ProtocolAdminCapV8>(
            ids.protocol_admin_id,
        );
        protocol::set_protocol_enabled_v8(
            &mut protocol_config,
            &protocol_admin,
            false,
        );
        scenario.return_to_sender(protocol_admin);
        sui::test_scenario::return_shared(protocol_config);
    };
    scenario.next_tx(recoverer);
    recover_soul_for_testing(
        &scenario,
        &ids,
        recover_listing_id,
        output_id,
        receipt_id,
        soul_id,
    );

    scenario.next_tx(seller);
    {
        let output_asset = scenario.take_from_sender_by_id<CompleteOutputV8>(output_id);
        let receipt = scenario.take_from_sender_by_id<CompleteReceiptV8>(receipt_id);
        let soul = scenario.take_from_sender_by_id<CanonicalSoulV8>(soul_id);
        let registry = scenario.take_shared_by_id<MarketRegistryV8<SUI>>(
            ids.market_registry_id,
        );
        assert!(output::complete_output_holder_v8(&output_asset) == seller
            && output::receipt_holder_v8(&receipt) == seller
            && output::soul_holder_v8(&soul) == seller
            && output::soul_ownership_epoch_v8(&soul) == 0, 99);
        assert!(registry.listing_count == 2
            && registry.escrow_count == 0
            && registry.completed_sale_count == 0
            && registry.canceled_sale_count == 1
            && registry.recovered_sale_count == 1, 99);
        scenario.return_to_sender(output_asset);
        scenario.return_to_sender(receipt);
        scenario.return_to_sender(soul);
        sui::test_scenario::return_shared(registry);
    };
    scenario.end();
}

#[test]
fun base_physical_listing_purchase_preserves_provenance_and_exact_split() {
    let seller = @0xA11;
    let buyer = @0xB0B;
    let recoverer = @0xC0C;
    let mut scenario = sui::test_scenario::begin(seller);
    let ids = share_market_integration_fixture(scenario.ctx());
    scenario.next_tx(seller);
    activate_market_integration_fixture(&mut scenario, &ids);

    let listing_id;
    let asset_id;
    let provenance;
    scenario.next_tx(seller);
    {
        let root = scenario.take_shared_by_id<MakerRootV8<SUI>>(ids.root_id);
        let mut physical_registry = scenario.take_shared_by_id<PhysicalRegistryV8>(
            ids.physical_registry_id,
        );
        let mut registry = scenario.take_shared_by_id<MarketRegistryV8<SUI>>(
            ids.market_registry_id,
        );
        let treasury = scenario.take_shared_by_id<MarketTreasuryV8<SUI>>(
            ids.market_treasury_id,
        );
        let maker_treasury = scenario.take_shared_by_id<MakerTreasuryV8<SUI>>(
            ids.maker_treasury_id,
        );
        let protocol_config = scenario.take_shared_by_id<ProtocolConfigV8>(
            ids.protocol_config_id,
        );
        let catalog = scenario.take_shared_by_id<ProductReleaseCatalogV8>(ids.catalog_id);
        let physical_config = scenario.take_shared_by_id<PhysicalPackageConfigV8>(
            ids.physical_config_id,
        );
        let market_config = scenario.take_shared_by_id<MarketPackageConfigV8>(
            ids.market_config_id,
        );
        let asset = physical::issue_transferable_base_physical_for_market_testing(
            &mut physical_registry,
            scenario.ctx(),
        );
        asset_id = physical::asset_id_v8(&asset);
        provenance = *physical::asset_provenance_commitment_v8(&asset);
        listing_id = list_base_physical_v8(
            &mut registry,
            &treasury,
            &physical_registry,
            &root,
            &maker_treasury,
            &protocol_config,
            &catalog,
            &physical_config,
            &market_config,
            asset,
            10_000,
            scenario.ctx(),
        );
        sui::test_scenario::return_shared(root);
        sui::test_scenario::return_shared(physical_registry);
        sui::test_scenario::return_shared(registry);
        sui::test_scenario::return_shared(treasury);
        sui::test_scenario::return_shared(maker_treasury);
        sui::test_scenario::return_shared(protocol_config);
        sui::test_scenario::return_shared(catalog);
        sui::test_scenario::return_shared(physical_config);
        sui::test_scenario::return_shared(market_config);
    };

    scenario.next_tx(buyer);
    {
        let mut listing = scenario.take_shared_by_id<PhysicalListingV8<SUI>>(listing_id);
        let root = scenario.take_shared_by_id<MakerRootV8<SUI>>(ids.root_id);
        let physical_registry = scenario.take_shared_by_id<PhysicalRegistryV8>(
            ids.physical_registry_id,
        );
        let mut registry = scenario.take_shared_by_id<MarketRegistryV8<SUI>>(
            ids.market_registry_id,
        );
        let mut treasury = scenario.take_shared_by_id<MarketTreasuryV8<SUI>>(
            ids.market_treasury_id,
        );
        let mut maker_treasury = scenario.take_shared_by_id<MakerTreasuryV8<SUI>>(
            ids.maker_treasury_id,
        );
        let protocol_config = scenario.take_shared_by_id<ProtocolConfigV8>(
            ids.protocol_config_id,
        );
        let mut protocol_treasury = scenario.take_shared_by_id<ProtocolTreasuryV8<SUI>>(
            ids.protocol_treasury_id,
        );
        let catalog = scenario.take_shared_by_id<ProductReleaseCatalogV8>(ids.catalog_id);
        let physical_config = scenario.take_shared_by_id<PhysicalPackageConfigV8>(
            ids.physical_config_id,
        );
        let market_config = scenario.take_shared_by_id<MarketPackageConfigV8>(
            ids.market_config_id,
        );
        purchase_base_physical_v8(
            &mut listing,
            &mut registry,
            &mut treasury,
            &physical_registry,
            &root,
            &mut maker_treasury,
            &protocol_config,
            &mut protocol_treasury,
            &catalog,
            &physical_config,
            &market_config,
            sui::test_scenario::receiving_ticket_by_id<PhysicalAssetV8>(asset_id),
            coin::mint_for_testing<SUI>(10_000, scenario.ctx()),
            scenario.ctx(),
        );
        assert!(listing.status == LISTING_SETTLED
            && listing.terminal_recipient == buyer
            && physical_listing_source_treasury_id_v8(&listing)
                == ids.maker_treasury_id, 99);
        assert!(registry.listing_count == 1
            && registry.escrow_count == 0
            && registry.completed_sale_count == 1
            && registry.protocol_paid_atomic == 250
            && registry.creator_paid_atomic == 250
            && registry.source_paid_atomic == 250
            && registry.seller_paid_atomic == 9_250, 99);
        assert!(protocol::protocol_treasury_balance_v8(&protocol_treasury) == 250, 99);
        assert!(core_treasury::maker_treasury_balance_v8(&maker_treasury) == 250, 99);
        assert!(treasury.escrow.value() == 0, 99);
        sui::test_scenario::return_shared(listing);
        sui::test_scenario::return_shared(root);
        sui::test_scenario::return_shared(physical_registry);
        sui::test_scenario::return_shared(registry);
        sui::test_scenario::return_shared(treasury);
        sui::test_scenario::return_shared(maker_treasury);
        sui::test_scenario::return_shared(protocol_config);
        sui::test_scenario::return_shared(protocol_treasury);
        sui::test_scenario::return_shared(catalog);
        sui::test_scenario::return_shared(physical_config);
        sui::test_scenario::return_shared(market_config);
    };

    scenario.next_tx(buyer);
    {
        let asset = scenario.take_from_sender_by_id<PhysicalAssetV8>(asset_id);
        assert!(physical::asset_holder_v8(&asset) == buyer
            && physical::asset_ownership_epoch_v8(&asset) == 1
            && physical::asset_source_kind_v8(&asset) == physical::source_base_style_v8()
            && physical::asset_provenance_commitment_v8(&asset) == &provenance, 99);
        scenario.return_to_sender(asset);
    };

    scenario.next_tx(buyer);
    let cancel_listing_id = relist_base_physical_for_testing(
        &mut scenario,
        &ids,
        asset_id,
        20_000,
    );
    scenario.next_tx(buyer);
    cancel_physical_for_testing(&mut scenario, &ids, cancel_listing_id, asset_id);

    scenario.next_tx(buyer);
    let recover_listing_id = relist_base_physical_for_testing(
        &mut scenario,
        &ids,
        asset_id,
        30_000,
    );
    scenario.next_tx(seller);
    {
        let mut root = scenario.take_shared_by_id<MakerRootV8<SUI>>(ids.root_id);
        let catalog = scenario.take_shared_by_id<ProductReleaseCatalogV8>(ids.catalog_id);
        let release_config = scenario.take_shared_by_id<ReleasePackageConfigV8>(
            ids.release_config_id,
        );
        let admin = scenario.take_from_sender_by_id<MakerAdminCapV8>(ids.admin_id);
        release::pause_maker_v8(
            &mut root,
            &admin,
            &catalog,
            &release_config,
            scenario.ctx(),
        );
        scenario.return_to_sender(admin);
        sui::test_scenario::return_shared(root);
        sui::test_scenario::return_shared(catalog);
        sui::test_scenario::return_shared(release_config);
    };
    scenario.next_tx(recoverer);
    recover_physical_for_testing(&scenario, &ids, recover_listing_id, asset_id);
    scenario.next_tx(buyer);
    {
        let asset = scenario.take_from_sender_by_id<PhysicalAssetV8>(asset_id);
        let registry = scenario.take_shared_by_id<MarketRegistryV8<SUI>>(
            ids.market_registry_id,
        );
        assert!(physical::asset_holder_v8(&asset) == buyer
            && physical::asset_ownership_epoch_v8(&asset) == 1
            && physical::asset_provenance_commitment_v8(&asset) == &provenance, 99);
        assert!(registry.listing_count == 3
            && registry.escrow_count == 0
            && registry.completed_sale_count == 1
            && registry.canceled_sale_count == 1
            && registry.recovered_sale_count == 1, 99);
        scenario.return_to_sender(asset);
        sui::test_scenario::return_shared(registry);
    };
    scenario.end();
}

#[test]
fun pack_physical_listing_purchase_uses_exact_pack_treasury() {
    let seller = @0xA11;
    let buyer = @0xB0B;
    let mut scenario = sui::test_scenario::begin(seller);
    let ids = share_market_integration_fixture(scenario.ctx());
    scenario.next_tx(seller);
    activate_market_integration_fixture(&mut scenario, &ids);

    let pack_release_id;
    let pack_treasury_id;
    let asset_id;
    let provenance;
    scenario.next_tx(seller);
    {
        let root = scenario.take_shared_by_id<MakerRootV8<SUI>>(ids.root_id);
        let runtime_registry = scenario.take_shared_by_id<RuntimeDefinitionRegistryV8>(
            ids.runtime_registry_id,
        );
        let mut pack_registry = scenario.take_shared_by_id<PackRegistryV8>(
            ids.pack_registry_id,
        );
        let mut physical_registry = scenario.take_shared_by_id<PhysicalRegistryV8>(
            ids.physical_registry_id,
        );
        let catalog = scenario.take_shared_by_id<ProductReleaseCatalogV8>(ids.catalog_id);
        let physical_config = scenario.take_shared_by_id<PhysicalPackageConfigV8>(
            ids.physical_config_id,
        );
        let maker_admin = scenario.take_from_sender_by_id<MakerAdminCapV8>(ids.admin_id);
        let (pack_release, pack_admin, pack_treasury, pack_pass, loadout) =
            runtime::add_physical_pack_fixture_for_testing(
                &mut pack_registry,
                &runtime_registry,
                &root,
                scenario.ctx(),
        );
        pack_release_id = runtime::pack_release_id_v8(&pack_release);
        pack_treasury_id = object::id(&pack_treasury);
        let physical_revision = physical::registry_revision_v8(&physical_registry);
        physical::register_pack_style_policy_v8(
            &mut physical_registry,
            &root,
            &maker_admin,
            &catalog,
            &physical_config,
            &pack_registry,
            &pack_release,
            &pack_admin,
            &pack_treasury,
            physical_revision,
            b"part".to_string(),
            b"pack-item".to_string(),
            b"pack-style".to_string(),
            test_hash(48),
            physical::issue_free_claim_v8(),
            physical::proof_none_v8(),
            0,
            100,
            true,
            scenario.ctx(),
        );
        let asset = physical::issue_transferable_pack_physical_for_market_testing(
            &mut physical_registry,
            scenario.ctx(),
        );
        asset_id = physical::asset_id_v8(&asset);
        provenance = *physical::asset_provenance_commitment_v8(&asset);
        physical::transfer_new_physical_asset_to_holder_v8(asset);
        runtime::share_pack_release_v8(pack_release);
        runtime::share_pack_treasury_v8(pack_treasury);
        runtime::transfer_pack_admin_cap_v8(pack_admin, seller);
        runtime::transfer_pack_pass_to_holder_v8(pack_pass);
        runtime::transfer_maker_loadout_to_holder_v8(loadout);
        scenario.return_to_sender(maker_admin);
        sui::test_scenario::return_shared(root);
        sui::test_scenario::return_shared(runtime_registry);
        sui::test_scenario::return_shared(pack_registry);
        sui::test_scenario::return_shared(physical_registry);
        sui::test_scenario::return_shared(catalog);
        sui::test_scenario::return_shared(physical_config);
    };

    let listing_id;
    scenario.next_tx(seller);
    {
        let asset = scenario.take_from_sender_by_id<PhysicalAssetV8>(asset_id);
        let root = scenario.take_shared_by_id<MakerRootV8<SUI>>(ids.root_id);
        let physical_registry = scenario.take_shared_by_id<PhysicalRegistryV8>(
            ids.physical_registry_id,
        );
        let mut registry = scenario.take_shared_by_id<MarketRegistryV8<SUI>>(
            ids.market_registry_id,
        );
        let treasury = scenario.take_shared_by_id<MarketTreasuryV8<SUI>>(
            ids.market_treasury_id,
        );
        let pack_treasury = scenario.take_shared_by_id<PackTreasuryV8<SUI>>(
            pack_treasury_id,
        );
        let protocol_config = scenario.take_shared_by_id<ProtocolConfigV8>(
            ids.protocol_config_id,
        );
        let catalog = scenario.take_shared_by_id<ProductReleaseCatalogV8>(ids.catalog_id);
        let physical_config = scenario.take_shared_by_id<PhysicalPackageConfigV8>(
            ids.physical_config_id,
        );
        let market_config = scenario.take_shared_by_id<MarketPackageConfigV8>(
            ids.market_config_id,
        );
        listing_id = list_pack_physical_v8(
            &mut registry,
            &treasury,
            &physical_registry,
            &root,
            &pack_treasury,
            &protocol_config,
            &catalog,
            &physical_config,
            &market_config,
            asset,
            10_000,
            scenario.ctx(),
        );
        sui::test_scenario::return_shared(root);
        sui::test_scenario::return_shared(physical_registry);
        sui::test_scenario::return_shared(registry);
        sui::test_scenario::return_shared(treasury);
        sui::test_scenario::return_shared(pack_treasury);
        sui::test_scenario::return_shared(protocol_config);
        sui::test_scenario::return_shared(catalog);
        sui::test_scenario::return_shared(physical_config);
        sui::test_scenario::return_shared(market_config);
    };

    scenario.next_tx(buyer);
    {
        let mut listing = scenario.take_shared_by_id<PhysicalListingV8<SUI>>(listing_id);
        let root = scenario.take_shared_by_id<MakerRootV8<SUI>>(ids.root_id);
        let physical_registry = scenario.take_shared_by_id<PhysicalRegistryV8>(
            ids.physical_registry_id,
        );
        let mut registry = scenario.take_shared_by_id<MarketRegistryV8<SUI>>(
            ids.market_registry_id,
        );
        let mut treasury = scenario.take_shared_by_id<MarketTreasuryV8<SUI>>(
            ids.market_treasury_id,
        );
        let pack_release = scenario.take_shared_by_id<PackReleaseV8<SUI>>(
            pack_release_id,
        );
        let mut pack_treasury = scenario.take_shared_by_id<PackTreasuryV8<SUI>>(
            pack_treasury_id,
        );
        let protocol_config = scenario.take_shared_by_id<ProtocolConfigV8>(
            ids.protocol_config_id,
        );
        let mut protocol_treasury = scenario.take_shared_by_id<ProtocolTreasuryV8<SUI>>(
            ids.protocol_treasury_id,
        );
        let catalog = scenario.take_shared_by_id<ProductReleaseCatalogV8>(ids.catalog_id);
        let physical_config = scenario.take_shared_by_id<PhysicalPackageConfigV8>(
            ids.physical_config_id,
        );
        let market_config = scenario.take_shared_by_id<MarketPackageConfigV8>(
            ids.market_config_id,
        );
        purchase_pack_physical_v8(
            &mut listing,
            &mut registry,
            &mut treasury,
            &physical_registry,
            &root,
            &pack_release,
            &mut pack_treasury,
            &protocol_config,
            &mut protocol_treasury,
            &catalog,
            &physical_config,
            &market_config,
            sui::test_scenario::receiving_ticket_by_id<PhysicalAssetV8>(asset_id),
            coin::mint_for_testing<SUI>(10_000, scenario.ctx()),
            scenario.ctx(),
        );
        assert!(listing.status == LISTING_SETTLED
            && listing.terminal_recipient == buyer
            && physical_listing_source_treasury_id_v8(&listing)
                == pack_treasury_id, 99);
        assert!(registry.listing_count == 1
            && registry.escrow_count == 0
            && registry.completed_sale_count == 1
            && registry.protocol_paid_atomic == 250
            && registry.creator_paid_atomic == 250
            && registry.source_paid_atomic == 250
            && registry.seller_paid_atomic == 9_250, 99);
        assert!(runtime::pack_treasury_balance_v8(&pack_treasury) == 250, 99);
        assert!(protocol::protocol_treasury_balance_v8(&protocol_treasury) == 250, 99);
        assert!(treasury.escrow.value() == 0, 99);
        sui::test_scenario::return_shared(listing);
        sui::test_scenario::return_shared(root);
        sui::test_scenario::return_shared(physical_registry);
        sui::test_scenario::return_shared(registry);
        sui::test_scenario::return_shared(treasury);
        sui::test_scenario::return_shared(pack_release);
        sui::test_scenario::return_shared(pack_treasury);
        sui::test_scenario::return_shared(protocol_config);
        sui::test_scenario::return_shared(protocol_treasury);
        sui::test_scenario::return_shared(catalog);
        sui::test_scenario::return_shared(physical_config);
        sui::test_scenario::return_shared(market_config);
    };

    scenario.next_tx(buyer);
    {
        let asset = scenario.take_from_sender_by_id<PhysicalAssetV8>(asset_id);
        assert!(physical::asset_holder_v8(&asset) == buyer
            && physical::asset_ownership_epoch_v8(&asset) == 1
            && physical::asset_source_kind_v8(&asset) == physical::source_pack_style_v8()
            && *physical::asset_source_treasury_id_v8(&asset).borrow()
                == pack_treasury_id
            && physical::asset_provenance_commitment_v8(&asset) == &provenance, 99);
        scenario.return_to_sender(asset);
    };

    scenario.next_tx(buyer);
    let cancel_listing_id = relist_pack_physical_for_testing(
        &mut scenario,
        &ids,
        asset_id,
        pack_treasury_id,
        20_000,
    );
    scenario.next_tx(buyer);
    cancel_physical_for_testing(&mut scenario, &ids, cancel_listing_id, asset_id);
    scenario.next_tx(buyer);
    {
        let asset = scenario.take_from_sender_by_id<PhysicalAssetV8>(asset_id);
        let registry = scenario.take_shared_by_id<MarketRegistryV8<SUI>>(
            ids.market_registry_id,
        );
        assert!(physical::asset_holder_v8(&asset) == buyer
            && physical::asset_ownership_epoch_v8(&asset) == 1
            && physical::asset_provenance_commitment_v8(&asset) == &provenance, 99);
        assert!(registry.listing_count == 2
            && registry.escrow_count == 0
            && registry.completed_sale_count == 1
            && registry.canceled_sale_count == 1
            && registry.recovered_sale_count == 0, 99);
        scenario.return_to_sender(asset);
        sui::test_scenario::return_shared(registry);
    };
    scenario.end();
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
    let max_gross = 18_446_744_073_709_551_615u64;
    let boundary = derive_quote(&root, QUOTE_PHYSICAL_RESALE, max_gross);
    assert!((boundary.protocol_atomic as u128)
        + (boundary.creator_atomic as u128)
        + (boundary.source_atomic as u128)
        + (boundary.seller_atomic as u128) == (max_gross as u128), 99);
    assert!(share(max_gross, 0) == 0, 99);
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

#[test, expected_failure(abort_code = EInvalidPayment)]
fun zero_purchase_payment_is_rejected() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 8, 0, 0, 0);
    let (_protocol_config, _protocol_admin, root, _base_registry,
        _maker_treasury, _admin, _catalog, market_config) =
        new_test_fixture(&mut ctx);
    let (_registry, mut treasury) = new_market_objects(&root, &market_config, &mut ctx);
    escrow_payment(
        &mut treasury,
        coin::mint_for_testing<SUI>(0, &mut ctx),
        10_000,
    );
    abort EInvalidPayment
}

#[test, expected_failure(abort_code = EInvalidPayment)]
fun underpayment_is_rejected() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 9, 0, 0, 0);
    let (_protocol_config, _protocol_admin, root, _base_registry,
        _maker_treasury, _admin, _catalog, market_config) =
        new_test_fixture(&mut ctx);
    let (_registry, mut treasury) = new_market_objects(&root, &market_config, &mut ctx);
    escrow_payment(
        &mut treasury,
        coin::mint_for_testing<SUI>(9_999, &mut ctx),
        10_000,
    );
    abort EInvalidPayment
}

#[test, expected_failure(abort_code = EInvalidPayment)]
fun overpayment_is_rejected() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 10, 0, 0, 0);
    let (_protocol_config, _protocol_admin, root, _base_registry,
        _maker_treasury, _admin, _catalog, market_config) =
        new_test_fixture(&mut ctx);
    let (_registry, mut treasury) = new_market_objects(&root, &market_config, &mut ctx);
    escrow_payment(
        &mut treasury,
        coin::mint_for_testing<SUI>(10_001, &mut ctx),
        10_000,
    );
    abort EInvalidPayment
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
