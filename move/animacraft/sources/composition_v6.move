module animacraft::composition_v6;

use animacraft::animacraft::{Self as legacy, ProtocolFeeAdminCap};
use animacraft::commerce_v5::{
    Self as commerce,
    CommerceProtocolConfigV5,
    MakerControlCapV5,
    MakerRootV5,
};
use std::bcs;
use std::hash;
use std::option::{Self as option, Option};
use std::string::{Self as string, String};
use std::type_name;
use sui::balance::{Self as balance, Balance};
use sui::clock::Clock;
use sui::coin::{Self as coin, Coin};
use sui::dynamic_field as df;
use sui::event;
use sui::table::{Self as table, Table};

const VERSION: u64 = 6;
const BPS_DENOMINATOR: u64 = 10_000;
const HASH_LENGTH: u64 = 32;
const MAX_MAKER_ECOSYSTEM_FEE_BPS: u16 = 1_000;

const PROFILE_FIXED: u8 = 0;
const PROFILE_COMPOSABLE: u8 = 1;

const THIRD_PARTY_OFFICIAL_ONLY: u8 = 0;
const THIRD_PARTY_CERTIFIED: u8 = 1;
const THIRD_PARTY_OPEN: u8 = 2;

const ADMISSION_OFFICIAL: u8 = 0;
const ADMISSION_CERTIFIED: u8 = 1;
const ADMISSION_OPEN: u8 = 2;

// Immutable Item Product origin.  The numeric values intentionally match the
// admission source kinds, but the two concepts remain distinct: origin is
// fixed at product publication, while admission is a Profile-scoped record
// that must prove it accepted the same class.
const ORIGIN_OFFICIAL: u8 = 0;
const ORIGIN_CERTIFIED: u8 = 1;
const ORIGIN_OPEN: u8 = 2;

const ACCESS_EMBEDDED: u8 = 0;
const ACCESS_FREE: u8 = 1;
const ACCESS_PAID: u8 = 2;

const BINDING_EMBEDDED: u8 = 0;
const BINDING_ACCOUNT: u8 = 1;
const BINDING_SOUL: u8 = 2;
const BINDING_OWNED: u8 = 3;

const SUBJECT_WALLET: u8 = 0;
const SUBJECT_SOUL: u8 = 1;
const SUBJECT_EMBEDDED: u8 = 2;

const RIGHTS_ONCHAIN_NATIVE: u8 = 0;
const RIGHTS_LICENSE_WRAPPED: u8 = 1;

const AUTH_INITIAL: u8 = 0;
const AUTH_UPDATE: u8 = 1;

const EInvalidProtocolAdmin: u64 = 0;
const EProtocolDisabled: u64 = 1;
const EProtocolMismatch: u64 = 2;
const EPaymentCoinMismatch: u64 = 3;
const EDependencyAlreadyBound: u64 = 4;
const EDependencyMissing: u64 = 5;
const EInvalidCommitment: u64 = 6;
const EInvalidProfileMode: u64 = 7;
const EInvalidThirdPartyPolicy: u64 = 8;
const EProfileExists: u64 = 9;
const EProfileNotSealed: u64 = 10;
const EProfileAlreadySealed: u64 = 11;
const EProfileNotComposable: u64 = 12;
const ELoadoutMutationDisabled: u64 = 13;
const EInvalidAccessKind: u64 = 14;
const EInvalidRightsOrigin: u64 = 15;
const EInvalidSlot: u64 = 16;
const EAdmissionExists: u64 = 17;
const EAdmissionMissing: u64 = 18;
const EAdmissionInactive: u64 = 19;
const EAdmissionPolicyMismatch: u64 = 20;
const EOfficialSourceMismatch: u64 = 21;
const EExternalSourceRequired: u64 = 22;
const EAttestationMismatch: u64 = 23;
const EInvalidValidatorCap: u64 = 24;
const EEntitlementExists: u64 = 25;
const EEntitlementMissing: u64 = 26;
const EWrongPayment: u64 = 27;
const EInvalidRecipient: u64 = 28;
const EInsufficientRevenue: u64 = 29;
const EInvalidSoulId: u64 = 30;
const ESoulOwnerProofMismatch: u64 = 31;
const EInvalidSubject: u64 = 32;
const EOwnedInstanceRequired: u64 = 33;
const EOwnedInstanceForbidden: u64 = 34;
const EOwnedItemMismatch: u64 = 35;
const EOwnedItemAlreadyLocked: u64 = 36;
const EOwnedItemNotLocked: u64 = 37;
const EOwnedItemWrongSoul: u64 = 38;
const ENotOwnedItemHolder: u64 = 39;
const EInvalidNonce: u64 = 40;
const ENonceAlreadyUsed: u64 = 41;
const EInvalidLoadoutHash: u64 = 42;
const EDuplicateSlot: u64 = 43;
const EEmptyLoadout: u64 = 44;
const EInvalidBinding: u64 = 45;
const EInvalidMakerEcosystemFee: u64 = 46;
const ERuleTargetMissing: u64 = 47;
const ERuleConflict: u64 = 48;
const ERequiredProductMissing: u64 = 49;
const EExcludedProductSelected: u64 = 50;
const EItemNotTransferable: u64 = 51;
const ERecipientAlreadyEntitled: u64 = 52;
const EInvalidCompanionManifestBlobId: u64 = 53;
const EProtocolMustBeDisabled: u64 = 54;
const EProfileCancellationForbidden: u64 = 55;
const EActiveSoulOwnedLocks: u64 = 56;
const ESecondaryLoadoutUnsafe: u64 = 57;
const EInvalidOriginKind: u64 = 58;
const EProductOriginMismatch: u64 = 59;
const EPhysicalV7AlreadyInitialized: u64 = 60;

/// Fail-closed protocol linkage for the additive v6 composition surface.
/// No rentals, games, durability, enhancement, consumption, or Bundle state
/// exists here. Future semantics must be introduced through a reviewed module
/// upgrade and a new extensions commitment.
public struct CompositionProtocolConfigV6 has key {
    id: UID,
    version: u64,
    v5_config_id: ID,
    v5_admin_cap_id: ID,
    treasury_id: ID,
    registry_id: ID,
    validator_cap_id: ID,
    validator_epoch: u64,
    payment_coin_type: String,
    primary_protocol_fee_bps: u16,
    validator_policy_commitment: vector<u8>,
    soul_owner_proof_type: Option<String>,
    enabled: bool,
}

public struct CompositionProtocolTreasuryV6<phantom PaymentCoin> has key {
    id: UID,
    version: u64,
    config_id: ID,
    revenue: Balance<PaymentCoin>,
    total_collected: u64,
    total_withdrawn: u64,
}

public struct CompositionAdminCapV6 has key {
    id: UID,
    version: u64,
    config_id: ID,
}

/// One-time marker stored directly on the canonical v6 administration
/// capability.  The additive physical_composition_v7 module claims it before
/// constructing the only canonical v7 config/registry pair.
public struct PhysicalV7InitializedKey has copy, drop, store {}

public struct ValidatorCapV6 has key {
    id: UID,
    version: u64,
    config_id: ID,
    validator_epoch: u64,
}

public struct WalletEntitlementKeyV6 has copy, drop, store {
    profile_id: ID,
    product_id: ID,
    wallet: address,
}

public struct SoulEntitlementKeyV6 has copy, drop, store {
    profile_id: ID,
    product_id: ID,
    soul_id: ID,
}

public struct LoadoutNonceKeyV6 has copy, drop, store {
    profile_id: ID,
    soul_id: ID,
    client_nonce: vector<u8>,
}

public struct EntitlementRecordV6 has copy, drop, store {
    purchaser: address,
    granted_at_ms: u64,
    paid_atomic: u64,
    owned_instance_id: Option<ID>,
}

public struct OwnedLockRecordV6 has copy, drop, store {
    profile_id: ID,
    product_id: ID,
    holder: address,
    soul_id: ID,
    ownership_epoch: u64,
}

public struct CompositionRegistryV6 has key {
    id: UID,
    version: u64,
    config_id: ID,
    profiles: Table<ID, ID>,
    wallet_entitlements: Table<WalletEntitlementKeyV6, EntitlementRecordV6>,
    soul_entitlements: Table<SoulEntitlementKeyV6, EntitlementRecordV6>,
    owned_locks: Table<ID, OwnedLockRecordV6>,
    soul_owned_lock_counts: Table<ID, u64>,
    used_nonces: Table<LoadoutNonceKeyV6, bool>,
}

/// One v5 release receives at most one v6 profile. The mode and schema
/// commitments are immutable after construction; only validator-backed
/// admission records may be appended after sealing.
public struct MakerProfileV6 has key {
    id: UID,
    version: u64,
    config_id: ID,
    root_id: ID,
    mode: u8,
    loadout_mutable: bool,
    item_assetization: bool,
    third_party_policy: u8,
    slot_schema_commitment: vector<u8>,
    renderer_commitment: vector<u8>,
    rights_origin: u8,
    primary_protocol_fee_bps: u16,
    /// Discoverable Walrus identity of the exact independent v6 companion
    /// manifest. This is separate from extensions_hash: it is required
    /// release data, not a future feature surface.
    companion_manifest_blob_id: String,
    companion_manifest_hash: vector<u8>,
    extensions_hash: vector<u8>,
    sealed: bool,
    admissions: Table<ID, AdmissionRecordV6>,
    admission_count: u64,
}

/// Immutable product definition. An official product is permanently tied to
/// its source Maker root; an external product has no source root and must pass
/// the target profile's Certified/Open admission path.
public struct ItemProductV6 has key {
    id: UID,
    version: u64,
    config_id: ID,
    source_root_id: Option<ID>,
    publisher: address,
    original_creator: address,
    origin_kind: u8,
    family_commitment: vector<u8>,
    definition_commitment: vector<u8>,
    asset_commitment: vector<u8>,
    slot_key: String,
    slot_schema_commitment: vector<u8>,
    rights_origin: u8,
    access_kind: u8,
    binding_kind: u8,
    price_atomic: u64,
    primary_protocol_fee_bps: u16,
    maker_ecosystem_fee_bps: u16,
    transferable: bool,
    required_product_ids: vector<ID>,
    excluded_product_ids: vector<ID>,
    extensions_hash: vector<u8>,
}

/// Immutable technical compatibility/security attestation. Open admission
/// removes Maker endorsement, never validator review.
public struct ValidatorAttestationV6 has key {
    id: UID,
    version: u64,
    config_id: ID,
    profile_id: ID,
    product_id: ID,
    definition_commitment: vector<u8>,
    slot_schema_commitment: vector<u8>,
    validator_policy_commitment: vector<u8>,
    validator_epoch: u64,
    issued_at_ms: u64,
}

public struct AdmissionRecordV6 has copy, drop, store {
    source_kind: u8,
    attestation_id: Option<ID>,
    admitted_by: address,
    admitted_at_ms: u64,
    definition_commitment: vector<u8>,
    asset_commitment: vector<u8>,
    slot_key: String,
    rights_origin: u8,
    access_kind: u8,
    binding_kind: u8,
    price_atomic: u64,
    maker_ecosystem_fee_bps: u16,
    transferable: bool,
    required_product_ids: vector<ID>,
    excluded_product_ids: vector<ID>,
    publisher: address,
    active: bool,
}

/// Independently wallet-owned only. Soul-bound access is recorded in the
/// Soul entitlement table and deliberately creates no instance.
public struct OwnedItemV6 has key {
    id: UID,
    version: u64,
    config_id: ID,
    profile_id: ID,
    product_id: ID,
    holder: address,
    transferable: bool,
    locked_soul: Option<ID>,
    ownership_epoch: u64,
}

/// Canonical selection committed into a loadout authorization.
public struct LoadoutSelectionV6 has copy, drop, store {
    product_id: ID,
    slot_key: String,
    subject_kind: u8,
    owned_instance_id: Option<ID>,
}

public struct LoadoutHashInputV6 has copy, drop, store {
    selections: vector<LoadoutSelectionV6>,
}

/// No abilities: it can only be consumed by the Soulidity adapter in the same
/// PTB that persists the resulting Soul loadout.
public struct LoadoutAuthorizationV6 {
    profile_id: ID,
    root_id: ID,
    soul_id: ID,
    authorizer: address,
    client_nonce: vector<u8>,
    loadout_hash: vector<u8>,
    slot_schema_commitment: vector<u8>,
    selections: vector<LoadoutSelectionV6>,
    wallet_bound_count: u64,
    version: u64,
}

/// Distinct no-ability type for the first Genesis/current binding. Fixed
/// profiles can issue this once to Soulidity, but can never issue the update
/// authorization type above.
public struct InitialLoadoutAuthorizationV6 {
    profile_id: ID,
    root_id: ID,
    soul_id: ID,
    authorizer: address,
    client_nonce: vector<u8>,
    loadout_hash: vector<u8>,
    slot_schema_commitment: vector<u8>,
    selections: vector<LoadoutSelectionV6>,
    wallet_bound_count: u64,
    version: u64,
}

public struct CompositionProtocolInitializedV6 has copy, drop {
    config_id: ID,
    treasury_id: ID,
    registry_id: ID,
    validator_cap_id: ID,
    validator_epoch: u64,
    validator_policy_commitment: vector<u8>,
    payment_coin_type: String,
    enabled: bool,
}

public struct MakerProfileCreatedV6 has copy, drop {
    profile_id: ID,
    root_id: ID,
    mode: u8,
    item_assetization: bool,
    third_party_policy: u8,
    companion_manifest_blob_id: String,
    companion_manifest_hash: vector<u8>,
}

public struct MakerProfileSealedV6 has copy, drop {
    profile_id: ID,
    root_id: ID,
}

/// Recovery-only deletion of a profile that never reached its immutable
/// sealed state. This releases the one-profile-per-root registry reservation
/// without touching a published profile or any admitted Item.
public struct MakerProfileCancelledV6 has copy, drop {
    profile_id: ID,
    root_id: ID,
    cancelled_by: address,
}

public struct ItemProductPublishedV6 has copy, drop {
    product_id: ID,
    source_root_id: Option<ID>,
    publisher: address,
    origin_kind: u8,
    access_kind: u8,
    binding_kind: u8,
    price_atomic: u64,
    maker_ecosystem_fee_bps: u16,
    transferable: bool,
}

public struct ItemAdmittedV6 has copy, drop {
    profile_id: ID,
    product_id: ID,
    source_kind: u8,
    attestation_id: Option<ID>,
    admitted_by: address,
}

public struct ItemAdmissionStatusChangedV6 has copy, drop {
    profile_id: ID,
    product_id: ID,
    active: bool,
    changed_by: address,
}

public struct ValidatorRotatedV6 has copy, drop {
    config_id: ID,
    validator_cap_id: ID,
    validator_epoch: u64,
    validator_policy_commitment: vector<u8>,
}

public struct EntitlementGrantedV6 has copy, drop {
    profile_id: ID,
    product_id: ID,
    subject_kind: u8,
    wallet: address,
    soul_id: Option<ID>,
    paid_atomic: u64,
    owned_instance_id: Option<ID>,
}

public struct OwnedItemLockChangedV6 has copy, drop {
    instance_id: ID,
    profile_id: ID,
    product_id: ID,
    holder: address,
    soul_id: ID,
    locked: bool,
}

public struct LoadoutAuthorizedV6 has copy, drop {
    profile_id: ID,
    root_id: ID,
    soul_id: ID,
    authorizer: address,
    client_nonce: vector<u8>,
    loadout_hash: vector<u8>,
    wallet_bound_count: u64,
    authorization_kind: u8,
}

public fun profile_mode_fixed_v6(): u8 { PROFILE_FIXED }
public fun profile_mode_composable_v6(): u8 { PROFILE_COMPOSABLE }
public fun composition_protocol_version_v6(): u64 { VERSION }
public fun third_party_official_only_v6(): u8 { THIRD_PARTY_OFFICIAL_ONLY }
public fun third_party_certified_v6(): u8 { THIRD_PARTY_CERTIFIED }
public fun third_party_open_v6(): u8 { THIRD_PARTY_OPEN }
public fun admission_official_v6(): u8 { ADMISSION_OFFICIAL }
public fun admission_certified_v6(): u8 { ADMISSION_CERTIFIED }
public fun admission_open_v6(): u8 { ADMISSION_OPEN }
public fun origin_official_v6(): u8 { ORIGIN_OFFICIAL }
public fun origin_certified_v6(): u8 { ORIGIN_CERTIFIED }
public fun origin_open_v6(): u8 { ORIGIN_OPEN }
public fun access_embedded_v6(): u8 { ACCESS_EMBEDDED }
public fun access_free_v6(): u8 { ACCESS_FREE }
public fun access_paid_v6(): u8 { ACCESS_PAID }
public fun binding_embedded_v6(): u8 { BINDING_EMBEDDED }
public fun binding_account_v6(): u8 { BINDING_ACCOUNT }
public fun binding_soul_v6(): u8 { BINDING_SOUL }
public fun binding_owned_v6(): u8 { BINDING_OWNED }
public fun subject_wallet_v6(): u8 { SUBJECT_WALLET }
public fun subject_soul_v6(): u8 { SUBJECT_SOUL }
public fun subject_embedded_v6(): u8 { SUBJECT_EMBEDDED }
public fun rights_onchain_native_v6(): u8 { RIGHTS_ONCHAIN_NATIVE }
public fun rights_license_wrapped_v6(): u8 { RIGHTS_LICENSE_WRAPPED }

fun new_protocol_objects<PaymentCoin>(
    v5_config: &CommerceProtocolConfigV5,
    v5_admin: &ProtocolFeeAdminCap,
    validator_policy_commitment: vector<u8>,
    ctx: &mut TxContext,
): (
    CompositionProtocolConfigV6,
    CompositionProtocolTreasuryV6<PaymentCoin>,
    CompositionRegistryV6,
    CompositionAdminCapV6,
    ValidatorCapV6,
) {
    commerce::assert_extension_protocol_admin_v5(v5_config, v5_admin);
    assert_hash(&validator_policy_commitment);
    assert!(
        &payment_coin_type_name<PaymentCoin>()
            == commerce::extension_payment_coin_type_v5(v5_config),
        EPaymentCoinMismatch,
    );
    let config_uid = object::new(ctx);
    let config_id = config_uid.to_inner();
    let treasury = CompositionProtocolTreasuryV6<PaymentCoin> {
        id: object::new(ctx),
        version: VERSION,
        config_id,
        revenue: balance::zero(),
        total_collected: 0,
        total_withdrawn: 0,
    };
    let registry = CompositionRegistryV6 {
        id: object::new(ctx),
        version: VERSION,
        config_id,
        profiles: table::new(ctx),
        wallet_entitlements: table::new(ctx),
        soul_entitlements: table::new(ctx),
        owned_locks: table::new(ctx),
        soul_owned_lock_counts: table::new(ctx),
        used_nonces: table::new(ctx),
    };
    let admin = CompositionAdminCapV6 {
        id: object::new(ctx),
        version: VERSION,
        config_id,
    };
    let validator = ValidatorCapV6 {
        id: object::new(ctx),
        version: VERSION,
        config_id,
        validator_epoch: 0,
    };
    let config = CompositionProtocolConfigV6 {
        id: config_uid,
        version: VERSION,
        v5_config_id: object::id(v5_config),
        v5_admin_cap_id: object::id(v5_admin),
        treasury_id: object::id(&treasury),
        registry_id: object::id(&registry),
        validator_cap_id: object::id(&validator),
        validator_epoch: 0,
        payment_coin_type: payment_coin_type_name<PaymentCoin>(),
        primary_protocol_fee_bps:
            commerce::primary_protocol_fee_bps_v5(v5_config),
        validator_policy_commitment,
        soul_owner_proof_type: option::none(),
        enabled: false,
    };
    (config, treasury, registry, admin, validator)
}

/// Additive v6 initialization. It never mutates or migrates a v5 Maker.
public fun initialize_composition_protocol_v6<PaymentCoin>(
    v5_config: &CommerceProtocolConfigV5,
    v5_admin: &mut ProtocolFeeAdminCap,
    validator_policy_commitment: vector<u8>,
    ctx: &mut TxContext,
) {
    commerce::assert_extension_protocol_admin_v5(v5_config, v5_admin);
    assert_hash(&validator_policy_commitment);
    assert!(
        &payment_coin_type_name<PaymentCoin>()
            == commerce::extension_payment_coin_type_v5(v5_config),
        EPaymentCoinMismatch,
    );
    legacy::claim_composition_v6_initializer(v5_admin);
    let (config, treasury, registry, admin, validator) =
        new_protocol_objects<PaymentCoin>(
            v5_config,
            v5_admin,
            validator_policy_commitment,
            ctx,
        );
    event::emit(CompositionProtocolInitializedV6 {
        config_id: object::id(&config),
        treasury_id: object::id(&treasury),
        registry_id: object::id(&registry),
        validator_cap_id: object::id(&validator),
        validator_epoch: config.validator_epoch,
        validator_policy_commitment: *&config.validator_policy_commitment,
        payment_coin_type: payment_coin_type_name<PaymentCoin>(),
        enabled: false,
    });
    transfer::share_object(config);
    transfer::share_object(treasury);
    transfer::share_object(registry);
    transfer::transfer(admin, ctx.sender());
    transfer::transfer(validator, ctx.sender());
}

