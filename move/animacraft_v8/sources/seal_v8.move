module animacraft_v8::seal_v8;

use animacraft_v8::maker_v8::{Self as maker, MakerAdminCapV8, MakerRootV8};
use std::bcs;
use std::hash;
use std::string::{Self as string, String};
use sui::event;
use sui::table::{Self as table, Table};

const VERSION: u64 = 8;
const HASH_LENGTH: u64 = 32;
const MAX_SCOPE_KEY_BYTES: u64 = 512;
const MAX_ASSET_KEY_BYTES: u64 = 512;

const SCOPE_MAKER_STYLE: u8 = 0;
const SCOPE_PACK_STYLE: u8 = 1;
const SCOPE_COMPLETE: u8 = 2;

const EInvalidBinding: u64 = 0;
const EInvalidCommitment: u64 = 1;
const EInvalidCount: u64 = 2;
const EInvalidSequence: u64 = 3;
const EInvalidScope: u64 = 4;
const EInvalidAssetKey: u64 = 5;
const EDuplicateAsset: u64 = 6;
const ERegistrySealed: u64 = 7;
const ERegistryNotSealed: u64 = 8;
const EAssetMissing: u64 = 9;

public struct SealAssetKeyV8 has copy, drop, store {
    scope_kind: u8,
    scope_key: String,
    asset_key: String,
}

public struct ProtectedAssetV8 has copy, drop, store {
    scope_kind: u8,
    scope_key: String,
    scope_commitment: vector<u8>,
    asset_key: String,
    asset_commitment: vector<u8>,
    seal_id: vector<u8>,
}

public struct SealRegistryV8 has key {
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
    assets: Table<SealAssetKeyV8, ProtectedAssetV8>,
}

public struct SealIdInputV8 has copy, drop, store {
    domain: vector<u8>,
    version: u64,
    root_content_commitment: vector<u8>,
    scope_kind: u8,
    scope_key: String,
    scope_commitment: vector<u8>,
    asset_key: String,
    asset_commitment: vector<u8>,
}

public struct SealRowHashInputV8 has copy, drop, store {
    domain: vector<u8>,
    version: u64,
    root_content_commitment: vector<u8>,
    sequence: u64,
    prior_commitment: vector<u8>,
    scope_kind: u8,
    scope_key: String,
    scope_commitment: vector<u8>,
    asset_key: String,
    asset_commitment: vector<u8>,
    seal_id: vector<u8>,
}

public struct SealEmptyHashInputV8 has copy, drop, store {
    domain: vector<u8>,
    version: u64,
    root_content_commitment: vector<u8>,
}

public struct ProtectedAssetRegisteredV8 has copy, drop {
    registry_id: ID,
    sequence: u64,
    scope_kind: u8,
    scope_key: String,
    scope_commitment: vector<u8>,
    asset_key: String,
    seal_id: vector<u8>,
    rolling_commitment: vector<u8>,
}

public struct SealRegistrySealedV8 has copy, drop {
    registry_id: ID,
    protected_asset_count: u64,
    commitment: vector<u8>,
}

public fun version_v8(): u64 { VERSION }
public fun scope_maker_style_v8(): u8 { SCOPE_MAKER_STYLE }
public fun scope_pack_style_v8(): u8 { SCOPE_PACK_STYLE }
public fun scope_complete_v8(): u8 { SCOPE_COMPLETE }
public fun maker_style_scope_key_v8(): String { b"maker".to_string() }
public fun maker_style_scope_commitment_v8(
    root_content_commitment: vector<u8>,
): vector<u8> {
    assert_digest(&root_content_commitment);
    root_content_commitment
}

/// Canonical asset key shared by base-Maker and Pack Style coverage.
public fun style_asset_key_v8(
    part_key: String,
    item_key: String,
    style_key: String,
): String {
    assert_component(&part_key);
    assert_component(&item_key);
    assert_component(&style_key);
    let mut bytes = part_key.into_bytes();
    bytes.push_back(0);
    bytes.append(item_key.into_bytes());
    bytes.push_back(0);
    bytes.append(style_key.into_bytes());
    bytes.to_string()
}

