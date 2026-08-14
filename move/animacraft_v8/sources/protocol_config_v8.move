module animacraft_v8::protocol_config_v8;

use std::bcs;
use std::hash;
use std::option::{Self as option, Option};
use std::string::{Self as string, String};
use std::type_name;
use sui::balance::{Self as balance, Balance};
use sui::coin::{Self as coin, Coin};
use sui::event;
use sui::package;

const VERSION: u64 = 8;
const BPS_DENOMINATOR: u64 = 10_000;
const MAX_PRIMARY_PROTOCOL_FEE_BPS: u16 = 10_000;
const DEFAULT_PRIMARY_PROTOCOL_FEE_BPS: u16 = 1_000;
const DEFAULT_FIXED_COMPLETE_FEE_ATOMIC: u64 = 0;
const DEFAULT_MAKER_MARKET_FEE_BPS: u16 = 250;
const DEFAULT_SOUL_MARKET_FEE_BPS: u16 = 250;
#[test_only]
const HASH_LENGTH: u64 = 32;

const CAPABILITY_COMPOSITION: u64 = 1;
const CAPABILITY_PACK: u64 = 2;
const CAPABILITY_COMPLETE: u64 = 4;
const CAPABILITY_SEAL: u64 = 8;
const CAPABILITY_PHYSICAL: u64 = 16;
const CAPABILITY_CANONICAL_SOUL: u64 = 32;
const REQUIRED_CAPABILITIES: u64 = 47;
const SUPPORTED_CAPABILITIES: u64 = 63;

const EInvalidAdminCap: u64 = 0;
const EProtocolDisabled: u64 = 2;
const ETreasuryAlreadyInitialized: u64 = 3;
const ETreasuryNotInitialized: u64 = 4;
const ETreasuryMismatch: u64 = 5;
const EPaymentCoinMismatch: u64 = 6;
const EPackageMismatch: u64 = 7;
const EConfigDrift: u64 = 8;
const EInvalidCapabilities: u64 = 9;
const EPublisherMismatch: u64 = 10;
const EInsufficientRevenue: u64 = 11;
const EInvalidRecipient: u64 = 12;
const EWrongPayment: u64 = 13;
#[test_only]
const EInvalidCommitment: u64 = 14;

/// Fresh v8 one-time witness. It is intentionally unrelated to ANIMACRAFT.
public struct PROTOCOL_CONFIG_V8 has drop {}

public struct ProtocolConfigV8 has key {
    id: UID,
    version: u64,
    package_id: ID,
    revision: u64,
    treasury_id: Option<ID>,
    payment_coin_type: String,
    primary_protocol_fee_bps: u16,
    fixed_complete_fee_atomic: u64,
    maker_market_fee_bps: u16,
    soul_market_fee_bps: u16,
    required_capabilities: u64,
    supported_capabilities: u64,
    enabled: bool,
    commitment: vector<u8>,
}

public struct ProtocolAdminCapV8 has key {
    id: UID,
    version: u64,
    config_id: ID,
    publisher: Option<package::Publisher>,
}

public struct ProtocolTreasuryV8<phantom PaymentCoin> has key {
    id: UID,
    version: u64,
    config_id: ID,
    revenue: Balance<PaymentCoin>,
    total_collected: u64,
    total_withdrawn: u64,
}

public struct ProtocolCommitmentInputV8 has drop {
    version: u64,
    package_id: ID,
    config_id: ID,
    revision: u64,
    treasury_id: Option<ID>,
    payment_coin_type: String,
    primary_protocol_fee_bps: u16,
    fixed_complete_fee_atomic: u64,
    maker_market_fee_bps: u16,
    soul_market_fee_bps: u16,
    required_capabilities: u64,
    supported_capabilities: u64,
    enabled: bool,
}

public struct ProtocolV8EnabledChanged has copy, drop {
    config_id: ID,
    revision: u64,
    enabled: bool,
    commitment: vector<u8>,
}

public struct ProtocolRevenueV8Withdrawn has copy, drop {
    config_id: ID,
    treasury_id: ID,
    operator: address,
    recipient: address,
    amount: u64,
}

