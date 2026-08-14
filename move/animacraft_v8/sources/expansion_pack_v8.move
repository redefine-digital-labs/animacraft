module animacraft_v8::expansion_pack_v8;

use animacraft_v8::maker_v8::{Self as maker, MakerAdminCapV8, MakerRootV8};
use animacraft_v8::protocol_config_v8::{
    Self as protocol,
    ProtocolConfigV8,
    ProtocolTreasuryV8,
};
use animacraft_v8::seal_v8::{Self as seal, SealRegistryV8};
use std::bcs;
use std::hash;
use std::string::{Self as string, String};
use sui::balance::{Self as balance, Balance};
use sui::clock::Clock;
use sui::coin::{Self as coin, Coin};
use sui::event;
use sui::table::{Self as table, Table};

const VERSION: u64 = 8;
const HASH_LENGTH: u64 = 32;
const MAX_IDENTIFIER_BYTES: u64 = 128;
const MAX_LOCATOR_BYTES: u64 = 512;

const ACCESS_FREE: u8 = 0;
const ACCESS_PAID: u8 = 1;
const ACCESS_INCLUDED_WITH_MAKER: u8 = 2;

const LIFECYCLE_DRAFT: u8 = 0;
const LIFECYCLE_SEALED: u8 = 1;
const LIFECYCLE_ACTIVE: u8 = 2;
const LIFECYCLE_PAUSED: u8 = 3;
const LIFECYCLE_ARCHIVED: u8 = 4;

const EInvalidBinding: u64 = 0;
const EInvalidCommitment: u64 = 1;
const EInvalidCount: u64 = 2;
const EInvalidSequence: u64 = 3;
const EInvalidIdentifier: u64 = 4;
const EInvalidAccess: u64 = 5;
const EInvalidLifecycle: u64 = 6;
const EInvalidAdmin: u64 = 7;
const EInvalidTreasury: u64 = 8;
const EDuplicate: u64 = 9;
const ERegistrySealed: u64 = 10;
const ERegistryNotSealed: u64 = 11;
const ESealCoverageMissing: u64 = 13;
const EEntitlementExists: u64 = 14;
const EEntitlementMissing: u64 = 15;
const EWrongPayment: u64 = 16;
const EInsufficientRevenue: u64 = 17;
const EInvalidRecipient: u64 = 18;
const EParentEpochChanged: u64 = 19;

public struct StyleKeyV8 has copy, drop, store {
    part_key: String,
    item_key: String,
    style_key: String,
}

public struct PackReleaseKeyV8 has copy, drop, store {
    namespace: String,
    pack_key: String,
}

public struct PackStyleV8 has copy, drop, store {
    part_key: String,
    item_key: String,
    style_key: String,
    asset_blob_id: String,
    asset_commitment: vector<u8>,
    protected: bool,
    seal_id: vector<u8>,
}

public struct PackReleaseRecordV8 has copy, drop, store {
    release_id: ID,
    namespace: String,
    pack_key: String,
    manifest_commitment: vector<u8>,
    content_commitment: vector<u8>,
    style_registry_commitment: vector<u8>,
    access_kind: u8,
    purchase_price_atomic: u64,
    complete_mode: u8,
    complete_price_atomic: u64,
    complete_free_quota_per_wallet: u64,
    complete_total_cap: u64,
    protected_style_count: u64,
    seal_registry_id: ID,
    seal_registry_commitment: vector<u8>,
}

public struct EntitlementRecordV8 has copy, drop, store {
    pass_id: ID,
    paid_atomic: u64,
    issued_at_ms: u64,
    admitted_ownership_epoch: u64,
}

public struct ExpansionPackRegistryV8 has key {
    id: UID,
    version: u64,
    maker_root_id: ID,
    ownership_epoch: u64,
    root_content_commitment: vector<u8>,
    expected_count: u64,
    observed_count: u64,
    expected_commitment: vector<u8>,
    rolling_commitment: vector<u8>,
    sealed: bool,
    protected_style_count: u64,
    releases: Table<ID, PackReleaseRecordV8>,
    release_keys: Table<PackReleaseKeyV8, bool>,
}

public struct ExpansionPackReleaseV8<phantom PaymentCoin> has key {
    id: UID,
    version: u64,
    maker_root_id: ID,
    ownership_epoch: u64,
    root_content_commitment: vector<u8>,
    creator: address,
    current_owner: address,
    admin_cap_id: ID,
    treasury_id: ID,
    namespace: String,
    pack_key: String,
    manifest_blob_id: String,
    manifest_commitment: vector<u8>,
    content_commitment: vector<u8>,
    access_kind: u8,
    purchase_price_atomic: u64,
    complete_mode: u8,
    complete_price_atomic: u64,
    complete_free_quota_per_wallet: u64,
    complete_total_cap: u64,
    lifecycle: u8,
    expected_style_count: u64,
    observed_style_count: u64,
    expected_protected_style_count: u64,
    observed_protected_style_count: u64,
    expected_style_registry_commitment: vector<u8>,
    rolling_style_registry_commitment: vector<u8>,
    seal_registry_id: ID,
    seal_registry_commitment: vector<u8>,
    entitlement_count: u64,
    styles: Table<StyleKeyV8, PackStyleV8>,
    entitlements: Table<address, EntitlementRecordV8>,
}

public struct ExpansionPackAdminCapV8 has key {
    id: UID,
    version: u64,
    release_id: ID,
    creator: address,
    owner: address,
    ownership_epoch: u64,
}

public struct ExpansionPackTreasuryV8<phantom PaymentCoin> has key {
    id: UID,
    version: u64,
    release_id: ID,
    revenue: Balance<PaymentCoin>,
    total_collected: u64,
    total_withdrawn: u64,
}

public struct ExpansionPackPassV8 has key {
    id: UID,
    version: u64,
    release_id: ID,
    maker_root_id: ID,
    ownership_epoch: u64,
    root_content_commitment: vector<u8>,
    release_content_commitment: vector<u8>,
    holder: address,
    paid_atomic: u64,
    issued_at_ms: u64,
}

/// Transaction-local access proof. It cannot be stored, copied, or dropped.
public struct PackStyleAccessProofV8 {
    release_id: ID,
    pack_scope_key: String,
    maker_root_id: ID,
    ownership_epoch: u64,
    root_content_commitment: vector<u8>,
    release_content_commitment: vector<u8>,
    complete_mode: u8,
    complete_price_atomic: u64,
    complete_free_quota_per_wallet: u64,
    complete_total_cap: u64,
    holder: address,
    part_key: String,
    item_key: String,
    style_key: String,
    asset_commitment: vector<u8>,
    protected: bool,
    seal_id: vector<u8>,
}

public struct PackRegistryEmptyHashInputV8 has copy, drop, store {
    domain: vector<u8>,
    version: u64,
    root_content_commitment: vector<u8>,
}

public struct PackStyleEmptyHashInputV8 has copy, drop, store {
    domain: vector<u8>,
    version: u64,
    root_content_commitment: vector<u8>,
    namespace: String,
    pack_key: String,
    manifest_commitment: vector<u8>,
    release_content_commitment: vector<u8>,
}

