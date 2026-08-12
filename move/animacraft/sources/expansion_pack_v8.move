module animacraft::expansion_pack_v8;

use animacraft::animacraft::{Self as legacy, OCMaker};
use animacraft::commerce_v5::{
    Self as commerce,
    CommerceProtocolConfigV5,
    CommerceProtocolTreasuryV5,
    IndependentExtensionAuthorityV5,
    MakerControlCapV5,
    MakerRootV5,
};
use animacraft::seal_v5::{Self as seal};
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

const VERSION: u64 = 8;
const HASH_LENGTH: u64 = 32;

const ACCESS_FREE: u8 = 0;
const ACCESS_PAID_ONCE: u8 = 1;

const LIFECYCLE_DRAFT: u8 = 0;
const LIFECYCLE_SEALED: u8 = 1;
const LIFECYCLE_ADMITTED: u8 = 2;
const LIFECYCLE_ACTIVE: u8 = 3;
const LIFECYCLE_PAUSED: u8 = 4;
const LIFECYCLE_ARCHIVED: u8 = 5;

const EInvalidBinding: u64 = 0;
const EInvalidCommitment: u64 = 1;
const EInvalidAccess: u64 = 2;
const EInvalidLifecycle: u64 = 3;
const EInvalidAdminCap: u64 = 4;
const EStyleExists: u64 = 5;
const EStyleMissing: u64 = 6;
const EStyleRegistryEmpty: u64 = 7;
const ESealPolicyMissing: u64 = 8;
const ESealPolicyExists: u64 = 9;
const EParentEpochChanged: u64 = 10;
const EEntitlementExists: u64 = 11;
const EEntitlementMissing: u64 = 12;
const EWrongPayment: u64 = 13;
const ETreasuryMismatch: u64 = 14;
const EInvalidRecipient: u64 = 15;
const EInsufficientRevenue: u64 = 16;
const EBridgeDisabled: u64 = 17;
const EPaymentCoinMismatch: u64 = 18;

/// Stable visual identity inside one additive Pack release.
public struct StyleAssetKeyV8 has copy, drop, store {
    part_key: String,
    item_key: String,
    style_key: String,
}

/// Exact Walrus and Seal identity for one Style. Source bytes remain immutable
/// after the Pack registry is sealed.
public struct StyleAssetRecordV8 has copy, drop, store {
    asset_blob_id: String,
    asset_sha256: vector<u8>,
    asset_seal_id: vector<u8>,
}

public struct EntitlementRecordV8 has copy, drop, store {
    paid_atomic: u64,
    issued_at_ms: u64,
    admitted_parent_ownership_epoch: u64,
}

/// Exact per-object scope used as the `release_commitment` input to the
/// existing Seal v5 identity. Equal Pack bytes published as two different
/// ExpansionPackReleaseV8 objects must never derive the same decryption key.
public struct ExpansionPackSealReleaseScopeV8 has copy, drop, store {
    release_id: ID,
    content_commitment: vector<u8>,
}

/// One independently-owned additive release. The parent tuple is explicit and
/// is attested by the current parent MakerControlCap during admission.
public struct ExpansionPackReleaseV8 has key {
    id: UID,
    version: u64,
    parent_root_id: ID,
    parent_legacy_maker_id: ID,
    parent_version: String,
    parent_manifest_blob_id: String,
    parent_manifest_sha256: vector<u8>,
    pack_id: String,
    namespace: String,
    pack_version: String,
    creator: address,
    manifest_bound: bool,
    manifest_blob_id: String,
    manifest_sha256: vector<u8>,
    content_commitment: vector<u8>,
    style_registry_commitment: vector<u8>,
    seal_policy_id: Option<ID>,
    seal_package_id: Option<ID>,
    seal_release_commitment: vector<u8>,
    access_kind: u8,
    purchase_price_atomic: u64,
    lifecycle: u8,
    admin_cap_id: ID,
    treasury_id: ID,
    admitted_by: address,
    admitted_parent_ownership_epoch: u64,
    styles: Table<StyleAssetKeyV8, StyleAssetRecordV8>,
    seal_assets: Table<vector<u8>, StyleAssetKeyV8>,
    style_keys: vector<StyleAssetKeyV8>,
    entitlements: Table<address, EntitlementRecordV8>,
    style_count: u64,
    entitlement_count: u64,
}

/// Independent, release-scoped administration. It intentionally has no
/// `store`, so generic transfers cannot desynchronize its explicit creator.
public struct ExpansionPackAdminCapV8 has key {
    id: UID,
    version: u64,
    release_id: ID,
    creator: address,
}

/// Independent creator revenue. Production instantiates this as Treasury<USDC>.
public struct ExpansionPackTreasuryV8<phantom PaymentCoin> has key {
    id: UID,
    version: u64,
    release_id: ID,
    revenue: Balance<PaymentCoin>,
    total_collected: u64,
    total_withdrawn: u64,
}

/// Permanent wallet-bound proof. No `store` ability means the holder cannot
/// transfer it through a generic kiosk or asset-transfer path.
public struct ExpansionPackPassV8 has key {
    id: UID,
    version: u64,
    release_id: ID,
    parent_root_id: ID,
    holder: address,
    paid_atomic: u64,
    issued_at_ms: u64,
    admitted_parent_ownership_epoch: u64,
    content_commitment: vector<u8>,
}

/// Verifiable, transaction-local access proof for a future reviewed Complete
/// or physical-item adapter. It has no key/store ability and cannot persist.
public struct ExpansionPackStyleAccessProofV8 has drop {
    release_id: ID,
    parent_root_id: ID,
    holder: address,
    part_key: String,
    item_key: String,
    style_key: String,
    asset_blob_id: String,
    asset_sha256: vector<u8>,
    asset_seal_id: vector<u8>,
    content_commitment: vector<u8>,
}

public struct ExpansionPackCreatedV8 has copy, drop {
    release_id: ID,
    admin_cap_id: ID,
    treasury_id: ID,
    parent_root_id: ID,
    parent_legacy_maker_id: ID,
    pack_id: String,
    pack_version: String,
    creator: address,
    access_kind: u8,
    purchase_price_atomic: u64,
    content_commitment: vector<u8>,
}

public struct ExpansionPackManifestBoundV8 has copy, drop {
    release_id: ID,
    manifest_blob_id: String,
    manifest_sha256: vector<u8>,
}

public struct ExpansionPackStyleRegisteredV8 has copy, drop {
    release_id: ID,
    part_key: String,
    item_key: String,
    style_key: String,
    asset_blob_id: String,
    asset_sha256: vector<u8>,
    asset_seal_id: vector<u8>,
}

public struct ExpansionPackSealedV8 has copy, drop {
    release_id: ID,
    style_count: u64,
    style_registry_commitment: vector<u8>,
}

public struct ExpansionPackSealPolicyBoundV8 has copy, drop {
    release_id: ID,
    seal_policy_id: ID,
    seal_package_id: ID,
    seal_release_commitment: vector<u8>,
}

public struct ExpansionPackAdmittedV8 has copy, drop {
    release_id: ID,
    parent_root_id: ID,
    parent_legacy_maker_id: ID,
    admitted_by: address,
    parent_ownership_epoch: u64,
    parent_version: String,
    parent_manifest_blob_id: String,
    parent_manifest_sha256: vector<u8>,
}

public struct ExpansionPackLifecycleChangedV8 has copy, drop {
    release_id: ID,
    previous_lifecycle: u8,
    lifecycle: u8,
}

public struct ExpansionPackEntitlementGrantedV8 has copy, drop {
    release_id: ID,
    parent_root_id: ID,
    holder: address,
    paid_atomic: u64,
    pass_id: ID,
    admitted_parent_ownership_epoch: u64,
}

public struct ExpansionPackRevenueWithdrawnV8 has copy, drop {
    release_id: ID,
    treasury_id: ID,
    amount: u64,
    recipient: address,
}

public fun version_v8(): u64 { VERSION }
public fun access_free_v8(): u8 { ACCESS_FREE }
public fun access_paid_once_v8(): u8 { ACCESS_PAID_ONCE }
public fun lifecycle_draft_v8(): u8 { LIFECYCLE_DRAFT }
public fun lifecycle_sealed_v8(): u8 { LIFECYCLE_SEALED }
public fun lifecycle_admitted_v8(): u8 { LIFECYCLE_ADMITTED }
public fun lifecycle_active_v8(): u8 { LIFECYCLE_ACTIVE }
public fun lifecycle_paused_v8(): u8 { LIFECYCLE_PAUSED }
public fun lifecycle_archived_v8(): u8 { LIFECYCLE_ARCHIVED }

