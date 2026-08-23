/// Exact per-Maker revenue custody for the fresh split v8 product. Payment
/// policy and line-item arithmetic live in the defining companion, while this
/// Core object guarantees that every residual reaches the one Root-bound
/// treasury and only the current Maker authority can withdraw it.
module animacraft_v8_core::treasury_v8;

use animacraft_v8_core::maker_v8::{
    Self as maker,
    MakerAdminCapV8,
    MakerRootV8,
};
use animacraft_v8_core::protocol_config_v8::ProtocolConfigV8;
use animacraft_v8_core::protocol_config_v8::{
    Self as protocol,
    ProtocolTreasuryV8,
};
use sui::balance::{Self as balance, Balance};
use sui::clock::Clock;
use sui::coin::{Self as coin, Coin};
use sui::dynamic_field as df;
use sui::event;

const VERSION: u64 = 8;

const EInvalidTreasury: u64 = 0;
const EInvalidLifecycle: u64 = 1;
const EInvalidAmount: u64 = 2;
const EInvalidRecipient: u64 = 3;
const ENotCurrentOwner: u64 = 4;
const EAccessAlreadyIssued: u64 = 5;
const EAccessPolicyMismatch: u64 = 6;
const EWrongPayment: u64 = 7;
const EProtocolShareRoundsToZero: u64 = 8;

const BPS_DENOMINATOR: u128 = 10_000;

public struct MakerTreasuryV8<phantom PaymentCoin> has key {
    id: UID,
    version: u64,
    root_id: ID,
    maker_version: u64,
    root_content_commitment: vector<u8>,
    revenue: Balance<PaymentCoin>,
    total_collected: u128,
    total_withdrawn: u128,
}

/// One non-transferable access entitlement for one immutable Maker version.
/// It binds content rather than control epoch, so a Maker ownership transfer
/// cannot revoke access that was already issued or purchased.
public struct MakerAccessPassV8 has key {
    id: UID,
    version: u64,
    root_id: ID,
    maker_version: u64,
    root_content_commitment: vector<u8>,
    holder: address,
    paid_atomic: u64,
    issued_at_ms: u64,
}

public struct MakerAccessKeyV8 has copy, drop, store { holder: address }

public struct MakerAccessRecordV8 has copy, drop, store {
    pass_id: ID,
    holder: address,
    paid_atomic: u64,
    issued_at_ms: u64,
}

public struct MakerRevenueV8Withdrawn has copy, drop {
    root_id: ID,
    treasury_id: ID,
    operator: address,
    recipient: address,
    amount: u64,
}

public struct MakerAccessPassV8Issued has copy, drop {
    root_id: ID,
    pass_id: ID,
    holder: address,
    paid_atomic: u64,
    protocol_atomic: u64,
    maker_atomic: u64,
    issued_at_ms: u64,
}

public(package) fun new_maker_treasury_v8<PaymentCoin>(
    root: &mut MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    ctx: &mut TxContext,
): MakerTreasuryV8<PaymentCoin> {
    maker::assert_draft_admin_v8(root, admin);
    let treasury = MakerTreasuryV8<PaymentCoin> {
        id: object::new(ctx),
        version: VERSION,
        root_id: maker::root_id_v8(root),
        maker_version: maker::root_maker_version_v8(root),
        root_content_commitment: *maker::root_content_commitment_v8(root),
        revenue: balance::zero(),
        total_collected: 0,
        total_withdrawn: 0,
    };
    maker::finalize_maker_treasury_binding_v8(
        root,
        admin,
        object::id(&treasury),
    );
    treasury
}

public(package) fun share_maker_treasury_v8<PaymentCoin>(
    treasury: MakerTreasuryV8<PaymentCoin>,
) {
    transfer::share_object(treasury);
}