public struct PackStyleHashInputV8 has copy, drop, store {
    domain: vector<u8>,
    version: u64,
    root_content_commitment: vector<u8>,
    namespace: String,
    pack_key: String,
    manifest_commitment: vector<u8>,
    release_content_commitment: vector<u8>,
    sequence: u64,
    prior_commitment: vector<u8>,
    part_key: String,
    item_key: String,
    style_key: String,
    asset_blob_id: String,
    asset_commitment: vector<u8>,
    protected: bool,
    seal_id: vector<u8>,
}

public struct PackRegistryRowHashInputV8 has copy, drop, store {
    domain: vector<u8>,
    version: u64,
    root_content_commitment: vector<u8>,
    sequence: u64,
    prior_commitment: vector<u8>,
    namespace: String,
    pack_key: String,
    manifest_commitment: vector<u8>,
    release_content_commitment: vector<u8>,
    style_registry_commitment: vector<u8>,
    access_kind: u8,
    purchase_price_atomic: u64,
    complete_mode: u8,
    complete_price_atomic: u64,
    complete_free_quota_per_wallet: u64,
    complete_total_cap: u64,
    protected_style_count: u64,
    seal_registry_commitment: vector<u8>,
}

public struct ExpansionPackLifecycleChangedV8 has copy, drop {
    release_id: ID,
    previous_lifecycle: u8,
    lifecycle: u8,
    ownership_epoch: u64,
}

public struct ExpansionPackPassIssuedV8 has copy, drop {
    release_id: ID,
    pass_id: ID,
    holder: address,
    paid_atomic: u64,
    ownership_epoch: u64,
}

public struct ExpansionPackRevenueWithdrawnV8 has copy, drop {
    release_id: ID,
    treasury_id: ID,
    recipient: address,
    amount: u64,
}

public struct ExpansionPackControlTransferredV8 has copy, drop {
    release_id: ID,
    previous_owner: address,
    owner: address,
    ownership_epoch: u64,
}

public fun version_v8(): u64 { VERSION }
public fun access_free_v8(): u8 { ACCESS_FREE }
public fun access_paid_v8(): u8 { ACCESS_PAID }
public fun access_included_with_maker_v8(): u8 { ACCESS_INCLUDED_WITH_MAKER }
public fun lifecycle_draft_v8(): u8 { LIFECYCLE_DRAFT }
public fun lifecycle_sealed_v8(): u8 { LIFECYCLE_SEALED }
public fun lifecycle_active_v8(): u8 { LIFECYCLE_ACTIVE }
public fun lifecycle_paused_v8(): u8 { LIFECYCLE_PAUSED }
public fun lifecycle_archived_v8(): u8 { LIFECYCLE_ARCHIVED }

/// Pure pre-publication helper for the per-Maker release registry.
public fun empty_registry_commitment_v8(
    root_content_commitment: vector<u8>,
): vector<u8> {
    assert_digest(&root_content_commitment);
    hash::sha2_256(bcs::to_bytes(&PackRegistryEmptyHashInputV8 {
        domain: b"animacraft.v8/pack/registry/empty",
        version: VERSION,
        root_content_commitment,
    }))
}

/// Pure pre-publication helper for one release's Style registry. The stable
/// release key and immutable content replace the not-yet-created release ID.
public fun empty_style_registry_commitment_v8(
    root_content_commitment: vector<u8>,
    namespace: String,
    pack_key: String,
    manifest_commitment: vector<u8>,
    release_content_commitment: vector<u8>,
): vector<u8> {
    assert_digest(&root_content_commitment);
    assert_canonical_component(&namespace);
    assert_canonical_component(&pack_key);
    assert_digest(&manifest_commitment);
    assert_digest(&release_content_commitment);
    hash::sha2_256(bcs::to_bytes(&PackStyleEmptyHashInputV8 {
        domain: b"animacraft.v8/pack/style/empty",
        version: VERSION,
        root_content_commitment,
        namespace,
        pack_key,
        manifest_commitment,
        release_content_commitment,
    }))
}

public fun advance_style_commitment_v8(
    root_content_commitment: vector<u8>,
    namespace: String,
    pack_key: String,
    manifest_commitment: vector<u8>,
    release_content_commitment: vector<u8>,
    sequence: u64,
    prior_commitment: vector<u8>,
    part_key: String,
    item_key: String,
    style_key: String,
    asset_blob_id: String,
    asset_commitment: vector<u8>,
    protected: bool,
    seal_id: vector<u8>,
): vector<u8> {
    assert_digest(&root_content_commitment);
    assert_canonical_component(&namespace);
    assert_canonical_component(&pack_key);
    assert_digest(&manifest_commitment);
    assert_digest(&release_content_commitment);
    assert_digest(&prior_commitment);
    assert_canonical_component(&part_key);
    assert_canonical_component(&item_key);
    assert_canonical_component(&style_key);
    assert_locator(&asset_blob_id);
    assert_digest(&asset_commitment);
    if (protected) {
        assert_digest(&seal_id);
    } else {
        assert!(seal_id.is_empty(), ESealCoverageMissing);
    };
    hash::sha2_256(bcs::to_bytes(&PackStyleHashInputV8 {
        domain: b"animacraft.v8/pack/style",
        version: VERSION,
        root_content_commitment,
        namespace,
        pack_key,
        manifest_commitment,
        release_content_commitment,
        sequence,
        prior_commitment,
        part_key,
        item_key,
        style_key,
        asset_blob_id,
        asset_commitment,
        protected,
        seal_id,
    }))
}

public fun advance_release_commitment_v8(
    root_content_commitment: vector<u8>,
    sequence: u64,
    prior_commitment: vector<u8>,
    namespace: String,
    pack_key: String,
    manifest_commitment: vector<u8>,
    release_content_commitment: vector<u8>,
    style_registry_commitment: vector<u8>,
    access_kind: u8,
    purchase_price_atomic: u64,
    complete_mode: u8,
    complete_price_atomic: u64,
    complete_free_quota_per_wallet: u64,
    complete_total_cap: u64,
    protected_style_count: u64,
    seal_registry_commitment: vector<u8>,
): vector<u8> {
    assert_digest(&root_content_commitment);
    assert_digest(&prior_commitment);
    assert_canonical_component(&namespace);
    assert_canonical_component(&pack_key);
    assert_digest(&manifest_commitment);
    assert_digest(&release_content_commitment);
    assert_digest(&style_registry_commitment);
    assert_access(access_kind, purchase_price_atomic);
    maker::assert_valid_complete_policy_v8(
        complete_mode,
        complete_price_atomic,
        complete_free_quota_per_wallet,
        complete_total_cap,
    );
    assert_digest(&seal_registry_commitment);
    hash::sha2_256(bcs::to_bytes(&PackRegistryRowHashInputV8 {
        domain: b"animacraft.v8/pack/release",
        version: VERSION,
        root_content_commitment,
        sequence,
        prior_commitment,
        namespace,
        pack_key,
        manifest_commitment,
        release_content_commitment,
        style_registry_commitment,
        access_kind,
        purchase_price_atomic,
        complete_mode,
        complete_price_atomic,
        complete_free_quota_per_wallet,
        complete_total_cap,
        protected_style_count,
        seal_registry_commitment,
    }))
}

/// Canonical stable Seal scope for a release. Zero bytes are rejected in each
/// component, so the separator cannot produce ambiguous pairs.
public fun pack_seal_scope_key_v8(namespace: String, pack_key: String): String {
    assert_canonical_component(&namespace);
    assert_canonical_component(&pack_key);
    let mut bytes = namespace.into_bytes();
    bytes.push_back(0);
    bytes.append(pack_key.into_bytes());
    bytes.to_string()
}

