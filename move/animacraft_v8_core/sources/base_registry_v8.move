/// Immutable base Maker definitions. Pack Releases are intentionally not
/// rows in this registry and are never counted by its commitments.
module animacraft_v8_core::base_registry_v8;

use animacraft_v8_core::maker_v8::{
    Self as maker,
    MakerAdminCapV8,
    MakerRootV8,
};
#[test_only]
use animacraft_v8_core::protocol_config_v8 as protocol;
use std::bcs;
use std::hash;
use std::option::{Self as option, Option};
use std::string::{Self as string, String};
use sui::dynamic_field as df;
use sui::event;

const VERSION: u64 = 8;
const HASH_LENGTH: u64 = 32;

const CATEGORY_TRACK: u8 = 0;
const CATEGORY_PART: u8 = 1;
const CATEGORY_ITEM: u8 = 2;
const CATEGORY_STYLE: u8 = 3;
const CATEGORY_COLOR: u8 = 4;
const CATEGORY_RULE: u8 = 5;
const CATEGORY_AGGREGATE: u8 = 255;

const MAX_TRACKS: u64 = 256;
const MAX_PARTS: u64 = 750;
const MAX_ITEMS: u64 = 5_000;
const MAX_STYLES: u64 = 10_000;
const MAX_COLORS: u64 = 5_000;
const MAX_RULES: u64 = 1_000;
const MAX_KEY_BYTES: u64 = 128;
const MAX_LABEL_BYTES: u64 = 256;
const MAX_BLOB_ID_BYTES: u64 = 512;

const EInvalidLifecycle: u64 = 0;
const EInvalidDigest: u64 = 1;
const EInvalidString: u64 = 2;
const EInvalidCounts: u64 = 3;
const EWrongSequence: u64 = 4;
const EDuplicateRow: u64 = 5;
const EMissingParentRow: u64 = 6;
const ECommitmentMismatch: u64 = 7;
const ECountMismatch: u64 = 8;
const EInvalidCategory: u64 = 9;
const ERegistryMismatch: u64 = 10;

public struct BaseDefinitionCountsV8 has copy, drop, store {
    tracks: u64,
    parts: u64,
    items: u64,
    styles: u64,
    colors: u64,
    rules: u64,
}

public struct BaseDefinitionCommitmentsV8 has copy, drop, store {
    tracks: vector<u8>,
    parts: vector<u8>,
    items: vector<u8>,
    styles: vector<u8>,
    colors: vector<u8>,
    rules: vector<u8>,
    aggregate: vector<u8>,
}

public struct BaseDefinitionRegistryV8 has key {
    id: UID,
    version: u64,
    root_id: ID,
    maker_version: u64,
    root_content_commitment: vector<u8>,
    expected_counts: BaseDefinitionCountsV8,
    observed_counts: BaseDefinitionCountsV8,
    expected_commitments: BaseDefinitionCommitmentsV8,
    rolling_commitments: BaseDefinitionCommitmentsV8,
    next_sequence: u64,
    expected_sequence_count: u64,
    protected_style_count: u64,
    sealed: bool,
}

public struct TrackKeyV8 has copy, drop, store { key: String }
public struct PartKeyV8 has copy, drop, store { key: String }
public struct ItemKeyV8 has copy, drop, store { part_key: String, item_key: String }
public struct StyleKeyV8 has copy, drop, store {
    part_key: String,
    item_key: String,
    style_key: String,
}
public struct StyleIndexKeyV8 has copy, drop, store { index: u64 }
public struct ProtectedStyleIndexKeyV8 has copy, drop, store { index: u64 }
public struct ColorKeyV8 has copy, drop, store {
    channel_key: String,
    swatch_key: String,
}
public struct RuleKeyV8 has copy, drop, store { key: String }

public struct TrackRowV8 has copy, drop, store {
    sequence: u64,
    key: String,
    label: String,
    render_order: u64,
    payload_commitment: vector<u8>,
}

public struct PartRowV8 has copy, drop, store {
    sequence: u64,
    key: String,
    label: String,
    kind: u8,
    render_order: u64,
    required: bool,
    visible: bool,
    payload_commitment: vector<u8>,
}

public struct ItemRowV8 has copy, drop, store {
    sequence: u64,
    part_key: String,
    item_key: String,
    label: String,
    gate_kind: u8,
    payload_commitment: vector<u8>,
}

public struct StyleRowV8 has copy, drop, store {
    sequence: u64,
    part_key: String,
    item_key: String,
    style_key: String,
    layer_track_key: String,
    color_channel_key: Option<String>,
    default_swatch_key: Option<String>,
    label: String,
    asset_blob_id: String,
    asset_sha256: vector<u8>,
    protected: bool,
    payload_commitment: vector<u8>,
}

public struct ColorRowV8 has copy, drop, store {
    sequence: u64,
    channel_key: String,
    swatch_key: String,
    label: String,
    rgba: u32,
    payload_commitment: vector<u8>,
}

public struct RuleRowV8 has copy, drop, store {
    sequence: u64,
    key: String,
    kind: u8,
    left_ref: String,
    right_ref: String,
    payload_commitment: vector<u8>,
}

public struct RollingCommitmentInputV8 has drop {
    domain: vector<u8>,
    version: u64,
    root_content_commitment: vector<u8>,
    category: u8,
    previous: vector<u8>,
    sequence: u64,
    row_bytes: vector<u8>,
}