public fun assert_maker_treasury_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    treasury: &MakerTreasuryV8<PaymentCoin>,
) {
    maker::assert_maker_treasury_identity_v8(root, object::id(treasury));
    assert!(treasury.version == VERSION, EInvalidTreasury);
    assert!(treasury.root_id == maker::root_id_v8(root), EInvalidTreasury);
    assert!(
        treasury.maker_version == maker::root_maker_version_v8(root),
        EInvalidTreasury,
    );
    assert!(
        &treasury.root_content_commitment == maker::root_content_commitment_v8(root),
        EInvalidTreasury,
    );
}

/// Split companions may deposit only while the exact Root and protocol
/// snapshot are operational. Passing a Coin is deliberate: no residual can
/// be left in an untracked Balance owned by the caller.
public fun deposit_maker_revenue_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    treasury: &mut MakerTreasuryV8<PaymentCoin>,
    config: &ProtocolConfigV8,
    payment: Coin<PaymentCoin>,
) {
    assert!(
        maker::root_lifecycle_v8(root) == maker::lifecycle_active_v8(),
        EInvalidLifecycle,
    );
    maker::assert_current_protocol_config_v8(root, config);
    assert_maker_treasury_v8(root, treasury);
    let amount = payment.value();
    assert!(amount > 0, EInvalidAmount);
    coin::put(&mut treasury.revenue, payment);
    treasury.total_collected = treasury.total_collected + (amount as u128);
}

/// FREE access still creates an exact v8 entitlement. Runtime and Output never
/// infer access from a boolean supplied beside a Pack or Complete request.
public fun claim_free_maker_access_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    treasury: &mut MakerTreasuryV8<PaymentCoin>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(
        maker::root_lifecycle_v8(root) == maker::lifecycle_active_v8(),
        EInvalidLifecycle,
    );
    assert_maker_treasury_v8(root, treasury);
    let economics = maker::root_economics_v8(root);
    assert!(
        maker::economics_maker_access_v8(&economics) == maker::access_free_v8(),
        EAccessPolicyMismatch,
    );
    issue_maker_access_pass(root, treasury, 0, 0, clock, ctx);
}

/// Paid Maker access settles the exact immutable Root price in one call. The
/// protocol share and Maker residual are deposited before the Pass is issued;
/// no loose fee Coin is returned to an untrusted caller.
public fun purchase_maker_access_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    treasury: &mut MakerTreasuryV8<PaymentCoin>,
    config: &ProtocolConfigV8,
    protocol_treasury: &mut ProtocolTreasuryV8<PaymentCoin>,
    mut payment: Coin<PaymentCoin>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(
        maker::root_lifecycle_v8(root) == maker::lifecycle_active_v8(),
        EInvalidLifecycle,
    );
    maker::assert_current_protocol_config_v8(root, config);
    assert_maker_treasury_v8(root, treasury);
    let economics = maker::root_economics_v8(root);
    assert!(
        maker::economics_maker_access_v8(&economics) == maker::access_paid_v8(),
        EAccessPolicyMismatch,
    );
    let gross = maker::economics_maker_price_atomic_v8(&economics);
    assert!(gross > 0 && payment.value() == gross, EWrongPayment);
    let fee_bps = maker::economics_primary_content_fee_bps_v8(&economics);
    let protocol_u128 = ((gross as u128) * (fee_bps as u128)) / BPS_DENOMINATOR;
    assert!(
        fee_bps == 0 || protocol_u128 > 0,
        EProtocolShareRoundsToZero,
    );
    let protocol_atomic = protocol_u128 as u64;
    let maker_atomic = gross - protocol_atomic;
    if (protocol_atomic > 0) {
        let protocol_payment = coin::split(&mut payment, protocol_atomic, ctx);
        protocol::deposit_protocol_revenue_v8(
            config,
            protocol_treasury,
            protocol_payment,
        );
    };
    assert!(payment.value() == maker_atomic && maker_atomic > 0, EWrongPayment);
    deposit_maker_revenue_v8(root, treasury, config, payment);
    issue_maker_access_pass(
        root,
        treasury,
        gross,
        protocol_atomic,
        clock,
        ctx,
    );
}

