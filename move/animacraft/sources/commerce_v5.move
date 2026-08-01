module animacraft::commerce_v5;

use animacraft::animacraft::{
    Self as legacy,
    CanonicalSoulMintAuthorization,
    CreatorProfile,
    MakerAdminCap,
    MakerTreasury,
    OCMaker,
    ProtocolFeeAdminCap,
    ProtocolFeeConfig,
    ProtocolTreasury,
    RecipeSlot,
};
use std::bcs;
use std::hash;
use std::option::{Self as option, Option};
use std::string::{Self as string, String};
use std::type_name;
use sui::balance::{Self as balance, Balance};
use sui::clock::Clock;
use sui::coin::{Self as coin, Coin};
use sui::event;
use sui::table::{Self as table, Table};

const VERSION: u64 = 5;
const BPS_DENOMINATOR: u64 = 10_000;
const PRIMARY_PROTOCOL_FEE_BPS: u16 = 1_000;
const DEFAULT_MAKER_MARKET_FEE_BPS: u16 = 250;
const MAX_MAKER_MARKET_FEE_BPS: u16 = 1_000;
const MAX_SOUL_CREATOR_ROYALTY_BPS: u16 = 500;
const MAX_MAKER_RESALE_ROYALTY_BPS: u16 = 500;
const MAX_U64_AS_U128: u128 = 18_446_744_073_709_551_615;

const RIGHTS_ONCHAIN_NATIVE: u8 = 0;
const RIGHTS_LICENSE_WRAPPED: u8 = 1;

const LIFECYCLE_ACTIVE: u8 = 0;
const LIFECYCLE_PAUSED: u8 = 1;
const LIFECYCLE_ARCHIVED: u8 = 2;
const LIFECYCLE_SALE_PENDING: u8 = 3;

const POLICY_UNLIMITED_FREE: u8 = 0;
const POLICY_FREE_QUOTA_THEN_PAID: u8 = 1;
const POLICY_PAID_EVERY_TIME: u8 = 2;
const POLICY_FREE_QUOTA_THEN_BLOCK: u8 = 3;

const PACK_ACCESS_FREE: u8 = 0;
const PACK_ACCESS_PAID_ONCE: u8 = 1;

const PRODUCT_BASE: u8 = 0;
const PRODUCT_PACK: u8 = 1;

const STYLE_ROW_VISUAL: u8 = 0;
const STYLE_ROW_LOGICAL_NONE: u8 = 1;
const STYLE_ROW_LOGICAL_COLOR: u8 = 2;

const EInvalidRightsOrigin: u64 = 0;
const EInvalidLifecycle: u64 = 1;
const EInvalidPolicy: u64 = 2;
const EInvalidPackAccess: u64 = 3;
const EInvalidName: u64 = 4;
const EInvalidProtocolAdmin: u64 = 5;
const EProtocolDisabled: u64 = 6;
const EProtocolMismatch: u64 = 7;
const EPaymentCoinMismatch: u64 = 8;
const EInvalidControlCap: u64 = 9;
const ENotCurrentOwner: u64 = 10;
const ETreasuryMismatch: u64 = 11;
const ETreasuryNotEmpty: u64 = 12;
const EPackExists: u64 = 13;
const EPackMissing: u64 = 14;
const EPackInactive: u64 = 15;
const EEntitlementExists: u64 = 16;
const EEntitlementMissing: u64 = 17;
const EWrongPayment: u64 = 18;
const ECompletionBlocked: u64 = 19;
const EQuoteOverflow: u64 = 20;
const EFreePathRequiresZeroQuote: u64 = 21;
const EPaidPathRequiresPayment: u64 = 22;
const EListingMismatch: u64 = 23;
const EListingInactive: u64 = 24;
const ENotListingSeller: u64 = 25;
const EInvalidRoyalty: u64 = 26;
const EInvalidRecipient: u64 = 27;
const EInsufficientRevenue: u64 = 28;
const EInvalidRecipeHash: u64 = 29;
const EStyleRegistrySealed: u64 = 30;
const EStyleAlreadyExists: u64 = 31;
const EStyleMissing: u64 = 32;
const EStyleSelectionMismatch: u64 = 33;
const EStyleRegistryNotSealed: u64 = 34;
const ESealPolicyAlreadyBound: u64 = 35;
const ESealPolicyRequired: u64 = 36;
const ESealPolicyNotRequired: u64 = 37;
const EInvalidSealCommitment: u64 = 38;
const EProtectedStyleMissing: u64 = 39;
const ESealAssetCoverageMismatch: u64 = 40;
const EInvalidCompleteOutput: u64 = 41;
const ECompleteOutputExists: u64 = 42;
const ECompleteOutputAlreadyBound: u64 = 43;
const ECompleteOutputBindingMismatch: u64 = 44;
const EInvalidSoulId: u64 = 45;
const EInvalidStyleRowKind: u64 = 46;
const EInvalidLogicalStyle: u64 = 47;
const EProtocolDependencyAlreadyBound: u64 = 48;
const EProtocolDependencyMissing: u64 = 49;
const ESoulBindingProofMismatch: u64 = 50;

/// v5 protocol linkage. The canonical object starts disabled and must be
/// explicitly enabled by the existing v4 protocol AdminCap after review.
public struct CommerceProtocolConfigV5 has key {
    id: UID,
    version: u64,
    legacy_config_id: ID,
    legacy_admin_cap_id: ID,
    treasury_id: ID,
    payment_coin_type: String,
    primary_protocol_fee_bps: u16,
    fixed_complete_fee_atomic: u64,
    maker_market_fee_bps: u16,
    /// Protocol-governed public transparent PNG used exclusively by logical
    /// None and Smart Color projection rows. A Maker owner cannot substitute
    /// one of their visual Assets and call it a logical row.
    logical_auxiliary_blob_id: Option<String>,
    /// Defining TypeName of Soulidity's private-constructor, one-use adapter
    /// proof. Binding is disabled until governance anchors this exact type.
    soul_binding_proof_type: Option<String>,
    enabled: bool,
}

/// Protocol revenue for v5 Pack purchases, Complete fees, and Maker resale
/// fees. It is deliberately separate from the v4 treasury.
public struct CommerceProtocolTreasuryV5<phantom PaymentCoin> has key {
    id: UID,
    version: u64,
    config_id: ID,
    revenue: Balance<PaymentCoin>,
    total_primary_collected: u64,
    total_fixed_collected: u64,
    total_market_collected: u64,
    total_withdrawn: u64,
}

/// Creator-selected completion policy used independently by Base and each
/// Expansion Pack.
public struct CompletionPolicyV5 has copy, drop, store {
    mode: u8,
    free_quota_per_wallet: u64,
    price_atomic: u64,
    /// Zero means unlimited. A non-zero value caps successful Completes for
    /// this Base or Pack across every wallet.
    total_cap: u64,
}

public struct PackKeyV5 has copy, drop, store {
    name: String,
}

public struct PackRecordV5 has copy, drop, store {
    key: String,
    label: String,
    access_kind: u8,
    purchase_price_atomic: u64,
    complete_policy: CompletionPolicyV5,
    active: bool,
    entitlement_count: u64,
    complete_count: u64,
    style_count: u64,
    protected_style_count: u64,
}

public struct StyleBindingKeyV5 has copy, drop, store {
    part_key: String,
    item_key: String,
    style_key: String,
}

public struct StyleProductRecordV5 has copy, drop, store {
    /// None means Base; Some(pack_key) means the exact Style is Pack-gated.
    pack_key: Option<String>,
    /// Immutable Walrus blob committed by the published legacy Item. Paid
    /// Pack rows point at ciphertext blobs protected by the Seal v5 policy.
    asset_blob_id: String,
    /// Move-verified row kind. Only canonical auxiliary-backed None and Smart
    /// Color rows may be public in a paid release.
    row_kind: u8,
    /// Derived by Move from row kind and Base/Pack access. It is never accepted
    /// from a client.
    seal_protected: bool,
}

public struct StyleSelectionV5 has copy, drop, store {
    part_key: String,
    item_key: String,
    style_key: String,
}

public struct CompleteSelectionHashInputV5 has copy, drop, store {
    recipe: vector<RecipeSlot>,
    style_selections: vector<StyleSelectionV5>,
}

public struct EntitlementKeyV5 has copy, drop, store {
    pack_key: String,
    wallet: address,
}

public struct EntitlementRecordV5 has copy, drop, store {
    granted_at_ms: u64,
    paid_atomic: u64,
    ownership_epoch: u64,
}

public struct CompletionCountKeyV5 has copy, drop, store {
    wallet: address,
    product_kind: u8,
    product_key: String,
}

/// One successful Complete owns exactly one encrypted final PNG. The Walrus
/// object remains ciphertext. Before Soul minting, payer access is only a
/// same-PTB transition state; authorization atomically binds the record to one
/// Soul, after which Soulidity's current-owner policy is the only Seal path.
public struct CompleteOutputRecordV5 has copy, drop, store {
    seal_id: vector<u8>,
    payer: address,
    recipe_hash: vector<u8>,
    output_nonce: vector<u8>,
    output_digest: vector<u8>,
    ciphertext_blob_id: String,
    bound_soul_id: Option<ID>,
}

/// Exact BCS identity mirrored by Seal and the web client. The ciphertext
/// Walrus ID is bound separately after encryption, avoiding a circular hash.
public struct CompleteOutputIdentityV5 has copy, drop, store {
    root_id: ID,
    payer: address,
    recipe_hash: vector<u8>,
    output_nonce: vector<u8>,
    output_digest: vector<u8>,
}

/// A one-use witness carried by the non-drop Complete authorization. Soulidity
/// consumes it in the same PTB as Soul creation, then binds this exact encrypted
/// output to the newly created Soul. With no abilities, callers cannot copy,
/// discard, store, or forge the witness outside this module.
public struct CompleteOutputSoulBindingV5 {
    root_id: ID,
    seal_id: vector<u8>,
}

/// Mutable release counters and Seal binding grouped below one root field.
/// Sui Mainnet protocol 130 permits at most 32 fields per struct; keeping this
/// nine-field state in one `store` value leaves MakerRootV5 at 30 fields while
/// preserving the exact public accessors and lifecycle semantics.
public struct MakerRootReleaseStateV5 has store {
    pack_count: u64,
    paid_pack_count: u64,
    style_count: u64,
    style_registry_sealed: bool,
    protected_style_count: u64,
    seal_policy_id: Option<ID>,
    seal_release_commitment: vector<u8>,
    complete_output_count: u64,
    total_completes: u64,
}

/// Per-release Maker identity and all mutable v5 policy state. The legacy v4
/// Maker remains the immutable art/recipe source, while this shared Root
/// survives owner rotation. A new immutable Maker version receives a new Root.
public struct MakerRootV5 has key {
    id: UID,
    version: u64,
    legacy_maker_id: ID,
    legacy_treasury_id: ID,
    control_vault_id: ID,
    treasury_id: ID,
    protocol_config_id: ID,
    payment_coin_type: String,
    original_creator: address,
    current_owner: address,
    rights_origin: u8,
    lifecycle: u8,
    ownership_epoch: u64,
    current_control_cap_id: Option<ID>,
    active_listing_id: Option<ID>,
    soul_creator_royalty_bps: u16,
    maker_resale_royalty_bps: u16,
    base_access_kind: u8,
    base_purchase_price_atomic: u64,
    base_policy: CompletionPolicyV5,
    packs: Table<PackKeyV5, PackRecordV5>,
    pack_keys: vector<String>,
    style_registry: Table<StyleBindingKeyV5, StyleProductRecordV5>,
    /// Table is not iterable, so immutable keys are retained for a full
    /// adversarial re-audit before the registry can be sealed.
    style_keys: vector<StyleBindingKeyV5>,
    logical_auxiliary_blob_id: String,
    base_entitlement_registry: Table<address, EntitlementRecordV5>,
    entitlement_registry: Table<EntitlementKeyV5, EntitlementRecordV5>,
    completion_counts: Table<CompletionCountKeyV5, u64>,
    complete_outputs: Table<vector<u8>, CompleteOutputRecordV5>,
    /// A paid release binds exactly one immutable Seal policy before it can
    /// become Active. The policy object itself lives in `seal_v5`; keeping its
    /// ID and release commitment here makes chain state—not event discovery—
    /// the authoritative linkage.
    release: MakerRootReleaseStateV5,
}

/// Per-release Maker revenue vault. It follows MakerRootV5 across owner
/// transfer; a new immutable Maker version receives a separate vault.
public struct MakerTreasuryV5<phantom PaymentCoin> has key {
    id: UID,
    version: u64,
    root_id: ID,
    revenue: Balance<PaymentCoin>,
    total_pack_collected: u64,
    total_complete_collected: u64,
    total_withdrawn: u64,
}

/// Shared but opaque custody object for the transferable v4 MakerAdminCap.
/// No public function ever extracts the legacy cap.
public struct MakerControlVaultV5 has key {
    id: UID,
    version: u64,
    root_id: ID,
    legacy_maker_id: ID,
    legacy_admin_cap: MakerAdminCap,
}

/// Key-only authority. Without `store`, wallets cannot public-transfer or wrap
/// it; every owner rotation must pass through this module.
public struct MakerControlCapV5 has key {
    id: UID,
    version: u64,
    root_id: ID,
    ownership_epoch: u64,
}

/// Wallet-bound, key-only permanent access receipt for a paid whole Maker/Base.
public struct MakerAccessPassV5 has key {
    id: UID,
    version: u64,
    root_id: ID,
    holder: address,
    issued_at_ms: u64,
    ownership_epoch: u64,
}

/// Wallet-bound, key-only permanent Expansion Pack receipt.
public struct PackPassV5 has key {
    id: UID,
    version: u64,
    root_id: ID,
    pack_key: String,
    holder: address,
    issued_at_ms: u64,
    ownership_epoch: u64,
}

/// Shared listing tombstone. The key-only control cap is consumed when the
/// listing opens, so no concurrent admin path exists during a sale.
public struct MakerListingV5 has key {
    id: UID,
    version: u64,
    root_id: ID,
    seller: address,
    price_atomic: u64,
    ownership_epoch: u64,
    protocol_fee_bps: u16,
    maker_resale_royalty_bps: u16,
    active: bool,
}

public struct CompleteQuoteV5 has copy, drop, store {
    creator_charge_atomic: u64,
    protocol_percentage_atomic: u64,
    fixed_protocol_fee_atomic: u64,
    maker_receives_atomic: u64,
    total_due_atomic: u64,
    used_pack_count: u64,
}

/// The only authorization Soulidity may consume for a commerce-v5 Soul.
/// The creator royalty is frozen from MakerRootV5; callers cannot substitute
/// a lower value while composing the cross-package mint PTB.
public struct CommerceV5SoulMintAuthorization {
    canonical: CanonicalSoulMintAuthorization,
    soul_creator_royalty_bps: u16,
    output_binding: CompleteOutputSoulBindingV5,
}

public struct CommerceProtocolV5Initialized has copy, drop {
    config_id: ID,
    treasury_id: ID,
    legacy_config_id: ID,
    payment_coin_type: String,
    enabled: bool,
}

public struct LogicalAuxiliaryBlobBoundV5 has copy, drop {
    config_id: ID,
    blob_id: String,
}

public struct SoulBindingProofTypeBoundV5 has copy, drop {
    config_id: ID,
    proof_type: String,
}

public struct LegacyMakerMigratedToV5 has copy, drop {
    root_id: ID,
    legacy_maker_id: ID,
    legacy_treasury_id: ID,
    treasury_id: ID,
    vault_id: ID,
    control_cap_id: ID,
    owner: address,
    rights_origin: u8,
    soul_creator_royalty_bps: u16,
    maker_resale_royalty_bps: u16,
}

public struct MakerLifecycleChangedV5 has copy, drop {
    root_id: ID,
    owner: address,
    previous: u8,
    current: u8,
    ownership_epoch: u64,
}

public struct PackConfiguredV5 has copy, drop {
    root_id: ID,
    pack_key: String,
    access_kind: u8,
    active: bool,
}

public struct PackEntitlementGrantedV5 has copy, drop {
    root_id: ID,
    pack_key: String,
    holder: address,
    paid_atomic: u64,
    pack_pass_id: ID,
}

public struct MakerAccessGrantedV5 has copy, drop {
    root_id: ID,
    holder: address,
    paid_atomic: u64,
    access_pass_id: ID,
}

public struct CompleteAuthorizedV5 has copy, drop {
    root_id: ID,
    legacy_maker_id: ID,
    payer: address,
    creator_charge_atomic: u64,
    protocol_percentage_atomic: u64,
    fixed_protocol_fee_atomic: u64,
    total_paid_atomic: u64,
    ownership_epoch: u64,
    output_seal_id: vector<u8>,
    output_nonce: vector<u8>,
    output_digest: vector<u8>,
    ciphertext_blob_id: String,
}

public struct CompleteOutputBoundToSoulV5 has copy, drop {
    root_id: ID,
    seal_id: vector<u8>,
    soul_id: ID,
    payer: address,
}

public struct MakerListingOpenedV5 has copy, drop {
    root_id: ID,
    listing_id: ID,
    seller: address,
    price_atomic: u64,
    ownership_epoch: u64,
}

public struct MakerListingCancelledV5 has copy, drop {
    root_id: ID,
    listing_id: ID,
    seller: address,
    control_cap_id: ID,
}

public struct MakerPurchasedV5 has copy, drop {
    root_id: ID,
    listing_id: ID,
    seller: address,
    buyer: address,
    price_atomic: u64,
    protocol_fee_atomic: u64,
    original_creator_royalty_atomic: u64,
    ownership_epoch: u64,
    control_cap_id: ID,
}

public fun protocol_version(): u64 {
    VERSION
}

public fun rights_onchain_native(): u8 {
    RIGHTS_ONCHAIN_NATIVE
}

public fun rights_license_wrapped(): u8 {
    RIGHTS_LICENSE_WRAPPED
}

public fun lifecycle_active(): u8 {
    LIFECYCLE_ACTIVE
}

public fun lifecycle_paused(): u8 {
    LIFECYCLE_PAUSED
}

public fun lifecycle_archived(): u8 {
    LIFECYCLE_ARCHIVED
}

public fun lifecycle_sale_pending(): u8 {
    LIFECYCLE_SALE_PENDING
}

public fun policy_unlimited_free(): u8 {
    POLICY_UNLIMITED_FREE
}

public fun policy_free_quota_then_paid(): u8 {
    POLICY_FREE_QUOTA_THEN_PAID
}

public fun policy_paid_every_time(): u8 {
    POLICY_PAID_EVERY_TIME
}

public fun policy_free_quota_then_block(): u8 {
    POLICY_FREE_QUOTA_THEN_BLOCK
}

public fun pack_access_free(): u8 {
    PACK_ACCESS_FREE
}

public fun pack_access_paid_once(): u8 {
    PACK_ACCESS_PAID_ONCE
}

public fun style_row_visual_v5(): u8 {
    STYLE_ROW_VISUAL
}

public fun style_row_logical_none_v5(): u8 {
    STYLE_ROW_LOGICAL_NONE
}

public fun style_row_logical_color_v5(): u8 {
    STYLE_ROW_LOGICAL_COLOR
}

public fun max_maker_resale_royalty_bps_v5(): u16 {
    MAX_MAKER_RESALE_ROYALTY_BPS
}

public fun new_completion_policy(
    mode: u8,
    free_quota_per_wallet: u64,
    price_atomic: u64,
): CompletionPolicyV5 {
    new_completion_policy_with_cap(
        mode,
        free_quota_per_wallet,
        price_atomic,
        0,
    )
}

public fun new_completion_policy_with_cap(
    mode: u8,
    free_quota_per_wallet: u64,
    price_atomic: u64,
    total_cap: u64,
): CompletionPolicyV5 {
    assert_valid_completion_policy(mode, free_quota_per_wallet, price_atomic);
    CompletionPolicyV5 {
        mode,
        free_quota_per_wallet,
        price_atomic,
        total_cap,
    }
}

public fun completion_policy_mode(self: &CompletionPolicyV5): u8 {
    self.mode
}

public fun completion_policy_free_quota(self: &CompletionPolicyV5): u64 {
    self.free_quota_per_wallet
}

public fun completion_policy_price(self: &CompletionPolicyV5): u64 {
    self.price_atomic
}

public fun completion_policy_total_cap(self: &CompletionPolicyV5): u64 {
    self.total_cap
}

fun new_protocol_objects<PaymentCoin>(
    legacy_config: &ProtocolFeeConfig,
    legacy_admin: &mut ProtocolFeeAdminCap,
    ctx: &mut TxContext,
): (CommerceProtocolConfigV5, CommerceProtocolTreasuryV5<PaymentCoin>) {
    legacy::claim_commerce_v5_initializer(legacy_config, legacy_admin);
    let config_uid = object::new(ctx);
    let config_id = config_uid.to_inner();
    let treasury = CommerceProtocolTreasuryV5<PaymentCoin> {
        id: object::new(ctx),
        version: VERSION,
        config_id,
        revenue: balance::zero(),
        total_primary_collected: 0,
        total_fixed_collected: 0,
        total_market_collected: 0,
        total_withdrawn: 0,
    };
    let config = CommerceProtocolConfigV5 {
        id: config_uid,
        version: VERSION,
        legacy_config_id: object::id(legacy_config),
        legacy_admin_cap_id: object::id(legacy_admin),
        treasury_id: object::id(&treasury),
        payment_coin_type: payment_coin_type_name<PaymentCoin>(),
        primary_protocol_fee_bps: PRIMARY_PROTOCOL_FEE_BPS,
        fixed_complete_fee_atomic: 0,
        maker_market_fee_bps: DEFAULT_MAKER_MARKET_FEE_BPS,
        logical_auxiliary_blob_id: option::none(),
        soul_binding_proof_type: option::none(),
        enabled: false,
    };
    (config, treasury)
}

