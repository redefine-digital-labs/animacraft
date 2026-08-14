module animacraft_v8::composition_v8;

use animacraft_v8::maker_v8::{Self as maker, MakerAdminCapV8, MakerRootV8};
use std::bcs;
use std::hash;
use std::string::String;
use sui::table::{Self as table, Table};

const VERSION: u64 = 8;
const HASH_LENGTH: u64 = 32;
const MAX_IDENTIFIER_BYTES: u64 = 128;
const MAX_SLOT_CAPACITY: u64 = 16;

const SLOT_FIXED: u8 = 0;
const SLOT_SOUL_LOCAL: u8 = 1;
const SLOT_OPEN: u8 = 2;
const SLOT_HYBRID: u8 = 3;

const SOURCE_OFFICIAL: u8 = 0;
const SOURCE_CERTIFIED: u8 = 1;
const SOURCE_OPEN: u8 = 2;

const RULE_REQUIRE: u8 = 0;
const RULE_EXCLUDE: u8 = 1;

const EInvalidBinding: u64 = 0;
const EInvalidCommitment: u64 = 1;
const EInvalidCount: u64 = 2;
const EInvalidSequence: u64 = 3;
const EInvalidIdentifier: u64 = 4;
const EInvalidSlot: u64 = 5;
const EInvalidItem: u64 = 6;
const EInvalidRule: u64 = 7;
const EDuplicate: u64 = 8;
const ERegistrySealed: u64 = 9;
const ERegistryNotSealed: u64 = 10;
const EStaleRevision: u64 = 11;
const ENotHolder: u64 = 12;
const ESlotFull: u64 = 13;
const ESelectionMissing: u64 = 14;
const ESelectionExists: u64 = 15;
const ERuleViolation: u64 = 16;
const ERecoveryRequired: u64 = 17;
const ERecoveryActive: u64 = 18;
const ERecoveryNotActive: u64 = 19;
const ERecoveryNotEmpty: u64 = 20;
const ECurrentEpoch: u64 = 21;

public struct SlotKeyV8 has copy, drop, store {
    slot_key: String,
}

public struct ItemKeyV8 has copy, drop, store {
    slot_key: String,
    item_key: String,
}

public struct RuleKeyV8 has copy, drop, store {
    sequence: u64,
}

public struct WardrobeSlotV8 has copy, drop, store {
    slot_key: String,
    behavior: u8,
    capacity: u64,
    required: bool,
    slot_commitment: vector<u8>,
}

public struct CompositionItemV8 has copy, drop, store {
    slot_key: String,
    item_key: String,
    source_kind: u8,
    transferable: bool,
    definition_commitment: vector<u8>,
    asset_commitment: vector<u8>,
}

public struct LoadoutRuleV8 has copy, drop, store {
    sequence: u64,
    rule_kind: u8,
    left_slot_key: String,
    left_item_key: String,
    right_slot_key: String,
    right_item_key: String,
    rule_commitment: vector<u8>,
}

/// Immutable-after-seal canonical Composition data for one MakerRootV8.
public struct CompositionRegistryV8 has key {
    id: UID,
    version: u64,
    maker_root_id: ID,
    ownership_epoch: u64,
    root_content_commitment: vector<u8>,
    expected_slot_count: u64,
    expected_item_count: u64,
    expected_rule_count: u64,
    expected_count: u64,
    observed_slot_count: u64,
    observed_item_count: u64,
    observed_rule_count: u64,
    observed_count: u64,
    expected_commitment: vector<u8>,
    rolling_commitment: vector<u8>,
    sealed: bool,
    slot_keys: vector<String>,
    slots: Table<SlotKeyV8, WardrobeSlotV8>,
    items: Table<ItemKeyV8, CompositionItemV8>,
    rules: Table<RuleKeyV8, LoadoutRuleV8>,
}

/// Wallet-owned logical state. It is not a Soul ownership proof.
public struct OwnedLoadoutV8 has key {
    id: UID,
    version: u64,
    maker_root_id: ID,
    ownership_epoch: u64,
    root_content_commitment: vector<u8>,
    composition_registry_id: ID,
    holder: address,
    revision: u64,
    recovering: bool,
    selected_slot_keys: vector<String>,
    selections_by_slot: Table<SlotKeyV8, vector<String>>,
    selection_count: u64,
    loadout_commitment: vector<u8>,
}