/// Exact Runtime-facing access assertion. The Pass type is Core-private and
/// lacks `store`, so another package cannot mint, wrap, or publicly transfer
/// a substitute object.
public fun assert_maker_access_pass_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    pass: &MakerAccessPassV8,
    holder: address,
) {
    assert!(
        maker::root_lifecycle_v8(root) == maker::lifecycle_active_v8(),
        EInvalidLifecycle,
    );
    assert!(pass.version == VERSION, EAccessPolicyMismatch);
    assert!(pass.root_id == maker::root_id_v8(root), EAccessPolicyMismatch);
    assert!(
        pass.maker_version == maker::root_maker_version_v8(root),
        EAccessPolicyMismatch,
    );
    assert!(
        &pass.root_content_commitment == maker::root_content_commitment_v8(root),
        EAccessPolicyMismatch,
    );
    assert!(pass.holder == holder, EAccessPolicyMismatch);
    let economics = maker::root_economics_v8(root);
    let access = maker::economics_maker_access_v8(&economics);
    if (access == maker::access_free_v8()) {
        assert!(pass.paid_atomic == 0, EAccessPolicyMismatch);
    } else {
        assert!(access == maker::access_paid_v8(), EAccessPolicyMismatch);
        assert!(
            pass.paid_atomic == maker::economics_maker_price_atomic_v8(&economics),
            EAccessPolicyMismatch,
        );
    };
}

/// Revenue remains withdrawable while PAUSED or ARCHIVED so lifecycle cannot
/// trap the current owner's already-settled funds.
public fun withdraw_maker_revenue_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    treasury: &mut MakerTreasuryV8<PaymentCoin>,
    amount: u64,
    recipient: address,
    ctx: &mut TxContext,
) {
    maker::assert_admin_v8(root, admin);
    assert!(maker::root_owner_v8(root) == ctx.sender(), ENotCurrentOwner);
    assert_maker_treasury_v8(root, treasury);
    assert!(recipient != @0x0, EInvalidRecipient);
    assert!(amount > 0 && amount <= treasury.revenue.value(), EInvalidAmount);
    let payment = coin::take(&mut treasury.revenue, amount, ctx);
    treasury.total_withdrawn = treasury.total_withdrawn + (amount as u128);
    event::emit(MakerRevenueV8Withdrawn {
        root_id: maker::root_id_v8(root),
        treasury_id: object::id(treasury),
        operator: ctx.sender(),
        recipient,
        amount,
    });
    transfer::public_transfer(payment, recipient);
}

public fun maker_treasury_id_v8<PaymentCoin>(
    treasury: &MakerTreasuryV8<PaymentCoin>,
): ID { object::id(treasury) }
public fun maker_treasury_root_id_v8<PaymentCoin>(
    treasury: &MakerTreasuryV8<PaymentCoin>,
): ID { treasury.root_id }
public fun maker_treasury_balance_v8<PaymentCoin>(
    treasury: &MakerTreasuryV8<PaymentCoin>,
): u64 { treasury.revenue.value() }
public fun maker_treasury_total_collected_v8<PaymentCoin>(
    treasury: &MakerTreasuryV8<PaymentCoin>,
): u128 { treasury.total_collected }
public fun maker_treasury_total_withdrawn_v8<PaymentCoin>(
    treasury: &MakerTreasuryV8<PaymentCoin>,
): u128 { treasury.total_withdrawn }

