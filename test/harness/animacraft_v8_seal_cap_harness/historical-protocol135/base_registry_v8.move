/// Immutable base Maker definitions. Pack Releases are intentionally not
/// rows in this registry and are never counted by its commitments.
module animacraft_v8_core::base_registry_v8;

use animacraft_v8_core::maker_v8::{
    Self as maker,
    MakerAdminCapV8,
    MakerRootV8,
};
use animacraft_v8_core::protocol_config_v8 as protocol;
use std::bcs;
use std::hash;
use std::option::{Self as option, Option};
use std::string::{Self as string, String};
use sui::dynamic_field as df;
use sui::event;

const VERSION: u64 = 8;
const SCHEMA_REVISION: u64 = 2;

const CATEGORY_TRACK: u8 = 0;
const CATEGORY_COLOR: u8 = 1;
const CATEGORY_PART: u8 = 2;
const CATEGORY_ITEM: u8 = 3;
const CATEGORY_STYLE: u8 = 4;
const CATEGORY_RULE: u8 = 5;
const CATEGORY_ASSET: u8 = 6;
const CATEGORY_OUTPUT: u8 = 7;
const CATEGORY_PHYSICAL: u8 = 8;
const CATEGORY_AGGREGATE: u8 = 255;

const PART_STANDARD: u8 = 0;
const PART_LEFT_RIGHT_PAIR: u8 = 1;
const PART_LAST_BASTION: u8 = 2;

const SLOT_FIXED: u8 = 0;
const SLOT_SELECTABLE: u8 = 1;
const ITEM_PUBLIC: u8 = 0;
const ITEM_PRIVATE: u8 = 1;

const RULE_REQUIRE: u8 = 0;
const RULE_EXCLUDE: u8 = 1;
const TARGET_ALL: u8 = 0;
const TARGET_ANY: u8 = 1;

const SOURCE_ANY: u8 = 0;
const SOURCE_BASE: u8 = 1;
const SOURCE_PACK: u8 = 2;
const SOURCE_EXTERNAL: u8 = 3;

const VIS_SELECTED: u8 = 0;
const VIS_NOT: u8 = 1;
const VIS_ALL: u8 = 2;
const VIS_ANY: u8 = 3;
const SUBJECT_PART: u8 = 0;
const SUBJECT_ITEM: u8 = 1;
const SUBJECT_STYLE: u8 = 2;

const BLEND_NORMAL: u8 = 0;
const BLEND_MULTIPLY: u8 = 1;
const BLEND_SCREEN: u8 = 2;
const BLEND_OVERLAY: u8 = 3;
const PHYSICAL_FREE_CLAIM: u8 = 0;
const PHYSICAL_PAID_PURCHASE: u8 = 1;
const PHYSICAL_PROOF_MATERIALIZE: u8 = 2;
const PHYSICAL_PROOF_NONE: u8 = 0;
const PHYSICAL_PROOF_CANONICAL_SOUL: u8 = 1;

const MAX_TRACKS: u64 = 256;
const MAX_PARTS: u64 = 750;
const MAX_ITEMS: u64 = 5_000;
const MAX_STYLES: u64 = 500;
const MAX_COLORS: u64 = 5_000;
const MAX_RULES: u64 = 1_000;
const MAX_ASSETS: u64 = 4_999;
const MAX_PART_CAPACITY: u64 = 64;
const MAX_TOTAL_CAPACITY: u64 = 500;
const MAX_RULE_TARGETS: u64 = 32;
const MAX_RULE_SELECTORS: u64 = 33_000;
const MAX_VISIBILITY_LEAVES: u64 = 32;
const MAX_VISIBILITY_DEPTH: u64 = 8;
const MAX_VISIBILITY_TOKENS: u64 = 288;
const MAX_TOTAL_VISIBILITY_LEAVES: u64 = 32_000;
const MAX_KEY_BYTES: u64 = 128;
const MAX_LABEL_BYTES: u64 = 256;
const MAX_BLOB_ID_BYTES: u64 = 512;
const MAX_TRANSLATION_MILLI: u64 = 8_192_000;
const MAX_ROTATION_MILLIDEGREES: u64 = 360_000;
const MAX_SCALE_PPM: u64 = 100_000_000;
const MAX_OPACITY_PPM: u64 = 1_000_000;
const MAX_ASSET_BYTES: u64 = 8 * 1024 * 1024;

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
const EInvalidDefinitionPolicy: u64 = 11;
const EItemNotPublic: u64 = 12;

public struct BaseDefinitionCountsV8 has copy, drop, store {
    tracks: u64,
    colors: u64,
    parts: u64,
    items: u64,
    styles: u64,
    rules: u64,
    assets: u64,
}