public struct BaseDefinitionRegistrySealedV8 has copy, drop {
    root_id: ID,
    registry_id: ID,
    definition_count: u64,
    protected_style_count: u64,
    aggregate_commitment: vector<u8>,
}

public fun version_v8(): u64 { VERSION }
public fun category_track_v8(): u8 { CATEGORY_TRACK }
public fun category_part_v8(): u8 { CATEGORY_PART }
public fun category_item_v8(): u8 { CATEGORY_ITEM }
public fun category_style_v8(): u8 { CATEGORY_STYLE }
public fun category_color_v8(): u8 { CATEGORY_COLOR }
public fun category_rule_v8(): u8 { CATEGORY_RULE }

public fun new_base_definition_counts_v8(
    tracks: u64,
    parts: u64,
    items: u64,
    styles: u64,
    colors: u64,
    rules: u64,
): BaseDefinitionCountsV8 {
    let counts = BaseDefinitionCountsV8 {
        tracks,
        parts,
        items,
        styles,
        colors,
        rules,
    };
    assert_valid_counts(&counts);
    counts
}

public fun new_base_definition_commitments_v8(
    tracks: vector<u8>,
    parts: vector<u8>,
    items: vector<u8>,
    styles: vector<u8>,
    colors: vector<u8>,
    rules: vector<u8>,
    aggregate: vector<u8>,
): BaseDefinitionCommitmentsV8 {
    let commitments = BaseDefinitionCommitmentsV8 {
        tracks,
        parts,
        items,
        styles,
        colors,
        rules,
        aggregate,
    };
    assert_commitments(&commitments);
    commitments
}

/// Canonical compiler primitive for an empty category in one immutable Root.
public fun empty_category_commitment_v8(
    root_content_commitment: vector<u8>,
    category: u8,
): vector<u8> {
    assert_hash(&root_content_commitment);
    assert_valid_category(category);
    hash::sha2_256(bcs::to_bytes(&RollingCommitmentInputV8 {
        domain: b"animacraft-v8/base-empty",
        version: VERSION,
        root_content_commitment,
        category,
        previous: vector[],
        sequence: 0,
        row_bytes: vector[],
    }))
}

/// Canonical compiler primitive for one ordered base-definition append.
public fun advance_commitment_v8(
    root_content_commitment: vector<u8>,
    category: u8,
    previous: vector<u8>,
    sequence: u64,
    row_bytes: vector<u8>,
): vector<u8> {
    assert_hash(&root_content_commitment);
    assert_hash(&previous);
    assert_valid_category(category);
    assert!(row_bytes.length() > 0, EInvalidDigest);
    hash::sha2_256(bcs::to_bytes(&RollingCommitmentInputV8 {
        domain: b"animacraft-v8/base-append",
        version: VERSION,
        root_content_commitment,
        category,
        previous,
        sequence,
        row_bytes,
    }))
}

public(package) fun new_base_definition_registry_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    expected_counts: BaseDefinitionCountsV8,
    expected_commitments: BaseDefinitionCommitmentsV8,
    ctx: &mut TxContext,
): BaseDefinitionRegistryV8 {
    maker::assert_draft_admin_v8(root, admin);
    assert_valid_counts(&expected_counts);
    assert_commitments(&expected_commitments);
    let root_id = maker::root_id_v8(root);
    let maker_version = maker::root_maker_version_v8(root);
    let root_content_commitment = *maker::root_content_commitment_v8(root);
    let expected_sequence_count = total_count_v8(&expected_counts);
    maker::assert_root_identity_v8(
        root,
        root_id,
        maker_version,
        &root_content_commitment,
    );
    assert!(
        maker::root_expected_base_definition_count_v8(root)
            == expected_sequence_count,
        ECountMismatch,
    );
    assert!(
        maker::root_expected_base_registry_commitment_v8(root)
            == &expected_commitments.aggregate,
        ECommitmentMismatch,
    );
    let registry_uid = object::new(ctx);
    BaseDefinitionRegistryV8 {
        id: registry_uid,
        version: VERSION,
        root_id,
        maker_version,
        root_content_commitment,
        expected_counts,
        observed_counts: zero_counts(),
        expected_commitments,
        rolling_commitments: empty_commitments(root_content_commitment),
        next_sequence: 0,
        expected_sequence_count,
        protected_style_count: 0,
        sealed: false,
    }
}

public fun append_track_v8<PaymentCoin>(
    registry: &mut BaseDefinitionRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    sequence: u64,
    key: String,
    label: String,
    render_order: u64,
    payload_commitment: vector<u8>,
) {
    assert_writable(registry, root, admin);
    assert_category_sequence(registry, CATEGORY_TRACK, sequence);
    assert_non_empty_bounded(&key, MAX_KEY_BYTES);
    assert_non_empty_bounded(&label, MAX_LABEL_BYTES);
    assert_hash(&payload_commitment);
    let field_key = TrackKeyV8 { key };
    assert!(!df::exists(&registry.id, field_key), EDuplicateRow);
    let row = TrackRowV8 {
        sequence,
        key,
        label,
        render_order,
        payload_commitment,
    };
    let row_bytes = bcs::to_bytes(&row);
    df::add(&mut registry.id, field_key, row);
    registry.observed_counts.tracks = registry.observed_counts.tracks + 1;
    advance_registry(registry, CATEGORY_TRACK, sequence, row_bytes);
}