fun new_expansion_pack_objects_v8<PaymentCoin>(
    parent_root: &MakerRootV5,
    parent_legacy_maker: &OCMaker,
    parent_version: String,
    parent_manifest_blob_id: String,
    parent_manifest_sha256: vector<u8>,
    pack_id: String,
    namespace: String,
    pack_version: String,
    content_commitment: vector<u8>,
    access_kind: u8,
    purchase_price_atomic: u64,
    ctx: &mut TxContext,
): (
    ExpansionPackReleaseV8,
    ExpansionPackTreasuryV8<PaymentCoin>,
    ExpansionPackAdminCapV8,
) {
    assert_parent_binding(parent_root, parent_legacy_maker);
    assert!(legacy::maker_manifest_blob_id(parent_legacy_maker) == &parent_manifest_blob_id, EInvalidBinding);
    assert_non_empty(&parent_version);
    assert_non_empty(&parent_manifest_blob_id);
    assert_digest(&parent_manifest_sha256);
    commerce::assert_extension_maker_release_evidence_v5(
        parent_root,
        parent_legacy_maker,
        &parent_version,
        &parent_manifest_blob_id,
        &parent_manifest_sha256,
    );
    assert_non_empty(&pack_id);
    assert_non_empty(&namespace);
    assert_non_empty(&pack_version);
    assert_digest(&content_commitment);
    assert_valid_access(access_kind, purchase_price_atomic);

    let creator = ctx.sender();
    let release_uid = object::new(ctx);
    let release_id = release_uid.to_inner();
    let treasury_uid = object::new(ctx);
    let treasury_id = treasury_uid.to_inner();
    let admin_uid = object::new(ctx);
    let admin_cap_id = admin_uid.to_inner();
    let release = ExpansionPackReleaseV8 {
        id: release_uid,
        version: VERSION,
        parent_root_id: commerce::root_id_v5(parent_root),
        parent_legacy_maker_id: legacy::maker_id(parent_legacy_maker),
        parent_version,
        parent_manifest_blob_id,
        parent_manifest_sha256,
        pack_id,
        namespace,
        pack_version,
        creator,
        manifest_bound: false,
        manifest_blob_id: b"".to_string(),
        manifest_sha256: vector[],
        content_commitment,
        style_registry_commitment: vector[],
        seal_policy_id: option::none(),
        seal_package_id: option::none(),
        seal_release_commitment: vector[],
        access_kind,
        purchase_price_atomic,
        lifecycle: LIFECYCLE_DRAFT,
        admin_cap_id,
        treasury_id,
        admitted_by: @0x0,
        admitted_parent_ownership_epoch: 0,
        styles: table::new(ctx),
        seal_assets: table::new(ctx),
        style_keys: vector[],
        entitlements: table::new(ctx),
        style_count: 0,
        entitlement_count: 0,
    };
    let treasury = ExpansionPackTreasuryV8<PaymentCoin> {
        id: treasury_uid,
        version: VERSION,
        release_id,
        revenue: balance::zero(),
        total_collected: 0,
        total_withdrawn: 0,
    };
    let admin_cap = ExpansionPackAdminCapV8 {
        id: admin_uid,
        version: VERSION,
        release_id,
        creator,
    };
    event::emit(ExpansionPackCreatedV8 {
        release_id,
        admin_cap_id,
        treasury_id,
        parent_root_id: commerce::root_id_v5(parent_root),
        parent_legacy_maker_id: legacy::maker_id(parent_legacy_maker),
        pack_id,
        pack_version,
        creator,
        access_kind,
        purchase_price_atomic,
        content_commitment,
    });
    (release, treasury, admin_cap)
}

/// Production constructor. It only creates local Pack objects and does not
/// change any deployment gate or publish a package.
public fun create_expansion_pack_v8<PaymentCoin>(
    parent_root: &MakerRootV5,
    parent_legacy_maker: &OCMaker,
    protocol_config: &CommerceProtocolConfigV5,
    parent_version: String,
    parent_manifest_blob_id: String,
    parent_manifest_sha256: vector<u8>,
    pack_id: String,
    namespace: String,
    pack_version: String,
    content_commitment: vector<u8>,
    access_kind: u8,
    purchase_price_atomic: u64,
    ctx: &mut TxContext,
) {
    // A Pack treasury must use the exact canonical payment coin configured by
    // the parent Commerce protocol. Without this check a release could become
    // Active while every purchase is permanently untypeable.
    assert!(
        &payment_coin_type_name<PaymentCoin>()
            == commerce::extension_payment_coin_type_v5(protocol_config),
        EPaymentCoinMismatch,
    );
    commerce::assert_independent_extension_operational_v5(
        parent_root,
        protocol_config,
    );
    let (release, treasury, admin_cap) = new_expansion_pack_objects_v8<PaymentCoin>(
        parent_root,
        parent_legacy_maker,
        parent_version,
        parent_manifest_blob_id,
        parent_manifest_sha256,
        pack_id,
        namespace,
        pack_version,
        content_commitment,
        access_kind,
        purchase_price_atomic,
        ctx,
    );
    transfer::share_object(release);
    transfer::share_object(treasury);
    transfer::transfer(admin_cap, ctx.sender());
}

fun payment_coin_type_name<PaymentCoin>(): String {
    string::from_ascii(type_name::with_defining_ids<PaymentCoin>().into_string())
}

#[test_only]
public fun new_expansion_pack_v8_for_testing<PaymentCoin>(
    parent_root: &MakerRootV5,
    parent_legacy_maker: &OCMaker,
    parent_version: String,
    parent_manifest_blob_id: String,
    parent_manifest_sha256: vector<u8>,
    pack_id: String,
    namespace: String,
    pack_version: String,
    content_commitment: vector<u8>,
    access_kind: u8,
    purchase_price_atomic: u64,
    ctx: &mut TxContext,
): (
    ExpansionPackReleaseV8,
    ExpansionPackTreasuryV8<PaymentCoin>,
    ExpansionPackAdminCapV8,
) {
    new_expansion_pack_objects_v8<PaymentCoin>(
        parent_root,
        parent_legacy_maker,
        parent_version,
        parent_manifest_blob_id,
        parent_manifest_sha256,
        pack_id,
        namespace,
        pack_version,
        content_commitment,
        access_kind,
        purchase_price_atomic,
        ctx,
    )
}

/// SHA-256(BCS(release object ID, semantic content commitment)). This is the
/// release commitment passed into the existing Seal v5 Style identity.
public fun derive_seal_release_commitment_v8(
    release_id: ID,
    content_commitment: vector<u8>,
): vector<u8> {
    assert_digest(&content_commitment);
    hash::sha2_256(bcs::to_bytes(&ExpansionPackSealReleaseScopeV8 {
        release_id,
        content_commitment,
    }))
}

/// Binds the final certified Walrus manifest exactly once after the Draft
/// shell has supplied the Release object ID used for paid Seal encryption.
public fun bind_expansion_pack_manifest_v8(
    release: &mut ExpansionPackReleaseV8,
    admin_cap: &ExpansionPackAdminCapV8,
    manifest_blob_id: String,
    manifest_sha256: vector<u8>,
    ctx: &TxContext,
) {
    assert_admin(release, admin_cap, ctx);
    assert!(release.lifecycle == LIFECYCLE_DRAFT, EInvalidLifecycle);
    assert!(!release.manifest_bound, EInvalidBinding);
    assert!(release.style_count == 0, EInvalidLifecycle);
    assert_non_empty(&manifest_blob_id);
    assert_digest(&manifest_sha256);
    release.manifest_bound = true;
    release.manifest_blob_id = manifest_blob_id;
    release.manifest_sha256 = manifest_sha256;
    event::emit(ExpansionPackManifestBoundV8 {
        release_id: object::id(release),
        manifest_blob_id,
        manifest_sha256,
    });
}