public struct CompositionEmptyHashInputV8 has copy, drop, store {
    domain: vector<u8>,
    version: u64,
    root_content_commitment: vector<u8>,
}

public struct CompositionSlotHashInputV8 has copy, drop, store {
    domain: vector<u8>,
    version: u64,
    root_content_commitment: vector<u8>,
    sequence: u64,
    prior_commitment: vector<u8>,
    slot_key: String,
    behavior: u8,
    capacity: u64,
    required: bool,
    slot_commitment: vector<u8>,
}

public struct CompositionItemHashInputV8 has copy, drop, store {
    domain: vector<u8>,
    version: u64,
    root_content_commitment: vector<u8>,
    sequence: u64,
    prior_commitment: vector<u8>,
    slot_key: String,
    item_key: String,
    source_kind: u8,
    transferable: bool,
    definition_commitment: vector<u8>,
    asset_commitment: vector<u8>,
}

public struct CompositionRuleHashInputV8 has copy, drop, store {
    domain: vector<u8>,
    version: u64,
    root_content_commitment: vector<u8>,
    sequence: u64,
    prior_commitment: vector<u8>,
    rule_kind: u8,
    left_slot_key: String,
    left_item_key: String,
    right_slot_key: String,
    right_item_key: String,
    rule_commitment: vector<u8>,
}

public struct LoadoutMutationHashInputV8 has copy, drop, store {
    domain: vector<u8>,
    version: u64,
    loadout_id: ID,
    maker_root_id: ID,
    ownership_epoch: u64,
    revision: u64,
    prior_commitment: vector<u8>,
    operation: u8,
    slot_key: String,
    item_key: String,
}

public fun version_v8(): u64 { VERSION }
public fun slot_fixed_v8(): u8 { SLOT_FIXED }
public fun slot_soul_local_v8(): u8 { SLOT_SOUL_LOCAL }
public fun slot_open_v8(): u8 { SLOT_OPEN }
public fun slot_hybrid_v8(): u8 { SLOT_HYBRID }
public fun source_official_v8(): u8 { SOURCE_OFFICIAL }
public fun source_certified_v8(): u8 { SOURCE_CERTIFIED }
public fun source_open_v8(): u8 { SOURCE_OPEN }
public fun rule_require_v8(): u8 { RULE_REQUIRE }
public fun rule_exclude_v8(): u8 { RULE_EXCLUDE }

/// Pure pre-publication helper. Object IDs and ownership epochs are excluded
/// deliberately: they are checked independently by registry binding.
public fun empty_registry_commitment_v8(
    root_content_commitment: vector<u8>,
): vector<u8> {
    assert_digest(&root_content_commitment);
    hash::sha2_256(bcs::to_bytes(&CompositionEmptyHashInputV8 {
        domain: b"animacraft.v8/composition/empty",
        version: VERSION,
        root_content_commitment,
    }))
}

public fun advance_slot_commitment_v8(
    root_content_commitment: vector<u8>,
    sequence: u64,
    prior_commitment: vector<u8>,
    slot_key: String,
    behavior: u8,
    capacity: u64,
    required: bool,
    slot_commitment: vector<u8>,
): vector<u8> {
    assert_digest(&root_content_commitment);
    assert_digest(&prior_commitment);
    assert_identifier(&slot_key);
    assert!(behavior <= SLOT_HYBRID, EInvalidSlot);
    assert!(capacity > 0 && capacity <= MAX_SLOT_CAPACITY, EInvalidSlot);
    assert_digest(&slot_commitment);
    hash::sha2_256(bcs::to_bytes(&CompositionSlotHashInputV8 {
        domain: b"animacraft.v8/composition/slot",
        version: VERSION,
        root_content_commitment,
        sequence,
        prior_commitment,
        slot_key,
        behavior,
        capacity,
        required,
        slot_commitment,
    }))
}