public fun append_part_v8<PaymentCoin>(
    registry: &mut BaseDefinitionRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    sequence: u64,
    key: String,
    label: String,
    kind: u8,
    render_order: u64,
    required: bool,
    visible: bool,
    payload_commitment: vector<u8>,
) {
    assert_writable(registry, root, admin);
    assert_category_sequence(registry, CATEGORY_PART, sequence);
    assert_non_empty_bounded(&key, MAX_KEY_BYTES);
    assert_non_empty_bounded(&label, MAX_LABEL_BYTES);
    assert_hash(&payload_commitment);
    let field_key = PartKeyV8 { key };
    assert!(!df::exists(&registry.id, field_key), EDuplicateRow);
    let row = PartRowV8 {
        sequence,
        key,
        label,
        kind,
        render_order,
        required,
        visible,
        payload_commitment,
    };
    let row_bytes = bcs::to_bytes(&row);
    df::add(&mut registry.id, field_key, row);
    registry.observed_counts.parts = registry.observed_counts.parts + 1;
    advance_registry(registry, CATEGORY_PART, sequence, row_bytes);
}

public fun append_item_v8<PaymentCoin>(
    registry: &mut BaseDefinitionRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    sequence: u64,
    part_key: String,
    item_key: String,
    label: String,
    gate_kind: u8,
    payload_commitment: vector<u8>,
) {
    assert_writable(registry, root, admin);
    assert_category_sequence(registry, CATEGORY_ITEM, sequence);
    assert_non_empty_bounded(&part_key, MAX_KEY_BYTES);
    assert_non_empty_bounded(&item_key, MAX_KEY_BYTES);
    assert_non_empty_bounded(&label, MAX_LABEL_BYTES);
    assert_hash(&payload_commitment);
    assert!(
        df::exists(&registry.id, PartKeyV8 { key: part_key }),
        EMissingParentRow,
    );
    let field_key = ItemKeyV8 { part_key, item_key };
    assert!(!df::exists(&registry.id, field_key), EDuplicateRow);
    let row = ItemRowV8 {
        sequence,
        part_key,
        item_key,
        label,
        gate_kind,
        payload_commitment,
    };
    let row_bytes = bcs::to_bytes(&row);
    df::add(&mut registry.id, field_key, row);
    registry.observed_counts.items = registry.observed_counts.items + 1;
    advance_registry(registry, CATEGORY_ITEM, sequence, row_bytes);
}

public fun append_style_v8<PaymentCoin>(
    registry: &mut BaseDefinitionRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    sequence: u64,
    part_key: String,
    item_key: String,
    style_key: String,
    layer_track_key: String,
    color_channel_key: Option<String>,
    default_swatch_key: Option<String>,
    label: String,
    asset_blob_id: String,
    asset_sha256: vector<u8>,
    protected: bool,
    payload_commitment: vector<u8>,
) {
    assert_writable(registry, root, admin);
    assert_category_sequence(registry, CATEGORY_STYLE, sequence);
    assert_non_empty_bounded(&part_key, MAX_KEY_BYTES);
    assert_non_empty_bounded(&item_key, MAX_KEY_BYTES);
    assert_non_empty_bounded(&style_key, MAX_KEY_BYTES);
    assert_non_empty_bounded(&layer_track_key, MAX_KEY_BYTES);
    assert!(
        color_channel_key.is_some() == default_swatch_key.is_some(),
        EMissingParentRow,
    );
    if (color_channel_key.is_some()) {
        assert_non_empty_bounded(color_channel_key.borrow(), MAX_KEY_BYTES);
        assert_non_empty_bounded(default_swatch_key.borrow(), MAX_KEY_BYTES);
    };
    assert_non_empty_bounded(&label, MAX_LABEL_BYTES);
    assert_non_empty_bounded(&asset_blob_id, MAX_BLOB_ID_BYTES);
    assert_hash(&asset_sha256);
    assert_hash(&payload_commitment);
    assert!(
        df::exists(&registry.id, ItemKeyV8 { part_key, item_key }),
        EMissingParentRow,
    );
    assert!(
        df::exists(&registry.id, TrackKeyV8 { key: layer_track_key }),
        EMissingParentRow,
    );
    let field_key = StyleKeyV8 { part_key, item_key, style_key };
    assert!(!df::exists(&registry.id, field_key), EDuplicateRow);
    let row = StyleRowV8 {
        sequence,
        part_key,
        item_key,
        style_key,
        layer_track_key,
        color_channel_key,
        default_swatch_key,
        label,
        asset_blob_id,
        asset_sha256,
        protected,
        payload_commitment,
    };
    let row_bytes = bcs::to_bytes(&row);
    df::add(&mut registry.id, field_key, row);
    df::add(
        &mut registry.id,
        StyleIndexKeyV8 { index: registry.observed_counts.styles },
        field_key,
    );
    registry.observed_counts.styles = registry.observed_counts.styles + 1;
    if (protected) {
        df::add(
            &mut registry.id,
            ProtectedStyleIndexKeyV8 { index: registry.protected_style_count },
            field_key,
        );
        registry.protected_style_count = registry.protected_style_count + 1;
    };
    advance_registry(registry, CATEGORY_STYLE, sequence, row_bytes);
}