public fun pack_seal_scope_commitment_v8(
    release_content_commitment: vector<u8>,
): vector<u8> {
    assert_digest(&release_content_commitment);
    release_content_commitment
}

public fun style_seal_asset_key_v8(
    part_key: String,
    item_key: String,
    style_key: String,
): String {
    seal::style_asset_key_v8(part_key, item_key, style_key)
}

public(package) fun new_expansion_pack_registry_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    expected_count: u64,
    expected_commitment: vector<u8>,
    ctx: &mut TxContext,
): ExpansionPackRegistryV8 {
    maker::assert_draft_admin_v8(root, admin);
    assert_digest(&expected_commitment);
    let maker_root_id = maker::root_id_v8(root);
    let ownership_epoch = maker::ownership_epoch_v8(root);
    let root_content_commitment = *maker::content_commitment_v8(root);
    let rolling_commitment = empty_registry_commitment_v8(root_content_commitment);
    if (expected_count == 0) {
        assert!(expected_commitment == rolling_commitment, EInvalidCommitment);
    };
    ExpansionPackRegistryV8 {
        id: object::new(ctx),
        version: VERSION,
        maker_root_id,
        ownership_epoch,
        root_content_commitment,
        expected_count,
        observed_count: 0,
        expected_commitment,
        rolling_commitment,
        sealed: false,
        protected_style_count: 0,
        releases: table::new(ctx),
        release_keys: table::new(ctx),
    }
}

public(package) fun share_expansion_pack_registry_v8(registry: ExpansionPackRegistryV8) {
    transfer::share_object(registry);
}

/// Creates shared staged release and treasury objects plus an owned exact cap.
public fun create_expansion_pack_release_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    maker_admin: &MakerAdminCapV8,
    seal_registry: &SealRegistryV8,
    namespace: String,
    pack_key: String,
    manifest_blob_id: String,
    manifest_commitment: vector<u8>,
    content_commitment: vector<u8>,
    access_kind: u8,
    purchase_price_atomic: u64,
    complete_mode: u8,
    complete_price_atomic: u64,
    complete_free_quota_per_wallet: u64,
    complete_total_cap: u64,
    expected_style_count: u64,
    expected_protected_style_count: u64,
    expected_style_registry_commitment: vector<u8>,
    ctx: &mut TxContext,
) {
    maker::assert_draft_admin_v8(root, maker_admin);
    assert_identifier(&namespace);
    assert_identifier(&pack_key);
    assert_locator(&manifest_blob_id);
    assert_digest(&manifest_commitment);
    assert_digest(&content_commitment);
    assert_digest(&expected_style_registry_commitment);
    assert_access(access_kind, purchase_price_atomic);
    maker::assert_valid_complete_policy_v8(
        complete_mode,
        complete_price_atomic,
        complete_free_quota_per_wallet,
        complete_total_cap,
    );
    assert!(expected_protected_style_count <= expected_style_count, EInvalidCount);
    seal::assert_draft_binding_v8(seal_registry, root);
    let release_uid = object::new(ctx);
    let release_id = release_uid.to_inner();
    let admin_uid = object::new(ctx);
    let admin_cap_id = admin_uid.to_inner();
    let treasury_uid = object::new(ctx);
    let treasury_id = treasury_uid.to_inner();
    let maker_root_id = maker::root_id_v8(root);
    let ownership_epoch = maker::ownership_epoch_v8(root);
    let root_content_commitment = *maker::content_commitment_v8(root);
    let rolling_style_registry_commitment = empty_style_registry_commitment_v8(
        root_content_commitment,
        namespace,
        pack_key,
        manifest_commitment,
        content_commitment,
    );
    if (expected_style_count == 0) {
        assert!(
            expected_style_registry_commitment == rolling_style_registry_commitment,
            EInvalidCommitment,
        );
    };
    let release = ExpansionPackReleaseV8<PaymentCoin> {
        id: release_uid,
        version: VERSION,
        maker_root_id,
        ownership_epoch,
        root_content_commitment,
        creator: ctx.sender(),
        current_owner: ctx.sender(),
        admin_cap_id,
        treasury_id,
        namespace,
        pack_key,
        manifest_blob_id,
        manifest_commitment,
        content_commitment,
        access_kind,
        purchase_price_atomic,
        complete_mode,
        complete_price_atomic,
        complete_free_quota_per_wallet,
        complete_total_cap,
        lifecycle: LIFECYCLE_DRAFT,
        expected_style_count,
        observed_style_count: 0,
        expected_protected_style_count,
        observed_protected_style_count: 0,
        expected_style_registry_commitment,
        rolling_style_registry_commitment,
        seal_registry_id: seal::registry_id_v8(seal_registry),
        seal_registry_commitment: *seal::registry_expected_commitment_v8(seal_registry),
        entitlement_count: 0,
        styles: table::new(ctx),
        entitlements: table::new(ctx),
    };
    let admin = ExpansionPackAdminCapV8 {
        id: admin_uid,
        version: VERSION,
        release_id,
        creator: ctx.sender(),
        owner: ctx.sender(),
        ownership_epoch,
    };
    let treasury = ExpansionPackTreasuryV8<PaymentCoin> {
        id: treasury_uid,
        version: VERSION,
        release_id,
        revenue: balance::zero(),
        total_collected: 0,
        total_withdrawn: 0,
    };
    transfer::share_object(release);
    transfer::share_object(treasury);
    transfer::transfer(admin, ctx.sender());
}

public fun append_expansion_pack_style_v8<PaymentCoin>(
    release: &mut ExpansionPackReleaseV8<PaymentCoin>,
    root: &MakerRootV8<PaymentCoin>,
    maker_admin: &MakerAdminCapV8,
    pack_admin: &ExpansionPackAdminCapV8,
    seal_registry: &SealRegistryV8,
    sequence: u64,
    part_key: String,
    item_key: String,
    style_key: String,
    asset_blob_id: String,
    asset_commitment: vector<u8>,
    protected: bool,
    seal_id: vector<u8>,
    ctx: &TxContext,
) {
    maker::assert_draft_admin_v8(root, maker_admin);
    assert_release_binding(release, root);
    assert_pack_admin(release, pack_admin, ctx);
    assert!(release.lifecycle == LIFECYCLE_DRAFT, EInvalidLifecycle);
    assert!(sequence == release.observed_style_count, EInvalidSequence);
    assert!(release.observed_style_count < release.expected_style_count, EInvalidCount);
    assert_identifier(&part_key);
    assert_identifier(&item_key);
    assert_identifier(&style_key);
    assert_locator(&asset_blob_id);
    assert_digest(&asset_commitment);
    let key = StyleKeyV8 { part_key, item_key, style_key };
    assert!(!release.styles.contains(key), EDuplicate);
    if (protected) {
        assert_digest(&seal_id);
        let scope_key = pack_seal_scope_key_v8(release.namespace, release.pack_key);
        let scope_commitment = pack_seal_scope_commitment_v8(release.content_commitment);
        seal::assert_asset_covered_v8(
            seal_registry,
            root,
            seal::scope_pack_style_v8(),
            scope_key,
            &scope_commitment,
            style_seal_asset_key_v8(part_key, item_key, style_key),
            &asset_commitment,
            &seal_id,
        );
        release.observed_protected_style_count = release.observed_protected_style_count + 1;
    } else {
        assert!(seal_id.is_empty(), ESealCoverageMissing);
    };
    release.rolling_style_registry_commitment = advance_style_commitment_v8(
        release.root_content_commitment,
        release.namespace,
        release.pack_key,
        release.manifest_commitment,
        release.content_commitment,
        sequence,
        release.rolling_style_registry_commitment,
        part_key,
        item_key,
        style_key,
        asset_blob_id,
        asset_commitment,
        protected,
        seal_id,
    );
    release.styles.add(key, PackStyleV8 {
        part_key,
        item_key,
        style_key,
        asset_blob_id,
        asset_commitment,
        protected,
        seal_id,
    });
    release.observed_style_count = release.observed_style_count + 1;
}