#[test_only]
public fun new_composition_protocol_v6_for_testing<PaymentCoin>(
    v5_config: &CommerceProtocolConfigV5,
    v5_admin: &ProtocolFeeAdminCap,
    validator_policy_commitment: vector<u8>,
    ctx: &mut TxContext,
): (
    CompositionProtocolConfigV6,
    CompositionProtocolTreasuryV6<PaymentCoin>,
    CompositionRegistryV6,
    CompositionAdminCapV6,
    ValidatorCapV6,
) {
    new_protocol_objects<PaymentCoin>(
        v5_config,
        v5_admin,
        validator_policy_commitment,
        ctx,
    )
}

/// One-time binding to Soulidity's private-constructor owner proof type.
public fun bind_soul_owner_proof_type_v6<Proof: drop>(
    config: &mut CompositionProtocolConfigV6,
    v5_config: &CommerceProtocolConfigV5,
    v5_admin: &ProtocolFeeAdminCap,
) {
    assert_protocol_link(config, v5_config);
    commerce::assert_extension_protocol_admin_v5(v5_config, v5_admin);
    assert!(!config.enabled, EDependencyAlreadyBound);
    assert!(config.soul_owner_proof_type.is_none(), EDependencyAlreadyBound);
    config.soul_owner_proof_type = option::some(defining_type_name<Proof>());
}

public fun update_protocol_enabled_v6(
    config: &mut CompositionProtocolConfigV6,
    v5_config: &CommerceProtocolConfigV5,
    v5_admin: &ProtocolFeeAdminCap,
    enabled: bool,
) {
    assert_protocol_link(config, v5_config);
    commerce::assert_extension_protocol_admin_v5(v5_config, v5_admin);
    if (enabled) {
        assert!(commerce::protocol_enabled_v5(v5_config), EProtocolDisabled);
        assert!(config.soul_owner_proof_type.is_some(), EDependencyMissing);
        assert_hash(&config.validator_policy_commitment);
    };
    config.enabled = enabled;
}

fun rotate_validator(
    config: &mut CompositionProtocolConfigV6,
    v5_config: &CommerceProtocolConfigV5,
    v5_admin: &ProtocolFeeAdminCap,
    admin: &CompositionAdminCapV6,
    validator_policy_commitment: vector<u8>,
    ctx: &mut TxContext,
): ValidatorCapV6 {
    assert_protocol_link(config, v5_config);
    commerce::assert_extension_protocol_admin_v5(v5_config, v5_admin);
    assert_admin(config, admin);
    assert!(!config.enabled, EProtocolMustBeDisabled);
    assert_hash(&validator_policy_commitment);
    config.validator_epoch = config.validator_epoch + 1;
    config.validator_policy_commitment = validator_policy_commitment;
    let validator = ValidatorCapV6 {
        id: object::new(ctx),
        version: VERSION,
        config_id: object::id(config),
        validator_epoch: config.validator_epoch,
    };
    config.validator_cap_id = object::id(&validator);
    event::emit(ValidatorRotatedV6 {
        config_id: object::id(config),
        validator_cap_id: object::id(&validator),
        validator_epoch: config.validator_epoch,
        validator_policy_commitment: *&config.validator_policy_commitment,
    });
    validator
}

/// Validator rotation is deliberately available only while the v6 gate is
/// disabled. The previous Cap remains an owned object but immediately loses
/// authority because both its object ID and epoch no longer match config.
public fun rotate_validator_v6(
    config: &mut CompositionProtocolConfigV6,
    v5_config: &CommerceProtocolConfigV5,
    v5_admin: &ProtocolFeeAdminCap,
    admin: &CompositionAdminCapV6,
    validator_policy_commitment: vector<u8>,
    ctx: &mut TxContext,
) {
    let validator = rotate_validator(
        config,
        v5_config,
        v5_admin,
        admin,
        validator_policy_commitment,
        ctx,
    );
    transfer::transfer(validator, ctx.sender());
}

#[test_only]
public fun rotate_validator_v6_for_testing(
    config: &mut CompositionProtocolConfigV6,
    v5_config: &CommerceProtocolConfigV5,
    v5_admin: &ProtocolFeeAdminCap,
    admin: &CompositionAdminCapV6,
    validator_policy_commitment: vector<u8>,
    ctx: &mut TxContext,
): ValidatorCapV6 {
    rotate_validator(
        config,
        v5_config,
        v5_admin,
        admin,
        validator_policy_commitment,
        ctx,
    )
}

/// Explicit custody migration for the composition administrator. The Cap has
/// no `store` ability, so it can move only through this reviewed module path.
/// Passing the owned Cap proves current custody; the non-zero recipient check
/// prevents accidentally burning production authority.
public fun transfer_composition_admin_cap_v6(
    cap: CompositionAdminCapV6,
    recipient: address,
    ctx: &TxContext,
) {
    assert!(recipient != @0x0 && recipient != ctx.sender(), EInvalidRecipient);
    transfer::transfer(cap, recipient);
}

/// Explicit custody migration for the currently authoritative validator Cap.
/// Stale rotated Caps may also be moved, but remain powerless because config
/// continues to pin the active object ID and epoch.
public fun transfer_validator_cap_v6(
    cap: ValidatorCapV6,
    recipient: address,
    ctx: &TxContext,
) {
    assert!(recipient != @0x0 && recipient != ctx.sender(), EInvalidRecipient);
    transfer::transfer(cap, recipient);
}

public fun composition_admin_cap_id_v6(self: &CompositionAdminCapV6): ID {
    object::id(self)
}

public fun composition_admin_cap_config_id_v6(
    self: &CompositionAdminCapV6,
): ID {
    self.config_id
}

/// Capability-gated one-time initializer bridge for the physical v7 companion
/// package. This ABI is public because Sui's package-size limit requires v7 to
/// live in a separate package; possession of the canonical mutable AdminCap is
/// still required and the marker prevents replay.
/// Keeping the marker on the canonical v6 key-only capability prevents a
/// second config from being created by replaying an address-level authority.
public fun claim_physical_v7_initializer(
    config: &CompositionProtocolConfigV6,
    admin: &mut CompositionAdminCapV6,
) {
    assert_admin(config, admin);
    assert!(
        !df::exists(&admin.id, PhysicalV7InitializedKey {}),
        EPhysicalV7AlreadyInitialized,
    );
    df::add(&mut admin.id, PhysicalV7InitializedKey {}, 7u64);
}

public fun validator_cap_id_v6(self: &ValidatorCapV6): ID {
    object::id(self)
}

public fun validator_cap_config_id_v6(self: &ValidatorCapV6): ID {
    self.config_id
}

public fun validator_cap_epoch_v6(self: &ValidatorCapV6): u64 {
    self.validator_epoch
}

public fun protocol_config_id_v6(self: &CompositionProtocolConfigV6): ID {
    object::id(self)
}
public fun protocol_v5_config_id_v6(self: &CompositionProtocolConfigV6): ID {
    self.v5_config_id
}

public fun protocol_soul_owner_proof_type_v6(
    self: &CompositionProtocolConfigV6,
): Option<String> {
    self.soul_owner_proof_type
}

public fun protocol_enabled_v6(self: &CompositionProtocolConfigV6): bool {
    self.enabled
}

public fun protocol_validator_epoch_v6(
    self: &CompositionProtocolConfigV6,
): u64 {
    self.validator_epoch
}

public fun protocol_validator_cap_id_v6(
    self: &CompositionProtocolConfigV6,
): ID {
    self.validator_cap_id
}

public fun protocol_validator_policy_commitment_v6(
    self: &CompositionProtocolConfigV6,
): &vector<u8> {
    &self.validator_policy_commitment
}

public fun protocol_primary_fee_bps_v6(
    self: &CompositionProtocolConfigV6,
): u16 {
    self.primary_protocol_fee_bps
}

public fun protocol_treasury_balance_v6<PaymentCoin>(
    self: &CompositionProtocolTreasuryV6<PaymentCoin>,
): u64 {
    self.revenue.value()
}

public fun withdraw_protocol_revenue_v6<PaymentCoin>(
    config: &CompositionProtocolConfigV6,
    treasury: &mut CompositionProtocolTreasuryV6<PaymentCoin>,
    admin: &CompositionAdminCapV6,
    amount: u64,
    recipient: address,
    ctx: &mut TxContext,
) {
    assert_admin(config, admin);
    assert_treasury(config, treasury);
    assert!(recipient != @0x0, EInvalidRecipient);
    assert!(amount > 0 && amount <= treasury.revenue.value(), EInsufficientRevenue);
    let payment = coin::take(&mut treasury.revenue, amount, ctx);
    treasury.total_withdrawn = treasury.total_withdrawn + amount;
    transfer::public_transfer(payment, recipient);
}

fun new_profile(
    root: &MakerRootV5,
    cap: &MakerControlCapV5,
    config: &CompositionProtocolConfigV6,
    registry: &mut CompositionRegistryV6,
    mode: u8,
    item_assetization: bool,
    third_party_policy: u8,
    slot_schema_commitment: vector<u8>,
    renderer_commitment: vector<u8>,
    companion_manifest_blob_id: String,
    companion_manifest_hash: vector<u8>,
    extensions_hash: vector<u8>,
    ctx: &mut TxContext,
): MakerProfileV6 {
    assert_protocol_enabled_v6(config);
    commerce::assert_extension_control_v5(root, cap, ctx);
    assert_registry(config, registry);
    assert_valid_profile_mode(mode);
    assert_valid_third_party_policy(third_party_policy);
    if (mode == PROFILE_FIXED) {
        assert!(!item_assetization, EInvalidProfileMode);
        assert!(
            third_party_policy == THIRD_PARTY_OFFICIAL_ONLY,
            EInvalidProfileMode,
        );
    };
    assert_hash(&slot_schema_commitment);
    assert_hash(&renderer_commitment);
    assert_companion_manifest(
        &companion_manifest_blob_id,
        &companion_manifest_hash,
    );
    assert_hash(&extensions_hash);
    let root_id = commerce::root_id_v5(root);
    assert!(!registry.profiles.contains(root_id), EProfileExists);
    let profile = MakerProfileV6 {
        id: object::new(ctx),
        version: VERSION,
        config_id: object::id(config),
        root_id,
        mode,
        loadout_mutable: mode == PROFILE_COMPOSABLE,
        item_assetization,
        third_party_policy,
        slot_schema_commitment,
        renderer_commitment,
        rights_origin: commerce::root_rights_origin_v5(root),
        primary_protocol_fee_bps: config.primary_protocol_fee_bps,
        companion_manifest_blob_id,
        companion_manifest_hash,
        extensions_hash,
        sealed: false,
        admissions: table::new(ctx),
        admission_count: 0,
    };
    registry.profiles.add(root_id, object::id(&profile));
    event::emit(MakerProfileCreatedV6 {
        profile_id: object::id(&profile),
        root_id,
        mode,
        item_assetization,
        third_party_policy,
        companion_manifest_blob_id: profile.companion_manifest_blob_id,
        companion_manifest_hash: profile.companion_manifest_hash,
    });
    profile
}

public fun create_maker_profile_v6(
    root: &MakerRootV5,
    cap: &MakerControlCapV5,
    config: &CompositionProtocolConfigV6,
    v5_config: &CommerceProtocolConfigV5,
    registry: &mut CompositionRegistryV6,
    mode: u8,
    item_assetization: bool,
    third_party_policy: u8,
    slot_schema_commitment: vector<u8>,
    renderer_commitment: vector<u8>,
    companion_manifest_blob_id: String,
    companion_manifest_hash: vector<u8>,
    extensions_hash: vector<u8>,
    ctx: &mut TxContext,
) {
    assert_v6_publication_gate(config, v5_config);
    let profile = new_profile(
        root,
        cap,
        config,
        registry,
        mode,
        item_assetization,
        third_party_policy,
        slot_schema_commitment,
        renderer_commitment,
        companion_manifest_blob_id,
        companion_manifest_hash,
        extensions_hash,
        ctx,
    );
    transfer::share_object(profile);
}

#[test_only]
public fun new_maker_profile_v6_for_testing(
    root: &MakerRootV5,
    cap: &MakerControlCapV5,
    config: &CompositionProtocolConfigV6,
    registry: &mut CompositionRegistryV6,
    mode: u8,
    item_assetization: bool,
    third_party_policy: u8,
    slot_schema_commitment: vector<u8>,
    renderer_commitment: vector<u8>,
    companion_manifest_blob_id: String,
    companion_manifest_hash: vector<u8>,
    extensions_hash: vector<u8>,
    ctx: &mut TxContext,
): MakerProfileV6 {
    new_profile(
        root,
        cap,
        config,
        registry,
        mode,
        item_assetization,
        third_party_policy,
        slot_schema_commitment,
        renderer_commitment,
        companion_manifest_blob_id,
        companion_manifest_hash,
        extensions_hash,
        ctx,
    )
}

public fun seal_maker_profile_v6(
    profile: &mut MakerProfileV6,
    root: &MakerRootV5,
    cap: &MakerControlCapV5,
    config: &CompositionProtocolConfigV6,
    v5_config: &CommerceProtocolConfigV5,
    ctx: &TxContext,
) {
    assert_v6_publication_gate(config, v5_config);
    commerce::assert_extension_control_v5(root, cap, ctx);
    assert_profile_link(config, profile, root);
    assert!(!profile.sealed, EProfileAlreadySealed);
    profile.sealed = true;
    event::emit(MakerProfileSealedV6 {
        profile_id: object::id(profile),
        root_id: profile.root_id,
    });
}

/// Cancel an incomplete profile and release its root reservation. This is
/// deliberately available while either release gate is disabled: disabling
/// new writes must not trap a Maker in an unsealed multi-signer checkpoint.
/// A sealed profile is immutable and can never use this recovery path.
public fun cancel_unsealed_maker_profile_v6(
    profile: MakerProfileV6,
    root: &MakerRootV5,
    cap: &MakerControlCapV5,
    config: &CompositionProtocolConfigV6,
    v5_config: &CommerceProtocolConfigV5,
    registry: &mut CompositionRegistryV6,
    ctx: &TxContext,
) {
    assert_protocol_link(config, v5_config);
    commerce::assert_extension_control_v5(root, cap, ctx);
    assert_registry(config, registry);
    assert_profile_link(config, &profile, root);
    assert!(
        !profile.sealed && profile.admission_count == 0,
        EProfileCancellationForbidden,
    );
    let profile_id = object::id(&profile);
    let root_id = profile.root_id;
    let registered_profile_id = registry.profiles.remove(root_id);
    assert!(registered_profile_id == profile_id, EProtocolMismatch);
    event::emit(MakerProfileCancelledV6 {
        profile_id,
        root_id,
        cancelled_by: ctx.sender(),
    });
    let MakerProfileV6 {
        id,
        version: _,
        config_id: _,
        root_id: _,
        mode: _,
        loadout_mutable: _,
        item_assetization: _,
        third_party_policy: _,
        slot_schema_commitment: _,
        renderer_commitment: _,
        rights_origin: _,
        primary_protocol_fee_bps: _,
        companion_manifest_blob_id: _,
        companion_manifest_hash: _,
        extensions_hash: _,
        sealed: _,
        admissions,
        admission_count: _,
    } = profile;
    table::destroy_empty(admissions);
    id.delete();
}

public fun profile_id_v6(self: &MakerProfileV6): ID { object::id(self) }
public fun profile_config_id_v6(self: &MakerProfileV6): ID { self.config_id }
public fun profile_root_id_v6(self: &MakerProfileV6): ID { self.root_id }
public fun profile_mode_v6(self: &MakerProfileV6): u8 { self.mode }
public fun profile_loadout_mutable_v6(self: &MakerProfileV6): bool {
    self.loadout_mutable
}
public fun profile_item_assetization_v6(self: &MakerProfileV6): bool {
    self.item_assetization
}
public fun profile_third_party_policy_v6(self: &MakerProfileV6): u8 {
    self.third_party_policy
}
public fun profile_slot_schema_commitment_v6(
    self: &MakerProfileV6,
): &vector<u8> {
    &self.slot_schema_commitment
}
public fun profile_renderer_commitment_v6(
    self: &MakerProfileV6,
): &vector<u8> {
    &self.renderer_commitment
}
public fun profile_companion_manifest_blob_id_v6(
    self: &MakerProfileV6,
): &String {
    &self.companion_manifest_blob_id
}
public fun profile_companion_manifest_hash_v6(
    self: &MakerProfileV6,
): &vector<u8> {
    &self.companion_manifest_hash
}
public fun profile_extensions_hash_v6(self: &MakerProfileV6): &vector<u8> {
    &self.extensions_hash
}
public fun profile_sealed_v6(self: &MakerProfileV6): bool { self.sealed }
public fun profile_admission_count_v6(self: &MakerProfileV6): u64 {
    self.admission_count
}

fun new_item_product(
    config: &CompositionProtocolConfigV6,
    profile: &MakerProfileV6,
    source_root_id: Option<ID>,
    publisher: address,
    original_creator: address,
    origin_kind: u8,
    family_commitment: vector<u8>,
    definition_commitment: vector<u8>,
    asset_commitment: vector<u8>,
    slot_key: String,
    slot_schema_commitment: vector<u8>,
    rights_origin: u8,
    access_kind: u8,
    binding_kind: u8,
    price_atomic: u64,
    maker_ecosystem_fee_bps: u16,
    transferable: bool,
    required_product_ids: vector<ID>,
    excluded_product_ids: vector<ID>,
    extensions_hash: vector<u8>,
    ctx: &mut TxContext,
): ItemProductV6 {
    assert_protocol_enabled_v6(config);
    assert!(publisher != @0x0 && original_creator != @0x0, EInvalidRecipient);
    assert_hash(&family_commitment);
    assert_hash(&definition_commitment);
    assert_hash(&asset_commitment);
    assert_hash(&slot_schema_commitment);
    assert_hash(&extensions_hash);
    assert_non_empty(&slot_key);
    assert_valid_origin_kind(origin_kind);
    assert_valid_rights_origin(rights_origin);
    assert_valid_access(
        profile,
        access_kind,
        binding_kind,
        price_atomic,
        transferable,
    );
    assert!(
        maker_ecosystem_fee_bps <= MAX_MAKER_ECOSYSTEM_FEE_BPS,
        EInvalidMakerEcosystemFee,
    );
    let product = ItemProductV6 {
        id: object::new(ctx),
        version: VERSION,
        config_id: object::id(config),
        source_root_id,
        publisher,
        original_creator,
        origin_kind,
        family_commitment,
        definition_commitment,
        asset_commitment,
        slot_key,
        slot_schema_commitment,
        rights_origin,
        access_kind,
        binding_kind,
        price_atomic,
        primary_protocol_fee_bps: config.primary_protocol_fee_bps,
        maker_ecosystem_fee_bps,
        transferable,
        required_product_ids,
        excluded_product_ids,
        extensions_hash,
    };
    assert_product_rules(&product);
    event::emit(ItemProductPublishedV6 {
        product_id: object::id(&product),
        source_root_id,
        publisher,
        origin_kind,
        access_kind,
        binding_kind,
        price_atomic,
        maker_ecosystem_fee_bps,
        transferable,
    });
    product
}

fun new_official_item_product(
    profile: &MakerProfileV6,
    root: &MakerRootV5,
    cap: &MakerControlCapV5,
    config: &CompositionProtocolConfigV6,
    family_commitment: vector<u8>,
    definition_commitment: vector<u8>,
    asset_commitment: vector<u8>,
    slot_key: String,
    access_kind: u8,
    binding_kind: u8,
    price_atomic: u64,
    maker_ecosystem_fee_bps: u16,
    transferable: bool,
    required_product_ids: vector<ID>,
    excluded_product_ids: vector<ID>,
    extensions_hash: vector<u8>,
    ctx: &mut TxContext,
): ItemProductV6 {
    commerce::assert_extension_control_v5(root, cap, ctx);
    assert_profile_link(config, profile, root);
    new_item_product(
        config,
        profile,
        option::some(profile.root_id),
        commerce::root_current_owner_v5(root),
        // An Official Item is authored by the current Maker operator that
        // publishes it. Maker provenance remains on the source root itself;
        // attributing every later Item to the root's first owner would be
        // incorrect after a Maker transfer.
        commerce::root_current_owner_v5(root),
        ORIGIN_OFFICIAL,
        family_commitment,
        definition_commitment,
        asset_commitment,
        slot_key,
        *&profile.slot_schema_commitment,
        profile.rights_origin,
        access_kind,
        binding_kind,
        price_atomic,
        maker_ecosystem_fee_bps,
        transferable,
        required_product_ids,
        excluded_product_ids,
        extensions_hash,
        ctx,
    )
}