public fun append_color_v8<PaymentCoin>(
    registry: &mut BaseDefinitionRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    sequence: u64,
    channel_key: String,
    swatch_key: String,
    label: String,
    rgba: u32,
    payload_commitment: vector<u8>,
) {
    assert_writable(registry, root, admin);
    assert_category_sequence(registry, CATEGORY_COLOR, sequence);
    assert_non_empty_bounded(&channel_key, MAX_KEY_BYTES);
    assert_non_empty_bounded(&swatch_key, MAX_KEY_BYTES);
    assert_non_empty_bounded(&label, MAX_LABEL_BYTES);
    assert_hash(&payload_commitment);
    let field_key = ColorKeyV8 { channel_key, swatch_key };
    assert!(!df::exists(&registry.id, field_key), EDuplicateRow);
    let row = ColorRowV8 {
        sequence,
        channel_key,
        swatch_key,
        label,
        rgba,
        payload_commitment,
    };
    let row_bytes = bcs::to_bytes(&row);
    df::add(&mut registry.id, field_key, row);
    registry.observed_counts.colors = registry.observed_counts.colors + 1;
    advance_registry(registry, CATEGORY_COLOR, sequence, row_bytes);
}

public fun append_rule_v8<PaymentCoin>(
    registry: &mut BaseDefinitionRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    sequence: u64,
    key: String,
    kind: u8,
    left_ref: String,
    right_ref: String,
    payload_commitment: vector<u8>,
) {
    assert_writable(registry, root, admin);
    assert_category_sequence(registry, CATEGORY_RULE, sequence);
    assert_non_empty_bounded(&key, MAX_KEY_BYTES);
    assert_non_empty_bounded(&left_ref, MAX_BLOB_ID_BYTES);
    assert_non_empty_bounded(&right_ref, MAX_BLOB_ID_BYTES);
    assert_hash(&payload_commitment);
    let field_key = RuleKeyV8 { key };
    assert!(!df::exists(&registry.id, field_key), EDuplicateRow);
    let row = RuleRowV8 {
        sequence,
        key,
        kind,
        left_ref,
        right_ref,
        payload_commitment,
    };
    let row_bytes = bcs::to_bytes(&row);
    df::add(&mut registry.id, field_key, row);
    registry.observed_counts.rules = registry.observed_counts.rules + 1;
    advance_registry(registry, CATEGORY_RULE, sequence, row_bytes);
}

public fun seal_base_definition_registry_v8<PaymentCoin>(
    registry: &mut BaseDefinitionRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
) {
    assert_writable(registry, root, admin);
    assert!(
        registry.next_sequence == registry.expected_sequence_count,
        ECountMismatch,
    );
    assert_counts_equal(&registry.observed_counts, &registry.expected_counts);
    assert_commitments_equal(
        &registry.rolling_commitments,
        &registry.expected_commitments,
    );
    assert_style_color_references(registry);
    registry.sealed = true;
    event::emit(BaseDefinitionRegistrySealedV8 {
        root_id: registry.root_id,
        registry_id: object::id(registry),
        definition_count: registry.expected_sequence_count,
        protected_style_count: registry.protected_style_count,
        aggregate_commitment: registry.rolling_commitments.aggregate,
    });
}

/// Core-side readiness consumed later by the Release orchestrator. It proves
/// only base definitions; it says nothing about companion runtime behavior.
public fun assert_activation_ready_v8<PaymentCoin>(
    registry: &BaseDefinitionRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
): (ID, vector<u8>, u64) {
    maker::assert_draft_v8(root);
    assert_registry_identity(registry, root);
    assert!(registry.sealed, EInvalidLifecycle);
    assert!(
        registry.next_sequence == registry.expected_sequence_count,
        ECountMismatch,
    );
    assert_counts_equal(&registry.observed_counts, &registry.expected_counts);
    assert_commitments_equal(
        &registry.rolling_commitments,
        &registry.expected_commitments,
    );
    (
        object::id(registry),
        registry.rolling_commitments.aggregate,
        registry.protected_style_count,
    )
}

public fun assert_draft_registry_identity_v8<PaymentCoin>(
    registry: &BaseDefinitionRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
) {
    maker::assert_draft_admin_v8(root, admin);
    assert_registry_identity(registry, root);
}

public(package) fun share_base_definition_registry_v8(
    registry: BaseDefinitionRegistryV8,
) {
    transfer::share_object(registry);
}

#[test_only]
public fun share_base_definition_registry_for_testing(
    registry: BaseDefinitionRegistryV8,
) {
    share_base_definition_registry_v8(registry)
}

fun assert_writable<PaymentCoin>(
    registry: &BaseDefinitionRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
) {
    maker::assert_draft_admin_v8(root, admin);
    assert_registry_identity(registry, root);
    assert!(!registry.sealed, EInvalidLifecycle);
}

fun assert_registry_identity<PaymentCoin>(
    registry: &BaseDefinitionRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
) {
    assert!(registry.version == VERSION, ERegistryMismatch);
    maker::assert_base_registry_identity_v8(
        root,
        object::id(registry),
        registry.root_id,
        registry.maker_version,
        &registry.root_content_commitment,
    );
    assert!(
        registry.expected_sequence_count
            == maker::root_expected_base_definition_count_v8(root),
        ECountMismatch,
    );
    assert!(
        &registry.expected_commitments.aggregate
            == maker::root_expected_base_registry_commitment_v8(root),
        ECommitmentMismatch,
    );
}

fun assert_category_sequence(
    registry: &BaseDefinitionRegistryV8,
    category: u8,
    sequence: u64,
) {
    assert!(sequence == registry.next_sequence, EWrongSequence);
    let (start, count) = category_range(&registry.expected_counts, category);
    assert!(sequence >= start && sequence < start + count, EWrongSequence);
}