public fun seal_expansion_pack_release_v8<PaymentCoin>(
    release: &mut ExpansionPackReleaseV8<PaymentCoin>,
    root: &MakerRootV8<PaymentCoin>,
    maker_admin: &MakerAdminCapV8,
    pack_admin: &ExpansionPackAdminCapV8,
    seal_registry: &SealRegistryV8,
    ctx: &TxContext,
) {
    maker::assert_draft_admin_v8(root, maker_admin);
    assert_release_binding(release, root);
    assert_pack_admin(release, pack_admin, ctx);
    assert!(release.lifecycle == LIFECYCLE_DRAFT, EInvalidLifecycle);
    let (_, _, _) = seal::assert_activation_ready_v8(seal_registry, root);
    assert!(release.seal_registry_id == seal::registry_id_v8(seal_registry), EInvalidBinding);
    assert!(release.seal_registry_commitment == *seal::registry_commitment_v8(seal_registry), EInvalidCommitment);
    assert!(release.observed_style_count == release.expected_style_count, EInvalidCount);
    assert!(
        release.observed_protected_style_count == release.expected_protected_style_count,
        EInvalidCount,
    );
    assert!(
        release.rolling_style_registry_commitment == release.expected_style_registry_commitment,
        EInvalidCommitment,
    );
    set_lifecycle(release, LIFECYCLE_SEALED);
}

public fun append_release_to_registry_v8<PaymentCoin>(
    registry: &mut ExpansionPackRegistryV8,
    release: &ExpansionPackReleaseV8<PaymentCoin>,
    root: &MakerRootV8<PaymentCoin>,
    maker_admin: &MakerAdminCapV8,
    sequence: u64,
) {
    maker::assert_draft_admin_v8(root, maker_admin);
    assert_registry_binding(registry, root);
    assert_release_binding(release, root);
    assert!(!registry.sealed, ERegistrySealed);
    assert!(release.lifecycle == LIFECYCLE_SEALED, EInvalidLifecycle);
    assert!(sequence == registry.observed_count, EInvalidSequence);
    assert!(registry.observed_count < registry.expected_count, EInvalidCount);
    let release_id = object::id(release);
    assert!(!registry.releases.contains(release_id), EDuplicate);
    let release_key = PackReleaseKeyV8 {
        namespace: release.namespace,
        pack_key: release.pack_key,
    };
    assert!(!registry.release_keys.contains(release_key), EDuplicate);
    registry.rolling_commitment = advance_release_commitment_v8(
        registry.root_content_commitment,
        sequence,
        registry.rolling_commitment,
        release.namespace,
        release.pack_key,
        release.manifest_commitment,
        release.content_commitment,
        release.rolling_style_registry_commitment,
        release.access_kind,
        release.purchase_price_atomic,
        release.complete_mode,
        release.complete_price_atomic,
        release.complete_free_quota_per_wallet,
        release.complete_total_cap,
        release.observed_protected_style_count,
        release.seal_registry_commitment,
    );
    registry.releases.add(release_id, PackReleaseRecordV8 {
        release_id,
        namespace: release.namespace,
        pack_key: release.pack_key,
        manifest_commitment: release.manifest_commitment,
        content_commitment: release.content_commitment,
        style_registry_commitment: release.rolling_style_registry_commitment,
        access_kind: release.access_kind,
        purchase_price_atomic: release.purchase_price_atomic,
        complete_mode: release.complete_mode,
        complete_price_atomic: release.complete_price_atomic,
        complete_free_quota_per_wallet: release.complete_free_quota_per_wallet,
        complete_total_cap: release.complete_total_cap,
        protected_style_count: release.observed_protected_style_count,
        seal_registry_id: release.seal_registry_id,
        seal_registry_commitment: release.seal_registry_commitment,
    });
    registry.release_keys.add(release_key, true);
    registry.protected_style_count =
        registry.protected_style_count + release.observed_protected_style_count;
    registry.observed_count = registry.observed_count + 1;
}

public fun seal_expansion_pack_registry_v8<PaymentCoin>(
    registry: &mut ExpansionPackRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    maker_admin: &MakerAdminCapV8,
) {
    maker::assert_draft_admin_v8(root, maker_admin);
    assert_registry_binding(registry, root);
    assert!(!registry.sealed, ERegistrySealed);
    assert!(registry.observed_count == registry.expected_count, EInvalidCount);
    assert!(registry.rolling_commitment == registry.expected_commitment, EInvalidCommitment);
    registry.sealed = true;
}

public(package) fun assert_activation_ready_v8<PaymentCoin>(
    registry: &ExpansionPackRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
): (ID, vector<u8>, u64, u64) {
    assert_registry_binding(registry, root);
    assert!(registry.sealed, ERegistryNotSealed);
    assert!(registry.observed_count == registry.expected_count, EInvalidCount);
    assert!(registry.rolling_commitment == registry.expected_commitment, EInvalidCommitment);
    (
        object::id(registry),
        registry.rolling_commitment,
        registry.observed_count,
        registry.protected_style_count,
    )
}

public(package) fun rebind_ownership_epoch_v8<PaymentCoin>(
    registry: &mut ExpansionPackRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    next_epoch: u64,
) {
    maker::assert_current_admin_v8(root, admin);
    assert_registry_binding(registry, root);
    assert!(registry.sealed, ERegistryNotSealed);
    assert!(next_epoch == maker::ownership_epoch_v8(root) + 1, EInvalidBinding);
    registry.ownership_epoch = next_epoch;
}

public fun activate_expansion_pack_v8<PaymentCoin>(
    release: &mut ExpansionPackReleaseV8<PaymentCoin>,
    registry: &ExpansionPackRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    maker_admin: &MakerAdminCapV8,
    pack_admin: &ExpansionPackAdminCapV8,
    ctx: &TxContext,
) {
    maker::assert_current_admin_v8(root, maker_admin);
    maker::assert_active_root_v8(root);
    assert_registry_binding(registry, root);
    assert!(registry.sealed, ERegistryNotSealed);
    assert_release_binding(release, root);
    assert_release_registered(registry, release);
    assert_pack_admin(release, pack_admin, ctx);
    assert!(release.lifecycle == LIFECYCLE_SEALED || release.lifecycle == LIFECYCLE_PAUSED, EInvalidLifecycle);
    set_lifecycle(release, LIFECYCLE_ACTIVE);
}