public struct BaseDefinitionCommitmentsV8 has copy, drop, store {
    tracks: vector<u8>,
    colors: vector<u8>,
    parts: vector<u8>,
    items: vector<u8>,
    styles: vector<u8>,
    rules: vector<u8>,
    assets: vector<u8>,
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
    initial_commitments: BaseDefinitionCommitmentsV8,
    rolling_commitments: BaseDefinitionCommitmentsV8,
    sealed_commitments: Option<BaseDefinitionCommitmentsV8>,
    next_sequence: u64,
    expected_sequence_count: u64,
    protected_style_count: u64,
    color_swatch_count: u64,
    total_capacity: u64,
    rule_selector_count: u64,
    visibility_leaf_count: u64,
    author_rows_rolling_commitment: vector<u8>,
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
public struct ItemIndexKeyV8 has copy, drop, store { index: u64 }
public struct ColorKeyV8 has copy, drop, store { channel_key: String }
public struct AssetKeyV2 has copy, drop, store { asset_id: String }
public struct RuleKeyV8 has copy, drop, store { key: String }
public struct RuleIndexKeyV8 has copy, drop, store { index: u64 }

public struct TrackRowV2 has copy, drop, store {
    sequence: u64,
    key: String,
    label: String,
    render_order: u64,
    locked: bool,
}

public struct ColorStopV2 has copy, drop, store {
    offset_ppm: u64,
    rgba: u32,
}

public struct ColorSwatchV2 has copy, drop, store {
    key: String,
    label: String,
    rgba: u32,
    stops: vector<ColorStopV2>,
}

public struct ColorChannelRowV2 has copy, drop, store {
    sequence: u64,
    key: String,
    label: String,
    default_swatch_key: String,
    swatches: vector<ColorSwatchV2>,
}

public struct SemanticSelectorV2 has copy, drop, store {
    source: u8,
    source_key: Option<String>,
    part_key: String,
    item_key: Option<String>,
    style_key: Option<String>,
}

public struct VisibilityTokenV1 has copy, drop, store {
    opcode: u8,
    selector: Option<SemanticSelectorV2>,
    arity: u16,
}

public struct SignedMilliV1 has copy, drop, store {
    negative: bool,
    magnitude: u64,
}

public struct TransformFixedV1 has copy, drop, store {
    x_milli: SignedMilliV1,
    y_milli: SignedMilliV1,
    scale_ppm: u64,
    rotation_millidegrees: SignedMilliV1,
}

public struct PhysicalPolicyV1 has copy, drop, store {
    material: String,
    issuance: u8,
    proof: u8,
    price_atomic: u64,
    max_supply: u64,
    transferable: bool,
}

public struct PartRowV2 has copy, drop, store {
    sequence: u64,
    key: String,
    label: String,
    kind: u8,
    render_order: u64,
    menu_order: u64,
    visible: bool,
    required: bool,
    slot_mode: u8,
    capacity: u64,
    track_keys: vector<String>,
    visibility_tokens: vector<VisibilityTokenV1>,
    visibility_commitment: vector<u8>,
    payload_commitment: vector<u8>,
}

public struct ItemRowV2 has copy, drop, store {
    sequence: u64,
    part_key: String,
    item_key: String,
    label: String,
    status: u8,
    display_order: u64,
    default_style_key: String,
    visibility_tokens: vector<VisibilityTokenV1>,
    visibility_commitment: vector<u8>,
    payload_commitment: vector<u8>,
}

public struct StyleRowV2 has copy, drop, store {
    sequence: u64,
    part_key: String,
    item_key: String,
    style_key: String,
    label: String,
    display_order: u64,
    track_key: String,
    color_channel_key: Option<String>,
    default_swatch_key: Option<String>,
    asset_id: String,
    asset_blob_id: String,
    asset_sha256: vector<u8>,
    protected: bool,
    transform: TransformFixedV1,
    opacity_ppm: u64,
    blend_mode: u8,
    physical: Option<PhysicalPolicyV1>,
    visibility_tokens: vector<VisibilityTokenV1>,
    visibility_commitment: vector<u8>,
    payload_commitment: vector<u8>,
}

public struct AssetRowV2 has copy, drop, store {
    sequence: u64,
    asset_id: String,
    kind: String,
    media_type: String,
    byte_length: u64,
    sha256: vector<u8>,
}

public struct RuleRowV2 has copy, drop, store {
    sequence: u64,
    key: String,
    kind: u8,
    trigger: SemanticSelectorV2,
    target_mode: u8,
    targets: vector<SemanticSelectorV2>,
    payload_commitment: vector<u8>,
}

public struct SemanticSelectorCommitmentInputV2 has drop {
    domain: String,
    schema_revision: u64,
    selector: SemanticSelectorV2,
}

public struct RuleRowCommitmentInputV2 has drop {
    domain: String,
    schema_revision: u64,
    definition_source: u8,
    definition_source_key: Option<String>,
    sequence: u64,
    key: String,
    kind: u8,
    trigger_selector_commitment: vector<u8>,
    target_mode: u8,
    ordered_target_selector_commitments: vector<vector<u8>>,
    payload_commitment: vector<u8>,
}

public struct VisibilityProgramCommitmentInputV1 has drop {
    domain: String,
    schema_revision: u64,
    definition_source: u8,
    definition_source_key: Option<String>,
    subject_level: u8,
    part_key: String,
    item_key: Option<String>,
    style_key: Option<String>,
    tokens: vector<VisibilityTokenV1>,
}

public struct RegistryRowCommitmentInputV2 has drop {
    domain: String,
    schema_revision: u64,
    registry_id: ID,
    root_id: ID,
    maker_version: u64,
    category_tag: u8,
    sequence: u64,
    row_bcs: vector<u8>,
}

public struct AuthorRowsEmptyCommitmentInputV2 has drop {
    domain: String,
    schema_revision: u64,
}
public struct AuthorRowsAdvanceCommitmentInputV2 has drop {
    domain: String,
    schema_revision: u64,
    category_tag: u8,
    sequence: u64,
    aggregate_sequence: u64,
    prior_commitment: vector<u8>,
    row_bcs: vector<u8>,
}
public struct AuthorRowsSealCommitmentInputV2 has drop {
    domain: String,
    schema_revision: u64,
    ordered_counts: vector<u64>,
    final_rolling_commitment: vector<u8>,
}

/// Precomputable author intent excludes transaction-created object IDs.
public fun author_rows_empty_commitment_v2(): vector<u8> {
    hash::sha2_256(bcs::to_bytes(&AuthorRowsEmptyCommitmentInputV2 {
        domain: b"animacraft-fresh-v8/compiler/author-rows-empty/v2".to_string(),
        schema_revision: SCHEMA_REVISION,
    }))
}
public fun author_rows_advance_commitment_v2(
    category_tag: u8, sequence: u64, aggregate_sequence: u64,
    prior_commitment: vector<u8>, row_bcs: vector<u8>,
): vector<u8> {
    assert!(category_tag <= CATEGORY_ASSET, EInvalidCategory);
    assert_hash(&prior_commitment);
    hash::sha2_256(bcs::to_bytes(&AuthorRowsAdvanceCommitmentInputV2 {
        domain: b"animacraft-fresh-v8/compiler/author-rows-advance/v2".to_string(),
        schema_revision: SCHEMA_REVISION, category_tag, sequence,
        aggregate_sequence, prior_commitment, row_bcs,
    }))
}
public fun author_rows_seal_commitment_v2(
    ordered_counts: vector<u64>, final_rolling_commitment: vector<u8>,
): vector<u8> {
    assert!(ordered_counts.length() == 7, EInvalidCounts);
    assert_hash(&final_rolling_commitment);
    hash::sha2_256(bcs::to_bytes(&AuthorRowsSealCommitmentInputV2 {
        domain: b"animacraft-fresh-v8/compiler/author-rows-seal/v2".to_string(),
        schema_revision: SCHEMA_REVISION, ordered_counts,
        final_rolling_commitment,
    }))
}

public struct RegistryAdvanceCommitmentInputV2 has drop {
    domain: String,
    schema_revision: u64,
    registry_id: ID,
    category_tag: u8,
    sequence: u64,
    prior_rolling_commitment: vector<u8>,
    row_commitment: vector<u8>,
}

public struct RegistryEmptyCommitmentInputV2 has drop {
    domain: String,
    schema_revision: u64,
    registry_id: ID,
    root_id: ID,
    maker_version: u64,
    category_tag: u8,
}

public struct RegistryCategorySealCommitmentInputV2 has drop {
    domain: String,
    schema_revision: u64,
    registry_id: ID,
    root_id: ID,
    maker_version: u64,
    category_tag: u8,
    count: u64,
    initial_commitment: vector<u8>,
    final_rolling_commitment: vector<u8>,
}

public struct RegistrySealCommitmentInputV2 has drop {
    domain: String,
    schema_revision: u64,
    registry_id: ID,
    root_id: ID,
    maker_version: u64,
    ordered_category_tags: vector<u8>,
    ordered_category_commitments: vector<vector<u8>>,
    aggregate_count: u64,
}

public struct BaseDefinitionCommitmentInputV2 has drop {
    domain: String,
    schema_revision: u64,
    maker_key: String,
    maker_version: u64,
    maker_document_commitment: vector<u8>,
    composition_commitment: vector<u8>,
    track_category_commitment: vector<u8>,
    color_category_commitment: vector<u8>,
    part_category_commitment: vector<u8>,
    item_category_commitment: vector<u8>,
    style_category_commitment: vector<u8>,
    rule_category_commitment: vector<u8>,
    asset_category_commitment: vector<u8>,
    output_category_commitment: vector<u8>,
    physical_category_commitment: vector<u8>,
    creator_defaults_commitment: vector<u8>,
    renderer_commitment: vector<u8>,
}

public struct BaseDefinitionRegistrySealedV8 has copy, drop {
    root_id: ID,
    registry_id: ID,
    definition_count: u64,
    protected_style_count: u64,
    aggregate_commitment: vector<u8>,
}

public fun new_semantic_selector_v2(
    source: u8,
    source_key: Option<String>,
    part_key: String,
    item_key: Option<String>,
    style_key: Option<String>,
): SemanticSelectorV2 {
    let selector = SemanticSelectorV2 {
        source, source_key, part_key, item_key, style_key,
    };
    assert_semantic_selector(&selector);
    selector
}

public fun new_visibility_token_v1(
    opcode: u8,
    selector: Option<SemanticSelectorV2>,
    arity: u16,
): VisibilityTokenV1 {
    let token = VisibilityTokenV1 { opcode, selector, arity };
    assert_visibility_token(&token);
    token
}

public fun new_signed_milli_v1(
    negative: bool,
    magnitude: u64,
): SignedMilliV1 {
    let value = SignedMilliV1 { negative, magnitude };
    assert_signed_milli(&value, 0xffffffffffffffff);
    value
}

public fun new_transform_fixed_v1(
    x_milli: SignedMilliV1,
    y_milli: SignedMilliV1,
    scale_ppm: u64,
    rotation_millidegrees: SignedMilliV1,
): TransformFixedV1 {
    let value = TransformFixedV1 {
        x_milli, y_milli, scale_ppm, rotation_millidegrees,
    };
    assert_transform(&value);
    value
}

public fun new_physical_policy_v1(
    material: String,
    issuance: u8,
    proof: u8,
    price_atomic: u64,
    max_supply: u64,
    transferable: bool,
): PhysicalPolicyV1 {
    let value = PhysicalPolicyV1 {
        material, issuance, proof, price_atomic, max_supply, transferable,
    };
    assert_physical_policy(&value);
    value
}

public fun new_track_row_v2(
    sequence: u64,
    key: String,
    label: String,
    render_order: u64,
    locked: bool,
): TrackRowV2 {
    let row = TrackRowV2 { sequence, key, label, render_order, locked };
    assert_track_row(&row);
    row
}

public fun new_color_stop_v2(offset_ppm: u64, rgba: u32): ColorStopV2 {
    let stop = ColorStopV2 { offset_ppm, rgba };
    assert_color_stop(&stop);
    stop
}

public fun new_color_swatch_v2(
    key: String,
    label: String,
    rgba: u32,
    stops: vector<ColorStopV2>,
): ColorSwatchV2 {
    let swatch = ColorSwatchV2 { key, label, rgba, stops };
    assert_color_swatch(&swatch);
    swatch
}

public fun new_color_channel_row_v2(
    sequence: u64,
    key: String,
    label: String,
    default_swatch_key: String,
    swatches: vector<ColorSwatchV2>,
): ColorChannelRowV2 {
    let row = ColorChannelRowV2 {
        sequence, key, label, default_swatch_key, swatches,
    };
    assert_color_channel_row(&row);
    row
}

public fun new_asset_row_v2(
    sequence: u64,
    asset_id: String,
    kind: String,
    media_type: String,
    byte_length: u64,
    sha256: vector<u8>,
): AssetRowV2 {
    let row = AssetRowV2 {
        sequence, asset_id, kind, media_type, byte_length, sha256,
    };
    assert_asset_row(&row);
    row
}

public fun new_part_row_v2(
    sequence: u64,
    key: String,
    label: String,
    kind: u8,
    render_order: u64,
    menu_order: u64,
    visible: bool,
    required: bool,
    slot_mode: u8,
    capacity: u64,
    track_keys: vector<String>,
    visibility_tokens: vector<VisibilityTokenV1>,
    visibility_commitment: vector<u8>,
    payload_commitment: vector<u8>,
): PartRowV2 {
    let row = PartRowV2 {
        sequence, key, label, kind, render_order, menu_order, visible,
        required, slot_mode, capacity, track_keys, visibility_tokens,
        visibility_commitment, payload_commitment,
    };
    assert_part_row(&row);
    row
}

public fun new_item_row_v2(
    sequence: u64,
    part_key: String,
    item_key: String,
    label: String,
    status: u8,
    display_order: u64,
    default_style_key: String,
    visibility_tokens: vector<VisibilityTokenV1>,
    visibility_commitment: vector<u8>,
    payload_commitment: vector<u8>,
): ItemRowV2 {
    let row = ItemRowV2 {
        sequence, part_key, item_key, label, status, display_order,
        default_style_key, visibility_tokens, visibility_commitment,
        payload_commitment,
    };
    assert_item_row(&row);
    row
}

public fun new_style_row_v2(
    sequence: u64,
    part_key: String,
    item_key: String,
    style_key: String,
    label: String,
    display_order: u64,
    track_key: String,
    color_channel_key: Option<String>,
    default_swatch_key: Option<String>,
    asset_id: String,
    asset_blob_id: String,
    asset_sha256: vector<u8>,
    protected: bool,
    transform: TransformFixedV1,
    opacity_ppm: u64,
    blend_mode: u8,
    physical: Option<PhysicalPolicyV1>,
    visibility_tokens: vector<VisibilityTokenV1>,
    visibility_commitment: vector<u8>,
    payload_commitment: vector<u8>,
): StyleRowV2 {
    let row = StyleRowV2 {
        sequence, part_key, item_key, style_key, label, display_order,
        track_key, color_channel_key, default_swatch_key, asset_id,
        asset_blob_id, asset_sha256, protected, transform, opacity_ppm,
        blend_mode, physical, visibility_tokens, visibility_commitment,
        payload_commitment,
    };
    assert_style_row(&row);
    row
}

public fun new_rule_row_v2(
    sequence: u64,
    key: String,
    kind: u8,
    trigger: SemanticSelectorV2,
    target_mode: u8,
    targets: vector<SemanticSelectorV2>,
    payload_commitment: vector<u8>,
): RuleRowV2 {
    let row = RuleRowV2 {
        sequence, key, kind, trigger, target_mode, targets,
        payload_commitment,
    };
    assert_rule_row(&row);
    row
}

public fun semantic_selector_commitment_v2(
    selector: &SemanticSelectorV2,
): vector<u8> {
    assert_semantic_selector(selector);
    hash::sha2_256(bcs::to_bytes(&SemanticSelectorCommitmentInputV2 {
        domain: b"animacraft-fresh-v8/core/semantic-selector/v2".to_string(),
        schema_revision: VERSION,
        selector: *selector,
    }))
}

public fun rule_row_commitment_v2(
    definition_source: u8,
    definition_source_key: Option<String>,
    row: &RuleRowV2,
): vector<u8> {
    assert_definition_scope(definition_source, &definition_source_key);
    assert_rule_row(row);
    let mut targets = vector[];
    let mut index = 0;
    while (index < row.targets.length()) {
        targets.push_back(semantic_selector_commitment_v2(&row.targets[index]));
        index = index + 1;
    };
    hash::sha2_256(bcs::to_bytes(&RuleRowCommitmentInputV2 {
        domain: b"animacraft-fresh-v8/core/rule-row/v2".to_string(),
        schema_revision: VERSION,
        definition_source,
        definition_source_key,
        sequence: row.sequence,
        key: row.key,
        kind: row.kind,
        trigger_selector_commitment:
            semantic_selector_commitment_v2(&row.trigger),
        target_mode: row.target_mode,
        ordered_target_selector_commitments: targets,
        payload_commitment: row.payload_commitment,
    }))
}

public fun visibility_program_commitment_v1(
    definition_source: u8,
    definition_source_key: Option<String>,
    subject_level: u8,
    part_key: String,
    item_key: Option<String>,
    style_key: Option<String>,
    tokens: &vector<VisibilityTokenV1>,
): vector<u8> {
    assert_definition_scope(definition_source, &definition_source_key);
    assert_subject_path(subject_level, &part_key, &item_key, &style_key);
    let _ = validate_visibility_program_v1(tokens);
    hash::sha2_256(bcs::to_bytes(&VisibilityProgramCommitmentInputV1 {
        domain: b"animacraft-fresh-v8/core/visibility-program/v1".to_string(),
        schema_revision: 1,
        definition_source,
        definition_source_key,
        subject_level,
        part_key,
        item_key,
        style_key,
        tokens: *tokens,
    }))
}

/// Returns the exact selector-leaf count after validating the postfix stack,
/// operator arities, 32-leaf/288-token limits and maximum depth eight.
public fun validate_visibility_program_v1(
    tokens: &vector<VisibilityTokenV1>,
): u64 {
    assert!(tokens.length() <= MAX_VISIBILITY_TOKENS,
        EInvalidDefinitionPolicy);
    if (tokens.is_empty()) return 0;
    let mut depths = vector[];
    let mut leaves = 0;
    let mut index = 0;
    while (index < tokens.length()) {
        let token = &tokens[index];
        assert_visibility_token(token);
        if (token.opcode == VIS_SELECTED) {
            leaves = leaves + 1;
            assert!(leaves <= MAX_VISIBILITY_LEAVES,
                EInvalidDefinitionPolicy);
            depths.push_back(1);
        } else if (token.opcode == VIS_NOT) {
            assert!(depths.length() >= 1, EInvalidDefinitionPolicy);
            let depth = depths.pop_back() + 1;
            assert!(depth <= MAX_VISIBILITY_DEPTH,
                EInvalidDefinitionPolicy);
            depths.push_back(depth);
        } else {
            let arity = token.arity as u64;
            assert!(depths.length() >= arity, EInvalidDefinitionPolicy);
            let mut max_depth = 0;
            let mut child = 0;
            while (child < arity) {
                let depth = depths.pop_back();
                if (depth > max_depth) max_depth = depth;
                child = child + 1;
            };
            max_depth = max_depth + 1;
            assert!(max_depth <= MAX_VISIBILITY_DEPTH,
                EInvalidDefinitionPolicy);
            depths.push_back(max_depth);
        };
        index = index + 1;
    };
    assert!(depths.length() == 1, EInvalidDefinitionPolicy);
    leaves
}

public fun new_base_definition_counts_v8(
    tracks: u64,
    colors: u64,
    parts: u64,
    items: u64,
    styles: u64,
    rules: u64,
    assets: u64,
): BaseDefinitionCountsV8 {
    let counts = BaseDefinitionCountsV8 {
        tracks, colors, parts, items, styles, rules, assets,
    };
    assert_valid_counts(&counts);
    counts
}

public fun new_base_definition_commitments_v8(
    tracks: vector<u8>,
    colors: vector<u8>,
    parts: vector<u8>,
    items: vector<u8>,
    styles: vector<u8>,
    rules: vector<u8>,
    assets: vector<u8>,
    aggregate: vector<u8>,
): BaseDefinitionCommitmentsV8 {
    let commitments = BaseDefinitionCommitmentsV8 {
        tracks, colors, parts, items, styles, rules, assets, aggregate,
    };
    assert_commitments(&commitments);
    commitments
}

/// Exact category initial root. It is identity-bound but deliberately does
/// not depend on RootContent, which is installed only after Base seal.
public fun registry_empty_commitment_v2(
    registry_id: ID,
    root_id: ID,
    maker_version: u64,
    category_tag: u8,
): vector<u8> {
    assert!(registry_id != root_id && maker_version > 0, ERegistryMismatch);
    assert_valid_category(category_tag);
    hash::sha2_256(bcs::to_bytes(&RegistryEmptyCommitmentInputV2 {
        domain: b"animacraft-fresh-v8/compiler/registry-empty/v2".to_string(),
        schema_revision: SCHEMA_REVISION,
        registry_id,
        root_id,
        maker_version,
        category_tag,
    }))
}

public fun registry_row_commitment_v2(
    registry_id: ID,
    root_id: ID,
    maker_version: u64,
    category_tag: u8,
    sequence: u64,
    row_bcs: vector<u8>,
): vector<u8> {
    assert!(registry_id != root_id && maker_version > 0, ERegistryMismatch);
    assert_valid_row_category(category_tag);
    assert!(!row_bcs.is_empty(), EInvalidDigest);
    hash::sha2_256(bcs::to_bytes(&RegistryRowCommitmentInputV2 {
        domain: b"animacraft-fresh-v8/compiler/registry-row/v2".to_string(),
        schema_revision: SCHEMA_REVISION,
        registry_id,
        root_id,
        maker_version,
        category_tag,
        sequence,
        row_bcs,
    }))
}

public fun registry_advance_commitment_v2(
    registry_id: ID,
    category_tag: u8,
    sequence: u64,
    prior_rolling_commitment: vector<u8>,
    row_commitment: vector<u8>,
): vector<u8> {
    assert_valid_category(category_tag);
    assert_hash(&prior_rolling_commitment);
    assert_hash(&row_commitment);
    hash::sha2_256(bcs::to_bytes(&RegistryAdvanceCommitmentInputV2 {
        domain: b"animacraft-fresh-v8/compiler/registry-advance/v2".to_string(),
        schema_revision: SCHEMA_REVISION,
        registry_id,
        category_tag,
        sequence,
        prior_rolling_commitment,
        row_commitment,
    }))
}

public fun registry_category_seal_commitment_v2(
    registry_id: ID,
    root_id: ID,
    maker_version: u64,
    category_tag: u8,
    count: u64,
    initial_commitment: vector<u8>,
    final_rolling_commitment: vector<u8>,
): vector<u8> {
    assert_valid_category(category_tag);
    assert_hash(&initial_commitment);
    assert_hash(&final_rolling_commitment);
    hash::sha2_256(bcs::to_bytes(&RegistryCategorySealCommitmentInputV2 {
        domain: b"animacraft-fresh-v8/compiler/registry-category-seal/v2".to_string(),
        schema_revision: SCHEMA_REVISION,
        registry_id,
        root_id,
        maker_version,
        category_tag,
        count,
        initial_commitment,
        final_rolling_commitment,
    }))
}

public fun registry_seal_commitment_v2(
    registry_id: ID,
    root_id: ID,
    maker_version: u64,
    ordered_category_tags: vector<u8>,
    ordered_category_commitments: vector<vector<u8>>,
    aggregate_count: u64,
): vector<u8> {
    assert_ordered_category_tags(&ordered_category_tags);
    assert!(ordered_category_commitments.length()
        == ordered_category_tags.length(), EInvalidCounts);
    let mut index = 0;
    while (index < ordered_category_commitments.length()) {
        assert_hash(&ordered_category_commitments[index]);
        index = index + 1;
    };
    hash::sha2_256(bcs::to_bytes(&RegistrySealCommitmentInputV2 {
        domain: b"animacraft-fresh-v8/compiler/registry-seal/v2".to_string(),
        schema_revision: SCHEMA_REVISION,
        registry_id,
        root_id,
        maker_version,
        ordered_category_tags,
        ordered_category_commitments,
        aggregate_count,
    }))
}

public fun base_definition_commitment_v2(
    maker_key: String,
    maker_version: u64,
    maker_document_commitment: vector<u8>,
    composition_commitment: vector<u8>,
    track_category_commitment: vector<u8>,
    color_category_commitment: vector<u8>,
    part_category_commitment: vector<u8>,
    item_category_commitment: vector<u8>,
    style_category_commitment: vector<u8>,
    rule_category_commitment: vector<u8>,
    asset_category_commitment: vector<u8>,
    output_category_commitment: vector<u8>,
    physical_category_commitment: vector<u8>,
    creator_defaults_commitment: vector<u8>,
    renderer_commitment: vector<u8>,
): vector<u8> {
    assert_non_empty_bounded(&maker_key, MAX_KEY_BYTES);
    assert!(maker_version > 0, EInvalidDefinitionPolicy);
    assert_hash(&maker_document_commitment);
    assert_hash(&composition_commitment);
    assert_hash(&track_category_commitment);
    assert_hash(&color_category_commitment);
    assert_hash(&part_category_commitment);
    assert_hash(&item_category_commitment);
    assert_hash(&style_category_commitment);
    assert_hash(&rule_category_commitment);
    assert_hash(&asset_category_commitment);
    assert_hash(&output_category_commitment);
    assert_hash(&physical_category_commitment);
    assert_hash(&creator_defaults_commitment);
    assert_hash(&renderer_commitment);
    hash::sha2_256(bcs::to_bytes(&BaseDefinitionCommitmentInputV2 {
        domain: b"animacraft-fresh-v8/core/base-definition/v2".to_string(),
        schema_revision: SCHEMA_REVISION,
        maker_key,
        maker_version,
        maker_document_commitment,
        composition_commitment,
        track_category_commitment,
        color_category_commitment,
        part_category_commitment,
        item_category_commitment,
        style_category_commitment,
        rule_category_commitment,
        asset_category_commitment,
        output_category_commitment,
        physical_category_commitment,
        creator_defaults_commitment,
        renderer_commitment,
    }))
}

public(package) fun new_base_definition_registry_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    expected_counts: BaseDefinitionCountsV8,
    ctx: &mut TxContext,
): BaseDefinitionRegistryV8 {
    maker::assert_draft_admin_v8(root, admin);
    assert_valid_counts(&expected_counts);
    let root_id = maker::root_id_v8(root);
    let maker_version = maker::root_maker_version_v8(root);
    let root_content_commitment = *maker::root_content_commitment_v8(root);
    let expected_sequence_count = expected_counts.tracks + expected_counts.colors
        + expected_counts.parts + expected_counts.items
        + expected_counts.styles + expected_counts.rules
        + expected_counts.assets;
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
    let registry_uid = object::new(ctx);
    let registry_id = registry_uid.to_inner();
    let initial_commitments = empty_commitments(
        registry_id, root_id, maker_version);
    BaseDefinitionRegistryV8 {
        id: registry_uid,
        version: VERSION,
        root_id,
        maker_version,
        root_content_commitment,
        expected_counts,
        observed_counts: zero_counts(),
        initial_commitments,
        rolling_commitments: initial_commitments,
        sealed_commitments: option::none(),
        next_sequence: 0,
        expected_sequence_count,
        protected_style_count: 0,
        color_swatch_count: 0,
        total_capacity: 0,
        rule_selector_count: 0,
        visibility_leaf_count: 0,
        author_rows_rolling_commitment: author_rows_empty_commitment_v2(),
        sealed: false,
    }
}