/// Initializes the canonical v5 protocol pair. The one-time marker is written
/// to the existing v4 ProtocolFeeAdminCap, and both v5 objects start shared and
/// disabled. This function performs no deployment and cannot enable commerce.
public fun initialize_commerce_protocol_v5<PaymentCoin>(
    legacy_config: &ProtocolFeeConfig,
    legacy_admin: &mut ProtocolFeeAdminCap,
    ctx: &mut TxContext,
) {
    let (config, treasury) =
        new_protocol_objects<PaymentCoin>(legacy_config, legacy_admin, ctx);
    event::emit(CommerceProtocolV5Initialized {
        config_id: object::id(&config),
        treasury_id: object::id(&treasury),
        legacy_config_id: object::id(legacy_config),
        payment_coin_type: payment_coin_type_name<PaymentCoin>(),
        enabled: false,
    });
    transfer::share_object(config);
    transfer::share_object(treasury);
}

#[test_only]
public fun new_commerce_protocol_v5_for_testing<PaymentCoin>(
    legacy_config: &ProtocolFeeConfig,
    legacy_admin: &mut ProtocolFeeAdminCap,
    ctx: &mut TxContext,
): (CommerceProtocolConfigV5, CommerceProtocolTreasuryV5<PaymentCoin>) {
    new_protocol_objects<PaymentCoin>(legacy_config, legacy_admin, ctx)
}

public fun update_protocol_enabled_v5(
    config: &mut CommerceProtocolConfigV5,
    legacy_admin: &ProtocolFeeAdminCap,
    enabled: bool,
) {
    assert_protocol_admin(config, legacy_admin);
    if (enabled) {
        assert_protocol_dependencies_bound(config);
    };
    config.enabled = enabled;
}

/// One-time protocol governance anchor for the public transparent PNG used by
/// projection-only None and Smart Color rows.
public fun bind_logical_auxiliary_blob_v5(
    config: &mut CommerceProtocolConfigV5,
    legacy_admin: &ProtocolFeeAdminCap,
    blob_id: String,
) {
    assert_protocol_admin(config, legacy_admin);
    assert!(!config.enabled, EProtocolDependencyAlreadyBound);
    assert!(
        config.logical_auxiliary_blob_id.is_none(),
        EProtocolDependencyAlreadyBound,
    );
    assert_non_empty(&blob_id);
    config.logical_auxiliary_blob_id = option::some(blob_id);
    event::emit(LogicalAuxiliaryBlobBoundV5 {
        config_id: object::id(config),
        blob_id,
    });
}

/// One-time protocol governance anchor for Soulidity's private-constructor
/// mint adapter proof. The defining TypeName remains stable across upgrades.
public fun bind_soul_binding_proof_type_v5<SoulBindingProof: drop>(
    config: &mut CommerceProtocolConfigV5,
    legacy_admin: &ProtocolFeeAdminCap,
) {
    assert_protocol_admin(config, legacy_admin);
    assert!(!config.enabled, EProtocolDependencyAlreadyBound);
    assert!(
        config.soul_binding_proof_type.is_none(),
        EProtocolDependencyAlreadyBound,
    );
    let proof_type = defining_type_name<SoulBindingProof>();
    config.soul_binding_proof_type = option::some(proof_type);
    event::emit(SoulBindingProofTypeBoundV5 {
        config_id: object::id(config),
        proof_type,
    });
}

public fun update_fixed_complete_fee_v5(
    config: &mut CommerceProtocolConfigV5,
    legacy_admin: &ProtocolFeeAdminCap,
    fee_atomic: u64,
) {
    assert_protocol_admin(config, legacy_admin);
    config.fixed_complete_fee_atomic = fee_atomic;
}

public fun update_maker_market_fee_bps_v5(
    config: &mut CommerceProtocolConfigV5,
    legacy_admin: &ProtocolFeeAdminCap,
    fee_bps: u16,
) {
    assert_protocol_admin(config, legacy_admin);
    assert!(fee_bps <= MAX_MAKER_MARKET_FEE_BPS, EInvalidProtocolAdmin);
    config.maker_market_fee_bps = fee_bps;
}

public fun protocol_config_id_v5(self: &CommerceProtocolConfigV5): ID {
    object::id(self)
}

public fun protocol_enabled_v5(self: &CommerceProtocolConfigV5): bool {
    self.enabled
}

public fun primary_protocol_fee_bps_v5(self: &CommerceProtocolConfigV5): u16 {
    self.primary_protocol_fee_bps
}

public fun fixed_complete_fee_v5(self: &CommerceProtocolConfigV5): u64 {
    self.fixed_complete_fee_atomic
}

public fun maker_market_fee_bps_v5(self: &CommerceProtocolConfigV5): u16 {
    self.maker_market_fee_bps
}

/// Narrow package-only bridge for additive protocol modules. Extension
/// modules must not duplicate v5 admin identity checks or infer authority from
/// a sender address alone.
public(package) fun assert_extension_protocol_admin_v5(
    config: &CommerceProtocolConfigV5,
    legacy_admin: &ProtocolFeeAdminCap,
) {
    assert_protocol_admin(config, legacy_admin);
}

/// Live upstream kill-switch check for additive protocol modules. Unlike the
/// Maker operational bridge, this intentionally does not require an Active
/// Maker lifecycle so governance may prepare or review a paused release while
/// still stopping every v6 write when the canonical v5 protocol is disabled.
public(package) fun assert_extension_protocol_enabled_v5(
    config: &CommerceProtocolConfigV5,
) {
    assert!(config.enabled, EProtocolDisabled);
    assert_protocol_dependencies_bound(config);
}

/// Narrow package-only bridge for release-scoped extension administration.
/// The epoch-bound key-only cap keeps extension writes frozen while a Maker
/// sale is pending and automatically rotates authority after purchase.
public(package) fun assert_extension_control_v5(
    root: &MakerRootV5,
    cap: &MakerControlCapV5,
    ctx: &TxContext,
) {
    assert_control(root, cap, ctx);
}

/// Narrow package-only bridge for player-facing extension actions. This keeps
/// v6 composition behind the same Active lifecycle, canonical v5 protocol
/// gate and payment-coin linkage as Complete.
public(package) fun assert_extension_operational_v5(
    root: &MakerRootV5,
    config: &CommerceProtocolConfigV5,
) {
    assert_operational(root, config);
}

public(package) fun extension_payment_coin_type_v5(
    config: &CommerceProtocolConfigV5,
): &String {
    &config.payment_coin_type
}

public fun protocol_logical_auxiliary_blob_id_v5(
    self: &CommerceProtocolConfigV5,
): &Option<String> {
    &self.logical_auxiliary_blob_id
}

public fun protocol_soul_binding_proof_type_v5(
    self: &CommerceProtocolConfigV5,
): &Option<String> {
    &self.soul_binding_proof_type
}

public fun protocol_treasury_balance_v5<PaymentCoin>(
    self: &CommerceProtocolTreasuryV5<PaymentCoin>,
): u64 {
    self.revenue.value()
}

public fun withdraw_protocol_revenue_v5<PaymentCoin>(
    config: &CommerceProtocolConfigV5,
    treasury: &mut CommerceProtocolTreasuryV5<PaymentCoin>,
    legacy_admin: &ProtocolFeeAdminCap,
    amount: u64,
    recipient: address,
    ctx: &mut TxContext,
) {
    assert_protocol_admin(config, legacy_admin);
    assert_protocol_treasury(config, treasury);
    assert!(recipient != @0x0, EInvalidRecipient);
    assert!(amount > 0 && amount <= treasury.revenue.value(), EInsufficientRevenue);
    let payment = coin::take(&mut treasury.revenue, amount, ctx);
    treasury.total_withdrawn = treasury.total_withdrawn + amount;
    transfer::public_transfer(payment, recipient);
}

fun new_migrated_maker_objects_v5<PaymentCoin>(
    legacy_maker: &mut OCMaker,
    legacy_treasury: &MakerTreasury<PaymentCoin>,
    legacy_cap: MakerAdminCap,
    protocol_config: &CommerceProtocolConfigV5,
    rights_origin: u8,
    base_policy: CompletionPolicyV5,
    soul_creator_royalty_bps: u16,
    maker_resale_royalty_bps: u16,
    clock: &Clock,
    ctx: &mut TxContext,
): (
    MakerRootV5,
    MakerTreasuryV5<PaymentCoin>,
    MakerControlVaultV5,
    MakerControlCapV5,
) {
    assert_valid_rights_origin(rights_origin);
    assert_valid_policy(&base_policy);
    assert_valid_soul_creator_royalty(soul_creator_royalty_bps);
    assert_valid_maker_resale_royalty(maker_resale_royalty_bps);
    assert_protocol_dependencies_bound(protocol_config);
    assert!(
        &payment_coin_type_name<PaymentCoin>() == &protocol_config.payment_coin_type,
        EPaymentCoinMismatch,
    );
    assert!(legacy::treasury_balance(legacy_treasury) == 0, ETreasuryNotEmpty);

    let legacy_cap = legacy::disable_legacy_minting_for_v5(
        legacy_cap,
        legacy_maker,
        legacy_treasury,
        clock,
        ctx,
    );
    let root_uid = object::new(ctx);
    let root_id = root_uid.to_inner();
    let treasury = MakerTreasuryV5<PaymentCoin> {
        id: object::new(ctx),
        version: VERSION,
        root_id,
        revenue: balance::zero(),
        total_pack_collected: 0,
        total_complete_collected: 0,
        total_withdrawn: 0,
    };
    let vault = MakerControlVaultV5 {
        id: object::new(ctx),
        version: VERSION,
        root_id,
        legacy_maker_id: object::id(legacy_maker),
        legacy_admin_cap: legacy_cap,
    };
    let control_cap = MakerControlCapV5 {
        id: object::new(ctx),
        version: VERSION,
        root_id,
        ownership_epoch: 0,
    };
    let control_cap_id = object::id(&control_cap);
    let root = MakerRootV5 {
        id: root_uid,
        version: VERSION,
        legacy_maker_id: object::id(legacy_maker),
        legacy_treasury_id: object::id(legacy_treasury),
        control_vault_id: object::id(&vault),
        treasury_id: object::id(&treasury),
        protocol_config_id: object::id(protocol_config),
        payment_coin_type: payment_coin_type_name<PaymentCoin>(),
        original_creator: legacy::maker_creator(legacy_maker),
        current_owner: ctx.sender(),
        rights_origin,
        lifecycle: LIFECYCLE_PAUSED,
        ownership_epoch: 0,
        current_control_cap_id: option::some(control_cap_id),
        active_listing_id: option::none(),
        soul_creator_royalty_bps,
        maker_resale_royalty_bps,
        base_access_kind: PACK_ACCESS_FREE,
        base_purchase_price_atomic: 0,
        base_policy,
        packs: table::new(ctx),
        pack_keys: vector[],
        style_registry: table::new(ctx),
        style_keys: vector[],
        logical_auxiliary_blob_id:
            *protocol_config.logical_auxiliary_blob_id.borrow(),
        base_entitlement_registry: table::new(ctx),
        entitlement_registry: table::new(ctx),
        completion_counts: table::new(ctx),
        complete_outputs: table::new(ctx),
        release: MakerRootReleaseStateV5 {
            pack_count: 0,
            paid_pack_count: 0,
            style_count: 0,
            style_registry_sealed: false,
            protected_style_count: 0,
            seal_policy_id: option::none(),
            seal_release_commitment: vector[],
            complete_output_count: 0,
            total_completes: 0,
        },
    };
    event::emit(LegacyMakerMigratedToV5 {
        root_id,
        legacy_maker_id: object::id(legacy_maker),
        legacy_treasury_id: object::id(legacy_treasury),
        treasury_id: object::id(&treasury),
        vault_id: object::id(&vault),
        control_cap_id,
        owner: ctx.sender(),
        rights_origin,
        soul_creator_royalty_bps,
        maker_resale_royalty_bps,
    });
    (root, treasury, vault, control_cap)
}

/// Migrates a published v4 Maker into the stable v5 Root/Treasury model.
/// Migration is intentionally paused: the operator must configure Base/Pack
/// policy and explicitly activate it. The legacy treasury must be empty.
public fun migrate_legacy_maker_v5<PaymentCoin>(
    legacy_maker: &mut OCMaker,
    legacy_treasury: &MakerTreasury<PaymentCoin>,
    legacy_cap: MakerAdminCap,
    protocol_config: &CommerceProtocolConfigV5,
    rights_origin: u8,
    base_policy: CompletionPolicyV5,
    soul_creator_royalty_bps: u16,
    maker_resale_royalty_bps: u16,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let (root, treasury, vault, control_cap) = new_migrated_maker_objects_v5(
        legacy_maker,
        legacy_treasury,
        legacy_cap,
        protocol_config,
        rights_origin,
        base_policy,
        soul_creator_royalty_bps,
        maker_resale_royalty_bps,
        clock,
        ctx,
    );
    transfer::share_object(root);
    transfer::share_object(treasury);
    transfer::share_object(vault);
    transfer::transfer(control_cap, ctx.sender());
}

#[test_only]
public fun new_migrated_maker_v5_for_testing<PaymentCoin>(
    legacy_maker: &mut OCMaker,
    legacy_treasury: &MakerTreasury<PaymentCoin>,
    legacy_cap: MakerAdminCap,
    protocol_config: &CommerceProtocolConfigV5,
    rights_origin: u8,
    base_policy: CompletionPolicyV5,
    soul_creator_royalty_bps: u16,
    maker_resale_royalty_bps: u16,
    clock: &Clock,
    ctx: &mut TxContext,
): (
    MakerRootV5,
    MakerTreasuryV5<PaymentCoin>,
    MakerControlVaultV5,
    MakerControlCapV5,
) {
    new_migrated_maker_objects_v5(
        legacy_maker,
        legacy_treasury,
        legacy_cap,
        protocol_config,
        rights_origin,
        base_policy,
        soul_creator_royalty_bps,
        maker_resale_royalty_bps,
        clock,
        ctx,
    )
}

#[test_only]
public fun share_root_v5_for_testing(root: MakerRootV5) {
    transfer::share_object(root);
}

public fun root_id_v5(self: &MakerRootV5): ID {
    object::id(self)
}

public fun root_legacy_maker_id_v5(self: &MakerRootV5): ID {
    self.legacy_maker_id
}

public fun root_legacy_treasury_id_v5(self: &MakerRootV5): ID {
    self.legacy_treasury_id
}

public fun root_treasury_id_v5(self: &MakerRootV5): ID {
    self.treasury_id
}

public fun root_original_creator_v5(self: &MakerRootV5): address {
    self.original_creator
}

public fun root_current_owner_v5(self: &MakerRootV5): address {
    self.current_owner
}

public fun root_rights_origin_v5(self: &MakerRootV5): u8 {
    self.rights_origin
}

public fun root_lifecycle_v5(self: &MakerRootV5): u8 {
    self.lifecycle
}

public fun root_ownership_epoch_v5(self: &MakerRootV5): u64 {
    self.ownership_epoch
}

public fun root_maker_resale_royalty_bps_v5(self: &MakerRootV5): u16 {
    self.maker_resale_royalty_bps
}

public fun root_soul_creator_royalty_bps_v5(self: &MakerRootV5): u16 {
    self.soul_creator_royalty_bps
}

public fun root_pack_count_v5(self: &MakerRootV5): u64 {
    self.release.pack_count
}

public fun root_paid_pack_count_v5(self: &MakerRootV5): u64 {
    self.release.paid_pack_count
}

public fun root_requires_seal_policy_v5(self: &MakerRootV5): bool {
    requires_seal_policy(self)
}

public fun root_seal_policy_id_v5(self: &MakerRootV5): Option<ID> {
    self.release.seal_policy_id
}

public fun root_seal_release_commitment_v5(
    self: &MakerRootV5,
): &vector<u8> {
    &self.release.seal_release_commitment
}

public fun root_seal_policy_bound_v5(self: &MakerRootV5): bool {
    self.release.seal_policy_id.is_some()
}

public fun root_protected_style_count_v5(self: &MakerRootV5): u64 {
    self.release.protected_style_count
}

public fun root_total_completes_v5(self: &MakerRootV5): u64 {
    self.release.total_completes
}

public fun root_complete_output_count_v5(self: &MakerRootV5): u64 {
    self.release.complete_output_count
}

public fun root_complete_outputs_table_id_v5(self: &MakerRootV5): ID {
    object::id(&self.complete_outputs)
}

public fun complete_output_exists_v5(
    root: &MakerRootV5,
    seal_id: vector<u8>,
): bool {
    root.complete_outputs.contains(seal_id)
}

public fun complete_output_record_v5(
    root: &MakerRootV5,
    seal_id: vector<u8>,
): &CompleteOutputRecordV5 {
    root.complete_outputs.borrow(seal_id)
}

public fun complete_output_seal_id_v5(
    self: &CompleteOutputRecordV5,
): &vector<u8> {
    &self.seal_id
}

public fun complete_output_payer_v5(
    self: &CompleteOutputRecordV5,
): address {
    self.payer
}

public fun complete_output_recipe_hash_v5(
    self: &CompleteOutputRecordV5,
): &vector<u8> {
    &self.recipe_hash
}

public fun complete_output_nonce_v5(
    self: &CompleteOutputRecordV5,
): &vector<u8> {
    &self.output_nonce
}

public fun complete_output_digest_v5(
    self: &CompleteOutputRecordV5,
): &vector<u8> {
    &self.output_digest
}

public fun complete_output_ciphertext_blob_id_v5(
    self: &CompleteOutputRecordV5,
): &String {
    &self.ciphertext_blob_id
}

public fun complete_output_bound_soul_id_v5(
    self: &CompleteOutputRecordV5,
): &Option<ID> {
    &self.bound_soul_id
}

public fun complete_output_is_soul_bound_v5(
    self: &CompleteOutputRecordV5,
): bool {
    self.bound_soul_id.is_some()
}

public fun complete_output_soul_binding_root_id_v5(
    binding: &CompleteOutputSoulBindingV5,
): ID {
    binding.root_id
}

public fun complete_output_soul_binding_seal_id_v5(
    binding: &CompleteOutputSoulBindingV5,
): &vector<u8> {
    &binding.seal_id
}

/// Permanently binds one encrypted Complete output to one Soul. The output
/// witness alone is insufficient: the caller must also consume the exact
/// private-constructor proof type anchored by protocol governance. Soulidity
/// creates that proof only after creating the Soul whose ID is supplied here,
/// in the same reviewed mint function and PTB.
public fun bind_complete_output_to_soul_v5<SoulBindingProof: drop>(
    root: &mut MakerRootV5,
    config: &CommerceProtocolConfigV5,
    binding: CompleteOutputSoulBindingV5,
    soul_id: ID,
    proof: SoulBindingProof,
) {
    assert!(root.protocol_config_id == object::id(config), EProtocolMismatch);
    assert!(
        config.soul_binding_proof_type.is_some(),
        EProtocolDependencyMissing,
    );
    assert!(
        &defining_type_name<SoulBindingProof>()
            == config.soul_binding_proof_type.borrow(),
        ESoulBindingProofMismatch,
    );
    let _proof = proof;
    let CompleteOutputSoulBindingV5 {
        root_id,
        seal_id,
    } = binding;
    assert!(
        root_id == object::id(root)
            && seal_id.length() == 32
            && root.complete_outputs.contains(copy seal_id),
        ECompleteOutputBindingMismatch,
    );
    assert!(
        soul_id != object::id_from_address(@0x0),
        EInvalidSoulId,
    );
    let output = root.complete_outputs.borrow_mut(copy seal_id);
    assert!(
        output.seal_id == seal_id,
        ECompleteOutputBindingMismatch,
    );
    assert!(
        output.bound_soul_id.is_none(),
        ECompleteOutputAlreadyBound,
    );
    let payer = output.payer;
    output.bound_soul_id = option::some(soul_id);
    event::emit(CompleteOutputBoundToSoulV5 {
        root_id,
        seal_id,
        soul_id,
        payer,
    });
}

public fun derive_complete_output_seal_id_v5(
    root_id: ID,
    payer: address,
    recipe_hash: vector<u8>,
    output_nonce: vector<u8>,
    output_digest: vector<u8>,
): vector<u8> {
    assert!(
        recipe_hash.length() == 32
            && output_nonce.length() == 32
            && output_digest.length() == 32,
        EInvalidCompleteOutput,
    );
    hash::sha2_256(bcs::to_bytes(&CompleteOutputIdentityV5 {
        root_id,
        payer,
        recipe_hash,
        output_nonce,
        output_digest,
    }))
}

public fun maker_treasury_balance_v5<PaymentCoin>(
    self: &MakerTreasuryV5<PaymentCoin>,
): u64 {
    self.revenue.value()
}

public fun activate_maker_v5(
    root: &mut MakerRootV5,
    cap: &MakerControlCapV5,
    ctx: &TxContext,
) {
    assert_control(root, cap, ctx);
    assert!(
        root.lifecycle == LIFECYCLE_PAUSED || root.lifecycle == LIFECYCLE_ARCHIVED,
        EInvalidLifecycle,
    );
    assert!(root.release.style_registry_sealed, EStyleRegistryNotSealed);
    if (requires_seal_policy(root)) {
        assert!(
            root.release.seal_policy_id.is_some()
                && root.release.seal_release_commitment.length() == 32,
            ESealPolicyRequired,
        );
    };
    set_lifecycle(root, LIFECYCLE_ACTIVE);
}

public fun pause_maker_v5(
    root: &mut MakerRootV5,
    cap: &MakerControlCapV5,
    ctx: &TxContext,
) {
    assert_control(root, cap, ctx);
    assert!(root.lifecycle == LIFECYCLE_ACTIVE, EInvalidLifecycle);
    set_lifecycle(root, LIFECYCLE_PAUSED);
}