public fun pause_expansion_pack_v8<PaymentCoin>(
    release: &mut ExpansionPackReleaseV8<PaymentCoin>,
    root: &MakerRootV8<PaymentCoin>,
    maker_admin: &MakerAdminCapV8,
    pack_admin: &ExpansionPackAdminCapV8,
    ctx: &TxContext,
) {
    maker::assert_current_admin_v8(root, maker_admin);
    assert_release_binding(release, root);
    assert_pack_admin(release, pack_admin, ctx);
    assert!(release.lifecycle == LIFECYCLE_ACTIVE, EInvalidLifecycle);
    set_lifecycle(release, LIFECYCLE_PAUSED);
}

public fun archive_expansion_pack_v8<PaymentCoin>(
    release: &mut ExpansionPackReleaseV8<PaymentCoin>,
    root: &MakerRootV8<PaymentCoin>,
    maker_admin: &MakerAdminCapV8,
    pack_admin: &ExpansionPackAdminCapV8,
    ctx: &TxContext,
) {
    maker::assert_current_admin_v8(root, maker_admin);
    assert_release_binding(release, root);
    assert_pack_admin(release, pack_admin, ctx);
    assert!(
        release.lifecycle == LIFECYCLE_SEALED
            || release.lifecycle == LIFECYCLE_ACTIVE
            || release.lifecycle == LIFECYCLE_PAUSED,
        EInvalidLifecycle,
    );
    set_lifecycle(release, LIFECYCLE_ARCHIVED);
}

/// Transfers the independent Pack authority without requiring a Maker cap.
/// This remains callable while the release is epoch-stale, so the old Pack
/// owner can hand control to the new Root owner before readmission.
public fun transfer_expansion_pack_control_v8<PaymentCoin>(
    release: &mut ExpansionPackReleaseV8<PaymentCoin>,
    pack_admin: ExpansionPackAdminCapV8,
    recipient: address,
    ctx: &TxContext,
) {
    let pack_admin = update_expansion_pack_control_v8(release, pack_admin, recipient, ctx);
    transfer::transfer(pack_admin, recipient);
}

#[test_only]
public(package) fun transfer_expansion_pack_control_for_testing<PaymentCoin>(
    release: &mut ExpansionPackReleaseV8<PaymentCoin>,
    pack_admin: ExpansionPackAdminCapV8,
    recipient: address,
    ctx: &TxContext,
): ExpansionPackAdminCapV8 {
    update_expansion_pack_control_v8(release, pack_admin, recipient, ctx)
}

fun update_expansion_pack_control_v8<PaymentCoin>(
    release: &mut ExpansionPackReleaseV8<PaymentCoin>,
    mut pack_admin: ExpansionPackAdminCapV8,
    recipient: address,
    ctx: &TxContext,
): ExpansionPackAdminCapV8 {
    assert_pack_admin(release, &pack_admin, ctx);
    assert!(release.lifecycle != LIFECYCLE_ARCHIVED, EInvalidLifecycle);
    assert!(recipient != @0x0 && recipient != release.current_owner, EInvalidRecipient);
    let previous_owner = release.current_owner;
    release.current_owner = recipient;
    pack_admin.owner = recipient;
    event::emit(ExpansionPackControlTransferredV8 {
        release_id: object::id(release),
        previous_owner,
        owner: recipient,
        ownership_epoch: release.ownership_epoch,
    });
    pack_admin
}

/// Existing wallet entitlements survive, but remain unusable until both Maker
/// and Pack authorities bind the release to the new Root ownership epoch.
public fun readmit_expansion_pack_epoch_v8<PaymentCoin>(
    release: &mut ExpansionPackReleaseV8<PaymentCoin>,
    root: &MakerRootV8<PaymentCoin>,
    maker_admin: &MakerAdminCapV8,
    pack_admin: &mut ExpansionPackAdminCapV8,
    ctx: &TxContext,
) {
    maker::assert_current_admin_v8(root, maker_admin);
    assert_release_identity_without_epoch(release, root);
    assert_pack_admin(release, pack_admin, ctx);
    let current_epoch = maker::ownership_epoch_v8(root);
    assert!(release.ownership_epoch != current_epoch, EParentEpochChanged);
    release.ownership_epoch = current_epoch;
    pack_admin.ownership_epoch = current_epoch;
    set_lifecycle(release, LIFECYCLE_PAUSED);
}

public fun claim_free_expansion_pack_v8<PaymentCoin>(
    release: &mut ExpansionPackReleaseV8<PaymentCoin>,
    root: &MakerRootV8<PaymentCoin>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    maker::assert_active_root_v8(root);
    assert_release_binding(release, root);
    assert!(release.lifecycle == LIFECYCLE_ACTIVE, EInvalidLifecycle);
    assert!(release.access_kind == ACCESS_FREE && release.purchase_price_atomic == 0, EInvalidAccess);
    issue_pass(release, 0, clock, ctx);
}

public fun claim_included_expansion_pack_v8<PaymentCoin>(
    release: &mut ExpansionPackReleaseV8<PaymentCoin>,
    root: &MakerRootV8<PaymentCoin>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    maker::assert_active_root_v8(root);
    maker::assert_maker_access_v8(root, ctx.sender());
    assert_release_binding(release, root);
    assert!(release.lifecycle == LIFECYCLE_ACTIVE, EInvalidLifecycle);
    assert!(
        release.access_kind == ACCESS_INCLUDED_WITH_MAKER
            && release.purchase_price_atomic == 0,
        EInvalidAccess,
    );
    issue_pass(release, 0, clock, ctx);
}

public fun purchase_expansion_pack_v8<PaymentCoin>(
    release: &mut ExpansionPackReleaseV8<PaymentCoin>,
    treasury: &mut ExpansionPackTreasuryV8<PaymentCoin>,
    root: &MakerRootV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    protocol_treasury: &mut ProtocolTreasuryV8<PaymentCoin>,
    payment: Coin<PaymentCoin>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    maker::assert_active_root_v8(root);
    assert_release_binding(release, root);
    assert_treasury(release, treasury);
    assert!(release.lifecycle == LIFECYCLE_ACTIVE, EInvalidLifecycle);
    assert!(release.access_kind == ACCESS_PAID && release.purchase_price_atomic > 0, EInvalidAccess);
    assert!(payment.value() == release.purchase_price_atomic, EWrongPayment);
    maker::assert_root_protocol_operational_v8(root, protocol_config, protocol_treasury);
    let gross = payment.value();
    let creator_coin = protocol::collect_protocol_primary_fee_v8(
        protocol_config,
        protocol_treasury,
        payment,
        ctx,
    );
    coin::put(&mut treasury.revenue, creator_coin);
    treasury.total_collected = treasury.total_collected + gross;
    issue_pass(release, gross, clock, ctx);
}

public fun withdraw_expansion_pack_revenue_v8<PaymentCoin>(
    release: &ExpansionPackReleaseV8<PaymentCoin>,
    pack_admin: &ExpansionPackAdminCapV8,
    treasury: &mut ExpansionPackTreasuryV8<PaymentCoin>,
    amount: u64,
    recipient: address,
    ctx: &mut TxContext,
) {
    assert_pack_admin(release, pack_admin, ctx);
    assert_treasury(release, treasury);
    assert!(recipient != @0x0, EInvalidRecipient);
    assert!(amount > 0 && amount <= treasury.revenue.value(), EInsufficientRevenue);
    let payment = coin::take(&mut treasury.revenue, amount, ctx);
    treasury.total_withdrawn = treasury.total_withdrawn + amount;
    event::emit(ExpansionPackRevenueWithdrawnV8 {
        release_id: object::id(release),
        treasury_id: object::id(treasury),
        recipient,
        amount,
    });
    transfer::public_transfer(payment, recipient);
}