public fun publish_official_item_product_v6(
    profile: &MakerProfileV6,
    root: &MakerRootV5,
    cap: &MakerControlCapV5,
    config: &CompositionProtocolConfigV6,
    v5_config: &CommerceProtocolConfigV5,
    family_commitment: vector<u8>,
    definition_commitment: vector<u8>,
    asset_commitment: vector<u8>,
    slot_key: String,
    access_kind: u8,
    binding_kind: u8,
    price_atomic: u64,
    maker_ecosystem_fee_bps: u16,
    transferable: bool,
    required_product_ids: vector<ID>,
    excluded_product_ids: vector<ID>,
    extensions_hash: vector<u8>,
    ctx: &mut TxContext,
) {
    assert_v6_publication_gate(config, v5_config);
    let product = new_official_item_product(
        profile,
        root,
        cap,
        config,
        family_commitment,
        definition_commitment,
        asset_commitment,
        slot_key,
        access_kind,
        binding_kind,
        price_atomic,
        maker_ecosystem_fee_bps,
        transferable,
        required_product_ids,
        excluded_product_ids,
        extensions_hash,
        ctx,
    );
    transfer::freeze_object(product);
}

#[test_only]
public fun new_official_item_product_v6_for_testing(
    profile: &MakerProfileV6,
    root: &MakerRootV5,
    cap: &MakerControlCapV5,
    config: &CompositionProtocolConfigV6,
    family_commitment: vector<u8>,
    definition_commitment: vector<u8>,
    asset_commitment: vector<u8>,
    slot_key: String,
    access_kind: u8,
    binding_kind: u8,
    price_atomic: u64,
    maker_ecosystem_fee_bps: u16,
    transferable: bool,
    required_product_ids: vector<ID>,
    excluded_product_ids: vector<ID>,
    extensions_hash: vector<u8>,
    ctx: &mut TxContext,
): ItemProductV6 {
    new_official_item_product(
        profile,
        root,
        cap,
        config,
        family_commitment,
        definition_commitment,
        asset_commitment,
        slot_key,
        access_kind,
        binding_kind,
        price_atomic,
        maker_ecosystem_fee_bps,
        transferable,
        required_product_ids,
        excluded_product_ids,
        extensions_hash,
        ctx,
    )
}

fun new_external_item_product(
    profile: &MakerProfileV6,
    config: &CompositionProtocolConfigV6,
    origin_kind: u8,
    family_commitment: vector<u8>,
    definition_commitment: vector<u8>,
    asset_commitment: vector<u8>,
    slot_key: String,
    rights_origin: u8,
    access_kind: u8,
    binding_kind: u8,
    price_atomic: u64,
    maker_ecosystem_fee_bps: u16,
    transferable: bool,
    required_product_ids: vector<ID>,
    excluded_product_ids: vector<ID>,
    extensions_hash: vector<u8>,
    ctx: &mut TxContext,
): ItemProductV6 {
    assert!(profile.config_id == object::id(config), EProtocolMismatch);
    assert!(
        origin_kind == ORIGIN_CERTIFIED || origin_kind == ORIGIN_OPEN,
        EInvalidOriginKind,
    );
    new_item_product(
        config,
        profile,
        option::none(),
        ctx.sender(),
        ctx.sender(),
        origin_kind,
        family_commitment,
        definition_commitment,
        asset_commitment,
        slot_key,
        *&profile.slot_schema_commitment,
        rights_origin,
        access_kind,
        binding_kind,
        price_atomic,
        maker_ecosystem_fee_bps,
        transferable,
        required_product_ids,
        excluded_product_ids,
        extensions_hash,
        ctx,
    )
}

public fun publish_external_item_product_v6(
    profile: &MakerProfileV6,
    config: &CompositionProtocolConfigV6,
    v5_config: &CommerceProtocolConfigV5,
    origin_kind: u8,
    family_commitment: vector<u8>,
    definition_commitment: vector<u8>,
    asset_commitment: vector<u8>,
    slot_key: String,
    rights_origin: u8,
    access_kind: u8,
    binding_kind: u8,
    price_atomic: u64,
    maker_ecosystem_fee_bps: u16,
    transferable: bool,
    required_product_ids: vector<ID>,
    excluded_product_ids: vector<ID>,
    extensions_hash: vector<u8>,
    ctx: &mut TxContext,
) {
    assert_v6_publication_gate(config, v5_config);
    let product = new_external_item_product(
        profile,
        config,
        origin_kind,
        family_commitment,
        definition_commitment,
        asset_commitment,
        slot_key,
        rights_origin,
        access_kind,
        binding_kind,
        price_atomic,
        maker_ecosystem_fee_bps,
        transferable,
        required_product_ids,
        excluded_product_ids,
        extensions_hash,
        ctx,
    );
    transfer::freeze_object(product);
}

#[test_only]
public fun new_external_item_product_v6_for_testing(
    profile: &MakerProfileV6,
    config: &CompositionProtocolConfigV6,
    origin_kind: u8,
    family_commitment: vector<u8>,
    definition_commitment: vector<u8>,
    asset_commitment: vector<u8>,
    slot_key: String,
    rights_origin: u8,
    access_kind: u8,
    binding_kind: u8,
    price_atomic: u64,
    maker_ecosystem_fee_bps: u16,
    transferable: bool,
    required_product_ids: vector<ID>,
    excluded_product_ids: vector<ID>,
    extensions_hash: vector<u8>,
    ctx: &mut TxContext,
): ItemProductV6 {
    new_external_item_product(
        profile,
        config,
        origin_kind,
        family_commitment,
        definition_commitment,
        asset_commitment,
        slot_key,
        rights_origin,
        access_kind,
        binding_kind,
        price_atomic,
        maker_ecosystem_fee_bps,
        transferable,
        required_product_ids,
        excluded_product_ids,
        extensions_hash,
        ctx,
    )
}

/// Minimal immutable external product fixture for cross-version authority
/// tests. Production products can only be created by the reviewed publication
/// paths above; this helper is absent from published bytecode.
#[test_only]
public fun new_external_item_product_stub_v6_for_testing(
    config_id: ID,
    publisher: address,
    original_creator: address,
    origin_kind: u8,
    slot_key: String,
    family_commitment: vector<u8>,
    slot_schema_commitment: vector<u8>,
    ctx: &mut TxContext,
): ItemProductV6 {
    ItemProductV6 {
        id: object::new(ctx),
        version: VERSION,
        config_id,
        source_root_id: option::none(),
        publisher,
        original_creator,
        origin_kind,
        family_commitment,
        definition_commitment: test_commitment(91),
        asset_commitment: test_commitment(92),
        slot_key,
        slot_schema_commitment,
        rights_origin: RIGHTS_ONCHAIN_NATIVE,
        access_kind: ACCESS_FREE,
        binding_kind: BINDING_OWNED,
        price_atomic: 0,
        primary_protocol_fee_bps: 1_000,
        maker_ecosystem_fee_bps: 0,
        transferable: true,
        required_product_ids: vector[],
        excluded_product_ids: vector[],
        extensions_hash: test_commitment(93),
    }
}

public fun product_id_v6(self: &ItemProductV6): ID { object::id(self) }
public fun product_config_id_v6(self: &ItemProductV6): ID { self.config_id }
public fun product_family_commitment_v6(
    self: &ItemProductV6,
): &vector<u8> {
    &self.family_commitment
}
public fun product_source_root_id_v6(self: &ItemProductV6): Option<ID> {
    self.source_root_id
}
public fun product_publisher_v6(self: &ItemProductV6): address { self.publisher }
public fun product_original_creator_v6(self: &ItemProductV6): address {
    self.original_creator
}
public fun product_origin_kind_v6(self: &ItemProductV6): u8 {
    self.origin_kind
}
public fun product_definition_commitment_v6(
    self: &ItemProductV6,
): &vector<u8> {
    &self.definition_commitment
}
public fun product_asset_commitment_v6(self: &ItemProductV6): &vector<u8> {
    &self.asset_commitment
}
public fun product_slot_key_v6(self: &ItemProductV6): &String { &self.slot_key }
public fun product_slot_schema_commitment_v6(
    self: &ItemProductV6,
): &vector<u8> {
    &self.slot_schema_commitment
}
public fun product_rights_origin_v6(self: &ItemProductV6): u8 {
    self.rights_origin
}
public fun product_access_kind_v6(self: &ItemProductV6): u8 { self.access_kind }
public fun product_binding_kind_v6(self: &ItemProductV6): u8 { self.binding_kind }
public fun product_price_atomic_v6(self: &ItemProductV6): u64 { self.price_atomic }
public fun product_maker_ecosystem_fee_bps_v6(self: &ItemProductV6): u16 {
    self.maker_ecosystem_fee_bps
}
public fun product_primary_protocol_fee_bps_v6(self: &ItemProductV6): u16 {
    self.primary_protocol_fee_bps
}
public fun product_transferable_v6(self: &ItemProductV6): bool {
    self.transferable
}
public fun product_required_product_ids_v6(
    self: &ItemProductV6,
): &vector<ID> {
    &self.required_product_ids
}
public fun product_excluded_product_ids_v6(
    self: &ItemProductV6,
): &vector<ID> {
    &self.excluded_product_ids
}

fun new_validator_attestation(
    config: &CompositionProtocolConfigV6,
    validator: &ValidatorCapV6,
    profile: &MakerProfileV6,
    product: &ItemProductV6,
    clock: &Clock,
    ctx: &mut TxContext,
): ValidatorAttestationV6 {
    assert_protocol_enabled_v6(config);
    assert!(
        validator.config_id == object::id(config)
            && object::id(validator) == config.validator_cap_id
            && validator.validator_epoch == config.validator_epoch,
        EInvalidValidatorCap,
    );
    assert!(profile.config_id == object::id(config), EProtocolMismatch);
    assert!(product.config_id == object::id(config), EProtocolMismatch);
    assert!(
        &product.slot_schema_commitment == &profile.slot_schema_commitment,
        EInvalidSlot,
    );
    ValidatorAttestationV6 {
        id: object::new(ctx),
        version: VERSION,
        config_id: object::id(config),
        profile_id: object::id(profile),
        product_id: object::id(product),
        definition_commitment: *&product.definition_commitment,
        slot_schema_commitment: *&profile.slot_schema_commitment,
        validator_policy_commitment: *&config.validator_policy_commitment,
        validator_epoch: config.validator_epoch,
        issued_at_ms: clock.timestamp_ms(),
    }
}

public fun publish_validator_attestation_v6(
    config: &CompositionProtocolConfigV6,
    v5_config: &CommerceProtocolConfigV5,
    validator: &ValidatorCapV6,
    profile: &MakerProfileV6,
    product: &ItemProductV6,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert_v6_publication_gate(config, v5_config);
    let attestation = new_validator_attestation(
        config,
        validator,
        profile,
        product,
        clock,
        ctx,
    );
    transfer::freeze_object(attestation);
}

#[test_only]
public fun new_validator_attestation_v6_for_testing(
    config: &CompositionProtocolConfigV6,
    validator: &ValidatorCapV6,
    profile: &MakerProfileV6,
    product: &ItemProductV6,
    clock: &Clock,
    ctx: &mut TxContext,
): ValidatorAttestationV6 {
    new_validator_attestation(config, validator, profile, product, clock, ctx)
}

fun admission_record(
    product: &ItemProductV6,
    source_kind: u8,
    attestation_id: Option<ID>,
    admitted_by: address,
    admitted_at_ms: u64,
): AdmissionRecordV6 {
    AdmissionRecordV6 {
        source_kind,
        attestation_id,
        admitted_by,
        admitted_at_ms,
        definition_commitment: *&product.definition_commitment,
        asset_commitment: *&product.asset_commitment,
        slot_key: *&product.slot_key,
        rights_origin: product.rights_origin,
        access_kind: product.access_kind,
        binding_kind: product.binding_kind,
        price_atomic: product.price_atomic,
        maker_ecosystem_fee_bps: product.maker_ecosystem_fee_bps,
        transferable: product.transferable,
        required_product_ids: *&product.required_product_ids,
        excluded_product_ids: *&product.excluded_product_ids,
        publisher: product.publisher,
        active: true,
    }
}

fun add_admission(
    config: &CompositionProtocolConfigV6,
    profile: &mut MakerProfileV6,
    product: &ItemProductV6,
    source_kind: u8,
    attestation_id: Option<ID>,
    clock: &Clock,
    ctx: &TxContext,
) {
    assert_protocol_enabled_v6(config);
    assert!(profile.config_id == object::id(config), EProtocolMismatch);
    assert!(profile.sealed, EProfileNotSealed);
    assert!(product.config_id == profile.config_id, EProtocolMismatch);
    assert!(source_kind == product.origin_kind, EProductOriginMismatch);
    assert!(
        &product.slot_schema_commitment == &profile.slot_schema_commitment,
        EInvalidSlot,
    );
    let product_id = object::id(product);
    assert!(!profile.admissions.contains(product_id), EAdmissionExists);
    assert_rule_targets_admitted(profile, product);
    let record = admission_record(
        product,
        source_kind,
        attestation_id,
        ctx.sender(),
        clock.timestamp_ms(),
    );
    profile.admissions.add(product_id, record);
    profile.admission_count = profile.admission_count + 1;
    event::emit(ItemAdmittedV6 {
        profile_id: object::id(profile),
        product_id,
        source_kind,
        attestation_id,
        admitted_by: ctx.sender(),
    });
}

public fun admit_official_item_v6(
    profile: &mut MakerProfileV6,
    product: &ItemProductV6,
    attestation: &ValidatorAttestationV6,
    root: &MakerRootV5,
    cap: &MakerControlCapV5,
    config: &CompositionProtocolConfigV6,
    v5_config: &CommerceProtocolConfigV5,
    clock: &Clock,
    ctx: &TxContext,
) {
    assert_v6_publication_gate(config, v5_config);
    commerce::assert_extension_control_v5(root, cap, ctx);
    assert_profile_link(config, profile, root);
    assert!(product.origin_kind == ORIGIN_OFFICIAL, EProductOriginMismatch);
    assert!(product.source_root_id.is_some(), EOfficialSourceMismatch);
    assert!(
        *product.source_root_id.borrow() == profile.root_id,
        EOfficialSourceMismatch,
    );
    assert_attestation(config, profile, product, attestation);
    add_admission(
        config,
        profile,
        product,
        ADMISSION_OFFICIAL,
        option::some(object::id(attestation)),
        clock,
        ctx,
    );
}

public fun admit_certified_item_v6(
    profile: &mut MakerProfileV6,
    product: &ItemProductV6,
    attestation: &ValidatorAttestationV6,
    root: &MakerRootV5,
    cap: &MakerControlCapV5,
    config: &CompositionProtocolConfigV6,
    v5_config: &CommerceProtocolConfigV5,
    clock: &Clock,
    ctx: &TxContext,
) {
    assert_v6_publication_gate(config, v5_config);
    commerce::assert_extension_control_v5(root, cap, ctx);
    assert_profile_link(config, profile, root);
    assert!(product.origin_kind == ORIGIN_CERTIFIED, EProductOriginMismatch);
    assert!(
        profile.third_party_policy >= THIRD_PARTY_CERTIFIED,
        EAdmissionPolicyMismatch,
    );
    assert!(product.source_root_id.is_none(), EExternalSourceRequired);
    assert_attestation(config, profile, product, attestation);
    add_admission(
        config,
        profile,
        product,
        ADMISSION_CERTIFIED,
        option::some(object::id(attestation)),
        clock,
        ctx,
    );
}

/// Permissionless at the Maker endorsement layer, but never unvalidated.
public fun admit_open_item_v6(
    profile: &mut MakerProfileV6,
    product: &ItemProductV6,
    attestation: &ValidatorAttestationV6,
    config: &CompositionProtocolConfigV6,
    v5_config: &CommerceProtocolConfigV5,
    clock: &Clock,
    ctx: &TxContext,
) {
    assert_v6_publication_gate(config, v5_config);
    assert!(profile.config_id == object::id(config), EProtocolMismatch);
    assert!(product.origin_kind == ORIGIN_OPEN, EProductOriginMismatch);
    assert!(profile.third_party_policy == THIRD_PARTY_OPEN, EAdmissionPolicyMismatch);
    assert!(product.source_root_id.is_none(), EExternalSourceRequired);
    assert_attestation(config, profile, product, attestation);
    add_admission(
        config,
        profile,
        product,
        ADMISSION_OPEN,
        option::some(object::id(attestation)),
        clock,
        ctx,
    );
}

public fun item_is_admitted_v6(
    profile: &MakerProfileV6,
    product_id: ID,
): bool {
    profile.admissions.contains(product_id)
}

public fun admission_active_v6(
    profile: &MakerProfileV6,
    product_id: ID,
): bool {
    assert!(profile.admissions.contains(product_id), EAdmissionMissing);
    profile.admissions.borrow(product_id).active
}

/// Emergency, per-product stop. It remains callable while either release
/// gate is disabled so governance can contain a bad asset without reopening
/// publication or player writes.
public fun deactivate_item_admission_v6(
    profile: &mut MakerProfileV6,
    product_id: ID,
    config: &CompositionProtocolConfigV6,
    v5_config: &CommerceProtocolConfigV5,
    v5_admin: &ProtocolFeeAdminCap,
    admin: &CompositionAdminCapV6,
    ctx: &TxContext,
) {
    assert_protocol_link(config, v5_config);
    commerce::assert_extension_protocol_admin_v5(v5_config, v5_admin);
    assert_admin(config, admin);
    assert!(profile.config_id == object::id(config), EProtocolMismatch);
    assert!(profile.admissions.contains(product_id), EAdmissionMissing);
    let admission = profile.admissions.borrow_mut(product_id);
    assert!(admission.active, EAdmissionInactive);
    admission.active = false;
    event::emit(ItemAdmissionStatusChangedV6 {
        profile_id: object::id(profile),
        product_id,
        active: false,
        changed_by: ctx.sender(),
    });
}

/// Re-enabling is stricter than disabling: both protocol gates must be live,
/// and a fresh attestation under the current validator epoch must be supplied.
public fun reactivate_item_admission_v6(
    profile: &mut MakerProfileV6,
    product: &ItemProductV6,
    attestation: &ValidatorAttestationV6,
    config: &CompositionProtocolConfigV6,
    v5_config: &CommerceProtocolConfigV5,
    v5_admin: &ProtocolFeeAdminCap,
    admin: &CompositionAdminCapV6,
    ctx: &TxContext,
) {
    assert_v6_publication_gate(config, v5_config);
    commerce::assert_extension_protocol_admin_v5(v5_config, v5_admin);
    assert_admin(config, admin);
    assert!(profile.config_id == object::id(config), EProtocolMismatch);
    let product_id = object::id(product);
    assert!(profile.admissions.contains(product_id), EAdmissionMissing);
    assert_attestation(config, profile, product, attestation);
    let admission = profile.admissions.borrow_mut(product_id);
    assert!(!admission.active, EAdmissionExists);
    assert_admission_matches_product(admission, product);
    admission.attestation_id = option::some(object::id(attestation));
    admission.active = true;
    event::emit(ItemAdmissionStatusChangedV6 {
        profile_id: object::id(profile),
        product_id,
        active: true,
        changed_by: ctx.sender(),
    });
}

public fun admission_source_kind_v6(
    profile: &MakerProfileV6,
    product_id: ID,
): u8 {
    assert!(profile.admissions.contains(product_id), EAdmissionMissing);
    profile.admissions.borrow(product_id).source_kind
}

fun create_owned_item(
    config: &CompositionProtocolConfigV6,
    profile: &MakerProfileV6,
    product: &ItemProductV6,
    holder: address,
    ctx: &mut TxContext,
): OwnedItemV6 {
    OwnedItemV6 {
        id: object::new(ctx),
        version: VERSION,
        config_id: object::id(config),
        profile_id: object::id(profile),
        product_id: object::id(product),
        holder,
        transferable: product.transferable,
        locked_soul: option::none(),
        ownership_epoch: 0,
    }
}

fun grant_wallet_entitlement_internal(
    registry: &mut CompositionRegistryV6,
    config: &CompositionProtocolConfigV6,
    profile: &MakerProfileV6,
    product: &ItemProductV6,
    paid_atomic: u64,
    clock: &Clock,
    ctx: &mut TxContext,
): Option<OwnedItemV6> {
    let wallet = ctx.sender();
    let key = WalletEntitlementKeyV6 {
        profile_id: object::id(profile),
        product_id: object::id(product),
        wallet,
    };
    assert!(!registry.wallet_entitlements.contains(key), EEntitlementExists);
    let owned = if (product.binding_kind == BINDING_OWNED) {
        assert!(profile.item_assetization, EInvalidBinding);
        option::some(create_owned_item(config, profile, product, wallet, ctx))
    } else {
        option::none()
    };
    let owned_instance_id = if (owned.is_some()) {
        option::some(object::id(owned.borrow()))
    } else {
        option::none()
    };
    registry.wallet_entitlements.add(key, EntitlementRecordV6 {
        purchaser: wallet,
        granted_at_ms: clock.timestamp_ms(),
        paid_atomic,
        owned_instance_id,
    });
    event::emit(EntitlementGrantedV6 {
        profile_id: object::id(profile),
        product_id: object::id(product),
        subject_kind: SUBJECT_WALLET,
        wallet,
        soul_id: option::none(),
        paid_atomic,
        owned_instance_id,
    });
    owned
}

