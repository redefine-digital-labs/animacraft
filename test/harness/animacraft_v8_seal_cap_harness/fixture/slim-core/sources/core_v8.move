/// Localnet-only harness for measuring the exact production Base registry
/// module. This scratch package is never a Mainnet publication unit.
module animacraft_v8_core::core_v8;

use animacraft_v8_core::base_registry_v8::{Self as base, BaseDefinitionRegistryV8};
use animacraft_v8_core::maker_v8::{
    Self as maker,
    MakerAdminCapV8,
    MakerRootV8,
};
use std::bcs;
use std::option::{Self as option, Option};
use std::string::{Self as string, String};
use sui::sui::SUI;

const E_INVALID_BATCH: u64 = 0;
const HASH_LENGTH: u64 = 32;

public struct TrackRowForBcs has drop {
    sequence: u64,
    key: String,
    label: String,
    render_order: u64,
    payload_commitment: vector<u8>,
}

public struct PartRowForBcs has drop {
    sequence: u64,
    key: String,
    label: String,
    kind: u8,
    render_order: u64,
    required: bool,
    visible: bool,
    payload_commitment: vector<u8>,
}

public struct ItemRowForBcs has drop {
    sequence: u64,
    part_key: String,
    item_key: String,
    label: String,
    gate_kind: u8,
    payload_commitment: vector<u8>,
}