fun category_range(counts: &BaseDefinitionCountsV8, category: u8): (u64, u64) {
    if (category == CATEGORY_TRACK) return (0, counts.tracks);
    if (category == CATEGORY_PART) return (counts.tracks, counts.parts);
    if (category == CATEGORY_ITEM) return (counts.tracks + counts.parts, counts.items);
    if (category == CATEGORY_STYLE) return (
        counts.tracks + counts.parts + counts.items,
        counts.styles,
    );
    if (category == CATEGORY_COLOR) return (
        counts.tracks + counts.parts + counts.items + counts.styles,
        counts.colors,
    );
    if (category == CATEGORY_RULE) return (
        counts.tracks + counts.parts + counts.items + counts.styles + counts.colors,
        counts.rules,
    );
    abort EInvalidCategory
}

fun advance_registry(
    registry: &mut BaseDefinitionRegistryV8,
    category: u8,
    sequence: u64,
    row_bytes: vector<u8>,
) {
    if (category == CATEGORY_TRACK) {
        registry.rolling_commitments.tracks = advance_commitment_v8(
            registry.root_content_commitment,
            category,
            registry.rolling_commitments.tracks,
            sequence,
            row_bytes,
        );
    } else if (category == CATEGORY_PART) {
        registry.rolling_commitments.parts = advance_commitment_v8(
            registry.root_content_commitment,
            category,
            registry.rolling_commitments.parts,
            sequence,
            row_bytes,
        );
    } else if (category == CATEGORY_ITEM) {
        registry.rolling_commitments.items = advance_commitment_v8(
            registry.root_content_commitment,
            category,
            registry.rolling_commitments.items,
            sequence,
            row_bytes,
        );
    } else if (category == CATEGORY_STYLE) {
        registry.rolling_commitments.styles = advance_commitment_v8(
            registry.root_content_commitment,
            category,
            registry.rolling_commitments.styles,
            sequence,
            row_bytes,
        );
    } else if (category == CATEGORY_COLOR) {
        registry.rolling_commitments.colors = advance_commitment_v8(
            registry.root_content_commitment,
            category,
            registry.rolling_commitments.colors,
            sequence,
            row_bytes,
        );
    } else if (category == CATEGORY_RULE) {
        registry.rolling_commitments.rules = advance_commitment_v8(
            registry.root_content_commitment,
            category,
            registry.rolling_commitments.rules,
            sequence,
            row_bytes,
        );
    } else {
        abort EInvalidCategory
    };
    registry.rolling_commitments.aggregate = advance_commitment_v8(
        registry.root_content_commitment,
        CATEGORY_AGGREGATE,
        registry.rolling_commitments.aggregate,
        sequence,
        row_bytes,
    );
    registry.next_sequence = registry.next_sequence + 1;
}

fun assert_style_color_references(registry: &BaseDefinitionRegistryV8) {
    let mut index = 0;
    while (index < registry.observed_counts.styles) {
        let style_key: &StyleKeyV8 = df::borrow(
            &registry.id,
            StyleIndexKeyV8 { index },
        );
        let style: &StyleRowV8 = df::borrow(&registry.id, *style_key);
        if (style.color_channel_key.is_some()) {
            assert!(
                df::exists(
                    &registry.id,
                    ColorKeyV8 {
                        channel_key: *style.color_channel_key.borrow(),
                        swatch_key: *style.default_swatch_key.borrow(),
                    },
                ),
                EMissingParentRow,
            );
        };
        index = index + 1;
    };
}

fun assert_valid_counts(counts: &BaseDefinitionCountsV8) {
    assert!(counts.tracks > 0 && counts.tracks <= MAX_TRACKS, EInvalidCounts);
    assert!(counts.parts > 0 && counts.parts <= MAX_PARTS, EInvalidCounts);
    assert!(counts.items > 0 && counts.items <= MAX_ITEMS, EInvalidCounts);
    assert!(counts.styles > 0 && counts.styles <= MAX_STYLES, EInvalidCounts);
    assert!(counts.colors <= MAX_COLORS, EInvalidCounts);
    assert!(counts.rules <= MAX_RULES, EInvalidCounts);
}

fun assert_commitments(commitments: &BaseDefinitionCommitmentsV8) {
    assert_hash(&commitments.tracks);
    assert_hash(&commitments.parts);
    assert_hash(&commitments.items);
    assert_hash(&commitments.styles);
    assert_hash(&commitments.colors);
    assert_hash(&commitments.rules);
    assert_hash(&commitments.aggregate);
}

fun assert_counts_equal(
    actual: &BaseDefinitionCountsV8,
    expected: &BaseDefinitionCountsV8,
) {
    assert!(actual.tracks == expected.tracks, ECountMismatch);
    assert!(actual.parts == expected.parts, ECountMismatch);
    assert!(actual.items == expected.items, ECountMismatch);
    assert!(actual.styles == expected.styles, ECountMismatch);
    assert!(actual.colors == expected.colors, ECountMismatch);
    assert!(actual.rules == expected.rules, ECountMismatch);
}

fun assert_commitments_equal(
    actual: &BaseDefinitionCommitmentsV8,
    expected: &BaseDefinitionCommitmentsV8,
) {
    assert!(&actual.tracks == &expected.tracks, ECommitmentMismatch);
    assert!(&actual.parts == &expected.parts, ECommitmentMismatch);
    assert!(&actual.items == &expected.items, ECommitmentMismatch);
    assert!(&actual.styles == &expected.styles, ECommitmentMismatch);
    assert!(&actual.colors == &expected.colors, ECommitmentMismatch);
    assert!(&actual.rules == &expected.rules, ECommitmentMismatch);
    assert!(&actual.aggregate == &expected.aggregate, ECommitmentMismatch);
}