public fun advance_item_commitment_v8(
    root_content_commitment: vector<u8>,
    sequence: u64,
    prior_commitment: vector<u8>,
    slot_key: String,
    item_key: String,
    source_kind: u8,
    transferable: bool,
    definition_commitment: vector<u8>,
    asset_commitment: vector<u8>,
): vector<u8> {
    assert_digest(&root_content_commitment);
    assert_digest(&prior_commitment);
    assert_identifier(&slot_key);
    assert_identifier(&item_key);
    assert!(source_kind <= SOURCE_OPEN, EInvalidItem);
    assert_digest(&definition_commitment);
    assert_digest(&asset_commitment);
    hash::sha2_256(bcs::to_bytes(&CompositionItemHashInputV8 {
        domain: b"animacraft.v8/composition/item",
        version: VERSION,
        root_content_commitment,
        sequence,
        prior_commitment,
        slot_key,
        item_key,
        source_kind,
        transferable,
        definition_commitment,
        asset_commitment,
    }))
}

public fun advance_rule_commitment_v8(
    root_content_commitment: vector<u8>,
    sequence: u64,
    prior_commitment: vector<u8>,
    rule_kind: u8,
    left_slot_key: String,
    left_item_key: String,
    right_slot_key: String,
    right_item_key: String,
    rule_commitment: vector<u8>,
): vector<u8> {
    assert_digest(&root_content_commitment);
    assert_digest(&prior_commitment);
    assert!(rule_kind == RULE_REQUIRE || rule_kind == RULE_EXCLUDE, EInvalidRule);
    assert_identifier(&left_slot_key);
    assert_identifier(&left_item_key);
    assert_identifier(&right_slot_key);
    assert_identifier(&right_item_key);
    assert_digest(&rule_commitment);
    hash::sha2_256(bcs::to_bytes(&CompositionRuleHashInputV8 {
        domain: b"animacraft.v8/composition/rule",
        version: VERSION,
        root_content_commitment,
        sequence,
        prior_commitment,
        rule_kind,
        left_slot_key,
        left_item_key,
        right_slot_key,
        right_item_key,
        rule_commitment,
    }))
}

public(package) fun new_composition_registry_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    expected_slot_count: u64,
    expected_item_count: u64,
    expected_rule_count: u64,
    expected_commitment: vector<u8>,
    ctx: &mut TxContext,
): CompositionRegistryV8 {
    maker::assert_draft_admin_v8(root, admin);
    assert_digest(&expected_commitment);
    let expected_count = expected_slot_count + expected_item_count + expected_rule_count;
    let maker_root_id = maker::root_id_v8(root);
    let ownership_epoch = maker::ownership_epoch_v8(root);
    let root_content_commitment = *maker::content_commitment_v8(root);
    let rolling_commitment = empty_registry_commitment_v8(root_content_commitment);
    if (expected_count == 0) {
        assert!(expected_commitment == rolling_commitment, EInvalidCommitment);
    };
    CompositionRegistryV8 {
        id: object::new(ctx),
        version: VERSION,
        maker_root_id,
        ownership_epoch,
        root_content_commitment,
        expected_slot_count,
        expected_item_count,
        expected_rule_count,
        expected_count,
        observed_slot_count: 0,
        observed_item_count: 0,
        observed_rule_count: 0,
        observed_count: 0,
        expected_commitment,
        rolling_commitment,
        sealed: false,
        slot_keys: vector[],
        slots: table::new(ctx),
        items: table::new(ctx),
        rules: table::new(ctx),
    }
}

public(package) fun share_composition_registry_v8(registry: CompositionRegistryV8) {
    transfer::share_object(registry);
}

public fun append_wardrobe_slot_v8<PaymentCoin>(
    registry: &mut CompositionRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    sequence: u64,
    slot_key: String,
    behavior: u8,
    capacity: u64,
    required: bool,
    slot_commitment: vector<u8>,
) {
    assert_write(registry, root, admin, sequence);
    assert!(registry.observed_item_count == 0 && registry.observed_rule_count == 0, EInvalidSequence);
    assert!(registry.observed_slot_count < registry.expected_slot_count, EInvalidCount);
    assert_identifier(&slot_key);
    assert!(behavior <= SLOT_HYBRID, EInvalidSlot);
    assert!(capacity > 0 && capacity <= MAX_SLOT_CAPACITY, EInvalidSlot);
    assert_digest(&slot_commitment);
    let key = SlotKeyV8 { slot_key };
    assert!(!registry.slots.contains(key), EDuplicate);
    registry.rolling_commitment = advance_slot_commitment_v8(
        registry.root_content_commitment,
        sequence,
        registry.rolling_commitment,
        slot_key,
        behavior,
        capacity,
        required,
        slot_commitment,
    );
    registry.slots.add(key, WardrobeSlotV8 {
        slot_key,
        behavior,
        capacity,
        required,
        slot_commitment,
    });
    registry.slot_keys.push_back(slot_key);
    registry.observed_slot_count = registry.observed_slot_count + 1;
    registry.observed_count = registry.observed_count + 1;
}