/// Pure pre-publication helper. Object IDs and ownership epochs are excluded
/// deliberately and remain mandatory registry binding checks.
public fun empty_registry_commitment_v8(
    root_content_commitment: vector<u8>,
): vector<u8> {
    assert_digest(&root_content_commitment);
    hash::sha2_256(bcs::to_bytes(&SealEmptyHashInputV8 {
        domain: b"animacraft.v8/seal/empty",
        version: VERSION,
        root_content_commitment,
    }))
}

public(package) fun new_seal_registry_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    expected_count: u64,
    expected_commitment: vector<u8>,
    ctx: &mut TxContext,
): SealRegistryV8 {
    maker::assert_draft_admin_v8(root, admin);
    assert_digest(&expected_commitment);
    let maker_root_id = maker::root_id_v8(root);
    let ownership_epoch = maker::ownership_epoch_v8(root);
    let root_content_commitment = *maker::content_commitment_v8(root);
    let rolling_commitment = empty_registry_commitment_v8(root_content_commitment);
    if (expected_count == 0) {
        assert!(expected_commitment == rolling_commitment, EInvalidCommitment);
    };
    SealRegistryV8 {
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
        assets: table::new(ctx),
    }
}

public(package) fun share_seal_registry_v8(registry: SealRegistryV8) {
    transfer::share_object(registry);
}

public fun derive_seal_id_v8(
    root_content_commitment: vector<u8>,
    scope_kind: u8,
    scope_key: String,
    scope_commitment: vector<u8>,
    asset_key: String,
    asset_commitment: vector<u8>,
): vector<u8> {
    assert_scope(scope_kind);
    assert_scope_key(&scope_key);
    assert_asset_key(&asset_key);
    assert_digest(&root_content_commitment);
    assert_digest(&scope_commitment);
    assert_digest(&asset_commitment);
    hash::sha2_256(bcs::to_bytes(&SealIdInputV8 {
        domain: b"animacraft.v8/seal/id",
        version: VERSION,
        root_content_commitment,
        scope_kind,
        scope_key,
        scope_commitment,
        asset_key,
        asset_commitment,
    }))
}

/// Computes the exact row-chain transition and its derived Seal ID from only
/// stable semantic inputs. Append uses this helper verbatim.
public fun advance_protected_asset_commitment_v8(
    root_content_commitment: vector<u8>,
    sequence: u64,
    prior_commitment: vector<u8>,
    scope_kind: u8,
    scope_key: String,
    scope_commitment: vector<u8>,
    asset_key: String,
    asset_commitment: vector<u8>,
): (vector<u8>, vector<u8>) {
    assert_digest(&root_content_commitment);
    assert_digest(&prior_commitment);
    let seal_id = derive_seal_id_v8(
        root_content_commitment,
        scope_kind,
        scope_key,
        scope_commitment,
        asset_key,
        asset_commitment,
    );
    let next_commitment = hash::sha2_256(bcs::to_bytes(&SealRowHashInputV8 {
        domain: b"animacraft.v8/seal/row",
        version: VERSION,
        root_content_commitment,
        sequence,
        prior_commitment,
        scope_kind,
        scope_key,
        scope_commitment,
        asset_key,
        asset_commitment,
        seal_id,
    }));
    (next_commitment, seal_id)
}