fun init(otw: PROTOCOL_CONFIG_V8, ctx: &mut TxContext) {
    let publisher = package::claim(otw, ctx);
    let package_id = object::id_from_address(type_name::defining_id<ProtocolConfigV8>());
    let config_uid = object::new(ctx);
    let config_id = config_uid.to_inner();
    let mut config = ProtocolConfigV8 {
        id: config_uid,
        version: VERSION,
        package_id,
        revision: 0,
        treasury_id: option::none(),
        payment_coin_type: native_usdc_type_v8(),
        primary_protocol_fee_bps: DEFAULT_PRIMARY_PROTOCOL_FEE_BPS,
        fixed_complete_fee_atomic: DEFAULT_FIXED_COMPLETE_FEE_ATOMIC,
        maker_market_fee_bps: DEFAULT_MAKER_MARKET_FEE_BPS,
        soul_market_fee_bps: DEFAULT_SOUL_MARKET_FEE_BPS,
        required_capabilities: REQUIRED_CAPABILITIES,
        supported_capabilities: SUPPORTED_CAPABILITIES,
        enabled: false,
        commitment: vector[],
    };
    refresh_commitment(&mut config);
    let cap = ProtocolAdminCapV8 {
        id: object::new(ctx),
        version: VERSION,
        config_id,
        publisher: option::some(publisher),
    };
    transfer::share_object(config);
    transfer::transfer(cap, ctx.sender());
}

public fun version_v8(): u64 { VERSION }
public fun capability_composition_v8(): u64 { CAPABILITY_COMPOSITION }
public fun capability_pack_v8(): u64 { CAPABILITY_PACK }
public fun capability_complete_v8(): u64 { CAPABILITY_COMPLETE }
public fun capability_seal_v8(): u64 { CAPABILITY_SEAL }
public fun capability_physical_v8(): u64 { CAPABILITY_PHYSICAL }
public fun capability_canonical_soul_v8(): u64 { CAPABILITY_CANONICAL_SOUL }
public fun required_capabilities_v8(): u64 { REQUIRED_CAPABILITIES }
public fun supported_capabilities_v8(): u64 { SUPPORTED_CAPABILITIES }
public fun default_primary_protocol_fee_bps_v8(): u16 {
    DEFAULT_PRIMARY_PROTOCOL_FEE_BPS
}
public fun max_primary_protocol_fee_bps_v8(): u16 { MAX_PRIMARY_PROTOCOL_FEE_BPS }
public fun default_fixed_complete_fee_atomic_v8(): u64 {
    DEFAULT_FIXED_COMPLETE_FEE_ATOMIC
}
public fun default_maker_market_fee_bps_v8(): u16 { DEFAULT_MAKER_MARKET_FEE_BPS }
public fun default_soul_market_fee_bps_v8(): u16 { DEFAULT_SOUL_MARKET_FEE_BPS }

public fun native_usdc_type_v8(): String {
    b"0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC".to_string()
}

public fun payment_coin_type_name_v8<PaymentCoin>(): String {
    string::from_ascii(type_name::with_defining_ids<PaymentCoin>().into_string())
}

/// The init-created AdminCap and mutable config make this a one-time generic
/// initialization without importing a concrete USDC package into v8 bytecode.
public fun initialize_protocol_treasury_v8<PaymentCoin>(
    config: &mut ProtocolConfigV8,
    cap: &ProtocolAdminCapV8,
    ctx: &mut TxContext,
) {
    assert_admin(config, cap);
    assert!(cap.publisher.is_some(), EPublisherMismatch);
    assert!(cap.publisher.borrow().from_package<PROTOCOL_CONFIG_V8>(), EPublisherMismatch);
    assert!(config.treasury_id.is_none(), ETreasuryAlreadyInitialized);
    assert!(payment_coin_type_name_v8<PaymentCoin>() == config.payment_coin_type, EPaymentCoinMismatch);
    let treasury = new_protocol_treasury<PaymentCoin>(object::id(config), ctx);
    let treasury_id = object::id(&treasury);
    config.treasury_id = option::some(treasury_id);
    config.revision = config.revision + 1;
    refresh_commitment(config);
    transfer::share_object(treasury);
}