public fun register_style_asset_v8(
    release: &mut ExpansionPackReleaseV8,
    admin_cap: &ExpansionPackAdminCapV8,
    part_key: String,
    item_key: String,
    style_key: String,
    asset_blob_id: String,
    asset_sha256: vector<u8>,
    asset_seal_id: vector<u8>,
    ctx: &TxContext,
) {
    assert_admin(release, admin_cap, ctx);
    assert!(release.lifecycle == LIFECYCLE_DRAFT, EInvalidLifecycle);
    assert!(release.manifest_bound, EInvalidBinding);
    assert_non_empty(&part_key);
    assert_non_empty(&item_key);
    assert_non_empty(&style_key);
    assert_non_empty(&asset_blob_id);
    assert_digest(&asset_sha256);
    if (release.access_kind == ACCESS_PAID_ONCE) {
        assert_digest(&asset_seal_id);
    } else {
        // Free Pack PNGs are public Walrus assets. Allowing an unused Seal id
        // here would make the chain registry disagree with the Player verifier
        // and could advertise decryption semantics that no entitlement needs.
        assert!(asset_seal_id.length() == 0, EInvalidCommitment);
    };
    let key = StyleAssetKeyV8 { part_key, item_key, style_key };
    assert!(!release.styles.contains(key), EStyleExists);
    if (asset_seal_id.length() == HASH_LENGTH) {
        let expected_seal_id = seal::derive_seal_id_v5(
            derive_seal_release_commitment_v8(
                object::id(release),
                release.content_commitment,
            ),
            1,
            part_key,
            item_key,
            style_key,
            release.pack_id,
            asset_sha256,
        );
        assert!(asset_seal_id == expected_seal_id, EInvalidCommitment);
        assert!(!release.seal_assets.contains(asset_seal_id), EStyleExists);
        release.seal_assets.add(asset_seal_id, key);
    };
    release.styles.add(key, StyleAssetRecordV8 {
        asset_blob_id,
        asset_sha256,
        asset_seal_id,
    });
    release.style_keys.push_back(key);
    release.style_count = release.style_count + 1;
    event::emit(ExpansionPackStyleRegisteredV8 {
        release_id: object::id(release),
        part_key,
        item_key,
        style_key,
        asset_blob_id,
        asset_sha256,
        asset_seal_id,
    });
}

/// Permanently freezes the exact Style registry commitment.
public fun seal_expansion_pack_v8(
    release: &mut ExpansionPackReleaseV8,
    admin_cap: &ExpansionPackAdminCapV8,
    style_registry_commitment: vector<u8>,
    ctx: &TxContext,
) {
    assert_admin(release, admin_cap, ctx);
    assert!(release.lifecycle == LIFECYCLE_DRAFT, EInvalidLifecycle);
    assert!(release.manifest_bound, EInvalidBinding);
    assert!(release.style_count > 0, EStyleRegistryEmpty);
    assert_digest(&style_registry_commitment);
    release.style_registry_commitment = style_registry_commitment;
    set_lifecycle(release, LIFECYCLE_SEALED);
    event::emit(ExpansionPackSealedV8 {
        release_id: object::id(release),
        style_count: release.style_count,
        style_registry_commitment,
    });
}

/// Binds the reviewed Sui Seal policy/object identity once. Paid Pack releases
/// cannot be admitted or activated without this binding.
public fun bind_expansion_pack_seal_policy_v8(
    release: &mut ExpansionPackReleaseV8,
    admin_cap: &ExpansionPackAdminCapV8,
    ctx: &TxContext,
) {
    assert_admin(release, admin_cap, ctx);
    assert!(release.lifecycle == LIFECYCLE_SEALED, EInvalidLifecycle);
    assert!(release.seal_policy_id.is_none(), ESealPolicyExists);
    assert!(release.seal_package_id.is_none(), ESealPolicyExists);
    // ExpansionPackReleaseV8 is itself the immutable Seal policy object used
    // by `seal_approve_style_v8`; accepting an unrelated ID would create an
    // unverifiable decryption promise.
    let seal_policy_id = object::id(release);
    let seal_package_id = current_seal_package_id_v8();
    let seal_release_commitment = derive_seal_release_commitment_v8(
        seal_policy_id,
        release.content_commitment,
    );
    release.seal_policy_id = option::some(seal_policy_id);
    release.seal_package_id = option::some(seal_package_id);
    release.seal_release_commitment = seal_release_commitment;
    event::emit(ExpansionPackSealPolicyBoundV8 {
        release_id: object::id(release),
        seal_policy_id,
        seal_package_id,
        seal_release_commitment,
    });
}

/// The current parent owner explicitly admits the exact immutable child tuple.
/// A Maker sale changes the ownership epoch, so all Pack access is suspended
/// until the new owner re-admits the immutable child tuple. Entitlements and
/// Pass objects remain permanent and resume after that current-epoch admission.
public fun admit_expansion_pack_v8(
    release: &mut ExpansionPackReleaseV8,
    parent_root: &MakerRootV5,
    parent_legacy_maker: &OCMaker,
    parent_control_cap: &MakerControlCapV5,
    ctx: &TxContext,
) {
    commerce::assert_extension_control_v5(parent_root, parent_control_cap, ctx);
    admit_expansion_pack_impl_v8(
        release,
        parent_root,
        parent_legacy_maker,
        ctx,
    );
}

fun admit_expansion_pack_impl_v8(
    release: &mut ExpansionPackReleaseV8,
    parent_root: &MakerRootV5,
    parent_legacy_maker: &OCMaker,
    ctx: &TxContext,
) {
    assert!(release.lifecycle != LIFECYCLE_DRAFT, EInvalidLifecycle);
    assert!(release.lifecycle != LIFECYCLE_ARCHIVED, EInvalidLifecycle);
    assert_parent_binding(parent_root, parent_legacy_maker);
    assert_release_parent(release, parent_root, parent_legacy_maker);
    commerce::assert_extension_maker_release_evidence_v5(
        parent_root,
        parent_legacy_maker,
        &release.parent_version,
        &release.parent_manifest_blob_id,
        &release.parent_manifest_sha256,
    );
    assert!(commerce::style_registry_sealed_v5(parent_root), EInvalidBinding);
    commerce::assert_independent_extension_parent_paused_v5(parent_root);
    if (release.access_kind == ACCESS_PAID_ONCE) {
        assert!(release.seal_policy_id.is_some(), ESealPolicyMissing);
        assert!(release.seal_package_id.is_some(), ESealPolicyMissing);
        assert!(
            *release.seal_package_id.borrow() == current_seal_package_id_v8(),
            ESealPolicyMissing,
        );
    };
    let epoch = commerce::root_ownership_epoch_v5(parent_root);
    assert!(
        release.lifecycle == LIFECYCLE_SEALED
            || release.admitted_parent_ownership_epoch != epoch,
        EInvalidLifecycle,
    );
    release.admitted_by = ctx.sender();
    release.admitted_parent_ownership_epoch = epoch;
    set_lifecycle(release, LIFECYCLE_ADMITTED);
    event::emit(ExpansionPackAdmittedV8 {
        release_id: object::id(release),
        parent_root_id: commerce::root_id_v5(parent_root),
        parent_legacy_maker_id: legacy::maker_id(parent_legacy_maker),
        admitted_by: ctx.sender(),
        parent_ownership_epoch: epoch,
        parent_version: release.parent_version,
        parent_manifest_blob_id: release.parent_manifest_blob_id,
        parent_manifest_sha256: release.parent_manifest_sha256,
    });
}

/// Production admission after the parent irreversibly retires its general
/// MakerControlCap. Historical callables can still create untrusted Draft
/// shells, but only this authority-bound path can cross the admission boundary.
public fun admit_expansion_pack_with_authority_v8(
    release: &mut ExpansionPackReleaseV8,
    parent_root: &MakerRootV5,
    parent_legacy_maker: &OCMaker,
    parent_authority: &IndependentExtensionAuthorityV5,
    ctx: &TxContext,
) {
    commerce::assert_independent_extension_authority_v5(
        parent_root,
        parent_legacy_maker,
        parent_authority,
        ctx,
    );
    admit_expansion_pack_impl_v8(
        release,
        parent_root,
        parent_legacy_maker,
        ctx,
    );
}

public fun activate_expansion_pack_v8(
    release: &mut ExpansionPackReleaseV8,
    admin_cap: &ExpansionPackAdminCapV8,
    parent_root: &MakerRootV5,
    config: &CommerceProtocolConfigV5,
    ctx: &TxContext,
) {
    assert_admin(release, admin_cap, ctx);
    assert!(release.lifecycle == LIFECYCLE_ADMITTED, EInvalidLifecycle);
    assert_release_root(release, parent_root);
    assert_current_parent_epoch(release, parent_root);
    commerce::assert_independent_extension_operational_v5(parent_root, config);
    set_lifecycle(release, LIFECYCLE_ACTIVE);
}

public fun pause_expansion_pack_v8(
    release: &mut ExpansionPackReleaseV8,
    admin_cap: &ExpansionPackAdminCapV8,
    ctx: &TxContext,
) {
    assert_admin(release, admin_cap, ctx);
    assert!(release.lifecycle == LIFECYCLE_ACTIVE, EInvalidLifecycle);
    set_lifecycle(release, LIFECYCLE_PAUSED);
}

