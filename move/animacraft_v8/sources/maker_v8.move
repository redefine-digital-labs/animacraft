module animacraft_v8::maker_v8;

use animacraft_v8::protocol_config_v8::{
    Self as protocol,
    ProtocolAdminCapV8,
    ProtocolConfigV8,
    ProtocolTreasuryV8,
};
use std::bcs;
use std::hash;
use std::option::{Self as option, Option};
use std::string::{Self as string, String};
use std::type_name;
use sui::balance::{Self as balance, Balance};
use sui::clock::Clock;
use sui::coin::{Self as coin, Coin};
use sui::dynamic_field as df;
use sui::event;

const VERSION: u64 = 8;
const HASH_LENGTH: u64 = 32;
const BPS_DENOMINATOR: u64 = 10_000;

const DRAFT: u8 = 0;
const ACTIVE: u8 = 1;
const PAUSED: u8 = 2;
const ARCHIVED: u8 = 3;

const ACCESS_FREE: u8 = 0;
const ACCESS_PAID: u8 = 1;
const RIGHTS_ONCHAIN_NATIVE: u8 = 0;
const RIGHTS_LICENSE_WRAPPED: u8 = 1;

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
const MAX_SLOTS: u64 = 1_000;
const MAX_PACK_RELEASES: u64 = 1_000;
const MAX_PROTECTED_ASSETS: u64 = 10_000;
const MAX_KEY_BYTES: u64 = 128;
const MAX_LABEL_BYTES: u64 = 256;
const MAX_BLOB_ID_BYTES: u64 = 512;

const EInvalidLifecycle: u64 = 0;
const EInvalidAdminCap: u64 = 1;
const ENotCurrentOwner: u64 = 2;
const EInvalidTreasury: u64 = 3;
const EInvalidDigest: u64 = 4;
const EInvalidString: u64 = 5;
const EInvalidCounts: u64 = 6;
const EWrongSequence: u64 = 7;
const EDuplicateRow: u64 = 8;
const EMissingParentRow: u64 = 9;
const ECommitmentMismatch: u64 = 10;
const ECountMismatch: u64 = 11;
const EInvalidEconomics: u64 = 12;
const EInvalidRights: u64 = 13;
const EInvalidCapabilities: u64 = 14;
const ECapabilityBindingMismatch: u64 = 15;
const EWrongPayment: u64 = 16;
const EEntitlementExists: u64 = 17;
const EEntitlementMissing: u64 = 18;
const EInvalidRecipient: u64 = 19;
const EInsufficientRevenue: u64 = 20;
const EOwnershipEpochMismatch: u64 = 21;
const EInvalidLineage: u64 = 22;
const EInvalidCategory: u64 = 23;
const EInvalidProtocol: u64 = 24;
const ETerminalLifecycle: u64 = 25;
const ECapabilityIdCollision: u64 = 26;

public struct RowCountsV8 has copy, drop, store {
    tracks: u64,
    parts: u64,
    items: u64,
    styles: u64,
    colors: u64,
    rules: u64,
    slots: u64,
    pack_releases: u64,
    protected_assets: u64,
}

public struct RegistryCommitmentsV8 has copy, drop, store {
    tracks: vector<u8>,
    parts: vector<u8>,
    items: vector<u8>,
    styles: vector<u8>,
    colors: vector<u8>,
    rules: vector<u8>,
    aggregate: vector<u8>,
}

public struct CapabilityCommitmentsV8 has copy, drop, store {
    composition: vector<u8>,
    pack: vector<u8>,
    complete: vector<u8>,
    seal: vector<u8>,
    physical: Option<vector<u8>>,
}

public struct EconomicsV8 has copy, drop, store {
    maker_access: u8,
    maker_price_atomic: u64,
    complete_access: u8,
    complete_price_atomic: u64,
    complete_per_wallet_quota: u64,
    complete_total_cap: u64,
    protocol_fee_bps: u16,
    commitment: vector<u8>,
}

public struct RightsV8 has copy, drop, store {
    origin: u8,
    creator_confirmed: bool,
    soul_creator_royalty_bps: u16,
    maker_source_royalty_bps: u16,
    maker_resale_royalty_bps: u16,
    commitment: vector<u8>,
}

public struct CapabilityBindingsV8 has copy, drop, store {
    composition_registry_id: Option<ID>,
    pack_registry_id: Option<ID>,
    complete_registry_id: Option<ID>,
    seal_registry_id: Option<ID>,
    physical_registry_id: Option<ID>,
}

public struct TrackKeyV8 has copy, drop, store { key: String }
public struct PartKeyV8 has copy, drop, store { key: String }
public struct ItemKeyV8 has copy, drop, store { part_key: String, item_key: String }
public struct StyleKeyV8 has copy, drop, store {
    part_key: String,
    item_key: String,
    style_key: String,
}
public struct ColorKeyV8 has copy, drop, store { channel_key: String, swatch_key: String }
public struct RuleKeyV8 has copy, drop, store { key: String }
public struct EntitlementKeyV8 has copy, drop, store { wallet: address }

public struct TrackRowV8 has copy, drop, store {
    sequence: u64,
    key: String,
    label: String,
    render_order: u64,
    required: bool,
    payload_commitment: vector<u8>,
}