public fun append_composition_item_v8<PaymentCoin>(
    registry: &mut CompositionRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    sequence: u64,
    slot_key: String,
    item_key: String,
    source_kind: u8,
    transferable: bool,
    definition_commitment: vector<u8>,
    asset_commitment: vector<u8>,
) {
    assert_write(registry, root, admin, sequence);
    assert!(registry.observed_slot_count == registry.expected_slot_count, EInvalidSequence);
    assert!(registry.observed_rule_count == 0, EInvalidSequence);
    assert!(registry.observed_item_count < registry.expected_item_count, EInvalidCount);
    assert_identifier(&slot_key);
    assert_identifier(&item_key);
    assert!(source_kind <= SOURCE_OPEN, EInvalidItem);
    assert_digest(&definition_commitment);
    assert_digest(&asset_commitment);
    assert!(registry.slots.contains(SlotKeyV8 { slot_key }), EInvalidSlot);
    let key = ItemKeyV8 { slot_key, item_key };
    assert!(!registry.items.contains(key), EDuplicate);
    registry.rolling_commitment = advance_item_commitment_v8(
        registry.root_content_commitment,
        sequence,
        registry.rolling_commitment,
        slot_key,
        item_key,
        source_kind,
        transferable,
        definition_commitment,
        asset_commitment,
    );
    registry.items.add(key, CompositionItemV8 {
        slot_key,
        item_key,
        source_kind,
        transferable,
        definition_commitment,
        asset_commitment,
    });
    registry.observed_item_count = registry.observed_item_count + 1;
    registry.observed_count = registry.observed_count + 1;
}

public fun append_loadout_rule_v8<PaymentCoin>(
    registry: &mut CompositionRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    sequence: u64,
    rule_kind: u8,
    left_slot_key: String,
    left_item_key: String,
    right_slot_key: String,
    right_item_key: String,
    rule_commitment: vector<u8>,
) {
    assert_write(registry, root, admin, sequence);
    assert!(registry.observed_slot_count == registry.expected_slot_count, EInvalidSequence);
    assert!(registry.observed_item_count == registry.expected_item_count, EInvalidSequence);
    assert!(registry.observed_rule_count < registry.expected_rule_count, EInvalidCount);
    assert!(rule_kind == RULE_REQUIRE || rule_kind == RULE_EXCLUDE, EInvalidRule);
    assert_identifier(&left_slot_key);
    assert_identifier(&left_item_key);
    assert_identifier(&right_slot_key);
    assert_identifier(&right_item_key);
    assert_digest(&rule_commitment);
    assert!(registry.items.contains(ItemKeyV8 {
        slot_key: left_slot_key,
        item_key: left_item_key,
    }), EInvalidItem);
    assert!(registry.items.contains(ItemKeyV8 {
        slot_key: right_slot_key,
        item_key: right_item_key,
    }), EInvalidItem);
    let rule_sequence = registry.observed_rule_count;
    registry.rolling_commitment = advance_rule_commitment_v8(
        registry.root_content_commitment,
        sequence,
        registry.rolling_commitment,
        rule_kind,
        left_slot_key,
        left_item_key,
        right_slot_key,
        right_item_key,
        rule_commitment,
    );
    registry.rules.add(RuleKeyV8 { sequence: rule_sequence }, LoadoutRuleV8 {
        sequence: rule_sequence,
        rule_kind,
        left_slot_key,
        left_item_key,
        right_slot_key,
        right_item_key,
        rule_commitment,
    });
    registry.observed_rule_count = registry.observed_rule_count + 1;
    registry.observed_count = registry.observed_count + 1;
}