public fun resume_expansion_pack_v8(
    release: &mut ExpansionPackReleaseV8,
    admin_cap: &ExpansionPackAdminCapV8,
    parent_root: &MakerRootV5,
    config: &CommerceProtocolConfigV5,
    ctx: &TxContext,
) {
    assert_admin(release, admin_cap, ctx);
    assert!(release.lifecycle == LIFECYCLE_PAUSED, EInvalidLifecycle);
    assert_release_root(release, parent_root);
    assert_current_parent_epoch(release, parent_root);
    commerce::assert_independent_extension_operational_v5(parent_root, config);
    set_lifecycle(release, LIFECYCLE_ACTIVE);
}

public fun archive_expansion_pack_v8(
    release: &mut ExpansionPackReleaseV8,
    admin_cap: &ExpansionPackAdminCapV8,
    ctx: &TxContext,
) {
    assert_admin(release, admin_cap, ctx);
    assert!(release.lifecycle != LIFECYCLE_ACTIVE, EInvalidLifecycle);
    assert!(release.lifecycle != LIFECYCLE_ARCHIVED, EInvalidLifecycle);
    set_lifecycle(release, LIFECYCLE_ARCHIVED);
}

public fun claim_free_expansion_pack_v8(
    release: &mut ExpansionPackReleaseV8,
    parent_root: &MakerRootV5,
    config: &CommerceProtocolConfigV5,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert_release_operational(release, parent_root, config, ctx.sender());
    assert!(release.access_kind == ACCESS_FREE, EInvalidAccess);
    issue_entitlement(release, 0, clock, ctx);
}

public fun purchase_expansion_pack_v8<PaymentCoin>(
    release: &mut ExpansionPackReleaseV8,
    treasury: &mut ExpansionPackTreasuryV8<PaymentCoin>,
    parent_root: &MakerRootV5,
    config: &CommerceProtocolConfigV5,
    protocol_treasury: &mut CommerceProtocolTreasuryV5<PaymentCoin>,
    payment: Coin<PaymentCoin>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert_release_operational(release, parent_root, config, ctx.sender());
    assert_treasury(release, treasury);
    assert!(release.access_kind == ACCESS_PAID_ONCE, EInvalidAccess);
    assert!(release.purchase_price_atomic > 0, EWrongPayment);
    assert!(!release.entitlements.contains(ctx.sender()), EEntitlementExists);
    let price = release.purchase_price_atomic;
    assert!(payment.value() == price, EWrongPayment);
    let creator_payment = commerce::collect_independent_extension_primary_payment_v5(
        parent_root,
        config,
        protocol_treasury,
        payment,
        price,
        ctx,
    );
    treasury.total_collected = treasury.total_collected + creator_payment.value();
    coin::put(&mut treasury.revenue, creator_payment);
    issue_entitlement(release, price, clock, ctx);
}

public fun withdraw_expansion_pack_revenue_v8<PaymentCoin>(
    release: &ExpansionPackReleaseV8,
    treasury: &mut ExpansionPackTreasuryV8<PaymentCoin>,
    admin_cap: &ExpansionPackAdminCapV8,
    amount: u64,
    recipient: address,
    ctx: &mut TxContext,
) {
    assert_admin(release, admin_cap, ctx);
    assert_treasury(release, treasury);
    assert!(recipient != @0x0, EInvalidRecipient);
    assert!(amount > 0 && amount <= treasury.revenue.value(), EInsufficientRevenue);
    let payment = coin::take(&mut treasury.revenue, amount, ctx);
    treasury.total_withdrawn = treasury.total_withdrawn + amount;
    event::emit(ExpansionPackRevenueWithdrawnV8 {
        release_id: object::id(release),
        treasury_id: object::id(treasury),
        amount,
        recipient,
    });
    transfer::public_transfer(payment, recipient);
}

/// Creates a transaction-local proof only after the exact release, current
/// parent epoch, wallet entitlement and Style commitment all verify.
public fun verify_style_access_v8(
    release: &ExpansionPackReleaseV8,
    parent_root: &MakerRootV5,
    part_key: String,
    item_key: String,
    style_key: String,
    ctx: &TxContext,
): ExpansionPackStyleAccessProofV8 {
    // Acquisition is gated by Active state, the live v5 protocol and the
    // current parent epoch. Existing entitlements survive ownership transfer,
    // but access is suspended until the release is re-admitted at that epoch.
    assert_release_root(release, parent_root);
    commerce::assert_independent_extension_parent_paused_v5(parent_root);
    assert_current_parent_epoch(release, parent_root);
    assert!(
        release.lifecycle == LIFECYCLE_ADMITTED
            || release.lifecycle == LIFECYCLE_ACTIVE
            || release.lifecycle == LIFECYCLE_PAUSED
            || release.lifecycle == LIFECYCLE_ARCHIVED,
        EInvalidLifecycle,
    );
    if (release.access_kind == ACCESS_PAID_ONCE) {
        assert!(release.seal_package_id.is_some(), ESealPolicyMissing);
        assert!(
            *release.seal_package_id.borrow() == current_seal_package_id_v8(),
            ESealPolicyMissing,
        );
    };
    assert!(commerce::has_base_entitlement_v5(parent_root, ctx.sender()), EEntitlementMissing);
    assert!(release.entitlements.contains(ctx.sender()), EEntitlementMissing);
    let key = StyleAssetKeyV8 { part_key, item_key, style_key };
    assert!(release.styles.contains(key), EStyleMissing);
    let style = release.styles.borrow(key);
    ExpansionPackStyleAccessProofV8 {
        release_id: object::id(release),
        parent_root_id: commerce::root_id_v5(parent_root),
        holder: ctx.sender(),
        part_key,
        item_key,
        style_key,
        asset_blob_id: style.asset_blob_id,
        asset_sha256: style.asset_sha256,
        asset_seal_id: style.asset_seal_id,
        content_commitment: release.content_commitment,
    }
}

/// Sui Seal key servers dry-run this entry. It approves only a deterministically
/// derived, registered Style ID held by a wallet with both Base and Pack rights.
entry fun seal_approve_style_v8(
    id: vector<u8>,
    release: &ExpansionPackReleaseV8,
    parent_root: &MakerRootV5,
    ctx: &TxContext,
) {
    assert!(
        check_style_seal_access_v8(id, release, parent_root, ctx.sender()),
        EEntitlementMissing,
    );
}

public fun check_style_seal_access_v8(
    id: vector<u8>,
    release: &ExpansionPackReleaseV8,
    parent_root: &MakerRootV5,
    wallet: address,
): bool {
    assert_release_root(release, parent_root);
    commerce::assert_independent_extension_parent_paused_v5(parent_root);
    if (
        release.lifecycle != LIFECYCLE_ADMITTED
            && release.lifecycle != LIFECYCLE_ACTIVE
            && release.lifecycle != LIFECYCLE_PAUSED
            && release.lifecycle != LIFECYCLE_ARCHIVED
    ) return false;
    if (!is_current_parent_epoch(release, parent_root)) return false;
    if (release.seal_policy_id.is_none()) return false;
    if (*release.seal_policy_id.borrow() != object::id(release)) return false;
    if (release.seal_package_id.is_none()) return false;
    if (*release.seal_package_id.borrow() != current_seal_package_id_v8()) return false;
    let scoped_commitment = derive_seal_release_commitment_v8(
        object::id(release),
        release.content_commitment,
    );
    if (release.seal_release_commitment != scoped_commitment) return false;
    if (!commerce::has_base_entitlement_v5(parent_root, wallet)) return false;
    if (!release.entitlements.contains(wallet)) return false;
    if (!release.seal_assets.contains(id)) return false;
    let key = release.seal_assets.borrow(id);
    let style = release.styles.borrow(*key);
    if (style.asset_seal_id != id) return false;
    seal::derive_seal_id_v5(
        scoped_commitment,
        1,
        key.part_key,
        key.item_key,
        key.style_key,
        release.pack_id,
        style.asset_sha256,
    ) == id
}

/// Complete and physical-item adapters remain explicitly disabled until a
/// reviewed consumer module is deployed and bound. No placeholder can mint or
/// equip from this companion release.
public fun complete_bridge_enabled_v8(): bool { false }
public fun physical_bridge_enabled_v8(): bool { false }
public fun assert_complete_bridge_enabled_v8() { abort EBridgeDisabled }
public fun assert_physical_bridge_enabled_v8() { abort EBridgeDisabled }

