/// Fresh v8 Physical registry and custody objects.
///
/// Publication commitments use only pre-publication stable semantics. Runtime
/// objects additionally bind the exact registry ID, Root ID, ownership epoch,
/// and Root content commitment. No v4-v7 type is imported or accepted.
module animacraft_v8::physical_v8;

use animacraft_v8::expansion_pack_v8::{
    Self as pack,
    ExpansionPackRegistryV8,
    ExpansionPackReleaseV8,
};
use animacraft_v8::maker_v8::{Self as maker, MakerAdminCapV8, MakerRootV8};
use std::bcs;
use std::hash;
use std::string::String;
use sui::event;
use sui::table::{Self as table, Table};

const VERSION: u64 = 8;
const HASH_LENGTH: u64 = 32;
const MAX_IDENTIFIER_BYTES: u64 = 128;
const MAX_SCOPE_KEY_BYTES: u64 = 512;
const MAX_POLICIES: u64 = 10_000;
const MAX_SUPPLY_PER_POLICY: u64 = 1_000_000_000;

const SOURCE_MAKER_STYLE: u8 = 0;
const SOURCE_PACK_STYLE: u8 = 1;

const EInvalidBinding: u64 = 0;
const EInvalidCommitment: u64 = 1;
const EInvalidCount: u64 = 2;
const EInvalidSequence: u64 = 3;
const EInvalidKey: u64 = 4;
const EInvalidSource: u64 = 5;
const EDuplicatePolicy: u64 = 6;
const ERegistrySealed: u64 = 7;
const ERegistryNotSealed: u64 = 8;
const EPolicyMissing: u64 = 9;
const ESupplyExhausted: u64 = 10;
const ENotAuthorized: u64 = 11;
const ENotTransferable: u64 = 12;
const EInvalidRecipient: u64 = 13;
const ERecoveryNotRequired: u64 = 14;

public struct PhysicalPolicyKeyV8 has copy, drop, store {
    source_kind: u8,
    scope_key: String,
    scope_commitment: vector<u8>,
    part_key: String,
    item_key: String,
    style_key: String,
}

public struct PhysicalStylePolicyV8 has copy, drop, store {
    source_kind: u8,
    scope_key: String,
    scope_commitment: vector<u8>,
    part_key: String,
    item_key: String,
    style_key: String,
    style_content_commitment: vector<u8>,
    material_commitment: vector<u8>,
    max_supply: u64,
    materialized_count: u64,
    transferable: bool,
}

public struct PhysicalRegistryV8 has key {
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
    total_materialized: u64,
    total_consumed: u64,
    policies: Table<PhysicalPolicyKeyV8, PhysicalStylePolicyV8>,
}

/// A module-mediated custody object. The missing `store` ability prevents a
/// generic transfer from bypassing holder, epoch, and transfer-policy checks.
public struct PhysicalAssetV8 has key {
    id: UID,
    version: u64,
    registry_id: ID,
    maker_root_id: ID,
    ownership_epoch: u64,
    root_content_commitment: vector<u8>,
    source_kind: u8,
    scope_key: String,
    scope_commitment: vector<u8>,
    part_key: String,
    item_key: String,
    style_key: String,
    style_content_commitment: vector<u8>,
    material_commitment: vector<u8>,
    serial: u64,
    holder: address,
    transferable: bool,
}

public struct PhysicalEmptyHashInputV8 has copy, drop, store {
    domain: vector<u8>,
    version: u64,
    root_content_commitment: vector<u8>,
}

public struct PhysicalPolicyHashInputV8 has copy, drop, store {
    domain: vector<u8>,
    version: u64,
    root_content_commitment: vector<u8>,
    sequence: u64,
    prior_commitment: vector<u8>,
    source_kind: u8,
    scope_key: String,
    scope_commitment: vector<u8>,
    part_key: String,
    item_key: String,
    style_key: String,
    style_content_commitment: vector<u8>,
    material_commitment: vector<u8>,
    max_supply: u64,
    transferable: bool,
}