public fun set_protocol_enabled_v8(
    config: &mut ProtocolConfigV8,
    cap: &ProtocolAdminCapV8,
    enabled: bool,
) {
    assert_admin(config, cap);
    if (enabled) {
        assert!(config.treasury_id.is_some(), ETreasuryNotInitialized);
    };
    assert!(config.enabled != enabled, EConfigDrift);
    config.enabled = enabled;
    config.revision = config.revision + 1;
    refresh_commitment(config);
    event::emit(ProtocolV8EnabledChanged {
        config_id: object::id(config),
        revision: config.revision,
        enabled,
        commitment: config.commitment,
    });
}

public fun withdraw_protocol_revenue_v8<PaymentCoin>(
    config: &ProtocolConfigV8,
    cap: &ProtocolAdminCapV8,
    treasury: &mut ProtocolTreasuryV8<PaymentCoin>,
    amount: u64,
    recipient: address,
    ctx: &mut TxContext,
) {
    assert_admin(config, cap);
    assert_protocol_treasury(config, treasury);
    assert!(recipient != @0x0, EInvalidRecipient);
    assert!(amount > 0 && amount <= treasury.revenue.value(), EInsufficientRevenue);
    let payment = coin::take(&mut treasury.revenue, amount, ctx);
    treasury.total_withdrawn = treasury.total_withdrawn + amount;
    event::emit(ProtocolRevenueV8Withdrawn {
        config_id: object::id(config),
        treasury_id: object::id(treasury),
        operator: ctx.sender(),
        recipient,
        amount,
    });
    transfer::public_transfer(payment, recipient);
}

/// Splits the immutable fee policy and returns the creator remainder. Only v8
/// modules may use it, so no parallel public payment surface can bypass Root.
public(package) fun collect_protocol_primary_fee_v8<PaymentCoin>(
    config: &ProtocolConfigV8,
    treasury: &mut ProtocolTreasuryV8<PaymentCoin>,
    mut payment: Coin<PaymentCoin>,
    ctx: &mut TxContext,
): Coin<PaymentCoin> {
    assert_enabled(config);
    assert_protocol_treasury(config, treasury);
    assert!(payment_coin_type_name_v8<PaymentCoin>() == config.payment_coin_type, EPaymentCoinMismatch);
    let gross = payment.value();
    let fee = (((gross as u128) * (config.primary_protocol_fee_bps as u128))
        / (BPS_DENOMINATOR as u128)) as u64;
    if (fee > 0) {
        let protocol_coin = coin::split(&mut payment, fee, ctx);
        coin::put(&mut treasury.revenue, protocol_coin);
        treasury.total_collected = treasury.total_collected + fee;
    };
    payment
}

/// Complete charges add the fixed protocol amount to the content subtotal,
/// then apply the primary content percentage only to that subtotal.
public(package) fun collect_protocol_complete_fee_v8<PaymentCoin>(
    config: &ProtocolConfigV8,
    treasury: &mut ProtocolTreasuryV8<PaymentCoin>,
    mut payment: Coin<PaymentCoin>,
    content_atomic: u64,
    ctx: &mut TxContext,
): Coin<PaymentCoin> {
    assert_enabled(config);
    assert_protocol_treasury(config, treasury);
    assert!(payment_coin_type_name_v8<PaymentCoin>() == config.payment_coin_type, EPaymentCoinMismatch);
    let gross = content_atomic + config.fixed_complete_fee_atomic;
    assert!(payment.value() == gross, EWrongPayment);
    let content_fee = (((content_atomic as u128) * (config.primary_protocol_fee_bps as u128))
        / (BPS_DENOMINATOR as u128)) as u64;
    let protocol_amount = config.fixed_complete_fee_atomic + content_fee;
    if (protocol_amount > 0) {
        let protocol_coin = coin::split(&mut payment, protocol_amount, ctx);
        coin::put(&mut treasury.revenue, protocol_coin);
        treasury.total_collected = treasury.total_collected + protocol_amount;
    };
    payment
}

