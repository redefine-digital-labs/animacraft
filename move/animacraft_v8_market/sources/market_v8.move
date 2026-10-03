/// Activation-safe native Market foundation for the fresh unified Maker v8.
/// Custody and settlement are added only through future concrete typed tickets;
/// this module never treats a pure object ID as authority.
module animacraft_v8_market::market_v8;

use animacraft_v8_core::companion_binding_v2::{
    Self as companion, MakerRuntimeCompanionBindingBuilderV2,
};
use animacraft_v8_core::package_binding_v8::FreshTupleReplacementBindingV2;

/// Constructed only after this module validates its actual companion objects.
public struct MakerCompanionBindingWitnessV2 has drop {}

public fun bind_maker_market_companion_v2<PaymentCoin>(
    builder: MakerRuntimeCompanionBindingBuilderV2<PaymentCoin>,
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    config: &MarketPackageConfigV8,
    registry: &MarketRegistryV8<PaymentCoin>,
    treasury: &MarketTreasuryV8<PaymentCoin>,
    ctx: &TxContext,
): MakerRuntimeCompanionBindingBuilderV2<PaymentCoin> {
    maker::assert_companion_builder_root_v2(&builder, root, admin, ctx);
    binding::assert_catalog_current_v8(protocol_config, catalog);
    binding::assert_replacement_current_v2(replacement, catalog);
    assert_config(root, protocol_config, catalog, replacement, config);
    assert_market_identity(registry, treasury, root, config);
    assert!(registry.sealed, EInvalidState);
    assert_zero_state(registry, treasury);
    companion::append_market_v2(builder, MakerCompanionBindingWitnessV2 {},
        protocol_config, catalog, replacement, object::id(registry), ctx)
}



use std::option::{Self as option, Option};
use animacraft_v8_core::package_binding_v8::{RuntimeCallerCapV1, FreshTupleBootstrapAdminV2};
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
use animacraft_v8_core::base_registry_v8::BaseDefinitionRegistryV8;

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
    PackRegistryV8,
    RuntimeDefinitionRegistryV8,
    ExternalItemProductV8,
    OwnedBaseItemV8,
    OwnedExternalItemV8,
    EquipmentMarketCustodyBindingV8,
};
#[test_only]
use sui::sui::SUI;

const VERSION: u64 = 8;
const BPS_DENOMINATOR: u128 = 10_000;
const QUOTE_MAKER_RESALE: u8 = 0;
const QUOTE_SOUL_RESALE: u8 = 1;
const QUOTE_PHYSICAL_RESALE: u8 = 2;
const QUOTE_EQUIPMENT_RESALE: u8 = 3;
const LISTING_OPEN: u8 = 0;
const LISTING_SETTLED: u8 = 1;
const LISTING_CANCELED: u8 = 2;
const LISTING_RECOVERED: u8 = 3;
const LANE_MAKER: u8 = 0;
const LANE_SOUL: u8 = 1;
const LANE_PHYSICAL_BASE: u8 = 2;
const LANE_PHYSICAL_PACK: u8 = 3;
const LANE_EQUIPMENT_BASE: u8 = 4;
const LANE_EQUIPMENT_EXTERNAL: u8 = 5;

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
const EStaleListingRevision: u64 = 10;
const EInvalidBuyer: u64 = 11;

public struct MarketOriginalMarkerV8 has drop {}
public struct MarketCallableMarkerV8 has drop {}
public struct MarketSetupInstallWitnessV2 has drop {}
public struct MarketRuntimeCallerCapInstallWitnessV2 has drop {}


/// Catalog-installed configuration. The call cap has no abilities and is
/// permanently nested here; callers can never borrow it through an accessor.
public struct MarketPackageConfigV8 has key {
    id: UID,
    version: u64,
    catalog_id: ID,
    product_binding_commitment: vector<u8>,
    call_cap_set_commitment: vector<u8>,
    installation_commitment: vector<u8>,
    runtime_caller_cap: Option<RuntimeCallerCapV1>,
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

/// One explicitly selected Runtime instance. The child retains its seller and
/// epoch during custody; only a paid purchase rotates actual ownership.
public struct EquipmentListingV8<phantom PaymentCoin> has key {
    id: UID,
    version: u64,
    registry_id: ID,
    treasury_id: ID,
    package_config_id: ID,
    root_id: ID,
    maker_version: u64,
    root_content_commitment: vector<u8>,
    custody: EquipmentMarketCustodyBindingV8,
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

public struct MarketListingRepricedV8 has copy, drop {
    listing_id: ID,
    registry_id: ID,
    lane: u8,
    asset_id: ID,
    seller: address,
    previous_revision: u64,
    revision: u64,
    previous_gross_atomic: u64,
    gross_atomic: u64,
    quote_commitment: vector<u8>,
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
public fun quote_equipment_resale_kind_v8(): u8 { QUOTE_EQUIPMENT_RESALE }
public fun lane_equipment_base_v8(): u8 { LANE_EQUIPMENT_BASE }
public fun lane_equipment_external_v8(): u8 { LANE_EQUIPMENT_EXTERNAL }
public fun listing_open_v8(): u8 { LISTING_OPEN }
public fun listing_settled_v8(): u8 { LISTING_SETTLED }
public fun listing_canceled_v8(): u8 { LISTING_CANCELED }
public fun listing_recovered_v8(): u8 { LISTING_RECOVERED }

public fun new_market_package_config_v8(
    catalog: &mut ProductReleaseCatalogV8,
    market_call_cap: PackageCallCapV8<MarketRoleV8>,
    ctx: &mut TxContext,
): MarketPackageConfigV8 {
    let id = object::new(ctx);
    let installation_commitment = binding::consume_market_call_cap_v8(
        catalog, market_call_cap, MarketSetupInstallWitnessV2 {}, object::uid_to_inner(&id));
    let (_, _, _, product, cap_set, _) = binding::catalog_terms_v2(catalog);
    MarketPackageConfigV8 {
        id, version: VERSION, catalog_id: object::id(catalog),
        product_binding_commitment: *binding::product_binding_commitment_v8(product),
        call_cap_set_commitment: *cap_set, installation_commitment,
        runtime_caller_cap: option::none(),
    }
}

public fun install_market_runtime_caller_cap_v2(
    config: &mut MarketPackageConfigV8,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    bootstrap_admin: &mut FreshTupleBootstrapAdminV2,
    cap: RuntimeCallerCapV1,
) {
    assert_config_installation(protocol_config, catalog, replacement, config);
    assert!(config.runtime_caller_cap.is_none(), EInvalidConfig);
    binding::assert_runtime_caller_cap_v1(&cap, 1, replacement, catalog);
    let commitment = *binding::runtime_caller_cap_commitment_v2(&cap);
    config.runtime_caller_cap.fill(cap);
    binding::mark_fresh_tuple_install_v2(protocol_config, bootstrap_admin,
        replacement, catalog, MarketRuntimeCallerCapInstallWitnessV2 {},
        8, object::id(config), option::none(), commitment);
}

fun runtime_caller_cap(config: &MarketPackageConfigV8): &RuntimeCallerCapV1 {
    assert!(config.runtime_caller_cap.is_some(), EInvalidConfig);
    config.runtime_caller_cap.borrow()
}

fun assert_config<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    config: &MarketPackageConfigV8,
) {
    assert_config_installation(protocol_config, catalog, replacement, config);
    assert_return_config(root, catalog, replacement, config);
}

// Returning escrow to its recorded owner remains available after a protocol
// revision/disable. The exact installed Market authority is still mandatory.
fun assert_return_config<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    config: &MarketPackageConfigV8,
) {
    assert_structural_config_installation(catalog, replacement, config);
    maker::assert_product_release_catalog_v8(root, catalog);
    binding::assert_runtime_caller_cap_v1(runtime_caller_cap(config), 1, replacement, catalog);
}

public fun share_market_package_config_v8(config: MarketPackageConfigV8) {
    transfer::share_object(config)
}

public fun new_market_objects_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    config: &MarketPackageConfigV8,
    ctx: &mut TxContext,
): (MarketRegistryV8<PaymentCoin>, MarketTreasuryV8<PaymentCoin>) {
    maker::assert_draft_admin_v8(root, admin);
    assert_config(root, protocol_config, catalog, replacement, config);
    new_market_objects(root, config, ctx)
}