public fun maker_access_pass_id_v8(pass: &MakerAccessPassV8): ID {
    object::id(pass)
}
public fun maker_access_pass_root_id_v8(pass: &MakerAccessPassV8): ID {
    pass.root_id
}
public fun maker_access_pass_maker_version_v8(pass: &MakerAccessPassV8): u64 {
    pass.maker_version
}
public fun maker_access_pass_root_content_commitment_v8(
    pass: &MakerAccessPassV8,
): &vector<u8> { &pass.root_content_commitment }
public fun maker_access_pass_holder_v8(pass: &MakerAccessPassV8): address {
    pass.holder
}
public fun maker_access_pass_paid_atomic_v8(pass: &MakerAccessPassV8): u64 {
    pass.paid_atomic
}
public fun maker_access_pass_issued_at_ms_v8(pass: &MakerAccessPassV8): u64 {
    pass.issued_at_ms
}

fun issue_maker_access_pass<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    treasury: &mut MakerTreasuryV8<PaymentCoin>,
    paid_atomic: u64,
    protocol_atomic: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let holder = ctx.sender();
    let key = MakerAccessKeyV8 { holder };
    assert!(!df::exists(&treasury.id, key), EAccessAlreadyIssued);
    let issued_at_ms = clock.timestamp_ms();
    let pass = MakerAccessPassV8 {
        id: object::new(ctx),
        version: VERSION,
        root_id: maker::root_id_v8(root),
        maker_version: maker::root_maker_version_v8(root),
        root_content_commitment: *maker::root_content_commitment_v8(root),
        holder,
        paid_atomic,
        issued_at_ms,
    };
    let pass_id = object::id(&pass);
    df::add(
        &mut treasury.id,
        key,
        MakerAccessRecordV8 {
            pass_id,
            holder,
            paid_atomic,
            issued_at_ms,
        },
    );
    event::emit(MakerAccessPassV8Issued {
        root_id: maker::root_id_v8(root),
        pass_id,
        holder,
        paid_atomic,
        protocol_atomic,
        maker_atomic: paid_atomic - protocol_atomic,
        issued_at_ms,
    });
    transfer::transfer(pass, holder);
}

#[test_only]
public fun destroy_maker_treasury_for_testing<PaymentCoin>(
    treasury: MakerTreasuryV8<PaymentCoin>,
) {
    let MakerTreasuryV8 {
        id,
        version: _,
        root_id: _,
        maker_version: _,
        root_content_commitment: _,
        revenue,
        total_collected: _,
        total_withdrawn: _,
    } = treasury;
    revenue.destroy_zero();
    id.delete();
}

#[test_only]
fun remove_maker_access_record_for_testing<PaymentCoin>(
    treasury: &mut MakerTreasuryV8<PaymentCoin>,
    holder: address,
) {
    let MakerAccessRecordV8 {
        pass_id: _,
        holder: _,
        paid_atomic: _,
        issued_at_ms: _,
    } = df::remove(&mut treasury.id, MakerAccessKeyV8 { holder });
}

#[test_only]
fun test_hash(byte: u8): vector<u8> {
    let mut value = vector[];
    let mut index = 0u64;
    while (index < 32) {
        value.push_back(byte);
        index = index + 1;
    };
    value
}