public fun append_track_v2<PaymentCoin>(
    registry: &mut BaseDefinitionRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    row: TrackRowV2,
) {
    assert_writable(registry, root, admin);
    assert_category_sequence(registry, CATEGORY_TRACK, row.sequence);
    assert_track_row(&row);
    let field_key = TrackKeyV8 { key: row.key };
    assert!(!df::exists(&registry.id, field_key), EDuplicateRow);
    let sequence = row.sequence;
    let row_bytes = bcs::to_bytes(&row);
    df::add(&mut registry.id, field_key, row);
    registry.observed_counts.tracks = registry.observed_counts.tracks + 1;
    advance_author_rows(registry, CATEGORY_TRACK, sequence, row_bytes);
    let row_commitment = registry_row_commitment(registry, CATEGORY_TRACK,
        sequence, row_bytes);
    advance_registry(registry, CATEGORY_TRACK, sequence, row_commitment);
}

public fun append_color_v2<PaymentCoin>(
    registry: &mut BaseDefinitionRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    row: ColorChannelRowV2,
) {
    assert_writable(registry, root, admin);
    assert_category_sequence(registry, CATEGORY_COLOR, row.sequence);
    assert_color_channel_row(&row);
    assert!(registry.color_swatch_count + row.swatches.length()
        <= MAX_COLORS, EInvalidCounts);
    let field_key = ColorKeyV8 { channel_key: row.key };
    assert!(!df::exists(&registry.id, field_key), EDuplicateRow);
    let sequence = row.sequence;
    let swatch_count = row.swatches.length();
    let row_bytes = bcs::to_bytes(&row);
    df::add(&mut registry.id, field_key, row);
    registry.observed_counts.colors = registry.observed_counts.colors + 1;
    registry.color_swatch_count = registry.color_swatch_count + swatch_count;
    advance_author_rows(registry, CATEGORY_COLOR, sequence, row_bytes);
    let row_commitment = registry_row_commitment(registry, CATEGORY_COLOR,
        sequence, row_bytes);
    advance_registry(registry, CATEGORY_COLOR, sequence, row_commitment);
}

public fun append_part_v2<PaymentCoin>(
    registry: &mut BaseDefinitionRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    row: PartRowV2,
) {
    assert_writable(registry, root, admin);
    assert_category_sequence(registry, CATEGORY_PART, row.sequence);
    assert_part_row(&row);
    let expected_visibility = visibility_program_commitment_v1(
        SOURCE_BASE, option::none(), SUBJECT_PART, row.key,
        option::none(), option::none(), &row.visibility_tokens);
    assert!(&expected_visibility == &row.visibility_commitment,
        ECommitmentMismatch);
    let leaves = validate_visibility_program_v1(&row.visibility_tokens);
    assert!(registry.visibility_leaf_count + leaves
        <= MAX_TOTAL_VISIBILITY_LEAVES, EInvalidCounts);
    assert!(registry.total_capacity + row.capacity <= MAX_TOTAL_CAPACITY,
        EInvalidCounts);
    let mut track_index = 0;
    while (track_index < row.track_keys.length()) {
        let track_key = row.track_keys[track_index];
        assert_non_empty_bounded(&track_key, MAX_KEY_BYTES);
        assert!(df::exists(&registry.id, TrackKeyV8 { key: track_key }),
            EMissingParentRow);
        let mut earlier = 0;
        while (earlier < track_index) {
            assert!(&row.track_keys[earlier] != &row.track_keys[track_index],
                EInvalidDefinitionPolicy);
            earlier = earlier + 1;
        };
        track_index = track_index + 1;
    };
    let field_key = PartKeyV8 { key: row.key };
    assert!(!df::exists(&registry.id, field_key), EDuplicateRow);
    let sequence = row.sequence;
    let capacity = row.capacity;
    let row_bytes = bcs::to_bytes(&row);
    registry.observed_counts.parts = registry.observed_counts.parts + 1;
    registry.total_capacity = registry.total_capacity + capacity;
    registry.visibility_leaf_count = registry.visibility_leaf_count + leaves;
    advance_author_rows(registry, CATEGORY_PART, sequence, row_bytes);
    let row_commitment = registry_row_commitment(registry, CATEGORY_PART,
        sequence, row_bytes);
    advance_registry(registry, CATEGORY_PART, sequence, row_commitment);
    df::add(&mut registry.id, field_key, row);
}

public fun append_item_v2<PaymentCoin>(
    registry: &mut BaseDefinitionRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    row: ItemRowV2,
) {
    assert_writable(registry, root, admin);
    assert_category_sequence(registry, CATEGORY_ITEM, row.sequence);
    assert_item_row(&row);
    assert!(
        df::exists(&registry.id, PartKeyV8 { key: row.part_key }),
        EMissingParentRow,
    );
    let expected_visibility = visibility_program_commitment_v1(
        SOURCE_BASE, option::none(), SUBJECT_ITEM, row.part_key,
        option::some(row.item_key), option::none(), &row.visibility_tokens);
    assert!(&expected_visibility == &row.visibility_commitment,
        ECommitmentMismatch);
    let leaves = validate_visibility_program_v1(&row.visibility_tokens);
    assert!(registry.visibility_leaf_count + leaves
        <= MAX_TOTAL_VISIBILITY_LEAVES, EInvalidCounts);
    let field_key = ItemKeyV8 {
        part_key: row.part_key,
        item_key: row.item_key,
    };
    assert!(!df::exists(&registry.id, field_key), EDuplicateRow);
    let sequence = row.sequence;
    let row_bytes = bcs::to_bytes(&row);
    df::add(
        &mut registry.id,
        ItemIndexKeyV8 { index: registry.observed_counts.items },
        field_key,
    );
    registry.observed_counts.items = registry.observed_counts.items + 1;
    registry.visibility_leaf_count = registry.visibility_leaf_count + leaves;
    advance_author_rows(registry, CATEGORY_ITEM, sequence, row_bytes);
    let row_commitment = registry_row_commitment(registry, CATEGORY_ITEM,
        sequence, row_bytes);
    advance_registry(registry, CATEGORY_ITEM, sequence, row_commitment);
    df::add(&mut registry.id, field_key, row);
}