public struct PhysicalMaterializedV8 has copy, drop {
    registry_id: ID,
    asset_id: ID,
    maker_root_id: ID,
    ownership_epoch: u64,
    holder: address,
    source_kind: u8,
    scope_key: String,
    part_key: String,
    item_key: String,
    style_key: String,
    serial: u64,
}

public struct PhysicalTransferredV8 has copy, drop {
    asset_id: ID,
    from: address,
    to: address,
    ownership_epoch: u64,
}

public struct PhysicalConsumedV8 has copy, drop {
    registry_id: ID,
    asset_id: ID,
    maker_root_id: ID,
    holder: address,
    serial: u64,
    material_commitment: vector<u8>,
}

public struct PhysicalEpochRecoveredV8 has copy, drop {
    asset_id: ID,
    holder: address,
    from_epoch: u64,
    to_epoch: u64,
}

public fun version_v8(): u64 { VERSION }
public fun source_maker_style_v8(): u8 { SOURCE_MAKER_STYLE }
public fun source_pack_style_v8(): u8 { SOURCE_PACK_STYLE }
public fun maker_style_scope_key_v8(): String { b"maker".to_string() }

/// Pure client/on-chain parity helper. No object ID or ownership epoch is an
/// input, so the expected commitment can be frozen before begin_maker_v8.
public fun empty_registry_commitment_v8(
    root_content_commitment: vector<u8>,
): vector<u8> {
    assert_digest(&root_content_commitment);
    hash::sha2_256(bcs::to_bytes(&PhysicalEmptyHashInputV8 {
        domain: b"animacraft.v8/physical/empty",
        version: VERSION,
        root_content_commitment,
    }))
}

public fun advance_policy_commitment_v8(
    root_content_commitment: vector<u8>,
    sequence: u64,
    prior_commitment: vector<u8>,
    source_kind: u8,
    scope_key: String,
    scope_commitment: vector<u8>,
    part_key: String,
    item_key: String,
    style_key: String,
    style_content_commitment: vector<u8>,
    material_commitment: vector<u8>,
    max_supply: u64,
    transferable: bool,
): vector<u8> {
    assert_digest(&root_content_commitment);
    assert_digest(&prior_commitment);
    assert_source(source_kind);
    assert_scope_key(&scope_key);
    assert_identifier(&part_key);
    assert_identifier(&item_key);
    assert_identifier(&style_key);
    assert_digest(&scope_commitment);
    assert_digest(&style_content_commitment);
    assert_digest(&material_commitment);
    assert!(max_supply > 0 && max_supply <= MAX_SUPPLY_PER_POLICY, EInvalidCount);
    hash::sha2_256(bcs::to_bytes(&PhysicalPolicyHashInputV8 {
        domain: b"animacraft.v8/physical/policy",
        version: VERSION,
        root_content_commitment,
        sequence,
        prior_commitment,
        source_kind,
        scope_key,
        scope_commitment,
        part_key,
        item_key,
        style_key,
        style_content_commitment,
        material_commitment,
        max_supply,
        transferable,
    }))
}

public(package) fun new_physical_registry_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    expected_count: u64,
    expected_commitment: vector<u8>,
    ctx: &mut TxContext,
): PhysicalRegistryV8 {
    maker::assert_draft_admin_v8(root, admin);
    assert!(expected_count <= MAX_POLICIES, EInvalidCount);
    assert_digest(&expected_commitment);
    let root_content_commitment = *maker::content_commitment_v8(root);
    let rolling_commitment = empty_registry_commitment_v8(root_content_commitment);
    if (expected_count == 0) {
        assert!(expected_commitment == rolling_commitment, EInvalidCommitment);
    };
    PhysicalRegistryV8 {
        id: object::new(ctx),
        version: VERSION,
        maker_root_id: maker::root_id_v8(root),
        ownership_epoch: maker::ownership_epoch_v8(root),
        root_content_commitment,
        expected_count,
        observed_count: 0,
        expected_commitment,
        rolling_commitment,
        sealed: false,
        total_materialized: 0,
        total_consumed: 0,
        policies: table::new(ctx),
    }
}