public fun archive_maker_v5(
    root: &mut MakerRootV5,
    cap: &MakerControlCapV5,
    ctx: &TxContext,
) {
    assert_control(root, cap, ctx);
    assert!(
        root.lifecycle == LIFECYCLE_ACTIVE || root.lifecycle == LIFECYCLE_PAUSED,
        EInvalidLifecycle,
    );
    set_lifecycle(root, LIFECYCLE_ARCHIVED);
}

public fun update_base_policy_v5(
    root: &mut MakerRootV5,
    cap: &MakerControlCapV5,
    policy: CompletionPolicyV5,
    ctx: &TxContext,
) {
    assert_control(root, cap, ctx);
    assert_configurable(root);
    assert_release_terms_mutable(root);
    assert_valid_policy(&policy);
    root.base_policy = policy;
}

/// Configures whole Maker/Base access independently from Complete pricing.
/// FREE permits every wallet. PAID_ONCE requires a permanent MakerAccessPassV5
/// before Pack acquisition or Complete.
public fun update_base_access_v5(
    root: &mut MakerRootV5,
    cap: &MakerControlCapV5,
    access_kind: u8,
    purchase_price_atomic: u64,
    ctx: &TxContext,
) {
    assert_control(root, cap, ctx);
    assert_configurable(root);
    assert_release_terms_mutable(root);
    assert_valid_pack_access(access_kind, purchase_price_atomic);
    root.base_access_kind = access_kind;
    root.base_purchase_price_atomic = purchase_price_atomic;
}

public fun base_access_kind_v5(root: &MakerRootV5): u8 {
    root.base_access_kind
}

public fun base_purchase_price_v5(root: &MakerRootV5): u64 {
    root.base_purchase_price_atomic
}

public fun has_base_entitlement_v5(root: &MakerRootV5, wallet: address): bool {
    root.base_access_kind == PACK_ACCESS_FREE
        || root.base_entitlement_registry.contains(wallet)
}

public fun purchase_base_access_v5<PaymentCoin>(
    root: &mut MakerRootV5,
    maker_treasury: &mut MakerTreasuryV5<PaymentCoin>,
    config: &CommerceProtocolConfigV5,
    protocol_treasury: &mut CommerceProtocolTreasuryV5<PaymentCoin>,
    payment: Coin<PaymentCoin>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert_operational(root, config);
    assert_payment_linkage(root, maker_treasury, config, protocol_treasury);
    assert!(root.base_access_kind == PACK_ACCESS_PAID_ONCE, EInvalidPackAccess);
    assert!(
        !root.base_entitlement_registry.contains(ctx.sender()),
        EEntitlementExists,
    );
    let price = root.base_purchase_price_atomic;
    assert!(price > 0 && payment.value() == price, EWrongPayment);
    collect_primary_payment(
        maker_treasury,
        protocol_treasury,
        payment,
        price,
        0,
        ctx,
    );
    maker_treasury.total_pack_collected =
        maker_treasury.total_pack_collected + maker_receives(price);
    root.base_entitlement_registry.add(
        ctx.sender(),
        EntitlementRecordV5 {
            granted_at_ms: clock.timestamp_ms(),
            paid_atomic: price,
            ownership_epoch: root.ownership_epoch,
        },
    );
    let pass = MakerAccessPassV5 {
        id: object::new(ctx),
        version: VERSION,
        root_id: object::id(root),
        holder: ctx.sender(),
        issued_at_ms: clock.timestamp_ms(),
        ownership_epoch: root.ownership_epoch,
    };
    let pass_id = object::id(&pass);
    event::emit(MakerAccessGrantedV5 {
        root_id: object::id(root),
        holder: ctx.sender(),
        paid_atomic: price,
        access_pass_id: pass_id,
    });
    transfer::transfer(pass, ctx.sender());
}

public fun maker_access_pass_root_id_v5(self: &MakerAccessPassV5): ID {
    self.root_id
}

public fun maker_access_pass_holder_v5(self: &MakerAccessPassV5): address {
    self.holder
}

public fun update_maker_resale_royalty_v5(
    root: &mut MakerRootV5,
    cap: &MakerControlCapV5,
    royalty_bps: u16,
    ctx: &TxContext,
) {
    assert_control(root, cap, ctx);
    assert_configurable(root);
    // The original-creator royalty is part of the immutable release terms.
    // It may be corrected while the release is still being assembled, but a
    // buyer or later operator must never be able to reduce it after seal.
    assert_release_terms_mutable(root);
    assert_valid_maker_resale_royalty(royalty_bps);
    root.maker_resale_royalty_bps = royalty_bps;
}

public fun add_pack_v5(
    root: &mut MakerRootV5,
    cap: &MakerControlCapV5,
    key: String,
    label: String,
    access_kind: u8,
    purchase_price_atomic: u64,
    complete_policy: CompletionPolicyV5,
    ctx: &TxContext,
) {
    assert_control(root, cap, ctx);
    assert_configurable(root);
    assert_release_terms_mutable(root);
    assert_non_empty(&key);
    assert_non_empty(&label);
    assert_valid_pack_access(access_kind, purchase_price_atomic);
    assert_valid_policy(&complete_policy);
    let table_key = PackKeyV5 { name: key };
    assert!(!root.packs.contains(table_key), EPackExists);
    root.packs.add(
        table_key,
        PackRecordV5 {
            key,
            label,
            access_kind,
            purchase_price_atomic,
            complete_policy,
            active: true,
            entitlement_count: 0,
            complete_count: 0,
            style_count: 0,
            protected_style_count: 0,
        },
    );
    root.pack_keys.push_back(key);
    root.release.pack_count = root.release.pack_count + 1;
    if (access_kind == PACK_ACCESS_PAID_ONCE) {
        root.release.paid_pack_count = root.release.paid_pack_count + 1;
    };
    event::emit(PackConfiguredV5 {
        root_id: object::id(root),
        pack_key: key,
        access_kind,
        active: true,
    });
}

public fun update_pack_v5(
    root: &mut MakerRootV5,
    cap: &MakerControlCapV5,
    key: String,
    label: String,
    access_kind: u8,
    purchase_price_atomic: u64,
    complete_policy: CompletionPolicyV5,
    active: bool,
    ctx: &TxContext,
) {
    assert_control(root, cap, ctx);
    assert_configurable(root);
    assert_release_terms_mutable(root);
    assert_non_empty(&label);
    assert_valid_pack_access(access_kind, purchase_price_atomic);
    assert_valid_policy(&complete_policy);
    let record = root.packs.borrow_mut(PackKeyV5 { name: key });
    let was_paid = record.access_kind == PACK_ACCESS_PAID_ONCE;
    let becomes_paid = access_kind == PACK_ACCESS_PAID_ONCE;
    if (was_paid && !becomes_paid) {
        root.release.paid_pack_count = root.release.paid_pack_count - 1;
    } else if (!was_paid && becomes_paid) {
        root.release.paid_pack_count = root.release.paid_pack_count + 1;
    };
    record.label = label;
    record.access_kind = access_kind;
    record.purchase_price_atomic = purchase_price_atomic;
    record.complete_policy = complete_policy;
    record.active = active;
    event::emit(PackConfiguredV5 {
        root_id: object::id(root),
        pack_key: key,
        access_kind,
        active,
    });
}

public fun new_style_selection_v5(
    part_key: String,
    item_key: String,
    style_key: String,
): StyleSelectionV5 {
    assert_non_empty(&part_key);
    assert_non_empty(&item_key);
    assert_non_empty(&style_key);
    StyleSelectionV5 { part_key, item_key, style_key }
}

public fun style_selection_part_key_v5(self: &StyleSelectionV5): &String {
    &self.part_key
}

public fun style_selection_item_key_v5(self: &StyleSelectionV5): &String {
    &self.item_key
}

public fun style_selection_style_key_v5(self: &StyleSelectionV5): &String {
    &self.style_key
}

/// Canonical v5 composition hash. Unlike the v4 recipe hash, this commits to
/// the exact Style selected for every Part/Item so Pack provenance cannot be
/// changed while reusing a valid legacy recipe hash.
public fun hash_complete_selection_v5(
    recipe: &vector<RecipeSlot>,
    style_selections: &vector<StyleSelectionV5>,
): vector<u8> {
    hash::sha2_256(bcs::to_bytes(&CompleteSelectionHashInputV5 {
        recipe: *recipe,
        style_selections: *style_selections,
    }))
}

/// Registers one exact legacy Item + off-chain Style identity as Base.
/// Registration is append-only and becomes permanently immutable at seal.
public fun register_base_style_v5(
    root: &mut MakerRootV5,
    cap: &MakerControlCapV5,
    legacy_maker: &OCMaker,
    part_key: String,
    item_key: String,
    style_key: String,
    ctx: &TxContext,
) {
    register_style_row_v5(
        root,
        cap,
        legacy_maker,
        part_key,
        item_key,
        style_key,
        option::none(),
        STYLE_ROW_VISUAL,
        ctx,
    );
}

/// Registers a projection-only Base row. Move accepts only the canonical
/// transparent auxiliary Blob and reserved None/Smart Color identity. The
/// client cannot mark a real visual Asset public by choosing this entrypoint.
public fun register_base_logical_style_v5(
    root: &mut MakerRootV5,
    cap: &MakerControlCapV5,
    legacy_maker: &OCMaker,
    part_key: String,
    item_key: String,
    style_key: String,
    row_kind: u8,
    ctx: &TxContext,
) {
    assert!(
        row_kind == STYLE_ROW_LOGICAL_NONE
            || row_kind == STYLE_ROW_LOGICAL_COLOR,
        EInvalidStyleRowKind,
    );
    register_style_row_v5(
        root,
        cap,
        legacy_maker,
        part_key,
        item_key,
        style_key,
        option::none(),
        row_kind,
        ctx,
    );
}

/// Registers one exact Style as Pack-gated. The Pack ID is not supplied by
/// players later; Complete derives it from this sealed on-chain row.
public fun register_pack_style_v5(
    root: &mut MakerRootV5,
    cap: &MakerControlCapV5,
    legacy_maker: &OCMaker,
    part_key: String,
    item_key: String,
    style_key: String,
    pack_key: String,
    ctx: &TxContext,
) {
    register_style_row_v5(
        root,
        cap,
        legacy_maker,
        part_key,
        item_key,
        style_key,
        option::some(pack_key),
        STYLE_ROW_VISUAL,
        ctx,
    );
}

fun register_style_row_v5(
    root: &mut MakerRootV5,
    cap: &MakerControlCapV5,
    legacy_maker: &OCMaker,
    part_key: String,
    item_key: String,
    style_key: String,
    pack_key: Option<String>,
    row_kind: u8,
    ctx: &TxContext,
) {
    assert_control(root, cap, ctx);
    assert_configurable(root);
    assert!(!root.release.style_registry_sealed, EStyleRegistrySealed);
    assert_legacy_maker(root, legacy_maker);
    assert_non_empty(&style_key);
    assert_valid_style_row_kind(row_kind);
    if (pack_key.is_some()) {
        assert!(
            root.packs.contains(PackKeyV5 { name: *pack_key.borrow() }),
            EPackMissing,
        );
    };
    legacy::assert_item_exists_for_v5(legacy_maker, &part_key, &item_key);
    let asset_blob_id =
        legacy::item_blob_id_for_v5(legacy_maker, &part_key, &item_key);
    assert_style_row_identity(
        &root.logical_auxiliary_blob_id,
        &asset_blob_id,
        &style_key,
        &pack_key,
        row_kind,
    );
    let seal_protected = if (row_kind == STYLE_ROW_VISUAL) {
        root.base_access_kind == PACK_ACCESS_PAID_ONCE
            || (
                pack_key.is_some()
                    && root.packs.borrow(PackKeyV5 {
                        name: *pack_key.borrow(),
                    }).access_kind == PACK_ACCESS_PAID_ONCE
            )
    } else {
        false
    };
    let binding_key = StyleBindingKeyV5 { part_key, item_key, style_key };
    assert!(!root.style_registry.contains(binding_key), EStyleAlreadyExists);
    root.style_keys.push_back(binding_key);
    root.style_registry.add(
        binding_key,
        StyleProductRecordV5 {
            pack_key,
            asset_blob_id,
            row_kind,
            seal_protected,
        },
    );
    root.release.style_count = root.release.style_count + 1;
    if (pack_key.is_some()) {
        let pack = root.packs.borrow_mut(PackKeyV5 {
            name: *pack_key.borrow(),
        });
        pack.style_count = pack.style_count + 1;
        if (seal_protected) {
            pack.protected_style_count = pack.protected_style_count + 1;
        };
    };
    if (seal_protected) {
        root.release.protected_style_count = root.release.protected_style_count + 1;
    };
}

/// Permanently freezes Style-to-product provenance. There is intentionally no
/// unseal or update function; a correction requires a new Maker version/root.
public fun seal_style_registry_v5(
    root: &mut MakerRootV5,
    cap: &MakerControlCapV5,
    ctx: &TxContext,
) {
    assert_control(root, cap, ctx);
    assert_configurable(root);
    assert!(!root.release.style_registry_sealed, EStyleRegistrySealed);
    assert!(root.release.style_count > 0, EStyleMissing);
    assert!(root.style_keys.length() == root.release.style_count, EStyleMissing);
    let mut protected_count = 0;
    let mut style_index = 0;
    while (style_index < root.style_keys.length()) {
        let key = root.style_keys[style_index];
        let product = root.style_registry.borrow(key);
        assert_style_row_identity(
            &root.logical_auxiliary_blob_id,
            &product.asset_blob_id,
            &key.style_key,
            &product.pack_key,
            product.row_kind,
        );
        let expected_protection = if (product.row_kind == STYLE_ROW_VISUAL) {
            root.base_access_kind == PACK_ACCESS_PAID_ONCE
                || (
                    product.pack_key.is_some()
                        && root.packs.borrow(PackKeyV5 {
                            name: *product.pack_key.borrow(),
                        }).access_kind == PACK_ACCESS_PAID_ONCE
                )
        } else {
            false
        };
        assert!(
            product.seal_protected == expected_protection,
            EProtectedStyleMissing,
        );
        if (product.seal_protected) {
            protected_count = protected_count + 1;
        };
        style_index = style_index + 1;
    };
    assert!(
        protected_count == root.release.protected_style_count,
        ESealAssetCoverageMismatch,
    );
    if (root.base_access_kind == PACK_ACCESS_PAID_ONCE) {
        assert!(root.release.protected_style_count > 0, EProtectedStyleMissing);
    };
    let mut index = 0;
    while (index < root.pack_keys.length()) {
        let pack = root.packs.borrow(PackKeyV5 {
            name: *root.pack_keys.borrow(index),
        });
        if (pack.access_kind == PACK_ACCESS_PAID_ONCE) {
            assert!(
                pack.protected_style_count > 0
                    && pack.protected_style_count == pack.style_count,
                EProtectedStyleMissing,
            );
        };
        index = index + 1;
    };
    root.release.style_registry_sealed = true;
}

/// Called only by this package's reviewed Seal module after the exact Commerce
/// Style registry and exact Seal asset registry have both been assembled.
/// Bind-once semantics prevent a later operator from publishing an ambiguous
/// second policy for the same immutable release.
public(package) fun bind_seal_policy_v5(
    root: &mut MakerRootV5,
    policy_id: ID,
    release_commitment: vector<u8>,
    asset_count: u64,
) {
    assert_configurable(root);
    assert!(root.release.style_registry_sealed, EStyleRegistryNotSealed);
    assert!(requires_seal_policy(root), ESealPolicyNotRequired);
    assert!(root.release.seal_policy_id.is_none(), ESealPolicyAlreadyBound);
    assert!(release_commitment.length() == 32, EInvalidSealCommitment);
    assert!(
        asset_count > 0 && asset_count == root.release.protected_style_count,
        ESealAssetCoverageMismatch,
    );
    root.release.seal_policy_id = option::some(policy_id);
    root.release.seal_release_commitment = release_commitment;
}

public fun style_registry_sealed_v5(root: &MakerRootV5): bool {
    root.release.style_registry_sealed
}

public fun style_count_v5(root: &MakerRootV5): u64 {
    root.release.style_count
}

/// Exact immutable Style-to-product lookup used by the Seal access policy.
/// An unregistered identity aborts through the sealed registry table lookup.
public fun style_product_pack_key_v5(
    root: &MakerRootV5,
    part_key: String,
    item_key: String,
    style_key: String,
): Option<String> {
    let product = root.style_registry.borrow(StyleBindingKeyV5 {
        part_key,
        item_key,
        style_key,
    });
    if (product.pack_key.is_some()) {
        option::some(*product.pack_key.borrow())
    } else {
        option::none()
    }
}

public fun style_product_asset_blob_id_v5(
    root: &MakerRootV5,
    part_key: String,
    item_key: String,
    style_key: String,
): String {
    root.style_registry.borrow(StyleBindingKeyV5 {
        part_key,
        item_key,
        style_key,
    }).asset_blob_id
}

public fun style_product_seal_protected_v5(
    root: &MakerRootV5,
    part_key: String,
    item_key: String,
    style_key: String,
): bool {
    root.style_registry.borrow(StyleBindingKeyV5 {
        part_key,
        item_key,
        style_key,
    }).seal_protected
}

public fun style_product_row_kind_v5(
    root: &MakerRootV5,
    part_key: String,
    item_key: String,
    style_key: String,
): u8 {
    root.style_registry.borrow(StyleBindingKeyV5 {
        part_key,
        item_key,
        style_key,
    }).row_kind
}

public fun pack_record_v5(root: &MakerRootV5, key: String): &PackRecordV5 {
    root.packs.borrow(PackKeyV5 { name: key })
}

public fun pack_label_v5(self: &PackRecordV5): &String {
    &self.label
}

public fun pack_access_kind_v5(self: &PackRecordV5): u8 {
    self.access_kind
}

public fun pack_purchase_price_v5(self: &PackRecordV5): u64 {
    self.purchase_price_atomic
}

public fun pack_active_v5(self: &PackRecordV5): bool {
    self.active
}

public fun has_pack_entitlement_v5(
    root: &MakerRootV5,
    pack_key: String,
    wallet: address,
): bool {
    let record = root.packs.borrow(PackKeyV5 { name: pack_key });
    record.access_kind == PACK_ACCESS_FREE
        || root.entitlement_registry.contains(EntitlementKeyV5 {
            pack_key,
            wallet,
        })
}

/// Optionally records a free Pack claim and issues a wallet receipt. A claim is
/// not required to select or Complete with Styles from a FREE Pack.
public fun claim_free_pack_v5(
    root: &mut MakerRootV5,
    config: &CommerceProtocolConfigV5,
    pack_key: String,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert_operational(root, config);
    assert_base_access(root, ctx.sender());
    let record = root.packs.borrow_mut(PackKeyV5 { name: pack_key });
    assert!(record.active, EPackInactive);
    assert!(record.access_kind == PACK_ACCESS_FREE, EInvalidPackAccess);
    issue_pack_entitlement(root, pack_key, 0, clock, ctx);
}

public fun purchase_pack_v5<PaymentCoin>(
    root: &mut MakerRootV5,
    maker_treasury: &mut MakerTreasuryV5<PaymentCoin>,
    config: &CommerceProtocolConfigV5,
    protocol_treasury: &mut CommerceProtocolTreasuryV5<PaymentCoin>,
    pack_key: String,
    payment: Coin<PaymentCoin>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert_operational(root, config);
    assert_base_access(root, ctx.sender());
    assert_payment_linkage(root, maker_treasury, config, protocol_treasury);
    let record = root.packs.borrow(PackKeyV5 { name: pack_key });
    assert!(record.active, EPackInactive);
    assert!(record.access_kind == PACK_ACCESS_PAID_ONCE, EInvalidPackAccess);
    let price = record.purchase_price_atomic;
    assert!(price > 0 && payment.value() == price, EWrongPayment);
    assert!(
        !root.entitlement_registry.contains(EntitlementKeyV5 {
            pack_key,
            wallet: ctx.sender(),
        }),
        EEntitlementExists,
    );
    collect_primary_payment(
        maker_treasury,
        protocol_treasury,
        payment,
        price,
        0,
        ctx,
    );
    maker_treasury.total_pack_collected =
        maker_treasury.total_pack_collected + maker_receives(price);
    issue_pack_entitlement(root, pack_key, price, clock, ctx);
}

public fun pack_pass_root_id_v5(self: &PackPassV5): ID {
    self.root_id
}

public fun pack_pass_key_v5(self: &PackPassV5): &String {
    &self.pack_key
}

public fun pack_pass_holder_v5(self: &PackPassV5): address {
    self.holder
}

public fun quote_complete_v5(
    root: &MakerRootV5,
    legacy_maker: &OCMaker,
    config: &CommerceProtocolConfigV5,
    recipe: &vector<RecipeSlot>,
    style_selections: &vector<StyleSelectionV5>,
    wallet: address,
): CompleteQuoteV5 {
    let (quote, _) = build_complete_quote(
        root,
        legacy_maker,
        config,
        recipe,
        style_selections,
        wallet,
    );
    quote
}

public fun quote_creator_charge_v5(self: &CompleteQuoteV5): u64 {
    self.creator_charge_atomic
}

public fun quote_protocol_percentage_v5(self: &CompleteQuoteV5): u64 {
    self.protocol_percentage_atomic
}

public fun quote_fixed_fee_v5(self: &CompleteQuoteV5): u64 {
    self.fixed_protocol_fee_atomic
}

public fun quote_maker_receives_v5(self: &CompleteQuoteV5): u64 {
    self.maker_receives_atomic
}

public fun quote_total_due_v5(self: &CompleteQuoteV5): u64 {
    self.total_due_atomic
}

public fun quote_used_pack_count_v5(self: &CompleteQuoteV5): u64 {
    self.used_pack_count
}