fun assert_hash(value: &vector<u8>) {
    assert!(value.length() == HASH_LENGTH, EInvalidDigest);
}

fun assert_non_empty_bounded(value: &String, max: u64) {
    let length = string::as_bytes(value).length();
    assert!(length > 0 && length <= max, EInvalidString);
}

fun assert_valid_category(category: u8) {
    assert!(
        category == CATEGORY_TRACK
            || category == CATEGORY_PART
            || category == CATEGORY_ITEM
            || category == CATEGORY_STYLE
            || category == CATEGORY_COLOR
            || category == CATEGORY_RULE
            || category == CATEGORY_AGGREGATE,
        EInvalidCategory,
    );
}

fun zero_counts(): BaseDefinitionCountsV8 {
    BaseDefinitionCountsV8 {
        tracks: 0,
        parts: 0,
        items: 0,
        styles: 0,
        colors: 0,
        rules: 0,
    }
}

fun empty_commitments(
    root_content_commitment: vector<u8>,
): BaseDefinitionCommitmentsV8 {
    BaseDefinitionCommitmentsV8 {
        tracks: empty_category_commitment_v8(root_content_commitment, CATEGORY_TRACK),
        parts: empty_category_commitment_v8(root_content_commitment, CATEGORY_PART),
        items: empty_category_commitment_v8(root_content_commitment, CATEGORY_ITEM),
        styles: empty_category_commitment_v8(root_content_commitment, CATEGORY_STYLE),
        colors: empty_category_commitment_v8(root_content_commitment, CATEGORY_COLOR),
        rules: empty_category_commitment_v8(root_content_commitment, CATEGORY_RULE),
        aggregate: empty_category_commitment_v8(
            root_content_commitment,
            CATEGORY_AGGREGATE,
        ),
    }
}

public fun total_count_v8(counts: &BaseDefinitionCountsV8): u64 {
    counts.tracks + counts.parts + counts.items + counts.styles + counts.colors + counts.rules
}
public fun aggregate_commitment_v8(
    commitments: &BaseDefinitionCommitmentsV8,
): &vector<u8> { &commitments.aggregate }
public fun registry_id_v8(registry: &BaseDefinitionRegistryV8): ID {
    object::id(registry)
}
public fun registry_root_id_v8(registry: &BaseDefinitionRegistryV8): ID {
    registry.root_id
}
public fun registry_maker_version_v8(registry: &BaseDefinitionRegistryV8): u64 {
    registry.maker_version
}
public fun registry_root_content_commitment_v8(
    registry: &BaseDefinitionRegistryV8,
): &vector<u8> { &registry.root_content_commitment }
public fun registry_next_sequence_v8(registry: &BaseDefinitionRegistryV8): u64 {
    registry.next_sequence
}
public fun registry_track_count_v8(registry: &BaseDefinitionRegistryV8): u64 {
    registry.observed_counts.tracks
}
public fun registry_part_count_v8(registry: &BaseDefinitionRegistryV8): u64 {
    registry.observed_counts.parts
}
public fun registry_sealed_v8(registry: &BaseDefinitionRegistryV8): bool {
    registry.sealed
}
public fun registry_protected_style_count_v8(
    registry: &BaseDefinitionRegistryV8,
): u64 { registry.protected_style_count }

public fun borrow_track_v8(
    registry: &BaseDefinitionRegistryV8,
    key: String,
): &TrackRowV8 { df::borrow(&registry.id, TrackKeyV8 { key }) }
public fun borrow_part_v8(
    registry: &BaseDefinitionRegistryV8,
    key: String,
): &PartRowV8 { df::borrow(&registry.id, PartKeyV8 { key }) }
public fun borrow_item_v8(
    registry: &BaseDefinitionRegistryV8,
    part_key: String,
    item_key: String,
): &ItemRowV8 { df::borrow(&registry.id, ItemKeyV8 { part_key, item_key }) }
public fun borrow_style_v8(
    registry: &BaseDefinitionRegistryV8,
    part_key: String,
    item_key: String,
    style_key: String,
): &StyleRowV8 {
    df::borrow(&registry.id, StyleKeyV8 { part_key, item_key, style_key })
}
public fun borrow_style_key_by_index_v8(
    registry: &BaseDefinitionRegistryV8,
    index: u64,
): &StyleKeyV8 { df::borrow(&registry.id, StyleIndexKeyV8 { index }) }
public fun borrow_protected_style_key_by_index_v8(
    registry: &BaseDefinitionRegistryV8,
    index: u64,
): &StyleKeyV8 {
    df::borrow(&registry.id, ProtectedStyleIndexKeyV8 { index })
}
public fun borrow_color_v8(
    registry: &BaseDefinitionRegistryV8,
    channel_key: String,
    swatch_key: String,
): &ColorRowV8 {
    df::borrow(&registry.id, ColorKeyV8 { channel_key, swatch_key })
}
public fun borrow_rule_v8(
    registry: &BaseDefinitionRegistryV8,
    key: String,
): &RuleRowV8 { df::borrow(&registry.id, RuleKeyV8 { key }) }