public fun append_style_v2<PaymentCoin>(
    registry: &mut BaseDefinitionRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    row: StyleRowV2,
) {
    assert_writable(registry, root, admin);
    assert_category_sequence(registry, CATEGORY_STYLE, row.sequence);
    assert_style_row(&row);
    assert!(
        df::exists(&registry.id, ItemKeyV8 {
            part_key: row.part_key, item_key: row.item_key,
        }),
        EMissingParentRow,
    );
    assert!(
        df::exists(&registry.id, TrackKeyV8 { key: row.track_key }),
        EMissingParentRow,
    );
    let expected_visibility = visibility_program_commitment_v1(
        SOURCE_BASE, option::none(), SUBJECT_STYLE, row.part_key,
        option::some(row.item_key), option::some(row.style_key),
        &row.visibility_tokens);
    assert!(&expected_visibility == &row.visibility_commitment,
        ECommitmentMismatch);
    let leaves = validate_visibility_program_v1(&row.visibility_tokens);
    assert!(registry.visibility_leaf_count + leaves
        <= MAX_TOTAL_VISIBILITY_LEAVES, EInvalidCounts);
    let field_key = StyleKeyV8 {
        part_key: row.part_key,
        item_key: row.item_key,
        style_key: row.style_key,
    };
    assert!(!df::exists(&registry.id, field_key), EDuplicateRow);
    let sequence = row.sequence;
    let protected = row.protected;
    let row_bytes = bcs::to_bytes(&row);
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
    registry.visibility_leaf_count = registry.visibility_leaf_count + leaves;
    advance_author_rows(registry, CATEGORY_STYLE, sequence, row_bytes);
    let row_commitment = registry_row_commitment(registry, CATEGORY_STYLE,
        sequence, row_bytes);
    advance_registry(registry, CATEGORY_STYLE, sequence, row_commitment);
    df::add(&mut registry.id, field_key, row);
}

public fun append_asset_v2<PaymentCoin>(
    registry: &mut BaseDefinitionRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    row: AssetRowV2,
) {
    assert_writable(registry, root, admin);
    assert_category_sequence(registry, CATEGORY_ASSET, row.sequence);
    assert_asset_row(&row);
    let field_key = AssetKeyV2 { asset_id: row.asset_id };
    assert!(!df::exists(&registry.id, field_key), EDuplicateRow);
    let sequence = row.sequence;
    let row_bytes = bcs::to_bytes(&row);
    df::add(&mut registry.id, field_key, row);
    registry.observed_counts.assets = registry.observed_counts.assets + 1;
    advance_author_rows(registry, CATEGORY_ASSET, sequence, row_bytes);
    let row_commitment = registry_row_commitment(registry, CATEGORY_ASSET,
        sequence, row_bytes);
    advance_registry(registry, CATEGORY_ASSET, sequence, row_commitment);
}

public fun append_rule_v2<PaymentCoin>(
    registry: &mut BaseDefinitionRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    row: RuleRowV2,
) {
    assert_writable(registry, root, admin);
    assert_category_sequence(registry, CATEGORY_RULE, row.sequence);
    assert_rule_row(&row);
    assert_base_selector_resolves_if_needed(registry, &row.trigger);
    let mut target_index = 0;
    while (target_index < row.targets.length()) {
        assert_base_selector_resolves_if_needed(
            registry, &row.targets[target_index]);
        target_index = target_index + 1;
    };
    let selector_count = 1 + row.targets.length();
    assert!(registry.rule_selector_count + selector_count
        <= MAX_RULE_SELECTORS, EInvalidCounts);
    let field_key = RuleKeyV8 { key: row.key };
    assert!(!df::exists(&registry.id, field_key), EDuplicateRow);
    let sequence = row.sequence;
    let row_commitment = rule_row_commitment_v2(
        SOURCE_BASE, option::none(), &row);
    advance_author_rows(registry, CATEGORY_RULE, sequence, bcs::to_bytes(&row));
    df::add(
        &mut registry.id,
        RuleIndexKeyV8 { index: registry.observed_counts.rules },
        field_key,
    );
    registry.observed_counts.rules = registry.observed_counts.rules + 1;
    registry.rule_selector_count = registry.rule_selector_count + selector_count;
    advance_registry(registry, CATEGORY_RULE, sequence, row_commitment);
    df::add(&mut registry.id, field_key, row);
}

public fun seal_base_definition_registry_v8<PaymentCoin>(
    registry: &mut BaseDefinitionRegistryV8,
    root: &mut MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
) {
    assert_writable(registry, root, admin);
    assert!(
        registry.next_sequence == registry.expected_sequence_count,
        ECountMismatch,
    );
    assert_counts_equal(&registry.observed_counts, &registry.expected_counts);
    assert_style_color_references(registry);
    assert_item_default_styles(registry);
    assert_style_assets(registry);
    let author_commitment = author_rows_seal_commitment_v2(
        count_vector(&registry.observed_counts), registry.author_rows_rolling_commitment);
    assert!(&author_commitment == maker::root_expected_base_registry_commitment_v8(root),
        ECommitmentMismatch);
    let sealed_commitments = derive_sealed_commitments(registry);
    maker::install_sealed_base_registry_commitment_v2(
        root, admin, object::id(registry), sealed_commitments.aggregate);
    registry.sealed_commitments = option::some(sealed_commitments);
    registry.sealed = true;
    event::emit(BaseDefinitionRegistrySealedV8 {
        root_id: registry.root_id,
        registry_id: object::id(registry),
        definition_count: registry.expected_sequence_count,
        protected_style_count: registry.protected_style_count,
        aggregate_commitment: sealed_commitments.aggregate,
    });
}

/// Core-side readiness consumed later by the Release orchestrator. It proves
/// only base definitions; it says nothing about companion runtime behavior.
/// Runtime and Seal read the immutable schema-2 row, never an unsealed draft.
public fun registry_root_id_v2(registry: &BaseDefinitionRegistryV8): ID { registry.root_id }
public fun registry_maker_version_v2(registry: &BaseDefinitionRegistryV8): u64 { registry.maker_version }
public fun registry_root_content_commitment_v2(registry: &BaseDefinitionRegistryV8): &vector<u8> {
    &registry.root_content_commitment
}
public fun registry_sealed_v2(registry: &BaseDefinitionRegistryV8): bool { registry.sealed }
public fun registry_part_count_v2(registry: &BaseDefinitionRegistryV8): u64 {
    assert!(registry.sealed, EInvalidLifecycle);
    registry.observed_counts.parts
}
public fun registry_track_count_v2(registry: &BaseDefinitionRegistryV8): u64 {
    assert!(registry.sealed, EInvalidLifecycle);
    registry.observed_counts.tracks
}

public fun borrow_track_v2(registry: &BaseDefinitionRegistryV8, key: String): &TrackRowV2 {
    assert!(registry.sealed, EInvalidLifecycle);
    let field_key = TrackKeyV8 { key };
    assert!(df::exists(&registry.id, field_key), EMissingParentRow);
    df::borrow(&registry.id, field_key)
}

/// The channel and swatch are both exact; an absent swatch never selects
/// the channel's default color.
public fun borrow_color_v2(
    registry: &BaseDefinitionRegistryV8,
    channel_key: String,
    swatch_key: String,
): &ColorSwatchV2 {
    assert!(registry.sealed, EInvalidLifecycle);
    let field_key = ColorKeyV8 { channel_key };
    assert!(df::exists(&registry.id, field_key), EMissingParentRow);
    let channel: &ColorChannelRowV2 = df::borrow(&registry.id, field_key);
    let mut index = 0u64;
    while (index < channel.swatches.length()) {
        if (channel.swatches[index].key == swatch_key) return &channel.swatches[index];
        index = index + 1;
    };
    abort EMissingParentRow
}

public fun borrow_part_v2(
    registry: &BaseDefinitionRegistryV8,
    key: String,
): &PartRowV2 {
    assert!(registry.sealed, EInvalidLifecycle);
    df::borrow(&registry.id, PartKeyV8 { key })
}

/// Sequence is local to the Part category, not the whole registry.
public fun part_identity_terms_v2(row: &PartRowV2): (&String, u64, bool, &vector<u8>) {
    (&row.key, row.sequence, row.required, &row.payload_commitment)
}

public fun borrow_item_v2(
    registry: &BaseDefinitionRegistryV8,
    part_key: String,
    item_key: String,
): &ItemRowV2 {
    assert!(registry.sealed, EInvalidLifecycle);
    df::borrow(&registry.id, ItemKeyV8 { part_key, item_key })
}

public fun item_payload_commitment_v2(row: &ItemRowV2): &vector<u8> {
    &row.payload_commitment
}

/// Publication eligibility, not a fee or acquisition policy. Runtime must
/// separately validate the Maker pass or exact holder-owned instance.
public fun assert_public_item_v2(row: &ItemRowV2) {
    assert!(row.status == ITEM_PUBLIC, EItemNotPublic);
}

public fun registry_rule_count_v2(registry: &BaseDefinitionRegistryV8): u64 {
    assert!(registry.sealed, EInvalidLifecycle);
    registry.observed_counts.rules
}

public fun borrow_rule_at_v2(registry: &BaseDefinitionRegistryV8, index: u64): &RuleRowV2 {
    assert!(registry.sealed, EInvalidLifecycle);
    assert!(index < registry.observed_counts.rules, ECountMismatch);
    let key: &RuleKeyV8 = df::borrow(&registry.id, RuleIndexKeyV8 { index });
    df::borrow(&registry.id, *key)
}

public fun rule_terms_v2(
    row: &RuleRowV2,
): (u8, &SemanticSelectorV2, u8, &vector<SemanticSelectorV2>, &vector<u8>) {
    (row.kind, &row.trigger, row.target_mode, &row.targets, &row.payload_commitment)
}

public fun semantic_selector_terms_v2(
    selector: &SemanticSelectorV2,
): (u8, &Option<String>, &String, &Option<String>, &Option<String>) {
    (selector.source, &selector.source_key, &selector.part_key,
        &selector.item_key, &selector.style_key)
}

/// Pure matching only. Runtime derives these facts from its exact, proven
/// selection; this function grants no ownership or publication authority.
public fun semantic_selector_matches_v2(
    selector: &SemanticSelectorV2, source: u8, source_key: &Option<String>,
    part_key: &String, item_key: &String, style_key: &String,
): bool {
    assert!(source >= SOURCE_BASE && source <= SOURCE_EXTERNAL, EInvalidDefinitionPolicy);
    if (selector.source != SOURCE_ANY && selector.source != source) return false;
    if ((selector.source == SOURCE_PACK || selector.source == SOURCE_EXTERNAL)
        && &selector.source_key != source_key) return false;
    &selector.part_key == part_key
        && (selector.item_key.is_none() || selector.item_key.borrow() == item_key)
        && (selector.style_key.is_none() || selector.style_key.borrow() == style_key)
}

/// EXCLUDE means each selected target is forbidden; it is never an ALL-only
/// conflict. REQUIRE retains the author's ALL/ANY alternatives.
public fun rule_is_satisfied_v2(
    row: &RuleRowV2, trigger_selected: bool, target_matches: &vector<bool>,
): bool {
    assert!(target_matches.length() == row.targets.length(), ECountMismatch);
    if (!trigger_selected) return true;
    let mut any = false;
    let mut all = true;
    let mut index = 0u64;
    while (index < target_matches.length()) {
        any = any || target_matches[index];
        all = all && target_matches[index];
        index = index + 1;
    };
    if (row.kind == RULE_EXCLUDE) !any
    else if (row.target_mode == TARGET_ALL) all
    else any
}

public fun borrow_style_v2(
    registry: &BaseDefinitionRegistryV8,
    part_key: String,
    item_key: String,
    style_key: String,
): &StyleRowV2 {
    assert!(registry.sealed, EInvalidLifecycle);
    df::borrow(&registry.id, StyleKeyV8 { part_key, item_key, style_key })
}

public fun style_payload_commitment_v2(row: &StyleRowV2): &vector<u8> {
    &row.payload_commitment
}

public fun style_asset_blob_id_v2(row: &StyleRowV2): &String {
    &row.asset_blob_id
}

public fun style_asset_sha256_v2(row: &StyleRowV2): &vector<u8> {
    &row.asset_sha256
}

public fun style_layer_track_key_v2(row: &StyleRowV2): &String { &row.track_key }
public fun style_color_channel_key_v2(row: &StyleRowV2): &Option<String> { &row.color_channel_key }
public fun style_protected_v2(row: &StyleRowV2): bool { row.protected }
public fun style_part_key_v2(row: &StyleRowV2): &String { &row.part_key }
public fun style_item_key_v2(row: &StyleRowV2): &String { &row.item_key }
public fun style_key_v2(row: &StyleRowV2): &String { &row.style_key }
public fun style_default_swatch_key_v2(row: &StyleRowV2): &Option<String> { &row.default_swatch_key }

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
    assert!(registry.sealed_commitments.is_some(), ECommitmentMismatch);
    let sealed_commitments = derive_sealed_commitments(registry);
    assert!(registry.sealed_commitments.borrow() == &sealed_commitments,
        ECommitmentMismatch);
    assert!(&sealed_commitments.aggregate == maker::root_sealed_base_registry_commitment_v2(root),
        ECommitmentMismatch);
    (
        object::id(registry),
        sealed_commitments.aggregate,
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
}