/// `image_blob_id` is the Seal ciphertext's Walrus Blob/Quilt-patch ID.
/// `image_url` is a separate public low-resolution preview for Soulidity UI;
/// it is never consulted by Seal and is not stored in CompleteOutputRecordV5.
public fun authorize_complete_free_v5(
    root: &mut MakerRootV5,
    legacy_maker: &OCMaker,
    config: &CommerceProtocolConfigV5,
    name: String,
    profile_json_blob_id: String,
    image_blob_id: String,
    image_url: String,
    output_seal_id: vector<u8>,
    output_nonce: vector<u8>,
    output_digest: vector<u8>,
    recipe_hash: vector<u8>,
    recipe: vector<RecipeSlot>,
    style_selections: vector<StyleSelectionV5>,
    clock: &Clock,
    ctx: &TxContext,
): CommerceV5SoulMintAuthorization {
    assert_operational(root, config);
    assert_complete_metadata(
        &name,
        &profile_json_blob_id,
        &image_blob_id,
        &image_url,
        &recipe_hash,
        &recipe,
        &style_selections,
    );
    assert_complete_output_metadata(
        root,
        ctx.sender(),
        &recipe_hash,
        &image_blob_id,
        &output_seal_id,
        &output_nonce,
        &output_digest,
    );
    let (quote, used_pack_keys) =
        build_complete_quote(
            root,
            legacy_maker,
            config,
            &recipe,
            &style_selections,
            ctx.sender(),
        );
    assert!(quote.total_due_atomic == 0, EFreePathRequiresZeroQuote);
    record_complete(root, ctx.sender(), &used_pack_keys);
    record_complete_output(
        root,
        ctx.sender(),
        &recipe_hash,
        output_seal_id,
        output_nonce,
        output_digest,
        &image_blob_id,
    );
    new_complete_authorization(
        root,
        legacy_maker,
        config,
        name,
        profile_json_blob_id,
        image_blob_id,
        image_url,
        recipe_hash,
        recipe,
        quote,
        output_seal_id,
        output_nonce,
        output_digest,
        clock,
        ctx,
    )
}

/// Paid Complete uses the same split image semantics as the free path:
/// ciphertext identity in `image_blob_id`, public preview in `image_url`.
public fun authorize_complete_paid_v5<PaymentCoin>(
    root: &mut MakerRootV5,
    legacy_maker: &OCMaker,
    maker_treasury: &mut MakerTreasuryV5<PaymentCoin>,
    config: &CommerceProtocolConfigV5,
    protocol_treasury: &mut CommerceProtocolTreasuryV5<PaymentCoin>,
    payment: Coin<PaymentCoin>,
    name: String,
    profile_json_blob_id: String,
    image_blob_id: String,
    image_url: String,
    output_seal_id: vector<u8>,
    output_nonce: vector<u8>,
    output_digest: vector<u8>,
    recipe_hash: vector<u8>,
    recipe: vector<RecipeSlot>,
    style_selections: vector<StyleSelectionV5>,
    clock: &Clock,
    ctx: &mut TxContext,
): CommerceV5SoulMintAuthorization {
    assert_operational(root, config);
    assert_payment_linkage(root, maker_treasury, config, protocol_treasury);
    assert_complete_metadata(
        &name,
        &profile_json_blob_id,
        &image_blob_id,
        &image_url,
        &recipe_hash,
        &recipe,
        &style_selections,
    );
    assert_complete_output_metadata(
        root,
        ctx.sender(),
        &recipe_hash,
        &image_blob_id,
        &output_seal_id,
        &output_nonce,
        &output_digest,
    );
    let (quote, used_pack_keys) =
        build_complete_quote(
            root,
            legacy_maker,
            config,
            &recipe,
            &style_selections,
            ctx.sender(),
        );
    assert!(quote.total_due_atomic > 0, EPaidPathRequiresPayment);
    assert!(payment.value() == quote.total_due_atomic, EWrongPayment);
    collect_primary_payment(
        maker_treasury,
        protocol_treasury,
        payment,
        quote.creator_charge_atomic,
        quote.fixed_protocol_fee_atomic,
        ctx,
    );
    maker_treasury.total_complete_collected =
        maker_treasury.total_complete_collected + quote.maker_receives_atomic;
    record_complete(root, ctx.sender(), &used_pack_keys);
    record_complete_output(
        root,
        ctx.sender(),
        &recipe_hash,
        output_seal_id,
        output_nonce,
        output_digest,
        &image_blob_id,
    );
    new_complete_authorization(
        root,
        legacy_maker,
        config,
        name,
        profile_json_blob_id,
        image_blob_id,
        image_url,
        recipe_hash,
        recipe,
        quote,
        output_seal_id,
        output_nonce,
        output_digest,
        clock,
        ctx,
    )
}

#[test_only]
public fun destroy_complete_authorization_v5_for_testing(
    authorization: CommerceV5SoulMintAuthorization,
) {
    let (authorization, _, binding) =
        consume_commerce_v5_soul_mint_authorization(authorization);
    let CompleteOutputSoulBindingV5 {
        root_id: _,
        seal_id: _,
    } = binding;
    destroy_canonical_authorization_v5_for_testing(authorization);
}

#[test_only]
public fun bind_and_destroy_complete_authorization_v5_for_testing(
    root: &mut MakerRootV5,
    config: &CommerceProtocolConfigV5,
    authorization: CommerceV5SoulMintAuthorization,
    soul_id: ID,
) {
    let (authorization, _, binding) =
        consume_commerce_v5_soul_mint_authorization(authorization);
    bind_complete_output_to_soul_v5(
        root,
        config,
        binding,
        soul_id,
        TrustedSoulBindingProofV5 {},
    );
    destroy_canonical_authorization_v5_for_testing(authorization);
}

#[test_only]
fun destroy_canonical_authorization_v5_for_testing(
    authorization: CanonicalSoulMintAuthorization,
) {
    let (authorization, _, _, _, _) =
        legacy::consume_canonical_soul_mint_authorization(authorization);
    let (
        _,
        _,
        _,
        _,
        _,
        _,
        _,
        _,
        _,
        _,
        _,
        _,
        _,
        _,
        _,
        _,
    ) = legacy::consume_soul_mint_authorization(authorization);
}

public fun withdraw_maker_revenue_v5<PaymentCoin>(
    root: &MakerRootV5,
    treasury: &mut MakerTreasuryV5<PaymentCoin>,
    cap: &MakerControlCapV5,
    amount: u64,
    recipient: address,
    ctx: &mut TxContext,
) {
    assert_control(root, cap, ctx);
    assert_maker_treasury(root, treasury);
    assert!(recipient != @0x0, EInvalidRecipient);
    assert!(amount > 0 && amount <= treasury.revenue.value(), EInsufficientRevenue);
    let payment = coin::take(&mut treasury.revenue, amount, ctx);
    treasury.total_withdrawn = treasury.total_withdrawn + amount;
    transfer::public_transfer(payment, recipient);
}

fun new_maker_listing_v5<PaymentCoin>(
    root: &mut MakerRootV5,
    treasury: &MakerTreasuryV5<PaymentCoin>,
    cap: MakerControlCapV5,
    config: &CommerceProtocolConfigV5,
    price_atomic: u64,
    ctx: &mut TxContext,
): MakerListingV5 {
    assert_control(root, &cap, ctx);
    assert_maker_treasury(root, treasury);
    assert!(config.enabled, EProtocolDisabled);
    assert!(root.protocol_config_id == object::id(config), EProtocolMismatch);
    assert!(&root.payment_coin_type == &config.payment_coin_type, EPaymentCoinMismatch);
    assert!(root.lifecycle == LIFECYCLE_PAUSED, EInvalidLifecycle);
    assert!(treasury.revenue.value() == 0, ETreasuryNotEmpty);
    assert!(price_atomic > 0, EWrongPayment);
    assert!(root.active_listing_id.is_none(), EInvalidLifecycle);
    let MakerControlCapV5 {
        id: control_cap_uid,
        version: _,
        root_id: _,
        ownership_epoch: _,
    } = cap;
    control_cap_uid.delete();
    let listing = MakerListingV5 {
        id: object::new(ctx),
        version: VERSION,
        root_id: object::id(root),
        seller: ctx.sender(),
        price_atomic,
        ownership_epoch: root.ownership_epoch,
        protocol_fee_bps: config.maker_market_fee_bps,
        maker_resale_royalty_bps: root.maker_resale_royalty_bps,
        active: true,
    };
    let listing_id = object::id(&listing);
    root.current_control_cap_id = option::none();
    root.active_listing_id = option::some(listing_id);
    root.lifecycle = LIFECYCLE_SALE_PENDING;
    event::emit(MakerListingOpenedV5 {
        root_id: object::id(root),
        listing_id,
        seller: ctx.sender(),
        price_atomic,
        ownership_epoch: root.ownership_epoch,
    });
    listing
}

/// Opens a Maker sale only after the stable Maker treasury has been emptied.
/// Consuming the current key-only cap makes every admin path unavailable until
/// cancellation or purchase mints the next epoch-bound cap.
public fun list_maker_for_sale_v5<PaymentCoin>(
    root: &mut MakerRootV5,
    treasury: &MakerTreasuryV5<PaymentCoin>,
    cap: MakerControlCapV5,
    config: &CommerceProtocolConfigV5,
    price_atomic: u64,
    ctx: &mut TxContext,
) {
    let listing =
        new_maker_listing_v5(root, treasury, cap, config, price_atomic, ctx);
    transfer::share_object(listing);
}

#[test_only]
public fun new_maker_listing_v5_for_testing<PaymentCoin>(
    root: &mut MakerRootV5,
    treasury: &MakerTreasuryV5<PaymentCoin>,
    cap: MakerControlCapV5,
    config: &CommerceProtocolConfigV5,
    price_atomic: u64,
    ctx: &mut TxContext,
): MakerListingV5 {
    new_maker_listing_v5(root, treasury, cap, config, price_atomic, ctx)
}

public fun cancel_maker_listing_v5(
    root: &mut MakerRootV5,
    listing: &mut MakerListingV5,
    ctx: &mut TxContext,
) {
    assert_listing(root, listing);
    assert!(listing.active, EListingInactive);
    assert!(ctx.sender() == listing.seller, ENotListingSeller);
    assert!(ctx.sender() == root.current_owner, ENotCurrentOwner);
    listing.active = false;
    root.active_listing_id = option::none();
    root.lifecycle = LIFECYCLE_PAUSED;
    let cap = mint_current_control_cap(root, ctx);
    let cap_id = object::id(&cap);
    event::emit(MakerListingCancelledV5 {
        root_id: object::id(root),
        listing_id: object::id(listing),
        seller: ctx.sender(),
        control_cap_id: cap_id,
    });
    transfer::transfer(cap, ctx.sender());
}

public fun buy_maker_v5<PaymentCoin>(
    root: &mut MakerRootV5,
    maker_treasury: &MakerTreasuryV5<PaymentCoin>,
    listing: &mut MakerListingV5,
    config: &CommerceProtocolConfigV5,
    protocol_treasury: &mut CommerceProtocolTreasuryV5<PaymentCoin>,
    mut payment: Coin<PaymentCoin>,
    ctx: &mut TxContext,
) {
    assert!(config.enabled, EProtocolDisabled);
    assert_listing(root, listing);
    assert!(listing.active, EListingInactive);
    assert!(ctx.sender() != listing.seller, ENotCurrentOwner);
    assert!(maker_treasury.revenue.value() == 0, ETreasuryNotEmpty);
    assert_maker_treasury(root, maker_treasury);
    assert_protocol_treasury(config, protocol_treasury);
    assert!(root.protocol_config_id == object::id(config), EProtocolMismatch);
    assert!(
        &payment_coin_type_name<PaymentCoin>() == &root.payment_coin_type
            && &root.payment_coin_type == &config.payment_coin_type,
        EPaymentCoinMismatch,
    );
    let price = listing.price_atomic;
    assert!(payment.value() == price, EWrongPayment);
    let protocol_fee = bps_amount(price, listing.protocol_fee_bps);
    let original_royalty = bps_amount(price, listing.maker_resale_royalty_bps);
    let combined = (protocol_fee as u128) + (original_royalty as u128);
    assert!(combined <= (price as u128), EQuoteOverflow);

    if (protocol_fee > 0) {
        let protocol_coin = coin::split(&mut payment, protocol_fee, ctx);
        coin::put(&mut protocol_treasury.revenue, protocol_coin);
        protocol_treasury.total_market_collected =
            protocol_treasury.total_market_collected + protocol_fee;
    };
    if (original_royalty > 0) {
        let royalty_coin = coin::split(&mut payment, original_royalty, ctx);
        transfer::public_transfer(royalty_coin, root.original_creator);
    };
    transfer::public_transfer(payment, listing.seller);

    let seller = listing.seller;
    listing.active = false;
    root.current_owner = ctx.sender();
    root.ownership_epoch = root.ownership_epoch + 1;
    root.active_listing_id = option::none();
    root.lifecycle = LIFECYCLE_PAUSED;
    let cap = mint_current_control_cap(root, ctx);
    let cap_id = object::id(&cap);
    event::emit(MakerPurchasedV5 {
        root_id: object::id(root),
        listing_id: object::id(listing),
        seller,
        buyer: ctx.sender(),
        price_atomic: price,
        protocol_fee_atomic: protocol_fee,
        original_creator_royalty_atomic: original_royalty,
        ownership_epoch: root.ownership_epoch,
        control_cap_id: cap_id,
    });
    transfer::transfer(cap, ctx.sender());
}

public fun listing_active_v5(self: &MakerListingV5): bool {
    self.active
}

public fun listing_price_v5(self: &MakerListingV5): u64 {
    self.price_atomic
}

public fun listing_seller_v5(self: &MakerListingV5): address {
    self.seller
}

public fun listing_protocol_fee_bps_v5(self: &MakerListingV5): u16 {
    self.protocol_fee_bps
}

fun assert_protocol_admin(
    config: &CommerceProtocolConfigV5,
    legacy_admin: &ProtocolFeeAdminCap,
) {
    assert!(
        object::id(legacy_admin) == config.legacy_admin_cap_id
            && legacy::protocol_fee_admin_config_id(legacy_admin)
                == config.legacy_config_id,
        EInvalidProtocolAdmin,
    );
}

fun assert_protocol_treasury<PaymentCoin>(
    config: &CommerceProtocolConfigV5,
    treasury: &CommerceProtocolTreasuryV5<PaymentCoin>,
) {
    assert!(
        object::id(treasury) == config.treasury_id
            && treasury.config_id == object::id(config),
        EProtocolMismatch,
    );
    assert!(
        &payment_coin_type_name<PaymentCoin>() == &config.payment_coin_type,
        EPaymentCoinMismatch,
    );
}

fun assert_maker_treasury<PaymentCoin>(
    root: &MakerRootV5,
    treasury: &MakerTreasuryV5<PaymentCoin>,
) {
    assert!(
        object::id(treasury) == root.treasury_id
            && treasury.root_id == object::id(root),
        ETreasuryMismatch,
    );
    assert!(
        &payment_coin_type_name<PaymentCoin>() == &root.payment_coin_type,
        EPaymentCoinMismatch,
    );
}

fun assert_payment_linkage<PaymentCoin>(
    root: &MakerRootV5,
    maker_treasury: &MakerTreasuryV5<PaymentCoin>,
    config: &CommerceProtocolConfigV5,
    protocol_treasury: &CommerceProtocolTreasuryV5<PaymentCoin>,
) {
    assert_maker_treasury(root, maker_treasury);
    assert_protocol_treasury(config, protocol_treasury);
    assert!(root.protocol_config_id == object::id(config), EProtocolMismatch);
    assert!(&root.payment_coin_type == &config.payment_coin_type, EPaymentCoinMismatch);
}

fun assert_control(
    root: &MakerRootV5,
    cap: &MakerControlCapV5,
    ctx: &TxContext,
) {
    assert!(cap.root_id == object::id(root), EInvalidControlCap);
    assert!(cap.ownership_epoch == root.ownership_epoch, EInvalidControlCap);
    assert!(root.current_control_cap_id.is_some(), EInvalidControlCap);
    assert!(
        *root.current_control_cap_id.borrow() == object::id(cap),
        EInvalidControlCap,
    );
    assert!(root.current_owner == ctx.sender(), ENotCurrentOwner);
}

fun assert_legacy_maker(root: &MakerRootV5, maker: &OCMaker) {
    assert!(root.legacy_maker_id == object::id(maker), EProtocolMismatch);
}

fun assert_operational(root: &MakerRootV5, config: &CommerceProtocolConfigV5) {
    assert!(root.lifecycle == LIFECYCLE_ACTIVE, EInvalidLifecycle);
    assert!(config.enabled, EProtocolDisabled);
    assert_protocol_dependencies_bound(config);
    assert!(root.protocol_config_id == object::id(config), EProtocolMismatch);
    assert!(&root.payment_coin_type == &config.payment_coin_type, EPaymentCoinMismatch);
}

fun assert_base_access(root: &MakerRootV5, wallet: address) {
    if (root.base_access_kind == PACK_ACCESS_PAID_ONCE) {
        assert!(
            root.base_entitlement_registry.contains(wallet),
            EEntitlementMissing,
        );
    };
}

fun assert_configurable(root: &MakerRootV5) {
    assert!(
        root.lifecycle == LIFECYCLE_PAUSED || root.lifecycle == LIFECYCLE_ARCHIVED,
        EInvalidLifecycle,
    );
    assert!(root.active_listing_id.is_none(), EInvalidLifecycle);
}

/// Base access, Complete policies, Pack terms, and resale royalties describe
/// one immutable Maker release. They may be assembled while paused before the
/// exact Style registry is sealed, but changing them after seal requires a new
/// version/root so previously purchased access can never be revoked.
fun assert_release_terms_mutable(root: &MakerRootV5) {
    assert!(
        !root.release.style_registry_sealed && root.release.style_count == 0,
        EStyleRegistrySealed,
    );
}

fun requires_seal_policy(root: &MakerRootV5): bool {
    root.base_access_kind == PACK_ACCESS_PAID_ONCE
        || root.release.paid_pack_count > 0
}

fun assert_listing(root: &MakerRootV5, listing: &MakerListingV5) {
    assert!(root.lifecycle == LIFECYCLE_SALE_PENDING, EInvalidLifecycle);
    assert!(listing.root_id == object::id(root), EListingMismatch);
    assert!(listing.ownership_epoch == root.ownership_epoch, EListingMismatch);
    assert!(root.active_listing_id.is_some(), EListingMismatch);
    assert!(
        *root.active_listing_id.borrow() == object::id(listing),
        EListingMismatch,
    );
}

fun set_lifecycle(root: &mut MakerRootV5, current: u8) {
    let previous = root.lifecycle;
    root.lifecycle = current;
    event::emit(MakerLifecycleChangedV5 {
        root_id: object::id(root),
        owner: root.current_owner,
        previous,
        current,
        ownership_epoch: root.ownership_epoch,
    });
}

fun mint_current_control_cap(
    root: &mut MakerRootV5,
    ctx: &mut TxContext,
): MakerControlCapV5 {
    assert!(root.current_control_cap_id.is_none(), EInvalidControlCap);
    let cap = MakerControlCapV5 {
        id: object::new(ctx),
        version: VERSION,
        root_id: object::id(root),
        ownership_epoch: root.ownership_epoch,
    };
    root.current_control_cap_id = option::some(object::id(&cap));
    cap
}

fun issue_pack_entitlement(
    root: &mut MakerRootV5,
    pack_key: String,
    paid_atomic: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let holder = ctx.sender();
    let entitlement_key = EntitlementKeyV5 { pack_key, wallet: holder };
    assert!(
        !root.entitlement_registry.contains(entitlement_key),
        EEntitlementExists,
    );
    root.entitlement_registry.add(
        entitlement_key,
        EntitlementRecordV5 {
            granted_at_ms: clock.timestamp_ms(),
            paid_atomic,
            ownership_epoch: root.ownership_epoch,
        },
    );
    let record = root.packs.borrow_mut(PackKeyV5 { name: pack_key });
    record.entitlement_count = record.entitlement_count + 1;
    let pass = PackPassV5 {
        id: object::new(ctx),
        version: VERSION,
        root_id: object::id(root),
        pack_key,
        holder,
        issued_at_ms: clock.timestamp_ms(),
        ownership_epoch: root.ownership_epoch,
    };
    let pass_id = object::id(&pass);
    event::emit(PackEntitlementGrantedV5 {
        root_id: object::id(root),
        pack_key,
        holder,
        paid_atomic,
        pack_pass_id: pass_id,
    });
    transfer::transfer(pass, holder);
}

fun build_complete_quote(
    root: &MakerRootV5,
    legacy_maker: &OCMaker,
    config: &CommerceProtocolConfigV5,
    recipe: &vector<RecipeSlot>,
    style_selections: &vector<StyleSelectionV5>,
    wallet: address,
): (CompleteQuoteV5, vector<String>) {
    assert_operational(root, config);
    assert_base_access(root, wallet);
    assert_legacy_maker(root, legacy_maker);
    legacy::assert_valid_recipe_for_v5(legacy_maker, recipe);
    assert_style_selection_alignment(root, recipe, style_selections);

    let base_count = completion_count(
        root,
        CompletionCountKeyV5 {
            wallet,
            product_kind: PRODUCT_BASE,
            product_key: b"".to_string(),
        },
    );
    assert_policy_total_capacity(&root.base_policy, root.release.total_completes);
    let mut creator_charge = policy_charge(&root.base_policy, base_count);
    let used_pack_keys = derive_used_pack_keys(root, style_selections, wallet);
    let mut index = 0;
    while (index < used_pack_keys.length()) {
        let key = used_pack_keys[index];
        let record = root.packs.borrow(PackKeyV5 { name: key });
        assert!(record.active, EPackInactive);
        let count = completion_count(
            root,
            CompletionCountKeyV5 {
                wallet,
                product_kind: PRODUCT_PACK,
                product_key: key,
            },
        );
        assert_policy_total_capacity(
            &record.complete_policy,
            record.complete_count,
        );
        creator_charge =
            checked_add(creator_charge, policy_charge(&record.complete_policy, count));
        index = index + 1;
    };
    let protocol_percentage = bps_amount(creator_charge, PRIMARY_PROTOCOL_FEE_BPS);
    let maker_receives = creator_charge - protocol_percentage;
    let total_due = checked_add(creator_charge, config.fixed_complete_fee_atomic);
    (
        CompleteQuoteV5 {
            creator_charge_atomic: creator_charge,
            protocol_percentage_atomic: protocol_percentage,
            fixed_protocol_fee_atomic: config.fixed_complete_fee_atomic,
            maker_receives_atomic: maker_receives,
            total_due_atomic: total_due,
            used_pack_count: used_pack_keys.length(),
        },
        used_pack_keys,
    )
}