public fun append_protected_asset_v8<PaymentCoin>(
    registry: &mut SealRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    sequence: u64,
    scope_kind: u8,
    scope_key: String,
    scope_commitment: vector<u8>,
    asset_key: String,
    asset_commitment: vector<u8>,
): vector<u8> {
    maker::assert_draft_admin_v8(root, admin);
    assert_registry_binding(registry, root);
    assert!(!registry.sealed, ERegistrySealed);
    assert!(sequence == registry.observed_count, EInvalidSequence);
    assert!(registry.observed_count < registry.expected_count, EInvalidCount);
    assert_scope(scope_kind);
    assert_scope_key(&scope_key);
    assert_asset_key(&asset_key);
    assert_digest(&scope_commitment);
    assert_digest(&asset_commitment);
    let key = SealAssetKeyV8 { scope_kind, scope_key, asset_key };
    assert!(!registry.assets.contains(key), EDuplicateAsset);
    let (next_commitment, seal_id) = advance_protected_asset_commitment_v8(
        registry.root_content_commitment,
        sequence,
        registry.rolling_commitment,
        scope_kind,
        scope_key,
        scope_commitment,
        asset_key,
        asset_commitment,
    );
    registry.rolling_commitment = next_commitment;
    registry.assets.add(key, ProtectedAssetV8 {
        scope_kind,
        scope_key,
        scope_commitment,
        asset_key,
        asset_commitment,
        seal_id,
    });
    registry.observed_count = registry.observed_count + 1;
    event::emit(ProtectedAssetRegisteredV8 {
        registry_id: object::id(registry),
        sequence,
        scope_kind,
        scope_key,
        scope_commitment,
        asset_key,
        seal_id,
        rolling_commitment: registry.rolling_commitment,
    });
    seal_id
}

public fun seal_registry_v8<PaymentCoin>(
    registry: &mut SealRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
) {
    maker::assert_draft_admin_v8(root, admin);
    assert_registry_binding(registry, root);
    assert!(!registry.sealed, ERegistrySealed);
    assert!(registry.observed_count == registry.expected_count, EInvalidCount);
    assert!(registry.rolling_commitment == registry.expected_commitment, EInvalidCommitment);
    registry.sealed = true;
    event::emit(SealRegistrySealedV8 {
        registry_id: object::id(registry),
        protected_asset_count: registry.observed_count,
        commitment: registry.rolling_commitment,
    });
}

public(package) fun assert_asset_covered_v8<PaymentCoin>(
    registry: &SealRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    scope_kind: u8,
    scope_key: String,
    scope_commitment: &vector<u8>,
    asset_key: String,
    asset_commitment: &vector<u8>,
    expected_seal_id: &vector<u8>,
) {
    assert_registry_binding(registry, root);
    assert!(registry.sealed, ERegistryNotSealed);
    let key = SealAssetKeyV8 { scope_kind, scope_key, asset_key };
    assert!(registry.assets.contains(key), EAssetMissing);
    let asset = registry.assets.borrow(key);
    assert!(&asset.scope_commitment == scope_commitment, EInvalidCommitment);
    assert!(&asset.asset_commitment == asset_commitment, EInvalidCommitment);
    assert!(&asset.seal_id == expected_seal_id, EInvalidCommitment);
    assert!(asset.seal_id == derive_seal_id_v8(
        registry.root_content_commitment,
        scope_kind,
        scope_key,
        asset.scope_commitment,
        asset_key,
        asset.asset_commitment,
    ), EInvalidCommitment);
}

public fun check_asset_covered_v8<PaymentCoin>(
    registry: &SealRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    scope_kind: u8,
    scope_key: String,
    scope_commitment: &vector<u8>,
    asset_key: String,
    asset_commitment: &vector<u8>,
    expected_seal_id: &vector<u8>,
): bool {
    if (!registry_binding_matches(registry, root) || !registry.sealed) return false;
    let key = SealAssetKeyV8 { scope_kind, scope_key, asset_key };
    if (!registry.assets.contains(key)) return false;
    let asset = registry.assets.borrow(key);
    &asset.scope_commitment == scope_commitment
        && &asset.asset_commitment == asset_commitment
        && &asset.seal_id == expected_seal_id
        && asset.seal_id == derive_seal_id_v8(
            registry.root_content_commitment,
            scope_kind,
            scope_key,
            asset.scope_commitment,
            asset_key,
            asset.asset_commitment,
        )
}