public(package) fun assert_begin_config_v8<PaymentCoin>(
    config: &ProtocolConfigV8,
    declared_capabilities: u64,
) {
    assert_enabled(config);
    assert!(config.version == VERSION, EConfigDrift);
    assert!(config.package_id == current_package_id(), EPackageMismatch);
    assert!(payment_coin_type_name_v8<PaymentCoin>() == config.payment_coin_type, EPaymentCoinMismatch);
    assert_valid_capabilities(config, declared_capabilities);
}

public(package) fun assert_activation_snapshot_v8<PaymentCoin>(
    config: &ProtocolConfigV8,
    expected_config_id: ID,
    expected_revision: u64,
    expected_commitment: &vector<u8>,
    expected_treasury_id: ID,
    declared_capabilities: u64,
    expected_fee_bps: u16,
) {
    assert_begin_config_v8<PaymentCoin>(config, declared_capabilities);
    assert!(object::id(config) == expected_config_id, EConfigDrift);
    assert!(config.revision == expected_revision, EConfigDrift);
    assert!(&config.commitment == expected_commitment, EConfigDrift);
    assert!(config.primary_protocol_fee_bps == expected_fee_bps, EConfigDrift);
    assert!(config.treasury_id.is_some(), ETreasuryNotInitialized);
    assert!(*config.treasury_id.borrow() == expected_treasury_id, ETreasuryMismatch);
}

public(package) fun assert_operational_snapshot_v8<PaymentCoin>(
    config: &ProtocolConfigV8,
    expected_config_id: ID,
    expected_treasury_id: ID,
    declared_capabilities: u64,
    expected_fee_bps: u16,
) {
    assert_begin_config_v8<PaymentCoin>(config, declared_capabilities);
    assert!(object::id(config) == expected_config_id, EConfigDrift);
    assert!(config.primary_protocol_fee_bps == expected_fee_bps, EConfigDrift);
    assert!(config.treasury_id.is_some(), ETreasuryNotInitialized);
    assert!(*config.treasury_id.borrow() == expected_treasury_id, ETreasuryMismatch);
}

public(package) fun assert_protocol_treasury_v8<PaymentCoin>(
    config: &ProtocolConfigV8,
    treasury: &ProtocolTreasuryV8<PaymentCoin>,
) {
    assert_protocol_treasury(config, treasury)
}

fun new_protocol_treasury<PaymentCoin>(
    config_id: ID,
    ctx: &mut TxContext,
): ProtocolTreasuryV8<PaymentCoin> {
    ProtocolTreasuryV8 {
        id: object::new(ctx),
        version: VERSION,
        config_id,
        revenue: balance::zero(),
        total_collected: 0,
        total_withdrawn: 0,
    }
}

fun assert_enabled(config: &ProtocolConfigV8) {
    assert!(config.enabled, EProtocolDisabled);
    assert!(config.treasury_id.is_some(), ETreasuryNotInitialized);
}

fun assert_admin(config: &ProtocolConfigV8, cap: &ProtocolAdminCapV8) {
    assert!(cap.version == VERSION, EInvalidAdminCap);
    assert!(cap.config_id == object::id(config), EInvalidAdminCap);
}

fun assert_protocol_treasury<PaymentCoin>(
    config: &ProtocolConfigV8,
    treasury: &ProtocolTreasuryV8<PaymentCoin>,
) {
    assert!(config.treasury_id.is_some(), ETreasuryNotInitialized);
    assert!(*config.treasury_id.borrow() == object::id(treasury), ETreasuryMismatch);
    assert!(treasury.version == VERSION, ETreasuryMismatch);
    assert!(treasury.config_id == object::id(config), ETreasuryMismatch);
    assert!(payment_coin_type_name_v8<PaymentCoin>() == config.payment_coin_type, EPaymentCoinMismatch);
}