fun derive_used_pack_keys(
    root: &MakerRootV5,
    style_selections: &vector<StyleSelectionV5>,
    wallet: address,
): vector<String> {
    let mut result = vector[];
    let mut index = 0;
    while (index < style_selections.length()) {
        let selection = &style_selections[index];
        let binding_key = StyleBindingKeyV5 {
            part_key: selection.part_key,
            item_key: selection.item_key,
            style_key: selection.style_key,
        };
        let product = root.style_registry.borrow(binding_key);
        if (product.pack_key.is_some()) {
            let pack_key = *product.pack_key.borrow();
            let record = root.packs.borrow(PackKeyV5 { name: pack_key });
            if (record.access_kind == PACK_ACCESS_PAID_ONCE) {
                assert!(
                    root.entitlement_registry.contains(EntitlementKeyV5 {
                        pack_key,
                        wallet,
                    }),
                    EEntitlementMissing,
                );
            };
            if (!string_vector_contains(&result, &pack_key)) {
                result.push_back(pack_key);
            };
        };
        index = index + 1;
    };
    result
}

fun record_complete(
    root: &mut MakerRootV5,
    wallet: address,
    used_pack_keys: &vector<String>,
) {
    increment_completion_count(
        root,
        CompletionCountKeyV5 {
            wallet,
            product_kind: PRODUCT_BASE,
            product_key: b"".to_string(),
        },
    );
    let mut index = 0;
    while (index < used_pack_keys.length()) {
        let pack_key = used_pack_keys[index];
        increment_completion_count(
            root,
            CompletionCountKeyV5 {
                wallet,
                product_kind: PRODUCT_PACK,
                product_key: pack_key,
            },
        );
        let record = root.packs.borrow_mut(PackKeyV5 { name: pack_key });
        record.complete_count = record.complete_count + 1;
        index = index + 1;
    };
    root.release.total_completes = root.release.total_completes + 1;
}

fun record_complete_output(
    root: &mut MakerRootV5,
    payer: address,
    recipe_hash: &vector<u8>,
    output_seal_id: vector<u8>,
    output_nonce: vector<u8>,
    output_digest: vector<u8>,
    ciphertext_blob_id: &String,
) {
    assert!(
        output_seal_id.length() == 32
            && output_nonce.length() == 32
            && output_digest.length() == 32
            && recipe_hash.length() == 32
            && !ciphertext_blob_id.is_empty(),
        EInvalidCompleteOutput,
    );
    assert!(
        !root.complete_outputs.contains(output_seal_id),
        ECompleteOutputExists,
    );
    root.complete_outputs.add(
        output_seal_id,
        CompleteOutputRecordV5 {
            seal_id: output_seal_id,
            payer,
            recipe_hash: *recipe_hash,
            output_nonce,
            output_digest,
            ciphertext_blob_id: *ciphertext_blob_id,
            bound_soul_id: option::none(),
        },
    );
    root.release.complete_output_count = root.release.complete_output_count + 1;
}

fun completion_count(root: &MakerRootV5, key: CompletionCountKeyV5): u64 {
    if (root.completion_counts.contains(key)) {
        *root.completion_counts.borrow(key)
    } else {
        0
    }
}

fun increment_completion_count(root: &mut MakerRootV5, key: CompletionCountKeyV5) {
    if (root.completion_counts.contains(key)) {
        let count = root.completion_counts.borrow_mut(key);
        *count = *count + 1;
    } else {
        root.completion_counts.add(key, 1);
    };
}

fun policy_charge(policy: &CompletionPolicyV5, previous_count: u64): u64 {
    if (policy.mode == POLICY_UNLIMITED_FREE) {
        0
    } else if (policy.mode == POLICY_FREE_QUOTA_THEN_PAID) {
        if (previous_count < policy.free_quota_per_wallet) 0 else policy.price_atomic
    } else if (policy.mode == POLICY_PAID_EVERY_TIME) {
        policy.price_atomic
    } else {
        assert!(previous_count < policy.free_quota_per_wallet, ECompletionBlocked);
        0
    }
}

fun assert_policy_total_capacity(
    policy: &CompletionPolicyV5,
    previous_total: u64,
) {
    if (policy.total_cap > 0) {
        assert!(previous_total < policy.total_cap, ECompletionBlocked);
    };
}

fun collect_primary_payment<PaymentCoin>(
    maker_treasury: &mut MakerTreasuryV5<PaymentCoin>,
    protocol_treasury: &mut CommerceProtocolTreasuryV5<PaymentCoin>,
    mut payment: Coin<PaymentCoin>,
    creator_charge: u64,
    fixed_fee: u64,
    ctx: &mut TxContext,
) {
    let expected = checked_add(creator_charge, fixed_fee);
    assert!(payment.value() == expected, EWrongPayment);
    let percentage = bps_amount(creator_charge, PRIMARY_PROTOCOL_FEE_BPS);
    let protocol_total = checked_add(percentage, fixed_fee);
    if (protocol_total > 0) {
        let protocol_coin = coin::split(&mut payment, protocol_total, ctx);
        coin::put(&mut protocol_treasury.revenue, protocol_coin);
        protocol_treasury.total_primary_collected =
            protocol_treasury.total_primary_collected + percentage;
        protocol_treasury.total_fixed_collected =
            protocol_treasury.total_fixed_collected + fixed_fee;
    };
    coin::put(&mut maker_treasury.revenue, payment);
}

fun new_complete_authorization(
    root: &MakerRootV5,
    legacy_maker: &OCMaker,
    config: &CommerceProtocolConfigV5,
    name: String,
    profile_json_blob_id: String,
    image_blob_id: String,
    image_url: String,
    recipe_hash: vector<u8>,
    recipe: vector<RecipeSlot>,
    quote: CompleteQuoteV5,
    output_seal_id: vector<u8>,
    output_nonce: vector<u8>,
    output_digest: vector<u8>,
    clock: &Clock,
    ctx: &TxContext,
): CommerceV5SoulMintAuthorization {
    event::emit(CompleteAuthorizedV5 {
        root_id: object::id(root),
        legacy_maker_id: object::id(legacy_maker),
        payer: ctx.sender(),
        creator_charge_atomic: quote.creator_charge_atomic,
        protocol_percentage_atomic: quote.protocol_percentage_atomic,
        fixed_protocol_fee_atomic: quote.fixed_protocol_fee_atomic,
        total_paid_atomic: quote.total_due_atomic,
        ownership_epoch: root.ownership_epoch,
        output_seal_id: copy output_seal_id,
        output_nonce: copy output_nonce,
        output_digest: copy output_digest,
        ciphertext_blob_id: image_blob_id,
    });
    let canonical = legacy::new_canonical_commerce_v5_authorization(
        object::id(root),
        root.treasury_id,
        root.original_creator,
        ctx.sender(),
        legacy_maker,
        name,
        profile_json_blob_id,
        image_blob_id,
        image_url,
        recipe_hash,
        root.payment_coin_type,
        quote.total_due_atomic,
        recipe,
        object::id(config),
        config.treasury_id,
        config.primary_protocol_fee_bps,
        checked_add(
            quote.protocol_percentage_atomic,
            quote.fixed_protocol_fee_atomic,
        ),
        clock,
    );
    CommerceV5SoulMintAuthorization {
        canonical,
        soul_creator_royalty_bps: root.soul_creator_royalty_bps,
        output_binding: CompleteOutputSoulBindingV5 {
            root_id: object::id(root),
            seal_id: output_seal_id,
        },
    }
}

/// Consumed by Soulidity in the same PTB as Complete payment and Soul minting.
/// The royalty is authenticated Maker release data, not a caller parameter;
/// the one-use output witness must bind the Complete output to that same Soul.
public fun consume_commerce_v5_soul_mint_authorization(
    authorization: CommerceV5SoulMintAuthorization,
): (
    CanonicalSoulMintAuthorization,
    u16,
    CompleteOutputSoulBindingV5,
) {
    let CommerceV5SoulMintAuthorization {
        canonical,
        soul_creator_royalty_bps,
        output_binding,
    } = authorization;
    (canonical, soul_creator_royalty_bps, output_binding)
}

fun assert_complete_metadata(
    name: &String,
    profile_json_blob_id: &String,
    image_blob_id: &String,
    image_url: &String,
    recipe_hash: &vector<u8>,
    recipe: &vector<RecipeSlot>,
    style_selections: &vector<StyleSelectionV5>,
) {
    assert_non_empty(name);
    assert_non_empty(profile_json_blob_id);
    assert_non_empty(image_blob_id);
    assert_non_empty(image_url);
    assert!(recipe.length() > 0, EInvalidRecipeHash);
    assert!(recipe_hash.length() == 32, EInvalidRecipeHash);
    assert!(
        recipe_hash == &hash_complete_selection_v5(recipe, style_selections),
        EInvalidRecipeHash,
    );
}

fun assert_complete_output_metadata(
    root: &MakerRootV5,
    payer: address,
    recipe_hash: &vector<u8>,
    ciphertext_blob_id: &String,
    output_seal_id: &vector<u8>,
    output_nonce: &vector<u8>,
    output_digest: &vector<u8>,
) {
    assert_non_empty(ciphertext_blob_id);
    assert!(
        output_seal_id.length() == 32
            && output_nonce.length() == 32
            && output_digest.length() == 32
            && recipe_hash.length() == 32,
        EInvalidCompleteOutput,
    );
    assert!(
        *output_seal_id == derive_complete_output_seal_id_v5(
            object::id(root),
            payer,
            *recipe_hash,
            *output_nonce,
            *output_digest,
        ),
        EInvalidCompleteOutput,
    );
    assert!(
        !root.complete_outputs.contains(*output_seal_id),
        ECompleteOutputExists,
    );
}

fun assert_style_selection_alignment(
    root: &MakerRootV5,
    recipe: &vector<RecipeSlot>,
    style_selections: &vector<StyleSelectionV5>,
) {
    assert!(root.release.style_registry_sealed, EStyleRegistryNotSealed);
    assert!(
        style_selections.length() == recipe.length(),
        EStyleSelectionMismatch,
    );
    let mut index = 0;
    while (index < recipe.length()) {
        let slot = &recipe[index];
        let selection = &style_selections[index];
        assert!(
            legacy::recipe_slot_part_key(slot) == &selection.part_key
                && legacy::recipe_slot_item_key(slot) == &selection.item_key,
            EStyleSelectionMismatch,
        );
        let binding_key = StyleBindingKeyV5 {
            part_key: selection.part_key,
            item_key: selection.item_key,
            style_key: selection.style_key,
        };
        assert!(root.style_registry.contains(binding_key), EStyleMissing);
        index = index + 1;
    };
}

fun assert_valid_rights_origin(value: u8) {
    assert!(
        value == RIGHTS_ONCHAIN_NATIVE || value == RIGHTS_LICENSE_WRAPPED,
        EInvalidRightsOrigin,
    );
}

fun assert_valid_completion_policy(mode: u8, quota: u64, price: u64) {
    assert!(mode <= POLICY_FREE_QUOTA_THEN_BLOCK, EInvalidPolicy);
    if (mode == POLICY_UNLIMITED_FREE) {
        assert!(quota == 0 && price == 0, EInvalidPolicy);
    } else if (mode == POLICY_FREE_QUOTA_THEN_PAID) {
        assert!(quota > 0 && price > 0, EInvalidPolicy);
    } else if (mode == POLICY_PAID_EVERY_TIME) {
        assert!(quota == 0 && price > 0, EInvalidPolicy);
    } else {
        assert!(quota > 0 && price == 0, EInvalidPolicy);
    };
}

fun assert_valid_policy(policy: &CompletionPolicyV5) {
    assert_valid_completion_policy(
        policy.mode,
        policy.free_quota_per_wallet,
        policy.price_atomic,
    );
}

fun assert_valid_pack_access(access_kind: u8, purchase_price: u64) {
    assert!(access_kind <= PACK_ACCESS_PAID_ONCE, EInvalidPackAccess);
    if (access_kind == PACK_ACCESS_FREE) {
        assert!(purchase_price == 0, EInvalidPackAccess);
    } else {
        assert!(purchase_price > 0, EInvalidPackAccess);
    };
}

fun assert_valid_style_row_kind(row_kind: u8) {
    assert!(
        row_kind == STYLE_ROW_VISUAL
            || row_kind == STYLE_ROW_LOGICAL_NONE
            || row_kind == STYLE_ROW_LOGICAL_COLOR,
        EInvalidStyleRowKind,
    );
}

fun assert_style_row_identity(
    logical_auxiliary_blob_id: &String,
    asset_blob_id: &String,
    style_key: &String,
    pack_key: &Option<String>,
    row_kind: u8,
) {
    assert_valid_style_row_kind(row_kind);
    let none_key = b"__animacraft_none__".to_string();
    let color_prefix = b"__animacraft_color__:".to_string();
    let is_none = style_key == &none_key;
    let is_color = has_non_empty_string_prefix(style_key, &color_prefix);
    if (row_kind == STYLE_ROW_VISUAL) {
        assert!(
            asset_blob_id != logical_auxiliary_blob_id
                && !is_none
                && !is_color,
            EInvalidLogicalStyle,
        );
    } else {
        assert!(
            pack_key.is_none()
                && asset_blob_id == logical_auxiliary_blob_id,
            EInvalidLogicalStyle,
        );
        if (row_kind == STYLE_ROW_LOGICAL_NONE) {
            assert!(is_none, EInvalidLogicalStyle);
        } else {
            assert!(is_color, EInvalidLogicalStyle);
        };
    };
}

fun has_non_empty_string_prefix(value: &String, prefix: &String): bool {
    let value_bytes = string::as_bytes(value);
    let prefix_bytes = string::as_bytes(prefix);
    if (value_bytes.length() <= prefix_bytes.length()) return false;
    let mut index = 0;
    while (index < prefix_bytes.length()) {
        if (value_bytes[index] != prefix_bytes[index]) return false;
        index = index + 1;
    };
    true
}

fun assert_protocol_dependencies_bound(config: &CommerceProtocolConfigV5) {
    assert!(
        config.logical_auxiliary_blob_id.is_some()
            && config.soul_binding_proof_type.is_some(),
        EProtocolDependencyMissing,
    );
}

fun assert_valid_maker_resale_royalty(royalty_bps: u16) {
    assert!(
        royalty_bps <= MAX_MAKER_RESALE_ROYALTY_BPS
            && royalty_bps % 50 == 0,
        EInvalidRoyalty,
    );
}

fun assert_valid_soul_creator_royalty(royalty_bps: u16) {
    assert!(
        royalty_bps <= MAX_SOUL_CREATOR_ROYALTY_BPS
            && royalty_bps % 50 == 0,
        EInvalidRoyalty,
    );
}

fun assert_non_empty(value: &String) {
    assert!(string::as_bytes(value).length() > 0, EInvalidName);
}

fun bps_amount(amount: u64, bps: u16): u64 {
    (((amount as u128) * (bps as u128)) / (BPS_DENOMINATOR as u128)) as u64
}

fun maker_receives(creator_charge: u64): u64 {
    creator_charge - bps_amount(creator_charge, PRIMARY_PROTOCOL_FEE_BPS)
}

fun checked_add(left: u64, right: u64): u64 {
    let sum = (left as u128) + (right as u128);
    assert!(sum <= MAX_U64_AS_U128, EQuoteOverflow);
    sum as u64
}

fun string_vector_contains(values: &vector<String>, needle: &String): bool {
    let mut index = 0;
    while (index < values.length()) {
        if (&values[index] == needle) return true;
        index = index + 1;
    };
    false
}

fun payment_coin_type_name<PaymentCoin>(): String {
    defining_type_name<PaymentCoin>()
}

fun defining_type_name<T>(): String {
    string::from_ascii(type_name::with_defining_ids<T>().into_string())
}

#[test_only]
public struct TrustedSoulBindingProofV5 has drop {}

#[test_only]
public struct UntrustedSoulBindingProofV5 has drop {}

#[test_only]
fun legacy_maker_for_v5_testing(
    ctx: &mut TxContext,
    clock: &Clock,
): (
    CreatorProfile,
    OCMaker,
    MakerTreasury<sui::sui::SUI>,
    MakerAdminCap,
) {
    let mut profile = legacy::new_creator_profile(
        b"v5 creator".to_string(),
        b"".to_string(),
        b"".to_string(),
        ctx.sender(),
        ctx,
    );
    let (mut maker, treasury, cap) = legacy::new_managed_oc_maker<sui::sui::SUI>(
        &mut profile,
        b"v5 maker".to_string(),
        b"".to_string(),
        b"".to_string(),
        b"manifest".to_string(),
        legacy::license_personal(),
        0,
        false,
        false,
        true,
        true,
        false,
        0,
        clock,
        ctx,
    );
    legacy::admin_add_part(
        &cap,
        &mut maker,
        b"eyes".to_string(),
        b"Eyes".to_string(),
        legacy::part_standard(),
        0,
        true,
        true,
        clock,
        ctx,
    );
    legacy::admin_add_color(
        &cap,
        &mut maker,
        b"eyes".to_string(),
        b"#2db7a3".to_string(),
        clock,
        ctx,
    );
    legacy::admin_add_item(
        &cap,
        &mut maker,
        b"eyes".to_string(),
        b"bright".to_string(),
        b"Bright".to_string(),
        b"eyes-blob".to_string(),
        b"".to_string(),
        legacy::item_included(),
        clock,
        ctx,
    );
    legacy::admin_add_part(
        &cap,
        &mut maker,
        b"hat".to_string(),
        b"Hat".to_string(),
        legacy::part_standard(),
        1,
        true,
        false,
        clock,
        ctx,
    );
    legacy::admin_add_color(
        &cap,
        &mut maker,
        b"hat".to_string(),
        b"#ffffff".to_string(),
        clock,
        ctx,
    );
    legacy::admin_add_item(
        &cap,
        &mut maker,
        b"hat".to_string(),
        b"moon".to_string(),
        b"Moon Hat".to_string(),
        b"hat-blob".to_string(),
        b"".to_string(),
        legacy::item_included(),
        clock,
        ctx,
    );
    legacy::admin_add_item(
        &cap,
        &mut maker,
        b"hat".to_string(),
        b"__ac_none".to_string(),
        b"None".to_string(),
        b"projection-auxiliary-blob".to_string(),
        b"".to_string(),
        legacy::item_included(),
        clock,
        ctx,
    );
    legacy::admin_add_item(
        &cap,
        &mut maker,
        b"hat".to_string(),
        b"color-blue".to_string(),
        b"Blue".to_string(),
        b"projection-auxiliary-blob".to_string(),
        b"".to_string(),
        legacy::item_included(),
        clock,
        ctx,
    );
    legacy::admin_publish_maker(
        &cap,
        &mut maker,
        b"manifest".to_string(),
        clock,
        ctx,
    );
    (profile, maker, treasury, cap)
}

#[test_only]
public fun v5_world_for_testing(
    base_policy: CompletionPolicyV5,
    ctx: &mut TxContext,
    clock: &Clock,
): (
    CreatorProfile,
    OCMaker,
    MakerTreasury<sui::sui::SUI>,
    ProtocolFeeConfig,
    ProtocolTreasury<sui::sui::SUI>,
    ProtocolFeeAdminCap,
    CommerceProtocolConfigV5,
    CommerceProtocolTreasuryV5<sui::sui::SUI>,
    MakerRootV5,
    MakerTreasuryV5<sui::sui::SUI>,
    MakerControlVaultV5,
    MakerControlCapV5,
) {
    let (profile, mut maker, legacy_treasury, legacy_cap) =
        legacy_maker_for_v5_testing(ctx, clock);
    let (legacy_config, legacy_protocol_treasury, mut protocol_admin) =
        legacy::new_protocol_fee_objects_for_testing<sui::sui::SUI>(false, ctx);
    let (mut config, protocol_treasury) =
        new_protocol_objects<sui::sui::SUI>(
            &legacy_config,
            &mut protocol_admin,
            ctx,
        );
    bind_logical_auxiliary_blob_v5(
        &mut config,
        &protocol_admin,
        b"projection-auxiliary-blob".to_string(),
    );
    bind_soul_binding_proof_type_v5<TrustedSoulBindingProofV5>(
        &mut config,
        &protocol_admin,
    );
    let (root, treasury, vault, cap) = new_migrated_maker_objects_v5(
        &mut maker,
        &legacy_treasury,
        legacy_cap,
        &config,
        RIGHTS_ONCHAIN_NATIVE,
        base_policy,
        250,
        500,
        clock,
        ctx,
    );
    (
        profile,
        maker,
        legacy_treasury,
        legacy_config,
        legacy_protocol_treasury,
        protocol_admin,
        config,
        protocol_treasury,
        root,
        treasury,
        vault,
        cap,
    )
}

#[test_only]
fun eyes_recipe(): vector<RecipeSlot> {
    vector[legacy::new_recipe_slot(
        b"eyes".to_string(),
        b"bright".to_string(),
        b"#2db7a3".to_string(),
        0,
    )]
}

#[test_only]
fun hat_recipe(): vector<RecipeSlot> {
    vector[
        legacy::new_recipe_slot(
            b"eyes".to_string(),
            b"bright".to_string(),
            b"#2db7a3".to_string(),
            0,
        ),
        legacy::new_recipe_slot(
            b"hat".to_string(),
            b"moon".to_string(),
            b"#ffffff".to_string(),
            1,
        ),
    ]
}