fun new_market_objects<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    config: &MarketPackageConfigV8,
    ctx: &mut TxContext,
): (MarketRegistryV8<PaymentCoin>, MarketTreasuryV8<PaymentCoin>) {
    let economics = maker::root_economics_v8(root);
    let rights = maker::root_rights_v2(root);
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
        catalog_id: config.catalog_id,
        package_config_id: object::id(config),
        product_binding_commitment: config.product_binding_commitment,
        call_cap_set_commitment: config.call_cap_set_commitment,
        root_id: maker::root_id_v8(root),
        maker_version: maker::root_maker_version_v8(root),
        root_content_commitment: *maker::root_content_commitment_v8(root),
        protocol_config_id: maker::economics_protocol_config_id_v2(&economics),
        protocol_config_revision: maker::economics_protocol_config_revision_v2(&economics),
        protocol_config_commitment: *maker::economics_protocol_config_commitment_v2(&economics),
        economics_commitment: *maker::economics_commitment_v2(&economics),
        rights_commitment: *maker::rights_commitment_v2(&rights),
        maker_market_fee_bps: maker::economics_maker_market_fee_bps_v2(&economics),
        soul_market_fee_bps: maker::economics_soul_market_fee_bps_v2(&economics),
        soul_creator_royalty_bps: maker::rights_soul_creator_royalty_bps_v2(&rights),
        maker_source_royalty_bps: maker::rights_maker_source_royalty_bps_v2(&rights),
        maker_resale_royalty_bps: maker::rights_maker_resale_royalty_bps_v2(&rights),
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
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    config: &MarketPackageConfigV8,
) {
    maker::assert_draft_admin_v8(root, admin);
    assert_config(root, protocol_config, catalog, replacement, config);
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

public fun validate_market_activation_readiness_v2<PaymentCoin>(
    registry: &MarketRegistryV8<PaymentCoin>,
    treasury: &MarketTreasuryV8<PaymentCoin>,
    root: &MakerRootV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    config: &MarketPackageConfigV8,
): vector<u8> {
    maker::assert_draft_v8(root);
    assert_config(root, protocol_config, catalog, replacement, config);
    assert_market_identity(registry, treasury, root, config);
    assert!(registry.sealed, EInvalidState);
    assert_zero_state(registry, treasury);
    readiness_commitment(registry, treasury)
}

public fun quote_maker_resale_v8<PaymentCoin>(
    registry: &MarketRegistryV8<PaymentCoin>,
    treasury: &MarketTreasuryV8<PaymentCoin>,
    root: &MakerRootV8<PaymentCoin>,
    gross_atomic: u64,
): MarketQuoteV8 {
    assert_live_market(registry, treasury, root);
    let lifecycle = maker::root_lifecycle_v8(root);
    assert!(lifecycle == maker::lifecycle_active_v8()
        || lifecycle == maker::lifecycle_paused_v8(), EInvalidState);
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

public fun quote_equipment_resale_v8<PaymentCoin>(
    registry: &MarketRegistryV8<PaymentCoin>,
    treasury: &MarketTreasuryV8<PaymentCoin>,
    root: &MakerRootV8<PaymentCoin>,
    gross_atomic: u64,
): MarketQuoteV8 {
    assert_active_market(registry, treasury, root);
    derive_quote(root, QUOTE_EQUIPMENT_RESALE, gross_atomic)
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
    replacement: &FreshTupleReplacementBindingV2,
    config: &MarketPackageConfigV8,
    gross_atomic: u64,
    ctx: &mut TxContext,
): ID {
    assert_config(root, protocol_config, catalog, replacement, config);
    assert_bound_market(registry, treasury, root, config);
    assert!(maker::root_lifecycle_v8(root) == maker::lifecycle_paused_v8(),
        EInvalidState);
    maker::assert_current_protocol_config_v8(root, protocol_config);
    core_treasury::assert_maker_treasury_v8(root, maker_treasury);
    assert!(core_treasury::maker_treasury_balance_v2(maker_treasury) == 0,
        EInvalidState);
    maker::assert_admin_v8(root, &admin);
    let seller = maker::root_owner_v8(root);
    assert!(seller == ctx.sender(), ENotSeller);
    let admin_cap_id = object::id(&admin);
    let expected_control_epoch = maker::root_control_epoch_v2(root);
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
        protocol_config,
        catalog,
        replacement,
        runtime_caller_cap(config),
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
    replacement: &FreshTupleReplacementBindingV2,
    config: &MarketPackageConfigV8,
    receiving: Receiving<MakerAdminCapV8>,
    payment: Coin<PaymentCoin>,
    ctx: &mut TxContext,
) {
    assert_config(root, protocol_config, catalog, replacement, config);
    assert_bound_market(registry, treasury, root, config);
    assert_maker_listing(listing, registry, treasury, root, config);
    assert!(maker::root_lifecycle_v8(root) == maker::lifecycle_paused_v8(),
        EInvalidState);
    maker::assert_current_protocol_config_v8(root, protocol_config);
    assert!(maker::root_owner_v8(root) == listing.seller, EInvalidListing);
    assert!(maker::root_control_epoch_v2(root) == listing.expected_control_epoch,
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
        protocol_config,
        catalog,
        replacement,
        runtime_caller_cap(config),
        &mut listing.id,
        receiving,
        buyer,
        ctx,
    );
    release_maker_payment(
        treasury,
        protocol_config,
        protocol_treasury,
        maker::root_creator_v2(root),
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
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    config: &MarketPackageConfigV8,
    receiving: Receiving<MakerAdminCapV8>,
    ctx: &mut TxContext,
) {
    assert_return_config(root, catalog, replacement, config);
    assert_bound_market(registry, treasury, root, config);
    assert_maker_listing(listing, registry, treasury, root, config);
    assert!(ctx.sender() == listing.seller, ENotSeller);
    assert!(transfer::receiving_object_id(&receiving) == listing.admin_cap_id,
        EInvalidListing);
    maker::resolve_maker_admin_from_market_v8(
        root,
        protocol_config,
        catalog,
        replacement,
        runtime_caller_cap(config),
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
    replacement: &FreshTupleReplacementBindingV2,
    config: &MarketPackageConfigV8,
    receiving: Receiving<MakerAdminCapV8>,
    ctx: &mut TxContext,
) {
    assert_return_config(root, catalog, replacement, config);
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
        protocol_config,
        catalog,
        replacement,
        runtime_caller_cap(config),
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
    replacement: &FreshTupleReplacementBindingV2,
    config: &MarketPackageConfigV8,
    output_asset: CompleteOutputV8,
    receipt: CompleteReceiptV8,
    soul: CanonicalSoulV8,
    gross_atomic: u64,
    ctx: &mut TxContext,
): ID {
    assert_config(root, protocol_config, catalog, replacement, config);
    assert_bound_market(registry, treasury, root, config);
    assert_active_market(registry, treasury, root);
    maker::assert_current_protocol_config_v8(root, protocol_config);
    let quote = derive_quote(root, QUOTE_SOUL_RESALE, gross_atomic);
    let mut listing_uid = object::new(ctx);
    let ticket = output::custody_soul_bundle_for_market_v8<
        PaymentCoin,
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
        replacement,
        registry,
        treasury,
        runtime_caller_cap(config),
        ctx,
    );
    let custody = output::consume_soul_market_custody_ticket_v8<
        PaymentCoin,
        MarketRegistryV8<PaymentCoin>,
        MarketTreasuryV8<PaymentCoin>,
    >(
        ticket,
        &listing_uid,
        output_registry,
        soul_registry,
        root,
        protocol_config,
        catalog,
        replacement,
        registry,
        treasury,
        runtime_caller_cap(config),
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
    replacement: &FreshTupleReplacementBindingV2,
    config: &MarketPackageConfigV8,
    output_receiving: Receiving<CompleteOutputV8>,
    receipt_receiving: Receiving<CompleteReceiptV8>,
    soul_receiving: Receiving<CanonicalSoulV8>,
    payment: Coin<PaymentCoin>,
    ctx: &mut TxContext,
) {
    assert_config(root, protocol_config, catalog, replacement, config);
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
        replacement,
        registry,
        treasury,
        runtime_caller_cap(config),
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
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    config: &MarketPackageConfigV8,
    output_receiving: Receiving<CompleteOutputV8>,
    receipt_receiving: Receiving<CompleteReceiptV8>,
    soul_receiving: Receiving<CanonicalSoulV8>,
    ctx: &mut TxContext,
) {
    assert_return_config(root, catalog, replacement, config);
    assert_bound_market(registry, treasury, root, config);
    assert_soul_listing(listing, registry, treasury, root, config);
    assert!(ctx.sender() == output::soul_market_seller_v8(&listing.custody), ENotSeller);
    output::return_soul_bundle_from_market_v8<
        PaymentCoin,
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
        replacement,
        registry,
        treasury,
        runtime_caller_cap(config),
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
    replacement: &FreshTupleReplacementBindingV2,
    config: &MarketPackageConfigV8,
    output_receiving: Receiving<CompleteOutputV8>,
    receipt_receiving: Receiving<CompleteReceiptV8>,
    soul_receiving: Receiving<CanonicalSoulV8>,
) {
    assert_return_config(root, catalog, replacement, config);
    assert_bound_market(registry, treasury, root, config);
    assert_soul_listing(listing, registry, treasury, root, config);
    assert_protocol_object(registry, protocol_config);
    assert!(asset_recoverable(registry, root, protocol_config), ENotRecoverable);
    output::return_soul_bundle_from_market_v8<
        PaymentCoin,
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
        replacement,
        registry,
        treasury,
        runtime_caller_cap(config),
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
    replacement: &FreshTupleReplacementBindingV2,
    physical_config: &PhysicalPackageConfigV8,
    config: &MarketPackageConfigV8,
    asset: PhysicalAssetV8,
    gross_atomic: u64,
    ctx: &mut TxContext,
): ID {
    assert_config(root, protocol_config, catalog, replacement, config);
    assert_bound_market(registry, treasury, root, config);
    assert_active_market(registry, treasury, root);
    maker::assert_current_protocol_config_v8(root, protocol_config);
    let quote = derive_quote(root, QUOTE_PHYSICAL_RESALE, gross_atomic);
    let mut listing_uid = object::new(ctx);
    let ticket = physical::custody_base_physical_for_market_v8<
        PaymentCoin,
        MarketRegistryV8<PaymentCoin>,
        MarketTreasuryV8<PaymentCoin>,
    >(
        physical_registry,
        root,
        protocol_config,
        catalog,
        replacement,
        physical_config,
        runtime_caller_cap(config),
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
    replacement: &FreshTupleReplacementBindingV2,
    physical_config: &PhysicalPackageConfigV8,
    config: &MarketPackageConfigV8,
    asset: PhysicalAssetV8,
    gross_atomic: u64,
    ctx: &mut TxContext,
): ID {
    assert_config(root, protocol_config, catalog, replacement, config);
    assert_bound_market(registry, treasury, root, config);
    assert_active_market(registry, treasury, root);
    maker::assert_current_protocol_config_v8(root, protocol_config);
    let quote = derive_quote(root, QUOTE_PHYSICAL_RESALE, gross_atomic);
    let mut listing_uid = object::new(ctx);
    let ticket = physical::custody_pack_physical_for_market_v8<
        PaymentCoin,
        MarketRegistryV8<PaymentCoin>,
        MarketTreasuryV8<PaymentCoin>,
    >(
        physical_registry,
        root,
        protocol_config,
        catalog,
        replacement,
        physical_config,
        runtime_caller_cap(config),
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
    replacement: &FreshTupleReplacementBindingV2,
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
        replacement,
        config,
        physical::source_base_style_v8(),
    );
    core_treasury::assert_maker_treasury_v8(root, maker_treasury);
    let quote = derive_quote(root, QUOTE_PHYSICAL_RESALE, listing.gross_atomic);
    assert_physical_quote(listing, &quote);
    escrow_payment(treasury, payment, listing.gross_atomic);
    physical::purchase_base_physical_from_market_v8<
        PaymentCoin,
        MarketRegistryV8<PaymentCoin>,
        MarketTreasuryV8<PaymentCoin>,
    >(
        physical_registry,
        root,
        protocol_config,
        catalog,
        replacement,
        physical_config,
        runtime_caller_cap(config),
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
    replacement: &FreshTupleReplacementBindingV2,
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
        replacement,
        config,
        physical::source_pack_style_v8(),
    );
    let quote = derive_quote(root, QUOTE_PHYSICAL_RESALE, listing.gross_atomic);
    assert_physical_quote(listing, &quote);
    escrow_payment(treasury, payment, listing.gross_atomic);
    physical::purchase_pack_physical_from_market_v8<
        PaymentCoin,
        MarketRegistryV8<PaymentCoin>,
        MarketTreasuryV8<PaymentCoin>,
    >(
        physical_registry,
        root,
        protocol_config,
        catalog,
        replacement,
        physical_config,
        runtime_caller_cap(config),
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
        maker::root_creator_v2(root),
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
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    config: &MarketPackageConfigV8,
    receiving: Receiving<PhysicalAssetV8>,
    ctx: &TxContext,
) {
    assert_return_config(root, catalog, replacement, config);
    assert_bound_market(registry, treasury, root, config);
    assert_physical_listing(listing, registry, treasury, root, config);
    assert!(ctx.sender()
        == physical::physical_market_custody_holder_v8(&listing.custody), ENotSeller);
    physical::return_physical_from_market_v8<
        PaymentCoin,
        MarketRegistryV8<PaymentCoin>,
        MarketTreasuryV8<PaymentCoin>,
    >(
        physical_registry,
        root,
        protocol_config,
        catalog,
        replacement,
        runtime_caller_cap(config),
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
    replacement: &FreshTupleReplacementBindingV2,
    config: &MarketPackageConfigV8,
    receiving: Receiving<PhysicalAssetV8>,
) {
    assert_return_config(root, catalog, replacement, config);
    assert_bound_market(registry, treasury, root, config);
    assert_physical_listing(listing, registry, treasury, root, config);
    assert_protocol_object(registry, protocol_config);
    assert!(asset_recoverable(registry, root, protocol_config), ENotRecoverable);
    physical::return_physical_from_market_v8<
        PaymentCoin,
        MarketRegistryV8<PaymentCoin>,
        MarketTreasuryV8<PaymentCoin>,
    >(
        physical_registry,
        root,
        protocol_config,
        catalog,
        replacement,
        runtime_caller_cap(config),
        registry,
        treasury,
        &mut listing.id,
        receiving,
        &listing.custody,
    );
    close_physical_listing(registry, listing, true)
}

/// Base instances retain their PackRegistry entitlement while listed.
public fun list_base_equipment_v8<PaymentCoin>(
    registry: &mut MarketRegistryV8<PaymentCoin>,
    treasury: &MarketTreasuryV8<PaymentCoin>,
    root: &MakerRootV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    config: &MarketPackageConfigV8,
    packs: &PackRegistryV8,
    definitions: &RuntimeDefinitionRegistryV8,
    base: &BaseDefinitionRegistryV8,
    item: OwnedBaseItemV8,
    gross_atomic: u64,
    ctx: &mut TxContext,
): ID {
    assert_equipment_current_market(registry, treasury, root, protocol_config, catalog, replacement, config);
    let quote = derive_quote(root, QUOTE_EQUIPMENT_RESALE, gross_atomic);
    let mut id = object::new(ctx);
    let ticket = runtime::custody_owned_base_item_for_market_v8(root, protocol_config,
        catalog, replacement, runtime_caller_cap(config), registry, treasury, &mut id,
        packs, definitions, base, item, ctx);
    let listing = EquipmentListingV8<PaymentCoin> {
        id, version: VERSION, registry_id: object::id(registry), treasury_id: object::id(treasury),
        package_config_id: object::id(config), root_id: maker::root_id_v8(root),
        maker_version: maker::root_maker_version_v8(root),
        root_content_commitment: *maker::root_content_commitment_v8(root),
        custody: runtime::consume_equipment_market_custody_ticket_v8(ticket),
        gross_atomic: quote.gross_atomic, protocol_atomic: quote.protocol_atomic,
        creator_atomic: 0, source_atomic: 0, seller_atomic: quote.seller_atomic,
        quote_commitment: quote.commitment, status: LISTING_OPEN, revision: 0, terminal_recipient: @0x0,
    };
    share_equipment_listing(listing, registry, runtime::source_base_v8(), ctx)
}

public fun list_external_equipment_v8<PaymentCoin>(
    registry: &mut MarketRegistryV8<PaymentCoin>,
    treasury: &MarketTreasuryV8<PaymentCoin>,
    root: &MakerRootV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    config: &MarketPackageConfigV8,
    product: &ExternalItemProductV8,
    item: OwnedExternalItemV8,
    gross_atomic: u64,
    ctx: &mut TxContext,
): ID {
    assert_equipment_current_market(registry, treasury, root, protocol_config, catalog, replacement, config);
    let quote = derive_quote(root, QUOTE_EQUIPMENT_RESALE, gross_atomic);
    let mut id = object::new(ctx);
    let ticket = runtime::custody_owned_external_item_for_market_v8(root, protocol_config,
        catalog, replacement, runtime_caller_cap(config), registry, treasury, &mut id,
        product, item, ctx);
    let listing = EquipmentListingV8<PaymentCoin> {
        id, version: VERSION, registry_id: object::id(registry), treasury_id: object::id(treasury),
        package_config_id: object::id(config), root_id: maker::root_id_v8(root),
        maker_version: maker::root_maker_version_v8(root),
        root_content_commitment: *maker::root_content_commitment_v8(root),
        custody: runtime::consume_equipment_market_custody_ticket_v8(ticket),
        gross_atomic: quote.gross_atomic, protocol_atomic: quote.protocol_atomic,
        creator_atomic: 0, source_atomic: 0, seller_atomic: quote.seller_atomic,
        quote_commitment: quote.commitment, status: LISTING_OPEN, revision: 0, terminal_recipient: @0x0,
    };
    share_equipment_listing(listing, registry, runtime::source_external_v8(), ctx)
}

/// Repricing never changes the selected asset, custody parent, source or owner.
public fun reprice_equipment_listing_v8<PaymentCoin>(
    listing: &mut EquipmentListingV8<PaymentCoin>,
    registry: &mut MarketRegistryV8<PaymentCoin>,
    treasury: &MarketTreasuryV8<PaymentCoin>,
    root: &MakerRootV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    config: &MarketPackageConfigV8,
    expected_revision: u64,
    gross_atomic: u64,
    ctx: &TxContext,
) {
    assert_equipment_current_market(registry, treasury, root, protocol_config, catalog, replacement, config);
    assert_equipment_listing(listing, registry, treasury, root, config, expected_revision);
    assert!(equipment_listing_seller_v8(listing) == ctx.sender(), ENotSeller);
    let quote = derive_quote(root, QUOTE_EQUIPMENT_RESALE, gross_atomic);
    let previous_gross_atomic = listing.gross_atomic;
    listing.gross_atomic = quote.gross_atomic;
    listing.protocol_atomic = quote.protocol_atomic;
    listing.creator_atomic = quote.creator_atomic;
    listing.source_atomic = quote.source_atomic;
    listing.seller_atomic = quote.seller_atomic;
    listing.quote_commitment = quote.commitment;
    listing.revision = listing.revision + 1;
    registry.revision = registry.revision + 1;
    event::emit(MarketListingRepricedV8 {
        listing_id: object::id(listing), registry_id: object::id(registry),
        lane: equipment_lane(&listing.custody), asset_id: equipment_listing_asset_id_v8(listing),
        seller: equipment_listing_seller_v8(listing), previous_revision: expected_revision,
        revision: listing.revision, previous_gross_atomic, gross_atomic,
        quote_commitment: listing.quote_commitment,
    });
}

public fun purchase_base_equipment_v8<PaymentCoin>(
    listing: &mut EquipmentListingV8<PaymentCoin>,
    registry: &mut MarketRegistryV8<PaymentCoin>,
    treasury: &mut MarketTreasuryV8<PaymentCoin>,
    root: &MakerRootV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    protocol_treasury: &mut ProtocolTreasuryV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    config: &MarketPackageConfigV8,
    packs: &mut PackRegistryV8,
    definitions: &RuntimeDefinitionRegistryV8,
    receiving: Receiving<OwnedBaseItemV8>,
    payment: Coin<PaymentCoin>,
    expected_revision: u64,
    ctx: &mut TxContext,
) {
    let quote = assert_equipment_purchase(listing, registry, treasury, root, protocol_config,
        catalog, replacement, config, runtime::source_base_v8(), expected_revision, ctx);
    escrow_payment(treasury, payment, quote.gross_atomic);
    runtime::purchase_owned_base_item_from_market_v8(root, protocol_config, catalog,
        replacement, runtime_caller_cap(config), registry, treasury, &mut listing.id,
        packs, definitions, receiving, &listing.custody, ctx);
    release_equipment_payment(treasury, protocol_config, protocol_treasury,
        equipment_listing_seller_v8(listing), &quote, ctx);
    settle_equipment_listing(listing, registry, &quote, ctx.sender());
}

public fun purchase_external_equipment_v8<PaymentCoin>(
    listing: &mut EquipmentListingV8<PaymentCoin>,
    registry: &mut MarketRegistryV8<PaymentCoin>,
    treasury: &mut MarketTreasuryV8<PaymentCoin>,
    root: &MakerRootV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    protocol_treasury: &mut ProtocolTreasuryV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    config: &MarketPackageConfigV8,
    receiving: Receiving<OwnedExternalItemV8>,
    payment: Coin<PaymentCoin>,
    expected_revision: u64,
    ctx: &mut TxContext,
) {
    let quote = assert_equipment_purchase(listing, registry, treasury, root, protocol_config,
        catalog, replacement, config, runtime::source_external_v8(), expected_revision, ctx);
    escrow_payment(treasury, payment, quote.gross_atomic);
    runtime::purchase_owned_external_item_from_market_v8(root, protocol_config, catalog,
        replacement, runtime_caller_cap(config), registry, treasury, &mut listing.id,
        receiving, &listing.custody, ctx);
    release_equipment_payment(treasury, protocol_config, protocol_treasury,
        equipment_listing_seller_v8(listing), &quote, ctx);
    settle_equipment_listing(listing, registry, &quote, ctx.sender());
}

/// Cancellation returns the exact instance to its seller without an active
/// Root or current protocol requirement. Typed Runtime receiving checks both
/// the real child and its frozen full-object commitment.
public fun cancel_base_equipment_listing_v8<PaymentCoin>(
    listing: &mut EquipmentListingV8<PaymentCoin>,
    registry: &mut MarketRegistryV8<PaymentCoin>,
    treasury: &MarketTreasuryV8<PaymentCoin>,
    root: &MakerRootV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    config: &MarketPackageConfigV8,
    packs: &PackRegistryV8,
    definitions: &RuntimeDefinitionRegistryV8,
    receiving: Receiving<OwnedBaseItemV8>,
    expected_revision: u64,
    ctx: &TxContext,
) {
    assert_equipment_return(listing, registry, treasury, root, catalog, replacement,
        config, runtime::source_base_v8(), expected_revision);
    assert!(equipment_listing_seller_v8(listing) == ctx.sender(), ENotSeller);
    runtime::return_owned_base_item_from_market_v8(root, catalog, replacement,
        runtime_caller_cap(config), registry, treasury, &mut listing.id,
        packs, definitions, receiving, &listing.custody);
    close_equipment_listing(listing, registry, false);
}

public fun cancel_external_equipment_listing_v8<PaymentCoin>(
    listing: &mut EquipmentListingV8<PaymentCoin>,
    registry: &mut MarketRegistryV8<PaymentCoin>,
    treasury: &MarketTreasuryV8<PaymentCoin>,
    root: &MakerRootV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    config: &MarketPackageConfigV8,
    receiving: Receiving<OwnedExternalItemV8>,
    expected_revision: u64,
    ctx: &TxContext,
) {
    assert_equipment_return(listing, registry, treasury, root, catalog, replacement,
        config, runtime::source_external_v8(), expected_revision);
    assert!(equipment_listing_seller_v8(listing) == ctx.sender(), ENotSeller);
    runtime::return_owned_external_item_from_market_v8(root, catalog, replacement,
        runtime_caller_cap(config), registry, treasury, &mut listing.id, receiving, &listing.custody);
    close_equipment_listing(listing, registry, false);
}

/// Permissionless recovery is limited to the existing paused/archived/degraded
/// Market rule, and can send the item only to the recorded seller.
public fun recover_base_equipment_listing_v8<PaymentCoin>(
    listing: &mut EquipmentListingV8<PaymentCoin>,
    registry: &mut MarketRegistryV8<PaymentCoin>,
    treasury: &MarketTreasuryV8<PaymentCoin>,
    root: &MakerRootV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    config: &MarketPackageConfigV8,
    packs: &PackRegistryV8,
    definitions: &RuntimeDefinitionRegistryV8,
    receiving: Receiving<OwnedBaseItemV8>,
    expected_revision: u64,
) {
    assert_equipment_return(listing, registry, treasury, root, catalog, replacement,
        config, runtime::source_base_v8(), expected_revision);
    assert_protocol_object(registry, protocol_config);
    assert!(asset_recoverable(registry, root, protocol_config), ENotRecoverable);
    runtime::return_owned_base_item_from_market_v8(root, catalog, replacement,
        runtime_caller_cap(config), registry, treasury, &mut listing.id,
        packs, definitions, receiving, &listing.custody);
    close_equipment_listing(listing, registry, true);
}

public fun recover_external_equipment_listing_v8<PaymentCoin>(
    listing: &mut EquipmentListingV8<PaymentCoin>,
    registry: &mut MarketRegistryV8<PaymentCoin>,
    treasury: &MarketTreasuryV8<PaymentCoin>,
    root: &MakerRootV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    config: &MarketPackageConfigV8,
    receiving: Receiving<OwnedExternalItemV8>,
    expected_revision: u64,
) {
    assert_equipment_return(listing, registry, treasury, root, catalog, replacement,
        config, runtime::source_external_v8(), expected_revision);
    assert_protocol_object(registry, protocol_config);
    assert!(asset_recoverable(registry, root, protocol_config), ENotRecoverable);
    runtime::return_owned_external_item_from_market_v8(root, catalog, replacement,
        runtime_caller_cap(config), registry, treasury, &mut listing.id, receiving, &listing.custody);
    close_equipment_listing(listing, registry, true);
}

fun assert_equipment_current_market<PaymentCoin>(
    registry: &MarketRegistryV8<PaymentCoin>, treasury: &MarketTreasuryV8<PaymentCoin>,
    root: &MakerRootV8<PaymentCoin>, protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8, replacement: &FreshTupleReplacementBindingV2,
    config: &MarketPackageConfigV8,
) {
    assert_config(root, protocol_config, catalog, replacement, config);
    assert_bound_market(registry, treasury, root, config);
    assert_active_market(registry, treasury, root);
    maker::assert_current_protocol_config_v8(root, protocol_config);
}

fun equipment_lane(custody: &EquipmentMarketCustodyBindingV8): u8 {
    let kind = runtime::equipment_market_custody_asset_kind_v8(custody);
    if (kind == runtime::source_base_v8()) LANE_EQUIPMENT_BASE
    else { assert!(kind == runtime::source_external_v8(), EInvalidListing); LANE_EQUIPMENT_EXTERNAL }
}

fun share_equipment_listing<PaymentCoin>(
    listing: EquipmentListingV8<PaymentCoin>, registry: &mut MarketRegistryV8<PaymentCoin>,
    kind: u8, ctx: &TxContext,
): ID {
    assert!(runtime::equipment_market_custody_listing_id_v8(&listing.custody) == object::id(&listing)
        && runtime::equipment_market_custody_asset_kind_v8(&listing.custody) == kind, EInvalidListing);
    assert!(runtime::equipment_market_custody_holder_v8(&listing.custody) == ctx.sender()
        && ctx.sender() != @0x0, ENotSeller);
    assert!(listing.creator_atomic == 0 && listing.source_atomic == 0, EInvalidCommitment);
    open_listing(registry);
    let listing_id = object::id(&listing);
    event::emit(MarketListingOpenedV8 {
        listing_id, registry_id: object::id(registry), lane: equipment_lane(&listing.custody),
        root_id: listing.root_id, asset_id: equipment_listing_asset_id_v8(&listing),
        seller: equipment_listing_seller_v8(&listing),
        ownership_epoch: equipment_listing_ownership_epoch_v8(&listing),
        gross_atomic: listing.gross_atomic, quote_commitment: listing.quote_commitment,
    });
    transfer::share_object(listing);
    listing_id
}

fun assert_equipment_listing<PaymentCoin>(
    listing: &EquipmentListingV8<PaymentCoin>, registry: &MarketRegistryV8<PaymentCoin>,
    treasury: &MarketTreasuryV8<PaymentCoin>, root: &MakerRootV8<PaymentCoin>,
    config: &MarketPackageConfigV8, expected_revision: u64,
) {
    assert!(listing.version == VERSION && listing.status == LISTING_OPEN, EInvalidListing);
    assert!(listing.revision == expected_revision, EStaleListingRevision);
    assert!(listing.registry_id == object::id(registry) && listing.treasury_id == object::id(treasury)
        && listing.package_config_id == object::id(config), EInvalidListing);
    maker::assert_root_identity_v8(root, listing.root_id, listing.maker_version, &listing.root_content_commitment);
    assert!(runtime::equipment_market_custody_listing_id_v8(&listing.custody) == object::id(listing)
        && equipment_listing_seller_v8(listing) != @0x0 && listing.gross_atomic > 0
        && listing.creator_atomic == 0 && listing.source_atomic == 0, EInvalidListing);
}

fun assert_equipment_purchase<PaymentCoin>(
    listing: &EquipmentListingV8<PaymentCoin>, registry: &MarketRegistryV8<PaymentCoin>,
    treasury: &MarketTreasuryV8<PaymentCoin>, root: &MakerRootV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8, catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2, config: &MarketPackageConfigV8,
    kind: u8, expected_revision: u64, ctx: &TxContext,
): MarketQuoteV8 {
    assert_equipment_current_market(registry, treasury, root, protocol_config, catalog, replacement, config);
    assert_equipment_listing(listing, registry, treasury, root, config, expected_revision);
    assert!(equipment_listing_asset_kind_v8(listing) == kind, EInvalidListing);
    assert!(ctx.sender() != @0x0 && ctx.sender() != equipment_listing_seller_v8(listing), EInvalidBuyer);
    let quote = derive_quote(root, QUOTE_EQUIPMENT_RESALE, listing.gross_atomic);
    assert_asset_quote(listing.gross_atomic, listing.protocol_atomic, listing.creator_atomic,
        listing.source_atomic, listing.seller_atomic, &listing.quote_commitment, QUOTE_EQUIPMENT_RESALE, &quote);
    quote
}

fun assert_equipment_return<PaymentCoin>(
    listing: &EquipmentListingV8<PaymentCoin>, registry: &MarketRegistryV8<PaymentCoin>,
    treasury: &MarketTreasuryV8<PaymentCoin>, root: &MakerRootV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8, replacement: &FreshTupleReplacementBindingV2,
    config: &MarketPackageConfigV8, kind: u8, expected_revision: u64,
) {
    assert_return_config(root, catalog, replacement, config);
    assert_bound_market(registry, treasury, root, config);
    assert_equipment_listing(listing, registry, treasury, root, config, expected_revision);
    assert!(equipment_listing_asset_kind_v8(listing) == kind, EInvalidListing);
}

fun release_equipment_payment<PaymentCoin>(
    treasury: &mut MarketTreasuryV8<PaymentCoin>, protocol_config: &ProtocolConfigV8,
    protocol_treasury: &mut ProtocolTreasuryV8<PaymentCoin>, seller: address,
    quote: &MarketQuoteV8, ctx: &mut TxContext,
) {
    assert!(quote.quote_kind == QUOTE_EQUIPMENT_RESALE && quote.creator_atomic == 0
        && quote.source_atomic == 0 && quote.protocol_atomic > 0, EInvalidCommitment);
    let fee = coin::take(&mut treasury.escrow, quote.protocol_atomic, ctx);
    protocol::deposit_protocol_revenue_v8(protocol_config, protocol_treasury, fee);
    let proceeds = coin::take(&mut treasury.escrow, quote.seller_atomic, ctx);
    transfer::public_transfer(proceeds, seller);
    treasury.gross_released_atomic = treasury.gross_released_atomic + (quote.gross_atomic as u128);
    assert!(treasury.escrow.value() == 0, EInvalidState);
}

fun settle_equipment_listing<PaymentCoin>(
    listing: &mut EquipmentListingV8<PaymentCoin>, registry: &mut MarketRegistryV8<PaymentCoin>,
    quote: &MarketQuoteV8, buyer: address,
) {
    settle_listing(registry, listing.gross_atomic, quote);
    listing.status = LISTING_SETTLED;
    listing.revision = listing.revision + 1;
    listing.terminal_recipient = buyer;
    event::emit(MarketListingSettledV8 {
        listing_id: object::id(listing), registry_id: object::id(registry), lane: equipment_lane(&listing.custody),
        asset_id: equipment_listing_asset_id_v8(listing), seller: equipment_listing_seller_v8(listing), buyer,
        gross_atomic: quote.gross_atomic, protocol_atomic: quote.protocol_atomic,
        creator_atomic: 0, source_atomic: 0, seller_atomic: quote.seller_atomic,
    });
}

fun close_equipment_listing<PaymentCoin>(
    listing: &mut EquipmentListingV8<PaymentCoin>, registry: &mut MarketRegistryV8<PaymentCoin>, recovered: bool,
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
    listing.terminal_recipient = equipment_listing_seller_v8(listing);
    event::emit(MarketListingClosedV8 {
        listing_id: object::id(listing), registry_id: object::id(registry), lane: equipment_lane(&listing.custody),
        asset_id: equipment_listing_asset_id_v8(listing), seller: equipment_listing_seller_v8(listing), recovered,
    });
}

fun derive_quote<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    quote_kind: u8,
    gross_atomic: u64,
): MarketQuoteV8 {
    assert!(gross_atomic > 0, EInvalidAmount);
    let economics = maker::root_economics_v8(root);
    let rights = maker::root_rights_v2(root);
    let (protocol_bps, creator_bps, source_bps) = if (quote_kind == QUOTE_MAKER_RESALE) {
        (
            maker::economics_maker_market_fee_bps_v2(&economics),
            maker::rights_maker_resale_royalty_bps_v2(&rights),
            0,
        )
    } else if (quote_kind == QUOTE_EQUIPMENT_RESALE) {
        // Confirmed equipment policy: the same 2.5% protocol market fee,
        // without Soul/Physical creator or Maker-source royalties.
        let fee = maker::economics_soul_market_fee_bps_v2(&economics);
        assert!(fee == 250, EInvalidConfig);
        (fee, 0, 0)
    } else {
        assert!(quote_kind == QUOTE_SOUL_RESALE
            || quote_kind == QUOTE_PHYSICAL_RESALE, EInvalidState);
        (
            maker::economics_soul_market_fee_bps_v2(&economics),
            maker::rights_soul_creator_royalty_bps_v2(&rights),
            maker::rights_maker_source_royalty_bps_v2(&rights),
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
    let economics_commitment = *maker::economics_commitment_v2(&economics);
    let rights_commitment = *maker::rights_commitment_v2(&rights);
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
    assert!(companion::market_registry_id_v2(maker::root_companion_registry_ids_v2(root))
        == object::id(registry), EInvalidBinding);
    assert!(registry.treasury_id == object::id(treasury), EInvalidBinding);
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
    replacement: &FreshTupleReplacementBindingV2,
    config: &MarketPackageConfigV8,
    expected_source_kind: u8,
) {
    assert_config(root, protocol_config, catalog, replacement, config);
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
    !protocol::config_enabled_v2(config)
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
        transfer::public_transfer(creator_payment, maker::root_creator_v2(root));
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
        protocol_config_id: maker::economics_protocol_config_id_v2(economics),
        protocol_config_revision: maker::economics_protocol_config_revision_v2(economics),
        protocol_config_commitment: *maker::economics_protocol_config_commitment_v2(economics),
        economics_commitment: *maker::economics_commitment_v2(economics),
        rights_commitment: *maker::rights_commitment_v2(rights),
        maker_market_fee_bps: maker::economics_maker_market_fee_bps_v2(economics),
        soul_market_fee_bps: maker::economics_soul_market_fee_bps_v2(economics),
        soul_creator_royalty_bps: maker::rights_soul_creator_royalty_bps_v2(rights),
        maker_source_royalty_bps: maker::rights_maker_source_royalty_bps_v2(rights),
        maker_resale_royalty_bps: maker::rights_maker_resale_royalty_bps_v2(rights),
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

fun assert_config_installation(
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    config: &MarketPackageConfigV8,
) {
    binding::assert_catalog_current_v8(protocol_config, catalog);
    assert_structural_config_installation(catalog, replacement, config);
}

fun assert_structural_config_installation(
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    config: &MarketPackageConfigV8,
) {
    binding::assert_replacement_current_v2(replacement, catalog);
    assert!(config.version == VERSION && config.catalog_id == object::id(catalog), EInvalidConfig);
    let (_, _, _, product, cap_set, _) = binding::catalog_terms_v2(catalog);
    assert!(&config.product_binding_commitment == binding::product_binding_commitment_v8(product)
        && &config.call_cap_set_commitment == cap_set, EInvalidConfig);
    binding::assert_role_config_installation_v2(catalog, 5, object::id(config),
        &config.installation_commitment);
}

fun assert_market_identity<PaymentCoin>(
    registry: &MarketRegistryV8<PaymentCoin>,
    treasury: &MarketTreasuryV8<PaymentCoin>,
    root: &MakerRootV8<PaymentCoin>,
    config: &MarketPackageConfigV8,
) {
    assert!(treasury.version == VERSION, EInvalidBinding);
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
    let rights = maker::root_rights_v2(root);
    assert!(registry.protocol_config_id
        == maker::economics_protocol_config_id_v2(&economics), EInvalidBinding);
    assert!(registry.protocol_config_revision
        == maker::economics_protocol_config_revision_v2(&economics), EInvalidBinding);
    assert!(&registry.protocol_config_commitment
        == maker::economics_protocol_config_commitment_v2(&economics), EInvalidBinding);
    assert!(&registry.economics_commitment
        == maker::economics_commitment_v2(&economics), EInvalidBinding);
    assert!(&registry.rights_commitment
        == maker::rights_commitment_v2(&rights), EInvalidBinding);
    assert!(registry.maker_market_fee_bps
        == maker::economics_maker_market_fee_bps_v2(&economics), EInvalidBinding);
    assert!(registry.soul_market_fee_bps
        == maker::economics_soul_market_fee_bps_v2(&economics), EInvalidBinding);
    assert!(registry.soul_creator_royalty_bps
        == maker::rights_soul_creator_royalty_bps_v2(&rights), EInvalidBinding);
    assert!(registry.maker_source_royalty_bps
        == maker::rights_maker_source_royalty_bps_v2(&rights), EInvalidBinding);
    assert!(registry.maker_resale_royalty_bps
        == maker::rights_maker_resale_royalty_bps_v2(&rights), EInvalidBinding);
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
    assert!(maker::root_lifecycle_v8(root) == maker::lifecycle_active_v8(), EInvalidState);
    assert_live_market(registry, treasury, root)
}

fun assert_live_market<PaymentCoin>(
    registry: &MarketRegistryV8<PaymentCoin>,
    treasury: &MarketTreasuryV8<PaymentCoin>,
    root: &MakerRootV8<PaymentCoin>,
) {
    maker::assert_root_identity_v8(root, registry.root_id, registry.maker_version,
        &registry.root_content_commitment);
    maker::assert_root_identity_v8(root, treasury.root_id, treasury.maker_version,
        &treasury.root_content_commitment);
    assert!(companion::market_registry_id_v2(maker::root_companion_registry_ids_v2(root))
        == object::id(registry), EInvalidBinding);
    assert!(registry.treasury_id == object::id(treasury), EInvalidBinding);
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

public fun equipment_listing_id_v8<PaymentCoin>(listing: &EquipmentListingV8<PaymentCoin>): ID { object::id(listing) }
public fun equipment_listing_status_v8<PaymentCoin>(listing: &EquipmentListingV8<PaymentCoin>): u8 { listing.status }
public fun equipment_listing_revision_v8<PaymentCoin>(listing: &EquipmentListingV8<PaymentCoin>): u64 { listing.revision }
public fun equipment_listing_registry_id_v8<PaymentCoin>(listing: &EquipmentListingV8<PaymentCoin>): ID { listing.registry_id }
public fun equipment_listing_treasury_id_v8<PaymentCoin>(listing: &EquipmentListingV8<PaymentCoin>): ID { listing.treasury_id }
public fun equipment_listing_package_config_id_v8<PaymentCoin>(listing: &EquipmentListingV8<PaymentCoin>): ID { listing.package_config_id }
public fun equipment_listing_root_id_v8<PaymentCoin>(listing: &EquipmentListingV8<PaymentCoin>): ID { listing.root_id }
public fun equipment_listing_maker_version_v8<PaymentCoin>(listing: &EquipmentListingV8<PaymentCoin>): u64 { listing.maker_version }
public fun equipment_listing_root_content_commitment_v8<PaymentCoin>(listing: &EquipmentListingV8<PaymentCoin>): &vector<u8> { &listing.root_content_commitment }
public fun equipment_listing_custody_v8<PaymentCoin>(listing: &EquipmentListingV8<PaymentCoin>): &EquipmentMarketCustodyBindingV8 { &listing.custody }
public fun equipment_listing_asset_id_v8<PaymentCoin>(listing: &EquipmentListingV8<PaymentCoin>): ID {
    runtime::equipment_market_custody_asset_id_v8(&listing.custody)
}
public fun equipment_listing_asset_kind_v8<PaymentCoin>(listing: &EquipmentListingV8<PaymentCoin>): u8 {
    runtime::equipment_market_custody_asset_kind_v8(&listing.custody)
}
public fun equipment_listing_source_id_v8<PaymentCoin>(listing: &EquipmentListingV8<PaymentCoin>): ID {
    runtime::equipment_market_custody_source_id_v8(&listing.custody)
}
public fun equipment_listing_seller_v8<PaymentCoin>(listing: &EquipmentListingV8<PaymentCoin>): address {
    runtime::equipment_market_custody_holder_v8(&listing.custody)
}
public fun equipment_listing_ownership_epoch_v8<PaymentCoin>(listing: &EquipmentListingV8<PaymentCoin>): u64 {
    runtime::equipment_market_custody_ownership_epoch_v8(&listing.custody)
}
public fun equipment_listing_asset_commitment_v8<PaymentCoin>(listing: &EquipmentListingV8<PaymentCoin>): &vector<u8> {
    runtime::equipment_market_custody_asset_commitment_v8(&listing.custody)
}
public fun equipment_listing_gross_atomic_v8<PaymentCoin>(listing: &EquipmentListingV8<PaymentCoin>): u64 { listing.gross_atomic }
public fun equipment_listing_protocol_atomic_v8<PaymentCoin>(listing: &EquipmentListingV8<PaymentCoin>): u64 { listing.protocol_atomic }
public fun equipment_listing_creator_atomic_v8<PaymentCoin>(listing: &EquipmentListingV8<PaymentCoin>): u64 { listing.creator_atomic }
public fun equipment_listing_source_atomic_v8<PaymentCoin>(listing: &EquipmentListingV8<PaymentCoin>): u64 { listing.source_atomic }
public fun equipment_listing_seller_atomic_v8<PaymentCoin>(listing: &EquipmentListingV8<PaymentCoin>): u64 { listing.seller_atomic }
public fun equipment_listing_quote_commitment_v8<PaymentCoin>(listing: &EquipmentListingV8<PaymentCoin>): &vector<u8> { &listing.quote_commitment }
public fun equipment_listing_terminal_recipient_v8<PaymentCoin>(listing: &EquipmentListingV8<PaymentCoin>): address { listing.terminal_recipient }

#[test_only]
/// Upper-graph custody tests borrow the capability genuinely installed by the
/// production bootstrap. This neither constructs nor extracts the capability.
public fun market_runtime_caller_for_testing(config: &MarketPackageConfigV8): &RuntimeCallerCapV1 {
    runtime_caller_cap(config)
}

#[test_only]
public fun assert_quotes_for_testing(root: &MakerRootV8<SUI>) {
    let maker_quote = derive_quote(root, QUOTE_MAKER_RESALE, 10_000);
    assert!(maker_quote.protocol_atomic == 250, 99);
    assert!(maker_quote.creator_atomic == 500, 99);
    assert!(maker_quote.source_atomic == 0, 99);
    assert!(maker_quote.seller_atomic == 9_250, 99);
    let soul_quote = derive_quote(root, QUOTE_SOUL_RESALE, 10_000);
    assert!(soul_quote.protocol_atomic == 250, 99);
    assert!(soul_quote.creator_atomic == 250, 99);
    assert!(soul_quote.source_atomic == 250, 99);
    assert!(soul_quote.seller_atomic == 9_250, 99);
    assert!(maker_quote.commitment != soul_quote.commitment, 99);
    let max_gross = 18_446_744_073_709_551_615u64;
    let boundary = derive_quote(root, QUOTE_PHYSICAL_RESALE, max_gross);
    assert!((boundary.protocol_atomic as u128)
        + (boundary.creator_atomic as u128)
        + (boundary.source_atomic as u128)
        + (boundary.seller_atomic as u128) == (max_gross as u128), 99);
    assert!(share(max_gross, 0) == 0, 99);
}

#[test_only]
public fun assert_nonzero_listing_rejected_for_testing(
    registry: &mut MarketRegistryV8<SUI>, treasury: &MarketTreasuryV8<SUI>,
) {
    registry.listing_count = 1;
    assert_zero_state(registry, treasury);
}

#[test_only]
public fun assert_market_identity_for_testing(
    registry: &MarketRegistryV8<SUI>, treasury: &MarketTreasuryV8<SUI>,
    root: &MakerRootV8<SUI>, config: &MarketPackageConfigV8,
) { assert_market_identity(registry, treasury, root, config) }

#[test_only]
public fun escrow_payment_for_testing(treasury: &mut MarketTreasuryV8<SUI>, payment: Coin<SUI>) {
    escrow_payment(treasury, payment, 10_000);
}

#[test_only]
public fun assert_zero_price_rejected_for_testing(root: &MakerRootV8<SUI>) {
    let _ = derive_quote(root, QUOTE_SOUL_RESALE, 0);
}
#[test_only]
public fun assert_round_to_zero_rejected_for_testing(root: &MakerRootV8<SUI>) {
    let _ = derive_quote(root, QUOTE_MAKER_RESALE, 1);
}