public fun release_id_v8(self: &ExpansionPackReleaseV8): ID { object::id(self) }
public fun release_parent_root_id_v8(self: &ExpansionPackReleaseV8): ID { self.parent_root_id }
public fun release_parent_legacy_maker_id_v8(self: &ExpansionPackReleaseV8): ID { self.parent_legacy_maker_id }
public fun release_parent_version_v8(self: &ExpansionPackReleaseV8): &String { &self.parent_version }
public fun release_parent_manifest_blob_id_v8(self: &ExpansionPackReleaseV8): &String { &self.parent_manifest_blob_id }
public fun release_parent_manifest_sha256_v8(self: &ExpansionPackReleaseV8): &vector<u8> { &self.parent_manifest_sha256 }
public fun release_pack_id_v8(self: &ExpansionPackReleaseV8): &String { &self.pack_id }
public fun release_namespace_v8(self: &ExpansionPackReleaseV8): &String { &self.namespace }
public fun release_pack_version_v8(self: &ExpansionPackReleaseV8): &String { &self.pack_version }
public fun release_creator_v8(self: &ExpansionPackReleaseV8): address { self.creator }
public fun release_manifest_bound_v8(self: &ExpansionPackReleaseV8): bool { self.manifest_bound }
public fun release_manifest_blob_id_v8(self: &ExpansionPackReleaseV8): &String { &self.manifest_blob_id }
public fun release_manifest_sha256_v8(self: &ExpansionPackReleaseV8): &vector<u8> { &self.manifest_sha256 }
public fun release_content_commitment_v8(self: &ExpansionPackReleaseV8): &vector<u8> { &self.content_commitment }
public fun release_style_registry_commitment_v8(self: &ExpansionPackReleaseV8): &vector<u8> { &self.style_registry_commitment }
public fun release_seal_policy_id_v8(self: &ExpansionPackReleaseV8): Option<ID> { self.seal_policy_id }
public fun release_seal_package_id_v8(self: &ExpansionPackReleaseV8): Option<ID> { self.seal_package_id }
public fun release_seal_commitment_v8(self: &ExpansionPackReleaseV8): &vector<u8> { &self.seal_release_commitment }
public fun release_access_kind_v8(self: &ExpansionPackReleaseV8): u8 { self.access_kind }
public fun release_purchase_price_v8(self: &ExpansionPackReleaseV8): u64 { self.purchase_price_atomic }
public fun release_lifecycle_v8(self: &ExpansionPackReleaseV8): u8 { self.lifecycle }
public fun release_admin_cap_id_v8(self: &ExpansionPackReleaseV8): ID { self.admin_cap_id }
public fun release_treasury_id_v8(self: &ExpansionPackReleaseV8): ID { self.treasury_id }
public fun release_admitted_by_v8(self: &ExpansionPackReleaseV8): address { self.admitted_by }
public fun release_admitted_parent_epoch_v8(self: &ExpansionPackReleaseV8): u64 { self.admitted_parent_ownership_epoch }
public fun release_style_count_v8(self: &ExpansionPackReleaseV8): u64 { self.style_count }
public fun release_entitlement_count_v8(self: &ExpansionPackReleaseV8): u64 { self.entitlement_count }
public fun release_styles_table_id_v8(self: &ExpansionPackReleaseV8): ID { object::id(&self.styles) }
public fun release_seal_assets_table_id_v8(self: &ExpansionPackReleaseV8): ID { object::id(&self.seal_assets) }
public fun release_entitlements_table_id_v8(self: &ExpansionPackReleaseV8): ID { object::id(&self.entitlements) }

public fun has_entitlement_v8(self: &ExpansionPackReleaseV8, wallet: address): bool {
    self.entitlements.contains(wallet)
}

public fun style_exists_v8(
    self: &ExpansionPackReleaseV8,
    part_key: String,
    item_key: String,
    style_key: String,
): bool {
    self.styles.contains(StyleAssetKeyV8 { part_key, item_key, style_key })
}

public fun style_asset_blob_id_v8(
    self: &ExpansionPackReleaseV8,
    part_key: String,
    item_key: String,
    style_key: String,
): &String {
    &self.styles.borrow(StyleAssetKeyV8 { part_key, item_key, style_key }).asset_blob_id
}

public fun style_asset_sha256_v8(
    self: &ExpansionPackReleaseV8,
    part_key: String,
    item_key: String,
    style_key: String,
): &vector<u8> {
    &self.styles.borrow(StyleAssetKeyV8 { part_key, item_key, style_key }).asset_sha256
}

public fun style_asset_seal_id_v8(
    self: &ExpansionPackReleaseV8,
    part_key: String,
    item_key: String,
    style_key: String,
): &vector<u8> {
    &self.styles.borrow(StyleAssetKeyV8 { part_key, item_key, style_key }).asset_seal_id
}

public fun admin_cap_release_id_v8(self: &ExpansionPackAdminCapV8): ID { self.release_id }
public fun admin_cap_creator_v8(self: &ExpansionPackAdminCapV8): address { self.creator }
public fun treasury_release_id_v8<PaymentCoin>(self: &ExpansionPackTreasuryV8<PaymentCoin>): ID { self.release_id }
public fun treasury_balance_v8<PaymentCoin>(self: &ExpansionPackTreasuryV8<PaymentCoin>): u64 { self.revenue.value() }
public fun treasury_total_collected_v8<PaymentCoin>(self: &ExpansionPackTreasuryV8<PaymentCoin>): u64 { self.total_collected }
public fun treasury_total_withdrawn_v8<PaymentCoin>(self: &ExpansionPackTreasuryV8<PaymentCoin>): u64 { self.total_withdrawn }
public fun pass_release_id_v8(self: &ExpansionPackPassV8): ID { self.release_id }
public fun pass_parent_root_id_v8(self: &ExpansionPackPassV8): ID { self.parent_root_id }
public fun pass_holder_v8(self: &ExpansionPackPassV8): address { self.holder }
public fun pass_paid_atomic_v8(self: &ExpansionPackPassV8): u64 { self.paid_atomic }
public fun pass_issued_at_ms_v8(self: &ExpansionPackPassV8): u64 { self.issued_at_ms }
public fun pass_parent_epoch_v8(self: &ExpansionPackPassV8): u64 { self.admitted_parent_ownership_epoch }
public fun pass_content_commitment_v8(self: &ExpansionPackPassV8): &vector<u8> { &self.content_commitment }
public fun style_access_proof_release_id_v8(self: &ExpansionPackStyleAccessProofV8): ID { self.release_id }
public fun style_access_proof_parent_root_id_v8(self: &ExpansionPackStyleAccessProofV8): ID { self.parent_root_id }
public fun style_access_proof_holder_v8(self: &ExpansionPackStyleAccessProofV8): address { self.holder }
public fun style_access_proof_part_key_v8(self: &ExpansionPackStyleAccessProofV8): &String { &self.part_key }
public fun style_access_proof_item_key_v8(self: &ExpansionPackStyleAccessProofV8): &String { &self.item_key }
public fun style_access_proof_style_key_v8(self: &ExpansionPackStyleAccessProofV8): &String { &self.style_key }
public fun style_access_proof_blob_id_v8(self: &ExpansionPackStyleAccessProofV8): &String { &self.asset_blob_id }
public fun style_access_proof_sha256_v8(self: &ExpansionPackStyleAccessProofV8): &vector<u8> { &self.asset_sha256 }
public fun style_access_proof_seal_id_v8(self: &ExpansionPackStyleAccessProofV8): &vector<u8> { &self.asset_seal_id }
public fun style_access_proof_content_commitment_v8(self: &ExpansionPackStyleAccessProofV8): &vector<u8> { &self.content_commitment }

fun issue_entitlement(
    release: &mut ExpansionPackReleaseV8,
    paid_atomic: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(!release.entitlements.contains(ctx.sender()), EEntitlementExists);
    let epoch = release.admitted_parent_ownership_epoch;
    release.entitlements.add(ctx.sender(), EntitlementRecordV8 {
        paid_atomic,
        issued_at_ms: clock.timestamp_ms(),
        admitted_parent_ownership_epoch: epoch,
    });
    release.entitlement_count = release.entitlement_count + 1;
    let pass = ExpansionPackPassV8 {
        id: object::new(ctx),
        version: VERSION,
        release_id: object::id(release),
        parent_root_id: release.parent_root_id,
        holder: ctx.sender(),
        paid_atomic,
        issued_at_ms: clock.timestamp_ms(),
        admitted_parent_ownership_epoch: epoch,
        content_commitment: release.content_commitment,
    };
    let pass_id = object::id(&pass);
    event::emit(ExpansionPackEntitlementGrantedV8 {
        release_id: object::id(release),
        parent_root_id: release.parent_root_id,
        holder: ctx.sender(),
        paid_atomic,
        pass_id,
        admitted_parent_ownership_epoch: epoch,
    });
    transfer::transfer(pass, ctx.sender());
}