#[test_only]
fun eyes_default_style(): vector<StyleSelectionV5> {
    vector[new_style_selection_v5(
        b"eyes".to_string(),
        b"bright".to_string(),
        b"default".to_string(),
    )]
}

#[test_only]
fun eyes_pack_style(): vector<StyleSelectionV5> {
    vector[new_style_selection_v5(
        b"eyes".to_string(),
        b"bright".to_string(),
        b"moon-glow".to_string(),
    )]
}

#[test_only]
fun hat_styles(): vector<StyleSelectionV5> {
    vector[
        new_style_selection_v5(
            b"eyes".to_string(),
            b"bright".to_string(),
            b"default".to_string(),
        ),
        new_style_selection_v5(
            b"hat".to_string(),
            b"moon".to_string(),
            b"moon-style".to_string(),
        ),
    ]
}

#[test_only]
fun register_default_base_styles(
    root: &mut MakerRootV5,
    cap: &MakerControlCapV5,
    maker: &OCMaker,
    ctx: &TxContext,
) {
    register_base_style_v5(
        root,
        cap,
        maker,
        b"eyes".to_string(),
        b"bright".to_string(),
        b"default".to_string(),
        ctx,
    );
    register_base_style_v5(
        root,
        cap,
        maker,
        b"hat".to_string(),
        b"moon".to_string(),
        b"default".to_string(),
        ctx,
    );
}

#[test_only]
fun register_moon_pack_hat_style(
    root: &mut MakerRootV5,
    cap: &MakerControlCapV5,
    maker: &OCMaker,
    ctx: &TxContext,
) {
    register_pack_style_v5(
        root,
        cap,
        maker,
        b"hat".to_string(),
        b"moon".to_string(),
        b"moon-style".to_string(),
        b"moon-pack".to_string(),
        ctx,
    );
}

#[test_only]
fun register_moon_pack_style_on_base_item(
    root: &mut MakerRootV5,
    cap: &MakerControlCapV5,
    maker: &OCMaker,
    ctx: &TxContext,
) {
    register_pack_style_v5(
        root,
        cap,
        maker,
        b"eyes".to_string(),
        b"bright".to_string(),
        b"moon-glow".to_string(),
        b"moon-pack".to_string(),
        ctx,
    );
}

#[test_only]
public fun destroy_v5_world_for_testing(
    profile: CreatorProfile,
    maker: OCMaker,
    legacy_treasury: MakerTreasury<sui::sui::SUI>,
    legacy_config: ProtocolFeeConfig,
    legacy_protocol_treasury: ProtocolTreasury<sui::sui::SUI>,
    protocol_admin: ProtocolFeeAdminCap,
    config: CommerceProtocolConfigV5,
    protocol_treasury: CommerceProtocolTreasuryV5<sui::sui::SUI>,
    root: MakerRootV5,
    treasury: MakerTreasuryV5<sui::sui::SUI>,
    vault: MakerControlVaultV5,
    cap: MakerControlCapV5,
) {
    std::unit_test::destroy(profile);
    std::unit_test::destroy(maker);
    std::unit_test::destroy(legacy_treasury);
    std::unit_test::destroy(legacy_config);
    std::unit_test::destroy(legacy_protocol_treasury);
    std::unit_test::destroy(protocol_admin);
    std::unit_test::destroy(config);
    std::unit_test::destroy(protocol_treasury);
    std::unit_test::destroy(root);
    std::unit_test::destroy(treasury);
    std::unit_test::destroy(vault);
    std::unit_test::destroy(cap);
}

#[test_only]
fun test_seal_release_commitment(): vector<u8> {
    vector[
        5, 5, 5, 5, 5, 5, 5, 5,
        5, 5, 5, 5, 5, 5, 5, 5,
        5, 5, 5, 5, 5, 5, 5, 5,
        5, 5, 5, 5, 5, 5, 5, 5,
    ]
}

#[test_only]
fun test_complete_output_bytes(value: u8): vector<u8> {
    let mut result = vector[];
    let mut index = 0u64;
    while (index < 32) {
        result.push_back(value);
        index = index + 1;
    };
    result
}

#[test_only]
fun test_complete_output_metadata(
    root: &MakerRootV5,
    payer: address,
    recipe_hash: &vector<u8>,
    nonce_value: u8,
    digest_value: u8,
): (vector<u8>, vector<u8>, vector<u8>) {
    let output_nonce = test_complete_output_bytes(nonce_value);
    let output_digest = test_complete_output_bytes(digest_value);
    let output_seal_id = derive_complete_output_seal_id_v5(
        object::id(root),
        payer,
        *recipe_hash,
        copy output_nonce,
        copy output_digest,
    );
    (output_seal_id, output_nonce, output_digest)
}

#[test_only]
fun activate_maker_with_test_seal_if_required(
    root: &mut MakerRootV5,
    cap: &MakerControlCapV5,
    ctx: &TxContext,
) {
    if (requires_seal_policy(root)) {
        let protected_style_count = root.release.protected_style_count;
        bind_seal_policy_v5(
            root,
            object::id_from_address(@0x5EA1),
            test_seal_release_commitment(),
            protected_style_count,
        );
    };
    activate_maker_v5(root, cap, ctx);
}

#[test]
fun v5_protocol_and_migration_start_fail_closed() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 1, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let base_policy = new_completion_policy(POLICY_UNLIMITED_FREE, 0, 0);
    let (
        profile,
        maker,
        legacy_treasury,
        legacy_config,
        legacy_protocol_treasury,
        protocol_admin,
        config,
        protocol_treasury,
        mut root,
        treasury,
        vault,
        cap,
    ) = v5_world_for_testing(base_policy, &mut ctx, &clock);

    assert!(!protocol_enabled_v5(&config));
    assert!(primary_protocol_fee_bps_v5(&config) == 1_000);
    assert!(root_lifecycle_v5(&root) == LIFECYCLE_PAUSED);
    assert!(root_rights_origin_v5(&root) == RIGHTS_ONCHAIN_NATIVE);
    assert!(root_soul_creator_royalty_bps_v5(&root) == 250);
    assert!(base_access_kind_v5(&root) == PACK_ACCESS_FREE);
    assert!(max_maker_resale_royalty_bps_v5() == 500);
    update_maker_resale_royalty_v5(&mut root, &cap, 500, &ctx);
    assert!(root_maker_resale_royalty_bps_v5(&root) == 500);
    assert!(!legacy::maker_minting_enabled(&maker));
    assert!(!legacy::maker_mint_fee_enabled(&maker));
    assert!(legacy::maker_archived(&maker));
    assert!(maker_treasury_balance_v5(&treasury) == 0);

    sui::clock::destroy_for_testing(clock);
    destroy_v5_world_for_testing(
        profile,
        maker,
        legacy_treasury,
        legacy_config,
        legacy_protocol_treasury,
        protocol_admin,
        config,
        protocol_treasury,
        root,
        treasury,
        vault,
        cap,
    );
}

#[test]
fun complete_quota_then_paid_splits_ninety_ten_plus_fixed() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 2, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let base_policy =
        new_completion_policy(POLICY_FREE_QUOTA_THEN_PAID, 1, 1_000);
    let (
        profile,
        maker,
        legacy_treasury,
        legacy_config,
        legacy_protocol_treasury,
        mut protocol_admin,
        mut config,
        mut protocol_treasury,
        mut root,
        mut treasury,
        vault,
        cap,
    ) = v5_world_for_testing(base_policy, &mut ctx, &clock);
    update_protocol_enabled_v5(&mut config, &protocol_admin, true);
    register_default_base_styles(&mut root, &cap, &maker, &ctx);
    seal_style_registry_v5(&mut root, &cap, &ctx);
    activate_maker_with_test_seal_if_required(&mut root, &cap, &ctx);

    let recipe = eyes_recipe();
    let style_selections = eyes_default_style();
    let recipe_hash = hash_complete_selection_v5(&recipe, &style_selections);
    let (output_seal_id, output_nonce, output_digest) =
        test_complete_output_metadata(
            &root,
            ctx.sender(),
            &recipe_hash,
            12,
            13,
        );
    let free_authorization = authorize_complete_free_v5(
        &mut root,
        &maker,
        &config,
        b"Free OC".to_string(),
        b"profile".to_string(),
        b"image".to_string(),
        b"https://image".to_string(),
        output_seal_id,
        output_nonce,
        output_digest,
        recipe_hash,
        recipe,
        style_selections,
        &clock,
        &ctx,
    );
    destroy_complete_authorization_v5_for_testing(free_authorization);

    update_fixed_complete_fee_v5(&mut config, &protocol_admin, 100);
    let paid_recipe = eyes_recipe();
    let paid_style_selections = eyes_default_style();
    let quote = quote_complete_v5(
        &root,
        &maker,
        &config,
        &paid_recipe,
        &paid_style_selections,
        ctx.sender(),
    );
    assert!(quote_creator_charge_v5(&quote) == 1_000);
    assert!(quote_protocol_percentage_v5(&quote) == 100);
    assert!(quote_fixed_fee_v5(&quote) == 100);
    assert!(quote_maker_receives_v5(&quote) == 900);
    assert!(quote_total_due_v5(&quote) == 1_100);
    let payment = coin::from_balance(
        balance::create_for_testing<sui::sui::SUI>(1_100),
        &mut ctx,
    );
    let paid_hash =
        hash_complete_selection_v5(&paid_recipe, &paid_style_selections);
    let (paid_output_seal_id, paid_output_nonce, paid_output_digest) =
        test_complete_output_metadata(
            &root,
            ctx.sender(),
            &paid_hash,
            22,
            23,
        );
    let paid_authorization = authorize_complete_paid_v5(
        &mut root,
        &maker,
        &mut treasury,
        &config,
        &mut protocol_treasury,
        payment,
        b"Paid OC".to_string(),
        b"profile".to_string(),
        b"image".to_string(),
        b"https://image".to_string(),
        paid_output_seal_id,
        paid_output_nonce,
        paid_output_digest,
        paid_hash,
        paid_recipe,
        paid_style_selections,
        &clock,
        &mut ctx,
    );
    destroy_complete_authorization_v5_for_testing(paid_authorization);
    assert!(maker_treasury_balance_v5(&treasury) == 900);
    assert!(protocol_treasury_balance_v5(&protocol_treasury) == 200);
    assert!(root_total_completes_v5(&root) == 2);

    sui::clock::destroy_for_testing(clock);
    destroy_v5_world_for_testing(
        profile,
        maker,
        legacy_treasury,
        legacy_config,
        legacy_protocol_treasury,
        protocol_admin,
        config,
        protocol_treasury,
        root,
        treasury,
        vault,
        cap,
    );
}

#[test, expected_failure(abort_code = 42, location = animacraft::commerce_v5)]
fun complete_rejects_reused_output_seal_id() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 27, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (
        _profile,
        maker,
        _legacy_treasury,
        _legacy_config,
        _legacy_protocol_treasury,
        protocol_admin,
        mut config,
        _protocol_treasury,
        mut root,
        _treasury,
        _vault,
        cap,
    ) = v5_world_for_testing(
        new_completion_policy(POLICY_UNLIMITED_FREE, 0, 0),
        &mut ctx,
        &clock,
    );
    register_default_base_styles(&mut root, &cap, &maker, &ctx);
    seal_style_registry_v5(&mut root, &cap, &ctx);
    update_protocol_enabled_v5(&mut config, &protocol_admin, true);
    activate_maker_with_test_seal_if_required(&mut root, &cap, &ctx);

    let recipe = eyes_recipe();
    let styles = eyes_default_style();
    let recipe_hash = hash_complete_selection_v5(&recipe, &styles);
    let (output_seal_id, output_nonce, output_digest) =
        test_complete_output_metadata(
            &root,
            ctx.sender(),
            &recipe_hash,
            62,
            63,
        );
    let authorization = authorize_complete_free_v5(
        &mut root,
        &maker,
        &config,
        b"First sealed output".to_string(),
        b"profile-first".to_string(),
        b"walrus-ciphertext-first".to_string(),
        b"https://cdn.example/preview-first.webp".to_string(),
        copy output_seal_id,
        copy output_nonce,
        copy output_digest,
        recipe_hash,
        recipe,
        styles,
        &clock,
        &ctx,
    );
    destroy_complete_authorization_v5_for_testing(authorization);

    let duplicate_recipe = eyes_recipe();
    let duplicate_styles = eyes_default_style();
    let duplicate_recipe_hash =
        hash_complete_selection_v5(&duplicate_recipe, &duplicate_styles);
    let duplicate_authorization = authorize_complete_free_v5(
        &mut root,
        &maker,
        &config,
        b"Duplicate sealed output".to_string(),
        b"profile-duplicate".to_string(),
        b"walrus-ciphertext-duplicate".to_string(),
        b"https://cdn.example/preview-duplicate.webp".to_string(),
        output_seal_id,
        output_nonce,
        output_digest,
        duplicate_recipe_hash,
        duplicate_recipe,
        duplicate_styles,
        &clock,
        &ctx,
    );
    destroy_complete_authorization_v5_for_testing(duplicate_authorization);
    abort 99
}

#[test, expected_failure(abort_code = 41, location = animacraft::commerce_v5)]
fun complete_rejects_forged_output_seal_id_before_recording() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 29, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (
        _profile,
        maker,
        _legacy_treasury,
        _legacy_config,
        _legacy_protocol_treasury,
        protocol_admin,
        mut config,
        _protocol_treasury,
        mut root,
        _treasury,
        _vault,
        cap,
    ) = v5_world_for_testing(
        new_completion_policy(POLICY_UNLIMITED_FREE, 0, 0),
        &mut ctx,
        &clock,
    );
    register_default_base_styles(&mut root, &cap, &maker, &ctx);
    seal_style_registry_v5(&mut root, &cap, &ctx);
    update_protocol_enabled_v5(&mut config, &protocol_admin, true);
    activate_maker_with_test_seal_if_required(&mut root, &cap, &ctx);

    let recipe = eyes_recipe();
    let styles = eyes_default_style();
    let recipe_hash = hash_complete_selection_v5(&recipe, &styles);
    let forged_authorization = authorize_complete_free_v5(
        &mut root,
        &maker,
        &config,
        b"Forged sealed output".to_string(),
        b"profile-forged".to_string(),
        b"walrus-ciphertext-forged".to_string(),
        b"https://cdn.example/preview-forged.webp".to_string(),
        test_complete_output_bytes(99),
        test_complete_output_bytes(98),
        test_complete_output_bytes(97),
        recipe_hash,
        recipe,
        styles,
        &clock,
        &ctx,
    );
    destroy_complete_authorization_v5_for_testing(forged_authorization);
    abort 99
}

#[test, expected_failure(abort_code = 43, location = animacraft::commerce_v5)]
fun complete_output_rejects_second_soul_binding() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 30, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (
        _profile,
        _maker,
        _legacy_treasury,
        _legacy_config,
        _legacy_protocol_treasury,
        _protocol_admin,
        config,
        _protocol_treasury,
        mut root,
        _treasury,
        _vault,
        _cap,
    ) = v5_world_for_testing(
        new_completion_policy(POLICY_UNLIMITED_FREE, 0, 0),
        &mut ctx,
        &clock,
    );
    let seal_id = test_complete_output_bytes(71);
    let recipe_hash = test_complete_output_bytes(72);
    record_complete_output(
        &mut root,
        ctx.sender(),
        &recipe_hash,
        copy seal_id,
        test_complete_output_bytes(73),
        test_complete_output_bytes(74),
        &b"walrus-bound-output".to_string(),
    );
    let root_id = object::id(&root);
    bind_complete_output_to_soul_v5(
        &mut root,
        &config,
        CompleteOutputSoulBindingV5 {
            root_id,
            seal_id: copy seal_id,
        },
        object::id_from_address(@0x501),
        TrustedSoulBindingProofV5 {},
    );
    bind_complete_output_to_soul_v5(
        &mut root,
        &config,
        CompleteOutputSoulBindingV5 {
            root_id,
            seal_id,
        },
        object::id_from_address(@0x502),
        TrustedSoulBindingProofV5 {},
    );
    abort 99
}

#[test, expected_failure(abort_code = 44, location = animacraft::commerce_v5)]
fun complete_output_rejects_mismatched_binding_witness() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 31, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (
        _profile,
        _maker,
        _legacy_treasury,
        _legacy_config,
        _legacy_protocol_treasury,
        _protocol_admin,
        config,
        _protocol_treasury,
        mut root,
        _treasury,
        _vault,
        _cap,
    ) = v5_world_for_testing(
        new_completion_policy(POLICY_UNLIMITED_FREE, 0, 0),
        &mut ctx,
        &clock,
    );
    let seal_id = test_complete_output_bytes(75);
    let recipe_hash = test_complete_output_bytes(76);
    record_complete_output(
        &mut root,
        ctx.sender(),
        &recipe_hash,
        copy seal_id,
        test_complete_output_bytes(77),
        test_complete_output_bytes(78),
        &b"walrus-mismatched-output".to_string(),
    );
    bind_complete_output_to_soul_v5(
        &mut root,
        &config,
        CompleteOutputSoulBindingV5 {
            root_id: object::id_from_address(@0x999),
            seal_id,
        },
        object::id_from_address(@0x503),
        TrustedSoulBindingProofV5 {},
    );
    abort 99
}

#[test, expected_failure(abort_code = 44, location = animacraft::commerce_v5)]
fun complete_output_rejects_mismatched_binding_seal() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 33, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (
        _profile,
        _maker,
        _legacy_treasury,
        _legacy_config,
        _legacy_protocol_treasury,
        _protocol_admin,
        config,
        _protocol_treasury,
        mut root,
        _treasury,
        _vault,
        _cap,
    ) = v5_world_for_testing(
        new_completion_policy(POLICY_UNLIMITED_FREE, 0, 0),
        &mut ctx,
        &clock,
    );
    let seal_id = test_complete_output_bytes(83);
    let recipe_hash = test_complete_output_bytes(84);
    record_complete_output(
        &mut root,
        ctx.sender(),
        &recipe_hash,
        seal_id,
        test_complete_output_bytes(85),
        test_complete_output_bytes(86),
        &b"walrus-mismatched-seal-output".to_string(),
    );
    let root_id = object::id(&root);
    bind_complete_output_to_soul_v5(
        &mut root,
        &config,
        CompleteOutputSoulBindingV5 {
            root_id,
            seal_id: test_complete_output_bytes(87),
        },
        object::id_from_address(@0x504),
        TrustedSoulBindingProofV5 {},
    );
    abort 99
}

#[test, expected_failure(abort_code = 45, location = animacraft::commerce_v5)]
fun complete_output_rejects_zero_soul_id() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 32, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (
        _profile,
        _maker,
        _legacy_treasury,
        _legacy_config,
        _legacy_protocol_treasury,
        _protocol_admin,
        config,
        _protocol_treasury,
        mut root,
        _treasury,
        _vault,
        _cap,
    ) = v5_world_for_testing(
        new_completion_policy(POLICY_UNLIMITED_FREE, 0, 0),
        &mut ctx,
        &clock,
    );
    let seal_id = test_complete_output_bytes(79);
    let recipe_hash = test_complete_output_bytes(80);
    record_complete_output(
        &mut root,
        ctx.sender(),
        &recipe_hash,
        copy seal_id,
        test_complete_output_bytes(81),
        test_complete_output_bytes(82),
        &b"walrus-zero-soul-output".to_string(),
    );
    let root_id = object::id(&root);
    bind_complete_output_to_soul_v5(
        &mut root,
        &config,
        CompleteOutputSoulBindingV5 {
            root_id,
            seal_id,
        },
        object::id_from_address(@0x0),
        TrustedSoulBindingProofV5 {},
    );
    abort 99
}

#[test]
fun paid_base_and_pack_issue_wallet_bound_entitlements() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 3, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (
        profile,
        maker,
        legacy_treasury,
        legacy_config,
        legacy_protocol_treasury,
        mut protocol_admin,
        mut config,
        mut protocol_treasury,
        mut root,
        mut treasury,
        vault,
        cap,
    ) = v5_world_for_testing(
        new_completion_policy(POLICY_UNLIMITED_FREE, 0, 0),
        &mut ctx,
        &clock,
    );
    update_base_access_v5(
        &mut root,
        &cap,
        PACK_ACCESS_PAID_ONCE,
        1_000,
        &ctx,
    );
    add_pack_v5(
        &mut root,
        &cap,
        b"moon-pack".to_string(),
        b"Moon Pack".to_string(),
        PACK_ACCESS_PAID_ONCE,
        500,
        new_completion_policy(POLICY_PAID_EVERY_TIME, 0, 200),
        &ctx,
    );
    register_default_base_styles(&mut root, &cap, &maker, &ctx);
    register_moon_pack_hat_style(&mut root, &cap, &maker, &ctx);
    seal_style_registry_v5(&mut root, &cap, &ctx);
    update_protocol_enabled_v5(&mut config, &protocol_admin, true);
    activate_maker_with_test_seal_if_required(&mut root, &cap, &ctx);

    let base_payment = coin::from_balance(
        balance::create_for_testing<sui::sui::SUI>(1_000),
        &mut ctx,
    );
    purchase_base_access_v5(
        &mut root,
        &mut treasury,
        &config,
        &mut protocol_treasury,
        base_payment,
        &clock,
        &mut ctx,
    );
    assert!(has_base_entitlement_v5(&root, ctx.sender()));
    let pack_payment = coin::from_balance(
        balance::create_for_testing<sui::sui::SUI>(500),
        &mut ctx,
    );
    purchase_pack_v5(
        &mut root,
        &mut treasury,
        &config,
        &mut protocol_treasury,
        b"moon-pack".to_string(),
        pack_payment,
        &clock,
        &mut ctx,
    );
    assert!(has_pack_entitlement_v5(
        &root,
        b"moon-pack".to_string(),
        ctx.sender(),
    ));
    assert!(maker_treasury_balance_v5(&treasury) == 1_350);
    assert!(protocol_treasury_balance_v5(&protocol_treasury) == 150);
    let recipe = hat_recipe();
    let style_selections = hat_styles();
    let quote = quote_complete_v5(
        &root,
        &maker,
        &config,
        &recipe,
        &style_selections,
        ctx.sender(),
    );
    assert!(quote_creator_charge_v5(&quote) == 200);
    assert!(quote_total_due_v5(&quote) == 200);
    assert!(quote_used_pack_count_v5(&quote) == 1);

    sui::clock::destroy_for_testing(clock);
    destroy_v5_world_for_testing(
        profile,
        maker,
        legacy_treasury,
        legacy_config,
        legacy_protocol_treasury,
        protocol_admin,
        config,
        protocol_treasury,
        root,
        treasury,
        vault,
        cap,
    );
}