public struct StyleRowForBcs has drop {
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

public struct ColorRowForBcs has drop {
    sequence: u64,
    channel_key: String,
    swatch_key: String,
    label: String,
    rgba: u32,
    payload_commitment: vector<u8>,
}

/// Computes the exact expected commitments, creates a DRAFT Root and registry,
/// appends the three parent rows, then shares the objects. Style and color rows
/// are appended in later transactions so their setup cannot hide the seal limit.
public fun create_registry(
    style_count: u64,
    unique_color_per_style: bool,
    ctx: &mut TxContext,
) {
    assert!(style_count > 0 && style_count <= 10_000, E_INVALID_BATCH);
    let color_count = if (unique_color_per_style) style_count else 0;
    assert!(color_count <= 5_000, E_INVALID_BATCH);

    let root_content_commitment = test_hash(5);
    let mut tracks = base::empty_category_commitment_v8(
        root_content_commitment,
        base::category_track_v8(),
    );
    let mut parts = base::empty_category_commitment_v8(
        root_content_commitment,
        base::category_part_v8(),
    );
    let mut items = base::empty_category_commitment_v8(
        root_content_commitment,
        base::category_item_v8(),
    );
    let mut styles = base::empty_category_commitment_v8(
        root_content_commitment,
        base::category_style_v8(),
    );
    let mut colors = base::empty_category_commitment_v8(
        root_content_commitment,
        base::category_color_v8(),
    );
    let rules = base::empty_category_commitment_v8(
        root_content_commitment,
        base::category_rule_v8(),
    );
    let mut aggregate = base::empty_category_commitment_v8(
        root_content_commitment,
        255,
    );

    let track_bytes = bcs::to_bytes(&TrackRowForBcs {
        sequence: 0,
        key: b"track".to_string(),
        label: b"Track".to_string(),
        render_order: 0,
        payload_commitment: test_hash(10),
    });
    tracks = base::advance_commitment_v8(
        root_content_commitment,
        base::category_track_v8(),
        tracks,
        0,
        track_bytes,
    );
    aggregate = base::advance_commitment_v8(
        root_content_commitment,
        255,
        aggregate,
        0,
        track_bytes,
    );

    let part_bytes = bcs::to_bytes(&PartRowForBcs {
        sequence: 1,
        key: b"part".to_string(),
        label: b"Part".to_string(),
        kind: 0,
        render_order: 0,
        required: true,
        visible: true,
        payload_commitment: test_hash(11),
    });
    parts = base::advance_commitment_v8(
        root_content_commitment,
        base::category_part_v8(),
        parts,
        1,
        part_bytes,
    );
    aggregate = base::advance_commitment_v8(
        root_content_commitment,
        255,
        aggregate,
        1,
        part_bytes,
    );

    let item_bytes = bcs::to_bytes(&ItemRowForBcs {
        sequence: 2,
        part_key: b"part".to_string(),
        item_key: b"item".to_string(),
        label: b"Item".to_string(),
        gate_kind: 0,
        payload_commitment: test_hash(12),
    });
    items = base::advance_commitment_v8(
        root_content_commitment,
        base::category_item_v8(),
        items,
        2,
        item_bytes,
    );
    aggregate = base::advance_commitment_v8(
        root_content_commitment,
        255,
        aggregate,
        2,
        item_bytes,
    );

    let mut index = 0;
    while (index < style_count) {
        let row_bytes = style_row_bytes(index, unique_color_per_style);
        let sequence = 3 + index;
        styles = base::advance_commitment_v8(
            root_content_commitment,
            base::category_style_v8(),
            styles,
            sequence,
            row_bytes,
        );
        aggregate = base::advance_commitment_v8(
            root_content_commitment,
            255,
            aggregate,
            sequence,
            row_bytes,
        );
        index = index + 1;
    };

    index = 0;
    while (index < color_count) {
        let row_bytes = color_row_bytes(style_count, index);
        let sequence = 3 + style_count + index;
        colors = base::advance_commitment_v8(
            root_content_commitment,
            base::category_color_v8(),
            colors,
            sequence,
            row_bytes,
        );
        aggregate = base::advance_commitment_v8(
            root_content_commitment,
            255,
            aggregate,
            sequence,
            row_bytes,
        );
        index = index + 1;
    };

    let expected_counts = base::new_base_definition_counts_v8(
        1,
        1,
        1,
        style_count,
        color_count,
        0,
    );
    let expected_commitments = base::new_base_definition_commitments_v8(
        tracks,
        parts,
        items,
        styles,
        colors,
        rules,
        aggregate,
    );
    let (mut root, admin) = maker::new_root_for_seal_cap<SUI>(
        base::total_count_v8(&expected_counts),
        *base::aggregate_commitment_v8(&expected_commitments),
        root_content_commitment,
        ctx,
    );
    let mut registry = base::new_base_definition_registry_v8(
        &root,
        &admin,
        expected_counts,
        expected_commitments,
        ctx,
    );
    maker::finalize_base_registry_binding_v8(
        &mut root,
        &admin,
        object::id(&registry),
    );
    base::append_track_v8(
        &mut registry,
        &root,
        &admin,
        0,
        b"track".to_string(),
        b"Track".to_string(),
        0,
        test_hash(10),
    );
    base::append_part_v8(
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
    base::append_item_v8(
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
    base::share_base_definition_registry_v8(registry);
    maker::share_maker_root_and_admin_v8(root, admin, ctx);
}

/// Appends a consecutive style range. Use batches small enough to stay below
/// the per-transaction new-object/store-entry limits during fixture setup.
public fun append_styles(
    registry: &mut BaseDefinitionRegistryV8,
    root: &MakerRootV8<SUI>,
    admin: &MakerAdminCapV8,
    start: u64,
    count: u64,
    unique_color_per_style: bool,
) {
    assert!(count > 0 && start + count <= 10_000, E_INVALID_BATCH);
    let end = start + count;
    let mut index = start;
    while (index < end) {
        let color_channel_key = if (unique_color_per_style) {
            option::some(indexed_key(b"c", index))
        } else {
            option::none()
        };
        let default_swatch_key = if (unique_color_per_style) {
            option::some(b"swatch".to_string())
        } else {
            option::none()
        };
        base::append_style_v8(
            registry,
            root,
            admin,
            3 + index,
            b"part".to_string(),
            b"item".to_string(),
            indexed_key(b"s", index),
            b"track".to_string(),
            color_channel_key,
            default_swatch_key,
            b"Style".to_string(),
            b"style-blob".to_string(),
            test_hash(13),
            false,
            test_hash(14),
        );
        index = index + 1;
    };
}

/// Appends a consecutive unique-color range after all styles are present.
public fun append_colors(
    registry: &mut BaseDefinitionRegistryV8,
    root: &MakerRootV8<SUI>,
    admin: &MakerAdminCapV8,
    style_count: u64,
    start: u64,
    count: u64,
) {
    assert!(count > 0 && start + count <= style_count, E_INVALID_BATCH);
    let end = start + count;
    let mut index = start;
    while (index < end) {
        base::append_color_v8(
            registry,
            root,
            admin,
            3 + style_count + index,
            indexed_key(b"c", index),
            b"swatch".to_string(),
            b"Color".to_string(),
            0xff00ffff,
            test_hash(15),
        );
        index = index + 1;
    };
}

/// Calls the unmodified production seal function in its own transaction.
public fun seal(
    registry: &mut BaseDefinitionRegistryV8,
    root: &MakerRootV8<SUI>,
    admin: &MakerAdminCapV8,
) {
    base::seal_base_definition_registry_v8(registry, root, admin);
}

fun style_row_bytes(index: u64, unique_color_per_style: bool): vector<u8> {
    let color_channel_key = if (unique_color_per_style) {
        option::some(indexed_key(b"c", index))
    } else {
        option::none()
    };
    let default_swatch_key = if (unique_color_per_style) {
        option::some(b"swatch".to_string())
    } else {
        option::none()
    };
    bcs::to_bytes(&StyleRowForBcs {
        sequence: 3 + index,
        part_key: b"part".to_string(),
        item_key: b"item".to_string(),
        style_key: indexed_key(b"s", index),
        layer_track_key: b"track".to_string(),
        color_channel_key,
        default_swatch_key,
        label: b"Style".to_string(),
        asset_blob_id: b"style-blob".to_string(),
        asset_sha256: test_hash(13),
        protected: false,
        payload_commitment: test_hash(14),
    })
}

fun color_row_bytes(style_count: u64, index: u64): vector<u8> {
    bcs::to_bytes(&ColorRowForBcs {
        sequence: 3 + style_count + index,
        channel_key: indexed_key(b"c", index),
        swatch_key: b"swatch".to_string(),
        label: b"Color".to_string(),
        rgba: 0xff00ffff,
        payload_commitment: test_hash(15),
    })
}

/// Fixed-width decimal avoids UTF-8 ambiguity and is unique for 0..=9_999.
fun indexed_key(mut prefix: vector<u8>, index: u64): String {
    assert!(index < 10_000, E_INVALID_BATCH);
    let mut divisor = 1_000;
    while (divisor > 0) {
        let digit = ((index / divisor) % 10) as u8;
        prefix.push_back(48 + digit);
        divisor = divisor / 10;
    };
    string::utf8(prefix)
}

fun test_hash(byte: u8): vector<u8> {
    let mut value = vector[];
    let mut index = 0;
    while (index < HASH_LENGTH) {
        value.push_back(byte);
        index = index + 1;
    };
    value
}