fun assert_category_sequence(
    registry: &BaseDefinitionRegistryV8,
    category: u8,
    sequence: u64,
) {
    assert!(category <= CATEGORY_ASSET, EInvalidCategory);
    let expected = count_vector(&registry.expected_counts);
    let observed = count_vector(&registry.observed_counts);
    let category_index = category as u64;
    assert!(sequence == observed[category_index]
        && sequence < expected[category_index], EWrongSequence);
    let mut index = 0;
    while (index < category_index) {
        assert!(observed[index] == expected[index], EWrongSequence);
        index = index + 1;
    };
}

fun advance_registry(
    registry: &mut BaseDefinitionRegistryV8,
    category: u8,
    sequence: u64,
    row_commitment: vector<u8>,
) {
    let registry_id = object::id(registry);
    let target = if (category == CATEGORY_TRACK) {
        &mut registry.rolling_commitments.tracks
    } else if (category == CATEGORY_COLOR) {
        &mut registry.rolling_commitments.colors
    } else if (category == CATEGORY_PART) {
        &mut registry.rolling_commitments.parts
    } else if (category == CATEGORY_ITEM) {
        &mut registry.rolling_commitments.items
    } else if (category == CATEGORY_STYLE) {
        &mut registry.rolling_commitments.styles
    } else if (category == CATEGORY_RULE) {
        &mut registry.rolling_commitments.rules
    } else if (category == CATEGORY_ASSET) {
        &mut registry.rolling_commitments.assets
    } else {
        abort EInvalidCategory
    };
    *target = registry_advance_commitment_v2(
        registry_id, category, sequence, *target, row_commitment);
    registry.rolling_commitments.aggregate = registry_advance_commitment_v2(
        registry_id,
        CATEGORY_AGGREGATE,
        registry.next_sequence,
        registry.rolling_commitments.aggregate,
        row_commitment,
    );
    registry.next_sequence = registry.next_sequence + 1;
}

fun advance_author_rows(
    registry: &mut BaseDefinitionRegistryV8, category: u8,
    sequence: u64, row_bcs: vector<u8>,
) {
    registry.author_rows_rolling_commitment = author_rows_advance_commitment_v2(
        category, sequence, registry.next_sequence,
        registry.author_rows_rolling_commitment, row_bcs);
}

fun registry_row_commitment(
    registry: &BaseDefinitionRegistryV8,
    category: u8,
    sequence: u64,
    row_bcs: vector<u8>,
): vector<u8> {
    registry_row_commitment_v2(
        object::id(registry), registry.root_id, registry.maker_version,
        category, sequence, row_bcs)
}

fun derive_sealed_commitments(
    registry: &BaseDefinitionRegistryV8,
): BaseDefinitionCommitmentsV8 {
    let tracks = seal_category(registry, CATEGORY_TRACK,
        registry.observed_counts.tracks,
        registry.initial_commitments.tracks,
        registry.rolling_commitments.tracks);
    let colors = seal_category(registry, CATEGORY_COLOR,
        registry.observed_counts.colors,
        registry.initial_commitments.colors,
        registry.rolling_commitments.colors);
    let parts = seal_category(registry, CATEGORY_PART,
        registry.observed_counts.parts,
        registry.initial_commitments.parts,
        registry.rolling_commitments.parts);
    let items = seal_category(registry, CATEGORY_ITEM,
        registry.observed_counts.items,
        registry.initial_commitments.items,
        registry.rolling_commitments.items);
    let styles = seal_category(registry, CATEGORY_STYLE,
        registry.observed_counts.styles,
        registry.initial_commitments.styles,
        registry.rolling_commitments.styles);
    let rules = seal_category(registry, CATEGORY_RULE,
        registry.observed_counts.rules,
        registry.initial_commitments.rules,
        registry.rolling_commitments.rules);
    let assets = seal_category(registry, CATEGORY_ASSET,
        registry.observed_counts.assets,
        registry.initial_commitments.assets,
        registry.rolling_commitments.assets);
    let aggregate_category = seal_category(registry, CATEGORY_AGGREGATE,
        registry.next_sequence,
        registry.initial_commitments.aggregate,
        registry.rolling_commitments.aggregate);
    let aggregate = registry_seal_commitment_v2(
        object::id(registry), registry.root_id, registry.maker_version,
        category_tags(),
        vector[
            tracks, colors, parts, items, styles, rules, assets,
            aggregate_category,
        ],
        registry.next_sequence,
    );
    BaseDefinitionCommitmentsV8 {
        tracks, colors, parts, items, styles, rules, assets, aggregate,
    }
}

fun seal_category(
    registry: &BaseDefinitionRegistryV8,
    category: u8,
    count: u64,
    initial: vector<u8>,
    rolling: vector<u8>,
): vector<u8> {
    registry_category_seal_commitment_v2(
        object::id(registry), registry.root_id, registry.maker_version,
        category, count, initial, rolling)
}

fun category_tags(): vector<u8> {
    vector[
        CATEGORY_TRACK, CATEGORY_COLOR, CATEGORY_PART, CATEGORY_ITEM,
        CATEGORY_STYLE, CATEGORY_RULE, CATEGORY_ASSET, CATEGORY_AGGREGATE,
    ]
}

fun assert_style_color_references(registry: &BaseDefinitionRegistryV8) {
    let mut index = 0;
    while (index < registry.observed_counts.styles) {
        let style_key: &StyleKeyV8 = df::borrow(
            &registry.id,
            StyleIndexKeyV8 { index },
        );
        let style: &StyleRowV2 = df::borrow(&registry.id, *style_key);
        if (style.color_channel_key.is_some()) {
            let color_key = ColorKeyV8 {
                channel_key: *style.color_channel_key.borrow(),
            };
            assert!(df::exists(&registry.id, color_key), EMissingParentRow);
            let channel: &ColorChannelRowV2 =
                df::borrow(&registry.id, color_key);
            assert!(has_swatch(channel, style.default_swatch_key.borrow()),
                EMissingParentRow);
        };
        index = index + 1;
    };
}

fun assert_style_assets(registry: &BaseDefinitionRegistryV8) {
    let mut index = 0;
    while (index < registry.observed_counts.styles) {
        let style_key: &StyleKeyV8 = df::borrow(
            &registry.id, StyleIndexKeyV8 { index });
        let style: &StyleRowV2 = df::borrow(&registry.id, *style_key);
        assert!(df::exists(&registry.id, AssetKeyV2 {
            asset_id: style.asset_id,
        }), EMissingParentRow);
        index = index + 1;
    };
}

fun has_swatch(channel: &ColorChannelRowV2, key: &String): bool {
    let mut index = 0;
    while (index < channel.swatches.length()) {
        if (&channel.swatches[index].key == key) return true;
        index = index + 1;
    };
    false
}

fun assert_item_default_styles(registry: &BaseDefinitionRegistryV8) {
    let mut index = 0;
    while (index < registry.observed_counts.items) {
        let item_key: &ItemKeyV8 = df::borrow(
            &registry.id, ItemIndexKeyV8 { index });
        let item: &ItemRowV2 = df::borrow(&registry.id, *item_key);
        assert!(df::exists(&registry.id, StyleKeyV8 {
            part_key: item.part_key,
            item_key: item.item_key,
            style_key: item.default_style_key,
        }), EMissingParentRow);
        index = index + 1;
    };
}

fun assert_valid_counts(counts: &BaseDefinitionCountsV8) {
    assert!(counts.tracks > 0 && counts.tracks <= MAX_TRACKS
        && counts.colors <= MAX_COLORS
        && counts.parts > 0 && counts.parts <= MAX_PARTS
        && counts.items > 0 && counts.items <= MAX_ITEMS
        && counts.styles > 0 && counts.styles <= MAX_STYLES
        && counts.rules <= MAX_RULES
        && counts.assets > 0 && counts.assets <= MAX_ASSETS,
        EInvalidCounts);
}

fun assert_commitments(commitments: &BaseDefinitionCommitmentsV8) {
    assert_hash(&commitments.tracks);
    assert_hash(&commitments.colors);
    assert_hash(&commitments.parts);
    assert_hash(&commitments.items);
    assert_hash(&commitments.styles);
    assert_hash(&commitments.rules);
    assert_hash(&commitments.assets);
    assert_hash(&commitments.aggregate);
}

fun assert_counts_equal(
    actual: &BaseDefinitionCountsV8,
    expected: &BaseDefinitionCountsV8,
) {
    assert!(actual == expected, ECountMismatch);
}

fun assert_hash(value: &vector<u8>) {
    assert!(protocol::is_nonzero_hash_v2(value), EInvalidDigest);
}

fun assert_non_empty_bounded(value: &String, max: u64) {
    let length = string::as_bytes(value).length();
    assert!(length > 0 && length <= max, EInvalidString);
}

fun assert_valid_category(category: u8) {
    assert!(
        category == CATEGORY_TRACK
            || category == CATEGORY_COLOR
            || category == CATEGORY_PART
            || category == CATEGORY_ITEM
            || category == CATEGORY_STYLE
            || category == CATEGORY_RULE
            || category == CATEGORY_ASSET
            || category == CATEGORY_OUTPUT
            || category == CATEGORY_PHYSICAL
            || category == CATEGORY_AGGREGATE,
        EInvalidCategory,
    );
}

fun assert_valid_row_category(category: u8) {
    assert_valid_category(category);
    assert!(category != CATEGORY_RULE && category != CATEGORY_AGGREGATE,
        EInvalidCategory);
}

fun assert_ordered_category_tags(tags: &vector<u8>) {
    assert!(!tags.is_empty(), EInvalidCategory);
    let mut index = 0;
    while (index < tags.length()) {
        assert_valid_category(tags[index]);
        if (index > 0) {
            assert!(tags[index - 1] < tags[index], EInvalidCategory);
        };
        index = index + 1;
    };
}

fun count_vector(counts: &BaseDefinitionCountsV8): vector<u64> {
    vector[
        counts.tracks, counts.colors, counts.parts, counts.items,
        counts.styles, counts.rules, counts.assets,
    ]
}

fun assert_part_policy(kind: u8, required: bool) {
    assert!((kind == PART_STANDARD || kind == PART_LEFT_RIGHT_PAIR
        || kind == PART_LAST_BASTION)
        && (kind != PART_LAST_BASTION || required), EInvalidDefinitionPolicy);
}

fun assert_rule_kind(kind: u8) {
    assert!(kind == RULE_REQUIRE || kind == RULE_EXCLUDE, EInvalidDefinitionPolicy);
}

fun assert_definition_scope(
    source: u8,
    source_key: &Option<String>,
) {
    assert!((source == SOURCE_BASE || source == SOURCE_PACK
        || source == SOURCE_EXTERNAL)
        && source_key.is_some() == (source != SOURCE_BASE),
        EInvalidDefinitionPolicy);
    if (source != SOURCE_BASE) {
        assert_non_empty_bounded(source_key.borrow(), MAX_KEY_BYTES);
    };
}

fun assert_semantic_selector(selector: &SemanticSelectorV2) {
    assert!(selector.source <= SOURCE_EXTERNAL, EInvalidDefinitionPolicy);
    if (selector.source == SOURCE_ANY || selector.source == SOURCE_BASE) {
        assert!(selector.source_key.is_none(), EInvalidDefinitionPolicy);
    } else {
        assert!(selector.source_key.is_some(), EInvalidDefinitionPolicy);
        assert_non_empty_bounded(selector.source_key.borrow(), MAX_KEY_BYTES);
        if (selector.source == SOURCE_EXTERNAL) {
            assert_external_product_key(selector.source_key.borrow());
        };
    };
    assert_non_empty_bounded(&selector.part_key, MAX_KEY_BYTES);
    if (selector.item_key.is_some()) {
        assert_non_empty_bounded(selector.item_key.borrow(), MAX_KEY_BYTES);
    };
    if (selector.style_key.is_some()) {
        assert!(selector.item_key.is_some(), EInvalidDefinitionPolicy);
        assert_non_empty_bounded(selector.style_key.borrow(), MAX_KEY_BYTES);
    };
}

// External selections already carry the exact immutable Product object ID.
// Use that authority instead of inventing an unbound semantic alias.
fun assert_external_product_key(key: &String) {
    let bytes = key.as_bytes();
    assert!(bytes.length() == 66 && bytes[0] == 48 && bytes[1] == 120,
        EInvalidDefinitionPolicy);
    let mut index = 2u64;
    let mut nonzero = false;
    while (index < bytes.length()) {
        let byte = bytes[index];
        assert!((byte >= 48 && byte <= 57) || (byte >= 97 && byte <= 102),
            EInvalidDefinitionPolicy);
        nonzero = nonzero || byte != 48;
        index = index + 1;
    };
    assert!(nonzero, EInvalidDefinitionPolicy);
}