#[test]
fun maker_sale_zero_balance_rotates_owner_and_epoch() {
    let mut seller_ctx =
        sui::tx_context::new_from_hint(@0xA11, 4, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut seller_ctx);
    let (
        profile,
        maker,
        legacy_treasury,
        legacy_config,
        legacy_protocol_treasury,
        mut protocol_admin,
        mut config,
        mut protocol_treasury,
        mut root,
        treasury,
        vault,
        cap,
    ) = v5_world_for_testing(
        new_completion_policy(POLICY_UNLIMITED_FREE, 0, 0),
        &mut seller_ctx,
        &clock,
    );
    update_protocol_enabled_v5(&mut config, &protocol_admin, true);
    let mut listing =
        new_maker_listing_v5(
            &mut root,
            &treasury,
            cap,
            &config,
            10_000,
            &mut seller_ctx,
        );
    assert!(root_lifecycle_v5(&root) == LIFECYCLE_SALE_PENDING);
    assert!(listing_protocol_fee_bps_v5(&listing) == 250);
    // A listing is an exact quote: later protocol configuration changes do
    // not change the seller's already-presented proceeds.
    update_maker_market_fee_bps_v5(&mut config, &protocol_admin, 1_000);

    let mut buyer_ctx =
        sui::tx_context::new_from_hint(@0xB22, 5, 0, 0, 0);
    let payment = coin::from_balance(
        balance::create_for_testing<sui::sui::SUI>(10_000),
        &mut buyer_ctx,
    );
    buy_maker_v5(
        &mut root,
        &treasury,
        &mut listing,
        &config,
        &mut protocol_treasury,
        payment,
        &mut buyer_ctx,
    );
    assert!(root_current_owner_v5(&root) == @0xB22);
    assert!(root_ownership_epoch_v5(&root) == 1);
    assert!(root_lifecycle_v5(&root) == LIFECYCLE_PAUSED);
    assert!(!listing_active_v5(&listing));
    assert!(protocol_treasury_balance_v5(&protocol_treasury) == 250);

    sui::clock::destroy_for_testing(clock);
    std::unit_test::destroy(profile);
    std::unit_test::destroy(maker);
    std::unit_test::destroy(legacy_treasury);
    std::unit_test::destroy(legacy_config);
    std::unit_test::destroy(legacy_protocol_treasury);
    std::unit_test::destroy(protocol_admin);
    std::unit_test::destroy(config);
    std::unit_test::destroy(protocol_treasury);
    std::unit_test::destroy(root);
    std::unit_test::destroy(treasury);
    std::unit_test::destroy(vault);
    std::unit_test::destroy(listing);
}

#[test, expected_failure(abort_code = 17, location = animacraft::commerce_v5)]
fun paid_base_blocks_complete_before_entitlement() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 6, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (
        _profile,
        maker,
        _legacy_treasury,
        _legacy_config,
        _legacy_protocol_treasury,
        protocol_admin,
        mut config,
        _protocol_treasury,
        mut root,
        _treasury,
        _vault,
        cap,
    ) = v5_world_for_testing(
        new_completion_policy(POLICY_UNLIMITED_FREE, 0, 0),
        &mut ctx,
        &clock,
    );
    update_base_access_v5(
        &mut root,
        &cap,
        PACK_ACCESS_PAID_ONCE,
        1_000,
        &ctx,
    );
    update_protocol_enabled_v5(&mut config, &protocol_admin, true);
    register_default_base_styles(&mut root, &cap, &maker, &ctx);
    seal_style_registry_v5(&mut root, &cap, &ctx);
    activate_maker_with_test_seal_if_required(&mut root, &cap, &ctx);
    let recipe = eyes_recipe();
    let style_selections = eyes_default_style();
    let _ = quote_complete_v5(
        &root,
        &maker,
        &config,
        &recipe,
        &style_selections,
        ctx.sender(),
    );
    abort 99
}

#[test, expected_failure(abort_code = 17, location = animacraft::commerce_v5)]
fun paid_pack_blocks_complete_before_entitlement() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 7, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (
        _profile,
        maker,
        _legacy_treasury,
        _legacy_config,
        _legacy_protocol_treasury,
        protocol_admin,
        mut config,
        _protocol_treasury,
        mut root,
        _treasury,
        _vault,
        cap,
    ) = v5_world_for_testing(
        new_completion_policy(POLICY_UNLIMITED_FREE, 0, 0),
        &mut ctx,
        &clock,
    );
    add_pack_v5(
        &mut root,
        &cap,
        b"moon-pack".to_string(),
        b"Moon Pack".to_string(),
        PACK_ACCESS_PAID_ONCE,
        500,
        new_completion_policy(POLICY_UNLIMITED_FREE, 0, 0),
        &ctx,
    );
    register_default_base_styles(&mut root, &cap, &maker, &ctx);
    register_moon_pack_hat_style(&mut root, &cap, &maker, &ctx);
    seal_style_registry_v5(&mut root, &cap, &ctx);
    update_protocol_enabled_v5(&mut config, &protocol_admin, true);
    activate_maker_with_test_seal_if_required(&mut root, &cap, &ctx);
    let recipe = hat_recipe();
    let style_selections = hat_styles();
    let _ = quote_complete_v5(
        &root,
        &maker,
        &config,
        &recipe,
        &style_selections,
        ctx.sender(),
    );
    abort 99
}

#[test, expected_failure(abort_code = 12, location = animacraft::commerce_v5)]
fun maker_with_unwithdrawn_revenue_cannot_be_listed() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 8, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (
        _profile,
        _maker,
        _legacy_treasury,
        _legacy_config,
        _legacy_protocol_treasury,
        protocol_admin,
        mut config,
        mut protocol_treasury,
        mut root,
        mut treasury,
        _vault,
        cap,
    ) = v5_world_for_testing(
        new_completion_policy(POLICY_UNLIMITED_FREE, 0, 0),
        &mut ctx,
        &clock,
    );
    update_base_access_v5(
        &mut root,
        &cap,
        PACK_ACCESS_PAID_ONCE,
        1_000,
        &ctx,
    );
    update_protocol_enabled_v5(&mut config, &protocol_admin, true);
    register_base_style_v5(
        &mut root,
        &cap,
        &_maker,
        b"eyes".to_string(),
        b"bright".to_string(),
        b"default".to_string(),
        &ctx,
    );
    seal_style_registry_v5(&mut root, &cap, &ctx);
    activate_maker_with_test_seal_if_required(&mut root, &cap, &ctx);
    let payment = coin::from_balance(
        balance::create_for_testing<sui::sui::SUI>(1_000),
        &mut ctx,
    );
    purchase_base_access_v5(
        &mut root,
        &mut treasury,
        &config,
        &mut protocol_treasury,
        payment,
        &clock,
        &mut ctx,
    );
    pause_maker_v5(&mut root, &cap, &ctx);
    let listing = new_maker_listing_v5(
        &mut root,
        &treasury,
        cap,
        &config,
        10_000,
        &mut ctx,
    );
    std::unit_test::destroy(listing);
    abort 99
}

#[test]
fun exact_pack_style_on_base_item_is_charged_and_committed() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 9, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (
        profile,
        maker,
        legacy_treasury,
        legacy_config,
        legacy_protocol_treasury,
        protocol_admin,
        mut config,
        mut protocol_treasury,
        mut root,
        mut treasury,
        vault,
        cap,
    ) = v5_world_for_testing(
        new_completion_policy(POLICY_UNLIMITED_FREE, 0, 0),
        &mut ctx,
        &clock,
    );
    add_pack_v5(
        &mut root,
        &cap,
        b"moon-pack".to_string(),
        b"Moon Pack".to_string(),
        PACK_ACCESS_PAID_ONCE,
        500,
        new_completion_policy(POLICY_PAID_EVERY_TIME, 0, 250),
        &ctx,
    );
    register_base_style_v5(
        &mut root,
        &cap,
        &maker,
        b"eyes".to_string(),
        b"bright".to_string(),
        b"default".to_string(),
        &ctx,
    );
    register_moon_pack_style_on_base_item(&mut root, &cap, &maker, &ctx);
    seal_style_registry_v5(&mut root, &cap, &ctx);
    update_protocol_enabled_v5(&mut config, &protocol_admin, true);
    activate_maker_with_test_seal_if_required(&mut root, &cap, &ctx);

    let pack_payment = coin::from_balance(
        balance::create_for_testing<sui::sui::SUI>(500),
        &mut ctx,
    );
    purchase_pack_v5(
        &mut root,
        &mut treasury,
        &config,
        &mut protocol_treasury,
        b"moon-pack".to_string(),
        pack_payment,
        &clock,
        &mut ctx,
    );

    let recipe = eyes_recipe();
    let base_style = eyes_default_style();
    let pack_style = eyes_pack_style();
    let base_quote = quote_complete_v5(
        &root,
        &maker,
        &config,
        &recipe,
        &base_style,
        ctx.sender(),
    );
    assert!(quote_creator_charge_v5(&base_quote) == 0);
    assert!(quote_used_pack_count_v5(&base_quote) == 0);
    let quote = quote_complete_v5(
        &root,
        &maker,
        &config,
        &recipe,
        &pack_style,
        ctx.sender(),
    );
    assert!(quote_creator_charge_v5(&quote) == 250);
    assert!(quote_total_due_v5(&quote) == 250);
    assert!(quote_used_pack_count_v5(&quote) == 1);
    assert!(
        hash_complete_selection_v5(&recipe, &base_style)
            != hash_complete_selection_v5(&recipe, &pack_style),
    );

    let payment = coin::from_balance(
        balance::create_for_testing<sui::sui::SUI>(250),
        &mut ctx,
    );
    let recipe_hash = hash_complete_selection_v5(&recipe, &pack_style);
    let (output_seal_id, output_nonce, output_digest) =
        test_complete_output_metadata(
            &root,
            ctx.sender(),
            &recipe_hash,
            32,
            33,
        );
    let authorization = authorize_complete_paid_v5(
        &mut root,
        &maker,
        &mut treasury,
        &config,
        &mut protocol_treasury,
        payment,
        b"Pack OC".to_string(),
        b"profile".to_string(),
        b"image".to_string(),
        b"https://image".to_string(),
        output_seal_id,
        output_nonce,
        output_digest,
        copy recipe_hash,
        recipe,
        pack_style,
        &clock,
        &mut ctx,
    );
    let (authorization, soul_creator_royalty_bps, output_binding) =
        consume_commerce_v5_soul_mint_authorization(authorization);
    assert!(soul_creator_royalty_bps == 250);
    assert!(
        complete_output_soul_binding_root_id_v5(&output_binding)
            == object::id(&root),
    );
    assert!(
        complete_output_soul_binding_seal_id_v5(&output_binding)
            == &output_seal_id,
    );
    let soul_id = object::id_from_address(@0x501);
    bind_complete_output_to_soul_v5(
        &mut root,
        &config,
        output_binding,
        soul_id,
        TrustedSoulBindingProofV5 {},
    );
    let output =
        complete_output_record_v5(&root, output_seal_id);
    assert!(complete_output_is_soul_bound_v5(output));
    assert!(
        complete_output_bound_soul_id_v5(output).borrow() == &soul_id,
    );
    let (
        authorization,
        protocol_config_id,
        protocol_treasury_id,
        protocol_fee_bps,
        protocol_fee_amount,
    ) = legacy::consume_canonical_soul_mint_authorization(authorization);
    let (
        authorization_version,
        stable_maker_id,
        stable_treasury_id,
        maker_creator,
        payer,
        _,
        _,
        _,
        _,
        authorized_selection_hash,
        _,
        _,
        _,
        total_paid_atomic,
        _,
        _,
    ) = legacy::consume_soul_mint_authorization(authorization);
    assert!(authorization_version == 5);
    assert!(stable_maker_id == object::id(&root));
    assert!(stable_treasury_id == object::id(&treasury));
    assert!(maker_creator == @0xA11 && payer == @0xA11);
    assert!(protocol_config_id == object::id(&config));
    assert!(protocol_treasury_id == object::id(&protocol_treasury));
    assert!(protocol_fee_bps == 1_000);
    assert!(protocol_fee_amount == 25);
    assert!(total_paid_atomic == 250);
    assert!(authorized_selection_hash == recipe_hash);
    assert!(maker_treasury_balance_v5(&treasury) == 675);
    assert!(protocol_treasury_balance_v5(&protocol_treasury) == 75);
    assert!(root_total_completes_v5(&root) == 1);

    sui::clock::destroy_for_testing(clock);
    destroy_v5_world_for_testing(
        profile,
        maker,
        legacy_treasury,
        legacy_config,
        legacy_protocol_treasury,
        protocol_admin,
        config,
        protocol_treasury,
        root,
        treasury,
        vault,
        cap,
    );
}

#[test, expected_failure(abort_code = 17, location = animacraft::commerce_v5)]
fun exact_pack_style_on_base_item_blocks_without_entitlement() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 10, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (
        _profile,
        maker,
        _legacy_treasury,
        _legacy_config,
        _legacy_protocol_treasury,
        protocol_admin,
        mut config,
        _protocol_treasury,
        mut root,
        _treasury,
        _vault,
        cap,
    ) = v5_world_for_testing(
        new_completion_policy(POLICY_UNLIMITED_FREE, 0, 0),
        &mut ctx,
        &clock,
    );
    add_pack_v5(
        &mut root,
        &cap,
        b"moon-pack".to_string(),
        b"Moon Pack".to_string(),
        PACK_ACCESS_PAID_ONCE,
        500,
        new_completion_policy(POLICY_UNLIMITED_FREE, 0, 0),
        &ctx,
    );
    register_base_style_v5(
        &mut root,
        &cap,
        &maker,
        b"eyes".to_string(),
        b"bright".to_string(),
        b"default".to_string(),
        &ctx,
    );
    register_moon_pack_style_on_base_item(&mut root, &cap, &maker, &ctx);
    seal_style_registry_v5(&mut root, &cap, &ctx);
    update_protocol_enabled_v5(&mut config, &protocol_admin, true);
    activate_maker_with_test_seal_if_required(&mut root, &cap, &ctx);
    let recipe = eyes_recipe();
    let pack_style = eyes_pack_style();
    let _ = quote_complete_v5(
        &root,
        &maker,
        &config,
        &recipe,
        &pack_style,
        ctx.sender(),
    );
    abort 99
}

#[test, expected_failure(abort_code = 32, location = animacraft::commerce_v5)]
fun unregistered_style_cannot_reuse_a_valid_item_recipe() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 11, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (
        _profile,
        maker,
        _legacy_treasury,
        _legacy_config,
        _legacy_protocol_treasury,
        protocol_admin,
        mut config,
        _protocol_treasury,
        mut root,
        _treasury,
        _vault,
        cap,
    ) = v5_world_for_testing(
        new_completion_policy(POLICY_UNLIMITED_FREE, 0, 0),
        &mut ctx,
        &clock,
    );
    register_base_style_v5(
        &mut root,
        &cap,
        &maker,
        b"eyes".to_string(),
        b"bright".to_string(),
        b"default".to_string(),
        &ctx,
    );
    seal_style_registry_v5(&mut root, &cap, &ctx);
    update_protocol_enabled_v5(&mut config, &protocol_admin, true);
    activate_maker_with_test_seal_if_required(&mut root, &cap, &ctx);
    let recipe = eyes_recipe();
    let unknown_style = vector[new_style_selection_v5(
        b"eyes".to_string(),
        b"bright".to_string(),
        b"not-registered".to_string(),
    )];
    let _ = quote_complete_v5(
        &root,
        &maker,
        &config,
        &recipe,
        &unknown_style,
        ctx.sender(),
    );
    abort 99
}

#[test, expected_failure(abort_code = 33, location = animacraft::commerce_v5)]
fun style_selection_must_match_the_same_recipe_slot() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 12, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (
        _profile,
        maker,
        _legacy_treasury,
        _legacy_config,
        _legacy_protocol_treasury,
        protocol_admin,
        mut config,
        _protocol_treasury,
        mut root,
        _treasury,
        _vault,
        cap,
    ) = v5_world_for_testing(
        new_completion_policy(POLICY_UNLIMITED_FREE, 0, 0),
        &mut ctx,
        &clock,
    );
    register_default_base_styles(&mut root, &cap, &maker, &ctx);
    seal_style_registry_v5(&mut root, &cap, &ctx);
    update_protocol_enabled_v5(&mut config, &protocol_admin, true);
    activate_maker_with_test_seal_if_required(&mut root, &cap, &ctx);
    let recipe = eyes_recipe();
    let wrong_slot = vector[new_style_selection_v5(
        b"hat".to_string(),
        b"moon".to_string(),
        b"default".to_string(),
    )];
    let _ = quote_complete_v5(
        &root,
        &maker,
        &config,
        &recipe,
        &wrong_slot,
        ctx.sender(),
    );
    abort 99
}

#[test, expected_failure(abort_code = 33, location = animacraft::commerce_v5)]
fun every_recipe_slot_requires_one_exact_style_selection() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 13, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (
        _profile,
        maker,
        _legacy_treasury,
        _legacy_config,
        _legacy_protocol_treasury,
        protocol_admin,
        mut config,
        _protocol_treasury,
        mut root,
        _treasury,
        _vault,
        cap,
    ) = v5_world_for_testing(
        new_completion_policy(POLICY_UNLIMITED_FREE, 0, 0),
        &mut ctx,
        &clock,
    );
    register_default_base_styles(&mut root, &cap, &maker, &ctx);
    seal_style_registry_v5(&mut root, &cap, &ctx);
    update_protocol_enabled_v5(&mut config, &protocol_admin, true);
    activate_maker_with_test_seal_if_required(&mut root, &cap, &ctx);
    let recipe = hat_recipe();
    let incomplete = eyes_default_style();
    let _ = quote_complete_v5(
        &root,
        &maker,
        &config,
        &recipe,
        &incomplete,
        ctx.sender(),
    );
    abort 99
}

#[test, expected_failure(abort_code = 30, location = animacraft::commerce_v5)]
fun sealed_style_registry_is_immutable() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 14, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (
        _profile,
        maker,
        _legacy_treasury,
        _legacy_config,
        _legacy_protocol_treasury,
        _protocol_admin,
        _config,
        _protocol_treasury,
        mut root,
        _treasury,
        _vault,
        cap,
    ) = v5_world_for_testing(
        new_completion_policy(POLICY_UNLIMITED_FREE, 0, 0),
        &mut ctx,
        &clock,
    );
    register_base_style_v5(
        &mut root,
        &cap,
        &maker,
        b"eyes".to_string(),
        b"bright".to_string(),
        b"default".to_string(),
        &ctx,
    );
    seal_style_registry_v5(&mut root, &cap, &ctx);
    register_base_style_v5(
        &mut root,
        &cap,
        &maker,
        b"hat".to_string(),
        b"moon".to_string(),
        b"default".to_string(),
        &ctx,
    );
    abort 99
}

#[test, expected_failure(abort_code = 34, location = animacraft::commerce_v5)]
fun maker_cannot_activate_before_style_registry_is_sealed() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 15, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (
        _profile,
        _maker,
        _legacy_treasury,
        _legacy_config,
        _legacy_protocol_treasury,
        _protocol_admin,
        _config,
        _protocol_treasury,
        mut root,
        _treasury,
        _vault,
        cap,
    ) = v5_world_for_testing(
        new_completion_policy(POLICY_UNLIMITED_FREE, 0, 0),
        &mut ctx,
        &clock,
    );
    activate_maker_with_test_seal_if_required(&mut root, &cap, &ctx);
    abort 99
}

#[test, expected_failure(abort_code = 36, location = animacraft::commerce_v5)]
fun paid_maker_cannot_activate_without_bound_seal_policy() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 27, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (
        _profile,
        maker,
        _legacy_treasury,
        _legacy_config,
        _legacy_protocol_treasury,
        _protocol_admin,
        _config,
        _protocol_treasury,
        mut root,
        _treasury,
        _vault,
        cap,
    ) = v5_world_for_testing(
        new_completion_policy(POLICY_UNLIMITED_FREE, 0, 0),
        &mut ctx,
        &clock,
    );
    update_base_access_v5(
        &mut root,
        &cap,
        PACK_ACCESS_PAID_ONCE,
        1_000,
        &ctx,
    );
    register_default_base_styles(&mut root, &cap, &maker, &ctx);
    seal_style_registry_v5(&mut root, &cap, &ctx);
    assert!(root_requires_seal_policy_v5(&root));
    assert!(!root_seal_policy_bound_v5(&root));
    activate_maker_v5(&mut root, &cap, &ctx);
    abort 99
}