public fun authorize_pack_style_v8<PaymentCoin>(
    release: &ExpansionPackReleaseV8<PaymentCoin>,
    root: &MakerRootV8<PaymentCoin>,
    part_key: String,
    item_key: String,
    style_key: String,
    ctx: &TxContext,
): PackStyleAccessProofV8 {
    maker::assert_active_root_v8(root);
    assert_release_binding(release, root);
    assert!(release.lifecycle == LIFECYCLE_ACTIVE, EInvalidLifecycle);
    if (release.access_kind == ACCESS_INCLUDED_WITH_MAKER) {
        maker::assert_maker_access_v8(root, ctx.sender());
    } else {
        assert!(release.entitlements.contains(ctx.sender()), EEntitlementMissing);
    };
    let style = release.styles.borrow(StyleKeyV8 { part_key, item_key, style_key });
    PackStyleAccessProofV8 {
        release_id: object::id(release),
        pack_scope_key: pack_seal_scope_key_v8(release.namespace, release.pack_key),
        maker_root_id: release.maker_root_id,
        ownership_epoch: release.ownership_epoch,
        root_content_commitment: release.root_content_commitment,
        release_content_commitment: release.content_commitment,
        complete_mode: release.complete_mode,
        complete_price_atomic: release.complete_price_atomic,
        complete_free_quota_per_wallet: release.complete_free_quota_per_wallet,
        complete_total_cap: release.complete_total_cap,
        holder: ctx.sender(),
        part_key,
        item_key,
        style_key,
        asset_commitment: style.asset_commitment,
        protected: style.protected,
        seal_id: style.seal_id,
    }
}

public(package) fun consume_style_access_proof_v8(
    proof: PackStyleAccessProofV8,
): (ID, String, ID, u64, vector<u8>, vector<u8>, u8, u64, u64, u64, address, String, String, String, vector<u8>, bool, vector<u8>) {
    let PackStyleAccessProofV8 {
        release_id,
        pack_scope_key,
        maker_root_id,
        ownership_epoch,
        root_content_commitment,
        release_content_commitment,
        complete_mode,
        complete_price_atomic,
        complete_free_quota_per_wallet,
        complete_total_cap,
        holder,
        part_key,
        item_key,
        style_key,
        asset_commitment,
        protected,
        seal_id,
    } = proof;
    (
        release_id,
        pack_scope_key,
        maker_root_id,
        ownership_epoch,
        root_content_commitment,
        release_content_commitment,
        complete_mode,
        complete_price_atomic,
        complete_free_quota_per_wallet,
        complete_total_cap,
        holder,
        part_key,
        item_key,
        style_key,
        asset_commitment,
        protected,
        seal_id,
    )
}

public fun registry_id_v8(self: &ExpansionPackRegistryV8): ID { object::id(self) }
public fun registry_commitment_v8(self: &ExpansionPackRegistryV8): &vector<u8> {
    &self.rolling_commitment
}
public fun registry_release_count_v8(self: &ExpansionPackRegistryV8): u64 { self.observed_count }
public fun registry_protected_style_count_v8(self: &ExpansionPackRegistryV8): u64 {
    self.protected_style_count
}
public fun registry_sealed_v8(self: &ExpansionPackRegistryV8): bool { self.sealed }
public fun release_id_v8<PaymentCoin>(self: &ExpansionPackReleaseV8<PaymentCoin>): ID {
    object::id(self)
}
public fun release_root_id_v8<PaymentCoin>(self: &ExpansionPackReleaseV8<PaymentCoin>): ID {
    self.maker_root_id
}
public fun release_ownership_epoch_v8<PaymentCoin>(self: &ExpansionPackReleaseV8<PaymentCoin>): u64 {
    self.ownership_epoch
}
public fun release_content_commitment_v8<PaymentCoin>(
    self: &ExpansionPackReleaseV8<PaymentCoin>,
): &vector<u8> { &self.content_commitment }
public fun release_style_commitment_v8<PaymentCoin>(
    self: &ExpansionPackReleaseV8<PaymentCoin>,
): &vector<u8> { &self.rolling_style_registry_commitment }
public fun release_access_kind_v8<PaymentCoin>(self: &ExpansionPackReleaseV8<PaymentCoin>): u8 {
    self.access_kind
}
public fun release_price_v8<PaymentCoin>(self: &ExpansionPackReleaseV8<PaymentCoin>): u64 {
    self.purchase_price_atomic
}
public fun release_complete_mode_v8<PaymentCoin>(
    self: &ExpansionPackReleaseV8<PaymentCoin>,
): u8 { self.complete_mode }
public fun release_complete_price_v8<PaymentCoin>(
    self: &ExpansionPackReleaseV8<PaymentCoin>,
): u64 { self.complete_price_atomic }
public fun release_complete_free_quota_v8<PaymentCoin>(
    self: &ExpansionPackReleaseV8<PaymentCoin>,
): u64 { self.complete_free_quota_per_wallet }
public fun release_complete_total_cap_v8<PaymentCoin>(
    self: &ExpansionPackReleaseV8<PaymentCoin>,
): u64 { self.complete_total_cap }
public fun release_lifecycle_v8<PaymentCoin>(self: &ExpansionPackReleaseV8<PaymentCoin>): u8 {
    self.lifecycle
}
public fun release_creator_v8<PaymentCoin>(self: &ExpansionPackReleaseV8<PaymentCoin>): address {
    self.creator
}
public fun release_current_owner_v8<PaymentCoin>(
    self: &ExpansionPackReleaseV8<PaymentCoin>,
): address { self.current_owner }
public fun release_entitlement_count_v8<PaymentCoin>(self: &ExpansionPackReleaseV8<PaymentCoin>): u64 {
    self.entitlement_count
}
public fun has_entitlement_v8<PaymentCoin>(
    self: &ExpansionPackReleaseV8<PaymentCoin>,
    wallet: address,
): bool { self.entitlements.contains(wallet) }
public fun treasury_balance_v8<PaymentCoin>(self: &ExpansionPackTreasuryV8<PaymentCoin>): u64 {
    self.revenue.value()
}
public fun pass_holder_v8(self: &ExpansionPackPassV8): address { self.holder }
public fun pass_release_id_v8(self: &ExpansionPackPassV8): ID { self.release_id }
public fun pass_ownership_epoch_v8(self: &ExpansionPackPassV8): u64 { self.ownership_epoch }

/// Complete stages one native policy for every exact registered release.
public(package) fun registered_complete_policy_v8<PaymentCoin>(
    registry: &ExpansionPackRegistryV8,
    release: &ExpansionPackReleaseV8<PaymentCoin>,
    root: &MakerRootV8<PaymentCoin>,
): (ID, String, vector<u8>, u8, u64, u64, u64) {
    maker::assert_draft_root_v8(root);
    assert_registry_binding(registry, root);
    assert_release_binding(release, root);
    assert!(release.lifecycle == LIFECYCLE_SEALED, EInvalidLifecycle);
    assert_release_registered(registry, release);
    (
        object::id(release),
        pack_seal_scope_key_v8(release.namespace, release.pack_key),
        release.content_commitment,
        release.complete_mode,
        release.complete_price_atomic,
        release.complete_free_quota_per_wallet,
        release.complete_total_cap,
    )
}