fun set_lifecycle(release: &mut ExpansionPackReleaseV8, lifecycle: u8) {
    let previous_lifecycle = release.lifecycle;
    release.lifecycle = lifecycle;
    event::emit(ExpansionPackLifecycleChangedV8 {
        release_id: object::id(release),
        previous_lifecycle,
        lifecycle,
    });
}

fun assert_admin(
    release: &ExpansionPackReleaseV8,
    admin_cap: &ExpansionPackAdminCapV8,
    ctx: &TxContext,
) {
    assert!(admin_cap.version == VERSION, EInvalidAdminCap);
    assert!(admin_cap.release_id == object::id(release), EInvalidAdminCap);
    assert!(object::id(admin_cap) == release.admin_cap_id, EInvalidAdminCap);
    assert!(admin_cap.creator == release.creator, EInvalidAdminCap);
    assert!(ctx.sender() == release.creator, EInvalidAdminCap);
}

fun assert_treasury<PaymentCoin>(
    release: &ExpansionPackReleaseV8,
    treasury: &ExpansionPackTreasuryV8<PaymentCoin>,
) {
    assert!(treasury.version == VERSION, ETreasuryMismatch);
    assert!(treasury.release_id == object::id(release), ETreasuryMismatch);
    assert!(object::id(treasury) == release.treasury_id, ETreasuryMismatch);
}

fun assert_parent_binding(root: &MakerRootV5, legacy_maker: &OCMaker) {
    assert!(commerce::root_legacy_maker_id_v5(root) == legacy::maker_id(legacy_maker), EInvalidBinding);
}

fun assert_release_parent(
    release: &ExpansionPackReleaseV8,
    root: &MakerRootV5,
    legacy_maker: &OCMaker,
) {
    assert_release_root(release, root);
    assert!(release.parent_legacy_maker_id == legacy::maker_id(legacy_maker), EInvalidBinding);
}

fun assert_release_root(release: &ExpansionPackReleaseV8, root: &MakerRootV5) {
    assert!(release.parent_root_id == commerce::root_id_v5(root), EInvalidBinding);
    assert!(release.parent_legacy_maker_id == commerce::root_legacy_maker_id_v5(root), EInvalidBinding);
}

fun assert_current_parent_epoch(release: &ExpansionPackReleaseV8, root: &MakerRootV5) {
    assert!(is_current_parent_epoch(release, root), EParentEpochChanged);
}

fun is_current_parent_epoch(
    release: &ExpansionPackReleaseV8,
    root: &MakerRootV5,
): bool {
    release.admitted_parent_ownership_epoch == commerce::root_ownership_epoch_v5(root)
}

fun assert_release_operational(
    release: &ExpansionPackReleaseV8,
    root: &MakerRootV5,
    config: &CommerceProtocolConfigV5,
    wallet: address,
) {
    assert!(release.lifecycle == LIFECYCLE_ACTIVE, EInvalidLifecycle);
    assert_release_root(release, root);
    assert_current_parent_epoch(release, root);
    assert!(commerce::has_base_entitlement_v5(root, wallet), EEntitlementMissing);
    commerce::assert_independent_extension_operational_v5(root, config);
}

fun assert_valid_access(access_kind: u8, purchase_price_atomic: u64) {
    assert!(
        (access_kind == ACCESS_FREE && purchase_price_atomic == 0)
            || (access_kind == ACCESS_PAID_ONCE && purchase_price_atomic > 0),
        EInvalidAccess,
    );
}

fun assert_non_empty(value: &String) {
    assert!(string::as_bytes(value).length() > 0, EInvalidBinding);
}

fun assert_digest(value: &vector<u8>) {
    assert!(value.length() == HASH_LENGTH, EInvalidCommitment);
}

fun current_seal_package_id_v8(): ID {
    object::id_from_address(type_name::defining_id<ExpansionPackReleaseV8>())
}

#[test_only]
fun digest(value: u8): vector<u8> {
    let mut bytes = vector[];
    let mut index = 0;
    while (index < HASH_LENGTH) {
        bytes.push_back(value);
        index = index + 1;
    };
    bytes
}