public struct PartRowV8 has copy, drop, store {
    sequence: u64,
    key: String,
    track_key: String,
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

public struct EntitlementRecordV8 has copy, drop, store {
    pass_id: ID,
    wallet: address,
    paid_atomic: u64,
    issued_at_ms: u64,
    ownership_epoch: u64,
    content_commitment: vector<u8>,
}

public struct MakerRootV8<phantom PaymentCoin> has key {
    id: UID,
    version: u64,
    package_id: ID,
    protocol_config_id: ID,
    protocol_config_revision: u64,
    protocol_config_commitment: vector<u8>,
    protocol_treasury_id: ID,
    creator: address,
    owner: address,
    admin_cap_id: ID,
    treasury_id: ID,
    ownership_epoch: u64,
    lifecycle: u8,
    maker_key: String,
    maker_version: String,
    version_commitment: vector<u8>,
    previous_root_id: Option<ID>,
    previous_version_commitment: Option<vector<u8>>,
    renderer_commitment: vector<u8>,
    manifest_blob_id: String,
    manifest_sha256: vector<u8>,
    content_commitment: vector<u8>,
    payment_coin_type: String,
    declared_capabilities: u64,
    economics: EconomicsV8,
    rights: RightsV8,
    expected_counts: RowCountsV8,
    observed_counts: RowCountsV8,
    expected_registry_commitments: RegistryCommitmentsV8,
    rolling_registry_commitments: RegistryCommitmentsV8,
    expected_capability_commitments: CapabilityCommitmentsV8,
    capability_bindings: CapabilityBindingsV8,
    next_sequence: u64,
    expected_sequence_count: u64,
    protected_style_count: u64,
    entitlement_count: u64,
    created_at_ms: u64,
    activated_at_ms: u64,
}

public struct MakerAdminCapV8 has key {
    id: UID,
    version: u64,
    root_id: ID,
    treasury_id: ID,
    owner: address,
    ownership_epoch: u64,
}

public struct MakerTreasuryV8<phantom PaymentCoin> has key {
    id: UID,
    version: u64,
    root_id: ID,
    revenue: Balance<PaymentCoin>,
    total_collected: u64,
    total_withdrawn: u64,
}

public struct MakerPassV8 has key {
    id: UID,
    version: u64,
    root_id: ID,
    holder: address,
    paid_atomic: u64,
    issued_at_ms: u64,
    ownership_epoch: u64,
    content_commitment: vector<u8>,
}

/// Non-store activation tuple. publication_v8 constructs it only after every
/// concrete registry has independently verified its sealed state.
public struct ActivationBindingsV8 {
    composition_registry_id: ID,
    composition_commitment: vector<u8>,
    composition_slot_count: u64,
    pack_registry_id: ID,
    pack_commitment: vector<u8>,
    pack_release_count: u64,
    complete_registry_id: ID,
    complete_commitment: vector<u8>,
    seal_registry_id: ID,
    seal_commitment: vector<u8>,
    protected_asset_count: u64,
    physical_registry_id: Option<ID>,
    physical_commitment: Option<vector<u8>>,
}

public struct RollingCommitmentInputV8 has drop {
    domain: vector<u8>,
    category: u8,
    previous: vector<u8>,
    sequence: u64,
    row_bytes: vector<u8>,
}

public struct VersionCommitmentInputV8 has drop {
    version: u64,
    package_id: ID,
    maker_key: String,
    maker_version: String,
    previous_root_id: Option<ID>,
    previous_version_commitment: Option<vector<u8>>,
    renderer_commitment: vector<u8>,
    manifest_blob_id: String,
    manifest_sha256: vector<u8>,
    content_commitment: vector<u8>,
}

public struct EconomicsCommitmentInputV8 has drop {
    maker_access: u8,
    maker_price_atomic: u64,
    complete_access: u8,
    complete_price_atomic: u64,
    complete_per_wallet_quota: u64,
    complete_total_cap: u64,
    protocol_fee_bps: u16,
}

public struct RightsCommitmentInputV8 has drop {
    origin: u8,
    creator_confirmed: bool,
    soul_creator_royalty_bps: u16,
    maker_source_royalty_bps: u16,
    maker_resale_royalty_bps: u16,
}

public struct MakerV8Activated has copy, drop {
    root_id: ID,
    version: u64,
    package_id: ID,
    owner: address,
    ownership_epoch: u64,
    admin_cap_id: ID,
    treasury_id: ID,
    protocol_config_id: ID,
    protocol_treasury_id: ID,
    maker_key: String,
    maker_version: String,
    version_commitment: vector<u8>,
    manifest_blob_id: String,
    manifest_sha256: vector<u8>,
    content_commitment: vector<u8>,
    renderer_commitment: vector<u8>,
    aggregate_registry_commitment: vector<u8>,
    declared_capabilities: u64,
    composition_registry_id: ID,
    pack_registry_id: ID,
    complete_registry_id: ID,
    seal_registry_id: ID,
    physical_registry_id: Option<ID>,
    maker_access: u8,
    maker_price_atomic: u64,
    activated_at_ms: u64,
}

public struct MakerV8LifecycleChanged has copy, drop {
    root_id: ID,
    owner: address,
    ownership_epoch: u64,
    from: u8,
    to: u8,
}

public struct MakerV8OwnershipTransferred has copy, drop {
    root_id: ID,
    from: address,
    to: address,
    ownership_epoch: u64,
}

public struct MakerPassV8Issued has copy, drop {
    root_id: ID,
    pass_id: ID,
    holder: address,
    paid_atomic: u64,
    ownership_epoch: u64,
    content_commitment: vector<u8>,
}

public struct MakerRevenueV8Withdrawn has copy, drop {
    root_id: ID,
    treasury_id: ID,
    operator: address,
    recipient: address,
    amount: u64,
}

public fun version_v8(): u64 { VERSION }
public fun lifecycle_draft_v8(): u8 { DRAFT }
public fun lifecycle_active_v8(): u8 { ACTIVE }
public fun lifecycle_paused_v8(): u8 { PAUSED }
public fun lifecycle_archived_v8(): u8 { ARCHIVED }
public fun access_free_v8(): u8 { ACCESS_FREE }
public fun access_paid_v8(): u8 { ACCESS_PAID }
public fun rights_onchain_native_v8(): u8 { RIGHTS_ONCHAIN_NATIVE }
public fun rights_license_wrapped_v8(): u8 { RIGHTS_LICENSE_WRAPPED }
public fun category_track_v8(): u8 { CATEGORY_TRACK }
public fun category_part_v8(): u8 { CATEGORY_PART }
public fun category_item_v8(): u8 { CATEGORY_ITEM }
public fun category_style_v8(): u8 { CATEGORY_STYLE }
public fun category_color_v8(): u8 { CATEGORY_COLOR }
public fun category_rule_v8(): u8 { CATEGORY_RULE }

public fun new_row_counts_v8(
    tracks: u64,
    parts: u64,
    items: u64,
    styles: u64,
    colors: u64,
    rules: u64,
    slots: u64,
    pack_releases: u64,
    protected_assets: u64,
): RowCountsV8 {
    let counts = RowCountsV8 {
        tracks,
        parts,
        items,
        styles,
        colors,
        rules,
        slots,
        pack_releases,
        protected_assets,
    };
    assert_valid_expected_counts(&counts);
    counts
}

public fun new_registry_commitments_v8(
    tracks: vector<u8>,
    parts: vector<u8>,
    items: vector<u8>,
    styles: vector<u8>,
    colors: vector<u8>,
    rules: vector<u8>,
    aggregate: vector<u8>,
): RegistryCommitmentsV8 {
    assert_digest(&tracks);
    assert_digest(&parts);
    assert_digest(&items);
    assert_digest(&styles);
    assert_digest(&colors);
    assert_digest(&rules);
    assert_digest(&aggregate);
    RegistryCommitmentsV8 { tracks, parts, items, styles, colors, rules, aggregate }
}

public fun new_capability_commitments_v8(
    composition: vector<u8>,
    pack: vector<u8>,
    complete: vector<u8>,
    seal: vector<u8>,
    physical: Option<vector<u8>>,
): CapabilityCommitmentsV8 {
    assert_digest(&composition);
    assert_digest(&pack);
    assert_digest(&complete);
    assert_digest(&seal);
    if (physical.is_some()) assert_digest(physical.borrow());
    CapabilityCommitmentsV8 { composition, pack, complete, seal, physical }
}

public fun new_economics_v8(
    maker_access: u8,
    maker_price_atomic: u64,
    complete_access: u8,
    complete_price_atomic: u64,
    complete_per_wallet_quota: u64,
    complete_total_cap: u64,
    protocol_fee_bps: u16,
): EconomicsV8 {
    assert_valid_access(maker_access, maker_price_atomic);
    assert_valid_access(complete_access, complete_price_atomic);
    assert!(complete_total_cap == 0 || complete_per_wallet_quota <= complete_total_cap, EInvalidEconomics);
    assert!((protocol_fee_bps as u64) <= BPS_DENOMINATOR, EInvalidEconomics);
    let commitment = hash::sha2_256(bcs::to_bytes(&EconomicsCommitmentInputV8 {
        maker_access,
        maker_price_atomic,
        complete_access,
        complete_price_atomic,
        complete_per_wallet_quota,
        complete_total_cap,
        protocol_fee_bps,
    }));
    EconomicsV8 {
        maker_access,
        maker_price_atomic,
        complete_access,
        complete_price_atomic,
        complete_per_wallet_quota,
        complete_total_cap,
        protocol_fee_bps,
        commitment,
    }
}

public fun new_rights_v8(
    origin: u8,
    creator_confirmed: bool,
    soul_creator_royalty_bps: u16,
    maker_source_royalty_bps: u16,
    maker_resale_royalty_bps: u16,
): RightsV8 {
    assert!(origin == RIGHTS_ONCHAIN_NATIVE || origin == RIGHTS_LICENSE_WRAPPED, EInvalidRights);
    assert!(creator_confirmed, EInvalidRights);
    assert!((soul_creator_royalty_bps as u64) <= BPS_DENOMINATOR, EInvalidRights);
    assert!((maker_source_royalty_bps as u64) <= BPS_DENOMINATOR, EInvalidRights);
    assert!((maker_resale_royalty_bps as u64) <= BPS_DENOMINATOR, EInvalidRights);
    let commitment = hash::sha2_256(bcs::to_bytes(&RightsCommitmentInputV8 {
        origin,
        creator_confirmed,
        soul_creator_royalty_bps,
        maker_source_royalty_bps,
        maker_resale_royalty_bps,
    }));
    RightsV8 {
        origin,
        creator_confirmed,
        soul_creator_royalty_bps,
        maker_source_royalty_bps,
        maker_resale_royalty_bps,
        commitment,
    }
}

public fun empty_category_commitment_v8(category: u8): vector<u8> {
    assert_valid_category(category);
    hash::sha2_256(bcs::to_bytes(&RollingCommitmentInputV8 {
        domain: b"animacraft-v8/empty-registry",
        category,
        previous: vector[],
        sequence: 0,
        row_bytes: vector[],
    }))
}

public fun advance_commitment_v8(
    category: u8,
    previous: vector<u8>,
    sequence: u64,
    row_bytes: vector<u8>,
): vector<u8> {
    assert_valid_category(category);
    assert_digest(&previous);
    assert!(row_bytes.length() > 0, EInvalidDigest);
    hash::sha2_256(bcs::to_bytes(&RollingCommitmentInputV8 {
        domain: b"animacraft-v8/append-row",
        category,
        previous,
        sequence,
        row_bytes,
    }))
}

/// Package orchestrators call this once after Walrus certification and before
/// constructing the four required empty registries. No v4-v7 object is an
/// input, so this TypeOrigin cannot become a migration path accidentally.
public(package) fun new_maker_v8<PaymentCoin>(
    config: &ProtocolConfigV8,
    maker_key: String,
    maker_version: String,
    previous_root_id: Option<ID>,
    previous_version_commitment: Option<vector<u8>>,
    renderer_commitment: vector<u8>,
    manifest_blob_id: String,
    manifest_sha256: vector<u8>,
    content_commitment: vector<u8>,
    expected_counts: RowCountsV8,
    expected_registry_commitments: RegistryCommitmentsV8,
    expected_capability_commitments: CapabilityCommitmentsV8,
    declared_capabilities: u64,
    economics: EconomicsV8,
    rights: RightsV8,
    clock: &Clock,
    ctx: &mut TxContext,
): (MakerRootV8<PaymentCoin>, MakerTreasuryV8<PaymentCoin>, MakerAdminCapV8) {
    protocol::assert_begin_config_v8<PaymentCoin>(config, declared_capabilities);
    assert_non_empty_bounded(&maker_key, MAX_KEY_BYTES);
    assert_non_empty_bounded(&maker_version, MAX_KEY_BYTES);
    assert_non_empty_bounded(&manifest_blob_id, MAX_BLOB_ID_BYTES);
    assert_digest(&renderer_commitment);
    assert_digest(&manifest_sha256);
    assert_digest(&content_commitment);
    assert_valid_expected_counts(&expected_counts);
    assert_expected_registry_commitments(&expected_registry_commitments);
    assert_capability_declaration(
        declared_capabilities,
        &expected_capability_commitments,
    );
    assert!(economics.protocol_fee_bps == protocol::config_primary_protocol_fee_bps_v8(config), EInvalidProtocol);
    assert_lineage(&previous_root_id, &previous_version_commitment);

    let package_id = object::id_from_address(type_name::defining_id<MakerRootV8<PaymentCoin>>());
    assert!(package_id == protocol::config_package_id_v8(config), EInvalidProtocol);
    let root_uid = object::new(ctx);
    let root_id = root_uid.to_inner();
    let treasury = MakerTreasuryV8<PaymentCoin> {
        id: object::new(ctx),
        version: VERSION,
        root_id,
        revenue: balance::zero(),
        total_collected: 0,
        total_withdrawn: 0,
    };
    let treasury_id = object::id(&treasury);
    let owner = ctx.sender();
    let admin = MakerAdminCapV8 {
        id: object::new(ctx),
        version: VERSION,
        root_id,
        treasury_id,
        owner,
        ownership_epoch: 0,
    };
    let admin_cap_id = object::id(&admin);
    let version_commitment = hash::sha2_256(bcs::to_bytes(&VersionCommitmentInputV8 {
        version: VERSION,
        package_id,
        maker_key,
        maker_version,
        previous_root_id,
        previous_version_commitment,
        renderer_commitment,
        manifest_blob_id,
        manifest_sha256,
        content_commitment,
    }));
    let protocol_treasury_id = protocol::config_treasury_id_v8(config);
    assert!(protocol_treasury_id.is_some(), EInvalidProtocol);
    let root = MakerRootV8<PaymentCoin> {
        id: root_uid,
        version: VERSION,
        package_id,
        protocol_config_id: protocol::config_id_v8(config),
        protocol_config_revision: protocol::config_revision_v8(config),
        protocol_config_commitment: *protocol::config_commitment_v8(config),
        protocol_treasury_id: *protocol_treasury_id.borrow(),
        creator: owner,
        owner,
        admin_cap_id,
        treasury_id,
        ownership_epoch: 0,
        lifecycle: DRAFT,
        maker_key,
        maker_version,
        version_commitment,
        previous_root_id,
        previous_version_commitment,
        renderer_commitment,
        manifest_blob_id,
        manifest_sha256,
        content_commitment,
        payment_coin_type: protocol::payment_coin_type_name_v8<PaymentCoin>(),
        declared_capabilities,
        economics,
        rights,
        expected_counts,
        observed_counts: zero_counts(),
        expected_registry_commitments,
        rolling_registry_commitments: empty_registry_commitments(),
        expected_capability_commitments,
        capability_bindings: empty_capability_bindings(),
        next_sequence: 0,
        expected_sequence_count: core_sequence_count(&expected_counts),
        protected_style_count: 0,
        entitlement_count: 0,
        created_at_ms: clock.timestamp_ms(),
        activated_at_ms: 0,
    };
    (root, treasury, admin)
}

public(package) fun share_maker_objects_v8<PaymentCoin>(
    root: MakerRootV8<PaymentCoin>,
    treasury: MakerTreasuryV8<PaymentCoin>,
    admin: MakerAdminCapV8,
    ctx: &TxContext,
) {
    assert!(admin.owner == ctx.sender(), ENotCurrentOwner);
    transfer::share_object(root);
    transfer::share_object(treasury);
    transfer::transfer(admin, ctx.sender());
}

public fun append_track_v8<PaymentCoin>(
    root: &mut MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    sequence: u64,
    key: String,
    label: String,
    render_order: u64,
    required: bool,
    payload_commitment: vector<u8>,
) {
    assert_draft_admin_v8(root, admin);
    assert_category_sequence(root, CATEGORY_TRACK, sequence);
    assert_non_empty_bounded(&key, MAX_KEY_BYTES);
    assert_non_empty_bounded(&label, MAX_LABEL_BYTES);
    assert_digest(&payload_commitment);
    let field_key = TrackKeyV8 { key };
    assert!(!df::exists(&root.id, field_key), EDuplicateRow);
    let row = TrackRowV8 {
        sequence,
        key,
        label,
        render_order,
        required,
        payload_commitment,
    };
    let row_bytes = bcs::to_bytes(&row);
    df::add(&mut root.id, field_key, row);
    root.observed_counts.tracks = root.observed_counts.tracks + 1;
    advance_root_commitments(root, CATEGORY_TRACK, sequence, row_bytes);
}

public fun append_part_v8<PaymentCoin>(
    root: &mut MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    sequence: u64,
    key: String,
    track_key: String,
    label: String,
    kind: u8,
    render_order: u64,
    required: bool,
    visible: bool,
    payload_commitment: vector<u8>,
) {
    assert_draft_admin_v8(root, admin);
    assert_category_sequence(root, CATEGORY_PART, sequence);
    assert_non_empty_bounded(&key, MAX_KEY_BYTES);
    assert_non_empty_bounded(&track_key, MAX_KEY_BYTES);
    assert_non_empty_bounded(&label, MAX_LABEL_BYTES);
    assert_digest(&payload_commitment);
    assert!(df::exists(&root.id, TrackKeyV8 { key: track_key }), EMissingParentRow);
    let field_key = PartKeyV8 { key };
    assert!(!df::exists(&root.id, field_key), EDuplicateRow);
    let row = PartRowV8 {
        sequence,
        key,
        track_key,
        label,
        kind,
        render_order,
        required,
        visible,
        payload_commitment,
    };
    let row_bytes = bcs::to_bytes(&row);
    df::add(&mut root.id, field_key, row);
    root.observed_counts.parts = root.observed_counts.parts + 1;
    advance_root_commitments(root, CATEGORY_PART, sequence, row_bytes);
}

public fun append_item_v8<PaymentCoin>(
    root: &mut MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    sequence: u64,
    part_key: String,
    item_key: String,
    label: String,
    gate_kind: u8,
    payload_commitment: vector<u8>,
) {
    assert_draft_admin_v8(root, admin);
    assert_category_sequence(root, CATEGORY_ITEM, sequence);
    assert_non_empty_bounded(&part_key, MAX_KEY_BYTES);
    assert_non_empty_bounded(&item_key, MAX_KEY_BYTES);
    assert_non_empty_bounded(&label, MAX_LABEL_BYTES);
    assert_digest(&payload_commitment);
    assert!(df::exists(&root.id, PartKeyV8 { key: part_key }), EMissingParentRow);
    let field_key = ItemKeyV8 { part_key, item_key };
    assert!(!df::exists(&root.id, field_key), EDuplicateRow);
    let row = ItemRowV8 {
        sequence,
        part_key,
        item_key,
        label,
        gate_kind,
        payload_commitment,
    };
    let row_bytes = bcs::to_bytes(&row);
    df::add(&mut root.id, field_key, row);
    root.observed_counts.items = root.observed_counts.items + 1;
    advance_root_commitments(root, CATEGORY_ITEM, sequence, row_bytes);
}

public fun append_style_v8<PaymentCoin>(
    root: &mut MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    sequence: u64,
    part_key: String,
    item_key: String,
    style_key: String,
    label: String,
    asset_blob_id: String,
    asset_sha256: vector<u8>,
    protected: bool,
    payload_commitment: vector<u8>,
) {
    assert_draft_admin_v8(root, admin);
    assert_category_sequence(root, CATEGORY_STYLE, sequence);
    assert_non_empty_bounded(&part_key, MAX_KEY_BYTES);
    assert_non_empty_bounded(&item_key, MAX_KEY_BYTES);
    assert_non_empty_bounded(&style_key, MAX_KEY_BYTES);
    assert_non_empty_bounded(&label, MAX_LABEL_BYTES);
    assert_non_empty_bounded(&asset_blob_id, MAX_BLOB_ID_BYTES);
    assert_digest(&asset_sha256);
    assert_digest(&payload_commitment);
    assert!(df::exists(&root.id, ItemKeyV8 { part_key, item_key }), EMissingParentRow);
    let field_key = StyleKeyV8 { part_key, item_key, style_key };
    assert!(!df::exists(&root.id, field_key), EDuplicateRow);
    let row = StyleRowV8 {
        sequence,
        part_key,
        item_key,
        style_key,
        label,
        asset_blob_id,
        asset_sha256,
        protected,
        payload_commitment,
    };
    let row_bytes = bcs::to_bytes(&row);
    df::add(&mut root.id, field_key, row);
    root.observed_counts.styles = root.observed_counts.styles + 1;
    if (protected) root.protected_style_count = root.protected_style_count + 1;
    advance_root_commitments(root, CATEGORY_STYLE, sequence, row_bytes);
}

public fun append_color_v8<PaymentCoin>(
    root: &mut MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    sequence: u64,
    channel_key: String,
    swatch_key: String,
    label: String,
    rgba: u32,
    payload_commitment: vector<u8>,
) {
    assert_draft_admin_v8(root, admin);
    assert_category_sequence(root, CATEGORY_COLOR, sequence);
    assert_non_empty_bounded(&channel_key, MAX_KEY_BYTES);
    assert_non_empty_bounded(&swatch_key, MAX_KEY_BYTES);
    assert_non_empty_bounded(&label, MAX_LABEL_BYTES);
    assert_digest(&payload_commitment);
    let field_key = ColorKeyV8 { channel_key, swatch_key };
    assert!(!df::exists(&root.id, field_key), EDuplicateRow);
    let row = ColorRowV8 {
        sequence,
        channel_key,
        swatch_key,
        label,
        rgba,
        payload_commitment,
    };
    let row_bytes = bcs::to_bytes(&row);
    df::add(&mut root.id, field_key, row);
    root.observed_counts.colors = root.observed_counts.colors + 1;
    advance_root_commitments(root, CATEGORY_COLOR, sequence, row_bytes);
}

public fun append_rule_v8<PaymentCoin>(
    root: &mut MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    sequence: u64,
    key: String,
    kind: u8,
    left_ref: String,
    right_ref: String,
    payload_commitment: vector<u8>,
) {
    assert_draft_admin_v8(root, admin);
    assert_category_sequence(root, CATEGORY_RULE, sequence);
    assert_non_empty_bounded(&key, MAX_KEY_BYTES);
    assert_non_empty_bounded(&left_ref, MAX_BLOB_ID_BYTES);
    assert_non_empty_bounded(&right_ref, MAX_BLOB_ID_BYTES);
    assert_digest(&payload_commitment);
    let field_key = RuleKeyV8 { key };
    assert!(!df::exists(&root.id, field_key), EDuplicateRow);
    let row = RuleRowV8 {
        sequence,
        key,
        kind,
        left_ref,
        right_ref,
        payload_commitment,
    };
    let row_bytes = bcs::to_bytes(&row);
    df::add(&mut root.id, field_key, row);
    root.observed_counts.rules = root.observed_counts.rules + 1;
    advance_root_commitments(root, CATEGORY_RULE, sequence, row_bytes);
}

public(package) fun new_activation_bindings_v8(
    composition_registry_id: ID,
    composition_commitment: vector<u8>,
    composition_slot_count: u64,
    pack_registry_id: ID,
    pack_commitment: vector<u8>,
    pack_release_count: u64,
    complete_registry_id: ID,
    complete_commitment: vector<u8>,
    seal_registry_id: ID,
    seal_commitment: vector<u8>,
    protected_asset_count: u64,
    physical_registry_id: Option<ID>,
    physical_commitment: Option<vector<u8>>,
): ActivationBindingsV8 {
    assert_digest(&composition_commitment);
    assert_digest(&pack_commitment);
    assert_digest(&complete_commitment);
    assert_digest(&seal_commitment);
    if (physical_commitment.is_some()) assert_digest(physical_commitment.borrow());
    ActivationBindingsV8 {
        composition_registry_id,
        composition_commitment,
        composition_slot_count,
        pack_registry_id,
        pack_commitment,
        pack_release_count,
        complete_registry_id,
        complete_commitment,
        seal_registry_id,
        seal_commitment,
        protected_asset_count,
        physical_registry_id,
        physical_commitment,
    }
}

/// This is the only function that can emit MakerV8Activated. The public
/// publication orchestrator supplies registry-derived values, never client
/// booleans, then this module commits the bindings and changes visibility.
public(package) fun activate_checked_v8<PaymentCoin>(
    root: &mut MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    treasury: &MakerTreasuryV8<PaymentCoin>,
    config: &ProtocolConfigV8,
    bindings: ActivationBindingsV8,
    clock: &Clock,
    ctx: &TxContext,
) {
    assert_draft_admin_v8(root, admin);
    assert!(root.owner == ctx.sender(), ENotCurrentOwner);
    assert_maker_treasury(root, treasury);
    protocol::assert_activation_snapshot_v8<PaymentCoin>(
        config,
        root.protocol_config_id,
        root.protocol_config_revision,
        &root.protocol_config_commitment,
        root.protocol_treasury_id,
        root.declared_capabilities,
        root.economics.protocol_fee_bps,
    );
    assert_core_rows_complete(root);

    let ActivationBindingsV8 {
        composition_registry_id,
        composition_commitment,
        composition_slot_count,
        pack_registry_id,
        pack_commitment,
        pack_release_count,
        complete_registry_id,
        complete_commitment,
        seal_registry_id,
        seal_commitment,
        protected_asset_count,
        physical_registry_id,
        physical_commitment,
    } = bindings;
    assert_distinct_binding_ids(
        root,
        composition_registry_id,
        pack_registry_id,
        complete_registry_id,
        seal_registry_id,
        &physical_registry_id,
    );
    assert!(composition_slot_count == root.expected_counts.slots, ECountMismatch);
    assert!(pack_release_count == root.expected_counts.pack_releases, ECountMismatch);
    assert!(protected_asset_count == root.expected_counts.protected_assets, ECountMismatch);
    assert!(root.protected_style_count <= protected_asset_count, ECountMismatch);
    assert!(composition_commitment == root.expected_capability_commitments.composition, ECapabilityBindingMismatch);
    assert!(pack_commitment == root.expected_capability_commitments.pack, ECapabilityBindingMismatch);
    assert!(complete_commitment == root.expected_capability_commitments.complete, ECapabilityBindingMismatch);
    assert!(seal_commitment == root.expected_capability_commitments.seal, ECapabilityBindingMismatch);
    assert_physical_binding(
        root,
        &physical_registry_id,
        &physical_commitment,
    );

    root.observed_counts.slots = composition_slot_count;
    root.observed_counts.pack_releases = pack_release_count;
    root.observed_counts.protected_assets = protected_asset_count;
    root.capability_bindings = CapabilityBindingsV8 {
        composition_registry_id: option::some(composition_registry_id),
        pack_registry_id: option::some(pack_registry_id),
        complete_registry_id: option::some(complete_registry_id),
        seal_registry_id: option::some(seal_registry_id),
        physical_registry_id,
    };
    root.lifecycle = ACTIVE;
    root.activated_at_ms = clock.timestamp_ms();
    event::emit(MakerV8Activated {
        root_id: object::id(root),
        version: root.version,
        package_id: root.package_id,
        owner: root.owner,
        ownership_epoch: root.ownership_epoch,
        admin_cap_id: root.admin_cap_id,
        treasury_id: root.treasury_id,
        protocol_config_id: root.protocol_config_id,
        protocol_treasury_id: root.protocol_treasury_id,
        maker_key: root.maker_key,
        maker_version: root.maker_version,
        version_commitment: root.version_commitment,
        manifest_blob_id: root.manifest_blob_id,
        manifest_sha256: root.manifest_sha256,
        content_commitment: root.content_commitment,
        renderer_commitment: root.renderer_commitment,
        aggregate_registry_commitment: root.rolling_registry_commitments.aggregate,
        declared_capabilities: root.declared_capabilities,
        composition_registry_id,
        pack_registry_id,
        complete_registry_id,
        seal_registry_id,
        physical_registry_id,
        maker_access: root.economics.maker_access,
        maker_price_atomic: root.economics.maker_price_atomic,
        activated_at_ms: root.activated_at_ms,
    });
}

public fun pause_maker_v8<PaymentCoin>(
    root: &mut MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    ctx: &TxContext,
) {
    assert_admin_v8(root, admin);
    assert!(root.owner == ctx.sender(), ENotCurrentOwner);
    assert!(root.lifecycle == ACTIVE, EInvalidLifecycle);
    set_lifecycle(root, PAUSED);
}

public(package) fun resume_checked_v8<PaymentCoin>(
    root: &mut MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    config: &ProtocolConfigV8,
    ctx: &TxContext,
) {
    assert_admin_v8(root, admin);
    assert!(root.owner == ctx.sender(), ENotCurrentOwner);
    assert!(root.lifecycle == PAUSED, EInvalidLifecycle);
    protocol::assert_operational_snapshot_v8<PaymentCoin>(
        config,
        root.protocol_config_id,
        root.protocol_treasury_id,
        root.declared_capabilities,
        root.economics.protocol_fee_bps,
    );
    assert_bindings_present(root);
    set_lifecycle(root, ACTIVE);
}

public fun archive_maker_v8<PaymentCoin>(
    root: &mut MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    ctx: &TxContext,
) {
    assert_admin_v8(root, admin);
    assert!(root.owner == ctx.sender(), ENotCurrentOwner);
    assert!(root.lifecycle == ACTIVE || root.lifecycle == PAUSED, EInvalidLifecycle);
    set_lifecycle(root, ARCHIVED);
}

/// The cap deliberately lacks store, so ownership cannot drift through a
/// generic transfer. publication_v8 rebinds every registry epoch before it
/// calls this package function and transfers the returned cap.
public(package) fun transfer_control_checked_v8<PaymentCoin>(
    root: &mut MakerRootV8<PaymentCoin>,
    mut admin: MakerAdminCapV8,
    recipient: address,
    ctx: &TxContext,
) {
    assert_admin_v8(root, &admin);
    assert!(root.owner == ctx.sender(), ENotCurrentOwner);
    assert!(root.lifecycle != DRAFT && root.lifecycle != ARCHIVED, EInvalidLifecycle);
    assert!(recipient != @0x0 && recipient != root.owner, EInvalidRecipient);
    let previous_owner = root.owner;
    root.owner = recipient;
    root.ownership_epoch = root.ownership_epoch + 1;
    admin.owner = recipient;
    admin.ownership_epoch = root.ownership_epoch;
    event::emit(MakerV8OwnershipTransferred {
        root_id: object::id(root),
        from: previous_owner,
        to: recipient,
        ownership_epoch: root.ownership_epoch,
    });
    transfer::transfer(admin, recipient);
}

public fun claim_free_maker_pass_v8<PaymentCoin>(
    root: &mut MakerRootV8<PaymentCoin>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert_active(root);
    assert!(root.economics.maker_access == ACCESS_FREE, EInvalidEconomics);
    issue_pass(root, 0, clock, ctx);
}

public fun purchase_maker_pass_v8<PaymentCoin>(
    root: &mut MakerRootV8<PaymentCoin>,
    maker_treasury: &mut MakerTreasuryV8<PaymentCoin>,
    config: &ProtocolConfigV8,
    protocol_treasury: &mut ProtocolTreasuryV8<PaymentCoin>,
    payment: Coin<PaymentCoin>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert_active(root);
    assert!(root.economics.maker_access == ACCESS_PAID, EInvalidEconomics);
    assert_maker_treasury(root, maker_treasury);
    protocol::assert_operational_snapshot_v8<PaymentCoin>(
        config,
        root.protocol_config_id,
        root.protocol_treasury_id,
        root.declared_capabilities,
        root.economics.protocol_fee_bps,
    );
    protocol::assert_protocol_treasury_v8(config, protocol_treasury);
    let price = root.economics.maker_price_atomic;
    assert!(payment.value() == price, EWrongPayment);
    let creator_payment = protocol::collect_protocol_primary_fee_v8(
        config,
        protocol_treasury,
        payment,
        ctx,
    );
    let creator_amount = creator_payment.value();
    coin::put(&mut maker_treasury.revenue, creator_payment);
    maker_treasury.total_collected = maker_treasury.total_collected + creator_amount;
    issue_pass(root, price, clock, ctx);
}

/// Canonical Complete settlement hook. complete_v8 owns quota/receipt state,
/// while this module alone can mutate the one Maker Treasury and enforce the
/// Root/config/payment snapshot.
public(package) fun collect_complete_payment_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    maker_treasury: &mut MakerTreasuryV8<PaymentCoin>,
    config: &ProtocolConfigV8,
    protocol_treasury: &mut ProtocolTreasuryV8<PaymentCoin>,
    payment: Coin<PaymentCoin>,
    ctx: &mut TxContext,
): u64 {
    assert_active(root);
    assert!(root.economics.complete_access == ACCESS_PAID, EInvalidEconomics);
    assert_maker_treasury(root, maker_treasury);
    protocol::assert_operational_snapshot_v8<PaymentCoin>(
        config,
        root.protocol_config_id,
        root.protocol_treasury_id,
        root.declared_capabilities,
        root.economics.protocol_fee_bps,
    );
    protocol::assert_protocol_treasury_v8(config, protocol_treasury);
    let gross = root.economics.complete_price_atomic;
    assert!(payment.value() == gross, EWrongPayment);
    let creator_payment = protocol::collect_protocol_primary_fee_v8(
        config,
        protocol_treasury,
        payment,
        ctx,
    );
    let creator_amount = creator_payment.value();
    coin::put(&mut maker_treasury.revenue, creator_payment);
    maker_treasury.total_collected = maker_treasury.total_collected + creator_amount;
    gross
}