#[test, expected_failure(abort_code = 35, location = animacraft::commerce_v5)]
fun paid_maker_release_rejects_second_seal_policy_binding() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 28, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (
        _profile,
        maker,
        _legacy_treasury,
        _legacy_config,
        _legacy_protocol_treasury,
        _protocol_admin,
        _config,
        _protocol_treasury,
        mut root,
        _treasury,
        _vault,
        cap,
    ) = v5_world_for_testing(
        new_completion_policy(POLICY_UNLIMITED_FREE, 0, 0),
        &mut ctx,
        &clock,
    );
    add_pack_v5(
        &mut root,
        &cap,
        b"premium".to_string(),
        b"Premium".to_string(),
        PACK_ACCESS_PAID_ONCE,
        500,
        new_completion_policy(POLICY_UNLIMITED_FREE, 0, 0),
        &ctx,
    );
    register_default_base_styles(&mut root, &cap, &maker, &ctx);
    register_pack_style_v5(
        &mut root,
        &cap,
        &maker,
        b"eyes".to_string(),
        b"bright".to_string(),
        b"premium-style".to_string(),
        b"premium".to_string(),
        &ctx,
    );
    seal_style_registry_v5(&mut root, &cap, &ctx);
    let protected_style_count = root.release.protected_style_count;
    bind_seal_policy_v5(
        &mut root,
        object::id_from_address(@0x5EA1),
        test_seal_release_commitment(),
        protected_style_count,
    );
    assert!(root_seal_policy_bound_v5(&root));
    assert!(
        *root_seal_policy_id_v5(&root).borrow()
            == object::id_from_address(@0x5EA1),
    );
    assert!(
        root_seal_release_commitment_v5(&root)
            == &test_seal_release_commitment(),
    );
    let protected_style_count = root.release.protected_style_count;
    bind_seal_policy_v5(
        &mut root,
        object::id_from_address(@0x5EA2),
        test_seal_release_commitment(),
        protected_style_count,
    );
    abort 99
}

#[test, expected_failure(abort_code = 31, location = animacraft::commerce_v5)]
fun duplicate_exact_style_binding_is_rejected() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 16, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (
        _profile,
        maker,
        _legacy_treasury,
        _legacy_config,
        _legacy_protocol_treasury,
        _protocol_admin,
        _config,
        _protocol_treasury,
        mut root,
        _treasury,
        _vault,
        cap,
    ) = v5_world_for_testing(
        new_completion_policy(POLICY_UNLIMITED_FREE, 0, 0),
        &mut ctx,
        &clock,
    );
    register_base_style_v5(
        &mut root,
        &cap,
        &maker,
        b"eyes".to_string(),
        b"bright".to_string(),
        b"default".to_string(),
        &ctx,
    );
    register_base_style_v5(
        &mut root,
        &cap,
        &maker,
        b"eyes".to_string(),
        b"bright".to_string(),
        b"default".to_string(),
        &ctx,
    );
    abort 99
}

#[test, expected_failure(abort_code = 19, location = animacraft::commerce_v5)]
fun base_total_complete_cap_blocks_the_next_wallet_complete() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 17, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let base_policy = new_completion_policy_with_cap(
        POLICY_UNLIMITED_FREE,
        0,
        0,
        1,
    );
    assert!(completion_policy_total_cap(&base_policy) == 1);
    let (
        _profile,
        maker,
        _legacy_treasury,
        _legacy_config,
        _legacy_protocol_treasury,
        protocol_admin,
        mut config,
        _protocol_treasury,
        mut root,
        _treasury,
        _vault,
        cap,
    ) = v5_world_for_testing(base_policy, &mut ctx, &clock);
    register_base_style_v5(
        &mut root,
        &cap,
        &maker,
        b"eyes".to_string(),
        b"bright".to_string(),
        b"default".to_string(),
        &ctx,
    );
    seal_style_registry_v5(&mut root, &cap, &ctx);
    update_protocol_enabled_v5(&mut config, &protocol_admin, true);
    activate_maker_with_test_seal_if_required(&mut root, &cap, &ctx);

    let recipe = eyes_recipe();
    let styles = eyes_default_style();
    let recipe_hash = hash_complete_selection_v5(&recipe, &styles);
    let (output_seal_id, output_nonce, output_digest) =
        test_complete_output_metadata(
            &root,
            ctx.sender(),
            &recipe_hash,
            42,
            43,
        );
    let authorization = authorize_complete_free_v5(
        &mut root,
        &maker,
        &config,
        b"Last Base OC".to_string(),
        b"profile".to_string(),
        b"image".to_string(),
        b"https://image".to_string(),
        output_seal_id,
        output_nonce,
        output_digest,
        recipe_hash,
        recipe,
        styles,
        &clock,
        &ctx,
    );
    destroy_complete_authorization_v5_for_testing(authorization);
    assert!(root_total_completes_v5(&root) == 1);

    let next_recipe = eyes_recipe();
    let next_styles = eyes_default_style();
    let _ = quote_complete_v5(
        &root,
        &maker,
        &config,
        &next_recipe,
        &next_styles,
        ctx.sender(),
    );
    abort 99
}

#[test, expected_failure(abort_code = 19, location = animacraft::commerce_v5)]
fun free_pack_needs_no_claim_and_total_cap_blocks_only_that_pack() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 18, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (
        _profile,
        maker,
        _legacy_treasury,
        _legacy_config,
        _legacy_protocol_treasury,
        protocol_admin,
        mut config,
        _protocol_treasury,
        mut root,
        _treasury,
        _vault,
        cap,
    ) = v5_world_for_testing(
        new_completion_policy(POLICY_UNLIMITED_FREE, 0, 0),
        &mut ctx,
        &clock,
    );
    add_pack_v5(
        &mut root,
        &cap,
        b"moon-pack".to_string(),
        b"Moon Pack".to_string(),
        PACK_ACCESS_FREE,
        0,
        new_completion_policy_with_cap(POLICY_UNLIMITED_FREE, 0, 0, 1),
        &ctx,
    );
    register_base_style_v5(
        &mut root,
        &cap,
        &maker,
        b"eyes".to_string(),
        b"bright".to_string(),
        b"default".to_string(),
        &ctx,
    );
    register_moon_pack_style_on_base_item(&mut root, &cap, &maker, &ctx);
    seal_style_registry_v5(&mut root, &cap, &ctx);
    update_protocol_enabled_v5(&mut config, &protocol_admin, true);
    activate_maker_v5(&mut root, &cap, &ctx);
    // FREE Pack Styles are immediately usable. A free claim/PackPass is an
    // optional receipt and is deliberately not created in this test.
    assert!(has_pack_entitlement_v5(
        &root,
        b"moon-pack".to_string(),
        ctx.sender(),
    ));

    let recipe = eyes_recipe();
    let styles = eyes_pack_style();
    let recipe_hash = hash_complete_selection_v5(&recipe, &styles);
    let (output_seal_id, output_nonce, output_digest) =
        test_complete_output_metadata(
            &root,
            ctx.sender(),
            &recipe_hash,
            52,
            53,
        );
    let authorization = authorize_complete_free_v5(
        &mut root,
        &maker,
        &config,
        b"Last Pack OC".to_string(),
        b"profile".to_string(),
        b"image".to_string(),
        b"https://image".to_string(),
        output_seal_id,
        output_nonce,
        output_digest,
        recipe_hash,
        recipe,
        styles,
        &clock,
        &ctx,
    );
    destroy_complete_authorization_v5_for_testing(authorization);

    let base_recipe = eyes_recipe();
    let base_styles = eyes_default_style();
    let base_quote = quote_complete_v5(
        &root,
        &maker,
        &config,
        &base_recipe,
        &base_styles,
        ctx.sender(),
    );
    assert!(quote_used_pack_count_v5(&base_quote) == 0);
    let next_pack_recipe = eyes_recipe();
    let next_pack_styles = eyes_pack_style();
    let _ = quote_complete_v5(
        &root,
        &maker,
        &config,
        &next_pack_recipe,
        &next_pack_styles,
        ctx.sender(),
    );
    abort 99
}

#[test, expected_failure(abort_code = 26, location = animacraft::commerce_v5)]
fun maker_resale_royalty_above_five_percent_is_rejected() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 19, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (
        _profile,
        _maker,
        _legacy_treasury,
        _legacy_config,
        _legacy_protocol_treasury,
        _protocol_admin,
        _config,
        _protocol_treasury,
        mut root,
        _treasury,
        _vault,
        cap,
    ) = v5_world_for_testing(
        new_completion_policy(POLICY_UNLIMITED_FREE, 0, 0),
        &mut ctx,
        &clock,
    );
    update_maker_resale_royalty_v5(&mut root, &cap, 501, &ctx);
    abort 99
}

#[test, expected_failure(abort_code = 26, location = animacraft::commerce_v5)]
fun maker_resale_royalty_outside_half_percent_steps_is_rejected() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 20, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (
        _profile,
        _maker,
        _legacy_treasury,
        _legacy_config,
        _legacy_protocol_treasury,
        _protocol_admin,
        _config,
        _protocol_treasury,
        mut root,
        _treasury,
        _vault,
        cap,
    ) = v5_world_for_testing(
        new_completion_policy(POLICY_UNLIMITED_FREE, 0, 0),
        &mut ctx,
        &clock,
    );
    update_maker_resale_royalty_v5(&mut root, &cap, 425, &ctx);
    abort 99
}

#[test, expected_failure(abort_code = 30, location = animacraft::commerce_v5)]
fun maker_resale_royalty_is_frozen_when_style_registry_is_sealed() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 21, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (
        _profile,
        maker,
        _legacy_treasury,
        _legacy_config,
        _legacy_protocol_treasury,
        _protocol_admin,
        _config,
        _protocol_treasury,
        mut root,
        _treasury,
        _vault,
        cap,
    ) = v5_world_for_testing(
        new_completion_policy(POLICY_UNLIMITED_FREE, 0, 0),
        &mut ctx,
        &clock,
    );
    register_default_base_styles(&mut root, &cap, &maker, &ctx);
    seal_style_registry_v5(&mut root, &cap, &ctx);
    update_maker_resale_royalty_v5(&mut root, &cap, 0, &ctx);
    abort 99
}

#[test, expected_failure(abort_code = 30, location = animacraft::commerce_v5)]
fun base_complete_policy_is_frozen_when_style_registry_is_sealed() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 23, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (
        _profile,
        maker,
        _legacy_treasury,
        _legacy_config,
        _legacy_protocol_treasury,
        _protocol_admin,
        _config,
        _protocol_treasury,
        mut root,
        _treasury,
        _vault,
        cap,
    ) = v5_world_for_testing(
        new_completion_policy(POLICY_UNLIMITED_FREE, 0, 0),
        &mut ctx,
        &clock,
    );
    register_default_base_styles(&mut root, &cap, &maker, &ctx);
    seal_style_registry_v5(&mut root, &cap, &ctx);
    update_base_policy_v5(
        &mut root,
        &cap,
        new_completion_policy(POLICY_PAID_EVERY_TIME, 0, 100),
        &ctx,
    );
    abort 99
}

#[test, expected_failure(abort_code = 30, location = animacraft::commerce_v5)]
fun base_access_is_frozen_when_style_registry_is_sealed() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 24, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (
        _profile,
        maker,
        _legacy_treasury,
        _legacy_config,
        _legacy_protocol_treasury,
        _protocol_admin,
        _config,
        _protocol_treasury,
        mut root,
        _treasury,
        _vault,
        cap,
    ) = v5_world_for_testing(
        new_completion_policy(POLICY_UNLIMITED_FREE, 0, 0),
        &mut ctx,
        &clock,
    );
    register_default_base_styles(&mut root, &cap, &maker, &ctx);
    seal_style_registry_v5(&mut root, &cap, &ctx);
    update_base_access_v5(
        &mut root,
        &cap,
        PACK_ACCESS_PAID_ONCE,
        100,
        &ctx,
    );
    abort 99
}

#[test, expected_failure(abort_code = 30, location = animacraft::commerce_v5)]
fun pack_cannot_be_added_after_style_registry_is_sealed() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 25, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (
        _profile,
        maker,
        _legacy_treasury,
        _legacy_config,
        _legacy_protocol_treasury,
        _protocol_admin,
        _config,
        _protocol_treasury,
        mut root,
        _treasury,
        _vault,
        cap,
    ) = v5_world_for_testing(
        new_completion_policy(POLICY_UNLIMITED_FREE, 0, 0),
        &mut ctx,
        &clock,
    );
    register_default_base_styles(&mut root, &cap, &maker, &ctx);
    seal_style_registry_v5(&mut root, &cap, &ctx);
    add_pack_v5(
        &mut root,
        &cap,
        b"late-pack".to_string(),
        b"Late Pack".to_string(),
        PACK_ACCESS_FREE,
        0,
        new_completion_policy(POLICY_UNLIMITED_FREE, 0, 0),
        &ctx,
    );
    abort 99
}

#[test, expected_failure(abort_code = 30, location = animacraft::commerce_v5)]
fun pack_terms_are_frozen_when_style_registry_is_sealed() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 26, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (
        _profile,
        maker,
        _legacy_treasury,
        _legacy_config,
        _legacy_protocol_treasury,
        _protocol_admin,
        _config,
        _protocol_treasury,
        mut root,
        _treasury,
        _vault,
        cap,
    ) = v5_world_for_testing(
        new_completion_policy(POLICY_UNLIMITED_FREE, 0, 0),
        &mut ctx,
        &clock,
    );
    add_pack_v5(
        &mut root,
        &cap,
        b"moon-pack".to_string(),
        b"Moon Pack".to_string(),
        PACK_ACCESS_PAID_ONCE,
        500,
        new_completion_policy(POLICY_UNLIMITED_FREE, 0, 0),
        &ctx,
    );
    register_default_base_styles(&mut root, &cap, &maker, &ctx);
    register_moon_pack_hat_style(&mut root, &cap, &maker, &ctx);
    seal_style_registry_v5(&mut root, &cap, &ctx);
    update_pack_v5(
        &mut root,
        &cap,
        b"moon-pack".to_string(),
        b"Moon Pack".to_string(),
        PACK_ACCESS_PAID_ONCE,
        500,
        new_completion_policy(POLICY_UNLIMITED_FREE, 0, 0),
        false,
        &ctx,
    );
    abort 99
}

#[test]
fun paid_base_protects_visual_rows_but_not_verified_logical_rows() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 40, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (
        profile,
        maker,
        legacy_treasury,
        legacy_config,
        legacy_protocol_treasury,
        protocol_admin,
        config,
        protocol_treasury,
        mut root,
        treasury,
        vault,
        cap,
    ) = v5_world_for_testing(
        new_completion_policy(POLICY_UNLIMITED_FREE, 0, 0),
        &mut ctx,
        &clock,
    );
    update_base_access_v5(
        &mut root,
        &cap,
        PACK_ACCESS_PAID_ONCE,
        100,
        &ctx,
    );
    register_base_style_v5(
        &mut root,
        &cap,
        &maker,
        b"eyes".to_string(),
        b"bright".to_string(),
        b"default".to_string(),
        &ctx,
    );
    register_base_logical_style_v5(
        &mut root,
        &cap,
        &maker,
        b"hat".to_string(),
        b"__ac_none".to_string(),
        b"__animacraft_none__".to_string(),
        STYLE_ROW_LOGICAL_NONE,
        &ctx,
    );
    register_base_logical_style_v5(
        &mut root,
        &cap,
        &maker,
        b"hat".to_string(),
        b"color-blue".to_string(),
        b"__animacraft_color__:blue".to_string(),
        STYLE_ROW_LOGICAL_COLOR,
        &ctx,
    );
    assert!(
        style_product_row_kind_v5(
            &root,
            b"eyes".to_string(),
            b"bright".to_string(),
            b"default".to_string(),
        ) == STYLE_ROW_VISUAL,
    );
    assert!(style_product_seal_protected_v5(
        &root,
        b"eyes".to_string(),
        b"bright".to_string(),
        b"default".to_string(),
    ));
    assert!(
        style_product_row_kind_v5(
            &root,
            b"hat".to_string(),
            b"__ac_none".to_string(),
            b"__animacraft_none__".to_string(),
        ) == STYLE_ROW_LOGICAL_NONE,
    );
    assert!(!style_product_seal_protected_v5(
        &root,
        b"hat".to_string(),
        b"__ac_none".to_string(),
        b"__animacraft_none__".to_string(),
    ));
    assert!(
        style_product_row_kind_v5(
            &root,
            b"hat".to_string(),
            b"color-blue".to_string(),
            b"__animacraft_color__:blue".to_string(),
        ) == STYLE_ROW_LOGICAL_COLOR,
    );
    assert!(!style_product_seal_protected_v5(
        &root,
        b"hat".to_string(),
        b"color-blue".to_string(),
        b"__animacraft_color__:blue".to_string(),
    ));
    seal_style_registry_v5(&mut root, &cap, &ctx);
    destroy_v5_world_for_testing(
        profile,
        maker,
        legacy_treasury,
        legacy_config,
        legacy_protocol_treasury,
        protocol_admin,
        config,
        protocol_treasury,
        root,
        treasury,
        vault,
        cap,
    );
    sui::clock::destroy_for_testing(clock);
}

#[test, expected_failure(abort_code = 47, location = animacraft::commerce_v5)]
fun paid_base_visual_asset_cannot_self_report_as_logical() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 41, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (
        _profile,
        maker,
        _legacy_treasury,
        _legacy_config,
        _legacy_protocol_treasury,
        _protocol_admin,
        _config,
        _protocol_treasury,
        mut root,
        _treasury,
        _vault,
        cap,
    ) = v5_world_for_testing(
        new_completion_policy(POLICY_UNLIMITED_FREE, 0, 0),
        &mut ctx,
        &clock,
    );
    update_base_access_v5(
        &mut root,
        &cap,
        PACK_ACCESS_PAID_ONCE,
        100,
        &ctx,
    );
    register_base_logical_style_v5(
        &mut root,
        &cap,
        &maker,
        b"eyes".to_string(),
        b"bright".to_string(),
        b"__animacraft_none__".to_string(),
        STYLE_ROW_LOGICAL_NONE,
        &ctx,
    );
    abort 99
}

#[test, expected_failure(abort_code = 47, location = animacraft::commerce_v5)]
fun canonical_auxiliary_blob_cannot_self_report_as_visual() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 42, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (
        _profile,
        maker,
        _legacy_treasury,
        _legacy_config,
        _legacy_protocol_treasury,
        _protocol_admin,
        _config,
        _protocol_treasury,
        mut root,
        _treasury,
        _vault,
        cap,
    ) = v5_world_for_testing(
        new_completion_policy(POLICY_UNLIMITED_FREE, 0, 0),
        &mut ctx,
        &clock,
    );
    register_base_style_v5(
        &mut root,
        &cap,
        &maker,
        b"hat".to_string(),
        b"__ac_none".to_string(),
        b"default".to_string(),
        &ctx,
    );
    abort 99
}

#[test, expected_failure(abort_code = 46, location = animacraft::commerce_v5)]
fun caller_cannot_invent_an_unverified_style_row_kind() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 43, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (
        _profile,
        maker,
        _legacy_treasury,
        _legacy_config,
        _legacy_protocol_treasury,
        _protocol_admin,
        _config,
        _protocol_treasury,
        mut root,
        _treasury,
        _vault,
        cap,
    ) = v5_world_for_testing(
        new_completion_policy(POLICY_UNLIMITED_FREE, 0, 0),
        &mut ctx,
        &clock,
    );
    register_base_logical_style_v5(
        &mut root,
        &cap,
        &maker,
        b"hat".to_string(),
        b"__ac_none".to_string(),
        b"__animacraft_none__".to_string(),
        9,
        &ctx,
    );
    abort 99
}

#[test, expected_failure(abort_code = 50, location = animacraft::commerce_v5)]
fun arbitrary_nonzero_soul_id_rejects_untrusted_binding_proof() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 44, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (
        _profile,
        _maker,
        _legacy_treasury,
        _legacy_config,
        _legacy_protocol_treasury,
        _protocol_admin,
        config,
        _protocol_treasury,
        mut root,
        _treasury,
        _vault,
        _cap,
    ) = v5_world_for_testing(
        new_completion_policy(POLICY_UNLIMITED_FREE, 0, 0),
        &mut ctx,
        &clock,
    );
    let seal_id = test_complete_output_bytes(91);
    let recipe_hash = test_complete_output_bytes(92);
    record_complete_output(
        &mut root,
        ctx.sender(),
        &recipe_hash,
        copy seal_id,
        test_complete_output_bytes(93),
        test_complete_output_bytes(94),
        &b"walrus-untrusted-proof-output".to_string(),
    );
    let root_id = object::id(&root);
    bind_complete_output_to_soul_v5(
        &mut root,
        &config,
        CompleteOutputSoulBindingV5 {
            root_id,
            seal_id,
        },
        object::id_from_address(@0xDEAD),
        UntrustedSoulBindingProofV5 {},
    );
    abort 99
}

#[test, expected_failure(abort_code = 49, location = animacraft::commerce_v5)]
fun protocol_cannot_enable_before_both_trusted_dependencies_are_bound() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 45, 0, 0, 0);
    let (legacy_config, _legacy_treasury, mut protocol_admin) =
        legacy::new_protocol_fee_objects_for_testing<sui::sui::SUI>(
            false,
            &mut ctx,
        );
    let (mut config, _treasury) =
        new_protocol_objects<sui::sui::SUI>(
            &legacy_config,
            &mut protocol_admin,
            &mut ctx,
        );
    update_protocol_enabled_v5(&mut config, &protocol_admin, true);
    abort 99
}

#[test, expected_failure(abort_code = 49, location = animacraft::animacraft)]
fun canonical_v5_protocol_can_only_initialize_once() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 22, 0, 0, 0);
    let (legacy_config, _legacy_treasury, mut protocol_admin) =
        legacy::new_protocol_fee_objects_for_testing<sui::sui::SUI>(false, &mut ctx);
    let (_first_config, _first_treasury) =
        new_protocol_objects<sui::sui::SUI>(
            &legacy_config,
            &mut protocol_admin,
            &mut ctx,
        );
    let (second_config, second_treasury) = new_protocol_objects<sui::sui::SUI>(
        &legacy_config,
        &mut protocol_admin,
        &mut ctx,
    );
    std::unit_test::destroy(second_config);
    std::unit_test::destroy(second_treasury);
    abort 99
}