fun grant_soul_entitlement_internal<Proof: drop>(
    registry: &mut CompositionRegistryV6,
    config: &CompositionProtocolConfigV6,
    profile: &MakerProfileV6,
    product: &ItemProductV6,
    soul_id: ID,
    paid_atomic: u64,
    _proof: Proof,
    clock: &Clock,
    ctx: &TxContext,
) {
    assert_soul_owner_proof_type<Proof>(config);
    assert!(soul_id.to_address() != @0x0, EInvalidSoulId);
    let key = SoulEntitlementKeyV6 {
        profile_id: object::id(profile),
        product_id: object::id(product),
        soul_id,
    };
    assert!(!registry.soul_entitlements.contains(key), EEntitlementExists);
    registry.soul_entitlements.add(key, EntitlementRecordV6 {
        purchaser: ctx.sender(),
        granted_at_ms: clock.timestamp_ms(),
        paid_atomic,
        owned_instance_id: option::none(),
    });
    event::emit(EntitlementGrantedV6 {
        profile_id: object::id(profile),
        product_id: object::id(product),
        subject_kind: SUBJECT_SOUL,
        wallet: ctx.sender(),
        soul_id: option::some(soul_id),
        paid_atomic,
        owned_instance_id: option::none(),
    });
}

public fun claim_free_wallet_item_v6(
    registry: &mut CompositionRegistryV6,
    config: &CompositionProtocolConfigV6,
    profile: &MakerProfileV6,
    product: &ItemProductV6,
    root: &MakerRootV5,
    v5_config: &CommerceProtocolConfigV5,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert_player_action(registry, config, profile, product, root, v5_config);
    assert!(product.access_kind == ACCESS_FREE, EInvalidAccessKind);
    assert!(
        product.binding_kind == BINDING_ACCOUNT
            || product.binding_kind == BINDING_OWNED,
        EInvalidBinding,
    );
    let owned = grant_wallet_entitlement_internal(
        registry,
        config,
        profile,
        product,
        0,
        clock,
        ctx,
    );
    if (owned.is_some()) {
        transfer::transfer(owned.destroy_some(), ctx.sender());
    } else {
        owned.destroy_none();
    };
}

#[test_only]
public fun claim_free_wallet_item_v6_for_testing(
    registry: &mut CompositionRegistryV6,
    config: &CompositionProtocolConfigV6,
    profile: &MakerProfileV6,
    product: &ItemProductV6,
    root: &MakerRootV5,
    v5_config: &CommerceProtocolConfigV5,
    clock: &Clock,
    ctx: &mut TxContext,
): Option<OwnedItemV6> {
    assert_player_action(registry, config, profile, product, root, v5_config);
    assert!(product.access_kind == ACCESS_FREE, EInvalidAccessKind);
    assert!(
        product.binding_kind == BINDING_ACCOUNT
            || product.binding_kind == BINDING_OWNED,
        EInvalidBinding,
    );
    grant_wallet_entitlement_internal(
        registry,
        config,
        profile,
        product,
        0,
        clock,
        ctx,
    )
}

public fun claim_free_soul_item_v6<Proof: drop>(
    registry: &mut CompositionRegistryV6,
    config: &CompositionProtocolConfigV6,
    profile: &MakerProfileV6,
    product: &ItemProductV6,
    root: &MakerRootV5,
    v5_config: &CommerceProtocolConfigV5,
    soul_id: ID,
    proof: Proof,
    clock: &Clock,
    ctx: &TxContext,
) {
    assert_player_action(registry, config, profile, product, root, v5_config);
    assert!(product.access_kind == ACCESS_FREE, EInvalidAccessKind);
    assert!(product.binding_kind == BINDING_SOUL, EInvalidBinding);
    grant_soul_entitlement_internal(
        registry,
        config,
        profile,
        product,
        soul_id,
        0,
        proof,
        clock,
        ctx,
    );
}

fun split_item_payment<PaymentCoin>(
    config: &CompositionProtocolConfigV6,
    treasury: &mut CompositionProtocolTreasuryV6<PaymentCoin>,
    profile: &MakerProfileV6,
    product: &ItemProductV6,
    root: &MakerRootV5,
    mut payment: Coin<PaymentCoin>,
    ctx: &mut TxContext,
) {
    assert_treasury(config, treasury);
    assert!(
        &payment_coin_type_name<PaymentCoin>() == &config.payment_coin_type,
        EPaymentCoinMismatch,
    );
    assert!(coin::value(&payment) == product.price_atomic, EWrongPayment);
    let protocol_amount = bps_amount(
        product.price_atomic,
        product.primary_protocol_fee_bps,
    );
    let maker_ecosystem_amount = bps_amount(
        product.price_atomic,
        product.maker_ecosystem_fee_bps,
    );
    if (protocol_amount > 0) {
        let protocol_coin = coin::split(&mut payment, protocol_amount, ctx);
        coin::put(&mut treasury.revenue, protocol_coin);
    };
    treasury.total_collected = treasury.total_collected + protocol_amount;
    if (maker_ecosystem_amount > 0) {
        let maker_coin = coin::split(&mut payment, maker_ecosystem_amount, ctx);
        transfer::public_transfer(
            maker_coin,
            commerce::root_current_owner_v5(root),
        );
    };
    let recipient = if (product.source_root_id.is_some()) {
        assert!(
            *product.source_root_id.borrow() == profile.root_id,
            EOfficialSourceMismatch,
        );
        commerce::root_current_owner_v5(root)
    } else {
        product.publisher
    };
    transfer::public_transfer(payment, recipient);
}

public fun purchase_wallet_item_v6<PaymentCoin>(
    registry: &mut CompositionRegistryV6,
    config: &CompositionProtocolConfigV6,
    treasury: &mut CompositionProtocolTreasuryV6<PaymentCoin>,
    profile: &MakerProfileV6,
    product: &ItemProductV6,
    root: &MakerRootV5,
    v5_config: &CommerceProtocolConfigV5,
    payment: Coin<PaymentCoin>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert_player_action(registry, config, profile, product, root, v5_config);
    assert!(product.access_kind == ACCESS_PAID, EInvalidAccessKind);
    assert!(
        product.binding_kind == BINDING_ACCOUNT
            || product.binding_kind == BINDING_OWNED,
        EInvalidBinding,
    );
    let paid_atomic = coin::value(&payment);
    split_item_payment(config, treasury, profile, product, root, payment, ctx);
    let owned = grant_wallet_entitlement_internal(
        registry,
        config,
        profile,
        product,
        paid_atomic,
        clock,
        ctx,
    );
    if (owned.is_some()) {
        transfer::transfer(owned.destroy_some(), ctx.sender());
    } else {
        owned.destroy_none();
    };
}

/// Atomic bridge used by the physical v7 companion package. It preserves
/// the exact v6 admission, entitlement and 90/10+Maker settlement semantics,
/// but returns the newly-created key-only receipt so v7 can retire it and mint
/// the concrete StyleAsset in the same transaction. Calling it directly never
/// bypasses admission or ownership and only yields the same non-droppable v6
/// receipt that the existing public claim path transfers to the player.
public fun claim_free_owned_item_for_physical_v7(
    registry: &mut CompositionRegistryV6,
    config: &CompositionProtocolConfigV6,
    profile: &MakerProfileV6,
    product: &ItemProductV6,
    root: &MakerRootV5,
    v5_config: &CommerceProtocolConfigV5,
    clock: &Clock,
    ctx: &mut TxContext,
): OwnedItemV6 {
    assert_player_action(registry, config, profile, product, root, v5_config);
    assert!(product.access_kind == ACCESS_FREE, EInvalidAccessKind);
    assert!(product.binding_kind == BINDING_OWNED, EInvalidBinding);
    grant_wallet_entitlement_internal(
        registry,
        config,
        profile,
        product,
        0,
        clock,
        ctx,
    ).destroy_some()
}

public fun purchase_owned_item_for_physical_v7<PaymentCoin>(
    registry: &mut CompositionRegistryV6,
    config: &CompositionProtocolConfigV6,
    treasury: &mut CompositionProtocolTreasuryV6<PaymentCoin>,
    profile: &MakerProfileV6,
    product: &ItemProductV6,
    root: &MakerRootV5,
    v5_config: &CommerceProtocolConfigV5,
    payment: Coin<PaymentCoin>,
    clock: &Clock,
    ctx: &mut TxContext,
): OwnedItemV6 {
    assert_player_action(registry, config, profile, product, root, v5_config);
    assert!(product.access_kind == ACCESS_PAID, EInvalidAccessKind);
    assert!(product.binding_kind == BINDING_OWNED, EInvalidBinding);
    let paid_atomic = coin::value(&payment);
    split_item_payment(config, treasury, profile, product, root, payment, ctx);
    grant_wallet_entitlement_internal(
        registry,
        config,
        profile,
        product,
        paid_atomic,
        clock,
        ctx,
    ).destroy_some()
}

/// Retire one legacy v6 OwnedItem after transferring its economic entitlement
/// into the concrete v7 StyleAsset. This bridge is intentionally available
/// while a Maker is paused/archived so an already-owned receipt cannot become
/// trapped during an upgrade. It does not grant a new entitlement or perform a
/// sale.
public fun consume_owned_item_for_physical_v7(
    registry: &mut CompositionRegistryV6,
    config: &CompositionProtocolConfigV6,
    profile: &MakerProfileV6,
    item: OwnedItemV6,
    ctx: &TxContext,
): (ID, address, bool, u64) {
    assert_registry(config, registry);
    assert!(profile.config_id == object::id(config), EProtocolMismatch);
    assert!(item.config_id == object::id(config), EOwnedItemMismatch);
    assert!(item.profile_id == object::id(profile), EOwnedItemMismatch);
    assert!(item.holder == ctx.sender(), ENotOwnedItemHolder);
    assert!(item.locked_soul.is_none(), EOwnedItemAlreadyLocked);
    let instance_id = object::id(&item);
    assert!(!registry.owned_locks.contains(instance_id), EOwnedItemAlreadyLocked);
    let key = WalletEntitlementKeyV6 {
        profile_id: item.profile_id,
        product_id: item.product_id,
        wallet: item.holder,
    };
    assert!(registry.wallet_entitlements.contains(key), EEntitlementMissing);
    let record = registry.wallet_entitlements.remove(key);
    assert!(record.owned_instance_id.is_some(), EOwnedInstanceRequired);
    assert!(*record.owned_instance_id.borrow() == instance_id, EOwnedItemMismatch);
    let OwnedItemV6 {
        id,
        version: _,
        config_id: _,
        profile_id: _,
        product_id,
        holder,
        transferable,
        locked_soul: _,
        ownership_epoch,
    } = item;
    id.delete();
    (product_id, holder, transferable, ownership_epoch)
}

public fun purchase_soul_item_v6<PaymentCoin, Proof: drop>(
    registry: &mut CompositionRegistryV6,
    config: &CompositionProtocolConfigV6,
    treasury: &mut CompositionProtocolTreasuryV6<PaymentCoin>,
    profile: &MakerProfileV6,
    product: &ItemProductV6,
    root: &MakerRootV5,
    v5_config: &CommerceProtocolConfigV5,
    soul_id: ID,
    proof: Proof,
    payment: Coin<PaymentCoin>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert_player_action(registry, config, profile, product, root, v5_config);
    assert!(product.access_kind == ACCESS_PAID, EInvalidAccessKind);
    assert!(product.binding_kind == BINDING_SOUL, EInvalidBinding);
    let paid_atomic = coin::value(&payment);
    split_item_payment(config, treasury, profile, product, root, payment, ctx);
    grant_soul_entitlement_internal(
        registry,
        config,
        profile,
        product,
        soul_id,
        paid_atomic,
        proof,
        clock,
        ctx,
    );
}

public fun wallet_entitlement_exists_v6(
    registry: &CompositionRegistryV6,
    profile_id: ID,
    product_id: ID,
    wallet: address,
): bool {
    registry.wallet_entitlements.contains(WalletEntitlementKeyV6 {
        profile_id,
        product_id,
        wallet,
    })
}

public fun soul_entitlement_exists_v6(
    registry: &CompositionRegistryV6,
    profile_id: ID,
    product_id: ID,
    soul_id: ID,
): bool {
    registry.soul_entitlements.contains(SoulEntitlementKeyV6 {
        profile_id,
        product_id,
        soul_id,
    })
}

public fun owned_item_id_v6(self: &OwnedItemV6): ID { object::id(self) }
public fun owned_item_holder_v6(self: &OwnedItemV6): address { self.holder }
public fun owned_item_product_id_v6(self: &OwnedItemV6): ID { self.product_id }
public fun owned_item_transferable_v6(self: &OwnedItemV6): bool {
    self.transferable
}
public fun owned_item_ownership_epoch_v6(self: &OwnedItemV6): u64 {
    self.ownership_epoch
}
public fun owned_item_locked_soul_v6(self: &OwnedItemV6): Option<ID> {
    self.locked_soul
}

/// Owned instances can move independently only while unequipped. The exact
/// wallet entitlement key is rotated atomically with custody.
public fun transfer_owned_item_v6(
    registry: &mut CompositionRegistryV6,
    config: &CompositionProtocolConfigV6,
    profile: &MakerProfileV6,
    root: &MakerRootV5,
    v5_config: &CommerceProtocolConfigV5,
    mut item: OwnedItemV6,
    recipient: address,
    ctx: &TxContext,
) {
    assert_v6_operational(config, profile, root, v5_config);
    assert_registry(config, registry);
    assert!(recipient != @0x0 && recipient != ctx.sender(), EInvalidRecipient);
    assert!(item.config_id == object::id(config), EOwnedItemMismatch);
    assert!(item.profile_id == object::id(profile), EOwnedItemMismatch);
    assert!(item.holder == ctx.sender(), ENotOwnedItemHolder);
    assert!(item.transferable, EItemNotTransferable);
    assert!(item.locked_soul.is_none(), EOwnedItemAlreadyLocked);
    let instance_id = object::id(&item);
    assert!(!registry.owned_locks.contains(instance_id), EOwnedItemAlreadyLocked);
    let old_key = WalletEntitlementKeyV6 {
        profile_id: item.profile_id,
        product_id: item.product_id,
        wallet: item.holder,
    };
    assert!(registry.wallet_entitlements.contains(old_key), EEntitlementMissing);
    let new_key = WalletEntitlementKeyV6 {
        profile_id: item.profile_id,
        product_id: item.product_id,
        wallet: recipient,
    };
    assert!(
        !registry.wallet_entitlements.contains(new_key),
        ERecipientAlreadyEntitled,
    );
    let record = registry.wallet_entitlements.remove(old_key);
    assert!(record.owned_instance_id.is_some(), EOwnedInstanceRequired);
    assert!(*record.owned_instance_id.borrow() == instance_id, EOwnedItemMismatch);
    registry.wallet_entitlements.add(new_key, record);
    item.holder = recipient;
    item.ownership_epoch = item.ownership_epoch + 1;
    transfer::transfer(item, recipient);
}

public fun lock_owned_item_to_soul_v6<Proof: drop>(
    registry: &mut CompositionRegistryV6,
    config: &CompositionProtocolConfigV6,
    profile: &MakerProfileV6,
    root: &MakerRootV5,
    v5_config: &CommerceProtocolConfigV5,
    item: &mut OwnedItemV6,
    soul_id: ID,
    _proof: Proof,
    ctx: &TxContext,
) {
    assert_v6_operational(config, profile, root, v5_config);
    assert_registry(config, registry);
    assert_soul_owner_proof_type<Proof>(config);
    assert!(soul_id.to_address() != @0x0, EInvalidSoulId);
    assert!(item.config_id == object::id(config), EOwnedItemMismatch);
    assert!(item.profile_id == object::id(profile), EOwnedItemMismatch);
    assert!(item.holder == ctx.sender(), ENotOwnedItemHolder);
    assert!(item.locked_soul.is_none(), EOwnedItemAlreadyLocked);
    let instance_id = object::id(item);
    assert!(!registry.owned_locks.contains(instance_id), EOwnedItemAlreadyLocked);
    item.locked_soul = option::some(soul_id);
    registry.owned_locks.add(instance_id, OwnedLockRecordV6 {
        profile_id: item.profile_id,
        product_id: item.product_id,
        holder: item.holder,
        soul_id,
        ownership_epoch: item.ownership_epoch,
    });
    increment_soul_owned_lock_count(registry, soul_id);
    event::emit(OwnedItemLockChangedV6 {
        instance_id,
        profile_id: item.profile_id,
        product_id: item.product_id,
        holder: item.holder,
        soul_id,
        locked: true,
    });
}

public fun unlock_owned_item_from_soul_v6<Proof: drop>(
    registry: &mut CompositionRegistryV6,
    config: &CompositionProtocolConfigV6,
    profile: &MakerProfileV6,
    root: &MakerRootV5,
    v5_config: &CommerceProtocolConfigV5,
    item: &mut OwnedItemV6,
    soul_id: ID,
    _proof: Proof,
    ctx: &TxContext,
) {
    // Recovery must remain available while either protocol gate is paused or
    // the Maker lifecycle is no longer Active.  Only new locks and player
    // mutations are gated.  Keep every identity/linkage check so an emergency
    // pause cannot be used to unlock a different Item, Profile or Soul.
    assert_protocol_link(config, v5_config);
    assert_profile_link(config, profile, root);
    assert_registry(config, registry);
    assert_soul_owner_proof_type<Proof>(config);
    assert!(soul_id.to_address() != @0x0, EInvalidSoulId);
    assert!(item.config_id == object::id(config), EOwnedItemMismatch);
    assert!(item.profile_id == object::id(profile), EOwnedItemMismatch);
    assert!(item.holder == ctx.sender(), ENotOwnedItemHolder);
    assert!(item.locked_soul.is_some(), EOwnedItemNotLocked);
    assert!(*item.locked_soul.borrow() == soul_id, EOwnedItemWrongSoul);
    let instance_id = object::id(item);
    assert!(registry.owned_locks.contains(instance_id), EOwnedItemNotLocked);
    let record = registry.owned_locks.remove(instance_id);
    assert!(
        record.profile_id == item.profile_id
            && record.product_id == item.product_id
            && record.holder == item.holder
            && record.ownership_epoch == item.ownership_epoch,
        EOwnedItemMismatch,
    );
    assert!(record.soul_id == soul_id, EOwnedItemWrongSoul);
    decrement_soul_owned_lock_count(registry, soul_id);
    item.locked_soul = option::none();
    event::emit(OwnedItemLockChangedV6 {
        instance_id,
        profile_id: item.profile_id,
        product_id: item.product_id,
        holder: item.holder,
        soul_id,
        locked: false,
    });
}

public fun new_loadout_selection_v6(
    product_id: ID,
    slot_key: String,
    subject_kind: u8,
    owned_instance_id: Option<ID>,
): LoadoutSelectionV6 {
    assert_non_empty(&slot_key);
    assert!(
        subject_kind == SUBJECT_WALLET
            || subject_kind == SUBJECT_SOUL
            || subject_kind == SUBJECT_EMBEDDED,
        EInvalidSubject,
    );
    if (subject_kind == SUBJECT_SOUL || subject_kind == SUBJECT_EMBEDDED) {
        assert!(owned_instance_id.is_none(), EOwnedInstanceForbidden);
    };
    LoadoutSelectionV6 {
        product_id,
        slot_key,
        subject_kind,
        owned_instance_id,
    }
}

public fun loadout_selection_product_id_v6(
    self: &LoadoutSelectionV6,
): ID { self.product_id }
public fun loadout_selection_slot_key_v6(
    self: &LoadoutSelectionV6,
): &String { &self.slot_key }
public fun loadout_selection_subject_kind_v6(
    self: &LoadoutSelectionV6,
): u8 { self.subject_kind }
public fun loadout_selection_owned_instance_id_v6(
    self: &LoadoutSelectionV6,
): Option<ID> { self.owned_instance_id }

public fun hash_loadout_selections_v6(
    selections: &vector<LoadoutSelectionV6>,
): vector<u8> {
    hash::sha2_256(bcs::to_bytes(&LoadoutHashInputV6 {
        selections: *selections,
    }))
}