fun assert_visibility_token(token: &VisibilityTokenV1) {
    if (token.opcode == VIS_SELECTED) {
        assert!(token.selector.is_some() && token.arity == 0,
            EInvalidDefinitionPolicy);
        assert_semantic_selector(token.selector.borrow());
    } else if (token.opcode == VIS_NOT) {
        assert!(token.selector.is_none() && token.arity == 1,
            EInvalidDefinitionPolicy);
    } else if (token.opcode == VIS_ALL || token.opcode == VIS_ANY) {
        assert!(token.selector.is_none() && token.arity > 0
            && (token.arity as u64) <= MAX_VISIBILITY_LEAVES,
            EInvalidDefinitionPolicy);
    } else {
        abort EInvalidDefinitionPolicy
    };
}

fun assert_subject_path(
    subject_level: u8,
    part_key: &String,
    item_key: &Option<String>,
    style_key: &Option<String>,
) {
    assert_non_empty_bounded(part_key, MAX_KEY_BYTES);
    if (subject_level == SUBJECT_PART) {
        assert!(item_key.is_none() && style_key.is_none(),
            EInvalidDefinitionPolicy);
    } else if (subject_level == SUBJECT_ITEM) {
        assert!(item_key.is_some() && style_key.is_none(),
            EInvalidDefinitionPolicy);
        assert_non_empty_bounded(item_key.borrow(), MAX_KEY_BYTES);
    } else if (subject_level == SUBJECT_STYLE) {
        assert!(item_key.is_some() && style_key.is_some(),
            EInvalidDefinitionPolicy);
        assert_non_empty_bounded(item_key.borrow(), MAX_KEY_BYTES);
        assert_non_empty_bounded(style_key.borrow(), MAX_KEY_BYTES);
    } else {
        abort EInvalidDefinitionPolicy
    };
}

fun assert_signed_milli(value: &SignedMilliV1, max: u64) {
    assert!(value.magnitude <= max
        && (value.magnitude != 0 || !value.negative), EInvalidDefinitionPolicy);
}

fun assert_transform(value: &TransformFixedV1) {
    assert_signed_milli(&value.x_milli, MAX_TRANSLATION_MILLI);
    assert_signed_milli(&value.y_milli, MAX_TRANSLATION_MILLI);
    assert_signed_milli(
        &value.rotation_millidegrees, MAX_ROTATION_MILLIDEGREES);
    assert!(value.scale_ppm > 0 && value.scale_ppm <= MAX_SCALE_PPM,
        EInvalidDefinitionPolicy);
}

fun assert_physical_policy(value: &PhysicalPolicyV1) {
    assert_non_empty_bounded(&value.material, MAX_LABEL_BYTES);
    assert!((value.issuance == PHYSICAL_FREE_CLAIM
        || value.issuance == PHYSICAL_PAID_PURCHASE
        || value.issuance == PHYSICAL_PROOF_MATERIALIZE)
        && (value.proof == PHYSICAL_PROOF_NONE
            || value.proof == PHYSICAL_PROOF_CANONICAL_SOUL)
        && value.max_supply > 0, EInvalidDefinitionPolicy);
}

fun assert_track_row(row: &TrackRowV2) {
    assert_non_empty_bounded(&row.key, MAX_KEY_BYTES);
    assert_non_empty_bounded(&row.label, MAX_LABEL_BYTES);
}

fun assert_color_stop(stop: &ColorStopV2) {
    assert!(stop.offset_ppm <= 1_000_000, EInvalidDefinitionPolicy);
}

fun assert_color_swatch(swatch: &ColorSwatchV2) {
    assert_non_empty_bounded(&swatch.key, MAX_KEY_BYTES);
    assert_non_empty_bounded(&swatch.label, MAX_LABEL_BYTES);
    let mut index = 0;
    while (index < swatch.stops.length()) {
        assert_color_stop(&swatch.stops[index]);
        if (index > 0) {
            assert!(swatch.stops[index - 1].offset_ppm
                <= swatch.stops[index].offset_ppm,
                EInvalidDefinitionPolicy);
        };
        index = index + 1;
    };
}

#[test]
fun color_swatch_retains_equal_offset_nodes() {
    let swatch = new_color_swatch_v2(b"gradient".to_string(), b"Gradient".to_string(), 0,
        vector[new_color_stop_v2(0, 1), new_color_stop_v2(500_000, 2),
            new_color_stop_v2(500_000, 3), new_color_stop_v2(1_000_000, 4)]);
    assert!(swatch.stops.length() == 4, EInvalidDefinitionPolicy);
    assert!(swatch.stops[1].rgba == 2 && swatch.stops[2].rgba == 3,
        EInvalidDefinitionPolicy);
}

#[test, expected_failure(abort_code = EInvalidDefinitionPolicy)]
fun color_swatch_rejects_descending_offsets() {
    let _ = new_color_swatch_v2(b"gradient".to_string(), b"Gradient".to_string(), 0,
        vector[new_color_stop_v2(500_000, 1), new_color_stop_v2(499_999, 2)]);
}

#[test, expected_failure(abort_code = EInvalidDefinitionPolicy)]
fun color_stop_rejects_out_of_range_offset() {
    let _ = new_color_stop_v2(1_000_001, 1);
}

fun assert_color_channel_row(row: &ColorChannelRowV2) {
    assert_non_empty_bounded(&row.key, MAX_KEY_BYTES);
    assert_non_empty_bounded(&row.label, MAX_LABEL_BYTES);
    assert_non_empty_bounded(&row.default_swatch_key, MAX_KEY_BYTES);
    assert!(!row.swatches.is_empty()
        && row.swatches.length() <= MAX_COLORS, EInvalidCounts);
    let mut default_found = false;
    let mut index = 0;
    while (index < row.swatches.length()) {
        let swatch = &row.swatches[index];
        assert_color_swatch(swatch);
        if (&swatch.key == &row.default_swatch_key) default_found = true;
        let mut prior = 0;
        while (prior < index) {
            assert!(&row.swatches[prior].key != &swatch.key,
                EInvalidDefinitionPolicy);
            prior = prior + 1;
        };
        index = index + 1;
    };
    assert!(default_found, EInvalidDefinitionPolicy);
}

fun assert_asset_row(row: &AssetRowV2) {
    assert_non_empty_bounded(&row.asset_id, MAX_KEY_BYTES);
    assert_non_empty_bounded(&row.kind, MAX_LABEL_BYTES);
    assert_non_empty_bounded(&row.media_type, MAX_LABEL_BYTES);
    assert!(row.byte_length > 0 && row.byte_length <= MAX_ASSET_BYTES,
        EInvalidDefinitionPolicy);
    assert_hash(&row.sha256);
}

fun assert_part_row(row: &PartRowV2) {
    assert_non_empty_bounded(&row.key, MAX_KEY_BYTES);
    assert_non_empty_bounded(&row.label, MAX_LABEL_BYTES);
    assert_hash(&row.visibility_commitment);
    assert_hash(&row.payload_commitment);
    assert_part_policy(row.kind, row.required);
    assert!(row.slot_mode == SLOT_FIXED || row.slot_mode == SLOT_SELECTABLE,
        EInvalidDefinitionPolicy);
    assert!(row.capacity > 0 && row.capacity <= MAX_PART_CAPACITY,
        EInvalidDefinitionPolicy);
    // Slot mode controls admission, not the independently authored capacity.
    // An empty/open Part need not invent a Track before it contains a Style.
    assert!(row.track_keys.length() <= MAX_TRACKS, EInvalidDefinitionPolicy);
    let _ = validate_visibility_program_v1(&row.visibility_tokens);
}

#[test]
fun fixed_slot_retains_independent_capacity_and_empty_track_list() {
    let row = new_part_row_v2(0, b"optional".to_string(), b"Optional".to_string(),
        PART_STANDARD, 0, 0, true, false, SLOT_FIXED, 2, vector[], vector[],
        test_hash(1), test_hash(2));
    assert!(row.capacity == 2 && row.track_keys.is_empty(), EInvalidDefinitionPolicy);
}

fun assert_item_row(row: &ItemRowV2) {
    assert_non_empty_bounded(&row.part_key, MAX_KEY_BYTES);
    assert_non_empty_bounded(&row.item_key, MAX_KEY_BYTES);
    assert_non_empty_bounded(&row.label, MAX_LABEL_BYTES);
    assert!(row.status == ITEM_PUBLIC || row.status == ITEM_PRIVATE,
        EInvalidDefinitionPolicy);
    assert_non_empty_bounded(&row.default_style_key, MAX_KEY_BYTES);
    assert_hash(&row.visibility_commitment);
    assert_hash(&row.payload_commitment);
    let _ = validate_visibility_program_v1(&row.visibility_tokens);
}

fun assert_style_row(row: &StyleRowV2) {
    assert_non_empty_bounded(&row.part_key, MAX_KEY_BYTES);
    assert_non_empty_bounded(&row.item_key, MAX_KEY_BYTES);
    assert_non_empty_bounded(&row.style_key, MAX_KEY_BYTES);
    assert_non_empty_bounded(&row.label, MAX_LABEL_BYTES);
    assert_non_empty_bounded(&row.track_key, MAX_KEY_BYTES);
    assert!(row.color_channel_key.is_some()
        == row.default_swatch_key.is_some(), EMissingParentRow);
    if (row.color_channel_key.is_some()) {
        assert_non_empty_bounded(row.color_channel_key.borrow(), MAX_KEY_BYTES);
        assert_non_empty_bounded(row.default_swatch_key.borrow(), MAX_KEY_BYTES);
    };
    assert_non_empty_bounded(&row.asset_id, MAX_KEY_BYTES);
    assert_non_empty_bounded(&row.asset_blob_id, MAX_BLOB_ID_BYTES);
    assert_hash(&row.asset_sha256);
    assert_transform(&row.transform);
    assert!(row.opacity_ppm <= MAX_OPACITY_PPM, EInvalidDefinitionPolicy);
    assert!(row.blend_mode == BLEND_NORMAL
        || row.blend_mode == BLEND_MULTIPLY
        || row.blend_mode == BLEND_SCREEN
        || row.blend_mode == BLEND_OVERLAY, EInvalidDefinitionPolicy);
    if (row.physical.is_some()) {
        assert_physical_policy(row.physical.borrow());
    };
    assert_hash(&row.visibility_commitment);
    assert_hash(&row.payload_commitment);
    let _ = validate_visibility_program_v1(&row.visibility_tokens);
}

fun assert_rule_row(row: &RuleRowV2) {
    assert_non_empty_bounded(&row.key, MAX_KEY_BYTES);
    assert_rule_kind(row.kind);
    assert!(row.target_mode == TARGET_ALL || row.target_mode == TARGET_ANY,
        EInvalidDefinitionPolicy);
    assert!(row.kind != RULE_EXCLUDE || row.target_mode == TARGET_ANY,
        EInvalidDefinitionPolicy);
    assert_semantic_selector(&row.trigger);
    assert!(row.targets.length() > 0
        && row.targets.length() <= MAX_RULE_TARGETS,
        EInvalidDefinitionPolicy);
    let mut index = 0;
    while (index < row.targets.length()) {
        assert_semantic_selector(&row.targets[index]);
        index = index + 1;
    };
    assert_hash(&row.payload_commitment);
}

fun assert_base_selector_resolves_if_needed(
    registry: &BaseDefinitionRegistryV8,
    selector: &SemanticSelectorV2,
) {
    if (selector.source != SOURCE_BASE) return;
    if (selector.item_key.is_none()) {
        assert!(df::exists(&registry.id, PartKeyV8 {
            key: selector.part_key,
        }), EMissingParentRow);
    } else if (selector.style_key.is_none()) {
        assert!(df::exists(&registry.id, ItemKeyV8 {
            part_key: selector.part_key,
            item_key: *selector.item_key.borrow(),
        }), EMissingParentRow);
    } else {
        assert!(df::exists(&registry.id, StyleKeyV8 {
            part_key: selector.part_key,
            item_key: *selector.item_key.borrow(),
            style_key: *selector.style_key.borrow(),
        }), EMissingParentRow);
    };
}

public fun definition_count_v2(
    counts: &BaseDefinitionCountsV8,
): u64 {
    assert_valid_counts(counts);
    counts.tracks + counts.colors + counts.parts + counts.items
        + counts.styles + counts.rules + counts.assets
}

#[test]
fun base_definition_policy_accepts_exact_product_vocabulary() {
    assert_part_policy(PART_STANDARD, false);
    assert_part_policy(PART_LEFT_RIGHT_PAIR, false);
    assert_part_policy(PART_LAST_BASTION, true);
    assert_rule_kind(RULE_REQUIRE);
    assert_rule_kind(RULE_EXCLUDE);
}