// Cross-package runtime and protection registries must bind their own rows to
// the sealed Base definitions, not to caller-supplied copies of those fields.
// These read-only accessors expose only immutable row data; they grant no
// authority to append, replace, or unseal a Base registry.
public fun track_key_v8(row: &TrackRowV8): &String { &row.key }
public fun track_render_order_v8(row: &TrackRowV8): u64 { row.render_order }
public fun track_payload_commitment_v8(row: &TrackRowV8): &vector<u8> {
    &row.payload_commitment
}

public fun part_key_v8(row: &PartRowV8): &String { &row.key }
public fun part_sequence_v8(row: &PartRowV8): u64 { row.sequence }
public fun part_kind_v8(row: &PartRowV8): u8 { row.kind }
public fun part_render_order_v8(row: &PartRowV8): u64 { row.render_order }
public fun part_required_v8(row: &PartRowV8): bool { row.required }
public fun part_visible_v8(row: &PartRowV8): bool { row.visible }
public fun part_payload_commitment_v8(row: &PartRowV8): &vector<u8> {
    &row.payload_commitment
}

public fun item_part_key_v8(row: &ItemRowV8): &String { &row.part_key }
public fun item_key_v8(row: &ItemRowV8): &String { &row.item_key }
public fun item_gate_kind_v8(row: &ItemRowV8): u8 { row.gate_kind }
public fun item_payload_commitment_v8(row: &ItemRowV8): &vector<u8> {
    &row.payload_commitment
}

public fun style_part_key_v8(row: &StyleRowV8): &String { &row.part_key }
public fun style_item_key_v8(row: &StyleRowV8): &String { &row.item_key }
public fun style_key_v8(row: &StyleRowV8): &String { &row.style_key }
public fun style_layer_track_key_v8(row: &StyleRowV8): &String {
    &row.layer_track_key
}
public fun style_color_channel_key_v8(row: &StyleRowV8): &Option<String> {
    &row.color_channel_key
}
public fun style_default_swatch_key_v8(row: &StyleRowV8): &Option<String> {
    &row.default_swatch_key
}
public fun style_asset_blob_id_v8(row: &StyleRowV8): &String {
    &row.asset_blob_id
}
public fun style_asset_sha256_v8(row: &StyleRowV8): &vector<u8> {
    &row.asset_sha256
}
public fun style_protected_v8(row: &StyleRowV8): bool { row.protected }
public fun style_payload_commitment_v8(row: &StyleRowV8): &vector<u8> {
    &row.payload_commitment
}

public fun color_channel_key_v8(row: &ColorRowV8): &String { &row.channel_key }
public fun color_swatch_key_v8(row: &ColorRowV8): &String { &row.swatch_key }
public fun color_rgba_v8(row: &ColorRowV8): u32 { row.rgba }
public fun color_payload_commitment_v8(row: &ColorRowV8): &vector<u8> {
    &row.payload_commitment
}

#[test]
fun empty_commitments_are_root_and_category_separated() {
    let root_a = test_hash(1);
    let root_b = test_hash(2);
    let track_a = empty_category_commitment_v8(root_a, CATEGORY_TRACK);
    let part_a = empty_category_commitment_v8(root_a, CATEGORY_PART);
    let track_b = empty_category_commitment_v8(root_b, CATEGORY_TRACK);
    assert!(track_a != part_a, ECommitmentMismatch);
    assert!(track_a != track_b, ECommitmentMismatch);
}

#[test, expected_failure(abort_code = EInvalidCounts)]
fun base_registry_requires_real_creator_structure() {
    new_base_definition_counts_v8(0, 1, 1, 1, 0, 0);
}

#[test, expected_failure(abort_code = EInvalidDigest)]
fun malformed_expected_commitment_is_rejected() {
    new_base_definition_commitments_v8(
        vector[1],
        test_hash(1),
        test_hash(1),
        test_hash(1),
        test_hash(1),
        test_hash(1),
        test_hash(1),
    );
}

#[test]
fun exact_minimal_base_registry_seals() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 201, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (config, protocol_cap) =
        protocol::new_protocol_for_testing<sui::sui::SUI>(true, &mut ctx);
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
    let root_content_commitment = test_hash(5);
    let expected_counts = new_base_definition_counts_v8(1, 1, 1, 1, 0, 0);
    let expected_commitments = minimal_expected_commitments_for_testing(
        root_content_commitment,
    );
    let (mut root, admin) = maker::new_initial_maker_draft_v8<sui::sui::SUI>(
        &config,
        total_count_v8(&expected_counts),
        *aggregate_commitment_v8(&expected_commitments),
        test_hash(6),
        b"maker".to_string(),
        test_hash(7),
        b"walrus-blob".to_string(),
        test_hash(8),
        root_content_commitment,
        economics,
        rights,
        &clock,
        &mut ctx,
    );
    let mut registry = new_base_definition_registry_v8(
        &root,
        &admin,
        expected_counts,
        expected_commitments,
        &mut ctx,
    );
    maker::finalize_base_registry_binding_v8(
        &mut root,
        &admin,
        object::id(&registry),
    );
    append_track_v8(
        &mut registry,
        &root,
        &admin,
        0,
        b"track".to_string(),
        b"Track".to_string(),
        0,
        test_hash(10),
    );
    append_part_v8(
        &mut registry,
        &root,
        &admin,
        1,
        b"part".to_string(),
        b"Part".to_string(),
        0,
        0,
        true,
        true,
        test_hash(11),
    );
    append_item_v8(
        &mut registry,
        &root,
        &admin,
        2,
        b"part".to_string(),
        b"item".to_string(),
        b"Item".to_string(),
        0,
        test_hash(12),
    );
    append_style_v8(
        &mut registry,
        &root,
        &admin,
        3,
        b"part".to_string(),
        b"item".to_string(),
        b"style".to_string(),
        b"track".to_string(),
        option::none(),
        option::none(),
        b"Style".to_string(),
        b"style-blob".to_string(),
        test_hash(13),
        false,
        test_hash(14),
    );
    seal_base_definition_registry_v8(&mut registry, &root, &admin);
    let next_admin = maker::rotate_maker_control_for_testing(
        &mut root,
        admin,
        0,
        @0xBEEF,
        &mut ctx,
    );
    let (registry_id, aggregate, protected_count) =
        assert_activation_ready_v8(&registry, &root);
    assert!(registry_id == object::id(&registry), ERegistryMismatch);
    assert!(
        &aggregate == maker::root_expected_base_registry_commitment_v8(&root),
        ECommitmentMismatch,
    );
    assert!(protected_count == 0, ECountMismatch);
    share_base_definition_registry_v8(registry);
    maker::destroy_maker_for_testing(root, next_admin);
    protocol::destroy_protocol_for_testing(config, protocol_cap);
    clock.destroy_for_testing();
}