/// Physical publication can bind only a sealed staged Pack Style already
/// admitted to this Root's exact registry. Stable scope inputs exclude the
/// release object ID and ownership epoch from the pre-publication hash.
public(package) fun assert_physical_style_v8<PaymentCoin>(
    registry: &ExpansionPackRegistryV8,
    release: &ExpansionPackReleaseV8<PaymentCoin>,
    root: &MakerRootV8<PaymentCoin>,
    part_key: String,
    item_key: String,
    style_key: String,
    style_content_commitment: &vector<u8>,
): (String, vector<u8>) {
    maker::assert_draft_root_v8(root);
    assert_registry_binding(registry, root);
    assert_release_binding(release, root);
    assert!(release.lifecycle == LIFECYCLE_SEALED, EInvalidLifecycle);
    assert_release_registered(registry, release);
    let style = release.styles.borrow(StyleKeyV8 { part_key, item_key, style_key });
    assert!(&style.asset_commitment == style_content_commitment, EInvalidCommitment);
    (
        pack_seal_scope_key_v8(release.namespace, release.pack_key),
        pack_seal_scope_commitment_v8(release.content_commitment),
    )
}

#[test_only]
public(package) fun new_orphan_sealed_release_for_testing(
    root: &MakerRootV8<sui::sui::SUI>,
    ctx: &mut TxContext,
): ExpansionPackReleaseV8<sui::sui::SUI> {
    let namespace = b"test".to_string();
    let pack_key = b"orphan".to_string();
    let manifest_commitment = maker::test_digest(41);
    let content_commitment = maker::test_digest(42);
    let root_content_commitment = *maker::content_commitment_v8(root);
    let empty_style_commitment = empty_style_registry_commitment_v8(
        root_content_commitment,
        namespace,
        pack_key,
        manifest_commitment,
        content_commitment,
    );
    let style_commitment = advance_style_commitment_v8(
        root_content_commitment,
        namespace,
        pack_key,
        manifest_commitment,
        content_commitment,
        0,
        empty_style_commitment,
        b"face".to_string(),
        b"base".to_string(),
        b"pack".to_string(),
        b"walrus-pack-style".to_string(),
        maker::test_digest(24),
        false,
        vector[],
    );
    let mut styles = table::new(ctx);
    styles.add(
        StyleKeyV8 {
            part_key: b"face".to_string(),
            item_key: b"base".to_string(),
            style_key: b"pack".to_string(),
        },
        PackStyleV8 {
            part_key: b"face".to_string(),
            item_key: b"base".to_string(),
            style_key: b"pack".to_string(),
            asset_blob_id: b"walrus-pack-style".to_string(),
            asset_commitment: maker::test_digest(24),
            protected: false,
            seal_id: vector[],
        },
    );
    ExpansionPackReleaseV8 {
        id: object::new(ctx),
        version: VERSION,
        maker_root_id: maker::root_id_v8(root),
        ownership_epoch: maker::ownership_epoch_v8(root),
        root_content_commitment,
        creator: ctx.sender(),
        current_owner: ctx.sender(),
        admin_cap_id: object::id_from_address(@0xD1),
        treasury_id: object::id_from_address(@0xD2),
        namespace,
        pack_key,
        manifest_blob_id: b"walrus-pack-manifest".to_string(),
        manifest_commitment,
        content_commitment,
        access_kind: ACCESS_FREE,
        purchase_price_atomic: 0,
        complete_mode: maker::complete_unlimited_free_v8(),
        complete_price_atomic: 0,
        complete_free_quota_per_wallet: 0,
        complete_total_cap: 0,
        lifecycle: LIFECYCLE_SEALED,
        expected_style_count: 1,
        observed_style_count: 1,
        expected_protected_style_count: 0,
        observed_protected_style_count: 0,
        expected_style_registry_commitment: style_commitment,
        rolling_style_registry_commitment: style_commitment,
        seal_registry_id: object::id_from_address(@0xD3),
        seal_registry_commitment: maker::test_digest(34),
        entitlement_count: 0,
        styles,
        entitlements: table::new(ctx),
    }
}

#[test_only]
public(package) fun share_release_for_testing<PaymentCoin>(
    release: ExpansionPackReleaseV8<PaymentCoin>,
) {
    transfer::share_object(release);
}

#[test_only]
public(package) fun new_active_release_and_admin_for_testing(
    root: &MakerRootV8<sui::sui::SUI>,
    ctx: &mut TxContext,
): (ExpansionPackReleaseV8<sui::sui::SUI>, ExpansionPackAdminCapV8) {
    let mut release = new_orphan_sealed_release_for_testing(root, ctx);
    let admin = ExpansionPackAdminCapV8 {
        id: object::new(ctx),
        version: VERSION,
        release_id: object::id(&release),
        creator: ctx.sender(),
        owner: ctx.sender(),
        ownership_epoch: maker::ownership_epoch_v8(root),
    };
    release.admin_cap_id = object::id(&admin);
    release.lifecycle = LIFECYCLE_ACTIVE;
    (release, admin)
}

#[test_only]
public(package) fun new_sealed_release_and_admin_for_testing(
    root: &MakerRootV8<sui::sui::SUI>,
    ctx: &mut TxContext,
): (ExpansionPackReleaseV8<sui::sui::SUI>, ExpansionPackAdminCapV8) {
    let mut release = new_orphan_sealed_release_for_testing(root, ctx);
    let admin = ExpansionPackAdminCapV8 {
        id: object::new(ctx),
        version: VERSION,
        release_id: object::id(&release),
        creator: ctx.sender(),
        owner: ctx.sender(),
        ownership_epoch: maker::ownership_epoch_v8(root),
    };
    release.admin_cap_id = object::id(&admin);
    (release, admin)
}

#[test_only]
public(package) fun bind_seal_and_complete_policy_for_testing<PaymentCoin>(
    release: &mut ExpansionPackReleaseV8<PaymentCoin>,
    seal_registry: &SealRegistryV8,
    mode: u8,
    price_atomic: u64,
    free_quota_per_wallet: u64,
    total_cap: u64,
) {
    maker::assert_valid_complete_policy_v8(
        mode,
        price_atomic,
        free_quota_per_wallet,
        total_cap,
    );
    release.seal_registry_id = seal::registry_id_v8(seal_registry);
    release.seal_registry_commitment = *seal::registry_expected_commitment_v8(seal_registry);
    release.complete_mode = mode;
    release.complete_price_atomic = price_atomic;
    release.complete_free_quota_per_wallet = free_quota_per_wallet;
    release.complete_total_cap = total_cap;
}

#[test_only]
public(package) fun set_included_access_for_testing<PaymentCoin>(
    release: &mut ExpansionPackReleaseV8<PaymentCoin>,
) {
    release.access_kind = ACCESS_INCLUDED_WITH_MAKER;
    release.purchase_price_atomic = 0;
}