/// Revalidate one exact transferable appearance immediately before a
/// secondary-market listing or settlement.  The caller supplies the
/// canonical selections whose BCS hash is already pinned by Soulidity's
/// appearance companion.  This check deliberately performs no write and
/// consumes no nonce, so it can safely run both when listing and when buying.
///
/// Wallet/account and Owned Item selections are never transferable with the
/// Soul.  A removed Owned Item can still be locked to the Soul, so the
/// Registry's per-Soul active-lock count must also be zero.
public fun assert_secondary_market_loadout_v6(
    registry: &CompositionRegistryV6,
    config: &CompositionProtocolConfigV6,
    profile: &MakerProfileV6,
    root: &MakerRootV5,
    v5_config: &CommerceProtocolConfigV5,
    soul_id: ID,
    expected_loadout_hash: &vector<u8>,
    selections: &vector<LoadoutSelectionV6>,
) {
    // A Maker pause/archive stops new primary authorizations, not an owner's
    // ability to sell an already-authorized transferable Soul.  Global v5/v6
    // emergency gates remain fail-closed, while immutable linkage, admissions
    // and rules are revalidated below.
    assert_protocol_enabled_v6(config);
    assert_protocol_link(config, v5_config);
    assert_profile_link(config, profile, root);
    commerce::assert_extension_protocol_enabled_v5(v5_config);
    assert_registry(config, registry);
    assert!(profile.sealed, EProfileNotSealed);
    assert!(soul_id.to_address() != @0x0, EInvalidSoulId);
    assert!(selections.length() > 0, EEmptyLoadout);
    assert!(expected_loadout_hash.length() == HASH_LENGTH, EInvalidLoadoutHash);
    assert!(
        expected_loadout_hash == &hash_loadout_selections_v6(selections),
        EInvalidLoadoutHash,
    );
    assert!(
        soul_owned_lock_count_v6(registry, soul_id) == 0,
        EActiveSoulOwnedLocks,
    );

    let mut index = 0;
    while (index < selections.length()) {
        let selection = &selections[index];
        assert_unique_slot(selections, index);
        assert!(
            selection.subject_kind == SUBJECT_SOUL
                || selection.subject_kind == SUBJECT_EMBEDDED,
            ESecondaryLoadoutUnsafe,
        );
        assert!(
            selection.owned_instance_id.is_none(),
            ESecondaryLoadoutUnsafe,
        );
        // The authorizer is intentionally irrelevant here: transferable
        // selections are either embedded or entitled to this exact Soul.
        assert_selection(registry, profile, soul_id, @0x0, selection);
        index = index + 1;
    };
    assert_loadout_rules(profile, selections);
}

public fun soul_owned_lock_count_v6(
    registry: &CompositionRegistryV6,
    soul_id: ID,
): u64 {
    if (registry.soul_owned_lock_counts.contains(soul_id)) {
        *registry.soul_owned_lock_counts.borrow(soul_id)
    } else {
        0
    }
}

/// One-shot authorization for a Soulidity loadout write. The generic proof's
/// defining type is protocol-bound; its constructor remains private to the
/// Soulidity wrapper that verifies the exact Soul and current owner.
public fun authorize_loadout_v6<Proof: drop>(
    registry: &mut CompositionRegistryV6,
    config: &CompositionProtocolConfigV6,
    profile: &MakerProfileV6,
    root: &MakerRootV5,
    v5_config: &CommerceProtocolConfigV5,
    soul_id: ID,
    client_nonce: vector<u8>,
    loadout_hash: vector<u8>,
    selections: vector<LoadoutSelectionV6>,
    _proof: Proof,
    ctx: &TxContext,
): LoadoutAuthorizationV6 {
    assert_v6_operational(config, profile, root, v5_config);
    assert_registry(config, registry);
    assert_soul_owner_proof_type<Proof>(config);
    assert!(profile.sealed, EProfileNotSealed);
    assert!(profile.mode == PROFILE_COMPOSABLE, EProfileNotComposable);
    assert!(profile.loadout_mutable, ELoadoutMutationDisabled);
    assert!(soul_id.to_address() != @0x0, EInvalidSoulId);
    assert!(client_nonce.length() == HASH_LENGTH, EInvalidNonce);
    assert!(selections.length() > 0, EEmptyLoadout);
    assert!(loadout_hash.length() == HASH_LENGTH, EInvalidLoadoutHash);
    assert!(
        loadout_hash == hash_loadout_selections_v6(&selections),
        EInvalidLoadoutHash,
    );
    let nonce_key = LoadoutNonceKeyV6 {
        profile_id: object::id(profile),
        soul_id,
        client_nonce: copy client_nonce,
    };
    assert!(!registry.used_nonces.contains(nonce_key), ENonceAlreadyUsed);

    let mut wallet_bound_count = 0;
    let mut index = 0;
    while (index < selections.length()) {
        let selection = &selections[index];
        assert_unique_slot(&selections, index);
        assert_selection(
            registry,
            profile,
            soul_id,
            ctx.sender(),
            selection,
        );
        if (selection.subject_kind == SUBJECT_WALLET) {
            wallet_bound_count = wallet_bound_count + 1;
        };
        index = index + 1;
    };
    assert_loadout_rules(profile, &selections);
    registry.used_nonces.add(nonce_key, true);
    event::emit(LoadoutAuthorizedV6 {
        profile_id: object::id(profile),
        root_id: profile.root_id,
        soul_id,
        authorizer: ctx.sender(),
        client_nonce: copy client_nonce,
        loadout_hash: copy loadout_hash,
        wallet_bound_count,
        authorization_kind: AUTH_UPDATE,
    });
    LoadoutAuthorizationV6 {
        profile_id: object::id(profile),
        root_id: profile.root_id,
        soul_id,
        authorizer: ctx.sender(),
        client_nonce,
        loadout_hash,
        slot_schema_commitment: *&profile.slot_schema_commitment,
        selections,
        wallet_bound_count,
        version: VERSION,
    }
}

public fun loadout_authorization_wallet_bound_count_v6(
    self: &LoadoutAuthorizationV6,
): u64 {
    self.wallet_bound_count
}

public fun assert_soul_transferable_v6(wallet_bound_count: u64) {
    assert!(wallet_bound_count == 0, EOwnedItemWrongSoul);
}

public fun consume_loadout_authorization_v6(
    authorization: LoadoutAuthorizationV6,
): (
    ID,
    ID,
    ID,
    address,
    vector<u8>,
    vector<u8>,
    vector<u8>,
    vector<LoadoutSelectionV6>,
    u64,
    u64,
) {
    let LoadoutAuthorizationV6 {
        profile_id,
        root_id,
        soul_id,
        authorizer,
        client_nonce,
        loadout_hash,
        slot_schema_commitment,
        selections,
        wallet_bound_count,
        version,
    } = authorization;
    (
        profile_id,
        root_id,
        soul_id,
        authorizer,
        client_nonce,
        loadout_hash,
        slot_schema_commitment,
        selections,
        wallet_bound_count,
        version,
    )
}

/// Initial Genesis/current binding for either profile mode. The returned type
/// is intentionally not accepted by the update adapter in Soulidity.
public fun authorize_initial_loadout_v6<Proof: drop>(
    registry: &mut CompositionRegistryV6,
    config: &CompositionProtocolConfigV6,
    profile: &MakerProfileV6,
    root: &MakerRootV5,
    v5_config: &CommerceProtocolConfigV5,
    soul_id: ID,
    client_nonce: vector<u8>,
    loadout_hash: vector<u8>,
    selections: vector<LoadoutSelectionV6>,
    _proof: Proof,
    ctx: &TxContext,
): InitialLoadoutAuthorizationV6 {
    assert_v6_operational(config, profile, root, v5_config);
    assert_registry(config, registry);
    assert_soul_owner_proof_type<Proof>(config);
    assert!(profile.sealed, EProfileNotSealed);
    assert!(soul_id.to_address() != @0x0, EInvalidSoulId);
    assert!(client_nonce.length() == HASH_LENGTH, EInvalidNonce);
    assert!(selections.length() > 0, EEmptyLoadout);
    assert!(loadout_hash.length() == HASH_LENGTH, EInvalidLoadoutHash);
    assert!(
        loadout_hash == hash_loadout_selections_v6(&selections),
        EInvalidLoadoutHash,
    );
    let nonce_key = LoadoutNonceKeyV6 {
        profile_id: object::id(profile),
        soul_id,
        client_nonce: copy client_nonce,
    };
    assert!(!registry.used_nonces.contains(nonce_key), ENonceAlreadyUsed);

    let mut wallet_bound_count = 0;
    let mut index = 0;
    while (index < selections.length()) {
        let selection = &selections[index];
        assert_unique_slot(&selections, index);
        assert_selection(
            registry,
            profile,
            soul_id,
            ctx.sender(),
            selection,
        );
        if (selection.subject_kind == SUBJECT_WALLET) {
            wallet_bound_count = wallet_bound_count + 1;
        };
        index = index + 1;
    };
    assert_loadout_rules(profile, &selections);
    registry.used_nonces.add(nonce_key, true);
    event::emit(LoadoutAuthorizedV6 {
        profile_id: object::id(profile),
        root_id: profile.root_id,
        soul_id,
        authorizer: ctx.sender(),
        client_nonce: copy client_nonce,
        loadout_hash: copy loadout_hash,
        wallet_bound_count,
        authorization_kind: AUTH_INITIAL,
    });
    InitialLoadoutAuthorizationV6 {
        profile_id: object::id(profile),
        root_id: profile.root_id,
        soul_id,
        authorizer: ctx.sender(),
        client_nonce,
        loadout_hash,
        slot_schema_commitment: *&profile.slot_schema_commitment,
        selections,
        wallet_bound_count,
        version: VERSION,
    }
}

public fun initial_loadout_authorization_wallet_bound_count_v6(
    self: &InitialLoadoutAuthorizationV6,
): u64 {
    self.wallet_bound_count
}

public fun consume_initial_loadout_authorization_v6(
    authorization: InitialLoadoutAuthorizationV6,
): (
    ID,
    ID,
    ID,
    address,
    vector<u8>,
    vector<u8>,
    vector<u8>,
    vector<LoadoutSelectionV6>,
    u64,
    u64,
) {
    let InitialLoadoutAuthorizationV6 {
        profile_id,
        root_id,
        soul_id,
        authorizer,
        client_nonce,
        loadout_hash,
        slot_schema_commitment,
        selections,
        wallet_bound_count,
        version,
    } = authorization;
    (
        profile_id,
        root_id,
        soul_id,
        authorizer,
        client_nonce,
        loadout_hash,
        slot_schema_commitment,
        selections,
        wallet_bound_count,
        version,
    )
}

fun assert_selection(
    registry: &CompositionRegistryV6,
    profile: &MakerProfileV6,
    soul_id: ID,
    authorizer: address,
    selection: &LoadoutSelectionV6,
) {
    assert!(
        profile.admissions.contains(selection.product_id),
        EAdmissionMissing,
    );
    let admission = profile.admissions.borrow(selection.product_id);
    assert!(admission.active, EAdmissionInactive);
    assert!(&admission.slot_key == &selection.slot_key, EInvalidSlot);
    if (admission.binding_kind == BINDING_EMBEDDED) {
        assert!(selection.subject_kind == SUBJECT_EMBEDDED, EInvalidSubject);
        assert!(selection.owned_instance_id.is_none(), EOwnedInstanceForbidden);
    } else if (admission.binding_kind == BINDING_ACCOUNT) {
        assert!(selection.subject_kind == SUBJECT_WALLET, EInvalidSubject);
        assert!(selection.owned_instance_id.is_none(), EOwnedInstanceForbidden);
        let entitlement_key = WalletEntitlementKeyV6 {
            profile_id: object::id(profile),
            product_id: selection.product_id,
            wallet: authorizer,
        };
        assert!(
            registry.wallet_entitlements.contains(entitlement_key),
            EEntitlementMissing,
        );
        let entitlement = registry.wallet_entitlements.borrow(entitlement_key);
        assert!(entitlement.owned_instance_id.is_none(), EOwnedInstanceForbidden);
    } else if (admission.binding_kind == BINDING_SOUL) {
        assert!(selection.subject_kind == SUBJECT_SOUL, EInvalidSubject);
        assert!(selection.owned_instance_id.is_none(), EOwnedInstanceForbidden);
        let entitlement_key = SoulEntitlementKeyV6 {
            profile_id: object::id(profile),
            product_id: selection.product_id,
            soul_id,
        };
        assert!(
            registry.soul_entitlements.contains(entitlement_key),
            EEntitlementMissing,
        );
        assert!(
            registry.soul_entitlements.borrow(entitlement_key)
                .owned_instance_id.is_none(),
            EOwnedInstanceForbidden,
        );
    } else if (admission.binding_kind == BINDING_OWNED) {
        assert!(profile.item_assetization, EInvalidBinding);
        assert!(selection.subject_kind == SUBJECT_WALLET, EInvalidSubject);
        assert!(selection.owned_instance_id.is_some(), EOwnedInstanceRequired);
        let entitlement_key = WalletEntitlementKeyV6 {
            profile_id: object::id(profile),
            product_id: selection.product_id,
            wallet: authorizer,
        };
        assert!(
            registry.wallet_entitlements.contains(entitlement_key),
            EEntitlementMissing,
        );
        let entitlement = registry.wallet_entitlements.borrow(entitlement_key);
        assert!(entitlement.owned_instance_id.is_some(), EOwnedInstanceRequired);
        let instance_id = *selection.owned_instance_id.borrow();
        assert!(
            instance_id == *entitlement.owned_instance_id.borrow(),
            EOwnedItemMismatch,
        );
        assert!(registry.owned_locks.contains(instance_id), EOwnedItemNotLocked);
        let lock = registry.owned_locks.borrow(instance_id);
        assert!(
            lock.profile_id == object::id(profile)
                && lock.product_id == selection.product_id
                && lock.holder == authorizer,
            EOwnedItemMismatch,
        );
        assert!(lock.soul_id == soul_id, EOwnedItemWrongSoul);
    } else {
        abort EInvalidBinding
    };
}

fun increment_soul_owned_lock_count(
    registry: &mut CompositionRegistryV6,
    soul_id: ID,
) {
    if (registry.soul_owned_lock_counts.contains(soul_id)) {
        let count = registry.soul_owned_lock_counts.borrow_mut(soul_id);
        *count = *count + 1;
    } else {
        registry.soul_owned_lock_counts.add(soul_id, 1);
    };
}

fun decrement_soul_owned_lock_count(
    registry: &mut CompositionRegistryV6,
    soul_id: ID,
) {
    assert!(
        registry.soul_owned_lock_counts.contains(soul_id),
        EOwnedItemNotLocked,
    );
    let count = *registry.soul_owned_lock_counts.borrow(soul_id);
    assert!(count > 0, EOwnedItemNotLocked);
    if (count == 1) {
        let removed = registry.soul_owned_lock_counts.remove(soul_id);
        assert!(removed == 1, EOwnedItemNotLocked);
    } else {
        let count_ref = registry.soul_owned_lock_counts.borrow_mut(soul_id);
        *count_ref = *count_ref - 1;
    };
}

fun assert_unique_slot(selections: &vector<LoadoutSelectionV6>, index: u64) {
    let mut prior = 0;
    while (prior < index) {
        assert!(
            &selections[prior].slot_key != &selections[index].slot_key,
            EDuplicateSlot,
        );
        prior = prior + 1;
    };
}

fun assert_player_action(
    registry: &CompositionRegistryV6,
    config: &CompositionProtocolConfigV6,
    profile: &MakerProfileV6,
    product: &ItemProductV6,
    root: &MakerRootV5,
    v5_config: &CommerceProtocolConfigV5,
) {
    assert_v6_operational(config, profile, root, v5_config);
    assert_registry(config, registry);
    assert!(profile.sealed, EProfileNotSealed);
    assert!(product.config_id == object::id(config), EProtocolMismatch);
    let product_id = object::id(product);
    assert!(profile.admissions.contains(product_id), EAdmissionMissing);
    let admission = profile.admissions.borrow(product_id);
    assert!(admission.active, EAdmissionInactive);
    assert_admission_matches_product(admission, product);
}

fun assert_admission_matches_product(
    admission: &AdmissionRecordV6,
    product: &ItemProductV6,
) {
    assert!(
        admission.source_kind == product.origin_kind
            && &admission.definition_commitment == &product.definition_commitment
            && &admission.asset_commitment == &product.asset_commitment
            && &admission.slot_key == &product.slot_key
            && admission.rights_origin == product.rights_origin
            && admission.access_kind == product.access_kind
            && admission.binding_kind == product.binding_kind
            && admission.price_atomic == product.price_atomic
            && admission.maker_ecosystem_fee_bps
                == product.maker_ecosystem_fee_bps
            && admission.transferable == product.transferable
            && &admission.required_product_ids == &product.required_product_ids
            && &admission.excluded_product_ids == &product.excluded_product_ids
            && admission.publisher == product.publisher,
        EProtocolMismatch,
    );
}

fun assert_v6_operational(
    config: &CompositionProtocolConfigV6,
    profile: &MakerProfileV6,
    root: &MakerRootV5,
    v5_config: &CommerceProtocolConfigV5,
) {
    assert_protocol_enabled_v6(config);
    assert_protocol_link(config, v5_config);
    assert_profile_link(config, profile, root);
    commerce::assert_extension_operational_v5(root, v5_config);
}

fun assert_v6_publication_gate(
    config: &CompositionProtocolConfigV6,
    v5_config: &CommerceProtocolConfigV5,
) {
    assert_protocol_enabled_v6(config);
    assert_protocol_link(config, v5_config);
    commerce::assert_extension_protocol_enabled_v5(v5_config);
}

/// One kill switch covers every v6 publication and player mutation. Protocol
/// initialization, dependency binding, gate administration and emergency
/// treasury withdrawal remain available while disabled so governance can
/// safely configure or pause the protocol.
fun assert_protocol_enabled_v6(config: &CompositionProtocolConfigV6) {
    assert!(config.enabled, EProtocolDisabled);
}

fun assert_protocol_link(
    config: &CompositionProtocolConfigV6,
    v5_config: &CommerceProtocolConfigV5,
) {
    assert!(config.v5_config_id == object::id(v5_config), EProtocolMismatch);
    assert!(
        &config.payment_coin_type
            == commerce::extension_payment_coin_type_v5(v5_config),
        EPaymentCoinMismatch,
    );
    assert!(
        config.primary_protocol_fee_bps
            == commerce::primary_protocol_fee_bps_v5(v5_config),
        EProtocolMismatch,
    );
}

fun assert_profile_link(
    config: &CompositionProtocolConfigV6,
    profile: &MakerProfileV6,
    root: &MakerRootV5,
) {
    assert!(profile.config_id == object::id(config), EProtocolMismatch);
    assert!(profile.root_id == commerce::root_id_v5(root), EProtocolMismatch);
    assert!(
        profile.rights_origin == commerce::root_rights_origin_v5(root),
        EProtocolMismatch,
    );
    assert!(
        profile.primary_protocol_fee_bps == config.primary_protocol_fee_bps,
        EProtocolMismatch,
    );
}

fun assert_registry(
    config: &CompositionProtocolConfigV6,
    registry: &CompositionRegistryV6,
) {
    assert!(object::id(registry) == config.registry_id, EProtocolMismatch);
    assert!(registry.config_id == object::id(config), EProtocolMismatch);
}

fun assert_treasury<PaymentCoin>(
    config: &CompositionProtocolConfigV6,
    treasury: &CompositionProtocolTreasuryV6<PaymentCoin>,
) {
    assert!(object::id(treasury) == config.treasury_id, EProtocolMismatch);
    assert!(treasury.config_id == object::id(config), EProtocolMismatch);
}

fun assert_admin(
    config: &CompositionProtocolConfigV6,
    admin: &CompositionAdminCapV6,
) {
    assert!(admin.config_id == object::id(config), EInvalidProtocolAdmin);
}

fun assert_attestation(
    config: &CompositionProtocolConfigV6,
    profile: &MakerProfileV6,
    product: &ItemProductV6,
    attestation: &ValidatorAttestationV6,
) {
    assert!(
        attestation.config_id == object::id(config)
            && attestation.profile_id == object::id(profile)
            && attestation.product_id == object::id(product)
            && &attestation.definition_commitment == &product.definition_commitment
            && &attestation.slot_schema_commitment == &profile.slot_schema_commitment
            && &attestation.validator_policy_commitment
                == &config.validator_policy_commitment
            && attestation.validator_epoch == config.validator_epoch,
        EAttestationMismatch,
    );
}

fun assert_soul_owner_proof_type<Proof: drop>(
    config: &CompositionProtocolConfigV6,
) {
    assert!(config.soul_owner_proof_type.is_some(), EDependencyMissing);
    assert!(
        &defining_type_name<Proof>() == config.soul_owner_proof_type.borrow(),
        ESoulOwnerProofMismatch,
    );
}

fun assert_valid_profile_mode(mode: u8) {
    assert!(mode == PROFILE_FIXED || mode == PROFILE_COMPOSABLE, EInvalidProfileMode);
}

fun assert_valid_third_party_policy(policy: u8) {
    assert!(policy <= THIRD_PARTY_OPEN, EInvalidThirdPartyPolicy);
}

fun assert_valid_rights_origin(rights_origin: u8) {
    assert!(
        rights_origin == RIGHTS_ONCHAIN_NATIVE
            || rights_origin == RIGHTS_LICENSE_WRAPPED,
        EInvalidRightsOrigin,
    );
}