fun assert_valid_capabilities(config: &ProtocolConfigV8, declared: u64) {
    assert!((declared & config.required_capabilities) == config.required_capabilities, EInvalidCapabilities);
    assert!((declared & config.supported_capabilities) == declared, EInvalidCapabilities);
}

fun refresh_commitment(config: &mut ProtocolConfigV8) {
    config.commitment = hash::sha2_256(bcs::to_bytes(&ProtocolCommitmentInputV8 {
        version: config.version,
        package_id: config.package_id,
        config_id: object::id(config),
        revision: config.revision,
        treasury_id: config.treasury_id,
        payment_coin_type: config.payment_coin_type,
        primary_protocol_fee_bps: config.primary_protocol_fee_bps,
        fixed_complete_fee_atomic: config.fixed_complete_fee_atomic,
        maker_market_fee_bps: config.maker_market_fee_bps,
        soul_market_fee_bps: config.soul_market_fee_bps,
        required_capabilities: config.required_capabilities,
        supported_capabilities: config.supported_capabilities,
        enabled: config.enabled,
    }));
}

fun current_package_id(): ID {
    object::id_from_address(type_name::defining_id<ProtocolConfigV8>())
}

public fun config_id_v8(config: &ProtocolConfigV8): ID { object::id(config) }
public fun config_version_v8(config: &ProtocolConfigV8): u64 { config.version }
public fun config_package_id_v8(config: &ProtocolConfigV8): ID { config.package_id }
public fun config_revision_v8(config: &ProtocolConfigV8): u64 { config.revision }
public fun config_treasury_id_v8(config: &ProtocolConfigV8): Option<ID> { config.treasury_id }
public fun config_payment_coin_type_v8(config: &ProtocolConfigV8): &String { &config.payment_coin_type }
public fun config_primary_protocol_fee_bps_v8(config: &ProtocolConfigV8): u16 {
    config.primary_protocol_fee_bps
}
public fun config_fixed_complete_fee_atomic_v8(config: &ProtocolConfigV8): u64 {
    config.fixed_complete_fee_atomic
}
public fun config_maker_market_fee_bps_v8(config: &ProtocolConfigV8): u16 {
    config.maker_market_fee_bps
}
public fun config_soul_market_fee_bps_v8(config: &ProtocolConfigV8): u16 {
    config.soul_market_fee_bps
}
public fun config_required_capabilities_v8(config: &ProtocolConfigV8): u64 {
    config.required_capabilities
}
public fun config_supported_capabilities_v8(config: &ProtocolConfigV8): u64 {
    config.supported_capabilities
}
public fun config_enabled_v8(config: &ProtocolConfigV8): bool { config.enabled }
public fun config_commitment_v8(config: &ProtocolConfigV8): &vector<u8> { &config.commitment }
public fun protocol_admin_config_id_v8(cap: &ProtocolAdminCapV8): ID { cap.config_id }
public fun protocol_treasury_config_id_v8<PaymentCoin>(
    treasury: &ProtocolTreasuryV8<PaymentCoin>,
): ID { treasury.config_id }
public fun protocol_treasury_balance_v8<PaymentCoin>(
    treasury: &ProtocolTreasuryV8<PaymentCoin>,
): u64 { treasury.revenue.value() }
public fun protocol_treasury_total_collected_v8<PaymentCoin>(
    treasury: &ProtocolTreasuryV8<PaymentCoin>,
): u64 { treasury.total_collected }