public(package) fun share_physical_registry_v8(registry: PhysicalRegistryV8) {
    transfer::share_object(registry);
}

public fun append_maker_style_policy_v8<PaymentCoin>(
    registry: &mut PhysicalRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    sequence: u64,
    part_key: String,
    item_key: String,
    style_key: String,
    style_content_commitment: vector<u8>,
    material_commitment: vector<u8>,
    max_supply: u64,
    transferable: bool,
) {
    maker::assert_style_content_v8(
        root,
        part_key,
        item_key,
        style_key,
        &style_content_commitment,
    );
    append_policy(
        registry,
        root,
        admin,
        sequence,
        SOURCE_MAKER_STYLE,
        maker_style_scope_key_v8(),
        *maker::content_commitment_v8(root),
        part_key,
        item_key,
        style_key,
        style_content_commitment,
        material_commitment,
        max_supply,
        transferable,
    );
}

public fun append_pack_style_policy_v8<PaymentCoin>(
    registry: &mut PhysicalRegistryV8,
    pack_registry: &ExpansionPackRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    release: &ExpansionPackReleaseV8<PaymentCoin>,
    sequence: u64,
    part_key: String,
    item_key: String,
    style_key: String,
    style_content_commitment: vector<u8>,
    material_commitment: vector<u8>,
    max_supply: u64,
    transferable: bool,
) {
    let (scope_key, scope_commitment) = pack::assert_physical_style_v8(
        pack_registry,
        release,
        root,
        part_key,
        item_key,
        style_key,
        &style_content_commitment,
    );
    append_policy(
        registry,
        root,
        admin,
        sequence,
        SOURCE_PACK_STYLE,
        scope_key,
        scope_commitment,
        part_key,
        item_key,
        style_key,
        style_content_commitment,
        material_commitment,
        max_supply,
        transferable,
    );
}

public fun seal_physical_registry_v8<PaymentCoin>(
    registry: &mut PhysicalRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
) {
    maker::assert_draft_admin_v8(root, admin);
    assert_registry_binding(registry, root);
    assert!(!registry.sealed, ERegistrySealed);
    assert!(registry.observed_count == registry.expected_count, EInvalidCount);
    assert!(registry.rolling_commitment == registry.expected_commitment, EInvalidCommitment);
    registry.sealed = true;
}

public(package) fun assert_activation_ready_v8<PaymentCoin>(
    registry: &PhysicalRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
): (ID, vector<u8>, u64) {
    assert_registry_binding(registry, root);
    assert!(registry.sealed, ERegistryNotSealed);
    assert!(registry.observed_count == registry.expected_count, EInvalidCount);
    assert!(registry.rolling_commitment == registry.expected_commitment, EInvalidCommitment);
    (object::id(registry), registry.rolling_commitment, registry.observed_count)
}