#[test_only]
public fun minimal_expected_commitments_for_testing(
    root_content_commitment: vector<u8>,
): BaseDefinitionCommitmentsV8 {
    let mut commitments = empty_commitments(root_content_commitment);
    let track = TrackRowV8 {
        sequence: 0,
        key: b"track".to_string(),
        label: b"Track".to_string(),
        render_order: 0,
        payload_commitment: test_hash(10),
    };
    let track_bytes = bcs::to_bytes(&track);
    commitments.tracks = advance_commitment_v8(
        root_content_commitment,
        CATEGORY_TRACK,
        commitments.tracks,
        0,
        track_bytes,
    );
    commitments.aggregate = advance_commitment_v8(
        root_content_commitment,
        CATEGORY_AGGREGATE,
        commitments.aggregate,
        0,
        track_bytes,
    );
    let part = PartRowV8 {
        sequence: 1,
        key: b"part".to_string(),
        label: b"Part".to_string(),
        kind: 0,
        render_order: 0,
        required: true,
        visible: true,
        payload_commitment: test_hash(11),
    };
    let part_bytes = bcs::to_bytes(&part);
    commitments.parts = advance_commitment_v8(
        root_content_commitment,
        CATEGORY_PART,
        commitments.parts,
        1,
        part_bytes,
    );
    commitments.aggregate = advance_commitment_v8(
        root_content_commitment,
        CATEGORY_AGGREGATE,
        commitments.aggregate,
        1,
        part_bytes,
    );
    let item = ItemRowV8 {
        sequence: 2,
        part_key: b"part".to_string(),
        item_key: b"item".to_string(),
        label: b"Item".to_string(),
        gate_kind: 0,
        payload_commitment: test_hash(12),
    };
    let item_bytes = bcs::to_bytes(&item);
    commitments.items = advance_commitment_v8(
        root_content_commitment,
        CATEGORY_ITEM,
        commitments.items,
        2,
        item_bytes,
    );
    commitments.aggregate = advance_commitment_v8(
        root_content_commitment,
        CATEGORY_AGGREGATE,
        commitments.aggregate,
        2,
        item_bytes,
    );
    let style = StyleRowV8 {
        sequence: 3,
        part_key: b"part".to_string(),
        item_key: b"item".to_string(),
        style_key: b"style".to_string(),
        layer_track_key: b"track".to_string(),
        color_channel_key: option::none(),
        default_swatch_key: option::none(),
        label: b"Style".to_string(),
        asset_blob_id: b"style-blob".to_string(),
        asset_sha256: test_hash(13),
        protected: false,
        payload_commitment: test_hash(14),
    };
    let style_bytes = bcs::to_bytes(&style);
    commitments.styles = advance_commitment_v8(
        root_content_commitment,
        CATEGORY_STYLE,
        commitments.styles,
        3,
        style_bytes,
    );
    commitments.aggregate = advance_commitment_v8(
        root_content_commitment,
        CATEGORY_AGGREGATE,
        commitments.aggregate,
        3,
        style_bytes,
    );
    commitments
}

#[test_only]
public fun populate_and_seal_minimal_for_testing<PaymentCoin>(
    registry: &mut BaseDefinitionRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
) {
    append_track_v8(registry, root, admin, 0, b"track".to_string(),
        b"Track".to_string(), 0, test_hash(10));
    append_part_v8(registry, root, admin, 1, b"part".to_string(),
        b"Part".to_string(), 0, 0, true, true, test_hash(11));
    append_item_v8(registry, root, admin, 2, b"part".to_string(),
        b"item".to_string(), b"Item".to_string(), 0, test_hash(12));
    append_style_v8(registry, root, admin, 3, b"part".to_string(),
        b"item".to_string(), b"style".to_string(), b"track".to_string(),
        option::none(), option::none(), b"Style".to_string(),
        b"style-blob".to_string(), test_hash(13), false, test_hash(14));
    seal_base_definition_registry_v8(registry, root, admin);
}

#[test_only]
fun test_hash(byte: u8): vector<u8> {
    let mut value = vector[];
    let mut index = 0;
    while (index < HASH_LENGTH) {
        value.push_back(byte);
        index = index + 1;
    };
    value
}