public(package) fun assert_complete_free_v8<PaymentCoin>(root: &MakerRootV8<PaymentCoin>) {
    assert_active(root);
    assert!(root.economics.complete_access == ACCESS_FREE, EInvalidEconomics);
}

public fun withdraw_maker_revenue_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    treasury: &mut MakerTreasuryV8<PaymentCoin>,
    amount: u64,
    recipient: address,
    ctx: &mut TxContext,
) {
    assert_admin_v8(root, admin);
    assert!(root.owner == ctx.sender(), ENotCurrentOwner);
    assert_maker_treasury(root, treasury);
    assert!(recipient != @0x0, EInvalidRecipient);
    assert!(amount > 0 && amount <= treasury.revenue.value(), EInsufficientRevenue);
    let payment = coin::take(&mut treasury.revenue, amount, ctx);
    treasury.total_withdrawn = treasury.total_withdrawn + amount;
    event::emit(MakerRevenueV8Withdrawn {
        root_id: object::id(root),
        treasury_id: object::id(treasury),
        operator: ctx.sender(),
        recipient,
        amount,
    });
    transfer::public_transfer(payment, recipient);
}

public fun verify_maker_pass_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    pass: &MakerPassV8,
    wallet: address,
) {
    assert_active(root);
    assert!(pass.version == VERSION, EEntitlementMissing);
    assert!(pass.root_id == object::id(root), EEntitlementMissing);
    assert!(pass.holder == wallet, EEntitlementMissing);
    assert!(&pass.content_commitment == &root.content_commitment, EEntitlementMissing);
    assert!(df::exists(&root.id, EntitlementKeyV8 { wallet }), EEntitlementMissing);
    let record: &EntitlementRecordV8 = df::borrow(&root.id, EntitlementKeyV8 { wallet });
    assert!(record.pass_id == object::id(pass), EEntitlementMissing);
}

