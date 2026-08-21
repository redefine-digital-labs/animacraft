/// Global version-8 protocol identity and fee terms for the split product.
/// It is intentionally independent of Seal, Runtime, Output, Physical,
/// Market, and Release packages.
module animacraft_v8_core::protocol_config_v8;

use std::bcs;
use std::hash;
use std::string::{Self as string, String};
use std::type_name;
use sui::balance::{Self as balance, Balance};
use sui::coin::{Self as coin, Coin};
use sui::event;

const VERSION: u64 = 8;
const DEFAULT_PRIMARY_CONTENT_FEE_BPS: u16 = 1_000;
const DEFAULT_FIXED_COMPLETE_FEE_ATOMIC: u64 = 0;
const DEFAULT_MAKER_MARKET_FEE_BPS: u16 = 250;
const DEFAULT_SOUL_MARKET_FEE_BPS: u16 = 250;

const EInvalidAdminCap: u64 = 0;
const EProtocolDisabled: u64 = 1;
const EConfigDrift: u64 = 2;
const EPaymentCoinMismatch: u64 = 3;
const ECorePackageMismatch: u64 = 4;
const ETreasuryAlreadyInitialized: u64 = 5;
const ETreasuryNotInitialized: u64 = 6;
const ETreasuryMismatch: u64 = 7;
const EInvalidRecipient: u64 = 8;
const EInvalidAmount: u64 = 9;

/// Fresh v8 one-time witness. It is unrelated to every legacy package.
public struct PROTOCOL_CONFIG_V8 has drop {}

/// Stable marker for the first Core package lineage and callable version.
/// A future Core upgrade must introduce a new callable marker rather than
/// pretending that the original package ID is the upgraded code package ID.
public struct CorePackageMarkerV8 has drop {}

public struct ProtocolConfigV8 has key {
    id: UID,
    version: u64,
    core_original_package_id: ID,
    core_callable_package_id: ID,
    revision: u64,
    treasury_id: Option<ID>,
    payment_coin_type: String,
    primary_content_fee_bps: u16,
    fixed_complete_fee_atomic: u64,
    maker_market_fee_bps: u16,
    soul_market_fee_bps: u16,
    enabled: bool,
    commitment: vector<u8>,
}

public struct ProtocolAdminCapV8 has key {
    id: UID,
    version: u64,
    config_id: ID,
}

/// The one protocol-wide revenue sink for the configured PaymentCoin. Every
/// companion settles its exact protocol line into this shared object; no
/// companion may return a loose protocol-fee Coin to its caller.
public struct ProtocolTreasuryV8<phantom PaymentCoin> has key {
    id: UID,
    version: u64,
    config_id: ID,
    revenue: Balance<PaymentCoin>,
    total_collected: u128,
    total_withdrawn: u128,
}

public struct ProtocolConfigCommitmentInputV8 has drop {
    domain: vector<u8>,
    version: u64,
    config_id: ID,
    core_original_package_id: ID,
    core_callable_package_id: ID,
    revision: u64,
    treasury_id: Option<ID>,
    payment_coin_type: String,
    primary_content_fee_bps: u16,
    fixed_complete_fee_atomic: u64,
    maker_market_fee_bps: u16,
    soul_market_fee_bps: u16,
    enabled: bool,
}

public struct ProtocolV8EnabledChanged has copy, drop {
    config_id: ID,
    revision: u64,
    enabled: bool,
    commitment: vector<u8>,
}

public struct ProtocolTreasuryV8Initialized has copy, drop {
    config_id: ID,
    treasury_id: ID,
    revision: u64,
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
    let PROTOCOL_CONFIG_V8 {} = otw;
    let config_uid = object::new(ctx);
    let config_id = config_uid.to_inner();
    let mut config = ProtocolConfigV8 {
        id: config_uid,
        version: VERSION,
        core_original_package_id: current_core_original_package_id(),
        core_callable_package_id: current_core_callable_package_id(),
        revision: 0,
        treasury_id: option::none(),
        payment_coin_type: native_usdc_type_v8(),
        primary_content_fee_bps: DEFAULT_PRIMARY_CONTENT_FEE_BPS,
        fixed_complete_fee_atomic: DEFAULT_FIXED_COMPLETE_FEE_ATOMIC,
        maker_market_fee_bps: DEFAULT_MAKER_MARKET_FEE_BPS,
        soul_market_fee_bps: DEFAULT_SOUL_MARKET_FEE_BPS,
        enabled: false,
        commitment: vector[],
    };
    refresh_commitment(&mut config);
    let cap = ProtocolAdminCapV8 {
        id: object::new(ctx),
        version: VERSION,
        config_id,
    };
    transfer::share_object(config);
    transfer::transfer(cap, ctx.sender());
}