public fun seal_composition_registry_v8<PaymentCoin>(
    registry: &mut CompositionRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
) {
    maker::assert_draft_admin_v8(root, admin);
    assert_registry_binding(registry, root);
    assert!(!registry.sealed, ERegistrySealed);
    assert!(registry.observed_slot_count == registry.expected_slot_count, EInvalidCount);
    assert!(registry.observed_item_count == registry.expected_item_count, EInvalidCount);
    assert!(registry.observed_rule_count == registry.expected_rule_count, EInvalidCount);
    assert!(registry.observed_count == registry.expected_count, EInvalidCount);
    assert!(registry.rolling_commitment == registry.expected_commitment, EInvalidCommitment);
    registry.sealed = true;
}

public(package) fun assert_activation_ready_v8<PaymentCoin>(
    registry: &CompositionRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
): (ID, vector<u8>, u64) {
    assert_registry_binding(registry, root);
    assert!(registry.sealed, ERegistryNotSealed);
    assert!(registry.observed_slot_count == registry.expected_slot_count, EInvalidCount);
    assert!(registry.observed_item_count == registry.expected_item_count, EInvalidCount);
    assert!(registry.observed_rule_count == registry.expected_rule_count, EInvalidCount);
    assert!(registry.observed_count == registry.expected_count, EInvalidCount);
    assert!(registry.rolling_commitment == registry.expected_commitment, EInvalidCommitment);
    (object::id(registry), registry.rolling_commitment, registry.observed_slot_count)
}