#[test]
fun exact_maker_treasury_survives_pause_for_withdrawal() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 801, 0, 0, 0);
    let (config, protocol_treasury, protocol_cap) =
        animacraft_v8_core::protocol_config_v8::new_protocol_with_treasury_for_testing<
            sui::sui::SUI,
        >(true, &mut ctx);
    let economics = maker::new_economics_snapshot_v8<sui::sui::SUI>(
        &config,
        maker::access_free_v8(),
        0,
        maker::complete_unlimited_free_v8(),
        0,
        0,
        0,
    );
    let rights = maker::new_onchain_native_rights_snapshot_v8(
        &ctx,
        250,
        250,
        500,
    );
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (mut root, admin) = maker::new_initial_maker_draft_v8<sui::sui::SUI>(
        &config,
        4,
        test_hash(1),
        test_hash(2),
        b"maker".to_string(),
        test_hash(3),
        b"walrus-blob".to_string(),
        test_hash(4),
        test_hash(5),
        economics,
        rights,
        &clock,
        &mut ctx,
    );
    let mut treasury = new_maker_treasury_v8(&mut root, &admin, &mut ctx);
    maker::set_lifecycle_for_testing(&mut root, maker::lifecycle_active_v8());
    let payment = coin::from_balance(
        balance::create_for_testing<sui::sui::SUI>(900),
        &mut ctx,
    );
    deposit_maker_revenue_v8(&root, &mut treasury, &config, payment);
    assert!(maker_treasury_balance_v8(&treasury) == 900, EInvalidAmount);
    maker::set_lifecycle_for_testing(&mut root, maker::lifecycle_paused_v8());
    withdraw_maker_revenue_v8(
        &root,
        &admin,
        &mut treasury,
        900,
        @0xB11,
        &mut ctx,
    );
    assert!(maker_treasury_balance_v8(&treasury) == 0, EInvalidAmount);
    assert!(maker_treasury_total_collected_v8(&treasury) == 900, EInvalidAmount);
    assert!(maker_treasury_total_withdrawn_v8(&treasury) == 900, EInvalidAmount);
    destroy_maker_treasury_for_testing(treasury);
    maker::destroy_maker_for_testing(root, admin);
    animacraft_v8_core::protocol_config_v8::destroy_protocol_with_treasury_for_testing(
        config,
        protocol_treasury,
        protocol_cap,
    );
    clock.destroy_for_testing();
}

#[test]
fun paid_maker_access_settles_exact_treasuries_before_issuing_pass() {
    let holder = @0xA11;
    let mut ctx = sui::tx_context::new_from_hint(holder, 811, 0, 0, 0);
    let (config, mut protocol_treasury, protocol_cap) =
        animacraft_v8_core::protocol_config_v8::new_protocol_with_treasury_for_testing<
            sui::sui::SUI,
        >(true, &mut ctx);
    let economics = maker::new_economics_snapshot_v8<sui::sui::SUI>(
        &config,
        maker::access_paid_v8(),
        1_000,
        maker::complete_unlimited_free_v8(),
        0,
        0,
        0,
    );
    let rights = maker::new_onchain_native_rights_snapshot_v8(
        &ctx,
        250,
        250,
        500,
    );
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (mut root, admin) = maker::new_initial_maker_draft_v8<sui::sui::SUI>(
        &config,
        4,
        test_hash(11),
        test_hash(12),
        b"paid-maker".to_string(),
        test_hash(13),
        b"paid-walrus-blob".to_string(),
        test_hash(14),
        test_hash(15),
        economics,
        rights,
        &clock,
        &mut ctx,
    );
    let mut maker_treasury = new_maker_treasury_v8(&mut root, &admin, &mut ctx);
    maker::set_lifecycle_for_testing(&mut root, maker::lifecycle_active_v8());
    let payment = coin::from_balance(
        balance::create_for_testing<sui::sui::SUI>(1_000),
        &mut ctx,
    );
    purchase_maker_access_v8(
        &root,
        &mut maker_treasury,
        &config,
        &mut protocol_treasury,
        payment,
        &clock,
        &mut ctx,
    );
    assert!(protocol::protocol_treasury_balance_v8(&protocol_treasury) == 100, EWrongPayment);
    assert!(maker_treasury_balance_v8(&maker_treasury) == 900, EWrongPayment);
    remove_maker_access_record_for_testing(&mut maker_treasury, holder);
    withdraw_maker_revenue_v8(
        &root,
        &admin,
        &mut maker_treasury,
        900,
        @0xB11,
        &mut ctx,
    );
    protocol::withdraw_protocol_revenue_v8(
        &config,
        &protocol_cap,
        &mut protocol_treasury,
        100,
        @0xB11,
        &mut ctx,
    );
    destroy_maker_treasury_for_testing(maker_treasury);
    maker::destroy_maker_for_testing(root, admin);
    protocol::destroy_protocol_with_treasury_for_testing(
        config,
        protocol_treasury,
        protocol_cap,
    );
    clock.destroy_for_testing();
}