#[test, expected_failure(abort_code = EInvalidDefinitionPolicy)]
fun last_bastion_cannot_be_optional() {
    assert_part_policy(PART_LAST_BASTION, false);
}

#[test, expected_failure(abort_code = EInvalidDefinitionPolicy)]
fun unknown_part_kind_is_rejected() {
    assert_part_policy(3, true);
}

#[test, expected_failure(abort_code = EInvalidDefinitionPolicy)]
fun unknown_rule_kind_is_rejected() {
    assert_rule_kind(2);
}

fun zero_counts(): BaseDefinitionCountsV8 {
    BaseDefinitionCountsV8 {
        tracks: 0,
        colors: 0,
        parts: 0,
        items: 0,
        styles: 0,
        rules: 0,
        assets: 0,
    }
}

fun empty_commitments(
    registry_id: ID,
    root_id: ID,
    maker_version: u64,
): BaseDefinitionCommitmentsV8 {
    BaseDefinitionCommitmentsV8 {
        tracks: registry_empty_commitment_v2(
            registry_id, root_id, maker_version, CATEGORY_TRACK),
        colors: registry_empty_commitment_v2(
            registry_id, root_id, maker_version, CATEGORY_COLOR),
        parts: registry_empty_commitment_v2(
            registry_id, root_id, maker_version, CATEGORY_PART),
        items: registry_empty_commitment_v2(
            registry_id, root_id, maker_version, CATEGORY_ITEM),
        styles: registry_empty_commitment_v2(
            registry_id, root_id, maker_version, CATEGORY_STYLE),
        rules: registry_empty_commitment_v2(
            registry_id, root_id, maker_version, CATEGORY_RULE),
        assets: registry_empty_commitment_v2(
            registry_id, root_id, maker_version, CATEGORY_ASSET),
        aggregate: registry_empty_commitment_v2(
            registry_id, root_id, maker_version, CATEGORY_AGGREGATE),
    }
}

#[test]
fun empty_commitments_are_root_and_category_separated() {
    let registry_a = object::id_from_address(@0xA);
    let registry_b = object::id_from_address(@0xB);
    let root_a = object::id_from_address(@0xC);
    let root_b = object::id_from_address(@0xD);
    let track_a = registry_empty_commitment_v2(
        registry_a, root_a, 1, CATEGORY_TRACK);
    let part_a = registry_empty_commitment_v2(
        registry_a, root_a, 1, CATEGORY_PART);
    let track_b = registry_empty_commitment_v2(
        registry_b, root_b, 1, CATEGORY_TRACK);
    assert!(track_a != part_a, ECommitmentMismatch);
    assert!(track_a != track_b, ECommitmentMismatch);
}

#[test, expected_failure(abort_code = EInvalidCounts)]
fun base_registry_requires_real_creator_structure() {
    new_base_definition_counts_v8(0, 0, 1, 1, 1, 0, 1);
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
        test_hash(1),
    );
}

#[test]
fun exact_minimal_base_registry_seals() {
    exercise_registry_readers(0);
}

#[test]
fun semantic_selectors_preserve_source_and_definition_granularity() {
    let part = b"body".to_string();
    let item = b"item".to_string();
    let style = b"red".to_string();
    let pack = option::some(b"pack-a".to_string());
    let base_item = new_semantic_selector_v2(SOURCE_BASE, option::none(),
        part, option::some(item), option::none());
    assert!(semantic_selector_matches_v2(&base_item, SOURCE_BASE, &option::none(),
        &part, &item, &style), EInvalidDefinitionPolicy);
    assert!(!semantic_selector_matches_v2(&base_item, SOURCE_PACK, &pack,
        &part, &item, &style), EInvalidDefinitionPolicy);
    let pack_style = new_semantic_selector_v2(SOURCE_PACK, pack,
        part, option::some(item), option::some(style));
    assert!(semantic_selector_matches_v2(&pack_style, SOURCE_PACK, &pack,
        &part, &item, &style), EInvalidDefinitionPolicy);
    assert!(!semantic_selector_matches_v2(&pack_style, SOURCE_PACK,
        &option::some(b"pack-b".to_string()), &part, &item, &style), EInvalidDefinitionPolicy);
    assert!(!semantic_selector_matches_v2(&pack_style, SOURCE_PACK, &pack,
        &part, &item, &b"blue".to_string()), EInvalidDefinitionPolicy);
    let external_id = option::some(
        b"0x00000000000000000000000000000000000000000000000000000000000000ab".to_string());
    let external = new_semantic_selector_v2(SOURCE_EXTERNAL, external_id,
        part, option::some(item), option::some(style));
    assert!(semantic_selector_matches_v2(&external, SOURCE_EXTERNAL, &external_id,
        &part, &item, &style), EInvalidDefinitionPolicy);
    assert!(!semantic_selector_matches_v2(&external, SOURCE_EXTERNAL, &option::some(
        b"0x00000000000000000000000000000000000000000000000000000000000000ac".to_string()),
        &part, &item, &style), EInvalidDefinitionPolicy);
    let any_part = new_semantic_selector_v2(SOURCE_ANY, option::none(),
        part, option::none(), option::none());
    assert!(semantic_selector_matches_v2(&any_part, SOURCE_EXTERNAL, &external_id,
        &part, &b"other".to_string(), &b"other-style".to_string()), EInvalidDefinitionPolicy);
}

#[test]
fun rule_targets_preserve_require_all_any_and_each_exclusion() {
    let trigger = new_semantic_selector_v2(SOURCE_ANY, option::none(),
        b"body".to_string(), option::none(), option::none());
    let one = new_semantic_selector_v2(SOURCE_BASE, option::none(),
        b"hat".to_string(), option::some(b"one".to_string()), option::none());
    let two = new_semantic_selector_v2(SOURCE_BASE, option::none(),
        b"hat".to_string(), option::some(b"two".to_string()), option::none());
    let all = new_rule_row_v2(0, b"all".to_string(), RULE_REQUIRE, trigger,
        TARGET_ALL, vector[one, two], test_hash(10));
    let any = new_rule_row_v2(1, b"any".to_string(), RULE_REQUIRE, trigger,
        TARGET_ANY, vector[one, two], test_hash(11));
    let excludes = new_rule_row_v2(2, b"excludes".to_string(), RULE_EXCLUDE, trigger,
        TARGET_ANY, vector[one, two], test_hash(12));
    assert!(rule_is_satisfied_v2(&all, true, &vector[true, true]), EInvalidDefinitionPolicy);
    assert!(!rule_is_satisfied_v2(&all, true, &vector[true, false]), EInvalidDefinitionPolicy);
    assert!(rule_is_satisfied_v2(&any, true, &vector[false, true]), EInvalidDefinitionPolicy);
    assert!(!rule_is_satisfied_v2(&any, true, &vector[false, false]), EInvalidDefinitionPolicy);
    assert!(!rule_is_satisfied_v2(&excludes, true, &vector[false, true]), EInvalidDefinitionPolicy);
    assert!(rule_is_satisfied_v2(&excludes, true, &vector[false, false]), EInvalidDefinitionPolicy);
    assert!(rule_is_satisfied_v2(&all, false, &vector[false, false])
        && rule_is_satisfied_v2(&excludes, false, &vector[true, true]), EInvalidDefinitionPolicy);
}

#[test, expected_failure(abort_code = EInvalidDefinitionPolicy)]
fun external_rule_rejects_unbound_semantic_alias() {
    new_semantic_selector_v2(SOURCE_EXTERNAL, option::some(b"same-name".to_string()),
        b"part".to_string(), option::none(), option::none());
}

#[test, expected_failure(abort_code = EInvalidDefinitionPolicy)]
fun exclude_rule_cannot_weaken_conflicts_to_all() {
    let selector = new_semantic_selector_v2(SOURCE_ANY, option::none(),
        b"body".to_string(), option::none(), option::none());
    new_rule_row_v2(0, b"exclude".to_string(), RULE_EXCLUDE, selector,
        TARGET_ALL, vector[selector], test_hash(10));
}

#[test, expected_failure(abort_code = EMissingParentRow)]
fun sealed_track_reader_rejects_missing_key() {
    exercise_registry_readers(1);
}

#[test, expected_failure(abort_code = EMissingParentRow)]
fun sealed_color_reader_rejects_wrong_channel() {
    exercise_registry_readers(2);
}

#[test, expected_failure(abort_code = EMissingParentRow)]
fun sealed_color_reader_rejects_missing_swatch_without_default() {
    exercise_registry_readers(3);
}

#[test, expected_failure(abort_code = EInvalidLifecycle)]
fun track_reader_rejects_unsealed_registry() {
    exercise_registry_readers(4);
}

#[test, expected_failure(abort_code = EInvalidLifecycle)]
fun color_reader_rejects_unsealed_registry() {
    exercise_registry_readers(5);
}

#[test, expected_failure(abort_code = EItemNotPublic)]
fun sealed_private_item_is_not_user_eligible() {
    exercise_registry_readers(6);
}

#[test, expected_failure(abort_code = ECommitmentMismatch)]
fun author_intent_rejects_same_count_track_edit() { exercise_registry_readers(7); }

#[test]
fun author_hash_protocol_matches_javascript_golden() {
    let empty = author_rows_empty_commitment_v2();
    assert!(empty == x"2a491da2d215a60eea0fb4a5859854f89ee5d442018963455aa966257dfd97d0",
        ECommitmentMismatch);
    let rolling = author_rows_advance_commitment_v2(
        CATEGORY_TRACK, 0, 0, empty,
        bcs::to_bytes(&new_track_row_v2(0, b"back".to_string(), b"Track".to_string(), 8, true)));
    assert!(rolling == x"c60d44ad4221d336ce30fd5269ff4ba975d26fe3538e983237ab19574922104a",
        ECommitmentMismatch);
    assert!(author_rows_seal_commitment_v2(vector[1, 0, 0, 0, 0, 0, 0], rolling)
        == x"d56df8d794c1648a2282a698e0c21581dee616bade80bf9d05a06a56872dec23",
        ECommitmentMismatch);
}

#[test]
fun storage_hash_protocol_matches_javascript_golden() {
    let registry_id = object::id_from_address(@0x11);
    let root_id = object::id_from_address(@0x22);
    let row_bytes = bcs::to_bytes(&new_track_row_v2(
        0, b"back".to_string(), b"Track".to_string(), 8, true));
    let row_hash = registry_row_commitment_v2(registry_id, root_id, 3, CATEGORY_TRACK, 0, row_bytes);
    let tags = vector[0, 1, 2, 3, 4, 5, 6, 255];
    let mut seals = vector[];
    let mut index = 0;
    while (index < tags.length()) {
        let tag = tags[index];
        let empty = registry_empty_commitment_v2(registry_id, root_id, 3, tag);
        if (tag == CATEGORY_TRACK) assert!(empty
            == x"758a18ae2bbbc1c3db0576829bc69e55a002fe32c4217b9caa0f6e3d3cf95d79", ECommitmentMismatch);
        let populated = tag == CATEGORY_TRACK || tag == CATEGORY_AGGREGATE;
        let rolling = if (populated) {
            registry_advance_commitment_v2(registry_id, tag, 0, empty, row_hash)
        } else { empty };
        seals.push_back(registry_category_seal_commitment_v2(
            registry_id, root_id, 3, tag, if (populated) 1 else 0, empty, rolling));
        index = index + 1;
    };
    assert!(registry_seal_commitment_v2(registry_id, root_id, 3, tags, seals, 1)
        == x"d61c26fd57b05e6e0f23a8dece1e2d76b4dc8161ffde79a4f94f3578df1771d0", ECommitmentMismatch);
}

#[test, expected_failure(abort_code = ECommitmentMismatch)]
fun author_intent_rejects_same_count_rule_edit() { exercise_registry_readers(8); }

#[test, expected_failure(abort_code = 15, location = animacraft_v8_core::maker_v8)]
fun seal_rejects_wrong_root_identity() { exercise_registry_readers(9); }

#[test, expected_failure(abort_code = 15, location = animacraft_v8_core::maker_v8)]
fun seal_rejects_other_registry_id() { exercise_registry_readers(10); }

#[test, expected_failure(abort_code = EInvalidLifecycle)]
fun seal_cannot_install_twice() { exercise_registry_readers(11); }

#[test, expected_failure(abort_code = 28, location = animacraft_v8_core::maker_v8)]
fun root_rejects_unsealed_base_commitment() { exercise_registry_readers(12); }