fun issue_pass<PaymentCoin>(
    root: &mut MakerRootV8<PaymentCoin>,
    paid_atomic: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let holder = ctx.sender();
    let entitlement_key = EntitlementKeyV8 { wallet: holder };
    assert!(!df::exists(&root.id, entitlement_key), EEntitlementExists);
    let pass = MakerPassV8 {
        id: object::new(ctx),
        version: VERSION,
        root_id: object::id(root),
        holder,
        paid_atomic,
        issued_at_ms: clock.timestamp_ms(),
        ownership_epoch: root.ownership_epoch,
        content_commitment: root.content_commitment,
    };
    let pass_id = object::id(&pass);
    let record = EntitlementRecordV8 {
        pass_id,
        wallet: holder,
        paid_atomic,
        issued_at_ms: clock.timestamp_ms(),
        ownership_epoch: root.ownership_epoch,
        content_commitment: root.content_commitment,
    };
    df::add(&mut root.id, entitlement_key, record);
    root.entitlement_count = root.entitlement_count + 1;
    event::emit(MakerPassV8Issued {
        root_id: object::id(root),
        pass_id,
        holder,
        paid_atomic,
        ownership_epoch: root.ownership_epoch,
        content_commitment: root.content_commitment,
    });
    transfer::transfer(pass, holder);
}