public(package) fun rebind_ownership_epoch_v8<PaymentCoin>(
    registry: &mut PhysicalRegistryV8,
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

public fun materialize_physical_v8<PaymentCoin>(
    registry: &mut PhysicalRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    source_kind: u8,
    scope_key: String,
    scope_commitment: vector<u8>,
    part_key: String,
    item_key: String,
    style_key: String,
    recipient: address,
    ctx: &mut TxContext,
) {
    maker::assert_current_admin_v8(root, admin);
    maker::assert_active_root_v8(root);
    assert!(maker::root_owner_v8(root) == ctx.sender(), ENotAuthorized);
    assert_registry_binding(registry, root);
    maker::assert_physical_registry_bound_v8(root, object::id(registry));
    assert!(registry.sealed, ERegistryNotSealed);
    assert!(recipient != @0x0, EInvalidRecipient);
    let key = PhysicalPolicyKeyV8 {
        source_kind,
        scope_key,
        scope_commitment,
        part_key,
        item_key,
        style_key,
    };
    assert!(registry.policies.contains(key), EPolicyMissing);
    let (
        serial,
        policy_source_kind,
        policy_scope_key,
        policy_scope_commitment,
        policy_part_key,
        policy_item_key,
        policy_style_key,
        policy_style_content_commitment,
        policy_material_commitment,
        policy_transferable,
    ) = {
        let policy = registry.policies.borrow_mut(key);
        assert!(policy.materialized_count < policy.max_supply, ESupplyExhausted);
        let serial = policy.materialized_count + 1;
        policy.materialized_count = serial;
        (
            serial,
            policy.source_kind,
            policy.scope_key,
            policy.scope_commitment,
            policy.part_key,
            policy.item_key,
            policy.style_key,
            policy.style_content_commitment,
            policy.material_commitment,
            policy.transferable,
        )
    };
    let asset = PhysicalAssetV8 {
        id: object::new(ctx),
        version: VERSION,
        registry_id: object::id(registry),
        maker_root_id: registry.maker_root_id,
        ownership_epoch: registry.ownership_epoch,
        root_content_commitment: registry.root_content_commitment,
        source_kind: policy_source_kind,
        scope_key: policy_scope_key,
        scope_commitment: policy_scope_commitment,
        part_key: policy_part_key,
        item_key: policy_item_key,
        style_key: policy_style_key,
        style_content_commitment: policy_style_content_commitment,
        material_commitment: policy_material_commitment,
        serial,
        holder: recipient,
        transferable: policy_transferable,
    };
    registry.total_materialized = registry.total_materialized + 1;
    event::emit(PhysicalMaterializedV8 {
        registry_id: object::id(registry),
        asset_id: object::id(&asset),
        maker_root_id: registry.maker_root_id,
        ownership_epoch: registry.ownership_epoch,
        holder: recipient,
        source_kind: policy_source_kind,
        scope_key: policy_scope_key,
        part_key: policy_part_key,
        item_key: policy_item_key,
        style_key: policy_style_key,
        serial,
    });
    transfer::transfer(asset, recipient);
}

public fun transfer_physical_v8<PaymentCoin>(
    mut asset: PhysicalAssetV8,
    registry: &PhysicalRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    recipient: address,
    ctx: &TxContext,
) {
    assert_current_asset(&asset, registry, root);
    assert!(asset.holder == ctx.sender(), ENotAuthorized);
    assert!(asset.transferable, ENotTransferable);
    assert!(recipient != @0x0 && recipient != asset.holder, EInvalidRecipient);
    let previous_holder = asset.holder;
    asset.holder = recipient;
    event::emit(PhysicalTransferredV8 {
        asset_id: object::id(&asset),
        from: previous_holder,
        to: recipient,
        ownership_epoch: asset.ownership_epoch,
    });
    transfer::transfer(asset, recipient);
}

public fun consume_physical_v8<PaymentCoin>(
    registry: &mut PhysicalRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    asset: PhysicalAssetV8,
    ctx: &TxContext,
) {
    assert_current_asset(&asset, registry, root);
    assert!(asset.holder == ctx.sender(), ENotAuthorized);
    let PhysicalAssetV8 {
        id,
        version: _,
        registry_id,
        maker_root_id,
        ownership_epoch: _,
        root_content_commitment: _,
        source_kind: _,
        scope_key: _,
        scope_commitment: _,
        part_key: _,
        item_key: _,
        style_key: _,
        style_content_commitment: _,
        material_commitment,
        serial,
        holder,
        transferable: _,
    } = asset;
    let asset_id = id.to_inner();
    registry.total_consumed = registry.total_consumed + 1;
    event::emit(PhysicalConsumedV8 {
        registry_id,
        asset_id,
        maker_root_id,
        holder,
        serial,
        material_commitment,
    });
    id.delete();
}

/// Holder-driven recovery is allowed only after the authoritative Physical
/// registry has atomically followed a Root ownership-epoch change.
public fun recover_physical_epoch_v8<PaymentCoin>(
    asset: &mut PhysicalAssetV8,
    registry: &PhysicalRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    ctx: &TxContext,
) {
    assert!(asset.holder == ctx.sender(), ENotAuthorized);
    assert_registry_binding(registry, root);
    maker::assert_physical_registry_bound_v8(root, object::id(registry));
    assert!(registry.sealed, ERegistryNotSealed);
    assert_asset_identity_without_epoch(asset, registry, root);
    assert!(asset.ownership_epoch != registry.ownership_epoch, ERecoveryNotRequired);
    let from_epoch = asset.ownership_epoch;
    asset.ownership_epoch = registry.ownership_epoch;
    event::emit(PhysicalEpochRecoveredV8 {
        asset_id: object::id(asset),
        holder: asset.holder,
        from_epoch,
        to_epoch: asset.ownership_epoch,
    });
}

public fun registry_id_v8(self: &PhysicalRegistryV8): ID { object::id(self) }
public fun registry_root_id_v8(self: &PhysicalRegistryV8): ID { self.maker_root_id }
public fun registry_ownership_epoch_v8(self: &PhysicalRegistryV8): u64 { self.ownership_epoch }
public fun registry_commitment_v8(self: &PhysicalRegistryV8): &vector<u8> {
    &self.rolling_commitment
}
public fun registry_expected_count_v8(self: &PhysicalRegistryV8): u64 { self.expected_count }
public fun registry_observed_count_v8(self: &PhysicalRegistryV8): u64 { self.observed_count }
public fun registry_sealed_v8(self: &PhysicalRegistryV8): bool { self.sealed }
public fun registry_total_materialized_v8(self: &PhysicalRegistryV8): u64 {
    self.total_materialized
}
public fun registry_total_consumed_v8(self: &PhysicalRegistryV8): u64 { self.total_consumed }
public fun asset_holder_v8(self: &PhysicalAssetV8): address { self.holder }
public fun asset_serial_v8(self: &PhysicalAssetV8): u64 { self.serial }
public fun asset_ownership_epoch_v8(self: &PhysicalAssetV8): u64 { self.ownership_epoch }
public fun asset_style_content_commitment_v8(self: &PhysicalAssetV8): &vector<u8> {
    &self.style_content_commitment
}

#[test_only]
public(package) fun corrupt_registry_root_for_testing(
    registry: &mut PhysicalRegistryV8,
    maker_root_id: ID,
) {
    registry.maker_root_id = maker_root_id;
}

#[test_only]
public(package) fun corrupt_registry_epoch_for_testing(
    registry: &mut PhysicalRegistryV8,
) {
    registry.ownership_epoch = registry.ownership_epoch + 1;
}

#[test_only]
public(package) fun corrupt_registry_content_for_testing(
    registry: &mut PhysicalRegistryV8,
    root_content_commitment: vector<u8>,
) {
    registry.root_content_commitment = root_content_commitment;
}

#[test_only]
public(package) fun corrupt_registry_commitment_for_testing(
    registry: &mut PhysicalRegistryV8,
    rolling_commitment: vector<u8>,
) {
    registry.rolling_commitment = rolling_commitment;
}

#[test_only]
public(package) fun new_current_asset_for_testing<PaymentCoin>(
    registry: &PhysicalRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    holder: address,
    transferable: bool,
    ctx: &mut TxContext,
): PhysicalAssetV8 {
    assert_registry_binding(registry, root);
    PhysicalAssetV8 {
        id: object::new(ctx),
        version: VERSION,
        registry_id: object::id(registry),
        maker_root_id: maker::root_id_v8(root),
        ownership_epoch: maker::ownership_epoch_v8(root),
        root_content_commitment: *maker::content_commitment_v8(root),
        source_kind: SOURCE_MAKER_STYLE,
        scope_key: maker_style_scope_key_v8(),
        scope_commitment: *maker::content_commitment_v8(root),
        part_key: b"face".to_string(),
        item_key: b"base".to_string(),
        style_key: b"default".to_string(),
        style_content_commitment: maker::test_digest(24),
        material_commitment: maker::test_digest(40),
        serial: 1,
        holder,
        transferable,
    }
}

fun append_policy<PaymentCoin>(
    registry: &mut PhysicalRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    sequence: u64,
    source_kind: u8,
    scope_key: String,
    scope_commitment: vector<u8>,
    part_key: String,
    item_key: String,
    style_key: String,
    style_content_commitment: vector<u8>,
    material_commitment: vector<u8>,
    max_supply: u64,
    transferable: bool,
) {
    maker::assert_draft_admin_v8(root, admin);
    assert_registry_binding(registry, root);
    assert!(!registry.sealed, ERegistrySealed);
    assert!(sequence == registry.observed_count, EInvalidSequence);
    assert!(registry.observed_count < registry.expected_count, EInvalidCount);
    let key = PhysicalPolicyKeyV8 {
        source_kind,
        scope_key,
        scope_commitment,
        part_key,
        item_key,
        style_key,
    };
    assert!(!registry.policies.contains(key), EDuplicatePolicy);
    registry.rolling_commitment = advance_policy_commitment_v8(
        registry.root_content_commitment,
        sequence,
        registry.rolling_commitment,
        source_kind,
        scope_key,
        scope_commitment,
        part_key,
        item_key,
        style_key,
        style_content_commitment,
        material_commitment,
        max_supply,
        transferable,
    );
    registry.policies.add(key, PhysicalStylePolicyV8 {
        source_kind,
        scope_key,
        scope_commitment,
        part_key,
        item_key,
        style_key,
        style_content_commitment,
        material_commitment,
        max_supply,
        materialized_count: 0,
        transferable,
    });
    registry.observed_count = registry.observed_count + 1;
}

fun assert_current_asset<PaymentCoin>(
    asset: &PhysicalAssetV8,
    registry: &PhysicalRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
) {
    maker::assert_active_root_v8(root);
    assert_registry_binding(registry, root);
    maker::assert_physical_registry_bound_v8(root, object::id(registry));
    assert!(registry.sealed, ERegistryNotSealed);
    assert_asset_identity_without_epoch(asset, registry, root);
    assert!(asset.ownership_epoch == registry.ownership_epoch, EInvalidBinding);
}

fun assert_asset_identity_without_epoch<PaymentCoin>(
    asset: &PhysicalAssetV8,
    registry: &PhysicalRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
) {
    assert!(asset.version == VERSION, EInvalidBinding);
    assert!(asset.registry_id == object::id(registry), EInvalidBinding);
    assert!(asset.maker_root_id == maker::root_id_v8(root), EInvalidBinding);
    assert!(asset.root_content_commitment == *maker::content_commitment_v8(root), EInvalidBinding);
}

fun assert_registry_binding<PaymentCoin>(
    registry: &PhysicalRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
) {
    assert!(registry.version == VERSION, EInvalidBinding);
    assert!(registry.maker_root_id == maker::root_id_v8(root), EInvalidBinding);
    assert!(registry.ownership_epoch == maker::ownership_epoch_v8(root), EInvalidBinding);
    assert!(registry.root_content_commitment == *maker::content_commitment_v8(root), EInvalidBinding);
}

fun assert_source(source_kind: u8) {
    assert!(
        source_kind == SOURCE_MAKER_STYLE || source_kind == SOURCE_PACK_STYLE,
        EInvalidSource,
    );
}

fun assert_identifier(value: &String) {
    assert!(value.length() > 0 && value.length() <= MAX_IDENTIFIER_BYTES, EInvalidKey);
}

fun assert_scope_key(value: &String) {
    assert!(value.length() > 0 && value.length() <= MAX_SCOPE_KEY_BYTES, EInvalidKey);
}

fun assert_digest(value: &vector<u8>) {
    assert!(value.length() == HASH_LENGTH, EInvalidCommitment);
}
