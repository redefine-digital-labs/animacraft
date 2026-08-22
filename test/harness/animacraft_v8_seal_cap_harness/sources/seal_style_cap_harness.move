/// Localnet-only harness for measuring the production Base registry seal.
/// This package is never a production dependency or Mainnet publication unit.
module animacraft_v8_seal_cap_harness::seal_style_cap_harness;

use animacraft_v8_core::base_registry_v8::{Self as base, BaseDefinitionRegistryV8};
use animacraft_v8_core::core_v8 as core;
use animacraft_v8_core::maker_v8::{
    Self as maker,
    MakerAdminCapV8,
    MakerRootV8,
};
use animacraft_v8_core::protocol_config_v8::ProtocolConfigV8;
use std::option;
use std::string::{Self as string, String};
use sui::clock::Clock;
use sui::sui::SUI;

const E_INVALID_BATCH: u64 = 0;
const HASH_LENGTH: u64 = 32;

/// Creates a DRAFT Root and registry from commitments computed off chain, then
/// appends the three constant parent rows and shares the objects. Style/color
/// fixture setup and the measured seal remain separate transactions.
public fun create_registry(
    config: &ProtocolConfigV8,
    clock: &Clock,
    style_count: u64,
    unique_color_per_style: bool,
    expected_tracks: vector<u8>,
    expected_parts: vector<u8>,
    expected_items: vector<u8>,
    expected_styles: vector<u8>,
    expected_colors: vector<u8>,
    expected_rules: vector<u8>,
    expected_aggregate: vector<u8>,
    ctx: &mut TxContext,
) {
    assert!(style_count > 0 && style_count <= 10_000, E_INVALID_BATCH);
    let color_count = if (unique_color_per_style) style_count else 0;
    assert!(color_count <= 5_000, E_INVALID_BATCH);

    let root_content_commitment = test_hash(5);
    let expected_counts = base::new_base_definition_counts_v8(
        1,
        1,
        1,
        style_count,
        color_count,
        0,
    );
    let expected_commitments = base::new_base_definition_commitments_v8(
        expected_tracks,
        expected_parts,
        expected_items,
        expected_styles,
        expected_colors,
        expected_rules,
        expected_aggregate,
    );
    let economics = maker::new_economics_snapshot_v8<SUI>(
        config,
        maker::access_free_v8(),
        0,
        maker::complete_unlimited_free_v8(),
        0,
        0,
        0,
    );
    let rights = maker::new_onchain_native_rights_snapshot_v8(ctx, 250, 250, 500);
    let (root, mut registry, maker_treasury, admin) =
        core::new_initial_maker_draft_v8<SUI>(
        config,
        b"seal-cap-maker".to_string(),
        test_hash(7),
        b"seal-cap-manifest".to_string(),
        test_hash(8),
        root_content_commitment,
        expected_counts,
        expected_commitments,
        test_hash(6),
        economics,
        rights,
        clock,
        ctx,
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
    core::share_maker_draft_v8(root, registry, maker_treasury, admin, ctx);
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