#[test]
fun paid_pack_purchase_splits_protocol_and_independent_treasury() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 80, 0, 0, 0);
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
        maker_treasury,
        vault,
        parent_cap,
    ) = commerce::v5_world_for_testing(
        commerce::new_completion_policy(commerce::policy_unlimited_free(), 0, 0),
        &mut ctx,
        &clock,
    );
    assert!(!commerce::root_maker_release_evidence_bound_v5(&root));
    commerce::bind_maker_release_evidence_v5(
        &mut root,
        &parent_cap,
        &maker,
        b"parent-v1".to_string(),
        b"manifest".to_string(),
        digest(1),
        &ctx,
    );
    // Exact retries are safe, but the Root-owned tuple can never be replaced.
    commerce::bind_maker_release_evidence_v5(
        &mut root,
        &parent_cap,
        &maker,
        b"parent-v1".to_string(),
        b"manifest".to_string(),
        digest(1),
        &ctx,
    );
    let parent_evidence = commerce::root_maker_release_evidence_v5(&root);
    assert!(
        commerce::maker_release_parent_version_v5(parent_evidence)
            == &b"parent-v1".to_string(),
    );
    assert!(
        commerce::maker_release_manifest_blob_id_v5(parent_evidence)
            == &b"manifest".to_string(),
    );
    assert!(
        commerce::maker_release_manifest_sha256_v5(parent_evidence)
            == &digest(1),
    );
    commerce::update_protocol_enabled_v5(&mut config, &protocol_admin, true);
    let (parts, items, styles, row_kinds) =
        commerce::legacy_compatibility_rows_for_testing();
    let parent_authority = commerce::finalize_independent_extension_root_v5_for_testing(
        &mut root, &maker_treasury, parent_cap, &maker, &config,
        &protocol_admin, parts, items, styles, row_kinds, digest(30), &mut ctx,
    );
    // Expansion Pack v8 is independently operational while the parent remains
    // PAUSED; Base Commerce/Complete therefore stays unavailable.
    assert!(commerce::root_lifecycle_v5(&root) == commerce::lifecycle_paused());

    let (mut release, mut treasury, admin_cap) =
        new_expansion_pack_v8_for_testing<sui::sui::SUI>(
            &root,
            &maker,
            b"parent-v1".to_string(),
            b"manifest".to_string(),
            digest(1),
            b"festival-pack".to_string(),
            b"festival".to_string(),
            b"1.0.0".to_string(),
            digest(3),
            ACCESS_PAID_ONCE,
            1_000,
            &mut ctx,
        );
    assert!(release_seal_package_id_v8(&release).is_none());
    let expected_seal_package_id = current_seal_package_id_v8();
    bind_expansion_pack_manifest_v8(
        &mut release,
        &admin_cap,
        b"pack-manifest".to_string(),
        digest(2),
        &ctx,
    );
    let release_id = object::id(&release);
    let scoped_release_commitment = derive_seal_release_commitment_v8(
        release_id,
        digest(3),
    );
    let style_seal_id = seal::derive_seal_id_v5(
        scoped_release_commitment,
        1,
        b"hat".to_string(),
        b"festival".to_string(),
        b"red".to_string(),
        b"festival-pack".to_string(),
        digest(4),
    );
    // A second Release with byte-identical public Pack/style commitments must
    // still produce a different Seal namespace. Owning release B can never
    // authorize decryption of release A's ciphertext.
    let (other_release, other_treasury, other_admin_cap) =
        new_expansion_pack_v8_for_testing<sui::sui::SUI>(
            &root,
            &maker,
            b"parent-v1".to_string(),
            b"manifest".to_string(),
            digest(1),
            b"festival-pack".to_string(),
            b"festival".to_string(),
            b"1.0.0".to_string(),
            digest(3),
            ACCESS_PAID_ONCE,
            1_000,
            &mut ctx,
        );
    let other_scoped_release_commitment = derive_seal_release_commitment_v8(
        object::id(&other_release),
        digest(3),
    );
    let other_style_seal_id = seal::derive_seal_id_v5(
        other_scoped_release_commitment,
        1,
        b"hat".to_string(),
        b"festival".to_string(),
        b"red".to_string(),
        b"festival-pack".to_string(),
        digest(4),
    );
    assert!(style_seal_id != other_style_seal_id);
    register_style_asset_v8(
        &mut release,
        &admin_cap,
        b"hat".to_string(),
        b"festival".to_string(),
        b"red".to_string(),
        b"style-blob".to_string(),
        digest(4),
        style_seal_id,
        &ctx,
    );
    seal_expansion_pack_v8(&mut release, &admin_cap, digest(6), &ctx);
    bind_expansion_pack_seal_policy_v8(
        &mut release,
        &admin_cap,
        &ctx,
    );
    assert!(release_seal_package_id_v8(&release).is_some());
    assert!(
        *release_seal_package_id_v8(&release).borrow() == expected_seal_package_id,
    );
    admit_expansion_pack_with_authority_v8(
        &mut release, &root, &maker, &parent_authority, &ctx,
    );
    activate_expansion_pack_v8(&mut release, &admin_cap, &root, &config, &ctx);
    assert!(
        *release_seal_package_id_v8(&release).borrow() == expected_seal_package_id,
    );

    let payment = coin::from_balance(
        balance::create_for_testing<sui::sui::SUI>(1_000),
        &mut ctx,
    );
    purchase_expansion_pack_v8(
        &mut release,
        &mut treasury,
        &root,
        &config,
        &mut protocol_treasury,
        payment,
        &clock,
        &mut ctx,
    );
    assert!(has_entitlement_v8(&release, @0xA11));
    assert!(treasury_balance_v8(&treasury) == 900);
    assert!(commerce::protocol_treasury_balance_v5(&protocol_treasury) == 100);
    assert!(check_style_seal_access_v8(
        style_seal_id,
        &release,
        &root,
        @0xA11,
    ));
    let proof = verify_style_access_v8(
        &release,
        &root,
        b"hat".to_string(),
        b"festival".to_string(),
        b"red".to_string(),
        &ctx,
    );
    let ExpansionPackStyleAccessProofV8 {
        release_id: _, parent_root_id: _, holder: _, part_key: _, item_key: _,
        style_key: _, asset_blob_id: _, asset_sha256: _, asset_seal_id: _,
        content_commitment: _,
    } = proof;
    withdraw_expansion_pack_revenue_v8(
        &release,
        &mut treasury,
        &admin_cap,
        400,
        @0xA11,
        &mut ctx,
    );
    assert!(treasury_balance_v8(&treasury) == 500);
    assert!(treasury_total_collected_v8(&treasury) == 900);
    assert!(treasury_total_withdrawn_v8(&treasury) == 400);
    pause_expansion_pack_v8(&mut release, &admin_cap, &ctx);
    assert!(release_lifecycle_v8(&release) == LIFECYCLE_PAUSED);
    resume_expansion_pack_v8(&mut release, &admin_cap, &root, &config, &ctx);
    assert!(release_lifecycle_v8(&release) == LIFECYCLE_ACTIVE);
    pause_expansion_pack_v8(&mut release, &admin_cap, &ctx);
    archive_expansion_pack_v8(&mut release, &admin_cap, &ctx);
    assert!(release_lifecycle_v8(&release) == LIFECYCLE_ARCHIVED);
    assert!(
        *release_seal_package_id_v8(&release).borrow() == expected_seal_package_id,
    );
    assert!(check_style_seal_access_v8(
        style_seal_id,
        &release,
        &root,
        @0xA11,
    ));

    let (mut free_release, free_treasury, free_admin_cap) =
        new_expansion_pack_v8_for_testing<sui::sui::SUI>(
            &root,
            &maker,
            b"parent-v1".to_string(),
            b"manifest".to_string(),
            digest(1),
            b"free-pack".to_string(),
            b"free".to_string(),
            b"1.0.0".to_string(),
            digest(9),
            ACCESS_FREE,
            0,
            &mut ctx,
        );
    bind_expansion_pack_manifest_v8(
        &mut free_release,
        &free_admin_cap,
        b"free-manifest".to_string(),
        digest(8),
        &ctx,
    );
    register_style_asset_v8(
        &mut free_release,
        &free_admin_cap,
        b"hat".to_string(),
        b"free".to_string(),
        b"blue".to_string(),
        b"free-style-blob".to_string(),
        digest(10),
        vector[],
        &ctx,
    );
    seal_expansion_pack_v8(&mut free_release, &free_admin_cap, digest(11), &ctx);
    admit_expansion_pack_with_authority_v8(
        &mut free_release, &root, &maker, &parent_authority, &ctx,
    );
    activate_expansion_pack_v8(
        &mut free_release,
        &free_admin_cap,
        &root,
        &config,
        &ctx,
    );
    claim_free_expansion_pack_v8(
        &mut free_release,
        &root,
        &config,
        &clock,
        &mut ctx,
    );
    assert!(has_entitlement_v8(&free_release, @0xA11));
    assert!(treasury_balance_v8(&free_treasury) == 0);

    sui::clock::destroy_for_testing(clock);
    std::unit_test::destroy(release);
    std::unit_test::destroy(treasury);
    std::unit_test::destroy(admin_cap);
    std::unit_test::destroy(other_release);
    std::unit_test::destroy(other_treasury);
    std::unit_test::destroy(other_admin_cap);
    std::unit_test::destroy(free_release);
    std::unit_test::destroy(free_treasury);
    std::unit_test::destroy(free_admin_cap);
    commerce::destroy_v5_world_with_independent_authority_for_testing(
        profile, maker, legacy_treasury, legacy_config,
        legacy_protocol_treasury, protocol_admin, config, protocol_treasury,
        root, maker_treasury, vault, parent_authority,
    );
}

#[test]
fun parent_epoch_change_suspends_and_readmission_restores_existing_free_access() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 84, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (
        profile, maker, legacy_treasury, legacy_config,
        legacy_protocol_treasury, mut protocol_admin, mut config,
        protocol_treasury, mut root, maker_treasury, vault, parent_cap,
    ) = commerce::v5_world_for_testing(
        commerce::new_completion_policy(commerce::policy_unlimited_free(), 0, 0),
        &mut ctx,
        &clock,
    );
    commerce::bind_maker_release_evidence_v5(
        &mut root, &parent_cap, &maker,
        b"parent-v1".to_string(), b"manifest".to_string(), digest(1), &ctx,
    );
    commerce::update_protocol_enabled_v5(&mut config, &protocol_admin, true);
    let (parts, items, styles, row_kinds) =
        commerce::legacy_compatibility_rows_for_testing();
    let mut parent_authority =
        commerce::finalize_independent_extension_root_v5_for_testing(
            &mut root, &maker_treasury, parent_cap, &maker, &config,
            &protocol_admin, parts, items, styles, row_kinds, digest(30), &mut ctx,
        );
    let (mut release, treasury, admin_cap) =
        new_expansion_pack_v8_for_testing<sui::sui::SUI>(
            &root, &maker,
            b"parent-v1".to_string(), b"manifest".to_string(), digest(1),
            b"epoch-pack".to_string(), b"epoch".to_string(),
            b"1.0.0".to_string(), digest(2), ACCESS_FREE, 0, &mut ctx,
        );
    bind_expansion_pack_manifest_v8(
        &mut release, &admin_cap, b"pack-manifest".to_string(), digest(3), &ctx,
    );
    register_style_asset_v8(
        &mut release, &admin_cap,
        b"hat".to_string(), b"epoch".to_string(), b"blue".to_string(),
        b"style-blob".to_string(), digest(4), vector[], &ctx,
    );
    seal_expansion_pack_v8(&mut release, &admin_cap, digest(5), &ctx);
    admit_expansion_pack_with_authority_v8(
        &mut release, &root, &maker, &parent_authority, &ctx,
    );
    activate_expansion_pack_v8(&mut release, &admin_cap, &root, &config, &ctx);
    claim_free_expansion_pack_v8(&mut release, &root, &config, &clock, &mut ctx);
    assert!(has_entitlement_v8(&release, @0xA11));
    let entitlement_count = release_entitlement_count_v8(&release);
    let admitted_epoch = release_admitted_parent_epoch_v8(&release);
    commerce::advance_independent_extension_epoch_v5_for_testing(
        &mut root,
        &mut parent_authority,
    );
    assert!(
        release_admitted_parent_epoch_v8(&release) == admitted_epoch,
    );
    assert!(release_entitlement_count_v8(&release) == entitlement_count);
    assert!(!check_style_seal_access_v8(vector[], &release, &root, @0xA11));
    admit_expansion_pack_with_authority_v8(
        &mut release, &root, &maker, &parent_authority, &ctx,
    );
    assert!(release_entitlement_count_v8(&release) == entitlement_count);
    let restored = verify_style_access_v8(
        &release, &root,
        b"hat".to_string(), b"epoch".to_string(), b"blue".to_string(), &ctx,
    );
    let ExpansionPackStyleAccessProofV8 {
        release_id: _, parent_root_id: _, holder: _, part_key: _, item_key: _,
        style_key: _, asset_blob_id: _, asset_sha256: _, asset_seal_id: _,
        content_commitment: _,
    } = restored;

    sui::clock::destroy_for_testing(clock);
    std::unit_test::destroy(release);
    std::unit_test::destroy(treasury);
    std::unit_test::destroy(admin_cap);
    commerce::destroy_v5_world_with_independent_authority_for_testing(
        profile, maker, legacy_treasury, legacy_config,
        legacy_protocol_treasury, protocol_admin, config, protocol_treasury,
        root, maker_treasury, vault, parent_authority,
    );
}

