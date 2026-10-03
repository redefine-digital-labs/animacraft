/// Public-row authoring fixture: an optional empty Part precedes the equipped
/// Part. Both have capacity one; no production state or lock is fabricated.
#[test_only]
module native_soul_v8_graph::sparse_base;

use animacraft_v8_core::base_registry_v8::{Self as base, BaseDefinitionRegistryV8,
    TrackRowV2, PartRowV2, ItemRowV2, StyleRowV2, AssetRowV2};
use animacraft_v8_core::maker_v8::{MakerRootV8, MakerAdminCapV8};

fun hash(byte: u8): vector<u8> { vector::tabulate!(32, |_| byte) }

fun rows(): (TrackRowV2, PartRowV2, PartRowV2, ItemRowV2, StyleRowV2, AssetRowV2) {
    let part = b"part".to_string();
    let empty = b"empty-part".to_string();
    let item = b"item".to_string();
    let style = b"style".to_string();
    let track = base::new_track_row_v2(0, b"track".to_string(), b"Track".to_string(), 0, false);
    let empty_visibility = base::visibility_program_commitment_v1(1, option::none(), 0,
        empty, option::none(), option::none(), &vector[]);
    let empty_part = base::new_part_row_v2(0, empty, b"Empty Part".to_string(), 0,
        0, 0, true, false, 0, 1, vector[b"track".to_string()], vector[], empty_visibility, hash(15));
    let part_visibility = base::visibility_program_commitment_v1(1, option::none(), 0,
        part, option::none(), option::none(), &vector[]);
    let selected_part = base::new_part_row_v2(1, part, b"Part".to_string(), 0,
        1, 0, true, true, 0, 1, vector[b"track".to_string()], vector[], part_visibility, hash(11));
    let item_visibility = base::visibility_program_commitment_v1(1, option::none(), 1,
        part, option::some(item), option::none(), &vector[]);
    let selected_item = base::new_item_row_v2(0, part, item, b"Item".to_string(), 0,
        0, style, vector[], item_visibility, hash(12));
    let style_visibility = base::visibility_program_commitment_v1(1, option::none(), 2,
        part, option::some(item), option::some(style), &vector[]);
    let selected_style = base::new_style_row_v2(0, part, item, style, b"Style".to_string(),
        0, b"track".to_string(), option::none(), option::none(), b"style-asset".to_string(),
        b"style-blob".to_string(), hash(13), false,
        base::new_transform_fixed_v1(base::new_signed_milli_v1(false, 0),
            base::new_signed_milli_v1(false, 0), 1_000_000, base::new_signed_milli_v1(false, 0)),
        1_000_000, 0, option::none(), vector[], style_visibility, hash(14));
    let asset = base::new_asset_row_v2(0, b"style-asset".to_string(), b"image".to_string(),
        b"image/png".to_string(), 32, hash(13));
    (track, empty_part, selected_part, selected_item, selected_style, asset)
}

public fun author_commitment(): vector<u8> {
    let (track, empty_part, part, item, style, asset) = rows();
    let encoded = vector[std::bcs::to_bytes(&track), std::bcs::to_bytes(&empty_part),
        std::bcs::to_bytes(&part), std::bcs::to_bytes(&item), std::bcs::to_bytes(&style), std::bcs::to_bytes(&asset)];
    let categories = vector[0u8, 2, 2, 3, 4, 6];
    let sequences = vector[0u64, 0, 1, 0, 0, 0];
    let mut rolling = base::author_rows_empty_commitment_v2();
    let mut i = 0;
    while (i < encoded.length()) {
        rolling = base::author_rows_advance_commitment_v2(categories[i], sequences[i], i, rolling, encoded[i]);
        i = i + 1;
    };
    base::author_rows_seal_commitment_v2(vector[1, 0, 2, 1, 1, 0, 1], rolling)
}

public fun populate<PaymentCoin>(registry: &mut BaseDefinitionRegistryV8,
    root: &mut MakerRootV8<PaymentCoin>, admin: &MakerAdminCapV8) {
    let (track, empty_part, part, item, style, asset) = rows();
    base::append_track_v2(registry, root, admin, track);
    base::append_part_v2(registry, root, admin, empty_part);
    base::append_part_v2(registry, root, admin, part);
    base::append_item_v2(registry, root, admin, item);
    base::append_style_v2(registry, root, admin, style);
    base::append_asset_v2(registry, root, admin, asset);
    base::seal_base_definition_registry_v8(registry, root, admin);
}