fun assert_valid_origin_kind(origin_kind: u8) {
    assert!(
        origin_kind == ORIGIN_OFFICIAL
            || origin_kind == ORIGIN_CERTIFIED
            || origin_kind == ORIGIN_OPEN,
        EInvalidOriginKind,
    );
}

fun assert_valid_access(
    profile: &MakerProfileV6,
    access_kind: u8,
    binding_kind: u8,
    price_atomic: u64,
    transferable: bool,
) {
    assert!(
        access_kind == ACCESS_EMBEDDED
            || access_kind == ACCESS_FREE
            || access_kind == ACCESS_PAID,
        EInvalidAccessKind,
    );
    assert!(binding_kind <= BINDING_OWNED, EInvalidBinding);
    if (binding_kind == BINDING_EMBEDDED) {
        assert!(access_kind == ACCESS_EMBEDDED, EInvalidBinding);
        assert!(price_atomic == 0, EInvalidAccessKind);
        assert!(!transferable, EItemNotTransferable);
    } else {
        assert!(access_kind != ACCESS_EMBEDDED, EInvalidBinding);
        if (access_kind == ACCESS_FREE) {
            assert!(price_atomic == 0, EInvalidAccessKind);
        } else {
            assert!(price_atomic > 0, EInvalidAccessKind);
        };
        if (binding_kind == BINDING_OWNED) {
            assert!(profile.item_assetization, EInvalidBinding);
        } else {
            assert!(!transferable, EItemNotTransferable);
        };
    };
    if (profile.mode == PROFILE_FIXED) {
        assert!(binding_kind == BINDING_EMBEDDED, EInvalidBinding);
    };
}

fun assert_product_rules(product: &ItemProductV6) {
    let product_id = object::id(product);
    let mut index = 0;
    while (index < product.required_product_ids.length()) {
        let required_id = product.required_product_ids[index];
        assert!(required_id != product_id, ERuleConflict);
        assert!(
            !id_vector_contains_before(
                &product.required_product_ids,
                required_id,
                index,
            ),
            ERuleConflict,
        );
        assert!(
            !id_vector_contains(&product.excluded_product_ids, required_id),
            ERuleConflict,
        );
        index = index + 1;
    };
    index = 0;
    while (index < product.excluded_product_ids.length()) {
        let excluded_id = product.excluded_product_ids[index];
        assert!(excluded_id != product_id, ERuleConflict);
        assert!(
            !id_vector_contains_before(
                &product.excluded_product_ids,
                excluded_id,
                index,
            ),
            ERuleConflict,
        );
        index = index + 1;
    };
}

fun assert_rule_targets_admitted(
    profile: &MakerProfileV6,
    product: &ItemProductV6,
) {
    let mut index = 0;
    while (index < product.required_product_ids.length()) {
        assert!(
            profile.admissions.contains(product.required_product_ids[index]),
            ERuleTargetMissing,
        );
        index = index + 1;
    };
    index = 0;
    while (index < product.excluded_product_ids.length()) {
        assert!(
            profile.admissions.contains(product.excluded_product_ids[index]),
            ERuleTargetMissing,
        );
        index = index + 1;
    };
}

fun assert_loadout_rules(
    profile: &MakerProfileV6,
    selections: &vector<LoadoutSelectionV6>,
) {
    let mut index = 0;
    while (index < selections.length()) {
        let admission = profile.admissions.borrow(selections[index].product_id);
        let mut rule_index = 0;
        while (rule_index < admission.required_product_ids.length()) {
            assert!(
                selection_vector_contains_product(
                    selections,
                    admission.required_product_ids[rule_index],
                ),
                ERequiredProductMissing,
            );
            rule_index = rule_index + 1;
        };
        rule_index = 0;
        while (rule_index < admission.excluded_product_ids.length()) {
            assert!(
                !selection_vector_contains_product(
                    selections,
                    admission.excluded_product_ids[rule_index],
                ),
                EExcludedProductSelected,
            );
            rule_index = rule_index + 1;
        };
        index = index + 1;
    };
}

fun selection_vector_contains_product(
    selections: &vector<LoadoutSelectionV6>,
    product_id: ID,
): bool {
    let mut index = 0;
    while (index < selections.length()) {
        if (selections[index].product_id == product_id) return true;
        index = index + 1;
    };
    false
}

fun id_vector_contains(values: &vector<ID>, value: ID): bool {
    let mut index = 0;
    while (index < values.length()) {
        if (values[index] == value) return true;
        index = index + 1;
    };
    false
}

fun id_vector_contains_before(
    values: &vector<ID>,
    value: ID,
    end: u64,
): bool {
    let mut index = 0;
    while (index < end) {
        if (values[index] == value) return true;
        index = index + 1;
    };
    false
}

fun assert_hash(value: &vector<u8>) {
    assert!(value.length() == HASH_LENGTH, EInvalidCommitment);
}

fun assert_companion_manifest(blob_id: &String, manifest_hash: &vector<u8>) {
    assert!(
        string::as_bytes(blob_id).length() > 0,
        EInvalidCompanionManifestBlobId,
    );
    assert_hash(manifest_hash);
}

fun assert_non_empty(value: &String) {
    assert!(string::as_bytes(value).length() > 0, EInvalidSlot);
}

fun bps_amount(amount: u64, bps: u16): u64 {
    (((amount as u128) * (bps as u128)) / (BPS_DENOMINATOR as u128)) as u64
}

fun payment_coin_type_name<PaymentCoin>(): String {
    defining_type_name<PaymentCoin>()
}

fun defining_type_name<T>(): String {
    string::from_ascii(type_name::with_defining_ids<T>().into_string())
}

#[test_only]
public struct TrustedSoulOwnerProofV6 has drop {}

#[test_only]
public struct UntrustedSoulOwnerProofV6 has drop {}

#[test_only]
public struct WrongPaymentCoinV6 has drop {}

#[test_only]
public fun trusted_soul_owner_proof_v6(): TrustedSoulOwnerProofV6 {
    TrustedSoulOwnerProofV6 {}
}

#[test_only]
public fun untrusted_soul_owner_proof_v6(): UntrustedSoulOwnerProofV6 {
    UntrustedSoulOwnerProofV6 {}
}

#[test_only]
public fun destroy_composition_protocol_v6_for_testing<PaymentCoin>(
    config: CompositionProtocolConfigV6,
    treasury: CompositionProtocolTreasuryV6<PaymentCoin>,
    registry: CompositionRegistryV6,
    admin: CompositionAdminCapV6,
    validator: ValidatorCapV6,
) {
    std::unit_test::destroy(config);
    std::unit_test::destroy(treasury);
    std::unit_test::destroy(registry);
    std::unit_test::destroy(admin);
    std::unit_test::destroy(validator);
}

#[test_only]
public fun destroy_profile_v6_for_testing(profile: MakerProfileV6) {
    std::unit_test::destroy(profile);
}

/// Minimal admission-only profile used by the physical v7 module's negative
/// tests. It deliberately exposes no production constructor and exists only
/// in test bytecode: v7 needs to prove that a present-but-revoked v6
/// AdmissionRecord cannot be used for a new mint, deposit, or equip.
#[test_only]
public fun new_admission_profile_stub_v6_for_testing(
    product_id: ID,
    active: bool,
    ctx: &mut TxContext,
): MakerProfileV6 {
    new_admission_profile_stub_with_source_v6_for_testing(
        product_id,
        ADMISSION_OFFICIAL,
        active,
        ctx,
    )
}

/// Flexible admission-only fixture used to prove v7 external supplier source
/// matching. It is intentionally unavailable in production bytecode.
#[test_only]
public fun new_admission_profile_stub_with_source_v6_for_testing(
    product_id: ID,
    source_kind: u8,
    active: bool,
    ctx: &mut TxContext,
): MakerProfileV6 {
    let mut admissions = table::new(ctx);
    admissions.add(product_id, AdmissionRecordV6 {
        source_kind,
        attestation_id: option::none(),
        admitted_by: ctx.sender(),
        admitted_at_ms: 0,
        definition_commitment: test_commitment(91),
        asset_commitment: test_commitment(92),
        slot_key: b"body".to_string(),
        rights_origin: RIGHTS_ONCHAIN_NATIVE,
        access_kind: ACCESS_FREE,
        binding_kind: BINDING_OWNED,
        price_atomic: 0,
        maker_ecosystem_fee_bps: 0,
        transferable: true,
        required_product_ids: vector[],
        excluded_product_ids: vector[],
        publisher: ctx.sender(),
        active,
    });
    MakerProfileV6 {
        id: object::new(ctx),
        version: VERSION,
        config_id: object::id_from_address(@0x6006),
        root_id: object::id_from_address(@0x5007),
        mode: PROFILE_COMPOSABLE,
        loadout_mutable: true,
        item_assetization: true,
        third_party_policy: THIRD_PARTY_OPEN,
        slot_schema_commitment: test_commitment(93),
        renderer_commitment: test_commitment(94),
        rights_origin: RIGHTS_ONCHAIN_NATIVE,
        primary_protocol_fee_bps: 1_000,
        companion_manifest_blob_id: b"test-admission-profile-v6".to_string(),
        companion_manifest_hash: test_commitment(95),
        extensions_hash: test_commitment(96),
        sealed: true,
        admissions,
        admission_count: 1,
    }
}

#[test_only]
public fun destroy_item_product_v6_for_testing(product: ItemProductV6) {
    std::unit_test::destroy(product);
}

#[test_only]
public fun destroy_validator_attestation_v6_for_testing(
    attestation: ValidatorAttestationV6,
) {
    std::unit_test::destroy(attestation);
}

#[test_only]
public fun destroy_owned_item_v6_for_testing(item: OwnedItemV6) {
    std::unit_test::destroy(item);
}

#[test_only]
fun test_commitment(value: u8): vector<u8> {
    let mut result = vector[];
    let mut index = 0;
    while (index < HASH_LENGTH) {
        result.push_back(value);
        index = index + 1;
    };
    result
}

#[test, expected_failure(abort_code = 53, location = animacraft::composition_v6)]
fun companion_manifest_rejects_empty_blob_id() {
    assert_companion_manifest(&b"".to_string(), &test_commitment(1));
}

#[test, expected_failure(abort_code = 6, location = animacraft::composition_v6)]
fun companion_manifest_rejects_non_sha256_hash() {
    assert_companion_manifest(
        &b"walrus-companion-v6".to_string(),
        &vector[1, 2, 3],
    );
}

#[test, expected_failure(abort_code = 50, location = animacraft::animacraft)]
fun canonical_v6_protocol_can_only_initialize_once() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 589, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (
        _legacy_profile,
        _maker,
        _legacy_treasury,
        _legacy_config,
        _legacy_protocol_treasury,
        mut protocol_admin,
        v5_config,
        _v5_protocol_treasury,
        _root,
        _v5_maker_treasury,
        _vault,
        _cap,
    ) = commerce::v5_world_for_testing(
        commerce::new_completion_policy(
            commerce::policy_unlimited_free(),
            0,
            0,
        ),
        &mut ctx,
        &clock,
    );
    initialize_composition_protocol_v6<sui::sui::SUI>(
        &v5_config,
        &mut protocol_admin,
        test_commitment(88),
        &mut ctx,
    );
    initialize_composition_protocol_v6<sui::sui::SUI>(
        &v5_config,
        &mut protocol_admin,
        test_commitment(89),
        &mut ctx,
    );
    abort 99
}

#[test, expected_failure(abort_code = 6, location = animacraft::composition_v6)]
fun canonical_v6_initializer_rejects_invalid_policy_before_claim() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 586, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (
        _legacy_profile,
        _maker,
        _legacy_treasury,
        _legacy_config,
        _legacy_protocol_treasury,
        mut protocol_admin,
        v5_config,
        _v5_protocol_treasury,
        _root,
        _v5_maker_treasury,
        _vault,
        _cap,
    ) = commerce::v5_world_for_testing(
        commerce::new_completion_policy(
            commerce::policy_unlimited_free(),
            0,
            0,
        ),
        &mut ctx,
        &clock,
    );
    initialize_composition_protocol_v6<sui::sui::SUI>(
        &v5_config,
        &mut protocol_admin,
        vector[1, 2, 3],
        &mut ctx,
    );
    abort 99
}

#[test, expected_failure(abort_code = 3, location = animacraft::composition_v6)]
fun canonical_v6_initializer_rejects_wrong_coin_before_claim() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 585, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (
        _legacy_profile,
        _maker,
        _legacy_treasury,
        _legacy_config,
        _legacy_protocol_treasury,
        mut protocol_admin,
        v5_config,
        _v5_protocol_treasury,
        _root,
        _v5_maker_treasury,
        _vault,
        _cap,
    ) = commerce::v5_world_for_testing(
        commerce::new_completion_policy(
            commerce::policy_unlimited_free(),
            0,
            0,
        ),
        &mut ctx,
        &clock,
    );
    initialize_composition_protocol_v6<WrongPaymentCoinV6>(
        &v5_config,
        &mut protocol_admin,
        test_commitment(87),
        &mut ctx,
    );
    abort 99
}

#[test]
fun valid_v6_initializer_records_exact_marker_version() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 584, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (
        legacy_profile,
        maker,
        legacy_treasury,
        legacy_config,
        legacy_protocol_treasury,
        mut protocol_admin,
        v5_config,
        v5_protocol_treasury,
        root,
        v5_maker_treasury,
        vault,
        cap,
    ) = commerce::v5_world_for_testing(
        commerce::new_completion_policy(
            commerce::policy_unlimited_free(),
            0,
            0,
        ),
        &mut ctx,
        &clock,
    );
    assert!(legacy::composition_v6_initialized_version(&protocol_admin) == 0);
    initialize_composition_protocol_v6<sui::sui::SUI>(
        &v5_config,
        &mut protocol_admin,
        test_commitment(86),
        &mut ctx,
    );
    assert!(legacy::composition_v6_initialized_version(&protocol_admin) == 6);
    sui::clock::destroy_for_testing(clock);
    commerce::destroy_v5_world_for_testing(
        legacy_profile,
        maker,
        legacy_treasury,
        legacy_config,
        legacy_protocol_treasury,
        protocol_admin,
        v5_config,
        v5_protocol_treasury,
        root,
        v5_maker_treasury,
        vault,
        cap,
    );
}

#[test]
fun composition_control_caps_support_explicit_custody_migration() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 588, 0, 0, 0);
    let config_id = object::id_from_address(@0xC066);
    let admin = CompositionAdminCapV6 {
        id: object::new(&mut ctx),
        version: VERSION,
        config_id,
    };
    let validator = ValidatorCapV6 {
        id: object::new(&mut ctx),
        version: VERSION,
        config_id,
        validator_epoch: 0,
    };
    assert!(composition_admin_cap_config_id_v6(&admin) == config_id);
    assert!(validator_cap_config_id_v6(&validator) == config_id);
    assert!(validator_cap_epoch_v6(&validator) == 0);
    transfer_composition_admin_cap_v6(admin, @0xBEEF, &ctx);
    transfer_validator_cap_v6(validator, @0xCAFE, &ctx);
}

#[test, expected_failure(abort_code = 28, location = animacraft::composition_v6)]
fun composition_control_cap_rejects_zero_recipient() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 587, 0, 0, 0);
    let admin = CompositionAdminCapV6 {
        id: object::new(&mut ctx),
        version: VERSION,
        config_id: object::id_from_address(@0xC066),
    };
    transfer_composition_admin_cap_v6(admin, @0x0, &ctx);
    abort 99
}

#[test_only]
fun exercise_disabled_publication_stage(stage: u8) {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 590 + (stage as u64), 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (
        _legacy_profile,
        maker,
        _legacy_treasury,
        _legacy_config,
        _legacy_protocol_treasury,
        protocol_admin,
        mut v5_config,
        _v5_protocol_treasury,
        mut root,
        _v5_maker_treasury,
        _vault,
        cap,
    ) = commerce::v5_world_for_testing(
        commerce::new_completion_policy(commerce::policy_unlimited_free(), 0, 0),
        &mut ctx,
        &clock,
    );
    activate_v5_for_composition_testing(
        &mut root,
        &cap,
        &maker,
        &mut v5_config,
        &protocol_admin,
        &ctx,
    );
    let (mut config, _treasury, mut registry, _admin, validator) =
        new_composition_protocol_v6_for_testing<sui::sui::SUI>(
            &v5_config,
            &protocol_admin,
            test_commitment(90),
            &mut ctx,
        );
    bind_soul_owner_proof_type_v6<TrustedSoulOwnerProofV6>(
        &mut config,
        &v5_config,
        &protocol_admin,
    );

    if (stage == 0) {
        let _blocked_profile = new_maker_profile_v6_for_testing(
            &root,
            &cap,
            &config,
            &mut registry,
            PROFILE_COMPOSABLE,
            false,
            THIRD_PARTY_OPEN,
            test_commitment(1),
            test_commitment(2),
            b"walrus-disabled-profile".to_string(),
            test_commitment(3),
            test_commitment(4),
            &mut ctx,
        );
        abort 99
    };

    update_protocol_enabled_v6(
        &mut config,
        &v5_config,
        &protocol_admin,
        true,
    );
    let mut profile = new_maker_profile_v6_for_testing(
        &root,
        &cap,
        &config,
        &mut registry,
        PROFILE_COMPOSABLE,
        false,
        THIRD_PARTY_OPEN,
        test_commitment(1),
        test_commitment(2),
        b"walrus-disabled-stage".to_string(),
        test_commitment(3),
        test_commitment(4),
        &mut ctx,
    );
    if (stage == 1) {
        update_protocol_enabled_v6(
            &mut config,
            &v5_config,
            &protocol_admin,
            false,
        );
        seal_maker_profile_v6(&mut profile, &root, &cap, &config, &v5_config, &ctx);
        abort 99
    };
    seal_maker_profile_v6(&mut profile, &root, &cap, &config, &v5_config, &ctx);

    if (stage == 2) {
        update_protocol_enabled_v6(
            &mut config,
            &v5_config,
            &protocol_admin,
            false,
        );
        let _blocked_product = new_external_item_product_v6_for_testing(
            &profile,
            &config,
            ORIGIN_OPEN,
            test_commitment(10),
            test_commitment(11),
            test_commitment(12),
            b"outfit".to_string(),
            RIGHTS_ONCHAIN_NATIVE,
            ACCESS_FREE,
            BINDING_ACCOUNT,
            0,
            0,
            false,
            vector[],
            vector[],
            test_commitment(13),
            &mut ctx,
        );
        abort 99
    };
    if (stage == 5) {
        let _invalid_external_origin = new_external_item_product_v6_for_testing(
            &profile,
            &config,
            ORIGIN_OFFICIAL,
            test_commitment(10),
            test_commitment(11),
            test_commitment(12),
            b"outfit".to_string(),
            RIGHTS_ONCHAIN_NATIVE,
            ACCESS_FREE,
            BINDING_ACCOUNT,
            0,
            0,
            false,
            vector[],
            vector[],
            test_commitment(13),
            &mut ctx,
        );
        abort 99
    };
    let product = new_external_item_product_v6_for_testing(
        &profile,
        &config,
        ORIGIN_OPEN,
        test_commitment(10),
        test_commitment(11),
        test_commitment(12),
        b"outfit".to_string(),
        RIGHTS_ONCHAIN_NATIVE,
        ACCESS_FREE,
        BINDING_ACCOUNT,
        0,
        0,
        false,
        vector[],
        vector[],
        test_commitment(13),
        &mut ctx,
    );

    if (stage == 3) {
        update_protocol_enabled_v6(
            &mut config,
            &v5_config,
            &protocol_admin,
            false,
        );
        let _blocked_attestation = new_validator_attestation_v6_for_testing(
            &config,
            &validator,
            &profile,
            &product,
            &clock,
            &mut ctx,
        );
        abort 99
    };
    let attestation = new_validator_attestation_v6_for_testing(
        &config,
        &validator,
        &profile,
        &product,
        &clock,
        &mut ctx,
    );

    if (stage == 4) {
        update_protocol_enabled_v6(
            &mut config,
            &v5_config,
            &protocol_admin,
            false,
        );
        admit_open_item_v6(
            &mut profile,
            &product,
            &attestation,
            &config,
            &v5_config,
            &clock,
            &ctx,
        );
        abort 99
    };
    abort 98
}

#[test, expected_failure(abort_code = 1, location = animacraft::composition_v6)]
fun disabled_gate_rejects_profile_creation() {
    exercise_disabled_publication_stage(0)
}

#[test, expected_failure(abort_code = 1, location = animacraft::composition_v6)]
fun disabled_gate_rejects_profile_seal() {
    exercise_disabled_publication_stage(1)
}

#[test, expected_failure(abort_code = 1, location = animacraft::composition_v6)]
fun disabled_gate_rejects_product_publication() {
    exercise_disabled_publication_stage(2)
}

#[test, expected_failure(abort_code = 1, location = animacraft::composition_v6)]
fun disabled_gate_rejects_validator_attestation() {
    exercise_disabled_publication_stage(3)
}

#[test, expected_failure(abort_code = 1, location = animacraft::composition_v6)]
fun disabled_gate_rejects_item_admission() {
    exercise_disabled_publication_stage(4)
}