#[test]
fun atomic_parent_finalizer_retires_general_control_and_authorizes_v8_admission() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 89, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (
        profile, maker, legacy_treasury, legacy_config,
        legacy_protocol_treasury, mut protocol_admin, mut config,
        protocol_treasury, mut root, maker_treasury, vault, parent_cap,
    ) = commerce::v5_world_for_testing(
        commerce::new_completion_policy(commerce::policy_unlimited_free(), 0, 0),
        &mut ctx,
        &clock,
    );
    commerce::bind_maker_release_evidence_v5(
        &mut root, &parent_cap, &maker,
        b"parent-v1".to_string(), b"manifest".to_string(), digest(1), &ctx,
    );
    commerce::update_protocol_enabled_v5(&mut config, &protocol_admin, true);
    let (parts, items, styles, row_kinds) =
        commerce::legacy_compatibility_rows_for_testing();
    let authority = commerce::finalize_independent_extension_root_v5_for_testing(
        &mut root,
        &maker_treasury,
        parent_cap,
        &maker,
        &config,
        &protocol_admin,
        parts,
        items,
        styles,
        row_kinds,
        digest(9),
        &mut ctx,
    );
    assert!(commerce::root_independent_extension_locked_v5(&root));
    assert!(commerce::style_count_v5(&root) == 26);
    assert!(commerce::style_registry_sealed_v5(&root));
    assert!(commerce::root_lifecycle_v5(&root) == commerce::lifecycle_paused());
    assert!(commerce::root_ownership_epoch_v5(&root) == 1);
    assert!(commerce::independent_extension_authority_root_id_v5(&authority)
        == commerce::root_id_v5(&root));
    assert!(commerce::independent_extension_authority_owner_v5(&authority) == @0xA11);
    assert!(commerce::independent_extension_authority_locked_epoch_v5(&authority) == 1);
    assert!(commerce::independent_extension_authority_audit_hash_v5(&authority) == &digest(9));

    let (mut release, treasury, admin_cap) =
        new_expansion_pack_v8_for_testing<sui::sui::SUI>(
            &root, &maker,
            b"parent-v1".to_string(), b"manifest".to_string(), digest(1),
            b"locked-pack".to_string(), b"locked".to_string(),
            b"1.0.0".to_string(), digest(2), ACCESS_FREE, 0, &mut ctx,
        );
    bind_expansion_pack_manifest_v8(
        &mut release, &admin_cap, b"pack-manifest".to_string(), digest(3), &ctx,
    );
    register_style_asset_v8(
        &mut release, &admin_cap,
        b"hat".to_string(), b"locked".to_string(), b"blue".to_string(),
        b"style-blob".to_string(), digest(4), vector[], &ctx,
    );
    seal_expansion_pack_v8(&mut release, &admin_cap, digest(5), &ctx);
    admit_expansion_pack_with_authority_v8(
        &mut release, &root, &maker, &authority, &ctx,
    );
    activate_expansion_pack_v8(&mut release, &admin_cap, &root, &config, &ctx);
    claim_free_expansion_pack_v8(&mut release, &root, &config, &clock, &mut ctx);
    assert!(has_entitlement_v8(&release, @0xA11));

    sui::clock::destroy_for_testing(clock);
    std::unit_test::destroy(release);
    std::unit_test::destroy(treasury);
    std::unit_test::destroy(admin_cap);
    commerce::destroy_v5_world_with_independent_authority_for_testing(
        profile, maker, legacy_treasury, legacy_config,
        legacy_protocol_treasury, protocol_admin, config, protocol_treasury,
        root, maker_treasury, vault, authority,
    );
}

#[test, expected_failure(abort_code = 10, location = animacraft::expansion_pack_v8)]
fun stale_parent_epoch_rejects_style_proof() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 85, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (
        _profile, maker, _legacy_treasury, _legacy_config,
        _legacy_protocol_treasury, mut protocol_admin, mut config,
        _protocol_treasury, mut root, maker_treasury, _vault, parent_cap,
    ) = commerce::v5_world_for_testing(
        commerce::new_completion_policy(commerce::policy_unlimited_free(), 0, 0),
        &mut ctx,
        &clock,
    );
    commerce::bind_maker_release_evidence_v5(
        &mut root, &parent_cap, &maker,
        b"parent-v1".to_string(), b"manifest".to_string(), digest(1), &ctx,
    );
    commerce::update_protocol_enabled_v5(&mut config, &protocol_admin, true);
    let (parts, items, styles, row_kinds) =
        commerce::legacy_compatibility_rows_for_testing();
    let mut parent_authority =
        commerce::finalize_independent_extension_root_v5_for_testing(
            &mut root, &maker_treasury, parent_cap, &maker, &config,
            &protocol_admin, parts, items, styles, row_kinds, digest(30), &mut ctx,
        );
    let (mut release, _treasury, admin_cap) =
        new_expansion_pack_v8_for_testing<sui::sui::SUI>(
            &root, &maker,
            b"parent-v1".to_string(), b"manifest".to_string(), digest(1),
            b"stale-pack".to_string(), b"stale".to_string(),
            b"1.0.0".to_string(), digest(2), ACCESS_FREE, 0, &mut ctx,
        );
    bind_expansion_pack_manifest_v8(
        &mut release, &admin_cap, b"pack-manifest".to_string(), digest(3), &ctx,
    );
    register_style_asset_v8(
        &mut release, &admin_cap,
        b"hat".to_string(), b"stale".to_string(), b"blue".to_string(),
        b"style-blob".to_string(), digest(4), vector[], &ctx,
    );
    release.lifecycle = LIFECYCLE_ADMITTED;
    release.admitted_parent_ownership_epoch = commerce::root_ownership_epoch_v5(&root);
    let issued_epoch = release.admitted_parent_ownership_epoch;
    release.entitlements.add(@0xA11, EntitlementRecordV8 {
        paid_atomic: 0,
        issued_at_ms: 0,
        admitted_parent_ownership_epoch: issued_epoch,
    });
    commerce::advance_independent_extension_epoch_v5_for_testing(
        &mut root,
        &mut parent_authority,
    );
    let _proof = verify_style_access_v8(
        &release, &root,
        b"hat".to_string(), b"stale".to_string(), b"blue".to_string(), &ctx,
    );
    abort 99
}

#[test, expected_failure(abort_code = 51, location = animacraft::commerce_v5)]
fun pack_creation_rejects_parent_hash_that_differs_from_attestation() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 81, 0, 0, 0);
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
        maker_treasury,
        vault,
        parent_cap,
    ) = commerce::v5_world_for_testing(
        commerce::new_completion_policy(commerce::policy_unlimited_free(), 0, 0),
        &mut ctx,
        &clock,
    );
    commerce::bind_maker_release_evidence_v5(
        &mut root,
        &parent_cap,
        &maker,
        b"parent-v1".to_string(),
        b"manifest".to_string(),
        digest(1),
        &ctx,
    );
    let (_release, _treasury, _admin_cap) =
        new_expansion_pack_v8_for_testing<sui::sui::SUI>(
            &root,
            &maker,
            b"parent-v1".to_string(),
            b"manifest".to_string(),
            digest(2),
            b"forged-parent-pack".to_string(),
            b"forged".to_string(),
            b"1.0.0".to_string(),
            digest(3),
            ACCESS_FREE,
            0,
            &mut ctx,
        );
    std::unit_test::destroy(_release);
    std::unit_test::destroy(_treasury);
    std::unit_test::destroy(_admin_cap);
    sui::clock::destroy_for_testing(clock);
    commerce::destroy_v5_world_for_testing(
        profile, maker, legacy_treasury, legacy_config,
        legacy_protocol_treasury, protocol_admin, config, protocol_treasury,
        root, maker_treasury, vault, parent_cap,
    );
}

#[test, expected_failure(abort_code = 17, location = animacraft::expansion_pack_v8)]
fun complete_bridge_is_fail_closed() {
    assert!(!complete_bridge_enabled_v8());
    assert!(!physical_bridge_enabled_v8());
    assert_complete_bridge_enabled_v8();
}