public fun version_v8(): u64 { VERSION }
public fun default_primary_content_fee_bps_v8(): u16 {
    DEFAULT_PRIMARY_CONTENT_FEE_BPS
}
public fun default_fixed_complete_fee_atomic_v8(): u64 {
    DEFAULT_FIXED_COMPLETE_FEE_ATOMIC
}
public fun default_maker_market_fee_bps_v8(): u16 {
    DEFAULT_MAKER_MARKET_FEE_BPS
}
public fun default_soul_market_fee_bps_v8(): u16 {
    DEFAULT_SOUL_MARKET_FEE_BPS
}

public fun native_usdc_type_v8(): String {
    b"0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC"
        .to_string()
}

public fun payment_coin_type_name_v8<PaymentCoin>(): String {
    string::from_ascii(type_name::with_original_ids<PaymentCoin>().into_string())
}

/// One-time generic initialization binds the concrete PaymentCoin treasury to
/// the non-generic config before the protocol can be enabled.
public fun initialize_protocol_treasury_v8<PaymentCoin>(
    config: &mut ProtocolConfigV8,
    cap: &ProtocolAdminCapV8,
    ctx: &mut TxContext,
) {
    assert_admin(config, cap);
    assert!(config.treasury_id.is_none(), ETreasuryAlreadyInitialized);
    assert!(
        payment_coin_type_name_v8<PaymentCoin>() == config.payment_coin_type,
        EPaymentCoinMismatch,
    );
    let treasury = new_protocol_treasury<PaymentCoin>(object::id(config), ctx);
    let treasury_id = object::id(&treasury);
    config.treasury_id = option::some(treasury_id);
    config.revision = config.revision + 1;
    refresh_commitment(config);
    event::emit(ProtocolTreasuryV8Initialized {
        config_id: object::id(config),
        treasury_id,
        revision: config.revision,
        commitment: config.commitment,
    });
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

public fun assert_enabled_for_coin_v8<PaymentCoin>(config: &ProtocolConfigV8) {
    assert_enabled_v8(config);
    assert!(
        config.payment_coin_type == payment_coin_type_name_v8<PaymentCoin>(),
        EPaymentCoinMismatch,
    );
}

/// Generic-free half used by protocol-admin release catalog governance.
public fun assert_enabled_v8(config: &ProtocolConfigV8) {
    assert!(config.version == VERSION, EConfigDrift);
    assert!(config.enabled, EProtocolDisabled);
    assert!(config.treasury_id.is_some(), ETreasuryNotInitialized);
    assert!(
        config.core_original_package_id == current_core_original_package_id(),
        ECorePackageMismatch,
    );
    assert!(
        config.core_callable_package_id == current_core_callable_package_id(),
        ECorePackageMismatch,
    );
}

/// Any package may deposit only into the exact config-bound treasury. This is
/// intentionally public so split v8 companions can settle atomically; it can
/// never withdraw or redirect funds.
public fun deposit_protocol_revenue_v8<PaymentCoin>(
    config: &ProtocolConfigV8,
    treasury: &mut ProtocolTreasuryV8<PaymentCoin>,
    payment: Coin<PaymentCoin>,
) {
    assert_enabled_for_coin_v8<PaymentCoin>(config);
    assert_protocol_treasury(config, treasury);
    let amount = payment.value();
    assert!(amount > 0, EInvalidAmount);
    coin::put(&mut treasury.revenue, payment);
    treasury.total_collected = treasury.total_collected + (amount as u128);
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
    assert!(amount > 0 && amount <= treasury.revenue.value(), EInvalidAmount);
    let payment = coin::take(&mut treasury.revenue, amount, ctx);
    treasury.total_withdrawn = treasury.total_withdrawn + (amount as u128);
    event::emit(ProtocolRevenueV8Withdrawn {
        config_id: object::id(config),
        treasury_id: object::id(treasury),
        operator: ctx.sender(),
        recipient,
        amount,
    });
    transfer::public_transfer(payment, recipient);
}

public fun assert_exact_snapshot_v8<PaymentCoin>(
    config: &ProtocolConfigV8,
    expected_config_id: ID,
    expected_revision: u64,
    expected_commitment: &vector<u8>,
) {
    assert_enabled_for_coin_v8<PaymentCoin>(config);
    assert!(object::id(config) == expected_config_id, EConfigDrift);
    assert!(config.revision == expected_revision, EConfigDrift);
    assert!(&config.commitment == expected_commitment, EConfigDrift);
}

/// Public protocol-governance assertion used by Core catalog certification.
/// Possessing a Maker AdminCap is deliberately insufficient.
public fun assert_protocol_admin_v8(
    config: &ProtocolConfigV8,
    cap: &ProtocolAdminCapV8,
) {
    assert!(cap.version == VERSION, EInvalidAdminCap);
    assert!(cap.config_id == object::id(config), EInvalidAdminCap);
}

fun assert_admin(config: &ProtocolConfigV8, cap: &ProtocolAdminCapV8) {
    assert_protocol_admin_v8(config, cap);
}

fun refresh_commitment(config: &mut ProtocolConfigV8) {
    config.commitment = hash::sha2_256(bcs::to_bytes(
        &ProtocolConfigCommitmentInputV8 {
            domain: b"animacraft-v8/protocol-config",
            version: config.version,
            config_id: object::id(config),
            core_original_package_id: config.core_original_package_id,
            core_callable_package_id: config.core_callable_package_id,
            revision: config.revision,
            treasury_id: config.treasury_id,
            payment_coin_type: config.payment_coin_type,
            primary_content_fee_bps: config.primary_content_fee_bps,
            fixed_complete_fee_atomic: config.fixed_complete_fee_atomic,
            maker_market_fee_bps: config.maker_market_fee_bps,
            soul_market_fee_bps: config.soul_market_fee_bps,
            enabled: config.enabled,
        },
    ));
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

fun assert_protocol_treasury<PaymentCoin>(
    config: &ProtocolConfigV8,
    treasury: &ProtocolTreasuryV8<PaymentCoin>,
) {
    assert!(config.treasury_id.is_some(), ETreasuryNotInitialized);
    assert!(*config.treasury_id.borrow() == object::id(treasury), ETreasuryMismatch);
    assert!(treasury.version == VERSION, ETreasuryMismatch);
    assert!(treasury.config_id == object::id(config), ETreasuryMismatch);
    assert!(
        config.payment_coin_type == payment_coin_type_name_v8<PaymentCoin>(),
        EPaymentCoinMismatch,
    );
}

/// Core-only exact treasury assertion used by terminal activation. Companion
/// packages retain only the public deposit surface and cannot turn this into
/// a treasury-discovery API.
public(package) fun assert_exact_protocol_treasury_v8<PaymentCoin>(
    config: &ProtocolConfigV8,
    treasury: &ProtocolTreasuryV8<PaymentCoin>,
) {
    assert_protocol_treasury(config, treasury);
}

fun current_core_original_package_id(): ID {
    object::id_from_address(type_name::original_id<CorePackageMarkerV8>())
}

fun current_core_callable_package_id(): ID {
    object::id_from_address(type_name::defining_id<CorePackageMarkerV8>())
}

public fun config_id_v8(config: &ProtocolConfigV8): ID { object::id(config) }
public fun config_revision_v8(config: &ProtocolConfigV8): u64 { config.revision }
public fun config_treasury_id_v8(config: &ProtocolConfigV8): &Option<ID> {
    &config.treasury_id
}
public fun config_core_original_package_id_v8(config: &ProtocolConfigV8): ID {
    config.core_original_package_id
}
public fun config_core_callable_package_id_v8(config: &ProtocolConfigV8): ID {
    config.core_callable_package_id
}
public fun config_payment_coin_type_v8(config: &ProtocolConfigV8): &String {
    &config.payment_coin_type
}
public fun config_primary_content_fee_bps_v8(config: &ProtocolConfigV8): u16 {
    config.primary_content_fee_bps
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
public fun config_enabled_v8(config: &ProtocolConfigV8): bool { config.enabled }
public fun config_commitment_v8(config: &ProtocolConfigV8): &vector<u8> {
    &config.commitment
}
public fun protocol_treasury_id_v8<PaymentCoin>(
    treasury: &ProtocolTreasuryV8<PaymentCoin>,
): ID { object::id(treasury) }
public fun protocol_treasury_config_id_v8<PaymentCoin>(
    treasury: &ProtocolTreasuryV8<PaymentCoin>,
): ID { treasury.config_id }
public fun protocol_treasury_balance_v8<PaymentCoin>(
    treasury: &ProtocolTreasuryV8<PaymentCoin>,
): u64 { treasury.revenue.value() }
public fun protocol_treasury_total_collected_v8<PaymentCoin>(
    treasury: &ProtocolTreasuryV8<PaymentCoin>,
): u128 { treasury.total_collected }
public fun protocol_treasury_total_withdrawn_v8<PaymentCoin>(
    treasury: &ProtocolTreasuryV8<PaymentCoin>,
): u128 { treasury.total_withdrawn }

#[test_only]
public fun new_protocol_for_testing<PaymentCoin>(
    enabled: bool,
    ctx: &mut TxContext,
): (ProtocolConfigV8, ProtocolAdminCapV8) {
    let config_uid = object::new(ctx);
    let config_id = config_uid.to_inner();
    let mut config = ProtocolConfigV8 {
        id: config_uid,
        version: VERSION,
        core_original_package_id: current_core_original_package_id(),
        core_callable_package_id: current_core_callable_package_id(),
        revision: 0,
        treasury_id: option::some(object::id_from_address(@0xFEE)),
        payment_coin_type: payment_coin_type_name_v8<PaymentCoin>(),
        primary_content_fee_bps: DEFAULT_PRIMARY_CONTENT_FEE_BPS,
        fixed_complete_fee_atomic: DEFAULT_FIXED_COMPLETE_FEE_ATOMIC,
        maker_market_fee_bps: DEFAULT_MAKER_MARKET_FEE_BPS,
        soul_market_fee_bps: DEFAULT_SOUL_MARKET_FEE_BPS,
        enabled,
        commitment: vector[],
    };
    refresh_commitment(&mut config);
    let cap = ProtocolAdminCapV8 {
        id: object::new(ctx),
        version: VERSION,
        config_id,
    };
    (config, cap)
}

#[test_only]
public fun new_protocol_with_treasury_for_testing<PaymentCoin>(
    enabled: bool,
    ctx: &mut TxContext,
): (
    ProtocolConfigV8,
    ProtocolTreasuryV8<PaymentCoin>,
    ProtocolAdminCapV8,
) {
    let config_uid = object::new(ctx);
    let config_id = config_uid.to_inner();
    let treasury = new_protocol_treasury<PaymentCoin>(config_id, ctx);
    let treasury_id = object::id(&treasury);
    let mut config = ProtocolConfigV8 {
        id: config_uid,
        version: VERSION,
        core_original_package_id: current_core_original_package_id(),
        core_callable_package_id: current_core_callable_package_id(),
        revision: 1,
        treasury_id: option::some(treasury_id),
        payment_coin_type: payment_coin_type_name_v8<PaymentCoin>(),
        primary_content_fee_bps: DEFAULT_PRIMARY_CONTENT_FEE_BPS,
        fixed_complete_fee_atomic: DEFAULT_FIXED_COMPLETE_FEE_ATOMIC,
        maker_market_fee_bps: DEFAULT_MAKER_MARKET_FEE_BPS,
        soul_market_fee_bps: DEFAULT_SOUL_MARKET_FEE_BPS,
        enabled,
        commitment: vector[],
    };
    refresh_commitment(&mut config);
    let cap = ProtocolAdminCapV8 {
        id: object::new(ctx),
        version: VERSION,
        config_id,
    };
    (config, treasury, cap)
}

#[test_only]
public fun destroy_protocol_for_testing(
    config: ProtocolConfigV8,
    cap: ProtocolAdminCapV8,
) {
    let ProtocolConfigV8 {
        id: config_uid,
        version: _,
        core_original_package_id: _,
        core_callable_package_id: _,
        revision: _,
        treasury_id: _,
        payment_coin_type: _,
        primary_content_fee_bps: _,
        fixed_complete_fee_atomic: _,
        maker_market_fee_bps: _,
        soul_market_fee_bps: _,
        enabled: _,
        commitment: _,
    } = config;
    let ProtocolAdminCapV8 { id: cap_uid, version: _, config_id: _ } = cap;
    config_uid.delete();
    cap_uid.delete();
}

#[test_only]
public fun destroy_protocol_with_treasury_for_testing<PaymentCoin>(
    config: ProtocolConfigV8,
    treasury: ProtocolTreasuryV8<PaymentCoin>,
    cap: ProtocolAdminCapV8,
) {
    let ProtocolTreasuryV8 {
        id: treasury_uid,
        version: _,
        config_id: _,
        revenue,
        total_collected: _,
        total_withdrawn: _,
    } = treasury;
    revenue.destroy_zero();
    treasury_uid.delete();
    destroy_protocol_for_testing(config, cap);
}

#[test_only]
public fun share_protocol_for_testing(
    config: ProtocolConfigV8,
    cap: ProtocolAdminCapV8,
    ctx: &TxContext,
) {
    transfer::share_object(config);
    transfer::transfer(cap, ctx.sender());
}

#[test_only]
public fun share_protocol_with_treasury_for_testing<PaymentCoin>(
    config: ProtocolConfigV8,
    treasury: ProtocolTreasuryV8<PaymentCoin>,
    cap: ProtocolAdminCapV8,
    ctx: &TxContext,
) {
    assert_admin(&config, &cap);
    assert_protocol_treasury(&config, &treasury);
    transfer::share_object(config);
    transfer::share_object(treasury);
    transfer::transfer(cap, ctx.sender());
}

#[test]
fun enabled_config_exposes_exact_terms() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 1, 0, 0, 0);
    let (config, cap) = new_protocol_for_testing<sui::sui::SUI>(true, &mut ctx);
    assert_enabled_for_coin_v8<sui::sui::SUI>(&config);
    assert!(config.primary_content_fee_bps == 1_000, EConfigDrift);
    assert!(config.fixed_complete_fee_atomic == 0, EConfigDrift);
    assert!(config.maker_market_fee_bps == 250, EConfigDrift);
    assert!(config.soul_market_fee_bps == 250, EConfigDrift);
    destroy_protocol_for_testing(config, cap);
}

#[test]
fun exact_protocol_treasury_collects_and_withdraws() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 11, 0, 0, 0);
    let (config, mut treasury, cap) =
        new_protocol_with_treasury_for_testing<sui::sui::SUI>(true, &mut ctx);
    let payment = coin::from_balance(
        balance::create_for_testing<sui::sui::SUI>(100),
        &mut ctx,
    );
    deposit_protocol_revenue_v8(&config, &mut treasury, payment);
    assert!(protocol_treasury_balance_v8(&treasury) == 100, EInvalidAmount);
    assert!(protocol_treasury_total_collected_v8(&treasury) == 100, EInvalidAmount);
    withdraw_protocol_revenue_v8(
        &config,
        &cap,
        &mut treasury,
        100,
        @0xB11,
        &mut ctx,
    );
    assert!(protocol_treasury_balance_v8(&treasury) == 0, EInvalidAmount);
    assert!(protocol_treasury_total_withdrawn_v8(&treasury) == 100, EInvalidAmount);
    destroy_protocol_with_treasury_for_testing(config, treasury, cap);
}

#[test, expected_failure(abort_code = EProtocolDisabled)]
fun disabled_config_cannot_begin_a_draft() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 2, 0, 0, 0);
    let (config, cap) = new_protocol_for_testing<sui::sui::SUI>(false, &mut ctx);
    assert_enabled_for_coin_v8<sui::sui::SUI>(&config);
    destroy_protocol_for_testing(config, cap);
}