public(package) fun assert_draft_admin_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
) {
    assert_admin_v8(root, admin);
    assert!(root.lifecycle == DRAFT, EInvalidLifecycle);
}

public(package) fun assert_admin_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
) {
    assert!(admin.version == VERSION, EInvalidAdminCap);
    assert!(admin.root_id == object::id(root), EInvalidAdminCap);
    assert!(object::id(admin) == root.admin_cap_id, EInvalidAdminCap);
    assert!(admin.treasury_id == root.treasury_id, EInvalidAdminCap);
    assert!(admin.owner == root.owner, EInvalidAdminCap);
    assert!(admin.ownership_epoch == root.ownership_epoch, EOwnershipEpochMismatch);
}

public(package) fun assert_current_admin_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
) {
    assert_admin_v8(root, admin);
    assert!(root.lifecycle != ARCHIVED, ETerminalLifecycle);
}

public(package) fun assert_root_epoch_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    root_id: ID,
    ownership_epoch: u64,
) {
    assert!(object::id(root) == root_id, ECapabilityBindingMismatch);
    assert!(root.ownership_epoch == ownership_epoch, EOwnershipEpochMismatch);
}

public(package) fun assert_active_v8<PaymentCoin>(root: &MakerRootV8<PaymentCoin>) {
    assert_active(root)
}

public(package) fun assert_active_root_v8<PaymentCoin>(root: &MakerRootV8<PaymentCoin>) {
    assert_active(root)
}

fun assert_active<PaymentCoin>(root: &MakerRootV8<PaymentCoin>) {
    assert!(root.lifecycle == ACTIVE, EInvalidLifecycle);
}

fun assert_maker_treasury<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    treasury: &MakerTreasuryV8<PaymentCoin>,
) {
    assert!(treasury.version == VERSION, EInvalidTreasury);
    assert!(treasury.root_id == object::id(root), EInvalidTreasury);
    assert!(object::id(treasury) == root.treasury_id, EInvalidTreasury);
    assert!(protocol::payment_coin_type_name_v8<PaymentCoin>() == root.payment_coin_type, EInvalidTreasury);
}

fun assert_core_rows_complete<PaymentCoin>(root: &MakerRootV8<PaymentCoin>) {
    assert!(root.next_sequence == root.expected_sequence_count, ECountMismatch);
    assert!(root.observed_counts.tracks == root.expected_counts.tracks, ECountMismatch);
    assert!(root.observed_counts.parts == root.expected_counts.parts, ECountMismatch);
    assert!(root.observed_counts.items == root.expected_counts.items, ECountMismatch);
    assert!(root.observed_counts.styles == root.expected_counts.styles, ECountMismatch);
    assert!(root.observed_counts.colors == root.expected_counts.colors, ECountMismatch);
    assert!(root.observed_counts.rules == root.expected_counts.rules, ECountMismatch);
    assert_registry_commitments_equal(
        &root.rolling_registry_commitments,
        &root.expected_registry_commitments,
    );
}

fun assert_distinct_binding_ids<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    composition: ID,
    pack: ID,
    complete: ID,
    seal: ID,
    physical: &Option<ID>,
) {
    let root_id = object::id(root);
    assert!(composition != pack && composition != complete && composition != seal, ECapabilityIdCollision);
    assert!(pack != complete && pack != seal && complete != seal, ECapabilityIdCollision);
    assert!(composition != root_id && pack != root_id && complete != root_id && seal != root_id, ECapabilityIdCollision);
    assert!(composition != root.treasury_id && pack != root.treasury_id, ECapabilityIdCollision);
    assert!(complete != root.treasury_id && seal != root.treasury_id, ECapabilityIdCollision);
    assert!(composition != root.admin_cap_id && pack != root.admin_cap_id, ECapabilityIdCollision);
    assert!(complete != root.admin_cap_id && seal != root.admin_cap_id, ECapabilityIdCollision);
    if (physical.is_some()) {
        let physical_id = *physical.borrow();
        assert!(physical_id != root_id && physical_id != root.treasury_id, ECapabilityIdCollision);
        assert!(physical_id != root.admin_cap_id, ECapabilityIdCollision);
        assert!(physical_id != composition && physical_id != pack, ECapabilityIdCollision);
        assert!(physical_id != complete && physical_id != seal, ECapabilityIdCollision);
    };
}

fun assert_physical_binding<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    physical_id: &Option<ID>,
    physical_commitment: &Option<vector<u8>>,
) {
    let physical_capability = protocol::capability_physical_v8();
    let declared = (root.declared_capabilities & physical_capability) == physical_capability;
    if (declared) {
        assert!(physical_id.is_some(), ECapabilityBindingMismatch);
        assert!(physical_commitment.is_some(), ECapabilityBindingMismatch);
        assert!(root.expected_capability_commitments.physical.is_some(), ECapabilityBindingMismatch);
        assert!(
            physical_commitment.borrow() == root.expected_capability_commitments.physical.borrow(),
            ECapabilityBindingMismatch,
        );
    } else {
        assert!(physical_id.is_none(), ECapabilityBindingMismatch);
        assert!(physical_commitment.is_none(), ECapabilityBindingMismatch);
        assert!(root.expected_capability_commitments.physical.is_none(), ECapabilityBindingMismatch);
    };
}

fun assert_bindings_present<PaymentCoin>(root: &MakerRootV8<PaymentCoin>) {
    assert!(root.capability_bindings.composition_registry_id.is_some(), ECapabilityBindingMismatch);
    assert!(root.capability_bindings.pack_registry_id.is_some(), ECapabilityBindingMismatch);
    assert!(root.capability_bindings.complete_registry_id.is_some(), ECapabilityBindingMismatch);
    assert!(root.capability_bindings.seal_registry_id.is_some(), ECapabilityBindingMismatch);
    let physical = protocol::capability_physical_v8();
    if ((root.declared_capabilities & physical) == physical) {
        assert!(root.capability_bindings.physical_registry_id.is_some(), ECapabilityBindingMismatch);
    } else {
        assert!(root.capability_bindings.physical_registry_id.is_none(), ECapabilityBindingMismatch);
    };
}

fun set_lifecycle<PaymentCoin>(root: &mut MakerRootV8<PaymentCoin>, next: u8) {
    let previous = root.lifecycle;
    assert!(previous != ARCHIVED, ETerminalLifecycle);
    root.lifecycle = next;
    event::emit(MakerV8LifecycleChanged {
        root_id: object::id(root),
        owner: root.owner,
        ownership_epoch: root.ownership_epoch,
        from: previous,
        to: next,
    });
}

fun assert_category_sequence<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    category: u8,
    sequence: u64,
) {
    assert!(sequence == root.next_sequence, EWrongSequence);
    let (start, count) = category_range(&root.expected_counts, category);
    assert!(sequence >= start && sequence < start + count, EWrongSequence);
}