#[test_only]
fun exercise_registry_readers(case: u8) {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 201, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (config, protocol_cap) =
        protocol::new_protocol_for_testing<sui::sui::SUI>(true, &mut ctx);
    let economics = maker::new_economics_snapshot_v8<sui::sui::SUI>(
        &config,
        0,
        0,
        0,
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
    let expected_counts = new_base_definition_counts_v8(1, 1, 1, 1, 1, 1, 1);
    let (mut root, admin) = maker::new_initial_maker_draft_v8<sui::sui::SUI>(
        &config,
        7,
        test_author_fixture_commitment(case == 6),
        test_hash(6),
        b"maker".to_string(),
        test_hash(9),
        test_hash(10),
        test_hash(11),
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
        &mut ctx,
    );
    maker::finalize_base_registry_binding_v8(
        &mut root,
        &admin,
        object::id(&registry),
    );
    let mut track = test_track_row_v2();
    if (case == 7) track.locked = !track.locked;
    append_track_v2(&mut registry, &root, &admin, track);
    append_color_v2(&mut registry, &root, &admin, test_color_row_v2());
    append_part_v2(&mut registry, &root, &admin, test_part_row_v2());
    let mut item_row = test_item_row_v2();
    if (case == 6) item_row.status = ITEM_PRIVATE;
    append_item_v2(&mut registry, &root, &admin, item_row);
    append_style_v2(&mut registry, &root, &admin, test_style_row_v2());
    let mut expected_rule = test_rule_row_v2();
    if (case == 8) expected_rule.payload_commitment = test_hash(16);
    append_rule_v2(&mut registry, &root, &admin, expected_rule);
    append_asset_v2(&mut registry, &root, &admin, test_asset_row_v2());
    if (case == 4) { let _ = borrow_track_v2(&registry, b"track".to_string()); };
    if (case == 5) {
        let _ = borrow_color_v2(&registry, b"palette".to_string(), b"alternate".to_string());
    };
    if (case == 9) registry.root_id = object::id_from_address(@0xBAD);
    if (case == 10) {
        let mut other_registry = new_base_definition_registry_v8(
            &root, &admin, expected_counts, &mut ctx);
        seal_base_definition_registry_v8(&mut other_registry, &mut root, &admin);
        share_base_definition_registry_v8(other_registry);
    };
    if (case == 12) { let _ = maker::root_sealed_base_registry_commitment_v2(&root); };
    seal_base_definition_registry_v8(&mut registry, &mut root, &admin);
    if (case == 11) seal_base_definition_registry_v8(&mut registry, &mut root, &admin);
    if (case == 1) { let _ = borrow_track_v2(&registry, b"absent".to_string()); };
    if (case == 2) {
        let _ = borrow_color_v2(&registry, b"absent".to_string(), b"alternate".to_string());
    };
    if (case == 3) {
        let _ = borrow_color_v2(&registry, b"palette".to_string(), b"absent".to_string());
    };
    let track = borrow_track_v2(&registry, b"track".to_string());
    assert!(*track == test_track_row_v2(), ECommitmentMismatch);
    let swatch = borrow_color_v2(&registry, b"palette".to_string(), b"alternate".to_string());
    assert!(swatch.key == b"alternate".to_string()
        && swatch.label == b"Alternate".to_string() && swatch.rgba == 0xaabbccff
        && swatch.stops.is_empty(), ECommitmentMismatch);
    let part = borrow_part_v2(&registry, b"part".to_string());
    let (part_key, part_sequence, required, part_payload) = part_identity_terms_v2(part);
    assert!(*part_key == b"part".to_string() && part_sequence == 0 && required,
        ECommitmentMismatch);
    assert!(*part_payload == test_hash(11), ECommitmentMismatch);
    let item = borrow_item_v2(&registry, b"part".to_string(), b"item".to_string());
    assert_public_item_v2(item);
    assert!(*item_payload_commitment_v2(item) == test_hash(12), ECommitmentMismatch);
    assert!(registry_rule_count_v2(&registry) == 1, ECountMismatch);
    let rule = borrow_rule_at_v2(&registry, 0);
    let (kind, trigger, target_mode, targets, payload) = rule_terms_v2(rule);
    assert!(kind == RULE_REQUIRE && target_mode == TARGET_ANY
        && targets.length() == 1 && *payload == test_hash(15), ECommitmentMismatch);
    let (source, source_key, part_key, item_key, style_key) = semantic_selector_terms_v2(trigger);
    assert!(source == SOURCE_BASE && source_key.is_none()
        && *part_key == b"part".to_string()
        && *item_key.borrow() == b"item".to_string()
        && *style_key.borrow() == b"style".to_string(), ECommitmentMismatch);
    let (source, source_key, part_key, item_key, style_key) = semantic_selector_terms_v2(&targets[0]);
    assert!(source == SOURCE_PACK && *source_key.borrow() == b"pack-a".to_string()
        && *part_key == b"part".to_string()
        && *item_key.borrow() == b"pack-item".to_string()
        && style_key.is_none(), ECommitmentMismatch);
    let style = borrow_style_v2(
        &registry, b"part".to_string(), b"item".to_string(), b"style".to_string());
    let expected_style = test_style_row_v2();
    assert!(style_payload_commitment_v2(style) == &expected_style.payload_commitment, ECommitmentMismatch);
    assert!(style_asset_blob_id_v2(style) == &expected_style.asset_blob_id, ECommitmentMismatch);
    assert!(style_asset_sha256_v2(style) == &expected_style.asset_sha256, ECommitmentMismatch);
    assert!(style_layer_track_key_v2(style) == &expected_style.track_key, ECommitmentMismatch);
    assert!(style_color_channel_key_v2(style) == &expected_style.color_channel_key, ECommitmentMismatch);
    assert!(style_protected_v2(style) == expected_style.protected, ECommitmentMismatch);
    assert!(style_part_key_v2(style) == &expected_style.part_key, ECommitmentMismatch);
    assert!(style_item_key_v2(style) == &expected_style.item_key, ECommitmentMismatch);
    assert!(style_key_v2(style) == &expected_style.style_key, ECommitmentMismatch);
    assert!(style_default_swatch_key_v2(style) == &expected_style.default_swatch_key, ECommitmentMismatch);
    assert!(registry_sealed_v2(&registry), EInvalidLifecycle);
    assert!(registry_part_count_v2(&registry) == 1, ECountMismatch);
    assert!(registry_track_count_v2(&registry) == 1, ECountMismatch);
    assert!(registry_root_id_v2(&registry) == maker::root_id_v8(&root), ERegistryMismatch);
    assert!(registry_maker_version_v2(&registry) == maker::root_maker_version_v8(&root), ERegistryMismatch);
    assert!(registry_root_content_commitment_v2(&registry) == maker::root_content_commitment_v8(&root), ECommitmentMismatch);
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
    assert_hash(&aggregate);
    assert!(&aggregate == maker::root_sealed_base_registry_commitment_v2(&root), ECommitmentMismatch);
    assert!(&aggregate != maker::root_expected_base_registry_commitment_v8(&root), ECommitmentMismatch);
    assert!(protected_count == 0, ECountMismatch);
    share_base_definition_registry_v8(registry);
    maker::destroy_maker_for_testing(root, next_admin);
    protocol::destroy_protocol_for_testing(config, protocol_cap);
    clock.destroy_for_testing();
}

#[test_only]
public fun populate_and_seal_minimal_for_testing<PaymentCoin>(
    registry: &mut BaseDefinitionRegistryV8,
    root: &mut MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
) {
    append_track_v2(registry, root, admin, test_track_row_v2());
    append_part_v2(registry, root, admin, test_part_row_v2());
    append_item_v2(registry, root, admin, test_item_row_v2());
    append_style_v2(registry, root, admin, test_style_row_v2());
    append_asset_v2(registry, root, admin, test_asset_row_v2());
    seal_base_definition_registry_v8(registry, root, admin);
}

#[test_only]
fun test_track_row_v2(): TrackRowV2 {
    new_track_row_v2(
        0, b"track".to_string(), b"Track".to_string(), 0, false)
}

#[test_only]
fun test_color_row_v2(): ColorChannelRowV2 {
    new_color_channel_row_v2(
        0, b"palette".to_string(), b"Palette".to_string(), b"default".to_string(),
        vector[
            new_color_swatch_v2(b"default".to_string(), b"Default".to_string(),
                0x112233ff, vector[]),
            new_color_swatch_v2(b"alternate".to_string(), b"Alternate".to_string(),
                0xaabbccff, vector[]),
        ])
}

#[test_only]
fun test_rule_row_v2(): RuleRowV2 {
    new_rule_row_v2(
        0, b"require-pack".to_string(), RULE_REQUIRE,
        new_semantic_selector_v2(SOURCE_BASE, option::none(), b"part".to_string(),
            option::some(b"item".to_string()), option::some(b"style".to_string())),
        TARGET_ANY,
        vector[new_semantic_selector_v2(SOURCE_PACK, option::some(b"pack-a".to_string()),
            b"part".to_string(), option::some(b"pack-item".to_string()), option::none())],
        test_hash(15))
}

#[test_only]
fun test_author_fixture_commitment(private_item: bool): vector<u8> {
    let mut item = test_item_row_v2();
    if (private_item) item.status = ITEM_PRIVATE;
    let rows = vector[
        bcs::to_bytes(&test_track_row_v2()), bcs::to_bytes(&test_color_row_v2()),
        bcs::to_bytes(&test_part_row_v2()), bcs::to_bytes(&item),
        bcs::to_bytes(&test_style_row_v2()), bcs::to_bytes(&test_rule_row_v2()),
        bcs::to_bytes(&test_asset_row_v2()),
    ];
    let mut rolling = author_rows_empty_commitment_v2();
    let mut index = 0;
    while (index < rows.length()) {
        rolling = author_rows_advance_commitment_v2(
            index as u8, 0, index, rolling, rows[index]);
        index = index + 1;
    };
    author_rows_seal_commitment_v2(vector[1, 1, 1, 1, 1, 1, 1], rolling)
}

/// Author intent for the exact rows populated by the minimal fixture helper.
#[test_only]
public fun minimal_author_rows_commitment_for_testing(): vector<u8> {
    let rows = vector[
        bcs::to_bytes(&test_track_row_v2()), bcs::to_bytes(&test_part_row_v2()),
        bcs::to_bytes(&test_item_row_v2()), bcs::to_bytes(&test_style_row_v2()),
        bcs::to_bytes(&test_asset_row_v2()),
    ];
    let categories = vector[CATEGORY_TRACK, CATEGORY_PART, CATEGORY_ITEM, CATEGORY_STYLE, CATEGORY_ASSET];
    let mut rolling = author_rows_empty_commitment_v2();
    let mut index = 0;
    while (index < rows.length()) {
        rolling = author_rows_advance_commitment_v2(
            categories[index], 0, index, rolling, rows[index]);
        index = index + 1;
    };
    author_rows_seal_commitment_v2(vector[1, 0, 1, 1, 1, 0, 1], rolling)
}

#[test_only]
fun test_part_row_v2(): PartRowV2 {
    let tokens = vector[];
    let visibility_commitment = visibility_program_commitment_v1(
        SOURCE_BASE, option::none(), SUBJECT_PART, b"part".to_string(),
        option::none(), option::none(), &tokens);
    new_part_row_v2(
        0, b"part".to_string(), b"Part".to_string(), PART_STANDARD,
        0, 0, true, true, SLOT_FIXED, 1, vector[b"track".to_string()],
        tokens, visibility_commitment, test_hash(11))
}

#[test_only]
fun test_item_row_v2(): ItemRowV2 {
    let tokens = vector[];
    let visibility_commitment = visibility_program_commitment_v1(
        SOURCE_BASE, option::none(), SUBJECT_ITEM, b"part".to_string(),
        option::some(b"item".to_string()), option::none(), &tokens);
    new_item_row_v2(
        0, b"part".to_string(), b"item".to_string(), b"Item".to_string(),
        ITEM_PUBLIC, 0, b"style".to_string(), tokens,
        visibility_commitment, test_hash(12))
}

#[test_only]
fun test_style_row_v2(): StyleRowV2 {
    let tokens = vector[];
    let visibility_commitment = visibility_program_commitment_v1(
        SOURCE_BASE, option::none(), SUBJECT_STYLE, b"part".to_string(),
        option::some(b"item".to_string()),
        option::some(b"style".to_string()), &tokens);
    new_style_row_v2(
        0, b"part".to_string(), b"item".to_string(), b"style".to_string(),
        b"Style".to_string(), 0, b"track".to_string(), option::none(),
        option::none(), b"style-asset".to_string(),
        b"style-blob".to_string(), test_hash(13), false,
        new_transform_fixed_v1(
            new_signed_milli_v1(false, 0),
            new_signed_milli_v1(false, 0),
            1_000_000,
            new_signed_milli_v1(false, 0)),
        1_000_000, BLEND_NORMAL, option::none(), tokens,
        visibility_commitment, test_hash(14))
}

#[test_only]
fun test_asset_row_v2(): AssetRowV2 {
    new_asset_row_v2(
        0,
        b"style-asset".to_string(),
        b"image".to_string(),
        b"image/png".to_string(),
        32,
        test_hash(13),
    )
}

#[test_only]
fun test_hash(byte: u8): vector<u8> {
    let mut value = vector[];
    let mut index = 0u64;
    while (index < 32) {
        value.push_back(byte);
        index = index + 1;
    };
    value
}