#[test, expected_failure(abort_code = 58, location = animacraft::composition_v6)]
fun external_product_rejects_official_origin_kind() {
    exercise_disabled_publication_stage(5)
}

#[test_only]
fun exercise_v5_kill_switch_publication_stage(stage: u8) {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 610 + (stage as u64), 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (
        _legacy_profile,
        maker,
        _legacy_treasury,
        _legacy_config,
        _legacy_protocol_treasury,
        protocol_admin,
        mut v5_config,
        _v5_protocol_treasury,
        mut root,
        _v5_maker_treasury,
        _vault,
        cap,
    ) = commerce::v5_world_for_testing(
        commerce::new_completion_policy(commerce::policy_unlimited_free(), 0, 0),
        &mut ctx,
        &clock,
    );
    activate_v5_for_composition_testing(
        &mut root,
        &cap,
        &maker,
        &mut v5_config,
        &protocol_admin,
        &ctx,
    );
    let (mut config, _treasury, mut registry, _admin, validator) =
        new_composition_protocol_v6_for_testing<sui::sui::SUI>(
            &v5_config,
            &protocol_admin,
            test_commitment(90),
            &mut ctx,
        );
    bind_soul_owner_proof_type_v6<TrustedSoulOwnerProofV6>(
        &mut config,
        &v5_config,
        &protocol_admin,
    );
    update_protocol_enabled_v6(
        &mut config,
        &v5_config,
        &protocol_admin,
        true,
    );

    if (stage == 0) {
        commerce::update_protocol_enabled_v5(&mut v5_config, &protocol_admin, false);
        create_maker_profile_v6(
            &root,
            &cap,
            &config,
            &v5_config,
            &mut registry,
            PROFILE_COMPOSABLE,
            true,
            THIRD_PARTY_OPEN,
            test_commitment(1),
            test_commitment(2),
            b"walrus-v5-kill-create".to_string(),
            test_commitment(3),
            test_commitment(4),
            &mut ctx,
        );
        abort 99
    };

    let mut profile = new_maker_profile_v6_for_testing(
        &root,
        &cap,
        &config,
        &mut registry,
        PROFILE_COMPOSABLE,
        true,
        THIRD_PARTY_OPEN,
        test_commitment(1),
        test_commitment(2),
        b"walrus-v5-kill-profile".to_string(),
        test_commitment(3),
        test_commitment(4),
        &mut ctx,
    );
    if (stage == 1) {
        commerce::update_protocol_enabled_v5(&mut v5_config, &protocol_admin, false);
        seal_maker_profile_v6(&mut profile, &root, &cap, &config, &v5_config, &ctx);
        abort 99
    };

    let official = new_official_item_product_v6_for_testing(
        &profile,
        &root,
        &cap,
        &config,
        test_commitment(10),
        test_commitment(11),
        test_commitment(12),
        b"hair".to_string(),
        ACCESS_FREE,
        BINDING_ACCOUNT,
        0,
        0,
        false,
        vector[],
        vector[],
        test_commitment(13),
        &mut ctx,
    );
    let external = new_external_item_product_v6_for_testing(
        &profile,
        &config,
        ORIGIN_CERTIFIED,
        test_commitment(20),
        test_commitment(21),
        test_commitment(22),
        b"outfit".to_string(),
        RIGHTS_LICENSE_WRAPPED,
        ACCESS_FREE,
        BINDING_ACCOUNT,
        0,
        0,
        false,
        vector[],
        vector[],
        test_commitment(23),
        &mut ctx,
    );
    let official_attestation = new_validator_attestation_v6_for_testing(
        &config,
        &validator,
        &profile,
        &official,
        &clock,
        &mut ctx,
    );
    let external_attestation = new_validator_attestation_v6_for_testing(
        &config,
        &validator,
        &profile,
        &external,
        &clock,
        &mut ctx,
    );

    if (stage == 2) {
        commerce::update_protocol_enabled_v5(&mut v5_config, &protocol_admin, false);
        publish_official_item_product_v6(
            &profile, &root, &cap, &config, &v5_config,
            test_commitment(30), test_commitment(31), test_commitment(32),
            b"accessory".to_string(), ACCESS_FREE, BINDING_ACCOUNT,
            0, 0, false, vector[], vector[], test_commitment(33), &mut ctx,
        );
        abort 99
    };
    if (stage == 3) {
        commerce::update_protocol_enabled_v5(&mut v5_config, &protocol_admin, false);
        publish_external_item_product_v6(
            &profile, &config, &v5_config,
            ORIGIN_CERTIFIED,
            test_commitment(40), test_commitment(41), test_commitment(42),
            b"accessory".to_string(), RIGHTS_ONCHAIN_NATIVE,
            ACCESS_FREE, BINDING_ACCOUNT, 0, 0, false,
            vector[], vector[], test_commitment(43), &mut ctx,
        );
        abort 99
    };
    if (stage == 4) {
        commerce::update_protocol_enabled_v5(&mut v5_config, &protocol_admin, false);
        publish_validator_attestation_v6(
            &config,
            &v5_config,
            &validator,
            &profile,
            &external,
            &clock,
            &mut ctx,
        );
        abort 99
    };

    seal_maker_profile_v6(&mut profile, &root, &cap, &config, &v5_config, &ctx);
    commerce::update_protocol_enabled_v5(&mut v5_config, &protocol_admin, false);
    if (stage == 5) {
        admit_official_item_v6(
            &mut profile, &official, &official_attestation, &root, &cap,
            &config, &v5_config, &clock, &ctx,
        );
        abort 99
    };
    if (stage == 6) {
        admit_certified_item_v6(
            &mut profile, &external, &external_attestation, &root, &cap,
            &config, &v5_config, &clock, &ctx,
        );
        abort 99
    };
    admit_open_item_v6(
        &mut profile,
        &external,
        &external_attestation,
        &config,
        &v5_config,
        &clock,
        &ctx,
    );
    abort 99
}

#[test, expected_failure(abort_code = 6, location = animacraft::commerce_v5)]
fun v5_kill_switch_rejects_v6_profile_creation() { exercise_v5_kill_switch_publication_stage(0) }

#[test, expected_failure(abort_code = 6, location = animacraft::commerce_v5)]
fun v5_kill_switch_rejects_v6_profile_seal() { exercise_v5_kill_switch_publication_stage(1) }

#[test, expected_failure(abort_code = 6, location = animacraft::commerce_v5)]
fun v5_kill_switch_rejects_v6_official_product_publish() { exercise_v5_kill_switch_publication_stage(2) }

#[test, expected_failure(abort_code = 6, location = animacraft::commerce_v5)]
fun v5_kill_switch_rejects_v6_external_product_publish() { exercise_v5_kill_switch_publication_stage(3) }

#[test, expected_failure(abort_code = 6, location = animacraft::commerce_v5)]
fun v5_kill_switch_rejects_v6_validator_attestation() { exercise_v5_kill_switch_publication_stage(4) }

#[test, expected_failure(abort_code = 6, location = animacraft::commerce_v5)]
fun v5_kill_switch_rejects_v6_official_admission() { exercise_v5_kill_switch_publication_stage(5) }

#[test, expected_failure(abort_code = 6, location = animacraft::commerce_v5)]
fun v5_kill_switch_rejects_v6_certified_admission() { exercise_v5_kill_switch_publication_stage(6) }

#[test, expected_failure(abort_code = 6, location = animacraft::commerce_v5)]
fun v5_kill_switch_rejects_v6_open_admission() { exercise_v5_kill_switch_publication_stage(7) }

#[test_only]
fun activate_v5_for_composition_testing(
    root: &mut MakerRootV5,
    cap: &MakerControlCapV5,
    maker: &animacraft::animacraft::OCMaker,
    v5_config: &mut CommerceProtocolConfigV5,
    v5_admin: &ProtocolFeeAdminCap,
    ctx: &TxContext,
) {
    commerce::register_base_style_v5(
        root,
        cap,
        maker,
        b"eyes".to_string(),
        b"bright".to_string(),
        b"default".to_string(),
        ctx,
    );
    commerce::register_base_style_v5(
        root,
        cap,
        maker,
        b"hat".to_string(),
        b"moon".to_string(),
        b"default".to_string(),
        ctx,
    );
    commerce::seal_style_registry_v5(root, cap, ctx);
    commerce::update_protocol_enabled_v5(v5_config, v5_admin, true);
    commerce::activate_maker_v5(root, cap, ctx);
}

#[test]
fun incomplete_profile_can_be_cancelled_and_root_reused_with_gates_off() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 6001, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (
        legacy_profile,
        maker,
        legacy_treasury,
        legacy_config,
        legacy_protocol_treasury,
        protocol_admin,
        mut v5_config,
        v5_protocol_treasury,
        mut root,
        v5_maker_treasury,
        vault,
        cap,
    ) = commerce::v5_world_for_testing(
        commerce::new_completion_policy(commerce::policy_unlimited_free(), 0, 0),
        &mut ctx,
        &clock,
    );
    activate_v5_for_composition_testing(
        &mut root,
        &cap,
        &maker,
        &mut v5_config,
        &protocol_admin,
        &ctx,
    );
    let (mut config, treasury, mut registry, admin, validator) =
        new_composition_protocol_v6_for_testing<sui::sui::SUI>(
            &v5_config,
            &protocol_admin,
            test_commitment(90),
            &mut ctx,
        );
    bind_soul_owner_proof_type_v6<TrustedSoulOwnerProofV6>(
        &mut config,
        &v5_config,
        &protocol_admin,
    );
    update_protocol_enabled_v6(
        &mut config,
        &v5_config,
        &protocol_admin,
        true,
    );
    let profile = new_maker_profile_v6_for_testing(
        &root,
        &cap,
        &config,
        &mut registry,
        PROFILE_COMPOSABLE,
        false,
        THIRD_PARTY_CERTIFIED,
        test_commitment(1),
        test_commitment(2),
        b"walrus-recoverable-profile".to_string(),
        test_commitment(3),
        test_commitment(4),
        &mut ctx,
    );
    update_protocol_enabled_v6(
        &mut config,
        &v5_config,
        &protocol_admin,
        false,
    );
    commerce::update_protocol_enabled_v5(
        &mut v5_config,
        &protocol_admin,
        false,
    );
    cancel_unsealed_maker_profile_v6(
        profile,
        &root,
        &cap,
        &config,
        &v5_config,
        &mut registry,
        &ctx,
    );

    commerce::update_protocol_enabled_v5(
        &mut v5_config,
        &protocol_admin,
        true,
    );
    update_protocol_enabled_v6(
        &mut config,
        &v5_config,
        &protocol_admin,
        true,
    );
    let replacement = new_maker_profile_v6_for_testing(
        &root,
        &cap,
        &config,
        &mut registry,
        PROFILE_COMPOSABLE,
        true,
        THIRD_PARTY_OPEN,
        test_commitment(5),
        test_commitment(6),
        b"walrus-replacement-profile".to_string(),
        test_commitment(7),
        test_commitment(8),
        &mut ctx,
    );
    cancel_unsealed_maker_profile_v6(
        replacement,
        &root,
        &cap,
        &config,
        &v5_config,
        &mut registry,
        &ctx,
    );
    destroy_composition_protocol_v6_for_testing(
        config,
        treasury,
        registry,
        admin,
        validator,
    );
    sui::clock::destroy_for_testing(clock);
    commerce::destroy_v5_world_for_testing(
        legacy_profile,
        maker,
        legacy_treasury,
        legacy_config,
        legacy_protocol_treasury,
        protocol_admin,
        v5_config,
        v5_protocol_treasury,
        root,
        v5_maker_treasury,
        vault,
        cap,
    );
}

#[test]
fun composable_profile_enforces_admission_entitlement_lock_and_one_shot_auth() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 601, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (
        legacy_profile,
        maker,
        legacy_treasury,
        legacy_config,
        legacy_protocol_treasury,
        protocol_admin,
        mut v5_config,
        v5_protocol_treasury,
        mut root,
        v5_maker_treasury,
        vault,
        cap,
    ) = commerce::v5_world_for_testing(
        commerce::new_completion_policy(commerce::policy_unlimited_free(), 0, 0),
        &mut ctx,
        &clock,
    );
    activate_v5_for_composition_testing(
        &mut root,
        &cap,
        &maker,
        &mut v5_config,
        &protocol_admin,
        &ctx,
    );

    let (
        mut config,
        mut protocol_treasury,
        mut registry,
        admin,
        validator,
    ) = new_composition_protocol_v6_for_testing<sui::sui::SUI>(
        &v5_config,
        &protocol_admin,
        test_commitment(90),
        &mut ctx,
    );
    bind_soul_owner_proof_type_v6<TrustedSoulOwnerProofV6>(
        &mut config,
        &v5_config,
        &protocol_admin,
    );
    update_protocol_enabled_v6(
        &mut config,
        &v5_config,
        &protocol_admin,
        true,
    );
    let mut profile = new_maker_profile_v6_for_testing(
        &root,
        &cap,
        &config,
        &mut registry,
        PROFILE_COMPOSABLE,
        true,
        THIRD_PARTY_OPEN,
        test_commitment(1),
        test_commitment(2),
        b"walrus-companion-v6".to_string(),
        test_commitment(3),
        test_commitment(4),
        &mut ctx,
    );
    assert!(
        *profile_companion_manifest_blob_id_v6(&profile)
            == b"walrus-companion-v6".to_string(),
        99,
    );
    assert!(
        *profile_companion_manifest_hash_v6(&profile) == test_commitment(3),
        99,
    );
    seal_maker_profile_v6(&mut profile, &root, &cap, &config, &v5_config, &ctx);

    let official = new_official_item_product_v6_for_testing(
        &profile,
        &root,
        &cap,
        &config,
        test_commitment(10),
        test_commitment(11),
        test_commitment(12),
        b"hair".to_string(),
        ACCESS_FREE,
        BINDING_OWNED,
        0,
        500,
        true,
        vector[],
        vector[],
        test_commitment(13),
        &mut ctx,
    );
    let certified = new_external_item_product_v6_for_testing(
        &profile,
        &config,
        ORIGIN_CERTIFIED,
        test_commitment(20),
        test_commitment(21),
        test_commitment(22),
        b"outfit".to_string(),
        RIGHTS_LICENSE_WRAPPED,
        ACCESS_PAID,
        BINDING_SOUL,
        1_000,
        500,
        false,
        vector[],
        vector[],
        test_commitment(23),
        &mut ctx,
    );
    let open = new_external_item_product_v6_for_testing(
        &profile,
        &config,
        ORIGIN_OPEN,
        test_commitment(30),
        test_commitment(31),
        test_commitment(32),
        b"accessory".to_string(),
        RIGHTS_ONCHAIN_NATIVE,
        ACCESS_FREE,
        BINDING_SOUL,
        0,
        0,
        false,
        vector[object::id(&official)],
        vector[],
        test_commitment(33),
        &mut ctx,
    );
    let official_attestation = new_validator_attestation_v6_for_testing(
        &config,
        &validator,
        &profile,
        &official,
        &clock,
        &mut ctx,
    );
    let certified_attestation = new_validator_attestation_v6_for_testing(
        &config,
        &validator,
        &profile,
        &certified,
        &clock,
        &mut ctx,
    );
    let open_attestation = new_validator_attestation_v6_for_testing(
        &config,
        &validator,
        &profile,
        &open,
        &clock,
        &mut ctx,
    );
    admit_official_item_v6(
        &mut profile,
        &official,
        &official_attestation,
        &root,
        &cap,
        &config,
        &v5_config,
        &clock,
        &ctx,
    );
    admit_certified_item_v6(
        &mut profile,
        &certified,
        &certified_attestation,
        &root,
        &cap,
        &config,
        &v5_config,
        &clock,
        &ctx,
    );
    admit_open_item_v6(
        &mut profile,
        &open,
        &open_attestation,
        &config,
        &v5_config,
        &clock,
        &ctx,
    );
    assert!(admission_source_kind_v6(&profile, object::id(&official)) == ADMISSION_OFFICIAL);
    assert!(admission_source_kind_v6(&profile, object::id(&certified)) == ADMISSION_CERTIFIED);
    assert!(admission_source_kind_v6(&profile, object::id(&open)) == ADMISSION_OPEN);
    assert!(product_origin_kind_v6(&official) == ORIGIN_OFFICIAL, 99);
    assert!(product_origin_kind_v6(&certified) == ORIGIN_CERTIFIED, 99);
    assert!(product_origin_kind_v6(&open) == ORIGIN_OPEN, 99);
    assert!(product_original_creator_v6(&official) == commerce::root_current_owner_v5(&root));
    assert!(admission_active_v6(&profile, object::id(&official)));
    deactivate_item_admission_v6(
        &mut profile,
        object::id(&official),
        &config,
        &v5_config,
        &protocol_admin,
        &admin,
        &ctx,
    );
    assert!(!admission_active_v6(&profile, object::id(&official)));
    reactivate_item_admission_v6(
        &mut profile,
        &official,
        &official_attestation,
        &config,
        &v5_config,
        &protocol_admin,
        &admin,
        &ctx,
    );
    assert!(admission_active_v6(&profile, object::id(&official)));

    let mut owned = claim_free_wallet_item_v6_for_testing(
        &mut registry,
        &config,
        &profile,
        &official,
        &root,
        &v5_config,
        &clock,
        &mut ctx,
    ).destroy_some();
    let soul_id = object::id_from_address(@0x5001);
    lock_owned_item_to_soul_v6(
        &mut registry,
        &config,
        &profile,
        &root,
        &v5_config,
        &mut owned,
        soul_id,
        trusted_soul_owner_proof_v6(),
        &ctx,
    );
    assert!(soul_owned_lock_count_v6(&registry, soul_id) == 1, 99);
    update_protocol_enabled_v6(
        &mut config,
        &v5_config,
        &protocol_admin,
        false,
    );
    commerce::update_protocol_enabled_v5(
        &mut v5_config,
        &protocol_admin,
        false,
    );
    unlock_owned_item_from_soul_v6(
        &mut registry,
        &config,
        &profile,
        &root,
        &v5_config,
        &mut owned,
        soul_id,
        trusted_soul_owner_proof_v6(),
        &ctx,
    );
    assert!(soul_owned_lock_count_v6(&registry, soul_id) == 0, 99);
    commerce::update_protocol_enabled_v5(
        &mut v5_config,
        &protocol_admin,
        true,
    );
    update_protocol_enabled_v6(
        &mut config,
        &v5_config,
        &protocol_admin,
        true,
    );
    lock_owned_item_to_soul_v6(
        &mut registry,
        &config,
        &profile,
        &root,
        &v5_config,
        &mut owned,
        soul_id,
        trusted_soul_owner_proof_v6(),
        &ctx,
    );
    assert!(soul_owned_lock_count_v6(&registry, soul_id) == 1, 99);
    let payment = coin::from_balance(
        balance::create_for_testing<sui::sui::SUI>(1_000),
        &mut ctx,
    );
    purchase_soul_item_v6(
        &mut registry,
        &config,
        &mut protocol_treasury,
        &profile,
        &certified,
        &root,
        &v5_config,
        soul_id,
        trusted_soul_owner_proof_v6(),
        payment,
        &clock,
        &mut ctx,
    );
    claim_free_soul_item_v6(
        &mut registry,
        &config,
        &profile,
        &open,
        &root,
        &v5_config,
        soul_id,
        trusted_soul_owner_proof_v6(),
        &clock,
        &ctx,
    );
    assert!(protocol_treasury_balance_v6(&protocol_treasury) == 100);
    assert!(soul_entitlement_exists_v6(
        &registry,
        object::id(&profile),
        object::id(&certified),
        soul_id,
    ));

    let selections = vector[
        new_loadout_selection_v6(
            object::id(&official),
            b"hair".to_string(),
            SUBJECT_WALLET,
            option::some(object::id(&owned)),
        ),
        new_loadout_selection_v6(
            object::id(&certified),
            b"outfit".to_string(),
            SUBJECT_SOUL,
            option::none(),
        ),
        new_loadout_selection_v6(
            object::id(&open),
            b"accessory".to_string(),
            SUBJECT_SOUL,
            option::none(),
        ),
    ];
    let loadout_hash = hash_loadout_selections_v6(&selections);
    let authorization = authorize_loadout_v6(
        &mut registry,
        &config,
        &profile,
        &root,
        &v5_config,
        soul_id,
        test_commitment(70),
        loadout_hash,
        selections,
        trusted_soul_owner_proof_v6(),
        &ctx,
    );
    assert!(loadout_authorization_wallet_bound_count_v6(&authorization) == 1);
    let (
        authorized_profile_id,
        authorized_root_id,
        authorized_soul_id,
        authorizer,
        nonce,
        authorized_hash,
        slot_commitment,
        authorized_selections,
        wallet_bound_count,
        version,
    ) = consume_loadout_authorization_v6(authorization);
    assert!(authorized_profile_id == object::id(&profile));
    assert!(authorized_root_id == object::id(&root));
    assert!(authorized_soul_id == soul_id);
    assert!(authorizer == @0xA11);
    assert!(nonce.length() == 32 && authorized_hash.length() == 32);
    assert!(slot_commitment == test_commitment(1));
    assert!(authorized_selections.length() == 3);
    assert!(wallet_bound_count == 1 && version == VERSION);

    unlock_owned_item_from_soul_v6(
        &mut registry,
        &config,
        &profile,
        &root,
        &v5_config,
        &mut owned,
        soul_id,
        trusted_soul_owner_proof_v6(),
        &ctx,
    );
    assert!(soul_owned_lock_count_v6(&registry, soul_id) == 0, 99);
    let transferable_selections = vector[new_loadout_selection_v6(
        object::id(&certified),
        b"outfit".to_string(),
        SUBJECT_SOUL,
        option::none(),
    )];
    let transferable_hash = hash_loadout_selections_v6(
        &transferable_selections,
    );
    assert_secondary_market_loadout_v6(
        &registry,
        &config,
        &profile,
        &root,
        &v5_config,
        soul_id,
        &transferable_hash,
        &transferable_selections,
    );
    transfer_owned_item_v6(
        &mut registry,
        &config,
        &profile,
        &root,
        &v5_config,
        owned,
        @0xB11,
        &ctx,
    );
    assert!(!wallet_entitlement_exists_v6(
        &registry,
        object::id(&profile),
        object::id(&official),
        @0xA11,
    ));
    assert!(wallet_entitlement_exists_v6(
        &registry,
        object::id(&profile),
        object::id(&official),
        @0xB11,
    ));
    destroy_validator_attestation_v6_for_testing(official_attestation);
    destroy_validator_attestation_v6_for_testing(certified_attestation);
    destroy_validator_attestation_v6_for_testing(open_attestation);
    destroy_item_product_v6_for_testing(official);
    destroy_item_product_v6_for_testing(certified);
    destroy_item_product_v6_for_testing(open);
    destroy_profile_v6_for_testing(profile);
    destroy_composition_protocol_v6_for_testing(
        config,
        protocol_treasury,
        registry,
        admin,
        validator,
    );
    sui::clock::destroy_for_testing(clock);
    commerce::destroy_v5_world_for_testing(
        legacy_profile,
        maker,
        legacy_treasury,
        legacy_config,
        legacy_protocol_treasury,
        protocol_admin,
        v5_config,
        v5_protocol_treasury,
        root,
        v5_maker_treasury,
        vault,
        cap,
    );
}