/// Pre-binds the sealed registry to the epoch that core will install in the
/// same atomic ownership-transfer transaction.
public(package) fun rebind_ownership_epoch_v8<PaymentCoin>(
    registry: &mut CompositionRegistryV8,
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

public fun create_owned_loadout_v8<PaymentCoin>(
    registry: &CompositionRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    ctx: &mut TxContext,
) {
    maker::assert_active_root_v8(root);
    assert_registry_binding(registry, root);
    assert!(registry.sealed, ERegistryNotSealed);
    let loadout_uid = object::new(ctx);
    let loadout_id = loadout_uid.to_inner();
    let loadout = OwnedLoadoutV8 {
        id: loadout_uid,
        version: VERSION,
        maker_root_id: maker::root_id_v8(root),
        ownership_epoch: maker::ownership_epoch_v8(root),
        root_content_commitment: *maker::content_commitment_v8(root),
        composition_registry_id: object::id(registry),
        holder: ctx.sender(),
        revision: 0,
        recovering: false,
        selected_slot_keys: vector[],
        selections_by_slot: table::new(ctx),
        selection_count: 0,
        loadout_commitment: empty_loadout_commitment(
            loadout_id,
            maker::root_id_v8(root),
            maker::ownership_epoch_v8(root),
        ),
    };
    transfer::transfer(loadout, ctx.sender());
}

public fun select_loadout_item_v8<PaymentCoin>(
    loadout: &mut OwnedLoadoutV8,
    registry: &CompositionRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    expected_revision: u64,
    slot_key: String,
    item_key: String,
    ctx: &TxContext,
) {
    assert_loadout_mutable(loadout, registry, root, expected_revision, ctx);
    assert!(registry.items.contains(ItemKeyV8 { slot_key, item_key }), EInvalidItem);
    let slot = registry.slots.borrow(SlotKeyV8 { slot_key });
    let slot_table_key = SlotKeyV8 { slot_key };
    if (!loadout.selections_by_slot.contains(slot_table_key)) {
        loadout.selections_by_slot.add(slot_table_key, vector[]);
        loadout.selected_slot_keys.push_back(slot_key);
    };
    let selections = loadout.selections_by_slot.borrow_mut(slot_table_key);
    assert!(!string_vector_contains(selections, &item_key), ESelectionExists);
    assert!(selections.length() < slot.capacity, ESlotFull);
    selections.push_back(item_key);
    mutate_loadout_commitment(loadout, 0, slot_key, item_key);
    loadout.selection_count = loadout.selection_count + 1;
    loadout.revision = loadout.revision + 1;
}

public fun remove_loadout_item_v8<PaymentCoin>(
    loadout: &mut OwnedLoadoutV8,
    registry: &CompositionRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    expected_revision: u64,
    slot_key: String,
    item_key: String,
    ctx: &TxContext,
) {
    assert_loadout_mutable(loadout, registry, root, expected_revision, ctx);
    let key = SlotKeyV8 { slot_key };
    assert!(loadout.selections_by_slot.contains(key), ESelectionMissing);
    let selections = loadout.selections_by_slot.borrow_mut(key);
    let index = string_vector_index(selections, &item_key);
    selections.remove(index);
    if (selections.is_empty()) {
        let _ = loadout.selections_by_slot.remove(key);
        remove_string(&mut loadout.selected_slot_keys, &slot_key);
    };
    mutate_loadout_commitment(loadout, 1, slot_key, item_key);
    loadout.selection_count = loadout.selection_count - 1;
    loadout.revision = loadout.revision + 1;
}

public fun assert_loadout_rules_v8(
    loadout: &OwnedLoadoutV8,
    registry: &CompositionRegistryV8,
) {
    assert!(loadout.composition_registry_id == object::id(registry), EInvalidBinding);
    let mut slot_index = 0;
    while (slot_index < registry.slot_keys.length()) {
        let slot_key = registry.slot_keys[slot_index];
        let slot = registry.slots.borrow(SlotKeyV8 { slot_key });
        if (slot.required) {
            assert!(
                loadout.selections_by_slot.contains(SlotKeyV8 { slot_key })
                    && !loadout.selections_by_slot.borrow(SlotKeyV8 { slot_key }).is_empty(),
                ERuleViolation,
            );
        };
        slot_index = slot_index + 1;
    };
    let mut rule_index = 0;
    while (rule_index < registry.observed_rule_count) {
        let rule = registry.rules.borrow(RuleKeyV8 { sequence: rule_index });
        let left = loadout_contains(
            loadout,
            &rule.left_slot_key,
            &rule.left_item_key,
        );
        let right = loadout_contains(
            loadout,
            &rule.right_slot_key,
            &rule.right_item_key,
        );
        if (rule.rule_kind == RULE_REQUIRE) {
            assert!(!left || right, ERuleViolation);
        } else {
            assert!(!left || !right, ERuleViolation);
        };
        rule_index = rule_index + 1;
    };
}

public(package) fun assert_loadout_ready_v8<PaymentCoin>(
    loadout: &OwnedLoadoutV8,
    registry: &CompositionRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
): (ID, u64, vector<u8>) {
    assert_registry_binding(registry, root);
    assert!(registry.sealed, ERegistryNotSealed);
    assert!(loadout.version == VERSION, EInvalidBinding);
    assert!(loadout.maker_root_id == maker::root_id_v8(root), EInvalidBinding);
    assert!(loadout.ownership_epoch == maker::ownership_epoch_v8(root), ERecoveryRequired);
    assert!(loadout.root_content_commitment == *maker::content_commitment_v8(root), EInvalidBinding);
    assert!(loadout.composition_registry_id == object::id(registry), EInvalidBinding);
    assert!(!loadout.recovering, ERecoveryActive);
    assert_loadout_rules_v8(loadout, registry);
    (object::id(loadout), loadout.revision, loadout.loadout_commitment)
}

/// Starts fail-closed recovery only after the Root ownership epoch changes.
public fun begin_stale_loadout_recovery_v8<PaymentCoin>(
    loadout: &mut OwnedLoadoutV8,
    root: &MakerRootV8<PaymentCoin>,
    expected_revision: u64,
    ctx: &TxContext,
) {
    assert_holder(loadout, ctx);
    assert!(loadout.revision == expected_revision, EStaleRevision);
    assert!(!loadout.recovering, ERecoveryActive);
    assert_root_identity_without_epoch(loadout, root);
    assert!(loadout.ownership_epoch != maker::ownership_epoch_v8(root), ECurrentEpoch);
    loadout.recovering = true;
    loadout.revision = loadout.revision + 1;
}

/// Removes the last selected slot atomically. Recovery never preserves stale
/// selections across a Root ownership epoch.
public fun recover_last_loadout_slot_v8(
    loadout: &mut OwnedLoadoutV8,
    expected_revision: u64,
    ctx: &TxContext,
) {
    assert_holder(loadout, ctx);
    assert!(loadout.recovering, ERecoveryNotActive);
    assert!(loadout.revision == expected_revision, EStaleRevision);
    assert!(!loadout.selected_slot_keys.is_empty(), ERecoveryNotEmpty);
    let slot_key = loadout.selected_slot_keys.pop_back();
    let selections = loadout.selections_by_slot.remove(SlotKeyV8 { slot_key });
    let removed = selections.length();
    loadout.selection_count = loadout.selection_count - removed;
    mutate_loadout_commitment(loadout, 2, slot_key, b"*".to_string());
    loadout.revision = loadout.revision + 1;
}

public fun finish_stale_loadout_recovery_v8<PaymentCoin>(
    loadout: &mut OwnedLoadoutV8,
    root: &MakerRootV8<PaymentCoin>,
    expected_revision: u64,
    ctx: &TxContext,
) {
    assert_holder(loadout, ctx);
    assert!(loadout.recovering, ERecoveryNotActive);
    assert!(loadout.revision == expected_revision, EStaleRevision);
    assert_root_identity_without_epoch(loadout, root);
    assert!(loadout.selection_count == 0, ERecoveryNotEmpty);
    assert!(loadout.selected_slot_keys.is_empty(), ERecoveryNotEmpty);
    loadout.ownership_epoch = maker::ownership_epoch_v8(root);
    loadout.recovering = false;
    loadout.revision = loadout.revision + 1;
    loadout.loadout_commitment = empty_loadout_commitment(
        object::id(loadout),
        loadout.maker_root_id,
        loadout.ownership_epoch,
    );
}

public fun registry_id_v8(self: &CompositionRegistryV8): ID { object::id(self) }
public fun registry_root_id_v8(self: &CompositionRegistryV8): ID { self.maker_root_id }
public fun registry_ownership_epoch_v8(self: &CompositionRegistryV8): u64 { self.ownership_epoch }
public fun registry_root_content_commitment_v8(self: &CompositionRegistryV8): &vector<u8> {
    &self.root_content_commitment
}
public fun registry_expected_count_v8(self: &CompositionRegistryV8): u64 { self.expected_count }
public fun registry_observed_count_v8(self: &CompositionRegistryV8): u64 { self.observed_count }
public fun registry_commitment_v8(self: &CompositionRegistryV8): &vector<u8> {
    &self.rolling_commitment
}
public fun registry_sealed_v8(self: &CompositionRegistryV8): bool { self.sealed }
public fun slot_v8(self: &CompositionRegistryV8, slot_key: String): &WardrobeSlotV8 {
    self.slots.borrow(SlotKeyV8 { slot_key })
}
public fun item_v8(
    self: &CompositionRegistryV8,
    slot_key: String,
    item_key: String,
): &CompositionItemV8 {
    self.items.borrow(ItemKeyV8 { slot_key, item_key })
}
public fun loadout_id_v8(self: &OwnedLoadoutV8): ID { object::id(self) }
public fun loadout_holder_v8(self: &OwnedLoadoutV8): address { self.holder }
public fun loadout_revision_v8(self: &OwnedLoadoutV8): u64 { self.revision }
public fun loadout_selection_count_v8(self: &OwnedLoadoutV8): u64 { self.selection_count }
public fun loadout_commitment_v8(self: &OwnedLoadoutV8): &vector<u8> { &self.loadout_commitment }
public fun loadout_recovering_v8(self: &OwnedLoadoutV8): bool { self.recovering }
public fun slot_behavior_v8(self: &WardrobeSlotV8): u8 { self.behavior }
public fun slot_capacity_v8(self: &WardrobeSlotV8): u64 { self.capacity }
public fun slot_required_v8(self: &WardrobeSlotV8): bool { self.required }

fun assert_write<PaymentCoin>(
    registry: &CompositionRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    sequence: u64,
) {
    maker::assert_draft_admin_v8(root, admin);
    assert_registry_binding(registry, root);
    assert!(!registry.sealed, ERegistrySealed);
    assert!(sequence == registry.observed_count, EInvalidSequence);
}

fun assert_registry_binding<PaymentCoin>(
    registry: &CompositionRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
) {
    assert!(registry.version == VERSION, EInvalidBinding);
    assert!(registry.maker_root_id == maker::root_id_v8(root), EInvalidBinding);
    assert!(registry.ownership_epoch == maker::ownership_epoch_v8(root), EInvalidBinding);
    assert!(registry.root_content_commitment == *maker::content_commitment_v8(root), EInvalidBinding);
}

fun assert_loadout_mutable<PaymentCoin>(
    loadout: &OwnedLoadoutV8,
    registry: &CompositionRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    expected_revision: u64,
    ctx: &TxContext,
) {
    maker::assert_active_root_v8(root);
    assert_holder(loadout, ctx);
    assert!(loadout.revision == expected_revision, EStaleRevision);
    assert!(!loadout.recovering, ERecoveryActive);
    assert_registry_binding(registry, root);
    assert!(registry.sealed, ERegistryNotSealed);
    assert!(loadout.maker_root_id == registry.maker_root_id, EInvalidBinding);
    assert!(loadout.ownership_epoch == registry.ownership_epoch, ERecoveryRequired);
    assert!(loadout.root_content_commitment == registry.root_content_commitment, EInvalidBinding);
    assert!(loadout.composition_registry_id == object::id(registry), EInvalidBinding);
}

fun assert_holder(loadout: &OwnedLoadoutV8, ctx: &TxContext) {
    assert!(loadout.holder == ctx.sender(), ENotHolder);
}

fun assert_root_identity_without_epoch<PaymentCoin>(
    loadout: &OwnedLoadoutV8,
    root: &MakerRootV8<PaymentCoin>,
) {
    assert!(loadout.maker_root_id == maker::root_id_v8(root), EInvalidBinding);
    assert!(loadout.root_content_commitment == *maker::content_commitment_v8(root), EInvalidBinding);
}

fun empty_loadout_commitment(
    loadout_id: ID,
    maker_root_id: ID,
    ownership_epoch: u64,
): vector<u8> {
    hash::sha2_256(bcs::to_bytes(&LoadoutMutationHashInputV8 {
        domain: b"animacraft.v8/loadout/empty",
        version: VERSION,
        loadout_id,
        maker_root_id,
        ownership_epoch,
        revision: 0,
        prior_commitment: vector[],
        operation: 255,
        slot_key: b"*".to_string(),
        item_key: b"*".to_string(),
    }))
}

fun mutate_loadout_commitment(
    loadout: &mut OwnedLoadoutV8,
    operation: u8,
    slot_key: String,
    item_key: String,
) {
    loadout.loadout_commitment = hash::sha2_256(bcs::to_bytes(&LoadoutMutationHashInputV8 {
        domain: b"animacraft.v8/loadout/mutation",
        version: VERSION,
        loadout_id: object::id(loadout),
        maker_root_id: loadout.maker_root_id,
        ownership_epoch: loadout.ownership_epoch,
        revision: loadout.revision,
        prior_commitment: loadout.loadout_commitment,
        operation,
        slot_key,
        item_key,
    }));
}

fun loadout_contains(loadout: &OwnedLoadoutV8, slot_key: &String, item_key: &String): bool {
    let key = SlotKeyV8 { slot_key: *slot_key };
    loadout.selections_by_slot.contains(key)
        && string_vector_contains(loadout.selections_by_slot.borrow(key), item_key)
}

fun string_vector_contains(values: &vector<String>, value: &String): bool {
    let mut index = 0;
    while (index < values.length()) {
        if (values.borrow(index) == value) return true;
        index = index + 1;
    };
    false
}

fun string_vector_index(values: &vector<String>, value: &String): u64 {
    let mut index = 0;
    while (index < values.length()) {
        if (values.borrow(index) == value) return index;
        index = index + 1;
    };
    abort ESelectionMissing
}

fun remove_string(values: &mut vector<String>, value: &String) {
    let index = string_vector_index(values, value);
    values.remove(index);
}

fun assert_identifier(value: &String) {
    assert!(value.length() > 0 && value.length() <= MAX_IDENTIFIER_BYTES, EInvalidIdentifier);
}

fun assert_digest(value: &vector<u8>) {
    assert!(value.length() == HASH_LENGTH, EInvalidCommitment);
}