#[test_only]
public(package) fun share_release_and_admin_for_testing<PaymentCoin>(
    release: ExpansionPackReleaseV8<PaymentCoin>,
    admin: ExpansionPackAdminCapV8,
    ctx: &TxContext,
) {
    assert!(release.current_owner == ctx.sender(), EInvalidAdmin);
    assert_pack_admin(&release, &admin, ctx);
    transfer::share_object(release);
    transfer::transfer(admin, ctx.sender());
}

fun issue_pass<PaymentCoin>(
    release: &mut ExpansionPackReleaseV8<PaymentCoin>,
    paid_atomic: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let holder = ctx.sender();
    assert!(!release.entitlements.contains(holder), EEntitlementExists);
    let pass = ExpansionPackPassV8 {
        id: object::new(ctx),
        version: VERSION,
        release_id: object::id(release),
        maker_root_id: release.maker_root_id,
        ownership_epoch: release.ownership_epoch,
        root_content_commitment: release.root_content_commitment,
        release_content_commitment: release.content_commitment,
        holder,
        paid_atomic,
        issued_at_ms: clock.timestamp_ms(),
    };
    let pass_id = object::id(&pass);
    release.entitlements.add(holder, EntitlementRecordV8 {
        pass_id,
        paid_atomic,
        issued_at_ms: clock.timestamp_ms(),
        admitted_ownership_epoch: release.ownership_epoch,
    });
    release.entitlement_count = release.entitlement_count + 1;
    event::emit(ExpansionPackPassIssuedV8 {
        release_id: object::id(release),
        pass_id,
        holder,
        paid_atomic,
        ownership_epoch: release.ownership_epoch,
    });
    transfer::transfer(pass, holder);
}

fun assert_registry_binding<PaymentCoin>(
    registry: &ExpansionPackRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
) {
    assert!(registry.version == VERSION, EInvalidBinding);
    assert!(registry.maker_root_id == maker::root_id_v8(root), EInvalidBinding);
    assert!(registry.ownership_epoch == maker::ownership_epoch_v8(root), EInvalidBinding);
    assert!(registry.root_content_commitment == *maker::content_commitment_v8(root), EInvalidBinding);
}

fun assert_release_binding<PaymentCoin>(
    release: &ExpansionPackReleaseV8<PaymentCoin>,
    root: &MakerRootV8<PaymentCoin>,
) {
    assert_release_identity_without_epoch(release, root);
    assert!(release.ownership_epoch == maker::ownership_epoch_v8(root), EParentEpochChanged);
}

fun assert_release_identity_without_epoch<PaymentCoin>(
    release: &ExpansionPackReleaseV8<PaymentCoin>,
    root: &MakerRootV8<PaymentCoin>,
) {
    assert!(release.version == VERSION, EInvalidBinding);
    assert!(release.maker_root_id == maker::root_id_v8(root), EInvalidBinding);
    assert!(release.root_content_commitment == *maker::content_commitment_v8(root), EInvalidBinding);
}

fun assert_pack_admin<PaymentCoin>(
    release: &ExpansionPackReleaseV8<PaymentCoin>,
    admin: &ExpansionPackAdminCapV8,
    ctx: &TxContext,
) {
    assert!(admin.version == VERSION, EInvalidAdmin);
    assert!(admin.release_id == object::id(release), EInvalidAdmin);
    assert!(object::id(admin) == release.admin_cap_id, EInvalidAdmin);
    assert!(admin.creator == release.creator, EInvalidAdmin);
    assert!(admin.owner == release.current_owner && ctx.sender() == release.current_owner, EInvalidAdmin);
    assert!(admin.ownership_epoch == release.ownership_epoch, EInvalidAdmin);
}

fun assert_treasury<PaymentCoin>(
    release: &ExpansionPackReleaseV8<PaymentCoin>,
    treasury: &ExpansionPackTreasuryV8<PaymentCoin>,
) {
    assert!(treasury.version == VERSION, EInvalidTreasury);
    assert!(treasury.release_id == object::id(release), EInvalidTreasury);
    assert!(object::id(treasury) == release.treasury_id, EInvalidTreasury);
}

fun assert_release_registered<PaymentCoin>(
    registry: &ExpansionPackRegistryV8,
    release: &ExpansionPackReleaseV8<PaymentCoin>,
) {
    let release_id = object::id(release);
    assert!(registry.releases.contains(release_id), EInvalidBinding);
    let record = registry.releases.borrow(release_id);
    assert!(record.release_id == release_id, EInvalidBinding);
    assert!(record.namespace == release.namespace, EInvalidBinding);
    assert!(record.pack_key == release.pack_key, EInvalidBinding);
    assert!(record.manifest_commitment == release.manifest_commitment, EInvalidCommitment);
    assert!(record.content_commitment == release.content_commitment, EInvalidCommitment);
    assert!(
        record.style_registry_commitment == release.rolling_style_registry_commitment,
        EInvalidCommitment,
    );
    assert!(record.access_kind == release.access_kind, EInvalidAccess);
    assert!(record.purchase_price_atomic == release.purchase_price_atomic, EInvalidAccess);
    assert!(record.complete_mode == release.complete_mode, EInvalidAccess);
    assert!(record.complete_price_atomic == release.complete_price_atomic, EInvalidAccess);
    assert!(
        record.complete_free_quota_per_wallet == release.complete_free_quota_per_wallet,
        EInvalidAccess,
    );
    assert!(record.complete_total_cap == release.complete_total_cap, EInvalidAccess);
    assert!(record.protected_style_count == release.observed_protected_style_count, EInvalidCount);
    assert!(record.seal_registry_id == release.seal_registry_id, EInvalidBinding);
    assert!(record.seal_registry_commitment == release.seal_registry_commitment, EInvalidCommitment);
}

fun assert_access(access_kind: u8, purchase_price_atomic: u64) {
    assert!(
        (access_kind == ACCESS_FREE && purchase_price_atomic == 0)
            || (
                access_kind == ACCESS_PAID
                    && purchase_price_atomic > 0
                    && purchase_price_atomic <= maker::max_price_atomic_v8()
            )
            || (access_kind == ACCESS_INCLUDED_WITH_MAKER && purchase_price_atomic == 0),
        EInvalidAccess,
    );
}

fun set_lifecycle<PaymentCoin>(release: &mut ExpansionPackReleaseV8<PaymentCoin>, lifecycle: u8) {
    let previous_lifecycle = release.lifecycle;
    release.lifecycle = lifecycle;
    event::emit(ExpansionPackLifecycleChangedV8 {
        release_id: object::id(release),
        previous_lifecycle,
        lifecycle,
        ownership_epoch: release.ownership_epoch,
    });
}

fun assert_identifier(value: &String) {
    assert!(value.length() > 0 && value.length() <= MAX_IDENTIFIER_BYTES, EInvalidIdentifier);
}

fun assert_canonical_component(value: &String) {
    assert_identifier(value);
    let bytes = string::as_bytes(value);
    let mut index = 0;
    while (index < bytes.length()) {
        assert!(*bytes.borrow(index) != 0, EInvalidIdentifier);
        index = index + 1;
    };
}

fun assert_locator(value: &String) {
    assert!(value.length() > 0 && value.length() <= MAX_LOCATOR_BYTES, EInvalidIdentifier);
}

fun assert_digest(value: &vector<u8>) {
    assert!(value.length() == HASH_LENGTH, EInvalidCommitment);
}