#[test_only]
fun exercise_secondary_market_guard(stage: u8) {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 609, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (
        legacy_profile,
        maker,
        legacy_treasury,
        legacy_config,
        legacy_protocol_treasury,
        protocol_admin,
        mut v5_config,
        v5_protocol_treasury,
        mut root,
        v5_maker_treasury,
        vault,
        cap,
    ) = commerce::v5_world_for_testing(
        commerce::new_completion_policy(
            commerce::policy_unlimited_free(),
            0,
            0,
        ),
        &mut ctx,
        &clock,
    );
    activate_v5_for_composition_testing(
        &mut root,
        &cap,
        &maker,
        &mut v5_config,
        &protocol_admin,
        &ctx,
    );
    let (
        mut config,
        protocol_treasury,
        mut registry,
        admin,
        validator,
    ) = new_composition_protocol_v6_for_testing<sui::sui::SUI>(
        &v5_config,
        &protocol_admin,
        test_commitment(90),
        &mut ctx,
    );
    bind_soul_owner_proof_type_v6<TrustedSoulOwnerProofV6>(
        &mut config,
        &v5_config,
        &protocol_admin,
    );
    update_protocol_enabled_v6(
        &mut config,
        &v5_config,
        &protocol_admin,
        true,
    );
    let mut profile = new_maker_profile_v6_for_testing(
        &root,
        &cap,
        &config,
        &mut registry,
        PROFILE_COMPOSABLE,
        true,
        THIRD_PARTY_OFFICIAL_ONLY,
        test_commitment(1),
        test_commitment(2),
        b"walrus-secondary-guard-v6".to_string(),
        test_commitment(3),
        test_commitment(4),
        &mut ctx,
    );
    seal_maker_profile_v6(
        &mut profile,
        &root,
        &cap,
        &config,
        &v5_config,
        &ctx,
    );
    let embedded = new_official_item_product_v6_for_testing(
        &profile,
        &root,
        &cap,
        &config,
        test_commitment(10),
        test_commitment(11),
        test_commitment(12),
        b"body".to_string(),
        ACCESS_EMBEDDED,
        BINDING_EMBEDDED,
        0,
        0,
        false,
        vector[],
        vector[],
        test_commitment(13),
        &mut ctx,
    );
    let attestation = new_validator_attestation_v6_for_testing(
        &config,
        &validator,
        &profile,
        &embedded,
        &clock,
        &mut ctx,
    );
    admit_official_item_v6(
        &mut profile,
        &embedded,
        &attestation,
        &root,
        &cap,
        &config,
        &v5_config,
        &clock,
        &ctx,
    );
    let soul_id = object::id_from_address(@0x5009);
    let selections = vector[new_loadout_selection_v6(
        object::id(&embedded),
        b"body".to_string(),
        SUBJECT_EMBEDDED,
        option::none(),
    )];
    let loadout_hash = hash_loadout_selections_v6(&selections);

    if (stage == 1) {
        increment_soul_owned_lock_count(&mut registry, soul_id);
    } else if (stage == 2) {
        update_protocol_enabled_v6(
            &mut config,
            &v5_config,
            &protocol_admin,
            false,
        );
    } else if (stage == 3) {
        commerce::update_protocol_enabled_v5(
            &mut v5_config,
            &protocol_admin,
            false,
        );
    } else if (stage == 4) {
        deactivate_item_admission_v6(
            &mut profile,
            object::id(&embedded),
            &config,
            &v5_config,
            &protocol_admin,
            &admin,
            &ctx,
        );
    } else if (stage == 5) {
        // One unlocked Item must not make the Soul transferable while a
        // second removed Item is still locked to it.
        increment_soul_owned_lock_count(&mut registry, soul_id);
        increment_soul_owned_lock_count(&mut registry, soul_id);
        decrement_soul_owned_lock_count(&mut registry, soul_id);
    } else if (stage == 7) {
        commerce::pause_maker_v5(&mut root, &cap, &ctx);
    };

    let expected_hash = if (stage == 6) {
        test_commitment(91)
    } else {
        loadout_hash
    };
    assert_secondary_market_loadout_v6(
        &registry,
        &config,
        &profile,
        &root,
        &v5_config,
        soul_id,
        &expected_hash,
        &selections,
    );

    destroy_validator_attestation_v6_for_testing(attestation);
    destroy_item_product_v6_for_testing(embedded);
    destroy_profile_v6_for_testing(profile);
    destroy_composition_protocol_v6_for_testing(
        config,
        protocol_treasury,
        registry,
        admin,
        validator,
    );
    sui::clock::destroy_for_testing(clock);
    commerce::destroy_v5_world_for_testing(
        legacy_profile,
        maker,
        legacy_treasury,
        legacy_config,
        legacy_protocol_treasury,
        protocol_admin,
        v5_config,
        v5_protocol_treasury,
        root,
        v5_maker_treasury,
        vault,
        cap,
    );
}

#[test]
fun secondary_market_guard_accepts_live_embedded_loadout() {
    exercise_secondary_market_guard(0);
}

#[test, expected_failure(abort_code = 56, location = animacraft::composition_v6)]
fun secondary_market_guard_rejects_removed_but_still_locked_owned_item() {
    exercise_secondary_market_guard(1);
}

#[test, expected_failure(abort_code = 1, location = animacraft::composition_v6)]
fun secondary_market_guard_rejects_disabled_v6_protocol() {
    exercise_secondary_market_guard(2);
}

#[test, expected_failure]
fun secondary_market_guard_rejects_disabled_v5_protocol() {
    exercise_secondary_market_guard(3);
}

#[test, expected_failure(abort_code = 19, location = animacraft::composition_v6)]
fun secondary_market_guard_rejects_inactive_product_admission() {
    exercise_secondary_market_guard(4);
}

#[test, expected_failure(abort_code = 56, location = animacraft::composition_v6)]
fun secondary_market_guard_rejects_one_of_multiple_remaining_owned_locks() {
    exercise_secondary_market_guard(5);
}

#[test, expected_failure(abort_code = 42, location = animacraft::composition_v6)]
fun secondary_market_guard_rejects_noncanonical_selection_hash() {
    exercise_secondary_market_guard(6);
}

#[test]
fun secondary_market_guard_allows_existing_loadout_while_maker_paused() {
    exercise_secondary_market_guard(7);
}

#[test, expected_failure(abort_code = 24, location = animacraft::composition_v6)]
fun rotated_validator_cap_cannot_issue_new_attestations() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 6011, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (
        _legacy_profile,
        maker,
        _legacy_treasury,
        _legacy_config,
        _legacy_protocol_treasury,
        protocol_admin,
        mut v5_config,
        _v5_protocol_treasury,
        mut root,
        _v5_maker_treasury,
        _vault,
        cap,
    ) = commerce::v5_world_for_testing(
        commerce::new_completion_policy(commerce::policy_unlimited_free(), 0, 0),
        &mut ctx,
        &clock,
    );
    activate_v5_for_composition_testing(
        &mut root,
        &cap,
        &maker,
        &mut v5_config,
        &protocol_admin,
        &ctx,
    );
    let (mut config, _treasury, mut registry, admin, stale_validator) =
        new_composition_protocol_v6_for_testing<sui::sui::SUI>(
            &v5_config,
            &protocol_admin,
            test_commitment(90),
            &mut ctx,
        );
    bind_soul_owner_proof_type_v6<TrustedSoulOwnerProofV6>(
        &mut config,
        &v5_config,
        &protocol_admin,
    );
    let _current_validator = rotate_validator_v6_for_testing(
        &mut config,
        &v5_config,
        &protocol_admin,
        &admin,
        test_commitment(91),
        &mut ctx,
    );
    assert!(protocol_validator_epoch_v6(&config) == 1);
    update_protocol_enabled_v6(
        &mut config,
        &v5_config,
        &protocol_admin,
        true,
    );
    let profile = new_maker_profile_v6_for_testing(
        &root,
        &cap,
        &config,
        &mut registry,
        PROFILE_COMPOSABLE,
        true,
        THIRD_PARTY_OPEN,
        test_commitment(1),
        test_commitment(2),
        b"walrus-rotated-validator".to_string(),
        test_commitment(3),
        test_commitment(4),
        &mut ctx,
    );
    let product = new_official_item_product_v6_for_testing(
        &profile,
        &root,
        &cap,
        &config,
        test_commitment(10),
        test_commitment(11),
        test_commitment(12),
        b"hair".to_string(),
        ACCESS_FREE,
        BINDING_ACCOUNT,
        0,
        0,
        false,
        vector[],
        vector[],
        test_commitment(13),
        &mut ctx,
    );
    let _blocked = new_validator_attestation_v6_for_testing(
        &config,
        &stale_validator,
        &profile,
        &product,
        &clock,
        &mut ctx,
    );
    abort 99
}

#[test, expected_failure(abort_code = 1, location = animacraft::composition_v6)]
fun v6_player_paths_fail_while_protocol_gate_is_disabled() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 602, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (
        _legacy_profile,
        maker,
        _legacy_treasury,
        _legacy_config,
        _legacy_protocol_treasury,
        protocol_admin,
        mut v5_config,
        _v5_protocol_treasury,
        mut root,
        _v5_maker_treasury,
        _vault,
        cap,
    ) = commerce::v5_world_for_testing(
        commerce::new_completion_policy(commerce::policy_unlimited_free(), 0, 0),
        &mut ctx,
        &clock,
    );
    activate_v5_for_composition_testing(
        &mut root,
        &cap,
        &maker,
        &mut v5_config,
        &protocol_admin,
        &ctx,
    );
    let (mut config, _treasury, mut registry, _admin, validator) =
        new_composition_protocol_v6_for_testing<sui::sui::SUI>(
            &v5_config,
            &protocol_admin,
            test_commitment(90),
            &mut ctx,
        );
    bind_soul_owner_proof_type_v6<TrustedSoulOwnerProofV6>(
        &mut config,
        &v5_config,
        &protocol_admin,
    );
    update_protocol_enabled_v6(
        &mut config,
        &v5_config,
        &protocol_admin,
        true,
    );
    let mut profile = new_maker_profile_v6_for_testing(
        &root,
        &cap,
        &config,
        &mut registry,
        PROFILE_COMPOSABLE,
        false,
        THIRD_PARTY_OFFICIAL_ONLY,
        test_commitment(1),
        test_commitment(2),
        b"walrus-companion-disabled-test".to_string(),
        test_commitment(3),
        test_commitment(4),
        &mut ctx,
    );
    seal_maker_profile_v6(&mut profile, &root, &cap, &config, &v5_config, &ctx);
    let product = new_official_item_product_v6_for_testing(
        &profile,
        &root,
        &cap,
        &config,
        test_commitment(10),
        test_commitment(11),
        test_commitment(12),
        b"hair".to_string(),
        ACCESS_FREE,
        BINDING_ACCOUNT,
        0,
        0,
        false,
        vector[],
        vector[],
        test_commitment(13),
        &mut ctx,
    );
    let attestation = new_validator_attestation_v6_for_testing(
        &config,
        &validator,
        &profile,
        &product,
        &clock,
        &mut ctx,
    );
    admit_official_item_v6(
        &mut profile,
        &product,
        &attestation,
        &root,
        &cap,
        &config,
        &v5_config,
        &clock,
        &ctx,
    );
    update_protocol_enabled_v6(
        &mut config,
        &v5_config,
        &protocol_admin,
        false,
    );
    claim_free_wallet_item_v6(
        &mut registry,
        &config,
        &profile,
        &product,
        &root,
        &v5_config,
        &clock,
        &mut ctx,
    );
    abort 99
}

#[test_only]
fun exercise_open_admission_rejection(origin_mismatch: bool) {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 603, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (
        _legacy_profile,
        maker,
        _legacy_treasury,
        _legacy_config,
        _legacy_protocol_treasury,
        protocol_admin,
        mut v5_config,
        _v5_protocol_treasury,
        mut root,
        _v5_maker_treasury,
        _vault,
        cap,
    ) = commerce::v5_world_for_testing(
        commerce::new_completion_policy(commerce::policy_unlimited_free(), 0, 0),
        &mut ctx,
        &clock,
    );
    activate_v5_for_composition_testing(
        &mut root,
        &cap,
        &maker,
        &mut v5_config,
        &protocol_admin,
        &ctx,
    );
    let (mut config, _treasury, mut registry, _admin, validator) =
        new_composition_protocol_v6_for_testing<sui::sui::SUI>(
            &v5_config,
            &protocol_admin,
            test_commitment(90),
            &mut ctx,
        );
    bind_soul_owner_proof_type_v6<TrustedSoulOwnerProofV6>(
        &mut config,
        &v5_config,
        &protocol_admin,
    );
    update_protocol_enabled_v6(
        &mut config,
        &v5_config,
        &protocol_admin,
        true,
    );
    let mut profile = new_maker_profile_v6_for_testing(
        &root,
        &cap,
        &config,
        &mut registry,
        PROFILE_COMPOSABLE,
        false,
        THIRD_PARTY_OPEN,
        test_commitment(1),
        test_commitment(2),
        b"walrus-companion-attestation-test".to_string(),
        test_commitment(3),
        test_commitment(4),
        &mut ctx,
    );
    seal_maker_profile_v6(&mut profile, &root, &cap, &config, &v5_config, &ctx);
    let product_a = new_external_item_product_v6_for_testing(
        &profile,
        &config,
        ORIGIN_OPEN,
        test_commitment(10),
        test_commitment(11),
        test_commitment(12),
        b"hair".to_string(),
        RIGHTS_ONCHAIN_NATIVE,
        ACCESS_FREE,
        BINDING_ACCOUNT,
        0,
        0,
        false,
        vector[],
        vector[],
        test_commitment(13),
        &mut ctx,
    );
    let product_b = new_external_item_product_v6_for_testing(
        &profile,
        &config,
        if (origin_mismatch) { ORIGIN_CERTIFIED } else { ORIGIN_OPEN },
        test_commitment(20),
        test_commitment(21),
        test_commitment(22),
        b"outfit".to_string(),
        RIGHTS_ONCHAIN_NATIVE,
        ACCESS_FREE,
        BINDING_ACCOUNT,
        0,
        0,
        false,
        vector[],
        vector[],
        test_commitment(23),
        &mut ctx,
    );
    let attestation_a = new_validator_attestation_v6_for_testing(
        &config,
        &validator,
        &profile,
        &product_a,
        &clock,
        &mut ctx,
    );
    admit_open_item_v6(
        &mut profile,
        &product_b,
        &attestation_a,
        &config,
        &v5_config,
        &clock,
        &ctx,
    );
    abort 99
}

#[test, expected_failure(abort_code = 23, location = animacraft::composition_v6)]
fun open_admission_rejects_an_attestation_for_another_product() {
    exercise_open_admission_rejection(false)
}

#[test, expected_failure(abort_code = 59, location = animacraft::composition_v6)]
fun open_admission_rejects_certified_origin_product() {
    exercise_open_admission_rejection(true)
}

#[test, expected_failure(abort_code = 12, location = animacraft::composition_v6)]
fun fixed_profile_accepts_initial_binding_but_rejects_updates() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 604, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (
        _legacy_profile,
        maker,
        _legacy_treasury,
        _legacy_config,
        _legacy_protocol_treasury,
        protocol_admin,
        mut v5_config,
        _v5_protocol_treasury,
        mut root,
        _v5_maker_treasury,
        _vault,
        cap,
    ) = commerce::v5_world_for_testing(
        commerce::new_completion_policy(commerce::policy_unlimited_free(), 0, 0),
        &mut ctx,
        &clock,
    );
    activate_v5_for_composition_testing(
        &mut root,
        &cap,
        &maker,
        &mut v5_config,
        &protocol_admin,
        &ctx,
    );
    let (mut config, _treasury, mut registry, _admin, validator) =
        new_composition_protocol_v6_for_testing<sui::sui::SUI>(
            &v5_config,
            &protocol_admin,
            test_commitment(90),
            &mut ctx,
        );
    bind_soul_owner_proof_type_v6<TrustedSoulOwnerProofV6>(
        &mut config,
        &v5_config,
        &protocol_admin,
    );
    update_protocol_enabled_v6(
        &mut config,
        &v5_config,
        &protocol_admin,
        true,
    );
    let mut profile = new_maker_profile_v6_for_testing(
        &root,
        &cap,
        &config,
        &mut registry,
        PROFILE_FIXED,
        false,
        THIRD_PARTY_OFFICIAL_ONLY,
        test_commitment(1),
        test_commitment(2),
        b"walrus-companion-fixed-test".to_string(),
        test_commitment(3),
        test_commitment(4),
        &mut ctx,
    );
    seal_maker_profile_v6(&mut profile, &root, &cap, &config, &v5_config, &ctx);
    let product = new_official_item_product_v6_for_testing(
        &profile,
        &root,
        &cap,
        &config,
        test_commitment(10),
        test_commitment(11),
        test_commitment(12),
        b"portrait".to_string(),
        ACCESS_EMBEDDED,
        BINDING_EMBEDDED,
        0,
        0,
        false,
        vector[],
        vector[],
        test_commitment(13),
        &mut ctx,
    );
    let attestation = new_validator_attestation_v6_for_testing(
        &config,
        &validator,
        &profile,
        &product,
        &clock,
        &mut ctx,
    );
    admit_official_item_v6(
        &mut profile,
        &product,
        &attestation,
        &root,
        &cap,
        &config,
        &v5_config,
        &clock,
        &ctx,
    );
    let initial_selections = vector[new_loadout_selection_v6(
        object::id(&product),
        b"portrait".to_string(),
        SUBJECT_EMBEDDED,
        option::none(),
    )];
    let initial_hash = hash_loadout_selections_v6(&initial_selections);
    let initial_authorization = authorize_initial_loadout_v6(
        &mut registry,
        &config,
        &profile,
        &root,
        &v5_config,
        object::id_from_address(@0x5002),
        test_commitment(70),
        initial_hash,
        initial_selections,
        trusted_soul_owner_proof_v6(),
        &ctx,
    );
    consume_initial_loadout_authorization_v6(initial_authorization);

    let update_selections = vector[new_loadout_selection_v6(
        object::id(&product),
        b"portrait".to_string(),
        SUBJECT_EMBEDDED,
        option::none(),
    )];
    let update_hash = hash_loadout_selections_v6(&update_selections);
    let authorization = authorize_loadout_v6(
        &mut registry,
        &config,
        &profile,
        &root,
        &v5_config,
        object::id_from_address(@0x5002),
        test_commitment(71),
        update_hash,
        update_selections,
        trusted_soul_owner_proof_v6(),
        &ctx,
    );
    consume_loadout_authorization_v6(authorization);
    abort 99
}