public(package) fun assert_activation_ready_v8<PaymentCoin>(
    registry: &SealRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
): (ID, vector<u8>, u64) {
    assert_registry_binding(registry, root);
    assert!(registry.sealed, ERegistryNotSealed);
    assert!(registry.observed_count == registry.expected_count, EInvalidCount);
    assert!(registry.rolling_commitment == registry.expected_commitment, EInvalidCommitment);
    (object::id(registry), registry.rolling_commitment, registry.observed_count)
}

/// Allows another same-package DRAFT module to bind a not-yet-sealed Seal
/// registry by identity and its immutable expected final commitment. This is
/// used while a Pack release records the registry's immutable expected Seal
/// commitment before the registry is finalized.
public(package) fun assert_draft_binding_v8<PaymentCoin>(
    registry: &SealRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
) {
    assert_registry_binding(registry, root);
    assert!(!registry.sealed, ERegistrySealed);
}

public(package) fun rebind_ownership_epoch_v8<PaymentCoin>(
    registry: &mut SealRegistryV8,
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

public fun registry_id_v8(self: &SealRegistryV8): ID { object::id(self) }
public fun registry_root_id_v8(self: &SealRegistryV8): ID { self.maker_root_id }
public fun registry_ownership_epoch_v8(self: &SealRegistryV8): u64 { self.ownership_epoch }
public fun registry_expected_count_v8(self: &SealRegistryV8): u64 { self.expected_count }
public fun registry_observed_count_v8(self: &SealRegistryV8): u64 { self.observed_count }
public fun registry_commitment_v8(self: &SealRegistryV8): &vector<u8> { &self.rolling_commitment }
public fun registry_expected_commitment_v8(self: &SealRegistryV8): &vector<u8> {
    &self.expected_commitment
}
public fun registry_sealed_v8(self: &SealRegistryV8): bool { self.sealed }
public fun asset_seal_id_v8(
    self: &SealRegistryV8,
    scope_kind: u8,
    scope_key: String,
    scope_commitment: &vector<u8>,
    asset_key: String,
): &vector<u8> {
    let asset = self.assets.borrow(SealAssetKeyV8 { scope_kind, scope_key, asset_key });
    assert!(&asset.scope_commitment == scope_commitment, EInvalidCommitment);
    &asset.seal_id
}

fun assert_registry_binding<PaymentCoin>(
    registry: &SealRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
) {
    assert!(registry_binding_matches(registry, root), EInvalidBinding);
}

fun registry_binding_matches<PaymentCoin>(
    registry: &SealRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
): bool {
    registry.version == VERSION
        && registry.maker_root_id == maker::root_id_v8(root)
        && registry.ownership_epoch == maker::ownership_epoch_v8(root)
        && registry.root_content_commitment == *maker::content_commitment_v8(root)
}

fun assert_scope(scope_kind: u8) {
    assert!(
        scope_kind == SCOPE_MAKER_STYLE
            || scope_kind == SCOPE_PACK_STYLE
            || scope_kind == SCOPE_COMPLETE,
        EInvalidScope,
    );
}

fun assert_scope_key(scope_key: &String) {
    assert!(scope_key.length() > 0 && scope_key.length() <= MAX_SCOPE_KEY_BYTES, EInvalidScope);
}

fun assert_asset_key(asset_key: &String) {
    assert!(asset_key.length() > 0 && asset_key.length() <= MAX_ASSET_KEY_BYTES, EInvalidAssetKey);
}

fun assert_component(value: &String) {
    assert!(value.length() > 0 && value.length() <= MAX_ASSET_KEY_BYTES, EInvalidAssetKey);
    let bytes = string::as_bytes(value);
    let mut index = 0;
    while (index < bytes.length()) {
        assert!(*bytes.borrow(index) != 0, EInvalidAssetKey);
        index = index + 1;
    };
}

fun assert_digest(value: &vector<u8>) {
    assert!(value.length() == HASH_LENGTH, EInvalidCommitment);
}