#[test_only]
public fun new_protocol_for_testing<PaymentCoin>(
    enabled: bool,
    ctx: &mut TxContext,
): (ProtocolConfigV8, ProtocolTreasuryV8<PaymentCoin>, ProtocolAdminCapV8) {
    let config_uid = object::new(ctx);
    let config_id = config_uid.to_inner();
    let treasury = new_protocol_treasury<PaymentCoin>(config_id, ctx);
    let treasury_id = object::id(&treasury);
    let mut config = ProtocolConfigV8 {
        id: config_uid,
        version: VERSION,
        package_id: current_package_id(),
        revision: 1,
        treasury_id: option::some(treasury_id),
        payment_coin_type: payment_coin_type_name_v8<PaymentCoin>(),
        primary_protocol_fee_bps: DEFAULT_PRIMARY_PROTOCOL_FEE_BPS,
        fixed_complete_fee_atomic: DEFAULT_FIXED_COMPLETE_FEE_ATOMIC,
        maker_market_fee_bps: DEFAULT_MAKER_MARKET_FEE_BPS,
        soul_market_fee_bps: DEFAULT_SOUL_MARKET_FEE_BPS,
        required_capabilities: REQUIRED_CAPABILITIES,
        supported_capabilities: SUPPORTED_CAPABILITIES,
        enabled,
        commitment: vector[],
    };
    refresh_commitment(&mut config);
    let cap = ProtocolAdminCapV8 {
        id: object::new(ctx),
        version: VERSION,
        config_id,
        publisher: option::none(),
    };
    (config, treasury, cap)
}

#[test_only]
public fun destroy_protocol_for_testing<PaymentCoin>(
    config: ProtocolConfigV8,
    treasury: ProtocolTreasuryV8<PaymentCoin>,
    cap: ProtocolAdminCapV8,
) {
    let ProtocolConfigV8 {
        id: config_uid,
        version: _,
        package_id: _,
        revision: _,
        treasury_id: _,
        payment_coin_type: _,
        primary_protocol_fee_bps: _,
        fixed_complete_fee_atomic: _,
        maker_market_fee_bps: _,
        soul_market_fee_bps: _,
        required_capabilities: _,
        supported_capabilities: _,
        enabled: _,
        commitment: _,
    } = config;
    let ProtocolTreasuryV8 {
        id: treasury_uid,
        version: _,
        config_id: _,
        revenue,
        total_collected: _,
        total_withdrawn: _,
    } = treasury;
    let ProtocolAdminCapV8 {
        id: cap_uid,
        version: _,
        config_id: _,
        publisher,
    } = cap;
    publisher.destroy_none();
    revenue.destroy_zero();
    config_uid.delete();
    treasury_uid.delete();
    cap_uid.delete();
}

#[test]
fun enabled_test_config_has_exact_snapshot() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 1, 0, 0, 0);
    let (config, treasury, cap) = new_protocol_for_testing<sui::sui::SUI>(true, &mut ctx);
    assert_begin_config_v8<sui::sui::SUI>(&config, REQUIRED_CAPABILITIES);
    assert_activation_snapshot_v8<sui::sui::SUI>(
        &config,
        object::id(&config),
        config.revision,
        &config.commitment,
        object::id(&treasury),
        REQUIRED_CAPABILITIES,
        DEFAULT_PRIMARY_PROTOCOL_FEE_BPS,
    );
    assert!(config_primary_protocol_fee_bps_v8(&config) == 1_000, EConfigDrift);
    assert!(config_fixed_complete_fee_atomic_v8(&config) == 0, EConfigDrift);
    assert!(config_maker_market_fee_bps_v8(&config) == 250, EConfigDrift);
    assert!(config_soul_market_fee_bps_v8(&config) == 250, EConfigDrift);
    assert!(config.commitment.length() == HASH_LENGTH, EInvalidCommitment);
    destroy_protocol_for_testing(config, treasury, cap);
}

#[test, expected_failure(abort_code = EProtocolDisabled)]
fun disabled_config_cannot_begin_publication() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 2, 0, 0, 0);
    let (config, treasury, cap) = new_protocol_for_testing<sui::sui::SUI>(false, &mut ctx);
    assert_begin_config_v8<sui::sui::SUI>(&config, REQUIRED_CAPABILITIES);
    destroy_protocol_for_testing(config, treasury, cap);
}

#[test, expected_failure(abort_code = EInvalidCapabilities)]
fun missing_required_capability_is_rejected() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 3, 0, 0, 0);
    let (config, treasury, cap) = new_protocol_for_testing<sui::sui::SUI>(true, &mut ctx);
    assert_begin_config_v8<sui::sui::SUI>(&config, CAPABILITY_COMPOSITION);
    destroy_protocol_for_testing(config, treasury, cap);
}