fun category_range(counts: &RowCountsV8, category: u8): (u64, u64) {
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

fun advance_root_commitments<PaymentCoin>(
    root: &mut MakerRootV8<PaymentCoin>,
    category: u8,
    sequence: u64,
    row_bytes: vector<u8>,
) {
    if (category == CATEGORY_TRACK) {
        root.rolling_registry_commitments.tracks = advance_commitment_v8(
            category,
            root.rolling_registry_commitments.tracks,
            sequence,
            row_bytes,
        );
    } else if (category == CATEGORY_PART) {
        root.rolling_registry_commitments.parts = advance_commitment_v8(
            category,
            root.rolling_registry_commitments.parts,
            sequence,
            row_bytes,
        );
    } else if (category == CATEGORY_ITEM) {
        root.rolling_registry_commitments.items = advance_commitment_v8(
            category,
            root.rolling_registry_commitments.items,
            sequence,
            row_bytes,
        );
    } else if (category == CATEGORY_STYLE) {
        root.rolling_registry_commitments.styles = advance_commitment_v8(
            category,
            root.rolling_registry_commitments.styles,
            sequence,
            row_bytes,
        );
    } else if (category == CATEGORY_COLOR) {
        root.rolling_registry_commitments.colors = advance_commitment_v8(
            category,
            root.rolling_registry_commitments.colors,
            sequence,
            row_bytes,
        );
    } else if (category == CATEGORY_RULE) {
        root.rolling_registry_commitments.rules = advance_commitment_v8(
            category,
            root.rolling_registry_commitments.rules,
            sequence,
            row_bytes,
        );
    } else {
        abort EInvalidCategory
    };
    root.rolling_registry_commitments.aggregate = advance_commitment_v8(
        CATEGORY_AGGREGATE,
        root.rolling_registry_commitments.aggregate,
        sequence,
        row_bytes,
    );
    root.next_sequence = root.next_sequence + 1;
}

fun assert_expected_registry_commitments(expected: &RegistryCommitmentsV8) {
    assert_digest(&expected.tracks);
    assert_digest(&expected.parts);
    assert_digest(&expected.items);
    assert_digest(&expected.styles);
    assert_digest(&expected.colors);
    assert_digest(&expected.rules);
    assert_digest(&expected.aggregate);
}

fun assert_registry_commitments_equal(
    actual: &RegistryCommitmentsV8,
    expected: &RegistryCommitmentsV8,
) {
    assert!(&actual.tracks == &expected.tracks, ECommitmentMismatch);
    assert!(&actual.parts == &expected.parts, ECommitmentMismatch);
    assert!(&actual.items == &expected.items, ECommitmentMismatch);
    assert!(&actual.styles == &expected.styles, ECommitmentMismatch);
    assert!(&actual.colors == &expected.colors, ECommitmentMismatch);
    assert!(&actual.rules == &expected.rules, ECommitmentMismatch);
    assert!(&actual.aggregate == &expected.aggregate, ECommitmentMismatch);
}

fun assert_valid_expected_counts(counts: &RowCountsV8) {
    assert!(counts.tracks > 0 && counts.tracks <= MAX_TRACKS, EInvalidCounts);
    assert!(counts.parts > 0 && counts.parts <= MAX_PARTS, EInvalidCounts);
    assert!(counts.items > 0 && counts.items <= MAX_ITEMS, EInvalidCounts);
    assert!(counts.styles > 0 && counts.styles <= MAX_STYLES, EInvalidCounts);
    assert!(counts.colors <= MAX_COLORS, EInvalidCounts);
    assert!(counts.rules <= MAX_RULES, EInvalidCounts);
    assert!(counts.slots <= MAX_SLOTS, EInvalidCounts);
    assert!(counts.pack_releases <= MAX_PACK_RELEASES, EInvalidCounts);
    assert!(counts.protected_assets <= MAX_PROTECTED_ASSETS, EInvalidCounts);
    assert!(counts.parts >= counts.tracks, EInvalidCounts);
    assert!(counts.items >= counts.parts, EInvalidCounts);
    assert!(counts.styles >= counts.items, EInvalidCounts);
}

fun assert_capability_declaration(
    declared: u64,
    expected: &CapabilityCommitmentsV8,
) {
    let required = protocol::required_capabilities_v8();
    let supported = protocol::supported_capabilities_v8();
    assert!((declared & required) == required, EInvalidCapabilities);
    assert!((declared & supported) == declared, EInvalidCapabilities);
    assert_digest(&expected.composition);
    assert_digest(&expected.pack);
    assert_digest(&expected.complete);
    assert_digest(&expected.seal);
    let physical = protocol::capability_physical_v8();
    if ((declared & physical) == physical) {
        assert!(expected.physical.is_some(), EInvalidCapabilities);
        assert_digest(expected.physical.borrow());
    } else {
        assert!(expected.physical.is_none(), EInvalidCapabilities);
    };
}

fun assert_lineage(
    previous_root_id: &Option<ID>,
    previous_version_commitment: &Option<vector<u8>>,
) {
    assert!(previous_root_id.is_some() == previous_version_commitment.is_some(), EInvalidLineage);
    if (previous_version_commitment.is_some()) assert_digest(previous_version_commitment.borrow());
}

fun assert_valid_access(access: u8, price: u64) {
    assert!(
        (access == ACCESS_FREE && price == 0)
            || (access == ACCESS_PAID && price > 0),
        EInvalidEconomics,
    );
}

fun assert_digest(value: &vector<u8>) {
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

fun zero_counts(): RowCountsV8 {
    RowCountsV8 {
        tracks: 0,
        parts: 0,
        items: 0,
        styles: 0,
        colors: 0,
        rules: 0,
        slots: 0,
        pack_releases: 0,
        protected_assets: 0,
    }
}

fun empty_registry_commitments(): RegistryCommitmentsV8 {
    RegistryCommitmentsV8 {
        tracks: empty_category_commitment_v8(CATEGORY_TRACK),
        parts: empty_category_commitment_v8(CATEGORY_PART),
        items: empty_category_commitment_v8(CATEGORY_ITEM),
        styles: empty_category_commitment_v8(CATEGORY_STYLE),
        colors: empty_category_commitment_v8(CATEGORY_COLOR),
        rules: empty_category_commitment_v8(CATEGORY_RULE),
        aggregate: empty_category_commitment_v8(CATEGORY_AGGREGATE),
    }
}

fun empty_capability_bindings(): CapabilityBindingsV8 {
    CapabilityBindingsV8 {
        composition_registry_id: option::none(),
        pack_registry_id: option::none(),
        complete_registry_id: option::none(),
        seal_registry_id: option::none(),
        physical_registry_id: option::none(),
    }
}

fun core_sequence_count(counts: &RowCountsV8): u64 {
    counts.tracks + counts.parts + counts.items + counts.styles + counts.colors + counts.rules
}

public fun root_id_v8<PaymentCoin>(root: &MakerRootV8<PaymentCoin>): ID { object::id(root) }
public fun ownership_epoch_v8<PaymentCoin>(root: &MakerRootV8<PaymentCoin>): u64 {
    root.ownership_epoch
}
public fun content_commitment_v8<PaymentCoin>(root: &MakerRootV8<PaymentCoin>): &vector<u8> {
    &root.content_commitment
}
public fun admin_cap_id_v8<PaymentCoin>(root: &MakerRootV8<PaymentCoin>): ID {
    root.admin_cap_id
}
public fun root_version_v8<PaymentCoin>(root: &MakerRootV8<PaymentCoin>): u64 { root.version }
public fun root_package_id_v8<PaymentCoin>(root: &MakerRootV8<PaymentCoin>): ID { root.package_id }
public fun root_protocol_config_id_v8<PaymentCoin>(root: &MakerRootV8<PaymentCoin>): ID {
    root.protocol_config_id
}
public fun root_creator_v8<PaymentCoin>(root: &MakerRootV8<PaymentCoin>): address { root.creator }
public fun root_owner_v8<PaymentCoin>(root: &MakerRootV8<PaymentCoin>): address { root.owner }
public fun root_admin_cap_id_v8<PaymentCoin>(root: &MakerRootV8<PaymentCoin>): ID { root.admin_cap_id }
public fun root_treasury_id_v8<PaymentCoin>(root: &MakerRootV8<PaymentCoin>): ID { root.treasury_id }
public fun root_ownership_epoch_v8<PaymentCoin>(root: &MakerRootV8<PaymentCoin>): u64 {
    root.ownership_epoch
}
public fun root_lifecycle_v8<PaymentCoin>(root: &MakerRootV8<PaymentCoin>): u8 { root.lifecycle }
public fun root_maker_key_v8<PaymentCoin>(root: &MakerRootV8<PaymentCoin>): &String { &root.maker_key }
public fun root_maker_version_v8<PaymentCoin>(root: &MakerRootV8<PaymentCoin>): &String {
    &root.maker_version
}
public fun root_version_commitment_v8<PaymentCoin>(root: &MakerRootV8<PaymentCoin>): &vector<u8> {
    &root.version_commitment
}
public fun root_renderer_commitment_v8<PaymentCoin>(root: &MakerRootV8<PaymentCoin>): &vector<u8> {
    &root.renderer_commitment
}
public fun root_manifest_blob_id_v8<PaymentCoin>(root: &MakerRootV8<PaymentCoin>): &String {
    &root.manifest_blob_id
}
public fun root_manifest_sha256_v8<PaymentCoin>(root: &MakerRootV8<PaymentCoin>): &vector<u8> {
    &root.manifest_sha256
}
public fun root_content_commitment_v8<PaymentCoin>(root: &MakerRootV8<PaymentCoin>): &vector<u8> {
    &root.content_commitment
}
public fun root_payment_coin_type_v8<PaymentCoin>(root: &MakerRootV8<PaymentCoin>): &String {
    &root.payment_coin_type
}
public fun root_declared_capabilities_v8<PaymentCoin>(root: &MakerRootV8<PaymentCoin>): u64 {
    root.declared_capabilities
}
public fun root_next_sequence_v8<PaymentCoin>(root: &MakerRootV8<PaymentCoin>): u64 {
    root.next_sequence
}
public fun root_expected_sequence_count_v8<PaymentCoin>(root: &MakerRootV8<PaymentCoin>): u64 {
    root.expected_sequence_count
}
public fun root_expected_counts_v8<PaymentCoin>(root: &MakerRootV8<PaymentCoin>): RowCountsV8 {
    root.expected_counts
}
public fun root_observed_counts_v8<PaymentCoin>(root: &MakerRootV8<PaymentCoin>): RowCountsV8 {
    root.observed_counts
}
public fun root_expected_capability_commitments_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
): CapabilityCommitmentsV8 { root.expected_capability_commitments }
public fun root_economics_v8<PaymentCoin>(root: &MakerRootV8<PaymentCoin>): EconomicsV8 {
    root.economics
}
public fun root_rights_v8<PaymentCoin>(root: &MakerRootV8<PaymentCoin>): RightsV8 { root.rights }
public fun root_entitlement_count_v8<PaymentCoin>(root: &MakerRootV8<PaymentCoin>): u64 {
    root.entitlement_count
}
public fun root_has_entitlement_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    wallet: address,
): bool { df::exists(&root.id, EntitlementKeyV8 { wallet }) }
public fun admin_root_id_v8(admin: &MakerAdminCapV8): ID { admin.root_id }
public fun admin_owner_v8(admin: &MakerAdminCapV8): address { admin.owner }
public fun admin_ownership_epoch_v8(admin: &MakerAdminCapV8): u64 { admin.ownership_epoch }
public fun maker_treasury_root_id_v8<PaymentCoin>(treasury: &MakerTreasuryV8<PaymentCoin>): ID {
    treasury.root_id
}
public fun maker_treasury_balance_v8<PaymentCoin>(treasury: &MakerTreasuryV8<PaymentCoin>): u64 {
    treasury.revenue.value()
}
public fun maker_treasury_total_collected_v8<PaymentCoin>(
    treasury: &MakerTreasuryV8<PaymentCoin>,
): u64 { treasury.total_collected }
public fun maker_pass_root_id_v8(pass: &MakerPassV8): ID { pass.root_id }
public fun maker_pass_holder_v8(pass: &MakerPassV8): address { pass.holder }
public fun maker_pass_paid_atomic_v8(pass: &MakerPassV8): u64 { pass.paid_atomic }
public fun maker_pass_content_commitment_v8(pass: &MakerPassV8): &vector<u8> {
    &pass.content_commitment
}

public fun row_counts_tracks_v8(counts: &RowCountsV8): u64 { counts.tracks }
public fun row_counts_parts_v8(counts: &RowCountsV8): u64 { counts.parts }
public fun row_counts_items_v8(counts: &RowCountsV8): u64 { counts.items }
public fun row_counts_styles_v8(counts: &RowCountsV8): u64 { counts.styles }
public fun row_counts_colors_v8(counts: &RowCountsV8): u64 { counts.colors }
public fun row_counts_rules_v8(counts: &RowCountsV8): u64 { counts.rules }
public fun row_counts_slots_v8(counts: &RowCountsV8): u64 { counts.slots }
public fun row_counts_pack_releases_v8(counts: &RowCountsV8): u64 { counts.pack_releases }
public fun row_counts_protected_assets_v8(counts: &RowCountsV8): u64 { counts.protected_assets }

public fun economics_maker_access_v8(economics: &EconomicsV8): u8 { economics.maker_access }
public fun economics_maker_price_v8(economics: &EconomicsV8): u64 {
    economics.maker_price_atomic
}
public fun economics_complete_access_v8(economics: &EconomicsV8): u8 { economics.complete_access }
public fun economics_complete_price_v8(economics: &EconomicsV8): u64 {
    economics.complete_price_atomic
}
public fun economics_complete_per_wallet_quota_v8(economics: &EconomicsV8): u64 {
    economics.complete_per_wallet_quota
}
public fun economics_complete_total_cap_v8(economics: &EconomicsV8): u64 {
    economics.complete_total_cap
}
public fun economics_commitment_v8(economics: &EconomicsV8): &vector<u8> {
    &economics.commitment
}
public fun rights_commitment_v8(rights: &RightsV8): &vector<u8> { &rights.commitment }

#[test_only]
fun test_digest(byte: u8): vector<u8> {
    let mut digest = vector[];
    let mut index = 0;
    while (index < HASH_LENGTH) {
        digest.push_back(byte);
        index = index + 1;
    };
    digest
}

#[test_only]
fun test_registry_commitments(protected: bool): RegistryCommitmentsV8 {
    let track = TrackRowV8 {
        sequence: 0,
        key: b"body".to_string(),
        label: b"Body".to_string(),
        render_order: 0,
        required: true,
        payload_commitment: test_digest(21),
    };
    let part = PartRowV8 {
        sequence: 1,
        key: b"face".to_string(),
        track_key: b"body".to_string(),
        label: b"Face".to_string(),
        kind: 0,
        render_order: 0,
        required: true,
        visible: true,
        payload_commitment: test_digest(22),
    };
    let item = ItemRowV8 {
        sequence: 2,
        part_key: b"face".to_string(),
        item_key: b"base".to_string(),
        label: b"Base".to_string(),
        gate_kind: 0,
        payload_commitment: test_digest(23),
    };
    let style = StyleRowV8 {
        sequence: 3,
        part_key: b"face".to_string(),
        item_key: b"base".to_string(),
        style_key: b"default".to_string(),
        label: b"Default".to_string(),
        asset_blob_id: b"walrus-style".to_string(),
        asset_sha256: test_digest(24),
        protected,
        payload_commitment: test_digest(25),
    };
    let track_bytes = bcs::to_bytes(&track);
    let part_bytes = bcs::to_bytes(&part);
    let item_bytes = bcs::to_bytes(&item);
    let style_bytes = bcs::to_bytes(&style);
    let tracks = advance_commitment_v8(
        CATEGORY_TRACK,
        empty_category_commitment_v8(CATEGORY_TRACK),
        0,
        track_bytes,
    );
    let parts = advance_commitment_v8(
        CATEGORY_PART,
        empty_category_commitment_v8(CATEGORY_PART),
        1,
        part_bytes,
    );
    let items = advance_commitment_v8(
        CATEGORY_ITEM,
        empty_category_commitment_v8(CATEGORY_ITEM),
        2,
        item_bytes,
    );
    let styles = advance_commitment_v8(
        CATEGORY_STYLE,
        empty_category_commitment_v8(CATEGORY_STYLE),
        3,
        style_bytes,
    );
    let mut aggregate = empty_category_commitment_v8(CATEGORY_AGGREGATE);
    aggregate = advance_commitment_v8(CATEGORY_AGGREGATE, aggregate, 0, track_bytes);
    aggregate = advance_commitment_v8(CATEGORY_AGGREGATE, aggregate, 1, part_bytes);
    aggregate = advance_commitment_v8(CATEGORY_AGGREGATE, aggregate, 2, item_bytes);
    aggregate = advance_commitment_v8(CATEGORY_AGGREGATE, aggregate, 3, style_bytes);
    RegistryCommitmentsV8 {
        tracks,
        parts,
        items,
        styles,
        colors: empty_category_commitment_v8(CATEGORY_COLOR),
        rules: empty_category_commitment_v8(CATEGORY_RULE),
        aggregate,
    }
}

#[test_only]
fun test_capability_commitments(): CapabilityCommitmentsV8 {
    new_capability_commitments_v8(
        test_digest(31),
        test_digest(32),
        test_digest(33),
        test_digest(34),
        option::none(),
    )
}

#[test_only]
fun new_test_maker(
    access: u8,
    price: u64,
    protected: bool,
    clock: &Clock,
    ctx: &mut TxContext,
): (
    ProtocolConfigV8,
    ProtocolTreasuryV8<sui::sui::SUI>,
    ProtocolAdminCapV8,
    MakerRootV8<sui::sui::SUI>,
    MakerTreasuryV8<sui::sui::SUI>,
    MakerAdminCapV8,
) {
    let (config, protocol_treasury, protocol_cap) =
        protocol::new_protocol_for_testing<sui::sui::SUI>(true, ctx);
    let expected_counts = new_row_counts_v8(
        1,
        1,
        1,
        1,
        0,
        0,
        0,
        0,
        if (protected) 1 else 0,
    );
    let economics = new_economics_v8(
        access,
        price,
        ACCESS_FREE,
        0,
        0,
        0,
        protocol::default_primary_protocol_fee_bps_v8(),
    );
    let rights = new_rights_v8(RIGHTS_ONCHAIN_NATIVE, true, 250, 250, 500);
    let (root, treasury, admin) = new_maker_v8<sui::sui::SUI>(
        &config,
        b"maker-test".to_string(),
        b"1.0.0".to_string(),
        option::none(),
        option::none(),
        test_digest(1),
        b"walrus-manifest".to_string(),
        test_digest(2),
        test_digest(3),
        expected_counts,
        test_registry_commitments(protected),
        test_capability_commitments(),
        protocol::required_capabilities_v8(),
        economics,
        rights,
        clock,
        ctx,
    );
    (config, protocol_treasury, protocol_cap, root, treasury, admin)
}

#[test_only]
fun append_test_rows(
    root: &mut MakerRootV8<sui::sui::SUI>,
    admin: &MakerAdminCapV8,
    protected: bool,
) {
    append_track_v8(
        root,
        admin,
        0,
        b"body".to_string(),
        b"Body".to_string(),
        0,
        true,
        test_digest(21),
    );
    append_part_v8(
        root,
        admin,
        1,
        b"face".to_string(),
        b"body".to_string(),
        b"Face".to_string(),
        0,
        0,
        true,
        true,
        test_digest(22),
    );
    append_item_v8(
        root,
        admin,
        2,
        b"face".to_string(),
        b"base".to_string(),
        b"Base".to_string(),
        0,
        test_digest(23),
    );
    append_style_v8(
        root,
        admin,
        3,
        b"face".to_string(),
        b"base".to_string(),
        b"default".to_string(),
        b"Default".to_string(),
        b"walrus-style".to_string(),
        test_digest(24),
        protected,
        test_digest(25),
    );
}

#[test_only]
fun test_activation_bindings(protected: bool): ActivationBindingsV8 {
    new_activation_bindings_v8(
        object::id_from_address(@0xC1),
        test_digest(31),
        0,
        object::id_from_address(@0xC2),
        test_digest(32),
        0,
        object::id_from_address(@0xC3),
        test_digest(33),
        object::id_from_address(@0xC4),
        test_digest(34),
        if (protected) 1 else 0,
        option::none(),
        option::none(),
    )
}

#[test_only]
fun activate_test_maker(
    root: &mut MakerRootV8<sui::sui::SUI>,
    admin: &MakerAdminCapV8,
    treasury: &MakerTreasuryV8<sui::sui::SUI>,
    config: &ProtocolConfigV8,
    protected: bool,
    clock: &Clock,
    ctx: &TxContext,
) {
    activate_checked_v8(
        root,
        admin,
        treasury,
        config,
        test_activation_bindings(protected),
        clock,
        ctx,
    )
}

#[test]
fun exact_rows_activate_once_and_lifecycle_is_terminal() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 10, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (config, protocol_treasury, protocol_cap, mut root, treasury, admin) =
        new_test_maker(ACCESS_FREE, 0, false, &clock, &mut ctx);
    append_test_rows(&mut root, &admin, false);
    activate_test_maker(&mut root, &admin, &treasury, &config, false, &clock, &ctx);
    assert!(root.lifecycle == ACTIVE, EInvalidLifecycle);
    pause_maker_v8(&mut root, &admin, &ctx);
    assert!(root.lifecycle == PAUSED, EInvalidLifecycle);
    resume_checked_v8(&mut root, &admin, &config, &ctx);
    assert!(root.lifecycle == ACTIVE, EInvalidLifecycle);
    archive_maker_v8(&mut root, &admin, &ctx);
    assert!(root.lifecycle == ARCHIVED, EInvalidLifecycle);
    share_maker_objects_v8(root, treasury, admin, &ctx);
    protocol::destroy_protocol_for_testing(config, protocol_treasury, protocol_cap);
    clock.destroy_for_testing();
}

#[test]
fun free_pass_is_real_zero_payment_entitlement() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 11, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (config, protocol_treasury, protocol_cap, mut root, treasury, admin) =
        new_test_maker(ACCESS_FREE, 0, false, &clock, &mut ctx);
    append_test_rows(&mut root, &admin, false);
    activate_test_maker(&mut root, &admin, &treasury, &config, false, &clock, &ctx);
    claim_free_maker_pass_v8(&mut root, &clock, &mut ctx);
    assert!(root.entitlement_count == 1, EEntitlementMissing);
    assert!(root_has_entitlement_v8(&root, @0xA11), EEntitlementMissing);
    assert!(treasury.revenue.value() == 0, EWrongPayment);
    share_maker_objects_v8(root, treasury, admin, &ctx);
    protocol::destroy_protocol_for_testing(config, protocol_treasury, protocol_cap);
    clock.destroy_for_testing();
}

#[test]
fun paid_pass_splits_protocol_and_maker_revenue() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 12, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (config, mut protocol_treasury, protocol_cap, mut root, mut treasury, admin) =
        new_test_maker(ACCESS_PAID, 1_000, false, &clock, &mut ctx);
    append_test_rows(&mut root, &admin, false);
    activate_test_maker(&mut root, &admin, &treasury, &config, false, &clock, &ctx);
    let payment = coin::from_balance(
        balance::create_for_testing<sui::sui::SUI>(1_000),
        &mut ctx,
    );
    purchase_maker_pass_v8(
        &mut root,
        &mut treasury,
        &config,
        &mut protocol_treasury,
        payment,
        &clock,
        &mut ctx,
    );
    assert!(treasury.revenue.value() == 500, EWrongPayment);
    assert!(protocol::protocol_treasury_balance_v8(&protocol_treasury) == 500, EWrongPayment);
    withdraw_maker_revenue_v8(
        &root,
        &admin,
        &mut treasury,
        500,
        @0xB11,
        &mut ctx,
    );
    protocol::withdraw_protocol_revenue_v8(
        &config,
        &protocol_cap,
        &mut protocol_treasury,
        500,
        @0xB12,
        &mut ctx,
    );
    share_maker_objects_v8(root, treasury, admin, &ctx);
    protocol::destroy_protocol_for_testing(config, protocol_treasury, protocol_cap);
    clock.destroy_for_testing();
}

#[test, expected_failure(abort_code = ECountMismatch)]
fun partial_rows_cannot_activate() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 13, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (config, protocol_treasury, protocol_cap, mut root, treasury, admin) =
        new_test_maker(ACCESS_FREE, 0, false, &clock, &mut ctx);
    activate_test_maker(&mut root, &admin, &treasury, &config, false, &clock, &ctx);
    share_maker_objects_v8(root, treasury, admin, &ctx);
    protocol::destroy_protocol_for_testing(config, protocol_treasury, protocol_cap);
    clock.destroy_for_testing();
}

#[test, expected_failure(abort_code = EWrongSequence)]
fun out_of_order_row_is_rejected() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 14, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (config, protocol_treasury, protocol_cap, mut root, treasury, admin) =
        new_test_maker(ACCESS_FREE, 0, false, &clock, &mut ctx);
    append_track_v8(
        &mut root,
        &admin,
        1,
        b"body".to_string(),
        b"Body".to_string(),
        0,
        true,
        test_digest(21),
    );
    share_maker_objects_v8(root, treasury, admin, &ctx);
    protocol::destroy_protocol_for_testing(config, protocol_treasury, protocol_cap);
    clock.destroy_for_testing();
}

#[test, expected_failure(abort_code = EDuplicateRow)]
fun duplicate_dynamic_row_key_is_rejected() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 141, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (config, protocol_treasury, protocol_cap, mut root, treasury, admin) =
        new_test_maker(ACCESS_FREE, 0, false, &clock, &mut ctx);
    root.expected_counts.tracks = 2;
    root.expected_sequence_count = root.expected_sequence_count + 1;
    append_track_v8(
        &mut root,
        &admin,
        0,
        b"body".to_string(),
        b"Body".to_string(),
        0,
        true,
        test_digest(21),
    );
    append_track_v8(
        &mut root,
        &admin,
        1,
        b"body".to_string(),
        b"Body duplicate".to_string(),
        1,
        true,
        test_digest(26),
    );
    share_maker_objects_v8(root, treasury, admin, &ctx);
    protocol::destroy_protocol_for_testing(config, protocol_treasury, protocol_cap);
    clock.destroy_for_testing();
}

#[test, expected_failure(abort_code = ECommitmentMismatch)]
fun category_hash_mismatch_cannot_activate() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 15, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (config, protocol_treasury, protocol_cap, mut root, treasury, admin) =
        new_test_maker(ACCESS_FREE, 0, false, &clock, &mut ctx);
    root.expected_registry_commitments.styles = test_digest(99);
    append_test_rows(&mut root, &admin, false);
    activate_test_maker(&mut root, &admin, &treasury, &config, false, &clock, &ctx);
    share_maker_objects_v8(root, treasury, admin, &ctx);
    protocol::destroy_protocol_for_testing(config, protocol_treasury, protocol_cap);
    clock.destroy_for_testing();
}

#[test, expected_failure(abort_code = 8, location = animacraft_v8::protocol_config_v8)]
fun config_revision_drift_cannot_activate() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 16, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (mut config, protocol_treasury, protocol_cap, mut root, treasury, admin) =
        new_test_maker(ACCESS_FREE, 0, false, &clock, &mut ctx);
    append_test_rows(&mut root, &admin, false);
    protocol::set_protocol_enabled_v8(&mut config, &protocol_cap, false);
    protocol::set_protocol_enabled_v8(&mut config, &protocol_cap, true);
    activate_test_maker(&mut root, &admin, &treasury, &config, false, &clock, &ctx);
    share_maker_objects_v8(root, treasury, admin, &ctx);
    protocol::destroy_protocol_for_testing(config, protocol_treasury, protocol_cap);
    clock.destroy_for_testing();
}

#[test, expected_failure(abort_code = EInvalidLifecycle)]
fun activation_replay_is_rejected() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 161, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (config, protocol_treasury, protocol_cap, mut root, treasury, admin) =
        new_test_maker(ACCESS_FREE, 0, false, &clock, &mut ctx);
    append_test_rows(&mut root, &admin, false);
    activate_test_maker(&mut root, &admin, &treasury, &config, false, &clock, &ctx);
    activate_test_maker(&mut root, &admin, &treasury, &config, false, &clock, &ctx);
    share_maker_objects_v8(root, treasury, admin, &ctx);
    protocol::destroy_protocol_for_testing(config, protocol_treasury, protocol_cap);
    clock.destroy_for_testing();
}

#[test, expected_failure(abort_code = EWrongPayment)]
fun paid_pass_rejects_wrong_payment() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 162, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (config, mut protocol_treasury, protocol_cap, mut root, mut treasury, admin) =
        new_test_maker(ACCESS_PAID, 1_000, false, &clock, &mut ctx);
    append_test_rows(&mut root, &admin, false);
    activate_test_maker(&mut root, &admin, &treasury, &config, false, &clock, &ctx);
    let payment = coin::from_balance(
        balance::create_for_testing<sui::sui::SUI>(999),
        &mut ctx,
    );
    purchase_maker_pass_v8(
        &mut root,
        &mut treasury,
        &config,
        &mut protocol_treasury,
        payment,
        &clock,
        &mut ctx,
    );
    share_maker_objects_v8(root, treasury, admin, &ctx);
    protocol::destroy_protocol_for_testing(config, protocol_treasury, protocol_cap);
    clock.destroy_for_testing();
}

#[test, expected_failure(abort_code = EInvalidAdminCap)]
fun foreign_admin_cap_cannot_write() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 17, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (config_a, pt_a, pc_a, mut root_a, treasury_a, admin_a) =
        new_test_maker(ACCESS_FREE, 0, false, &clock, &mut ctx);
    let (config_b, pt_b, pc_b, root_b, treasury_b, admin_b) =
        new_test_maker(ACCESS_FREE, 0, false, &clock, &mut ctx);
    append_track_v8(
        &mut root_a,
        &admin_b,
        0,
        b"body".to_string(),
        b"Body".to_string(),
        0,
        true,
        test_digest(21),
    );
    share_maker_objects_v8(root_a, treasury_a, admin_a, &ctx);
    share_maker_objects_v8(root_b, treasury_b, admin_b, &ctx);
    protocol::destroy_protocol_for_testing(config_a, pt_a, pc_a);
    protocol::destroy_protocol_for_testing(config_b, pt_b, pc_b);
    clock.destroy_for_testing();
}

#[test, expected_failure(abort_code = EInvalidEconomics)]
fun free_access_rejects_nonzero_price() {
    new_economics_v8(ACCESS_FREE, 1, ACCESS_FREE, 0, 0, 0, 5_000);
}

#[test, expected_failure(abort_code = EInvalidRights)]
fun unconfirmed_rights_are_rejected() {
    new_rights_v8(RIGHTS_LICENSE_WRAPPED, false, 250, 250, 500);
}
